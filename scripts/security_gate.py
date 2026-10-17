#!/usr/bin/env python3
"""依赖安全基线门禁（棘轮：只降不升）。

背景
----
dependency-vuln-scan job 每次 push / PR 都会运行，但三个审计步骤分别是
`pnpm audit ... || true`、`cargo audit || true`、osv-scanner `continue-on-error: true`，
因此无论扫出多少漏洞，commit 状态永远是绿的——结果只进 artifact，没人看。

本脚本把"报告生成"与"门禁判定"分离：
  * 报告步骤照旧生成 JSON（允许审计工具自身非零退出）
  * 本脚本读取报告并与 `.ci/security_baseline.json` 比对：
      - 任一指标高于基线 → 失败（exit 1）
      - 低于基线 → 通过并提示回写基线（棘轮自动收紧）
      - 基线缺失或报告结构异常 → 失败，绝不"首次自动放行"

当前基线说明（.ci/security_baseline.json）
------------------------------------
npm_critical=0 / npm_high=0：历史高点（gh-pages 经 pixi-live2d-display 引入、
protobufjs）已由上游修复，2026-09-20 按棘轮约定回写收紧到实测值 0。
cargo_vulns=7（2026-10-17 人工复核后回写；原值 1）：
  RustSec 库于 2026-10-17 新增 3 条 zip 提取类公告（RUSTSEC-2026-0367/0368/0369，
  均只作用于 `ZipArchive::extract()`），同时命中树内两个 zip 版本
  （0.6.6 直接依赖 / 4.6.1 经 tauri-plugin-updater），叠加原有的 rkyv 幻影条目 = 7 条。
  **七条的 patched_versions 全为空** —— 上游尚无修复版，升依赖修不掉
  （zip 0.6 升到 4.x 后仍剩 3 条），故只能回写基线。逐条复核结论：

  * RUSTSEC-2026-0235 / rkyv 0.7.46 —— **幻影条目，不进构建图、不编译**：
      cargo tree -i rkyv            # 无输出（rust_decimal 的 rkyv feature 未启用）
    Cargo.lock 记录可选依赖、cargo-audit 逐行扫 lockfile，属度量口径差异；
  * RUSTSEC-2026-0367/0368/0369 / zip 0.6.6 —— **本仓不可达**：
    三条的共同前提是调用 `ZipArchive::extract()`（SUID/SGID 保留、符号链接逃逸、
    经符号链接写权限）。而 `src/petmod.rs::extract_zip_to()` 是手写逐条目解压 ——
    `enclosed_name()` 挡 zip-slip，`File::create` + `io::copy` 写普通文件，
    **从不调用 extract()、不设 Unix 权限、不创建符号链接**；
  * 同三条 / zip 4.6.1 —— 传递依赖（tauri-plugin-updater），走上游代码路径；
    更新包需本仓私钥签名后才下发，攻击面限于已签名包。

  结论：这是「上游无补丁 + 本仓不可达」的组合，**不是**「接受了 7 个可利用漏洞」。
  上游发布修复版后必须立刻升级，并把基线降回实测值（棘轮只降不升的方向不变）。
基线入库后，**新增**任何高危漏洞都会让 CI 变红。

用法
----
    python scripts/security_gate.py                    # 校验模式（CI 用）
    python scripts/security_gate.py --update-baseline  # 回写基线（人工确认后用）
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

BASELINE_PATH = os.path.join(".ci", "security_baseline.json")
PNPM_REPORT = "pnpm-audit.json"
CARGO_REPORT = "cargo-audit.json"

# 只有这三项参与门禁；moderate/low 与 cargo 的 unmaintained 警告仅打印。
GATED_METRICS = ("npm_critical", "npm_high", "cargo_vulns")


def _load_json(path: str) -> Any | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        print(f"[FAIL] 无法解析 {path}: {exc}")
        print("       报告损坏等同于门禁失明，拒绝放行。")
        sys.exit(1)


def count_pnpm(report: Any | None) -> dict[str, int]:
    """统计 pnpm audit 各级别漏洞数。

    pnpm 10 的 JSON 中 `vulnerabilities` 扁平映射常为空，权威计数在
    `metadata.vulnerabilities`。两种都兼容。
    """
    if report is None:
        print(f"[FAIL] 缺少 {PNPM_REPORT} —— pnpm audit 未成功生成报告，门禁拒绝放行。")
        sys.exit(1)

    counts = {"critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0}

    meta = (report.get("metadata") or {}).get("vulnerabilities")
    if isinstance(meta, dict):
        for key in counts:
            counts[key] = int(meta.get(key, 0) or 0)
        return counts

    flat = report.get("vulnerabilities") or {}
    if isinstance(flat, dict):
        for item in flat.values():
            if isinstance(item, dict):
                sev = (item.get("severity") or "").lower()
                if sev in counts:
                    counts[sev] += 1
        return counts

    print(f"[FAIL] {PNPM_REPORT} 结构异常（既无 metadata.vulnerabilities 也无 vulnerabilities）。")
    print("       pnpm audit 很可能执行失败（常见于镜像源不支持 audit 端点），")
    print("       漏洞数不可信，门禁拒绝放行。")
    sys.exit(1)


def count_cargo(report: Any | None) -> tuple[int, int]:
    """返回 (漏洞数, 警告数)。"""
    if report is None:
        print(f"[FAIL] 缺少 {CARGO_REPORT} —— cargo audit 未成功生成报告，门禁拒绝放行。")
        sys.exit(1)

    vulns = report.get("vulnerabilities")
    if not isinstance(vulns, dict):
        print(f"[FAIL] {CARGO_REPORT} 结构异常（缺少 vulnerabilities 字段）。")
        print("       cargo audit 很可能执行失败，漏洞数不可信，门禁拒绝放行。")
        sys.exit(1)

    if isinstance(vulns.get("list"), list):
        vcount = len(vulns["list"])
    else:
        vcount = int(vulns.get("count", 0) or 0)

    warns = report.get("warnings") or {}
    if isinstance(warns.get("list"), list):
        wcount = len(warns["list"])
    else:
        wcount = int(warns.get("count", 0) or 0)
    return vcount, wcount


def load_baseline() -> dict[str, int]:
    if not os.path.exists(BASELINE_PATH):
        print(f"[FAIL] 缺少基线文件 {BASELINE_PATH}。")
        print("       基线必须人工确认后入库，本门禁不做首次自动放行（否则仍是假绿）。")
        print("       生成方式：python scripts/security_gate.py --update-baseline")
        sys.exit(1)
    data = _load_json(BASELINE_PATH)
    if not isinstance(data, dict):
        print(f"[FAIL] 基线文件 {BASELINE_PATH} 格式非法（应为 JSON 对象）。")
        sys.exit(1)
    return {k: int(data.get(k, 0) or 0) for k in GATED_METRICS}


def main() -> int:
    parser = argparse.ArgumentParser(description="依赖安全基线门禁")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="用当前扫描结果回写 .ci/security_baseline.json",
    )
    args = parser.parse_args()

    pnpm_counts = count_pnpm(_load_json(PNPM_REPORT))
    cargo_vulns, cargo_warns = count_cargo(_load_json(CARGO_REPORT))

    current = {
        "npm_critical": pnpm_counts["critical"],
        "npm_high": pnpm_counts["high"],
        "cargo_vulns": cargo_vulns,
    }

    print("=== 依赖安全扫描结果 ===")
    print(
        "  pnpm audit : "
        f"critical={pnpm_counts['critical']} high={pnpm_counts['high']} "
        f"moderate={pnpm_counts['moderate']} low={pnpm_counts['low']}"
    )
    print(f"  cargo audit: vulnerabilities={cargo_vulns} warnings={cargo_warns}")

    if args.update_baseline:
        os.makedirs(os.path.dirname(BASELINE_PATH) or ".", exist_ok=True)
        with open(BASELINE_PATH, "w", encoding="utf-8") as fh:
            json.dump(current, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"[OK] 基线已回写 {BASELINE_PATH}: {current}")
        return 0

    baseline = load_baseline()
    print(f"=== 基线 {BASELINE_PATH}: {baseline} ===")

    regressions, improvements = [], []
    for metric in GATED_METRICS:
        now, base = current[metric], baseline[metric]
        if now > base:
            regressions.append(f"{metric}: {base} -> {now} (+{now - base})")
        elif now < base:
            improvements.append(f"{metric}: {base} -> {now} (-{base - now})")

    if regressions:
        print("[FAIL] 依赖安全债务上升，棘轮门禁拒绝放行：")
        for item in regressions:
            print(f"      - {item}")
        print("      若确为可接受风险，请人工复核后回写基线：")
        print("          python scripts/security_gate.py --update-baseline")
        return 1

    if improvements:
        print("[PASS] 安全债务下降，建议回写基线以收紧棘轮：")
        for item in improvements:
            print(f"      - {item}")
        print("          python scripts/security_gate.py --update-baseline")

    print("[PASS] 依赖安全基线门禁通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
