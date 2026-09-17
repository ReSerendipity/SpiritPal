#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_tauri_embed.py — SpiritPal 前端内嵌发布门禁（AGENTS v2.60 规格还原）。

门禁分两道（与 docs/agents/QUALITY_CONTRACT.md §13.2 / AGENTS.md v2.60 记录一致）：
  1. 配置门禁（--config-only，CI 每 PR 执行）：
     src-tauri/Cargo.toml 的 tauri 依赖 features 必须包含 `custom-protocol`，
     否则 release 构建不内嵌 dist 前端（会回退 devUrl，双击 exe 报 localhost 拒绝连接）。
  2. 二进制门禁（release 构建后执行，默认模式）：
     指定（或自动定位）release exe，要求：
       - 文件体积 >= 50 MiB
       - 内嵌 gzip 流数量 >= 100（dist 前端资源被 Tauri 压缩内嵌）
       - 二进制内容包含 `tauri://localhost` 标记（custom-protocol 已启用）

用法：
  python scripts/verify_tauri_embed.py --config-only
  python scripts/verify_tauri_embed.py [path/to/SpiritPal.exe]

退出码：0 = 通过；1 = 未通过（任一子项失败即失败）。
本脚本按 AGENTS v2.60 描述实现，2026-09-17 由文档审计整改补回。
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys

MIN_EXE_BYTES = 50 * 1024 * 1024          # 50 MiB
MIN_GZIP_STREAMS = 100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARGO_TOML = os.path.join(ROOT, "src-tauri", "Cargo.toml")
GZIP_MAGIC = b"\x1f\x8b"
MARKER = b"tauri://localhost"


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    sys.exit(1)


def check_config() -> None:
    if not os.path.isfile(CARGO_TOML):
        fail(f"src-tauri/Cargo.toml 不存在：{CARGO_TOML}")
    text = open(CARGO_TOML, encoding="utf-8").read()
    # 提取 tauri 依赖行（形如 tauri = { version = "2", features = [...] }）
    m = re.search(r"tauri\s*=\s*\{[^}]*features\s*=\s*\[([^\]]*)\]", text)
    if not m:
        fail("src-tauri/Cargo.toml 中未找到 tauri 依赖的 features 声明")
    feats = {f.strip().strip('"').strip("'") for f in m.group(1).split(",") if f.strip()}
    if "custom-protocol" not in feats:
        fail(
            "tauri features 缺少 `custom-protocol`（当前：%s）——release 不会内嵌 dist 前端，"
            "双击 exe 将回退 devUrl 并报 localhost 拒绝连接；请参照 AGENTS v2.59 修复" % ", ".join(sorted(feats))
        )
    print("[OK] 配置门禁：tauri features 包含 custom-protocol")


def count_gzip_streams(data: bytes) -> int:
    count = 0
    start = 0
    while True:
        idx = data.find(GZIP_MAGIC, start)
        if idx < 0:
            break
        count += 1
        start = idx + 1
    return count


def check_binary(exe: str) -> None:
    if not os.path.isfile(exe):
        fail(f"release exe 不存在：{exe}")
    size = os.path.getsize(exe)
    if size < MIN_EXE_BYTES:
        fail(f"体积不足：{size / 1024 / 1024:.1f} MiB < 50 MiB（exe={exe}）")
    with open(exe, "rb") as fh:
        data = fh.read()
    streams = count_gzip_streams(data)
    if streams < MIN_GZIP_STREAMS:
        fail(f"内嵌 gzip 流不足：{streams} < {MIN_GZIP_STREAMS}（前端资源未内嵌）")
    if MARKER not in data:
        fail("二进制中未找到 `tauri://localhost` 标记（custom-protocol 未生效）")
    print(f"[OK] 二进制门禁：{size / 1024 / 1024:.1f} MiB，gzip 流 {streams} 个，含 tauri://localhost")


def auto_find_exe() -> str | None:
    candidates = []
    for pat in (
        os.path.join(ROOT, "src-tauri", "target", "release", "*.exe"),
        os.path.join(ROOT, "target", "release", "*.exe"),
        os.path.join(ROOT, "release", "*.exe"),
        os.path.join(ROOT, "dist", "**", "*.exe"),
    ):
        candidates.extend(glob.glob(pat, recursive=True))
    # 按修改时间取最新
    candidates = [c for c in candidates if "debug" not in c.lower()]
    if not candidates:
        return None
    return max(candidates, key=os.path.getmtime)


def main() -> int:
    ap = argparse.ArgumentParser(description="SpiritPal 前端内嵌发布门禁")
    ap.add_argument("exe", nargs="?", help="release exe 路径；缺省自动定位")
    ap.add_argument("--config-only", action="store_true", help="仅执行配置门禁（CI 每 PR）")
    args = ap.parse_args()

    check_config()
    if args.config_only:
        print("[OK] 配置门禁全部通过")
        return 0

    exe = args.exe or auto_find_exe()
    if not exe:
        fail("未找到 release exe，请显式传入路径（如 scripts/verify_tauri_embed.py src-tauri/target/release/SpiritPal.exe）")
    check_binary(exe)
    print("[OK] 前端内嵌门禁全部通过")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
