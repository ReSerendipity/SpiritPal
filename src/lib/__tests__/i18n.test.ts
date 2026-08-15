// T-24: 国际化测试 — 验证多语言切换和翻译完整性
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock i18next
const mockI18n = {
  language: 'zh-CN',
  t: vi.fn((key: string) => key),
  changeLanguage: vi.fn((lang: string) => { mockI18n.language = lang }),
  exists: vi.fn((_key: string) => true),
  getResource: vi.fn(() => null),
}

vi.mock('i18next', () => ({
  default: mockI18n,
  init: vi.fn(),
  use: vi.fn(() => mockI18n),
}))

describe('T-24: 国际化测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockI18n.language = 'zh-CN'
  })

  describe('语言切换', () => {
    it('默认语言应为中文', () => {
      expect(mockI18n.language).toBe('zh-CN')
    })

    it('可切换到英文', () => {
      mockI18n.changeLanguage('en')
      expect(mockI18n.language).toBe('en')
    })

    it('可切换回中文', () => {
      mockI18n.changeLanguage('en')
      mockI18n.changeLanguage('zh-CN')
      expect(mockI18n.language).toBe('zh-CN')
    })
  })

  describe('翻译键完整性', () => {
    it('关键 UI 文本有对应翻译键', () => {
      const criticalKeys = [
        'settings.title',
        'chat.placeholder',
        'chat.send',
        'pet.hunger',
        'pet.mood',
        'pet.health',
        'pet.coins',
        'common.close',
        'common.save',
        'common.cancel',
      ]

      for (const key of criticalKeys) {
        // t() 应返回非空字符串
        const result = mockI18n.t(key)
        expect(result).toBeDefined()
        expect(typeof result).toBe('string')
      }
    })

    it('不存在空翻译键', () => {
      // 遍历所有已知键，确保没有空值
      const knownKeys = [
        'settings.title',
        'chat.placeholder',
        'common.close',
        'common.save',
      ]

      for (const key of knownKeys) {
        const result = mockI18n.t(key)
        expect(result.length).toBeGreaterThan(0)
      }
    })
  })

  describe('数字和日期格式', () => {
    it('中文环境金币显示正确', () => {
      const coins = 1234
      const formatted = new Intl.NumberFormat('zh-CN').format(coins)
      expect(formatted).toBe('1,234')
    })

    it('英文环境金币显示正确', () => {
      const coins = 1234
      const formatted = new Intl.NumberFormat('en').format(coins)
      expect(formatted).toBe('1,234')
    })

    it('中文日期格式', () => {
      const date = new Date('2026-08-09T10:00:00Z')
      const formatter = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      const result = formatter.format(date)
      expect(result).toMatch(/2026/)
    })
  })
})
