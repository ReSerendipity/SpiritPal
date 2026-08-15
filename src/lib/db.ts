/**
 * SQLite 持久化层 — 使用 tauri-plugin-sql 替代 localStorage
 * PRD 要求：所有养成/记忆/模组/设置数据持久化到 SQLite
 *
 * @fileoverview
 * 主要模块：
 * - getDb()：获取数据库实例（单例，自动初始化）
 * - initDB()：初始化数据库（建表、PRAGMA 优化、localStorage 迁移）
 * - getSetting()/setSetting()：全局设置读写
 * - getCharacterData()/saveCharacterData()：角色养成数据读写
 * - getMemories()/saveMemories()：记忆数据读写
 * - getMods()/saveMods()：模组数据读写
 * - getInventory()/saveInventory()：背包数据读写
 *
 * 表结构：
 *   characters — 角色养成数据（每个角色一行）
 *   settings   — 全局设置 / zustand store JSON blob
 *   memories   — 记忆数据（immediate/short_term/long_term/core）
 *   mods       — 模组数据
 *   inventory  — 背包物品
 *   schedules  — 日程
 *
 * 性能优化 PRAGMA：WAL 模式、synchronous=NORMAL、mmap_size=256MB
 *
 * @module db
 * @requires @tauri-apps/plugin-sql - Tauri SQLite 插件
 */

import Database from '@tauri-apps/plugin-sql'
// R-14: 数据库文件级加密
import { invoke } from '@tauri-apps/api/core'

// ============ 数据库单例 ============

const DB_PATH = 'sqlite:spiritpal.db'

let dbInstance: Database | null = null
let dbInitPromise: Promise<Database> | null = null

/** settings 内存缓存：避免频繁查询相同的 key（如 store 持久化 blob） */
const settingsCache = new Map<string, string | null>()
/** 缓存最大条目数 */
const SETTINGS_CACHE_MAX = 50

/**
 * 从 settings 缓存获取值（LRU：命中时移到末尾标记为最近使用）
 */
function cacheGet(key: string): string | null | undefined {
  const value = settingsCache.get(key)
  if (value !== undefined) {
    settingsCache.delete(key)
    settingsCache.set(key, value)
  }
  return value
}

/**
 * 写入 settings 缓存（LRU：超限时淘汰最久未用的条目）
 */
function cacheSet(key: string, value: string | null): void {
  settingsCache.delete(key)
  if (settingsCache.size >= SETTINGS_CACHE_MAX) {
    const oldestKey = settingsCache.keys().next().value
    if (oldestKey !== undefined) {
      settingsCache.delete(oldestKey)
    }
  }
  settingsCache.set(key, value)
}

/**
 * 失效 settings 缓存中的指定 key
 */
function cacheInvalidate(key: string): void {
  settingsCache.delete(key)
}

/**
 * 获取数据库实例（单例，自动初始化）。
 * 多次调用返回同一个 Promise，确保表只创建一次、迁移只执行一次。
 */
export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance
  if (!dbInitPromise) {
    dbInitPromise = initDB()
  }
  return dbInitPromise
}

/**
 * 关闭数据库连接并清理资源。
 * 将 dbInstance 置 null、dbInitPromise 置 null、清空 settingsCache。
 * 下次调用 getDb() 时会重新初始化数据库连接。
 */
export function closeDatabase(): void {
  dbInstance = null
  dbInitPromise = null
  settingsCache.clear()
}

/**
 * R-14: 加密数据库文件（应用关闭时调用）
 * 将明文 spiritpal.db 加密为 spiritpal.db.enc，删除明文文件。
 *
 * S2/M0 (E1): 加密前先执行 PRAGMA wal_checkpoint(TRUNCATE)，
 * 确保 WAL 中的最新数据合并到主库，避免加密后丢失最新写入。
 */
export async function encryptDatabaseAtRest(): Promise<void> {
  try {
    // S2/M0 (E1): 先执行 WAL checkpoint，将 WAL 数据合并到主库
    if (dbInstance) {
      try {
        await dbInstance.execute('PRAGMA wal_checkpoint(TRUNCATE)')
      } catch (e) {
        console.warn('[SpiritPal] WAL checkpoint before encryption failed:', e)
      }
      // 关闭数据库连接
      await dbInstance.close()
      dbInstance = null
      dbInitPromise = null
      settingsCache.clear()
    }
    // 加密数据库文件（Rust 端会进一步清理 -wal/-shm 残留）
    await invoke('encrypt_db_at_rest')
  } catch (e) {
    console.warn('[SpiritPal] Failed to encrypt database at rest:', e)
  }
}

// R-14: 注册 beforeunload 事件，在应用关闭时加密数据库
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // 使用 sendBeacon 或同步 invoke 确保加密执行
    // 由于 beforeunload 中 async 操作可能不完整，此处做最大努力尝试
    invoke('encrypt_db_at_rest').catch(() => {})
  })
}

/**
 * 初始化数据库：加载连接 → 创建表 schema → 执行 localStorage 迁移。
 * 幂等：重复调用不会重复建表或重复迁移。
 */
export async function initDB(): Promise<Database> {
  if (dbInstance) return dbInstance

  // R-14: 启动时解密数据库文件（如果有加密版本）
  try {
    await invoke('decrypt_db_at_rest')
  } catch (e) {
    console.warn('[SpiritPal] Failed to decrypt database at rest:', e)
  }

  const db = await Database.load(DB_PATH)
  dbInstance = db

  // ---- 启用 WAL 模式和性能优化 PRAGMA ----
  // WAL（Write-Ahead Logging）允许并发读写，提升多窗口/多线程场景性能
  // synchronous=NORMAL 在 WAL 模式下安全且高效（比 FULL 减少约 50% 写延迟）
  try {
    await db.execute('PRAGMA journal_mode=WAL')
    await db.execute('PRAGMA synchronous=NORMAL')
    // busy_timeout: 并发写入时等待锁的时间（毫秒），避免 "database is locked" 错误
    await db.execute('PRAGMA busy_timeout=5000')
    // 临时表和索引存储在内存中，减少磁盘 I/O
    await db.execute('PRAGMA temp_store=MEMORY')
    // 启用外键约束
    await db.execute('PRAGMA foreign_keys=ON')
    // WAL 模式下的自动检查点阈值（默认 1000 页，适当增大减少检查点频率）
    await db.execute('PRAGMA wal_autocheckpoint=2000')
    // 增大缓存大小（页数，默认约 2MB，增至约 8MB）
    await db.execute('PRAGMA cache_size=-8000')
    // 启用内存映射 I/O（增大 mmap_size 提升大查询性能）
    await db.execute('PRAGMA mmap_size=268435456')  // 256MB
  } catch (e) {
    // PRAGMA 设置失败不影响数据库使用，仅记录警告
    console.warn('[SpiritPal] Failed to set PRAGMA optimizations:', e)
  }

  // ---- 创建所有表（IF NOT EXISTS 保证幂等）----

  // 角色养成数据（每个角色一行）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      stats TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 全局设置 / zustand store JSON blob
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // 记忆数据（含 embedding 列用于向量检索）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 50,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL,
      embedding BLOB
    )
  `)

  // 兼容旧数据库：若 memories 表已存在但缺少 embedding 列，则添加
  try {
    const columns = await db.select<{ name: string }[]>('PRAGMA table_info(memories)')
    if (columns.length > 0 && !columns.some((c) => c.name === 'embedding')) {
      await db.execute('ALTER TABLE memories ADD COLUMN embedding BLOB')
      console.log('[SpiritPal] Added embedding column to memories table')
    }
  } catch (e) {
    console.warn('[SpiritPal] Failed to check/migrate embedding column:', e)
  }

  // S2/M1: memories 表扩列（幂等迁移，沿用 ALTER + try-catch 先例）
  // 将运行时四层记忆从 JSON blob 迁移为行级存储
  const memColumns = await db.select<{ name: string }[]>('PRAGMA table_info(memories)')
  const memColNames = new Set(memColumns.map((c) => c.name))

  // memory_id: 前端 generateId 的 id（行级化后不再依赖 dbId 隐式关联）
  if (!memColNames.has('memory_id')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN memory_id TEXT') } catch { /* 列已存在 */ }
  }
  // assistant: AI 回复文本
  if (!memColNames.has('assistant')) {
    try { await db.execute("ALTER TABLE memories ADD COLUMN assistant TEXT DEFAULT ''") } catch { /* 列已存在 */ }
  }
  // category: 记忆分类
  if (!memColNames.has('category')) {
    try { await db.execute("ALTER TABLE memories ADD COLUMN category TEXT DEFAULT '日常'") } catch { /* 列已存在 */ }
  }
  // tags: JSON 数组
  if (!memColNames.has('tags')) {
    try { await db.execute("ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT '[]'") } catch { /* 列已存在 */ }
  }
  // emotional_intensity: 情感强度 0-1
  if (!memColNames.has('emotional_intensity')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN emotional_intensity REAL DEFAULT 0') } catch { /* 列已存在 */ }
  }
  // emotional_valence: 情感效价 -1..1
  if (!memColNames.has('emotional_valence')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN emotional_valence REAL DEFAULT 0') } catch { /* 列已存在 */ }
  }
  // emotional_arousal: 情感唤醒度 0-1
  if (!memColNames.has('emotional_arousal')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN emotional_arousal REAL DEFAULT 0.3') } catch { /* 列已存在 */ }
  }
  // strength: 记忆强度
  if (!memColNames.has('strength')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN strength REAL DEFAULT 1.0') } catch { /* 列已存在 */ }
  }
  // decay_factor: 衰减因子（仅 UI 展示）
  if (!memColNames.has('decay_factor')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN decay_factor REAL DEFAULT 1.0') } catch { /* 列已存在 */ }
  }
  // access_count: 访问次数
  if (!memColNames.has('access_count')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0') } catch { /* 列已存在 */ }
  }
  // source_kind: 记忆来源
  if (!memColNames.has('source_kind')) {
    try { await db.execute("ALTER TABLE memories ADD COLUMN source_kind TEXT DEFAULT 'exchange'") } catch { /* 列已存在 */ }
  }
  // fact_text: LLM 提取的事实文本
  if (!memColNames.has('fact_text')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN fact_text TEXT') } catch { /* 列已存在 */ }
  }
  // is_autobiographical: 是否自传记忆
  if (!memColNames.has('is_autobiographical')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN is_autobiographical INTEGER DEFAULT 0') } catch { /* 列已存在 */ }
  }
  // tier: 记忆层级 working/episodic/autobiographical
  if (!memColNames.has('tier')) {
    try { await db.execute("ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'episodic'") } catch { /* 列已存在 */ }
  }
  // superseded_by: 软删除/被更新指针（冲突解决预留）
  if (!memColNames.has('superseded_by')) {
    try { await db.execute('ALTER TABLE memories ADD COLUMN superseded_by INTEGER') } catch { /* 列已存在 */ }
  }

  // S2/M1: 新增索引（扩列后）
  await db.execute('CREATE INDEX IF NOT EXISTS idx_memories_memory_id ON memories(memory_id)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier)')

  // S2/M1: 新增 memory_summaries 表（semantic 层摘要，按角色一行）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_summaries (
      character_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // S2/M1: 新增 memory_state 表（触发状态/冷却等轻量状态，明文非敏感）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_state (
      character_id TEXT PRIMARY KEY,
      last_chat_date TEXT,
      trigger_log TEXT DEFAULT '[]',
      ignore_count TEXT DEFAULT '{}',
      last_periodic_fire_date TEXT DEFAULT '{}',
      injected_at TEXT DEFAULT '{}',
      llm_reassessed_ids TEXT DEFAULT '[]'
    )
  `)

  // OPTIMIZE: 为向量检索候选集查询添加索引。
  // 单列索引用于简单条件过滤
  await db.execute('CREATE INDEX IF NOT EXISTS idx_memories_character ON memories(character_id)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)')
  // 复合索引：覆盖最常见的多条件查询（按角色+类型+重要性+时间筛选）
  // 这些复合索引可让 SQL 引擎直接通过索引完成过滤，无需回表扫描
  await db.execute('CREATE INDEX IF NOT EXISTS idx_memories_char_type ON memories(character_id, type)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_memories_char_type_acc ON memories(character_id, type, last_accessed)')

  // 模组数据
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT,
      config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      installed_at INTEGER NOT NULL
    )
  `)

  // 背包物品
  await db.execute(`
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      character_id TEXT
    )
  `)

  // 背包物品索引（必须在 inventory 表创建之后执行）
  await db.execute('CREATE INDEX IF NOT EXISTS idx_inventory_char ON inventory(character_id)')

  // 日程
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      time INTEGER NOT NULL,
      repeat TEXT,
      completed INTEGER DEFAULT 0
    )
  `)

  // R2：约定与计划追踪表——第四面墙核心
  // F1 修复：补齐 repeat 列，否则 commitmentTracker 的 INSERT 会抛 "no such column: repeat"
  await db.execute(`
    CREATE TABLE IF NOT EXISTS commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      content TEXT NOT NULL,
      actor TEXT NOT NULL,
      due_at INTEGER,
      status TEXT DEFAULT 'open',
      source_memory_id INTEGER,
      created_at INTEGER NOT NULL,
      follow_up_count INTEGER DEFAULT 0,
      repeat TEXT
    )
  `)
  // F1：幂等迁移——为已存在的旧表补列（SQLite 不支持 IF NOT EXISTS on ADD COLUMN，用 try-catch 兜底）
  try {
    await db.execute('ALTER TABLE commitments ADD COLUMN repeat TEXT')
  } catch {
    // 列已存在，忽略
  }
  await db.execute('CREATE INDEX IF NOT EXISTS idx_commitments_char ON commitments(character_id)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments(due_at)')

  // R1：上下文快照表——现实感知记录
  await db.execute(`
    CREATE TABLE IF NOT EXISTS context_episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      work_state TEXT,
      weather TEXT,
      idle_minutes INTEGER,
      music TEXT,
      summary TEXT
    )
  `)
  await db.execute('CREATE INDEX IF NOT EXISTS idx_context_episodes_char ON context_episodes(character_id)')

  // ---- 执行 localStorage → SQLite 迁移（幂等）----
  await migrateFromLocalStorage()

  return db
}

// ============ settings 表操作 ============

/** 读取 setting 值，不存在返回 null（带内存缓存） */
export async function getSetting(key: string): Promise<string | null> {
  const cached = cacheGet(key)
  if (cached !== undefined) return cached
  const db = await getDb()
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = $1',
    [key],
  )
  const value = rows.length > 0 ? rows[0].value : null
  cacheSet(key, value)
  return value
}

/** 写入 setting（upsert），自动更新缓存 */
export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2',
    [key, value],
  )
  cacheInvalidate(key)
  cacheSet(key, value)
}

/** 删除 setting，同时清除缓存 */
export async function removeSetting(key: string): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM settings WHERE key = $1', [key])
  cacheInvalidate(key)
}

// ============ characters 表操作 ============

/** 获取单个角色的养成数据（JSON 字符串） */
export async function getCharacterStats(charId: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db.select<{ stats: string }[]>(
    'SELECT stats FROM characters WHERE id = $1',
    [charId],
  )
  return rows.length > 0 ? rows[0].stats : null
}

/** 保存角色养成数据（upsert） */
export async function saveCharacterStats(charId: string, stats: object): Promise<void> {
  const db = await getDb()
  const statsJson = JSON.stringify(stats)
  const now = Date.now()
  await db.execute(
    'INSERT INTO characters (id, stats, updated_at) VALUES ($1, $2, $3) ON CONFLICT(id) DO UPDATE SET stats = $2, updated_at = $3',
    [charId, statsJson, now],
  )
}

/** 获取所有角色养成数据 */
export async function getAllCharacters(): Promise<
  Array<{ id: string; stats: string; updated_at: number }>
> {
  const db = await getDb()
  return db.select('SELECT id, stats, updated_at FROM characters')
}

// ============ memories 表操作 ============

export type MemoryType = 'immediate' | 'short_term' | 'long_term' | 'core'

/** 添加记忆条目，返回插入的行 ID（用于关联 embedding） */
export async function addMemory(
  characterId: string,
  type: MemoryType,
  content: string,
  importance: number = 50,
): Promise<number> {
  const db = await getDb()
  const now = Date.now()
  await db.execute(
    'INSERT INTO memories (character_id, type, content, importance, created_at, last_accessed) VALUES ($1, $2, $3, $4, $5, $5)',
    [characterId, type, content, importance, now],
  )
  const rows = await db.select<{ id: number }[]>('SELECT last_insert_rowid() as id')
  return rows[0]?.id ?? 0
}

// ============ embedding 列操作 ============

// OPTIMIZE: 使用 String.fromCharCode.apply 替代 spread 操作符 (...chunk)，
// 避免 32768 个参数展开在某些引擎下触及参数上限；行为等价但更稳健。
const BINARY_CHUNK_SIZE = 0x8000

/** 将 Float32Array 转为 base64 字符串（用于 SQLite 存储） */
function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += BINARY_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + BINARY_CHUNK_SIZE, bytes.length))
    // OPTIMIZE: apply 接收类数组，比 spread 更安全（无参数数量风险）
    parts.push(String.fromCharCode.apply(null, chunk as unknown as number[]))
  }
  return btoa(parts.join(''))
}

/** 将 base64 字符串转回 Float32Array */
function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Float32Array(bytes.buffer)
}

/** 保存记忆的嵌入向量 */
export async function saveEmbedding(memoryId: number, embedding: Float32Array): Promise<void> {
  const db = await getDb()
  const embeddingB64 = float32ToBase64(embedding)
  await db.execute('UPDATE memories SET embedding = $1 WHERE id = $2', [embeddingB64, memoryId])
}

/**
 * 批量保存嵌入向量（一次事务，减少数据库往返）
 * @param items 记忆ID和嵌入向量的数组
 */
export async function saveEmbeddingsBatch(items: Array<{ memoryId: number; embedding: Float32Array }>): Promise<void> {
  if (items.length === 0) return
  const db = await getDb()
  await db.execute('BEGIN TRANSACTION')
  try {
    // 预编译语句，批量执行
    for (const { memoryId, embedding } of items) {
      const embeddingB64 = float32ToBase64(embedding)
      await db.execute('UPDATE memories SET embedding = $1 WHERE id = $2', [embeddingB64, memoryId])
    }
    await db.execute('COMMIT')
  } catch (e) {
    await db.execute('ROLLBACK')
    throw e
  }
}

/** 更新记忆的最后访问时间 */
export async function updateMemoryLastAccessed(memoryId: number): Promise<void> {
  const db = await getDb()
  await db.execute('UPDATE memories SET last_accessed = $1 WHERE id = $2', [Date.now(), memoryId])
}

/**
 * 获取所有记忆的嵌入向量。
 * @param characterId 可选，按角色过滤。不传则返回所有角色的嵌入。
 * @param limit 候选集上限，默认 1000（性能优化：限制候选集大小）
 * @param type 可选，按记忆类型过滤
 */
// REFACTOR: 统一 4 分支 SQL 为动态构建，消除重复（DRY/A5），便于未来扩展过滤条件
export async function getAllEmbeddings(
  characterId?: string,
  limit: number = 1000,
  type?: MemoryType,
): Promise<{ id: number; embedding: Float32Array }[]> {
  const db = await getDb()
  const conditions: string[] = ['embedding IS NOT NULL']
  const params: unknown[] = []
  if (characterId) {
    params.push(characterId)
    conditions.push(`character_id = $${params.length}`)
  }
  if (type) {
    params.push(type)
    conditions.push(`type = $${params.length}`)
  }
  params.push(limit)
  const sql = `SELECT id, embedding FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`
  const rows = await db.select<{ id: number; embedding: string }[]>(sql, params)
  return rows.map((row) => ({ id: row.id, embedding: base64ToFloat32(row.embedding) }))
}

/** 查询角色的记忆列表 */
export async function getMemories(
  characterId: string,
  type?: MemoryType,
): Promise<Array<Record<string, unknown>>> {
  const db = await getDb()
  if (type) {
    return db.select(
      'SELECT * FROM memories WHERE character_id = $1 AND type = $2 ORDER BY created_at DESC',
      [characterId, type],
    )
  }
  return db.select(
    'SELECT * FROM memories WHERE character_id = $1 ORDER BY created_at DESC',
    [characterId],
  )
}

/**
 * P0-3 修复：按 dbId（SQLite 行 id）删除单条记忆及其 embedding。
 * 之前的 deleteMemory 只过滤内存数组，留下孤儿 SQLite 行与 embedding BLOB，
 * 导致 DB 无限增长、LIMIT 1000 候选集被孤儿行挤占。
 * @param dbId SQLite memories 表的行 id
 */
export async function deleteMemory(dbId: number): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM memories WHERE id = $1', [dbId])
}

/**
 * P0-3 修复：按角色清空该角色的全部记忆（含 embedding）。
 * 用于 EnhancedMemoryManager.clear() 与"重置记忆"功能。
 * @param characterId 角色 id
 */
export async function clearMemories(characterId: string): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM memories WHERE character_id = $1', [characterId])
}

// ============ S2/M1: 行级 CRUD（替代全量 JSON blob + 每值加密）============

/**
 * S2: 记忆行数据（扩列后的完整字段）
 */
export interface MemoryRow {
  id?: number
  character_id: string
  type: string
  content: string
  importance: number
  created_at: number
  last_accessed: number
  memory_id?: string | null
  assistant?: string
  category?: string
  tags?: string
  emotional_intensity?: number
  emotional_valence?: number
  emotional_arousal?: number
  strength?: number
  decay_factor?: number
  access_count?: number
  source_kind?: string
  fact_text?: string | null
  is_autobiographical?: number
  tier?: string
  superseded_by?: number | null
  embedding?: string | null
}

/**
 * S2: 插入完整记忆行（含所有扩列字段），返回 rowid
 */
export async function insertMemoryRow(row: MemoryRow): Promise<number> {
  const db = await getDb()
  await db.execute(
    `INSERT INTO memories (
      character_id, type, content, importance, created_at, last_accessed,
      memory_id, assistant, category, tags,
      emotional_intensity, emotional_valence, emotional_arousal,
      strength, decay_factor, access_count,
      source_kind, fact_text, is_autobiographical, tier
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [
      row.character_id, row.type, row.content, row.importance, row.created_at, row.last_accessed,
      row.memory_id ?? null, row.assistant ?? '', row.category ?? '日常', row.tags ?? '[]',
      row.emotional_intensity ?? 0, row.emotional_valence ?? 0, row.emotional_arousal ?? 0.3,
      row.strength ?? 1.0, row.decay_factor ?? 1.0, row.access_count ?? 0,
      row.source_kind ?? 'exchange', row.fact_text ?? null, row.is_autobiographical ?? 0, row.tier ?? 'episodic',
    ],
  )
  const rows = await db.select<{ id: number }[]>('SELECT last_insert_rowid() as id')
  return rows[0]?.id ?? 0
}

/**
 * S2: 按 rowid 更新记忆行（部分字段，只更新传入的字段）
 */
export async function updateMemoryRow(
  id: number,
  fields: Partial<MemoryRow>,
): Promise<void> {
  const db = await getDb()
  const sets: string[] = []
  const params: unknown[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id' || key === 'character_id') continue // 不可更新
    sets.push(`${key} = $${sets.length + 1}`)
    params.push(value)
  }
  if (sets.length === 0) return
  params.push(id)
  await db.execute(
    `UPDATE memories SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params,
  )
}

/**
 * S2: 按角色和 tier 查询所有记忆行（用于 load 替代 JSON blob 读取）
 */
export async function getMemoriesByTier(
  characterId: string,
  tiers?: string[],
): Promise<MemoryRow[]> {
  const db = await getDb()
  if (tiers && tiers.length > 0) {
    const placeholders = tiers.map((_, i) => `$${i + 2}`).join(',')
    return db.select(
      `SELECT * FROM memories WHERE character_id = $1 AND tier IN (${placeholders}) ORDER BY created_at ASC`,
      [characterId, ...tiers],
    )
  }
  return db.select(
    'SELECT * FROM memories WHERE character_id = $1 ORDER BY created_at ASC',
    [characterId],
  )
}

/**
 * S2: 按角色查询旧式 type 字段的所有记忆（兼容旧路径）
 */
export async function getMemoriesByCharacter(characterId: string): Promise<MemoryRow[]> {
  const db = await getDb()
  return db.select(
    'SELECT * FROM memories WHERE character_id = $1 ORDER BY created_at ASC',
    [characterId],
  )
}

// ============ S2/M1: memory_summaries 表操作 ============

/**
 * S2: 获取角色的语义摘要
 */
export async function getMemorySummary(characterId: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db.select<{ summary: string }[]>(
    'SELECT summary FROM memory_summaries WHERE character_id = $1',
    [characterId],
  )
  return rows.length > 0 ? rows[0].summary : null
}

/**
 * S2: Upsert 角色的语义摘要
 */
export async function upsertMemorySummary(characterId: string, summary: string): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  await db.execute(
    `INSERT INTO memory_summaries (character_id, summary, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT(character_id) DO UPDATE SET summary = $2, updated_at = $3`,
    [characterId, summary, now],
  )
}

/**
 * S2: 删除角色的语义摘要
 */
export async function deleteMemorySummary(characterId: string): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM memory_summaries WHERE character_id = $1', [characterId])
}

// ============ S2/M1: memory_state 表操作 ============

/**
 * S2: 记忆触发状态数据
 */
export interface MemoryStateRow {
  character_id: string
  last_chat_date: string | null
  trigger_log: string
  ignore_count: string
  last_periodic_fire_date: string
  injected_at: string
  llm_reassessed_ids: string
}

/**
 * S2: 获取角色的触发状态
 */
export async function getMemoryState(characterId: string): Promise<MemoryStateRow | null> {
  const db = await getDb()
  const rows = await db.select<MemoryStateRow[]>(
    'SELECT * FROM memory_state WHERE character_id = $1',
    [characterId],
  )
  return rows.length > 0 ? rows[0] : null
}

/**
 * S2: Upsert 角色的触发状态
 */
export async function upsertMemoryState(state: MemoryStateRow): Promise<void> {
  const db = await getDb()
  await db.execute(
    `INSERT INTO memory_state (character_id, last_chat_date, trigger_log, ignore_count, last_periodic_fire_date, injected_at, llm_reassessed_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(character_id) DO UPDATE SET
       last_chat_date = $2, trigger_log = $3, ignore_count = $4,
       last_periodic_fire_date = $5, injected_at = $6, llm_reassessed_ids = $7`,
    [
      state.character_id, state.last_chat_date,
      state.trigger_log ?? '[]', state.ignore_count ?? '{}',
      state.last_periodic_fire_date ?? '{}', state.injected_at ?? '{}',
      state.llm_reassessed_ids ?? '[]',
    ],
  )
}

/**
 * S2: 删除角色的触发状态
 */
export async function deleteMemoryState(characterId: string): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM memory_state WHERE character_id = $1', [characterId])
}

/**
 * S2: 清空角色的所有行级记忆数据（memories + summaries + state）
 * 用于 resetAll / clear 等"全部清除"场景
 */
export async function clearAllMemoryData(characterId: string): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM memories WHERE character_id = $1', [characterId])
  await db.execute('DELETE FROM memory_summaries WHERE character_id = $1', [characterId])
  await db.execute('DELETE FROM memory_state WHERE character_id = $1', [characterId])
}

/**
 * S2: 迁移标记读写
 */
const MEMORY_MIGRATION_FLAG = 'spiritpal-memory-migrated-v2'
const MEMORY_LEGACY_FLAG = 'spiritpal-memory-use-legacy'

export async function isMemoryMigrated(): Promise<boolean> {
  return (await getSetting(MEMORY_MIGRATION_FLAG)) === '1'
}

export async function setMemoryMigrated(): Promise<void> {
  await setSetting(MEMORY_MIGRATION_FLAG, '1')
}

export async function isLegacyMode(): Promise<boolean> {
  return (await getSetting(MEMORY_LEGACY_FLAG)) === '1'
}

// ============ mods 表操作 ============

/** 保存模组（upsert） */
export async function saveMod(mod: {
  id: string
  name: string
  version?: string
  config: object
  enabled?: boolean
}): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  await db.execute(
    `INSERT INTO mods (id, name, version, config, enabled, installed_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(id) DO UPDATE SET name = $2, version = $3, config = $4, enabled = $5`,
    [mod.id, mod.name, mod.version ?? null, JSON.stringify(mod.config), mod.enabled ? 1 : 0, now],
  )
}

/** 获取所有模组 */
export async function getMods(): Promise<
  Array<{
    id: string
    name: string
    version: string | null
    config: string
    enabled: number
    installed_at: number
  }>
> {
  const db = await getDb()
  return db.select('SELECT * FROM mods')
}

/** 删除模组 */
export async function deleteMod(id: string): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM mods WHERE id = $1', [id])
}

/** 更新模组启用状态 */
export async function updateModEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await getDb()
  await db.execute('UPDATE mods SET enabled = $1 WHERE id = $2', [enabled ? 1 : 0, id])
}

// ============ inventory 表操作 ============

/** 保存背包物品（upsert） */
export async function saveInventoryItem(item: {
  id: string
  item_id: string
  quantity: number
  character_id?: string | null
}): Promise<void> {
  const db = await getDb()
  await db.execute(
    `INSERT INTO inventory (id, item_id, quantity, character_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(id) DO UPDATE SET item_id = $2, quantity = $3, character_id = $4`,
    [item.id, item.item_id, item.quantity, item.character_id ?? null],
  )
}

/** 查询背包物品 */
export async function getInventory(
  characterId?: string,
): Promise<Array<Record<string, unknown>>> {
  const db = await getDb()
  if (characterId) {
    return db.select(
      'SELECT * FROM inventory WHERE character_id = $1 OR character_id IS NULL',
      [characterId],
    )
  }
  return db.select('SELECT * FROM inventory')
}

// ============ schedules 表操作 ============

/** 保存日程（upsert） */
export async function saveSchedule(schedule: {
  id: string
  title: string
  time: number
  repeat?: string
  completed?: boolean
}): Promise<void> {
  const db = await getDb()
  await db.execute(
    `INSERT INTO schedules (id, title, time, repeat, completed)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(id) DO UPDATE SET title = $2, time = $3, repeat = $4, completed = $5`,
    [schedule.id, schedule.title, schedule.time, schedule.repeat ?? null, schedule.completed ? 1 : 0],
  )
}

/** 查询所有日程（按时间排序） */
export async function getSchedules(): Promise<Array<Record<string, unknown>>> {
  const db = await getDb()
  return db.select('SELECT * FROM schedules ORDER BY time ASC')
}

// ============ Zustand 持久化存储适配器 ============
//
// 将 zustand persist 的 storage 桥接到 SQLite settings 表。
// 每个 store 的完整状态以 JSON blob 存储在 settings 表中，key = store name。
// createJSONStorage 支持异步 StateStorage（返回 Promise）。

export const sqliteStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      return await getSetting(name)
    } catch (e) {
      console.error('[sqliteStorage] getItem failed:', name, e)
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await setSetting(name, value)
    } catch (e) {
      console.error('[sqliteStorage] setItem failed:', name, e)
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await removeSetting(name)
    } catch (e) {
      console.error('[sqliteStorage] removeItem failed:', name, e)
    }
  },
}

// ============ localStorage → SQLite 迁移 ============

const MIGRATION_FLAG = '__sqlite_migration_done'

/**
 * 从 localStorage 迁移数据到 SQLite。
 *
 * - 幂等：通过 settings 表中的 MIGRATION_FLAG 防止重复执行
 * - 读取所有 spiritpal-* 键，写入 SQLite settings 表（供 zustand persist 读取）
 * - 同时填充专用表（characters / memories / mods）以便未来直接 SQL 查询
 * - 不清除 localStorage：其他 lib 文件（enhancedMemory / modManager 等）
 *   仍直接读取 localStorage，待后续迁移后再清除
 */
export async function migrateFromLocalStorage(): Promise<void> {
  // 检查是否已迁移（幂等保护）
  const done = await getSetting(MIGRATION_FLAG)
  if (done === '1') return

  console.log('[SpiritPal] Starting localStorage → SQLite migration...')

  // 1. 收集所有 spiritpal-* localStorage 键，写入 settings 表
  const spiritpalKeys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('spiritpal-')) {
      spiritpalKeys.push(key)
    }
  }

  const db = await getDb()
  await db.execute('BEGIN TRANSACTION')

  try {
    for (const key of spiritpalKeys) {
      const value = localStorage.getItem(key)
      if (value !== null) {
        try {
          await setSetting(key, value)
        } catch (e) {
          console.warn(`[SpiritPal] Failed to migrate key "${key}":`, e)
        }
      }
    }

    // 2. 解析 spiritpal-pet-store，填充 characters 表
    try {
      const petStoreRaw = localStorage.getItem('spiritpal-pet-store')
      if (petStoreRaw) {
        const parsed = JSON.parse(petStoreRaw)
        const stats = parsed?.state?.stats
        if (stats && typeof stats === 'object') {
          for (const [charId, charStats] of Object.entries(stats)) {
            try {
              await saveCharacterStats(charId, charStats as object)
            } catch (e) {
              console.warn(`[SpiritPal] Failed to save character "${charId}":`, e)
            }
          }
        }
      }
    } catch (e) {
      console.warn('[SpiritPal] Failed to populate characters table:', e)
    }

    // 3. 解析 spiritpal-mods，填充 mods 表（同步 spiritpal-mods-enabled 的启用状态）
    try {
      const modsRaw = localStorage.getItem('spiritpal-mods')
      const enabledRaw = localStorage.getItem('spiritpal-mods-enabled')
      const enabledList: string[] = enabledRaw ? JSON.parse(enabledRaw) : []
      if (modsRaw) {
        const mods = JSON.parse(modsRaw)
        if (Array.isArray(mods)) {
          for (const mod of mods) {
            if (mod?.id && mod?.displayName) {
              try {
                // 以 spiritpal-mods-enabled 为准同步启用状态
                mod.enabled = enabledList.includes(mod.id) || mod.isBuiltIn === true
                await saveMod({
                  id: mod.id,
                  name: mod.displayName,
                  version: mod.version,
                  config: mod,
                  enabled: mod.enabled,
                })
              } catch (e) {
                console.warn(`[SpiritPal] Failed to save mod "${mod.id}":`, e)
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[SpiritPal] Failed to populate mods table:', e)
    }

    // 4. 解析记忆数据，填充 memories 表
    for (const key of spiritpalKeys) {
      if (key.startsWith('spiritpal-memory-') || key.startsWith('spiritpal-enhanced-memory-')) {
        const charId = key.replace(/^spiritpal-(enhanced-)?memory-/, '')
        const type: MemoryType = key.startsWith('spiritpal-enhanced-memory-') ? 'long_term' : 'short_term'
        try {
          const raw = localStorage.getItem(key)
          if (raw) {
            await addMemory(charId, type, raw, 50)
          }
        } catch (e) {
          console.warn(`[SpiritPal] Failed to migrate memory for "${charId}":`, e)
        }
      }
    }

    await db.execute('COMMIT')
  } catch (e) {
    await db.execute('ROLLBACK')
    throw e
  }

  // 5. 标记迁移完成
  await setSetting(MIGRATION_FLAG, '1')

  // 清除已迁移的 localStorage 数据（保留迁移标记键）
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('spiritpal-')) {
      keysToRemove.push(key)
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key)
  }
  // OPTIMIZE: 单行日志，避免多行模板字面量在压缩/解析阶段的兼容性风险
  console.log('[SpiritPal] localStorage → SQLite migration complete.')
}