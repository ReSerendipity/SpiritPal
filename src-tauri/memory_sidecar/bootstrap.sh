#!/usr/bin/env bash
# SpiritPal memory sidecar bootstrap (Linux/macOS)
# Creates an isolated venv next to this script and installs requirements,
# then launches the cognee API server. Invoked by the Rust command
# `start_memory_sidecar` (or run manually for local dev / PoC).
set -euo pipefail
PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$PKG/.venv"
PY="$VENV/bin/python"
if [ ! -x "$PY" ]; then
  python3 -m venv "$VENV"
fi
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r "$PKG/requirements.txt"
exec "$PY" "$PKG/server.py"
