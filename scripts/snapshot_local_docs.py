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
  python scripts/snapshot_local_docs.py snapshot [--force] [--keep N] [--mirror DIR]
  python scripts/snapshot_local_docs.py list [--from DIR]
  python scripts/snapshot_local_docs.py restore [--snapshot TS|latest] [--files a b ...] [--dest DIR] [--from DIR]

异地镜像（跨机落地，尽力而为）：--mirror DIR 把同一份快照额外复制到一个仓库外目录；
优先级 --mirror > 环境变量 SPIRITPAL_SNAPSHOT_MIRROR > git config spiritpal.snapshotMirror；
三者都不设 = 只写本机 backups/，绝不写任何仓库外路径。镜像目标落在仓库工作树内一律
exit 1 拒绝（防本地层文档被 Git 跟踪、变相纳入版本控制）。restore/list 的 --from DIR 从异地副本读取。

退出码：0 = 成功或跳过；1 = 失败（受保护路径全缺 / 快照损坏 / 哈希不符等）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
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
MIRROR_ENV = "SPIRITPAL_SNAPSHOT_MIRROR"         # 异地镜像根（环境变量）
MIRROR_CONFIG_KEY = "spiritpal.snapshotMirror"   # 异地镜像根（git config）


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


def list_snapshots(root: Path | None = None) -> list[Path]:
    base = root if root is not None else SNAPSHOT_ROOT
    if not base.is_dir():
        return []
    return sorted(d for d in base.iterdir() if d.is_dir())


def resolve_mirror(cli_value: str | None) -> Path | None:
    """异地镜像根解析优先级：--mirror > 环境变量 SPIRITPAL_SNAPSHOT_MIRROR
    > git config spiritpal.snapshotMirror。三者都不设返回 None，
    即与旧版逐字节一致（只写本机 backups/，绝不写任何仓库外路径）。"""
    raw = (cli_value or "").strip()
    if not raw:
        raw = os.environ.get(MIRROR_ENV, "").strip()
    if not raw:
        try:
            out = subprocess.run(
                ["git", "-C", str(ROOT), "config", "--get", MIRROR_CONFIG_KEY],
                capture_output=True, text=True, timeout=10,
            )
            if out.returncode == 0:
                raw = out.stdout.strip()
        except Exception:
            raw = ""
    if not raw:
        return None
    return Path(os.path.expanduser(raw)).resolve()


def is_inside_root(path: Path) -> bool:
    """镜像目标是否落在仓库工作树内（等于仓库根或其子目录）。
    Windows 文件系统大小写不敏感，用 os.path.normcase 归一后比对；
    无法解析的路径一律按“不安全”处理（拒绝，防泄露）。"""
    try:
        root = os.path.normcase(str(ROOT.resolve()))
        target = os.path.normcase(str(path.resolve()))
    except OSError:
        return True
    if root == target:
        return True
    try:
        Path(target).relative_to(root)
        return True
    except ValueError:
        return False


def mirror_snapshot(snap: Path, mirror_root: Path) -> Path:
    """把一份本机快照幂等复制到异地镜像根。
    布局与 backups/agents-snapshots/ 相同：<时间戳>/ + 全部子文档 + MANIFEST.json。"""
    dest = mirror_root / snap.name
    if dest.is_dir():
        shutil.rmtree(dest)
    mirror_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(snap, dest)
    return dest


def cmd_snapshot(force: bool, keep: int, mirror: str | None = None) -> int:
    # 先解析并校验异地镜像目标（防泄露铁律）：落在仓库工作树内一律拒绝，绝不写入。
    mirror_root = resolve_mirror(mirror)
    if mirror_root is not None and is_inside_root(mirror_root):
        print(
            f"[FAIL] 拒绝把快照镜像写入仓库工作树内：{mirror_root}",
            file=sys.stderr,
        )
        print(
            "       异地镜像必须是仓库外目录——禁止把本地层文档（AGENTS.md / docs/agents/）"
            "复制进可被 Git 跟踪的区域、变相纳入版本控制。",
            file=sys.stderr,
        )
        return 1

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
            # 「跳过新建」仍幂等补齐异地（覆盖“先配本机、后配异地”或“异地被清空”两种情形）；
            # 本机快照永远优先，异地补齐失败只置 rc=1，不回滚、不影响本机恢复能力。
            if mirror_root is not None:
                try:
                    mirrored = mirror_snapshot(prev, mirror_root)
                    print(f"[OK] 已幂等补齐异地镜像：{mirrored}")
                except Exception as exc:  # noqa: BLE001（尽力而为镜像，失败仅上报）
                    print(f"[WARN] 异地镜像补齐失败（本机快照不受影响）：{exc}", file=sys.stderr)
                    return 1
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

    # 本机快照已落盘，再镜像到异地仓库外目录；失败不回滚本机快照（本机恢复永远优先），但本次 rc=1。
    mirror_failed = False
    if mirror_root is not None:
        try:
            mirrored = mirror_snapshot(snap, mirror_root)
            print(f"[OK] 已镜像到异地目录：{mirrored}")
        except Exception as exc:  # noqa: BLE001（尽力而为镜像，失败仅上报）
            print(f"[WARN] 异地镜像失败（本机快照 {snap.name} 已建好并保留）：{exc}", file=sys.stderr)
            mirror_failed = True

    # 滚动清理只在快照完整时执行：源路径齐全且文件数不比上一份少，
    # 防止半丢失状态的新快照把完好的历史快照挤掉。
    prev_count = len(prev_manifest["files"]) if prev_manifest else -1
    degraded = bool(missing) or (prev_count >= 0 and len(files) < prev_count)
    if degraded:
        print(
            "[WARN] 本次快照不完整（源缺失或文件数缩水），跳过滚动清理以保护历史快照",
            file=sys.stderr,
        )
        return 1 if mirror_failed else 0
    snaps = list_snapshots()
    for old in (snaps[:-keep] if keep >= 1 else []):
        shutil.rmtree(old, ignore_errors=True)
        print(f"[OK] 已清理过期快照 {old.name}（保留最近 {keep} 份）")
    return 1 if mirror_failed else 0


def cmd_restore(snapshot: str, files: list[str], dest: str, src: str | None = None) -> int:
    src_root = Path(src).resolve() if src else None
    snaps = list_snapshots(src_root)
    if not snaps:
        where = src_root if src_root else SNAPSHOT_ROOT
        print(f"[FAIL] 在 {where} 下没有任何快照可恢复（先执行 snapshot 子命令，或用 --from 指定异地镜像目录）")
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


def cmd_list(src: str | None = None) -> int:
    src_root = Path(src).resolve() if src else None
    snaps = list_snapshots(src_root)
    base_disp = str(src_root) if src_root else str(SNAPSHOT_ROOT.relative_to(ROOT))
    if not snaps:
        print(f"（暂无快照；目录：{base_disp}）")
        return 0
    for d in snaps:
        manifest = load_manifest(d)
        detail = f"{len(manifest['files'])} 个文件" if manifest else "MANIFEST 缺失/损坏"
        latest = "  <- 最新" if d is snaps[-1] else ""
        print(f"  {d.name}  {detail}{latest}")
    print(f"共 {len(snaps)} 份快照，位于 {base_disp}")
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
    p_snap.add_argument(
        "--mirror", default=None, metavar="DIR",
        help="额外把同一份快照镜像到一个仓库外目录（跨机异地落地）；落在仓库工作树内一律拒绝。"
             f"未设则与旧版一致只写本机。优先级 --mirror > 环境变量 {MIRROR_ENV} > git config {MIRROR_CONFIG_KEY}",
    )

    p_list = sub.add_parser("list", help="列出全部快照")
    p_list.add_argument("--from", dest="from_dir", default=None, metavar="DIR",
                        help="列出异地镜像目录下的快照（默认本机 backups/agents-snapshots/）")

    p_rest = sub.add_parser("restore", help="从快照恢复文件")
    p_rest.add_argument("--snapshot", default="latest", help="快照时间戳（前缀匹配）或 latest（默认）")
    p_rest.add_argument("--files", nargs="+", default=None, help="要恢复的相对路径（默认全部）")
    p_rest.add_argument("--dest", default=str(ROOT), help="恢复目标目录（默认仓库根；演练请指向临时目录）")
    p_rest.add_argument("--from", dest="from_dir", default=None, metavar="DIR",
                        help="从异地镜像目录恢复（默认从本机 backups/agents-snapshots/）")

    args = ap.parse_args()
    if args.cmd == "snapshot":
        return cmd_snapshot(args.force, args.keep, args.mirror)
    if args.cmd == "list":
        return cmd_list(args.from_dir)
    return cmd_restore(args.snapshot, args.files, args.dest, args.from_dir)


if __name__ == "__main__":
    raise SystemExit(main())
