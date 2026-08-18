// 最终放置位置: src/hooks/useSafeTimeout.test.tsx
// 覆盖: useSafeTimeout / useTimeout —— 定时器调度、取消、卸载清理
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSafeTimeout, useTimeout } from './useSafeTimeout'

describe('useSafeTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('返回 safeTimeout / clearSafeTimeout 函数', () => {
    const { result } = renderHook(() => useSafeTimeout())
    expect(typeof result.current.safeTimeout).toBe('function')
    expect(typeof result.current.clearSafeTimeout).toBe('function')
  })

  it('safeTimeout 在指定时间后执行回调', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useSafeTimeout())
    act(() => {
      result.current.safeTimeout(fn, 1000)
    })
    expect(fn).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('clearSafeTimeout 取消回调', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useSafeTimeout())
    let id = 0
    act(() => {
      id = result.current.safeTimeout(fn, 1000)
    })
    act(() => {
      result.current.clearSafeTimeout(id)
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(fn).not.toHaveBeenCalled()
  })

  it('卸载后清理未执行定时器', () => {
    const fn = vi.fn()
    const { result, unmount } = renderHook(() => useSafeTimeout())
    act(() => {
      result.current.safeTimeout(fn, 1000)
    })
    unmount()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('useTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('返回 safeTimeout 函数并正常触发', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useTimeout())
    act(() => {
      result.current(fn, 500)
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
