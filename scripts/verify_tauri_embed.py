#!/usr/bin/env python3
"""Verify the SpiritPal release binary actually embeds the frontend (dist).

ROOT CAUSE of the 2026-09-15 bug (see docs/agents/GOTCHAS.md #98):
  The `tauri` crate was missing the `custom-protocol` Cargo feature, so
  `generate_context!` compiled with `dev=true` and the release binary did NOT
  embed `dist` -- it fell back to `devUrl` (http://localhost:5223). On an end
  user's machine (double-click the .exe, no dev server running) the WebView
  reported "localhost refused to connect" (ERR_CONNECTION_REFUSED).

This script is the regression gate:
  * --config-only : cheap parse of src-tauri/Cargo.toml; assert `tauri`
                   features include `custom-protocol`. Runs on EVERY PR.
  * (default)     : also read the built release binary and assert it embeds
                   assets (gzip streams + `tauri://localhost` + size).
                   Runs AFTER a release build.

Exit code: 0 = PASS, 1 = FAIL.
"""
from __future__ import annotations

import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"

# Conservative thresholds. Real fixed build: 1591 gzip streams, 111 MB.
MIN_GZIP_STREAMS = 100
MIN_SIZE_MB = 50.0


def check_config() -> bool:
    if not CARGO_TOML.is_file():
        print(f"[config] MISSING {CARGO_TOML}", file=sys.stderr)
        return False
    data = tomllib.loads(CARGO_TOML.read_text(encoding="utf-8"))
    dep = data.get("dependencies", {}).get("tauri")
    features: list[str] = []
    if isinstance(dep, dict):
        features = list(dep.get("features", []) or [])
    print(f"[config] tauri features = {features}")
    ok = "custom-protocol" in features
    print(f"[config] custom-protocol present = {ok}")
    if not ok:
        print(
            "[config] FAIL: add \"custom-protocol\" to the `tauri` features in "
            "src-tauri/Cargo.toml, else the release binary will not embed the "
            "frontend and double-clicking it fails with 'localhost refused'.",
            file=sys.stderr,
        )
    return ok


def find_exe() -> Path | None:
    direct = [
        ROOT / "src-tauri" / "target" / "release" / "spiritpal-app.exe",
        ROOT / "src-tauri" / "target" / "release" / "spiritpal-app",
    ]
    for c in direct:
        if c.is_file():
            return c
    # macOS: tauri build places the binary inside the .app bundle.
    release = ROOT / "src-tauri" / "target" / "release"
    if release.is_dir():
        for p in release.rglob("spiritpal-app"):
            if p.is_file():
                return p
    return None


def check_binary() -> bool:
    exe = find_exe()
    if exe is None:
        print(
            "[binary] no release binary found under src-tauri/target/release "
            "(run `pnpm tauri build` first)",
            file=sys.stderr,
        )
        return False
    data = exe.read_bytes()
    size_mb = len(data) / (1024 * 1024)
    gzip = data.count(b"\x1f\x8b")
    has_proto = b"tauri://localhost" in data
    print(
        f"[binary] {exe.name}: size={size_mb:.1f}MB gzip_streams={gzip} "
        f"tauri_protocol={has_proto}"
    )
    reasons: list[str] = []
    if gzip < MIN_GZIP_STREAMS:
        reasons.append(f"gzip_streams {gzip} < {MIN_GZIP_STREAMS} (frontend NOT embedded)")
    if not has_proto:
        reasons.append("'tauri://localhost' marker absent (frontend NOT embedded)")
    if size_mb < MIN_SIZE_MB:
        reasons.append(f"size {size_mb:.1f}MB < {MIN_SIZE_MB}MB (frontend NOT embedded)")
    if reasons:
        print("[binary] FAIL: " + "; ".join(reasons), file=sys.stderr)
        return False
    return True


def main() -> int:
    config_only = "--config-only" in sys.argv
    if not check_config():
        # Config broken -> binary is also broken; fail fast.
        return 1
    if config_only:
        return 0
    return 0 if check_binary() else 1


if __name__ == "__main__":
    sys.exit(main())
