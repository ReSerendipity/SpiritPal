/**
 * @file memoryRecall.eval.test.ts
 * @description 记忆召回评测集（B-4-3）
 *
 * 30 条「记忆 → 查询 → 期望命中关键词」评测用例，验证检索链路的召回质量。
 * 与 bench（测延迟）互补：本文件测**召回正确性**。
 *
 * 设计要点：
 * - 每条用例先写入记忆再立即检索（近期召回场景），避免分层存储的压缩/晋升
 *   淘汰旧记忆导致结果不稳定（见 bench 中"写入 300 条仅剩 35 条"的实测）
 * - 判定标准：Top-5 结果中至少一条包含期望关键词
 * - 存储层与向量/RAG 全部 mock，只考察本地检索打分链路（无 LLM 参与）
 *
 * 阈值：整体命中率 ≥ 70%（30 条中 ≥ 21 条）。
 *
 * ⚠️ 基线说明：
 * 本评测在**向量检索与 RAG 均被 mock 短路**的条件下运行，考察的是纯本地
 * LCS + 多因子打分的召回能力（B-4 Fix B 已加入查询意图同义词扩展以缓解
 * 措辞差异导致的漏召回，如「宠物」↔「猫」、「天气」↔「雨」）。
 * B-4 Fix A 修复了 compressEpisodic 把记忆丢弃为不可检索摘要的缺陷，使
 * 被压缩溢出的记忆仍可被 retrieve 命中（宠物不再"忘记"旧细节）。
 * 阈值 70% 是**回归保护线**而非质量目标：命中率跌破它说明检索打分被改坏了。
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('@/lib/data/db', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
  addMemory: vi.fn(() => Promise.resolve()),
  saveEmbedding: vi.fn(() => Promise.resolve()),
  getAllEmbeddings: vi.fn(() => Promise.resolve([])),
  updateMemoryLastAccessed: vi.fn(() => Promise.resolve()),
  deleteMemory: vi.fn(() => Promise.resolve()),
  clearMemories: vi.fn(() => Promise.resolve()),
  insertMemoryRow: vi.fn(() => Promise.resolve(1)),
  updateMemoryRow: vi.fn(() => Promise.resolve()),
  getMemoriesByTier: vi.fn(() => Promise.resolve([])),
  getMemorySummary: vi.fn(() => Promise.resolve(null)),
  upsertMemorySummary: vi.fn(() => Promise.resolve()),
  getMemoryState: vi.fn(() => Promise.resolve(null)),
  upsertMemoryState: vi.fn(() => Promise.resolve()),
  clearAllMemoryData: vi.fn(() => Promise.resolve()),
  isMemoryMigrated: vi.fn(() => Promise.resolve(true)),
  isLegacyMode: vi.fn(() => Promise.resolve(false)),
  getSemanticFacts: vi.fn(() => Promise.resolve([])),
  upsertSemanticFact: vi.fn(() => Promise.resolve()),
  deleteSemanticFact: vi.fn(() => Promise.resolve()),
  clearSemanticFacts: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/system/vectorSearch', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array(8))),
  isVectorSearchAvailable: vi.fn(() => Promise.resolve(false)),
  searchSimilar: vi.fn(() => Promise.resolve([])),
  terminateVectorSearch: vi.fn(),
}))

vi.mock('@/lib/memory/ragRetrieval', () => ({
  getRAGRetriever: vi.fn(() => ({
    retrieve: vi.fn(() => []),
    buildIndex: vi.fn(() => Promise.resolve()),
    clear: vi.fn(),
  })),
  DEFAULT_RAG_CONFIG: { topK: 20, minScore: 0.1 },
}))

vi.mock('@/lib/memory/memoryMigrator', () => ({
  needsMigration: vi.fn(() => Promise.resolve(false)),
  migrateCharacterMemory: vi.fn(() => Promise.resolve({ migrated: 0 })),
}))

vi.mock('@/lib/memory/entityLinking', () => ({
  getEntityManager: vi.fn(() => ({
    getLinkedMemories: vi.fn(() => Promise.resolve([])),
  })),
}))

// 抽取事实与情感重评会调 LLM —— 评测只考察本地检索，故 mock 掉
vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: vi.fn(() => ({ chatOnce: vi.fn(() => Promise.resolve('[]')) })),
}))

import { EnhancedMemoryManager } from '@/lib/memory/enhancedMemory'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface EvalCase {
  id: number
  /** 写入的记忆内容 */
  memory: string
  /** 检索查询（与记忆措辞不同，考验语义/关键词泛化） */
  query: string
  /** 期望在 Top-5 中命中的关键词 */
  expect: string
}

const CASES: EvalCase[] = [
  { id: 1, memory: '我最喜欢的食物是火锅，尤其是麻辣锅底', query: '我喜欢吃什么', expect: '火锅' },
  { id: 2, memory: '我养了一只叫豆豆的橘猫', query: '我的宠物叫什么', expect: '豆豆' },
  { id: 3, memory: '我在腾讯做前端开发工程师', query: '我的工作是做什么的', expect: '前端' },
  { id: 4, memory: '我的生日是 3 月 15 日', query: '我的生日是哪天', expect: '3 月 15 日' },
  { id: 5, memory: '我喜欢听周杰伦的歌', query: '我喜欢听谁的歌', expect: '周杰伦' },
  { id: 6, memory: '我住在杭州西湖区', query: '我住在哪里', expect: '杭州' },
  { id: 7, memory: '我对芒果过敏，吃了会起疹子', query: '我不能吃什么', expect: '芒果' },
  { id: 8, memory: '我最喜欢的颜色是紫色', query: '我喜欢什么颜色', expect: '紫色' },
  { id: 9, memory: '我每天晚上十一点睡觉', query: '我几点睡觉', expect: '十一点' },
  { id: 10, memory: '我在学吉他，已经学了三个月', query: '我在学什么乐器', expect: '吉他' },
  { id: 11, memory: '我的偶像是爱因斯坦', query: '我崇拜谁', expect: '爱因斯坦' },
  { id: 12, memory: '我最近在追《繁花》这部电视剧', query: '我在看什么剧', expect: '繁花' },
  { id: 13, memory: '我讨厌下雨天，因为会堵车', query: '我不喜欢什么天气', expect: '下雨' },
  { id: 14, memory: '我的座右铭是「慢慢来，比较快」', query: '我的座右铭是什么', expect: '慢慢来' },
  { id: 15, memory: '我每天早上都会喝一杯美式咖啡', query: '我早上喝什么', expect: '咖啡' },
  { id: 16, memory: '我有一个妹妹在上高中', query: '我的家人有谁', expect: '妹妹' },
  { id: 17, memory: '我去年去了日本旅游，最喜欢京都', query: '我去哪里旅游过', expect: '日本' },
  { id: 18, memory: '我的手机是 iPhone 15 Pro', query: '我用的什么手机', expect: 'iPhone' },
  { id: 19, memory: '我在准备考研，目标是浙江大学', query: '我在准备什么考试', expect: '考研' },
  { id: 20, memory: '我喜欢跑步，一周跑三次', query: '我的运动习惯是什么', expect: '跑步' },
  { id: 21, memory: '我最害怕的东西是蟑螂', query: '我害怕什么', expect: '蟑螂' },
  { id: 22, memory: '我的家乡在成都', query: '我的老家是哪里', expect: '成都' },
  { id: 23, memory: '我喜欢看科幻小说，尤其是刘慈欣的作品', query: '我喜欢看什么书', expect: '科幻' },
  { id: 24, memory: '我的工位上放着一盆多肉植物', query: '我工位上有什么', expect: '多肉' },
  { id: 25, memory: '我每周三晚上要开会', query: '我什么时候开会', expect: '周三' },
  { id: 26, memory: '我在学习 Rust 语言', query: '我在学什么编程语言', expect: 'Rust' },
  { id: 27, memory: '我最喜欢的季节是秋天', query: '我喜欢哪个季节', expect: '秋天' },
  { id: 28, memory: '我的猫不喜欢吃鱼罐头', query: '我的猫不爱吃什么', expect: '鱼罐头' },
  { id: 29, memory: '我打算明年去云南旅行', query: '我计划去哪里玩', expect: '云南' },
  { id: 30, memory: '我的幸运数字是 7', query: '我的幸运数字是多少', expect: '7' },
]

describe('B-4-3：记忆召回评测集（30 条）', () => {
  let hits = 0
  const misses: number[] = []

  beforeAll(async () => {
    const mgr = new EnhancedMemoryManager('eval-character')
    // 等待构造函数触发的异步 init()（loadFromRows 从（mock）空库加载并重置内存数组）
    // 完成，避免"先写入后被 init 清空"的竞态导致前几条记忆丢失（B-4 排查发现）。
    await new Promise((resolve) => setTimeout(resolve, 20))

    // 检索只搜 episodicMemory（见 searchEpisodicWithScores 的 candidatePool），
    // 而新记忆先进 workingMemory，超出容量后才溢出到情景记忆。
    // 这里把工作记忆容量设为 1，让每条记忆立即溢出，确保 30 条都在检索池内。
    mgr.setCategoryConfig({ workingMemoryCapacity: 1, episodicCapacity: 50 })

    for (const c of CASES) {
      await mgr.addExchange(c.memory, '好的，我记住啦～')
    }

    for (const c of CASES) {
      const results = await mgr.retrieve(c.query)
      const hit = results
        .slice(0, 5)
        .some((r) => `${r.memory.user} ${r.memory.assistant}`.includes(c.expect))
      if (hit) hits++
      else misses.push(c.id)
    }
  })

  it('评测集规模为 30 条', () => {
    expect(CASES).toHaveLength(30)
  })

  it('Top-5 召回命中率 ≥ 70%（回归保护线）', () => {
    const rate = hits / CASES.length
    console.log(
      `[memory-recall-eval] 命中 ${hits}/${CASES.length} (${(rate * 100).toFixed(1)}%)` +
        (misses.length ? ` 未命中: [${misses.join(', ')}]` : ''),
    )
    expect(rate).toBeGreaterThanOrEqual(0.7)
  })

  it('结果写入 perf/results/memory-recall-accuracy.json（供趋势看板消费）', () => {
    const rate = hits / CASES.length
    const payload = {
      timestamp: new Date().toISOString(),
      name: 'memory-recall-accuracy',
      unit: 'ratio',
      threshold: 0.7,
      compare: 'gte',
      value: Math.round(rate * 1000) / 1000,
      passed: rate >= 0.7,
      detail: { hit: hits, total: CASES.length, misses },
    }
    const resultsDir = resolve(process.cwd(), 'perf', 'results')
    mkdirSync(resultsDir, { recursive: true })
    writeFileSync(resolve(resultsDir, 'memory-recall-accuracy.json'), JSON.stringify(payload, null, 2))
    expect(payload.passed).toBe(true)
  })
})
