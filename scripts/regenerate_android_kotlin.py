#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
regenerate_android_kotlin.py — 重建 Tauri/wry 为 Android 生成的 Kotlin 胶水层

背景
----
`src-tauri/gen/android/app/src/main/java/<package>/generated/*.kt`（Rust.kt / WryActivity.kt /
TauriActivity.kt / Ipc.kt / Logger.kt / PermissionHelper.kt / RustWebView*.kt）**不是本项目源码**，
而是 tauri 与 wry 的 **build script 在编译 Android target 时**写到
`WRY_ANDROID_KOTLIN_FILES_OUT_DIR` 的产物：

  * tauri：`tauri-<ver>/mobile/android-codegen/*.kt`（模板自带 AUTO-GENERATED 注释）
  * wry  ：`wry-<ver>/src/android/kotlin/*.kt`（build.rs 会另加 AUTO-GENERATED 注释前缀）

该目录被 `src-tauri/gen/android/app/.gitignore` 忽略（`/src/main/**/generated`），**不在版本库**。

为什么需要本脚本
----------------
本仓的 Android 构建走 `gradle → BuildTask.kt → cargo ndk`，**没有设置**
`WRY_ANDROID_KOTLIN_FILES_OUT_DIR` / `WRY_ANDROID_PACKAGE` / `WRY_ANDROID_LIBRARY`
（那是 `tauri android build` CLI 的职责），因此 build script 里这段 codegen 在 gradle 链路中
**不会触发**。一旦这批文件丢失（本次事故：2026-09-17 被外部删除），`gradlew` 会直接报
`Unresolved reference: TauriActivity` 而失败——且 cargo 任务若命中缓存也不会重新生成。

本脚本按 build.rs 的同一套替换规则（占位符 + 前缀）从 cargo 注册表模板确定性重建，避免依赖
`tauri android init`（该命令会重新生成 `.kts`，与现有 Groovy DSL 冲突）。

用法
----
  python scripts/regenerate_android_kotlin.py            # 重建（幂等，内容不变则不写）
  python scripts/regenerate_android_kotlin.py --check    # 只检查，缺失/不一致则退出码 1
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

AUTO_GEN_COMMENT = "/* THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!! */\n\n"
# 占位符 → 取值来源；class-extension / class-init 在环境变量未设时为空串（与 wry build.rs 一致）
PLACEHOLDERS = ("{{package}}", "{{package-unescaped}}", "{{library}}",
                "{{class-extension}}", "{{class-init}}")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def cargo_home() -> Path:
    return Path(os.environ.get("CARGO_HOME") or (Path.home() / ".cargo"))


def read_library_name(root: Path) -> str:
    """从 src-tauri/Cargo.toml 的 [lib] name 取原生库名（System.loadLibrary 用）。"""
    text = (root / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
    m = re.search(r"^\[lib\][^\[]*?^name\s*=\s*\"([^\"]+)\"", text, re.S | re.M)
    if not m:
        raise RuntimeError("无法从 src-tauri/Cargo.toml 解析 [lib] name")
    return m.group(1)


def read_android_package(root: Path) -> str:
    """从 tauri.conf.json 的 identifier 取 Android 包名（'-' → '_'，与 Tauri 约定一致）。"""
    cfg = json.loads((root / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    identifier = cfg.get("identifier")
    if not identifier:
        raise RuntimeError("tauri.conf.json 缺少 identifier")
    return identifier.replace("-", "_")


def find_templates(cargo: Path) -> dict[str, tuple[Path, bool]]:
    """返回 {文件名: (模板路径, 是否需要额外加 AUTO-GENERATED 前缀)}。"""
    registry = cargo / "registry" / "src"
    found: dict[str, tuple[Path, bool]] = {}
    for src in sorted(registry.glob("*")):
        if not src.is_dir():
            continue
        # wry：src/android/kotlin/*.kt（build.rs 会补 AUTO-GENERATED 前缀）
        for d in src.glob("wry-*/src/android/kotlin"):
            for f in d.glob("*.kt"):
                found.setdefault(f.name, (f, True))
        # tauri：mobile/android-codegen/*.kt（模板自带 AUTO-GENERATED 注释）
        for d in src.glob("tauri-*/mobile/android-codegen"):
            for f in d.glob("*.kt"):
                found.setdefault(f.name, (f, False))
    return found


def render(template: Path, add_comment: bool, package: str, library: str) -> str:
    content = template.read_text(encoding="utf-8")
    content = (content
               .replace("{{package}}", package)
               .replace("{{package-unescaped}}", package.replace("`", ""))
               .replace("{{library}}", library)
               .replace("{{class-extension}}", os.environ.get(
                   f"WRY_{template.stem.upper()}_CLASS_EXTENSION", ""))
               .replace("{{class-init}}", os.environ.get(
                   f"WRY_{template.stem.upper()}_CLASS_INIT", "")))
    return (AUTO_GEN_COMMENT + content) if add_comment else content


def main() -> int:
    ap = argparse.ArgumentParser(description="重建 Tauri/wry 的 Android Kotlin 胶水层")
    ap.add_argument("--check", action="store_true", help="只检查，不做写入（缺失/不一致 → 退出码 1）")
    args = ap.parse_args()

    root = repo_root()
    package = read_android_package(root)
    library = read_library_name(root)
    out_dir = (root / "src-tauri" / "gen" / "android" / "app" / "src" / "main"
               / "java" / Path(*package.split(".")) / "generated")

    templates = find_templates(cargo_home())
    if not templates:
        print("[error] 在 cargo 注册表中找不到 tauri/wry 的 Kotlin 模板；请先 `cargo fetch`。",
              file=sys.stderr)
        return 2

    print(f"[info] package={package}  library={library}")
    print(f"[info] out_dir={out_dir}")
    print(f"[info] 模板 {len(templates)} 个：{', '.join(sorted(templates))}")

    missing, stale, written = [], [], []
    for name, (tpl, add_comment) in sorted(templates.items()):
        expected = render(tpl, add_comment, package, library)
        dst = out_dir / name
        if not dst.exists():
            missing.append(name)
        elif dst.read_text(encoding="utf-8") != expected:
            stale.append(name)

        if args.check:
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        if dst.exists() and dst.read_text(encoding="utf-8") == expected:
            continue
        dst.write_text(expected, encoding="utf-8")
        written.append(name)

    if args.check:
        if missing or stale:
            print(f"[FAIL] 缺失 {len(missing)}：{missing or '无'}；内容不一致 {len(stale)}：{stale or '无'}",
                  file=sys.stderr)
            return 1
        print("[OK] 全部就位且内容与模板一致。")
        return 0

    print(f"[done] 新写入 {len(written)}：{written or '（无变化）'}")
    if missing:
        print(f"       其中原本缺失 {len(missing)}：{missing}")
    print("[next] 之后执行 gradlew assembleRelease / bundleRelease 即可编译。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
