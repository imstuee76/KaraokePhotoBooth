from __future__ import annotations

import json
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Dict, List, Optional


APP_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = APP_DIR / "data"
CONFIG_PATH = DATA_DIR / "config.json"
OVERLAYS_DIR = DATA_DIR / "overlays"
BACKGROUNDS_DIR = DATA_DIR / "backgrounds"
SESSIONS_DIR = DATA_DIR / "sessions"


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


@dataclass
class Crop:
    # If enabled=False, crop is not applied.
    enabled: bool = False
    x: int = 0
    y: int = 0
    w: int = 0
    h: int = 0


@dataclass
class VideoPreset:
    name: str
    width: int
    height: int
    fps: int
    crf: int
    preset: str
    audio_bitrate_k: int


DEFAULT_PRESETS: List[VideoPreset] = [
    VideoPreset(name="1080p30 Balanced", width=1920, height=1080, fps=30, crf=23, preset="veryfast", audio_bitrate_k=128),
    VideoPreset(name="1080p30 High", width=1920, height=1080, fps=30, crf=20, preset="fast", audio_bitrate_k=192),
    VideoPreset(name="720p30 Fast", width=1280, height=720, fps=30, crf=24, preset="ultrafast", audio_bitrate_k=128),
]


@dataclass
class AppConfig:
    # URLs / QR
    base_qr_url: str = "http://localhost:8000/s"

    # Session behavior
    session_ttl_hours: int = 24
    session_duration_seconds: int = 180
    pre_clip_delay_seconds: int = 3
    clip_duration_seconds: int = 10

    # Idle
    idle_text: str = "Not unlocked"
    idle_background_filename: str = ""
    show_main_session_controls: bool = False

    # Browser device selection (substring match on device label; requires permission first).
    preferred_video_device_label: str = ""
    preferred_audio_device_label: str = ""

    # Capture / encoding
    width: int = 1920
    height: int = 1080
    fps: int = 30
    h264_crf: int = 23
    h264_preset: str = "veryfast"
    audio_codec: str = "aac"
    audio_bitrate_k: int = 128
    audio_samplerate: int = 48000
    audio_channels: int = 2

    # Image adjustments (ffmpeg eq)
    brightness: float = 0.0  # -1..1
    contrast: float = 1.0    # 0..2
    saturation: float = 1.0  # 0..3

    crop: Crop = field(default_factory=Crop)

    # Overlay
    overlay_enabled: bool = False
    overlay_filename: str = ""  # stored under data/overlays

    def sanitize(self) -> "AppConfig":
        self.session_ttl_hours = max(1, int(self.session_ttl_hours))
        self.session_duration_seconds = max(10, int(self.session_duration_seconds))
        self.pre_clip_delay_seconds = max(0, int(self.pre_clip_delay_seconds))
        self.clip_duration_seconds = max(1, int(self.clip_duration_seconds))
        self.show_main_session_controls = bool(self.show_main_session_controls)

        self.width = max(160, int(self.width))
        self.height = max(120, int(self.height))
        self.fps = max(1, int(self.fps))
        self.h264_crf = int(_clamp(float(self.h264_crf), 0, 51))
        self.audio_bitrate_k = max(32, int(self.audio_bitrate_k))
        self.audio_samplerate = max(8000, int(self.audio_samplerate))
        self.audio_channels = 1 if int(self.audio_channels) <= 1 else 2

        self.brightness = float(_clamp(float(self.brightness), -1.0, 1.0))
        self.contrast = float(_clamp(float(self.contrast), 0.0, 2.0))
        self.saturation = float(_clamp(float(self.saturation), 0.0, 3.0))

        if not isinstance(self.crop, Crop):
            self.crop = Crop()
        self.crop.enabled = bool(self.crop.enabled)
        self.crop.x = max(0, int(self.crop.x))
        self.crop.y = max(0, int(self.crop.y))
        self.crop.w = max(0, int(self.crop.w))
        self.crop.h = max(0, int(self.crop.h))

        return self


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OVERLAYS_DIR.mkdir(parents=True, exist_ok=True)
    BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def overlays_list() -> List[str]:
    ensure_dirs()
    files = []
    for p in OVERLAYS_DIR.glob("*.png"):
        if p.is_file():
            files.append(p.name)
    files.sort()
    return files


def backgrounds_list() -> List[str]:
    ensure_dirs()
    files: List[str] = []
    for p in BACKGROUNDS_DIR.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]:
            files.append(p.name)
    files.sort()
    return files


def load_config() -> AppConfig:
    ensure_dirs()
    if not CONFIG_PATH.exists():
        cfg = AppConfig().sanitize()
        save_config(cfg)
        return cfg
    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cfg = AppConfig()
    _apply_dict(cfg, raw)
    cfg.sanitize()
    return cfg


def save_config(cfg: AppConfig) -> None:
    ensure_dirs()
    cfg.sanitize()
    payload = asdict(cfg)
    CONFIG_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def presets_payload() -> List[Dict[str, Any]]:
    return [asdict(p) for p in DEFAULT_PRESETS]


def _apply_dict(cfg: Any, raw: Dict[str, Any]) -> None:
    # Minimal permissive merge: ignore unknown keys; supports nested dataclasses.
    for k, v in raw.items():
        if not hasattr(cfg, k):
            continue
        cur = getattr(cfg, k)
        if isinstance(cur, Crop) and isinstance(v, dict):
            for ck, cv in v.items():
                if hasattr(cur, ck):
                    setattr(cur, ck, cv)
            continue
        setattr(cfg, k, v)
