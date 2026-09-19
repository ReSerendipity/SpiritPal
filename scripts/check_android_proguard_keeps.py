#!/usr/bin/env python3
"""静态守卫：Android release 的 R8 keep 规则完整性（**无需 Android 工具链**）。

为什么需要它（见 docs/agents/GOTCHAS.md #121 / #122）
------------------------------------------------------
release 开 `minifyEnabled=true` 后，R8 会把「Kotlin/Java 侧没有调用者、只能被 Rust
侧经 JNI 反射调用」的方法当 unused **整方法删除** —— 编译期零告警、打包零报错，
真机启动才抛 `java.lang.NoSuchMethodError` + SIGABRT。已踩过 3 次：

  1. `WryActivity.getId()`        —— wry 自带 proguard-wry.pro 从未接入构建；
  2. `TauriActivity.getPluginManager()` —— tauri CLI 自动生成的 proguard-tauri.pro 缺失
     （Gradle 对缺失的 proguard 文件**不报错也不警告**，静默少应用一份规则）；
  3. `RustWebView.clearAllBrowsingData()` / `getCookies()` —— wry 官方规则自身漏列。

本脚本查三件事（静态、秒级、零外部依赖）
----------------------------------------
  A. `app/proguard-rules.pro` 是否为**每个**「仅 JNI 可达」的方法提供了 keep 覆盖；
  B. `app/build.gradle` 的 release `proguardFiles` 是否仍引用 `proguard-rules.pro`；
  C. `Cargo.lock` 里的 `wry` / `tauri` 版本是否仍是**已审计过**的版本 —— 依赖升级会
     改变 JNI 面（新增/改名被 JNI 调用的方法），必须重新审计，不能静默放行。

**A 是"规则还在"，C 是"假设还成立"**；两者都过仍不等于 APK 里真有这些方法 ——
真正的 DEX 级证明需要 APK，见 `scripts/verify_android_jni_keeps.py`（release 包出完必跑，
SOP-4）。本脚本的作用是让"规则被删/被重新生成/依赖升级"这三类高频回归在 PR 阶段就红。

退出码：0 = 通过；1 = 有缺口（打印缺口清单）；2 = 环境/文件问题。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# 「仅 JNI 可达」方法清单与 DEX 级校验共用同一张表，避免两处漂移。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_android_jni_keeps import REQUIRED  # noqa: E402

# 已审计过 JNI 面的依赖版本。升级后必须对照以下模板重新审计，再更新此表：
#   ~/.cargo/registry/src/*/wry-<ver>/src/android/kotlin/proguard-wry.pro
#   ~/.cargo/registry/src/*/tauri-<ver>/mobile/proguard-tauri.pro
AUDITED_VERSIONS: dict[str, str] = {
    "wry": "0.55.1",
    "tauri": "2.11.5",
}

# 类描述符（Lcom/x/Y;）→ 生成它的 Kotlin 源所在目录，用于 A 的失败提示
GENERATED_DIR = "src-tauri/gen/android/app/src/main/java"

# 这些类的方法由**依赖自带的 consumer proguard 规则**保证，不在本仓的
# proguard-rules.pro 里 —— tauri-android 模块声明了
# `consumerProguardFiles("proguard-rules.pro")`，其内容含
# `-keep class app.tauri.** { @app.tauri.JniMethod public <methods>; native <methods>; }`，
# 故 A 项跳过它们（DEX 级校验 scripts/verify_android_jni_keeps.py 仍会实测）。
DEPENDENCY_KEPT = {"Lapp/tauri/plugin/PluginManager;"}

# 这些类的方法**本身就是 native 方法**（Rust.kt 里的 `external fun`），
# 因此 `-keep class ... { native <methods>; }` 即可覆盖，无需逐条列出。
NATIVE_CLASSES = {"Lcom/spiritpal/desktop_pet/Rust;"}

PROGUARD = "src-tauri/gen/android/app/proguard-rules.pro"
BUILD_GRADLE = "src-tauri/gen/android/app/build.gradle"
CARGO_LOCK = "src-tauri/Cargo.lock"


# --------------------------------------------------------------------------- #
# ProGuard 解析
# --------------------------------------------------------------------------- #

_KEEP_RE = re.compile(
    r"^\s*-keep\w*\s+class\s+(?P<classes>[^{]+?)\s*\{(?P<body>[^}]*)\}",
    re.MULTILINE | re.DOTALL,
)
_MODIFIERS = (
    r"public|private|protected|static|final|synchronized|native|abstract|"
    r"volatile|transient|strictfp"
)


def strip_comments(text: str) -> str:
    """去掉整行 `#` 注释（本项目 proguard 文件只用整行注释）。"""
    return "\n".join(l for l in text.splitlines() if not l.strip().startswith("#"))


def member_method_name(line: str) -> str | None:
    """把一条 keep 成员规则归一到"它覆盖哪个方法名"。

    返回 `'*'`（全成员）、`'<methods>'`（全部方法）、`'<native-methods>'`（仅 native 方法，
    **不能**算作覆盖普通方法）、或具体方法名；字段/无法识别返回 None。
    """
    raw = line.strip().rstrip(";").strip()
    if not raw:
        return None
    s = re.sub(r"@[\w.]+", " ", raw)  # 去注解（@android.webkit.JavascriptInterface 等）
    is_native = bool(re.search(r"\bnative\b", s))
    s = re.sub(rf"\b({_MODIFIERS})\b", " ", s)
    s = " ".join(s.split())
    if s == "*":
        return "*"
    if s == "<methods>":
        return "<native-methods>" if is_native else "<methods>"
    if s in ("<fields>", "<init>") or "(" not in s:
        return None
    return s[: s.index("(")].strip().split()[-1]


def class_pattern_matches(pattern: str, java_name: str) -> bool:
    """ProGuard 类名模式是否覆盖某个具体类名。

    `*` 不跨包分隔符、`**` 跨 —— 与 ProGuard 语义一致，故 `pkg.*` 不覆盖 `pkg.sub.Foo`。
    """
    p = pattern.strip()
    if p == java_name:
        return True
    if p.endswith(".**"):
        return java_name.startswith(p[:-2])
    if p.endswith(".*"):
        prefix = p[:-2]
        rest = java_name[len(prefix) + 1:] if java_name.startswith(prefix + ".") else ""
        return bool(rest) and "." not in rest
    return False


def parse_keeps(text: str) -> list[tuple[list[str], set[str]]]:
    """→ [(类名模式列表, 被覆盖的方法名集合), ...]"""
    blocks: list[tuple[list[str], set[str]]] = []
    for m in _KEEP_RE.finditer(strip_comments(text)):
        patterns = [p.strip() for p in m.group("classes").split(",") if p.strip()]
        members = {n for n in (member_method_name(l) for l in m.group("body").splitlines()) if n}
        blocks.append((patterns, members))
    return blocks


def covers(
    blocks: list[tuple[list[str], set[str]]],
    java_name: str,
    method: str,
    *,
    native: bool = False,
) -> bool:
    accepted = {"*", "<methods>", method}
    if native:
        # `native <methods>;` 只覆盖 native 方法，故仅当该方法确为 native 时才接受。
        accepted.add("<native-methods>")
    for patterns, members in blocks:
        if not any(class_pattern_matches(p, java_name) for p in patterns):
            continue
        if members & accepted:
            return True
    return False


# --------------------------------------------------------------------------- #
# 三项检查
# --------------------------------------------------------------------------- #


def check_proguard_keeps(text: str) -> list[str]:
    """A. 每个「仅 JNI 可达」方法都要有 keep 覆盖（依赖自带规则的类除外）。"""
    blocks = parse_keeps(text)
    problems: list[str] = []
    for desc, required in REQUIRED.items():
        if desc in DEPENDENCY_KEPT:
            continue
        java_name = desc[1:-1].replace("/", ".")  # Lcom/x/Y; → com.x.Y
        is_native_class = desc in NATIVE_CLASSES
        for method, _sig in required:
            if not covers(blocks, java_name, method, native=is_native_class):
                problems.append(
                    f"{java_name}.{method}() 无 keep 覆盖（JNI 调用方=Rust 侧；"
                    f"R8 会当 unused 删除 → 真机 NoSuchMethodError）"
                )
    return problems


def check_gradle_wiring(text: str) -> list[str]:
    """B. release 变体必须仍引用 proguard-rules.pro。"""
    if not re.search(r"proguardFiles[^\n]*['\"]proguard-rules\.pro['\"]", text):
        return [
            "app/build.gradle 的 release `proguardFiles` 未引用 proguard-rules.pro"
            "（规则写再好也不会被应用）"
        ]
    return []


def check_dependency_versions(text: str) -> list[str]:
    """C. wry / tauri 版本必须仍是已审计版本。"""
    versions: dict[str, str] = {}
    for m in re.finditer(
        r'^\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"',
        text,
        re.MULTILINE,
    ):
        versions.setdefault(m.group(1), m.group(2))
    problems: list[str] = []
    for crate, audited in AUDITED_VERSIONS.items():
        found = versions.get(crate)
        if found is None:
            problems.append(f"Cargo.lock 里找不到 crate `{crate}`（已审计版本 {audited}）")
        elif found != audited:
            problems.append(
                f"`{crate}` 由已审计的 {audited} 变为 {found} —— 依赖升级会改变 JNI 面，"
                f"须对照 wry 的 proguard-wry.pro / tauri 的 mobile/proguard-tauri.pro "
                f"重新审计「仅 JNI 可达」方法清单，然后更新 AUDITED_VERSIONS 与 REQUIRED"
            )
    return problems


# --------------------------------------------------------------------------- #


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Android release R8 keep 规则静态守卫")
    ap.add_argument("--proguard", default=str(REPO_ROOT / PROGUARD))
    ap.add_argument("--gradle", default=str(REPO_ROOT / BUILD_GRADLE))
    ap.add_argument("--lock", default=str(REPO_ROOT / CARGO_LOCK))
    args = ap.parse_args(argv[1:])

    groups = [
        ("A. keep 规则覆盖（proguard-rules.pro）", args.proguard, check_proguard_keeps),
        ("B. release 是否引用该规则文件（build.gradle）", args.gradle, check_gradle_wiring),
        ("C. wry/tauri 版本是否仍为已审计版本（Cargo.lock）", args.lock, check_dependency_versions),
    ]

    problems: list[str] = []
    for title, path, fn in groups:
        p = Path(path)
        if not p.is_file():
            print(f"[env] 找不到 {path}", file=sys.stderr)
            return 2
        found = fn(p.read_text(encoding="utf-8", errors="replace"))
        print(f"[{'FAIL' if found else ' OK '}] {title}")
        problems += found

    total = sum(len(v) for v in REQUIRED.values())
    if problems:
        print(f"\n[FAIL] Android release JNI keep 守卫未通过（清单共 {total} 项方法）：")
        for item in problems:
            print(f"  - {item}")
        print(
            "\n[fix] 规则补进 src-tauri/gen/android/app/proguard-rules.pro（user-owned、"
            "始终被引用、不被 tauri CLI 覆盖）。\n"
            f"      生成的 Kotlin 胶水层在 {GENERATED_DIR}/com/spiritpal/desktop_pet/generated/。\n"
            "      改完务必重建 release APK 并跑 scripts/verify_android_jni_keeps.py（DEX 级证明）。"
        )
        return 1

    print(f"\n[OK] 守卫通过：{total} 项「仅 JNI 可达」方法均有 keep 覆盖，"
          f"构建引用与依赖版本（{', '.join(f'{k} {v}' for k, v in AUDITED_VERSIONS.items())}）均未漂移。")
    print("[note] 本守卫只证明「规则在、假设未失效」；证明「APK 里真有这些方法」需 DEX 级校验"
          "（scripts/verify_android_jni_keeps.py，release 包出完必跑）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
