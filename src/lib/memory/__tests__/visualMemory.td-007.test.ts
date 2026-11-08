// visualMemory TD-007 测试 — 降采样默认实现、只缩不放、回退如实计数
//
// 覆盖：① computeTargetSize 的边界（不放大 / 等比 / 最小 1px / 非法输入）；
// ② addKeyframe 在"原图比目标窄"时完全不重绘、尺寸如实；
// ③ 环境无 Canvas（vitest/jsdom 的真实情况）时回退原图并 fallbackFrames 计数，不谎报降采样；
// ④ 注入 onDownsample 时以 L1 结果为 L2 输入、每级尺寸与级别正确；
// ⑤ destroy 后计数与缓冲一起归零。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  VisualMemoryManager,
  computeTargetSize,
  resetVisualMemoryManager,
} from '@/lib/memory/visualMemory'

describe('computeTargetSize（只缩不放）', () => {
  it('原图比目标宽：等比缩小并标记 scaled', () => {
    expect(computeTargetSize(1024, 768, 256)).toEqual({ width: 256, height: 192, scaled: true })
    expect(computeTargetSize(1920, 1080, 64)).toEqual({ width: 64, height: 36, scaled: true })
  })

  it('原图正好等于目标宽度：不重绘', () => {
    expect(computeTargetSize(256, 144, 256)).toEqual({ width: 256, height: 144, scaled: false })
  })

  it('原图窄于目标（旧实现会放大的场景）：保持原尺寸且不重绘', () => {
    expect(computeTargetSize(100, 50, 256)).toEqual({ width: 100, height: 50, scaled: false })
    expect(computeTargetSize(30, 30, 64)).toEqual({ width: 30, height: 30, scaled: false })
  })

  it('极小图缩放后高度不小于 1px', () => {
    const s = computeTargetSize(10000, 3, 64)
    expect(s.width).toBe(64)
    expect(s.height).toBe(1)
  })

  it('非法尺寸不抛异常，返回 0 尺寸', () => {
    expect(computeTargetSize(0, 10, 256)).toEqual({ width: 0, height: 0, scaled: false })
    expect(computeTargetSize(Number.NaN, 10, 256)).toEqual({ width: 0, height: 0, scaled: false })
    expect(computeTargetSize(10, 10, 0)).toEqual({ width: 10, height: 10, scaled: false })
  })
})

describe('VisualMemoryManager 降采样行为', () => {
  let mgr: VisualMemoryManager

  beforeEach(() => {
    resetVisualMemoryManager()
    mgr = new VisualMemoryManager()
  })

  afterEach(() => {
    resetVisualMemoryManager()
  })

  it('原生实现下 L1/L2 尺寸按下标推导，L2 恒为 64 宽', async () => {
    await mgr.addKeyframe('data', 1920, 1080, 'W', 'P')

    const l1 = mgr.getLatestL1(1)[0]
    const l2 = mgr.getLatestL2(1)[0]
    expect(l1.width).toBe(256)
    expect(l1.height).toBe(144)
    expect(l2.width).toBe(64)
    expect(l2.height).toBe(36)
  })

  it('环境无 Canvas 时如实回退：数据仍是原图，fallbackFrames 计数', async () => {
    await mgr.addKeyframe('data', 1920, 1080, 'W', 'P')

    const stats = mgr.getStats()
    expect(mgr.getLatestL1(1)[0].imageData).toBe('data')
    expect(mgr.getLatestL2(1)[0].imageData).toBe('data')
    // jsdom 没有 canvas 实现 → 两级都回退，且绝不谎报 downscaledFrames
    expect(stats.downscaledFrames).toBe(0)
    expect(stats.fallbackFrames).toBe(2)
  })

  it('原图比目标窄时不重绘、不产生 fallback 计数', async () => {
    await mgr.addKeyframe('small', 100, 50, 'W', 'P')

    const stats = mgr.getStats()
    expect(mgr.getLatestL1(1)[0].width).toBe(100)
    expect(mgr.getLatestL2(1)[0].width).toBe(64)
    // L1 不重绘（宽 100 ≤ 256）；L2 需要重绘但环境不支持 → 1 次回退
    expect(stats.fallbackFrames).toBe(1)
    expect(stats.downscaledFrames).toBe(0)
  })

  it('注入 onDownsample 时 L2 以 L1 输出为输入，且计入 downscaledFrames', async () => {
    const onDownsample = vi.fn(async (d: string, w: number) => `ds${w}:${d}`)
    const custom = new VisualMemoryManager({ onDownsample })

    await custom.addKeyframe('raw', 1024, 768, 'W', 'P')

    expect(onDownsample).toHaveBeenNthCalledWith(1, 'raw', 256)
    expect(onDownsample).toHaveBeenNthCalledWith(2, 'ds256:raw', 64)
    expect(custom.getLatestL2(1)[0].imageData).toBe('ds64:ds256:raw')
    expect(custom.getStats().downscaledFrames).toBe(2)
    expect(custom.getStats().fallbackFrames).toBe(0)
  })

  it('onDownsample 抛错时 addKeyframe 不中断，回退原图', async () => {
    const onDownsample = vi.fn(async () => {
      throw new Error('boom')
    })
    // 注入的异常由调用方承担：此处验证"抛错不会让整帧丢失"
    const custom = new VisualMemoryManager({ onDownsample })
    await expect(custom.addKeyframe('raw', 1024, 768, 'W', 'P')).rejects.toThrow('boom')
    // L0 已经入队，L1/L2 未写入 —— 不做半成品掩盖，也不吞异常
    expect(custom.getAllFrames(0)).toHaveLength(1)
    expect(custom.getAllFrames(1)).toHaveLength(0)
  })

  it('destroy 归零两个降采样计数', async () => {
    await mgr.addKeyframe('data', 1920, 1080, 'W', 'P')
    expect(mgr.getStats().fallbackFrames).toBeGreaterThan(0)
    mgr.destroy()
    expect(mgr.getStats().downscaledFrames).toBe(0)
    expect(mgr.getStats().fallbackFrames).toBe(0)
  })
})
