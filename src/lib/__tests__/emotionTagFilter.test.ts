import { describe, expect, it } from 'vitest'
import { EmotionTagFilter, extractEmotionTagKeywords, stripEmotionTags } from '@/lib/ai/emotionTagFilter'

describe('EmotionTagFilter', () => {
  it('removes complete emotion and affection tags', () => {
    expect(stripEmotionTags('[happy]你好呀[affection:+3]！')).toBe('你好呀！')
    expect(stripEmotionTags('[emotion:happy]带前缀的标签')).toBe('带前缀的标签')
  })

  it('exposes raw emotion keywords even when no animation is registered for them', () => {
    expect(extractEmotionTagKeywords('[happy]开心[emotion: excited]')).toEqual(['happy', 'excited'])
    expect(extractEmotionTagKeywords('[affection:+3]普通文本')).toEqual([])
  })

  it('filters a tag split across chunks without leaking its fragments', () => {
    const filter = new EmotionTagFilter()
    let out = ''
    for (const chunk of ['太棒了[ha', 'ppy]我们继续[affec', 'tion:-2]吧']) out += filter.push(chunk)
    out += filter.flush()
    expect(out).toBe('太棒了我们继续吧')
  })

  it('keeps ordinary brackets and incomplete non-tag text', () => {
    expect(stripEmotionTags('引用[1]和[链接](https://example.com)')).toBe('引用[1]和[链接](https://example.com)')
    const filter = new EmotionTagFilter()
    expect(filter.push('数组[0]') + filter.flush()).toBe('数组[0]')
  })

  it('holds a possible tag prefix at the stream end only until flush', () => {
    const filter = new EmotionTagFilter()
    expect(filter.push('结果[hap')).toBe('结果')
    expect(filter.flush()).toBe('[hap')
  })
})
