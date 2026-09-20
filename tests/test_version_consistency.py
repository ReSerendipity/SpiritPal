"""版本一致性基础测试（家族简化版）

验证：
- 版本号符合 SemVer 格式（x.y.z）
- 不存在硬编码的旧版本号（0.1.0 / 0.0.1 等）
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _find_version_file():
    """查找版本权威源文件"""
    candidates = [
        "package.json",
        "pyproject.toml",
        "version.json",
        "gradle.properties",
    ]
    for c in candidates:
        if (PROJECT_ROOT / c).exists():
            return c
    return None


def test_version_file_exists():
    assert _find_version_file() is not None, "未找到版本权威源文件"


def test_version_is_semver():
    vfile = _find_version_file()
    assert vfile, "未找到版本文件"

    content = (PROJECT_ROOT / vfile).read_text(encoding="utf-8", errors="ignore")

    # package.json
    if vfile == "package.json":
        data = json.loads(content)
        version = data.get("version", "")
    # pyproject.toml
    elif vfile == "pyproject.toml":
        m = re.search(r'version\s*=\s*["\']([^"\']+)["\']', content)
        version = m.group(1) if m else ""
    # version.json
    elif vfile == "version.json":
        data = json.loads(content)
        version = data.get("version", "")
    # gradle.properties
    elif vfile == "gradle.properties":
        m = re.search(r'versionName\s*=\s*([^\n]+)', content)
        version = m.group(1).strip() if m else ""
    else:
        version = ""

    assert re.fullmatch(r"\d+\.\d+\.\d+", version), f"版本号不符合 SemVer: {version}"


def test_no_hardcoded_old_version():
    """代码中不应硬编码 0.1.0 / 0.0.1 等占位版本号"""
    old_patterns = [r'version\s*=\s*["\']0\.1\.0["\']', r'version\s*=\s*["\']0\.0\.1["\']']

    offenders = []
    for pyfile in PROJECT_ROOT.rglob("*.py"):
        if any(skip in str(pyfile) for skip in [".venv", "__pycache__", "node_modules"]):
            continue
        try:
            content = pyfile.read_text(encoding="utf-8", errors="ignore")
            for pat in old_patterns:
                if re.search(pat, content):
                    offenders.append(str(pyfile.relative_to(PROJECT_ROOT)))
                    break
        except:
            pass

    assert offenders == [], f"发现硬编码旧版本号: {offenders}"
