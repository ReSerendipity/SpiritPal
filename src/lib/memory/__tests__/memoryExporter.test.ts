/**
 * @file memoryExporter.test.ts
 * @description 记忆导出：多角色批量导出的角色枚举与格式
 *
 * 覆盖 TD-010a 的核心：不指定 characterId 时不再「静默落默认角色」，而是
 * ① 从 memories 表枚举有数据的角色；② 补查旧 blob 的 settings 键；③ 逐个取数并标注角色。
 * 同时钉住单角色导出行为不变（不加 characterId 字段、CSV 不加角色列），避免修一个坑挖另一个。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListMemoryCharacters = vi.fn()
const mockGetSettingsKeysLike = vi.fn()
const mockGetCharacter = vi.fn()
const mockGetEnhancedMemoryManager = vi.fn()
const mockGetKeyframeMemory = vi.fn()

vi.mock('@/lib/data/db', () => ({
  listMemoryCharacters: (...args: unknown[]) => mockListMemoryCharacters(...args),
  getSettingsKeysLike: (...args: unknown[]) => mockGetSettingsKeysLike(...args),
}))

vi.mock('@/lib/data/characters', () => ({
  getCharacter: (...args: unknown[]) => mockGetCharacter(...args),
}))

vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: (...args: unknown[]) => mockGetEnhancedMemoryManager(...args),
}))

vi.mock('@/lib/memory/keyframeMemory', () => ({
  getKeyframeMemory: () => mockGetKeyframeMemory(),
}))

import { MemoryExporter } from '@/lib/memory/memoryExporter'

function entry(user: string, assistant: string, createdAt = '2026-11-01T10:00:00.000Z') {
  return { created_at: createdAt, user, assistant }
}

/** 造一个角色管理器桩：ensureLoaded 成功、getAllMemories 返回给定列表 */
function managerWith(list: ReturnType<typeof entry>[]) {
  return {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getAllMemories: vi.fn().mockReturnValue(list),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSettingsKeysLike.mockResolvedValue([])
  mockGetCharacter.mockReturnValue(undefined)
  mockGetKeyframeMemory.mockReturnValue({ getAllFrames: () => [] })
})

describe('MemoryExporter 多角色导出（TD-010a）', () => {
  it('未指定角色时枚举有数据的角色，条目带 characterId 且文件名点明范围', async () => {
    mockListMemoryCharacters.mockResolvedValue([
      { character_id: 'alice', memory_count: 1 },
      { character_id: 'bob', memory_count: 1 },
    ])
    const alice = managerWith([entry('早', '早上好')])
    const bob = managerWith([entry('晚安', '晚安啦')])
    mockGetEnhancedMemoryManager.mockImplementation((id: string) => (id === 'alice' ? alice : bob))

    const result = await new MemoryExporter({ format: 'json' }).export()

    expect(mockGetEnhancedMemoryManager.mock.calls.map((c) => c[0])).toEqual(['alice', 'bob'])
    expect(result.memoryCount).toBe(2)
    expect(result.filename).toMatch(/^all-characters-memories-\d{4}-\d{2}-\d{2}\.json$/)

    const payload = JSON.parse(result.content)
    expect(payload.entries.map((e: { characterId: string }) => e.characterId)).toEqual([
      'alice',
      'bob',
    ])
    expect(payload._exportMeta.characters).toHaveLength(2)
    expect(payload._exportMeta.characterCount).toBe(2)
  })

  it('多角色 CSV 增加「角色」列，避免合并后分不清归属', async () => {
    mockListMemoryCharacters.mockResolvedValue([{ character_id: 'alice', memory_count: 1 }])
    mockGetSettingsKeysLike.mockResolvedValue(['spiritpal-enhanced-memory-bob'])
    mockGetEnhancedMemoryManager.mockImplementation((id: string) =>
      id === 'alice' ? managerWith([entry('a', 'A')]) : managerWith([entry('b', 'B')]),
    )

    const result = await new MemoryExporter({ format: 'csv' }).export()
    const lines = result.content.split('\n')

    expect(lines[0]).toBe('角色,日期,用户消息,AI 回复,字数统计')
    expect(lines[1]?.startsWith('alice,')).toBe(true)
    expect(lines[2]?.startsWith('bob,')).toBe(true)
  })

  it('旧 blob 键反推角色时剔除 .corrupt 备份键，且不产生伪角色 id', async () => {
    mockListMemoryCharacters.mockResolvedValue([])
    mockGetSettingsKeysLike.mockResolvedValue([
      'spiritpal-enhanced-memory-solo',
      'spiritpal-enhanced-memory-solo.corrupt',
      'spiritpal-enhanced-memory-',
      'unrelated:key',
    ])
    const solo = managerWith([entry('hi', 'hello')])
    mockGetEnhancedMemoryManager.mockReturnValue(solo)

    const result = await new MemoryExporter({ format: 'json' }).export()

    expect(mockGetEnhancedMemoryManager.mock.calls.map((c) => c[0])).toEqual(['solo'])
    expect(result.memoryCount).toBe(1)
  })

  it('两处都枚举不到角色时回退默认角色（保持旧行为，不静默导空）', async () => {
    mockListMemoryCharacters.mockResolvedValue([])
    mockGetSettingsKeysLike.mockResolvedValue([])
    const def = managerWith([entry('x', 'y')])
    mockGetEnhancedMemoryManager.mockReturnValue(def)

    const result = await new MemoryExporter({ format: 'json' }).export()

    expect(mockGetEnhancedMemoryManager).toHaveBeenCalledWith('default')
    expect(result.filename).toMatch(/^default-memories-/)
    expect(result.memoryCount).toBe(1)
  })

  it('枚举到的角色若记忆为空，则跳过且不写进元数据', async () => {
    mockListMemoryCharacters.mockResolvedValue([
      { character_id: 'empty', memory_count: 1 },
      { character_id: 'full', memory_count: 1 },
    ])
    mockGetEnhancedMemoryManager.mockImplementation((id: string) =>
      id === 'empty' ? managerWith([]) : managerWith([entry('u', 'r')]),
    )

    const result = await new MemoryExporter({ format: 'json' }).export()
    const payload = JSON.parse(result.content)

    expect(result.memoryCount).toBe(1)
    expect(payload._exportMeta.characters).toEqual([{ id: 'full', name: 'full' }])
    expect(result.filename).toMatch(/^full-memories-/)
  })

  it('指定角色时保持旧格式：条目无 characterId、CSV 无角色列', async () => {
    mockGetEnhancedMemoryManager.mockReturnValue(managerWith([entry('u', 'r')]))

    const json = await new MemoryExporter({ format: 'json', characterId: 'solo' }).export()
    const payload = JSON.parse(json.content)
    expect(payload.entries[0]).not.toHaveProperty('characterId')
    expect(json.filename).toMatch(/^solo-memories-/)
    // 单角色导出不应触发任何角色枚举
    expect(mockListMemoryCharacters).not.toHaveBeenCalled()

    const csv = await new MemoryExporter({ format: 'csv', characterId: 'solo' }).export()
    expect(csv.content.split('\n')[0]).toBe('日期,用户消息,AI 回复,字数统计')
  })

  it('行级枚举抛错时降级到旧 blob 枚举，不中断导出', async () => {
    mockListMemoryCharacters.mockRejectedValue(new Error('db not ready'))
    mockGetSettingsKeysLike.mockResolvedValue(['spiritpal-enhanced-memory-legacy'])
    mockGetEnhancedMemoryManager.mockReturnValue(managerWith([entry('u', 'r')]))

    const result = await new MemoryExporter({ format: 'json' }).export()

    expect(result.memoryCount).toBe(1)
    expect(result.filename).toMatch(/^legacy-memories-/)
  })

  it('默认角色名查询用 getCharacter 的 displayName，查不到回落 id', async () => {
    mockListMemoryCharacters.mockResolvedValue([{ character_id: 'alice', memory_count: 1 }])
    mockGetEnhancedMemoryManager.mockReturnValue(managerWith([entry('u', 'r')]))
    mockGetCharacter.mockReturnValue({ displayName: '爱丽丝' })

    const result = await new MemoryExporter({ format: 'json' }).export()
    const payload = JSON.parse(result.content)

    expect(payload._exportMeta.characters).toEqual([{ id: 'alice', name: '爱丽丝' }])

    mockGetCharacter.mockReturnValue(undefined)
    const second = await new MemoryExporter({ format: 'json' }).export()
    expect(JSON.parse(second.content)._exportMeta.characters).toEqual([
      { id: 'alice', name: 'alice' },
    ])
  })
})
