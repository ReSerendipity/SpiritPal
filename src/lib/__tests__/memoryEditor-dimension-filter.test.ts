/**
 * memoryEditor-dimension-filter.test.ts
 *
 * MemoryEditor 扩展能力单测：
 * - searchMemories 支持 tagDimensions 维度过滤（与分类/时间跨组 AND）
 * - updateMemory 支持 createdAt 时间字段更新（内存 + 行级持久化）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EnhancedMemoryManager } from '@/lib/memory/enhancedMemory'
import {
  MemoryEditor,
  createMemoryEditor,
  type MemorySearchOptions,
} from '@/lib/memory/memoryEditor'
import { type EnhancedMemory } from '@/lib/memory/memoryTypes'

vi.mock('@/lib/memory/enhancedMemory', () => ({
  EnhancedMemoryManager: vi.fn(),
}))

const updateMemoryRowMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/data/db', () => ({
  updateMemoryRow: (...args: unknown[]) => updateMemoryRowMock(...args),
}))

function makeMem(partial: Partial<EnhancedMemory> & Pick<EnhancedMemory, 'id'>): EnhancedMemory {
  return {
    created_at: '2026-01-01T10:00:00.000Z',
    user: '',
    assistant: '',
    importance: 50,
    emotionalIntensity: 0,
    category: '偏好',
    tags: [],
    accessCount: 0,
    lastAccessed: Date.now(),
    decayFactor: 1,
    isAutobiographical: false,
    strength: 1,
    sourceKind: 'exchange',
    ...partial,
  } as EnhancedMemory
}

describe('MemoryEditor 多维筛选与时间编辑', () => {
  let memoryEditor: MemoryEditor
  let mockMemories: EnhancedMemory[]

  beforeEach(() => {
    vi.clearAllMocks()
    mockMemories = [
      makeMem({
        id: 'm-person',
        user: '妈妈喜欢喝茶',
        category: '关系',
        tags: ['person:妈妈'],
        created_at: '2026-01-01T10:00:00.000Z',
      }),
      makeMem({
        id: 'm-place',
        user: '公司楼下有家咖啡店',
        category: '事件',
        tags: ['place:公司', 'item:咖啡'],
        created_at: '2026-02-01T10:00:00.000Z',
      }),
      makeMem({
        id: 'm-plain',
        user: '今天天气不错',
        category: '情感',
        tags: ['天气'],
        created_at: '2026-03-01T10:00:00.000Z',
      }),
    ]

    const mgr = {
      getAllMemories: () => mockMemories,
      addExchange: vi.fn(),
      deleteMemory: vi.fn(),
    } as unknown as EnhancedMemoryManager
    memoryEditor = createMemoryEditor(mgr)
  })

  it('按标签维度筛选：只保留命中选中维度的记忆', async () => {
    const options: MemorySearchOptions = { tagDimensions: ['person'] }
    const result = await memoryEditor.searchMemories(options)
    expect(result.success).toBe(true)
    expect(result.affectedCount).toBe(1)
    expect((result.details?.memories as EnhancedMemory[])[0].id).toBe('m-person')
  })

  it('多维 AND：维度 person + 分类 关系 + 时间范围 组合', async () => {
    // 维度 person 命中 m-person；分类 关系 也命中 m-person；时间窗含 1 月 → 应唯一命中 m-person
    const result = await memoryEditor.searchMemories({
      tagDimensions: ['person'],
      categories: ['关系'],
      timeRange: {
        start: new Date('2026-01-01T00:00:00.000Z').getTime(),
        end: new Date('2026-01-31T23:59:59.000Z').getTime(),
      },
    })
    expect(result.success).toBe(true)
    expect(result.affectedCount).toBe(1)
    expect((result.details?.memories as EnhancedMemory[])[0].id).toBe('m-person')
  })

  it('维度筛选与分类筛选冲突时 AND 落空', async () => {
    // 维度 person → m-person；分类 事件 → m-place；无交集
    const result = await memoryEditor.searchMemories({
      tagDimensions: ['person'],
      categories: ['事件'],
    })
    expect(result.affectedCount).toBe(0)
  })

  it('时间范围筛选：只保留窗口内记忆', async () => {
    const result = await memoryEditor.searchMemories({
      timeRange: {
        start: new Date('2026-02-01T00:00:00.000Z').getTime(),
        end: new Date('2026-02-28T23:59:59.000Z').getTime(),
      },
    })
    expect(result.affectedCount).toBe(1)
    expect((result.details?.memories as EnhancedMemory[])[0].id).toBe('m-place')
  })

  it('未归类标签在启用维度筛选时被排除', async () => {
    // 仅选 item 维度 → m-place 命中（item:咖啡），m-plain 的「天气」未归类不命中
    const result = await memoryEditor.searchMemories({ tagDimensions: ['item'] })
    expect(result.affectedCount).toBe(1)
    expect((result.details?.memories as EnhancedMemory[])[0].id).toBe('m-place')
  })

  it('updateMemory 支持 createdAt 更新（内存态 + 行级持久化）', async () => {
    const target = mockMemories[0]!
    target.dbId = 42
    const result = await memoryEditor.updateMemory('m-person', {
      content: '妈妈喜欢喝绿茶',
      createdAt: '2026-05-05T08:30:00.000Z',
    })
    expect(result.success).toBe(true)
    expect(target.user).toBe('妈妈喜欢喝绿茶')
    expect(target.created_at).toBe('2026-05-05T08:30:00.000Z')
    // 行级持久化应带 created_at（ms）
    expect(updateMemoryRowMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        content: '妈妈喜欢喝绿茶',
        created_at: new Date('2026-05-05T08:30:00.000Z').getTime(),
      }),
    )
  })
})
