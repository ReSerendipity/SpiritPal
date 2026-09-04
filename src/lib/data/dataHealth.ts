/**
 * @file dataHealth.ts
 * @description 数据治理统一入口（P1）
 *
 * 把启动流程缺失的两条治理管线接进生产链路：
 * 1. `runMigrations` — 版本化 Schema 迁移（schema_versions / schema_migration_log）
 * 2. `runDirtyDataChecks` — 6 类脏数据检测（dirty_data_registry）
 *
 * 此前二者均无调用点（只写不读）：迁移框架是死代码、脏检测仅停留在测试。
 * 本模块提供：
 * - `runGovernanceChecks()`：启动时并行执行迁移 + 脏检测，结果广播给 UI
 * - `getDataHealthSnapshot()`：UI 读取上次结果
 * - `subscribeDataHealth(cb)`：UI 订阅结果更新（CustomEvent，跨窗口广播）
 */

import { runMigrations, getUnresolvedFailures } from '@/lib/migrations/schemaRunner'
import {
  runDirtyDataChecks,
  markDirtyDataResolved,
  cleanupResolvedDirtyData,
} from '@/lib/data/dirtyDataTracker'

/** 数据健康快照（UI 展示与诊断用） */
export interface DataHealthSnapshot {
  /** schema 迁移失败数 */
  migrationFailed: number
  /** 当前 schema 版本 */
  schemaVersion: number
  /** 未解决脏数据总数 */
  dirtyTotal: number
  /** 最高严重度（low/medium/high/critical/null） */
  highestSeverity: 'low' | 'medium' | 'high' | 'critical' | null
  /** Top 脏数据问题（含 registry id，供「标记已解决」操作） */
  topIssues: Array<{ id?: number; table: string; severity: string; description: string }>
  /** 本次检查时间戳 */
  checkedAt: number
}

/** 数据健康事件名（跨窗口 UI 订阅） */
export const DATA_HEALTH_EVENT = 'spiritpal:data-health'

let lastSnapshot: DataHealthSnapshot | null = null

/** 获取最近一次健康快照（未检查过返回 null） */
export function getDataHealthSnapshot(): DataHealthSnapshot | null {
  return lastSnapshot
}

/** 在 window 上广播健康事件（非 Tauri/无 window 环境静默跳过） */
function broadcast(snapshot: DataHealthSnapshot): void {
  lastSnapshot = snapshot
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent<DataHealthSnapshot>(DATA_HEALTH_EVENT, { detail: snapshot }))
    } catch {
      // 非浏览器环境（Vitest）静默跳过
    }
  }
}

/** 订阅数据健康事件；返回取消订阅函数 */
export function subscribeDataHealth(cb: (snapshot: DataHealthSnapshot) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => {
    cb((e as CustomEvent<DataHealthSnapshot>).detail)
  }
  window.addEventListener(DATA_HEALTH_EVENT, handler)
  return () => window.removeEventListener(DATA_HEALTH_EVENT, handler)
}

/**
 * 启动时的数据治理检查（幂等，可重复调用用于手动刷新）
 * - 执行所有未应用迁移；迁移失败写入 schema_migration_log
 * - 执行 6 类脏数据检测并持久化到 dirty_data_registry
 * - 结果广播 + 返回快照
 */
export async function runGovernanceChecks(): Promise<DataHealthSnapshot> {
  const [migration, , summary] = await Promise.all([
    runMigrations()
      .then((r) => ({ failed: r.failed, version: r.currentVersion }))
      .catch((err: unknown) => {
        console.error('[DataHealth] 迁移执行异常:', err)
        return { failed: 1, version: 0 }
      }),
    getUnresolvedFailures()
      .then((f) => f.length)
      .catch(() => 0),
    runDirtyDataChecks()
      .then(async (report) => {
        // 顺带清理 30 天前已解决的登记（上限约束，防止 registry 无限增长）
        await cleanupResolvedDirtyData(30).catch(() => 0)
        // 从完整报告推导最高严重度与 Top 问题（带 registry id 供 UI 标记已解决）
        const severityOrder = ['low', 'medium', 'high', 'critical'] as const
        let highest: DataHealthSnapshot['highestSeverity'] = null
        for (const sev of severityOrder) {
          if (report.bySeverity[sev] > 0) highest = sev
        }
        return {
          totalIssues: report.totalIssues,
          highestSeverity: highest,
          topIssues: report.issues.slice(0, 5).map((i) => ({
            id: i.id,
            table: i.table,
            severity: i.severity,
            description: i.description,
          })),
        }
      })
      .catch(() => ({
        totalIssues: 0,
        highestSeverity: null as DataHealthSnapshot['highestSeverity'],
        topIssues: [],
      })),
  ])

  const snapshot: DataHealthSnapshot = {
    migrationFailed: migration.failed,
    schemaVersion: migration.version,
    dirtyTotal: summary.totalIssues,
    highestSeverity: summary.highestSeverity,
    topIssues: summary.topIssues,
    checkedAt: Date.now(),
  }

  if (snapshot.migrationFailed > 0) {
    console.error(
      `[DataHealth] ${snapshot.migrationFailed} 个 Schema 迁移失败（当前 v${snapshot.schemaVersion}），请见 schema_migration_log`,
    )
  }
  if (snapshot.dirtyTotal > 0) {
    console.warn(
      `[DataHealth] 发现 ${snapshot.dirtyTotal} 条未解决脏数据（最高严重度：${snapshot.highestSeverity ?? '无'}）`,
    )
  }

  broadcast(snapshot)
  return snapshot
}

/** 标记指定脏数据问题（ID）为已解决（UI「标记已解决」按钮） */
export async function resolveDirtyIssue(issueId: number): Promise<void> {
  await markDirtyDataResolved(issueId)
  await runDirtyDataChecks() // 刷新登记状态
  await runGovernanceChecks() // 重新广播最新快照
}

/** 迁移失败提示文案（供 UI 展示） */
export function migrationFailureText(failed: number, version: number): string {
  if (failed <= 0) return ''
  return `上次升级有 ${failed} 项 Schema 迁移失败（当前数据库版本 v${version}）。部分新功能可能不可用，可尝试重新迁移或联系支持。`
}