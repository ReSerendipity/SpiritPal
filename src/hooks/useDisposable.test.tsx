// 最终放置位置: src/hooks/useDisposable.test.tsx
// 覆盖: useDisposable —— 逆序 dispose、重复 dispose 幂等、卸载自动清理、错误吞掉
//       useEventListener —— 订阅 / 卸载 off
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDisposable, useEventListener } from './useDisposable'

describe('useDisposable', () => {
  it('返回 addCleanup / dispose', () => {
    const { result } = renderHook(() => useDisposable())
    expect(typeof result.current.addCleanup).toBe('function')
    expect(typeof result.current.dispose).toBe('function')
  })

  it('dispose 逆序执行清理函数', () => {
    const order: number[] = []
    const { result } = renderHook(() => useDisposable())
    act(() => {
      result.current.addCleanup(() => order.push(1))
      result.current.addCleanup(() => order.push(2))
      result.current.addCleanup(() => order.push(3))
      result.current.dispose()
    })
    expect(order).toEqual([3, 2, 1])
  })

  it('dispose 后清空，重复 dispose 不重复执行', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDisposable())
    act(() => {
      result.current.addCleanup(fn)
      result.current.dispose()
    })
    act(() => {
      result.current.dispose()
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('卸载时自动 dispose', () => {
    const fn = vi.fn()
    const { result, unmount } = renderHook(() => useDisposable())
    act(() => {
      result.current.addCleanup(fn)
    })
    unmount()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('清理函数抛错被吞掉，不影响后续清理', () => {
    const order: number[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useDisposable())
    act(() => {
      result.current.addCleanup(() => {
        order.push(1)
        throw new Error('boom')
      })
      result.current.addCleanup(() => order.push(2))
      result.current.dispose()
    })
    expect(order).toEqual([2, 1])
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('useEventListener', () => {
  it('订阅 manager.on 并在卸载时 off', () => {
    const on = vi.fn()
    const off = vi.fn()
    const manager = { on, off }
    const handler = vi.fn()
    const { unmount } = renderHook(() => useEventListener(manager, 'test', handler, []))
    expect(on).toHaveBeenCalledWith('test', handler)
    unmount()
    expect(off).toHaveBeenCalledWith('test', handler)
  })

  it('支持函数形式的 manager', () => {
    const on = vi.fn()
    const manager = { on }
    const handler = vi.fn()
    renderHook(() => useEventListener(() => manager, 'evt', handler, []))
    expect(on).toHaveBeenCalledWith('evt', handler)
  })
})
