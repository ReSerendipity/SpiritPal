import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LatencySLOManager, DEFAULT_SLO_CONFIG, resetLatencySLOManager } from '@/lib/system/latencySLO'

// Mock runtimeMonitor
vi.mock('@/lib/system/runtimeMonitor', () => {
  let mockLatencies: number[] = []
  let mockErrors = 0
  let mockTotalCalls = 0

  return {
    runtimeMonitor: {
      getLLMMetrics: () => ({
        totalCalls: mockTotalCalls,
        avgLatency: mockLatencies.length > 0
          ? Math.round(mockLatencies.reduce((a, b) => a + b, 0) / mockLatencies.length)
          : 0,
        p95Latency: mockLatencies.length > 0
          ? Math.round([...mockLatencies].sort((a, b) => a - b)[Math.floor(mockLatencies.length * 0.95)] ?? mockLatencies[mockLatencies.length - 1]!)
          : 0,
        maxLatency: mockLatencies.length > 0 ? Math.max(...mockLatencies) : 0,
        recentLatencies: [...mockLatencies],
        errorRate: mockTotalCalls > 0 ? mockErrors / mockTotalCalls : 0,
      }),
      // 测试辅助：设置模拟延迟数据
      _setMockLatencies: (latencies: number[]) => { mockLatencies = latencies; mockTotalCalls = latencies.length },
      _reset: () => { mockLatencies = []; mockErrors = 0; mockTotalCalls = 0 },
      start: vi.fn(),
      stop: vi.fn(),
      startLLMCall: vi.fn(),
      endLLMCall: vi.fn(),
      emitAlertProxy: vi.fn(),
    },
  }
})

import { runtimeMonitor } from '@/lib/system/runtimeMonitor'

describe('LatencySLOManager', () => {
  let manager: LatencySLOManager

  beforeEach(() => {
    resetLatencySLOManager()
    ;(runtimeMonitor as any)._reset()
    manager = new LatencySLOManager({
      ...DEFAULT_SLO_CONFIG,
      p95ThresholdMs: 5000,
      p95CriticalMs: 10000,
      p95RecoveryMs: 3000,
      minSampleSize: 5,
      minDegradeDurationMs: 0, // 测试中不设最小保持时间
    }, 'gpt-4')
  })

  afterEach(() => {
    ;(runtimeMonitor as any)._reset()
  })

  describe('evaluate', () => {
    it('should stay at level 0 when latency is normal', () => {
      ;(runtimeMonitor as any)._setMockLatencies([1000, 1100, 1200, 1300, 1400])
      const state = manager.evaluate()
      expect(state.degradationLevel).toBe(0)
      expect(state.isDegraded).toBe(false)
      expect(state.activeModel).toBe('gpt-4')
    })

    it('should degrade to level 1 when P95 exceeds threshold', () => {
      ;(runtimeMonitor as any)._setMockLatencies([6000, 6100, 6200, 6300, 6400])
      const state = manager.evaluate()
      expect(state.degradationLevel).toBe(1)
      expect(state.isDegraded).toBe(true)
      expect(state.activeModel).toBe(DEFAULT_SLO_CONFIG.degradedModel)
    })

    it('should degrade to level 2 when P95 exceeds critical', () => {
      ;(runtimeMonitor as any)._setMockLatencies([11000, 11100, 11200, 11300, 11400])
      const state = manager.evaluate()
      expect(state.degradationLevel).toBe(2)
      expect(state.isDegraded).toBe(true)
      expect(state.activeModel).toBe(DEFAULT_SLO_CONFIG.fallbackModel)
    })

    it('should recover when latency drops below recovery threshold', () => {
      // 先降级
      ;(runtimeMonitor as any)._setMockLatencies([6000, 6100, 6200, 6300, 6400])
      manager.evaluate()
      expect(manager.getState().degradationLevel).toBe(1)

      // 恢复
      ;(runtimeMonitor as any)._setMockLatencies([1000, 1100, 1200, 1300, 1400])
      const state = manager.evaluate()
      expect(state.degradationLevel).toBe(0)
      expect(state.isDegraded).toBe(false)
      expect(state.activeModel).toBe('gpt-4')
    })

    it('should not evaluate with insufficient samples', () => {
      ;(runtimeMonitor as any)._setMockLatencies([100, 200])
      const state = manager.evaluate()
      expect(state.degradationLevel).toBe(0)
      expect(state.currentP95).toBeGreaterThan(0) // still reads P95
    })
  })

  describe('hysteresis', () => {
    it('should not switch back immediately after degrading', () => {
      const mgr = new LatencySLOManager({
        ...DEFAULT_SLO_CONFIG,
        p95ThresholdMs: 5000,
        p95CriticalMs: 10000,
        p95RecoveryMs: 3000,
        minSampleSize: 3,
        minDegradeDurationMs: 60000, // 60s minimum
      }, 'gpt-4')

      // 降级
      ;(runtimeMonitor as any)._setMockLatencies([6000, 6100, 6200])
      mgr.evaluate()
      expect(mgr.getState().degradationLevel).toBe(1)

      // 延迟恢复但仍在保持期内 → 不切换
      ;(runtimeMonitor as any)._setMockLatencies([1000, 1100, 1200])
      const state = mgr.evaluate()
      expect(state.degradationLevel).toBe(1) // 仍保持降级
    })
  })

  describe('getActiveModel', () => {
    it('should return original model when not degraded', () => {
      ;(runtimeMonitor as any)._setMockLatencies([1000, 1100, 1200, 1300, 1400])
      manager.evaluate()
      expect(manager.getActiveModel()).toBe('gpt-4')
    })
  })

  describe('reset', () => {
    it('should reset to initial state', () => {
      ;(runtimeMonitor as any)._setMockLatencies([6000, 6100, 6200, 6300, 6400])
      manager.evaluate()
      expect(manager.getState().isDegraded).toBe(true)

      manager.reset()
      const state = manager.getState()
      expect(state.degradationLevel).toBe(0)
      expect(state.isDegraded).toBe(false)
    })
  })
})
