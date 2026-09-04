/**
 * Schema 迁移 v002 — 添加 Schema 版本追踪表
 *
 * 创建 Schema 治理基础设施：
 * - schema_versions：记录已应用的迁移版本
 * - schema_migration_log：记录迁移失败日志
 *
 * @version 2
 * @since v0.1.0 (数据治理改进)
 */

import type { Migration } from './types'

export const v002_addSchemaTracking: Migration = {
  version: 2,
  description: '添加 Schema 版本追踪表（schema_versions + schema_migration_log）',
  sql: [
    // Schema 版本追踪表
    `CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      sql_checksum TEXT NOT NULL
    )`,

    // 迁移失败日志表
    `CREATE TABLE IF NOT EXISTS schema_migration_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      attempted_at INTEGER NOT NULL,
      error_message TEXT NOT NULL,
      sql_statement TEXT,
      resolved INTEGER DEFAULT 0,
      resolved_at INTEGER
    )`,

    // 迁移失败日志索引
    'CREATE INDEX IF NOT EXISTS idx_migration_log_version ON schema_migration_log(version)',
    'CREATE INDEX IF NOT EXISTS idx_migration_log_resolved ON schema_migration_log(resolved)',
  ],
}
