# SpiritPal 记忆系统升级实施计划

> 文档版本：v1.0  
> 创建日期：2026-08-17  
> 对应调研：docs/SpiritPal-记忆系统评估×业界调研×升级方案.md

---

## 执行摘要

基于对 SpiritPal 记忆系统的全面评估和对 GitHub 主流记忆框架（mem0、Graphiti、Letta、HippoRAG、MemOS 等）的调研，本报告提出分阶段改进方案，目标是构建具备**类人认知特征**的记忆机制，突破传统"第四面墙"限制。

**核心差距**：
1. 检索打分失真（relevance 是硬编码常量而非真实分数）
2. 无多跳联想检索（实体链接仅一跳）
3. 无时间感知的事实版本（宠物记不住"你以前喜欢 X、现在喜欢 Y"）
4. 巩固是破坏性的（语义层是扁平字符串，5000 字符截断）

**改进路线图**：P0（打分准确性）→ P1（类人联想）→ P2（离线巩固）→ P3（多模态评测）

---

## P0 阶段：打分准确性（优先级：最高，1-2 天）

### P0-1: retrieve() 返回真实检索分

**目标**：修复 `recallEngine` 中 `relevance` 字段使用硬编码常量（0.7/0.5/0.8）的问题，改用真实检索分数。

**改动文件**：
- `src/lib/enhancedMemory.ts`: 
  - 新增 `RetrievalResult` 接口（memory/score/baseScore/fusedScore）
  - 修改 `retrieve()` 返回 `RetrievalResult[]`
  - 新增 `searchEpisodicWithScores()` 方法
- `src/lib/recallEngine.ts`:
  - 修改 `generateCandidates()` 使用真实 `result.score` 替代硬编码 0.7

**验收标准**：
- vitest 测试中 `retrieve()` 返回值包含分数字段
- `recallEngine` 生成的候选 `relevance` 分数在 0-1 之间连续分布（非离散值）

**兼容性处理**：
- 保留旧 `retrieveMemories()` 方法返回 `EnhancedMemory[]` 供旧代码调用
- 测试代码逐步迁移到新 API

### P0-2: applyConsolidation 非破坏化

**目标**：巩固时保留源记忆（软删除），支持回溯到原始情景记忆。

**改动文件**：
- `src/lib/enhancedMemory.ts`:
  - `applyConsolidation()` 增加 `importance < 阈值` 条件
  - 源记忆写入 `superseded_by` 字段而非物理 DELETE
  - 新增 `memory_semantic_facts` 表存储结构化摘要
- `src/lib/db.ts`:
  - 新增 `memory_semantic_facts` 表 DDL
  - 新增 `upsertSemanticFact()` / `getSemanticFacts()` 函数

**验收标准**：
- 巩固后源记忆仍可在数据库中通过 `superseded_by` 查询到
- 语义摘要可追溯到源记忆 ID 列表

### P0-3: RRF rank-based 归一化

**目标**：移除 `Math.min(1, r.score * 61)` hack，改用标准 RRF 公式。

**改动文件**：
- `src/lib/enhancedMemory.ts`:
  - `searchEpisodicWithScores()` 中 RRF 归一化改为 `1 / (rrfK + rank)`

**验收标准**：
- RRF 分数在 0-1 之间平滑分布
- 检索结果排序与之前基本一致（K 值调优后）

---

## P1 阶段：类人联想检索（核心技术突破，1-2 周）

### P1-4: 实体图两表 + PPR 多跳联想

**目标**：实现 HippoRAG 简化版，支持"音乐→雨天→对话"的多跳联想。

**改动文件**：
- `src/lib/db.ts`:
  - 新增 `memory_entities` 表（memory_id, entity_name, entity_type, embedding）
  - 新增 `memory_entity_edges` 表（entity_a, entity_b, weight, cooccur_count）
- `src/lib/entityLinking.ts`:
  - 新增 `buildEntityGraph()` 方法
  - 新增 `personalizedPageRank()` 方法（~40 行幂迭代）
- `src/lib/enhancedMemory.ts`:
  - `searchEpisodicWithScores()` 中 entityExtras 改用 PPR 分数

**验收标准**：
- 给定种子实体，PPR 返回关联实体按扩散分排序
- 多跳检索结果包含间接关联记忆（如通过"雨"关联到"那天吵架"）

### P1-5: ownerFacts 双时间轴

**目标**：支持"你以前喜欢拿铁，最近改美式了？"这类时序事实查询。

**改动文件**：
- `src/lib/db.ts`:
  - `owner_facts` 表加 `valid_at / invalid_at / superseded_by` 列
  - 新增 `upsertOwnerFactWithValidity()` 函数
- `src/lib/ownerFacts.ts`:
  - 修改 `upsertFact()` 逻辑：同 key 新值 → 旧值打 `invalid_at` 标记
  - 新增 `getFactsAsOf(date)` 方法

**验收标准**：
- 新事实写入后旧事实仍保留但标记为历史
- `getFactsAsOf('2026-08-01')` 返回当时的有效事实

### P1-6: 语义层结构化

**目标**：语义记忆从 5000 字符截断字符串 → 可查询的结构化事实表。

**改动文件**：
- `src/lib/db.ts`:
  - 新增 `memory_semantic_facts` 表（id, character_id, fact_text, source_memory_ids, confidence, created_at）
- `src/lib/enhancedMemory.ts`:
  - `semanticMemory` 字段改为从表读取
  - `applyConsolidation()` 写入新表而非追加字符串

**验收标准**：
- 语义事实可单独查询、删除、更新
- 无 5000 字符截断行为

---

## P2 阶段：离线巩固与自编辑（2-3 周）

### P2-7: 离线做梦任务

**目标**：宠物 idle/夜间时后台巩固记忆（去重合并 + ≥3 次蒸馏 + 日记）。

**改动文件**：
- `src/lib/sleepConsolidation.ts` (新文件):
  - `runSleepConsolidation(characterId, options)` 主函数
  - 去重合并逻辑（嵌入相似度 > 阈值 → LLM 合并）
  - ≥3 次同类事实蒸馏为语义事实
  - 从 `context_episodes` 生成日记
- `src/lib/agentScheduler.ts`:
  - 新增 idle 触发 / 夜间定时触发逻辑

**验收标准**：
- idle 5 分钟后自动触发巩固任务
- 巩固后相似记忆数量减少，语义事实增加
- 日记系统生成当日摘要

### P2-8: 记忆自编辑工具

**目标**：宠物 LLM 可自主决定"这个我要记住"。

**改动文件**：
- `src/lib/mcpServer.ts`:
  - 新增 `memory_search / memory_save / memory_update / owner_fact_update` 工具
- `src-tauri/src/commands/memory.rs` (新文件):
  - Rust 端白名单校验
  - 参数验证（防注入）

**验收标准**：
- 宠物 LLM 调用工具后记忆真实写入/更新
- 非授权调用被拒绝

---

## P3 阶段：多模态与评测（约 1 个月）

### P3-9: episode 级多模态记忆

**目标**：把"某段情节 = 对话 + 截图关键帧 + 音乐 + 天气"绑定为检索单元。

**改动文件**：
- `src/lib/db.ts`:
  - `context_episodes` 表加 `snapshot_keyframe_id / music_track_id` 列
- `src/lib/contextEpisodeManager.ts`:
  - 状态变迁时自动绑定视觉关键帧

**验收标准**：
- 检索 episode 时返回关联的多模态数据
- 多模态信号参与检索打分

### P3-10: 本地记忆评测集

**目标**：自建 ~100 题中文陪伴场景基准（时序/更新/拒答/多跳四类）。

**改动文件**：
- `src/lib/__tests__/memory-benchmark.test.ts` (新文件):
  - LoCoMo/LongMemEval 风格测试用例
  - 时序推理：宠物能否回答"我上个月说过什么"
  - 知识更新：宠物能否识别"我现在不喜欢 X 了"
  - 拒答：宠物能否拒绝回答未透露的推断
  - 多跳联想：给定音乐能否联想到相关对话

**验收标准**：
- 评测集纳入 CI 流程
- SpiritPal 得分 ≥ 基线（随机检索）+30%

---

## 实施路线图

| 阶段 | 里程碑 | 工作量 | 验收 |
|------|--------|--------|------|
| **P0** | retrieve() 返回分数 + RRF 修复 + 巩固非破坏化 | 1-2 天 | vitest 全绿，tsc 0 错误 |
| **P1** | 实体图 PPR + ownerFacts 双时间轴 + 语义结构化 | 1-2 周 | 多跳联想 demo 可演示 |
| **P2** | 离线做梦 + 自编辑工具 | 2-3 周 | idle 触发巩固，LLM 可调用工具 |
| **P3** | episode 多模态 + 评测集 | 1 个月 | 评测集纳入 CI，得分达标 |

---

## 风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| P0-1 破坏现有 API | P1 | 保留 `retrieveMemories()` 兼容层，逐步迁移调用方 |
| P1-4 PPR 性能问题 | P2 | 限制迭代轮数（10-20 轮），种子节点 Top-K 剪枝 |
| P1-5 数据迁移复杂 | P1 | 幂等迁移脚本 + `.legacy` 备份 + 回滚开关 |
| P2-7 idle 检测时序 | P2 | 复用现有 `useIdleDetection`，不另起定时器 |
| P3-10 评测集主观性 | P3 | 人工抽检 + LLM-as-judge 双轨验证 |

---

## 附录：关键代码片段

### P0-1: RetrievalResult 类型

```typescript
export interface RetrievalResult {
  memory: EnhancedMemory
  score: number        // 综合得分（用于排序）
  baseScore: number    // RRF/向量/LCS 原始分
  fusedScore: number   // 多因子融合分
}
```

### P1-4: PPR 幂迭代（简化版）

```typescript
function personalizedPageRank(
  seeds: Set<string>,
  edges: Map<string, { target: string; weight: number }[]>,
  damping = 0.15,
  iterations = 20
): Map<string, number> {
  const scores = new Map<string, number>()
  // 初始化种子节点
  seeds.forEach(s => scores.set(s, 1 / seeds.size))
  
  for (let i = 0; i < iterations; i++) {
    const newScores = new Map<string, number>()
    // 阻尼因子：随机跳转概率
    seeds.forEach(s => newScores.set(s, (newScores.get(s) || 0) + damping / seeds.size))
    
    // 扩散：沿边传播分数
    scores.forEach((score, node) => {
      const targets = edges.get(node) || []
      targets.forEach(({ target, weight }) => {
        newScores.set(target, (newScores.get(target) || 0) + (1 - damping) * score * weight)
      })
    })
    scores.clear()
    newScores.forEach((v, k) => scores.set(k, v))
  }
  return scores
}
```

### P1-5: ownerFacts 双时间轴

```sql
ALTER TABLE owner_facts ADD COLUMN valid_at INTEGER;      -- 事实生效时间
ALTER TABLE owner_facts ADD COLUMN invalid_at INTEGER;    -- 事实失效时间（NULL=当前有效）
ALTER TABLE owner_facts ADD COLUMN superseded_by INTEGER; -- 被哪个新事实取代
```

---

*本文档待评审。确认后将按阶段推进，每阶段独立验收、可回滚。*
