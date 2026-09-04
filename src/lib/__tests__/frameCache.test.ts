/**
 * @file frameCache.test.ts
 * @description frameCache 单元测试 — LRU 淘汰 / TTL / 统计 / 预加载 / webview 兼容性
 *
 * A-6 接入 trayIconRenderer 前，本模块无任何 importer。
 * 关键回归点：`estimateSize` 曾使用 Node 的 Buffer，在 webview 中会抛 ReferenceError。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LRUCache, FrameAnimationCache, disposeFrameCaches } from '@/lib/render/frameCache'

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    disposeFrameCaches()
    vi.restoreAllMocks()
  })

  it('命中与未命中分别累计到统计中', () => {
    const cache = new LRUCache<string, number>({ maxItems: 10 })

    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('missing')).toBeUndefined()

    const s = cache.getStats()
    expect(s.hits).toBe(1)
    expect(s.misses).toBe(1)
    expect(s.hitRate).toBeCloseTo(0.5, 5)
    cache.dispose()
  })

  it('超过 maxItems 时淘汰最久未访问的条目', () => {
    const cache = new LRUCache<string, number>({ maxItems: 2 })

    cache.set('a', 1)
    cache.set('b', 2)
    // 访问 a，使 b 成为最久未访问
    cache.get('a')
    cache.set('c', 3)

    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
    cache.dispose()
  })

  it('TTL 过期后视为未命中', () => {
    const cache = new LRUCache<string, number>({ maxItems: 10, defaultTTL: 1000 })

    cache.set('a', 1)
    vi.advanceTimersByTime(1500)

    expect(cache.get('a')).toBeUndefined()
    expect(cache.getStats().misses).toBe(1)
    cache.dispose()
  })

  it('estimateSize 不依赖 Node 的 Buffer（webview 安全）', () => {
    // webview 中不存在 Buffer：把它抹掉后仍能正常估算，说明没有 Node 依赖
    vi.stubGlobal('Buffer', undefined)

    const cache = new LRUCache<string, string>({ maxItems: 10 })
    expect(() => cache.set('zh', '你好，世界')).not.toThrow()

    const stats = cache.getStats()
    // '你好，世界' UTF-8 编码为 15 字节（5 个汉字 × 3 + 1 个全角逗号 × 3）
    expect(stats.currentMemoryUsage).toBe(15)
    expect(stats.currentSize).toBe(1)

    vi.unstubAllGlobals()
    cache.dispose()
  })

  it('preload 只加载缓存中缺失的 key', async () => {
    const cache = new LRUCache<string, number>({ maxItems: 10 })
    cache.set('a', 1)

    const loader = vi.fn(async (key: string) => (key === 'c' ? undefined : 42))
    const loaded = await cache.preload(['a', 'b', 'c'], loader)

    expect(loaded).toBe(1)
    // 'a' 已存在，不应调用 loader
    expect(loader).toHaveBeenCalledTimes(2)
    expect(cache.get('b')).toBe(42)
    expect(cache.get('c')).toBeUndefined()
    cache.dispose()
  })

  it('按标签批量删除条目', () => {
    const cache = new LRUCache<string, number>({ maxItems: 10 })
    cache.set('a', 1, { tags: ['tray-icon'] })
    cache.set('b', 2, { tags: ['other'] })
    cache.set('c', 3, { tags: ['tray-icon'] })

    cache.deleteByTags(['tray-icon'])

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('c')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    cache.dispose()
  })

  it('dispose 后定时器不再运行', () => {
    const cache = new LRUCache<string, number>({ maxItems: 10, cleanupInterval: 1000 })
    cache.set('a', 1)
    cache.dispose()

    expect(cache.get('a')).toBeUndefined()
    // 清理定时器已停止，不应再抛错
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
  })
})

describe('FrameAnimationCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    disposeFrameCaches()
  })

  it('相同 (animationId,row,frame,scale) 复用同一缓存条目', () => {
    const cache = new FrameAnimationCache({ maxItems: 10 })

    cache.cacheFrame({ animationId: 'doro', row: 0, frame: 1, scale: 32 }, 'base64-A')
    expect(cache.getFrame({ animationId: 'doro', row: 0, frame: 1, scale: 32 })).toBe('base64-A')
    // 帧号不同 → 未命中
    expect(cache.getFrame({ animationId: 'doro', row: 0, frame: 2, scale: 32 })).toBeUndefined()
    // 角色不同 → 未命中
    expect(cache.getFrame({ animationId: 'other', row: 0, frame: 1, scale: 32 })).toBeUndefined()

    cache.dispose()
  })

  it('params 参与 key 生成（资源换了不应命中旧条目）', () => {
    const cache = new FrameAnimationCache({ maxItems: 10 })

    cache.cacheFrame(
      { animationId: 'doro', row: 0, frame: 0, scale: 32, params: { src: '/old.png' } },
      'old',
    )
    expect(
      cache.getFrame({
        animationId: 'doro',
        row: 0,
        frame: 0,
        scale: 32,
        params: { src: '/new.png' },
      }),
    ).toBeUndefined()

    cache.dispose()
  })

  it('clearAnimation 只清除指定动画的帧', () => {
    const cache = new FrameAnimationCache({ maxItems: 10 })

    cache.cacheFrame({ animationId: 'doro', row: 0, frame: 0 }, 'a')
    cache.cacheFrame({ animationId: 'mimi', row: 0, frame: 0 }, 'b')

    cache.clearAnimation('doro')

    expect(cache.getFrame({ animationId: 'doro', row: 0, frame: 0 })).toBeUndefined()
    expect(cache.getFrame({ animationId: 'mimi', row: 0, frame: 0 })).toBe('b')

    cache.dispose()
  })
})
