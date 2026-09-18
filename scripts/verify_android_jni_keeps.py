#!/usr/bin/env python3
"""校验 Android release APK 里「仅 JNI 可达」的方法是否被 R8 保留。

背景（见 docs/agents/GOTCHAS.md #121 / #122）：
    release 构建开了 `minifyEnabled=true`，R8 会把「Kotlin/Java 侧没有直接调用者、
    只能被 Rust 侧经 JNI 反射调用」的方法当 unused 整方法删除。这类删除**编译期
    无告警、打包无报错**，只在真机启动/触发对应功能时抛
    `java.lang.NoSuchMethodError: no non-static method "L<Class>;.<method>()<sig>"`。

    已踩过的坑：WryActivity.getId()、TauriActivity.getPluginManager()、
    RustWebView.clearAllBrowsingData() / getCookies()。

用法：
    python scripts/verify_android_jni_keeps.py [APK 路径]
    不传参数时，自动取 src-tauri/gen/android/app/build/outputs/apk/arm64/release/*.apk。

退出码：0 = 全部命中；1 = 有缺失（同时打印缺失清单）；2 = 环境/文件问题。
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_APK_GLOB = "src-tauri/gen/android/app/build/outputs/apk/arm64/release/*.apk"

# {类描述符: [(方法名, 期望签名片段或 None 表示只校验名字)]}
# 签名片段用「返回值类型」粗略校验，避免同名重载误判。
REQUIRED: dict[str, list[tuple[str, str | None]]] = {
    # wry 0.55.1：src/android/mod.rs 经 JNI 调 activity 上的这些方法
    "Lcom/spiritpal/desktop_pet/WryActivity;": [
        ("getId", "()I"),
        ("getVersion", "()Ljava/lang/String;"),
        ("getAppClass", None),
        ("setWebView", None),
        ("startActivity", None),
    ],
    # wry 0.55.1：main_pipe.rs 经 JNI 调 webview 上的这些方法
    # （loadUrl / reload / setBackgroundColor / zoomBy 是库方法 override，R8 必留，不列）
    "Lcom/spiritpal/desktop_pet/RustWebView;": [
        ("loadUrlMainThread", None),
        ("loadHTMLMainThread", None),
        ("evalScript", None),
        ("clearAllBrowsingData", "()V"),
        ("getCookies", "(Ljava/lang/String;)Ljava/lang/String;"),
    ],
    # tauri 2.x：plugin/mobile.rs、manager/webview.rs 调 activity.getPluginManager()
    "Lcom/spiritpal/desktop_pet/TauriActivity;": [
        ("getPluginManager", "()Lapp/tauri/plugin/PluginManager;"),
    ],
    # wry：Ipc 的 @JavascriptInterface 方法由 WebView 经 JS 桥调用
    "Lcom/spiritpal/desktop_pet/Ipc;": [
        ("postMessage", None),
    ],
    # tauri：Rust.kt（generated）里的 native 方法由 .so 按「类名+方法名」链接。
    # 注意：这些 native 方法挂在 `Rust` 类上（不是 MainActivity！MainActivity 只有
    # <init>/onCreate）。用 dexdump 逐类核对时务必按 Class descriptor 边界切分，
    # 否则会把下一个类（Rust）的成员误算到 MainActivity 头上。
    "Lcom/spiritpal/desktop_pet/Rust;": [
        ("create", "()V"),
        ("ipc", None),
        ("handleRequest", None),
        ("handleReceivedTitle", None),
        ("assetLoaderDomain", None),
        ("onActivityCreate", None),
        ("onActivityDestroy", None),
        ("onActivityLowMemory", None),
        ("onActivitySaveInstanceState", None),
    ],
    # tauri：PluginManager 的 @JniMethod 方法（由 tauri-android 的 consumer proguard 规则保证）
    "Lapp/tauri/plugin/PluginManager;": [
        ("load", None),
        ("onWebViewCreated", None),
        ("runCommand", None),
        ("sendChannelData", None),
        ("handlePluginResponse", None),
    ],
}


def find_dexdump() -> str | None:
    """定位 SDK build-tools 里的 dexdump。"""
    candidates: list[Path] = []
    for env in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(env):
            candidates.append(Path(os.environ[env]) / "build-tools")
    candidates += [
        Path.home() / "AppData/Local/Android/Sdk/build-tools",
        Path.home() / "Library/Android/sdk/build-tools",
        Path("/usr/lib/android-sdk/build-tools"),
    ]
    for root in candidates:
        if not root.is_dir():
            continue
        # build-tools/<version>/dexdump(.exe)：取版本号最大的
        versions = sorted(
            (p for p in root.iterdir() if p.is_dir()),
            key=lambda p: [int(x) for x in re.findall(r"\d+", p.name)] or [0],
            reverse=True,
        )
        for v in versions:
            for exe in ("dexdump.exe", "dexdump"):
                if (v / exe).is_file():
                    return str(v / exe)
    return shutil.which("dexdump")


def pick_apk() -> Path | None:
    found = sorted(
        REPO_ROOT.glob(DEFAULT_APK_GLOB), key=lambda p: p.stat().st_mtime, reverse=True
    )
    return found[0] if found else None


def dump_dex(apk: Path, workdir: Path) -> str:
    """把 APK 内所有 classes*.dex 抽出并用 dexdump 转文本。"""
    dexdump = find_dexdump()
    if not dexdump:
        print("[env] 找不到 dexdump，请设置 ANDROID_HOME 或安装 SDK build-tools", file=sys.stderr)
        raise SystemExit(2)

    with zipfile.ZipFile(apk) as zf:
        dex_names = [n for n in zf.namelist() if re.fullmatch(r"classes\d*\.dex", n)]
        if not dex_names:
            print(f"[env] {apk.name} 里没有 classes*.dex", file=sys.stderr)
            raise SystemExit(2)
        zf.extractall(workdir, members=dex_names)

    chunks: list[str] = []
    for name in sorted(dex_names):
        chunks.append(
            subprocess.run(
                [dexdump, str(workdir / name)],
                capture_output=True, text=True, errors="replace", check=True,
            ).stdout
        )
    return "\n".join(chunks)


CLASS_RE = re.compile(r"^\s*Class descriptor\s*:\s*'(?P<desc>[^']+)'")
NAME_RE = re.compile(r"^\s*name\s*:\s*'(?P<name>[^']*)'")
TYPE_RE = re.compile(r"^\s*type\s*:\s*'(?P<type>[^']*)'")


def collect_methods(dump: str) -> dict[str, set[tuple[str, str]]]:
    """解析 dexdump 文本 → {类描述符: {(方法名, 签名)}}。"""
    result: dict[str, set[tuple[str, str]]] = {}
    current: str | None = None
    pending_name: str | None = None
    for line in dump.splitlines():
        m = CLASS_RE.match(line)
        if m:
            current = m.group("desc")
            result.setdefault(current, set())
            pending_name = None
            continue
        if current is None:
            continue
        m = NAME_RE.match(line)
        if m:
            pending_name = m.group("name")
            continue
        m = TYPE_RE.match(line)
        if m and pending_name is not None:
            # 字段与方法在 dexdump 里都是 name/type 成对出现；字段 type 不以 '(' 开头，
            # 方法 type 一定以 '(' 开头 → 用这个区分，避免把字段当成方法。
            if m.group("type").startswith("("):
                result[current].add((pending_name, m.group("type")))
            pending_name = None
    return result


def main(argv: list[str]) -> int:
    apk = Path(argv[1]).resolve() if len(argv) > 1 else pick_apk()
    if not apk or not apk.is_file():
        print("[env] 未找到 APK，请显式传入路径", file=sys.stderr)
        return 2
    print(f"[info] 校验 APK：{apk}")
    print(f"[info] 大小：{apk.stat().st_size:,} bytes")

    with tempfile.TemporaryDirectory(prefix="spiritpal-jni-") as td:
        methods = collect_methods(dump_dex(apk, Path(td)))

    missing: list[str] = []
    for desc, required in REQUIRED.items():
        if desc not in methods:
            missing.append(f"{desc}  ← 该类的原名不在 DEX 里（被 R8 删除或改名）")
            continue
        for name, sig in required:
            hit = (name, sig) if sig else None
            ok = any(
                m_name == name and (hit is None or m_sig == sig)
                for m_name, m_sig in methods[desc]
            )
            if not ok:
                detail = f"{name}{sig or ''}" if sig else name
                missing.append(f"{desc}.{detail}")

    total = sum(len(v) for v in REQUIRED.values())
    if missing:
        print(f"\n[FAIL] {len(missing)}/{total} 项 JNI 方法缺失（会被真机 NoSuchMethodError 打爆）：")
        for item in missing:
            print(f"  - {item}")
        print("\n[fix] 在 src-tauri/gen/android/app/proguard-rules.pro 里补 -keep（见 GOTCHAS #121/#122）")
        return 1

    print(f"\n[OK] {total}/{total} 项 JNI 方法全部保留在 release DEX 中。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
