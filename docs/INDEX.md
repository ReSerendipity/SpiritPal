# 文档索引（docs/INDEX）

> 最后核对：2026-11-10　｜　维护：文档整理工单 WO-DOC-B01
> 本文件是 `docs/` 全量 tracked Markdown 的机器可读索引（42 篇：顶层 20 + `adr/` 5 + `project/` 2 + `execution/` 15）。
> [`README.md`](README.md) 保留为人类阅读入口（分组导读 + 资产清单 + 关联工程件）；两处冲突时以本文件为准。
> 治理规范见根 [`README.md`](../README.md) 引用的 ReSerendipity/.github/governance。

## 状态口径

| 状态 | 含义 |
|---|---|
| 现行 | 仍在指导当前工作，或仍是某项规则、协议、Schema、台账的有效来源 |
| 历史 | 时点记录（执行/测试/验收/审计快照），只作追溯 |
| 废弃 | 已被后继文档取代，或文件自身标注 Superseded / 作废 |

## 一、仓根入口文档

| 文档 | 用途 | 状态 | 核对日期 |
|---|---|---|---|
| [`README.md`](../README.md) | 面向用户的项目说明：角色互动桌宠的能力、截图与安装 | 现行 | 2026-11-10 |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | 架构说明（随目录结构同步，§12.5） | 现行 | 2026-11-10 |
| [`AGENTS.md`](../AGENTS.md) | 编码代理在本仓的执行契约 | 现行 | 2026-11-10 |
| [`CHANGELOG.md`](../CHANGELOG.md) | 版本变更记录 | 现行 | 2026-11-10 |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | 贡献指南（分支 / 提交 / DCO） | 现行 | 2026-11-10 |
| [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | 行为准则 | 现行 | 2026-11-10 |
| [`FIX_LOG.md`](../FIX_LOG.md) | 缺陷修复流水（按编号记录根因与验证） | 现行 | 2026-11-10 |
| [`LOCAL_RULES.md`](../LOCAL_RULES.md) | 本机环境相关的本地约定 | 现行 | 2026-11-10 |
| [`.github/SECURITY.md`](../.github/SECURITY.md) | 安全漏洞披露渠道（GitHub 策略入口） | 现行 | 2026-11-10 |
| [`docs/README.md`](README.md) | docs 入口索引：分组导航、资产清单与关联工程件 | 现行 | 2026-11-10 |

## 二、docs/ 顶层（合规、安全、协议、规范）

| 文档 | 用途 | 状态 | 核对日期 |
|---|---|---|---|
| [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) | 隐私政策（v1.1） | 现行 | 2026-11-10 |
| [`USER_AGREEMENT.md`](USER_AGREEMENT.md) | 用户协议（v1.0） | 现行 | 2026-11-10 |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | 第三方组件声明 | 现行 | 2026-11-10 |
| [`COMPLIANCE_CHECKLIST.md`](COMPLIANCE_CHECKLIST.md) | 合规备忘（数据出境 / Live2D / 社区功能） | 现行 | 2026-11-10 |
| [`SECURITY_MATRIX.md`](SECURITY_MATRIX.md) | 安全矩阵（控制措施对照） | 现行 | 2026-11-10 |
| [`SECURITY_AUDIT_SpiritPal.md`](SECURITY_AUDIT_SpiritPal.md) | 安全审计记录（2026-09-01 快照） | 历史 | 2026-11-10 |
| [`CODING_STANDARDS.md`](CODING_STANDARDS.md) | 编码与 Git 规范 | 现行 | 2026-11-10 |
| [`TECH_DEBT.md`](TECH_DEBT.md) | 技术债登记册（TD-xxx） | 现行 | 2026-11-10 |
| [`release-governance.md`](release-governance.md) | 发布 / 回滚规范（治理 §10 本地化落地） | 现行 | 2026-11-10 |
| [`RELEASE_NOTES.md`](RELEASE_NOTES.md) | 发布与更新流程（Release Notes 体例） | 现行 | 2026-11-10 |
| [`agent-contract.md`](agent-contract.md) | Agent 契约（治理模板逐字节复制，勿本地改） | 现行 | 2026-11-10 |
| [`LIVE2D_LICENSE_REMINDER.md`](LIVE2D_LICENSE_REMINDER.md) | Live2D 发行许可提醒（发行前必读） | 现行 | 2026-11-10 |
| [`LIVE2D_APPLICATION_DRAFT.md`](LIVE2D_APPLICATION_DRAFT.md) | Live2D 发行许可申请草稿（待提交） | 现行 | 2026-11-10 |
| [`CHARACTER_ATTRIBUTIONS.md`](CHARACTER_ATTRIBUTIONS.md) | 角色素材归属与授权台账 | 现行 | 2026-11-10 |
| [`CHARACTER_PERMISSION_REQUEST_DRAFTS.md`](CHARACTER_PERMISSION_REQUEST_DRAFTS.md) | 角色授权请求草稿合集（状态索引） | 现行 | 2026-11-10 |
| [`CHARACTER_PERMISSION_REQUEST_DRAFTS_doro.md`](CHARACTER_PERMISSION_REQUEST_DRAFTS_doro.md) | Doro 角色授权请求草稿（已获回复） | 历史 | 2026-11-10 |
| [`CHARACTER_PERMISSION_REQUEST_DRAFTS_feibi.md`](CHARACTER_PERMISSION_REQUEST_DRAFTS_feibi.md) | 菲比角色授权请求草稿（未获回复，已出包） | 历史 | 2026-11-10 |
| [`VR-10-角色显示名回填指引.md`](VR-10-角色显示名回填指引.md) | 角色显示名 `char.*` 五语言回填指引 | 现行 | 2026-11-10 |
| [`spiritpal-animation-tech-selection.md`](spiritpal-animation-tech-selection.md) | 桌宠动画类型选型报告（2026-08-26 决策依据） | 历史 | 2026-11-10 |
| [`../_archive/执行记录/2026-11/P0-1-人工review包.md`](../_archive/执行记录/2026-11/P0-1-人工review包.md) | P0-1 人工 Review 包（已关闭 2026-10-07） | 历史 | 2026-11-10 |
| [`../_archive/执行记录/2026-11/agent-review-视觉回归结果-2026-10-06.md`](../_archive/执行记录/2026-11/agent-review-视觉回归结果-2026-10-06.md) | 移动端视觉回归验证结果（2026-10-06） | 历史 | 2026-11-10 |

## 三、docs/adr/（架构决策记录）

| 文档 | 用途 | 状态 | 核对日期 |
|---|---|---|---|
| [`adr/README.md`](adr/README.md) | ADR 索引与格式规范（0005 为本地层文档，未随仓库发布） | 现行 | 2026-11-10 |
| [`adr/0001-tauri-v2-capabilities.md`](adr/0001-tauri-v2-capabilities.md) | ADR-0001：Tauri v2 + 最小权限 Capability | 现行 | 2026-11-10 |
| [`adr/0002-upload-magic-check.md`](adr/0002-upload-magic-check.md) | ADR-0002：上传文件魔数校验 | 现行 | 2026-11-10 |
| [`adr/0003-memory-system-cognee-vs-memvid.md`](adr/0003-memory-system-cognee-vs-memvid.md) | ADR-0003：记忆系统选型（cognee vs memvid） | 现行 | 2026-11-10 |
| [`adr/0004-pixi-live2d-version-lock.md`](adr/0004-pixi-live2d-version-lock.md) | ADR-0004：Pixi Live2D 版本锁定（2026-09-17 标 Superseded） | 废弃 | 2026-11-10 |

## 四、docs/project/（项目工程知识库）

| 文档 | 用途 | 状态 | 核对日期 |
|---|---|---|---|
| [`project/AI_DEV_SOPS.md`](project/AI_DEV_SOPS.md) | 典型 AI 开发场景 SOP | 现行 | 2026-11-10 |
| [`project/KNOWN_GOTCHAS.md`](project/KNOWN_GOTCHAS.md) | 坑点台账（2026-09-15 起停更归档，增量见本地层 `local/agents/GOTCHAS.md`） | 历史 | 2026-11-10 |

## 五、docs/execution/（执行、测试与验收记录）

| 文档 | 用途 | 状态 | 核对日期 |
|---|---|---|---|
| [`execution/RELEASE_VERIFICATION.md`](execution/RELEASE_VERIFICATION.md) | 发布验收清单（P1-1），仍作发布前对照 | 现行 | 2026-11-10 |
| [`execution/BACKUP_RESTORE_DRILL_2026-11-06.md`](execution/BACKUP_RESTORE_DRILL_2026-11-06.md) | 本地数据备份/恢复实测记录（2026-11-06，O4 P0） | 历史 | 2026-11-10 |
| [`execution/ROLLBACK_DRILL_2026-10-31.md`](execution/ROLLBACK_DRILL_2026-10-31.md) | 回滚演练记录（2026-10-31） | 历史 | 2026-11-10 |
| [`execution/android-device-test-20261001.md`](execution/android-device-test-20261001.md) | Android 真机全量测试报告 | 历史 | 2026-11-10 |
| [`execution/android-fix-verification-20261003.md`](execution/android-fix-verification-20261003.md) | Android 修复端上复测 | 历史 | 2026-11-10 |
| [`execution/chat-llama-e2e-20260928.md`](execution/chat-llama-e2e-20260928.md) | 安卓端 × 本地 llama.cpp 聊天链路实测（含 30 张证据截图的清单） | 历史 | 2026-11-10 |
| [`execution/frontend-p1-forensics-20261016.md`](execution/frontend-p1-forensics-20261016.md) | 前端工程体系 P1 四项取证登记 | 历史 | 2026-11-10 |
| [`execution/head-validation-20261006-no-push.md`](execution/head-validation-20261006-no-push.md) | HEAD 终态门禁本地复跑记录 | 历史 | 2026-11-10 |
| [`execution/ondevice-custom-model-pipeline.md`](execution/ondevice-custom-model-pipeline.md) | 端侧自定义模型交付流水线（MNN） | 现行 | 2026-11-10 |
| [`execution/agent-review-handoff-2026-10-05.md`](execution/agent-review-handoff-2026-10-05.md) | 移动端施工审计 · 执行交接 | 历史 | 2026-11-10 |
| [`execution/agent-review-handoff-2026-10-05-tickets.md`](execution/agent-review-handoff-2026-10-05-tickets.md) | 移动端施工审计 · 工单切片与验收判据 | 历史 | 2026-11-10 |
| [`execution/依赖与安全跟踪机制-20260911.md`](execution/依赖与安全跟踪机制-20260911.md) | 依赖与安全跟踪机制（口径仍有效） | 现行 | 2026-11-10 |
| [`execution/执行对照表-桌面分发与安全加固-20260910.md`](execution/执行对照表-桌面分发与安全加固-20260910.md) | 桌面分发与安全加固 · 执行对照表 | 历史 | 2026-11-10 |
| [`execution/落地执行总结-桌面分发与安全加固-20260910.md`](execution/落地执行总结-桌面分发与安全加固-20260910.md) | 桌面分发与安全加固 · 落地执行总结 | 历史 | 2026-11-10 |
| [`execution/2026-09-agent-memory-archive.md`](execution/2026-09-agent-memory-archive.md) | 2026-09 Agent 会话记忆归档（构建链 / 门禁 / 端侧 MNN / 加固落地状态） | 历史 | 2026-11-10 |

## 六、docs/ 内的资产与非 Markdown 配置

| 项 | 用途 | 状态 | 核对日期 |
|---|---|---|---|
| `assets/readme-spiritpal-2-interaction.svg` / `-4-architecture.svg` / `-shot-1-main.png` | 根 README 展示图（流程图 / 分层架构 / 真机截图） | 现行 | 2026-11-10 |
| `execution/assets/chat-llama-e2e-20260928/` | 该次实测的 30 张端上截图（证据清单见 `execution/chat-llama-e2e-20260928.md` §7.7 / §9.1 / §10） | 历史 | 2026-11-10 |
| `ci/branch-protection.json` + `ci/apply_branch_protection.py` | 分支保护清单与应用脚本（非 Markdown，不在文档改动范围） | 现行 | 2026-11-10 |
| `plans/` | 空目录，暂无入库内容 | — | 2026-11-10 |

## 七、docs/ 之外的同体系文档（目录级）

| 目录 | 用途 | 状态 | 核对日期 |
|---|---|---|---|
| [`.githooks/README.md`](../.githooks/README.md) | 本地 Git 钩子说明（含本地层文档快照机制） | 现行 | 2026-11-10 |
| [`perf/monitoring_plan.md`](../perf/monitoring_plan.md) | 性能监控计划 | 现行 | 2026-11-10 |
| [`scripts/`](../scripts/) | 素材管线与 CDP 脚本说明（2 篇） | 现行 | 2026-11-10 |
| [`tests/`](../tests/) | E2E 测试说明（1 篇） | 现行 | 2026-11-10 |
| [`src-tauri/`](../src-tauri/) | Rust 侧说明（7 篇，随代码维护，不在文档改动范围） | 现行 | 2026-11-10 |
| [`local/`](../local/) | **本地文档，未随仓库发布**：`agents/`（GOTCHAS / QUALITY_CONTRACT / ADR-0005 / REVISION_LOG 等）24 篇 | 现行 | 2026-11-10 |
| [`references/`](../references/) | 第三方参考资料（123 篇），随上游，本仓不维护 | 历史 | 2026-11-10 |
| [`_archive/`](../_archive/) | 归档 3 篇（`执行记录/2026-11/` 的 P0-1 review 包与视觉回归结果等） | 历史 | 2026-11-10 |
| `.qoder/`、`.trae/`、`.workbuddy/`、`.pytest_cache/` | 本地工具资产与缓存（合计 9 篇），不入库发布 | 历史 | 2026-11-10 |

> 引用本地层文档（`local/agents/**`、`AGENTS.md`）时必须标注「本地文档，未随仓库发布」，见 [`README.md`](README.md) §本地上下文指引。

## 八、索引维护规则

1. **新增文档**：归入对应目录并在本文件相应节补一行；`状态` 按上表口径判定；同时更新 [`README.md`](README.md) 的分组表。
2. **取代 / 归档**：被取代的文档在行内把 `状态` 改为 `废弃` 并写后继文档路径；需移走的入 `_archive/docs-archive-<YYYYMMDD>/`（保留原相对路径），**不删除**。
3. **本地层文档**：`local/agents/**` 不进入本文件逐文件清单（只做目录级说明），引用时必须标注「本地文档，未随仓库发布」。
4. **核对日期**：整仓复核时统一刷新。
