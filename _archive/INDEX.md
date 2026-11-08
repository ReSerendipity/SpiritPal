# SpiritPal 归档索引（_archive/）

> 归档区按治理规范 §12.1 使用仓根 `_archive/`（下划线前缀＝非活动区，§10 审计自动豁免）。
> 归档只移动文件、不改写正文；`docs/README.md` 中两条索引链接已改新路径。

| 原路径 | 归档后路径 | 归档日 | 类别 | 一句话结论 | 是否仍被引用 |
|---|---|---|---|---|---|
| `docs/P0-1-人工review包.md` | `_archive/执行记录/2026-11/P0-1-人工review包.md` | 2026-11-08 | 执行记录（已关闭） | P0-1 安卓 at-rest 加密 / 备份链的人工 review 包，状态「✅ 已关闭（2026-10-07）」，两点合规判断已裁决 | 是：`docs/README.md:37`（已改新路径） |
| `docs/agent-review-视觉回归结果-2026-10-06.md` | `_archive/执行记录/2026-11/agent-review-视觉回归结果-2026-10-06.md` | 2026-11-08 | 执行记录（一次性验证） | 移动端视觉回归验证结果（2026-10-06，基线 `main @ d3e9d0c`，模拟器 LawnchairApi35 + CDP 走查） | 是：`docs/README.md:40`（已改新路径） |

## docs/execution/ 处置裁决（2026-11-08）

`docs/execution/`（45 个已跟踪文件：12 篇 md + 30 张证据 png + 3 个其他）**本次不迁移、不解除跟踪**，沿用本仓既有成文授权，理由如下：

1. `LOCAL_RULES.md` 第 4 条（2026-10-17 更正）：执行记录与证据截图归**公开层**并纳入版本控制——这是本仓对治理 §7.1 的更具体、更晚的仓级口径。
2. `.github/workflows/self-purify.yml`（2026-10-20）：已为 `^docs/execution/` 加仓级豁免，注释明示「不按『本地治理文档』判违规」。
3. `scripts/check-exec-docs-tracked.mjs`：入库防护门禁，注释记载「docs/execution/ 曾被 self-purify 移出跟踪（commit `e2a9699`），**经用户授权恢复**（commit `3578975`，2026-09-11）」；`EXEC_DOCS_REQUIRED` 硬编码 4 篇必须被跟踪，接入 `structure-guard.yml`，一旦移出跟踪 CI 立即红。
4. 外部另有 24 个文件引用 `docs/execution`（含 workflows、README 中英双语、源码与测试注释），迁移会同步打断这些锚点。

> 治理 §7.1「`docs/execution/**` 不入库，仅 `RELEASE_VERIFICATION.md` 白名单」与本仓上述三条仓级规则构成成文冲突；本次按仓级规则优先处置，冲突本身已登记在 `LOCAL_RULES.md` 第 4 条与门禁脚本注释中，无需重复另立文档。
> 注：`self-purify.yml` 注释中「41 个已跟踪文件（8 篇 md + 30 张 png + 3 篇白名单文档）」为 2026-10-20 时的旧计数，现为 45 个（12 篇 md + 30 张 png + 3 个其他）；本次不修改该注释（属工作流配置正文，改动需另立工单）。

## 未归档（活动文档，判定理由）

| 文档 | 保留理由 |
|---|---|
| `docs/VR-10-角色显示名回填指引.md` | 回填**工作表与流程**，显式写明「en/ja/ko 回填归用户本人、不含 AI 生成译名」——回填动作尚未结束，仍为活动指引 |
| `docs/LIVE2D_LICENSE_REMINDER.md`、`docs/LIVE2D_APPLICATION_DRAFT.md` | 公开发布前的 Live2D 发行许可**待办**（提醒 + 申请草稿，草稿要求发送后回填状态） |
| `docs/CHARACTER_PERMISSION_REQUEST_DRAFTS*.md`（含 `_doro` / `_feibi` 分版） | 角色授权申请草稿，属未完成的对外动作 |
| `docs/spiritpal-animation-tech-selection.md` | 2026-08-26 动画技术选型报告：给出选型依据与对比结论，是长期决策依据而非一次性留痕 |
| `docs/SECURITY_AUDIT_SpiritPal.md` | 安全审计结论，与 `docs/SECURITY_MATRIX.md`、`docs/COMPLIANCE_CHECKLIST.md` 构成现行合规面 |
| `docs/README.md`、`docs/release-governance.md`、`docs/agent-contract.md`、`docs/CODING_STANDARDS.md`、`docs/COMPLIANCE_CHECKLIST.md`、`docs/SECURITY_MATRIX.md` | 索引 / 规范 / 合规矩阵 |
| `docs/PRIVACY_POLICY.md`、`docs/USER_AGREEMENT.md`、`docs/THIRD_PARTY_NOTICES.md`、`docs/CHARACTER_ATTRIBUTIONS.md` | 法律与署名文本 |
| `docs/RELEASE_NOTES.md`、`docs/CODE_OF_CONDUCT.md`、`docs/adr/*`（5 篇）、`docs/project/*`（2 篇）、`docs/ci/*`、`docs/assets/*` | 发布说明 / 行为准则 / ADR（§12.5 条款 8 不迁移）/ 项目文档 / CI 文档 / README 展示图 |
| `docs/TECH_DEBT.md`（40KB） | 现行技术债台账（体量分卷属批 6 议题，本轮不动） |

## 例外登记

| 位置 | 说明 |
|---|---|
| `docs/execution/*`（45 个文件） | 见上「处置裁决」，整目录保留原位 |
| `CHANGELOG.md`、`docs/execution/*` 内对已归档两篇的提及 | 历史记录与执行留痕，按既定口径不改写正文 |
