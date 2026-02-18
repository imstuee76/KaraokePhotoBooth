from __future__ import annotations

import asyncio
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

import qrcode
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader, select_autoescape

from .capture import build_thumb_cmd, build_transcode_cmd
from .config import APP_DIR, AppConfig, BACKGROUNDS_DIR, OVERLAYS_DIR, SESSIONS_DIR, backgrounds_list, ensure_dirs, load_config, overlays_list, presets_payload, save_config
from .sessions import cleanup_expired, create_session, is_expired, load_session, save_clip, session_dir, stop_session
from .utils import utcnow


ensure_dirs()
app = FastAPI(title="Karaoke Photo Booth")

STATIC_DIR = APP_DIR / "static"
TEMPLATES_DIR = STATIC_DIR  # keep simple: html files are templates

env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
)
env.filters["tojson"] = lambda v: __import__("json").dumps(v)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/overlays", StaticFiles(directory=str(OVERLAYS_DIR)), name="overlays")
app.mount("/backgrounds", StaticFiles(directory=str(BACKGROUNDS_DIR)), name="backgrounds")


def _render(name: str, **ctx: Any) -> HTMLResponse:
    tpl = env.get_template(name)
    return HTMLResponse(tpl.render(**ctx))


def _cfg() -> AppConfig:
    return load_config()

def _version_info() -> Dict[str, str]:
    version = "0.0.0"
    version_file = APP_DIR / "VERSION"
    if version_file.exists():
        try:
            version = version_file.read_text(encoding="utf-8").strip() or version
        except Exception:
            pass

    commit = "unknown"
    try:
        commit = subprocess.check_output(
            ["git", "-C", str(APP_DIR), "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip() or commit
    except Exception:
        pass
    return {"version": version, "commit": commit}


record_lock = asyncio.Lock()

@dataclass
class ActiveSession:
    code: str
    ends_at_iso: str


_active_session: Optional[ActiveSession] = None
_live_tune: Optional[Dict[str, Any]] = None


def _active_payload() -> Optional[Dict[str, Any]]:
    global _active_session
    if not _active_session:
        return None
    meta = load_session(_active_session.code)
    if not meta or is_expired(meta) or meta.stopped_at:
        _active_session = None
        return None
    try:
        ends_at = datetime.fromisoformat(_active_session.ends_at_iso)
    except Exception:
        _active_session = None
        return None
    if utcnow() >= ends_at:
        stop_session(_active_session.code)
        _active_session = None
        return None
    cfg = _cfg()
    return {
        "active": True,
        "code": _active_session.code,
        "ends_at": _active_session.ends_at_iso,
        "qr_url": f"{cfg.base_qr_url.rstrip('/')}/{_active_session.code}",
        "pre_clip_delay_seconds": cfg.pre_clip_delay_seconds,
        "clip_duration_seconds": cfg.clip_duration_seconds,
    }


def _live_payload() -> Dict[str, Any]:
    global _live_tune
    if not _live_tune:
        return {"active": False}
    return {
        "active": True,
        "values": _live_tune.get("values", {}),
        "updated_at": _live_tune.get("updated_at", ""),
        "overlays": overlays_list(),
    }


@app.on_event("startup")
async def _startup() -> None:
    async def _cleanup_loop() -> None:
        while True:
            try:
                cleanup_expired()
            except Exception:
                pass
            await asyncio.sleep(600)

    asyncio.create_task(_cleanup_loop())


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    cfg = _cfg()
    idle_bg_url = ""
    if cfg.idle_background_filename:
        idle_bg_url = f"/backgrounds/{cfg.idle_background_filename}"
    return _render(
        "index.html",
        idle_text=cfg.idle_text,
        idle_bg_url=idle_bg_url,
        show_main_session_controls=cfg.show_main_session_controls,
    )

@app.get("/admin", response_class=HTMLResponse)
async def admin_page() -> HTMLResponse:
    return _render("admin.html")


@app.get("/config", response_class=HTMLResponse)
async def config_page() -> HTMLResponse:
    cfg = _cfg()
    return _render(
        "config.html",
        cfg=cfg,
        overlays=overlays_list(),
        backgrounds=backgrounds_list(),
        presets=presets_payload(),
    )


@app.get("/s/{code}", response_class=HTMLResponse)
async def gallery(code: str) -> HTMLResponse:
    meta = load_session(code)
    if not meta or is_expired(meta):
        return _render("gallery.html", expired=True, code=code, clips=[])
    return _render("gallery.html", expired=False, code=code, clips=meta.clips)


@app.get("/s/{code}/download/{filename}")
async def download(code: str, filename: str) -> Response:
    meta = load_session(code)
    if not meta or is_expired(meta):
        raise HTTPException(status_code=404, detail="expired")
    f = (session_dir(code) / filename).resolve()
    if not f.exists() or f.parent != session_dir(code).resolve():
        raise HTTPException(status_code=404, detail="not found")
    # Force download rather than browser playback.
    return FileResponse(
        str(f),
        media_type="application/octet-stream",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/s/{code}/thumb/{thumbname}")
async def thumb(code: str, thumbname: str) -> Response:
    meta = load_session(code)
    if not meta or is_expired(meta):
        raise HTTPException(status_code=404, detail="expired")
    f = (session_dir(code) / thumbname).resolve()
    if not f.exists() or f.parent != session_dir(code).resolve():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(f), media_type="image/jpeg")


@app.get("/api/config")
async def api_get_config() -> JSONResponse:
    cfg = _cfg()
    return JSONResponse(cfg.__dict__ | {"crop": cfg.crop.__dict__})

@app.get("/api/version")
async def api_version() -> JSONResponse:
    return JSONResponse(_version_info())


@app.post("/api/config")
async def api_set_config(payload: Dict[str, Any]) -> JSONResponse:
    cfg = _cfg()
    # permissive update
    for k, v in payload.items():
        if k == "crop" and isinstance(v, dict):
            for ck, cv in v.items():
                if hasattr(cfg.crop, ck):
                    setattr(cfg.crop, ck, cv)
            continue
        if hasattr(cfg, k):
            setattr(cfg, k, v)
    save_config(cfg)
    return JSONResponse({"ok": True})


@app.get("/api/live-tune")
async def api_live_tune_get() -> JSONResponse:
    return JSONResponse(_live_payload())


@app.post("/api/live-tune/start")
async def api_live_tune_start() -> JSONResponse:
    global _live_tune
    cfg = _cfg()
    _live_tune = {
        "values": cfg.__dict__ | {"crop": cfg.crop.__dict__},
        "updated_at": utcnow().isoformat(),
    }
    return JSONResponse({"ok": True, **_live_payload()})


@app.post("/api/live-tune/update")
async def api_live_tune_update(payload: Dict[str, Any]) -> JSONResponse:
    global _live_tune
    if not _live_tune:
        _live_tune = {"values": {}, "updated_at": utcnow().isoformat()}
    vals = _live_tune["values"]
    for k, v in payload.items():
        if k == "crop" and isinstance(v, dict):
            crop = vals.get("crop", {})
            for ck, cv in v.items():
                crop[ck] = cv
            vals["crop"] = crop
        else:
            vals[k] = v
    _live_tune["updated_at"] = utcnow().isoformat()
    return JSONResponse({"ok": True, **_live_payload()})


@app.post("/api/live-tune/save")
async def api_live_tune_save() -> JSONResponse:
    global _live_tune
    if not _live_tune:
        return JSONResponse({"ok": True, "saved": False})
    cfg = _cfg()
    vals = _live_tune.get("values", {})
    for k, v in vals.items():
        if k == "crop" and isinstance(v, dict):
            for ck, cv in v.items():
                if hasattr(cfg.crop, ck):
                    setattr(cfg.crop, ck, cv)
            continue
        if hasattr(cfg, k):
            setattr(cfg, k, v)
    save_config(cfg)
    _live_tune = None
    return JSONResponse({"ok": True, "saved": True})


@app.post("/api/live-tune/stop")
async def api_live_tune_stop() -> JSONResponse:
    global _live_tune
    _live_tune = None
    return JSONResponse({"ok": True})


@app.post("/api/overlay/upload")
async def api_upload_overlay(file: UploadFile = File(...)) -> JSONResponse:
    ensure_dirs()
    name = Path(file.filename or "overlay.png").name
    if not name.lower().endswith(".png"):
        raise HTTPException(status_code=400, detail="PNG only")
    dest = (OVERLAYS_DIR / name).resolve()
    if dest.parent != OVERLAYS_DIR.resolve():
        raise HTTPException(status_code=400, detail="bad filename")
    content = await file.read()
    dest.write_bytes(content)
    return JSONResponse({"ok": True, "filename": name, "overlays": overlays_list()})

@app.post("/api/background/upload")
async def api_upload_background(file: UploadFile = File(...)) -> JSONResponse:
    ensure_dirs()
    name = Path(file.filename or "idle_bg.jpg").name
    if Path(name).suffix.lower() not in [".png", ".jpg", ".jpeg", ".webp"]:
        raise HTTPException(status_code=400, detail="Image must be png/jpg/jpeg/webp")
    dest = (BACKGROUNDS_DIR / name).resolve()
    if dest.parent != BACKGROUNDS_DIR.resolve():
        raise HTTPException(status_code=400, detail="bad filename")
    content = await file.read()
    dest.write_bytes(content)
    return JSONResponse({"ok": True, "filename": name, "backgrounds": backgrounds_list()})


@app.get("/api/presets")
async def api_presets() -> JSONResponse:
    return JSONResponse({"presets": presets_payload()})


@app.post("/api/session/start")
async def api_session_start() -> JSONResponse:
    global _active_session
    active = _active_payload()
    if active:
        raise HTTPException(status_code=409, detail="session already active")
    cfg = _cfg()
    meta = create_session(cfg.session_ttl_hours)
    ends_at = utcnow() + timedelta(seconds=cfg.session_duration_seconds)
    _active_session = ActiveSession(code=meta.code, ends_at_iso=ends_at.isoformat())
    # base_qr_url is a prefix like http://host:8000/s
    qr_url = f"{cfg.base_qr_url.rstrip('/')}/{meta.code}"
    return JSONResponse(
        {
            "code": meta.code,
            "qr_url": qr_url,
            "expires_at": meta.expires_at,
            "ends_at": ends_at.isoformat(),
            "session_duration_seconds": cfg.session_duration_seconds,
            "pre_clip_delay_seconds": cfg.pre_clip_delay_seconds,
            "clip_duration_seconds": cfg.clip_duration_seconds,
        }
    )

@app.get("/api/session/active")
async def api_session_active() -> JSONResponse:
    payload = _active_payload()
    if not payload:
        return JSONResponse({"active": False})
    return JSONResponse(payload)


@app.post("/api/session/{code}/stop")
async def api_session_stop(code: str) -> JSONResponse:
    global _active_session
    stop_session(code)
    if _active_session and _active_session.code == code:
        _active_session = None
    return JSONResponse({"ok": True})

@app.post("/api/session/stop-active")
async def api_session_stop_active() -> JSONResponse:
    global _active_session
    if _active_session:
        stop_session(_active_session.code)
        _active_session = None
    return JSONResponse({"ok": True})


@app.get("/api/session/{code}/qr.png")
async def api_qr_png(code: str) -> Response:
    cfg = _cfg()
    meta = load_session(code)
    if not meta or is_expired(meta):
        raise HTTPException(status_code=404, detail="expired")
    qr_url = f"{cfg.base_qr_url.rstrip('/')}/{code}"
    img = qrcode.make(qr_url)
    import io

    bio = io.BytesIO()
    img.save(bio, format="PNG")
    return Response(content=bio.getvalue(), media_type="image/png")


@app.post("/api/session/{code}/record")
async def api_session_record(code: str) -> JSONResponse:
    # Kept for backwards-compat experiments; preferred flow is browser upload via /upload.
    raise HTTPException(status_code=410, detail="use /api/session/{code}/upload")

@app.post("/api/session/{code}/upload")
async def api_session_upload(code: str, file: UploadFile = File(...)) -> JSONResponse:
    cfg = _cfg()
    meta = load_session(code)
    if not meta or is_expired(meta):
        raise HTTPException(status_code=404, detail="expired")

    out_dir = session_dir(code)
    out_dir.mkdir(parents=True, exist_ok=True)

    async with record_lock:
        idx = len(meta.clips) + 1
        raw_ext = Path(file.filename or "clip.webm").suffix.lower()
        if raw_ext not in [".webm", ".mp4", ".mkv", ".mov", ".ogg"]:
            raw_ext = ".webm"
        raw_file = out_dir / f"clip_{idx:02d}_raw{raw_ext}"
        mp4_file = out_dir / f"clip_{idx:02d}.mp4"
        thumb_file = out_dir / f"clip_{idx:02d}.jpg"

        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="empty upload")
        raw_file.write_bytes(content)

        cmd = build_transcode_cmd(cfg, raw_file, mp4_file)
        proc = await asyncio.create_subprocess_exec(*cmd)
        rc = await proc.wait()
        if rc != 0 or not mp4_file.exists():
            raise HTTPException(status_code=500, detail="transcode failed (ffmpeg)")

        tcmd = build_thumb_cmd(mp4_file, thumb_file)
        tproc = await asyncio.create_subprocess_exec(*tcmd)
        await tproc.wait()

        # Save meta referencing the MP4.
        save_clip(code, mp4_file.name, thumb_file.name if thumb_file.exists() else "")

        # Delete raw upload to save space (best-effort).
        try:
            raw_file.unlink(missing_ok=True)
        except Exception:
            pass

    return JSONResponse({"ok": True, "file": mp4_file.name, "thumb": thumb_file.name})


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("KPB_HOST", "0.0.0.0")
    port = int(os.environ.get("KPB_PORT", "8000"))
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
