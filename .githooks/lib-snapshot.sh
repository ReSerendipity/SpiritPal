#!/bin/sh
# 本地层治理文档快照（AGENTS.md + docs/agents/ -> backups/agents-snapshots/）。
# 尽力而为：任何失败只提示、不阻断 git 操作；找不到 Python 时静默跳过。
# 用法：. lib-snapshot.sh; snapshot_docs
snapshot_docs() {
    [ -f scripts/snapshot_local_docs.py ] || return 0
    _snap_py=""
    for c in python python3; do
        command -v "$c" >/dev/null 2>&1 && _snap_py="$c" && break
    done
    [ -n "$_snap_py" ] || return 0
    if ! "$_snap_py" scripts/snapshot_local_docs.py snapshot >/dev/null; then
        echo "[snapshot] WARN: 本地层文档快照异常（不影响本次 git 操作；排查：python scripts/snapshot_local_docs.py snapshot）" >&2
    fi
    return 0
}
