/**
 * entityGraph 图谱视图查询函数单测。
 * 覆盖：getAllEntities（行映射/类型归一化/memory_ids 解析）、
 * buildCooccurrenceEdges（共现派生）、getAllEdges、getEntityMemories（按记忆 ID 过滤）。
 *
 * db 层通过 vi.mock 替换；不触碰真实 Tauri / SQLite。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEntityNodes, getMemories } from '@/lib/data/db'
import {
  getAllEntities,
  getAllEdges,
  getEntityMemories,
  buildCooccurrenceEdges,
  type GraphEntity,
} from '@/lib/memory/entityGraph'

vi.mock('@/lib/data/db', () => ({
  upsertEntityGraphNode: vi.fn(),
  upsertEntityGraphEdge: vi.fn(),
  findEntityNodesByName: vi.fn(),
  getEntityGraphNeighbors: vi.fn(),
  getEntityNodes: vi.fn(),
  getMemories: vi.fn(),
}))

const mockGetEntityNodes = vi.mocked(getEntityNodes)
const mockGetMemories = vi.mocked(getMemories)

function entityRow(overrides: Partial<{
  id: string
  name: string
  type: string
  linked_memory_ids: string
  mention_count: number
  first_seen: number
}> = {}) {
  return {
    id: 'ent-1',
    character_id: 'doro',
    name: '主人',
    type: 'person',
    linked_memory_ids: '["mem-a","mem-b"]',
    mention_count: 5,
    first_seen: 1000,
    last_seen: 2000,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getAllEntities', () => {
  it('映射 entity_nodes 行 → GraphEntity，解析 memory_ids', async () => {
    mockGetEntityNodes.mockResolvedValue([
      entityRow({ id: 'e1', name: '主人', type: 'person', linked_memory_ids: '["mem-a","mem-b"]', mention_count: 5 }),
      entityRow({ id: 'e2', name: '公司', type: 'place', linked_memory_ids: '["mem-b","mem-c"]', mention_count: 3 }),
      entityRow({ id: 'e3', name: '奇怪类型', type: 'unknown-xyz', linked_memory_ids: '[]', mention_count: 1 }),
    ])

    const result = await getAllEntities('doro')
    expect(mockGetEntityNodes).toHaveBeenCalledWith('doro')
    expect(result).toHaveLength(3)

    expect(result[0]).toMatchObject({ id: 'e1', name: '主人', type: 'person', memoryCount: 2, mentionCount: 5, createdAt: 1000 })
    expect(result[0]!.memoryIds).toEqual(['mem-a', 'mem-b'])
    // 未知类型归一化为 concept
    expect(result[2]!.type).toBe('concept')
  })

  it('linked_memory_ids 非法 JSON 时回退为空数组', async () => {
    mockGetEntityNodes.mockResolvedValue([entityRow({ linked_memory_ids: 'not-json' })])
    const result = await getAllEntities('doro')
    expect(result[0]!.memoryIds).toEqual([])
    expect(result[0]!.memoryCount).toBe(0)
  })
})

describe('buildCooccurrenceEdges', () => {
  it('共享一条记忆 → 权重 1 的一条边（无重复方向）', () => {
    const entities: GraphEntity[] = [
      { id: 'a', name: 'A', type: 'person', memoryCount: 1, memoryIds: ['m1'], mentionCount: 1, createdAt: 0 },
      { id: 'b', name: 'B', type: 'place', memoryCount: 1, memoryIds: ['m1'], mentionCount: 1, createdAt: 0 },
    ]
    const edges = buildCooccurrenceEdges(entities)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'a', target: 'b', weight: 1, cooccurCount: 1 })
  })

  it('共享两条记忆 → 权重 2；三方共现 → 三条边', () => {
    const entities: GraphEntity[] = [
      { id: 'a', name: 'A', type: 'person', memoryCount: 2, memoryIds: ['m1', 'm2'], mentionCount: 1, createdAt: 0 },
      { id: 'b', name: 'B', type: 'person', memoryCount: 2, memoryIds: ['m1', 'm2'], mentionCount: 1, createdAt: 0 },
      { id: 'c', name: 'C', type: 'event', memoryCount: 1, memoryIds: ['m1'], mentionCount: 1, createdAt: 0 },
    ]
    const edges = buildCooccurrenceEdges(entities)
    // a-b 共享 m1,m2 → 2；a-c 共享 m1 → 1；b-c 共享 m1 → 1
    expect(edges).toHaveLength(3)
    const ab = edges.find((e) => (e.source === 'a' && e.target === 'b') || (e.source === 'b' && e.target === 'a'))
    expect(ab!.weight).toBe(2)
  })

  it('无共享记忆 → 无边', () => {
    const entities: GraphEntity[] = [
      { id: 'a', name: 'A', type: 'person', memoryCount: 1, memoryIds: ['m1'], mentionCount: 1, createdAt: 0 },
      { id: 'b', name: 'B', type: 'person', memoryCount: 1, memoryIds: ['m9'], mentionCount: 1, createdAt: 0 },
    ]
    expect(buildCooccurrenceEdges(entities)).toEqual([])
  })
})

describe('getAllEdges', () => {
  it('先查实体再派生边', async () => {
    mockGetEntityNodes.mockResolvedValue([
      entityRow({ id: 'a', linked_memory_ids: '["m1"]' }),
      entityRow({ id: 'b', linked_memory_ids: '["m1"]' }),
    ])
    const edges = await getAllEdges('doro')
    expect(mockGetEntityNodes).toHaveBeenCalledWith('doro')
    expect(edges).toHaveLength(1)
    expect(edges[0]!.weight).toBe(1)
  })
})

describe('getEntityMemories', () => {
  it('按实体 linked_memory_ids 过滤记忆行', async () => {
    mockGetEntityNodes.mockResolvedValue([
      entityRow({ id: 'e1', linked_memory_ids: '["mem-a","mem-b"]' }),
    ])
    mockGetMemories.mockResolvedValue([
      { memory_id: 'mem-a', content: '今天开会' },
      { memory_id: 'mem-b', content: '明天聚餐' },
      { memory_id: 'mem-c', content: '不相关' },
    ] as Array<Record<string, unknown>>)

    const mems = await getEntityMemories('doro', 'e1')
    expect(mockGetMemories).toHaveBeenCalledWith('doro')
    expect(mems).toHaveLength(2)
    expect(mems.map((m) => m.memory_id)).toEqual(['mem-a', 'mem-b'])
  })

  it('实体不存在或无关联记忆 → 返回空数组', async () => {
    mockGetEntityNodes.mockResolvedValue([entityRow({ id: 'e1', linked_memory_ids: '[]' })])
    const mems = await getEntityMemories('doro', 'e1')
    expect(mems).toEqual([])
    // 无关联记忆时不应再拉全量记忆
    expect(mockGetMemories).not.toHaveBeenCalled()
  })
})
