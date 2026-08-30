/**
 * P0-2 非破坏性 consolidate 回归测试
 *
 * 验收标准（来自 MEMORY_UPGRADE_IMPLEMENTATION_PLAN.md P0-2）：
 *  1. 巩固时保留源记忆（软删除），支持回溯到原始情景记忆
 *     —— 内存路径：源 ID 保留在 ConsolidationEvent.sourceIds，
 *        且从 ephemeral 的 episodicMemory 中软移除（非物理销毁）。
 *     —— 行级路径：源记忆写入 superseded_by 字段而非物理 DELETE，
 *        并写入结构化语义事实表（source_memory_ids 可溯源）。
 *  2. 语义摘要可追溯到源记忆 ID 列表。
 *  3. importance >= 阈值 的记忆不被巩固（仅巩固低重要度旧记忆）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'decrypt_data') return Promise.resolve('{}')
    if (cmd === 'encrypt_data') return Promise.resolve(JSON.stringify({}))
    return Promise.resolve('')
  }),
}))

vi.mock('../db', () => {
  const m = {
    getSetting: vi.fn(() => Promise.resolve(null)),
    setSetting: vi.fn(() => Promise.resolve()),
    addMemory: vi.fn(() => Promise.resolve(1)),
    saveEmbedding: vi.fn(() => Promise.resolve()),
    getAllEmbeddings: vi.fn(() => Promise.resolve([])),
    insertMemoryRow: vi.fn(() => Promise.resolve(1)),
    updateMemoryLastAccessed: vi.fn(() => Promise.resolve()),
    clearMemories: vi.fn(() => Promise.resolve()),
    // P0-2 行级路径断言目标
    updateMemoryRow: vi.fn(() => Promise.resolve()),
    upsertSemanticFact: vi.fn(() => Promise.resolve()),
    getSemanticFacts: vi.fn(() => Promise.resolve([])),
  }
  return m
})

vi.mock('../vectorSearch', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array([0.1, 0.2, 0.3]))),
  cosineSimilarity: vi.fn(() => 0.8),
  isVectorSearchAvailable: vi.fn(() => Promise.resolve(false)),
  searchSimilar: vi.fn(() => [{ id: 1, score: 0.8 }]),
}))

import { EnhancedMemoryManager } from '../enhancedMemory'
import { updateMemoryRow, upsertSemanticFact, getSemanticFacts } from '../db'
import type { EnhancedMemory } from '../memoryTypes'

const DAY_MS = 86400000

/** 构造若干旧、低重要度、非自传的情景记忆（溢出到 episodic） */
function seedOldEpisodic(mgr: EnhancedMemoryManager, count: number, importance = 10): EnhancedMemory[] {
  for (let i = 0; i < count + 6; i++) {
    mgr.addExchange(`旧记忆内容${i}`, '回复')
  }
  const eps = (mgr as unknown as { episodicMemory: EnhancedMemory[] }).episodicMemory
  const picked = eps.slice(0, count)
  for (const m of picked) {
    m.created_at = new Date(Date.now() - 8 * DAY_MS).toISOString()
    m.importance = importance
    m.isAutobiographical = false
  }
  return picked
}

describe('P0-2 非破坏性 consolidate', () => {
  let mgr: EnhancedMemoryManager

  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    mgr = new EnhancedMemoryManager('p0-consolidation-char')
    await mgr.ensureLoaded()
  })

  it('内存路径：源记忆 ID 保留在事件且从 episodicMemory 软移除（可追溯）', async () => {
    const sources = seedOldEpisodic(mgr, 4)
    const sourceIds = sources.map((m) => m.id)
    expect(sourceIds.length).toBeGreaterThanOrEqual(3)

    const event = await mgr.applyConsolidation(() => Promise.resolve('合并摘要'))

    expect(event).not.toBeNull()
    // P0-2：事件携带 sourceIds（可回溯原始情景记忆）
    expect(event!.sourceIds.sort()).toEqual([...sourceIds].sort())
    // P0-2：consolidationId 支持溯源
    expect(typeof (event as { consolidationId?: unknown }).consolidationId).toBe('string')

    // 软移除：源记忆已从临时情景记忆中移出（非物理销毁，ID 仍可追溯）
    const remaining = (mgr as unknown as { episodicMemory: EnhancedMemory[] }).episodicMemory
    for (const id of sourceIds) {
      expect(remaining.find((m) => m.id === id)).toBeUndefined()
    }
  })

  it('阈值：importance >= 30 的记忆不被巩固', async () => {
    const low = seedOldEpisodic(mgr, 3, 10)
    // 额外塞入一条高重要度旧记忆
    mgr.addExchange('很重要的事', '记住了')
    const eps = (mgr as unknown as { episodicMemory: EnhancedMemory[] }).episodicMemory
    const keep = eps[eps.length - 1]
    keep.created_at = new Date(Date.now() - 8 * DAY_MS).toISOString()
    keep.importance = 50
    keep.isAutobiographical = false

    const event = await mgr.applyConsolidation(() => Promise.resolve('合并摘要'))
    expect(event).not.toBeNull()
    expect(event!.sourceIds).toContain(low[0].id)
    expect(event!.sourceIds).not.toContain(keep.id)
  })

  it('行级路径：写入 superseded_by 软删除并写入可溯源的语义事实', async () => {
    // 切换到行级存储路径
    ;(mgr as unknown as { useRowLevelStorage: boolean }).useRowLevelStorage = true

    const sources = seedOldEpisodic(mgr, 3)
    for (const m of sources) m.dbId = 100 // 赋予行级 ID 以触发 DB 写路径

    const event = await mgr.applyConsolidation(() => Promise.resolve('合并摘要'))
    expect(event).not.toBeNull()

    // P0-2：每条源记忆都通过 superseded_by 软删除（而非物理 DELETE）
    expect(updateMemoryRow).toHaveBeenCalledTimes(sources.length)
    for (const call of (updateMemoryRow as ReturnType<typeof vi.fn>).mock.calls) {
      const [dbId, fields] = call as [number, Record<string, unknown>]
      expect(typeof dbId).toBe('number')
      expect(fields).toHaveProperty('superseded_by')
      expect(fields.superseded_by).toBe(Number((event as { consolidationId?: unknown }).consolidationId))
    }

    // P0-2：语义事实记录源记忆 ID 列表（可溯源）
    expect(upsertSemanticFact).toHaveBeenCalledTimes(1)
    const factArg = (upsertSemanticFact as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      source_memory_ids?: string[]
      fact_key?: string
    }
    expect(factArg.source_memory_ids?.sort()).toEqual(sources.map((m) => m.id).sort())
    expect(factArg.fact_key).toContain('consolidation-')
    expect(getSemanticFacts).toHaveBeenCalled()
  })
})
