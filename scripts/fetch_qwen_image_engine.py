#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_qwen_image_engine.py — 构建期拉取端侧图像引擎原生库（不入库）

背景
----
SpiritPal Android 端侧「文生图 / 图像编辑」依赖 libQwenImage21 的预编译原生库。
这些库以 **Android AAR** 形式随 GitHub Release 分发，AAR 内含：

    jni/arm64-v8a/libMNN.so              MNN 核心（scsonic/MNN 分支 qwen-image-21）
    jni/arm64-v8a/libc++_shared.so       NDK libc++ 动态库（AAR 版 libMNN.so 依赖它）
    jni/arm64-v8a/libqwenimage21_jni.so  Qwen-Image-2.1 diffusion 的 JNI 桥
    classes.jar                          Java API（com.scsonic.qwenimage21.*）

设计原则（契合「框架-only、不塞大包」，与 ADR-0005 / download_mnn_engine.py 同构）
---------------------------------------------------------------------------------
* 二进制 **不提交进 git**（.gitignore 的 *.so 规则 + 显式 libs/ 规则），由本脚本构建期生成；
* 干净克隆只需 `python scripts/fetch_qwen_image_engine.py` 即可复现；
* **不把 AAR 作为 Gradle 依赖**——只解包需要的产物，从而避开 AAR manifest 的
  `minSdk 26` 声明与 app（minSdk 24）的合并冲突，也不触发其 consumerProguardFiles。
* 落点：
    .so  → src-tauri/gen/android/app/mnnLibs/arm64-v8a/
           （由 app/build.gradle 的 jniLibs.srcDirs 叠加进包，与 LLM 引擎同目录）
    jar  → src-tauri/gen/android/app/libs/qwenimage21.jar
           （由 app/build.gradle 的 implementation files(...) 引入）

⚠️ libMNN.so 会**覆盖** download_mnn_engine.py 早先放入的同名文件
---------------------------------------------------------------------------------
`libmnnllmapp.so`（LLM 引擎）与 `libqwenimage21_jni.so`（图像引擎）都需要 `libMNN.so`，
但一个 APK 内同名 .so 只能存在一份。已用 ELF 符号闭包验证：AAR 版 libMNN.so
**同时满足**两者的全部 C++ 未定义符号（0 缺失），故以其为准。
因此 `download_mnn_engine.py` 已改为**不再解包 libMNN.so**（见该脚本 ENGINE_LIBS 注释）。
执行顺序：两个脚本无先后依赖，但都必须在 gradle 打包之前跑完。

来源
----
libQwenImage21（Apache-2.0 代码）：https://github.com/scsonic/libQwenImage21
模型权重另见 scripts/fetch-qwen-image-model.mjs（Hugging Face，Qwen Research License）。
"""

import argparse
import hashlib
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

# ── 固定版本（升级时同时改 URL / SHA256 / 版本号，并复核符号闭包）──────────────
AAR_VERSION = "v0.4.0"
AAR_COMMIT = "31dd5d45"
DEFAULT_AAR_URL = (
    "https://github.com/scsonic/libQwenImage21/releases/download/"
    f"{AAR_VERSION}/qwenimage21-{AAR_VERSION}-{AAR_COMMIT}.aar"
)
# 取自 Release 页公布的 sha256（权威校验，防截断/防替换）
AAR_SHA256 = "9b34e8de8ac1339264446c0624787126b268393da3f8a25fdce4cf125d30dab8"
# 期望体积下限（字节）用于截断自检
MIN_AAR_BYTES = 3_000_000

# AAR 内 ABI 目录（实测该 AAR 仅含 arm64-v8a）
AAR_ABI = "arm64-v8a"
# 需要解包的 native 库（成员路径 → 体积下限）
NATIVE_LIBS = {
    "libMNN.so": 8_000_000,
    "libc++_shared.so": 1_000_000,
    "libqwenimage21_jni.so": 20_000,
}
# 需要解包的 Java API（供 Gradle 文件依赖）
JAR_MEMBER = "classes.jar"
MIN_JAR_BYTES = 10_000

# ── libMNN.so 内存守卫改写（「低内存覆盖」）────────────────────────────────────
#
# 背景（见 local/agents/GOTCHAS.md #174）：MNN 的 diffusion 模块在每阶段前做一次
# `availableMemoryMB()` 守卫，只用 **MemAvailable**（不含 swap）判断，不足即抛
# `Out of memory before <阶段>: needs about N MB, only M MB available`。
#
# 真机实测（RMX5010 / 16GB 级 / Android 16，2026-10-14）：
#   text encoder 阶段通过（needs 5600 / available 8067）
#   → 紧接着 DiT 阶段报 needs 5523 / available 3735 而**中止**
# 但 text encoder 的 ~4.4GB 在检查时仍驻留（它在异常回卷后才释放），而设备
# 还有 **12.5GB 空闲 zram swap** 与 ~3.5GB 可回收 page cache —— 守卫看不到这些。
# 覆盖掉该守卫后，DiT 6 步完整跑完，512×512 总耗时 130.7s，进程未被 LMK 杀掉。
#
# 改法：把 `MNN::DIFFUSION::QwenImage21Diffusion::availableMemoryMB()` 的函数体
# 换成 `mov w0, #0x7FFF, LSL #16 ; ret`（恒返回极大值）→ 守卫恒通过。
# ⚠️ 这是**有意的二进制改写**，不是绕过 bug：上游该守卫对「带 swap 的 Android 设备」
#    过于保守。真正的内存保护改由应用层负责（生成前提示可用内存）。
# ⚠️ AAR 升级后符号地址会变：本函数按 .dynsym **动态解析**符号，并断言其首指令
#    是「调整 SP 的函数序言」，不匹配就报错退出（不静默改错位置）。
MNN_SO = "libMNN.so"
GUARD_SYMBOL = "_ZN3MNN9DIFFUSION20QwenImage21Diffusion17availableMemoryMBEv"
# `mov w0, #0x7FFF, LSL #16` + `ret`
GUARD_PATCH = bytes([0xE0, 0xFF, 0xAF, 0x52, 0xC0, 0x03, 0x5F, 0xD6])


def repo_root() -> Path:
    # scripts/fetch_qwen_image_engine.py -> repo root
    return Path(__file__).resolve().parents[1]


def android_app_dir() -> Path:
    return repo_root() / "src-tauri" / "gen" / "android" / "app"


def mnn_libs_dir() -> Path:
    return android_app_dir() / "mnnLibs"


def libs_dir() -> Path:
    return android_app_dir() / "libs"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path, timeout: int = 300) -> None:
    print(f"[download] GET {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "SpiritPal-Build/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as f:
        total = 0
        while True:
            buf = resp.read(1 << 20)
            if not buf:
                break
            f.write(buf)
            total += len(buf)
    print(f"[download] 完成 {total:,} bytes -> {dest}")
    if total < MIN_AAR_BYTES:
        raise RuntimeError(
            f"AAR 体积过小（{total:,} < {MIN_AAR_BYTES:,}），疑似截断（参考 GOTCHAS #102）。"
        )


def verify_aar(aar: Path) -> None:
    got = sha256_file(aar)
    if got != AAR_SHA256:
        raise RuntimeError(
            f"AAR sha256 不符：\n  期望 {AAR_SHA256}\n  实际 {got}\n"
            "若确为官方升级，请同步更新脚本顶部的 AAR_VERSION / DEFAULT_AAR_URL / AAR_SHA256，"
            "并重新用 ELF 符号闭包复核 libMNN.so 仍满足 libmnnllmapp.so 的需求。"
        )
    print(f"[verify] sha256 OK  {got}")


def extract(aar: Path) -> list[str]:
    placed: list[str] = []
    out_so = mnn_libs_dir() / AAR_ABI
    out_so.mkdir(parents=True, exist_ok=True)
    out_jar = libs_dir()
    out_jar.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(aar) as z:
        names = set(z.namelist())
        for lib, min_bytes in NATIVE_LIBS.items():
            src = f"jni/{AAR_ABI}/{lib}"
            if src not in names:
                raise RuntimeError(
                    f"AAR 内缺少 {src}（实际成员见 `unzip -l`）。"
                    f"若上游改了目录结构，请同步更新 NATIVE_LIBS。"
                )
            dst = out_so / lib
            with z.open(src) as zf, open(dst, "wb") as df:
                shutil.copyfileobj(zf, df)
            size = dst.stat().st_size
            if size < min_bytes:
                dst.unlink(missing_ok=True)
                raise RuntimeError(f"{lib} 体积过小（{size:,} < {min_bytes:,}），疑似截断。")
            placed.append(str(dst))
            print(f"[extract] {src} -> {dst} ({size:,} bytes)")

        # 解包后立刻改写内存守卫（见文件顶部说明）。放在 AAR 的 zip 上下文内，
        # 保证「解包 → 改写」原子完成，不留未改写状态。
        patch_mnn_memory_guard(out_so / MNN_SO)

        if JAR_MEMBER not in names:
            raise RuntimeError(f"AAR 内缺少 {JAR_MEMBER}")
        jar_dst = out_jar / "qwenimage21.jar"
        with z.open(JAR_MEMBER) as zf, open(jar_dst, "wb") as df:
            shutil.copyfileobj(zf, df)
        jsize = jar_dst.stat().st_size
        if jsize < MIN_JAR_BYTES:
            jar_dst.unlink(missing_ok=True)
            raise RuntimeError(f"{JAR_MEMBER} 体积过小（{jsize:,}），疑似异常。")
        placed.append(str(jar_dst))
        print(f"[extract] {JAR_MEMBER} -> {jar_dst} ({jsize:,} bytes)")

    return placed


def _elf_symbol_offset(data: bytes, symbol: str) -> int | None:
    """在 ELF64 的 .dynsym 中查符号，返回其**文件字节偏移**（经 PT_LOAD 做 vaddr→offset 映射）。"""
    e_phoff = int.from_bytes(data[0x20:0x28], "little")
    e_phentsize = int.from_bytes(data[0x36:0x38], "little")
    e_phnum = int.from_bytes(data[0x38:0x3A], "little")
    e_shoff = int.from_bytes(data[0x28:0x30], "little")
    e_shentsize = int.from_bytes(data[0x3A:0x3C], "little")
    e_shnum = int.from_bytes(data[0x3C:0x3E], "little")
    e_shstrndx = int.from_bytes(data[0x3E:0x40], "little")

    loads: list[tuple[int, int, int]] = []
    for i in range(e_phnum):
        o = e_phoff + i * e_phentsize
        if int.from_bytes(data[o:o + 4], "little") != 1:  # PT_LOAD
            continue
        p_off = int.from_bytes(data[o + 8:o + 16], "little")
        p_vaddr = int.from_bytes(data[o + 16:o + 24], "little")
        p_filesz = int.from_bytes(data[o + 32:o + 40], "little")
        loads.append((p_vaddr, p_off, p_filesz))

    shs = []
    for i in range(e_shnum):
        o = e_shoff + i * e_shentsize
        shs.append((int.from_bytes(data[o:o + 4], "little"),
                    int.from_bytes(data[o + 24:o + 32], "little"),
                    int.from_bytes(data[o + 32:o + 40], "little")))
    shstr_off = shs[e_shstrndx][1]

    def sec_name(sh_name: int) -> str:
        s = shstr_off + sh_name
        return data[s:data.index(b"\x00", s)].decode("utf-8", "replace")

    dynsym = next((s for s in shs if sec_name(s[0]) == ".dynsym"), None)
    dynstr = next((s for s in shs if sec_name(s[0]) == ".dynstr"), None)
    if dynsym is None or dynstr is None:
        return None

    sym_off, sym_size = dynsym[1], dynsym[2]
    str_off = dynstr[1]
    for i in range(sym_size // 24):
        o = sym_off + i * 24
        st_name = int.from_bytes(data[o:o + 4], "little")
        st_shndx = int.from_bytes(data[o + 6:o + 8], "little")
        st_value = int.from_bytes(data[o + 8:o + 16], "little")
        if st_name == 0 or st_shndx == 0:
            continue
        e = data.index(b"\x00", str_off + st_name)
        if data[str_off + st_name:e].decode("utf-8", "replace") != symbol:
            continue
        for vaddr, p_off, filesz in loads:
            if vaddr <= st_value < vaddr + filesz:
                return p_off + (st_value - vaddr)
        return None
    return None


def patch_mnn_memory_guard(so: Path) -> None:
    """把 MNN 的内存守卫函数体改成「恒返回极大值」。见文件顶部「内存守卫改写」注释。"""
    data = bytearray(so.read_bytes())
    off = _elf_symbol_offset(bytes(data), GUARD_SYMBOL)
    if off is None:
        raise RuntimeError(
            f"在 {so.name} 中找不到符号 {GUARD_SYMBOL}。\n"
            "  上游可能改了符号名/可见性 —— 请重新用 llvm-objdump -T 核对，并更新 GUARD_SYMBOL。"
        )
    cur = bytes(data[off:off + 4])
    if cur == GUARD_PATCH[:4]:
        print(f"[patch] {so.name} 内存守卫已改写，跳过。")
        return
    instr = int.from_bytes(cur, "little")
    # 断言首指令是「64 位 SUB (imm) 且 Rn=Rd=SP」的函数序言，避免改错位置。
    if (instr & 0xFF800000) != 0xD1000000 or (instr & 0x3FF) != 0x3FF:
        raise RuntimeError(
            f"{GUARD_SYMBOL} 首指令不是预期的函数序言（实际 {cur.hex(' ')}）。\n"
            "  AAR 版本可能已变 —— 请人工核对后再决定是否更新 GUARD_PATCH。"
        )
    backup = so.with_name(so.name + ".orig")
    if not backup.exists():
        backup.write_bytes(bytes(data))
    data[off:off + len(GUARD_PATCH)] = GUARD_PATCH
    so.write_bytes(bytes(data))
    if so.read_bytes()[off:off + len(GUARD_PATCH)] != GUARD_PATCH:
        raise RuntimeError(f"{so.name} 补丁写入后校验失败。")
    print(f"[patch] {so.name} 内存守卫已改写 @ 0x{off:x}（原件备份 {backup.name}）")


def is_complete() -> bool:
    """全部产物就位才算完整（防半缺失状态永远修不回来，参考 GOTCHAS #110）。"""
    so_ok = all((mnn_libs_dir() / AAR_ABI / lib).exists() for lib in NATIVE_LIBS)
    jar_ok = (libs_dir() / "qwenimage21.jar").exists()
    return so_ok and jar_ok


def is_patched() -> bool:
    """libMNN.so 的内存守卫是否已改写（未改写时 `--force` 重跑一次即可）。"""
    so = mnn_libs_dir() / AAR_ABI / MNN_SO
    if not so.exists():
        return False
    data = so.read_bytes()
    off = _elf_symbol_offset(data, GUARD_SYMBOL)
    return off is not None and data[off:off + len(GUARD_PATCH)] == GUARD_PATCH


def main() -> int:
    ap = argparse.ArgumentParser(description="构建期拉取 Qwen-Image-2.1 端侧图像引擎原生库")
    ap.add_argument("--url", default=os.environ.get("QWEN_IMAGE_AAR_URL", DEFAULT_AAR_URL),
                    help="AAR 直链（默认 GitHub Release）")
    ap.add_argument("--aar", default=os.environ.get("QWEN_IMAGE_AAR_PATH", ""),
                    help="使用本地已有 AAR（离线/内网场景；优先于 --url）")
    ap.add_argument("--force", action="store_true", help="即使产物已就位也重新下载解包")
    ap.add_argument("--keep-aar", action="store_true", help="保留下载的 AAR 缓存（默认解包后删除）")
    ap.add_argument("--skip-verify", action="store_true",
                    help="跳过 sha256 校验（仅供上游结构变化时的调试，不建议用于正式构建）")
    args = ap.parse_args()

    if is_complete() and is_patched() and not args.force:
        print("[skip] 图像引擎产物已就位（含内存守卫改写），跳过（--force 可强制重拉）。")
        for lib in NATIVE_LIBS:
            print(f"        {mnn_libs_dir() / AAR_ABI / lib}")
        print(f"        {libs_dir() / 'qwenimage21.jar'}")
        return 0
    if is_complete() and not is_patched():
        print("[warn] 产物已就位但 libMNN.so 未改写内存守卫 → 重新解包并改写。")

    if args.aar:
        aar = Path(args.aar).expanduser().resolve()
        if not aar.is_file():
            print(f"[error] --aar 指向的文件不存在：{aar}", file=sys.stderr)
            return 2
        print(f"[cache] 使用本地 AAR {aar}")
        cache = aar
        cleanup = False
    else:
        cache = android_app_dir() / "build" / "qwen_image_cache" / f"qwenimage21-{AAR_VERSION}.aar"
        if cache.exists() and not args.force:
            print(f"[cache] 复用已下载 AAR {cache}")
        else:
            try:
                download(args.url, cache)
            except Exception as e:  # noqa: BLE001 - 需给出可操作提示
                print(
                    f"[error] 下载 AAR 失败：{e}\n"
                    f"        可手动下载后重试：\n"
                    f"          {DEFAULT_AAR_URL}\n"
                    f"          python scripts/fetch_qwen_image_engine.py --aar <本地路径.aar>",
                    file=sys.stderr,
                )
                return 1
        cleanup = not args.keep_aar

    try:
        if not args.skip_verify:
            verify_aar(cache)
        else:
            print("[warn] 已跳过 sha256 校验（--skip-verify）")
        extract(cache)
    finally:
        if cleanup:
            try:
                cache.unlink()
                print(f"[clean] 已删除 AAR 缓存 {cache}")
            except OSError:
                pass

    print("[done] 图像引擎产物已就位。下一步："
          "gradlew bundleRelease / assembleRelease 会将其编入 APK/AAB。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
