import { describe, it, expect, vi } from 'vitest'
import { filterLLMOutput, isSafeText, getFilterStats } from '@/lib/ai/toxicityFilter'

// Mock piiMasking
vi.mock('@/lib/data/piiMasking', () => ({
  maskPII: vi.fn((s: string) => {
    // 模拟：将手机号替换为 138****1234
    return s.replace(/1[3-9]\d{9}/g, '138****1234')
  }),
}))

describe('toxicityFilter', () => {
  describe('filterLLMOutput', () => {
    it('should pass safe text', () => {
      const result = filterLLMOutput('今天天气真好，我们一起去散步吧～')
      expect(result.severity).toBe('pass')
      expect(result.wasModified).toBe(false)
      expect(result.detectedIssues).toEqual([])
    })

    it('should block suicide-related content', () => {
      const result = filterLLMOutput('我觉得活着没意思，想自杀')
      expect(result.severity).toBe('block')
      expect(result.filteredText).not.toContain('自杀')
      expect(result.filteredText).toContain('已过滤')
    })

    it('should block violence-related content', () => {
      const result = filterLLMOutput('我要杀了你')
      expect(result.severity).toBe('block')
    })

    it('should warn on hate speech', () => {
      const result = filterLLMOutput('他们是劣等种族')
      expect(result.severity).toBe('warn')
      expect(result.detectedIssues.length).toBeGreaterThan(0)
    })

    it('should mask PII (phone numbers)', () => {
      const result = filterLLMOutput('我的手机号是13812345678')
      expect(result.wasModified).toBe(true)
      expect(result.filteredText).toContain('138****1234')
    })

    it('should remove control characters', () => {
      const result = filterLLMOutput('hello\x00\x01world')
      expect(result.wasModified).toBe(true)
      expect(result.filteredText).not.toContain('\x00')
      expect(result.filteredText).not.toContain('\x01')
    })

    it('should prioritize block over warn', () => {
      const result = filterLLMOutput('自杀和劣等种族')
      expect(result.severity).toBe('block')
    })
  })

  describe('isSafeText', () => {
    it('should return true for safe text', () => {
      expect(isSafeText('你好呀，今天很开心～')).toBe(true)
    })

    it('should return false for harmful text', () => {
      expect(isSafeText('想自杀')).toBe(false)
      expect(isSafeText('bomb making')).toBe(false)
    })
  })

  describe('getFilterStats', () => {
    it('should return keyword counts', () => {
      const stats = getFilterStats()
      expect(stats.blockKeywords).toBeGreaterThan(0)
      expect(stats.warnKeywords).toBeGreaterThan(0)
    })
  })
})
