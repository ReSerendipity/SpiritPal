/**
 * @file journalMood.test.ts
 * @description TD-012：日记心情分改由 emotionEngine 统一计算
 *
 * 契约：
 *  1. 空文本 / 全空白 → 50 分、无样本（不把「今天没说话」判成低落）
 *  2. 正向文本 → 分数明显高于 50，主导情绪为正向类
 *  3. 负向文本 → 分数明显低于 50，主导情绪为负向类
 *  4. 中性文本按 valence 0 进分母 → 与正向混合后分数被拉回中间（不再「一句开心就 90 分」）
 *  5. 与 moodFromEmotionTags 共用同一张评分表：同一情绪在两处给出一致的 valence 方向
 */
import { describe, it, expect } from 'vitest'
import { moodScoreFromTexts, moodFromEmotionTags } from '@/lib/ai/emotionEngine'

describe('moodScoreFromTexts（TD-012）', () => {
  it('空输入与全空白输入都返回 50 分且无样本', () => {
    expect(moodScoreFromTexts([])).toEqual({ score: 50, dominant: 'neutral', sampleCount: 0 })
    expect(moodScoreFromTexts(['   ', '\n'])).toEqual({
      score: 50,
      dominant: 'neutral',
      sampleCount: 0,
    })
  })

  it('正向文本得高分，主导情绪为正向类', () => {
    const r = moodScoreFromTexts(['今天好开心，特别喜欢你陪着我！'])
    expect(r.sampleCount).toBe(1)
    expect(r.score).toBeGreaterThan(60)
    expect(['happy', 'excited']).toContain(r.dominant)
  })

  it('负向文本得低分，主导情绪为负向类', () => {
    const r = moodScoreFromTexts(['今天很难过，心情很差，想哭'])
    expect(r.score).toBeLessThan(40)
    expect(['sad', 'angry']).toContain(r.dominant)
  })

  it('疲惫文本不会被判成「平静」', () => {
    const r = moodScoreFromTexts(['今天好累，有点困'])
    expect(r.dominant).toBe('tired')
    // 旧的本地启发式会把这类文本判成 50 分（平静）；现在应低于中间值
    expect(r.score).toBeLessThan(45)
  })

  it('中性文本进分母，混合后分数被拉回中间而不是被一句开心拉满', () => {
    const positiveOnly = moodScoreFromTexts(['好开心！'])
    const mixed = moodScoreFromTexts(['好开心！', '今天吃了饭', '在写代码', '看了会书'])
    expect(positiveOnly.score).toBeGreaterThan(mixed.score)
    expect(mixed.score).toBeGreaterThan(40)
    expect(mixed.score).toBeLessThan(70)
  })

  it('多句正向文本的主导情绪与单句一致，分数随样本稳定', () => {
    const one = moodScoreFromTexts(['我很开心'])
    const many = moodScoreFromTexts(['我很开心', '今天真棒', '过得很幸福'])
    expect(one.score).toBe(many.score)
    expect(many.sampleCount).toBe(3)
    expect(many.dominant).toBe('happy')
  })

  it('与 moodFromEmotionTags 共用评分表：happy 为正、sad 为负', () => {
    const happy = moodFromEmotionTags(['happy'])
    const sad = moodFromEmotionTags(['cry'])
    expect(happy?.valence).toBeGreaterThan(0)
    expect(sad?.valence).toBeLessThan(0)
    // 同一张表 ⇒ 文本侧 happy 的心情分也必须在 50 以上
    expect(moodScoreFromTexts(['开心']).score).toBeGreaterThan(50)
  })
})
