// modUpdater 纯逻辑测试 — 版本检查 / 下载 / 升级状态机（内存 fake transport）
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ModUpdater,
  type ModUpdaterTransport,
  type ModRegistryEntry,
} from '@/lib/data/modUpdater'

/** 构建记录调用轨迹的 fake transport */
function makeFakeTransport(overrides: Partial<ModUpdaterTransport> = {}) {
  const calls: string[] = []
  const registry: ModRegistryEntry[] = [
    {
      modId: 'test-pet',
      version: '2.0.0',
      downloadUrl: 'https://registry.example.com/test-pet-2.0.0.petmod',
      changelog: '新增动画',
    },
  ]
  const transport: ModUpdaterTransport = {
    async fetchRegistry() {
      calls.push('fetchRegistry')
      return registry
    },
    async downloadPackage() {
      calls.push('downloadPackage')
      return new Blob(['fake-petmod-bytes'], { type: 'application/octet-stream' })
    },
    async saveTempPackage() {
      calls.push('saveTempPackage')
      return '/tmp/update-test-pet.petmod'
    },
    async installPackage() {
      calls.push('installPackage')
      return { modId: 'test-pet', version: '2.0.0' }
    },
    async backupMod(modId) {
      calls.push(`backupMod:${modId}`)
      return `/mods/.backup/${modId}-123456`
    },
    async restoreBackup(backupPath, modId) {
      calls.push(`restoreBackup:${backupPath}:${modId}`)
    },
    async cleanupPath(path) {
      calls.push(`cleanupPath:${path}`)
    },
    ...overrides,
  }
  return { transport, calls }
}

describe('ModUpdater.checkForUpdate', () => {
  it('远程版本严格高于本地版本时报告有更新', async () => {
    const { transport } = makeFakeTransport()
    const updater = new ModUpdater(transport)
    const result = await updater.checkForUpdate('test-pet', '1.0.0')
    expect(result.hasUpdate).toBe(true)
    expect(result.newVersion).toBe('2.0.0')
    expect(result.downloadUrl).toBe('https://registry.example.com/test-pet-2.0.0.petmod')
    expect(result.changelog).toBe('新增动画')
  })

  it('远程版本等于本地版本时无更新', async () => {
    const { transport } = makeFakeTransport()
    const updater = new ModUpdater(transport)
    const result = await updater.checkForUpdate('test-pet', '2.0.0')
    expect(result.hasUpdate).toBe(false)
    expect(result.newVersion).toBe('2.0.0')
  })

  it('远程版本低于本地版本时无更新', async () => {
    const { transport } = makeFakeTransport()
    const updater = new ModUpdater(transport)
    const result = await updater.checkForUpdate('test-pet', '3.0.0')
    expect(result.hasUpdate).toBe(false)
  })

  it('清单中找不到该 modId 时无更新', async () => {
    const { transport } = makeFakeTransport()
    const updater = new ModUpdater(transport)
    const result = await updater.checkForUpdate('not-exists', '1.0.0')
    expect(result.hasUpdate).toBe(false)
    expect(result.newVersion).toBe('1.0.0')
  })

  it('清单请求失败时优雅降级为无更新', async () => {
    const { transport } = makeFakeTransport({
      fetchRegistry: async () => {
        throw new Error('network down')
      },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const updater = new ModUpdater(transport)
    const result = await updater.checkForUpdate('test-pet', '1.0.0')
    expect(result.hasUpdate).toBe(false)
    expect(result.newVersion).toBe('1.0.0')
    warn.mockRestore()
  })
})

describe('ModUpdater.downloadUpdate', () => {
  it('应将下载的 Blob 原样返回', async () => {
    const blob = new Blob(['x'], { type: 'application/octet-stream' })
    const { transport } = makeFakeTransport({
      downloadPackage: async () => blob,
    })
    const updater = new ModUpdater(transport)
    const result = await updater.downloadUpdate('https://example.com/x.petmod')
    expect(result).toBe(blob)
  })
})

describe('ModUpdater.applyUpdate 状态机', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('成功路径：备份 → 临时落盘 → 安装 → 清理，返回 true', async () => {
    const { transport, calls } = makeFakeTransport()
    const updater = new ModUpdater(transport)
    const blob = new Blob(['bytes'])

    const ok = await updater.applyUpdate('test-pet', blob)

    expect(ok).toBe(true)
    // 调用顺序
    expect(calls).toEqual([
      'backupMod:test-pet',
      'saveTempPackage',
      'installPackage',
      'cleanupPath:/tmp/update-test-pet.petmod',
      'cleanupPath:/mods/.backup/test-pet-123456',
    ])
    // 状态转换轨迹
    expect(updater.lastStages).toEqual([
      'backup-start',
      'backup-done',
      'temp-saved',
      'install-start',
      'install-done',
      'cleanup',
    ])
  })

  it('安装失败：自动回滚旧版，返回 false', async () => {
    const { transport, calls } = makeFakeTransport({
      installPackage: async () => {
        throw new Error('bad package')
      },
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const updater = new ModUpdater(transport)

    const ok = await updater.applyUpdate('test-pet', new Blob(['bytes']))

    expect(ok).toBe(false)
    // 回滚被调用
    expect(calls).toContain('restoreBackup:/mods/.backup/test-pet-123456:test-pet')
    // 临时文件仍被清理
    expect(calls).toContain('cleanupPath:/tmp/update-test-pet.petmod')
    expect(updater.lastStages).toContain('rollback')
    expect(updater.lastStages).toContain('failed')
    errorLog.mockRestore()
  })

  it('安装包 modId 不匹配时视为失败并回滚', async () => {
    const { transport } = makeFakeTransport({
      installPackage: async () => ({ modId: 'wrong-id', version: '9.9.9' }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const updater = new ModUpdater(transport)

    const ok = await updater.applyUpdate('test-pet', new Blob(['bytes']))

    expect(ok).toBe(false)
    expect(updater.lastStages).toContain('rollback')
  })

  it('备份前无旧版（backupMod 抛错）时直接失败，不触碰安装', async () => {
    const { transport, calls } = makeFakeTransport({
      backupMod: async () => {
        throw new Error('no old version')
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const updater = new ModUpdater(transport)

    const ok = await updater.applyUpdate('test-pet', new Blob(['bytes']))

    expect(ok).toBe(false)
    expect(calls).not.toContain('installPackage')
    expect(updater.lastStages).toEqual(['backup-start', 'failed'])
  })
})
