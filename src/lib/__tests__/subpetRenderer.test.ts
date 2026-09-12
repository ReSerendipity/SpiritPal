/**
 * @file subpetRenderer.test.ts
 * @description 副宠渲染器单元测试 — 召唤/收回/位置更新/idle 帧播放
 */

import { describe, it, expect } from 'vitest'
import type { SubPetConfig } from '@/lib/data/types'
import {
  SubpetRenderer,
  subpetCellWidth,
  subpetCellHeight,
  type SubpetImageLike,
} from '@/lib/render/subpetRenderer'

const GHOST: SubPetConfig = {
  spritePath: '/pets/subpets/mini-ghost.png',
  name: '小幽灵',
  scale: 0.4,
}

/** 桩图片工厂：立即置 complete，模拟图片已加载 */
function makeLoadedImageFactory(width = 120, height = 60) {
  return (src: string): SubpetImageLike => ({
    src,
    complete: true,
    naturalWidth: width,
    naturalHeight: height,
    onload: null,
    onerror: null,
  })
}

describe('SubpetRenderer', () => {
  it('召唤后条目入列，重复召唤被拒绝', () => {
    const r = new SubpetRenderer({ createImage: makeLoadedImageFactory() })
    expect(r.summon('p1', GHOST, { x: 100, y: 100 })).toBe(true)
    expect(r.count()).toBe(1)
    expect(r.has('p1')).toBe(true)
    // 重复召唤
    expect(r.summon('p1', GHOST, { x: 100, y: 100 })).toBe(false)
    expect(r.count()).toBe(1)
  })

  it('收回后条目移除', () => {
    const r = new SubpetRenderer({ createImage: makeLoadedImageFactory() })
    r.summon('p1', GHOST, { x: 0, y: 0 })
    expect(r.recall('p1')).toBe(true)
    expect(r.count()).toBe(0)
    expect(r.has('p1')).toBe(false)
    expect(r.recall('p1')).toBe(false)
  })

  it('加载完成的条目 loaded=true 且 cell 尺寸按帧数切分', () => {
    const r = new SubpetRenderer({
      createImage: makeLoadedImageFactory(120, 60),
      frameCount: 6,
    })
    r.summon('p1', GHOST, { x: 0, y: 0 })
    const entry = r.list()[0]
    expect(entry.loaded).toBe(true)
    expect(entry.failed).toBe(false)
    // 120px 宽 / 6 帧 = 20px 每帧
    expect(subpetCellWidth(entry, 6)).toBe(20)
    expect(subpetCellHeight(entry)).toBe(60)
  })

  it('update 后副宠位置朝主宠收敛', () => {
    const r = new SubpetRenderer({ createImage: makeLoadedImageFactory() })
    r.summon('p1', GHOST, { x: 0, y: 0 })
    // 主宠移动到 (500, 400)，副宠扇形偏移为 (0,0)（单只）
    for (let i = 0; i < 60 * 8; i++) {
      r.update(1 / 60, { x: 500, y: 400 })
    }
    const p = r.list()[0].follower.getPosition()
    expect(p.x).toBeCloseTo(500, 1)
    expect(p.y).toBeCloseTo(400, 1)
  })

  it('多只副宠扇形偏移互不重叠', () => {
    const r = new SubpetRenderer({ createImage: makeLoadedImageFactory(), fanRadius: 60 })
    r.summon('a', GHOST, { x: 0, y: 0 })
    r.summon('b', GHOST, { x: 0, y: 0 })
    r.summon('c', GHOST, { x: 0, y: 0 })
    // 跑足够久让位置收敛
    for (let i = 0; i < 60 * 10; i++) {
      r.update(1 / 60, { x: 500, y: 400 })
    }
    const positions = r.list().map((e) => e.follower.getPosition())
    // 中间一只在 (500, ~460)，左右两只 x 不同
    expect(Math.abs(positions[0].x - positions[1].x)).toBeGreaterThan(10)
    expect(Math.abs(positions[2].x - positions[1].x)).toBeGreaterThan(10)
  })

  it('idle 动画帧随时间推进', () => {
    const r = new SubpetRenderer({
      createImage: makeLoadedImageFactory(120, 60),
      frameCount: 4,
      fps: 10,
    })
    r.summon('p1', GHOST, { x: 0, y: 0 })
    const entry = r.list()[0]
    expect(entry.frameIndex).toBe(0)
    // 0.2 秒 @ 10fps = 2 帧
    r.update(0.2, { x: 0, y: 0 })
    expect(entry.frameIndex).toBe(2)
    // 超过总帧数后回绕
    for (let i = 0; i < 20; i++) r.update(0.1, { x: 0, y: 0 })
    expect(entry.frameIndex).toBeGreaterThanOrEqual(0)
    expect(entry.frameIndex).toBeLessThan(4)
  })

  it('getRenderables 输出带 scale 的渲染数据', () => {
    const r = new SubpetRenderer({ createImage: makeLoadedImageFactory(120, 60), frameCount: 6 })
    r.summon('p1', GHOST, { x: 10, y: 20 })
    const renderables = r.getRenderables()
    expect(renderables).toHaveLength(1)
    expect(renderables[0].id).toBe('p1')
    expect(renderables[0].textureId).toBe(GHOST.spritePath)
    // cellW=20 * scale 0.4 = 8
    expect(renderables[0].size[0]).toBeCloseTo(8, 2)
    expect(renderables[0].scale).toEqual([0.4, 0.4])
  })

  it('图片加载失败时 failed=true 且不产生 renderable', async () => {
    const failFactory = (): SubpetImageLike => {
      const img: SubpetImageLike = {
        src: '/missing.png',
        complete: false,
        naturalWidth: 0,
        naturalHeight: 0,
        onload: null,
        onerror: null,
      }
      // loadSprite 赋值 onerror 后再异步触发，模拟真实图片 onload/onerror 时序
      queueMicrotask(() => img.onerror?.())
      return img
    }
    const r = new SubpetRenderer({ createImage: failFactory })
    r.summon('p1', GHOST, { x: 0, y: 0 })
    await Promise.resolve()
    expect(r.list()[0].failed).toBe(true)
    expect(r.getRenderables()).toHaveLength(0)
  })
})
