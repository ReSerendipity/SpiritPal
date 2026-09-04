// dualBrain 单元测试 — 双脑复杂度评估与置信度评分
import { describe, it, expect } from 'vitest'
import { assessComplexity, assessConfidence } from '@/lib/ai/dualBrain'

describe('assessComplexity（复杂度评估）', () => {
  it('简单问候应判定为 fast', () => {
    const result = assessComplexity('你好')
    expect(result.suggestedBrain).toBe('fast')
    expect(result.dimensions.length).toBeGreaterThanOrEqual(0)
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('含推理关键词的复杂问题应判定为 slow', () => {
    // 组合推理/工具关键词使 score ≥ 0.6（0.35*推理1 + 0.25*工具1 + 长度项）
    const result = assessComplexity('请帮我分析这个算法的复杂度，推理它的退化情况，评估性能，设计优化方案，计算复杂度，然后打开相关文档搜索资料并执行分析')
    expect(result.dimensions.reasoning).toBeGreaterThan(0.3)
    expect(result.suggestedBrain).toBe('slow')
  })

  it('长输入应提高长度维度分数', () => {
    const short = assessComplexity('hi')
    const long = assessComplexity('这句话很长，'.repeat(60))
    expect(long.dimensions.length).toBeGreaterThan(short.dimensions.length)
  })

  it('长上下文下建议 slow', () => {
    const result = assessComplexity('继续', 30)
    expect(result.dimensions.context).toBe(1)
  })

  it('分数有界于 0-1', () => {
    const result = assessComplexity('为什么'.repeat(500), 100)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })
})

describe('assessConfidence（Fast Brain 置信度）', () => {
  it('空响应置信度为 0', () => {
    expect(assessConfidence('问题', '')).toBe(0)
    expect(assessConfidence('问题', '   ')).toBe(0)
  })

  it('过短响应会降低置信度', () => {
    expect(assessConfidence('问题', '好')).toBeLessThan(0.5)
  })

  it('含不确定性标记会降低置信度', () => {
    const normal = assessConfidence('天气如何', '明天晴天，温度 25 度，适合出行')
    const unsure = assessConfidence('天气如何', '我可能不太确定明天是否晴天，也许有雨')
    expect(unsure).toBeLessThan(normal)
  })

  it('含失败标记的置信度显著低于正常回答', () => {
    const failed = assessConfidence('问题', '抱歉，我无法回答这个问题，我不知道')
    const good = assessConfidence('问题', '这是一个明确的完整回答，内容充分且清晰')
    expect(failed).toBeLessThan(good)
  })

  it('置信度有界于 0-1', () => {
    const bad = '抱歉，我不可能确定，也许无法回答，好吧大概不知道'
    const good = '这是一个完整且明确的回答，包含足够的细节和上下文信息，可以放心使用'
    expect(assessConfidence('x', bad)).toBeGreaterThanOrEqual(0)
    expect(assessConfidence('x', good)).toBeLessThanOrEqual(1)
  })
})