/**
 * @file zombieDataCleanup.test.ts
 * @description 僵尸数据清理器单测（B-3）
 *
 * 覆盖契约：
 *  1. getZombieDataReport 只读统计（.legacy / context_episodes / entity_nodes）
 *  2. 普通清理只处理「有真实时间戳且超保留期」的 legacy（updated_at=0 不自动删）
 *  3. forceLegacyCleanup 强制清理全部 legacy（含无时间戳旧行）
 *  4. autoCleanupIfDue 每天最多执行一次
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  cleanupZombieData,
  getZombieDataReport,
  autoCleanupIfDue,
} from '../zombieDataCleanup'

const mockGetDb = vi.fn()
const mockGetSetting = vi.fn()
const mockSetSetting = vi.fn()

vi.mock('../db', () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
  removeSetting: vi.fn(),
}))

vi.mock('../auditLogger', () => ({
  auditLog: vi.fn(() => Promise.resolve()),
  AuditEventType: { SECURITY_EVENT: 'security_event' },
}))

interface MockDb {
  select: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
}

/** 构造 mock db：select 按 SQL 特征分派（顺序敏感：SELECT key 必须先于 SELECT value） */
function makeDb(): MockDb {
  return {
    select: vi.fn(async (sql: string) => {
      if (sql.includes('MIN(CASE WHEN updated_at > 0')) {
        return [{ count: 2, oldest: 1750000000000 }]
      }
      if (sql.includes('SELECT key FROM settings')) {
        return [{ key: 'spiritpal-enhanced-memory-char-a.legacy' }]
      }
      if (sql.includes('SELECT value FROM settings')) {
        return [{ value: 'ENC2:abc'.repeat(10) }, { value: 'ENC2:def'.repeat(10) }]
      }
      if (sql.includes('FROM context_episodes') && sql.includes('COUNT')) {
        return [{ count: 3 }]
      }
      if (sql.includes('FROM entity_nodes') && sql.includes('COUNT')) {
        return [{ count: 1 }]
      }
      return []
    }),
    execute: vi.fn(async () => ({ rowsAffected: 1 })),
  }
}

let db: MockDb

beforeEach(() => {
  vi.clearAllMocks()
  db = makeDb()
  mockGetDb.mockResolvedValue(db)
})

describe('getZombieDataReport', () => {
  it('汇总 legacy / episodes / entities 三类统计', async () => {
    const report = await getZombieDataReport()

    expect(report.legacyBlobCount).toBe(2)
    expect(report.legacyBlobOldest).toBe(1750000000000)
    expect(report.expiredEpisodeCount).toBe(3)
    expect(report.expiredEntityCount).toBe(1)
    // 每条 value 80 字符 × 2 条
    expect(report.totalEstimatedBytes).toBe(160)
  })

  it('legacyBlobOldest 忽略 updated_at=0 的旧行', async () => {
    db.select.mockImplementation(async (sql: string) => {
      if (sql.includes('MIN(CASE WHEN updated_at > 0')) {
        return [{ count: 1, oldest: null }]
      }
      if (sql.includes('FROM context_episodes') && sql.includes('COUNT')) return [{ count: 0 }]
      if (sql.includes('FROM entity_nodes') && sql.includes('COUNT')) return [{ count: 0 }]
      if (sql.includes('SELECT value FROM settings')) return [{ value: '' }]
      return []
    })

    const report = await getZombieDataReport()
    expect(report.legacyBlobCount).toBe(1)
    expect(report.legacyBlobOldest).toBeNull()
  })
})

describe('cleanupZombieData', () => {
  it('普通清理只删除带时间戳且超期的 legacy', async () => {
    await cleanupZombieData()

    const legacySelectCall = (db.select.mock.calls as string[][]).find(
      (c) => c[0].includes('SELECT key FROM settings') && c[0].includes('%.legacy'),
    )
    expect(legacySelectCall).toBeTruthy()
    expect(legacySelectCall![0]).toContain('updated_at > 0 AND updated_at < ?')
  })

  it('forceLegacyCleanup 跳过时间戳守卫', async () => {
    await cleanupZombieData({ forceLegacyCleanup: true })

    const legacySelectCall = (db.select.mock.calls as string[][]).find(
      (c) => c[0].includes('SELECT key FROM settings') && c[0].includes('%.legacy'),
    )
    expect(legacySelectCall).toBeTruthy()
    expect(legacySelectCall![0]).toContain('1=1')
  })

  it('清理后返回各类计数', async () => {
    const result = await cleanupZombieData({ forceLegacyCleanup: true })

    expect(result.cleanedLegacyBlobs).toBe(1)
    expect(result.cleanedEpisodes).toBe(1)
    expect(result.cleanedEntities).toBe(1)
    expect(result.totalCleaned).toBe(3)
    expect(result.errors).toEqual([])
  })
})

describe('autoCleanupIfDue', () => {
  it('距离上次清理超过 24h 才执行，并记录时间', async () => {
    mockGetSetting.mockResolvedValueOnce(String(Date.now() - 25 * 60 * 60 * 1000))

    const { executed, result } = await autoCleanupIfDue()

    expect(executed).toBe(true)
    expect(result).toBeTruthy()
    expect(mockSetSetting).toHaveBeenCalledWith(
      'spiritpal-last-zombie-cleanup',
      expect.any(String),
    )
  })

  it('24h 内不重复执行', async () => {
    mockGetSetting.mockResolvedValueOnce(String(Date.now() - 1000))

    const { executed } = await autoCleanupIfDue()

    expect(executed).toBe(false)
    expect(mockSetSetting).not.toHaveBeenCalled()
  })
})
