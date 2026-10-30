#!/usr/bin/env python3
"""校验 Android release APK 里「仅 JNI 可达」的方法是否被 R8 保留。

背景（见 local/agents/GOTCHAS.md #121 / #122）：
    release 构建开了 `minifyEnabled=true`，R8 会把「Kotlin/Java 侧没有直接调用者、
    只能被 Rust 侧经 JNI 反射调用」的方法当 unused 整方法删除。这类删除**编译期
    无告警、打包无报错**，只在真机启动/触发对应功能时抛
    `java.lang.NoSuchMethodError: no non-static method "L<Class>;.<method>()<sig>"`。

    已踩过的坑：WryActivity.getId()、TauriActivity.getPluginManager()、
    RustWebView.clearAllBrowsingData() / getCookies()。

ELF 层校验（2026-10-14 新增，动机见 GOTCHAS #170）：
    DEX 层管「Kotlin 方法没被 R8 删」，ELF 层管「Rust 侧把 JNI 符号真的导出了」。
    Kotlin 的 `external fun` 由 JVM 运行时按 `Java_<mangled类名>_<mangled方法名>`
    查找符号；Rust 侧漏写 `#[no_mangle]`、或类名里的下划线没转义成 `_1`
    （`desktop_pet` → `desktop_1pet`），**编译与 DEX 全过，只有调用那一刻才
    UnsatisfiedLinkError**。故对每个 native 桥做符号导出断言。

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
    # wry 0.57.1：src/android/mod.rs 经 JNI 调 activity 上的这些方法
    # （0.57.1 起 getId()/getVersion() 已从 WryActivity 移除；startActivity 仍在源码里，
    #   但 Rust 侧不再调用，保留条目只为 DEX 面不回退）
    "Lcom/spiritpal/desktop_pet/WryActivity;": [
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
        # wry 0.57.1 Rust.kt 的全部 external fun（.so 按类名+方法名链接）。
        # 0.55.1 的 create/start/resume/pause/stop/wryCreate/withAssetLoader 与
        # onActivityCreate/onActivityDestroy/onActivitySaveInstanceState/onActivityLowMemory
        # 已移除，替换为下面的生命周期面。
        ("onFirstActivityCreate", "()V"),
        ("onCreate", None),
        ("onStart", None),
        ("onResume", None),
        ("onPause", None),
        ("onStop", None),
        ("onDestroy", None),
        ("onWindowFocusChanged", None),
        ("onLowMemory", "()V"),
        ("onNewIntent", None),
        ("onFirstActivityCreateWry", "()V"),
        ("onWebviewDestroy", None),
        ("ipc", None),
        ("handleRequest", None),
        ("handleReceivedTitle", None),
        ("assetLoaderDomain", None),
        ("shouldOverride", None),
        ("onPageLoading", None),
        ("onPageLoaded", None),
        ("onEval", None),
    ],
    # tauri：PluginManager 的 @JniMethod 方法（由 tauri-android 的 consumer proguard 规则保证）
    "Lapp/tauri/plugin/PluginManager;": [
        ("load", None),
        ("onWebViewCreated", None),
        ("runCommand", None),
        ("sendChannelData", None),
        ("handlePluginResponse", None),
    ],
    # 端侧图像（Qwen-Image-2.1 / libQwenImage21 AAR）：
    # QwenImage21 的 native* 方法由 libqwenimage21_jni.so 按「类名+方法名」链接；
    # ProgressListener.onProgress 由 native 层经 GetMethodID 回调（见 AAR 的 qwenimage21_jni.cpp）。
    # ⚠️ AAR 自带 consumerProguardFiles 含 `-keep class com.scsonic.qwenimage21.** { *; }`，
    #    但本仓**不把 AAR 作为 Gradle 依赖**（只解包 .so 与 classes.jar），该规则不会自动应用，
    #    已手写进 proguard-rules.pro —— 此处登记以便静态守卫与 DEX 级校验双重覆盖。
    "Lcom/scsonic/qwenimage21/QwenImage21;": [
        ("nativeCreate", "(Ljava/lang/String;ZZZII)J"),
        ("nativeGenerate", None),
        ("nativeLastError", "(J)Ljava/lang/String;"),
        ("nativeAvailableMemoryMB", "()I"),
        ("nativeRelease", "(J)V"),
    ],
    "Lcom/scsonic/qwenimage21/QwenImage21$ProgressListener;": [
        ("onProgress", "(I)V"),
    ],
    # SpiritPal 端侧图像桥：Rust 经 JNI 调这些静态方法（Kotlin 侧无调用者 → R8 会删）；
    # native* 是 Kotlin 的 external 方法，需保持名字以匹配 libspiritpal_lib.so 的 JNI 符号。
    "Lcom/spiritpal/desktop_pet/QwenImageBridge;": [
        ("loadModel", "(Ljava/lang/String;Ljava/lang/String;)V"),
        ("generate", "(Ljava/lang/String;Ljava/lang/String;)V"),
        ("release", "()V"),
        ("missingFiles", "(Ljava/lang/String;)Ljava/lang/String;"),
        ("nativeOnProgress", "(Ljava/lang/String;I)V"),
        ("nativeOnDone", "(Ljava/lang/String;ZLjava/lang/String;)V"),
        ("nativeIsCancelled", "(Ljava/lang/String;)Z"),
    ],
}

# ---- ELF 层：native 桥的符号导出断言（动机见文件头注释）----
#
# (APK 内 .so 路径, 声明 external fun 的类描述符, [本仓 Rust 侧必须导出的方法名],
#  额外要求的非 Java_* 符号)
#
# 每个方法名经 {@link jni_symbol} 换算成 JVM 运行时真正查找的符号名，再核对
# `.so` 的 `.dynsym`。这样表格只写「Kotlin 侧看到的名字」，mangling 规则只有
# 一处实现（含下划线 → `_1` 的转义，2026-10-14 踩过：漏转义编译全过、
# 生成时才 UnsatisfiedLinkError，见 GOTCHAS #170）。
NATIVE_BRIDGES: list[tuple[str, str, list[str], list[str]]] = [
    # SpiritPal 自有三座桥：Rust 侧 JNI_OnLoad 缓存的类引用 + Kotlin external 方法。
    # ⚠️ QwenImageBridge / Rust 的包名 com.spiritpal.desktop_pet 含下划线，
    #    符号里必须是 `desktop_1pet`（tauri 自身生成的 `Java_..._Rust_*` 同理）。
    (
        "lib/arm64-v8a/libspiritpal_lib.so",
        "Lcom/spiritpal/desktop_pet/QwenImageBridge;",
        ["nativeOnProgress", "nativeOnDone", "nativeIsCancelled"],
        ["JNI_OnLoad"],
    ),
    (
        "lib/arm64-v8a/libspiritpal_lib.so",
        "Lcom/alibaba/mnnllm/android/SpiritPalOnDevice;",
        [
            "nativeOnToken",
            "nativeOnDone",
            "nativeIsCancelled",
            # P1-D：MainActivity 回传外部模型目录（2026-10-14 补 #[no_mangle]）
            "nativeSetExternalModelsDir",
        ],
        [],
    ),
    # 上游 AAR 的 JNI 桥：libqwenimage21_jni.so 按类名链接 com.scsonic.qwenimage21.QwenImage21。
    (
        "lib/arm64-v8a/libqwenimage21_jni.so",
        "Lcom/scsonic/qwenimage21/QwenImage21;",
        [
            "nativeCreate",
            "nativeGenerate",
            "nativeLastError",
            "nativeAvailableMemoryMB",
            "nativeRelease",
        ],
        [],
    ),
]


def jni_symbol(descriptor: str, method: str) -> str:
    """按 JNI 规范（"Resolving Native Method Names"）换算 JVM 查找的符号名。

    `Lcom/spiritpal/desktop_pet/QwenImageBridge;` + `nativeOnProgress`
    → `Java_com_spiritpal_desktop_1pet_QwenImageBridge_nativeOnProgress`

    规则：类描述符去掉 `L`/`;` 后逐字符转义 —— `/`→`_`、`_`→`_1`、`;`→`_2`、
    `[`→`_3`；数字/字母/`$` 原样保留。**类名与方法名都要转义**。
    （JNI 规范原文见 "Resolving Native Method Names"：`.` 换成 `/` 之后再做
    上述转义；Java 侧看到的 `com.spiritpal.desktop_pet` 在 descriptor 里已写作
    `com/spiritpal/desktop_pet`，故 `/` 也要变成 `_`。）
    （不支持重载 native 方法——那需要 `__<参数签名>` 后缀；当前无此用法。）
    """
    def escape(part: str) -> str:
        table = {"/": "_", "_": "_1", ";": "_2", "[": "_3"}
        return "".join(table.get(ch, ch) for ch in part)

    inner = descriptor[1:-1] if descriptor.startswith("L") else descriptor
    return f"Java_{escape(inner)}_{escape(method)}"


def exported_symbols(so_bytes: bytes) -> set[str]:
    """解析 ELF `.dynsym`，返回导出符号集合（st_shndx != SHN_UNDEF）。"""
    if so_bytes[:4] != b"\x7fELF":
        raise ValueError("不是 ELF 文件")
    e_shoff = int.from_bytes(so_bytes[0x28:0x30], "little")
    e_shentsize = int.from_bytes(so_bytes[0x3A:0x3C], "little")
    e_shnum = int.from_bytes(so_bytes[0x3C:0x3E], "little")
    e_shstrndx = int.from_bytes(so_bytes[0x3E:0x40], "little")

    sections = []
    for i in range(e_shnum):
        base = e_shoff + i * e_shentsize
        sh_name = int.from_bytes(so_bytes[base:base + 4], "little")
        sh_type = int.from_bytes(so_bytes[base + 4:base + 8], "little")
        sh_offset = int.from_bytes(so_bytes[base + 24:base + 32], "little")
        sh_size = int.from_bytes(so_bytes[base + 32:base + 40], "little")
        sections.append((sh_name, sh_type, sh_offset, sh_size))

    # 取节名表：第 e_shstrndx 节的「数据」即字符串表
    _, _, str_off, str_size = sections[e_shstrndx]
    strtab = so_bytes[str_off:str_off + str_size]

    def name_at(off: int) -> str:
        end = strtab.index(b"\x00", off)
        return strtab[off:end].decode("utf-8", "replace")

    by_name = {name_at(s[0]): s for s in sections}
    dynsym = by_name.get(".dynsym")
    dynstr = by_name.get(".dynstr")
    if not dynsym or not dynstr:
        return set()

    sym_off, sym_size = dynsym[2], dynsym[3]
    str_base = dynstr[2]
    out: set[str] = set()
    for pos in range(sym_off, sym_off + sym_size, 24):
        st_name = int.from_bytes(so_bytes[pos:pos + 4], "little")
        st_shndx = int.from_bytes(so_bytes[pos + 6:pos + 8], "little")
        if st_name == 0 or st_shndx == 0:
            continue  # 0 = SHN_UNDEF（未定义，即「需要别人提供」）
        end = so_bytes.index(b"\x00", str_base + st_name)
        out.add(so_bytes[str_base + st_name:end].decode("utf-8", "replace"))
    return out


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


def verify_elf_exports(apk: Path) -> list[str]:
    """ELF 层：核对每个 native 桥的 JNI 符号确实被 .so 导出。返回缺失清单。"""
    missing: list[str] = []
    with zipfile.ZipFile(apk) as zf:
        cache: dict[str, set[str]] = {}
        for so_path, descriptor, methods, extras in NATIVE_BRIDGES:
            try:
                raw = zf.read(so_path)
            except KeyError:
                missing.append(f"{so_path}  ← APK 里没有这个 native 库")
                continue
            if so_path not in cache:
                try:
                    cache[so_path] = exported_symbols(raw)
                except ValueError as exc:
                    missing.append(f"{so_path}  ← 无法解析 ELF：{exc}")
                    continue
            have = cache[so_path]
            for method in methods:
                sym = jni_symbol(descriptor, method)
                if sym not in have:
                    missing.append(f"{so_path}!{descriptor}.{method}  ← 缺符号 {sym}")
            for sym in extras:
                if sym not in have:
                    missing.append(f"{so_path}!{sym}")
    return missing


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

    # ELF 层：符号导出断言（DEX 层保方法名，这层保 Rust 侧符号真的在）
    elf_missing = verify_elf_exports(apk)
    missing.extend(elf_missing)

    total = sum(len(v) for v in REQUIRED.values())
    total += sum(len(m) + len(e) for _, _, m, e in NATIVE_BRIDGES)
    if missing:
        dex_missing = missing[: len(missing) - len(elf_missing)]
        if dex_missing:
            print(
                f"\n[FAIL] {len(dex_missing)}/{len(REQUIRED)} 项 DEX 层 JNI 方法缺失"
                "（会被真机 NoSuchMethodError 打爆）："
            )
            for item in dex_missing:
                print(f"  - {item}")
            print("\n[fix] 在 src-tauri/gen/android/app/proguard-rules.pro 里补 -keep（见 GOTCHAS #121/#122）")
        if elf_missing:
            print(
                f"\n[FAIL] {len(elf_missing)} 项 ELF 层 native 符号缺失"
                "（Kotlin external fun 运行时会 UnsatisfiedLinkError）："
            )
            for item in elf_missing:
                print(f"  - {item}")
            print(
                "\n[fix] Rust 侧确认：① fn 上有 `#[no_mangle]`；② 类名/方法名的下划线"
                "已按 JNI 规范转义成 `_1`（com.spiritpal.desktop_pet →"
                "Java_com_spiritpal_desktop_1pet_...）；③ 目标 target 确实是 aarch64-linux-android。"
            )
        return 1

    print(f"\n[OK] {total}/{total} 项 JNI 校验全部通过（DEX 层方法保留 + ELF 层符号导出）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
