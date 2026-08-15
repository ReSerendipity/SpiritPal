/**
 * 权限气泡系统模块
 *
 * @fileoverview 浮动权限请求卡片UI，支持快捷键响应、队列管理与权限记忆（参考clawd-on-desk）
 *
 * 主要模块：
 * - PermissionRequest/PermissionResponse: 权限请求与响应类型
 * - PermissionDecision: 权限决策（allow/deny/alwaysAllow）
 * - PermissionBubbleState: 气泡状态
 * - PermissionBubbleManager: 权限气泡管理器
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri全局快捷键注册
 *
 * 核心接口：
 * - requestPermission(): 请求权限（入队）
 * - respondToRequest(): 响应权限请求
 * - getCurrentRequest(): 获取当前显示的请求
 * - getAlwaysAllowed(): 获取始终允许列表
 * - resetPermissions(): 重置权限记忆
 *
 * 核心功能（参考clawd-on-desk权限提示设计）：
 * 1. 浮动卡片：Allow/Deny/Always Allow三按钮UI
 * 2. 全局快捷键：Ctrl+Shift+Y=允许，Ctrl+Shift+N=拒绝
 * 3. 请求队列：多个权限请求排队处理
 * 4. 自动超时：30秒无响应自动拒绝
 * 5. 权限记忆：始终允许列表，避免重复询问
 */

// ============ 类型定义 ============

/** 权限请求 */
export interface PermissionRequest {
  /** 请求 ID */
  id: string
  /** 插件/模组 ID */
  sourceId: string
  /** 权限名称 */
  permission: string
  /** 权限说明 */
  description?: string
  /** 请求时间 */
  requestedAt: number
  /** 超时时间（毫秒，默认 30000） */
  timeoutMs: number
}

/** 权限决策 */
export type PermissionDecision = 'allow' | 'deny' | 'alwaysAllow'

/** 权限响应 */
export interface PermissionResponse {
  requestId: string
  decision: PermissionDecision
  respondedAt: number
}

/** 权限气泡状态 */
export interface PermissionBubbleState {
  /** 是否显示 */
  visible: boolean
  /** 当前请求（队列头部） */
  currentRequest: PermissionRequest | null
  /** 队列中的请求数 */
  queueLength: number
  /** 剩余超时秒数 */
  remainingSeconds: number
}

// ============ 权限气泡管理器 ============

export class PermissionBubbleManager {
  /** 权限请求队列 */
  private queue: PermissionRequest[] = []
  /** 当前显示的请求 */
  private currentRequest: PermissionRequest | null = null
  /** 始终允许列表 */
  private alwaysAllowList = new Set<string>()
  /** 始终拒绝列表 */
  private alwaysDenyList = new Set<string>()
  /** 超时定时器 */
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  /** 倒计时定时器 */
  private countdownTimer: ReturnType<typeof setInterval> | null = null
  /** 剩余秒数 */
  private remainingSeconds = 30
  /** 响应回调 */
  private responseCallbacks = new Map<string, (response: PermissionResponse) => void>()
  /** 状态监听器 */
  private listeners = new Set<(state: PermissionBubbleState) => void>()

  constructor() {
    this.loadAlwaysAllowList()
  }

  // ============ 权限请求 ============

  /**
   * 发起权限请求
   * @returns Promise<PermissionDecision> — 返回用户决策
   */
  requestPermission(
    sourceId: string,
    permission: string,
    description?: string,
    timeoutMs = 30000,
  ): Promise<PermissionDecision> {
    // 检查始终允许列表
    const allowKey = `${sourceId}:${permission}`
    if (this.alwaysAllowList.has(allowKey)) {
      return Promise.resolve('alwaysAllow')
    }
    if (this.alwaysDenyList.has(allowKey)) {
      return Promise.resolve('deny')
    }

    const request: PermissionRequest = {
      id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceId,
      permission,
      description,
      requestedAt: Date.now(),
      timeoutMs,
    }

    return new Promise<PermissionDecision>((resolve) => {
      this.responseCallbacks.set(request.id, (response) => {
        resolve(response.decision)
      })

      this.queue.push(request)

      // 如果没有当前显示的请求，立即显示
      if (!this.currentRequest) {
        this.showNext()
      } else {
        this.notifyListeners()
      }
    })
  }

  /**
   * 响应当前权限请求
   */
  respond(decision: PermissionDecision): void {
    if (!this.currentRequest) return

    const request = this.currentRequest
    const response: PermissionResponse = {
      requestId: request.id,
      decision,
      respondedAt: Date.now(),
    }

    // 处理 Always Allow / Always Deny
    const key = `${request.sourceId}:${request.permission}`
    if (decision === 'alwaysAllow') {
      this.alwaysAllowList.add(key)
      this.saveAlwaysAllowList()
    }

    // 通知回调
    const callback = this.responseCallbacks.get(request.id)
    if (callback) {
      callback(response)
      this.responseCallbacks.delete(request.id)
    }

    // 清除超时定时器
    this.clearTimers()

    // 处理队列中的下一个
    this.currentRequest = null
    this.showNext()
  }

  /**
   * 快速允许（Ctrl+Shift+Y）
   */
  quickAllow(): void {
    if (this.currentRequest) {
      this.respond('allow')
    }
  }

  /**
   * 快速拒绝（Ctrl+Shift+N）
   */
  quickDeny(): void {
    if (this.currentRequest) {
      this.respond('deny')
    }
  }

  // ============ 队列管理 ============

  /**
   * 获取当前气泡状态
   */
  getState(): PermissionBubbleState {
    return {
      visible: this.currentRequest !== null,
      currentRequest: this.currentRequest,
      queueLength: this.queue.length,
      remainingSeconds: this.remainingSeconds,
    }
  }

  /**
   * 取消所有待处理请求
   */
  cancelAll(): void {
    this.clearTimers()
    for (const request of this.queue) {
      const callback = this.responseCallbacks.get(request.id)
      if (callback) {
        callback({ requestId: request.id, decision: 'deny', respondedAt: Date.now() })
        this.responseCallbacks.delete(request.id)
      }
    }
    if (this.currentRequest) {
      const callback = this.responseCallbacks.get(this.currentRequest.id)
      if (callback) {
        callback({ requestId: this.currentRequest.id, decision: 'deny', respondedAt: Date.now() })
        this.responseCallbacks.delete(this.currentRequest.id)
      }
    }
    this.queue = []
    this.currentRequest = null
    this.notifyListeners()
  }

  /**
   * 订阅气泡状态变化
   */
  subscribe(listener: (state: PermissionBubbleState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ============ 始终允许/拒绝管理 ============

  /**
   * 添加始终允许
   */
  addAlwaysAllow(sourceId: string, permission: string): void {
    this.alwaysAllowList.add(`${sourceId}:${permission}`)
    this.saveAlwaysAllowList()
  }

  /**
   * 移除始终允许
   */
  removeAlwaysAllow(sourceId: string, permission: string): void {
    this.alwaysAllowList.delete(`${sourceId}:${permission}`)
    this.saveAlwaysAllowList()
  }

  /**
   * 获取所有始终允许条目
   */
  getAlwaysAllowList(): string[] {
    return Array.from(this.alwaysAllowList)
  }

  // ============ 内部方法 ============

  private showNext(): void {
    if (this.queue.length === 0) {
      this.notifyListeners()
      return
    }

    this.currentRequest = this.queue.shift()!
    const timeout = this.currentRequest.timeoutMs
    this.remainingSeconds = Math.ceil(timeout / 1000)

    // 启动超时定时器
    this.timeoutTimer = setTimeout(() => {
      // 超时自动拒绝
      this.respond('deny')
    }, timeout)

    // 启动倒计时
    this.countdownTimer = setInterval(() => {
      this.remainingSeconds -= 1
      if (this.remainingSeconds <= 0) {
        this.remainingSeconds = 0
      }
      this.notifyListeners()
    }, 1000)

    this.notifyListeners()
  }

  private clearTimers(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  }

  private notifyListeners(): void {
    const state = this.getState()
    this.listeners.forEach((fn) => fn(state))
  }

  private loadAlwaysAllowList(): void {
    try {
      const raw = localStorage.getItem('spiritpal-always-allow')
      if (raw) {
        const list = JSON.parse(raw) as string[]
        list.forEach((key) => this.alwaysAllowList.add(key))
      }
    } catch {
      // 忽略
    }
  }

  private saveAlwaysAllowList(): void {
    try {
      localStorage.setItem(
        'spiritpal-always-allow',
        JSON.stringify(Array.from(this.alwaysAllowList)),
      )
    } catch {
      // 忽略
    }
  }
}

// ============ 单例 ============

let sharedManager: PermissionBubbleManager | null = null

export function getPermissionBubbleManager(): PermissionBubbleManager {
  if (!sharedManager) {
    sharedManager = new PermissionBubbleManager()
  }
  return sharedManager
}
