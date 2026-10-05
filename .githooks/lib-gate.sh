#!/bin/sh
# 门禁留痕 / 全链凭据 共用函数（被 pre-commit / prepare-commit-msg / post-commit `.` 引入）。
# 尽力而为：任何失败只提示、绝不阻断 git 操作 —— 与 lib-snapshot.sh 同语义。
#
# 为什么需要（2026-10-06）：受限执行沙箱里单个 hook（capability-lint）可能超时/被击杀。
# 历史处置是 `git commit --no-verify` **整链**绕过，连带把合并冲突守卫与其余 hook 一起关掉
# （见 docs/agent-review-handoff-2026-10-05.md §5.1）。本库把「绕过」降级成「可审计的例外」：
#   - gate_attest      pre-commit 通过时对 index tree 落一份凭据（.git/spiritpal-gate-attest）
#   - gate_check_chain post-commit 核对凭据 —— --no-verify 只跳过 pre-commit 与 commit-msg，
#                      **不跳过 post-***，所以整链绕过必然留痕（gate-bypass suspected:）
#   - gate_record_skip 任何单项跳过（含人工批准的 SKIP=<hook-id>）追加一行机械留痕
# 所有文件都落在 `git rev-parse --git-path` 下（本地 .git/，不进版本库、不污染工作树）。

GATE_SKIP_LOG_NAME="spiritpal-gate-skips.log"
GATE_ATTEST_NAME="spiritpal-gate-attest"
GATE_SKIP_MARKER_NAME="spiritpal-gate-skip-pending"
GATE_LIB_LOADED=1

# 人工批准的整链绕过说明（各钩子失败分支统一引用，不再把 --no-verify 当默认建议印出来）
GATE_BYPASS_HINT="[gate] 整链绕过（git commit --no-verify）属须仓库所有者明确批准的例外：它会同时关闭合并冲突守卫与其余全部钩子，且 post-commit 会把这类提交记为 gate-bypass suspected。代理不得自行使用。"

gate_git_path() {
    git rev-parse --git-path "$1" 2>/dev/null
}

gate_now() {
    date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown'
}

# gate_record_skip <一行记录正文>
# 记录正文必须以机械可 grep 的标记开头（capability-lint skipped: / gate-bypass suspected:）。
gate_record_skip() {
    _grs_reason="$1"
    [ -n "$_grs_reason" ] || return 0
    _grs_log="$(gate_git_path "$GATE_SKIP_LOG_NAME")"
    _grs_line="$(gate_now) ${_grs_reason}"
    if [ -n "$_grs_log" ]; then
        mkdir -p "$(dirname "$_grs_log")" 2>/dev/null
        if printf '%s\n' "$_grs_line" >>"$_grs_log" 2>/dev/null; then
            echo "[gate] 已留痕：${_grs_line}" >&2
            echo "[gate]        -> ${_grs_log}" >&2
            return 0
        fi
    fi
    echo "[gate] WARN 留痕落盘失败（只读环境？），本次输出仍记录：${_grs_line}" >&2
    return 0
}

# gate_attest —— 记下「本次 index tree 已走完 pre-commit 全链」
gate_attest() {
    _ga_tree="$(git write-tree 2>/dev/null)" || return 0
    [ -n "$_ga_tree" ] || return 0
    _ga_path="$(gate_git_path "$GATE_ATTEST_NAME")"
    [ -n "$_ga_path" ] || return 0
    mkdir -p "$(dirname "$_ga_path")" 2>/dev/null
    printf '%s %s\n' "$_ga_tree" "$(gate_now)" >"$_ga_path" 2>/dev/null
    return 0
}

# gate_check_chain —— post-commit 用：HEAD 的 tree 有没有对应凭据
# 凭据一次性消费（核对完就删）：否则紧跟其后的一次 --no-verify 会被上一笔留下的凭据误认为已校验。
gate_check_chain() {
    # 只核对真正由 `git commit` 产生的提交；merge / rebase / cherry-pick / reset 等由 git
    # 内部机制写成的提交不保证跑过 pre-commit，判它们绕过属假警报（reflog subject 可直接区分）。
    _gc_reflog="$(git reflog show -1 --format=%gs HEAD 2>/dev/null)"
    case "$_gc_reflog" in
        commit*) : ;;
        *) return 0 ;;
    esac
    _gc_tree="$(git rev-parse 'HEAD^{tree}' 2>/dev/null)"
    [ -n "$_gc_tree" ] || return 0
    _gc_att="$(gate_git_path "$GATE_ATTEST_NAME")"
    # 本笔提交相对父提交没带来任何内容变化（--allow-empty、或改完又改回去的空 amend）：
    # 没有需要守卫的内容，不判绕过（否则往审计日志里灌假警报）；旧凭据同样作废。
    # 注意：“纯改提交说明的 amend”不属此类——HEAD^1 是被 amend 掉的那笔的父，
    # tree 与它相比仍有差异；那种 amend 确实跳过了 commit-msg（DCO），仍应被记。
    _gc_ptree="$(git rev-parse 'HEAD^1^{tree}' 2>/dev/null)"
    if [ -n "$_gc_ptree" ] && [ "$_gc_ptree" = "$_gc_tree" ]; then
        [ -n "$_gc_att" ] && rm -f "$_gc_att" 2>/dev/null
        return 0
    fi
    _gc_ok=0
    if [ -n "$_gc_att" ] && [ -f "$_gc_att" ]; then
        if grep -q "^${_gc_tree} " "$_gc_att" 2>/dev/null; then
            _gc_ok=1
        else
            # 部分提交（git commit -- <路径> / git commit -p）：真正入库的 tree 并不等于
            # pre-commit 见到的整份 index tree，用「凭据刚刚被写过」认领，避免假警报。
            _gc_att_ts="$(date -r "$_gc_att" +%s 2>/dev/null)"
            _gc_head_ts="$(git show -s --format=%ct HEAD 2>/dev/null)"
            if [ -n "$_gc_att_ts" ] && [ -n "$_gc_head_ts" ] \
                && [ "$_gc_head_ts" -ge "$_gc_att_ts" ] \
                && [ "$((_gc_head_ts - _gc_att_ts))" -le 60 ]; then
                _gc_ok=1
            fi
        fi
        rm -f "$_gc_att" 2>/dev/null
    fi
    [ "$_gc_ok" -eq 1 ] && return 0
    _gc_sha="$(git rev-parse --short HEAD 2>/dev/null)"
    gate_record_skip "gate-bypass suspected: commit ${_gc_sha} 未匹配到 pre-commit 全链凭据（--no-verify 属须人工明确批准的例外）"
    echo "[gate] ⚠ 本次提交没有 pre-commit 凭据 —— 若使用了 git commit --no-verify，整链守卫（合并冲突守卫 / 路径可移植性 / pre-commit 框架全部钩子）都已被跳过。" >&2
    echo "$GATE_BYPASS_HINT" >&2
    echo "[gate] 单项豁免请改用 SKIP=<hook-id>（只跳过该钩子，其余照常），不要整链绕过。" >&2
    return 0
}

# gate_take_skip_note —— 读出并消费 capability-lint 降级便签（供 prepare-commit-msg 写进提交说明）
# 读后即删：便签只属于「当前这一笔」提交，不能串到下一笔。
gate_take_skip_note() {
    _gt_path="$(gate_git_path "$GATE_SKIP_MARKER_NAME")"
    [ -n "$_gt_path" ] && [ -f "$_gt_path" ] || return 0
    cat "$_gt_path" 2>/dev/null
    rm -f "$_gt_path" 2>/dev/null
    return 0
}

# gate_clear_skip_marker —— 兜底清理（例如 --no-verify 时 prepare-commit-msg 未被正常消费）
gate_clear_skip_marker() {
    _gc_path="$(gate_git_path "$GATE_SKIP_MARKER_NAME")"
    [ -n "$_gc_path" ] && rm -f "$_gc_path" 2>/dev/null
    return 0
}
