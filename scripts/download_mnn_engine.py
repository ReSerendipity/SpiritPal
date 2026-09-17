#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
download_mnn_engine.py — 构建期拉取端侧 MNN LLM 引擎原生库（不入库）

背景
----
SpiritPal Android 的端侧 LLM（on-device）依赖两个预编译原生库：
    libmnnllmapp.so  （MNN Chat 的 JNI 桥，System.loadLibrary("mnnllmapp") 加载）
    libMNN.so         （MNN 单体构建核心，已含 LLM/Express/后端，静态 libc++）
这两个库合计约 8.9MB，官方只以**编译进 MNN Chat APK** 的形式分发（GitHub release
的 android zip 里是 libllm.so，不是我们要的 libmnnllmapp.so）。因此从官方 MNN Chat
APK 解包是最稳的来源（见 docs/agents/GOTCHAS.md #71/#72、ADR-0005-ondevice-llm.md）。

设计原则（契合「框架-only、不塞大包」）
---------------------------------------
* 引擎 .so **不提交进 git**（.gitignore 的 *.so 全局规则照常忽略），由本脚本构建期生成；
* 干净克隆只需 `python scripts/download_mnn_engine.py` 即可复现引擎库；
* 落点 = src-tauri/gen/android/app/mnnLibs/<abi>/，再由 app/build.gradle 的
  `jniLibs.srcDirs` 把它与 cargo-ndk 产出的 src/main/jniLibs 叠加进包。

来源（国内 CDN，直连可达；GOTCHAS #72 已实测）
---------------------------------------------
默认：https://meta.alicdn.com/data/mnn/apks/mnn_chat_0_8_3.apk
可用环境变量 MNN_CHAT_APK_URL 或 --url 覆盖（版本升级时改这里）。

实测：mnn_chat_0_8_3.apk **仅含 arm64-v8a**（无 armeabi-v7a/x86/x86_64）；脚本对缺失 ABI
自动跳过并清理残留，不生成残缺包。故端侧 LLM 仅 arm64 设备可用（与其余 App 功能无关，
符合 GOTCHAS #71；版本升级后所含 ABI 可能变化，以解包结果为准）。
"""

import argparse
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

DEFAULT_APK_URL = "https://meta.alicdn.com/data/mnn/apks/mnn_chat_0_8_3.apk"
# 解包后需要的库（相对 APK 内 lib/<abi>/）
ENGINE_LIBS = ["libmnnllmapp.so", "libMNN.so"]
# 期望的 ABI 集（缺失者自动跳过；当前 APK 实际只提供 arm64-v8a）
TARGET_ABIS = ["arm64-v8a", "armeabi-v7a"]
# 体积下限（字节）用于截断自检：官方 APK ~41.8MB；这里只防“拿到空/半截”
MIN_APK_BYTES = 30 * 1024 * 1024


def repo_root() -> Path:
    # scripts/download_mnn_engine.py -> repo root
    return Path(__file__).resolve().parents[1]


def android_app_dir() -> Path:
    return repo_root() / "src-tauri" / "gen" / "android" / "app"


def mnn_libs_dir() -> Path:
    return android_app_dir() / "mnnLibs"


def download(url: str, dest: Path, timeout: int = 120) -> None:
    print(f"[download] GET {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    # 流式写入，避免一次性读入内存
    req = urllib.request.Request(url, headers={"User-Agent": "SpiritPal-Build/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as f:
        total = 0
        chunk = 1 << 20  # 1MiB
        while True:
            buf = resp.read(chunk)
            if not buf:
                break
            f.write(buf)
            total += len(buf)
    print(f"[download] 完成 {total:,} bytes -> {dest}")
    if total < MIN_APK_BYTES:
        raise RuntimeError(
            f"APK 体积过小（{total:,} < {MIN_APK_BYTES:,}），疑似截断（参考 GOTCHAS #102）。"
        )


def extract_libs(apk: Path, out_dir: Path) -> list[str]:
    placed: list[str] = []
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(apk) as z:
        names = set(z.namelist())
        for abi in TARGET_ABIS:
            abi_ok = True
            for lib in ENGINE_LIBS:
                src = f"lib/{abi}/{lib}"
                if src not in names:
                    print(f"[extract] 跳过 {src}（APK 内不存在，该 ABI 无端侧 LLM）")
                    abi_ok = False
                    continue
                dst = out_dir / abi / lib
                dst.parent.mkdir(parents=True, exist_ok=True)
                with z.open(src) as zf, open(dst, "wb") as df:
                    shutil.copyfileobj(zf, df)
                placed.append(str(dst))
                print(f"[extract] {src} -> {dst} ({dst.stat().st_size:,} bytes)")
            if not abi_ok:
                # 该 ABI 缺库：清理可能残留的半截，避免打进残缺包
                abi_dir = out_dir / abi
                if abi_dir.exists():
                    shutil.rmtree(abi_dir, ignore_errors=True)
    if not placed:
        raise RuntimeError("未从 APK 解包出任何引擎库，请检查 APK 版本/URL。")
    return placed


def main() -> int:
    ap = argparse.ArgumentParser(description="构建期拉取 MNN LLM 引擎原生库")
    ap.add_argument("--url", default=os.environ.get("MNN_CHAT_APK_URL", DEFAULT_APK_URL),
                    help="MNN Chat APK 直链（默认官方 CDN）")
    ap.add_argument("--force", action="store_true",
                    help="即使 mnnLibs 已存在也重新下载解包")
    ap.add_argument("--keep-apk", action="store_true",
                    help="保留下载的 APK 缓存（默认解包后删除）")
    args = ap.parse_args()

    out = mnn_libs_dir()
    # 完整性判定：只有某个 ABI 目录下 **ENGINE_LIBS 全部都在**，才算"已就位"。
    # ⚠️ 早期写法是"存在任意 1 个库即跳过"，导致「两个库少了一个」的半缺失状态
    #    永远修不回来（2026-09-17 实测：libmnnllmapp.so 被外部删除后，脚本报
    #    "[skip] mnnLibs 已存在 1 个库" 直接返回，构建却因缺库而失败）。
    complete_abis = [abi for abi in TARGET_ABIS
                     if all((out / abi / lib).exists() for lib in ENGINE_LIBS)]
    partial = [out / abi / lib for abi in TARGET_ABIS for lib in ENGINE_LIBS
               if (out / abi / lib).exists() and abi not in complete_abis]
    if complete_abis and not args.force:
        print(f"[skip] mnnLibs 已就位（完整 ABI：{', '.join(complete_abis)}），跳过（--force 可强制重拉）。")
        for abi in complete_abis:
            for lib in ENGINE_LIBS:
                print(f"        {out / abi / lib}")
        return 0
    if partial:
        print(f"[repair] 检测到半缺失状态（{len(partial)} 个残件），重新下载解包补全：")
        for p in partial:
            print(f"        {p}")

    cache = android_app_dir() / "build" / "mnn_chat_cache" / "mnn_chat.apk"
    if not (cache.exists() and not args.force):
        download(args.url, cache)
    else:
        print(f"[cache] 复用已下载 APK {cache}")

    try:
        extract_libs(cache, out)
    finally:
        if not args.keep_apk:
            try:
                cache.unlink()
                print(f"[clean] 已删除 APK 缓存 {cache}")
            except OSError:
                pass

    print("[done] 引擎库已就位，下一步：gradlew bundleRelease / assembleRelease 会将其编入 APK/AAB。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
