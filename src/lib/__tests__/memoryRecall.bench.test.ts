/**
 * @file memoryRecall.bench.test.ts
 * @description 记忆检索 P95 延迟基准（B-4-1）
 *
 * 与 perf/*.mjs（Playwright + 真实 exe，测启动/内存/帧率）互补：
 * 记忆检索跑在 webview 内且依赖 SQLite/向量检索，无法用 Node 脚本直接驱动，
 * 因此在 vitest 内以真实 EnhancedMemoryManager + mock 存储层的方式测量。
 *
 * 测什么：`EnhancedMemoryManager.retrieve()` —— 检索主入口（RAG + 向量 + LCS 融合打分排序）
 * 怎么测：预置 300 条记忆 → 50 次检索 → 统计 P50 / P95 / P99
 * 产出：console 输出 + JSON 写入 perf/results/memory-recall-p95.json（供趋势看板消费）
 *
 * ⚠️ 阈值说明：这是**纯 JS 检索路径**的阈值（不含 SQLite I/O 与真实向量检索，
 * 两者在 mock 下被短路）。数值用于回归检测（发现数量级劣化），不代表真机端到端延迟。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll, vi } from 'vitest'

// ===== 存储层 mock（让检索路径不依赖真实 SQLite / 向量服务）=====
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

import { EnhancedMemoryManager } from '@/lib/memory/enhancedMemory'

const MEMORY_COUNT = 300
const QUERY_COUNT = 50
/** P95 阈值（毫秒）：纯 JS 检索路径，用于发现数量级劣化 */
const P95_THRESHOLD_MS = 100

/** 百分位（线性插值） */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]!
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (idx - lower)
}

describe('B-4-1：记忆检索 P95 延迟基准', () => {
  let p50 = 0
  let p95 = 0
  let p99 = 0
  let avg = 0
  let poolSize = 0
  let hitCount = 0

  beforeAll(async () => {
    const mgr = new EnhancedMemoryManager('bench-character')
    // 等待构造函数触发的异步 init()（loadFromRows 从（mock）空库加载并重置内存数组）完成，
    // 避免"先写入后被 init 清空"的竞态导致基线失真（B-4 排查发现）。
    await new Promise((resolve) => setTimeout(resolve, 20))

    // 预置记忆（20 个主题轮转，模拟真实对话分布）
    for (let i = 0; i < MEMORY_COUNT; i++) {
      await mgr.addExchange(
        `我今天又去吃了火锅，同事${i % 10}号也一起，聊了关于主题${i % 20}的事情`,
        `听起来很棒！主题${i % 20}确实有意思。`,
      )
    }

    // 基准有效性：确认记忆真的进了检索池（否则就是"空库检索"的假基准）
    // B-4 Fix A 后，被情景压缩溢出的记忆保留在 compressedEpisodic，仍可被检索命中，
    // 因此"可达检索池"≈ 注入量（而非旧实现的 ~35 条）。
    poolSize = mgr.getRetrievableMemoryCount()
    hitCount = (await mgr.retrieve('主题5 火锅')).length

    // 预热（JIT + 首次索引构建不计入）
    await mgr.retrieve('预热查询')

    const durations: number[] = []
    for (let i = 0; i < QUERY_COUNT; i++) {
      const t0 = performance.now()
      await mgr.retrieve(`主题${i % 20} 火锅`)
      durations.push(performance.now() - t0)
    }

    const sorted = [...durations].sort((a, b) => a - b)
    p50 = percentile(sorted, 0.5)
    p95 = percentile(sorted, 0.95)
    p99 = percentile(sorted, 0.99)
    avg = durations.reduce((s, n) => s + n, 0) / durations.length
  })

  it('基准有效性：检索池非空且达到分层后的合理规模', () => {
    // B-4 Fix A：写入 300 条后，可达检索池应接近注入量（压缩记忆仍保留可检索），
    // 旧实现仅 ~35 条（压缩记忆被丢弃为不可检索摘要），属"宠物遗忘"缺陷，已修复。
    console.log(`[memory-recall] 写入 ${MEMORY_COUNT} 条 → 实际可达检索池 ${poolSize} 条`)
    expect(poolSize).toBeGreaterThanOrEqual(30)
  })

  it('基准有效性：查询能命中记忆（检索路径真的在工作）', () => {
    expect(hitCount).toBeGreaterThan(0)
  })

  it(`P95 检索延迟 < ${P95_THRESHOLD_MS}ms（发现数量级劣化）`, () => {
    console.log(
      `[memory-recall] avg=${avg.toFixed(2)}ms p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms`,
    )
    expect(p95).toBeLessThan(P95_THRESHOLD_MS)
  })

  it('P99 不出现失控长尾（< P95 的 5 倍）', () => {
    expect(p99).toBeLessThan(Math.max(p95 * 5, 5))
  })

  it('结果写入 perf/results/memory-recall-p95.json（供趋势看板消费）', () => {
    const payload = {
      timestamp: new Date().toISOString(),
      name: 'memory-recall-p95',
      unit: 'ms',
      threshold: P95_THRESHOLD_MS,
      compare: 'lt',
      value: Math.round(p95 * 100) / 100,
      passed: p95 < P95_THRESHOLD_MS,
      detail: {
        injectedCount: MEMORY_COUNT,
        // B-4 Fix A：压缩记忆保留可检索，可达检索池≈注入量（旧实现仅 ~35 条）
        actualPoolSize: poolSize,
        queryCount: QUERY_COUNT,
        avg: Math.round(avg * 100) / 100,
        p50: Math.round(p50 * 100) / 100,
        p95: Math.round(p95 * 100) / 100,
        p99: Math.round(p99 * 100) / 100,
        note: '纯 JS 检索路径（SQLite I/O 与向量检索已 mock 短路）；规模为分层后的实际检索池',
      },
    }

    const resultsDir = resolve(process.cwd(), 'perf', 'results')
    mkdirSync(resultsDir, { recursive: true })
    writeFileSync(
      resolve(resultsDir, 'memory-recall-p95.json'),
      JSON.stringify(payload, null, 2),
    )

    expect(payload.passed).toBe(true)
  })
})
