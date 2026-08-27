/**
 * @file tauriInvoker.ts
 * @description Tauri invoke 统一封装 — 超时控制 + 错误处理 + 自动重试
 *
 * 评估报告 P1-1：AGENTS.md §3.2 设计了 tauriInvoker.ts（超时 30s + retry 1 次），
 * 但实际文件缺失，所有调用方直接 import { invoke } 绕过封装。
 * 本模块提供统一入口，后续可逐步替换散落的直接 invoke 调用。
 *
 * 核心接口：
 * - tauriInvoke<T>(): 带超时 + 重试的 invoke 封装
 * - tauriInvokeNoRetry<T>(): 仅超时、不重试（用于非幂等操作）
 *
 * 安全机制：
 * - 30 秒默认超时（防止 IPC 挂起导致 UI 冻结）
 * - 网络类错误自动重试 1 次（仅对幂等操作）
 * - 非幂等操作（写入/删除）不重试
 *
 * @module tauriInvoker
 * @requires @tauri-apps/api/core
 */

import { invoke } from '@tauri-apps/api/core'

// ============ 配置常量 ============

/** 默认超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000

/** 默认重试次数（仅对幂等操作） */
const DEFAULT_RETRY_COUNT = 1

/** 重试延迟（毫秒） */
const RETRY_DELAY_MS = 500

// ============ 类型定义 ============

/** 超时错误标记 */
export class IpcTimeoutError extends Error {
  readonly command: string
  readonly timeoutMs: number

  constructor(command: string, timeoutMs: number) {
    super(`IPC 超时: 命令 "${command}" 在 ${timeoutMs}ms 内未响应`)
    this.name = 'IpcTimeoutError'
    this.command = command
    this.timeoutMs = timeoutMs
  }
}

/** 重试耗尽错误 */
export class IpcRetryExhaustedError extends Error {
  readonly command: string
  readonly attempts: number
  readonly lastError: string

  constructor(command: string, attempts: number, lastError: string) {
    super(`IPC 重试耗尽: 命令 "${command}" 重试 ${attempts} 次后仍失败 (最后错误: ${lastError})`)
    this.name = 'IpcRetryExhaustedError'
    this.command = command
    this.attempts = attempts
    this.lastError = lastError
  }
}

// ============ 核心：带超时的 invoke ============

/**
 * 创建一个超时 Promise，在指定毫秒后 reject
 */
function createTimeout<T>(ms: number, command: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new IpcTimeoutError(command, ms)), ms)
  })
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 判断错误是否值得重试（网络/超时类错误）
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof IpcTimeoutError) return true
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    // 网络错误、连接断开等可重试
    return msg.includes('network') || msg.includes('connection') || msg.includes('timeout')
  }
  return false
}

// ============ 公共 API ============

/**
 * 带超时的 invoke（不重试）
 *
 * 适用于非幂等操作（写入、删除等）。
 *
 * @param command 命令名
 * @param args 参数对象
 * @param timeoutMs 超时毫秒（默认 30 秒）
 * @returns Promise<T>
 * @throws IpcTimeoutError 超时
 * @throws Error 命令执行失败
 */
export async function tauriInvokeNoRetry<T>(
  command: string,
  args?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const invokePromise = invoke<T>(command, args)
  const timeoutPromise = createTimeout<T>(timeoutMs, command)
  return Promise.race([invokePromise, timeoutPromise])
}

/**
 * 带超时 + 自动重试的 invoke
 *
 * 适用于幂等操作（读取、查询等）。非幂等操作请用 tauriInvokeNoRetry。
 *
 * 重试策略：
 * - 首次调用失败且错误可重试（超时/网络错误）→ 延迟 RETRY_DELAY_MS 后重试 1 次
 * - 第二次仍失败 → 抛出 IpcRetryExhaustedError
 * - 非可重试错误（如参数校验失败）→ 直接抛出，不重试
 *
 * @param command 命令名
 * @param args 参数对象
 * @param options 可选配置
 * @returns Promise<T>
 * @throws IpcTimeoutError 超时
 * @throws IpcRetryExhaustedError 重试耗尽
 * @throws Error 其他错误
 */
export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: {
    timeoutMs?: number
    retryCount?: number
  },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options?.retryCount ?? DEFAULT_RETRY_COUNT

  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await tauriInvokeNoRetry<T>(command, args, timeoutMs)
    } catch (error) {
      lastError = error

      // 最后一次尝试或错误不可重试 → 直接抛出
      if (attempt >= maxRetries || !isRetryableError(error)) {
        if (attempt >= maxRetries && isRetryableError(error)) {
          throw new IpcRetryExhaustedError(command, maxRetries + 1, String(error))
        }
        throw error
      }

      // 可重试错误且非最后一次 → 延迟后重试
      await delay(RETRY_DELAY_MS)
    }
  }

  // 理论上不会走到这里（循环已覆盖所有分支）
  throw new IpcRetryExhaustedError(command, maxRetries + 1, String(lastError))
}
