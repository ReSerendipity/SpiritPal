/**
 * 情绪映射机制 — 从 LLM 流式输出中解析 [emotion:xxx]/[motion:xxx]/[affection:±N] 标签
 * 移植自 Open-LLM-VTuber live2d_model.py:146-172
 *
 * @fileoverview
 * 主要模块：
 * - EMOTION_MAP：情绪关键词→动画 ID 映射表（happy/sad/angry 等 + 动作关键词 + 编码反应关键词）
 * - extractEmotionTags()：从文本中提取情绪/动作标签
 * - extractAffectionDelta()：提取好感度变化值
 * - stripEmotionTags()：清除文本中的情绪标签
 * - mapEmotionToAnimation()：情绪关键词映射到 SpiritPal 动画 ID
 *
 * Phase 1.3: 从 LLM 流式输出中解析 [emotion:xxx] / [motion:xxx] 标签，映射到动画 ID
 * Phase 2: 好感度数值化 — 从 LLM 输出中解析 [affection:±N] 标签，将好感度变化写入 petStore
 *
 * 参考仓库：Open-LLM-VTuber（MIT 许可）
 *
 * @module emotionExtractor
 * @requires ./animationConfig - AnimationId, ANIMATION_CATALOG 类型和常量
 */

import type { AnimationId } from './animationConfig'
import { ANIMATION_CATALOG } from './animationConfig'

// ============ 情绪关键词 → 动画 ID 映射 ============
// 参考 Open-LLM-VTuber 的 emo_map，适配 SpiritPal 的 56 种动画
export const EMOTION_MAP: Record<string, AnimationId> = {
  // 情绪关键词 → SpiritPal 动画 ID
  happy: 'happy',
  joy: 'happy',
  excited: 'excited',
  laugh: 'laugh',
  giggle: 'giggle',
  sad: 'sad',
  cry: 'cry',
  angry: 'angry',
  annoyed: 'annoyed',
  surprised: 'surprised',
  confused: 'confused',
  shy: 'shy',
  embarrassed: 'embarrassed',
  // 动作关键词
  wave: 'stretch',
  jump: 'excited',
  think: 'sit',
  sleep: 'sleep',
  eat: 'eat',
  idle: 'idle',
  pet: 'pet_head',
  sick: 'sick',
  // 编码反应关键词（与 CodingAnim 类型一致）
  coding_thinking: 'thinking',
  coding_editing: 'editing',
  coding_testing: 'testing',
  coding_success: 'success',
  coding_error: 'error',
  coding_celebrating: 'celebrating',
}

// ============ 好感度标签解析 ============

/** 好感度变化事件 */
export interface AffectionDelta {
  /** 好感度变化量（正数为增加，负数为减少） */
  delta: number
  /** 触发原因描述 */
  reason?: string
}

/** 好感度标签正则 — 匹配 [affection:+N] 或 [affection:-N] 或 [affection:N] */
const AFFECTION_TAG_REGEX = /\[affection:([+-]?\d+)\]/gi

/**
 * 从文本中提取好感度变化标签
 * 格式：[affection:+5] 或 [affection:-3] 或 [affection:10]
 *
 * @param text 包含好感度标签的原始文本
 * @returns 好感度变化列表（可能有多个标签）
 */
export function extractAffectionDeltas(text: string): AffectionDelta[] {
  const deltas: AffectionDelta[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(AFFECTION_TAG_REGEX.source, 'gi')

  while ((match = regex.exec(text)) !== null) {
    const value = parseInt(match[1], 10)
    if (!isNaN(value) && value !== 0) {
      deltas.push({ delta: value })
    }
  }

  return deltas
}

/**
 * 计算总好感度变化量
 */
export function sumAffectionDeltas(deltas: AffectionDelta[]): number {
  return deltas.reduce((sum, d) => sum + d.delta, 0)
}

/**
 * 从文本中移除好感度标签
 */
export function removeAffectionTags(text: string): string {
  return text.replace(AFFECTION_TAG_REGEX, '').trim()
}

// ============ 提取结果 ============
export interface EmotionExtraction {
  /** 提取到的动画 ID 列表（按出现顺序） */
  animations: AnimationId[]
  /** 清理后的文本（移除了所有情绪标签和好感度标签） */
  cleanText: string
  /** 好感度变化列表 */
  affectionDeltas: AffectionDelta[]
}

// ============ 情绪标签正则 ============
// 匹配 [emotion:xxx] 或 [motion:xxx] 或 [xxx] 格式
const EMOTION_TAG_REGEX = /\[(?:emotion:|motion:)?([a-zA-Z_]+)\]/gi

/**
 * 从文本中提取情绪/动作标签，映射到 SpiritPal 动画 ID
 * 移植自 Open-LLM-VTuber live2d_model.py:146-172 extract_emotion
 * Phase 2: 同时提取好感度标签
 *
 * @param text 包含情绪标签的原始文本（如 "你好 [happy] 很高兴见到你！[affection:+5]"）
 * @returns 提取结果：动画 ID 列表 + 好感度变化 + 清理后的文本
 */
export function extractEmotion(text: string): EmotionExtraction {
  const animations: AnimationId[] = []
  // 收集所有有效的动画 ID
  const validIds = new Set(ANIMATION_CATALOG.map((a) => a.id))

  let match: RegExpExecArray | null
  const regex = new RegExp(EMOTION_TAG_REGEX.source, 'gi')

  while ((match = regex.exec(text)) !== null) {
    const keyword = match[1].toLowerCase()
    const animId = EMOTION_MAP[keyword]
    if (animId && validIds.has(animId)) {
      animations.push(animId)
    }
  }

  // 提取好感度标签
  const affectionDeltas = extractAffectionDeltas(text)

  // 移除所有情绪标签和好感度标签，返回纯净文本
  let cleanText = text.replace(EMOTION_TAG_REGEX, '')
  cleanText = removeAffectionTags(cleanText)

  return { animations, cleanText, affectionDeltas }
}

/**
 * 从流式 chunk 中实时提取情绪标签
 * 适用于逐 chunk 处理的场景，避免重复解析
 *
 * @param chunk 单个流式文本片段
 * @returns 该 chunk 中提取到的动画 ID（可能为空）
 */
export function extractEmotionFromChunk(chunk: string): AnimationId[] {
  const validIds = new Set(ANIMATION_CATALOG.map((a) => a.id))
  const animations: AnimationId[] = []

  let match: RegExpExecArray | null
  const regex = new RegExp(EMOTION_TAG_REGEX.source, 'gi')

  while ((match = regex.exec(chunk)) !== null) {
    const keyword = match[1].toLowerCase()
    const animId = EMOTION_MAP[keyword]
    if (animId && validIds.has(animId)) {
      animations.push(animId)
    }
  }

  return animations
}

/**
 * 从流式 chunk 中实时提取好感度变化
 *
 * @param chunk 单个流式文本片段
 * @returns 该 chunk 中提取到的好感度变化列表
 */
export function extractAffectionFromChunk(chunk: string): AffectionDelta[] {
  return extractAffectionDeltas(chunk)
}

/**
 * 移除文本中的情绪标签
 * 移植自 Open-LLM-VTuber live2d_model.py:174-194 remove_emotion_keywords
 *
 * @param text 包含情绪标签的原始文本
 * @returns 清理后的纯文本
 */
export function removeEmotionTags(text: string): string {
  let result = text.replace(EMOTION_TAG_REGEX, '')
  result = removeAffectionTags(result)
  return result.trim()
}

/**
 * T-6: 将宠物情绪标签映射为记忆情感三维（valence/arousal）
 * 用于对话结束后回写当轮记忆的情感标记，打通 emotionExtractor（LLM 情绪标签）
 * 与记忆侧基于词表的情感体系
 *
 * @param animations 从 LLM 输出提取的动画/情绪标签（如 happy/sad/excited）
 * @returns 情感三维 {valence: -1..1, arousal: 0..1}；无匹配时返回 undefined
 */
export function emotionTagsToMood(
  animations: string[],
): { valence: number; arousal: number } | undefined {
  if (!animations || animations.length === 0) return undefined
  // 取最后一个情绪标签（对话结尾的情绪最能代表当轮基调）
  const last = animations[animations.length - 1]
  switch (last) {
    case 'happy':
    case 'laugh':
    case 'giggle':
    case 'excited':
      return { valence: 0.8, arousal: 0.7 }
    case 'sad':
    case 'cry':
      return { valence: -0.8, arousal: 0.5 }
    case 'angry':
    case 'annoyed':
      return { valence: -0.6, arousal: 0.8 }
    case 'surprised':
      return { valence: 0, arousal: 0.9 }
    case 'shy':
    case 'embarrassed':
      return { valence: 0.2, arousal: 0.4 }
    case 'think':
      return { valence: 0, arousal: 0.2 }
    default:
      return undefined
  }
}

// ============ 情绪标签提示词片段 ============
// 参考 Open-LLM-VTuber prompts/utils/live2d_expression_prompt.txt
// 追加到 System Prompt 中，指导 LLM 输出情绪标签

export const EMOTION_PROMPT_FRAGMENT = `
## 表达情绪和动作
在回复中，你可以使用方括号标签来表达情绪或执行动作，格式为 [emotion:关键词] 或 [关键词]。
可用的情绪关键词：
- 正面：happy, excited, laugh, giggle, shy
- 负面：sad, cry, angry, annoyed, embarrassed
- 其他：surprised, confused, think, wave, idle
- 编码反应：coding_thinking, coding_editing, coding_testing, coding_success, coding_error, coding_celebrating

## 表达好感度变化
当你对主人的行为产生情感变化时，可以使用 [affection:+N] 或 [affection:-N] 标签来表达好感度变化。
- 正面互动：[affection:+3] 到 [affection:+10]
- 负面互动：[affection:-1] 到 [affection:-5]
- 仅在有显著情感波动时使用，日常对话不需要

示例：
"[happy] 太好了！今天的天气真不错！ [affection:+2]"
"[think] 让我想想... [surprised] 原来是这样！ [affection:+5]"
"[sad] 你怎么又忘记了我的生日…… [affection:-3]"
注意：只使用上面列出的关键词，不要使用未列出的关键词。记得包含方括号 []。
`
