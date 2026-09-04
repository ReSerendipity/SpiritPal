import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateMemoryQuality } from '@/lib/memory/memoryQualityCheck'
import { runtimeMonitor } from '@/lib/system/runtimeMonitor'

// Mock stringSimilarity
vi.mock('@/lib/system/stringSimilarity', () => ({
  tokenize: vi.fn((s: string) => {
    // 按字符分割中文，按空格分割英文
    if (/[\u4e00-\u9fff]/.test(s)) {
      return Array.from(s).filter((c) => c.trim() && c !== '，' && c !== '。')
    }
    return s.toLowerCase().split(/\s+/).filter(Boolean)
  }),
  stringSimilarity: vi.fn((a: string, b: string) => {
    // 简化 Jaccard 相似度
    const setA = new Set(Array.from(a))
    const setB = new Set(Array.from(b))
    const intersection = new Set([...setA].filter((x) => setB.has(x)))
    const union = new Set([...setA, ...setB])
    return union.size > 0 ? intersection.size / union.size : 0
  }),
}))

// Mock runtimeMonitor
vi.mock('@/lib/system/runtimeMonitor', () => ({
  runtimeMonitor: {
    emitAlertProxy: vi.fn(),
  },
}))

describe('memoryQualityCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('evaluateMemoryQuality', () => {
    it('should pass for good summary', () => {
      const original = '今天我和主人聊了天气，主人说今天要下雨，带伞出门了。'
      const summary = '主人今天出门带伞，因为要下雨。'
      const result = evaluateMemoryQuality(original, summary)
      expect(result.passed).toBe(true)
      expect(result.overallScore).toBeGreaterThan(0.3)
    })

    it('should fail for empty summary', () => {
      const original = '这是一段对话记录'
      const summary = ''
      const result = evaluateMemoryQuality(original, summary)
      expect(result.passed).toBe(false)
      expect(result.issues.length).toBeGreaterThan(0)
    })

    it('should fail for too-long summary', () => {
      const original = '短对话'
      const summary = 'a'.repeat(100)
      const result = evaluateMemoryQuality(original, summary)
      expect(result.densityScore).toBeLessThan(1)
    })

    it('should detect low keyword coverage', () => {
      const original = '今天天气很好，我们去公园散步了，还买了冰淇淋'
      const summary = '好的知道了'
      const result = evaluateMemoryQuality(original, summary)
      expect(result.keywordCoverage).toBeLessThan(0.5)
      expect(result.passed).toBe(false)
    })

    it('should return all quality dimensions', () => {
      const original = '主人说今天加班，可能要很晚回家，让我先吃饭不用等他'
      const summary = '主人今天加班晚归，让我先吃饭。'
      const result = evaluateMemoryQuality(original, summary)
      expect(result).toHaveProperty('overallScore')
      expect(result).toHaveProperty('keywordCoverage')
      expect(result).toHaveProperty('semanticSimilarity')
      expect(result).toHaveProperty('densityScore')
      expect(result).toHaveProperty('hallucinationScore')
      expect(result).toHaveProperty('passed')
      expect(result).toHaveProperty('issues')
    })

    it('should emit alert when quality is low', () => {
      const original = '主人说今天加班'
      const summary = 'xyzabc123456789'
      evaluateMemoryQuality(original, summary)
      expect(runtimeMonitor.emitAlertProxy).toHaveBeenCalledWith(
        'memory_quality_low',
        expect.objectContaining({ issues: expect.any(Array) }),
      )
    })
  })
})
