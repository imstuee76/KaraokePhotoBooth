#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/release_commit.sh "Short release note" [patch|major]

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

NOTE="${1:-}"
BUMP="${2:-patch}"
if [ -z "$NOTE" ]; then
  echo "Usage: $0 \"Short release note\" [patch|major]"
  exit 1
fi

VER_FILE="$ROOT_DIR/VERSION"
CUR_VER="$(cat "$VER_FILE")"
# Version format: X.YY (examples: 1.01, 1.02)
if [[ "$CUR_VER" =~ ^([0-9]+)\.([0-9]{2})$ ]]; then
  MAJOR="${BASH_REMATCH[1]}"
  COUNT="${BASH_REMATCH[2]}"
elif [[ "$CUR_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  # Legacy semver migration fallback.
  MAJOR=1
  COUNT=1
else
  echo "Invalid VERSION format '$CUR_VER'. Expected X.YY (e.g. 1.01)."
  exit 1
fi

case "$BUMP" in
  major)
    MAJOR=$((MAJOR+1))
    COUNT=1
    ;;
  patch)
    COUNT=$((10#$COUNT + 1))
    if [ "$COUNT" -gt 99 ]; then
      MAJOR=$((MAJOR+1))
      COUNT=1
    fi
    ;;
  *)
    echo "Invalid bump type: $BUMP (allowed: patch|major)"
    exit 1
    ;;
esac

NEW_VER="$(printf "%d.%02d" "$MAJOR" "$COUNT")"
printf "%s\n" "$NEW_VER" > "$VER_FILE"

TODAY="$(date +%Y-%m-%d)"
TMP_FILE="$(mktemp)"
{
  echo "# Changelog"
  echo
  echo "All notable changes to \`KaraokePhotoBooth\` are tracked here."
  echo
  echo "## [$NEW_VER] - $TODAY"
  echo "- $NOTE"
  echo
  tail -n +5 CHANGELOG.md
} > "$TMP_FILE"
mv "$TMP_FILE" CHANGELOG.md

# Stage only this project folder.
TOP="$(git rev-parse --show-toplevel)"
REL="$(TOP="$TOP" ROOT_DIR="$ROOT_DIR" python3 - <<'PY'
import os
top = os.path.abspath(os.environ["TOP"])
root = os.path.abspath(os.environ["ROOT_DIR"])
print(os.path.relpath(root, top))
PY
)"
git -C "$TOP" add "$REL"
git -C "$TOP" commit -m "KaraokePhotoBooth v$NEW_VER: $NOTE"

echo "Committed v$NEW_VER"
if [ "${NO_PUSH:-0}" = "1" ]; then
  echo "Auto-push skipped (NO_PUSH=1)."
  echo "Push with: git -C \"$TOP\" push"
else
  git -C "$TOP" push
  echo "Pushed v$NEW_VER"
fi
