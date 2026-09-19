#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""snapshot_local_docs.py — 本地层治理文档快照与恢复（AGENTS.md + docs/agents/）。

本地层文件（AGENTS.md + docs/agents/）被 .gitignore 忽略、无版本库保护，
2026-09-17 曾发生目录整体硬删除事故（GOTCHAS #115，6 个子文档只能凭记忆重写）。
本脚本为这两个路径建立项目内最小恢复路径：

  快照：AGENTS.md + docs/agents/ 全部文件 -> backups/agents-snapshots/<时间戳>/
        （backups/ 已被 .gitignore 忽略，不改变两级文档设计）
        每份快照附 MANIFEST.json（逐文件 sha256）；内容无变化时自动跳过。
  恢复：restore 先校验快照自身哈希，再复制到 --dest（默认仓库根，即就地恢复；
        排查演练请显式传 --dest 指向临时目录，勿直接覆盖工作树）。

自动触发：.githooks/pre-commit / post-checkout / post-merge（经 lib-snapshot.sh
调用，尽力而为，失败不阻断 git 操作）。

用法：
  python scripts/snapshot_local_docs.py snapshot [--force] [--keep N]
  python scripts/snapshot_local_docs.py list
  python scripts/snapshot_local_docs.py restore [--snapshot TS|latest] [--files a b ...] [--dest DIR]

退出码：0 = 成功或跳过；1 = 失败（受保护路径全缺 / 快照损坏 / 哈希不符等）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ("AGENTS.md", "docs/agents")          # 受保护的本地层路径
SNAPSHOT_ROOT = ROOT / "backups" / "agents-snapshots"
MANIFEST_NAME = "MANIFEST.json"
DEFAULT_KEEP = 30                                # 滚动保留最近 N 份快照


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def collect_sources() -> list[Path]:
    """收集受保护文件（按相对路径排序，目录递归）。"""
    files: list[Path] = []
    for name in SOURCES:
        p = ROOT / name
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            files.extend(q for q in p.rglob("*") if q.is_file())
    return sorted(set(files), key=lambda p: p.relative_to(ROOT).as_posix())


def git_head() -> str | None:
    """尽力而为记录快照时刻的 HEAD，便于事后把快照与分支状态对上。"""
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() if out.returncode == 0 else None
    except Exception:
        return None


def load_manifest(snap: Path) -> dict | None:
    mf = snap / MANIFEST_NAME
    if not mf.is_file():
        return None
    try:
        return json.loads(mf.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def list_snapshots() -> list[Path]:
    if not SNAPSHOT_ROOT.is_dir():
        return []
    return sorted(d for d in SNAPSHOT_ROOT.iterdir() if d.is_dir())


def cmd_snapshot(force: bool, keep: int) -> int:
    missing = [s for s in SOURCES if not (ROOT / s).exists()]
    files = collect_sources()
    if not files:
        print(
            f"[FAIL] 受保护路径全部不存在（{', '.join(SOURCES)}），疑似误删事故进行中，"
            "不生成空快照。先用 `python scripts/snapshot_local_docs.py list` 查看"
            "历史快照，再 restore 恢复"
        )
        return 1

    state = {p.relative_to(ROOT).as_posix(): sha256_file(p) for p in files}

    snaps = list_snapshots()
    prev = snaps[-1] if snaps else None
    prev_manifest = load_manifest(prev) if prev is not None else None
    if not force and prev_manifest is not None:
        prev_state = {f["path"]: f["sha256"] for f in prev_manifest.get("files", [])}
        if prev_state == state:
            print(f"[OK] 内容与最近快照 {prev.name} 一致，跳过（--force 可强制新建）")
            return 0

    stamp = time.strftime("%Y%m%d-%H%M%S")
    snap = SNAPSHOT_ROOT / stamp
    n = 2
    while snap.exists():                          # 同秒冲突时追加序号
        snap = SNAPSHOT_ROOT / f"{stamp}-{n}"
        n += 1
    snap.mkdir(parents=True)

    for p in files:
        dest = snap / p.relative_to(ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dest)

    manifest = {
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "tool": "scripts/snapshot_local_docs.py",
        "git_head": git_head(),
        "files": [
            {"path": rel, "sha256": dig, "size": (ROOT / rel).stat().st_size}
            for rel, dig in state.items()
        ],
    }
    (snap / MANIFEST_NAME).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    total = sum(f["size"] for f in manifest["files"])
    print(f"[OK] 快照已创建：{snap.relative_to(ROOT)}（{len(files)} 个文件，{total / 1024:.1f} KiB）")

    # 滚动清理只在快照完整时执行：源路径齐全且文件数不比上一份少，
    # 防止半丢失状态的新快照把完好的历史快照挤掉。
    prev_count = len(prev_manifest["files"]) if prev_manifest else -1
    degraded = bool(missing) or (prev_count >= 0 and len(files) < prev_count)
    if degraded:
        print(
            "[WARN] 本次快照不完整（源缺失或文件数缩水），跳过滚动清理以保护历史快照",
            file=sys.stderr,
        )
        return 0
    snaps = list_snapshots()
    for old in (snaps[:-keep] if keep >= 1 else []):
        shutil.rmtree(old, ignore_errors=True)
        print(f"[OK] 已清理过期快照 {old.name}（保留最近 {keep} 份）")
    return 0


def cmd_restore(snapshot: str, files: list[str], dest: str) -> int:
    snaps = list_snapshots()
    if not snaps:
        print("[FAIL] 没有任何快照可恢复（先执行 snapshot 子命令）")
        return 1
    if snapshot == "latest":
        snap = snaps[-1]
    else:
        cands = [d for d in snaps if d.name.startswith(snapshot)]
        if not cands:
            print(f"[FAIL] 未找到快照 {snapshot}（用 list 子命令查看全部快照）")
            return 1
        snap = cands[-1]

    manifest = load_manifest(snap)
    if manifest is None:
        print(f"[FAIL] 快照 {snap.name} 缺少或损坏 {MANIFEST_NAME}")
        return 1
    entries = {f["path"]: f["sha256"] for f in manifest.get("files", [])}
    wanted = files if files else list(entries)
    unknown = [w for w in wanted if w not in entries]
    if unknown:
        print(f"[FAIL] 快照 {snap.name} 中不存在：{', '.join(unknown)}")
        return 1

    dest_root = Path(dest).resolve()
    in_place = dest_root == ROOT.resolve()
    print(f"[INFO] 从快照 {snap.name} 恢复 {len(wanted)} 个文件 -> {dest_root}")
    ok = True
    for rel in wanted:
        src = snap / rel
        dig = entries[rel]
        if not src.is_file() or sha256_file(src) != dig:
            print(f"[FAIL] 快照文件损坏（sha256 校验不过）：{rel}")
            ok = False
            continue
        target = dest_root / rel
        if target.exists() and sha256_file(target) != dig:
            print(f"[WARN] 将覆盖已存在且内容不同的文件：{rel}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        if sha256_file(target) != dig:
            print(f"[FAIL] 恢复后 sha256 不符：{rel}")
            ok = False
            continue
        print(f"[OK] {rel}（sha256 {dig[:16]}...）")
    if not ok:
        return 1
    if in_place:
        print("[OK] 已就地恢复到工作树")
    else:
        print(f"[OK] 恢复完成（目标目录 {dest_root}；确认无误后去掉 --dest 即可就地恢复）")
    return 0


def cmd_list() -> int:
    snaps = list_snapshots()
    if not snaps:
        print(f"（暂无快照；目录：{SNAPSHOT_ROOT.relative_to(ROOT)}）")
        return 0
    for d in snaps:
        manifest = load_manifest(d)
        detail = f"{len(manifest['files'])} 个文件" if manifest else "MANIFEST 缺失/损坏"
        latest = "  <- 最新" if d is snaps[-1] else ""
        print(f"  {d.name}  {detail}{latest}")
    print(f"共 {len(snaps)} 份快照，位于 {SNAPSHOT_ROOT.relative_to(ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="本地层治理文档快照与恢复（AGENTS.md + docs/agents/）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_snap = sub.add_parser("snapshot", help="新建快照（内容无变化时跳过）")
    p_snap.add_argument("--force", action="store_true", help="内容无变化也强制新建")
    p_snap.add_argument(
        "--keep", type=int, default=DEFAULT_KEEP,
        help=f"滚动保留最近 N 份（默认 {DEFAULT_KEEP}；0 = 不清理）",
    )

    sub.add_parser("list", help="列出全部快照")

    p_rest = sub.add_parser("restore", help="从快照恢复文件")
    p_rest.add_argument("--snapshot", default="latest", help="快照时间戳（前缀匹配）或 latest（默认）")
    p_rest.add_argument("--files", nargs="+", default=None, help="要恢复的相对路径（默认全部）")
    p_rest.add_argument("--dest", default=str(ROOT), help="恢复目标目录（默认仓库根；演练请指向临时目录）")

    args = ap.parse_args()
    if args.cmd == "snapshot":
        return cmd_snapshot(args.force, args.keep)
    if args.cmd == "list":
        return cmd_list()
    return cmd_restore(args.snapshot, args.files, args.dest)


if __name__ == "__main__":
    raise SystemExit(main())
