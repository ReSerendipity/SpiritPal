/**
 * @file zombieDataCleanup.test.ts
 * @description 僵尸数据清理器单测（B-3）
 *
 * 覆盖契约：
 *  1. getZombieDataReport 只读统计（.legacy / context_episodes / entity_nodes）
 *  2. 普通清理走非 force 分支（保留时间戳守卫）
 *  3. forceLegacyCleanup 走 force 分支（清无时间戳旧行）
 *  4. autoCleanupIfDue 每天最多执行一次
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getZombieReport: vi.fn(),
  zombieCleanupLegacy: vi.fn(),
  zombieCleanupEpisodes: vi.fn(),
  zombieCleanupEntities: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}))

vi.mock('@/lib/data/db', () => mocks)

vi.mock('@/lib/system/auditLogger', () => ({
  auditLog: vi.fn(() => Promise.resolve()),
  AuditEventType: { SECURITY_EVENT: 'security_event' },
}))

import {
  cleanupZombieData,
  getZombieDataReport,
  autoCleanupIfDue,
} from '@/lib/data/zombieDataCleanup'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getZombieReport.mockResolvedValue({
    legacyCount: 0,
    legacyOldest: null,
    episodeCount: 0,
    entityCount: 0,
    bytes: 0,
  })
  mocks.zombieCleanupLegacy.mockResolvedValue(0)
  mocks.zombieCleanupEpisodes.mockResolvedValue(0)
  mocks.zombieCleanupEntities.mockResolvedValue(0)
})

describe('getZombieDataReport', () => {
  it('汇总 legacy / episodes / entities 三类统计', async () => {
    mocks.getZombieReport.mockResolvedValueOnce({
      legacyCount: 2,
      legacyOldest: 1750000000000,
      episodeCount: 3,
      entityCount: 1,
      bytes: 160,
    })

    const report = await getZombieDataReport()

    expect(report.legacyBlobCount).toBe(2)
    expect(report.legacyBlobOldest).toBe(1750000000000)
    expect(report.expiredEpisodeCount).toBe(3)
    expect(report.expiredEntityCount).toBe(1)
    expect(report.totalEstimatedBytes).toBe(160)
    // Rust 端已把 updated_at=0 的旧行排除在 oldest 之外
    expect(mocks.getZombieReport).toHaveBeenCalledWith(expect.any(Number), expect.any(Number))
  })

  it('legacyBlobOldest 为 null 时透传', async () => {
    mocks.getZombieReport.mockResolvedValueOnce({
      legacyCount: 1,
      legacyOldest: null,
      episodeCount: 0,
      entityCount: 0,
      bytes: 0,
    })

    const report = await getZombieDataReport()
    expect(report.legacyBlobCount).toBe(1)
    expect(report.legacyBlobOldest).toBeNull()
  })
})

describe('cleanupZombieData', () => {
  it('普通清理走非 force 分支（保留时间戳守卫）', async () => {
    await cleanupZombieData()

    expect(mocks.zombieCleanupLegacy).toHaveBeenCalledWith(expect.any(Number), false, 100)
  })

  it('forceLegacyCleanup 走 force 分支', async () => {
    await cleanupZombieData({ forceLegacyCleanup: true })

    expect(mocks.zombieCleanupLegacy).toHaveBeenCalledWith(expect.any(Number), true, 100)
  })

  it('清理后返回各类计数', async () => {
    mocks.zombieCleanupLegacy.mockResolvedValueOnce(1)
    mocks.zombieCleanupEpisodes.mockResolvedValueOnce(1)
    mocks.zombieCleanupEntities.mockResolvedValueOnce(1)

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
    mocks.getSetting.mockResolvedValueOnce(String(Date.now() - 25 * 60 * 60 * 1000))

    const { executed, result } = await autoCleanupIfDue()

    expect(executed).toBe(true)
    expect(result).toBeTruthy()
    expect(mocks.setSetting).toHaveBeenCalledWith(
      'spiritpal-last-zombie-cleanup',
      expect.any(String),
    )
  })

  it('24h 内不重复执行', async () => {
    mocks.getSetting.mockResolvedValueOnce(String(Date.now() - 1000))

    const { executed } = await autoCleanupIfDue()

    expect(executed).toBe(false)
    expect(mocks.setSetting).not.toHaveBeenCalled()
  })
})