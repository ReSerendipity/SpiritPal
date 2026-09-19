# .githooks

本仓库的 Git 钩子源码。启用一次即可：

```sh
git config core.hooksPath .githooks      # 或执行 ./.githooks/install.sh
```

启用后钩子直接从本目录读取，**改这里立即生效**，不需要再往 `.git/hooks` 复制文件。

| 钩子 | 作用 |
| --- | --- |
| `pre-commit` | 先做本地层文档快照（尽力而为）；有 `.pre-commit-config.yaml` 且框架可用 → 走 pre-commit（先试 `.venv`/`python -m pre_commit`，再退回 PATH 上的 `pre-commit` 控制台命令）；否则走 `pre-commit-lite` |
| `pre-push` | 执行仓库内 `precheck.ps1`（无则退回根目录守卫） |
| `prepare-commit-msg` | 自动追加 `Signed-off-by`（幂等，插在注释块之前） |
| `commit-msg` | DCO 硬校验（缺签名阻断）+ conventional 规范软提示 |
| `post-merge` / `post-checkout` | 依赖清单变更提醒（pip / pnpm / npm / cargo / gradle）+ 本地层文档快照 |
| `pre-commit-lite` | 轻量检查：大文件、私钥与令牌、冲突标记 + 根目录守卫 |

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
