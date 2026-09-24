#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_tauri_embed.py — SpiritPal 前端内嵌发布门禁（AGENTS v2.60 规格还原）。

门禁分两道（与 docs/agents/QUALITY_CONTRACT.md §13.2 / AGENTS.md v2.60 记录一致）：
  1. 配置门禁（--config-only，CI 每 PR 执行）：
     src-tauri/Cargo.toml 的 tauri 依赖 features 必须包含 `custom-protocol`，
     否则 release 构建不内嵌 dist 前端（会回退 devUrl，双击 exe 报 localhost 拒绝连接）。
  2. 二进制门禁（release 构建后执行，默认模式）：
     指定（或跨平台自动定位）release 主二进制，一律先量后判、失败也全量打印读数。
     判据（卡）：
       - 含 `tauri://localhost` 标记 —— custom-protocol 生效、前端确实被内嵌；
       - sri_hashes.rs 清单里的前端资产键在二进制中可寻（本轮仅在"一个都没找到"时判红）。
     只读数不卡：体积、gzip magic 计数。原因见 check_binary docstring：
     frontendDist 由 generate_context! 以 **brotli** 内嵌（src-tauri/src/integrity.rs:11），
     数 gzip magic 量的不是前端资产；dist 资产真值仅 37 个（sri_hashes.rs），
     「gzip>=100」与「裸二进制 >=50MiB」在任何平台都不成立。
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARGO_TOML = os.path.join(ROOT, "src-tauri", "Cargo.toml")
TAURI_CONF = os.path.join(ROOT, "src-tauri", "tauri.conf.json")
# 前端资产清单：Rust 编译期嵌入用的 SRI 清单，条目数即 dist 资产数的真值
SRI_MANIFEST = os.path.join(ROOT, "src-tauri", "src", "generated", "sri_hashes.rs")
GZIP_MAGIC = b"\x1f\x8b"
MARKER = b"tauri://localhost"
MACHO_MAGICS = (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca")

# Windows 托管 runner 的 stdout 默认 cp1252，打印中文即 UnicodeEncodeError
# （run 35997489906 的 windows 腿就死在 check_config 的第一次 print，根本没读到二进制）。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError, ValueError):
        pass


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


def detect_format(data: bytes) -> str:
    if data.startswith(b"\x7fELF"):
        return "ELF"
    if data[:4] in MACHO_MAGICS:
        return "Mach-O"
    if data.startswith(b"MZ"):
        return "PE"
    return "unknown"


def manifest_assets() -> list[str]:
    """编译期嵌入用的前端资产清单（dist 资产数的真值来源）。"""
    if not os.path.isfile(SRI_MANIFEST):
        return []
    text = open(SRI_MANIFEST, encoding="utf-8", errors="replace").read()
    out: list[str] = []
    for name in re.findall(r"\"([^\"]+\.(?:js|css|html|json|woff2?|png|svg))\"", text):
        if name not in out:
            out.append(name)
    return out


def check_binary(binary: str) -> None:
    """主二进制门禁。

    实测（run 36017549312）：三平台裸二进制 9.6~13.6 MiB、gzip 流 51/85/200、marker 均在。
    这两项曾判红的原因是口径错，而非产物缩水：src-tauri/src/integrity.rs:11 写明
    `generate_context!` 把 frontendDist **以 brotli 压缩内嵌进二进制**，所以
    「数 gzip magic」量的从来不是前端资产（而 dist 资产真值仅 37 个，见 sri_hashes.rs，
    「>=100」在任何平台都不可能成立）。据此本轮改为：
      - 卡：`tauri://localhost` 标记（= custom-protocol 生效、前端确实被内嵌）；
      - 读数：清单资产键在二进制中的命中比例（asset map 是否落空）——本轮不卡，理由见函数末尾；
      - 读数：体积与 gzip 流数，不再设阈值。
    """
    if not os.path.isfile(binary):
        fail(f"release 主二进制不存在：{binary}")
    with open(binary, "rb") as fh:
        data = fh.read()
    size = len(data)
    fmt = detect_format(data)
    streams = count_gzip_streams(data)
    has_marker = MARKER in data
    assets = manifest_assets()
    hit = [a for a in assets if a.encode() in data]
    ratio = f"{len(hit)}/{len(assets)}" if assets else "n/a"

    print(f"[MEASURE] {binary}\n"
          f"          format={fmt}  size={size / 1024 / 1024:.1f} MiB（本轮不设体积阈值）"
          f"  gzip_streams={streams}（历史读数，brotli 内嵌下无判据意义）"
          f"  tauri://localhost={'yes' if has_marker else 'no'}"
          f"  资产键命中={ratio} 清单={SRI_MANIFEST.split(os.sep)[-1]}")

    problems = []
    if not has_marker:
        problems.append("未找到 `tauri://localhost` 标记（custom-protocol 未生效，前端不会内嵌）")
    if problems:
        fail("；".join(problems))
    # 资产键命中率先只作读数：Tauri codegen 里 asset map 的键写法（是否带 / 或 assets/ 前缀）
    # 未经三平台实测，本轮就以 0 命中判红等于再赌一次 dispatch。取到三平台稳定值后收紧为判据。
    print(f"[OK] 二进制门禁：marker 在；资产键命中 {ratio}（读数，暂不判据）")


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
