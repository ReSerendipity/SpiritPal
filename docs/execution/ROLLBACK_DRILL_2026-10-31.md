# 回滚演练记录（2026-10-31）

> 依据：评估报告（2026-10-29）§3.4 发布版本管理 Q1（P0）与上线门禁 R4「回滚预案已演练」（本报告唯一 ⛔P0 阻断项）；改进路线 §6.1 S1「回滚演练一次 + 阈值成文」。
> 关联：`docs/release-governance.md` §5（回滚阈值已于本轮成文）；`docs/execution/RELEASE_VERIFICATION.md` §1.3（发布回读清单）。
> 范围：在仓库外临时克隆内演练四条回滚通道；全程不触碰主仓工作树、远端仓库、任何 Release / tag / Secrets，不执行任何 push。

## 0. 结论速览

| 演练 | 对象 | 结果 | 关键耗时 |
|---|---|---|---|
| A 更新清单回滚 | `updates.json` revert | ✅ 通过（逐字节复原） | 坏版本提交 0.229s；revert 0.088s；全链 39.8s |
| B 清单生成链复核 | `scripts/generate-updates-json.mjs` | ✅ 通过（version / platforms 含 signature 全文一致） | 8.9s |
| C 可达性 | 远端 `main` 的 `updates.json` | ✅ 通过（gh API 等价通道 HTTP 200）；raw 通道本机不可达，见 §6 | 取证合计 <5s |
| D 代码类回滚通道 | `git revert --no-commit` → abort | ✅ 通过（通道可用，未 push） | 0.101s + 0.144s |

## 1. 环境与克隆

- 实测基线：本地 `main` @ `f2ecfc2`，工作树干净（0 项脏）；克隆后克隆内 HEAD 同为 `f2ecfc2`。
- 克隆方式（含环境偏差说明）：指令给定的 `git clone https://github.com/ReSerendipity/SpiritPal.git` 在本机网络不可达——实测 github.com、api.github.com、raw.githubusercontent.com（均连接重置）与两个常用加速镜像（超时）皆失败，仅 codeload.github.com 可达（200 / 1.75s）；网络克隆 300 秒停滞后终止。改用本地对象库源 `git clone --no-hardlinks --no-local <主仓路径> <临时目录>`（等价于一次真实打包传输，1347 文件，11.1s）。克隆前已核对 `main == origin/main == f2ecfc2`，克隆内容与远端 `main` 等价；全程未触碰主仓工作树与远端。
- 临时目录：`%LOCALAPPDATA%\Temp\sp-rollback-drill-20261031`（演练结束后已删除）。

## 2. 演练 A：更新清单回滚（评估报告 S1 主流程）

命令序列（克隆内）：

```bash
git checkout -b drill/updates-rollback
sha256sum updates.json
# 基线：b6e720fc7fd596cdeb34e4d042a19795ef18ceae4fd5706876245fe3f128346a
node -e "…JSON.parse 后置 version='0.0.0-test'，注入伪造 darwin-aarch64 平台条目（显式合成签名串，非真实凭据）…"
git add updates.json && git commit -m "drill: publish corrupted updates.json (v0.0.0-test + bogus darwin-aarch64)"
# → cc75dc6，0.229s（含 add）
git revert --no-edit HEAD
# → 980cb84，0.088s
```

输出摘要与断言：

- 坏版本态 `updates.json` sha256 = `9ff06ed2aa73a7b901259fc380aaabb17bd429a085b7896d73f4614077f07021`（version=0.0.0-test、platforms 三键含伪造 darwin-aarch64），证明注入生效；
- revert 后 sha256 = `b6e720fc…28346a`，与基线**逐字节一致**；
- `git diff f2ecfc2 -- updates.json` 输出为空（rc=0）；
- `cmp` 与主仓工作树 `updates.json` 完全一致。

计时：坏版本提交 0.229s；`git revert` 0.088s；注入→提交→revert→断言全链 39.8s。

## 3. 演练 B：清单生成链复核

前置核对：`scripts/generate-updates-json.mjs` **没有** `--check` / `--verify` 只读模式（必须传 `--tag`、经 gh CLI 拉取 Release 资产、末尾 `writeFileSync` 写出）。为满足只读约束，用其 `--out` 参数把输出重定向到临时文件，不触碰清单本体：

```bash
node scripts/generate-updates-json.mjs --repo ReSerendipity/SpiritPal --tag v0.2.3 --out "%TEMP%\sp-regen-updates-check.json"
# rc=0，8.9s；输出 platforms: linux-x86_64, windows-x86_64
```

比对（回滚后清单 vs 生成器重生成清单）：

- `version`：0.2.3 == 0.2.3 ✅；
- `platforms`：深比较完全一致 ✅——signature 全文与 url 逐字节一致（signature 由生成器本轮从 v0.2.3 Release 资产重新下载后组装）；
- `notes`：一致（空串）；
- `pub_date`：不一致（回滚后清单 `2026-10-29T13:52:05.145Z` vs 重生成 `2026-10-31T…`）——生成器取值 `release.published_at || new Date().toISOString()`，而其 gh 调用仅请求 `tagName,name,assets` 三个字段，`published_at` 恒为空 → 回落到生成时刻。属生成器既有 quirk，对更新器判定（version 主键 + ed25519 签名校验）无影响，不构成回滚障碍；未在本 P0 内修复，见 §6。
- 重生成清单 sha256 = `820ce6e3e2e37e83e455aff4cf8ea977e902848cdebbb7361a315543ae714aa5`（与回滚后清单仅差上述 pub_date 一处）。

**结论**：回滚后的清单与生成器从远端 Release 资产重新组装的结果判定一致，生成链对回滚态无异议。

## 4. 演练 C：远端可达性与内容

- 指定通道实测：`curl -sI https://raw.githubusercontent.com/ReSerendipity/SpiritPal/main/updates.json` → 本机连接失败（curl rc=35，SSL 连接被重置；同轮另测 github.com / api.github.com / raw 指定 IP 亦失败）。**raw 通道 200 断言在本机网络环境无法完成**，列入 §6 未覆盖项。
- 等价通道（gh CLI，仓库发布链标准工具）：`gh api repos/ReSerendipity/SpiritPal/contents/updates.json?ref=main` → **HTTP/2.0 200 OK**；解码内容 sha256 = `b6e720fc…28346a`，与回滚后清单逐位一致（远端 main 清单完好，未受演练影响）。
- 内容判定：
  - `version` = 0.2.3 == 最新 release tag（`gh api releases/latest` → `v0.2.3`）== 远端最新 tag（tags 列表首位 `v0.2.3`）✅；
  - `platforms` 含 `windows-x86_64` 与 `linux-x86_64`，两平台 `signature` 均非空、base64 解码后为 minisign 格式（`untrusted comment:` 头），trusted comment 绑定 `SpiritPal_0.2.3` 对应平台文件名（签名原文不在此粘贴）✅；
  - 两平台 `url` 均指向 `releases/download/v0.2.3/` 不可变固定路径 ✅。

## 5. 演练 D：代码类回滚通道

```bash
git checkout main            # f2ecfc2，工作树干净
git revert --no-commit HEAD  # 最近一笔非发布性提交 f2ecfc2（fix(harness)…，非 updates.json sync）
# → 0.101s，15 个文件逆向变更进入暂存区（含 .github/workflows/release.yml、docs/release-governance.md 等）
git revert --abort           # 0.144s
```

断言：abort 后 `git status --short` 0 项；HEAD 仍为 `f2ecfc2`；`main == origin/main`，`origin/main..main` 0 提交——**未产生任何 push**（全程无 push 操作）。

**结论**：`revert --no-commit` → `revert --abort` 通道可用，可安全用于「先看逆向 diff 再决定去留」的处置流程。

## 6. 未覆盖项

1. **Release 退 draft 与 tag 重指向 / 删除**：属破坏性远端动作，须仓库所有者单独授权（`docs/release-governance.md` §5「破坏性动作」），本轮未执行——仅成文其执行顺序与授权要求。
2. **真机安装 / 卸载**：本轮未执行；常规发版的真机验收仍按 `docs/execution/RELEASE_VERIFICATION.md` §二 执行。
3. **raw.githubusercontent.com 200 断言**：本机网络对该域定向阻断（curl rc=35），本轮以 gh API 等价通道完成同等取证（HTTP 200 + sha256 逐位一致 + 内容判定）；在网络可用环境复跑时应以 raw 通道为准并回填结果。
4. **「客户端检查更新回落旧版」真机端到端**：评估报告 S1 原文含客户端视角（updater 实际回落）；本轮以清单 revert + 生成链复核 + 远端内容取证替代，未在真机触发 updater。
5. **生成器 pub_date quirk**（§3 所述）：不在本 P0 范围，未修复，留待后续按需处理。

## 7. 阈值成文对照（同轮完成）

- 改前：`docs/release-governance.md` §5「判定（本仓具体阈值）：**待定（负责人 + 触发条件）**」（改前第 75 行）；同文件差异点采集清单「回滚判定阈值｜待定（负责人 + 触发条件）」（改前第 113 行）。
- 改后：§5 成文为负责人（仓库所有者）、触发条件（清单与 tag 不一致 / 资产校验失败 / 崩溃回退 / 更新失败率 / 发布链闸失败，五条可判定）、执行顺序（退 draft → revert 清单 → revert 代码 → 验证 → 留痕）、回滚后验证、演练节奏（每季度至少一次）与最近演练行（改后第 75–91 行）；差异点表行同步（改后第 123 行）。
- 阈值为仓库所有者本轮成文的判定口径（其中崩溃单例复现、更新失败率 72h / ≥2 例为本轮拍板值，可在引入遥测后再校准）；§6 SLA 仍为待定，不在本 P0 范围。
