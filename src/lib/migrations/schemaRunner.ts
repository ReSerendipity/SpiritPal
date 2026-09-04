/**
 * Schema 迁移运行器 — 版本化 Schema 治理
 *
 * @module migrations/schemaRunner
 * @description
 * 提供版本化的 Schema 迁移管理，替代原有的内联 ALTER TABLE + try-catch 模式。
 *
 * 核心功能：
 * 1. schema_versions 表：记录已应用的迁移版本
 * 2. 版本号递增：每次 Schema 变更对应一个版本号
 * 3. 幂等执行：重复调用不会重复应用已执行的迁移
 * 4. 迁移失败追踪：记录失败原因到 schema_migration_log 表
 *
 * 迁移文件规范：
 * - 存放于 src/lib/migrations/ 目录
 * - 命名格式：v{N}_{description}.ts（如 v001_initial_schema.ts）
 * - 每个迁移是一个 SQL 字符串或 SQL 字符串数组
 *
 * @example
 * ```ts
 * import { runMigrations } from './migrations/schemaRunner'
 *
 * // 应用启动时执行
 * await runMigrations()
 * ```
 */

import { getDb } from '@/lib/data/db'
import type { Migration, MigrationRecord, MigrationFailureLog } from './types'

/**
 * 确保 schema_versions 表存在
 * 这是迁移系统的基础设施表，必须首先创建
 */
async function ensureSchemaVersionTable(): Promise<void> {
  const db = await getDb()

  // 创建 Schema 版本追踪表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      sql_checksum TEXT NOT NULL
    )
  `)

  // 创建迁移失败日志表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migration_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      attempted_at INTEGER NOT NULL,
      error_message TEXT NOT NULL,
      sql_statement TEXT,
      resolved INTEGER DEFAULT 0,
      resolved_at INTEGER
    )
  `)
}

/**
 * 获取当前 Schema 版本
 * @returns 当前版本号（0 = 未初始化）
 */
export async function getCurrentSchemaVersion(): Promise<number> {
  try {
    const db = await getDb()
    const result = await db.select<{ version: number }[]>(
      'SELECT MAX(version) as version FROM schema_versions'
    )
    return result[0]?.version ?? 0
  } catch {
    return 0
  }
}

/**
 * 检查指定版本是否已应用
 */
export async function isVersionApplied(version: number): Promise<boolean> {
  try {
    const db = await getDb()
    const result = await db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM schema_versions WHERE version = ?',
      [version]
    )
    return (result[0]?.count ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * 记录迁移失败
 */
async function logMigrationFailure(
  version: number,
  error: string,
  sql: string,
): Promise<void> {
  try {
    const db = await getDb()
    await db.execute(
      'INSERT INTO schema_migration_log (version, attempted_at, error_message, sql_statement) VALUES (?, ?, ?, ?)',
      [version, Date.now(), error, sql],
    )
  } catch {
    // 日志记录失败不阻断流程
    console.error('[SchemaMigration] Failed to log migration failure:', error)
  }
}

/**
 * 标记迁移失败为已解决
 */
export async function resolveMigrationFailure(logId: number): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE schema_migration_log SET resolved = 1, resolved_at = ? WHERE id = ?',
    [Date.now(), logId],
  )
}

/**
 * 获取未解决的迁移失败记录
 */
export async function getUnresolvedFailures(): Promise<MigrationFailureLog[]> {
  try {
    const db = await getDb()
    return await db.select<MigrationFailureLog[]>(
      'SELECT * FROM schema_migration_log WHERE resolved = 0 ORDER BY attempted_at DESC'
    )
  } catch {
    return []
  }
}

/**
 * 简化的 SQL 校验和（用于检测迁移文件是否被篡改）
 * 生产环境建议使用 SHA-256，这里用简单哈希避免依赖
 */
function simpleChecksum(sql: string): string {
  let hash = 0
  for (let i = 0; i < sql.length; i++) {
    const char = sql.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/**
 * 执行单个迁移
 * @returns 是否成功
 */
async function applyMigration(migration: Migration): Promise<boolean> {
  const db = await getDb()
  const sqlStatements = Array.isArray(migration.sql) ? migration.sql : [migration.sql]

  try {
    // 检查是否已应用
    if (await isVersionApplied(migration.version)) {
      return true
    }

    // 执行迁移 SQL
    for (const sql of sqlStatements) {
      if (sql.trim()) {
        await db.execute(sql)
      }
    }

    // 计算校验和
    const allSql = sqlStatements.join(';')
    const checksum = simpleChecksum(allSql)

    // 记录迁移版本
    await db.execute(
      'INSERT INTO schema_versions (version, description, applied_at, sql_checksum) VALUES (?, ?, ?, ?)',
      [migration.version, migration.description, Date.now(), checksum],
    )

    console.log(`[SchemaMigration] Applied v${migration.version}: ${migration.description}`)
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await logMigrationFailure(migration.version, errorMessage, sqlStatements.join(';'))
    console.error(`[SchemaMigration] Failed v${migration.version}: ${errorMessage}`)
    return false
  }
}

/**
 * 执行所有未应用的迁移
 * 按版本号升序执行，确保顺序一致
 *
 * @param migrations 迁移列表（必须按 version 升序排列）
 * @returns 执行结果 { applied: number, failed: number, currentVersion: number }
 */
export async function runMigrations(
  migrations?: Migration[],
): Promise<{ applied: number; failed: number; currentVersion: number }> {
  // 1. 确保基础设施表存在
  await ensureSchemaVersionTable()

  // 2. 如果没有传入迁移列表，使用默认导入
  let migrationList: Migration[]
  if (migrations) {
    migrationList = migrations
  } else {
    // 默认导入所有迁移文件
    try {
      const { allMigrations } = await import('./index')
      migrationList = allMigrations
    } catch {
      console.warn('[SchemaMigration] No migration index found, skipping')
      return { applied: 0, failed: 0, currentVersion: await getCurrentSchemaVersion() }
    }
  }

  // 3. 按版本号排序
  migrationList.sort((a, b) => a.version - b.version)

  // 4. 依次执行未应用的迁移
  let applied = 0
  let failed = 0

  for (const migration of migrationList) {
    const success = await applyMigration(migration)
    if (success) {
      applied++
    } else {
      failed++
    }
  }

  const currentVersion = await getCurrentSchemaVersion()
  return { applied, failed, currentVersion }
}

/**
 * 获取完整的 Schema 版本历史
 */
export async function getSchemaVersionHistory(): Promise<MigrationRecord[]> {
  try {
    const db = await getDb()
    return await db.select<MigrationRecord[]>(
      'SELECT version, description, applied_at, sql_checksum FROM schema_versions ORDER BY version ASC'
    )
  } catch {
    return []
  }
}

/**
 * 打印 Schema 版本状态（调试用）
 */
export async function printSchemaStatus(): Promise<void> {
  const current = await getCurrentSchemaVersion()
  const history = await getSchemaVersionHistory()
  const failures = await getUnresolvedFailures()

  console.log('=== Schema Migration Status ===')
  console.log(`Current version: v${current}`)
  console.log(`Applied migrations: ${history.length}`)
  console.log(`Unresolved failures: ${failures.length}`)

  if (history.length > 0) {
    console.log('\nVersion History:')
    for (const record of history) {
      const date = new Date(record.applied_at).toISOString()
      console.log(`  v${record.version} | ${date} | ${record.description}`)
    }
  }

  if (failures.length > 0) {
    console.log('\nUnresolved Failures:')
    for (const f of failures) {
      const date = new Date(f.attempted_at).toISOString()
      console.log(`  v${f.version} | ${date} | ${f.error_message}`)
    }
  }
  console.log('==============================')
}
