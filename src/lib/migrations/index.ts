/**
 * Schema 迁移入口文件 — 所有数据库迁移在此注册
 *
 * @module migrations/index
 * @description
 * 所有 Schema 迁移文件在此集中导出。新增迁移文件时，必须在 allMigrations 数组中注册。
 *
 * 迁移文件命名规范：
 * - v001_initial_schema.ts — 初始建表
 * - v002_add_column_xxx.ts — 添加列
 * - v003_create_table_xxx.ts — 创建新表
 *
 * 添加新迁移步骤：
 * 1. 在 migrations/ 目录创建新文件（如 v00N_description.ts）
 * 2. 导出 Migration 对象
 * 3. 在 allMigrations 数组中导入并注册
 *
 * @example
 * ```ts
 * import { v001_initial } from './v001_initial_schema'
 * import { v002_add_embedding } from './v002_add_embedding_column'
 *
 * export const allMigrations: Migration[] = [
 *   v001_initial,
 *   v002_add_embedding,
 * ]
 * ```
 */

import type { Migration } from './schemaRunner'

// ============ 迁移文件导入 ============
// 在此处导入所有迁移文件
import { v001_initialSchema } from './v001_initial_schema'
import { v002_addSchemaTracking } from './v002_add_schema_tracking'
import { v003_addDirtyDataRegistry } from './v003_add_dirty_data_registry'

// ============ 迁移注册列表 ============
/**
 * 所有已定义的迁移，按版本号升序排列
 *
 * ⚠️ 重要：新增迁移必须追加到数组末尾，确保版本号递增
 * ⚠️ 已发布的迁移文件禁止修改（已应用迁移的 SQL 不可变）
 */
export const allMigrations: Migration[] = [
  v001_initialSchema,
  v002_addSchemaTracking,
  v003_addDirtyDataRegistry,
  // 在此追加新迁移...
]

/**
 * 当前 Schema 版本号（等于最后一个迁移的版本号）
 * 用于快速检测是否需要迁移
 */
export const CURRENT_SCHEMA_VERSION = allMigrations.length > 0
  ? Math.max(...allMigrations.map(m => m.version))
  : 0
