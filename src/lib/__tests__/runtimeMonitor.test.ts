/**
 * @file runtimeMonitor.test.ts
 * @description runtimeMonitor 单元测试 — FPS/内存/LLM延迟监控
 *
 * 注意：jsdom 环境中没有 requestAnimationFrame 和 performance.memory，
 * 需要使用 vitest 模拟这些 API。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RuntimeMonitor, runtimeMonitor, withLLMMonitoring } from '../runtimeMonitor'

describe('RuntimeMonitor', () => {
  let monitor: RuntimeMonitor
  let rafCallbacks: Array<FrameRequestCallback> = []
  let rafId = 0

  beforeEach(() => {
    vi.useFakeTimers()
    rafCallbacks = []
    rafId = 0

    // 模拟 requestAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb)
      return ++rafId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    monitor = new RuntimeMonitor()
  })

  afterEach(() => {
    monitor.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('初始状态返回默认快照', () => {
    const snap = monitor.getSnapshot()
    expect(snap.fps.fps).toBe(60)
    expect(snap.llm.totalCalls).toBe(0)
    expect(snap.uptime).toBe(0)
    expect(snap.timestamp).toBeGreaterThan(0)
  })

  it('start/stop 幂等调用不报错', () => {
    monitor.start()
    monitor.start() // 第二次调用应无副作用
    expect(monitor['started']).toBe(true)
    monitor.stop()
    monitor.stop() // 第二次调用应无副作用
    expect(monitor['started']).toBe(false)
  })

  it('start 后 uptime 递增', () => {
    monitor.start()
    vi.advanceTimersByTime(1000)
    const snap = monitor.getSnapshot()
    expect(snap.uptime).toBeGreaterThan(900)
  })

  describe('LLM 延迟监控', () => {
    it('记录 LLM 调用延迟', () => {
      const handle = monitor.startLLMCall('openai')
      vi.advanceTimersByTime(500)
      const latency = monitor.endLLMCall(handle)

      expect(latency).toBeGreaterThanOrEqual(500)
      const metrics = monitor.getLLMMetrics()
      expect(metrics.totalCalls).toBe(1)
      expect(metrics.avgLatency).toBeGreaterThanOrEqual(500)
      expect(metrics.errorRate).toBe(0)
    })

    it('记录 LLM 错误调用', () => {
      const handle = monitor.startLLMCall('ollama')
      vi.advanceTimersByTime(200)
      monitor.endLLMCall(handle, true)

      const metrics = monitor.getLLMMetrics()
      expect(metrics.totalCalls).toBe(1)
      expect(metrics.errorRate).toBe(1)
      expect(metrics.recentLatencies).toHaveLength(0) // 错误不计入延迟
    })

    it('计算 P95 延迟', () => {
      for (let i = 0; i < 20; i++) {
        const h = monitor.startLLMCall('test')
        vi.advanceTimersByTime(100 + i * 50)
        monitor.endLLMCall(h)
      }

      const metrics = monitor.getLLMMetrics()
      expect(metrics.totalCalls).toBe(20)
      expect(metrics.maxLatency).toBeGreaterThan(metrics.avgLatency)
      expect(metrics.p95Latency).toBeGreaterThanOrEqual(metrics.avgLatency)
    })

    it('未开始的句柄返回 -1', () => {
      const result = monitor.endLLMCall({ id: 'nonexistent', provider: 'x', startTime: 0 })
      expect(result).toBe(-1)
    })
  })

  describe('withLLMMonitoring 包装器', () => {
    it('成功调用时记录延迟', async () => {
      const fn = vi.fn().mockResolvedValue('result')
      const wrapped = withLLMMonitoring('test', fn)

      const result = await wrapped('arg1')
      expect(result).toBe('result')
      expect(fn).toHaveBeenCalledWith('arg1')
    })

    it('失败调用时记录错误', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'))
      const wrapped = withLLMMonitoring('test', fn)

      await expect(wrapped()).rejects.toThrow('fail')
    })
  })

  describe('告警', () => {
    it('onAlert 注册和触发', () => {
      const handler = vi.fn()
      const off = monitor.onAlert(handler)

      // 直接通过 emitAlert 触发（测试内部方法）
      monitor['emitAlert']('test_alert', { key: 'value' })
      expect(handler).toHaveBeenCalledWith('test_alert', { key: 'value' })

      off()
      monitor['emitAlert']('test_alert', { key: 'value2' })
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('reset', () => {
    it('重置所有指标', () => {
      monitor.start()
      const h = monitor.startLLMCall('test')
      monitor.endLLMCall(h)
      monitor.reset()

      const snap = monitor.getSnapshot()
      expect(snap.llm.totalCalls).toBe(0)
      expect(snap.llm.recentLatencies).toHaveLength(0)
      expect(snap.fps.fps).toBe(60)
    })
  })
})

describe('runtimeMonitor 单例', () => {
  it('导出为 RuntimeMonitor 实例', () => {
    expect(runtimeMonitor).toBeInstanceOf(RuntimeMonitor)
  })
})
