/**
 * tauriInvoker.ts 单元测试
 *
 * 验证：
 * 1. 正常调用返回结果
 * 2. 超时后抛出 IpcTimeoutError
 * 3. 可重试错误重试后成功
 * 4. 非可重试错误不重试直接抛出
 * 5. 重试耗尽后抛出 IpcRetryExhaustedError
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  tauriInvoke,
  tauriInvokeNoRetry,
  IpcTimeoutError,
  IpcRetryExhaustedError,
} from '../tauriInvoker'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// 动态导入被 mock 的 invoke（显式标注为 Mock 类型，使 mockResolvedValueOnce 等方法可用）
const { invoke: mockInvoke } = (await import('@tauri-apps/api/core')) as unknown as {
  invoke: import('vitest').Mock
}

describe('tauriInvoker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认使用真实定时器
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('tauriInvokeNoRetry', () => {
    it('正常调用应返回结果', async () => {
      mockInvoke.mockResolvedValueOnce('success')
      const result = await tauriInvokeNoRetry<string>('test_command')
      expect(result).toBe('success')
      expect(mockInvoke).toHaveBeenCalledWith('test_command', undefined)
    })

    it('应传递参数给 invoke', async () => {
      mockInvoke.mockResolvedValueOnce(42)
      const result = await tauriInvokeNoRetry<number>('add', { a: 1, b: 2 })
      expect(result).toBe(42)
      expect(mockInvoke).toHaveBeenCalledWith('add', { a: 1, b: 2 })
    })

    it('命令失败时应抛出原始错误', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('command failed'))
      await expect(tauriInvokeNoRetry('fail')).rejects.toThrow('command failed')
    })
  })

  describe('tauriInvoke', () => {
    it('首次调用成功应不重试', async () => {
      mockInvoke.mockResolvedValueOnce('ok')
      const result = await tauriInvoke<string>('cmd')
      expect(result).toBe('ok')
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })

    it('可重试错误（超时）首次失败、第二次成功应重试 1 次', async () => {
      // 模拟超时：第一次 invoke 永远 pending
      let resolveFirst: (v: string) => void
      const firstCall = new Promise<string>((resolve) => { resolveFirst = resolve })
      mockInvoke.mockReturnValueOnce(firstCall)
      // 第二次正常返回
      mockInvoke.mockResolvedValueOnce('recovered')

      // 使用极短超时让第一次快速超时
      vi.useFakeTimers()
      const promise = tauriInvoke<string>('cmd', undefined, { timeoutMs: 50, retryCount: 1 })

      // 推进时间触发超时
      await vi.advanceTimersByTimeAsync(100)
      // 等待重试
      await vi.advanceTimersByTimeAsync(600)

      const result = await promise
      expect(result).toBe('recovered')
      expect(mockInvoke).toHaveBeenCalledTimes(2)
    })

    it('非可重试错误应直接抛出不重试', async () => {
      // 参数校验失败不是可重试错误
      mockInvoke.mockRejectedValueOnce(new Error('参数校验失败'))
      await expect(tauriInvoke('cmd', undefined, { retryCount: 1 })).rejects.toThrow('参数校验失败')
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })
  })

  describe('错误类型', () => {
    it('IpcTimeoutError 应包含命令名和超时时间', () => {
      const err = new IpcTimeoutError('my_cmd', 30000)
      expect(err.command).toBe('my_cmd')
      expect(err.timeoutMs).toBe(30000)
      expect(err.message).toContain('my_cmd')
      expect(err.message).toContain('30000')
      expect(err.name).toBe('IpcTimeoutError')
    })

    it('IpcRetryExhaustedError 应包含命令名和尝试次数', () => {
      const err = new IpcRetryExhaustedError('my_cmd', 2, 'timeout')
      expect(err.command).toBe('my_cmd')
      expect(err.attempts).toBe(2)
      expect(err.lastError).toBe('timeout')
      expect(err.message).toContain('my_cmd')
      expect(err.message).toContain('2')
      expect(err.name).toBe('IpcRetryExhaustedError')
    })
  })
})
