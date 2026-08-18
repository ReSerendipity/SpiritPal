// enhancedMemory 纯函数测试 — stringSimilarity / tokenize / estimateTokens
// 从 enhancedMemory.test.ts 拆分（审计 P1-6 God Test 拆分）
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'decrypt_data') return Promise.resolve('{}')
    if (cmd === 'encrypt_data') return Promise.resolve(JSON.stringify({}))
    return Promise.resolve('')
  }),
}))

vi.mock('../db', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
  addMemory: vi.fn(() => Promise.resolve(1)),
  saveEmbedding: vi.fn(() => Promise.resolve()),
  getAllEmbeddings: vi.fn(() => Promise.resolve([])),
  updateMemoryLastAccessed: vi.fn(() => Promise.resolve()),
  clearMemories: vi.fn(() => Promise.resolve()),
}))

vi.mock('../vectorSearch', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array([0.1, 0.2, 0.3]))),
  cosineSimilarity: vi.fn(() => 0.8),
  isVectorSearchAvailable: vi.fn(() => Promise.resolve(false)),
  searchSimilar: vi.fn(() => [{ id: 1, score: 0.8 }]),
}))

import { stringSimilarity, tokenize, estimateTokens } from '../enhancedMemory'

describe('enhancedMemory 纯函数', () => {
  describe('stringSimilarity', () => {
    it('两个空字符串相似度为 1', () => {
      expect(stringSimilarity('', '')).toBe(1)
    })

    it('一空一非空相似度为 0', () => {
      expect(stringSimilarity('abc', '')).toBe(0)
      expect(stringSimilarity('', 'abc')).toBe(0)
    })

    it('相同字符串相似度为 1', () => {
      expect(stringSimilarity('hello', 'hello')).toBe(1)
    })

    it('完全不同字符串相似度较低', () => {
      expect(stringSimilarity('abc', 'xyz')).toBe(0)
    })

    it('部分匹配返回 0-1 之间值', () => {
      const sim = stringSimilarity('abcde', 'abfgh')
      expect(sim).toBeGreaterThan(0)
      expect(sim).toBeLessThan(1)
    })
  })

  describe('tokenize', () => {
    it('空字符串返回空数组', () => {
      expect(tokenize('')).toEqual([])
    })

    it('提取中文单字', () => {
      const tokens = tokenize('你好世界')
      expect(tokens).toContain('你')
      expect(tokens).toContain('好')
      expect(tokens.length).toBe(4)
    })

    it('提取拉丁单词（小写化）', () => {
      const tokens = tokenize('Hello World')
      expect(tokens).toContain('hello')
      expect(tokens).toContain('world')
    })

    it('混合 CJK 和拉丁', () => {
      const tokens = tokenize('你好 hello')
      expect(tokens).toContain('你')
      expect(tokens).toContain('好')
      expect(tokens).toContain('hello')
    })
  })

  describe('estimateTokens', () => {
    it('空字符串为 0', () => {
      expect(estimateTokens('')).toBe(0)
    })

    it('纯 CJK 按字符数估算', () => {
      expect(estimateTokens('你好世界')).toBe(4)
    })

    it('纯拉丁按 4 字符/token 估算', () => {
      const result = estimateTokens('hello world')
      expect(result).toBe(Math.ceil(11 / 4))
    })

    it('混合内容', () => {
      const result = estimateTokens('你好 hello')
      // 2 CJK + 6 other (含空格) = 2 + ceil(6/4) = 2 + 2 = 4
      expect(result).toBeGreaterThan(0)
    })
  })
})


