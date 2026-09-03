# SpiritPal memory sidecar bootstrap (Windows)
# Creates an isolated venv next to this script and installs requirements,
# then launches the cognee API server. Invoked by the Rust command
# `start_memory_sidecar` (or run manually for local dev / PoC).
$ErrorActionPreference = "Stop"
$PKG = Split-Path -Parent $MyInvocation.MyCommand.Path
$VENV = Join-Path $PKG ".venv"
$PY = Join-Path $VENV "Scripts\python.exe"

if (-not (Test-Path $PY)) {
    python -m venv "$VENV"
}
& "$PY" -m pip install --upgrade pip | Out-Null
& "$PY" -m pip install -r (Join-Path $PKG "requirements.txt")
& "$PY" (Join-Path $PKG "server.py")
