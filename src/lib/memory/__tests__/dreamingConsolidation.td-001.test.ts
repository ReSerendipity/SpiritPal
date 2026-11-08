// dreamingConsolidation TD-001 测试 — 记忆巩固三个桩（实体图更新 / 记忆重排序 / 自传记忆合并）
//
// 覆盖：① 三个纯规划函数的边界（游标、升序取旧批、阈值语义、keeper 取更长者）；
// ② 三个任务真的动到管理器（建图被调用 / applyDecay 被调用 / mergeSimilarMemories 被调用）；
// ③ 空批次时**不**白跑（没新记忆不建图、没有可合并对不做 O(n²) 合并）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const buildEntityGraphFromMemories = vi.fn(async (_memories: EnhancedMemory[]) => {})

import {
  planEntityGraphBatch,
  planAutobiographicalMerge,
  startDreamingScheduler,
  stopDreamingScheduler,
  AUTOBIOGRAPHICAL_MERGE_THRESHOLD,
  type DreamingTask,
} from '@/lib/memory/dreamingConsolidation'
import type { EnhancedMemory } from '@/lib/memory/memoryTypes'
import type { EnhancedMemoryManager } from '@/lib/memory/enhancedMemory'

function mem(id: string, createdAt: string, user: string, isAutobiographical = false): EnhancedMemory {
  return {
    id,
    created_at: createdAt,
    user,
    assistant: '（回复）',
    importance: 50,
    emotionalIntensity: 0.3,
    category: '事件',
    tags: [],
    accessCount: 1,
    lastAccessed: 0,
    decayFactor: 1,
    isAutobiographical,
  }
}

function task(type: DreamingTask['type']): DreamingTask {
  return {
    type,
    priority: 5,
    estimatedDurationMs: 1000,
    status: 'pending',
    id: `${type}-${Math.random()}`,
    createdAt: Date.now(),
  }
}

describe('planEntityGraphBatch', () => {
  it('从游标往后按时间升序取一批，游标推进到本批最后一条', () => {
    const memories = [
      mem('m3', '2026-11-01T03:00:00Z', '三'),
      mem('m1', '2026-11-01T01:00:00Z', '一'),
      mem('m2', '2026-11-01T02:00:00Z', '二'),
    ]
    const plan = planEntityGraphBatch(memories, 0, 2)

    expect(plan.batch.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(plan.pending).toBe(3)
    expect(plan.nextWatermark).toBe(new Date('2026-11-01T02:00:00Z').getTime())
  })

  it('游标之后的记忆才进批次（不重复建图）', () => {
    const memories = [
      mem('old', '2026-10-01T00:00:00Z', '旧'),
      mem('new', '2026-11-01T00:00:00Z', '新'),
    ]
    const watermark = new Date('2026-10-15T00:00:00Z').getTime()
    const plan = planEntityGraphBatch(memories, watermark, 10)

    expect(plan.batch.map((m) => m.id)).toEqual(['new'])
    expect(plan.pending).toBe(1)
  })

  it('没有新记忆时不出批次，游标保持原值', () => {
    const plan = planEntityGraphBatch([mem('m1', '2026-10-01T00:00:00Z', '一')], Date.now(), 10)
    expect(plan.batch).toEqual([])
    expect(plan.pending).toBe(0)
    expect(plan.nextWatermark).toBe(Date.now() > 0 ? plan.nextWatermark : 0)
  })

  it('maxBatchSize 为 0 时不取任何批次（避免除零/空转）', () => {
    const plan = planEntityGraphBatch([mem('m1', '2026-10-01T00:00:00Z', '一')], 0, 0)
    expect(plan.batch).toEqual([])
  })
})

describe('planAutobiographicalMerge', () => {
  it('近似重复的两条归成一组，keeper 取文本更长的那条', () => {
    const memories = [
      mem('a', '2026-11-01T00:00:00Z', '今天和妈妈去了公园散步', true),
      mem('b', '2026-11-01T01:00:00Z', '今天和妈妈去了公园散步吧', true),
      mem('c', '2026-11-02T00:00:00Z', '在写一个关于记忆巩固的技术方案', true),
    ]
    const plan = planAutobiographicalMerge(memories)

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]!.keeperId).toBe('b')
    expect(plan.groups[0]!.absorbedIds).toEqual(['a'])
    expect(plan.untouchedIds).toEqual(['c'])
  })

  it('阈值是"必须严格超过"，等于阈值不算可合并', () => {
    // 两条完全相同 → 相似度 1.0
    const memories = [
      mem('x', '2026-11-01T00:00:00Z', '完全一样的一句话', true),
      mem('y', '2026-11-01T00:00:00Z', '完全一样的一句话', true),
    ]
    expect(planAutobiographicalMerge(memories, 1.0).groups).toHaveLength(0)
    expect(planAutobiographicalMerge(memories, 0.99).groups).toHaveLength(1)
    expect(AUTOBIOGRAPHICAL_MERGE_THRESHOLD).toBe(0.7)
  })

  it('互不相似的记忆全部原样保留', () => {
    const memories = [
      mem('p', '2026-11-01T00:00:00Z', '猫在窗台上晒太阳', true),
      mem('q', '2026-11-01T00:00:00Z', '重构了数据库迁移脚本', true),
    ]
    const plan = planAutobiographicalMerge(memories)
    expect(plan.groups).toHaveLength(0)
    expect(plan.untouchedIds.sort()).toEqual(['p', 'q'])
  })
})

describe('DreamingScheduler 三个任务真的动到管理器', () => {
  let manager: {
    getAllMemories: ReturnType<typeof vi.fn>
    getAutobiographicalMemories: ReturnType<typeof vi.fn>
    applyDecay: ReturnType<typeof vi.fn>
    mergeSimilarMemories: ReturnType<typeof vi.fn>
    applyConsolidation: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    manager = {
      getAllMemories: vi.fn(() => []),
      getAutobiographicalMemories: vi.fn(() => []),
      applyDecay: vi.fn(),
      mergeSimilarMemories: vi.fn(() => 0),
      applyConsolidation: vi.fn(async () => null),
    }
    buildEntityGraphFromMemories.mockClear()
  })

  afterEach(() => {
    stopDreamingScheduler()
  })

  it('实体图更新：按批次建图并推进游标，第二轮只处理剩下的', async () => {
    const memories = Array.from({ length: 12 }, (_, i) =>
      mem(`m${i}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), `第 ${i} 条`),
    )
    manager.getAllMemories.mockReturnValue(memories)

    const scheduler = startDreamingScheduler(manager as unknown as EnhancedMemoryManager, {
      maxBatchSize: 10,
      enabled: false, // 关掉空闲/夜间自动触发，只用手动 runPendingTasks
    }, { buildEntityGraphFromMemories })

    await scheduler.addTask(task('entity_graph_update'))
    await scheduler.runPendingTasks()
    expect(buildEntityGraphFromMemories).toHaveBeenCalledTimes(1)
    expect(buildEntityGraphFromMemories.mock.calls[0]![0]).toHaveLength(10)

    buildEntityGraphFromMemories.mockClear()
    await scheduler.addTask(task('entity_graph_update'))
    await scheduler.runPendingTasks()
    expect(buildEntityGraphFromMemories.mock.calls[0]![0]).toHaveLength(2)
  })

  it('实体图更新：没有新记忆时不建图（不白跑）', async () => {
    manager.getAllMemories.mockReturnValue([])
    const scheduler = startDreamingScheduler(manager as unknown as EnhancedMemoryManager, { enabled: false }, { buildEntityGraphFromMemories })

    await scheduler.addTask(task('entity_graph_update'))
    await scheduler.runPendingTasks()
    expect(buildEntityGraphFromMemories).not.toHaveBeenCalled()
  })

  it('记忆重排序：调用 applyDecay，并统计遗忘条数', async () => {
    const before = [mem('k1', '2026-11-01T00:00:00Z', '一'), mem('k2', '2026-11-01T00:00:00Z', '二')]
    manager.getAllMemories.mockReturnValueOnce(before).mockReturnValueOnce([before[0]!])

    const scheduler = startDreamingScheduler(manager as unknown as EnhancedMemoryManager, { enabled: false }, { buildEntityGraphFromMemories })
    const ranking = task('memory_ranking')
    await scheduler.addTask(ranking)
    await scheduler.runPendingTasks()

    expect(manager.applyDecay).toHaveBeenCalledTimes(1)
    expect(ranking.totalCount).toBe(2)
    expect(ranking.processedCount).toBe(1)
  })

  it('自传合并：有可合并对时调用 mergeSimilarMemories', async () => {
    manager.getAutobiographicalMemories.mockReturnValue([
      mem('a', '2026-11-01T00:00:00Z', '今天和妈妈去了公园散步', true),
      mem('b', '2026-11-01T01:00:00Z', '今天和妈妈去了公园散步吧', true),
    ])
    manager.mergeSimilarMemories.mockReturnValue(1)

    const scheduler = startDreamingScheduler(manager as unknown as EnhancedMemoryManager, { enabled: false }, { buildEntityGraphFromMemories })
    const merge = task('autobiographical_merge')
    await scheduler.addTask(merge)
    await scheduler.runPendingTasks()

    expect(manager.mergeSimilarMemories).toHaveBeenCalledTimes(1)
    expect(merge.processedCount).toBe(1)
  })

  it('自传合并：没有可合并对时不做 O(n²) 合并', async () => {
    manager.getAutobiographicalMemories.mockReturnValue([
      mem('p', '2026-11-01T00:00:00Z', '猫在窗台上晒太阳', true),
      mem('q', '2026-11-01T00:00:00Z', '重构了数据库迁移脚本', true),
    ])

    const scheduler = startDreamingScheduler(manager as unknown as EnhancedMemoryManager, { enabled: false }, { buildEntityGraphFromMemories })
    await scheduler.addTask(task('autobiographical_merge'))
    await scheduler.runPendingTasks()

    expect(manager.mergeSimilarMemories).not.toHaveBeenCalled()
  })
})
