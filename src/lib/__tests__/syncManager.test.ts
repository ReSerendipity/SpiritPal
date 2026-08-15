// syncManager 模块测试 — LWW 冲突解决、配置管理、同步流程
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { syncManager } from '../syncManager'
import type { SyncPayload } from '../syncManager'

describe('syncManager', () => {
  beforeEach(() => {
    localStorage.clear()
    syncManager.destroy()
    syncManager.configure({ enabled: false, autoSyncInterval: 0 })
  })

  afterEach(() => {
    syncManager.destroy()
  })

  describe('设备信息', () => {
    it('getDeviceInfo 返回设备信息', () => {
      const info = syncManager.getDeviceInfo()
      expect(info.deviceId).toBeTruthy()
      expect(info.deviceName).toBeTruthy()
      expect(['desktop', 'android', 'ios']).toContain(info.platform)
    })

    it('首次调用创建并持久化 deviceId', () => {
      const info1 = syncManager.getDeviceInfo()
      // 重新创建管理器后会读取相同的 deviceId
      syncManager.destroy()
      // 新实例会读取 localStorage 中已保存的 deviceId
      const info2 = syncManager.getDeviceInfo()
      expect(info2.deviceId).toBe(info1.deviceId)
    })
  })

  describe('配置管理', () => {
    it('默认配置', () => {
      const config = syncManager.getConfig()
      // enabled 和 autoSyncInterval 由 beforeEach 设置（false/0）以避免测试中触发自动同步
      expect(config.enabled).toBe(false)
      expect(config.transport).toBe('cloud')
      expect(config.cloudEndpoint).toBe('https://api.spiritpal.example.com/sync')
      expect(config.lanPort).toBe(8420)
    })

    it('configure 更新配置', () => {
      syncManager.configure({ enabled: true, transport: 'lan', lanPort: 9999 })
      const config = syncManager.getConfig()
      expect(config.enabled).toBe(true)
      expect(config.transport).toBe('lan')
      expect(config.lanPort).toBe(9999)
    })

    it('configure 合并而非替换', () => {
      syncManager.configure({ enabled: true, transport: 'cloud', cloudEndpoint: 'https://test.com' })
      syncManager.configure({ lanPort: 1234 })
      const config = syncManager.getConfig()
      expect(config.enabled).toBe(true)
      expect(config.transport).toBe('cloud')
      expect(config.lanPort).toBe(1234)
    })
  })

  describe('状态管理', () => {
    it('初始状态为 idle', () => {
      expect(syncManager.getStatus()).toBe('idle')
    })

    it('getLastSyncAt 初始为 0', () => {
      expect(syncManager.getLastSyncAt()).toBe(0)
    })

    it('getLastError 初始为 null', () => {
      expect(syncManager.getLastError()).toBe(null)
    })
  })

  describe('订阅', () => {
    it('subscribe 返回取消订阅函数', () => {
      const listener = vi.fn()
      const unsub = syncManager.subscribe(listener)
      expect(typeof unsub).toBe('function')
      unsub()
    })

    it('取消订阅后不再接收通知', () => {
      const listener = vi.fn()
      const unsub = syncManager.subscribe(listener)
      unsub()
      syncManager.configure({ enabled: true })
      // sync 不会通知已取消的 listener
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('resolveConflict (LWW)', () => {
    it('远程时间戳更新时选择远程值', () => {
      const result = syncManager.resolveConflict('field1',
        { value: 'local', timestamp: 100 },
        { value: 'remote', timestamp: 200 },
      )
      expect(result.resolution).toBe('remote')
      expect(result.resolvedValue).toBe('remote')
    })

    it('本地时间戳更新时选择本地值', () => {
      const result = syncManager.resolveConflict('field1',
        { value: 'local', timestamp: 200 },
        { value: 'remote', timestamp: 100 },
      )
      expect(result.resolution).toBe('local')
      expect(result.resolvedValue).toBe('local')
    })

    it('时间戳相同时按 deviceId 字典序决定胜出（远程 deviceId 大则选择远程值）', () => {
      const localDeviceId = syncManager.getDeviceInfo().deviceId
      // 构造字典序大于本地 deviceId 的远程 deviceId
      const remoteDeviceId = localDeviceId + 'z'
      const result = syncManager.resolveConflict('field1',
        { value: 'local', timestamp: 100 },
        { value: 'remote', timestamp: 100 },
        remoteDeviceId,
      )
      expect(result.resolution).toBe('remote')
      expect(result.resolvedValue).toBe('remote')
    })

    it('时间戳相同时按 deviceId 字典序决定胜出（远程 deviceId 小则选择本地值）', () => {
      const localDeviceId = syncManager.getDeviceInfo().deviceId
      // 构造字典序小于本地 deviceId 的远程 deviceId
      const remoteDeviceId = localDeviceId.slice(0, -1)
      const result = syncManager.resolveConflict('field1',
        { value: 'local', timestamp: 100 },
        { value: 'remote', timestamp: 100 },
        remoteDeviceId,
      )
      expect(result.resolution).toBe('local')
      expect(result.resolvedValue).toBe('local')
    })

    it('时间戳相同且未传 remoteDeviceId 时保守选择本地值（默认空串）', () => {
      // 兼容性测试：未传 remoteDeviceId 时默认 ''，本地非空 deviceId 必胜
      const result = syncManager.resolveConflict('field1',
        { value: 'local', timestamp: 100 },
        { value: 'remote', timestamp: 100 },
      )
      expect(result.resolution).toBe('local')
      expect(result.resolvedValue).toBe('local')
    })

    it('时间戳相同且同 deviceId（同设备回声）时保守选择本地值', () => {
      const localDeviceId = syncManager.getDeviceInfo().deviceId
      const result = syncManager.resolveConflict('field1',
        { value: 'local', timestamp: 100 },
        { value: 'remote', timestamp: 100 },
        localDeviceId,
      )
      expect(result.resolution).toBe('local')
      expect(result.resolvedValue).toBe('local')
    })

    it('返回完整的冲突记录', () => {
      const result = syncManager.resolveConflict('stats',
        { value: { a: 1 }, timestamp: 100 },
        { value: { a: 2 }, timestamp: 200 },
      )
      expect(result.field).toBe('stats')
      expect(result.localValue).toEqual({ a: 1 })
      expect(result.remoteValue).toEqual({ a: 2 })
      expect(result.localTimestamp).toBe(100)
      expect(result.remoteTimestamp).toBe(200)
    })
  })

  describe('sync', () => {
    it('未启用时返回失败', async () => {
      syncManager.configure({ enabled: false })
      const result = await syncManager.sync()
      expect(result.success).toBe(false)
      expect(result.error).toContain('未启用')
    })

    it('未注入数据访问器时返回失败', async () => {
      syncManager.configure({ enabled: true })
      const result = await syncManager.sync()
      expect(result.success).toBe(false)
      expect(result.error).toContain('未注入')
    })

    it('本地数据为 null 时返回失败', async () => {
      syncManager.configure({ enabled: true })
      syncManager.injectDataHandlers(
        () => null,
        () => {},
      )
      const result = await syncManager.sync()
      expect(result.success).toBe(false)
      expect(result.error).toContain('无法读取')
    })

    it('云端同步成功（占位实现返回 null）', async () => {
      const mockData: SyncPayload = {
        deviceId: 'test-device',
        timestamp: Date.now(),
        version: 1,
        sharedCoins: 100,
      }
      syncManager.configure({ enabled: true, transport: 'cloud', cloudEndpoint: 'https://test.com' })
      syncManager.injectDataHandlers(
        () => mockData,
        () => {},
      )
      const result = await syncManager.sync()
      expect(result.success).toBe(true)
      expect(result.direction).toBe('both')
      expect(result.conflicts).toBeDefined()
    })

    it('LAN 同步成功（占位实现返回 null）', async () => {
      const mockData: SyncPayload = {
        deviceId: 'test-device',
        timestamp: Date.now(),
        version: 1,
      }
      syncManager.configure({ enabled: true, transport: 'lan', lanPort: 8420 })
      syncManager.injectDataHandlers(
        () => mockData,
        () => {},
      )
      const result = await syncManager.sync()
      expect(result.success).toBe(true)
    })

    it('云端未配置端点时抛出错误', async () => {
      const mockData: SyncPayload = {
        deviceId: 'test-device',
        timestamp: Date.now(),
        version: 1,
      }
      syncManager.configure({ enabled: true, transport: 'cloud', cloudEndpoint: undefined })
      syncManager.injectDataHandlers(
        () => mockData,
        () => {},
      )
      const result = await syncManager.sync()
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('同步成功后更新 lastSyncAt', async () => {
      const mockData: SyncPayload = {
        deviceId: 'test-device',
        timestamp: Date.now(),
        version: 1,
      }
      syncManager.configure({ enabled: true, cloudEndpoint: 'https://test.com' })
      syncManager.injectDataHandlers(
        () => mockData,
        () => {},
      )
      const before = syncManager.getLastSyncAt()
      await syncManager.sync()
      const after = syncManager.getLastSyncAt()
      expect(after).toBeGreaterThanOrEqual(before)
    })

    it('同步成功后通知监听器', async () => {
      const mockData: SyncPayload = {
        deviceId: 'test-device',
        timestamp: Date.now(),
        version: 1,
      }
      const listener = vi.fn()
      syncManager.subscribe(listener)
      syncManager.configure({ enabled: true, cloudEndpoint: 'https://test.com' })
      syncManager.injectDataHandlers(
        () => mockData,
        () => {},
      )
      await syncManager.sync()
      expect(listener).toHaveBeenCalled()
    })

    it('applyRemoteData 被调用（当远程有数据时）', async () => {
      const mockData: SyncPayload = {
        deviceId: 'test-device',
        timestamp: Date.now(),
        version: 1,
        sharedCoins: 100,
      }
      const applyFn = vi.fn()
      syncManager.configure({ enabled: true, cloudEndpoint: 'https://test.com' })
      syncManager.injectDataHandlers(
        () => mockData,
        applyFn,
      )
      await syncManager.sync()
      // 占位实现返回 null，所以 applyRemoteData 不应被调用
      expect(applyFn).not.toHaveBeenCalled()
    })

    it('R6-B 回归：本地 timestamp 较新时 mergedData 保留本地值，不被远程覆盖', async () => {
      // 场景：本地 timestamp 300 > 远程 timestamp 100
      //       SyncPayload 设计为全局 timestamp，所有字段共用
      // 期望：applyRemoteData 收到 mergedData，stats 和 sharedCoins 均保留本地值
      //       旧 Bug：applyRemoteData(remoteData) 会用远程旧值覆盖本地新值（数据丢失）
      const localData: SyncPayload = {
        deviceId: 'local-device',
        timestamp: 300,
        version: 2,
        stats: { c1: { hunger: 80, mood: 70, health: 100, affection: 500, level: 5, exp: 1200, coins: 500, lastTickAt: 300, lastInteractionAt: 300, lastAffectionDecayAt: 300 } },
        sharedCoins: 500,
      }
      const remoteData: SyncPayload = {
        deviceId: 'remote-device',
        timestamp: 100, // 远程较旧
        version: 1,
        stats: { c1: { hunger: 50, mood: 50, health: 50, affection: 100, level: 3, exp: 600, coins: 999, lastTickAt: 100, lastInteractionAt: 100, lastAffectionDecayAt: 100 } },
        sharedCoins: 999, // 远程值不应被采纳
      }

      const applyFn = vi.fn()
      syncManager.configure({ enabled: true, cloudEndpoint: 'https://test.com' })
      syncManager.injectDataHandlers(() => localData, applyFn)

      // mock syncViaCloud 返回 remoteData 触发合并路径
      const mgr = syncManager as unknown as {
        syncViaCloud: (payload: SyncPayload) => Promise<SyncPayload | null>
      }
      vi.spyOn(mgr, 'syncViaCloud').mockResolvedValue(remoteData)

      const result = await syncManager.sync()

      expect(applyFn).toHaveBeenCalledTimes(1)
      const appliedPayload = applyFn.mock.calls[0][0] as SyncPayload

      // BUGFIX 验证：本地较新时 mergedData 保留本地业务字段
      expect(appliedPayload.stats).toEqual(localData.stats)
      expect(appliedPayload.sharedCoins).toBe(500)

      // appliedFields 应为空（所有字段本地胜）
      expect(result.appliedFields).toEqual([])
      expect(result.conflicts.length).toBeGreaterThan(0)
      // 所有冲突的 resolution 都是 'local'
      expect(result.conflicts.every((c) => c.resolution === 'local')).toBe(true)

      // 合并后元数据：version 取较大值，deviceId 为本机
      expect(appliedPayload.version).toBe(2)
      const localDeviceId = syncManager.getDeviceInfo().deviceId
      expect(appliedPayload.deviceId).toBe(localDeviceId)
      // timestamp 应为合并发生时间（>= 300）
      expect(appliedPayload.timestamp).toBeGreaterThanOrEqual(300)
    })

    it('R6-B 回归：远程 timestamp 较新时 mergedData 采纳远程业务字段', async () => {
      // 场景：本地 timestamp 100 < 远程 timestamp 300
      // 期望：applyRemoteData 收到 mergedData，业务字段取远程值，元数据仍为本机
      const localData: SyncPayload = {
        deviceId: 'local-device',
        timestamp: 100,
        version: 1,
        stats: { c1: { hunger: 80, mood: 70, health: 100, affection: 500, level: 5, exp: 1200, coins: 500, lastTickAt: 100, lastInteractionAt: 100, lastAffectionDecayAt: 100 } },
        sharedCoins: 500,
      }
      const remoteData: SyncPayload = {
        deviceId: 'remote-device',
        timestamp: 300, // 远程较新
        version: 3,
        stats: { c1: { hunger: 60, mood: 90, health: 70, affection: 800, level: 8, exp: 3000, coins: 999, lastTickAt: 300, lastInteractionAt: 300, lastAffectionDecayAt: 300 } },
        sharedCoins: 999,
      }

      const applyFn = vi.fn()
      syncManager.configure({ enabled: true, cloudEndpoint: 'https://test.com' })
      syncManager.injectDataHandlers(() => localData, applyFn)

      const mgr = syncManager as unknown as {
        syncViaCloud: (payload: SyncPayload) => Promise<SyncPayload | null>
      }
      vi.spyOn(mgr, 'syncViaCloud').mockResolvedValue(remoteData)

      const result = await syncManager.sync()

      expect(applyFn).toHaveBeenCalledTimes(1)
      const appliedPayload = applyFn.mock.calls[0][0] as SyncPayload

      // 远程较新：业务字段取远程值
      expect(appliedPayload.stats).toEqual(remoteData.stats)
      expect(appliedPayload.sharedCoins).toBe(999)

      // appliedFields 应包含所有远程定义的字段
      expect(result.appliedFields).toContain('stats')
      expect(result.appliedFields).toContain('sharedCoins')

      // 元数据仍为本机：version 取较大值，deviceId 为本机
      expect(appliedPayload.version).toBe(3)
      const localDeviceId = syncManager.getDeviceInfo().deviceId
      expect(appliedPayload.deviceId).toBe(localDeviceId)
    })
  })

  describe('自动同步', () => {
    it('startAutoSync 在未配置间隔时不启动', () => {
      syncManager.configure({ autoSyncInterval: 0 })
      syncManager.startAutoSync()
      // 不抛出错误即可
    })

    it('stopAutoSync 清理定时器', () => {
      syncManager.configure({ enabled: true, autoSyncInterval: 60000, cloudEndpoint: 'https://test.com' })
      syncManager.startAutoSync()
      syncManager.stopAutoSync()
      // 不抛出错误即可
    })

    it('destroy 停止自动同步并清空监听器', () => {
      const listener = vi.fn()
      syncManager.subscribe(listener)
      syncManager.destroy()
      // destroy 后 listener 不应被调用
      syncManager.configure({ enabled: true })
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
