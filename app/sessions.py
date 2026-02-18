from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .config import SESSIONS_DIR, ensure_dirs
from .utils import expires_at, new_code, utcnow


@dataclass
class SessionMeta:
    code: str
    created_at: str  # ISO8601
    expires_at: str  # ISO8601
    stopped_at: str  # ISO8601 or ""
    clips: List[Dict[str, str]]  # {"file": "...", "thumb": "...", "created_at": "..."}


def _meta_path(code: str) -> Path:
    return SESSIONS_DIR / code / "meta.json"


def _parse_iso(s: str) -> datetime:
    # Stored values are ISO8601 with offset.
    return datetime.fromisoformat(s)


def create_session(ttl_hours: int) -> SessionMeta:
    ensure_dirs()
    code = new_code()
    session_dir = SESSIONS_DIR / code
    session_dir.mkdir(parents=True, exist_ok=False)

    now = utcnow()
    meta = SessionMeta(
        code=code,
        created_at=now.isoformat(),
        expires_at=expires_at(ttl_hours).isoformat(),
        stopped_at="",
        clips=[],
    )
    _write_meta(meta)
    return meta


def load_session(code: str) -> Optional[SessionMeta]:
    p = _meta_path(code)
    if not p.exists():
        return None
    raw = json.loads(p.read_text(encoding="utf-8"))
    return SessionMeta(
        code=raw.get("code", code),
        created_at=raw.get("created_at", ""),
        expires_at=raw.get("expires_at", ""),
        stopped_at=raw.get("stopped_at", ""),
        clips=list(raw.get("clips", [])),
    )


def save_clip(code: str, filename: str, thumbname: str) -> None:
    meta = load_session(code)
    if not meta:
        raise FileNotFoundError("session not found")
    meta.clips.append(
        {"file": filename, "thumb": thumbname, "created_at": utcnow().isoformat()}
    )
    _write_meta(meta)


def stop_session(code: str) -> None:
    meta = load_session(code)
    if not meta:
        return
    if not meta.stopped_at:
        meta.stopped_at = utcnow().isoformat()
        _write_meta(meta)


def is_expired(meta: SessionMeta) -> bool:
    if not meta.expires_at:
        return True
    try:
        return utcnow() >= _parse_iso(meta.expires_at)
    except Exception:
        return True


def session_dir(code: str) -> Path:
    return SESSIONS_DIR / code


def cleanup_expired() -> int:
    ensure_dirs()
    deleted = 0
    for d in SESSIONS_DIR.iterdir():
        if not d.is_dir():
            continue
        meta = load_session(d.name)
        if not meta:
            continue
        if is_expired(meta):
            # Best-effort recursive delete.
            for p in sorted(d.rglob("*"), key=lambda p: len(p.as_posix().split("/")), reverse=True):
                try:
                    if p.is_file() or p.is_symlink():
                        p.unlink(missing_ok=True)
                    elif p.is_dir():
                        p.rmdir()
                except Exception:
                    pass
            try:
                d.rmdir()
            except Exception:
                pass
            deleted += 1
    return deleted


def _write_meta(meta: SessionMeta) -> None:
    p = _meta_path(meta.code)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "code": meta.code,
        "created_at": meta.created_at,
        "expires_at": meta.expires_at,
        "stopped_at": meta.stopped_at,
        "clips": meta.clips,
    }
    p.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

