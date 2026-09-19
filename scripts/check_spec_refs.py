#!/usr/bin/env python3
"""Thin wrapper -> shared family auditor. Exit codes are a status contract.

The auditor lives OUTSIDE this repo (a sibling `.spec_audit` directory next to
the checkout root). It is authoritative on a developer machine; a fresh CI
checkout cannot run it at all. "exit 0" may only ever mean "the audit really
ran and passed" -- an unrun audit is never reported as a pass:

  0  audit RAN, no phantom refs / dead links / stale hooks or workflows
  1  audit RAN and failed, or its report could not be evaluated
  2  audit DID NOT RUN -- family auditor unavailable (never reported as a pass)

CI callers opt into a warning-annotated skip with --allow-unavailable.
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
DEFAULT_AUDITORS = [
    HERE / ".spec_audit" / "audit_spec_refs.py",
    HERE.parent / ".spec_audit" / "audit_spec_refs.py",
]
EXIT_PASS = 0
EXIT_FAIL = 1
EXIT_UNAVAILABLE = 2


def resolve_auditor(explicit):
    """Return (auditor path or None, searched paths for the status message)."""
    if explicit:
        path = Path(explicit).expanduser()
        return (path if path.is_file() else None), [path]
    found = next((p for p in DEFAULT_AUDITORS if p.is_file()), None)
    return found, DEFAULT_AUDITORS


def report_unavailable(searched, allow_unavailable):
    msg = ("[spec-refs] status=UNAVAILABLE - family auditor not found; "
           "spec-reference check NOT executed. Searched: "
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


def run_auditor(auditor):
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
    print(f"[spec-refs] status={'FAIL' if bad else 'PASS'} phantom={len(hard)} "
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
                    help="explicit auditor script path (default: repo-local or "
                         "sibling .spec_audit/audit_spec_refs.py)")
    ap.add_argument("--allow-unavailable", action="store_true",
                    help="exit 0 when the auditor is unavailable; the explicit "
                         "UNAVAILABLE status / CI warning annotation is kept")
    args = ap.parse_args(argv)
    auditor, searched = resolve_auditor(args.auditor)
    if auditor is None:
        return report_unavailable(searched, args.allow_unavailable)
    return run_auditor(auditor)


if __name__ == "__main__":
    sys.exit(main())
