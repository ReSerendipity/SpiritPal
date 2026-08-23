# SpiritPal portable-exe artifact replacement script (handles the running-exe file lock)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/update-artifacts.ps1 [-Relaunch]
param([switch]$Relaunch)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repo 'src-tauri\target\release\spiritpal-app.exe'
$dest = Join-Path $repo 'artifacts\SpiritPal_0.1.0_portable-win64.exe'
$procName = 'SpiritPal_0.1.0_portable-win64'

if (-not (Test-Path $exe)) { Write-Error "Build artifact not found: $exe (run pnpm tauri build first)"; exit 1 }

# 1. Stop the running old instance to release the file lock
$running = Get-Process -Name $procName -ErrorAction SilentlyContinue
if ($running) {
  Write-Output ("[1/3] Stopping old instance (PID {0}) ..." -f ($running.Id -join ','))
  $running | Stop-Process -Force
  Start-Sleep -Seconds 3
} else {
  Write-Output "[1/3] No running instance"
}

# 2. Copy the artifact (retry up to 5x if still locked)
Write-Output "[2/3] Copying artifact to artifacts/"
$copied = $false
for ($i = 1; $i -le 5; $i++) {
  try { Copy-Item $exe $dest -Force; $copied = $true; break }
  catch {
    Write-Output ("  File locked, retrying in 1s ({0}/5) ..." -f $i)
    Start-Sleep -Seconds 1
  }
}
if (-not $copied) { Write-Error "Artifact copy failed (file still locked)"; exit 1 }
Write-Output ("  Updated: {0}" -f $dest)

# 3. Optionally relaunch
if ($Relaunch) {
  Write-Output "[3/3] Launching new version ..."
  Start-Process -FilePath $dest
} else {
  Write-Output "[3/3] Done (add -Relaunch to auto-launch the new version)"
}
