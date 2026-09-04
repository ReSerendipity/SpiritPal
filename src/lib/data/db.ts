/**
 * SQLite 持久化层 — D-1 收口：Rust 语义化命令（sp_*）替代 plugin-sql 直执行 SQL
 * PRD 要求：所有养成/记忆/模组/设置数据持久化到 SQLite
 *
 * @fileoverview
 * 主要模块：
 * - ensureDbReady()/initDB()：初始化数据库（Rust 侧迁移 schema + localStorage 迁移）
 * - getSetting()/setSetting()：全局设置读写
 * - getCharacterData()/saveCharacterData()：角色养成数据读写
 * - getMemories()/saveMemories()：记忆数据读写
 * - getMods()/saveMods()：模组数据读写
 * - getInventory()/saveInventory()：背包数据读写
 *
 * 表结构（由 src-tauri/src/sqlite.rs 的 ensure_schema 幂等创建）：
 *   characters / settings / memories(+扩列) / memory_summaries / memory_state /
 *   memory_semantic_facts / owner_facts / pet_experiences / visual_memories /
 *   entity_nodes / mods / inventory / schedules / commitments / context_episodes /
 *   dirty_data_registry
 *
 * 安全：本模块不再直接持有 SQL；所有写入经 Rust 端参数绑定命令（无字符串拼 SQL），
 * 因此 capability 中可整体移除 `sql:*` 授权（S1 闭合）。
 *
 * @module db
 */

// D-1: 所有数据访问经 Tauri invoke 走 Rust 语义命令
import { invoke } from '@tauri-apps/api/core'
// P1-2: 多窗口 settingsCache 一致性 — 监听跨窗口设置变更事件
import { emit, listen } from '@tauri-apps/api/event'

// ============ 就绪与初始化 ============

let readyPromise: Promise<void> | null = null

/**
 * 确保数据库就绪（Rust 侧首次调用时自动建表/迁移；幂等）。
 * 由 initDB 显式调用一次，其余函数在调用前都先 await 该 Promise。
 */
function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await invoke('sp_db_migrate')
    })()
  }
  return readyPromise
}

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
 * 关闭数据库连接（D-1 兼容保留：Rust 侧连接由 encrypt_db_at_rest 统一关闭；
 * 本函数保留以防旧调用方依赖，实际为无操作）。
 * @deprecated 收口后无需前端关闭连接
 */
export function closeDatabase(): void {
  settingsCache.clear()
}

// ============ P1-2: 多窗口 settingsCache 一致性 ============

/**
 * 跨窗口设置变更事件监听器（模块级单例）。
 *
 * 问题场景：SpiritPal 有 3+ 个窗口（pet/settings/chat），每个窗口有独立的 JS 上下文
 * 和独立的 settingsCache Map。窗口 A 修改设置后，窗口 B/C 的缓存仍持有旧值。
 *
 * 修复方案：setSetting/removeSetting 写入后通过 Tauri emit 广播事件，
 * 其他窗口收到事件后清除对应 key 的缓存，下次读取时从 SQLite 获取最新值。
 */
let settingsChangeListenerSetup = false

/**
 * 注册跨窗口设置变更监听器（幂等，多次调用安全）。
 * 应在应用启动时调用（如 initDB 完成后）。
 */
export async function setupSettingsCacheListener(): Promise<void> {
  if (settingsChangeListenerSetup) return
  settingsChangeListenerSetup = true

  try {
    await listen<{ key: string }>('spiritpal:settings-changed', (event) => {
      const key = event.payload?.key
      if (key) {
        cacheInvalidate(key)
      } else {
        // 无 key 时清空整个缓存（全量刷新）
        settingsCache.clear()
      }
    })
  } catch {
    // 非关键路径：监听器注册失败不影响正常读写
    settingsChangeListenerSetup = false
  }
}

/**
 * R-14: 加密数据库文件（应用关闭时调用）
 * 将明文 spiritpal.db 加密为 spiritpal.db.enc，删除明文文件。
 * Rust 侧 encrypt_db_at_rest 内部会先关闭 rusqlite 连接（D-1 协调）。
 */
export async function encryptDatabaseAtRest(): Promise<void> {
  try {
    // 加密数据库文件（Rust 端负责连接关闭 + 清理 -wal/-shm 残留）
    await invoke('encrypt_db_at_rest')
    // P1: 无云端备份下的本地 durability —— 加密完成后自动备份一轮（保留最近 3 份）
    await invoke('backup_db_at_rest').catch((e: unknown) => {
      console.warn('[SpiritPal] Auto backup failed (non-fatal):', e)
    })
  } catch (e) {
    console.warn('[SpiritPal] Failed to encrypt database at rest:', e)
  }
}

// R-14: 注册 beforeunload 事件，在应用关闭时加密数据库
// Rust 端 ExitRequested 会再次尝试（双保险），此处尽力而为
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    encryptDatabaseAtRest().catch((e: unknown) => {
      // M-2: 不再静默吞错 — 加密失败需记录（虽然 Rust 端 ExitRequested 会重试）
      console.error('[db] encryptDatabaseAtRest failed in beforeunload:', e instanceof Error ? e.message : e)
    })
  })
}

/**
 * 初始化数据库：解密 → 迁移 schema → localStorage 迁移。
 * 幂等：重复调用不重复迁移。
 */
export async function initDB(): Promise<void> {
  // R-14: 启动时解密数据库文件（如果有加密版本）
  try {
    await invoke('decrypt_db_at_rest')
  } catch (e) {
    console.warn('[SpiritPal] Failed to decrypt database at rest:', e)
  }

  // D-1: 建表/PRAGMA/迁移全部由 Rust 侧 ensure_schema 承担
  await ensureReady()

  // ---- 执行 localStorage → SQLite 迁移（幂等）----
  await migrateFromLocalStorage()

  // P1-2: 初始化跨窗口 settingsCache 一致性监听器
  await setupSettingsCacheListener()

  // P1: 启动物理完整性检查（非阻塞）——SQLite 损坏时尽早发现并可通过本地备份恢复
  try {
    const { checkDbIntegrity } = await import('./dbBackup')
    await checkDbIntegrity()
  } catch (e) {
    console.warn('[SpiritPal] 数据库完整性检查异常（非致命）:', e)
  }
}

// ============ settings 表操作 ============

/** 读取 setting 值，不存在返回 null（带内存缓存） */
export async function getSetting(key: string): Promise<string | null> {
  const cached = cacheGet(key)
  if (cached !== undefined) return cached
  await ensureReady()
  const value = await invoke<string | null>('sp_settings_get', { key })
  cacheSet(key, value)
  return value
}

/** 写入 setting（upsert），自动更新缓存 */
export async function setSetting(key: string, value: string): Promise<void> {
  await ensureReady()
  await invoke('sp_settings_set', { key, value })
  cacheInvalidate(key)
  cacheSet(key, value)
  // P1-2: 通知其他窗口清除该 key 的缓存（多窗口 settingsCache 一致性）
  // 用 Promise.resolve 包裹确保 .catch 可用（防止 mock 环境返回非 Promise）
  Promise.resolve(emit('spiritpal:settings-changed', { key })).catch(() => {
    // 非关键路径：事件发送失败不影响数据写入
  })
}

/** 删除 setting，同时清除缓存 */
export async function removeSetting(key: string): Promise<void> {
  await ensureReady()
  await invoke('sp_settings_remove', { key })
  cacheInvalidate(key)
  // P1-2: 通知其他窗口清除该 key 的缓存
  Promise.resolve(emit('spiritpal:settings-changed', { key })).catch(() => {
    // 非关键路径：事件发送失败不影响数据删除
  })
}

// ============ characters 表操作 ============

/** 获取单个角色的养成数据（JSON 字符串） */
export async function getCharacterStats(charId: string): Promise<string | null> {
  await ensureReady()
  return invoke<string | null>('sp_char_get_stats', { characterId: charId })
}

/** 保存角色养成数据（upsert） */
export async function saveCharacterStats(charId: string, stats: object): Promise<void> {
  await ensureReady()
  await invoke('sp_char_save_stats', { characterId: charId, stats: JSON.stringify(stats) })
}

/** 获取所有角色养成数据 */
export async function getAllCharacters(): Promise<
  Array<{ id: string; stats: string; updated_at: number }>
> {
  await ensureReady()
  return invoke('sp_char_list')
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
  await ensureReady()
  return invoke<number>('sp_mem_add', { characterId, memoryType: type, content, importance })
}

// ============ embedding 列操作 ============

// OPTIMIZE: 使用 String.fromCharCode.apply 替代 spread 操作符 (...chunk)，
// 避免 32768 个参数展开在某些引擎下触及参数上限；行为等价但更稳健。
const BINARY_CHUNK_SIZE = 0x8000

/** 将 Float32Array 转为 base64 字符串（与 Rust 端存储格式一致：TEXT base64） */
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
  await ensureReady()
  await invoke('sp_mem_save_embedding', {
    memoryId,
    embeddingB64: float32ToBase64(embedding),
  })
}

/**
 * 批量保存嵌入向量（Rust 端单事务）
 * @param items 记忆ID和嵌入向量的数组
 */
export async function saveEmbeddingsBatch(items: Array<{ memoryId: number; embedding: Float32Array }>): Promise<void> {
  if (items.length === 0) return
  await ensureReady()
  await invoke('sp_mem_save_embeddings_batch', {
    items: items.map(({ memoryId, embedding }) => ({
      memoryId,
      embeddingB64: float32ToBase64(embedding),
    })),
  })
}

/** 更新记忆的最后访问时间 */
export async function updateMemoryLastAccessed(memoryId: number): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_touch', { memoryId })
}

/**
 * 获取所有记忆的嵌入向量。
 * @param characterId 可选，按角色过滤。不传则返回所有角色的嵌入。
 * @param limit 候选集上限，默认 1000（性能优化：限制候选集大小）
 * @param type 可选，按记忆类型过滤
 */
export async function getAllEmbeddings(
  characterId?: string,
  limit: number = 1000,
  type?: MemoryType,
): Promise<{ id: number; embedding: Float32Array }[]> {
  await ensureReady()
  const rows = await invoke<Array<{ id: number; embedding: string }>>('sp_mem_get_embeddings', {
    characterId: characterId ?? null,
    limit,
    memoryType: type ?? null,
  })
  return rows.map((row) => ({ id: row.id, embedding: base64ToFloat32(row.embedding) }))
}

/** 查询角色的记忆列表 */
export async function getMemories(
  characterId: string,
  type?: MemoryType,
): Promise<Array<Record<string, unknown>>> {
  await ensureReady()
  return invoke('sp_mem_list', { characterId, memoryType: type ?? null })
}

/**
 * P0-3 修复：按 dbId（SQLite 行 id）删除单条记忆及其 embedding。
 */
export async function deleteMemory(dbId: number): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_delete', { memoryId: dbId })
}

/**
 * P0-3 修复：按角色清空该角色的全部记忆（含 embedding）。
 */
export async function clearMemories(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_clear', { characterId })
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
  await ensureReady()
  return invoke<number>('sp_mem_insert_row', { row })
}

/**
 * S2: 按 rowid 更新记忆行（部分字段；Rust 端仅允许白名单字段名）
 */
export async function updateMemoryRow(
  id: number,
  fields: Partial<MemoryRow>,
): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_update_row', { memoryId: id, fields })
}

/**
 * S2: 按角色和 tier 查询所有记忆行（用于 load 替代 JSON blob 读取）
 */
export async function getMemoriesByTier(
  characterId: string,
  tiers?: string[],
): Promise<MemoryRow[]> {
  await ensureReady()
  return invoke('sp_mem_by_tier', { characterId, tiers: tiers && tiers.length > 0 ? tiers : null })
}

/**
 * S2: 按角色查询旧式 type 字段的所有记忆（兼容旧路径）
 */
export async function getMemoriesByCharacter(characterId: string): Promise<MemoryRow[]> {
  await ensureReady()
  return invoke('sp_mem_by_character', { characterId })
}

// ============ S2/M1: memory_summaries 表操作 ============

/**
 * S2: 获取角色的语义摘要
 */
export async function getMemorySummary(characterId: string): Promise<string | null> {
  await ensureReady()
  return invoke<string | null>('sp_mem_summary_get', { characterId })
}

/**
 * S2: Upsert 角色的语义摘要
 */
export async function upsertMemorySummary(characterId: string, summary: string): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_summary_upsert', { characterId, summary })
}

/**
 * S2: 删除角色的语义摘要
 */
export async function deleteMemorySummary(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_summary_delete', { characterId })
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
  await ensureReady()
  return invoke<MemoryStateRow | null>('sp_mem_state_get', { characterId })
}

/**
 * S2: Upsert 角色的触发状态
 */
export async function upsertMemoryState(state: MemoryStateRow): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_state_upsert', { state })
}

/**
 * S2: 删除角色的触发状态
 */
export async function deleteMemoryState(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_state_delete', { characterId })
}

/**
 * S2: 清空角色的所有行级记忆数据（memories + summaries + state + semantic_facts）
 * 用于 resetAll / clear 等"全部清除"场景
 */
export async function clearAllMemoryData(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_mem_clear_all', { characterId })
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

// ============ T-1: owner_facts 表操作（二期行级化） ============

/** T-1: owner_facts 行类型（支持双时间轴 P1-5） */
export interface OwnerFactRow {
  id?: number
  character_id: string
  fact_id: string
  fact_key: string
  fact_value: string
  source_memory_id?: string | null
  confidence: number
  updated_at: number
  user_provided: number // 0 or 1
  valid_at?: number | null     // P1-5: 事实生效时间
  invalid_at?: number | null   // P1-5: 事实失效时间（NULL=当前有效）
  superseded_by?: number | null // P1-5: 被哪个新事实取代
}

/** T-1: 查询角色的所有事实 */
export async function getOwnerFacts(characterId: string): Promise<OwnerFactRow[]> {
  await ensureReady()
  return invoke('sp_owner_facts_list', { characterId })
}

/** P1-5: 查询角色在指定时间点的有效事实（支持双时间轴） */
export async function getOwnerFactsAsOf(characterId: string, asOfTime: number): Promise<OwnerFactRow[]> {
  await ensureReady()
  return invoke('sp_owner_facts_as_of', { characterId, asOfTime })
}

/** P1-5: 查询角色的历史事实（已被取代的事实） */
export async function getOwnerFactsHistory(characterId: string): Promise<OwnerFactRow[]> {
  await ensureReady()
  return invoke('sp_owner_facts_history', { characterId })
}

/** T-1: upsert 事实（按 character_id + fact_key 唯一）
 * P1-5 改进：同 key 新值插入时，旧值打 invalid_at 标记（非覆盖）——Rust 端实现 */
export async function upsertOwnerFact(row: OwnerFactRow): Promise<void> {
  await ensureReady()
  await invoke('sp_owner_facts_upsert', { row })
}

/** T-1: 删除事实 */
export async function deleteOwnerFact(characterId: string, factKey: string): Promise<void> {
  await ensureReady()
  await invoke('sp_owner_facts_delete', { characterId, factKey })
}

/** T-1: 清空角色所有事实 */
export async function clearOwnerFacts(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_owner_facts_clear', { characterId })
}

/** T-1: owner_facts 迁移标记 */
const OWNER_FACTS_MIGRATION_FLAG = 'spiritpal-owner-facts-migrated-v2'

export async function isOwnerFactsMigrated(): Promise<boolean> {
  return (await getSetting(OWNER_FACTS_MIGRATION_FLAG)) === '1'
}

export async function setOwnerFactsMigrated(): Promise<void> {
  await setSetting(OWNER_FACTS_MIGRATION_FLAG, '1')
}

// ============ P1-6: memory_semantic_facts 表操作（语义层结构化） ============

/** P1-6: 语义事实行类型 */
export interface SemanticFactRow {
  id?: number
  character_id: string
  fact_key: string
  fact_value: string
  source_memory_ids: string[]
  importance: number
  created_at: number
  updated_at: number
  is_autobiographical: number
}

/** P1-6: 查询角色的所有语义事实（按重要性排序） */
export async function getSemanticFacts(characterId: string): Promise<SemanticFactRow[]> {
  await ensureReady()
  return invoke('sp_sem_facts_list', { characterId })
}

/** P1-6: 按 key 查询特定语义事实 */
export async function getSemanticFactByKey(characterId: string, factKey: string): Promise<SemanticFactRow | null> {
  await ensureReady()
  return invoke('sp_sem_facts_by_key', { characterId, factKey })
}

/** P1-6: 插入或更新语义事实 */
export async function upsertSemanticFact(row: SemanticFactRow): Promise<void> {
  await ensureReady()
  await invoke('sp_sem_facts_upsert', { row })
}

/** P1-6: 删除特定语义事实 */
export async function deleteSemanticFact(characterId: string, factKey: string): Promise<void> {
  await ensureReady()
  await invoke('sp_sem_facts_delete', { characterId, factKey })
}

/** P1-6: 清空角色所有语义事实 */
export async function clearSemanticFacts(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_sem_facts_clear', { characterId })
}

/** P1-6: 获取语义事实数量 */
export async function getSemanticFactsCount(characterId: string): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_sem_facts_count', { characterId })
}

// ============ T-1: pet_experiences 表操作（二期行级化） ============

/** T-1: pet_experiences 行类型 */
export interface PetExperienceRow {
  id: string
  character_id: string
  type: string
  description: string
  timestamp: number
  sentiment: string
  intensity: number
}

/** T-1: 查询角色的所有经历 */
export async function getPetExperiences(characterId: string): Promise<PetExperienceRow[]> {
  await ensureReady()
  return invoke('sp_pet_exp_list', { characterId })
}

/** T-1: 插入一条经历 */
export async function insertPetExperience(row: PetExperienceRow): Promise<void> {
  await ensureReady()
  await invoke('sp_pet_exp_insert', { row })
}

/** T-1: 清空角色所有经历 */
export async function clearPetExperiences(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_pet_exp_clear', { characterId })
}

/** T-1: pet_experiences 迁移标记 */
const PET_EXPERIENCE_MIGRATION_FLAG = 'spiritpal-pet-experience-migrated-v2'

export async function isPetExperienceMigrated(): Promise<boolean> {
  return (await getSetting(PET_EXPERIENCE_MIGRATION_FLAG)) === '1'
}

export async function setPetExperienceMigrated(): Promise<void> {
  await setSetting(PET_EXPERIENCE_MIGRATION_FLAG, '1')
}

// ============ T-1: visual_memories 表操作（二期行级化） ============

/** T-1: visual_memories 行类型 */
export interface VisualMemoryRow {
  id: string
  character_id: string
  type: string
  description: string
  image_path?: string | null
  timestamp: number
  sentiment: string
  related_memory_id?: string | null
}

/** T-1: 查询角色的所有视觉记忆 */
export async function getVisualMemories(characterId: string): Promise<VisualMemoryRow[]> {
  await ensureReady()
  return invoke('sp_visual_list', { characterId })
}

/** T-1: 插入一条视觉记忆 */
export async function insertVisualMemory(row: VisualMemoryRow): Promise<void> {
  await ensureReady()
  await invoke('sp_visual_insert', { row })
}

/** T-1: 清空角色所有视觉记忆 */
export async function clearVisualMemories(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_visual_clear', { characterId })
}

/** T-1: visual_memories 迁移标记 */
const VISUAL_MEMORY_MIGRATION_FLAG = 'spiritpal-visual-memory-migrated-v2'

export async function isVisualMemoryMigrated(): Promise<boolean> {
  return (await getSetting(VISUAL_MEMORY_MIGRATION_FLAG)) === '1'
}

export async function setVisualMemoryMigrated(): Promise<void> {
  await setSetting(VISUAL_MEMORY_MIGRATION_FLAG, '1')
}

// ============ T-1: entity_nodes 表操作（二期行级化） ============

/** T-1: entity_nodes 行类型 */
export interface EntityNodeRow {
  id: string
  character_id: string
  name: string
  type: string
  linked_memory_ids: string // JSON 数组
  mention_count: number
  first_seen: number
  last_seen: number
}

/** T-1: 查询角色的所有实体 */
export async function getEntityNodes(characterId: string): Promise<EntityNodeRow[]> {
  await ensureReady()
  return invoke('sp_entity_list', { characterId })
}

/** T-1: upsert 实体（按 character_id + name 唯一） */
export async function upsertEntityNode(row: EntityNodeRow): Promise<void> {
  await ensureReady()
  await invoke('sp_entity_upsert', { row })
}

/** T-1: 清空角色所有实体 */
export async function clearEntityNodes(characterId: string): Promise<void> {
  await ensureReady()
  await invoke('sp_entity_clear', { characterId })
}

/** T-1: entity_nodes 迁移标记 */
const ENTITY_NODES_MIGRATION_FLAG = 'spiritpal-entity-nodes-migrated-v2'

export async function isEntityNodesMigrated(): Promise<boolean> {
  return (await getSetting(ENTITY_NODES_MIGRATION_FLAG)) === '1'
}

export async function setEntityNodesMigrated(): Promise<void> {
  await setSetting(ENTITY_NODES_MIGRATION_FLAG, '1')
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
  await ensureReady()
  await invoke('sp_mods_save', {
    row: {
      id: mod.id,
      name: mod.name,
      version: mod.version ?? null,
      config: JSON.stringify(mod.config),
      enabled: mod.enabled ?? true,
      installedAt: Date.now(),
    },
  })
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
  await ensureReady()
  return invoke('sp_mods_list')
}

/** 删除模组 */
export async function deleteMod(id: string): Promise<void> {
  await ensureReady()
  await invoke('sp_mods_delete', { id })
}

/** 更新模组启用状态 */
export async function updateModEnabled(id: string, enabled: boolean): Promise<void> {
  await ensureReady()
  await invoke('sp_mods_set_enabled', { id, enabled })
}

// ============ inventory 表操作 ============

/** 保存背包物品（upsert） */
export async function saveInventoryItem(item: {
  id: string
  item_id: string
  quantity: number
  character_id?: string | null
}): Promise<void> {
  await ensureReady()
  await invoke('sp_inventory_save', {
    item: {
      id: item.id,
      item_id: item.item_id,
      quantity: item.quantity,
      character_id: item.character_id ?? null,
    },
  })
}

/** 查询背包物品 */
export async function getInventory(
  characterId?: string,
): Promise<Array<Record<string, unknown>>> {
  await ensureReady()
  return invoke('sp_inventory_list', { characterId: characterId ?? null })
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
  await ensureReady()
  await invoke('sp_schedules_save', {
    schedule: {
      id: schedule.id,
      title: schedule.title,
      time: schedule.time,
      repeat: schedule.repeat ?? null,
      completed: schedule.completed ?? false,
    },
  })
}

/** 查询所有日程（按时间排序） */
export async function getSchedules(): Promise<Array<Record<string, unknown>>> {
  await ensureReady()
  return invoke('sp_schedules_list')
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
 * - 迁移完成后清除已迁移的 spiritpal-* localStorage 键（保留迁移标记键）
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

  // 2. 逐个写入 settings（Rust 端每条为独立事务，安全幂等）
  const keysToRemove: string[] = [...spiritpalKeys]
  for (const key of spiritpalKeys) {
    const value = localStorage.getItem(key)
    if (value !== null) {
      try {
        await setSetting(key, value)
      } catch (e) {
        console.warn('[SpiritPal] migrateFromLocalStorage setSetting failed:', key, e)
      }
    } else {
      keysToRemove.splice(keysToRemove.indexOf(key), 1)
    }
  }

  // 3. 标记迁移完成（幂等保护：迁移完成后才会走到这一步）
  await setSetting(MIGRATION_FLAG, '1')

  // 4. 清理已迁移的 localStorage 键（保留迁移标记键）
  for (const key of keysToRemove) {
    if (key !== MIGRATION_FLAG) {
      localStorage.removeItem(key)
    }
  }

  console.log(`[SpiritPal] localStorage → SQLite migration done (${keysToRemove.length} keys)`)
}

// ============ B2-2: 健康检查 / 完整性 / 快照 ============

/**
 * SQLite 物理完整性检查（PRAGMA integrity_check），返回每行状态字符串。
 * 全为 'ok' 即健康。
 */
export async function dbIntegrityCheck(): Promise<string[]> {
  await ensureReady()
  return invoke<string[]>('sp_db_integrity')
}

/**
 * 导出全部业务表的行级快照 { 表名: 行数组 }（表名由 Rust 白名单决定）。
 */
export async function exportDbSnapshot(): Promise<Record<string, unknown[]>> {
  await ensureReady()
  return invoke<Record<string, unknown[]>>('sp_db_snapshot')
}

// ============ B2-2: settings 键扫描 / 全量清空 ============

/** 按 LIKE 模式返回 settings 键列表（memoryMigrator / zombieDataCleanup 用） */
export async function getSettingsKeysLike(pattern: string): Promise<string[]> {
  await ensureReady()
  return invoke<string[]>('sp_settings_keys', { pattern })
}

/** 全量清空业务数据（dataManager.resetAll GDPR 语义） */
export async function purgeAllData(): Promise<void> {
  await ensureReady()
  await invoke('sp_db_purge')
}

// ============ B2-2: commitments（commitmentTracker） ============

/** 约定行 */
export interface CommitmentRow {
  id?: number
  character_id: string
  content: string
  actor: string
  due_at: number | null
  status: string
  source_memory_id: number | null
  created_at: number
  follow_up_count: number
  repeat?: string | null
}

/** 保存约定，返回 new id */
export async function insertCommitment(opts: {
  characterId: string
  content: string
  actor: string
  dueAt: number | null
  sourceMemoryId?: number | null
  repeat?: string | null
}): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_commitments_insert', {
    characterId: opts.characterId,
    content: opts.content,
    actor: opts.actor,
    dueAt: opts.dueAt,
    sourceMemoryId: opts.sourceMemoryId ?? null,
    repeat: opts.repeat ?? null,
  })
}

/** 获取角色的全部 open 约定 */
export async function getOpenCommitments(characterId: string): Promise<CommitmentRow[]> {
  await ensureReady()
  return invoke<CommitmentRow[]>('sp_commitments_list', { characterId })
}

/** 获取 today 区间（[start, end)）内到期的 open 约定 */
export async function getDueCommitments(characterId: string, start: number, end: number): Promise<CommitmentRow[]> {
  await ensureReady()
  return invoke<CommitmentRow[]>('sp_commitments_due', { characterId, start, end })
}

/** 获取逾期（due_at < now 且 > before）的 open 约定 */
export async function getOverdueCommitments(characterId: string, now: number, before: number): Promise<CommitmentRow[]> {
  await ensureReady()
  return invoke<CommitmentRow[]>('sp_commitments_overdue', { characterId, now, before })
}

const COMMITMENT_STATUSES = ['open', 'fulfilled', 'lapsed', 'cancelled'] as const
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number]

/** 设置约定状态（Rust 端白名单校验） */
export async function setCommitmentStatus(id: number, status: CommitmentStatus): Promise<void> {
  await ensureReady()
  await invoke('sp_commitments_set_status', { id, status })
}

/** 增加约定跟进次数 */
export async function incrementCommitmentFollowUp(id: number): Promise<void> {
  await ensureReady()
  await invoke('sp_commitments_increment_follow_up', { id })
}

/** 将角色超期未提的 open 约定自动置为 lapsed，返回受影响行数 */
export async function autoLapseCommitments(characterId: string, threshold: number): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_commitments_auto_lapse', { characterId, threshold })
}

/** 查询已完成/已过期的重复约定（createRecurring 候选） */
export async function getRecurringDoneCommitments(characterId: string): Promise<CommitmentRow[]> {
  await ensureReady()
  return invoke<CommitmentRow[]>('sp_commitments_recurring_done', { characterId })
}

/** 查询角色同内容最近创建的 open 约定（防重复建循环约定） */
export async function getOpenCommitmentByContent(characterId: string, content: string, since: number): Promise<CommitmentRow[]> {
  await ensureReady()
  return invoke<CommitmentRow[]>('sp_commitments_open_recent', { characterId, content, since })
}

// ============ B2-2: context_episodes（contextEpisodeManager） ============

export interface ContextEpisodeRow {
  id: number
  character_id: string
  started_at: number
  ended_at: number | null
  work_state: string | null
  weather: string | null
  idle_minutes: number | null
  music: string | null
  summary: string | null
}

/** 开启新片段，返回 id */
export async function insertContextEpisode(opts: {
  characterId: string
  startedAt: number
  workState?: string | null
  weather?: string | null
  idleMinutes?: number | null
  music?: string | null
}): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_ctx_insert', {
    characterId: opts.characterId,
    startedAt: opts.startedAt,
    workState: opts.workState ?? null,
    weather: opts.weather ?? null,
    idleMinutes: opts.idleMinutes ?? null,
    music: opts.music ?? null,
  })
}

/** 关闭片段 */
export async function closeContextEpisode(id: number, endedAt: number): Promise<void> {
  await ensureReady()
  await invoke('sp_ctx_close', { id, endedAt })
}

/** 查询片段（[start, end) 可选 end） */
export async function listContextEpisodes(characterId: string, start: number, end?: number): Promise<ContextEpisodeRow[]> {
  await ensureReady()
  return invoke<ContextEpisodeRow[]>('sp_ctx_list', { characterId, start, end: end ?? null })
}

// ============ B2-2: entityGraph（memory_entities / edges） ============

export interface EntityNodeGraphRow {
  id: string
  name: string
  type: string
  memory_ids: string
  created_at: number
}

/** upsert 实体节点，返回实际 id（新增用 candidateId；已存在复用既有 id） */
export async function upsertEntityGraphNode(opts: {
  name: string
  nodeType: string
  memoryId: string
  candidateId: string
  createdAt: number
  embeddingB64?: string | null
}): Promise<string> {
  await ensureReady()
  return invoke<string>('sp_entitygraph_upsert_node', {
    name: opts.name,
    nodeType: opts.nodeType,
    memoryId: opts.memoryId,
    candidateId: opts.candidateId,
    createdAt: opts.createdAt,
    embeddingB64: opts.embeddingB64 ?? null,
  })
}

/** upsert 实体关系边（增量权重） */
export async function upsertEntityGraphEdge(opts: {
  entityA: string
  entityB: string
  weightIncrement: number
  createdAt: number
}): Promise<void> {
  await ensureReady()
  await invoke('sp_entitygraph_upsert_edge', {
    entityA: opts.entityA,
    entityB: opts.entityB,
    weightIncrement: opts.weightIncrement,
    createdAt: opts.createdAt,
  })
}

/** 按名称批量查实体 */
export async function findEntityNodesByName(names: string[]): Promise<EntityNodeGraphRow[]> {
  await ensureReady()
  return invoke<EntityNodeGraphRow[]>('sp_entitygraph_find_by_names', { names })
}

/** 获取实体的邻居（含权重） */
export async function getEntityGraphNeighbors(entityName: string): Promise<Array<{ neighbor: string; weight: number }>> {
  await ensureReady()
  return invoke<Array<{ neighbor: string; weight: number }>>('sp_entitygraph_neighbors', { entityName })
}

// ============ B2-2: zombie 数据清理（zombieDataCleanup） ============

export interface ZombieReportRow {
  legacyCount: number
  legacyOldest: number | null
  episodeCount: number
  entityCount: number
  bytes: number
}

/** 僵尸数据报告 */
export async function getZombieReport(contextThreshold: number, entityThreshold: number): Promise<ZombieReportRow> {
  await ensureReady()
  return invoke<ZombieReportRow>('sp_zombie_report', { contextThreshold, entityThreshold })
}

/** 清理过期 legacy blob，返回清理条数 */
export async function zombieCleanupLegacy(threshold: number, force: boolean, limit: number): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_zombie_cleanup_legacy', { threshold, force, limit })
}

/** 清理过期 context_episodes，返回清理条数 */
export async function zombieCleanupEpisodes(threshold: number, limit: number): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_zombie_cleanup_episodes', { threshold, limit })
}

/** 清理过期 entity_nodes，返回清理条数 */
export async function zombieCleanupEntities(threshold: number, limit: number): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_zombie_cleanup_entities', { threshold, limit })
}

// ============ B2-2: schemaRunner（迁移标记 + 只读校验） ============

export interface SchemaVersionRecord {
  version: number
  description: string
  applied_at: number
  sql_checksum: string
}

export interface MigrationFailureLogRow {
  id: number
  version: number
  attempted_at: number
  error_message: string
  sql_statement: string
}

/** 当前 schema 版本 */
export async function getCurrentSchemaVersion(): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_schema_version_current')
}

/** 指定版本是否已应用 */
export async function isSchemaVersionApplied(version: number): Promise<boolean> {
  await ensureReady()
  return invoke<boolean>('sp_schema_version_applied', { version })
}

/** 标记迁移版本已应用（幂等，不执行 DDL） */
export async function recordSchemaVersion(version: number, description: string, sqlChecksum: string): Promise<void> {
  await ensureReady()
  await invoke('sp_schema_version_record', { version, description, sqlChecksum })
}

/** schema 版本历史 */
export async function getSchemaVersionHistory(): Promise<SchemaVersionRecord[]> {
  await ensureReady()
  return invoke<SchemaVersionRecord[]>('sp_schema_version_history')
}

/** 记录迁移失败 */
export async function logSchemaMigrationFailure(version: number, errorMessage: string, sqlStatement?: string): Promise<void> {
  await ensureReady()
  await invoke('sp_schema_log_failure', { version, errorMessage, sqlStatement: sqlStatement ?? null })
}

/** 标记迁移失败为已解决 */
export async function resolveSchemaMigrationFailure(logId: number, resolvedAt: number): Promise<void> {
  await ensureReady()
  await invoke('sp_schema_resolve_failure', { logId, resolvedAt })
}

/** 未解决的迁移失败记录 */
export async function getUnresolvedSchemaFailures(): Promise<MigrationFailureLogRow[]> {
  await ensureReady()
  return invoke<MigrationFailureLogRow[]>('sp_schema_unresolved')
}

// ============ B2-2: dirty_data_registry（dirtyDataTracker） ============

/** 运行脏数据检测（Rust 端静态 SQL），返回归一化 issue 列表 */
export interface DirtyScanIssue {
  table: string
  column?: string
  rowId?: string | number
  dataType: string
  severity: string
  description: string
  details?: string
  detectedAt: number
}

export async function scanDirtyData(): Promise<DirtyScanIssue[]> {
  await ensureReady()
  return invoke<DirtyScanIssue[]>('sp_dirty_scan')
}

export interface DirtyRegistryRow {
  id: number
  kind: string
  target_id: string
  payload: string
  detected_at: number
  resolved_at: number | null
}

/** 写入脏数据问题（幂等 upsert） */
export async function upsertDirtyIssue(kind: string, targetId: string, payload: string, detectedAt: number): Promise<void> {
  await ensureReady()
  await invoke('sp_dirty_upsert', { kind, targetId, payload, detectedAt })
}

/** 解决单个脏数据问题 */
export async function resolveDirtyIssue(id: number, resolvedAt: number): Promise<void> {
  await ensureReady()
  await invoke('sp_dirty_resolve', { id, resolvedAt })
}

/** 批量解决某表所有脏数据，返回受影响行数 */
export async function resolveDirtyIssuesForTable(table: string, resolvedAt: number): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_dirty_resolve_table', { table, resolvedAt })
}

/** 全部脏数据行 */
export async function listDirtyIssues(): Promise<DirtyRegistryRow[]> {
  await ensureReady()
  return invoke<DirtyRegistryRow[]>('sp_dirty_list')
}

/** 清理已解决超过 threshold 的记录 */
export async function cleanupResolvedDirtyData(threshold: number): Promise<number> {
  await ensureReady()
  return invoke<number>('sp_dirty_cleanup', { threshold })
}