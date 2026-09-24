#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_tauri_embed.py — SpiritPal 前端内嵌发布门禁（AGENTS v2.60 规格还原）。

门禁分两道（与 docs/agents/QUALITY_CONTRACT.md §13.2 / AGENTS.md v2.60 记录一致）：
  1. 配置门禁（--config-only，CI 每 PR 执行）：
     src-tauri/Cargo.toml 的 tauri 依赖 features 必须包含 `custom-protocol`，
     否则 release 构建不内嵌 dist 前端（会回退 devUrl，双击 exe 报 localhost 拒绝连接）。
  2. 二进制门禁（release 构建后执行，默认模式）：
     指定（或跨平台自动定位）release 主二进制，要求：
       - 文件体积 >= 50 MiB
       - 内嵌 gzip 流数量 >= 100（dist 前端资源被 Tauri 压缩内嵌）
       - 二进制内容包含 `tauri://localhost` 标记（custom-protocol 已启用）
     主二进制三平台同源同名：Linux/macOS 为 src-tauri/target/release/<name>（无扩展名），
     Windows 为 <name>.exe，macOS bundle 内层为 <ProductName>.app/Contents/MacOS/<ProductName>。

用法：
  python scripts/verify_tauri_embed.py --config-only
  python scripts/verify_tauri_embed.py [path/to/release/binary]

退出码：0 = 通过；1 = 未通过（任一子项失败即失败）。
本脚本按 AGENTS v2.60 描述实现，2026-09-17 由文档审计整改补回。
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

MIN_EXE_BYTES = 50 * 1024 * 1024          # 50 MiB
MIN_GZIP_STREAMS = 100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARGO_TOML = os.path.join(ROOT, "src-tauri", "Cargo.toml")
TAURI_CONF = os.path.join(ROOT, "src-tauri", "tauri.conf.json")
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


def _binary_names() -> list[str]:
    """release 主二进制的候选名：cargo 产物名（[[bin]] name 优先，否则 package.name）
    + tauri 的 productName（bundle 内层可执行文件用它命名）。"""
    names: list[str] = []
    if os.path.isfile(CARGO_TOML):
        text = open(CARGO_TOML, encoding="utf-8").read()
        names += re.findall(r"\[\[bin\]\][^\[]*?^name\s*=\s*[\"']([^\"']+)[\"']", text, re.M | re.S)
        pkg = re.search(r"^\[package\]\s*(.*?)(?=^\[)", text, re.M | re.S)
        if pkg:
            m = re.search(r"^name\s*=\s*[\"']([^\"']+)[\"']", pkg.group(1), re.M)
            if m:
                names.append(m.group(1))
    if os.path.isfile(TAURI_CONF):
        try:
            product = json.load(open(TAURI_CONF, encoding="utf-8")).get("productName")
            if product:
                names.append(str(product))
        except (OSError, ValueError):
            pass
    out: list[str] = []
    for n in names:
        if n and n not in out:
            out.append(n)
    return out or ["spiritpal-app"]


def auto_find_exe() -> str | None:
    """跨平台定位 release 主二进制。原先只 glob *.exe，Linux/macOS 上必然找不到而误报
    （run 35976217476 的 macOS 腿）；主二进制其实三平台同名，仅扩展名与 .app 包路径不同。"""
    roots = (
        os.path.join(ROOT, "src-tauri", "target", "release"),
        os.path.join(ROOT, "target", "release"),
        os.path.join(ROOT, "release"),
    )
    names = _binary_names()
    pats: list[str] = []
    for root in roots:
        for name in names:
            pats += [os.path.join(root, name), os.path.join(root, name + ".exe")]
        # macOS bundle 内层：SpiritPal.app/Contents/MacOS/SpiritPal
        pats.append(os.path.join(root, "bundle", "macos", "*.app", "Contents", "MacOS", "*"))
    for name in names:
        pats.append(os.path.join(ROOT, "dist", "**", name))
        pats.append(os.path.join(ROOT, "dist", "**", name + ".exe"))
    candidates = [c for pat in pats for c in glob.glob(pat, recursive=True)]
    candidates = [c for c in candidates if os.path.isfile(c) and "debug" not in c.lower()]
    if not candidates:
        return None
    # 按修改时间取最新
    return max(candidates, key=os.path.getmtime)


def main() -> int:
    ap = argparse.ArgumentParser(description="SpiritPal 前端内嵌发布门禁")
    ap.add_argument("binary", nargs="?", help="release 主二进制路径；缺省跨平台自动定位")
    ap.add_argument("--config-only", action="store_true", help="仅执行配置门禁（CI 每 PR）")
    args = ap.parse_args()

    check_config()
    if args.config_only:
        print("[OK] 配置门禁全部通过")
        return 0

    binary = args.binary or auto_find_exe()
    if not binary:
        fail("未找到 release 主二进制，请显式传入路径（如 scripts/verify_tauri_embed.py "
             "src-tauri/target/release/spiritpal-app）")
    check_binary(binary)
    print("[OK] 前端内嵌门禁全部通过")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
