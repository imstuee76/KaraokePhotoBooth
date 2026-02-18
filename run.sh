#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

APT_UPDATED=0
apt_install_if_missing() {
  local cmd_name="$1"
  local pkg_name="$2"
  if need_cmd "$cmd_name"; then
    return 0
  fi

  echo "Missing dependency: $cmd_name (installing package: $pkg_name)"
  if ! need_cmd apt-get; then
    echo "apt-get not found. Please install '$pkg_name' manually."
    exit 1
  fi

  if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
  elif need_cmd sudo; then
    SUDO="sudo"
  else
    echo "Need root privileges to install '$pkg_name'. Install it manually and retry."
    exit 1
  fi

  if [ "$APT_UPDATED" -eq 0 ]; then
    $SUDO apt-get update
    APT_UPDATED=1
  fi
  $SUDO apt-get install -y "$pkg_name"
}

# System dependencies (Linux Mint / Debian-based)
apt_install_if_missing python3 python3
apt_install_if_missing ffmpeg ffmpeg

# python3 -m venv support
if ! python3 -m venv --help >/dev/null 2>&1; then
  apt_install_if_missing python3 python3-venv
fi

# Ensure pip exists for python3
if ! python3 -m pip --version >/dev/null 2>&1; then
  apt_install_if_missing pip3 python3-pip
fi

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate

if ! python -m pip --version >/dev/null 2>&1; then
  python -m ensurepip --upgrade
fi

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m app.main
