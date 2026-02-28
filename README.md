# Karaoke Photo Booth (Touch Web App)

Touch-first photo booth webapp intended to run on Linux Mint in a kiosk browser.

## Features (current)
- Touch kiosk UI: idle screen, record clips only when admin has started a session.
- Admin page (`/admin`) starts/stops session.
- Live preview (browser `getUserMedia`) with optional PNG border overlay.
- Theme selector (Neon Party, Retro Film, Wedding Luxe) in config.
- Records video + audio in the browser, uploads to server; server transcodes to MP4 (ffmpeg) and generates thumbnails.
- Per-session QR URL that shows a gallery for 24 hours, then expires.
- Gallery shows thumbnails and provides download buttons (forces download, no in-browser playback).
- Config UI: timers, base URL, devices, crop, brightness/contrast/saturation, codecs/bitrates, overlay upload/select.
- Config UI also supports idle background image upload/select for no-session state.
- Config includes visual frame picker cards so you can pick border overlays by thumbnail.
- Shows current app version + git commit in the top-right corner on kiosk screen.

## Requirements (Linux Mint)
- Python 3.10+
- `ffmpeg` available in PATH
- Chromium (kiosk) or any browser that supports `getUserMedia` + `MediaRecorder`
- Camera + microphone available to the browser (permissions)

## Quick start (Linux)
```bash
cd karaoke_photobooth
./run.sh
```

Then open `http://localhost:8000/` (or run Chromium in kiosk mode pointing to it).
`run.sh` checks required dependencies and installs missing ones on Linux Mint/Debian systems.
If your distro enforces a managed Python environment, `run.sh` falls back to `--break-system-packages`.

Mode URLs:
- Kiosk mode (config hidden): `http://localhost:8000/?mode=kiosk`
- Window mode (config shown): `http://localhost:8000/?mode=window`

## Data folders
- `karaoke_photobooth/data/config.json`: persisted config
- `karaoke_photobooth/data/overlays/`: uploaded border PNGs
- `karaoke_photobooth/data/sessions/`: per-session folders with clips + thumbs + meta
- Demo border frame included: `karaoke_photobooth/data/overlays/demo_border_overlay.png`
- Additional demo frames:
  - `karaoke_photobooth/data/overlays/demo_border_retro.png`
  - `karaoke_photobooth/data/overlays/demo_border_luxe.png`

## Release + updater
- Version file: `VERSION`
- Release notes: `CHANGELOG.md`
- Release commit scripts:
  - `scripts/release_commit.sh`
  - `scripts/release_commit.ps1`
- Device updater:
  - `update/update_karaoke_photobooth.sh` (pulls repo root by default, preserves `/data`, and sets safe permissions)
  - Logs each update run to `data/logs/update_YYYYMMDD_HHMMSS.log`
  - Creates desktop shortcuts:
    - `Karaoke Photo Booth Kiosk.desktop`
    - `Karaoke Photo Booth Window.desktop`
- Full workflow: `GIT_UPDATE.md`

## Notes
- Camera/mic access is done in the browser. Use `http://localhost:8000/` on the kiosk device so `getUserMedia` works without HTTPS.
- `ffmpeg` is used server-side only to transcode uploads and create thumbnails.
- For updater installs, set `APP_DIR` explicitly in `.env` to your actual app path (example: `/home/arcade/karaoke_photobooth`) to avoid nested folders.
