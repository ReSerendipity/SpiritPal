/**
 * IPC 通信安全模块
 *
 * @fileoverview 提供本地 IPC 通信的安全防护机制，参考 OpenPets 安全模型
 *
 * 主要模块：
 * - IpcEnvelope/AuthResult/RateLimitResult: IPC 消息与验证结果接口
 * - TokenManager: Token 生成与轮转管理（30分钟自动轮转，5秒宽限期）
 * - RateLimiter: 滑动窗口速率限制器（每连接每秒10次请求）
 * - IpcSecurityManager: IPC 安全管理器主类
 * - validateIpcMessage: 消息校验函数
 *
 * 依赖关系：
 * - crypto: Node.js 加密模块（Token 生成）
 * - events: EventEmitter 事件机制
 * - mcpInputValidator.ts: 输入内容安全校验
 *
 * 核心接口：
 * - IpcSecurityManager.processMessage(): 处理收到的 IPC 消息（速率→认证→校验）
 * - validateIpcMessage(): 校验消息格式、大小、时间戳等
 * - getCurrentToken(): 获取当前认证 Token
 *
 * 安全机制：
 * - 16KB 消息大小限制
 * - Token 每30分钟自动轮转，旧Token5秒宽限期
 * - 滑动窗口速率限制（10次/秒/连接）
 * - 30秒消息时间戳窗口防重放
 */

import { randomBytes, createHash } from 'crypto'
import { EventEmitter } from 'events'
import { validateMcpInput, type TextValidationOptions } from './mcpInputValidator'

// ============ 安全配置常量 ============

/** 最大消息大小（16KB） */
export const MAX_MESSAGE_SIZE = 16 * 1024

/** Token 轮转间隔（毫秒，默认 30 分钟） */
const TOKEN_ROTATION_INTERVAL_MS = 30 * 60 * 1000

/** 速率限制：每个连接每秒最大请求数 */
const RATE_LIMIT_PER_SECOND = 10

/** 速率限制：窗口大小（毫秒） */
const RATE_LIMIT_WINDOW_MS = 1000

/** Token 长度（字节） */
const TOKEN_LENGTH = 32

// ============ IPC 消息格式 ============

/** IPC 消息信封 */
export interface IpcEnvelope {
  /** 消息 ID（用于响应匹配） */
  id: string
  /** 认证 Token */
  token: string
  /** 消息类型 */
  type: string
  /** 消息载荷 */
  payload: unknown
  /** 时间戳 */
  timestamp: number
}

/** IPC 认证结果 */
export interface AuthResult {
  /** 是否认证通过 */
  authenticated: boolean
  /** 错误消息 */
  error?: string
}

/** 速率限制结果 */
export interface RateLimitResult {
  /** 是否允许通过 */
  allowed: boolean
  /** 剩余配额 */
  remaining: number
  /** 重置时间（毫秒后） */
  resetAfter: number
}

// ============ Token 管理器 ============

class TokenManager {
  /** 当前活跃 Token */
  private currentToken: string
  /** 上一个 Token（轮转后仍短暂有效） */
  private previousToken: string | null = null
  /** Token 创建时间 */
  private tokenCreatedAt: number
  /** 轮转定时器 */
  private rotationTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.currentToken = this.generateToken()
    this.tokenCreatedAt = Date.now()
  }

  /** 生成随机 Token
   * SECURITY R-07: 删除 Math.random() 降级路径，randomBytes 失败直接抛错
   * 攻击者无法通过预测 Token 绕过 IPC 认证
   */
  private generateToken(): string {
    // 不再降级到 Math.random()，该路径可被预测
    return randomBytes(TOKEN_LENGTH).toString('hex')
  }

  /** 启动 Token 轮转 */
  start(): void {
    if (this.rotationTimer) return
    this.rotationTimer = setInterval(() => this.rotate(), TOKEN_ROTATION_INTERVAL_MS)
  }

  /** 停止 Token 轮转 */
  stop(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer)
      this.rotationTimer = null
    }
  }

  /** 轮转 Token */
  private rotate(): void {
    this.previousToken = this.currentToken
    this.currentToken = this.generateToken()
    this.tokenCreatedAt = Date.now()
  }

  /** 验证 Token */
  validate(token: string): AuthResult {
    // 检查当前 Token
    if (token === this.currentToken) {
      return { authenticated: true }
    }
    // 检查上一个 Token（轮转期间短暂有效）
    if (this.previousToken && token === this.previousToken) {
      const elapsed = Date.now() - this.tokenCreatedAt
      if (elapsed < 5000) { // 5 秒宽限期
        return { authenticated: true }
      }
    }
    return { authenticated: false, error: 'Token 无效或已过期' }
  }

  /** 获取当前 Token */
  getCurrentToken(): string {
    return this.currentToken
  }

  /** 计算 Token 指纹（用于日志，不暴露原始 Token） */
  getTokenFingerprint(): string {
    try {
      return createHash('sha256').update(this.currentToken).digest('hex').slice(0, 8)
    } catch {
      return this.currentToken.slice(0, 8)
    }
  }
}

// ============ 速率限制器 ============

class RateLimiter {
  /** 每个连接的请求记录 */
  private requestCounts = new Map<string, number[]>()
  /** 每秒最大请求数 */
  private maxPerSecond: number

  constructor(maxPerSecond: number = RATE_LIMIT_PER_SECOND) {
    this.maxPerSecond = maxPerSecond
  }

  /** 检查速率限制 */
  check(connectionId: string): RateLimitResult {
    const now = Date.now()
    const windowStart = now - RATE_LIMIT_WINDOW_MS

    // 获取或创建请求记录
    let timestamps = this.requestCounts.get(connectionId)
    if (!timestamps) {
      timestamps = []
      this.requestCounts.set(connectionId, timestamps)
    }

    // 清理过期记录
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift()
    }

    const remaining = this.maxPerSecond - timestamps.length
    if (remaining <= 0) {
      const resetAfter = timestamps[0] + RATE_LIMIT_WINDOW_MS - now
      return { allowed: false, remaining: 0, resetAfter: Math.max(0, resetAfter) }
    }

    // 记录本次请求
    timestamps.push(now)

    return { allowed: true, remaining: remaining - 1, resetAfter: RATE_LIMIT_WINDOW_MS }
  }

  /** 清除指定连接的速率记录 */
  clear(connectionId: string): void {
    this.requestCounts.delete(connectionId)
  }

  /** 清除所有速率记录 */
  clearAll(): void {
    this.requestCounts.clear()
  }
}

// ============ 消息校验器 ============

/** 消息校验选项 */
export interface MessageValidationOptions {
  /** 最大消息大小（默认 16KB） */
  maxSize?: number
  /** 是否校验 payload 中的字符串字段 */
  validatePayloadStrings?: boolean
  /** 字符串校验选项 */
  textValidationOptions?: TextValidationOptions
}

/**
 * 校验 IPC 消息
 * @param envelope 消息信封
 * @param options 校验选项
 */
export function validateIpcMessage(
  envelope: IpcEnvelope,
  options: MessageValidationOptions = {},
): { valid: boolean; error?: string } {
  const { maxSize = MAX_MESSAGE_SIZE, validatePayloadStrings = false, textValidationOptions } = options

  // 1. 基本字段检查
  if (!envelope.id || typeof envelope.id !== 'string') {
    return { valid: false, error: '消息 ID 缺失或类型错误' }
  }
  if (!envelope.token || typeof envelope.token !== 'string') {
    return { valid: false, error: '认证 Token 缺失或类型错误' }
  }
  if (!envelope.type || typeof envelope.type !== 'string') {
    return { valid: false, error: '消息类型缺失或类型错误' }
  }

  // 2. 消息大小限制
  try {
    const size = JSON.stringify(envelope).length
    if (size > maxSize) {
      return { valid: false, error: `消息大小超限: ${size} > ${maxSize}` }
    }
  } catch {
    return { valid: false, error: '消息序列化失败' }
  }

  // 3. 时间戳检查（拒绝过期消息）
  const now = Date.now()
  if (Math.abs(now - envelope.timestamp) > 30000) { // 30 秒窗口
    return { valid: false, error: '消息时间戳过期' }
  }

  // 4. Payload 字符串校验（可选）
  if (validatePayloadStrings && envelope.payload && textValidationOptions) {
    const payload = envelope.payload as Record<string, unknown>
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        const result = validateMcpInput(value, { ...textValidationOptions, fieldName: key })
        if (!result.valid) {
          return { valid: false, error: `Payload 校验失败 (${key}): ${result.error}` }
        }
      }
    }
  }

  return { valid: true }
}

// ============ IPC 安全管理器 ============

export interface IpcSecurityEvents {
  /** 认证失败 */
  'auth-failed': (connectionId: string, error: string) => void
  /** 速率限制触发 */
  'rate-limited': (connectionId: string, result: RateLimitResult) => void
  /** 消息校验失败 */
  'validation-failed': (connectionId: string, error: string) => void
  /** Token 轮转 */
  'token-rotated': (fingerprint: string) => void
}

export class IpcSecurityManager extends EventEmitter {
  private tokenManager: TokenManager
  private rateLimiter: RateLimiter
  private messageValidator: MessageValidationOptions

  constructor(options?: MessageValidationOptions) {
    super()
    this.tokenManager = new TokenManager()
    this.rateLimiter = new RateLimiter()
    this.messageValidator = options ?? {}
  }

  /** 启动安全管理器 */
  start(): void {
    this.tokenManager.start()
  }

  /** 停止安全管理器 */
  stop(): void {
    this.tokenManager.stop()
  }

  /** 处理收到的 IPC 消息 */
  processMessage(
    envelope: IpcEnvelope,
    connectionId: string,
  ): { accepted: boolean; error?: string } {
    // 1. 速率限制
    const rateResult = this.rateLimiter.check(connectionId)
    if (!rateResult.allowed) {
      this.emit('rate-limited', connectionId, rateResult)
      return { accepted: false, error: `速率限制: 请 ${rateResult.resetAfter}ms 后重试` }
    }

    // 2. Token 认证
    const authResult = this.tokenManager.validate(envelope.token)
    if (!authResult.authenticated) {
      this.emit('auth-failed', connectionId, authResult.error ?? '认证失败')
      return { accepted: false, error: authResult.error }
    }

    // 3. 消息校验
    const validation = validateIpcMessage(envelope, this.messageValidator)
    if (!validation.valid) {
      this.emit('validation-failed', connectionId, validation.error ?? '校验失败')
      return { accepted: false, error: validation.error }
    }

    return { accepted: true }
  }

  /** 获取当前认证 Token */
  getCurrentToken(): string {
    return this.tokenManager.getCurrentToken()
  }

  /** 获取 Token 指纹 */
  getTokenFingerprint(): string {
    return this.tokenManager.getTokenFingerprint()
  }

  /** 清除指定连接的速率记录 */
  clearConnection(connectionId: string): void {
    this.rateLimiter.clear(connectionId)
  }

  /** 销毁安全管理器 */
  destroy(): void {
    this.tokenManager.stop()
    this.rateLimiter.clearAll()
    this.removeAllListeners()
  }
}

// ============ 单例 ============

let ipcSecurityManager: IpcSecurityManager | null = null

/** 获取 IPC 安全管理器单例 */
export function getIpcSecurityManager(): IpcSecurityManager {
  if (!ipcSecurityManager) {
    ipcSecurityManager = new IpcSecurityManager()
  }
  return ipcSecurityManager
}

/** 重置 IPC 安全管理器 */
export function resetIpcSecurityManager(): void {
  if (ipcSecurityManager) {
    ipcSecurityManager.destroy()
    ipcSecurityManager = null
  }
}
