/**
 * Schema 迁移 v003 — 添加脏数据注册表
 *
 * 创建数据质量检测的基础设施：
 * - dirty_data_registry：记录业务层面的脏数据问题
 *
 * 脏数据类别：
 * - ORPHAN_REFERENCE：孤引用（外键指向不存在的记录）
 * - CONSTRAINT_VIOLATION：违反 Not Null / Check 约束
 * - DATA_TYPE_MISMATCH：数据类型不匹配
 * - BUSINESS_RULE_VIOLATION：违反业务规则（负数量、无效枚举）
 * - DUPLICATE_ENTRY：主键/唯一键冲突
 * - INCONSISTENT_STATE：数据状态不一致
 *
 * @version 3
 * @since v0.1.0 (数据治理改进)
 */

import type { Migration } from './schemaRunner'

export const v003_addDirtyDataRegistry: Migration = {
  version: 3,
  description: '添加脏数据注册表（dirty_data_registry）',
  sql: [
    // 脏数据注册表
    `CREATE TABLE IF NOT EXISTS dirty_data_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      column_name TEXT,
      row_id TEXT,
      data_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      description TEXT NOT NULL,
      details TEXT,
      detected_at INTEGER NOT NULL,
      resolved INTEGER DEFAULT 0,
      resolved_at INTEGER
    )`,

    // 索引
    'CREATE INDEX IF NOT EXISTS idx_dirty_data_resolved ON dirty_data_registry(resolved)',
    'CREATE INDEX IF NOT EXISTS idx_dirty_data_type ON dirty_data_registry(data_type)',
    'CREATE INDEX IF NOT EXISTS idx_dirty_data_severity ON dirty_data_registry(severity)',
  ],
}
