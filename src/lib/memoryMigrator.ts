/**
 * S2/M1: 记忆存储迁移器
 *
 * 将旧的双轨制记忆数据（settings 中的加密 JSON blob + memories 表镜像）
 * 迁移为行级存储（memories 表扩列行 + memory_summaries + memory_state）。
 *
 * 迁移流程：
 * 1. 检查迁移标记 spiritpal-memory-migrated-v2
 * 2. 读取旧 blob（兼容 ENC1:/ENC2: 解密）
 * 3. BEGIN TRANSACTION
 * 4. 逐条 INSERT memories（写 memory_id=旧 id）
 * 5. INSERT memory_summaries（semanticMemory）
 * 6. INSERT memory_state（触发状态）
 * 7. 旧 blob 副本写入 settings.spiritpal-enhanced-memory-<char>.legacy
 * 8. COMMIT；写迁移标记
 * 失败 → ROLLBACK，旧 blob 原样保留
 *
 * @module memoryMigrator
 */

import { invoke } from '@tauri-apps/api/core'
import {
  getDb,
  getSetting,
  setSetting,
  insertMemoryRow,
  upsertMemorySummary,
  upsertMemoryState,
  isMemoryMigrated,
  setMemoryMigrated,
  isLegacyMode,
  type MemoryRow,
  type MemoryStateRow,
} from './db'
import type { EnhancedMemory } from './memoryTypes'

/**
 * 迁移结果
 */
export interface MigrationResult {
  success: boolean
  characterId: string
  memoriesMigrated: number
  summaryMigrated: boolean
  stateMigrated: boolean
  error?: string
}

/**
 * 检查是否需要迁移（迁移标记未设 + 旧 blob 存在 + 未强制 legacy 模式）
 */
export async function needsMigration(characterId: string): Promise<boolean> {
  // 强制 legacy 模式时不迁移
  if (await isLegacyMode()) return false
  // 已迁移则跳过
  if (await isMemoryMigrated()) return false
  // 检查旧 blob 是否存在
  const blobKey = `spiritpal-enhanced-memory-${characterId}`
  const raw = await getSetting(blobKey)
  return raw !== null
}

/**
 * 从旧 blob 解析记忆数据
 * 兼容 ENC1:/ENC2: 加密前缀和明文
 */
async function parseLegacyBlob(raw: string): Promise<Record<string, unknown> | null> {
  if (!raw) return null

  let jsonStr: string
  if (raw.startsWith('ENC1:') || raw.startsWith('ENC2:')) {
    try {
      jsonStr = await invoke<string>('decrypt_data', { encrypted: raw, password: '' })
    } catch {
      // 解密失败，无法迁移
      return null
    }
  } else {
    jsonStr = raw
  }

  try {
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

/**
 * 将 EnhancedMemory 对象转为 MemoryRow
 */
function memoryToRow(characterId: string, mem: EnhancedMemory, tier: string): MemoryRow {
  return {
    character_id: characterId,
    type: mem.isAutobiographical ? 'long_term' : 'short_term',
    content: mem.user,
    importance: mem.importance,
    created_at: new Date(mem.created_at).getTime(),
    last_accessed: mem.lastAccessed ?? Date.now(),
    memory_id: mem.id,
    assistant: mem.assistant,
    category: mem.category,
    tags: JSON.stringify(mem.tags ?? []),
    emotional_intensity: mem.emotionalIntensity ?? 0,
    emotional_valence: mem.emotionalValence ?? 0,
    emotional_arousal: mem.emotionalArousal ?? 0.3,
    strength: mem.strength ?? 1.0,
    decay_factor: mem.decayFactor ?? 1.0,
    access_count: mem.accessCount ?? 0,
    source_kind: mem.sourceKind ?? 'exchange',
    fact_text: mem.factText ?? null,
    is_autobiographical: mem.isAutobiographical ? 1 : 0,
    tier,
    // embedding 保留在旧行中，不在此迁移
  }
}

/**
 * 执行单个角色的记忆迁移
 */
export async function migrateCharacterMemory(characterId: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    characterId,
    memoriesMigrated: 0,
    summaryMigrated: false,
    stateMigrated: false,
  }

  if (await isMemoryMigrated()) {
    result.success = true
    result.error = 'Already migrated'
    return result
  }

  const blobKey = `spiritpal-enhanced-memory-${characterId}`
  const raw = await getSetting(blobKey)
  if (!raw) {
    result.success = true
    result.error = 'No legacy blob found'
    // 即使没有 blob 也设标记，避免重复检查
    await setMemoryMigrated()
    return result
  }

  const data = await parseLegacyBlob(raw)
  if (!data) {
    result.error = 'Failed to parse legacy blob'
    return result
  }

  const db = await getDb()

  try {
    await db.execute('BEGIN TRANSACTION')

    // 1. 迁移记忆行
    const workingMemory = (data.workingMemory as EnhancedMemory[]) ?? []
    const episodicMemory = (data.episodicMemory as EnhancedMemory[]) ?? []
    const autobiographicalMemory = (data.autobiographicalMemory as EnhancedMemory[]) ?? []

    // working 层
    for (const mem of workingMemory) {
      const row = memoryToRow(characterId, mem, 'working')
      await insertMemoryRow(row)
      result.memoriesMigrated++
    }

    // episodic 层
    for (const mem of episodicMemory) {
      const row = memoryToRow(characterId, mem, 'episodic')
      await insertMemoryRow(row)
      result.memoriesMigrated++
    }

    // autobiographical 层
    for (const mem of autobiographicalMemory) {
      const row = memoryToRow(characterId, mem, 'autobiographical')
      await insertMemoryRow(row)
      result.memoriesMigrated++
    }

    // 2. 迁移语义摘要
    const semanticMemory = (data.semanticMemory as string) ?? ''
    if (semanticMemory) {
      await upsertMemorySummary(characterId, semanticMemory)
      result.summaryMigrated = true
    }

    // 3. 迁移触发状态
    const stateRow: MemoryStateRow = {
      character_id: characterId,
      last_chat_date: (data.lastChatDate as string) ?? null,
      trigger_log: JSON.stringify(data.triggerLog ?? []),
      ignore_count: JSON.stringify(data.ignoreCount ?? {}),
      last_periodic_fire_date: JSON.stringify(data.lastPeriodicFireDate ?? {}),
      injected_at: JSON.stringify(
        data.injectedAt
          ? Array.isArray(data.injectedAt)
            ? Object.fromEntries(data.injectedAt)
            : data.injectedAt
          : {},
      ),
      llm_reassessed_ids: JSON.stringify(
        data.llmReassessedIds
          ? Array.isArray(data.llmReassessedIds)
            ? data.llmReassessedIds
            : Array.from(data.llmReassessedIds as Set<unknown>)
          : [],
      ),
    }
    await upsertMemoryState(stateRow)
    result.stateMigrated = true

    // 4. 旧 blob 副本写入 .legacy 键（保留，不删除）
    await setSetting(`${blobKey}.legacy`, raw)

    await db.execute('COMMIT')

    // 5. 写迁移标记
    await setMemoryMigrated()

    result.success = true
    console.log(`[S2-Migration] Migrated ${result.memoriesMigrated} memories for ${characterId}`)
  } catch (e) {
    await db.execute('ROLLBACK')
    result.error = `Migration failed: ${e}`
    console.error(`[S2-Migration] Failed for ${characterId}:`, e)
  }

  return result
}

/**
 * 批量迁移所有角色（遍历 settings 中的 enhanced-memory blob）
 */
export async function migrateAllCharacterMemories(): Promise<MigrationResult[]> {
  if (await isMemoryMigrated()) {
    return [{ success: true, characterId: '*', memoriesMigrated: 0, summaryMigrated: false, stateMigrated: false, error: 'Already migrated' }]
  }
  if (await isLegacyMode()) {
    return [{ success: true, characterId: '*', memoriesMigrated: 0, summaryMigrated: false, stateMigrated: false, error: 'Legacy mode forced' }]
  }

  const db = await getDb()
  // 查找所有 spiritpal-enhanced-memory- 开头的 key（排除 .legacy / .corrupt）
  const rows = await db.select<{ key: string }[]>(
    "SELECT key FROM settings WHERE key LIKE 'spiritpal-enhanced-memory-%' AND key NOT LIKE '%.legacy' AND key NOT LIKE '%.corrupt'",
  )

  const results: MigrationResult[] = []
  for (const row of rows) {
    // 提取 characterId
    const charId = row.key.replace('spiritpal-enhanced-memory-', '')
    if (charId) {
      const result = await migrateCharacterMemory(charId)
      results.push(result)
    }
  }

  // 如果没有找到任何 blob，也设标记
  if (results.length === 0) {
    await setMemoryMigrated()
  }

  return results
}
