/**
 * @file visualMemory.test.ts
 * @description 关键帧视觉记忆模块（三级 Mipmap 环形缓冲区）单测
 *
 * 测什么：
 * - addKeyframe 存帧 L0 + 降采样 L1/L2（默认返回原样 / 自定义 onDownsample）
 * - 三级查询：getLatestL0/L1/L2、getAllFrames(level)、getStats（含 estimatedMemoryBytes）
 * - 环形覆盖：L0 超容量触发 onKeyframeEvicted；onKeyframeAdded 回调
 * - destroy() 清空；destroy 后 addKeyframe 无效
 * - 单例 getVisualMemoryManager / resetVisualMemoryManager
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  VisualMemoryManager,
  getVisualMemoryManager,
  resetVisualMemoryManager,
  type VisualKeyframe,
  type VisualMemoryStats,
} from '@/lib/memory/visualMemory'

describe('VisualMemoryManager', () => {
  let mgr: VisualMemoryManager

  beforeEach(() => {
    resetVisualMemoryManager()
    mgr = new VisualMemoryManager()
  })

  afterEach(() => {
    resetVisualMemoryManager()
  })

  it('初始状态为空', () => {
    const stats: VisualMemoryStats = mgr.getStats()
    expect(stats.l0Count).toBe(0)
    expect(stats.l1Count).toBe(0)
    expect(stats.l2Count).toBe(0)
    expect(stats.totalCaptured).toBe(0)
    expect(stats.estimatedMemoryBytes).toBe(0)
    expect(mgr.getLatestL0()).toBeUndefined()
    expect(mgr.getLatestL1()).toEqual([])
    expect(mgr.getLatestL2()).toEqual([])
    expect(mgr.getAllFrames(0)).toEqual([])
    expect(mgr.getAllFrames(1)).toEqual([])
    expect(mgr.getAllFrames(2)).toEqual([])
  })

  it('addKeyframe 存 L0 并按比例降采样到 L1/L2（默认返回原样）', async () => {
    await mgr.addKeyframe('base64data', 1024, 768, 'Chrome', 'chrome.exe')

    const l0 = mgr.getLatestL0()!
    expect(l0.level).toBe(0)
    expect(l0.imageData).toBe('base64data')
    expect(l0.width).toBe(1024)
    expect(l0.height).toBe(768)
    expect(l0.windowTitle).toBe('Chrome')
    expect(l0.windowProcess).toBe('chrome.exe')
    expect(l0.seq).toBe(0)
    expect(l0.timestamp).toBeGreaterThan(0)

    // L1: 256/1024 = 0.25 缩放
    const l1 = mgr.getLatestL1(1)[0]
    expect(l1.level).toBe(1)
    expect(l1.imageData).toBe('base64data')
    expect(l1.width).toBe(256)
    expect(l1.height).toBe(192)
    expect(l1.seq).toBe(0)

    // L2: 64/256 = 0.25 缩放
    const l2 = mgr.getLatestL2(1)[0]
    expect(l2.level).toBe(2)
    expect(l2.imageData).toBe('base64data')
    expect(l2.width).toBe(64)
    expect(l2.height).toBe(48)
    expect(l2.seq).toBe(0)
  })

  it('自定义 onDownsample 回调逐级降采样', async () => {
    const onDownsample = vi.fn(async (imageData: string, targetWidth: number) => {
      return `ds:${targetWidth}:${imageData}`
    })
    const custom = new VisualMemoryManager({ onDownsample })

    await custom.addKeyframe('raw', 100, 50, 'W', 'P')

    expect(onDownsample).toHaveBeenCalledTimes(2)
    expect(onDownsample).toHaveBeenNthCalledWith(1, 'raw', 256)
    expect(onDownsample).toHaveBeenNthCalledWith(2, 'ds:256:raw', 64)

    expect(custom.getLatestL1(1)[0].imageData).toBe('ds:256:raw')
    expect(custom.getLatestL2(1)[0].imageData).toBe('ds:64:ds:256:raw')
  })

  it('onKeyframeAdded 回调触发（L0 帧）', async () => {
    const added: VisualKeyframe[] = []
    const custom = new VisualMemoryManager({ onKeyframeAdded: (f) => added.push(f) })

    await custom.addKeyframe('data', 10, 10, 'W', 'P')

    expect(added).toHaveLength(1)
    expect(added[0].level).toBe(0)
    expect(added[0].seq).toBe(0)
  })

  it('seq 与 totalCaptured 逐帧递增', async () => {
    await mgr.addKeyframe('a', 10, 10, 'W', 'P')
    await mgr.addKeyframe('b', 10, 10, 'W', 'P')
    await mgr.addKeyframe('c', 10, 10, 'W', 'P')

    expect(mgr.getLatestL0()!.seq).toBe(2)
    expect(mgr.getStats().totalCaptured).toBe(3)
  })

  describe('环形覆盖', () => {
    it('L0 超容量（5）触发 onKeyframeEvicted，仅 L0 触发', async () => {
      const evicted: VisualKeyframe[] = []
      const custom = new VisualMemoryManager({ onKeyframeEvicted: (f) => evicted.push(f) })

      for (let i = 0; i < 6; i++) {
        await custom.addKeyframe(`frame${i}`, 10, 10, 'W', 'P')
      }

      // L0 容量 5，第 6 帧挤掉第 1 帧
      expect(evicted).toHaveLength(1)
      expect(evicted[0].seq).toBe(0)
      expect(evicted[0].level).toBe(0)

      const l0All = custom.getAllFrames(0)
      expect(l0All).toHaveLength(5)
      expect(l0All.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5])
      expect(custom.getStats().l0Count).toBe(5)
    })

    it('getLatestL0 返回最新写入帧', async () => {
      await mgr.addKeyframe('a', 10, 10, 'W', 'P')
      await mgr.addKeyframe('b', 10, 10, 'W', 'P')
      expect(mgr.getLatestL0()!.imageData).toBe('b')
    })
  })

  describe('查询', () => {
    beforeEach(async () => {
      for (let i = 0; i < 8; i++) {
        await mgr.addKeyframe(`f${i}`, 10, 10, 'W', 'P')
      }
    })

    it('getLatestL1 默认返回最近 5 帧', () => {
      const l1 = mgr.getLatestL1()
      expect(l1).toHaveLength(5)
      // 插入顺序返回，最后 5 帧是 seq 3~7
      expect(l1[0].seq).toBe(3)
      expect(l1[4].seq).toBe(7)
    })

    it('getLatestL2 默认返回最近 10 帧（不足则全部）', () => {
      expect(mgr.getLatestL2()).toHaveLength(8)
    })

    it('getLatest 支持自定义数量', () => {
      expect(mgr.getLatestL1(3)).toHaveLength(3)
      expect(mgr.getLatestL2(2)).toHaveLength(2)
    })

    it('getAllFrames 返回各 level 全部帧（L0 受容量 5 限制）', () => {
      expect(mgr.getAllFrames(0)).toHaveLength(5) // L0 容量 5，超出被覆盖
      expect(mgr.getAllFrames(1)).toHaveLength(8) // L1 容量 20
      expect(mgr.getAllFrames(2)).toHaveLength(8) // L2 容量 60
    })
  })

  describe('getStats', () => {
    it('estimatedMemoryBytes = 各帧 Base64 长度 × 0.75 求和', async () => {
      // 三个 level 各存 'abcd'（4 字符）→ 4 * 0.75 = 3 字节 each
      await mgr.addKeyframe('abcd', 10, 10, 'W', 'P')

      const stats = mgr.getStats()
      expect(stats.l0Count).toBe(1)
      expect(stats.l1Count).toBe(1)
      expect(stats.l2Count).toBe(1)
      expect(stats.estimatedMemoryBytes).toBe(9)
      expect(stats.totalCaptured).toBe(1)
    })

    it('空缓冲 estimatedMemoryBytes 为 0', () => {
      expect(mgr.getStats().estimatedMemoryBytes).toBe(0)
    })
  })

  describe('destroy', () => {
    it('清空所有缓冲区并清零统计', async () => {
      await mgr.addKeyframe('data', 10, 10, 'W', 'P')

      mgr.destroy()

      const stats = mgr.getStats()
      expect(stats.l0Count).toBe(0)
      expect(stats.l1Count).toBe(0)
      expect(stats.l2Count).toBe(0)
      expect(stats.totalCaptured).toBe(0)
      expect(stats.estimatedMemoryBytes).toBe(0)
      expect(mgr.getLatestL0()).toBeUndefined()
    })

    it('destroy 后 addKeyframe 无效', async () => {
      mgr.destroy()
      await mgr.addKeyframe('data', 10, 10, 'W', 'P')

      expect(mgr.getStats().totalCaptured).toBe(0)
      expect(mgr.getLatestL0()).toBeUndefined()
      expect(mgr.getLatestL1()).toEqual([])
      expect(mgr.getLatestL2()).toEqual([])
    })
  })
})

describe('单例 getVisualMemoryManager / resetVisualMemoryManager', () => {
  afterEach(() => {
    resetVisualMemoryManager()
  })

  it('多次获取返回同一实例', () => {
    const a = getVisualMemoryManager()
    const b = getVisualMemoryManager()
    expect(a).toBe(b)
  })

  it('resetVisualMemoryManager 后返回新实例', () => {
    const a = getVisualMemoryManager()
    resetVisualMemoryManager()
    const b = getVisualMemoryManager()
    expect(a).not.toBe(b)
  })

  it('首次创建传入的 callbacks 生效', async () => {
    const onDownsample = vi.fn(async (d: string) => d)
    const singleton = getVisualMemoryManager({ onDownsample })
    await singleton.addKeyframe('x', 10, 10, 'W', 'P')
    expect(onDownsample).toHaveBeenCalled()
  })
})
