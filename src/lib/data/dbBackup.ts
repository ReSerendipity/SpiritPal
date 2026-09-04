/**
 * @file dbBackup.ts
 * @description 本地备份与完整性（P1）
 *
 * 纯本地 + 无云端备份架构下数据耐久性的最小闭环：
 * 1. `checkDbIntegrity()` — 启动时 PRAGMA integrity_check（物理层损坏检测）
 * 2. `exportDatabaseSnapshot()` — 表级全量快照（导出覆盖全部业务表，
 *    弥补 dataManager store-blob 导出遗漏的 memories 行 / schedules 等）
 * 3. Rust `backup_db_at_rest` / `list_db_backups` / `restore_db_backup` /
 *    `delete_db_backup` — 退出时自动备份加密库（保留 3 份）+ 恢复/清理
 */

import { invoke } from '@tauri-apps/api/core'
import { getDb } from './db'

// ============ 物理完整性检查 ============

/** 数据库完整性损坏事件（UI 订阅提示恢复路径） */
export const DB_INTEGRITY_FAILED_EVENT = 'spiritpal:db-integrity-failed'

/**
 * 执行 SQLite 物理完整性检查（PRAGMA integrity_check）。
 * 结果全为 'ok' 即健康；异常时输出日志并广播事件（供 UI 提示使用本地备份恢复）。
 * 非阻塞：失败不抛出，仅记录。
 */
export async function checkDbIntegrity(): Promise<boolean> {
  try {
    const db = await getDb()
    const rows = await db.select<{ integrity_check: string }[]>(
      'SELECT * FROM pragma_integrity_check'
    )
    const ok = rows.every((r) => String(r.integrity_check).trim().toLowerCase() === 'ok')
    if (!ok) {
      const sample = rows.map((r) => String(r.integrity_check)).slice(0, 5).join('; ')
      console.error(`[DataHealth] 数据库完整性检查失败: ${sample}`)
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(
            new CustomEvent(DB_INTEGRITY_FAILED_EVENT, { detail: { sample } })
          )
        } catch {
          // 非浏览器环境静默
        }
      }
    } else {
      console.log('[DataHealth] 数据库完整性检查通过（integrity_check = ok）')
    }
    return ok
  } catch (e) {
    console.error('[DataHealth] 完整性检查执行异常:', e)
    return false
  }
}

// ============ 表级全量快照（导出/导入） ============

/**
 * 导出全部业务表的行级快照 { 表名: 行数组 }。
 * 覆盖 characters/settings/memories/mods/inventory/schedules/
 * memory_summaries/owner_facts/pet_experiences/visual_memories/
 * entity_nodes/commitments/context_episodes/memory_semantic_facts/memory_state 等。
 * 治理元数据表（schema 系列、dirty_data_registry、memory_entities 系列）跳过。
 */
export async function exportDatabaseSnapshot(): Promise<Record<string, unknown[]>> {
  const db = await getDb()
  const tables = await db.select<{ name: string }[]>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'dirty_data_%'
       AND name NOT LIKE 'schema_%' AND name <> 'memory_entities' AND name <> 'memory_entity_edges'
     ORDER BY name`
  )
  const snapshot: Record<string, unknown[]> = {}
  for (const { name } of tables) {
    try {
      snapshot[name] = (await db.select(`SELECT * FROM "${name}"`)) as unknown[]
    } catch {
      // 单表失败不阻断整体导出
      console.warn(`[DataHealth] 导出表 ${name} 失败，已跳过`)
    }
  }
  return snapshot
}

// ============ 本地自动备份（Rust 命令封装） ============

/** 备份文件信息（与 Rust DBBackupInfo 对应） */
export interface DBBackupInfoTs {
  name: string
  sizeBytes: number
  modifiedAt: number
}

/** 列出本地自动备份 */
export async function listDbBackups(): Promise<DBBackupInfoTs[]> {
  try {
    return (await invoke<DBBackupInfoTs[]>('list_db_backups')) ?? []
  } catch {
    return []
  }
}

/** 恢复指定备份（覆盖加密库；需重启生效） */
export async function restoreDbBackup(name: string): Promise<void> {
  await invoke('restore_db_backup', { name })
}

/** 删除指定备份 */
export async function deleteDbBackup(name: string): Promise<void> {
  await invoke('delete_db_backup', { name })
}