"""security_gate.py 基线读取路径的最小冒烟测试。

背景：SECURITY_MATRIX.md 把 `scripts/security_gate.py` 的棘轮基线列为依赖漏洞
门禁，但 `load_baseline()`（"基线能否读到、结构是否合法"这条判定路径）此前
无任何测试触达——基线文件被误删、键名被改、JSON 被写坏时只能等到 CI 跑到门禁
才发现。本文件补最基础的冒烟覆盖：真实基线可读、返回三项受门禁指标、且缺失时
判失败（绝不"首次自动放行"）。

security_gate.load_baseline() 用相对路径 `.ci/security_baseline.json`（依 CWD
解析），故测试显式对齐工作目录语义，保证与 CI 实际运行方式一致且可重复。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = PROJECT_ROOT / ".ci" / "security_baseline.json"
GATE_SCRIPT = PROJECT_ROOT / "scripts" / "security_gate.py"


def _load_security_gate():
    """按文件路径加载独立脚本 security_gate.py（scripts/ 非包，无 __init__.py）。"""
    spec = importlib.util.spec_from_file_location("security_gate", str(GATE_SCRIPT))
    assert spec and spec.loader, f"无法加载门禁脚本: {GATE_SCRIPT}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_baseline_file_present():
    """门禁赖以判定的基线文件必须真实存在于仓库中。"""
    assert BASELINE_PATH.exists(), f"缺少基线文件 {BASELINE_PATH}"


def test_load_baseline_reads_gated_metrics(monkeypatch):
    """load_baseline() 从仓库根读取真实基线，返回三项受门禁指标的整数值。"""
    module = _load_security_gate()
    monkeypatch.chdir(PROJECT_ROOT)  # 对齐 BASELINE_PATH 的相对路径语义

    baseline = module.load_baseline()

    assert isinstance(baseline, dict), "基线应为 JSON 对象"
    assert set(baseline.keys()) == set(module.GATED_METRICS), (
        f"基线键应恰为受门禁指标 {module.GATED_METRICS}，实得 {sorted(baseline)}"
    )
    for metric in module.GATED_METRICS:
        assert isinstance(baseline[metric], int), f"{metric} 应为整数，实得 {baseline[metric]!r}"


def test_load_baseline_rejects_missing_baseline(tmp_path, monkeypatch):
    """基线缺失时门禁必须判失败（SystemExit(1)），不得 fail-open 首次放行。"""
    module = _load_security_gate()
    monkeypatch.chdir(tmp_path)  # 空的临时目录：.ci/security_baseline.json 不存在

    with pytest.raises(SystemExit) as excinfo:
        module.load_baseline()

    assert excinfo.value.code == 1, "基线缺失应退出码 1（拒绝放行），实得非失败"
