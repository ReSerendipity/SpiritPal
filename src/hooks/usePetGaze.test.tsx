// 最终放置位置: src/hooks/usePetGaze.test.tsx
// 覆盖: usePetGaze —— 返回结构、focusLive2D 坐标转换、reset 清空 transform、enabled=false 不启动动画、setGazeTarget/setWalkOffset 不抛错
// Smoke 级: rAF 循环被 stub 为 no-op（不测试实际动画帧）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePetGaze } from './usePetGaze'

describe('usePetGaze', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('返回完整结构', () => {
    const { result } = renderHook(() => usePetGaze())
    expect(result.current.containerRef).toBeDefined()
    expect(typeof result.current.setGazeTarget).toBe('function')
    expect(typeof result.current.setWalkOffset).toBe('function')
    expect(typeof result.current.focusLive2D).toBe('function')
    expect(typeof result.current.reset).toBe('function')
  })

  it('focusLive2D 计算 canvas 局部坐标并回调', () => {
    const onFocus = vi.fn()
    const { result } = renderHook(() => usePetGaze({ onLive2DFocus: onFocus }))
    const rect: DOMRect = { left: 10, top: 20 } as DOMRect
    act(() => {
      result.current.focusLive2D(110, 70, rect)
    })
    expect(onFocus).toHaveBeenCalledWith(100, 50)
  })

  it('reset 清空容器 transform', () => {
    const { result } = renderHook(() => usePetGaze())
    const el = document.createElement('div')
    el.style.transform = 'translate(5px, 5px)'
    result.current.containerRef.current = el
    act(() => {
      result.current.reset()
    })
    expect(el.style.transform).toBe('')
  })

  it('setGazeTarget / setWalkOffset 不抛错', () => {
    const { result } = renderHook(() => usePetGaze())
    act(() => {
      result.current.setGazeTarget(0.5, -0.5)
      result.current.setWalkOffset(42)
    })
    expect(true).toBe(true) // 不崩溃即通过
  })

  it('enabled=false 时不启动动画循环', () => {
    const raf = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', raf)
    renderHook(() => usePetGaze({ enabled: false }))
    expect(raf).not.toHaveBeenCalled()
  })
})