#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_tauri_embed.py — SpiritPal 前端内嵌发布门禁（AGENTS v2.60 规格还原）。

门禁分两道（与 docs/agents/QUALITY_CONTRACT.md §13.2 / AGENTS.md v2.60 记录一致）：
  1. 配置门禁（--config-only，CI 每 PR 执行）：
     src-tauri/Cargo.toml 的 tauri 依赖 features 必须包含 `custom-protocol`，
     否则 release 构建不内嵌 dist 前端（会回退 devUrl，双击 exe 报 localhost 拒绝连接）。
  2. 二进制门禁（release 构建后执行，默认模式）：
     指定（或跨平台自动定位）release 主二进制，一律先量后判、失败也全量打印读数。
     判据（卡，全部满足才放行）：
       - 含 `tauri://localhost` 标记 —— custom-protocol 生效、前端确实被内嵌；
       - 资产清单非空，且 `src-tauri/src/generated/sri_hashes.rs` 里每个资产键都能在主二进制
         中寻得（fail-closed：清单缺失/为空即判红，不当通过）。
     只读数不卡：体积、gzip magic 计数。原因见 check_binary docstring：
     frontendDist 由 generate_context! 以 **brotli** 内嵌（src-tauri/src/integrity.rs:11），
     数 gzip magic 量的不是前端资产；dist 资产真值仅 37 个（sri_hashes.rs，条目数变化时
     判据自动跟随），「gzip>=100」与「裸二进制 >=50MiB」在任何平台都不成立。
     标定基线：run 36029050680，ELF/Mach-O/PE 三平台命中均 37/37、marker 均在。
     主二进制三平台同源同名：Linux/macOS 为 src-tauri/target/release/<name>（无扩展名），
     Windows 为 <name>.exe，macOS bundle 内层为 <ProductName>.app/Contents/MacOS/<ProductName>。
  3. 资源目录门禁（--check-resources，release 构建后执行）：
     bundle.resources 声明的 memory_sidecar 与 public/pets 必须在 target/release 子树里
     真实落盘且各含 >=1 个文件（前端本体不在此列——它只存在于主二进制的内嵌资产里，
     三平台产物树均无 index.html，见 run 36029050680 取证）。

用法：
  python scripts/verify_tauri_embed.py --config-only
  python scripts/verify_tauri_embed.py --check-resources
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
    「>=100」在任何平台都不可能成立）。据此口径为：
      - 卡：`tauri://localhost` 标记（= custom-protocol 生效、前端确实被内嵌）；
      - 卡：资产清单非空，且清单里每个资产键都能在二进制中寻得（fail-closed，缺清单即判红）；
      - 读数：体积与 gzip 流数，不设阈值。
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
          f"          format={fmt}  size={size / 1024 / 1024:.1f} MiB（不设阈值，仅读数）"
          f"  gzip_streams={streams}（仅读数：codegen 用 brotli，此数是字节巧合，同代码相邻两次 run 85/51/200 → 92/58/213）"
          f"  tauri://localhost={'yes' if has_marker else 'no'}"
          f"  资产键命中={ratio} 清单={SRI_MANIFEST.split(os.sep)[-1]}")

    # 判据（run 36029050680 标定：ELF / Mach-O / PE 三平台命中一致，均 37/37、marker 均在）。
    # 键写法无需归一化：清单里的裸文件名在三种格式的字节流里都能直接寻得。
    problems = []
    if not has_marker:
        problems.append("未找到 `tauri://localhost` 标记（custom-protocol 未生效，前端不会内嵌）")
    if not assets:
        # fail-closed：清单由 beforeBuildCommand 生成，读不到/为空即链路断了，不能算通过
        problems.append(f"资产清单为空或不可读：{SRI_MANIFEST}")
    elif len(hit) != len(assets):
        missing = [a for a in assets if a.encode() not in data]
        problems.append(f"资产键命中 {len(hit)}/{len(assets)}，未在内嵌资产中寻得："
                        + ", ".join(missing[:8]) + ("…" if len(missing) > 8 else ""))
    if problems:
        fail("；".join(problems))
    print(f"[OK] 二进制门禁：marker 在，前端资产键 {len(hit)}/{len(assets)} 全覆盖")



# bundle.resources 声明项的落点探针。用**尾段路径 glob**而不是按平台枚举中间目录：
# run 36029050680 三平台取证显示构建后都先暂存到 target/release/memory_sidecar 与
# target/release/_up_/public/pets，打进包后则分别在 …/usr/lib/SpiritPal/…（deb/AppImage）、
# ….app/Contents/Resources/…（dmg）、…/resources/…（NSIS）——同一条 `**/memory_sidecar`
# 对这四种形态同时成立，换平台/换 tauri 版本都不需要先改这里。
RESOURCE_PROBES = (
    ("memory_sidecar", ("**/memory_sidecar",)),
    ("public/pets", ("**/public/pets", "**/pets")),
)


def check_resources() -> None:
    """资源目录门禁：bundle.resources 的每一项都要真实落盘且非空。
    前端本体不在此列——三平台产物树里都没有 index.html，它只存在于主二进制的内嵌资产中。"""
    base = os.path.join(ROOT, "src-tauri", "target", "release")
    if not os.path.isdir(base):
        fail(f"构建产物目录不存在：{base}")
    problems = []
    for label, patterns in RESOURCE_PROBES:
        landed = []
        for pat in patterns:
            for d in glob.glob(os.path.join(base, pat), recursive=True):
                if os.path.isdir(d):
                    n = sum(len(fs) for _, _, fs in os.walk(d))
                    if n:
                        landed.append((os.path.relpath(d, ROOT), n))
        if not landed:
            problems.append(f"{label} 未落盘：在 {os.path.relpath(base, ROOT)} 下按 "
                            + "/".join(patterns) + " 未找到任何含文件的目录")
        else:
            path, n = max(landed, key=lambda x: x[1])
            print(f"[OK] 资源目录：{label} → {path}（{n} 个文件）")
    if problems:
        fail("；".join(problems))


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
    ap.add_argument("--check-resources", action="store_true",
                    help="仅执行资源目录门禁（bundle.resources 落盘，release 构建后）")
    args = ap.parse_args()

    check_config()
    if args.config_only:
        print("[OK] 配置门禁全部通过")
        return 0
    if args.check_resources:
        check_resources()
        print("[OK] 资源目录门禁全部通过")
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
