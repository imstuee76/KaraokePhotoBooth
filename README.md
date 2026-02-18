# Karaoke Photo Booth (Touch Web App)

Touch-first photo booth webapp intended to run on Linux Mint in a kiosk browser.

## Features (current)
- Touch kiosk UI: idle screen, start session, record multiple clips per session.
- Live preview (browser `getUserMedia`) with optional PNG border overlay.
- Records video + audio in the browser, uploads to server; server transcodes to MP4 (ffmpeg) and generates thumbnails.
- Per-session QR URL that shows a gallery for 24 hours, then expires.
- Gallery shows thumbnails and provides download buttons (forces download, no in-browser playback).
- Config UI: timers, base URL, devices, crop, brightness/contrast/saturation, codecs/bitrates, overlay upload/select.
- Shows current app version + git commit in the top-right corner on kiosk screen.

## Requirements (Linux Mint)
- Python 3.10+
- `ffmpeg` available in PATH
- Chromium (kiosk) or any browser that supports `getUserMedia` + `MediaRecorder`
- Camera + microphone available to the browser (permissions)

## Quick start (Linux)
```bash
cd karaoke_photobooth
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.main
```

Then open `http://localhost:8000/` (or run Chromium in kiosk mode pointing to it).

## Data folders
- `karaoke_photobooth/data/config.json`: persisted config
- `karaoke_photobooth/data/overlays/`: uploaded border PNGs
- `karaoke_photobooth/data/sessions/`: per-session folders with clips + thumbs + meta

## Release + updater
- Version file: `VERSION`
- Release notes: `CHANGELOG.md`
- Release commit scripts:
  - `scripts/release_commit.sh`
  - `scripts/release_commit.ps1`
- Device updater:
  - `update/update_karaoke_photobooth.sh` (pulls repo root by default, preserves `/data`, and sets safe permissions)
- Full workflow: `GIT_UPDATE.md`

## Notes
- Camera/mic access is done in the browser. Use `http://localhost:8000/` on the kiosk device so `getUserMedia` works without HTTPS.
- `ffmpeg` is used server-side only to transcode uploads and create thumbnails.
