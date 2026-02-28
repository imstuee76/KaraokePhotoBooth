#!/usr/bin/env bash
set -euo pipefail

# Linux Mint updater for KaraokePhotoBooth.
# - Pulls only the app folder from GitHub using sparse checkout
# - Preserves /data (config, sessions, overlays)
# - Reapplies safe permissions to /data

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ] && [ -f "$SCRIPT_DIR/../.env" ]; then
  ENV_FILE="$SCRIPT_DIR/../.env"
fi
if [ ! -f "$ENV_FILE" ]; then
  echo ".env not found in $SCRIPT_DIR or parent directory"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# Normalize values from CRLF .env files.
trim_cr() { printf "%s" "${1:-}" | tr -d '\r'; }
REPO="$(trim_cr "${REPO:-}")"
GITHUB_TOKEN="$(trim_cr "${GITHUB_TOKEN:-}")"
REPO_SUBDIR="$(trim_cr "${REPO_SUBDIR:-.}")"
BRANCH="$(trim_cr "${BRANCH:-main}")"

# Resolve app directory safely.
# 1) Use APP_DIR from env if provided.
# 2) If script is inside app/update, app dir is parent.
# 3) If script is in external updater folder, fallback to sibling karaoke_photobooth.
if [ -n "${APP_DIR:-}" ]; then
  APP_DIR="$(trim_cr "$APP_DIR")"
else
  PARENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  if [ -f "$PARENT_DIR/app/main.py" ] && [ -f "$PARENT_DIR/requirements.txt" ]; then
    APP_DIR="$PARENT_DIR"
  elif [ -f "$PARENT_DIR/karaoke_photobooth/app/main.py" ]; then
    APP_DIR="$PARENT_DIR/karaoke_photobooth"
  else
    APP_DIR="$PARENT_DIR"
  fi
fi

: "${REPO:?REPO is required in .env, e.g. imstuee76/KaraokePhotoBooth}"
REPO_URL="https://github.com/${REPO}.git"

LOG_DIR="$APP_DIR/data/logs"
mkdir -p "$LOG_DIR"
chmod 750 "$APP_DIR/data" "$LOG_DIR" 2>/dev/null || true
LOG_FILE="$LOG_DIR/update_$(date +%d-%m-%y_%H-%M-%S).log"
ERR_FILE="${LOG_FILE%.log}_errors.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== KaraokePhotoBooth updater start: $(date +%d-%m-%y\\ %H-%M-%S) ==="
echo "APP_DIR=$APP_DIR"
echo "REPO=$REPO"
echo "REPO_SUBDIR=$REPO_SUBDIR"
echo "BRANCH=$BRANCH"

# Prefer auth header (works even when token has special URL chars).
GIT_AUTH_ARGS=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  if command -v base64 >/dev/null 2>&1; then
    BASIC="$(printf "x-access-token:%s" "$GITHUB_TOKEN" | base64 | tr -d '\n')"
    GIT_AUTH_ARGS=(-c "http.extraheader=AUTHORIZATION: basic ${BASIC}")
  fi
fi

git_auth() {
  git "${GIT_AUTH_ARGS[@]}" "$@"
}

mkdir -p "$(dirname "$APP_DIR")"

DATA_DIR="$APP_DIR/data"
TMP_BACKUP="$(mktemp -d)"
TMP_SRC="$(mktemp -d)"
cleanup() { rm -rf "$TMP_BACKUP" "$TMP_SRC"; }
trap cleanup EXIT

if [ -d "$DATA_DIR" ]; then
  cp -a "$DATA_DIR" "$TMP_BACKUP/data_backup"
fi

# Fetch repo and optionally sparse-checkout a subfolder.
if [ "$REPO_SUBDIR" = "." ] || [ -z "$REPO_SUBDIR" ] || [ "$REPO_SUBDIR" = "/" ]; then
  git_auth clone --depth 1 --filter=blob:none --branch "$BRANCH" "$REPO_URL" "$TMP_SRC/repo"
  SRC_DIR="$TMP_SRC/repo"
else
  git_auth clone --depth 1 --filter=blob:none --sparse --branch "$BRANCH" "$REPO_URL" "$TMP_SRC/repo"
  git -C "$TMP_SRC/repo" sparse-checkout set --cone "$REPO_SUBDIR"
  SRC_DIR="$TMP_SRC/repo/$REPO_SUBDIR"
  if [ ! -d "$SRC_DIR" ]; then
    echo "Repo subdir not found: $REPO_SUBDIR"
    exit 1
  fi
fi

# Sync app files only (do not overwrite data/.env).
mkdir -p "$APP_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a \
    --exclude "data/" \
    --exclude ".env" \
    --exclude "update/.env" \
    "$SRC_DIR"/ "$APP_DIR"/
else
  # Non-destructive fallback copy (no delete).
  cp -a "$SRC_DIR"/. "$APP_DIR"/
fi

mkdir -p "$APP_DIR/data"
if [ -d "$TMP_BACKUP/data_backup" ]; then
  cp -a "$TMP_BACKUP/data_backup/." "$APP_DIR/data/"
fi

# Ensure data remains writable for booth app user.
chmod -R u+rwX,go-rwx "$APP_DIR/data"
find "$APP_DIR/data" -type d -exec chmod 750 {} \;
find "$APP_DIR/data" -type f -exec chmod 640 {} \;

# Ensure runnable scripts keep execute permissions after update.
for f in \
  "$APP_DIR/run.sh" \
  "$APP_DIR/update/update_karaoke_photobooth.sh"
do
  [ -f "$f" ] && chmod 750 "$f"
done
[ -d "$APP_DIR/scripts" ] && find "$APP_DIR/scripts" -maxdepth 1 -type f -name "*.sh" -exec chmod 750 {} \;
[ -d "$APP_DIR/update" ] && find "$APP_DIR/update" -maxdepth 1 -type f -name "*.sh" -exec chmod 750 {} \;

# Create launcher scripts + desktop shortcuts.
APP_USER="${SUDO_USER:-${USER:-$(id -un)}}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6 2>/dev/null || true)"
if [ -z "$APP_HOME" ]; then
  APP_HOME="$HOME"
fi
DESKTOP_DIR="$APP_HOME/Desktop"
mkdir -p "$APP_DIR/scripts" "$DESKTOP_DIR"

KIOSK_LAUNCH="$APP_DIR/scripts/launch_kiosk.sh"
WINDOW_LAUNCH="$APP_DIR/scripts/launch_window.sh"

cat > "$KIOSK_LAUNCH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$APP_DIR"
URL="http://localhost:8000/?mode=kiosk"
cd "\$APP_DIR"
mkdir -p "\$APP_DIR/data/logs"
if ! pgrep -f "python3 -m app.main" >/dev/null 2>&1; then
  nohup ./run.sh > "\$APP_DIR/data/logs/launcher_kiosk_\$(date +%d-%m-%y_%H-%M-%S).log" 2>&1 &
  sleep 5
fi
BROWSER=""
for b in chromium-browser chromium google-chrome-stable google-chrome; do
  if command -v "\$b" >/dev/null 2>&1; then
    BROWSER="\$b"
    break
  fi
done
if [ -n "\$BROWSER" ]; then
  "\$BROWSER" --kiosk --noerrdialogs --disable-infobars --incognito "\$URL" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "\$URL" >/dev/null 2>&1 &
fi
EOF

cat > "$WINDOW_LAUNCH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$APP_DIR"
URL="http://localhost:8000/?mode=window"
cd "\$APP_DIR"
mkdir -p "\$APP_DIR/data/logs"
if ! pgrep -f "python3 -m app.main" >/dev/null 2>&1; then
  nohup ./run.sh > "\$APP_DIR/data/logs/launcher_window_\$(date +%d-%m-%y_%H-%M-%S).log" 2>&1 &
  sleep 5
fi
BROWSER=""
for b in chromium-browser chromium google-chrome-stable google-chrome; do
  if command -v "\$b" >/dev/null 2>&1; then
    BROWSER="\$b"
    break
  fi
done
if [ -n "\$BROWSER" ]; then
  "\$BROWSER" --new-window "\$URL" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "\$URL" >/dev/null 2>&1 &
fi
EOF

chmod 750 "$KIOSK_LAUNCH" "$WINDOW_LAUNCH"

KIOSK_DESKTOP="$DESKTOP_DIR/Karaoke Photo Booth Kiosk.desktop"
WINDOW_DESKTOP="$DESKTOP_DIR/Karaoke Photo Booth Window.desktop"

cat > "$KIOSK_DESKTOP" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Karaoke Photo Booth Kiosk
Comment=Start booth in kiosk mode
Exec=$KIOSK_LAUNCH
Path=$APP_DIR
Terminal=false
Categories=AudioVideo;
StartupNotify=false
EOF

cat > "$WINDOW_DESKTOP" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Karaoke Photo Booth Window
Comment=Start booth in window mode (admin test)
Exec=$WINDOW_LAUNCH
Path=$APP_DIR
Terminal=false
Categories=AudioVideo;
StartupNotify=false
EOF

chmod 755 "$KIOSK_DESKTOP" "$WINDOW_DESKTOP"
if command -v gio >/dev/null 2>&1; then
  gio set "$KIOSK_DESKTOP" metadata::trusted true 2>/dev/null || true
  gio set "$WINDOW_DESKTOP" metadata::trusted true 2>/dev/null || true
fi
if [ "$(id -u)" -eq 0 ]; then
  chown "$APP_USER:$APP_USER" "$KIOSK_LAUNCH" "$WINDOW_LAUNCH" "$KIOSK_DESKTOP" "$WINDOW_DESKTOP" 2>/dev/null || true
fi

# Optional: install python deps on system python (no venv).
if command -v python3 >/dev/null 2>&1; then
  if ! python3 -m pip --version >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      if [ "$(id -u)" -eq 0 ]; then
        apt-get update && apt-get install -y python3-pip
      elif command -v sudo >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y python3-pip
      fi
    fi
  fi
  if python3 -m pip --version >/dev/null 2>&1; then
    python3 -m pip install --upgrade pip || true
    python3 -m pip install --user -r "$APP_DIR/requirements.txt" || \
      python3 -m pip install --break-system-packages -r "$APP_DIR/requirements.txt"
  fi
fi

VERSION="unknown"
if [ -f "$APP_DIR/VERSION" ]; then
  VERSION="$(cat "$APP_DIR/VERSION")"
fi
COMMIT="$(git -C "$TMP_SRC/repo" rev-parse --short HEAD)"
echo "Updated KaraokePhotoBooth to version $VERSION ($COMMIT)"
echo "=== KaraokePhotoBooth updater end: $(date +%d-%m-%y\\ %H-%M-%S) ==="
grep -iE "traceback|fatal|error|exception" "$LOG_FILE" > "$ERR_FILE" || true
chmod 640 "$LOG_FILE" 2>/dev/null || true
chmod 640 "$ERR_FILE" 2>/dev/null || true
