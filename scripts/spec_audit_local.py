#!/usr/bin/env python3
"""Repo-local spec-reference auditor. Same report shape as the family auditor.

Why this exists: scripts/check_spec_refs.py delegates to a family auditor that
lives OUTSIDE the repository, so a clean CI checkout could never run an audit --
the gate degraded to an explicit "UNAVAILABLE" note and CI stayed green without
judging a single path. This script is versioned inside the repository, so CI can
run a real spec-reference audit with no external dependency: exit 0 again means
"an audit executed and passed".

Two tiers, both conservative on purpose:

  A. invocations (judged everywhere, CI included) -- every script path a gate
     actually invokes (.github/workflows/*.yml `run:`, package.json scripts,
     .pre-commit-config.yaml local hooks, .githooks/*) must exist in the
     checkout. A gate pointing at a missing file silently does nothing, which
     is exactly the failure class this auditor exists to catch.

  B. governance prose (judged for whichever docs are present) -- repository
     paths written as inline code in the governance entry point (AGENTS.md) and
     in the tracked governance READMEs must exist, and their relative Markdown
     links must resolve. AGENTS.md is the local layer (gitignored), so on CI
     tier B reports which governance docs it could actually read.

Not judged: narrative/history docs under docs/ (they quote paths as they were at
writing time), build output, node_modules, machine-absolute paths, references
marked （计划，未实现） (AGENTS.md iron law #6), and anything .gitignore matches.

Exit codes: 0 = audit ran, nothing hard found; 1 = audit ran and failed.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# Path mentions anchored at one of these prefixes are versioned content, so a
# miss there is a real defect, not a local-machine detail.
ASSERTIVE_PREFIXES = (
    "scripts/", ".github/", ".githooks/", "src/", "src-tauri/", "docs/",
    "tests/", "perf/", "public/", "references/", "character-packs/", "demo/",
    "local/",
)

# Tier B: governance docs whose prose is a declaration of fact.
GOVERNANCE_DOCS = (
    "AGENTS.md", "README.md", ".github/SECURITY.md",
    ".github/PULL_REQUEST_TEMPLATE.md", ".githooks/README.md",
    # 2026-10-17 扩集（Better Harness finding local-governance-layer-refs-dangling / P3）：
    # 公开层典型 AI 开发 SOP 内联代码里写的仓库路径同样是「事实声明」，此前从不被审计，
    # 结果 5 条 phantom（src-tauri/src/types.rs、commands/pet.rs、src/stores/achievementStore.ts 等）
    # 长期无人点名。扩集前已按「源码核实」惯例把它们补正到位。
    "docs/project/AI_DEV_SOPS.md",
)

# Tier A extraction: only lines that really execute something. Without the
# interpreter keyword we would harvest artifact paths (`path: perf/results/…json`)
# and prose as if they were invocations.
EXECUTE_KEYWORD_RE = re.compile(
    r"(?:^|[\s\"';&|(])(?:python3?|node|deno|bash|sh|zsh|pwsh|powershell|npx|pnpm|npm|make)\b")
SCRIPT_FILE_RE = (
    r"(?:scripts|perf|tests|\.github/scripts)/[A-Za-z0-9_./@\-]+"
    r"\.(?:py|mjs|cjs|js|ts|sh|ps1|bat)(?![\w])")
INVOKED_PATH_RE = re.compile(r"(?P<path>" + SCRIPT_FILE_RE + r")")
HOOK_ENTRY_RE = re.compile(r"^\s*entry:\s*(?P<cmd>.+)$")

CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
LINK_RE = re.compile(r"(?<!!)\[[^\]\n]*\]\(\s*(?P<target>[^)\s#]+)")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
NOISE_RE = re.compile(r"[<>*?{}$()=|,;\uff0c\u3001]")
PLANNED_MARKERS = ("（计划，未实现）", "(计划，未实现)", "（计划,未实现）")

SKIP_DIR_NAMES = {
    ".git", "node_modules", "dist", "build", "coverage", "artifacts", "backups",
    "target", "__pycache__", ".pytest_cache", ".benchmarks", "playwright-report",
    "test-results", ".qoder", ".trae", ".workbuddy", ".workbuddy-ai", ".idea",
    "lcov-report",
}

# Declared-absent references: path -> why a governance doc may still name it.
KNOWN_ABSENT = {
    "docs/official_spec.md": "AGENTS.md 0 names it as optional and absent in this repo",
}


def rel_posix(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.name


def normalize_token(token: str) -> str:
    token = token.strip().strip("`").strip("'\"")
    token = token.replace("\\", "/")
    token = token.split("#")[0].split("?")[0]
    token = re.sub(r":\d+(?:-\d+)?$", "", token)
    if token.startswith("./"):
        token = token[2:]
    return token.strip().rstrip(".,;:" + "，。；：、）】}")


def path_like(token: str) -> bool:
    if not token or " " in token or "/" not in token:
        return False
    if NOISE_RE.search(token):
        return False
    if token.startswith(("/", "~", "http:", "https:", "mailto:", "tel:", "data:")):
        return False
    if ".." in token.split("/") or "::" in token:
        return False
    return token.startswith(ASSERTIVE_PREFIXES)


def iter_files(root: Path, base: str):
    """Yield auditable files under a repo-relative dir (or a single file)."""
    target = root / base
    if target.is_file():
        yield target
        return
    if not target.is_dir():
        return
    for path in sorted(target.rglob("*")):
        if not path.is_file() or any(part in SKIP_DIR_NAMES for part in path.parts):
            continue
        yield path


def git_ignored(root: Path, paths):
    """Bulk-ask git which paths match .gitignore. Stay bytes: on Windows a text
    mode run turns \\n into \\r\\n and git then matches nothing."""
    unique = sorted({p for p in paths if p})
    if not unique:
        return set()
    try:
        proc = subprocess.run(["git", "check-ignore", "--stdin"], cwd=str(root),
                              input="\n".join(unique).encode("utf-8"),
                              capture_output=True)
    except OSError:
        return set()
    return {line for line in proc.stdout.decode("utf-8", "replace").splitlines() if line}


class Claim:
    __slots__ = ("path", "loc", "channel", "link")

    def __init__(self, path, loc, channel, link=None):
        self.path = path
        self.loc = loc
        self.channel = channel  # phantom | dead_link
        self.link = link


def collect_invocation_claims(root: Path) -> list[Claim]:
    """Tier A: script paths that CI / hooks / npm scripts really execute."""
    sources: list[Path] = []
    for base in (".github/workflows", ".githooks"):
        sources.extend(iter_files(root, base))
    for extra in (".pre-commit-config.yaml", "package.json"):
        p = root / extra
        if p.is_file():
            sources.append(p)

    claims: list[Claim] = []
    for src in sources:
        src_rel = rel_posix(root, src)
        try:
            text = src.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if src_rel == ".pre-commit-config.yaml":
            for lineno, line in enumerate(text.splitlines(), 1):
                m = HOOK_ENTRY_RE.match(line)
                if not m:
                    continue
                for hit in INVOKED_PATH_RE.finditer(m.group("cmd")):
                    claims.append(Claim(hit.group("path"), f"{src_rel}:{lineno}", "phantom"))
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            if not EXECUTE_KEYWORD_RE.search(line):
                continue
            for hit in INVOKED_PATH_RE.finditer(line):
                claims.append(Claim(hit.group("path"), f"{src_rel}:{lineno}", "phantom"))
    return claims


def collect_governance_claims(root: Path, doc_names) -> tuple[list[Claim], list[str]]:
    """Tier B: path mentions and relative links inside governance prose."""
    claims: list[Claim] = []
    audited: list[str] = []
    for name in doc_names:
        doc = root / name
        if not doc.is_file():
            continue
        audited.append(name)
        doc_rel = rel_posix(root, doc)
        try:
            text = doc.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        in_fence = False
        for lineno, line in enumerate(text.splitlines(), start=1):
            if FENCE_RE.match(line):
                in_fence = not in_fence
                continue
            if in_fence or any(mk in line for mk in PLANNED_MARKERS):
                continue
            for span in CODE_SPAN_RE.findall(line):
                for piece in re.split(r"[,;、]| or | 或 ", span):
                    token = normalize_token(piece)
                    if not path_like(token):
                        continue
                    claims.append(Claim(token, f"{doc_rel}:{lineno}", "phantom"))
            for m in LINK_RE.finditer(line):
                target = normalize_token(m.group("target"))
                if not target or target.startswith(("http", "mailto:", "tel:", "javascript:")):
                    continue
                resolved = (doc.parent / target) if not target.startswith(ASSERTIVE_PREFIXES) \
                    else (root / target)
                claims.append(Claim(rel_posix(root, resolved), f"{doc_rel}:{lineno}",
                                    "dead_link", link=target))
    return claims, audited


def audit(root: Path, project: str) -> dict:
    doc_names = list(GOVERNANCE_DOCS)
    claims = collect_invocation_claims(root)
    gov_claims, audited = collect_governance_claims(root, doc_names)
    claims.extend(gov_claims)

    ignored = git_ignored(root, [c.path for c in claims])
    phantoms: dict[str, list[str]] = {}
    dead_links: list[dict] = []
    untracked: dict[str, list[str]] = {}
    # 引用来源自身的跟踪状态：本地层文件引用兄弟本地层文件属设计内行为，不计入台账。
    ignored_specs = git_ignored(root, sorted({c.loc.rpartition(":")[0] for c in claims}))
    checked = 0
    for claim in claims:
        checked += 1
        if claim.path in KNOWN_ABSENT:
            continue
        if claim.path in ignored:
            # 被 .gitignore 命中的路径不按幻影判：本地层不入库是有意设计
            # （见 snapshot_local_docs.py 的镜像拒绝逻辑）。但 check-ignore 只匹配
            # 模式、不看文件是否存在，所以「已跟踪文档要求去动一个不随仓库分发的
            # 文件」这类引用过去被整条静默减掉，门禁对它永远无信号。这里不判失败，
            # 只把它记成可见台账。
            if claim.loc.rpartition(":")[0] not in ignored_specs:
                bucket = untracked.setdefault(claim.path, [])
                if claim.loc not in bucket:
                    bucket.append(claim.loc)
            continue
        if (root / claim.path).exists():
            continue
        if claim.channel == "dead_link":
            spec, _, line_no = claim.loc.rpartition(":")
            dead_links.append({"spec": spec, "line": int(line_no), "link": claim.link})
            continue
        bucket = phantoms.setdefault(claim.path, [])
        if claim.loc not in bucket:
            bucket.append(claim.loc)

    findings = [{"status": "PHANTOM", "tier": "ASSERTIVE", "ref": ref,
                 "specs": sorted(set(locs))} for ref, locs in sorted(phantoms.items())]
    bad_workflow = sorted(ref for ref in phantoms if ref.startswith(".github/workflows/"))
    bad_hooks = sorted(ref for ref, locs in phantoms.items()
                       if any(loc.startswith(".pre-commit-config.yaml") for loc in locs))
    return {
        "project": project,
        "auditor": "repo-local",
        "governance_docs_audited": audited,
        "governance_docs_absent": [n for n in doc_names if n not in audited],
        "claims_checked": checked,
        "findings": findings,
        "dead_links": dead_links,
        "untracked_refs": [{"ref": ref, "specs": sorted(set(locs))}
                           for ref, locs in sorted(untracked.items())],
        "workflows": {"missing": bad_workflow},
        "precommit": {"declared_not_configured": bad_hooks},
    }


def render_md(report: dict) -> str:
    out = [f"# Spec-reference audit (repo-local) - {report['project']}", "",
           f"- claims checked: {report['claims_checked']}",
           f"- PHANTOM path references: {len(report['findings'])}",
           f"- dead links: {len(report['dead_links'])}",
           f"- missing local-hook targets: {len(report['precommit']['declared_not_configured'])}",
           f"- governance docs audited: {', '.join(report['governance_docs_audited']) or 'none'}",
           f"- governance docs absent in this checkout: "
           f"{', '.join(report['governance_docs_absent']) or 'none'}", ""]
    for f in report["findings"]:
        out.append(f"- `{f['ref']}` referenced by {', '.join(f['specs'])}")
    for d in report["dead_links"]:
        out.append(f"- dead link {d['spec']}:{d['line']} -> {d['link']}")
    return "\n".join(out) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--project", default=REPO_ROOT.name)
    ap.add_argument("--root", default=str(REPO_ROOT))
    ap.add_argument("--json", metavar="PATH")
    ap.add_argument("--md", metavar="PATH")
    ap.add_argument("--list", action="store_true",
                    help="print every hit (the wrapper prints them, so hits stay "
                         "quiet here by default and never get doubled)")
    ap.add_argument("--auditor-name", default="repo-local",
                    help="label recorded in the report (the wrapper tags it)")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    report = audit(root, args.project)
    report["auditor"] = args.auditor_name
    if args.json:
        Path(args.json).write_text(json.dumps([report], ensure_ascii=False, indent=2),
                                   encoding="utf-8")
    if args.md:
        Path(args.md).write_text(render_md(report), encoding="utf-8")

    hard = bool(report["findings"] or report["dead_links"]
                or report["workflows"]["missing"]
                or report["precommit"]["declared_not_configured"])
    if args.list:
        for f in report["findings"]:
            print(f"  PHANTOM {f['ref']}  in {', '.join(f['specs'])}")
        for d in report["dead_links"]:
            print(f"  DEAD    {d['spec']}:{d['line']} -> {d['link']}")
        for h in report["precommit"]["declared_not_configured"]:
            print(f"  HOOK    {h}")
        for u in report["untracked_refs"]:
            print(f"  UNTRACKED {u['ref']}  in {', '.join(u['specs'])}")
    print(f"[spec-audit-local] status={'FAIL' if hard else 'PASS'} "
          f"claims={report['claims_checked']} phantom={len(report['findings'])} "
          f"dead_links={len(report['dead_links'])} "
          f"bad_workflow={len(report['workflows']['missing'])} "
          f"bad_hook={len(report['precommit']['declared_not_configured'])} "
          f"untracked_refs={len(report['untracked_refs'])} "
          f"docs={len(report['governance_docs_audited'])} "
          f"absent={','.join(report['governance_docs_absent']) or '-'}")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
