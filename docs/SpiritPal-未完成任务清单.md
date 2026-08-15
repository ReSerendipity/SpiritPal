# SpiritPal 未完成任务清单

> 生成日期：2026-08-14
> 覆盖范围：第五轮记忆系统评估报告 + S2 记忆存储重构方案 + 后续核查发现的所有未完成项
> 已完成基线（不在本清单）：F1–F11 全部修复；S2 M0–M5 全部落地并通过 vitest 1474 / cargo 160 回归

---

## 一、验证 / 手工验收类（需真实运行环境）

| # | 任务 | 来源 | 具体内容与验收标准 | 优先级 |
|---|------|------|-------------------|:------:|
| V-1 | S2 真实构建手工验收 | S2 方案 §9 / 附录「待办」 | `npx tauri build` 出包 → 安装运行 → 连续多轮对话 → 重启应用 → 记忆完整保留（含最近一轮对话）；检查 `app_data_dir`（`%APPDATA%\com.xxx\`）磁盘上无 `*.db-wal` / `*.db-shm` 明文残留，仅有 `spiritpal.db.enc` | P0 |
| V-2 | 迁移正确性验收（存量用户视角） | S2 方案 §4 | 用旧版本 blob 数据启动新版本 → 迁移日志显示行数正确 → 重启后记忆、画像引用、触发状态均正常；`settings` 中 `.legacy` 备份存在 | P0 |
| V-3 | 体验级验收（一周） | 第五轮报告 §11 阶段 3 | 连续一周使用：无复读、无打扰投诉；主动回忆内容与当前情境相关率人工抽检 ≥70% | P1 |
| V-4 | 性能基准 | S2 方案 §9、第五轮附录 A | 1000 条记忆规模下：写入耗时对比（改造前后）；退出 at-rest 加密耗时；冷启动耗时（行级加载 vs 旧 blob 加载） | P2 |

---

## 二、代码改进类（可直接开工）

### P1（建议尽快）

| # | 任务 | 来源 | 现状与改动点 |
|---|------|------|-------------|
| T-1 | **二期迁移：四个 per-value blob 模块行级化** | S2 决策 D1-A 后续 | `ownerFacts.ts` / `petExperience.ts` / `visualMemoryManager.ts` / `entityLinking.ts` 各仍保留 1 处 `encrypt_data`。复用 `memoryMigrator` 模式：各自建表（或复用 settings 明文行）+ 独立迁移标记 + `.legacy` 备份 + 双模式回退。每模块独立小步验收 |
| T-2 | **清理 eslint warning（当前 5 条 → 0）** | S2 附录「待办」 | `enhancedMemory.ts:51/54` 新增未使用导入 `deleteMemorySummary` / `deleteMemoryState`（如确认不需要直接删除，或在 `clear()` 路径补用）；历史遗留：`FESTIVALS`(88)、`_unused`(359)、`opts`(1576) |
| T-3 | **recallEngine 情绪一致性接入真实情绪** | F2 收尾 | `recallEngine.ts:547+` `computeMoodCongruence` 已改为 valence 比较，但 `currentValence = 0` 硬编码（`getContextAwarenessManager()` 调用了但返回值未用）。应与 `enhancedMemory.getCurrentMood()` 同源（或由调用方传入当前情绪），否则"情绪一致回忆"在 recall 打分中仍近似中性 |
| T-4 | **semantic 容量配置生效** | F4 收尾 | `memoryTypes.ts:317` `semanticCapacity=30` 定义但未被读取；`compressEpisodic` 的 2000 字符与 `applyConsolidation` 的 5000 字符仍硬编码。统一改为读 `categoryConfig.semanticCapacity`（或明确该字段语义为 token 而非字符） |

### P2（中期）

| # | 任务 | 来源 | 现状与改动点 |
|---|------|------|-------------|
| T-5 | visualMemory 参与检索召回 | F7 收尾 | 现状：`ChatWindow:369` 固定注入 `buildContext(200)`（"最近感知"）；未进入 `searchEpisodic` 检索索引。建议：观察类记忆以 `source_kind='observation'` 落 `memories` 行，参与 RAG/实体检索 |
| T-6 | emotionExtractor ↔ 记忆情感打通 | F7 收尾 | `emotionExtractor`（LLM 输出 `[emotion:xxx]`）目前仅驱动动画/好感度；记忆侧 valence/arousal 仍靠规则词表 `assessEmotion3D`。建议：对话结束后将提取的情绪标签回写为当轮记忆的 valence/arousal（覆盖或融合规则值） |
| T-7 | Agent 工具意图路径注入记忆 | D8 收尾 | `ChatWindow:237` `processAgentRequest` 分支疑似未拼接记忆上下文（需先核查现状；重新生成路径 609 与移动端 MobileChatView:152 已注入 ✓）。如确认缺失，为 Agent 路径补 `getContextForChat` 注入 |
| T-8 | 响应式触发限流 | 第四轮 §6 纪律项 | `canTrigger`（每日 5 次/30min/忽略降频）仅对 `periodic` 生效；`relevance/emotion/keyword/frequency` 每轮对话都可能触发。建议把预算纪律扩展到全部响应式触发 |
| T-9 | contextFit 多信号化 | 第五轮阶段 3 建议 | `recallEngine.computeContextFit` 仅用当前小时；天气/音乐/工作状态（`contextAwareness` 已有）未进打分。`buildContextHints` 已含 workState，打分侧补上即可 |
| T-10 | 响应判定语义化 | 第四轮 §6 纪律项 | `recordUserResponse` 目前由"用户任意发一条消息"触发，无法区分"接住话题"与"聊别的"。建议：5 分钟窗口内用户消息与触发素材检索分 >0.4 才算有效响应，否则记为忽略（降频才可信） |

### P3（可选 / 合规 / 卫生）

| # | 任务 | 来源 | 说明 |
|---|------|------|------|
| T-11 | GDPR 导出闭环 + PII 掩码（可选） | 第五轮 §10 F6 延伸 | 导出/删除已覆盖 SQLite（F6 ✓）；建议：导出时在设置页展示"含哪些个人数据"清单；可选 PII 掩码（报告阶段 4 标注为可选） |
| T-12 | 统一 memoryConfig | 第五轮附录 A | 触发上限/间隔/忽略阈值、注入冷却 24h、向量阈值 0.45、proactive 节奏（5min/0.3/60s）、维护定时（6h/23:30）等仍散落硬编码，建议迁入单一配置模块（F4 已完成容量部分） |
| T-13 | at-rest 流式加密 | S2 方案 E4 优化项 | `encrypted_db.rs` 现为全文件读入内存 + base64 + AES（100MB DB 峰值内存约 400MB）。DB 预估 <50MB 可暂缓，列为优化项 |
| T-14 | 死代码清理 | 第五轮附录 B | `timeDecaySort`（无调用点，已废弃委托 calculateForgettingScore）、`triggerMechanism.ts` / `aiMemoryManager.ts`（若仍零调用，先 grep 确认） |
| T-15 | 文档同步 | AGENTS.md 自进化协议 | AGENTS.md 描述已落后于实际（记忆系统已行级化、S2 落地），按协议补 Known Gotchas 与修订记录；docs 归档 S2 实施记录，延续评估报告编号体系 |

---

## 三、待用户决策项

| # | 决策 | 选项 | 我的推荐 |
|---|------|------|:--------:|
| D-1 | 二期迁移范围 | 四个模块全迁 / 只迁 ownerFacts（最敏感） / 暂不迁 | 只迁 ownerFacts 先行验证模式，其余按需 |
| D-2 | 移动端 at-rest 加密 | 跳过（依赖系统沙箱） / 与桌面一致 | 跳过（移动端退出时机不可靠，沙箱已隔离） |
| D-3 | `.legacy` 备份清理 | 永久保留 / 设置页提供手动清理入口 | 保留 + 设置页清理入口（避免磁盘无感膨胀） |
| D-4 | V-3 一周体验验收是否立项 | 是 / 仅抽查 | 抽查即可（人工抽检 20 条主动回忆） |

---

## 四、建议执行顺序

1. **先做验证**：V-1（真实构建手工验收）是 S2 的最终兜底，应最先做，若发现迁移/加密问题立即回滚到双模式开关。
2. **再清代码**：T-2（warning 清零）→ T-3（情绪一致性收尾）→ T-4（容量配置）→ T-1（ownerFacts 二期先行）。
3. **后做体验**：T-5 ~ T-10（多模态与纪律），每个独立小步、独立回归。
4. **合规与文档**：T-11 ~ T-15 穿插或最后统一处理。

---

## 五、核查结果（2026-08-15 全量复核）

对 V-1~V-4、T-1~T-15 逐项核对代码证据 + 全量回归（vitest 61 文件 / 1494 通过 / 7 跳过 ✓；tsc 0 错误 ✓；cargo 160 通过 ✓；AGENTS.md 自进化协议已更新至 v1.2 ✓）。

### 已完成项（有代码证据）

| 任务 | 结论 | 证据 |
|------|:----:|------|
| T-3 | ✅ | `recallEngine` 新增 `currentMood` + `setCurrentMood()`，`proactiveSpeak.ts:219` 已接线 `memMgr.getCurrentMood()` |
| T-4 | ✅ | `semanticSummaryMaxChars=2000` / `semanticConsolidationMaxChars=5000` 配置化，`enhancedMemory.ts:943/2274` 读取 |
| T-7 | ✅ | Agent 路径注入记忆（`ChatWindow.tsx:237-245`，2000 tokens）+ 结果写回记忆（250） |
| T-8 | ✅ | `canTriggerResponsive()`（`enhancedMemory.ts:1056`）接入 `checkTriggers`（976） |
| T-9 | ✅ | `computeContextFit` 多信号：时间 + 工作状态（coding/meeting/idle）+ 音乐（`recallEngine.ts:543-572`） |
| T-10 | ✅ | 5 分钟响应窗口 + 相似度 >0.4 或长消息判有效响应（`usePetMemoryTriggers.ts:80-101`） |
| T-14 | ✅ | `timeDecaySort` / `triggerMechanism` / `aiMemoryManager` 均已清除 |
| T-1（ownerFacts） | ✅ | `owner_facts` 表 + 迁移标记 + `loadFromRows/migrateToRows` + `.legacy` + 双模式（`db.ts:315-330,873-928`、`ownerFacts.ts`） |

### 未完成 / 需复查项

| 任务 | 结论 | 说明 |
|------|:----:|------|
| T-1（其余三模块） | ⚠️ 部分 | `petExperience` / `visualMemoryManager` / `entityLinking` 仍各保留 1 处 per-value `encrypt_data`，未迁移（建议按 D-1 逐个推进） |
| T-2 | ⚠️ 未清零 | 旧 5 条 warning 已清，但 **`usePetDragging.ts:251` 新增 1 条 react-hooks/immutability error**（`dragWinOriginRef.current = {...}` 被判定为修改传入 hook 的值）。修法：该处加 `// eslint-disable-next-line react-hooks/immutability` 并注释原因，或把赋值提前到 hook 依赖捕获之前 |
| T-5 | ❌ | visualMemory 仍为 ChatWindow 固定注入（`buildContext(200)`），未接入 `searchEpisodic` 检索 |
| T-6 | ❌ | emotionExtractor（LLM 情绪标签）与记忆侧 valence/arousal 未打通 |
| T-11 | ❌ | `dataManager.exportAll()` 无导出内容清单/PII 掩码 |
| T-12 | ❌ | 无统一 `memoryConfig` 模块（T-4 仅完成 semantic 部分，触发/冷却/阈值常量仍散落） |
| T-13 | ❌ | `encrypted_db.rs` 仍全量 `fs::read` + base64（优化项，DB <50MB 可暂缓） |
| T-15 | ⚠️ 部分 | AGENTS.md 已更新 v1.2 ✓；但 docs/ 未归档本评估系列三份文档（第五轮报告 / S2 方案 / 本清单），建议复制进 `docs/` 延续编号体系 |
| V-1 | ⚠️ **需复查** | artifacts 已有 2026-08-14 22:14 构建的 0.1.0 产物 ✓；但 `%APPDATA%\com.spiritpal.desktop-pet\` 下是**明文 `spiritpal.db` 且无 `spiritpal.db.enc`**（当前无进程运行）→ 最近一次运行退出加密未落盘（可能为 dev 模式强退所致，也可能加密链路问题）。**必须**用正式安装包做一次「安装 → 对话 → 正常退出 → 检查 .enc 生成且无 -wal 残留」的完整验收 |
| V-2 / V-3 / V-4 | ⚠️ | 需运行时/时间验证：存量迁移验收、一周体验抽检、性能基准（均无记录） |
| D-2/D-3/D-4 | ⚠️ | 未见落实（`.legacy` 清理入口等决策未实施，可后续处理） |

### 下一步（按序）

1. **V-1 复查（最优先）**：用 `artifacts/SpiritPal_0.1.0_x64-setup.exe` 安装 → 对话 → 正常退出 → 确认生成 `spiritpal.db.enc` 且明文/`-wal` 消失。若加密未触发，优先查 `lib.rs` RunEvent 分支是否随安装版生效。
2. **修 eslint error**：`usePetDragging.ts:251` 一行 disable + 注释，恢复 `pnpm lint` 全绿。
3. **T-1 剩余三模块**：petExperience → visualMemoryManager → entityLinking 按 ownerFacts 模式逐个迁移（各 ~0.5 天）。
4. 体验项（T-5/T-6/T-9 天气信号/T-10 阈值校准）与合规项（T-11/T-12）按优先级插队。
