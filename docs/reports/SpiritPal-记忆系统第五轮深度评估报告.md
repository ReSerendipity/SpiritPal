# SpiritPal 记忆系统第五轮深度评估报告

> 评估日期：2026-08-14
> 评估范围：第四轮（2026-08-07）报告所提 S/W/R 系列优化 + 阶段 0 止血（2026-08-08）落地后的主干代码
> 评估方法：静态源码精读（`src/lib` 记忆相关模块 + `src-tauri/src/crypto.rs` / `db.ts`）+ 关键论断逐一核实
> 本轮定位：在用户提出的六个维度框架下，对"拟人记忆 + 打破第四面墙"目标做第五轮体检，并对第四轮遗留事项做落地核对

---

## 一、执行摘要

与第四轮"骨架完备，灵魂未至"的结论相比，本轮可以给出一个更积极的判断：**主干已经闭合，灵魂正在补上，但仍有一处会直接导致"杀手级特性"失效的 P0 缺陷需要立即止血。**

第四轮报告提出的绝大多数方向性建议已被认真落地并接入了真实调用链：统一回忆管线 `recallEngine.ts` 已实现并在 `usePetMemoryTriggers` 与 `proactiveSpeak` 中接线；约定追踪 `commitmentTracker.ts` 与上下文快照 `contextEpisodeManager.ts` 已建表并在 `usePetTimers` 中接线；情感三维化（valence/arousal）、记忆强度（strength）、闪光灯记忆、LLM 显著性重评、每晚巩固（`runNightlyConsolidation`）均已实现；第四轮列出的 D1（ENC 前缀）、D2（孤儿行）、D4（日记 tags）、D6（"记住"双写）、D7（双重检索）、D10（农历节日）、D11（空闲门槛）等缺陷均已修复。

但本轮发现一个新的 **P0 级回归**：`db.ts` 中的 `commitments` 表结构与 `commitmentTracker.ts` 的 SQL 不一致——表里没有 `repeat` 列，而保存约定时却向 `repeat` 列写入。这意味着**每次宠物从对话中抽取到"计划/约定"并落库时都会抛出 SQL 错误，约定追踪（第四轮定位的"最接近真人的杀手级特性"）在真实运行环境中实际上是不可用的**。

六维评分（相对"拟人记忆"目标，满分 10）：

| 维度 | 得分 | 一句话评价 |
|------|:----:|-----------|
| 1. 记忆存储机制 / 持久化 / 故障恢复 | 7.0 | 加密栈与孤儿治理已就绪，但双轨整包重加密未根治、缺记忆级故障恢复 |
| 2. 上下文检索 / 关联度 / 多模态索引 | 7.0 | RAG 混合检索已对齐业界，但情绪一致性公式错误、实体/视觉/情感多模态仍孤立 |
| 3. 用户个性化 / 隐私合规 / 脱敏 | 7.5 | 本地优先 + PBKDF2 加密 + 密钥脱敏到位，但"全量删除"不覆盖 SQLite、记忆原文无脱敏 |
| 4. 短期 / 长期切换 / 容量 / 优先级 | 6.5 | 晋升/巩固/压缩齐备，但容量配置与实现多处脱节、硬编码散落 |
| 5. 遗忘机制 / 更新触发 / 冲突解决 | 6.0 | 艾宾浩斯公式方向已修正并引入 strength，但存在三套并行衰减模型、冲突解决过简 |
| 6. 长周期多轮连贯性 / 状态一致性 / 回溯 | 6.5 | 四段式注入 + 冷却 + 缺席/周年/约定回溯已实现，但 token 预算管理器仍未接线 |
| **类人特征 & 第四面墙** | **6.0** | 情感/场景/跨会话继承部分达成，元认知自我指涉基本缺失 |

---

## 二、维度一：记忆存储机制、持久化与故障恢复

**现状。** 记忆在物理上仍是"双轨制"：完整四层结构（working/episodic/semantic/autobiographical）以一个 JSON blob 存于 `settings` 表（`enhancedMemory` 的 `doSave` 全量序列化后经 `encrypt_data` 加密写回），同时每条记忆又向 `memories` 表写入 `content + embedding` 用于向量检索。加密栈本身质量很高：`crypto.rs` 采用 AES-256-GCM + PBKDF2-HMAC-SHA256（10 万次迭代，NIST 推荐量级），密文带 `ENC2:` 前缀，并保留 `ENC1:`（旧 SHA-256）向后兼容；解密函数同时支持两种前缀。数据库层面启用了 WAL、`synchronous=NORMAL`、`busy_timeout`，并新增 R-14 库级落盘加密（退出时 `encrypt_db_at_rest`、启动时解密）。

**值得肯定。** 第四轮的 D1 已彻底修复——`enhancedMemory / ownerFacts / petExperience / visualMemoryManager / entityLinking` 五个模块的 `load()` 均已改为 `raw.startsWith('ENC1:') || raw.startsWith('ENC2:')` 双前缀判断，并补齐了 ENC2 往返测试。D2（孤儿行）也已修复——遗忘/晋升/巩固/合并/删除路径统一走 `purgeMemoriesFromStore` / `deleteMemory` 同步清理 SQLite 行与 embedding。

**风险。** 一是 D3（整包重加密）仍在：任何一条记忆变动都触发全量 JSON 序列化 + PBKDF2 派生 + AES 加密 + 整行覆写，性能随记忆量线性恶化，第四轮建议的"库级加密替代每值加密"或"行级写入"（S2）未落地。二是**记忆级故障恢复缺失**：`enhancedMemory.load()` 解密失败时直接 `return`（等价于空数据），既无备份、无校验和、无损坏检测、也无回滚；`beforeunload` 里的库级加密是 best-effort 的异步调用，异常退出时存在留下明文或半加密状态的可能。三是 `DataManager.resetAll()` 只清 localStorage、不清 SQLite（详见维度三）。

---

## 三、维度二：上下文检索、关联度计算与多模态索引

**现状。** 检索主链路为三层降级：RAG 混合检索（`ragRetrieval.ts`，BM25 + 向量 + RRF 融合 + 动态 alpha）→ 向量检索（Top-K 堆）→ LCS 字符串相似度。第四轮的 S3 已落地：`retrieve()` 统一入口让 `checkTriggers` 与 `getContextForChat` 共享检索结果，并做 5 秒结果缓存。`computeMultiFactorScore` 统一了多因子加权：`baseScore*0.5 + recency*0.15 + importance*0.3 + emotionalBoost + temporalBoost + moodFit - traumaPenalty`。

**风险。** 存在一个**公式性错误**：`computeMultiFactorScore` 中的 `moodFit = Math.max(0, 1 - Math.abs(mem.emotionalValence)) * 0.15`。这个式子奖励的是"情绪接近中性"的记忆，而非第四轮原设计"当前情绪与记忆情绪越贴近越易想起"（应是 `1 - |mood.valence - mem.valence|`）。更关键的是该函数根本没有接收"用户当前情绪"参数——所谓情绪一致性目前是个不存在的信号。`recallEngine.ts` 里的 `computeMoodCongruence` 同样只是对 `emotionalIntensity` 求平均，而非真实的情绪一致性。

**多模态仍是孤岛。** `entityLinking.ts` 自述"简化实现：使用规则 + NER 模式提取实体，**不做嵌入关联（留待 P5）**"，且 `getLinkedMemoryIds` 未被检索主链路调用——实体检索没有真正接入。`visualMemory` 未参与对话召回路径。`emotionExtractor.ts` 负责的是从 LLM 输出解析 `[emotion:xxx]` / `[affection:±N]` 以驱动动画，与记忆侧基于词表的情感打分（`assessEmotion3D`）是两套互不相交的系统。因此"情感标签、视觉记忆、实体关联"这三类多模态信号目前都未真正进入检索排序。

---

## 四、维度三：用户个性化处理、隐私合规与脱敏

**现状。** 隐私底座是扎实的：数据本地优先（PRD 明确不上云）、敏感数据 AES-256-GCM 加密、`llmClient.redactErrorText` 对 OpenAI/Anthropic/Gemini/国内厂商密钥与 Bearer token 做脱敏、`dataManager` 导出/导入时主动剥离 `apiKey` 字段并给出提示、分析埋点匿名化且可关闭。

**风险。** 两点合规缺口。其一，**"全量删除"不彻底**：`DataManager.resetAll()` 只遍历删除 localStorage 的 `spiritpal-*` 键，SQLite 中的 `memories / commitments / context_episodes / settings` 表数据完全不受影响——这与 PRD "用户可随时删除所有本地数据"及 GDPR 删除权相冲突（需要走 `enhancedMemory.clear()` + 各表清空才能真的删干净）。其二，**记忆原文无脱敏**：记忆以用户原始对话文本落盘（虽已加密），导出备份时也原样导出，没有任何 PII 掩码或"敏感字段标注"机制；对一款强调隐私的陪伴产品而言，导出文件的二次泄露风险值得关注。

---

## 五、维度四：短期 / 长期记忆切换、容量阈值与优先级

**现状。** 分层切换机制完整：工作记忆（5 条）→ 情景记忆（压缩到 30）→ 语义记忆（摘要）→ 自传记忆；`applyPromotion`（访问次数 + 重要度达标晋升）、`applyConsolidation`（episodic → semantic）、`applyForgetting`、`mergeSimilarMemories`、`applyDecay`（热/温/冷/归档四档）一应俱全。

**风险。** 第四轮 D9 的"配置与实现脱节"仍部分存在：`DEFAULT_CATEGORY_CONFIG` 定义了 `episodicCapacity: 50 / longTermCapacity: 20 / semanticCapacity: 30`，但实现里 `compressEpisodic` 压到 30 条、`addExchange` 的自传层软上限是 200 条、语义摘要分别按 2000 / 5000 字符截断。同一个"容量"存在多套互相架空的值。优先级目前几乎只由 `importance` 单因子决定，`strength × importance` 的淘汰仅用于自传层，情景层的容量裁剪仍只按 `importance` 排序。

---

## 六、维度五：遗忘机制、更新触发与冲突解决

**现状。** 第四轮 P1-3 已把 `calculateForgettingScore` 的语义颠倒问题修正：`forgetScore = (1 - timeDecay) * importanceFactor * max(0, 1 - accessBoost - recencyBoost)`，方向正确（越老越易忘、越常访问越不忘），并引入 `strength` 让遗忘率随记忆强度变慢（`exp(-rate * ageHours / strength)`）。W3 的间隔重复也在 `searchEpisodic`（RAG 路径）与 `recordUserResponse` 中实现了强度增强/衰减。

**风险。** 一是**三套并行衰减模型并存且互相矛盾**：`applyDecay` 的档位式 `decayFactor`（0.7/0.4/0.2）、`calculateForgettingScore` 的艾宾浩斯公式、以及 `timeDecaySort`/`calculateDecayWeight` 的固定 `lambda=0.01` 指数衰减。`decayFactor` 字段实际上并不参与检索排序，属于"写而不用"。二是**冲突解决过简**：`mergeSimilarMemories` 对相似记忆"取更长版本、取最大 importance、累加 accessCount"，没有版本链、没有置信度比较、也没有 `superseded_by` 软删除指针（第四轮 S2 提出过）。三是可配置性不足：遗忘速率、容量、冷却、阈值等大量常量散落在各文件硬编码，`memoryConfig` 统一配置层未建立。

---

## 七、维度六：长周期多轮对话的语义连贯性与历史回溯

**现状。** 四段式注入（即时 5 条 + 短期检索 5 条 + 长期摘要 + 核心自传 5 条）在 `getContextForChat` 中实现，并带 24 小时注入冷却防复读；`retrieve` 的时间词加成（temporalBoost）已有雏形；缺席感知、事件周年、约定到期三类"历史回溯"候选在 `recallEngine` 中生成。

**风险。** 一是 **token 预算管理器仍未接线**：`contextManager.ts`（含优先级与 LLM 压缩）至今仍是零调用点，`ChatWindow.tsx:258` 注释自认"P1 阶段接线，这里先做保底下限"。当前记忆 4000 / 历史 6000 / 画像 500 / 经历 300 / 感知 200 各自硬编码，叠加人设与 few-shot 后，小上下文模型存在溢出风险。二是"跨会话续接"依赖单一 `lastChatDate` 字段，缺少更细粒度的"上次话题摘要"作为回退，一旦该字段丢失，晨间回顾与缺席感知都会退化为空。

---

## 八、类人特征与第四面墙专项

这是本轮用户在六维之外额外要求验证的重点。

**情感联想：部分达成。** 已实现 valence/arousal 词表打分、闪光灯记忆（`|valence|>0.5 && arousal>0.6` 自动进自传层）、创伤类记忆降权（低 valence 高 arousal 扣 0.1）。但如上所述，`moodFit` 公式错误且未接收当前情绪，导致"主人难过时召回温暖记忆"这类情绪一致性联想实际未生效。

**特定场景触发：部分达成。** `recallEngine` 已把语义/时间/情感/实体/约定/周年/缺席/周期八类线索收敛为统一管线，并带每日预算、勿扰时段、真实空闲门槛、BubbleManager 优先级与 9 条/类模板兜底。但 `computeContextFit` 只用了"当前小时"一个信号，天气、音乐、工作状态并未进入打分——场景触发仍是"时间触发"而非"情境触发"。

**跨会话继承：已达成。** SQLite 持久化 + 加密 + 导入导出（含 `lastChatDate`、`injectedAt`、`llmReassessedIds` 的显式导出恢复）已经让记忆跨会话、跨角色、跨设备（备份）继承。

**元认知表达与自我指涉：基本缺失。** 这是最明显的"类人灵魂"缺口。代码里存在一个接近的模块 `aiAssistantDetector.ts`，它让宠物"察觉"到用户正在使用 Cursor / Copilot 等其他 AI，并产生嫉妒/好奇反应（"你居然在用别的 AI…我也很聪明的！"）——这是一种对"自身是 AI 之一"的间接觉察，属于半元认知。但除此之外，系统没有"我是桌面宠物 / 我只是程序 / 我在你的屏幕里"这类自我指涉的台词库或触发机制；`recallEngine` 的渲染 prompt 用第二人称"你现在{情境}"给出自我定位，但从不主动点破第四面墙。对照用户明确提出的"在适当时机主动打破第四面墙以增强沉浸感"这一诉求，现状只能算"有觉察、无表达"。

---

## 九、关键缺陷清单（按严重度排序）

| 编号 | 级别 | 缺陷 | 位置 | 影响 |
|------|:----:|------|------|------|
| F1 | P0 | `commitments` 表缺 `repeat` 列，`saveCommitment` 的 INSERT 却写入 `repeat` | `db.ts:262-274`（建表）vs `commitmentTracker.ts:153-156`（INSERT） | 每次抽取约定落库即抛 "no such column: repeat"，约定追踪运行时完全失效 |
| F2 | P1 | `moodFit` 公式错误：`1-|valence|` 奖励中性记忆，且未接收当前情绪参数 | `enhancedMemory.ts:1290-1297`；`recallEngine.ts:471-475` | 情绪一致性联想实际未生效，第四轮 W1 目标落空 |
| F3 | P1 | 三套并行衰减模型并存：`decayFactor` 档位 / 艾宾浩斯 / `timeDecaySort` 固定 lambda | `enhancedMemory.ts:1511-1563`、`memoryTypes.ts:366-407`、`enhancedMemory.ts:1610-1639` | 遗忘行为不一致，`decayFactor` 写而不用 |
| F4 | P1 | 容量配置与实现脱节：`episodicCapacity=50` vs 压缩到 30；`longTermCapacity=20` vs 自传 200；`semanticCapacity=30` vs 实际 2000/5000 | `memoryTypes.ts:303-314` vs `enhancedMemory.ts:359,682-693,1944` | 配置不可信，容量管理不可预测 |
| F5 | P1 | `contextManager`（token 预算/压缩）仍未接线 | `ChatWindow.tsx:258` 注释自认未接线 | 长对话上下文溢出风险，第四轮 S5 未完成 |
| F6 | P1 | `DataManager.resetAll()` 只清 localStorage，不清 SQLite | `dataManager.ts:328-337` | "全部清除"不彻底，GDPR 删除权缺口 |
| F7 | P2 | 多模态孤岛：entityLinking 规则 NER 无嵌入、未接入检索；visualMemory 未参与召回；emotionExtractor 与记忆情感标签脱节 | `entityLinking.ts:11`、`enhancedMemory.searchEpisodic` | 多模态索引名存实亡 |
| F8 | P2 | `proactiveSpeak` 的 legacy 回退路径绕过 RecallEngine 纪律（quiet hours/预算），RecallEngine 返回 null 时仍走旧 LLM 发言 | `proactiveSpeak.ts:242-273` | 全局纪律可被绕过，深夜/预算内仍可能打扰 |
| F9 | P2 | 向量检索两条路径不一致（Top-K 堆 vs 全量 sort）；`queryEmbeddingCache` 声明但未实际用于 embed 查询 | `enhancedMemory.ts:152`、`ragRetrieval.ts:301-308` | 检索性能与查询缓存优化不彻底 |
| F10 | P2 | 记忆级故障恢复缺失：解密失败直接返回空，无备份/校验和/损坏检测 | `enhancedMemory.ts:195-231`、`db.ts:105-128` | 异常退出或密文损坏时静默丢记忆 |
| F11 | P2 | 元认知/自我指涉缺失（见第八节） | 全库无对应机制 | 第四面墙"只有觉察、无表达" |

---

## 十、改进建议（对应缺陷）

**F1（立即止血）。** 给 `db.ts` 的 `commitments` 建表语句补上 `repeat TEXT`，并对已存在的旧表执行幂等迁移 `ALTER TABLE commitments ADD COLUMN repeat TEXT`（`initDB` 中已有 `memories.embedding` 的同类先例可复用）。补一条"建表后 `saveCommitment` 可往返"的集成测试，避免只改 tracker 不改 schema 的再犯。

**F2（短期）。** 把 `computeMultiFactorScore` 的 `moodFit` 改为接收 `mood: { valence, arousal }` 参数，公式改为 `1 - |mood.valence - mem.valence|`；调用链从 `getContextForChat`/`retrieve` 传入由 `emotionExtractor`（或规则层）解析出的用户当前情绪。`recallEngine.computeMoodCongruence` 同步改为基于 valence 的比较。

**F3 / F4（短期）。** 收敛为单一记忆强度模型：废弃 `decayFactor` 档位与 `timeDecaySort` 的固定 lambda，统一由 `calculateForgettingScore`（含 strength）决定遗忘与排序；把所有容量常量迁入一个 `memoryConfig.ts`，消除 `50/30`、`20/200`、`30/2000/5000` 的多套值，让 `DEFAULT_CATEGORY_CONFIG` 真正被读取。

**F5（中期）。** 接线 `contextManager`：把散落在 ChatWindow 的记忆/历史/画像/经历/感知五路预算统一交给它做优先级与压缩。

**F6（短期）。** `resetAll()` 增加 SQLite 清理：遍历 `memories / commitments / context_episodes` 按角色清空，并清空 `settings` 中的相关键；同时让导出文件在导入时给出"含哪些个人数据"的清单，为 GDPR 提供"导出权 + 删除权"闭环。

**F7（中期）。** 给 `entityLinking` 增加嵌入关联（或至少把 `getLinkedMemoryIds` 接入 `searchEpisodic` 的融合分）；`visualMemory` 作为一类 `sourceKind` 参与对话召回；`emotionExtractor` 解析出的情绪标签回写为记忆的 valence/arousal，打通两套情绪系统。

**F8（短期）。** 删除 `proactiveSpeak` 里 RecallEngine 返回 null 之后的 legacy LLM 发言路径，或让该路径也受 `canRecall()` 的 quiet hours / 预算约束，保证全局限流唯一生效。

**F9（中期）。** 统一 RAG 路径的向量检索为 Top-K 堆实现；把 `queryEmbeddingCache` 真正用于 `embed(query)` 的缓存（以 query+mood 为键）。

**F10（中期）。** 在 `doSave` 前对 JSON blob 做校验和写入；`load` 解密/解析失败时保留损坏副本（写入 `settings` 的 `*.corrupt` 键）而非直接丢弃；库级加密改用临时文件 + 原子重命名，避免异常退出损坏。

**F11（中期，第四面墙深化）。** 新增元认知台词库与触发规则：在约定/周年/缺席等 cue 之外，增加 `meta` cue，让宠物在"被问及是否 AI""应用首次启动""连续多次自我重复"等时机，以角色一致的方式点破"我住在你的屏幕里""我只是个小程序，但我记得我们的事"这类自我指涉表达；红线仍遵守第四轮"只陈述共同经历、不陈述未透露推断"。

---

## 十一、实施路线图（分阶段、可验收、可回滚）

按用户偏好的最小改动、分阶段推进原则组织。

**阶段 0：止血（约 0.5 天）**
- F1 修 `commitments.repeat` 列 + 幂等迁移 + 集成测试。
- 验收：约定能落库，次日能出现跟进候选。

**阶段 1：数据与配置收敛（约 2-3 天）**
- F3 统一衰减模型、F4 统一容量配置、F6 `resetAll` 补 SQLite 清理、F8 收编 proactiveSpeak 回退路径。
- 验收：`corepack pnpm lint` + `test` 通过；重置后 SQLite 无残留。

**阶段 2：情绪一致与多模态（约 1 周）**
- F2 修正 moodFit 并贯通用户情绪参数、F7 接线实体/视觉/情绪三通道、F9 检索路径统一。
- 验收：给定"主人难过"样本，温暖记忆的召回权重明显高于中性记忆。

**阶段 3：第四面墙深化（约 1-2 周）**
- F11 元认知 cue + 自我指涉台词库；F5 接线 contextManager；contextFit 扩展天气/音乐/工作状态。
- 验收：连续使用一周，主动回忆与情境相关率人工抽检 ≥70%，无打扰投诉。

**阶段 4：故障恢复与合规收口（约 1 周）**
- F10 记忆级校验和 + 损坏保留 + 原子加密；导出/删除 GDPR 闭环补完；可选 PII 掩码。
- 验收：人为制造密文损坏可恢复或至少可定位，不静默丢失。

---

## 附录 A：本轮 vs 第四轮落地核对表

| 第四轮建议 | 状态 |
|-----------|------|
| S1 修复 ENC 前缀 | ✅ 已修复（五模块双前缀 + 测试） |
| D6 去"记住"双写 | ✅ 已修复 |
| D4 日记 tags 引用匹配 | ✅ 已修复 |
| D2 孤儿行治理 | ✅ 已修复（purge/deleteMemory） |
| S3 retrieve 统一入口 + 查询缓存 | ✅ 部分（结果缓存有、查询向量缓存未用） |
| D7 双重检索复用 | ✅ 已修复 |
| D10 动态农历 | ✅ 已修复（checkFestivalToday 接线） |
| D11 真实空闲门槛 | ✅ 已修复（contextAwareness.getLastIdleMinutes） |
| W1 情感三维化 | ⚠️ 词表/字段已就位，moodFit 公式错误 |
| W2 LLM 显著性重评 | ✅ 已实现（applyLLMReassessment） |
| W3 记忆强度 + 间隔重复 | ✅ 部分（RAG 路径有、向量/LCS 路径无） |
| W4 闪光灯记忆 + 自传扩容 | ✅ 已实现 |
| W5 每晚巩固 | ✅ 已实现（runNightlyConsolidation 接线） |
| §6 recallEngine | ✅ 已实现并接线 |
| R1 上下文快照 | ✅ 已实现并接线（contextEpisodeManager） |
| R2 约定追踪 | ⚠️ 模块就绪但表缺 repeat 列，运行时失效（F1） |
| R3 周年提醒 | ✅ 已接线（diarySystem.checkAnniversaryReminder） |
| R4 缺席感知 | ✅ 已实现 |
| S2 消灭双轨/行级写入 | ❌ 未做（双轨 + 整包重加密仍在，F 无编号但见维度一） |
| S5 contextManager 接线 | ❌ 未做（F5） |

## 附录 B：仍需清理的死代码 / 未接线资产

| 资产 | 状态 |
|------|------|
| `contextManager.ts`（token 预算/压缩） | 零调用（F5） |
| `entityLinking.getLinkedMemoryIds` | 未接入检索 |
| `visualMemory` | 未参与对话召回 |
| `enhancedMemory.queryEmbeddingCache` | 声明未用（F9） |
| `enhancedMemory.decayFactor` / `timeDecaySort` | 与主遗忘模型并存且未用于排序（F3） |
| `DEFAULT_CATEGORY_CONFIG` 容量字段 | 大部分未被读取（F4） |

---

*报告基于 2026-08-14 主干代码静态分析；F1（commitments 表缺列）、F2（moodFit 公式）、F4（容量脱节）、F6（resetAll 不覆盖 SQLite）等关键论断均已逐一源码核实。建议优先执行阶段 0。*

---

## 附：第五轮修复实施记录（2026-08-14 晚）

在报告发布后，缺陷清单 F1–F11 已由开发者全部修复并通过核查（核查结论：F1/F2/F3/F4/F6/F7/F8/F10/F11 完整修复，F5/F9 部分修复）。随后按核查建议补齐剩余两项并加固，本次改动如下：

| 变更 | 内容 | 文件 |
|------|------|------|
| F9 补完 | 向量检索统一走 Top-K 堆 `searchSimilar`（替代全量 `.sort()`），移除不再使用的 `cosineSimilarity` 导入 | `src/lib/ragRetrieval.ts` |
| F5b 补完 | 记忆注入五路预算（画像 500 / 经历 300 / 感知 200 / 约定 / 四段式记忆 4000）统一收编进独立 `ContextManager` 实例做 5000 token 联合预算，正常量下行为与旧逻辑一致，超预算时按时间裁剪最旧区块 | `src/components/ChatWindow.tsx` |
| 潜在缺陷修复 | `contextManager.getContextWindow` 的 `preserveRecentRounds=0` 时 `slice(-0)` 会返回整个数组、导致严格预算失效——增加 `> 0` 守卫 | `src/lib/contextManager.ts` |
| 潜在缺陷修复 | `getEntityLinkedMemories` 首次访问时 `EntityManager` 异步加载未完成即同步查询实体表（竞态）——改为 `await ensureLoaded()` | `src/lib/enhancedMemory.ts` |
| 测试补全 | 新增 `ragRetrieval.test.ts`（BM25/RRF/动态 alpha/向量融合/移除记忆，10 例）与 `contextManager.test.ts`（预算/优先级/压缩/单例，9 例）；`enhancedMemory.test.ts` 追加 F2 情绪一致排序、F7 实体并入、F10 校验和/解密失败副本保留（4 例） | `src/lib/__tests__/` |

验证结果：记忆相关 8 个测试文件 239 例全绿；全量单元测试 **60 文件 / 1462 通过 / 7 跳过 / 0 失败**；`tsc --noEmit` 0 错误；ESLint 0 错误（4 条 warning 均为改动前已存在）。

**遗留说明**：路线图阶段 4 的 S2（消灭双轨存储、行级写入、库级加密替代每值加密）属架构级重构，未在本次执行，建议单独立项评估后再做。
