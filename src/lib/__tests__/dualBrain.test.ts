// dualBrain 单元测试 — 双脑复杂度评估与置信度评分
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  assessComplexity,
  assessConfidence,
  recordDualBrainEvent,
  getDualBrainRouteEvents,
  getDualBrainRoutingSummary,
  getComplexityParams,
  setComplexityParams,
  resetComplexityParams,
} from '@/lib/ai/dualBrain'

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

describe('P1-2 双脑路由打点', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    // 用内存 Map 模拟 localStorage（node env 无 localStorage）
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
      clear: () => { store = {} },
    })
  })

  it('空状态汇总为 0', () => {
    const summary = getDualBrainRoutingSummary()
    expect(summary.total).toBe(0)
    expect(summary.slowRatio).toBe(0)
    expect(summary.escalationRatio).toBe(0)
  })

  it('记录事件后汇总统计慢脑占比与升级率', () => {
    recordDualBrainEvent({ timestamp: 1, brain: 'fast', complexityScore: 0.2, confidence: 0.8, escalated: false })
    recordDualBrainEvent({ timestamp: 2, brain: 'slow', complexityScore: 0.7, escalated: true })
    recordDualBrainEvent({ timestamp: 3, brain: 'slow', complexityScore: 0.9, escalated: false })

    const events = getDualBrainRouteEvents()
    expect(events).toHaveLength(3)

    const summary = getDualBrainRoutingSummary()
    expect(summary.total).toBe(3)
    expect(summary.slowRatio).toBeCloseTo(2 / 3, 5)
    expect(summary.escalationRatio).toBeCloseTo(1 / 3, 5)
    expect(summary.avgComplexity).toBeCloseTo((0.2 + 0.7 + 0.9) / 3, 5)
  })

  it('事件上限裁剪至 500 条', () => {
    for (let i = 0; i < 600; i++) {
      recordDualBrainEvent({ timestamp: i, brain: 'fast', complexityScore: 0.1, escalated: false })
    }
    expect(getDualBrainRouteEvents()).toHaveLength(500)
  })
})

describe('P2-2 复杂度参数可调', () => {
  afterEach(() => {
    resetComplexityParams()
  })

  it('默认参数下评估结果与历史一致', () => {
    const r = assessComplexity('你好')
    expect(r.suggestedBrain).toBe('fast')
  })

  it('调低阈值后更敏感判 slow', () => {
    // '为什么'：单推理关键词 → reasoning=0.3 → score≈0.105；默认阈值下 fast，0.1 阈值下 slow
    expect(assessComplexity('为什么').suggestedBrain).toBe('fast')
    setComplexityParams({ threshold: 0.1 })
    expect(assessComplexity('为什么').suggestedBrain).toBe('slow')
  })

  it('权重整体放大不改变判定（归一化）', () => {
    const input = '请分析并设计一个方案，然后打开文档搜索资料执行分析'
    const before = assessComplexity(input).score
    const w = getComplexityParams()
    const doubled = Object.fromEntries(
      Object.entries(w.weights).map(([k, v]) => [k, (v as number) * 2]),
    )
    setComplexityParams({ weights: doubled as typeof w.weights })
    const after = assessComplexity(input).score
    expect(after).toBeCloseTo(before, 5)
  })

  it('重置参数恢复默认阈值', () => {
    setComplexityParams({ threshold: 0.99 })
    resetComplexityParams()
    expect(getComplexityParams().threshold).toBe(0.6)
  })
})