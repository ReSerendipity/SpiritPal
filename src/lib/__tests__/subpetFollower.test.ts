/**
 * @file subpetFollower.test.ts
 * @description 弹簧-阻尼跟随器单元测试 — 位置收敛性 / 速度钳制 / 扇形排列
 */

import { describe, it, expect } from 'vitest'
import {
  SubpetFollower,
  computeFanOffset,
  computeFanOffsets,
  DEFAULT_FOLLOWER_CONFIG,
} from '@/lib/nurture/subpetFollower'

describe('SubpetFollower', () => {
  it('从远处出发，在固定目标+偏移下收敛到期望值', () => {
    // 略过阻尼参数，保证单调收敛不振荡
    const follower = new SubpetFollower(
      { x: 0, y: 0 },
      { stiffness: 100, damping: 30, maxSpeed: 1000 },
      { x: 40, y: -20 },
    )
    const target = { x: 500, y: 400 }

    // 模拟 10 秒 @ 60fps
    for (let i = 0; i < 60 * 10; i++) {
      follower.update(1 / 60, target)
    }

    const p = follower.getPosition()
    expect(p.x).toBeCloseTo(540, 1) // 500 + offset.x
    expect(p.y).toBeCloseTo(380, 1) // 400 + offset.y
    const v = follower.getVelocity()
    expect(Math.hypot(v.x, v.y)).toBeLessThan(1e-3)
  })

  it('目标静止时位置不会越过目标（过阻尼无振荡）', () => {
    const follower = new SubpetFollower({ x: 0, y: 0 }, { stiffness: 80, damping: 30, maxSpeed: 1000 })
    const target = { x: 100, y: 0 }
    let overshot = false
    for (let i = 0; i < 60 * 5; i++) {
      const p = follower.update(1 / 60, target)
      if (p.x > 101) overshot = true
    }
    expect(overshot).toBe(false)
  })

  it('主宠瞬移时副宠速度被钳制在 maxSpeed 以内', () => {
    const maxSpeed = 200
    const follower = new SubpetFollower({ x: 0, y: 0 }, { stiffness: 500, damping: 10, maxSpeed })
    // 主宠瞬间跳到 5000 像素外
    const target = { x: 5000, y: 5000 }
    const dt = 1 / 60
    const p0 = follower.update(dt, target)
    // 单帧位移不应超过 maxSpeed * dt
    const stepDist = Math.hypot(p0.x, p0.y)
    expect(stepDist).toBeLessThanOrEqual(maxSpeed * dt + 1e-6)
  })

  it('dt 异常大时被钳制，位置不爆炸', () => {
    const follower = new SubpetFollower({ x: 0, y: 0 }, { stiffness: 200, damping: 20, maxSpeed: 500 })
    const p = follower.update(5.0, { x: 10000, y: 10000 })
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  })

  it('setOffset 改变期望位置', () => {
    const follower = new SubpetFollower({ x: 0, y: 0 }, { stiffness: 200, damping: 40, maxSpeed: 1000 })
    follower.setOffset(30, 10)
    for (let i = 0; i < 60 * 8; i++) {
      follower.update(1 / 60, { x: 200, y: 200 })
    }
    expect(follower.getPosition().x).toBeCloseTo(230, 1)
    expect(follower.getPosition().y).toBeCloseTo(210, 1)
  })

  it('默认配置参数完整', () => {
    expect(DEFAULT_FOLLOWER_CONFIG.stiffness).toBeGreaterThan(0)
    expect(DEFAULT_FOLLOWER_CONFIG.damping).toBeGreaterThan(0)
    expect(DEFAULT_FOLLOWER_CONFIG.maxSpeed).toBeGreaterThan(0)
  })
})

describe('computeFanOffsets', () => {
  it('单只副宠偏移为原点', () => {
    expect(computeFanOffsets(1)).toEqual([{ x: 0, y: 0 }])
    expect(computeFanOffset(0, 1)).toEqual({ x: 0, y: 0 })
  })

  it('多只副宠对称分布在扇形弧线上', () => {
    const offsets = computeFanOffsets(3, 60)
    expect(offsets).toHaveLength(3)
    // 中间一只在正后方
    expect(offsets[1].x).toBeCloseTo(0, 5)
    expect(offsets[1].y).toBeCloseTo(60, 5)
    // 左右对称
    expect(offsets[0].x).toBeCloseTo(-offsets[2].x, 5)
    expect(offsets[0].y).toBeCloseTo(offsets[2].y, 5)
    // 半径一致
    expect(Math.hypot(offsets[0].x, offsets[0].y)).toBeCloseTo(60, 5)
  })

  it('总数为 0 时返回空数组', () => {
    expect(computeFanOffsets(0)).toEqual([])
  })
})
