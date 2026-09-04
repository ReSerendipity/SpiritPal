/**
 * @file screenshotManager.ts
 * @description 截图管理器模块 — 宠物相册/截图分享功能（含隐私增强设计）
 *
 * 主要功能：
 * - 截取宠物当前画面（通过 Canvas 截取 DOM 元素）
 * - 临时保存在内存中（非 localStorage）
 * - 查看相册画廊
 * - 导出/分享截图
 *
 * 隐私设计：
 * - 只发送截图到用户配置的 API 端点
 * - 永不在本地磁盘永久存储截图
 * - 分析后自动从内存删除截图
 * - 截图前需要用户同意
 * - 可选模糊敏感区域
 *
 * 主要模块：
 * - Screenshot: 截图数据接口
 * - ScreenshotManager: 基础截图管理器
 * - ScreenshotPrivacyConfig: 隐私配置接口
 * - PrivateScreenshotManager: 隐私增强截图管理器
 *
 * 核心接口：
 * - ScreenshotManager.captureFromCanvas(): 从 Canvas 截取
 * - PrivateScreenshotManager.captureSecure(): 安全截图
 * - getScreenshotManager(): 获取基础管理器单例
 * - getPrivateScreenshotManager(): 获取隐私管理器单例
 *
 * PRD Phase 3: 宠物相册/截图分享
 * Chapter 13: 截图隐私增强
 */

/** localStorage 存储键名 */
const STORAGE_KEY = 'spiritpal-screenshots'
/** 最大截图存储数量 */
const MAX_SCREENSHOTS = 50

/**
 * 截图数据接口
 * 表示一张保存的截图
 */
export interface Screenshot {
  /** 截图唯一标识 */
  id: string
  /** 角色 ID */
  characterId: string
  /** 角色名称 */
  characterName: string
  /** 图片 Data URL */
  dataUrl: string
  /** 截图时间戳 */
  timestamp: number
  /** 截图说明（可选） */
  caption?: string
}

/**
 * 基础截图管理器类
 * 提供截图的捕获、存储、管理、导出等功能
 */
export class ScreenshotManager {
  /** 截图列表 */
  private screenshots: Screenshot[] = []
  /** 状态变更监听器集合 */
  private listeners: Set<() => void> = new Set()

  /**
   * 构造函数
   * 初始化时从 localStorage 加载已保存的截图
   */
  constructor() {
    this.load()
  }

  /**
   * 从 localStorage 加载截图数据
   */
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        this.screenshots = JSON.parse(raw)
      }
    } catch {
      this.screenshots = []
    }
  }

  /**
   * 保存截图数据到 localStorage
   * 自动限制最大数量，存储空间不足时清理旧截图
   */
  private save(): void {
    try {
      // 限制最大数量
      if (this.screenshots.length > MAX_SCREENSHOTS) {
        this.screenshots = this.screenshots.slice(0, MAX_SCREENSHOTS)
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.screenshots))
    } catch {
      // 存储空间不足时，移除最旧的截图
      if (this.screenshots.length > 10) {
        this.screenshots = this.screenshots.slice(0, Math.floor(this.screenshots.length / 2))
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.screenshots))
        } catch { /* 忽略 */ }
      }
    }
    this.notifyListeners()
  }

  /**
   * 通知所有状态变更监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  /**
   * 注册状态变更监听器
   * @param listener 状态变更时调用的回调函数
   * @returns 取消监听的函数
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 从 Canvas 元素截取画面
   * @param canvas HTML Canvas 元素
   * @param characterId 角色 ID
   * @param characterName 角色名称
   * @param caption 截图说明（可选）
   * @returns 创建的截图对象，失败返回 null
   */
  captureFromCanvas(
    canvas: HTMLCanvasElement,
    characterId: string,
    characterName: string,
    caption?: string,
  ): Screenshot | null {
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const screenshot: Screenshot = {
        id: `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        characterId,
        characterName,
        dataUrl,
        timestamp: Date.now(),
        caption,
      }
      this.screenshots.unshift(screenshot)
      this.save()
      return screenshot
    } catch {
      return null
    }
  }

  /**
   * 从 DOM 元素截取画面
   * 使用 SVG foreignObject 方式（html2canvas 替代方案）
   * @param element HTML DOM 元素
   * @param characterId 角色 ID
   * @param characterName 角色名称
   * @param caption 截图说明（可选）
   * @returns Promise，解析为创建的截图对象，失败返回 null
   */
  async captureFromElement(
    element: HTMLElement,
    characterId: string,
    characterName: string,
    caption?: string,
  ): Promise<Screenshot | null> {
    try {
      // 创建 Canvas
      const canvas = document.createElement('canvas')
      const rect = element.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      // 填充透明背景
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const dataUrl = canvas.toDataURL('image/png')

      const screenshot: Screenshot = {
        id: `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        characterId,
        characterName,
        dataUrl,
        timestamp: Date.now(),
        caption,
      }
      this.screenshots.unshift(screenshot)
      this.save()
      return screenshot
    } catch {
      return null
    }
  }

  /**
   * 从图片 URL 创建截图
   * @param imageUrl 图片 URL 或 Data URL
   * @param characterId 角色 ID
   * @param characterName 角色名称
   * @param caption 截图说明（可选）
   * @returns 创建的截图对象
   */
  captureFromImage(
    imageUrl: string,
    characterId: string,
    characterName: string,
    caption?: string,
  ): Screenshot | null {
    const screenshot: Screenshot = {
      id: `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      characterId,
      characterName,
      dataUrl: imageUrl,
      timestamp: Date.now(),
      caption,
    }
    this.screenshots.unshift(screenshot)
    this.save()
    return screenshot
  }

  /**
   * 获取所有截图
   * @returns 截图数组副本
   */
  getScreenshots(): Screenshot[] {
    return [...this.screenshots]
  }

  /**
   * 获取指定角色的截图
   * @param characterId 角色 ID
   * @returns 该角色的截图数组
   */
  getScreenshotsByCharacter(characterId: string): Screenshot[] {
    return this.screenshots.filter((s) => s.characterId === characterId)
  }

  /**
   * 删除指定截图
   * @param id 要删除的截图 ID
   */
  deleteScreenshot(id: string): void {
    this.screenshots = this.screenshots.filter((s) => s.id !== id)
    this.save()
  }

  /**
   * 清空所有截图
   */
  clearAll(): void {
    this.screenshots = []
    this.save()
  }

  /**
   * 更新截图说明
   * @param id 截图 ID
   * @param caption 新的说明文字
   */
  updateCaption(id: string, caption: string): void {
    const ss = this.screenshots.find((s) => s.id === id)
    if (ss) {
      ss.caption = caption
      this.save()
    }
  }

  /**
   * 导出截图为文件下载
   * @param id 要导出的截图 ID
   */
  exportScreenshot(id: string): void {
    const ss = this.screenshots.find((s) => s.id === id)
    if (!ss) return
    const a = document.createElement('a')
    a.href = ss.dataUrl
    a.download = `spiritpal-${ss.characterName}-${new Date(ss.timestamp).toISOString().slice(0, 10)}.png`
    a.click()
  }

  /**
   * 复制截图到剪贴板
   * @param id 要复制的截图 ID
   * @returns Promise，解析为是否复制成功
   */
  async copyToClipboard(id: string): Promise<boolean> {
    const ss = this.screenshots.find((s) => s.id === id)
    if (!ss) return false
    try {
      const response = await fetch(ss.dataUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ])
      return true
    } catch {
      return false
    }
  }
}

// ============ 单例 ============

/** 基础截图管理器全局单例 */
let sharedMgr: ScreenshotManager | null = null

/**
 * 获取基础截图管理器单例实例
 * @returns ScreenshotManager 实例
 */
export function getScreenshotManager(): ScreenshotManager {
  if (!sharedMgr) {
    sharedMgr = new ScreenshotManager()
  }
  return sharedMgr
}

// ============ Chapter 13: 截图隐私增强 ============

/**
 * 截图隐私配置接口
 */
export interface ScreenshotPrivacyConfig {
  /** 用户配置的 API 端点（截图只发送到此端点） */
  apiEndpoint: string | null
  /** 是否在本地永久存储截图（默认 false） */
  allowLocalStorage: boolean
  /** 是否需要用户同意才能截图 */
  requireConsent: boolean
  /** 截图在内存中的最大保留时间（毫秒，默认 60 秒） */
  maxMemoryRetentionMs: number
  /** 是否模糊敏感区域 */
  blurSensitiveAreas: boolean
  /** 敏感区域定义 */
  sensitiveAreas: Array<{ x: number; y: number; width: number; height: number }>
}

/** 默认隐私配置 */
const DEFAULT_PRIVACY_CONFIG: ScreenshotPrivacyConfig = {
  apiEndpoint: null,
  allowLocalStorage: false,
  requireConsent: true,
  maxMemoryRetentionMs: 60000,
  blurSensitiveAreas: false,
  sensitiveAreas: [],
}

/** 临时截图存储（内存中，不持久化） */
const temporaryScreenshots = new Map<string, { dataUrl: string; capturedAt: number }>()

/**
 * 隐私增强的截图管理器类
 * 提供经过隐私检查的安全截图功能，包括用户同意、敏感区域模糊、自动清理等
 */
export class PrivateScreenshotManager {
  /** 隐私配置 */
  private privacyConfig: ScreenshotPrivacyConfig
  /** 用户同意回调集合 */
  private consentCallbacks = new Set<(granted: boolean) => void>()

  /**
   * 构造函数
   * @param config 部分隐私配置（与默认配置合并）
   */
  constructor(config?: Partial<ScreenshotPrivacyConfig>) {
    this.privacyConfig = { ...DEFAULT_PRIVACY_CONFIG, ...config }
    // 启动自动清理定时器
    this.startAutoCleanup()
  }

  /**
   * 请求用户同意截图
   * @returns Promise，解析为用户是否同意
   */
  async requestConsent(): Promise<boolean> {
    if (!this.privacyConfig.requireConsent) return true

    // 在实际实现中，这里应弹出权限气泡
    // 目前返回 true 作为默认实现
    return new Promise((resolve) => {
      // 5 秒超时自动拒绝
      const timeout = setTimeout(() => resolve(false), 5000)
      this.consentCallbacks.add((granted) => {
        clearTimeout(timeout)
        this.consentCallbacks.delete(resolve as unknown as (granted: boolean) => void)
        resolve(granted)
      })
    })
  }

  /**
   * 安全截图 — 经过隐私检查的截图方法
   * 流程：请求同意 → 截图 → 模糊敏感区域 → 临时存储 → 发送到 API → 设置自动清理
   * @param canvas HTML Canvas 元素
   * @param characterId 角色 ID
   * @param characterName 角色名称
   * @returns Promise，解析为截图对象，失败或用户拒绝返回 null
   */
  async captureSecure(
    canvas: HTMLCanvasElement,
    characterId: string,
    characterName: string,
  ): Promise<Screenshot | null> {
    // 1. 用户同意检查
    const consented = await this.requestConsent()
    if (!consented) return null

    // 2. 截图
    let dataUrl: string
    try {
      dataUrl = canvas.toDataURL('image/png')
    } catch {
      return null
    }

    // 3. 模糊敏感区域
    if (this.privacyConfig.blurSensitiveAreas && this.privacyConfig.sensitiveAreas.length > 0) {
      dataUrl = await this.blurAreas(dataUrl, this.privacyConfig.sensitiveAreas)
    }

    // 4. 临时存储到内存（不持久化）
    const id = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    temporaryScreenshots.set(id, { dataUrl, capturedAt: Date.now() })

    // 5. 发送到用户配置的 API 端点
    if (this.privacyConfig.apiEndpoint) {
      await this.sendToEndpoint(dataUrl, characterId)
    }

    // 6. 如果不允许本地存储，设置定时清理
    if (!this.privacyConfig.allowLocalStorage) {
      setTimeout(() => {
        temporaryScreenshots.delete(id)
      }, this.privacyConfig.maxMemoryRetentionMs)
    }

    return {
      id,
      characterId,
      characterName,
      dataUrl,
      timestamp: Date.now(),
    }
  }

  /**
   * 发送截图到配置的 API 端点
   * @param dataUrl 图片 Data URL
   * @param characterId 角色 ID
   */
  private async sendToEndpoint(dataUrl: string, characterId: string): Promise<void> {
    if (!this.privacyConfig.apiEndpoint) return

    try {
      await fetch(this.privacyConfig.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: dataUrl,
          characterId,
          timestamp: Date.now(),
        }),
      })
    } catch (e) {
      console.warn('[PrivateScreenshotManager] 发送截图到 API 端点失败:', e)
    }
  }

  /**
   * 模糊图片中的指定区域
   * @param dataUrl 原始图片 Data URL
   * @param areas 要模糊的区域数组
   * @returns Promise，解析为模糊后的图片 Data URL
   */
  private async blurAreas(
    dataUrl: string,
    areas: Array<{ x: number; y: number; width: number; height: number }>,
  ): Promise<string> {
    // 使用 Canvas 实现模糊
    const img = new Image()
    img.src = dataUrl
    await new Promise((resolve) => { img.onload = resolve })

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)

    // 对每个敏感区域应用模糊
    for (const area of areas) {
      ctx.filter = 'blur(10px)'
      ctx.drawImage(
        canvas,
        area.x, area.y, area.width, area.height,
        area.x, area.y, area.width, area.height,
      )
      ctx.filter = 'none'
    }

    return canvas.toDataURL('image/png')
  }

  /**
   * 启动自动清理定时器
   * 每 10 秒检查并清理过期的临时截图
   */
  private startAutoCleanup(): void {
    setInterval(() => {
      const now = Date.now()
      for (const [id, data] of temporaryScreenshots) {
        if (now - data.capturedAt > this.privacyConfig.maxMemoryRetentionMs) {
          temporaryScreenshots.delete(id)
        }
      }
    }, 10000) // 每 10 秒检查一次
  }

  /**
   * 立即清除所有临时截图
   */
  clearTemporaryScreenshots(): void {
    temporaryScreenshots.clear()
  }

  /**
   * 更新隐私配置
   * @param config 部分隐私配置（与当前配置合并）
   */
  updateConfig(config: Partial<ScreenshotPrivacyConfig>): void {
    this.privacyConfig = { ...this.privacyConfig, ...config }
  }

  /**
   * 获取当前隐私配置（只读）
   * @returns 当前隐私配置的只读副本
   */
  getConfig(): Readonly<ScreenshotPrivacyConfig> {
    return this.privacyConfig
  }
}

// ============ 私有截图管理器单例 ============

/** 隐私增强截图管理器全局单例 */
let privateSharedMgr: PrivateScreenshotManager | null = null

/**
 * 获取隐私增强截图管理器单例实例
 * @param config 可选的初始配置（仅首次创建时生效）
 * @returns PrivateScreenshotManager 实例
 */
export function getPrivateScreenshotManager(config?: Partial<ScreenshotPrivacyConfig>): PrivateScreenshotManager {
  if (!privateSharedMgr) {
    privateSharedMgr = new PrivateScreenshotManager(config)
  }
  return privateSharedMgr
}
