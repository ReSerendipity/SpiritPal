/**
 * @file cultureEmoji.ts
 * @description 情绪 × 文化的表情适配（A-9 emojiCultureData 接入 + A-10 情绪消费）
 *
 * 背景：
 * - `emojiCultureData.ts`（12 类表情 × 4 种 locale）此前是孤岛模块，零 importer。
 * - `emotionEngine` 的 `EmotionStateManager` 在 ChatWindow 每次对话后更新情绪，
 *   但其 `getState()` 此前无任何消费方（写了没用）。
 *
 * 本模块把两者接起来：宠物说话时按「当前情绪 + 用户语言」附加符合文化的表情，
 * 让情绪状态第一次产生用户可见的效果，也让文化表情库真正被使用。
 */

import { getCulturalEmoji, type CultureLocale } from './emojiCultureData'
import { getEmotionStateManager } from './emotionEngine'
import { useSettingsStore } from '../stores/settingsStore'

/** 应用语言 → emojiCultureData 的文化 locale */
const LOCALE_MAP: Record<string, CultureLocale> = {
  zh: 'zh-CN',
  'zh-TW': 'zh-CN', // 文化表情库暂无 zh-TW 变体，退回简体中文习惯
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
}

/**
 * emotionEngine 情绪 → emojiCultureData 类别键
 * 覆盖 9 种基础情绪 + 6 种复合情绪（未命中的一律退回 greeting）
 */
const EMOTION_CATEGORY: Record<string, string> = {
  // 基础情绪
  happy: 'happy',
  excited: 'excited',
  calm: 'greeting',
  neutral: 'greeting',
  sad: 'sad',
  angry: 'angry',
  confused: 'thinking',
  tired: 'sleep',
  surprised: 'surprised',
  // 复合情绪
  proud: 'happy',
  content: 'happy',
  disappointed: 'sad',
  frustrated: 'angry',
  anxious: 'thinking',
  curious: 'thinking',
}

/** 文本中是否已含 emoji（避免重复叠加） */
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u

/**
 * 按情绪与文化取推荐表情
 *
 * @param emotion emotionEngine 的情绪标识（BasicEmotion | ComplexEmotion）
 * @param lang 应用语言（zh / en / ja / ko / zh-TW）
 */
export function cultureEmojiForEmotion(emotion: string, lang: string): string {
  const locale = LOCALE_MAP[lang] ?? 'zh-CN'
  const category = EMOTION_CATEGORY[emotion] ?? 'greeting'
  return getCulturalEmoji(category, locale).primary
}

/**
 * 给宠物说的话附加情绪表情（已含表情时原样返回）
 *
 * 读取当前情绪状态与用户语言，在文本前补一个文化适配的表情。
 * 用于主动说话气泡等宠物自发表达场景。
 */
export function decorateWithCultureEmoji(text: string): string {
  if (!text) return text
  if (EMOJI_PATTERN.test(text)) return text

  const lang = useSettingsStore.getState().language
  const state = getEmotionStateManager().getState()
  const emoji = cultureEmojiForEmotion(state.current, lang)
  return emoji ? `${emoji} ${text}` : text
}
