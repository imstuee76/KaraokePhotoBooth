# Git Update Workflow (`KaraokePhotoBooth`)

This project now includes a running version number and release notes.

## Files used
- `VERSION`: current app version (`x.y.z`)
- `CHANGELOG.md`: release notes by version
- `scripts/release_commit.sh` / `scripts/release_commit.ps1`: bump version + prepend changelog + commit
- `update/update_karaoke_photobooth.sh`: Linux Mint updater (pulls repo root by default, or a subfolder via `REPO_SUBDIR`, while preserving `/data`)

## Make a release commit
Linux:
```bash
cd karaoke_photobooth
./scripts/release_commit.sh "Describe the changes" patch
```

Windows PowerShell:
```powershell
cd karaoke_photobooth
.\scripts\release_commit.ps1 -Note "Describe the changes" -Bump patch
```

Bump can be `patch`, `minor`, or `major`.
The script auto-pushes after commit. Set `NO_PUSH=1` to skip push.

## Push to GitHub
```bash
git push
```

## Device updater setup (Linux Mint)
1. Put `.env` beside `update/update_karaoke_photobooth.sh` or project root:
```env
GITHUB_TOKEN=ghp_xxx
REPO=imstuee76/KaraokePhotoBooth
REPO_SUBDIR=.
BRANCH=main
APP_DIR=/opt/karaoke_photobooth
```
2. Run:
```bash
chmod +x update/update_karaoke_photobooth.sh
./update/update_karaoke_photobooth.sh
```

The updater syncs `REPO_SUBDIR` into `APP_DIR` (`.` means repo root), preserves `/data`, and reapplies secure permissions.
