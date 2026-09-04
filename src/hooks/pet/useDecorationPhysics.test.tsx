/**
 * @file useDecorationPhysics.test.tsx
 * @description useDecorationPhysics 单元测试（A-13）
 *
 * 契约：
 *  1. 角色未提供 physics3.json → 返回空角度，装饰层保持静态（默认角色无回归）
 *  2. 提供配置 → 解析成功后按锚点输出摆角
 *  3. 配置加载失败（404 / 非法 JSON）→ 静默降级，绝不抛错
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useDecorationPhysics } from './useDecorationPhysics'

/** 内部简化格式的 physics3.json：输出到 ParamHairFront（→ head 锚点） */
const PHYSICS_JSON = JSON.stringify({
  version: 3,
  groups: [
    {
      id: 'hair',
      type: 'pendulum',
      inputs: [{ id: 'ParamAngleX', type: 'angle', scale: 1, offset: 0 }],
      outputs: [{ id: 'ParamHairFront', scale: 10, offset: 0 }],
      settings: { gravity: { x: 0, y: 9.8 }, drag: 0.5 },
    },
  ],
})

let rafCallbacks: FrameRequestCallback[] = []

function flushFrames(count: number): void {
  for (let i = 0; i < count; i++) {
    const pending = rafCallbacks
    rafCallbacks = []
    if (pending.length === 0) return
    act(() => {
      pending.forEach((cb) => cb(performance.now()))
    })
  }
}

beforeEach(() => {
  rafCallbacks = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useDecorationPhysics', () => {
  it('未提供 physicsPath 时不启用物理，也不发起请求', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() =>
      useDecorationPhysics({ physicsPath: undefined, velocityX: 300 }),
    )

    expect(result.current).toEqual({})
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(rafCallbacks).toHaveLength(0)
  })

  it('enabled=false 时不启用物理', () => {
    const { result } = renderHook(() =>
      useDecorationPhysics({ physicsPath: '/p/physics3.json', velocityX: 300, enabled: false }),
    )

    expect(result.current).toEqual({})
    expect(rafCallbacks).toHaveLength(0)
  })

  it('加载成功后，按锚点输出摆角', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => PHYSICS_JSON })),
    )

    const { result } = renderHook(() =>
      useDecorationPhysics({ physicsPath: '/p/physics3.json', velocityX: 600 }),
    )

    await waitFor(() => {
      expect(rafCallbacks.length).toBeGreaterThan(0)
    })

    flushFrames(10)

    // ParamHairFront → head 锚点；宠物向右移动时应产生非零摆角
    expect(result.current).toHaveProperty('head')
    expect(Math.abs(result.current.head ?? 0)).toBeGreaterThan(0)
  })

  it('请求失败时静默降级，不抛错也不产生摆角', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })),
    )

    const { result } = renderHook(() =>
      useDecorationPhysics({ physicsPath: '/p/missing.json', velocityX: 300 }),
    )

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalled()
    })

    expect(result.current).toEqual({})
    expect(rafCallbacks).toHaveLength(0)
  })

  it('卸载后停止帧循环', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => PHYSICS_JSON })),
    )

    const { unmount } = renderHook(() =>
      useDecorationPhysics({ physicsPath: '/p/physics3.json', velocityX: 300 }),
    )

    await waitFor(() => {
      expect(rafCallbacks.length).toBeGreaterThan(0)
    })

    unmount()

    // 帧回调被取消：清空待执行队列后不应再排入新帧
    rafCallbacks = []
    flushFrames(3)
    expect(rafCallbacks).toHaveLength(0)
  })
})
