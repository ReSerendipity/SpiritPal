// 最终放置位置: src/hooks/pet/usePetLive2D.test.tsx
// 覆盖: usePetLive2D —— 模型路径检测、useLive2D 标志、setLive2dFailed、motion 触发
// Mock: ../../lib/commonUtils.fetchWithTimeout；animationConfig 为真实导入
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePetLive2D } from './usePetLive2D'

const live2d = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
}))

vi.mock('../../lib/commonUtils', () => ({
  fetchWithTimeout: live2d.fetchWithTimeout,
}))

describe('usePetLive2D', () => {
  beforeEach(() => {
    live2d.fetchWithTimeout.mockReset().mockResolvedValue({ ok: true })
  })

  it('检测到模型路径后 useLive2D 为 true', async () => {
    const { result } = renderHook(() =>
      usePetLive2D({
        currentCharacterId: 'doro',
        petState: 'idle',
        currentAnimId: 'idle',
      }),
    )
    expect(result.current.useLive2D).toBe(false)
    expect(result.current.live2dModelPath).toBeNull()
    await waitFor(() => {
      expect(result.current.live2dModelPath).toBe('/pets/doro/doro.model3.json')
    })
    expect(result.current.useLive2D).toBe(true)
    expect(live2d.fetchWithTimeout).toHaveBeenCalled()
  })

  it('无模型时 live2dModelPath 保持 null', async () => {
    live2d.fetchWithTimeout.mockResolvedValue({ ok: false })
    const { result } = renderHook(() =>
      usePetLive2D({
        currentCharacterId: 'nobody',
        petState: 'idle',
        currentAnimId: 'idle',
      }),
    )
    await waitFor(() => {
      expect(result.current.live2dModelPath).toBeNull()
    })
    expect(result.current.useLive2D).toBe(false)
  })

  it('setLive2dFailed(true) 关闭 Live2D 渲染', () => {
    const { result } = renderHook(() =>
      usePetLive2D({
        currentCharacterId: 'doro',
        petState: 'idle',
        currentAnimId: 'idle',
      }),
    )
    act(() => {
      result.current.setLive2dFailed(true)
    })
    expect(result.current.useLive2D).toBe(false)
  })

  it('检测到模型后触发对应 motion', async () => {
    const playMotion = vi.fn()
    const live2dRef = { current: { playMotion } as any }
    const { result } = renderHook(
      (props: any) => usePetLive2D(props),
      {
        initialProps: {
          currentCharacterId: 'doro',
          petState: 'idle',
          currentAnimId: 'idle',
          live2dRef,
        },
      },
    )
    await waitFor(() => {
      expect(result.current.useLive2D).toBe(true)
    })
    // 初始 currentAnimId='idle' → motion group 'Idle'
    expect(playMotion).toHaveBeenCalledWith('Idle', 0)
  })

  it('返回 lastMotionGroupRef（初始空字符串）', () => {
    const { result } = renderHook(() =>
      usePetLive2D({
        currentCharacterId: 'doro',
        petState: 'idle',
        currentAnimId: 'idle',
      }),
    )
    expect(result.current.lastMotionGroupRef.current).toBe('')
  })
})