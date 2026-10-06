// VR-5：实体图谱移动端可读性——绘制参数纯函数单测
import { describe, expect, it } from 'vitest'
import { computeGraphDisplayParams, memoryCountToRadius } from '@/lib/memory/forceLayout'

describe('computeGraphDisplayParams（VR-5）', () => {
  it('移动端 390px：k≈0.39，节点最小半径反推 ≥35、标签字号 ≥30（显示 ≈14px/12px）', () => {
    const p = computeGraphDisplayParams(390)
    expect(p.k).toBeCloseTo(0.39, 2)
    expect(p.minRadius).toBeGreaterThanOrEqual(35)
    expect(p.labelFont).toBeGreaterThanOrEqual(30)
    // 反向补偿验证：逻辑值 × k ≈ 目标显示值
    expect(p.minRadius * p.k).toBeCloseTo(14, 1)
    expect(p.labelFont * p.k).toBeCloseTo(12, 1)
  })

  it('桌面全宽 1000px：k=1，参数回落到基线（14/12）', () => {
    const p = computeGraphDisplayParams(1000)
    expect(p.k).toBeCloseTo(1)
    expect(p.minRadius).toBeCloseTo(14)
    expect(p.labelFont).toBeCloseTo(12)
  })

  it('异常宽度（0/负数）安全回退 k=1', () => {
    for (const w of [0, -100]) {
      const p = computeGraphDisplayParams(w)
      expect(p.k).toBe(1)
      expect(p.minRadius).toBeCloseTo(14)
      expect(p.labelFont).toBeCloseTo(12)
    }
  })

  it('节点最小半径与 memoryCountToRadius 取 max：低提及数节点也被抬到可读下限', () => {
    const { minRadius } = computeGraphDisplayParams(390)
    const base = memoryCountToRadius(1) // ≈12.5，低于移动端下限
    expect(Math.max(minRadius, base)).toBe(minRadius)
  })
})
