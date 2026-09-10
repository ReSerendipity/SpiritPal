/**
 * updater 模块测试（P0-1.5 / P2-2：更新链路每步可见，失败原因不吞）
 *
 * 覆盖：
 * - checkForUpdates：有更新 / 无更新 / 异常错误透传
 * - downloadAndInstallUpdate：成功阶段回调顺序、进度回调、失败原因、relaunch 失败
 */
import { type Update } from '@tauri-apps/plugin-updater'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============ mocks ============

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.check,
}))
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mocks.relaunch,
}))
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: mocks.sendNotification,
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
}))

import { checkForUpdates, downloadAndInstallUpdate } from '@/lib/system/updater'

function makeUpdate(overrides: Partial<Update> = {}): Update {
  return {
    version: '0.2.0',
    date: '2026-09-10',
    body: 'test release',
    downloadAndInstall: vi.fn(),
    ...overrides,
  } as unknown as Update
}

// ============ checkForUpdates ============

describe('checkForUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should report available with info when update exists', async () => {
    mocks.check.mockResolvedValue(makeUpdate())
    const result = await checkForUpdates()
    expect(result.available).toBe(true)
    expect(result.info?.version).toBe('0.2.0')
    expect(result.error).toBeUndefined()
  })

  it('should report not available when no update', async () => {
    mocks.check.mockResolvedValue(null)
    const result = await checkForUpdates()
    expect(result.available).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('should surface check error instead of swallowing it (报告1 §四-7 不吞错误)', async () => {
    mocks.check.mockRejectedValue(new Error('TLS handshake failed'))
    const result = await checkForUpdates()
    expect(result.available).toBe(false)
    expect(result.error).toContain('TLS handshake failed')
  })
})

// ============ downloadAndInstallUpdate ============

describe('downloadAndInstallUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.relaunch.mockResolvedValue(undefined)
  })

  it('should run phase callbacks in order and relaunch on success', async () => {
    const update = makeUpdate()
    const phases: string[] = []
    const progresses: Array<{ downloaded: number; total: number }> = []
    ;(update.downloadAndInstall as ReturnType<typeof vi.fn>).mockImplementation(
      async (handler: (e: { event: string; data: unknown }) => void) => {
        handler({ event: 'Started', data: { contentLength: 100 } })
        handler({ event: 'Progress', data: { chunkLength: 40 } })
        handler({ event: 'Finished', data: {} })
      },
    )
    mocks.check.mockResolvedValue(update)

    const result = await downloadAndInstallUpdate(
      (p) => progresses.push(p),
      (phase) => phases.push(phase),
    )

    expect(result.success).toBe(true)
    expect(phases).toEqual(['downloading', 'verifying', 'installing', 'restarting'])
    expect(progresses).toEqual([{ downloaded: 40, total: 100 }])
    expect(mocks.relaunch).toHaveBeenCalledTimes(1)
  })

  it('should return error when no update available', async () => {
    mocks.check.mockResolvedValue(null)
    const result = await downloadAndInstallUpdate()
    expect(result.success).toBe(false)
    expect(result.error).toContain('没有可用更新')
  })

  it('should surface download failure reason', async () => {
    mocks.check.mockRejectedValue(new Error('network unreachable'))
    const result = await downloadAndInstallUpdate()
    expect(result.success).toBe(false)
    expect(result.error).toContain('network unreachable')
  })

  it('should surface relaunch failure after install (更新已安装但重启失败)', async () => {
    const update = makeUpdate()
    ;(update.downloadAndInstall as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    mocks.check.mockResolvedValue(update)
    mocks.relaunch.mockRejectedValue(new Error('spawn failed'))

    const result = await downloadAndInstallUpdate()
    expect(result.success).toBe(false)
    expect(result.error).toContain('重启失败')
  })
})
