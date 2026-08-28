/**
 * @file useMiniMode.test.tsx
 * @description useMiniMode 单元测试（A-14）
 *
 * 契约：
 *  1. 初始为 normal；toggle 后进入 mini（isMini=true）
 *  2. 再次 toggle 回到 normal
 *  3. 迷你态下鼠标移入 → 预览态（preview）
 *  4. 卸载时销毁管理器并注销事件监听
 *
 * Tauri 的 window/event API 已在 src/test/setup.ts 中统一 mock。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useMiniMode } from './useMiniMode'
import { emit, listen } from '@tauri-apps/api/event'

const mockEmit = vi.mocked(emit)
const mockListen = vi.mocked(listen)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // listen 默认返回一个可注销的函数
  mockListen.mockResolvedValue(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useMiniMode', () => {
  it('初始为 normal 态', async () => {
    const { result } = renderHook(() => useMiniMode())

    expect(result.current.state).toBe('normal')
    expect(result.current.isMini).toBe(false)
    await waitFor(() => expect(mockListen).toHaveBeenCalled())
  })

  it('toggle 后进入迷你态，再次 toggle 回到普通态', async () => {
    const { result } = renderHook(() => useMiniMode())
    await waitFor(() => expect(mockListen).toHaveBeenCalled())

    await act(async () => {
      await result.current.toggle()
    })

    expect(result.current.state).toBe('mini')
    expect(result.current.isMini).toBe(true)
    // 跨窗口广播状态
    expect(mockEmit).toHaveBeenCalledWith('mini-mode', { enabled: true, source: 'pet-window' })

    await act(async () => {
      await result.current.toggle()
    })

    expect(result.current.state).toBe('normal')
    expect(result.current.isMini).toBe(false)
  })

  it('迷你态下鼠标移入进入 preview（仍属于迷你 UI 形态）', async () => {
    const { result } = renderHook(() => useMiniMode())
    await waitFor(() => expect(mockListen).toHaveBeenCalled())

    await act(async () => {
      await result.current.toggle()
    })
    expect(result.current.state).toBe('mini')

    // 预览展开有 300ms 延迟
    act(() => {
      result.current.handleMouseEnter()
    })

    await waitFor(
      () => {
        expect(result.current.state).toBe('preview')
      },
      { timeout: 2000 },
    )
    expect(result.current.isMini).toBe(true)
  })

  it('卸载时注销事件监听', async () => {
    const unlisten = vi.fn()
    mockListen.mockResolvedValue(unlisten)

    const { unmount } = renderHook(() => useMiniMode())
    await waitFor(() => expect(mockListen).toHaveBeenCalled())

    unmount()

    expect(unlisten).toHaveBeenCalled()
  })

  it('init 失败时不抛错，功能降级为不可用', async () => {
    mockListen.mockRejectedValue(new Error('event bus unavailable'))

    const { result } = renderHook(() => useMiniMode())

    await waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(result.current.state).toBe('normal')
  })
})
