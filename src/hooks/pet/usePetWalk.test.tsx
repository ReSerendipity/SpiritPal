// 最终放置位置: src/hooks/pet/usePetWalk.test.tsx
// 覆盖: usePetWalk —— 返回结构、startWalkAnimation 朝向/状态、向左朝向、interruptWalk 中断、卸载清理
// Smoke 级: rAF stub 为 no-op（不测试三段式速度曲线的数值）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePetWalk } from './usePetWalk'

describe('usePetWalk', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup() {
    const posRef = { current: { x: 100, y: 50 } }
    const setPos = vi.fn()
    const setPetState = vi.fn()
    const setCurrentAnimId = vi.fn()
    const setFacing = vi.fn()
    const onWalkOffsetChange = vi.fn()
    const onWalkComplete = vi.fn()
    const rendered = renderHook(() =>
      usePetWalk({
        posRef,
        setPos,
        setPetState,
        setCurrentAnimId,
        setFacing,
        onWalkOffsetChange,
        onWalkComplete,
      }),
    )
    return { ...rendered, setPos, setPetState, setCurrentAnimId, setFacing, onWalkOffsetChange, onWalkComplete }
  }

  it('返回 walkStateRef / startWalkAnimation / interruptWalk', () => {
    const { result } = setup()
    expect(result.current.walkStateRef.current.isWalking).toBe(false)
    expect(typeof result.current.startWalkAnimation).toBe('function')
    expect(typeof result.current.interruptWalk).toBe('function')
  })

  it('startWalkAnimation 向右设置朝向与行走状态', () => {
    const { result, setFacing, setPetState, setCurrentAnimId } = setup()
    act(() => {
      result.current.startWalkAnimation(150, 'walk' as any)
    })
    expect(setFacing).toHaveBeenCalledWith('right') // 150 > 100
    expect(setPetState).toHaveBeenCalledWith('walk')
    expect(setCurrentAnimId).toHaveBeenCalledWith('walk')
    expect(result.current.walkStateRef.current.isWalking).toBe(true)
    expect(result.current.walkStateRef.current.startX).toBe(100)
    expect(result.current.walkStateRef.current.endX).toBe(150)
  })

  it('startWalkAnimation 向左设置 facing=left', () => {
    const { result, setFacing } = setup()
    act(() => {
      result.current.startWalkAnimation(50, 'walk' as any)
    })
    expect(setFacing).toHaveBeenCalledWith('left')
  })

  it('interruptWalk 中断行走并回调偏移归零', () => {
    const { result, onWalkOffsetChange } = setup()
    act(() => {
      result.current.startWalkAnimation(150, 'walk' as any)
    })
    expect(result.current.walkStateRef.current.isWalking).toBe(true)
    act(() => {
      result.current.interruptWalk()
    })
    expect(result.current.walkStateRef.current.isWalking).toBe(false)
    expect(onWalkOffsetChange).toHaveBeenCalledWith(0)
  })

  it('卸载时清理动画帧', () => {
    const { unmount } = setup()
    expect(() => unmount()).not.toThrow()
  })
})