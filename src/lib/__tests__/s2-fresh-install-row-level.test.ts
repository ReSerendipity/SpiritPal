/**
 * 回归：全新安装必须走行级存储，而不是被"迁移标记从未置位"卡在旧 blob 路径上。
 *
 * 缺陷现场（2026-10-03，Android 模拟器 + 可用 AI 服务商实测）：
 *   对话成功、addExchange 也执行了，memories 表里确实多出 2 行，
 *   但移动端「全部记忆 (0)」，标签云 / 情感曲线 / 记忆密度 全空。
 *   落库行的特征暴露了写入分支：type=long_term、memory_id 为空、
 *   tier 停在 DB 默认值 'episodic'、tags='[]'、emotional_intensity=0.0
 *   —— 即 legacy 分支 addMemory(id, type, content, importance) 只写这 4 个字段。
 *   而读侧 loadFromBlob() 取的是 settings 键 spiritpal-enhanced-memory-<角色>，
 *   该键在库里根本不存在 ⇒ 读写落在两个不同的地方。
 *
 * 根因：load() 用 `migrated && !legacy` 决定存储模式，但全新安装没有旧 blob
 *   ⇒ needsMigration 恒 false ⇒ migrateCharacterMemory 从不执行
 *   ⇒ setMemoryMigrated 从不被调用 ⇒ 永远走旧路径。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EnhancedMemoryManager } from '@/lib/memory/enhancedMemory'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'decrypt_data') return Promise.resolve('{}')
    if (cmd === 'encrypt_data') return Promise.resolve(JSON.stringify({}))
    return Promise.resolve('')
  }),
}))

vi.mock('@/lib/system/vectorSearch', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array([0.1, 0.2, 0.3]))),
  cosineSimilarity: vi.fn(() => 0.8),
  isVectorSearchAvailable: vi.fn(() => Promise.resolve(false)),
  searchSimilar: vi.fn(() => Promise.resolve([])),
}))

const db = vi.hoisted(() => ({
  getSetting: vi.fn((_key: string): Promise<string | null> => Promise.resolve(null)),
  setSetting: vi.fn((_key: string, _val: string): Promise<void> => Promise.resolve()),
  addMemory: vi.fn(
    (_c: string, _t: string, _x: string, _i: number): Promise<number> => Promise.resolve(1),
  ),
  insertMemoryRow: vi.fn((_row: Record<string, unknown>): Promise<number> => Promise.resolve(1)),
  updateMemoryRow: vi.fn((_id: number, _p: Record<string, unknown>): Promise<void> => Promise.resolve()),
  saveEmbedding: vi.fn((_id: number, _e: Float32Array): Promise<void> => Promise.resolve()),
  getAllEmbeddings: vi.fn((_c: string): Promise<unknown[]> => Promise.resolve([])),
  getMemoriesByTier: vi.fn(
    (_c: string, _t?: string[] | null): Promise<unknown[]> => Promise.resolve([]),
  ),
  getMemorySummary: vi.fn((_c: string): Promise<string | null> => Promise.resolve(null)),
  getMemoryState: vi.fn((_c: string): Promise<unknown> => Promise.resolve(null)),
  getSemanticFacts: vi.fn((_c: string): Promise<unknown[]> => Promise.resolve([])),
  upsertMemoryState: vi.fn((_r: Record<string, unknown>): Promise<void> => Promise.resolve()),
  upsertMemorySummary: vi.fn((_c: string, _s: string): Promise<void> => Promise.resolve()),
  clearMemories: vi.fn((_c: string): Promise<void> => Promise.resolve()),
  updateMemoryLastAccessed: vi.fn((_id: number): Promise<void> => Promise.resolve()),
  isMemoryMigrated: vi.fn((): Promise<boolean> => Promise.resolve(false)),
  isLegacyMode: vi.fn((): Promise<boolean> => Promise.resolve(false)),
}))
vi.mock('@/lib/data/db', () => db)

const migrator = vi.hoisted(() => ({
  needsMigration: vi.fn((): Promise<boolean> => Promise.resolve(false)),
  migrateCharacterMemory: vi.fn((): Promise<unknown> => Promise.resolve({ migrated: 0 })),
  hasLegacyMemoryBlob: vi.fn((): Promise<boolean> => Promise.resolve(false)),
}))
vi.mock('@/lib/memory/memoryMigrator', () => migrator)

/** addExchange 里的 saveToVectorStore 是 void 异步，先把它冲出去再断言 */
async function flush() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('S2 存储模式判定：全新安装', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    db.getSetting.mockResolvedValue(null)
    db.isMemoryMigrated.mockResolvedValue(false)
    db.isLegacyMode.mockResolvedValue(false)
    migrator.needsMigration.mockResolvedValue(false)
    migrator.hasLegacyMemoryBlob.mockResolvedValue(false)
  })

  it('无旧 blob 且从未迁移 ⇒ 写入走行级分支（带 tags 与情绪强度）', async () => {
    const mgr = new EnhancedMemoryManager('fresh-install-char')
    await mgr.ensureLoaded()

    mgr.addExchange('今天很 happy，在 park 走了很久，park 的风很舒服', '回复')
    await flush()

    expect(db.insertMemoryRow).toHaveBeenCalledTimes(1)
    expect(db.addMemory).not.toHaveBeenCalled()

    const row = db.insertMemoryRow.mock.calls[0][0]
    // 下面三项正是旧分支丢掉的字段，也是标签云 / 情感曲线的数据来源
    // 顺序不固定（extractTags 按词频排，park 出现两次故靠前），只断言集合
    expect(JSON.parse(String(row.tags)).sort()).toEqual(['happy', 'park'])
    expect(Number(row.emotional_intensity)).toBeGreaterThan(0)
    expect(['working', 'episodic', 'autobiographical']).toContain(String(row.tier))
    expect(String(row.memory_id ?? '')).not.toBe('')
  })

  it('读侧与写侧同源：行级路径从 memories 表加载，不去读 settings blob', async () => {
    const mgr = new EnhancedMemoryManager('fresh-install-char-2')
    await mgr.ensureLoaded()
    await flush()

    expect(db.getMemoriesByTier).toHaveBeenCalledWith('fresh-install-char-2',
      ['working', 'episodic', 'autobiographical'])
    // 行级路径不应再读那个从未被写过的 blob 键
    const blobKeys = db.getSetting.mock.calls
      .map((c) => String(c[0]))
      .filter((k) => k.startsWith('spiritpal-enhanced-memory-'))
    expect(blobKeys).toEqual([])
  })

  it('仍保留迁移窗口：存在旧 blob 且未迁移时，继续走旧路径', async () => {
    migrator.hasLegacyMemoryBlob.mockResolvedValue(true)
    db.isMemoryMigrated.mockResolvedValue(false)

    const mgr = new EnhancedMemoryManager('legacy-char')
    await mgr.ensureLoaded()
    mgr.addExchange('旧路径测试', '回复')
    await flush()

    expect(db.addMemory).toHaveBeenCalledTimes(1)
    expect(db.insertMemoryRow).not.toHaveBeenCalled()
  })

  it('显式 legacy 模式优先：即便没有旧 blob 也不启用行级', async () => {
    db.isLegacyMode.mockResolvedValue(true)

    const mgr = new EnhancedMemoryManager('forced-legacy-char')
    await mgr.ensureLoaded()
    mgr.addExchange('强制 legacy', '回复')
    await flush()

    expect(db.addMemory).toHaveBeenCalledTimes(1)
    expect(db.insertMemoryRow).not.toHaveBeenCalled()
  })
})
