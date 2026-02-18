from __future__ import annotations

from pathlib import Path
from typing import List

from .config import AppConfig


def build_transcode_cmd(cfg: AppConfig, in_file: Path, out_file: Path) -> List[str]:
    # Input is expected to be a browser upload (typically WebM).
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(in_file),
        "-r",
        str(cfg.fps),
        "-c:v",
        "libx264",
        "-preset",
        cfg.h264_preset,
        "-crf",
        str(cfg.h264_crf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        cfg.audio_codec,
        "-b:a",
        f"{cfg.audio_bitrate_k}k",
        "-ar",
        str(cfg.audio_samplerate),
        "-ac",
        str(cfg.audio_channels),
        "-movflags",
        "+faststart",
        str(out_file),
    ]


def build_thumb_cmd(video_file: Path, thumb_file: Path) -> List[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video_file),
        "-vf",
        "thumbnail,scale=640:-1",
        "-frames:v",
        "1",
        str(thumb_file),
    ]
