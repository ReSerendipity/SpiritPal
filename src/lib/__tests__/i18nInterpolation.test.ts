/**
 * @file i18nInterpolation.test.ts
 * @description i18n 插值真实链路测试（A-9 修复验证）
 *
 * ⚠️ 与既有 `i18n.test.ts` 的区别：那份把 i18next 整个 mock 掉（`t: key => key`），
 * 只能验证"函数被调用"，**测不出字典内容与插值是否真的生效**（正是这个假测试掩盖了
 * 插值前缀未配置的静默 bug）。本文件使用真实 i18next 实例 + 真实字典。
 *
 * 契约：
 *  1. 单花括号 `{name}` 占位被真实替换（而不是原样输出）
 *  2. 五种语言的插值键都存在且可解析
 *  3. 格式化工具（formatRelativeTime 等）存在且可用
 */

import { describe, it, expect } from 'vitest'
import { t, setLanguage, formatRelativeTime, getTextDirection, type SupportedLang } from '../i18n'

describe('i18n 插值（真实字典，非 mock）', () => {
  it('单花括号参数被真实替换（A-9 修复：此前原样输出 {amount}）', () => {
    setLanguage('zh')

    // 字典原文：'coins.earned': '获得 {amount} 金币'
    const text = t('coins.earned', { amount: 10 })

    expect(text).not.toContain('{amount}')
    expect(text).toContain('10')
  })

  it.each<[SupportedLang, string]>([
    ['zh', '金币'],
    ['en', 'coin'],
    ['ja', 'コイン'],
    ['ko', '코인'],
    ['zh-TW', '金幣'],
  ])('%s 语言下 coins.earned 的插值生效', (lang, keyword) => {
    setLanguage(lang)
    const text = t('coins.earned', { amount: 7 })

    expect(text).not.toContain('{amount}')
    expect(text).toContain('7')
    expect(text.toLowerCase()).toContain(keyword.toLowerCase())
  })

  it('pomodoro.focusStreak 的多处插值生效', () => {
    setLanguage('zh')
    const text = t('pomodoro.focusStreak', { count: 3 })

    expect(text).not.toContain('{count}')
    expect(text).toContain('3')
  })

  it('缺少插值参数时不抛错（降级为原样或空，不崩溃）', () => {
    setLanguage('zh')
    expect(() => t('coins.earned')).not.toThrow()
  })
})

describe('i18n 本地化格式化工具（A-9 收敛自 i18nManager）', () => {
  it('formatRelativeTime 可表示过去', () => {
    setLanguage('zh')
    const past = new Date(Date.now() - 5 * 60 * 1000)
    expect(typeof formatRelativeTime(past)).toBe('string')
    expect(formatRelativeTime(past).length).toBeGreaterThan(0)
  })

  it('formatRelativeTime 可表示未来（单向实现的常见缺陷）', () => {
    setLanguage('zh')
    const future = new Date(Date.now() + 30 * 60 * 1000)
    const text = formatRelativeTime(future)
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })

  it('getTextDirection 对当前支持语言均为 ltr', () => {
    ;(['zh', 'en', 'ja', 'ko', 'zh-TW'] as SupportedLang[]).forEach((lang) => {
      setLanguage(lang)
      expect(getTextDirection(lang)).toBe('ltr')
    })
  })
})
