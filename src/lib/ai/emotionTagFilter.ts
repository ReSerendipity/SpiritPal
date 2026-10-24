const EMOTION_NAMES = [
  'happy',
  'excited',
  'laugh',
  'giggle',
  'shy',
  'sad',
  'cry',
  'angry',
  'annoyed',
  'embarrassed',
  'surprised',
  'confused',
  'think',
  'wave',
  'idle',
  'coding_thinking',
  'coding_editing',
  'coding_testing',
  'coding_success',
  'coding_error',
  'coding_celebrating',
]
const TAG = new RegExp(`\\[(?:(?:emotion\\s*:\\s*)?(?:${EMOTION_NAMES.join('|')})|affection:[+-]?\\d+)\\]`, 'gi')
const KEYWORD_TAG = new RegExp(`\\[(?:emotion\\s*:\\s*)?(${EMOTION_NAMES.join('|')})\\]`, 'gi')
const PARTIAL_TAG_TAIL = /\[[a-z_:+-]{0,24}$/i

export function stripEmotionTags(text: string): string {
  return text.replace(TAG, '')
}

/** 取出原始情绪关键词（不经过动画目录映射，未登记动画的情绪也能计入强度）。 */
export function extractEmotionTagKeywords(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(KEYWORD_TAG)) found.push(match[1].toLowerCase())
  return found
}

/**
 * 流式剥离情绪/好感度标签。标签可能被切在两个 chunk 之间，
 * 因此只在结尾像「半个标签」时暂扣，普通方括号（数组下标、Markdown 链接）照常输出。
 */
export class EmotionTagFilter {
  private buffer = ''

  push(chunk: string): string {
    this.buffer += chunk
    const match = this.buffer.match(PARTIAL_TAG_TAIL)
    if (!match) {
      const output = stripEmotionTags(this.buffer)
      this.buffer = ''
      return output
    }
    const cut = this.buffer.length - match[0].length
    const output = stripEmotionTags(this.buffer.slice(0, cut))
    this.buffer = match[0]
    return output
  }

  flush(): string {
    const output = stripEmotionTags(this.buffer)
    this.buffer = ''
    return output
  }
}
