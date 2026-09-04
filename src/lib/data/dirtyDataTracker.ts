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
 * D-1 收口：检测逻辑（静态 SQL + 白名单）已下沉 Rust `sp_dirty_scan`，
 * 本模块只负责「扫描 → 持久化 → 统计 → 解决/清理」的编排。
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
import {
  scanDirtyData,
  listDirtyIssues,
  upsertDirtyIssue,
  resolveDirtyIssue,
  resolveDirtyIssuesForTable,
  cleanupResolvedDirtyData as dbCleanupResolvedDirtyData,
  type DirtyRegistryRow,
} from './db'

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

// ============ 持久化映射（DirtyDataIssue ↔ dirty_data_registry） ============

const TARGET_SEP = '::'

function issueToTargetId(issue: DirtyDataIssue): string {
  return `${issue.table}${TARGET_SEP}${issue.rowId?.toString() ?? ''}`
}

function issueToPayload(issue: DirtyDataIssue): string {
  return JSON.stringify({
    table: issue.table,
    column: issue.column ?? null,
    severity: issue.severity,
    description: issue.description,
    details: issue.details ?? null,
  })
}

function rowToIssue(r: DirtyRegistryRow): DirtyDataIssue {
  const sep = r.target_id.indexOf(TARGET_SEP)
  const table = sep >= 0 ? r.target_id.slice(0, sep) : r.target_id
  const rowId = sep >= 0 ? r.target_id.slice(sep + TARGET_SEP.length) : ''
  let payload: {
    table?: string
    column?: string | null
    severity?: string
    description?: string
    details?: string | null
  } = {}
  try {
    if (r.payload) payload = JSON.parse(r.payload) ?? {}
  } catch {
    payload = {}
  }
  return {
    id: r.id,
    table: payload.table ?? table,
    column: payload.column ?? undefined,
    rowId: rowId || undefined,
    dataType: r.kind as DirtyDataType,
    severity: (payload.severity as DirtyDataSeverity) ?? 'medium',
    description: payload.description ?? '',
    detectedAt: r.detected_at,
    resolved: r.resolved_at != null,
    resolvedAt: r.resolved_at ?? undefined,
    details: payload.details ?? undefined,
  }
}

// ============ 基础设施 ============

/**
 * 确保脏数据注册表存在（结构已由 Rust ensure_schema 幂等创建）。
 * 前端不再执行任何 DDL，本函数为兼容保留的无操作。
 */
async function ensureDirtyDataTable(): Promise<void> {
  return
}

/**
 * 写入脏数据问题（幂等：同 table+row+type 不重复插入）
 */
async function persistIssue(issue: DirtyDataIssue): Promise<void> {
  await upsertDirtyIssue(issue.dataType, issueToTargetId(issue), issueToPayload(issue), issue.detectedAt)
}

// ============ 核心功能 ============

/**
 * 运行数据检测，收集所有发现的脏数据问题
 * 检测由 Rust `sp_dirty_scan`（静态 SQL）执行
 * @returns 检测到的脏数据问题列表
 */
async function detectDirtyData(config: Partial<CheckConfig> = {}): Promise<DirtyDataIssue[]> {
  const cfg = { ...DEFAULT_CHECK_CONFIG, ...config }
  const discovered = await scanDirtyData()
  const allIssues: DirtyDataIssue[] = discovered.slice(0, cfg.maxIssuesPerRun).map((d) => ({
    table: d.table,
    column: d.column,
    rowId: d.rowId,
    dataType: d.dataType as DirtyDataType,
    severity: d.severity as DirtyDataSeverity,
    description: d.description,
    details: d.details,
    detectedAt: d.detectedAt,
    resolved: false,
  }))
  if (discovered.length > cfg.maxIssuesPerRun) {
    console.warn(`[DirtyDataTracker] Reached max issues limit (${cfg.maxIssuesPerRun})`)
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
  const issues: DirtyDataIssue[] = []

  // 1. 确保表存在（Rust 已建，no-op）
  await ensureDirtyDataTable()

  // 2. 执行检测（Rust sp_dirty_scan）
  const detected = await detectDirtyData(cfg)
  issues.push(...detected)

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
  const all = await listDirtyIssues()
  // 仅处理未解决（resolved_at IS NULL）
  const openIssues = all.filter((r) => r.resolved_at == null)

  let resolvedCount = 0
  for (const open of openIssues) {
    const issue = rowToIssue(open)
    // 检查当前问题列表中是否还有这条记录
    const stillExists = currentIssues.some(
      i => i.table === issue.table &&
           i.rowId?.toString() === (issue.rowId?.toString() ?? '') &&
           i.dataType === issue.dataType
    )
    if (!stillExists) {
      await resolveDirtyIssue(open.id, now)
      resolvedCount++
    }
  }

  return resolvedCount
}

/**
 * 计算当前检测报告
 */
async function computeReport(): Promise<DirtyDataReport> {
  const all = await listDirtyIssues()
  const openRows = all.filter((r) => r.resolved_at == null)
  const openIssues = openRows.map(rowToIssue)

  const byType: Record<DirtyDataType, number> = {
    ORPHAN_REFERENCE: 0,
    CONSTRAINT_VIOLATION: 0,
    DATA_TYPE_MISMATCH: 0,
    BUSINESS_RULE_VIOLATION: 0,
    DUPLICATE_ENTRY: 0,
    INCONSISTENT_STATE: 0,
  }
  const bySeverity: Record<DirtyDataSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 }

  for (const issue of openIssues) {
    if (issue.dataType in byType) byType[issue.dataType]++
    if (issue.severity in bySeverity) bySeverity[issue.severity]++
  }

  const report: DirtyDataReport = {
    totalIssues: openIssues.length,
    byType,
    bySeverity,
    newIssues: openRows.filter((r) => r.detected_at > Date.now() - 24 * 3600 * 1000).length,
    resolvedIssues: all.length - openIssues.length,
    issues: openIssues.slice(0, 50),
  }

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
  await resolveDirtyIssue(issueId, Date.now())

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
  return resolveDirtyIssuesForTable(tableName, Date.now())
}

/**
 * 获取指定表的未解决脏数据
 */
export async function getIssuesForTable(tableName: string): Promise<DirtyDataIssue[]> {
  const all = await listDirtyIssues()
  const prefix = `${tableName}${TARGET_SEP}`
  return all
    .filter((r) => r.resolved_at == null && r.target_id.startsWith(prefix))
    .map(rowToIssue)
}

/**
 * 清理已解决且超过指定天数的脏数据记录
 * 建议定期调用（每周一次）
 */
export async function cleanupResolvedDirtyData(olderThanDays: number = 30): Promise<number> {
  const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  return dbCleanupResolvedDirtyData(threshold)
}