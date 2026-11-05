# SpiritPal 文档索引

> 本文件是 `docs/` 下全部 tracked Markdown 的统一入口索引（治理规范 §18.1「入链」）。
> 建立日期：2026-11-03。新增文档须在对应分组登记一行；被取代/归档的文档在行内补状态，不删条目。
> 治理规范见根 README 引用行（ReSerendipity/.github/governance）。

## 目录分组

- `docs/*.md` — 顶层：合规 / 安全 / 协议 / 规范 / 交付记录
- `docs/adr/` — 架构决策记录
- `docs/project/` — 项目工程知识库（SOP / 坑点台账）
- `docs/execution/` — 执行、测试与验收记录；证据截图在其下 `assets/`
- `docs/assets/` — README 展示图等静态资产
- `docs/ci/` — CI 辅助配置（非 Markdown）
- `docs/plans/` — 空目录（git 不追踪空目录，暂无入库内容）

## 顶层文档（docs/*.md）

| 文档 | 说明 |
|---|---|
| [COMPLIANCE_CHECKLIST.md](COMPLIANCE_CHECKLIST.md) | 合规备忘（数据出境 / Live2D / 社区功能） |
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | 隐私政策（v1.1） |
| [USER_AGREEMENT.md](USER_AGREEMENT.md) | 用户协议（v1.0） |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | 第三方组件声明 |
| [SECURITY_MATRIX.md](SECURITY_MATRIX.md) | 安全矩阵（控制措施对照） |
| [SECURITY_AUDIT_SpiritPal.md](SECURITY_AUDIT_SpiritPal.md) | 安全审计记录（2026-09-01） |
| [CODING_STANDARDS.md](CODING_STANDARDS.md) | 编码与 Git 规范 |
| [TECH_DEBT.md](TECH_DEBT.md) | 技术债登记册（TD-xxx） |
| [release-governance.md](release-governance.md) | 发布 / 回滚规范（§10 本地化落地） |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | 发布与更新流程（Release Notes） |
| [LIVE2D_LICENSE_REMINDER.md](LIVE2D_LICENSE_REMINDER.md) | Live2D 发行许可提醒 |
| [LIVE2D_APPLICATION_DRAFT.md](LIVE2D_APPLICATION_DRAFT.md) | Live2D 发行许可申请草稿 |
| [CHARACTER_ATTRIBUTIONS.md](CHARACTER_ATTRIBUTIONS.md) | 角色素材归属与授权台账 |
| [CHARACTER_PERMISSION_REQUEST_DRAFTS.md](CHARACTER_PERMISSION_REQUEST_DRAFTS.md) | 授权请求草稿合集（状态索引） |
| [CHARACTER_PERMISSION_REQUEST_DRAFTS_doro.md](CHARACTER_PERMISSION_REQUEST_DRAFTS_doro.md) | Doro 授权请求草稿（已获回复） |
| [CHARACTER_PERMISSION_REQUEST_DRAFTS_feibi.md](CHARACTER_PERMISSION_REQUEST_DRAFTS_feibi.md) | 菲比授权请求草稿（未获回复，已出包） |
| [P0-1-人工review包.md](P0-1-人工review包.md) | P0-1 人工 Review 包（已关闭 2026-10-07） |
| [VR-10-角色显示名回填指引.md](VR-10-角色显示名回填指引.md) | 角色显示名 char.* 五语言回填指引 |
| [agent-contract.md](agent-contract.md) | Agent 契约（治理模板逐字节复制） |
| [agent-review-视觉回归结果-2026-10-06.md](agent-review-视觉回归结果-2026-10-06.md) | 移动端视觉回归验证结果 |
| [spiritpal-animation-tech-selection.md](spiritpal-animation-tech-selection.md) | 桌宠动画类型选型报告（2026-08-26） |

## 架构决策记录（docs/adr/）

| 文档 | 说明 |
|---|---|
| [adr/README.md](adr/README.md) | ADR 索引与格式规范（0005 为本地层文档） |
| [adr/0001-tauri-v2-capabilities.md](adr/0001-tauri-v2-capabilities.md) | Tauri v2 + 最小权限 Capability |
| [adr/0002-upload-magic-check.md](adr/0002-upload-magic-check.md) | 上传文件魔数校验 |
| [adr/0003-memory-system-cognee-vs-memvid.md](adr/0003-memory-system-cognee-vs-memvid.md) | 记忆系统选型 |
| [adr/0004-pixi-live2d-version-lock.md](adr/0004-pixi-live2d-version-lock.md) | Pixi Live2D 版本锁定（Superseded 2026-09-17） |

## 项目工程知识库（docs/project/）

| 文档 | 说明 |
|---|---|
| [project/AI_DEV_SOPS.md](project/AI_DEV_SOPS.md) | 典型 AI 开发场景 SOP |
| [project/KNOWN_GOTCHAS.md](project/KNOWN_GOTCHAS.md) | 坑点台账（2026-09-15 起历史归档，增量见本地层 GOTCHAS） |

## 执行 / 测试 / 验收记录（docs/execution/）

| 文档 | 说明 |
|---|---|
| [execution/RELEASE_VERIFICATION.md](execution/RELEASE_VERIFICATION.md) | 发布验收清单（P1-1） |
| [execution/BACKUP_RESTORE_DRILL_2026-11-06.md](execution/BACKUP_RESTORE_DRILL_2026-11-06.md) | 本地数据备份/恢复实测记录（2026-11-06，O4 P0） |
| [execution/ROLLBACK_DRILL_2026-10-31.md](execution/ROLLBACK_DRILL_2026-10-31.md) | 回滚演练记录（2026-10-31） |
| [execution/android-device-test-20261001.md](execution/android-device-test-20261001.md) | Android 真机全量测试报告 |
| [execution/android-fix-verification-20261003.md](execution/android-fix-verification-20261003.md) | Android 修复端上复测 |
| [execution/chat-llama-e2e-20260928.md](execution/chat-llama-e2e-20260928.md) | 安卓端 × 本地 llama.cpp 聊天链路实测 |
| [execution/frontend-p1-forensics-20261016.md](execution/frontend-p1-forensics-20261016.md) | 前端工程体系 P1 四项取证登记 |
| [execution/head-validation-20261006-no-push.md](execution/head-validation-20261006-no-push.md) | HEAD 终态门禁本地复跑记录 |
| [execution/ondevice-custom-model-pipeline.md](execution/ondevice-custom-model-pipeline.md) | 端侧自定义模型交付流水线（MNN） |
| [execution/agent-review-handoff-2026-10-05.md](execution/agent-review-handoff-2026-10-05.md) | 移动端施工审计 · 执行交接 |
| [execution/agent-review-handoff-2026-10-05-tickets.md](execution/agent-review-handoff-2026-10-05-tickets.md) | 移动端施工审计 · 工单切片与验收判据 |
| [execution/依赖与安全跟踪机制-20260911.md](execution/依赖与安全跟踪机制-20260911.md) | 依赖与安全跟踪机制 |
| [execution/执行对照表-桌面分发与安全加固-20260910.md](execution/执行对照表-桌面分发与安全加固-20260910.md) | 桌面分发与安全加固 · 执行对照表 |
| [execution/落地执行总结-桌面分发与安全加固-20260910.md](execution/落地执行总结-桌面分发与安全加固-20260910.md) | 桌面分发与安全加固 · 落地执行总结 |
| [execution/2026-09-agent-memory-archive.md](execution/2026-09-agent-memory-archive.md) | 2026-09 Agent 会话记忆归档（构建链 / 门禁 / 端侧 MNN / 加固计划落地状态） |

## 资产（docs/assets/ 与执行证据）

- [assets/readme-spiritpal-2-interaction.svg](assets/readme-spiritpal-2-interaction.svg) — README 交互流程图
- [assets/readme-spiritpal-4-architecture.svg](assets/readme-spiritpal-4-architecture.svg) — README 分层架构图
- [assets/readme-spiritpal-shot-1-main.png](assets/readme-spiritpal-shot-1-main.png) — README 真实运行截图
- `execution/assets/chat-llama-e2e-20260928/` — 该次实测的 30 张端上截图；证据清单（文件名 ↔ 内容）单独见 [execution/chat-llama-e2e-20260928.md](execution/chat-llama-e2e-20260928.md) §7.7 / §9.1 / §10

## 非 Markdown 配置（docs/ci/、docs/plans/）

- `ci/branch-protection.json` + `ci/apply_branch_protection.py` — 分支保护清单与应用脚本
- `plans/` — 空目录，暂无入库内容

## 关联工程件（docs/ 之外的同体系文档）

- [ARCHITECTURE.md](../ARCHITECTURE.md) — 架构说明（§12.5，随目录结构同步）
- [CHANGELOG.md](../CHANGELOG.md) — 版本变更记录
- [CONTRIBUTING.md](../CONTRIBUTING.md) — 贡献指南
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) — 行为准则
- [.github/SECURITY.md](../.github/SECURITY.md) — 安全漏洞披露渠道
- [.githooks/README.md](../.githooks/README.md) — 本地 Git 钩子说明（含本地层文档快照机制）
- [perf/monitoring_plan.md](../perf/monitoring_plan.md) — 性能监控计划
- [scripts/asset-pipeline/README.md](../scripts/asset-pipeline/README.md) — 素材管线脚本说明
- [scripts/cdp/README.md](../scripts/cdp/README.md) — CDP 脚本说明
- [tests/e2e/README.md](../tests/e2e/README.md) — E2E 测试说明

## 本地上下文指引

`AGENTS.md`、`local/agents/**`（GOTCHAS / QUALITY_CONTRACT / ADR-0005 等）为**本地文档，未随仓库发布**；其快照机制见 [.githooks/README.md](../.githooks/README.md)。引用本地层文档时必须标注「本地文档，未随仓库发布」。
