/**
 * 脏数据追踪器 — 数据质量检测与告警
 *
 * @module dirtyDataTracker
 * @description
 * 提供运行时数据质量检测、持久化追踪与告警机制。
 *
 * 与 schema_migration_log（迁移期失败）互补：
 * - schema_migration_log：记录 SQL 迁移执行失败
 * - dirty_data_registry：记录业务数据层面的脏数据（孤记录、约束违反、业务规则异常）
 *
 * 检测类别：
 * 1. ORPHAN_REFERENCE：外键/引用指向不存在的记录
 * 2. CONSTRAINT_VIOLATION：违反 Not Null / Check 约束
 * 3. DATA_TYPE_MISMATCH：数据类型不匹配（非预期格式）
 * 4. BUSINESS_RULE_VIOLATION：违反业务规则（负数量、无效枚举）
 * 5. DUPLICATE_ENTRY：主键/唯一键冲突（理论上不应发生但保险起见）
 * 6. INCONSISTENT_STATE：数据状态不一致（如角色有背包但主记录丢失）
 *
 * 使用方式：
 * ```ts
 * import { runDirtyDataChecks, getDirtyDataSummary } from './dirtyDataTracker'
 *
 * // 应用启动后执行检测
 * const report = await runDirtyDataChecks()
 * console.log(`发现 ${report.totalIssues} 条脏数据`)
 *
 * // 获取摘要（UI 展示用）
 * const summary = await getDirtyDataSummary()
 * ```
 */

import { auditLog, AuditEventType } from '@/lib/system/auditLogger'
import { getDb } from './db'

// ============ 类型定义 ============

/** 脏数据问题类型 */
export type DirtyDataType =
  | 'ORPHAN_REFERENCE'
  | 'CONSTRAINT_VIOLATION'
  | 'DATA_TYPE_MISMATCH'
  | 'BUSINESS_RULE_VIOLATION'
  | 'DUPLICATE_ENTRY'
  | 'INCONSISTENT_STATE'

/** 严重程度 */
export type DirtyDataSeverity = 'low' | 'medium' | 'high' | 'critical'

/** 单个脏数据问题 */
export interface DirtyDataIssue {
  id?: number
  table: string
  column?: string
  rowId?: string | number
  dataType: DirtyDataType
  severity: DirtyDataSeverity
  description: string
  detectedAt: number
  resolved: boolean
  resolvedAt?: number
  details?: string
}

/** 检测结果汇总 */
export interface DirtyDataReport {
  totalIssues: number
  byType: Record<DirtyDataType, number>
  bySeverity: Record<DirtyDataSeverity, number>
  newIssues: number
  resolvedIssues: number
  issues: DirtyDataIssue[]
}

/** 检测配置 */
interface CheckConfig {
  /** 最大检测到的脏数据条目数（防止一次性加载过多） */
  maxIssuesPerRun: number
  /** 是否在检测到 high/critical 问题时立即写入审计日志 */
  auditHighSeverity: boolean
}

const DEFAULT_CHECK_CONFIG: CheckConfig = {
  maxIssuesPerRun: 200,
  auditHighSeverity: true,
}

// ============ 基础设施 ============

/**
 * 确保脏数据注册表存在
 */
async function ensureDirtyDataTable(): Promise<void> {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dirty_data_registry (
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
    )
  `)
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_dirty_data_resolved ON dirty_data_registry(resolved)'
  )
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_dirty_data_type ON dirty_data_registry(data_type)'
  )
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_dirty_data_severity ON dirty_data_registry(severity)'
  )
}

/**
 * 写入脏数据问题（幂等：同 table+row+type 不重复插入）
 */
async function persistIssue(issue: DirtyDataIssue): Promise<void> {
  const db = await getDb()

  // 检查是否已存在相同问题（未解决的）
  const existing = await db.select<{ id: number }[]>(
    `SELECT id FROM dirty_data_registry
     WHERE table_name = ? AND COALESCE(row_id, '') = COALESCE(?, '')
       AND data_type = ? AND resolved = 0
     LIMIT 1`,
    [issue.table, issue.rowId?.toString() ?? '', issue.dataType]
  )

  if (existing.length > 0) {
    // 已存在的未解决问题，更新时间戳
    await db.execute(
      'UPDATE dirty_data_registry SET detected_at = ? WHERE id = ?',
      [issue.detectedAt, existing[0].id]
    )
  } else {
    // 新问题
    await db.execute(
      `INSERT INTO dirty_data_registry
       (table_name, column_name, row_id, data_type, severity, description, details, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        issue.table,
        issue.column ?? null,
        issue.rowId?.toString() ?? null,
        issue.dataType,
        issue.severity,
        issue.description,
        issue.details ?? null,
        issue.detectedAt,
      ]
    )
  }
}

// ============ 检测规则 ============

/**
 * 检测孤引用：inventory.character_id 指向不存在的 characters.id
 */
async function checkInventoryOrphans(): Promise<DirtyDataIssue[]> {
  const db = await getDb()
  const issues: DirtyDataIssue[] = []

  const orphans = await db.select<{ id: string; character_id: string }[]>(
    `SELECT i.id, i.character_id FROM inventory i
     LEFT JOIN characters c ON i.character_id = c.id
     WHERE i.character_id IS NOT NULL AND c.id IS NULL`
  )

  for (const row of orphans) {
    issues.push({
      table: 'inventory',
      column: 'character_id',
      rowId: row.id,
      dataType: 'ORPHAN_REFERENCE',
      severity: 'medium',
      description: `背包物品引用的角色 ${row.character_id} 不存在`,
      detectedAt: Date.now(),
      resolved: false,
    })
  }

  return issues
}

/**
 * 检测孤引用：memories.character_id 指向不存在的 characters.id
 */
async function checkMemoriesOrphans(): Promise<DirtyDataIssue[]> {
  const db = await getDb()
  const issues: DirtyDataIssue[] = []

  const orphans = await db.select<{ id: number; character_id: string }[]>(
    `SELECT m.id, m.character_id FROM memories m
     LEFT JOIN characters c ON m.character_id = c.id
     WHERE c.id IS NULL`
  )

  for (const row of orphans) {
    issues.push({
      table: 'memories',
      column: 'character_id',
      rowId: row.id,
      dataType: 'ORPHAN_REFERENCE',
      severity: 'medium',
      description: `记忆 ${row.id} 引用的角色 ${row.character_id} 不存在`,
      detectedAt: Date.now(),
      resolved: false,
    })
  }

  return issues
}

/**
 * 检测数据类型不匹配：characters.stats 不是有效 JSON
 */
async function checkCharactersInvalidJson(): Promise<DirtyDataIssue[]> {
  const db = await getDb()
  const issues: DirtyDataIssue[] = []

  const chars = await db.select<{ id: string; stats: string }[]>(
    'SELECT id, stats FROM characters'
  )

  for (const row of chars) {
    try {
      JSON.parse(row.stats)
    } catch {
      issues.push({
        table: 'characters',
        column: 'stats',
        rowId: row.id,
        dataType: 'DATA_TYPE_MISMATCH',
        severity: 'high',
        description: `角色 ${row.id} 的 stats 字段不是有效 JSON`,
        detectedAt: Date.now(),
        resolved: false,
        details: row.stats.substring(0, 100),
      })
    }
  }

  return issues
}

/**
 * 检测业务规则违反：inventory.quantity 为负数
 */
async function checkInventoryNegativeQuantity(): Promise<DirtyDataIssue[]> {
  const db = await getDb()
  const issues: DirtyDataIssue[] = []

  const invalid = await db.select<{ id: string; item_id: string; quantity: number }[]>(
    'SELECT id, item_id, quantity FROM inventory WHERE quantity < 0'
  )

  for (const row of invalid) {
    issues.push({
      table: 'inventory',
      column: 'quantity',
      rowId: row.id,
      dataType: 'BUSINESS_RULE_VIOLATION',
      severity: 'medium',
      description: `背包物品 ${row.item_id} 数量为负数 (${row.quantity})`,
      detectedAt: Date.now(),
      resolved: false,
    })
  }

  return issues
}

/**
 * 检测业务规则违反：memories.importance 超出 0-100 范围
 */
async function checkMemoriesInvalidImportance(): Promise<DirtyDataIssue[]> {
  const db = await getDb()
  const issues: DirtyDataIssue[] = []

  const invalid = await db.select<{ id: number; importance: number }[]>(
    'SELECT id, importance FROM memories WHERE importance < 0 OR importance > 100'
  )

  for (const row of invalid) {
    issues.push({
      table: 'memories',
      column: 'importance',
      rowId: row.id,
      dataType: 'BUSINESS_RULE_VIOLATION',
      severity: 'low',
      description: `记忆 ${row.id} 的重要性值为 ${row.importance}（有效范围 0-100）`,
      detectedAt: Date.now(),
      resolved: false,
    })
  }

  return issues
}

/**
 * 检测业务规则违反：memories.type 不在允许范围内
 */
async function checkMemoriesInvalidType(): Promise<DirtyDataIssue[]> {
  const db = await getDb()
  const issues: DirtyDataIssue[] = []

  const allowedTypes = [
    'episodic', 'semantic', 'procedural', 'emotional',
    'preference', 'fear', 'dream', 'event', 'skill'
  ]

  const invalid = await db.select<{ id: number; type: string }[]>(
    `SELECT id, type FROM memories WHERE type NOT IN (${allowedTypes.map(() => '?').join(',')})`,
    allowedTypes
  )

  for (const row of invalid) {
    issues.push({
      table: 'memories',
      column: 'type',
      rowId: row.id,
      dataType: 'BUSINESS_RULE_VIOLATION',
      severity: 'low',
      description: `记忆 ${row.id} 的类型 "${row.type}" 不在允许范围内`,
      detectedAt: Date.now(),
      resolved: false,
    })
  }

  return issues
}

/**
 * 检测约束违反：characters.stats 为空（NOT NULL 违反）
 */
async function checkCharactersNullStats(): Promise<DirtyDataIssue[]> {
  const db = await getDb()
  const issues: DirtyDataIssue[] = []

  const invalid = await db.select<{ id: string }[]>(
    'SELECT id FROM characters WHERE stats IS NULL'
  )

  for (const row of invalid) {
    issues.push({
      table: 'characters',
      column: 'stats',
      rowId: row.id,
      dataType: 'CONSTRAINT_VIOLATION',
      severity: 'high',
      description: `角色 ${row.id} 的 stats 字段违反 NOT NULL 约束`,
      detectedAt: Date.now(),
      resolved: false,
    })
  }

  return issues
}

// ============ 核心功能 ============

/**
 * 运行数据检测，收集所有发现的脏数据问题
 * @returns 检测到的脏数据问题列表
 */
async function detectDirtyData(config: Partial<CheckConfig> = {}): Promise<DirtyDataIssue[]> {
  const cfg = { ...DEFAULT_CHECK_CONFIG, ...config }
  const allIssues: DirtyDataIssue[] = []

  const checkers = [
    checkInventoryOrphans,
    checkMemoriesOrphans,
    checkCharactersInvalidJson,
    checkInventoryNegativeQuantity,
    checkMemoriesInvalidImportance,
    checkMemoriesInvalidType,
    checkCharactersNullStats,
  ]

  for (const checker of checkers) {
    try {
      const issues = await checker()
      allIssues.push(...issues)
      if (allIssues.length >= cfg.maxIssuesPerRun) {
        console.warn(`[DirtyDataTracker] Reached max issues limit (${cfg.maxIssuesPerRun})`)
        break
      }
    } catch (e) {
      console.error('[DirtyDataTracker] Check failed:', e)
    }
  }

  return allIssues
}

/**
 * 执行数据质量检测并持久化结果
 * 这是主要的公开接口，在应用启动时可调用
 *
 * @param config 检测配置
 * @returns 检测报告
 */
export async function runDirtyDataChecks(
  config: Partial<CheckConfig> = {}
): Promise<DirtyDataReport> {
  const cfg = { ...DEFAULT_CHECK_CONFIG, ...config }
  const now = Date.now()

  // 1. 确保表存在
  await ensureDirtyDataTable()

  // 2. 执行检测
  const issues = await detectDirtyData(cfg)

  // 3. 持久化问题
  for (const issue of issues) {
    await persistIssue(issue)
  }

  // 4. 标记已修复的问题（之前记录但现在检测不到了）
  await markAutoResolvedIssues(issues, now)

  // 5. 统计结果
  const result = await computeReport()

  // 6. 高优先级问题写入审计日志
  if (cfg.auditHighSeverity) {
    const highSeverityIssues = issues.filter(
      i => i.severity === 'high' || i.severity === 'critical'
    )
    if (highSeverityIssues.length > 0) {
      try {
        await auditLog(
          AuditEventType.SECURITY_EVENT,
          `检测到 ${highSeverityIssues.length} 条严重脏数据问题：${highSeverityIssues[0].description}`,
          'dirty-data-detector'
        )
      } catch {
        // 审计日志失败不阻断
      }
    }
  }

  return result
}

/**
 * 标记已自动修复的问题（之前检测到但现在不再被认为是问题）
 */
async function markAutoResolvedIssues(
  currentIssues: DirtyDataIssue[],
  now: number
): Promise<number> {
  const db = await getDb()

  // 获取当前未解决的所有问题
  const openIssues = await db.select<{ id: number; table_name: string; row_id: string; data_type: string }[]>(
    'SELECT id, table_name, row_id, data_type FROM dirty_data_registry WHERE resolved = 0'
  )

  let resolvedCount = 0
  for (const open of openIssues) {
    // 检查当前问题列表中是否还有这条记录
    const stillExists = currentIssues.some(
      i => i.table === open.table_name &&
           i.rowId?.toString() === (open.row_id ?? '') &&
           i.dataType === open.data_type
    )
    if (!stillExists) {
      await db.execute(
        'UPDATE dirty_data_registry SET resolved = 1, resolved_at = ? WHERE id = ?',
        [now, open.id]
      )
      resolvedCount++
    }
  }

  return resolvedCount
}

/**
 * 计算当前检测报告
 */
async function computeReport(): Promise<DirtyDataReport> {
  const db = await getDb()

  // 统计各类型问题数量
  const byType = await db.select<{ data_type: string; cnt: number }[]>(
    'SELECT data_type, COUNT(*) as cnt FROM dirty_data_registry WHERE resolved = 0 GROUP BY data_type'
  )

  const bySeverity = await db.select<{ severity: string; cnt: number }[]>(
    'SELECT severity, COUNT(*) as cnt FROM dirty_data_registry WHERE resolved = 0 GROUP BY severity'
  )

  // 获取最近检测的问题
  const recentIssues = await db.select<{
    id: number; table_name: string; column_name: string | null; row_id: string | null;
    data_type: string; severity: string; description: string; detected_at: number;
    resolved: number; resolved_at: number | null; details: string | null;
  }[]>(
    `SELECT * FROM dirty_data_registry WHERE resolved = 0
     ORDER BY detected_at DESC LIMIT 50`
  )

  const report: DirtyDataReport = {
    totalIssues: 0,
    byType: {
      ORPHAN_REFERENCE: 0,
      CONSTRAINT_VIOLATION: 0,
      DATA_TYPE_MISMATCH: 0,
      BUSINESS_RULE_VIOLATION: 0,
      DUPLICATE_ENTRY: 0,
      INCONSISTENT_STATE: 0,
    },
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
    newIssues: 0,
    resolvedIssues: 0,
    issues: recentIssues.map(r => ({
      id: r.id,
      table: r.table_name,
      column: r.column_name ?? undefined,
      rowId: r.row_id ?? undefined,
      dataType: r.data_type as DirtyDataType,
      severity: r.severity as DirtyDataSeverity,
      description: r.description,
      detectedAt: r.detected_at,
      resolved: r.resolved === 1,
      resolvedAt: r.resolved_at ?? undefined,
      details: r.details ?? undefined,
    })),
  }

  for (const row of byType) {
    if (row.data_type in report.byType) {
      report.byType[row.data_type as DirtyDataType] = row.cnt
    }
  }
  for (const row of bySeverity) {
    if (row.severity in report.bySeverity) {
      report.bySeverity[row.severity as DirtyDataSeverity] = row.cnt
    }
  }

  report.totalIssues = Object.values(report.byType).reduce((a, b) => a + b, 0)
  return report
}

/**
 * 获取脏数据摘要（UI 展示用）
 */
export async function getDirtyDataSummary(): Promise<{
  hasIssues: boolean
  totalIssues: number
  highestSeverity: DirtyDataSeverity | null
  topIssues: Array<{ table: string; severity: DirtyDataSeverity; description: string }>
}> {
  await ensureDirtyDataTable()
  const report = await computeReport()

  // 获取 Top 5 问题
  const topIssues = report.issues.slice(0, 5).map(i => ({
    table: i.table,
    severity: i.severity,
    description: i.description,
  }))

  const severityOrder: DirtyDataSeverity[] = ['low', 'medium', 'high', 'critical']
  let highestSeverity: DirtyDataSeverity | null = null

  for (const sev of severityOrder) {
    if (report.bySeverity[sev] > 0) {
      highestSeverity = sev
    }
  }

  return {
    hasIssues: report.totalIssues > 0,
    totalIssues: report.totalIssues,
    highestSeverity,
    topIssues,
  }
}

/**
 * 手动标记脏数据为已解决
 * 用户在 UI 中确认问题已修复时调用
 */
export async function markDirtyDataResolved(
  issueId: number,
  autoDetected: boolean = false
): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE dirty_data_registry SET resolved = 1, resolved_at = ? WHERE id = ?',
    [Date.now(), issueId]
  )

  // 手动解决记录审计日志
  if (!autoDetected) {
    try {
      await auditLog(
        AuditEventType.SECURITY_EVENT,
        `手动标记脏数据问题 #${issueId} 为已解决`,
        'user'
      )
    } catch {
      // 审计日志失败不阻断
    }
  }
}

/**
 * 批量标记某表的所有脏数据为已解决
 */
export async function markTableResolved(tableName: string): Promise<number> {
  const db = await getDb()
  const result = await db.execute(
    'UPDATE dirty_data_registry SET resolved = 1, resolved_at = ? WHERE table_name = ? AND resolved = 0',
    [Date.now(), tableName]
  )
  return result.rowsAffected ?? 0
}

/**
 * 获取指定表的未解决脏数据
 */
export async function getIssuesForTable(tableName: string): Promise<DirtyDataIssue[]> {
  const db = await getDb()
  const rows = await db.select<{
    id: number; table_name: string; column_name: string | null; row_id: string | null;
    data_type: string; severity: string; description: string; detected_at: number;
    resolved: number; resolved_at: number | null; details: string | null;
  }[]>(
    'SELECT * FROM dirty_data_registry WHERE table_name = ? AND resolved = 0 ORDER BY detected_at DESC',
    [tableName]
  )

  return rows.map(r => ({
    id: r.id,
    table: r.table_name,
    column: r.column_name ?? undefined,
    rowId: r.row_id ?? undefined,
    dataType: r.data_type as DirtyDataType,
    severity: r.severity as DirtyDataSeverity,
    description: r.description,
    detectedAt: r.detected_at,
    resolved: r.resolved === 1,
    resolvedAt: r.resolved_at ?? undefined,
    details: r.details ?? undefined,
  }))
}

/**
 * 清理已解决且超过指定天数的脏数据记录
 * 建议定期调用（每周一次）
 */
export async function cleanupResolvedDirtyData(olderThanDays: number = 30): Promise<number> {
  const db = await getDb()
  const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000

  const result = await db.execute(
    'DELETE FROM dirty_data_registry WHERE resolved = 1 AND resolved_at < ?',
    [threshold]
  )
  return result.rowsAffected ?? 0
}
