/**
 * @file cultureEmoji.test.ts
 * @description 情绪 × 文化表情适配单测（A-9 emojiCultureData 接入 + A-10 情绪消费）
 *
 * 契约：
 *  1. 不同语言返回不同的文化表情（中日韩英表情习惯确实不同）
 *  2. 情绪映射覆盖全部 9 基础 + 6 复合情绪，未知情绪退回 greeting
 *  3. decorateWithCultureEmoji：无表情文本被前置；已含表情文本原样返回；空文本安全
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEmotionStateManager } from '@/lib/ai/emotionEngine'
import { cultureEmojiForEmotion, decorateWithCultureEmoji } from '@/lib/system/cultureEmoji'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@/lib/ai/emotionEngine', () => {
  const state = { current: 'happy', todayStats: {} }
  return {
    getEmotionStateManager: () => ({
      getState: () => state,
      __setEmotion: (e: string) => {
        state.current = e
      },
    }),
  }
})

function setEmotion(emotion: string) {
  const mgr = getEmotionStateManager() as unknown as { __setEmotion: (e: string) => void }
  mgr.__setEmotion(emotion)
}

beforeEach(() => {
  setEmotion('happy')
  useSettingsStore.setState({ language: 'zh' })
})

describe('cultureEmojiForEmotion', () => {
  it('中日英韩返回各自文化的表情（不全是同一个）', () => {
    const zh = cultureEmojiForEmotion('happy', 'zh')
    const ja = cultureEmojiForEmotion('happy', 'ja')
    const en = cultureEmojiForEmotion('happy', 'en')
    const ko = cultureEmojiForEmotion('happy', 'ko')

    expect(zh).toBeTruthy()
    expect(ja).toBeTruthy()
    expect(en).toBeTruthy()
    expect(ko).toBeTruthy()
    // 至少两种文化之间有差异（文化适配确实生效，而非统一 fallback）
    expect(new Set([zh, ja, en, ko]).size).toBeGreaterThan(1)
  })

  it.each(['happy', 'sad', 'angry', 'excited', 'calm', 'confused', 'tired', 'surprised', 'neutral'])(
    '基础情绪 %s 能取到表情',
    (emotion) => {
      expect(cultureEmojiForEmotion(emotion, 'zh')).toBeTruthy()
    },
  )

  it.each(['proud', 'frustrated', 'anxious', 'curious', 'content', 'disappointed'])(
    '复合情绪 %s 能取到表情',
    (emotion) => {
      expect(cultureEmojiForEmotion(emotion, 'zh')).toBeTruthy()
    },
  )

  it('未知情绪与未知语言都退化为可用表情（不抛错、不返回空）', () => {
    expect(cultureEmojiForEmotion('不存在的情绪', 'zh')).toBeTruthy()
    expect(cultureEmojiForEmotion('happy', '火星文')).toBeTruthy()
  })
})

describe('decorateWithCultureEmoji', () => {
  it('无表情文本被前置一个情绪表情', () => {
    setEmotion('sad')
    const result = decorateWithCultureEmoji('今天有点累')

    expect(result).toContain('今天有点累')
    expect(result.length).toBeGreaterThan('今天有点累'.length)
    expect(result).not.toBe('今天有点累')
  })

  it('已含表情的文本原样返回（不重复叠加）', () => {
    const text = '🐾 我回来啦'
    expect(decorateWithCultureEmoji(text)).toBe(text)
  })

  it('空文本安全返回', () => {
    expect(decorateWithCultureEmoji('')).toBe('')
  })

  it('语言切换后表情随之变化（或至少保持稳定可用）', () => {
    setEmotion('happy')
    useSettingsStore.setState({ language: 'zh' })
    const zh = decorateWithCultureEmoji('你好')
    useSettingsStore.setState({ language: 'ja' })
    const ja = decorateWithCultureEmoji('你好')

    expect(zh).toContain('你好')
    expect(ja).toContain('你好')
  })
})
