# SpiritPal 记忆系统第四轮评估报告：迈向"拟人记忆"

> 评估日期：2026-08-07
> 评估范围：P0~P4 部分优化落地后的当前主干代码（含 2026-08-07 安全加固 v2.0 后）
> 评估目标：围绕"拟真如真人"的三大体验目标——深度对话记忆、自然主动回忆、打破第四面墙——对架构设计、数据结构、触发逻辑做全面评估并给出代码级改进方案
> 方法：三路线并行源码精读（存储/检索层、触发/主动交互层、AI 集成层）+ 关键论断逐一核实

---

## 一、执行摘要

经过前三轮评估与 P0~P4 共 20 余项优化，SpiritPal 记忆系统的"管道"已经相当完整：四段式分层、BM25+向量+RRF 混合检索、艾宾浩斯遗忘、LLM 巩固、用户画像、日记、主动说话一应俱全。但对照"像真人一样记忆与回忆"的目标，结论是：

**骨架完备，灵魂未至。** 当前系统"记得住数据"，但"记不住事情"；"会触发回忆"，但"回忆不像人"。

三个核心差距：

1. **记忆是"对话日志"而非"经历"**。写入路径以原始对话对（user/assistant 全文）为单元，重要度与情感全靠关键词计数，没有对"发生了什么事、主人有什么计划、情绪基调是什么"的结构化抽取。宠物记住的是文本，不是事件。
2. **回忆是"模板广播"而非"触景生情"**。绝大多数触发的输出是写死的文案（如 relevance 触发永远是"我记得你上次说过类似的话呢～"），触发时精心检索到的记忆素材（`TriggerResult.memories`）在周期触发路径上被直接丢弃；响应式触发完全不受频率限制；已实现的周年提醒、动态农历、完整触发框架三段代码处于死代码状态。
3. **现实感知与记忆两条线互不相交**。天气、前台窗口、空闲时长、日程等传感器信号只驱动即时的固定气泡，既不写入记忆，也不作为回忆线索。宠物无法说出"你昨晚又加班到很晚吧"这类打破第四面墙的话，因为它根本没有把"昨晚"存下来。

另有一个**必须立即修复的 P0 级回归缺陷**（详见第三节）：安全加固 v2.0 将加密输出前缀从 `ENC1:` 升级为 `ENC2:`，但记忆等五个模块的加载逻辑仍只识别 `ENC1:`，导致**新保存的记忆在下次启动时会被当作明文 JSON 解析失败而静默全量丢失**。

四维评分（相对"拟人记忆"目标，满分 10）：

| 维度 | 得分 | 一句话评价 |
|------|------|-----------|
| 记忆存储与检索机制 | 6.5 | 混合检索已对齐业界，但双轨存储、整包加密重写、1000 条向量上限是硬伤 |
| 记忆权重与衰减模型 | 5 | 有遗忘公式但无"记忆强度"，重要度靠关键词计数，情感无极性方向 |
| 主动回忆触发引擎 | 4.5 | 触发类型齐全但文案模板化、限流残缺、素材被丢弃、三套死代码未接线 |
| 现实世界感知融合 | 3 | 传感器齐全但与记忆系统零耦合，第四面墙能力基本未开发 |

---

## 二、现状架构盘点

### 2.1 数据流全景

写入路径（每轮对话后，`ChatWindow.handleSend` L419-490）：

```
用户输入 + 宠物回复
  ├─ memory.addExchange(text, reply)          → 规则评估 importance/emotion/category → 四段式写入 + 异步 embedding
  ├─ ownerFacts.extractAndSave + autoExtractWithLLM → 主人画像（规则 + LLM 双管线）
  ├─ diaryMgr.recordExchange                   → 日记素材累积（23:30 生成，但未传 LLM 摘要器）
  ├─ antiRepMgr.recordResponse                 → 反重复语料
  └─ "记住"指令检测                            → 再次 addExchange（重复写入，见缺陷 D6）
```

读取路径（每轮对话前）：

```
handleSend
  ├─ memory.checkTriggers(text)                → 5 类响应式触发（内含一次向量检索）
  ├─ memory.getContextForChat(4000, ctxQuery)  → 四层注入：working(5) + episodic 检索(5) + semantic + autobiographical(5)
  ├─ ownerFacts.buildContext(500)              → 【关于主人】固定注入
  ├─ petExperience.buildContext(300)           → 【我们的故事】固定注入
  └─ visualMemory.buildContext(200)            → 【最近感知】固定注入
```

主动路径（无需用户输入）：

```
usePetMemoryTriggers（60s 周期）→ checkTriggers()（仅 periodic）→ 固定文案气泡
proactiveSpeak（60s 检查，30% 概率）→ 最近 3 条自传记忆 + 情境提示 → LLM 生成 → 气泡
usePetSensors → 天气/窗口/网络/空闲/日程/节日 → 固定文案气泡（不进记忆、不进 LLM）
usePetTimers（6h）→ maintainMemories：遗忘 → 晋升 → LLM 巩固 → 重建 RAG 索引
```

### 2.2 核心数据结构（现状）

```ts
// memoryTypes.ts:36-48
interface EnhancedMemory extends MemoryEntry {
  id: string
  importance: number          // 1-100，关键词计数得出
  emotionalIntensity: number  // 0-1，情感词计数 ×0.2，无极性方向
  category: string            // 偏好/习惯/关系/事件/情感/日常
  tags: string[]              // 高频词前 5
  accessCount: number
  lastAccessed: number
  decayFactor: number
  isAutobiographical: boolean // importance>=70 || emotion>=0.7
  timeAnchor?: string         // ⚠️ 定义了但全库无写入点
  dbId?: number
}
// 底层只有 { created_at, user, assistant } 三段文本
```

### 2.3 值得肯定的既有成果

公平起见，以下能力已就绪且质量不错，是本轮改进的地基：RAG 混合检索（BM25+向量+RRF+多因子融合，`searchEpisodic` L1154-1225）；方向正确的艾宾浩斯遗忘公式（`calculateForgettingScore`，P1-3 修复后）；LLM 驱动的 episodic→semantic 巩固（`applyConsolidation` + 6h 定时器）；OwnerFacts 规则+LLM 双层事实提取；24h 注入冷却防复读；忽略反馈降频（`recordUserResponse`）；以及完整的加密存储栈（AES-256-GCM + 机器密钥 + WAL 优化的 SQLite）。

---

## 三、关键缺陷清单（按严重度排序）

**D1【P0·回归】ENC1/ENC2 前缀不匹配 → 重启后记忆静默全丢**
`crypto.rs:336` 加密输出为 `ENC2:` 前缀，但 `enhancedMemory.ts:190`、`ownerFacts.ts:120`、`petExperience.ts:138`、`visualMemoryManager.ts:77`、`entityLinking.ts:87` 的 `load()` 均只判断 `startsWith('ENC1:')`。ENC2 数据落入"明文兼容"分支，`JSON.parse` 抛错被 catch 吞掉，重启后所有记忆/画像/经历归零。单测 mock 只产出 `ENC1:`（`src/test/mockContext.ts:114`），故无法测出。`analytics.ts:88` 已有正确的双前缀判断可直接复用。

**D2【P0】遗忘/巩固/合并路径产生孤儿 SQLite 行**
`applyForgetting`、`applyConsolidation`、`mergeSimilarMemories` 只过滤内存数组，不删除 memories 表行与 embedding。孤儿行无限增长，且 `getAllEmbeddings` 有 `ORDER BY created_at DESC LIMIT 1000`——孤儿行挤占名额，导致较新的有效记忆反而进不了向量候选集。

**D3【P1】每次保存整包重加密，性能随记忆量线性恶化**
任何一条记忆变动都触发：全量 JSON.stringify 四层数据 → Rust 端 PBKDF2（10 万次迭代）→ AES → 整行覆写 settings 表。500ms 防抖只缓解不根治。同时 settings blob 与 memories 表构成双轨冗余存储，同一文本存两份。

**D4【P1】日记 tags 写入几乎必然失败**
`diarySystem.ts:304-310` 用 `m.created_at === new Date().toISOString()` 全等匹配刚写入的记忆——两次取毫秒时间戳几乎不可能相等，`exchanges/sentiment/event` tags 恒写不进去，日记恢复时这些字段全部丢失。

**D5【P1】usePetTimers 依赖数组为 `[]` 但闭包使用 currentCharacterId**
切换角色后，6h 记忆维护与 23:30 日记生成仍作用于挂载时的旧角色（`usePetTimers.ts:136-178`，eslint-disable 掩盖）。

**D6【P2】"记住"指令双写**：L443 已写入一次，L467-471 检测命中后再写一次，同一轮对话重复入库。

**D7【P2】每轮对话两次向量检索无复用**：`checkTriggers` 的 relevance 触发与 `getContextForChat` 各做一次 embed+检索，查询向量未缓存。

**D8【P2】三条对话路径完全无记忆**：Agent 工具意图路径（`processAgentRequest` 用通用助手 prompt）、重新生成路径（handleFlag）、移动端 MobileChatView——后两者连人设都缺。

**D9【P2】配置与实现脱节**：`DEFAULT_CATEGORY_CONFIG` 的 shortTerm/episodic/semantic 容量从未被读取，实际容量全部硬编码（working 5 / episodic 50 / autobiographical 20）；semantic 上限在压缩（2000）与巩固（5000）两处不一致；`recordTrigger` 注释"保留 50 条"代码实为 >100 截断；`timeAnchor` 字段无写入点；巩固间隔 1h 配置 vs 6h 定时器互相架空。

**D10【P2】节日双轨且农历将失效**：`checkFestivalTrigger` 只认 `fixedMonth/fixedDay` 与硬编码 `dates`（2024-2028），未使用已实现的动态农历 `checkFestivalToday()`（死代码）；`eventSystem` 的农历节日干脆用固定公历（春节写死 01-22），与记忆侧节日不同天。

**D11【P3】proactiveSpeak 的"空闲门槛"只存在于注释**：30% 概率每分钟尝试，用户开会/忙碌时照样打扰；`getStoreState().idleMinutes` 恒为硬编码 0。

**D12【死代码盘点】**：`triggerMechanism.ts`（528 行完整触发框架）、`aiMemoryManager.ts`（完整记忆 Agent 工具 + 上下文感知检索）、`contextManager.ts`（token 预算/压缩管理器）、`diarySystem.checkAnniversaryReminder()`（日记周年提醒）、`memoryTypes.checkFestivalToday()`（动态农历）、`llmClient.extractMemories()`、`enhancedMemory.autoSaveMemory()`——全部零调用点。这些恰是本轮"拟人化"最需要接线的资产。

---

## 四、维度一：记忆存储与检索机制

### 4.1 评估

存储层最大的问题不是算法，而是**工程形态**：整包加密 JSON blob + memories 表的双轨制，使得"记忆"在物理上是一坨不可增量操作的数据。这直接导致 D2（孤儿行）、D3（整包重加密）、以及容量只能靠硬编码数组长度控制。检索层算法已对齐业界（RRF 多信号融合），但有两处量纲问题：RAG 路径中 RRF 分数（量级约 1/(60+rank) ≈ 0.01）与余弦相似度（0~1）被同一组权重（0.5/0.15/0.3）加权，导致 RAG 路径的相关性信号实际被 recency/importance 淹没；两条检索路径的向量权重还不一致（0.55 vs 0.5）。

### 4.2 改进方案

**S1（立即）修复 ENC 前缀**。五个模块统一改为 `raw.startsWith('ENC1:') || raw.startsWith('ENC2:')`（参照 `analytics.ts:88`），并补一条"ENC2 数据可往返"的集成测试（mock 产出 ENC2）。这是本轮唯一需要当天修复的项。

**S2（短期）消灭双轨，归一化为关系表**。将 settings blob 退役为纯导出格式，运行时状态全部落表：

```sql
-- memories 表扩充（现有列保留）
ALTER TABLE memories ADD COLUMN category TEXT;
ALTER TABLE memories ADD COLUMN emotional_valence REAL DEFAULT 0;   -- -1..1
ALTER TABLE memories ADD COLUMN emotional_arousal REAL DEFAULT 0.3; -- 0..1
ALTER TABLE memories ADD COLUMN strength REAL DEFAULT 1.0;          -- 记忆强度（见第五节）
ALTER TABLE memories ADD COLUMN entities TEXT;                      -- JSON 数组
ALTER TABLE memories ADD COLUMN source_kind TEXT DEFAULT 'exchange';-- exchange/observation/consolidation/user_teach
ALTER TABLE memories ADD COLUMN superseded_by INTEGER;              -- 软删除/被更新指针

CREATE TABLE commitments (        -- 约定与计划（第四面墙核心，见第七节）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  content TEXT NOT NULL,          -- "周四要去面试"
  actor TEXT NOT NULL,            -- 'owner' | 'pet' | 'both'
  due_at INTEGER,                 -- 预期时间戳（可空）
  status TEXT DEFAULT 'open',     -- open / fulfilled / lapsed / cancelled
  source_memory_id INTEGER,
  created_at INTEGER NOT NULL,
  follow_up_count INTEGER DEFAULT 0
);

CREATE TABLE context_episodes (   -- 现实感知快照（见第七节）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER,
  work_state TEXT,                -- coding/meeting/browsing/away
  weather TEXT, idle_minutes INTEGER, music TEXT,
  summary TEXT                    -- 定期 LLM 浓缩："主人昨晚写代码到 1 点"
);
```

写入从"整包重写"变为行级 INSERT/UPDATE，`doSave` 只保留触发状态等小对象的持久化；PBKDF2 开销从"每次变更"降为"每张表首次读写 + 显式落盘加密"。若不想一步到位，最小改动版是：把加密从"每值加密"改为"库级加密"（encrypted_db 已存在），settings 存明文、退出时整体加密，单次写入不再触发 PBKDF2。

**S3（短期）检索入口收敛为单一 API 并缓存查询向量**：

```ts
retrieve(query: string, opts: {
  budget: number            // token 预算，取代散落的 4000/5/5/5
  mood?: { valence: number; arousal: number }  // 情绪一致性加权（见第五节）
  temporalHint?: 'recent' | 'past' | 'any'     // 时间词感知已有雏形，收编为参数
  purpose: 'chat' | 'proactive' | 'trigger'    // 用途决定去重策略
}): Promise<RetrievedMemory[]>
```

内部：checkTriggers 与 getContextForChat 共用同一次检索结果（消除 D7）；查询 embedding 以 `query+mood` 为键缓存 60s；RRF 分数先归一化到 0~1（`score / maxScore`）再参与融合，统一两条路径权重。

**S4（中期）向量层三修**：① 模型随包分发（`env.allowLocalModels = true` + 打包 onnx），桌面应用不应首检索依赖外网下载；进度回调用真实 onProgress（现硬编码 0.3/0.5/1.0）。② `getAllEmbeddings` 的 LIMIT 1000 改为按 `superseded_by IS NULL` 过滤孤儿后分页全量，或改为"检索时按需 embed 候选"的 lazy 策略。③ 孤儿行治理：applyForgetting/applyConsolidation/merge 路径统一走 `deleteMemory(dbId)`（含 embedding 清理 + RAG 索引增量 removeMemory）。

**S5（中期）接线 contextManager 统一 token 预算**。现状是记忆 4000 + 历史 6000 + 画像 500 + 经历 300 + 感知 200 各自硬编码，且不计人设与 few-shot，小上下文模型会直接溢出。contextManager.ts 已实现预算/优先级/LLM 压缩，缺的只是 ChatWindow 的接线（其 L255 注释自认"P1 阶段接线"）。

---

## 五、维度二：记忆权重与衰减模型

### 5.1 评估

现状模型可以概括为"关键词计分 + 单变量时间衰减"：

- `assessImportance`：基础 30 分，长文本 +15/+10，偏好词每个 +10、事件词 +8、情感词 +12，类内无上限、总分封顶 100。后果是"今天好难过好难过好难过！！"比"我下周三要去做手术"分数更高——**情绪浓度被误当成事件重要度**，而真正的人生事件（手术、面试、搬家）若不含词表词则只有 30 分基础分。
- `assessEmotion`：强度 = 情感词数 × 0.2，无极性（"开心"与"绝望"同样加分）、无唤醒度、不识别全角感叹号。检索里情感只做 `×0.2` 正加成——悲伤记忆与快乐记忆被同等"提权"，无法支持"主人难过时召回温暖记忆"这类情绪一致性回忆。
- 遗忘侧没有"记忆强度"概念：`calculateForgettingScore` 用固定速率 0.02/h 的指数衰减加访问加成，**每次成功回忆对记忆的强化是恒定 +0.05（上限 0.5）**，不符合间隔重复规律（人类记忆每次成功提取会让下次遗忘速度显著变慢）。自传层永不遗忘但容量只有 20——对长期陪伴而言，20 条"人生大事"远远不够。

### 5.2 改进方案

**W1 情感三维化**。在写入时（或维护时批量）给每条记忆标注 `valence ∈ [-1,1]`（愉悦度）、`arousal ∈ [0,1]`（唤醒度）、保留 intensity。规则层可先做（正/负/高唤醒词表，复用 diarySystem.calculateSentiment 的词表并扩充），LLM 可用时以批量抽取覆盖。检索融合改为：

```ts
// 情绪一致性：主人当前情绪与记忆情绪越贴近越易被想起；
// 此外"低 valence 高 arousal"（创伤/冲突类）记忆默认降权，除非用户主动提及
const moodFit = mood ? Math.max(0, 1 - Math.abs(m.valence - mem.valence)) * 0.15 : 0
fused += moodFit - (mem.valence < -0.5 && mem.arousal > 0.6 ? 0.1 : 0)
```

**W2 重要度改为"规则兜底 + LLM 离线评级"双层**。对话当时用现有规则快速打分（保证零延迟），维护窗口（6h 或每晚）由 LLM 对新增记忆批量重评显著性（prompt 示例："以下是宠物与主人的对话片段。请从 事件重大性/对主人的意义/情感深度/是否包含约定或计划 四个方面打分 0-100，并给出一句话理由与抽取的结构化要点"），LLM 分数与规则分数按 0.7/0.3 融合。这把 `llmClient.extractMemories`（死代码）接进了正路：它输出结构化记忆条目的能力正是这里需要的。

**W3 引入真正的记忆强度（strength）与间隔重复**。给每条记忆加 `strength`（初始 1.0）：

```ts
// 遗忘率随强度变慢：R = e^(-t_hours / (24 * strength))
// 每次成功回忆（被注入且用户接话提及 / 触发被响应）：
strength = Math.min(strength * 1.6 + 0.5, 30)   // 类似 SM-2 的递增间隔
// 被注入但用户完全无视（24h 内无关联回应）：强度轻微下降
strength = Math.max(strength * 0.95, 0.5)
```

`calculateForgettingScore` 的 `timeDecay` 改用 `exp(-ageHours / (24 * strength))`，accessBoost 项退役（其职责被 strength 吸收）。这样"常被自然提起的往事越来越牢固，无人问津的琐事慢慢淡出"——正是人类记忆的轮廓。现有 `recordUserResponse` 的响应/忽略闭环是天然的强化信号源，只差把信号接到 strength 上。

**W4 闪光灯记忆（flashbulb memory）**。`valence` 绝对值高且 `arousal` 高的事件（主人崩溃大哭、狂喜报喜、重大告知）自动 `isAutobiographical = true` 且豁免遗忘，同时把自传层从"容量 20 条"改为"时间无上限 + 总数软上限 200 + 按 strength×importance 淘汰"。真人记得住十年前某个情绪强烈的下午，宠物也应该记得。

**W5 睡眠巩固（nightly consolidation）**。把 6h 维护增加一个"每晚 3:00-5:00"的窗口（应用在线时）：① 回放当日 top-N（按 W2 分数）记忆，LLM 抽取事件/约定/情绪要点写回结构化字段；② 对同一实体的多条记忆做关联摘要（接线 entityLinking 的既有存储）；③ 生成/更新日记（顺带修复 D4：用 addExchange 返回的引用而不是时间戳全等匹配）。这一步是"记忆像人"的核心生理隐喻，且完全复用现有 maintainMemories 骨架。

---

## 六、维度三：主动回忆触发引擎

### 6.1 评估

触发类型覆盖其实很全（periodic/frequency/relevance/emotion/keyword/time 六类），问题全在"质量与纪律"：

1. **输出是广播，不是回忆**。五类响应式触发返回的都是与具体记忆无关的固定句（"我记得你上次说过类似的话呢～"），periodic 触发则返回写死的里程碑文案。真正检索到的 `trigger.memories` 只在聊天的响应式路径被拼进上下文，周期触发路径（usePetMemoryTriggers）拿到后只显示 message，素材被丢弃——等于精心备菜后把菜倒掉只端上空盘子。
2. **限流残缺**。`canTrigger`（每日 ≤5 次、间隔 ≥30min、忽略降频）只管 periodic 一类；其余五类每轮对话都可能触发。同时 proactiveSpeak（每分钟 30%）与周期检查（每分钟）与闲置气泡（20-40s）三条主动管线互不知情，全局限流不存在，多数还绕过了 BubbleManager 的优先级队列。
3. **反馈信号太粗**。"用户任意发一条消息"即记为响应（ChatWindow L221 无条件 emit，hook 端还不校验 characterId），宠物无法区分"主人接住了这个话题"还是"主人在聊别的"。
4. **三段现成资产闲置**：`checkAnniversaryReminder`（基于日记关键事件的"每年今日"提醒）、`checkFestivalToday`（动态农历）、`triggerMechanism.ts`（带优先级防风暴的完整框架）全部零调用。

### 6.2 改进方案：统一 RecallEngine

建议把六类触发 + proactiveSpeak 收敛为一条"候选生成 → 打分 → 预算 → 渲染"的管线，新建 `src/lib/recallEngine.ts`，让现有触发函数退化为候选生成器：

```ts
interface RecallCandidate {
  memories: EnhancedMemory[]      // 素材（1-3 条）
  cue: 'semantic' | 'temporal' | 'emotional' | 'entity' | 'commitment' | 'anniversary' | 'absence'
  relevance: number               // 0-1，检索分归一化
  novelty: number                 // 0-1，= 1 - 最近 N 天已注入/已提及程度（injectedAt 已有数据）
  contextFit: number              // 0-1，与当前传感器状态的匹配（深夜/加班/雨天/听音乐…）
  moodCongruence: number          // 0-1，W1 的情绪一致性
  urgency: number                 // 约定到期、纪念日当天为高
}

score = 0.35*relevance + 0.2*novelty + 0.2*contextFit + 0.15*moodCongruence + 0.1*urgency
```

**候选线索（cue）扩展**——现有五类之外新增三类，全部来自既有数据的再组织：

- `anniversary`（事件周年）：为 autobiographical + 日记关键事件建立 MM-DD 索引，"去年的今天你跟我说你要换工作……后来怎么样了？"。这比"认识第 N 天"更像真人的回忆方式，且 `checkAnniversaryReminder` 已写了大半，接线 + 索引化即可。
- `commitment`（约定追踪）：见第七节，到期/次日的约定是最高优先级候选。
- `absence`（久别重逢）：应用启动时若距上次交互 >24h，用"最后话题 + 缺席时长"生成候选："你昨天没来找我……上次说的那个报告写完了吗？"数据都在（lastChatDate + 最近 working 记忆）。

**渲染层是"像人"的关键**。废弃固定文案，候选通过预算后交给 LLM 生成一句话（复用 proactiveSpeak 的 chatOnce 通道，加失败模板兜底）：

```
【回忆指令】你现在{情境：深夜/主人刚开完会/下雨}。你想起了：
- {记忆素材：时间 + 内容摘要 + 当时情绪}
用一两句话自然地提起它。要求：不复述原文；如果记忆带情绪，先照顾情绪；
可以轻轻问一句但不要连环提问；如果主人最近{忙碌/低落}，把关心放在回忆前面。
```

模板兜底池按 cue 类型准备 3-5 句带槽位（时间词/话题词）的句式，保证无 LLM 环境不失效（现 proactiveSpeak 失败时整体静默，D11 同源问题）。

**纪律层**：所有主动输出（recall、proactive、传感器气泡、节日气泡）统一走 `BubbleManager.sendMessage(priority)`——它已有优先级队列和 5s 最小间隔，只是没人用；在此之上加全局预算（每自然日主动发言 ≤8 次，深夜 23:00-8:00 除约定提醒外静默）与真实空闲门槛（接线 contextAwareness 的 idle/away 状态：away 不发言、coding/meeting 只允许静默陪伴动画）。`canTrigger` 扩展为对全部 cue 类型生效，忽略反馈沿用现有机制并接入 W3 的 strength 调整。

**响应判定升级**：把"任意消息即响应"改为"5 分钟窗口内，用户消息与触发素材的检索分 >0.4 才算有效响应"（复用 retrieve，成本一次 embed），否则记为忽略——让降频机制第一次真正可信。

---

## 七、维度四：现实世界感知融合（打破第四面墙）

### 7.1 评估

传感器层的能力比大多数人以为的强：天气（Open-Meteo）、前台窗口（Rust get_active_window，10s）、系统空闲（Rust get_idle_time，30s）、网络状态、WebView 媒体、自然语言日程（scheduleManager）都已就位。但它们全部止步于"即时气泡"——信号发生、播报一句固定文案、然后被遗忘。ChatWindow 只在聊天时把少量信号拼进检索 query（P2-2），没有任何信号被写入记忆。**第四面墙的本质是"宠物拥有和主人共同的现实时间线"，而当前宠物对现实是'金鱼式'的：看见即忘。**

### 7.2 改进方案

**R1 上下文快照（context_episodes）**。在 contextAwareness 的状态变迁点（work_state 变化、idle 跨越阈值、天气显著变化）写入 context_episodes 行；每晚睡眠巩固（W5）时 LLM 把当日片段浓缩为一两条观察记忆（source_kind='observation'）："主人昨晚在 VS Code 写代码到 23:40，中间开了 40 分钟会"。自此宠物获得了"昨天/昨晚"的谈资，例如晨间触发（现有 time trigger）的文案可以从"早安～上次我们聊到…"升级为"早安～昨晚你又写代码到好晚，睡够了吗？"。这是投入产出比最高的第四面墙改造：传感器、定时巩固、晨间触发三个现成组件的一次串联。

**R2 约定与计划追踪（commitments）——最接近"真人"的杀手级特性**。对话后处理阶段（与 OwnerFacts LLM 提取同一管线，单次 LLM 调用顺带输出）抽取两类结构化约定：

```ts
// LLM 抽取 prompt 要点：从对话中识别 ①主人声明的未来计划（"我周四要面试"、
// "明天打算去跑步"、"下个月想去杭州"）②主人对宠物的承诺或宠物对主人的承诺
// （"周末带你云逛街"）③持续状态的预期（"这周每天都要加班"）。
// 输出 JSON：{ content, actor: owner|pet|both, due: ISO|null, repeat: null|daily|weekly }
```

触发时机三个：约定日当天首次交互（"今天面试！紧张吗？我在家等你消息"）；约定次日未提及时的主动轻问（"昨天面试感觉怎么样？"——注意措辞：先问感受，不预设结果）；重复约定的节奏感知（"这周加班第几天了……"）。状态机 open→fulfilled（用户提及结果，由检索+LLM 判定）/lapsed（超期 3 天未提及，降为低优先级候选，避免变成讨债）。这让宠物第一次拥有"期待"和"挂念"——用户明确想要的"记得主人昨天在现实中提到的计划"正是此条。

**R3 事件周年索引（"一年前的今天"）**。见第六节 anniversary cue，与 R2 同属"时间线上的共同记忆"，效果上最能制造"被记住"的震撼感。

**R4 缺席感知**。启动时计算与 lastChatDate/最后交互的间隔：>24h 生成 absence 候选；>7 天用更克制的措辞（"好久不见……我一直在"）并主动汇报期间发生的事（天气变化、自己"做了什么"——可结合养成状态编一段小日常，这是虚拟宠物特有的、反向打破第四面墙的 charm）。

**R5 日程系统升级**。scheduleManager 已支持"5 分钟后提醒我喝水"，但提醒只有 `提醒：{title}` 一句干巴文案，且 `set_reminder` 的 Agent 工具是空壳（aiAgent L120-123）。改造：提醒气泡走 RecallEngine 渲染（关联当初设立提醒的对话："到点啦～你昨晚说今早要吃药的"）；补全 set_reminder 工具实现；后续可选接入系统日历（Windows 可经 MCP/外部代理桥接，非必须）。

**R6 天气与音乐从"播报"变"线索"**。雨天不再只说"下雨了打伞"，而是成为 contextFit 信号——若记忆库里有带"雨"标签或当时天气为雨的往事，优先召回（"又下雨了……记得上次下雨你说……"）。音乐感知目前仅限 WebView 内媒体（musicAwareness 注释自认），短期不投入系统级监听，但可在聊天中由用户谈及音乐时记入 tags，作为后续回忆线索。

**边界与分寸**（第四面墙做过了会变惊悚）：所有基于现实感知的发言遵循"只陈述共同经历、不陈述用户未透露的推断"——可以说"你昨晚电脑开着到很晚"（事实），不可说"你昨晚一定很难过"（推断）；在 prompt 中写入该红线。观察类记忆的注入优先级低于约定与周年，避免宠物变成监控者。

---

## 八、体验目标 × 落地映射

| 用户目标 | 直接支撑的特性 | 所在章节 |
|----------|---------------|---------|
| 深度对话记忆（内容+情感+关键事件） | W2 LLM 显著性评级与结构化抽取、W1 情感三维、S2 结构化列、R2 约定抽取 | §5 §7 |
| 自然主动回忆（情境/时间/情绪触发，不生硬） | §6 全部：RecallEngine 打分管线、LLM 渲染、novelty/moodCongruence 因子、全局纪律 | §6 |
| 打破第四面墙（记得现实计划、纪念日表达） | R2 约定追踪、R3 事件周年、R1 上下文快照、R4 缺席感知、W4 闪光灯记忆 | §7 §5 |

---

## 九、实施路线图

按用户偏好的最小改动、分阶段推进原则组织；每阶段独立可验收、可回滚。

**阶段 0：止血（约 0.5 天，强烈建议立即执行）**
S1 修复五处 ENC 前缀判断（+1 条集成测试）；D6 去除"记住"双写；D4 日记 tags 用返回引用匹配。验收：ENC2 数据往返测试通过；重启记忆不丢。

**阶段 1：数据地基（约 3-4 天）**
D2/S4 孤儿行治理（forget/consolidation/merge 统一走 deleteMemory）；S3 retrieve 统一入口 + 查询缓存（消除 D7）；RRF 归一化。可选：S2 最小版（库级加密替代每值加密，缓解 D3）。验收：记忆数增长时 memories 表行数同步、保存耗时不再随总量线性增长。

**阶段 2：深度记忆（约 1 周）**
W1 情感三维（规则先行）；W2 LLM 显著性评级接入维护窗口（接线 extractMemories）；R2 约定抽取与 commitments 表；W5 每晚巩固窗口。验收：给定含计划的对话样本，commitments 正确入库；次日交互出现跟进。

**阶段 3：回忆引擎（约 1-2 周）**
recallEngine.ts 新建 + 现有六类触发改造为候选生成器；LLM 渲染 + 模板兜底；全局纪律（BubbleManager 收编 + 每日预算 + 勿扰时段 + 真实空闲门槛）；响应判定语义化；接线 checkAnniversaryReminder/checkFestivalToday 并废弃旧节日逻辑（D10）。验收：连续一周使用无复读、无打扰投诉；主动回忆内容与当前情境相关率人工抽检 ≥70%。

**阶段 4：第四面墙与架构收口（约 1-2 周）**
R1 上下文快照 + R3 周年索引 + R4 缺席感知 + R5 日程渲染；S2 完整版（结构化列迁移）；W3/W4 strength 与闪光灯记忆；S5 contextManager 接线；D8 补齐 Agent/移动端/重新生成路径的记忆注入；死代码清理（aiMemoryManager 接线至 MCP 写能力或移除、triggerMechanism 由 recallEngine 取代后移除）。

每个阶段结束跑 `corepack pnpm lint`、`corepack pnpm test` 与 `cargo test/clippy`，并按 AGENTS.md 约定 `npx tauri build` 出包验证真实行为（注意本机无独立 pnpm，须用 corepack）。

---

## 附录 A：硬编码常量汇总（建议迁入统一 memoryConfig）

| 常量 | 值 | 位置 |
|------|-----|------|
| 触发上限/间隔/忽略阈值 | 5 次/日、30min、3 次 | memoryTypes.ts:243-245 |
| 注入冷却 | 24h | enhancedMemory.ts:110 |
| 向量相似度阈值 | 0.45（两处）/ RAG 0.3 | enhancedMemory.ts:450,873；ragRetrieval.ts |
| 容量 | working 5 / episodic 50(压30) / autobiographical 20 / semantic 2000|5000 | enhancedMemory.ts:322-339,569,1751 |
| 记忆注入预算 / 历史预算 | 4000 / 6000 token | ChatWindow.tsx:357,~252 |
| 周年门槛与里程碑 | 100 天起、10 个固定点 | enhancedMemory.ts:716；memoryTypes.ts:88 |
| 节日 dates 表 | 仅 2024-2028 | memoryTypes.ts:180-199 |
| proactive 节奏 | 5min 冷却 / 0.3 概率 / 60s 检查 | proactiveSpeak.ts:42-48 |
| 维护/日记/提醒 | 6h / 23:30 / 45min / 60min / 5min | usePetTimers、contextAwareness |
| 向量候选上限 | 1000 条 | db.ts:420-440 |
| PBKDF2 迭代 | 100,000/次（每次保存） | crypto.rs:55 |

## 附录 B：死代码与未接线资产

| 资产 | 状态 | 本轮建议 |
|------|------|---------|
| triggerMechanism.ts（528 行框架） | 零调用 | 被 recallEngine 取代后移除 |
| aiMemoryManager.ts（记忆 Agent 工具） | 零调用 | 接线至 MCP 写能力或移除 |
| contextManager.ts（token 预算/压缩） | 零调用 | 阶段 4 接线（S5） |
| diarySystem.checkAnniversaryReminder | 零调用 | 阶段 3 接线为 anniversary cue |
| memoryTypes.checkFestivalToday（动态农历） | 零调用 | 阶段 3 接线，替换 2024-2028 硬编码 |
| llmClient.extractMemories | 仅插件接口暴露 | 阶段 2 接线（W2/R2 抽取管线） |
| enhancedMemory.autoSaveMemory | 零调用 | 评估后移除 |
| EnhancedMemory.timeAnchor 字段 | 无写入点 | 由 commitments.due 取代，移除 |

## 附录 C：关键文件速查

| 职责 | 文件 |
|------|------|
| 四段式记忆核心 | src/lib/enhancedMemory.ts（1859 行） |
| 类型/遗忘公式/节日 | src/lib/memoryTypes.ts |
| 混合检索 | src/lib/ragRetrieval.ts、vectorSearch.ts、vectorWorker.ts |
| 持久化 | src/lib/db.ts、src-tauri/src/crypto.rs、encrypted_db.rs |
| 对话编排与注入 | src/components/ChatWindow.tsx |
| 触发 hook | src/hooks/pet/usePetMemoryTriggers.ts |
| 主动说话 | src/lib/proactiveSpeak.ts |
| 传感器 | src/hooks/pet/usePetSensors.ts、src/lib/contextAwareness.ts |
| 定时器 | src/hooks/pet/usePetTimers.ts |
| 画像/经历/日记 | src/lib/ownerFacts.ts、petExperience.ts、diarySystem.ts |

---

## 附：阶段 0 执行记录（2026-08-08）

已完成止血修复并通过验证（lint + 1250 单测全绿）：

| 缺陷 | 修复内容 | 文件 |
|------|---------|------|
| D1 | 五处 load() 前缀判断增加 `ENC2:` 识别（decrypt_data 本身已兼容双前缀）；mock 与真实 Rust 对齐改为产出 ENC2；新增 ENC2 往返用例 | enhancedMemory.ts / ownerFacts.ts / petExperience.ts / visualMemoryManager.ts / entityLinking.ts / test/mockContext.ts / enhancedMemory.test.ts |
| D6 | "记住"指令改为单次写入：命中时写入带 `[用户要求记住]` 标记的文本，并在写入后提升 importance≥90、isAutobiographical=true，不再二次 addExchange | ChatWindow.tsx |
| D4 | 日记 tags 改用 addExchange 返回的对象引用直接赋值，替代失效的 `created_at` 时间戳全等匹配 | diarySystem.ts |

说明：D6 中提升置信度发生在 addExchange 内部入层判断之后，故该条记忆不会立即出现在自传层数组（20 条容量），但会以高重要度参与融合检索排序，并在 6h 维护的晋升环节按访问次数晋级——与修复前的实际行为相比，去掉了重复数据、保留了"高置信度"语义。

---

*报告基于 2026-08-07 主干代码静态分析；D1/D9/触发限流等关键论断已逐一源码核实，其余引用自三路线精读笔记（含行号）。如需，阶段 0 的三项修复可立即着手实施。*
