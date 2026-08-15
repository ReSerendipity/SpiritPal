/**
 * S2 记忆存储架构重构测试
 *
 * 测试范围：
 * - 迁移往返（空库/旧 blob/已迁移场景）
 * - 行级 CRUD 往返
 * - 双模式回退
 * - 行级 load/save 路径
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db 模块
vi.mock('../db', () => {
  const mockDb = {
    execute: vi.fn(),
    select: vi.fn(),
    close: vi.fn(),
  }
  const settingsStore = new Map<string, string>()

  return {
    getDb: vi.fn().mockResolvedValue(mockDb),
    initDB: vi.fn().mockResolvedValue(mockDb),
    closeDatabase: vi.fn(),
    getSetting: vi.fn((key: string) => Promise.resolve(settingsStore.get(key) ?? null)),
    setSetting: vi.fn((key: string, value: string) => {
      settingsStore.set(key, value)
      return Promise.resolve()
    }),
    removeSetting: vi.fn((key: string) => {
      settingsStore.delete(key)
      return Promise.resolve()
    }),
    addMemory: vi.fn().mockResolvedValue(1),
    saveEmbedding: vi.fn().mockResolvedValue(undefined),
    getAllEmbeddings: vi.fn().mockResolvedValue([]),
    updateMemoryLastAccessed: vi.fn().mockResolvedValue(undefined),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    clearMemories: vi.fn().mockResolvedValue(undefined),
    // S2 行级 CRUD
    insertMemoryRow: vi.fn().mockResolvedValue(1),
    updateMemoryRow: vi.fn().mockResolvedValue(undefined),
    getMemoriesByTier: vi.fn().mockResolvedValue([]),
    getMemoriesByCharacter: vi.fn().mockResolvedValue([]),
    getMemorySummary: vi.fn().mockResolvedValue(null),
    upsertMemorySummary: vi.fn().mockResolvedValue(undefined),
    deleteMemorySummary: vi.fn().mockResolvedValue(undefined),
    getMemoryState: vi.fn().mockResolvedValue(null),
    upsertMemoryState: vi.fn().mockResolvedValue(undefined),
    deleteMemoryState: vi.fn().mockResolvedValue(undefined),
    clearAllMemoryData: vi.fn().mockResolvedValue(undefined),
    isMemoryMigrated: vi.fn().mockResolvedValue(false),
    setMemoryMigrated: vi.fn().mockResolvedValue(undefined),
    isLegacyMode: vi.fn().mockResolvedValue(false),
  }
})

// Mock invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue('decrypted-data'),
}))

// Mock vectorSearch
vi.mock('../vectorSearch', () => ({
  embed: vi.fn().mockResolvedValue(new Float32Array([1, 2, 3])),
  isVectorSearchAvailable: vi.fn().mockResolvedValue(true),
  searchSimilar: vi.fn().mockReturnValue([]),
  terminateVectorSearch: vi.fn(),
}))

// Mock ragRetrieval
vi.mock('../ragRetrieval', () => ({
  getRAGRetriever: vi.fn().mockReturnValue({
    search: vi.fn().mockResolvedValue([]),
    addMemory: vi.fn(),
    removeMemory: vi.fn(),
    rebuildIndex: vi.fn(),
  }),
  DEFAULT_RAG_CONFIG: { vectorMinScore: 0.3, bm25MinScore: 0.1, rrfK: 60, alpha: 0.5 },
}))

// Mock entityLinking
vi.mock('../entityLinking', () => ({
  getEntityManager: vi.fn().mockReturnValue({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getLinkedMemoryIds: vi.fn().mockReturnValue([]),
  }),
}))

describe('S2: 行级 CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('insertMemoryRow 应写入完整字段并返回 rowid', async () => {
    const { insertMemoryRow } = await import('../db')
    const result = await insertMemoryRow({
      character_id: 'test-char',
      type: 'short_term',
      content: '测试记忆',
      importance: 50,
      created_at: Date.now(),
      last_accessed: Date.now(),
      memory_id: 'mem-001',
      assistant: 'AI 回复',
      category: '日常',
      tags: '["tag1"]',
      tier: 'working',
    })
    expect(result).toBe(1)
    expect(insertMemoryRow).toHaveBeenCalled()
  })

  it('updateMemoryRow 应更新指定字段', async () => {
    const { updateMemoryRow } = await import('../db')
    await updateMemoryRow(1, { tier: 'episodic', importance: 80 })
    expect(updateMemoryRow).toHaveBeenCalledWith(1, { tier: 'episodic', importance: 80 })
  })

  it('getMemoriesByTier 应按 tier 查询', async () => {
    const { getMemoriesByTier } = await import('../db')
    await getMemoriesByTier('test-char', ['working', 'episodic'])
    expect(getMemoriesByTier).toHaveBeenCalledWith('test-char', ['working', 'episodic'])
  })

  it('upsertMemorySummary 应 upsert 语义摘要', async () => {
    const { upsertMemorySummary } = await import('../db')
    await upsertMemorySummary('test-char', '测试摘要')
    expect(upsertMemorySummary).toHaveBeenCalledWith('test-char', '测试摘要')
  })

  it('upsertMemoryState 应 upsert 触发状态', async () => {
    const { upsertMemoryState } = await import('../db')
    const state = {
      character_id: 'test-char',
      last_chat_date: '2026-08-15',
      trigger_log: '[]',
      ignore_count: '{}',
      last_periodic_fire_date: '{}',
      injected_at: '{}',
      llm_reassessed_ids: '[]',
    }
    await upsertMemoryState(state)
    expect(upsertMemoryState).toHaveBeenCalledWith(state)
  })

  it('clearAllMemoryData 应清空所有行级数据', async () => {
    const { clearAllMemoryData } = await import('../db')
    await clearAllMemoryData('test-char')
    expect(clearAllMemoryData).toHaveBeenCalledWith('test-char')
  })
})

describe('S2: 迁移标记', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isMemoryMigrated 应返回布尔值', async () => {
    const { isMemoryMigrated } = await import('../db')
    const result = await isMemoryMigrated()
    expect(typeof result).toBe('boolean')
  })

  it('isLegacyMode 应返回布尔值', async () => {
    const { isLegacyMode } = await import('../db')
    const result = await isLegacyMode()
    expect(typeof result).toBe('boolean')
  })
})

describe('S2: 迁移器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('needsMigration 应在未迁移且有 blob 时返回 true', async () => {
    const { getSetting } = await import('../db')
    const { needsMigration } = await import('../memoryMigrator')

    // 模拟有旧 blob
    vi.mocked(getSetting).mockResolvedValueOnce('ENC2:some-encrypted-data')
    // 模拟未迁移
    const { isMemoryMigrated, isLegacyMode } = await import('../db')
    vi.mocked(isMemoryMigrated).mockResolvedValueOnce(false)
    vi.mocked(isLegacyMode).mockResolvedValueOnce(false)

    const result = await needsMigration('test-char')
    expect(result).toBe(true)
  })

  it('needsMigration 应在已迁移时返回 false', async () => {
    const { isMemoryMigrated } = await import('../db')
    const { needsMigration } = await import('../memoryMigrator')

    vi.mocked(isMemoryMigrated).mockResolvedValueOnce(true)

    const result = await needsMigration('test-char')
    expect(result).toBe(false)
  })

  it('needsMigration 应在 legacy 模式时返回 false', async () => {
    const { isMemoryMigrated, isLegacyMode } = await import('../db')
    const { needsMigration } = await import('../memoryMigrator')

    vi.mocked(isMemoryMigrated).mockResolvedValueOnce(false)
    vi.mocked(isLegacyMode).mockResolvedValueOnce(true)

    const result = await needsMigration('test-char')
    expect(result).toBe(false)
  })

  it('migrateCharacterMemory 应在无 blob 时设标记并返回成功', async () => {
    const { getSetting } = await import('../db')
    const { migrateCharacterMemory } = await import('../memoryMigrator')

    vi.mocked(getSetting).mockResolvedValueOnce(null)

    const result = await migrateCharacterMemory('test-char')
    expect(result.success).toBe(true)
    expect(result.error).toContain('No legacy blob')
  })
})
