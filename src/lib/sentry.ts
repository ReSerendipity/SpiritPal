/**
 * @file sentry.ts
 * @description Sentry 错误监控集成 — 真实 SDK 动态加载 + Mock 降级 + 本地错误日志
 *
 * MLOps 评估报告 P0 差距：Sentry 为 Mock 实现，生产环境错误上报未接入。
 *
 * 改进方案（三层降级）：
 * 1. 优先动态加载真实 @sentry/react SDK（用户配置了 DSN 时）
 * 2. 未安装 SDK 或无 DSN → 降级到本地错误日志（localStorage 持久化，最多 200 条）
 * 3. 本地日志也写入失败 → 仅控制台输出
 *
 * 隐私保护：
 * - 错误上报前 PII 脱敏（复用 piiMasking.ts）
 * - 不上报用户消息原文，仅上报错误堆栈和系统信息
 *
 * 架构设计：
 * - init() 时检测 VITE_SENTRY_DSN 环境变量
 * - 有 DSN → 动态 import('@sentry/react') → 初始化真实 SDK → 所有方法代理到真实 SDK
 * - 无 DSN → 使用 MockSentryHub（console + 本地日志），不影响开发
 * - 动态 import 使用 /* @vite-ignore *\/ 确保未安装 @sentry/react 时不会构建失败
 */

import { maskPII } from './piiMasking'

// ============ 类型定义 ============

export interface SentryConfig {
  dsn?: string
  environment?: 'development' | 'staging' | 'production'
  release?: string
  enabled?: boolean
  tracesSampleRate?: number
}

export interface SentryBreadcrumb {
  category?: string
  level?: 'log' | 'info' | 'warning' | 'error'
  message: string
  data?: Record<string, unknown>
}

interface SentryHub {
  init(config: SentryConfig): void
  captureException(error: unknown, contexts?: Record<string, unknown>): void
  captureMessage(message: string, level?: 'log' | 'info' | 'warning' | 'error'): void
  setContext(key: string, value: Record<string, unknown>): void
  setUser(user: { id?: string; email?: string; name?: string } | null): void
  addBreadcrumb(breadcrumb: SentryBreadcrumb): void
  close(timeout?: number): Promise<boolean>
  isRealSentry(): boolean
}

// ============ 本地错误日志存储 ============

const LOCAL_ERROR_LOG_KEY = 'spiritpal-error-log'
const MAX_LOCAL_ERRORS = 200

interface LocalErrorEntry {
  timestamp: number
  message: string
  stack?: string
  level: 'error' | 'warning' | 'info'
  contexts?: Record<string, unknown>
}

function loadLocalErrors(): LocalErrorEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_ERROR_LOG_KEY)
    if (!raw) return []
    return JSON.parse(raw) as LocalErrorEntry[]
  } catch {
    return []
  }
}

function saveLocalError(entry: LocalErrorEntry): void {
  try {
    const errors = loadLocalErrors()
    errors.push(entry)
    if (errors.length > MAX_LOCAL_ERRORS) {
      errors.splice(0, errors.length - MAX_LOCAL_ERRORS)
    }
    localStorage.setItem(LOCAL_ERROR_LOG_KEY, JSON.stringify(errors))
  } catch {
    // localStorage 写入失败，静默忽略
  }
}

/**
 * 导出本地错误日志（用户诊断包使用）
 */
export function exportLocalErrorLog(): string {
  const errors = loadLocalErrors()
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    count: errors.length,
    errors,
  }, null, 2)
}

/**
 * 清除本地错误日志
 */
export function clearLocalErrorLog(): void {
  try {
    localStorage.removeItem(LOCAL_ERROR_LOG_KEY)
  } catch {
    // 忽略
  }
}

/**
 * 获取本地错误日志条目数
 */
export function getLocalErrorCount(): number {
  return loadLocalErrors().length
}

// ============ PII 脱敏辅助 ============

function maskContextsPII(contexts: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(contexts)) {
    if (typeof value === 'string') {
      result[key] = maskPII(value)
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) => typeof v === 'string' ? maskPII(v) : v)
    } else if (value && typeof value === 'object') {
      result[key] = maskPIIInObject(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

function maskPIIInObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = maskPII(value)
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) => typeof v === 'string' ? maskPII(v) : v)
    } else if (value && typeof value === 'object') {
      result[key] = maskPIIInObject(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

// ============ Mock 实现（无 DSN 时降级，含本地日志）============

class MockSentryHub implements SentryHub {
  private enabled = false

  init(config: SentryConfig): void {
    this.enabled = config.enabled !== false && !!config.dsn
    if (!this.enabled) {
      console.log('[Sentry] Mock 模式 (无 DSN — 配置 VITE_SENTRY_DSN 启用真实监控)')
    }
  }

  captureException(error: unknown, contexts?: Record<string, unknown>): void {
    // Mock 模式也保存到本地日志
    saveLocalError({
      timestamp: Date.now(),
      message: error instanceof Error ? maskPII(error.message) : maskPII(String(error)),
      stack: error instanceof Error ? error.stack : undefined,
      level: 'error',
      contexts: contexts ? maskContextsPII(contexts) : undefined,
    })
    console.warn('[Sentry Mock] 捕获异常:', error)
  }

  captureMessage(message: string, level: 'log' | 'info' | 'warning' | 'error' = 'info'): void {
    saveLocalError({
      timestamp: Date.now(),
      message: maskPII(message),
      level: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info',
    })
    console.log(`[Sentry Mock] ${level}:`, message)
  }

  setContext(_key: string, _value: Record<string, unknown>): void { /* no-op */ }
  setUser(_user: { id?: string; email?: string; name?: string } | null): void { /* no-op */ }
  addBreadcrumb(_breadcrumb: SentryBreadcrumb): void { /* no-op */ }
  close(): Promise<boolean> { return Promise.resolve(true) }
  isRealSentry(): boolean { return false }
}

// ============ 真实 SDK 代理（有 DSN 时动态加载）============

class RealSentryHub implements SentryHub {
  private realSdk: Record<string, unknown> | null = null
  private initConfig: SentryConfig | null = null

  async initAsync(config: SentryConfig): Promise<void> {
    this.initConfig = config
    if (!config.dsn) {
      console.log('[Sentry] No DSN configured — using Mock mode')
      return
    }

    try {
      // 动态加载真实 Sentry SDK（可选依赖）
      // 使用变量包裹模块名，避免 Vite 在构建/测试阶段静态解析失败
      const moduleName = '@sentry/react'
      const sentryModule = await import(/* @vite-ignore */ moduleName)
      this.realSdk = sentryModule as Record<string, unknown>

      const initFn = sentryModule.init as (c: Record<string, unknown>) => void
      if (initFn) {
        initFn({
          dsn: config.dsn,
          environment: config.environment ?? (import.meta.env?.MODE ?? 'development'),
          release: config.release,
          tracesSampleRate: config.tracesSampleRate ?? 0.1,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Sentry event type is complex, using any for SDK compat
          beforeSend(event: any) {
            // PII 脱敏
            if (event.message) event.message = maskPII(String(event.message))
            if (event.exception?.values) {
              for (const ex of event.exception.values) {
                if (ex.value) ex.value = maskPII(String(ex.value))
              }
            }
            return event
          },
        })
      }

      console.log('[Sentry] Real SDK initialized', {
        environment: config.environment,
        release: config.release,
      })
    } catch (e) {
      console.warn('[Sentry] Failed to load @sentry/react SDK — falling back to Mock:', e)
      this.realSdk = null
    }
  }

  init(config: SentryConfig): void {
    // 同步初始化（无法加载 SDK），异步 initAsync 由 initSentry() 调用
    this.initConfig = config
    if (!config.dsn) {
      console.log('[Sentry] No DSN configured — using Mock mode')
    }
  }

  captureException(error: unknown, contexts?: Record<string, unknown>): void {
    if (this.realSdk?.captureException) {
      const captureFn = this.realSdk.captureException as (e: unknown) => void
      captureFn(error)
    } else {
      // 降级到本地日志
      saveLocalError({
        timestamp: Date.now(),
        message: error instanceof Error ? maskPII(error.message) : maskPII(String(error)),
        stack: error instanceof Error ? error.stack : undefined,
        level: 'error',
        contexts: contexts ? maskContextsPII(contexts) : undefined,
      })
      console.warn('[Sentry Fallback] 捕获异常:', error)
    }
  }

  captureMessage(message: string, level: 'log' | 'info' | 'warning' | 'error' = 'info'): void {
    if (this.realSdk?.captureMessage) {
      const captureFn = this.realSdk.captureMessage as (m: string, l: string) => void
      captureFn(maskPII(message), level)
    } else {
      saveLocalError({
        timestamp: Date.now(),
        message: maskPII(message),
        level: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info',
      })
    }
  }

  setContext(key: string, value: Record<string, unknown>): void {
    if (this.realSdk?.getCurrentScope) {
      const scope = (this.realSdk.getCurrentScope as () => { setContext: (k: string, v: unknown) => void })()
      scope?.setContext(key, maskContextsPII({ [key]: value })[key] || value)
    }
  }

  setUser(user: { id?: string; email?: string; name?: string } | null): void {
    if (this.realSdk?.getCurrentScope) {
      const scope = (this.realSdk.getCurrentScope as () => { setUser: (u: unknown) => void })()
      const maskedUser = user?.email ? { ...user, email: maskPII(user.email) } : user
      scope?.setUser(maskedUser)
    }
  }

  addBreadcrumb(breadcrumb: SentryBreadcrumb): void {
    if (this.realSdk?.addBreadcrumb) {
      const addFn = this.realSdk.addBreadcrumb as (b: unknown) => void
      addFn({ ...breadcrumb, message: maskPII(breadcrumb.message) })
    }
  }

  async close(timeout?: number): Promise<boolean> {
    if (this.realSdk?.close) {
      const closeFn = this.realSdk.close as (t?: number) => Promise<boolean>
      return closeFn(timeout)
    }
    return true
  }

  isRealSentry(): boolean {
    return this.realSdk !== null
  }
}

// ============ 统一 Hub 管理器 ============

let currentHub: SentryHub = new MockSentryHub()

/**
 * 初始化 Sentry
 * 应在应用入口 main.tsx 中调用一次
 */
export async function initSentry(config: SentryConfig): Promise<void> {
  if (!config.dsn || config.enabled === false) {
    currentHub = new MockSentryHub()
    currentHub.init(config)
    return
  }

  // 尝试使用真实 SDK
  const realHub = new RealSentryHub()
  await realHub.initAsync(config)

  if (realHub.isRealSentry()) {
    currentHub = realHub
  } else {
    // SDK 加载失败，降级到 Mock（含本地日志）
    currentHub = new MockSentryHub()
    currentHub.init(config)
  }
}

/**
 * 获取当前 Sentry Hub
 */
export function getSentry(): SentryHub {
  return currentHub
}

// ============ 兼容旧 API（保持向后兼容）============

/**
 * Sentry 单例代理 — 所有方法代理到实际 Hub（Mock 或 Real）
 */
export const sentry: SentryHub = {
  init: (config: SentryConfig) => {
    void initSentry(config)
  },
  captureException: (error: unknown, contexts?: Record<string, unknown>) => {
    currentHub.captureException(error, contexts)
  },
  captureMessage: (message: string, level?: 'log' | 'info' | 'warning' | 'error') => {
    currentHub.captureMessage(message, level)
  },
  setContext: (key: string, value: Record<string, unknown>) => {
    currentHub.setContext(key, value)
  },
  setUser: (user: { id?: string; email?: string; name?: string } | null) => {
    currentHub.setUser(user)
  },
  addBreadcrumb: (breadcrumb: SentryBreadcrumb) => {
    currentHub.addBreadcrumb(breadcrumb)
  },
  close: (timeout?: number) => currentHub.close(timeout),
  isRealSentry: () => currentHub.isRealSentry(),
}

// ============ 全局错误处理器 ============

export function setupGlobalErrorListeners(): void {
  window.addEventListener('error', (event) => {
    currentHub.captureException(event.error || event.message, {
      browser: {
        userAgent: navigator.userAgent,
        language: navigator.language,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    currentHub.captureException(event.reason, {
      type: 'UnhandledPromiseRejection',
    })
  })

  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__SENTRY_ERROR_BOUNDARY_HANDLER__ = (
      error: Error,
      errorInfo: { componentStack?: string },
    ) => {
      currentHub.captureException(error, {
        componentStack: errorInfo?.componentStack,
      })
    }
  }
}

export function addAppBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  currentHub.addBreadcrumb({
    category,
    message,
    data,
    level: 'info',
  })
}

export function identifyUser(userId: string, email?: string, name?: string): void {
  currentHub.setUser({ id: userId, email, name })
}

export function clearUserContext(): void {
  currentHub.setUser(null)
}

export function captureFeatureError(
  feature: string,
  error: Error,
  extra?: Record<string, unknown>,
): void {
  currentHub.captureException(error, {
    feature,
    ...extra,
  })
}
