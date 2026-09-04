import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getQualityMonitor, resetQualityMonitor, type QualityRecord } from '@/lib/system/qualityMonitor'

// Mock analytics
vi.mock('@/lib/system/analytics', () => ({
  getAnalytics: () => ({
    track: vi.fn(),
    isEnabled: () => true,
  }),
}))

// Mock runtimeMonitor
vi.mock('@/lib/system/runtimeMonitor', () => ({
  runtimeMonitor: {
    emitAlertProxy: vi.fn(),
    startLLMCall: vi.fn(() => ({ id: 'mock', provider: 'test', startTime: 0 })),
    endLLMCall: vi.fn(),
  },
}))

// Mock invoke (Tauri)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri')),
}))

// Mock stringSimilarity
vi.mock('@/lib/system/stringSimilarity', () => ({
  stringSimilarity: vi.fn(() => 0.3),
  tokenize: vi.fn((s: string) => {
    // 模拟中文分词：按字符切分（简化版）
    if (/[\u4e00-\u9fff]/.test(s)) {
      return Array.from(s).filter((c) => c.trim())
    }
    return s.split(/\s+/).filter(Boolean)
  }),
}))

describe('QualityMonitor', () => {
  let monitor: ReturnType<typeof getQualityMonitor>

  beforeEach(() => {
    resetQualityMonitor()
    monitor = getQualityMonitor()
    monitor.clearRecords()
  })

  afterEach(() => {
    monitor.clearRecords()
  })

  describe('recordResponse', () => {
    it('should create a quality record with heuristic scores', () => {
      const id = monitor.recordResponse(
        'deepseek',
        'deepseek-chat',
        '你好',
        '你好呀！我是你的桌面宠物，很高兴见到你喵～',
        1500,
      )

      expect(id).toMatch(/^q_\d+_/)
      const records = monitor.getRecords()
      expect(records).toHaveLength(1)
      expect(records[0]!.provider).toBe('deepseek')
      expect(records[0]!.model).toBe('deepseek-chat')
      expect(records[0]!.implicitFeedback).toBe('pending')
      expect(records[0]!.overallScore).toBeGreaterThan(0)
      expect(records[0]!.overallScore).toBeLessThanOrEqual(1)
    })

    it('should compute length score correctly', () => {
      const id = monitor.recordResponse('test', 'model', 'hi', 'hi', 100)
      const record = monitor.getRecords()[0] as QualityRecord
      expect(record.dimensions.lengthScore).toBeLessThan(0.5) // too short
    })

    it('should compute safety score with high-risk keywords', () => {
      monitor.recordResponse('test', 'model', 'msg', '关于自杀的方法...', 100)
      const record = monitor.getRecords()[0] as QualityRecord
      expect(record.dimensions.safetyScore).toBeLessThan(0.3)
    })

    it('should compute safety score for normal text', () => {
      monitor.recordResponse('test', 'model', 'msg', '今天天气真好呀，我们去散步吧～', 100)
      const record = monitor.getRecords()[0] as QualityRecord
      expect(record.dimensions.safetyScore).toBe(1.0)
    })

    it('should compute format score with control characters', () => {
      monitor.recordResponse('test', 'model', 'msg', '好的\x00\x01\x02', 100)
      const record = monitor.getRecords()[0] as QualityRecord
      expect(record.dimensions.formatScore).toBeLessThan(1.0)
    })

    it('should compute format score for clean text', () => {
      monitor.recordResponse('test', 'model', 'msg', '好的，我知道了喵～', 100)
      const record = monitor.getRecords()[0] as QualityRecord
      expect(record.dimensions.formatScore).toBe(1.0)
    })

    it('should truncate previews', () => {
      const longMessage = 'a'.repeat(200)
      const longResponse = 'b'.repeat(300)
      monitor.recordResponse('test', 'model', longMessage, longResponse, 100)
      const record = monitor.getRecords()[0] as QualityRecord
      expect(record.userMessagePreview.length).toBeLessThanOrEqual(100)
      expect(record.responsePreview.length).toBeLessThanOrEqual(200)
    })
  })

  describe('recordUserAction', () => {
    it('should mark as continued when user sends another message', () => {
      const id = monitor.recordResponse('test', 'model', '你好你好你好', '你好呀喵～', 100)
      monitor.recordUserAction(id, 'message', '你好你好的')
      const record = monitor.getRecords().find((r) => r.id === id) as QualityRecord
      expect(record.implicitFeedback).toBe('continued')
      expect(record.dimensions.implicitFeedbackScore).toBe(1.0)
    })

    it('should mark as dropped when user closes', () => {
      const id = monitor.recordResponse('test', 'model', '你好', '你好呀喵～', 100)
      monitor.recordUserAction(id, 'close')
      const record = monitor.getRecords().find((r) => r.id === id) as QualityRecord
      expect(record.implicitFeedback).toBe('dropped')
      expect(record.dimensions.implicitFeedbackScore).toBeLessThan(0.2)
    })

    it('should mark previous record as continued when new response recorded', () => {
      const id1 = monitor.recordResponse('test', 'model', '你好', '你好呀喵～', 100)
      monitor.recordResponse('test', 'model', '再聊', '好的继续聊～', 100)
      const record1 = monitor.getRecords().find((r) => r.id === id1) as QualityRecord
      expect(record1.implicitFeedback).toBe('continued')
    })
  })

  describe('getTrend', () => {
    it('should return empty trend for no records', () => {
      const trend = monitor.getTrend()
      expect(trend.totalEvaluations).toBe(0)
      expect(trend.avgScore).toBe(0)
    })

    it('should compute trend statistics', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordResponse('test', 'model', `msg${i}`, `这是一段很好的回复${i}`, 100 + i * 100)
      }
      const trend = monitor.getTrend()
      expect(trend.totalEvaluations).toBe(5)
      expect(trend.avgScore).toBeGreaterThan(0)
      expect(trend.avgScore).toBeLessThanOrEqual(1)
      expect(trend.recentScores).toHaveLength(5)
    })
  })

  describe('clearRecords', () => {
    it('should clear all records', () => {
      monitor.recordResponse('test', 'model', 'msg', 'response', 100)
      expect(monitor.getRecords()).toHaveLength(1)
      monitor.clearRecords()
      expect(monitor.getRecords()).toHaveLength(0)
    })
  })
})
