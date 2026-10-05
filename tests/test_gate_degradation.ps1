# capability-lint 单项降级 / 整链绕过留痕 —— 钩子层集成验证
#
# 干什么：在 .workbuddy/tmp/ 下建一个**隔离小仓**，把本仓 .githooks/ 与 gate 脚本复制进去，
# 逐条断言「受限环境只降级 capability-lint 一项 + 机械留痕」与「整链绕过必被记录」，
# 同时回归合并冲突守卫与 DCO 未被削弱。全程不碰主仓工作树。
#
# 跑法：pwsh -NoProfile -File tests/test_gate_degradation.ps1
# 退出码：0 = 全部断言通过；1 = 有失败（末尾表格列出具体项）
#
# 覆盖：
#   A 注入被击杀 → 仅本项降级、其余钩子照常、留痕落日志 + 进提交说明、便签读后即删
#   B --no-verify 整链绕过 → post-commit 记 gate-bypass suspected 并指向 SKIP
#   C SKIP=capability-lint 人工单项豁免 → 分发器补记留痕、框架显示 Skipped
#   D 真实越权 capability（sql:allow-execute）→ 硬失败不降级、文案不再印「紧急绕过」
#   E 合并冲突态（MERGE_HEAD）→ 仍被拒，且给出 worktree 隔离指引
#   F DCO 硬校验（缺签名拒 / 带签名放行）
#   G 健康全链提交 → 不新增任何留痕
#   H pathspec 部分提交 → 不被误判为绕过
#   I 健康提交后紧跟 --no-verify → 仍被记录（凭据一次性消费）
#   J amend / 空提交：走钩子的 amend 不误报；跳过钩子的内容变更（含 --no-verify 的 amend）被记；
#     无内容变化的空提交不误报
#   K 幂等判据只看行首：正文里引用 `capability-lint skipped:` 不会吞掉真降级行；已有行首标记时不重复插
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$rp = Join-Path $root '.workbuddy/tmp/gate-repo'
$script:results = @()

function Check($name, $cond, $detail) {
    $script:results += [pscustomobject]@{ Test = $name; Result = $(if ($cond) { 'PASS' } else { 'FAIL' }); Detail = $detail }
}

# ---------- 建隔离小仓 ----------
if (Test-Path $rp) { Remove-Item -Recurse -Force $rp }
New-Item -ItemType Directory -Force -Path $rp, "$rp/.githooks", "$rp/scripts", "$rp/src", "$rp/src-tauri/src", "$rp/src-tauri/capabilities" | Out-Null
Copy-Item "$root/.githooks/pre-commit", "$root/.githooks/pre-commit-lite", "$root/.githooks/prepare-commit-msg",
    "$root/.githooks/commit-msg", "$root/.githooks/post-commit", "$root/.githooks/lib-gate.sh" -Destination "$rp/.githooks"
Copy-Item "$root/scripts/capability-lint-gate.mjs", "$root/scripts/lint-capabilities.mjs" -Destination "$rp/scripts"
$cfg = @'
repos:
  - repo: local
    hooks:
      - id: capability-lint
        name: Capability Lint (minimal permissions)
        entry: node scripts/capability-lint-gate.mjs
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-commit]
'@
[System.IO.File]::WriteAllText("$rp/.pre-commit-config.yaml", $cfg.Replace("`r`n", "`n") + "`n")
[System.IO.File]::WriteAllText("$rp/package.json", "{`n  `"dependencies`": {}`n}`n")
$capOk = "{`n  `"permissions`": [`"core:default`"]`n}`n"
$capBad = "{`n  `"permissions`": [`"sql:allow-execute`"]`n}`n"
[System.IO.File]::WriteAllText("$rp/src-tauri/capabilities/default.json", $capOk)
[System.IO.File]::WriteAllText("$rp/src-tauri/src/lib.rs", "")
[System.IO.File]::WriteAllText("$rp/src/dummy.ts", "export const x = 1`n")
Set-Location $rp
git init -q -b main . 2>&1 | Out-Null
git config core.hooksPath .githooks
git config user.name 'GateTest'; git config user.email 'gate@test.local'
git add . 2>&1 | Out-Null
git commit -q -m 'chore: harness setup' 2>&1 | Out-Null
"setup commit rc=$LASTEXITCODE"

$skipLog = "$rp/.git/spiritpal-gate-skips.log"
function LogCount($pat) { if (Test-Path $skipLog) { @(Select-String -Path $skipLog -Pattern $pat -SimpleMatch).Count } else { 0 } }

# ---------- A. 注入「被击杀」→ 只降级本项 + 提交说明机械留痕 ----------
$bypassBefore = LogCount 'gate-bypass suspected'
$env:SPIRITPAL_CAPLINT_FAKE_KILL = '1'
'a' | Set-Content a.txt
git add a.txt 2>&1 | Out-Null
$outA = git commit -m 'feat: degrade demo' 2>&1
$rcA = $LASTEXITCODE
Remove-Item Env:\SPIRITPAL_CAPLINT_FAKE_KILL
$msgA = git log -1 --format=%B
$txtA = $outA -join "`n"
Check 'A 降级后提交成功' ($rcA -eq 0) "rc=$rcA"
Check 'A 其余钩子照常执行（框架被调用）' ($txtA -match 'Capability Lint') ''
Check 'A 提交说明含 capability-lint skipped:' ($msgA -match 'capability-lint skipped:') ''
Check 'A 便签未被反斜杠转义破坏' (($msgA -notmatch '\\Users') -and ($msgA -match 'spiritpal-gate-skips.log')) ('msg=' + ($msgA -replace "`r?`n", ' | '))
Check 'A 提交说明仍带 DCO 签名' ($msgA -match 'Signed-off-by:') ''
Check 'A 留痕日志含 skipped 行' ((LogCount 'capability-lint skipped:') -ge 1) ''
Check 'A 正常全链提交未被记为绕过' ((LogCount 'gate-bypass suspected') -eq $bypassBefore) ''
Check 'A 全链凭据已被 post-commit 一次性消费' (-not (Test-Path "$rp/.git/spiritpal-gate-attest")) ''
Check 'A 便签已消费（无残留）' (-not (Test-Path "$rp/.git/spiritpal-gate-skip-pending")) ''

# ---------- B. --no-verify 整链绕过 → post-commit 必须留痕 ----------
'x' | Set-Content b.txt
git add b.txt 2>&1 | Out-Null
$outB = git commit -q --no-verify -m 'chore: bypass demo' 2>&1
$rcB = $LASTEXITCODE
$txtB = $outB -join "`n"
Check 'B --no-verify 提交本身成功' ($rcB -eq 0) "rc=$rcB"
Check 'B post-commit 记下 gate-bypass suspected' ((LogCount 'gate-bypass suspected') -eq ($bypassBefore + 1)) ''
Check 'B 告警文案说明须人工批准' ($txtB -match '须仓库所有者明确批准') ''
Check 'B 指引改用 SKIP 单项豁免' ($txtB -match 'SKIP=<hook-id>') ''

# ---------- C. 人工批准的单项豁免 SKIP=capability-lint → 分发器留痕 ----------
$skipC = LogCount '人工经 SKIP 环境变量批准跳过'
'c' | Set-Content c.txt
git add c.txt 2>&1 | Out-Null
$env:SKIP = 'capability-lint'
$outC = git commit -q -m 'feat: single-item skip via SKIP' 2>&1
$rcC = $LASTEXITCODE
Remove-Item Env:\SKIP
$txtC = $outC -join "`n"
Check 'C SKIP 单项豁免下提交成功' ($rcC -eq 0) "rc=$rcC"
Check 'C 分发器补记 SKIP 留痕' ((LogCount '人工经 SKIP 环境变量批准跳过') -eq ($skipC + 1)) ''
Check 'C 框架显示该钩子 Skipped' ($txtC -match 'Skipped') ''

# ---------- D. 真实越权 capability → 硬失败（不降级），且不再印「紧急绕过」 ----------
$skipD = LogCount 'capability-lint skipped:'
[System.IO.File]::WriteAllText("$rp/src-tauri/capabilities/default.json", $capBad)
'd' | Set-Content d.txt
git add src-tauri/capabilities/default.json d.txt 2>&1 | Out-Null
$outD = git commit -m 'feat: must be blocked' 2>&1
$rcD = $LASTEXITCODE
$txtD = $outD -join "`n"
Check 'D 真实违规被阻断' ($rcD -ne 0) "rc=$rcD"
Check 'D 违规判据被原样带出' ($txtD -match 'sql:allow-execute') ''
Check 'D 失败文案无「紧急绕过」' (-not ($txtD -match '紧急绕过')) ''
Check 'D 失败文案说明须人工批准' ($txtD -match '须仓库所有者明确批准') ''
Check 'D 违规未新增降级留痕' ((LogCount 'capability-lint skipped:') -eq $skipD) "before=$skipD after=$(LogCount 'capability-lint skipped:')"
[System.IO.File]::WriteAllText("$rp/src-tauri/capabilities/default.json", $capOk)
git add src-tauri/capabilities/default.json 2>&1 | Out-Null
git commit -q -m 'chore: base for merge' 2>&1 | Out-Null

# ---------- E. 合并冲突守卫仍生效（冲突已解决、MERGE_HEAD 仍在时拦截） ----------
git checkout -q -b side 2>&1 | Out-Null
'side' | Set-Content e.txt
git add e.txt 2>&1 | Out-Null
git commit -q --no-verify -m 'side commit' 2>&1 | Out-Null
git checkout -q main 2>&1 | Out-Null
'main' | Set-Content e.txt
git add e.txt 2>&1 | Out-Null
git commit -q --no-verify -m 'main commit' 2>&1 | Out-Null
git merge side 2>&1 | Out-Null
'e-resolved' | Set-Content e.txt
git add e.txt 2>&1 | Out-Null
$mergeHead = Test-Path "$rp/.git/MERGE_HEAD"
$outE = git commit -m 'feat: must be refused by merge guard' 2>&1
$rcE = $LASTEXITCODE
$txtE = $outE -join "`n"
Check 'E MERGE_HEAD 存在时提交被拒' ($rcE -ne 0 -and $mergeHead) "rc=$rcE mergeHead=$mergeHead"
Check 'E 拒绝文案点明 merge/冲突' ($txtE -match '未解决冲突|merge 进行中') ''
Check 'E 拒绝文案含 worktree 隔离指引' ($txtE -match 'git worktree add') ''
Check 'E 拒绝文案无「紧急绕过」' (-not ($txtE -match '紧急绕过')) ''
Check 'E 拒绝文案说明须人工批准' ($txtE -match '须仓库所有者明确批准') ''
git merge --abort 2>&1 | Out-Null
Check 'E abort 后回到干净态' ((git status --porcelain).Count -eq 0) ''

# ---------- F. DCO 硬校验未被削弱 ----------
[System.IO.File]::WriteAllText("$rp/.git/MSG_NOSOB", "feat: no signoff`n")
sh .githooks/commit-msg .git/MSG_NOSOB 2>&1 | Out-Null
$rcF = $LASTEXITCODE
Check 'F 缺 DCO 签名被拒' ($rcF -ne 0) "rc=$rcF"
[System.IO.File]::WriteAllText("$rp/.git/MSG_SOB", "feat: signed`n`nSigned-off-by: GateTest <gate@test.local>`n")
sh .githooks/commit-msg .git/MSG_SOB 2>&1 | Out-Null
Check 'F 带 DCO 签名放行' ($LASTEXITCODE -eq 0) "rc=$LASTEXITCODE"

# ---------- G. 健康全链：无降级、无绕过留痕 ----------
$skipG = LogCount 'capability-lint skipped:'
$bypassG = LogCount 'gate-bypass suspected'
'g' | Set-Content g.txt
git add g.txt 2>&1 | Out-Null
$outG = git commit -q -m 'feat: healthy full chain' 2>&1
$rcG = $LASTEXITCODE
$msgG = git log -1 --format=%B
Check 'G 健康提交成功' ($rcG -eq 0) "rc=$rcG; $(($outG -join ' '))"
Check 'G 未新增降级留痕' ((LogCount 'capability-lint skipped:') -eq $skipG) ''
Check 'G 未被记为绕过' ((LogCount 'gate-bypass suspected') -eq $bypassG) ''
Check 'G 提交说明不含降级便签' ($msgG -notmatch 'capability-lint skipped') ''

# ---------- H. 部分提交（git commit -- <路径>）不应被误判为绕过 ----------
$bypassH = LogCount 'gate-bypass suspected'
'h1' | Set-Content h.txt
'h2' | Set-Content h2.txt
git add h.txt h2.txt 2>&1 | Out-Null
$outH = git commit -q -m 'feat: partial commit' -- h.txt 2>&1
$rcH = $LASTEXITCODE
$filesH = (git show --name-only --format= HEAD) -join ','
Check 'H pathspec 部分提交成功' ($rcH -eq 0) "rc=$rcH; $(($outH -join ' '))"
Check 'H 部分提交未被误记为绕过' ((LogCount 'gate-bypass suspected') -eq $bypassH) ''
Check 'H 只提交了 h.txt' ($filesH -eq 'h.txt') "files=$filesH"

# ---------- I. 紧跟健康提交后的 --no-verify 仍必须被记（凭据已消费） ----------
$bypassI = LogCount 'gate-bypass suspected'
'i' | Set-Content i.txt
git add i.txt 2>&1 | Out-Null
git commit -q --no-verify -m 'chore: bypass right after hooked commit' 2>&1 | Out-Null
Check 'I 紧跟其后的绕过仍被记录' ((LogCount 'gate-bypass suspected') -eq ($bypassI + 1)) ''

# ---------- J. amend / 空提交：无内容变化不误报，跳过钩子的内容变更必须被记 ----------
$bypassJ = LogCount 'gate-bypass suspected'
git commit -q --amend -m 'chore: amend with hooks' 2>&1 | Out-Null
Check 'J1 走钩子的 amend 不误报' ((LogCount 'gate-bypass suspected') -eq $bypassJ) ''
git commit -q --amend --no-verify -m 'chore: message-only amend' 2>&1 | Out-Null
Check 'J2 --no-verify 的 amend 仍被记（连 commit-msg/DCO 一起跳）' ((LogCount 'gate-bypass suspected') -eq ($bypassJ + 1)) ''
'j' | Set-Content j.txt
git add j.txt 2>&1 | Out-Null
git commit -q --amend --no-verify -m 'chore: content amend without hooks' 2>&1 | Out-Null
Check 'J3 改内容却绕过钩子的 amend 被记录' ((LogCount 'gate-bypass suspected') -eq ($bypassJ + 2)) ''
git commit -q --allow-empty --no-verify -m 'chore: empty without hooks' 2>&1 | Out-Null
Check 'J4 无内容变化的空提交不误报' ((LogCount 'gate-bypass suspected') -eq ($bypassJ + 2)) ''

# ---------- K. 便签幂等判据只看行首（a6fdb59 踩过：正文提到该标记就把降级行吞了） ----------
$env:SPIRITPAL_CAPLINT_FAKE_KILL = '1'
'k1' | Set-Content k1.txt
git add k1.txt 2>&1 | Out-Null
$msgK1 = @'
feat: quote token inline

实现里记 `capability-lint skipped: <原因>` 后 exit 0，让其余钩子照常跑。
'@
[System.IO.File]::WriteAllText("$rp/.git/K1MSG", $msgK1 + "`n")
git commit -q -F .git/K1MSG 2>&1 | Out-Null
$bodyK1 = git log -1 --format=%B
$linesK1 = @(($bodyK1 -split "`r?`n") | Where-Object { $_ -match '^capability-lint skipped:' }).Count
Check 'K1 正文引用该标记时降级行仍被插入' ($linesK1 -eq 1) "lines=$linesK1"

'k2' | Set-Content k2.txt
git add k2.txt 2>&1 | Out-Null
$msgK2 = @'
feat: already annotated

capability-lint skipped: 人预先写好的说明

正文
'@
[System.IO.File]::WriteAllText("$rp/.git/K2MSG", $msgK2 + "`n")
git commit -q -F .git/K2MSG 2>&1 | Out-Null
Remove-Item Env:\SPIRITPAL_CAPLINT_FAKE_KILL
$bodyK2 = git log -1 --format=%B
$linesK2 = @(($bodyK2 -split "`r?`n") | Where-Object { $_ -match '^capability-lint skipped:' }).Count
Check 'K2 已有行首标记时不重复插入' ($linesK2 -eq 1) "lines=$linesK2"

'=== 留痕日志全文 ==='
if (Test-Path $skipLog) { Get-Content $skipLog } else { '(no skip log)' }
'=== 最近提交 ==='
git log --format='%h %s' -6
'=== 提交说明全文（A 降级笔） ==='
git log --format=%B --grep='feat: degrade demo' -1
$results | Format-Table -AutoSize -Wrap
$failed = @($results | Where-Object Result -eq 'FAIL')
if ($failed.Count -eq 0) { 'ALL PASS (' + $results.Count + ' 项)'; exit 0 } else { "FAILED $($failed.Count)/$($results.Count)"; $failed | ForEach-Object { $_.Test }; exit 1 }
