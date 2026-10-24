export interface EmotionAnalysisSignal {
  emotion: string
  intensity: number
  confidence?: number
}

const SCENE_TAGS = new Set(['idle', 'neutral', 'wave', 'think', 'coding_thinking', 'coding_editing', 'coding_testing'])
const INTENSE_TAGS = new Set(['excited', 'angry', 'cry', 'laugh', 'surprised', 'coding_error', 'coding_celebrating'])

/**
 * 记忆写入时不必只靠用户文本的关键词打分：聊天已经解析出 [happy] 等情绪标签，
 * 回复本身也可能带情绪。取已有值、标签分、分析分中的最大值，只升不降。
 */
export function deriveEmotionalIntensity(
  existing: number,
  tags: readonly string[],
  ...analyses: readonly EmotionAnalysisSignal[]
): number {
  const meaningful = tags.map((tag) => tag.toLowerCase()).filter((tag) => !SCENE_TAGS.has(tag))
  const tagScore =
    meaningful.length === 0
      ? 0
      : Math.min(1, 0.5 + 0.1 * (meaningful.length - 1) + (meaningful.some((tag) => INTENSE_TAGS.has(tag)) ? 0.2 : 0))
  const analysisScore = analyses.reduce((max, signal) => {
    if (!signal || signal.emotion === 'neutral') return max
    const score = Math.max(0, Math.min(1, signal.intensity * (signal.confidence ?? 1)))
    return Math.max(max, score)
  }, 0)
  return Math.min(1, Math.max(0, existing, tagScore, analysisScore))
}
