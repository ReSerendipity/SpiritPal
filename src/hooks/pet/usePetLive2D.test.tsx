// 最终放置位置: src/hooks/pet/usePetLive2D.test.tsx
// 覆盖: usePetLive2D —— 模型路径检测、useLive2D 标志、setLive2dFailed、motion 触发
// Mock: ../../lib/commonUtils.fetchWithTimeout；animationConfig 为真实导入
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePetLive2D } from '@/hooks/pet/usePetLive2D'

const live2d = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
}))

vi.mock('@/lib/data/commonUtils', () => ({
  fetchWithTimeout: live2d.fetchWithTimeout,
}))

/** 合法 model3 响应体：探针会校验 FileReferences 字段（见下一条用例） */
const MODEL3_JSON = JSON.stringify({ FileReferences: { Moc: 'doro.moc3' } })

describe('usePetLive2D', () => {
  beforeEach(() => {
    // 探针用 GET 并校验响应体确为 model3 JSON，故 mock 必须提供 text()
    live2d.fetchWithTimeout.mockReset().mockResolvedValue({
      ok: true,
      text: async () => MODEL3_JSON,
    })
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

  it('响应体不是 model3 JSON 时不算命中（防 asset/SPA fallback 假命中）', async () => {
    live2d.fetchWithTimeout.mockResolvedValue({
      ok: true,
      text: async () => '<!doctype html><html><body>index.html</body></html>',
    })
    const { result } = renderHook(() =>
      usePetLive2D({
        currentCharacterId: 'doro',
        petState: 'idle',
        currentAnimId: 'idle',
      }),
    )
    await waitFor(() => {
      expect(live2d.fetchWithTimeout).toHaveBeenCalled()
    })
    expect(result.current.live2dModelPath).toBeNull()
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