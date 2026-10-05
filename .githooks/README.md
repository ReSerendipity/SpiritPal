# .githooks

本仓库的 Git 钩子源码。启用一次即可：

```sh
git config core.hooksPath .githooks      # 或执行 ./.githooks/install.sh
```

启用后钩子直接从本目录读取，**改这里立即生效**，不需要再往 `.git/hooks` 复制文件。

| 钩子 | 作用 |
| --- | --- |
| `pre-commit` | 先做本地层文档快照（尽力而为）；有 `.pre-commit-config.yaml` 且框架可用 → 走 pre-commit（先试 `.venv`/`python -m pre_commit`，再退回 PATH 上的 `pre-commit` 控制台命令）；否则走 `pre-commit-lite`。通过后以 index tree 落一份全链凭据 |
| `pre-push` | 执行仓库内 `precheck.ps1`（无则退回根目录守卫） |
| `prepare-commit-msg` | 自动追加 `Signed-off-by`（幂等，插在注释块之前）；顺带消费 capability-lint 降级便签写进提交说明 |
| `commit-msg` | DCO 硬校验（缺签名阻断）+ conventional 规范软提示 |
| `post-commit` | 核对本次提交是否真的走过 `pre-commit` 全链（`--no-verify` 不跳过 `post-*`），缺失则记 `gate-bypass suspected:`；不阻断 |
| `post-merge` / `post-checkout` | 依赖清单变更提醒（pip / pnpm / npm / cargo / gradle）+ 本地层文档快照 |
| `pre-commit-lite` | 轻量检查：大文件、私钥与令牌、冲突标记 + 根目录守卫 |
| `lib-gate.sh` | 门禁留痕 / 全链凭据 共用函数（被上述钩子 `.` 引入，尽力而为不阻断） |

## 受限环境下的单项降级与整链绕过

背景：`capability-lint`（Tauri capability 最小授权 lint）在受限执行沙箱里可能被超时击杀。
历史处置是 `git commit --no-verify` 整链绕过 —— 连带把合并冲突守卫与其余钩子一起关掉。
现在改为**只降级那一项**：

- `capability-lint` 的入口是 `scripts/capability-lint-gate.mjs`（非 lint 本体）。子进程被击杀/
  超时/spawn 失败而**没给出判据**时，它只跳过本项（exit 0），并机械留痕
  `capability-lint skipped: <原因>` → 同时进 `<git-dir>/spiritpal-gate-skips.log` 与本笔提交说明。
- **真实违规永不降级**（lint 打印出违规判据 → gate 照样 exit 1）；`SPIRITPAL_CAPLINT_STRICT=1`
  可连环境性失败一起改为硬失败。CI 的 `layout` job 直调原脚本，不经过 gate，**不降级**。
- 环境开关：`SPIRITPAL_CAPLINT_TIMEOUT_MS`（deadline，默认 10000 ms）、
  `SPIRITPAL_CAPLINT_STRICT=1`、`SPIRITPAL_CAPLINT_FAKE_KILL=1`（自测注入点）。
- **单项豁免走框架自带的 `SKIP`**：`SKIP=capability-lint git commit ...`（只跳过该钩子，
  其余照常跑；`pre-commit` 分发器会同时补一条 `capability-lint skipped:` 留痕）。
- **`git commit --no-verify` 不再是建议选项**：各钩子失败文案不再印“紧急绕过”，只说明它属
  须仓库所有者明确批准的例外；post-commit 会把这类提交记为 `gate-bypass suspected:`。
  凭据一次性消费（核对完即删），所以紧跟在健康提交后的 `--no-verify` 仍会被记；
  部分提交（`git commit -- <路径>`）的 tree 并不等于整份 index tree，改以“凭据刚被写过”
  （≤60s）认领，不会误报。merge/rebase/cherry-pick 等由 git 内部机制写的提交不判。
- 已知边界：若 gate 进程**自身**被击杀（非子进程），本项仍会红；此时请走上面的人工批准
  `SKIP=<hook-id>`，不要整链绕过。
- 复跑验证：`pwsh -NoProfile -File tests/test_gate_degradation.ps1`（在 `.workbuddy/tmp/gate-repo`
  建隔离小仓，逐条断言 A–J：降级只影响本项、留痕同时落日志与提交说明、`--no-verify` 被记为
  `gate-bypass suspected`、`SKIP` 豁免被补记、真实违规不降级、合并冲突守卫与 DCO 仍生效；
  退出码 0 = 全过，不碰主仓工作树）。

## 说明

- `pre-commit-lite` 找不到 Python 时会打印醒目 `[WARN]` 并放行；设 `GUARD_STRICT=1` 可让它改为阻断。
- 大文件阈值默认 5MB，可用 `GUARD_MAX_FILE_MB` 调整。
- `core.hooksPath` 是**本地**配置，不会随克隆传播——换机器请重新执行上面那行命令。

## 本地层文档快照

`AGENTS.md` 与 `docs/agents/` 是被 gitignore 的本地层文件（无版本库保护），由
`lib-snapshot.sh`（挂在 pre-commit / post-checkout / post-merge 上，尽力而为，
失败不阻断 git 操作）调用 `scripts/snapshot_local_docs.py` 自动快照到
`backups/agents-snapshots/`（该目录已被 gitignore，不改变两级文档设计）。
每份快照带时间戳与 `MANIFEST.json`（逐文件 sha256），内容无变化时自动跳过，
滚动保留最近 30 份。

```sh
python scripts/snapshot_local_docs.py list                       # 查看全部快照
python scripts/snapshot_local_docs.py restore --dest <临时目录>   # 演练恢复（先校验哈希，不动工作树）
python scripts/snapshot_local_docs.py restore                    # 确认无误后就地恢复到工作树
```

## 跨机异地落地

`snapshot` 子命令**可选**地把同一份快照额外镜像到一个**仓库外**目录，给上面的本机快照
（同机同盘、又被 gitignore）补上跨机维度。镜像根布局与 `backups/agents-snapshots/` 相同：
`<时间戳>/` + 全部子文档 + `MANIFEST.json`。

触发优先级（三者都不设 = 与旧版逐字节一致，只写本机、绝不写任何仓库外路径）：

1. `snapshot --mirror DIR`（一次性，最高优先级）
2. 环境变量 `SPIRITPAL_SNAPSHOT_MIRROR=DIR`（当前 shell）
3. `git config spiritpal.snapshotMirror DIR`（本仓库长期生效，推荐）

```sh
python scripts/snapshot_local_docs.py snapshot --mirror <仓库外目录>
git config spiritpal.snapshotMirror <仓库外目录>
```

钩子接线：`lib-snapshot.sh` 只调用不带 `--mirror` 的 `snapshot` 子命令，环境变量与
 git config 由脚本自身读取——设了任一者即自动附带异地镜像，无需改动钩子；沿用「尽力
而为、失败只 WARN 不阻断」语义（镜像失败置本次 rc=1，但**不回滚**已建好的本机快照，
本机恢复永远优先）。内容无变化的「跳过新建」分支仍会幂等补齐异地（覆盖「先配本机、
后配异地」与「异地目录被清空」两种情形）。

🛡 防泄露铁律：镜像目标解析后若落在仓库工作树内（等于仓库根或子目录；Windows 用
`os.path.normcase` 归一后比对，无法解析的路径一律按不安全处理）`exit 1` 拒绝——禁止把
本地层文档复制进可被 Git 跟踪的区域、变相纳入版本控制。刻意不提供任何硬编码默认路径
（守可移植性），必须显式 opt-in。

跨机恢复（`list` 与 `restore` 都接受 `--from DIR`，默认仍读本机 `backups/agents-snapshots/`）：

```sh
python scripts/snapshot_local_docs.py list --from <异地目录>                        # 查看异地副本
python scripts/snapshot_local_docs.py restore --from <异地目录> --dest <临时目录>   # 演练恢复
python scripts/snapshot_local_docs.py restore --from <异地目录>                     # 就地恢复到工作树
```

> 异地镜像只是「两台机器各留一份」的最小落地，仍**不替代正式异地备份**（对象存储 /
> 离线介质）。
