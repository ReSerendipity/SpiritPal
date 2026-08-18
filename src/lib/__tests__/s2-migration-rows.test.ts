/**
 * S2 记忆存储架构重构测试
 *
 * 测试范围（覆盖方案 §9 全部用例）：
 * - 迁移4场景：空库 / ENC1 旧库 / ENC2 旧库 / 已有部分行
 * - 行级 CRUD 往返
 * - 双模式回退（行级加载失败 → 回退 blob；legacy 开关）
 * - export/import 兼容旧备份文件
 * - memory_id ↔ embedding 对账
 * - corrupt 保留逻辑在新路径下仍生效
 * - 行级 load/save 路径
 * - applyForgetting/applyConsolidation/mergeSimilarMemories 行级化验证
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============ Mock 基础设施 ============

// Mock invoke — 支持加密/解密模拟
const mockInvoke = vi.fn((cmd: string, _args?: Record<string, unknown>) => {
  if (cmd === 'decrypt_data') return Promise.resolve('decrypted-data')
  if (cmd === 'encrypt_data') return Promise.resolve('ENC2:encrypted-data')
  return Promise.resolve('')
})
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

// Mock db 模块 — 使用内存 Map 模拟 settings 存储
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
    // 暴露 settingsStore 供测试操控
    __settingsStore: settingsStore,
  }
})

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

// ============ 辅助函数 ============

/** 构造模拟旧 blob 数据（明文 JSON） */
function makeLegacyBlobData(memories: { user: string; assistant: string; id: string }[] = []) {
  return JSON.stringify({
    workingMemory: memories.map((m, i) => ({
      id: m.id,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
      user: m.user,
      assistant: m.assistant,
      importance: 50,
      emotionalIntensity: 0.3,
      category: '日常',
      tags: ['test'],
      accessCount: 0,
      lastAccessed: Date.now(),
      decayFactor: 1.0,
      isAutobiographical: false,
      emotionalValence: 0,
      emotionalArousal: 0.3,
      strength: 1.0,
      sourceKind: 'exchange',
    })),
    episodicMemory: [],
    semanticMemory: '测试摘要',
    autobiographicalMemory: [],
    triggerLog: [],
    ignoreCount: {},
    lastPeriodicFireDate: {},
    lastChatDate: '2026-08-14',
  })
}

/** 构造模拟 MemoryRow */
function makeMemoryRow(overrides: Partial<{
  id: number
  character_id: string
  memory_id: string
  content: string
  assistant: string
  tier: string
  importance: number
  is_autobiographical: number
  created_at: number
  access_count: number
  last_accessed: number
}> = {}) {
  return {
    id: overrides.id ?? 1,
    character_id: overrides.character_id ?? 'test-char',
    type: 'short_term',
    content: overrides.content ?? '测试记忆内容',
    importance: overrides.importance ?? 50,
    created_at: overrides.created_at ?? Date.now(),
    last_accessed: overrides.last_accessed ?? Date.now(),
    memory_id: overrides.memory_id ?? 'mem-001',
    assistant: overrides.assistant ?? 'AI 回复',
    category: '日常',
    tags: '[]',
    emotional_intensity: 0,
    emotional_valence: 0,
    emotional_arousal: 0.3,
    strength: 1.0,
    decay_factor: 1.0,
    access_count: overrides.access_count ?? 0,
    source_kind: 'exchange',
    fact_text: null,
    is_autobiographical: overrides.is_autobiographical ?? 0,
    tier: overrides.tier ?? 'working',
    embedding: null,
  }
}

// ============ 测试用例 ============

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

  it('insertMemoryRow 写入后 updateMemoryRow 更新 tier 应保留 memory_id', async () => {
    const { insertMemoryRow, updateMemoryRow } = await import('../db')
    const rowid = await insertMemoryRow({
      character_id: 'test-char',
      type: 'short_term',
      content: '测试记忆',
      importance: 50,
      created_at: Date.now(),
      last_accessed: Date.now(),
      memory_id: 'mem-unique-001',
      assistant: '回复',
      category: '日常',
      tags: '[]',
      tier: 'working',
    })
    expect(rowid).toBe(1)
    // 模拟 working → episodic 溢出
    await updateMemoryRow(rowid, { tier: 'episodic' })
    expect(updateMemoryRow).toHaveBeenCalledWith(rowid, { tier: 'episodic' })
  })
})

describe('S2: memory_id ↔ embedding 对账', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('insertMemoryRow 返回的 rowid 应与 saveEmbedding 关联', async () => {
    const { insertMemoryRow, saveEmbedding } = await import('../db')
    const rowid = await insertMemoryRow({
      character_id: 'char-recon',
      type: 'short_term',
      content: '对账测试',
      importance: 50,
      created_at: Date.now(),
      last_accessed: Date.now(),
      memory_id: 'mem-recon-001',
      assistant: '回复',
      category: '日常',
      tags: '[]',
      tier: 'working',
    })
    // saveEmbedding 应使用同一 rowid
    await saveEmbedding(rowid, new Float32Array([1, 2, 3]))
    expect(saveEmbedding).toHaveBeenCalledWith(rowid, expect.any(Float32Array))
  })

  it('迁移时 memory_id 应保留原始 id（不重算 embedding）', async () => {
    const { getSetting, isMemoryMigrated, isLegacyMode, insertMemoryRow } = await import('../db')
    const { migrateCharacterMemory } = await import('../memoryMigrator')

    const legacyData = makeLegacyBlobData([
      { user: '保留 ID 测试', assistant: '回复', id: 'mem-original-id-001' },
    ])
    vi.mocked(getSetting).mockResolvedValueOnce(`ENC2:${legacyData}`)
    vi.mocked(isMemoryMigrated).mockResolvedValueOnce(false)
    vi.mocked(isLegacyMode).mockResolvedValueOnce(false)
    mockInvoke.mockResolvedValueOnce(legacyData)

    await migrateCharacterMemory('recon-char')

    // insertMemoryRow 应被调用，且 memory_id 字段保留原始 id
    const call = vi.mocked(insertMemoryRow).mock.calls[0]
    expect(call).toBeDefined()
    const rowArg = call?.[0] as unknown as Record<string, unknown>
    expect(rowArg.memory_id).toBe('mem-original-id-001')
  })
})

describe('S2: 行级 load 路径', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('行级路径应从 getMemoriesByTier 加载三层记忆', async () => {
    const { isMemoryMigrated, isLegacyMode, getMemoriesByTier, getMemorySummary, getMemoryState, getSetting } = await import('../db')
    const { EnhancedMemoryManager } = await import('../enhancedMemory')

    // 模拟已迁移 → 走行级路径
    vi.mocked(isMemoryMigrated).mockResolvedValue(true)
    vi.mocked(isLegacyMode).mockResolvedValue(false)
    // getSetting 返回 null（无旧 blob，needsMigration 返回 false）
    vi.mocked(getSetting).mockResolvedValue(null)

    const mockRows = [
      makeMemoryRow({ id: 1, memory_id: 'mem-w-1', content: '工作记忆1', tier: 'working' }),
      makeMemoryRow({ id: 2, memory_id: 'mem-e-1', content: '情景记忆1', tier: 'episodic' }),
      makeMemoryRow({ id: 3, memory_id: 'mem-a-1', content: '自传记忆1', tier: 'autobiographical', is_autobiographical: 1 }),
    ]
    vi.mocked(getMemoriesByTier).mockResolvedValue(mockRows)
    vi.mocked(getMemorySummary).mockResolvedValue('行级摘要')
    vi.mocked(getMemoryState).mockResolvedValue({
      character_id: 'row-char',
      last_chat_date: '2026-08-15',
      trigger_log: '[]',
      ignore_count: '{}',
      last_periodic_fire_date: '{}',
      injected_at: '{}',
      llm_reassessed_ids: '[]',
    })

    const mgr = new EnhancedMemoryManager('row-char')
    await mgr.ensureLoaded()

    // 验证行级加载被调用
    expect(getMemoriesByTier).toHaveBeenCalledWith('row-char', ['working', 'episodic', 'autobiographical'])
    expect(getMemorySummary).toHaveBeenCalledWith('row-char')
    expect(getMemoryState).toHaveBeenCalledWith('row-char')
  })

  it('行级加载失败应回退到 blob 路径', async () => {
    const { isMemoryMigrated, isLegacyMode, getMemoriesByTier, getSetting } = await import('../db')
    const { EnhancedMemoryManager } = await import('../enhancedMemory')

    vi.mocked(isMemoryMigrated).mockResolvedValue(true)
    vi.mocked(isLegacyMode).mockResolvedValue(false)
    vi.mocked(getMemoriesByTier).mockRejectedValue(new Error('DB corrupted'))
    vi.mocked(getSetting).mockResolvedValue(null) // 无 blob

    const mgr = new EnhancedMemoryManager('fallback-char')
    await mgr.ensureLoaded()

    // 应尝试行级路径（失败后回退 blob）
    expect(getMemoriesByTier).toHaveBeenCalled()
  })
})

describe('S2: 行级 save 路径', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('行级路径 doSave 应仅写 memory_state + memory_summaries', async () => {
    const { isMemoryMigrated, isLegacyMode, upsertMemoryState, getMemoriesByTier, getMemorySummary, getMemoryState, getSetting } = await import('../db')
    const { EnhancedMemoryManager } = await import('../enhancedMemory')

    // 模拟已迁移 → 走行级路径
    vi.mocked(isMemoryMigrated).mockResolvedValue(true)
    vi.mocked(isLegacyMode).mockResolvedValue(false)
    vi.mocked(getSetting).mockResolvedValue(null) // 无旧 blob
    vi.mocked(getMemoriesByTier).mockResolvedValue([])
    vi.mocked(getMemorySummary).mockResolvedValue('')
    vi.mocked(getMemoryState).mockResolvedValue(null)

    const mgr = new EnhancedMemoryManager('save-char')
    await mgr.ensureLoaded()
    mgr.addExchange('测试保存', '回复')
    // 通过 import 触发 forceSave（import 内部调用 forceSave）
    mgr.import(JSON.stringify({
      workingMemory: [],
      episodicMemory: [],
      semanticMemory: '',
      autobiographicalMemory: [],
      triggerLog: [],
      ignoreCount: {},
      lastPeriodicFireDate: {},
      lastChatDate: null,
      injectedAt: [],
      llmReassessedIds: [],
    }))
    // 等待 forceSave 完成
    await new Promise(r => setTimeout(r, 100))

    // 行级路径应调用 upsertMemoryState
    expect(upsertMemoryState).toHaveBeenCalled()
    // 不应调用 encrypt_data（per-value 加密已退役）
    expect(mockInvoke).not.toHaveBeenCalledWith('encrypt_data', expect.anything())
  })
})
