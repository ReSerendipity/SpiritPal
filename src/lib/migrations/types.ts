/**
 * Schema 迁移公共类型
 *
 * @module migrations/types
 * @description
 * 从 schemaRunner.ts 抽出的纯类型定义，供 index.ts（迁移注册入口）与
 * schemaRunner.ts（迁移运行器）共同引用，切断二者之间的模块循环依赖。
 */

/** 迁移记录接口 */
export interface MigrationRecord {
  version: number
  applied_at: number
  description: string
  sql_checksum: string
}

/** 迁移失败日志接口 */
export interface MigrationFailureLog {
  id: number
  version: number
  attempted_at: number
  error_message: string
  sql_statement: string
}

/** 迁移定义 */
export interface Migration {
  version: number
  description: string
  sql: string | string[]
  /** 回滚 SQL（可选，用于手动回滚） */
  rollbackSql?: string | string[]
}