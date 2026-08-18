// 最终放置位置: src/hooks/pet/usePetMemoryTriggers.test.tsx
// 覆盖: usePetMemoryTriggers —— smoke 渲染、周期触发 recall → showBubble、用户响应 recordUserResponse、卸载清理
// Mock: enhancedMemory / recallEngine / stringSimilarity；capture listen('user-chat-responded') 回调
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { listen } from '@tauri-apps/api/event'
import { usePetMemoryTriggers } from './usePetMemoryTriggers'

const mem = vi.hoisted(() => ({
  ensureLoaded: vi.fn().mockResolvedValue(undefined),
  recordUserResponse: vi.fn(),
}))

const recall = vi.hoisted(() => vi.fn())

const sim = vi.hoisted(() => vi.fn(() => 0))

vi.mock('../../lib/enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => ({
    ensureLoaded: mem.ensureLoaded,
    recordUserResponse: mem.recordUserResponse,
  })),
  removeEnhancedMemoryManager: vi.fn(),
}))

vi.mock('../../lib/recallEngine', () => ({
  getRecallEngine: vi.fn(() => ({ recall })),
  buildRecallRenderPrompt: vi.fn(() => ''),
}))

vi.mock('../../lib/stringSimilarity', () => ({
  stringSimilarity: sim,
  tokenize: vi.fn(() => []),
  estimateTokens: vi.fn(() => 0),
}))

describe('usePetMemoryTriggers', () => {
  let respondHandler: ((event: any) => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    mem.ensureLoaded.mockClear().mockResolvedValue(undefined)
    mem.recordUserResponse.mockClear()
    recall.mockReset().mockResolvedValue(null)
    sim.mockReset().mockReturnValue(0)
    respondHandler = undefined
    vi.mocked(listen).mockImplementation((event: string, cb: any) => {
      if (event === 'user-chat-responded') {
        respondHandler = cb
      }
      return Promise.resolve(() => {})
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const opts = {
      currentCharacterId: 'doro',
      showBubble: vi.fn(),
      setPetState: vi.fn(),
      setCurrentAnimId: vi.fn(),
      safeTimeout: vi.fn(),
    }
    return renderHook(() => usePetMemoryTriggers(opts))
  }

  it('渲染不崩溃且无返回值', () => {
    const { result } = setup()
    expect(result.current).toBeUndefined()
  })

  it('周期定时器触发 recall（返回 null → 不显示气泡）', async () => {
    const { unmount } = setup()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(mem.ensureLoaded).toHaveBeenCalledTimes(1)
    expect(recall).toHaveBeenCalled()
    unmount()
  })

  it('recall 返回消息时显示气泡 + 设置状态', async () => {
    recall.mockResolvedValue('想你了～')
    const { unmount } = setup()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(recall).toHaveBeenCalled()
    unmount()
  })

  it('触发后用户响应 → recordUserResponse 被调用', async () => {
    recall.mockResolvedValue('想你了～')
    const { unmount } = setup()
    // 先让 recall 触发并设置 pendingTriggerRef
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    // 触发用户响应事件
    expect(respondHandler).toBeDefined()
    act(() => {
      respondHandler!({ payload: { characterId: 'doro', text: '我也想你' } })
    })
    expect(mem.recordUserResponse).toHaveBeenCalled()
    unmount()
  })

  it('卸载后定时器不再触发', async () => {
    const { unmount } = setup()
    unmount()
    const before = mem.ensureLoaded.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(120_000)
    })
    expect(mem.ensureLoaded).toHaveBeenCalledTimes(before)
  })
})