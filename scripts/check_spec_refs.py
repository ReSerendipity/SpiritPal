#!/usr/bin/env python3
"""Thin wrapper -> family auditor, with a repo-local fallback. Exit codes are a status contract.

The deep audit lives OUTSIDE this repo (a sibling `.spec_audit` directory next to
the checkout root). It is authoritative on a developer machine; a fresh CI
checkout cannot run it. To keep the gate real instead of decorative, the wrapper
falls back to scripts/spec_audit_local.py -- a versioned, dependency-free auditor
that judges the paths a clean checkout can actually see (gate invocations +
governance docs). "exit 0" may only ever mean "an audit really ran and passed":

  0  an audit RAN (family if available, else repo-local), no phantom refs /
     dead links / stale hooks or workflows
  1  the audit RAN and failed, or its report could not be evaluated
  2  NO audit ran -- neither the family auditor nor the repo-local fallback
     exists (never reported as a pass)

CI therefore calls this WITHOUT --allow-unavailable: green means judged.
--allow-unavailable stays for callers that must not block on a missing auditor.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
FAMILY_AUDITORS = [
    HERE / ".spec_audit" / "audit_spec_refs.py",
    HERE.parent / ".spec_audit" / "audit_spec_refs.py",
]
LOCAL_FALLBACK = HERE / "scripts" / "spec_audit_local.py"
EXIT_PASS = 0
EXIT_FAIL = 1
EXIT_UNAVAILABLE = 2


def resolve_auditor(explicit, family_only=False):
    """Return (auditor path or None, searched paths, auditor kind)."""
    if explicit:
        path = Path(explicit).expanduser()
        return (path if path.is_file() else None), [path], "explicit"
    searched = list(FAMILY_AUDITORS)
    if not family_only:
        searched = searched + [LOCAL_FALLBACK]
    found = next((p for p in FAMILY_AUDITORS if p.is_file()), None)
    if found is not None:
        return found, searched, "family"
    if not family_only and LOCAL_FALLBACK.is_file():
        return LOCAL_FALLBACK, searched, "repo-local"
    return None, searched, None


def report_unavailable(searched, allow_unavailable):
    msg = ("[spec-refs] status=UNAVAILABLE - no auditor found (neither the "
           "family auditor nor the repo-local fallback); spec-reference check "
           "NOT executed. Searched: "
           + "; ".join(str(p) for p in searched))
    print(msg, file=sys.stderr)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::warning::{msg}")
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            try:
                with open(summary, "a", encoding="utf-8") as fh:
                    fh.write("- `[spec-refs]` UNAVAILABLE - check NOT executed "
                             "(not a pass).\n")
            except OSError:
                pass
    return EXIT_PASS if allow_unavailable else EXIT_UNAVAILABLE


def run_auditor(auditor, kind):
    with tempfile.TemporaryDirectory(prefix="spec_audit_") as td:
        out = Path(td) / "current.json"
        out_md = Path(td) / "current.md"
        proc = subprocess.run([sys.executable, str(auditor), "--project", HERE.name,
                               "--json", str(out), "--md", str(out_md)])
        if not out.is_file():
            print(f"[spec-refs] status=ERROR - auditor exited rc={proc.returncode} "
                  "without a report; cannot evaluate.", file=sys.stderr)
            return EXIT_FAIL
        try:
            data = json.loads(out.read_text(encoding="utf-8"))[0]
        except (OSError, ValueError, IndexError) as exc:
            print(f"[spec-refs] status=ERROR - unreadable audit report: {exc}",
                  file=sys.stderr)
            return EXIT_FAIL

    hard = [f for f in data["findings"] if f["status"] == "PHANTOM" and f["tier"] == "ASSERTIVE"]
    dl = data["dead_links"]
    wf = data["workflows"]["missing"]
    pc = data["precommit"]["declared_not_configured"]
    bad = bool(hard or dl or wf or pc)
    print(f"[spec-refs] status={'FAIL' if bad else 'PASS'} auditor={kind} "
          f"phantom={len(hard)} "
          f"dead_links={len(dl)} bad_workflow={len(wf)} bad_hook={len(pc)}")
    if bad and os.environ.get("GITHUB_ACTIONS") == "true":
        print("::error::[spec-refs] audit FAILED - see PHANTOM/DEAD details in the log")
    for x in hard:
        print(f"  PHANTOM {x['ref']}  in {', '.join(x['specs'])}")
    for d in dl:
        print(f"  DEAD    {d['spec']}:{d['line']} -> {d['link']}")
    return EXIT_FAIL if bad else EXIT_PASS


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Spec-reference audit wrapper (status contract in docstring).")
    ap.add_argument("--auditor", metavar="PATH", default=None,
                    help="explicit auditor script path (default: family auditor in "
                         "the repo or its parent, else scripts/spec_audit_local.py)")
    ap.add_argument("--family-only", action="store_true",
                    help="skip the repo-local fallback and only accept the family "
                         "auditor (reproduces the historical UNAVAILABLE state)")
    ap.add_argument("--allow-unavailable", action="store_true",
                    help="exit 0 when no auditor is available; the explicit "
                         "UNAVAILABLE status / CI warning annotation is kept")
    args = ap.parse_args(argv)
    auditor, searched, kind = resolve_auditor(args.auditor, args.family_only)
    if auditor is None:
        return report_unavailable(searched, args.allow_unavailable)
    return run_auditor(auditor, kind)


if __name__ == "__main__":
    sys.exit(main())
