# SpiritPal HEAD 终态门禁本地复跑与 capabilities 复验记录（未推送路径）

> **生成日期**：2026-10-06
> **基线**：本地 `main @ 848b251`（领先 `origin/main` 38 个提交，**未 push**）
> **触发**：better-harness finding——HEAD 的 38 个本地提交无对应 CI 运行记录，且
> `f6b8b72 / f55e070 / 848b251` 三笔用了 `--no-verify`。
> **采用路径**：②（暂不推送）——本地逐条复跑交接文档 `docs/execution/agent-review-handoff-2026-10-05.md`
> §三 门禁四连，并按 §5.1 补 `scripts/lint-capabilities.mjs` 复验。外部写操作（`git push`）
> 未经仓库所有者授权，本报告不触发任何推送。
> **执行环境**：Windows / PowerShell 7；每条命令取真实 `$LASTEXITCODE`。

---

## 一、门禁四连（§三 复核入口）真实退出码

| # | 门禁 | 命令 | 退出码 | 关键计数 |
|---|---|---|---|---|
| 1 | 类型 | `npx tsc --noEmit` | **rc=0** | 0 error |
| 2 | Lint | `npx eslint src/ --max-warnings=0` | **rc=0** | 0 error 0 warning（无输出）|
| 3 | 单测 | `npx vitest run` | **rc=0** | **223 文件 / 2859 passed / 11 skipped**（2870 total）|
| 4 | Rust | `cd src-tauri && cargo test --lib` | **rc=0** | **222 passed / 0 failed**（0 ignored）|

> 计数与交接文档 §三 终态表**逐位一致**。原始 stdout 留存于 `artifacts/harness-vitest-recheck.log`、
> `artifacts/harness-cargo-recheck.log`。

## 二、三笔 `--no-verify` 提交 · capabilities 目录零改动抽查

对 `f6b8b72 / f55e070 / 848b251` 逐笔 `git show --name-only` 过滤 `capabilit`：

| 提交 | 说明 | 是否触碰 `capabilities/*` | 是否触碰 `lint-capabilities.mjs` |
|---|---|---|---|
| `f6b8b72` | 新增 `sp_schedules_delete` | **ZERO** | 未触碰 |
| `f55e070` | 角色包导入移动端入口 | **ZERO** | 未触碰 |
| `848b251` | 刷新 SRI 哈希 | **ZERO** | 未触碰 |

三笔提交树中 `scripts/lint-capabilities.mjs` 的 blob **完全一致**（`5064f2c0dcf54d17ee30a9f4d35f6ba7f76fae36`，
与 `HEAD` 同一），佐证 §5.1「脚本内容零改动」。三笔唯一新增的 `invoke` 为 `sp_schedules_delete`
（`sp_*` 前缀按 lint 规则 3 豁免），未声明任何新权限。

## 三、`node scripts/lint-capabilities.mjs` 复验 + 关键根因发现

### 3.1 复验直接结论

提交版（`5064f2c`）脚本在本机**无法返回 rc**——进程以高 CPU 无限空转（多次观测 >90s 不退出，
独立 `Start-Job` 亦超时）。经隔离定位，根因**不是**沙箱/FS 拦截，而是脚本自身的**确定性死循环**：

```js
// 提交版 collectRegisteredCommands() 内（BUGGY）
while (spRe.exec(sqliteSrc) !== null) {
  // eslint-disable-next-line no-cond-assign
  if ((sm = spRe.exec(sqliteSrc)) !== null) registered.add(sm[1])
}
```

- 对带 `g` 标志的正则，`.exec()` **返回 `null` 时会把 `lastIndex` 重置为 0**；
- 「外层取一个、内层取一个」的双调用模式，当 `sp_*` 匹配数为**奇数**时，内层在某轮取到 `null`
  → `lastIndex` 归 0 → 外层重新从第 1 个匹配开始 → **无限循环**；
- 实测当前 `src-tauri/src/sqlite.rs` 的 `sp_` 函数匹配数 = **93（奇数）**，恰好触发。

### 3.2 触发时间线（证伪 §5.1「沙箱 SIGTERM」误判）

同日 14:08 前多次 Passed，是因为此前 `sp_` 数为**偶数**；`f6b8b72` 新增 `sp_schedules_delete`
使 `sp_` 数变**奇数**，从这几笔提交起 Capability Lint 进入死循环——表现像「被 SIGTERM 击杀 / 沙箱拦截」，
实为脚本 bug。**该结论修正交接文档 §5.1 的环境性归因。**

诊断证据链（本机实测耗时）：
- `readFileSync` 直读 3 个 capabilities JSON + Cargo/package/lib.rs：**0.098s**，node FS 正常；
- `src` 递归遍历（`readdirSync withFileTypes`）：**7ms / 19 目录 / 394 文件**，无目录环、无 reparse point；
- `collectInvokeCalls` 等价（读+正则 392 个 ts/tsx）：**103ms**；
- Rust 扫描（34 个 .rs + `#[tauri::command]` 正则）：**9ms**；
- **`spRe` 双调用 while**：命中迭代上限（>1,000,000）→ 死循环唯一卡点。

### 3.3 修复与修复后复验

将上述双调用循环改为单调用（`while ((sm = spRe.exec(sqliteSrc)) !== null) registered.add(sm[1])`，
即之前工作树曾出现、随后被并发写回覆盖的那份修复）后，完整脚本复跑：

```
✅ capability lint 通过：chat-window.json, default.json, settings-window.json
   （权限最小授权 + 插件实现 + invoke 命令存在性）
rc=0（<0.2s）
```

- **规则 1**（硬拒绝黑名单 + 宽泛通配）：3 个 capability 文件均无违规；
- **规则 2**（非 `core:*` 前缀须对应已注册插件）：通过；
- **规则 3**（`invoke('xxx')` 命令须在 Rust 侧存在，`sp_*`/`plugin:` 豁免）：通过。

即 §5.1 所要求的「沙箱外预期 rc=0」在**修复脚本后成立**；三笔 `--no-verify` 提交本身不含任何
capabilities 改动，lint 语义判据全部满足。

## 四、验证判据对照

| 判据 | 结果 |
|---|---|
| CI 对 HEAD 全绿 **或** 本地复跑含 4 条命令真实退出码 | ✅ 本报告 §一 记录 4 条真实 rc（全部 rc=0）|
| 复验覆盖 `f6b8b72 / f55e070 / 848b251` capabilities 目录零改动抽查 | ✅ 本报告 §二 git 逐笔证实 ZERO |

## 五、遗留与授权边界

- **本路径未推送**：`git push origin main` 属外部写操作，须仓库所有者明确授权；本报告仅落地本地证据。
  路径①（授权推送 → structure-guard / ci / docs-consistency 对 HEAD 运行留存 run 链接）仍待授权后执行。
- **待入库的脚本修复**：`scripts/lint-capabilities.mjs` 的死循环修复应随本记录一并提交，否则
  任何 `sp_` 数为奇数的检出都会让 pre-commit / CI Capability Lint 卡死。
- **并发写入者警示**：复跑期间观测到 `scripts/lint-capabilities.mjs` 被并发进程在 HEAD 版与修复版之间
  来回改写，且工作树正被并发暂存（出现 `scripts/capability-lint-gate.mjs`、`.githooks/lib-gate.sh` 等）。
  依 AGENTS.md 多代理工作树隔离铁律，本报告**不执行 commit**，提交请由所有者在独占 worktree 内完成。
