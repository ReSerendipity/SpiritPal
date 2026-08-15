/**
 * @file syncManager.ts
 * @description 数据同步管理器模块 — 移动端与桌面端数据同步
 *
 * 同步协议设计：
 * - 每条数据携带 deviceId（设备标识）+ timestamp（最后修改时间）+ version（版本号）
 * - 同步策略：最后写入优先（Last-Write-Wins, LWW）
 * - 冲突解决：比较 timestamp，较新的覆盖较旧的；同时间戳时 deviceId 字典序大的胜出（确定性）
 *
 * 支持三种传输通道：
 * 1) 云端同步：通过 HTTP API 与远程服务器同步（占位实现）
 * 2) 局域网同步：通过 WebSocket 发现同网络设备并直连同步（占位实现）
 * 3) WebDAV 同步：通过 WebDAV 协议同步（已实现，支持坚果云等服务）
 *
 * 同步数据范围：
 * - petStore（养成数值、金币、背包、装饰品）
 * - settingsStore（应用设置）
 * - chatStore（聊天历史）
 *
 * 主要模块：
 * - DeviceInfo: 设备标识信息接口
 * - SyncPayload: 同步数据包接口
 * - ConflictRecord: 同步冲突记录接口
 * - SyncResult: 同步结果接口
 * - SyncConfig: 同步配置接口
 * - SyncManager: 同步管理器类（单例）
 *
 * 依赖关系：
 * - ./types: NurturingStats, InventoryItem, AppSettings, ChatMessage, WornDecoration, BackgroundConfig 类型
 * - ./webdavClient: WebDAV 客户端（动态导入）
 *
 * 核心接口：
 * - SyncManager.sync(): 执行完整同步（push + pull）
 * - SyncManager.configure(): 更新同步配置
 * - SyncManager.resolveConflict(): LWW 冲突解决
 * - SyncManager.injectDataHandlers(): 注入本地数据访问函数
 * - syncManager: 全局单例导出
 *
 * BUGFIX 记录：
 * - [R6-A] 修复 deviceId 比较 Bug，确保时间戳相同时确定性 tie-breaker
 * - [R6-B] 修复整体覆盖导致本地新值丢失的 Bug，改为逐字段 LWW 合并
 *
 * F7 移动端：通过云端或局域网同步宠物养成数据
 * P3-21: WebDAV 自动同步支持
 */

import type { NurturingStats, InventoryItem, AppSettings, ChatMessage, WornDecoration, BackgroundConfig } from './types'

// ============ 同步数据类型 ============

/** 设备标识信息 */
export interface DeviceInfo {
  deviceId: string
  deviceName: string
  platform: 'desktop' | 'android' | 'ios'
  lastSeenAt: number
}

/** 同步数据包：携带时间戳的可同步字段 */
export interface SyncPayload {
  deviceId: string
  timestamp: number
  version: number
  stats?: Record<string, NurturingStats>
  sharedCoins?: number
  currentCharacterId?: string
  inventory?: InventoryItem[]
  wornDecorations?: Record<string, WornDecoration[]>
  background?: BackgroundConfig
  position?: { x: number; y: number } | null
  settings?: AppSettings
  messagesByCharacter?: Record<string, ChatMessage[]>
}

/** 同步冲突记录 */
export interface ConflictRecord {
  field: string
  localValue: unknown
  remoteValue: unknown
  localTimestamp: number
  remoteTimestamp: number
  resolvedValue: unknown
  resolution: 'local' | 'remote'
}

/** 同步结果 */
export interface SyncResult {
  success: boolean
  direction: 'push' | 'pull' | 'both'
  conflicts: ConflictRecord[]
  appliedFields: string[]
  error?: string
  syncedAt: number
}

/** 同步状态 */
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline'

/** 同步配置 */
export interface SyncConfig {
  enabled: boolean
  autoSyncInterval: number // 自动同步间隔（毫秒），0 = 禁用
  transport: 'cloud' | 'lan' | 'webdav'  // [P3-21] 新增 WebDAV 传输
  cloudEndpoint?: string
  lanPort?: number
  webdav?: {
    serverUrl: string
    username: string
    remoteDir?: string
  }
}

// ============ 同步管理器单例 ============

class SyncManager {
  private config: SyncConfig = {
    enabled: false,
    autoSyncInterval: 5 * 60 * 1000, // 默认 5 分钟
    transport: 'cloud',
    cloudEndpoint: 'https://api.spiritpal.example.com/sync',
    lanPort: 8420,
  }

  private deviceInfo: DeviceInfo
  private status: SyncStatus = 'idle'
  private lastSyncAt: number = 0
  private lastError: string | null = null
  private autoSyncTimer: number | null = null
  private listeners: Set<(status: SyncStatus, result?: SyncResult) => void> = new Set()

  // 本地数据快照获取/设置函数（由 stores 注入）
  private getLocalData: (() => SyncPayload | null) | null = null
  private applyRemoteData: ((data: SyncPayload) => void) | null = null

  constructor() {
    // 生成或读取设备标识
    this.deviceInfo = this.loadOrCreateDeviceId()
  }

  /**
   * 加载或创建设备 ID（持久化到 localStorage）
   */
  private loadOrCreateDeviceId(): DeviceInfo {
    const STORAGE_KEY = 'spiritpal-device-id'
    let deviceId: string
    try {
      deviceId = localStorage.getItem(STORAGE_KEY) ?? ''
      if (!deviceId) {
        deviceId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        localStorage.setItem(STORAGE_KEY, deviceId)
      }
    } catch {
      deviceId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }

    // 检测平台
    const platform: DeviceInfo['platform'] = this.detectPlatform()
    const deviceName = platform === 'desktop' ? 'Desktop' : platform === 'android' ? 'Android' : 'iOS'

    return {
      deviceId,
      deviceName,
      platform,
      lastSeenAt: Date.now(),
    }
  }

  /**
   * 检测当前运行平台
   */
  private detectPlatform(): DeviceInfo['platform'] {
    if (typeof navigator === 'undefined') return 'desktop'
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('android')) return 'android'
    if (/iphone|ipad|ipod/.test(ua)) return 'ios'
    return 'desktop'
  }

  /**
   * 注入本地数据访问函数（由 stores 调用）
   */
  injectDataHandlers(
    getData: () => SyncPayload | null,
    applyData: (data: SyncPayload) => void,
  ): void {
    this.getLocalData = getData
    this.applyRemoteData = applyData
  }

  /**
   * 更新同步配置
   */
  configure(partial: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...partial }
    // 重启自动同步
    if (this.autoSyncTimer !== null) {
      this.stopAutoSync()
      if (this.config.enabled && this.config.autoSyncInterval > 0) {
        this.startAutoSync()
      }
    } else if (this.config.enabled && this.config.autoSyncInterval > 0) {
      this.startAutoSync()
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): SyncConfig {
    return { ...this.config }
  }

  /**
   * 获取设备信息
   */
  getDeviceInfo(): DeviceInfo {
    return { ...this.deviceInfo }
  }

  /**
   * 获取同步状态
   */
  getStatus(): SyncStatus {
    return this.status
  }

  /**
   * 获取上次同步时间
   */
  getLastSyncAt(): number {
    return this.lastSyncAt
  }

  /**
   * 获取上次错误
   */
  getLastError(): string | null {
    return this.lastError
  }

  /**
   * 订阅同步状态变化
   */
  subscribe(listener: (status: SyncStatus, result?: SyncResult) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 通知状态变化
   */
  private notify(result?: SyncResult): void {
    this.listeners.forEach((fn) => fn(this.status, result))
  }

  /**
   * 设置状态并通知
   */
  private setStatus(status: SyncStatus, result?: SyncResult): void {
    this.status = status
    this.notify(result)
  }

  /**
   * 启动自动同步
   */
  startAutoSync(): void {
    if (this.autoSyncTimer !== null) return
    if (this.config.autoSyncInterval <= 0) return
    this.autoSyncTimer = window.setInterval(() => {
      void this.sync()
    }, this.config.autoSyncInterval)
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(): void {
    if (this.autoSyncTimer !== null) {
      clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = null
    }
  }

  /**
   * LWW 冲突解决：比较时间戳，较新的胜出
   * 时间戳相同时，deviceId 字典序大的胜出（确定性）
   *
   * BUGFIX: [R6-A] 修复 deviceId 比较 Bug
   *   - 旧实现 `this.deviceInfo.deviceId > ''` 永远为 true（任何非空字符串均大于空串）
   *     导致时间戳相同场景下永远 remote 胜出，违反确定性原则
   *   - 修复：新增 remoteDeviceId 参数，真正比较两端 deviceId 字典序
   *   - 默认值 '' 保证向后兼容：未传参时本地（非空 deviceId）胜出，符合保守原则
   */
  resolveConflict(
    field: string,
    local: { value: unknown; timestamp: number },
    remote: { value: unknown; timestamp: number },
    remoteDeviceId: string = '',
  ): ConflictRecord {
    let resolution: 'local' | 'remote'
    let resolvedValue: unknown

    if (remote.timestamp > local.timestamp) {
      resolution = 'remote'
      resolvedValue = remote.value
    } else if (remote.timestamp < local.timestamp) {
      resolution = 'local'
      resolvedValue = local.value
    } else {
      // 时间戳相同：deviceId 字典序大的胜出（确定性 tie-breaker）
      // SECURITY: [D2] 严格字符串比较，避免非空 deviceId 永远胜出的越权数据覆盖
      const localDeviceId = this.deviceInfo.deviceId
      if (remoteDeviceId > localDeviceId) {
        resolution = 'remote'
        resolvedValue = remote.value
      } else {
        // remoteDeviceId <= localDeviceId（含同设备场景）时保守选择本地值
        resolution = 'local'
        resolvedValue = local.value
      }
    }

    return {
      field,
      localValue: local.value,
      remoteValue: remote.value,
      localTimestamp: local.timestamp,
      remoteTimestamp: remote.timestamp,
      resolvedValue,
      resolution,
    }
  }

  /**
   * 执行完整同步（push + pull）
   * 占位实现：实际需要对接后端 API 或局域网发现协议
   */
  async sync(): Promise<SyncResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        direction: 'both',
        conflicts: [],
        appliedFields: [],
        error: '同步未启用',
        syncedAt: Date.now(),
      }
    }

    if (!this.getLocalData) {
      return {
        success: false,
        direction: 'both',
        conflicts: [],
        appliedFields: [],
        error: '本地数据访问器未注入',
        syncedAt: Date.now(),
      }
    }

    this.setStatus('syncing')
    this.lastError = null

    try {
      const localData = this.getLocalData()
      if (!localData) {
        this.setStatus('error')
        return {
          success: false,
          direction: 'both',
          conflicts: [],
          appliedFields: [],
          error: '无法读取本地数据',
          syncedAt: Date.now(),
        }
      }

      // 附加设备信息与时间戳
      const payload: SyncPayload = {
        ...localData,
        deviceId: this.deviceInfo.deviceId,
        timestamp: Date.now(),
        version: 1,
      }

      // 根据传输通道调用不同的同步实现
      let remoteData: SyncPayload | null = null
      if (this.config.transport === 'webdav') {
        remoteData = await this.syncViaWebDAV(payload)
      } else if (this.config.transport === 'cloud') {
        remoteData = await this.syncViaCloud(payload)
      } else {
        remoteData = await this.syncViaLAN(payload)
      }

      // 合并远程数据（LWW 冲突解决）
      const conflicts: ConflictRecord[] = []
      const appliedFields: string[] = []

      if (remoteData && this.applyRemoteData) {
        // 逐字段比较并应用
        const fieldsToMerge: Array<keyof SyncPayload> = [
          'stats', 'sharedCoins', 'currentCharacterId', 'inventory',
          'wornDecorations', 'background', 'position', 'settings',
          'messagesByCharacter',
        ]

        // BUGFIX: [R6-B] 修复整体覆盖导致本地新值丢失的 Bug
        //   - 旧实现 `applyRemoteData(remoteData)` 整体覆盖本地，逐字段 LWW 形同虚设
        //   - 修复：构造 mergedData，以 localData 为基础仅覆盖远程胜出字段
        //   - 同步更新 deviceId/timestamp/version 元数据，记录合并发生时间
        // ROBUSTNESS: [E5/E6] 合并操作幂等——相同输入产生相同输出，避免数据不一致
        const mergedData: SyncPayload = {
          ...localData,
          deviceId: this.deviceInfo.deviceId,
          timestamp: Date.now(),
          version: Math.max(localData.version ?? 1, remoteData.version ?? 1),
        }

        for (const field of fieldsToMerge) {
          const localValue = localData[field]
          const remoteValue = remoteData[field]
          if (remoteValue === undefined) continue

          // 远程比本地新时应用远程值
          const conflict = this.resolveConflict(
            String(field),
            { value: localValue, timestamp: localData.timestamp ?? 0 },
            { value: remoteValue, timestamp: remoteData.timestamp ?? 0 },
            remoteData.deviceId ?? '', // R6-A: 传入远程 deviceId 用于确定性 tie-breaker
          )
          conflicts.push(conflict)
          if (conflict.resolution === 'remote') {
            appliedFields.push(String(field))
            // 仅覆盖远程胜出字段，保留本地更新的其他字段
            ;(mergedData as unknown as Record<string, unknown>)[field as string] = remoteValue
          }
        }

        // 应用合并后的数据（保留本地新值 + 远程胜出字段）
        this.applyRemoteData(mergedData)
      }

      this.lastSyncAt = Date.now()
      const result: SyncResult = {
        success: true,
        direction: 'both',
        conflicts,
        appliedFields,
        syncedAt: this.lastSyncAt,
      }
      this.setStatus('success', result)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.lastError = msg
      this.setStatus('error')
      return {
        success: false,
        direction: 'both',
        conflicts: [],
        appliedFields: [],
        error: msg,
        syncedAt: Date.now(),
      }
    }
  }

  /**
   * WebDAV 同步（实际实现）
   * P3-21 决策#2+#6+#7：WebDAV 自动同步，支持坚果云等服务
   *
   * 流程：
   * 1. 上传本地数据到 WebDAV（PUT）
   * 2. 下载远程数据（GET）
   * 3. 由外层 sync() 执行 LWW 冲突合并
   */
  private async syncViaWebDAV(payload: SyncPayload): Promise<SyncPayload | null> {
    const { getWebDAVClient } = await import('./webdavClient')
    const client = getWebDAVClient()

    // 配置 WebDAV 客户端
    const webdavConfig = this.config.webdav
    if (!webdavConfig) {
      throw new Error('未配置 WebDAV 连接信息')
    }

    await client.configure({
      serverUrl: webdavConfig.serverUrl,
      username: webdavConfig.username,
      remoteDir: webdavConfig.remoteDir,
      autoSync: this.config.enabled,
      autoSyncInterval: this.config.autoSyncInterval,
    })

    // 先上传本地数据
    await client.uploadSyncData({
      timestamp: payload.timestamp,
      deviceId: payload.deviceId,
      petData: {
        stats: payload.stats,
        sharedCoins: payload.sharedCoins,
        currentCharacterId: payload.currentCharacterId,
        inventory: payload.inventory,
        wornDecorations: payload.wornDecorations,
        background: payload.background,
        position: payload.position,
      },
      settings: payload.settings,
      chatData: payload.messagesByCharacter as Record<string, unknown> | undefined,
    })

    // 下载远程数据
    const remoteData = await client.downloadSyncData()
    if (!remoteData) return null

    // 将远程数据映射回 SyncPayload
    const remotePayload: SyncPayload = {
      deviceId: remoteData.deviceId,
      timestamp: remoteData.timestamp,
      version: 1,
    }

    if (remoteData.petData && typeof remoteData.petData === 'object') {
      const petData = remoteData.petData as Record<string, unknown>
      remotePayload.stats = petData.stats as Record<string, NurturingStats> | undefined
      remotePayload.sharedCoins = petData.sharedCoins as number | undefined
      remotePayload.currentCharacterId = petData.currentCharacterId as string | undefined
      remotePayload.inventory = petData.inventory as InventoryItem[] | undefined
      remotePayload.wornDecorations = petData.wornDecorations as Record<string, WornDecoration[]> | undefined
      remotePayload.background = petData.background as BackgroundConfig | undefined
      remotePayload.position = petData.position as { x: number; y: number } | null | undefined
    }

    if (remoteData.settings) {
      remotePayload.settings = remoteData.settings as AppSettings
    }

    if (remoteData.chatData) {
      remotePayload.messagesByCharacter = remoteData.chatData as Record<string, ChatMessage[]>
    }

    return remotePayload
  }

  /**
   * 云端同步（占位实现）
   * 实际实现需对接后端 API：
   * POST {cloudEndpoint}/push — 上传本地数据
   * GET  {cloudEndpoint}/pull — 拉取远程数据
   */
  private async syncViaCloud(payload: SyncPayload): Promise<SyncPayload | null> {
    const endpoint = this.config.cloudEndpoint
    if (!endpoint) {
      throw new Error('未配置云端同步端点')
    }

    // 占位实现：实际项目中应使用 fetch 调用后端 API
    // try {
    //   const pushResp = await fetch(`${endpoint}/push`, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify(payload),
    //   })
    //   if (!pushResp.ok) throw new Error(`Push failed: ${pushResp.status}`)
    //   const pullResp = await fetch(`${endpoint}/pull?deviceId=${this.deviceInfo.deviceId}`)
    //   if (!pullResp.ok) throw new Error(`Pull failed: ${pullResp.status}`)
    //   return await pullResp.json()
    // } catch (err) {
    //   throw err
    // }

    // 占位：返回 null 表示无远程数据
    void payload
    return null
  }

  /**
   * 局域网同步（占位实现）
   * 实际实现需使用 WebSocket 发现同网络设备并直连同步
   */
  private async syncViaLAN(payload: SyncPayload): Promise<SyncPayload | null> {
    const port = this.config.lanPort ?? 8420
    // 占位实现：实际项目中应使用 WebSocket 广播发现 + 直连同步
    // 1. 通过 UDP 广播发现同网络运行 SpiritPal 的设备
    // 2. 建立 WebSocket 连接（ws://<peer-ip>:<port>）
    // 3. 交换 SyncPayload 并执行 LWW 合并
    void port
    void payload
    return null
  }

  /**
   * 销毁同步管理器：停止自动同步、清空监听器、重置数据处理器
   * 在应用退出时调用
   */
  destroy(): void {
    this.stopAutoSync()
    this.listeners.clear()
    this.getLocalData = null
    this.applyRemoteData = null
    this.lastError = null
    this.lastSyncAt = 0
    this.status = 'idle'
  }

  /**
   * dispose 是 destroy 的别名，保持 API 一致性
   * 在切换角色或应用退出时调用
   */
  dispose(): void {
    this.destroy()
  }
}

// 导出全局单例
export const syncManager = new SyncManager()

/**
 * 获取本地需要同步的数据快照
 * 由各 store 调用 syncManager.injectDataHandlers 时传入
 */
export function collectLocalData(): SyncPayload | null {
  // 延迟导入避免循环依赖
  // 实际由 App 或 stores 在初始化时注入
  return null
}
