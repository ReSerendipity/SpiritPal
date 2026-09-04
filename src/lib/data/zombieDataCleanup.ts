/**
 * 僵尸数据清理器 — 自动清理过期遗留数据
 *
 * @module zombieDataCleanup
 * @description
 * 清理以下类型的僵尸数据：
 * 1. settings 表中 .legacy 后缀的 JSON blob（记忆迁移遗留副本）
 * 2. settings 表中过期的迁移标记（如 spiritpal-memory-migrated-v2）
 * 3. 已过期的 context_episodes 快照（滑动窗口之外的旧数据）
 * 4. 孤立的 entity_nodes（最后一次提及超过 90 天）
 *
 * 清理策略：
 * - .legacy blob：迁移成功后保留 7 天（用于回滚），之后自动清理
 * - 迁移标记：永久保留（用于防止重复迁移）
 * - context_episodes：保留最近 7 天
 * - entity_nodes：last_seen 超过 90 天的非核心实体
 *
 * 安全机制：
 * - 每次清理前记录审计日志
 * - 清理条目数上限（每次最多 100 条，防止长时间阻塞）
 * - 清理结果返回给调用方确认
 *
 * @example
 * ```ts
 * import { cleanupZombieData, getZombieDataReport } from './zombieDataCleanup'
 *
 * // 获取僵尸数据报告（不清理）
 * const report = await getZombieDataReport()
 * console.log(`Legacy blobs: ${report.legacyBlobCount}`)
 *
 *  // 执行清理
 * const result = await cleanupZombieData()
 * console.log(`Cleaned ${result.totalCleaned} zombie entries`)
 * ```
 */

import { auditLog, AuditEventType } from '@/lib/system/auditLogger'
import {
  getSetting,
  setSetting,
  getZombieReport,
  zombieCleanupLegacy,
  zombieCleanupEpisodes,
  zombieCleanupEntities,
} from './db'

/** 清理配置 */
interface CleanupConfig {
  /** .legacy blob 保留天数 */
  legacyBlobRetentionDays: number
  /** context_episodes 保留天数 */
  contextEpisodeRetentionDays: number
  /** entity_nodes 过期天数 */
  entityNodeExpirationDays: number
  /** 每次清理最大条目数 */
  maxEntriesPerRun: number
  /** 强制清理全部 .legacy（含无时间戳的旧行），供用户手动触发使用 */
  forceLegacyCleanup?: boolean
}

/** 默认清理配置 */
const DEFAULT_CONFIG: CleanupConfig = {
  legacyBlobRetentionDays: 7,
  contextEpisodeRetentionDays: 7,
  entityNodeExpirationDays: 90,
  maxEntriesPerRun: 100,
}

/** 僵尸数据报告 */
export interface ZombieDataReport {
  legacyBlobCount: number
  legacyBlobOldest: number | null
  expiredEpisodeCount: number
  expiredEntityCount: number
  totalEstimatedBytes: number
}

/** 清理结果 */
export interface CleanupResult {
  cleanedLegacyBlobs: number
  cleanedEpisodes: number
  cleanedEntities: number
  errors: string[]
  totalCleaned: number
}

/**
 * 获取僵尸数据报告（只读，不清理）
 */
export async function getZombieDataReport(config: Partial<CleanupConfig> = {}): Promise<ZombieDataReport> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const now = Date.now()
  const episodeThreshold = now - cfg.contextEpisodeRetentionDays * 24 * 60 * 60 * 1000
  const entityThreshold = now - cfg.entityNodeExpirationDays * 24 * 60 * 60 * 1000

  const report = await getZombieReport(episodeThreshold, entityThreshold)

  return {
    legacyBlobCount: report.legacyCount,
    legacyBlobOldest: report.legacyOldest,
    expiredEpisodeCount: report.episodeCount,
    expiredEntityCount: report.entityCount,
    totalEstimatedBytes: report.bytes,
  }
}

/**
 * 清理 .legacy 后缀的 JSON blob
 * 仅清理超过保留期的 blob
 */
async function cleanupLegacyBlobs(config: CleanupConfig): Promise<number> {
  // .legacy blob 的 updated_at 是 blob 写入时间（即迁移时间）
  const threshold = Date.now() - config.legacyBlobRetentionDays * 24 * 60 * 60 * 1000
  return zombieCleanupLegacy(threshold, config.forceLegacyCleanup ?? false, config.maxEntriesPerRun)
}

/**
 * 清理过期的 context_episodes
 */
async function cleanupExpiredEpisodes(config: CleanupConfig): Promise<number> {
  const threshold = Date.now() - config.contextEpisodeRetentionDays * 24 * 60 * 60 * 1000
  try {
    return await zombieCleanupEpisodes(threshold, config.maxEntriesPerRun)
  } catch (e) {
    console.warn('[ZombieCleanup] Failed to cleanup expired episodes:', e)
    return 0
  }
}

/**
 * 清理过期的 entity_nodes（低提及频率 + 长期未出现）
 */
async function cleanupExpiredEntities(config: CleanupConfig): Promise<number> {
  const threshold = Date.now() - config.entityNodeExpirationDays * 24 * 60 * 60 * 1000
  try {
    return await zombieCleanupEntities(threshold, config.maxEntriesPerRun)
  } catch (e) {
    console.warn('[ZombieCleanup] Failed to cleanup expired entities:', e)
    return 0
  }
}

/**
 * 执行僵尸数据清理（安全模式）
 *
 * 清理策略：
 * 1. 优先清理 .legacy blob（最直接的空间回收）
 * 2. 清理过期上下文快照（减少表膨胀）
 * 3. 清理低频过期实体（减少知识图谱噪音）
 *
 * @param config 清理配置（可选，使用默认值）
 * @returns 清理结果
 */
export async function cleanupZombieData(
  config: Partial<CleanupConfig> = {},
): Promise<CleanupResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const errors: string[] = []
  let cleanedBlobs = 0
  let cleanedEpisodes = 0
  let cleanedEntities = 0

  // 1. 清理 .legacy blob
  try {
    cleanedBlobs = await cleanupLegacyBlobs(cfg)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`Legacy blob cleanup failed: ${msg}`)
  }

  // 2. 清理过期 context_episodes
  try {
    cleanedEpisodes = await cleanupExpiredEpisodes(cfg)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`Episode cleanup failed: ${msg}`)
  }

  // 3. 清理过期 entity_nodes
  try {
    cleanedEntities = await cleanupExpiredEntities(cfg)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`Entity cleanup failed: ${msg}`)
  }

  const totalCleaned = cleanedBlobs + cleanedEpisodes + cleanedEntities

  // 记录审计日志
  if (totalCleaned > 0) {
    try {
      await auditLog(
        AuditEventType.SECURITY_EVENT,
        `Zombie data cleanup: ${cleanedBlobs} legacy blobs, ${cleanedEpisodes} episodes, ${cleanedEntities} entities cleaned`,
        'system',
      )
    } catch {
      // 审计日志失败不阻断清理
    }
  }

  return {
    cleanedLegacyBlobs: cleanedBlobs,
    cleanedEpisodes: cleanedEpisodes,
    cleanedEntities: cleanedEntities,
    errors,
    totalCleaned,
  }
}

/**
 * 检查上次清理时间，判断是否需要执行清理
 * 建议每天最多执行一次
 */
export async function shouldRunCleanup(): Promise<boolean> {
  try {
    const lastCleanup = await getSetting('spiritpal-last-zombie-cleanup')
    if (!lastCleanup) return true

    const lastTime = parseInt(lastCleanup, 10)
    if (isNaN(lastTime)) return true

    // 距离上次清理超过 24 小时
    return Date.now() - lastTime > 24 * 60 * 60 * 1000
  } catch {
    return true
  }
}

/**
 * 记录清理执行时间
 */
async function recordCleanupTime(): Promise<void> {
  try {
    await setSetting('spiritpal-last-zombie-cleanup', Date.now().toString())
  } catch {
    // 记录失败不影响清理
  }
}

/**
 * 自动清理入口（应在应用启动时调用）
 * 内置频率控制，每天最多执行一次
 *
 * @returns 是否执行了清理，以及清理结果
 */
export async function autoCleanupIfDue(): Promise<{
  executed: boolean
  result?: CleanupResult
}> {
  if (!(await shouldRunCleanup())) {
    return { executed: false }
  }

  const result = await cleanupZombieData()
  await recordCleanupTime()

  return { executed: true, result }
}
