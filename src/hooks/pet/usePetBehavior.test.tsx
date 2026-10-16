// 最终放置位置: src/hooks/pet/usePetBehavior.test.tsx
// 覆盖: usePetBehavior —— 返回结构、scheduleNextBehavior 定时触发行为选择、setStartWalkAnimation 设置回调、卸载清理定时器
// 依赖: 仅 mock 了 petStore.getCurrentStats；animationConfig 为真实导入（纯 TypeScript 无副作用）
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePetBehavior } from '@/hooks/pet/usePetBehavior'
import { getAnimationStateMachine } from '@/lib/render/animationConfig'
import type { WorkState } from '@/lib/ai/contextAwareness'

const mocks = vi.hoisted(() => ({
  getCurrentStats: vi.fn(() => ({
    hunger: 80,
    mood: 70,
    health: 100,
    affection: 500,
    level: 5,
  })),
}))

vi.mock('../../stores/petStore', () => ({
  usePetStore: { getState: () => ({ getCurrentStats: mocks.getCurrentStats }) },
}))

describe('usePetBehavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 两个「隐藏输入」必须固定，否则本用例的断言会随 CI 的测试执行顺序与墙钟时刻漂移：
    // ① getAnimationStateMachine() 是**模块级单例**，lastPlayedAt 冷却表跨用例持久化；
    //    若 happy/laugh/giggle 被同一批次的其它用例打上 30s 冷却，pickEmotion 会被过滤空
    //    → 落进 pickBasic → 取到 'sit'（CI 实测复现：expected 'sit' to be 'happy'）。
    //    → 每个用例前重置冷却，恢复「mood=70 必命中情绪候选」的前提。
    getAnimationStateMachine().resetCooldowns()
    // ② select / scheduleNextBehavior 内部多处用 Math.random（延迟区间、5% 躲藏、
    //    候选内随机），固定成常量让行为选择完全确定。
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function setup() {
    const showBubble = vi.fn()
    const workStateRef = { current: 'idle' as WorkState }
    const wrapper = renderHook(() =>
      usePetBehavior({
        bubbleMessages: undefined,
        showBubble,
        workStateRef,
      }),
    )
    return { ...wrapper, showBubble }
  }

  it('返回完整结构（初始 idle / right）', () => {
    const { result } = setup()
    expect(result.current.petState).toBe('idle')
    expect(result.current.currentAnimId).toBe('idle')
    expect(result.current.facing).toBe('right')
    expect(typeof result.current.scheduleNextBehavior).toBe('function')
    expect(typeof result.current.setStartWalkAnimation).toBe('function')
    expect(result.current.dragCountRef.current).toBe(0)
    expect(result.current.petStateRef.current).toBe('idle')
    expect(result.current.musicSwayingRef.current).toBe(false)
  })

  it('scheduleNextBehavior 定时触发行为选择（mood=70 → 情绪动画 → happy）', () => {
    const { result } = setup()
    // 调度行为（workState idle → 延迟 5s~30s）
    act(() => {
      result.current.scheduleNextBehavior()
    })
    // 推进超过最大随机延迟
    act(() => {
      vi.advanceTimersByTime(40000)
    })
    expect(mocks.getCurrentStats).toHaveBeenCalled()
    // mood=70 命中情绪候选 → renderState 均为 'happy'（laugh/giggle/happy 都映射到 happy）
    expect(result.current.petState).toBe('happy')
  })

  it('setStartWalkAnimation 覆盖行走回调', () => {
    const fn = vi.fn()
    const { result } = setup()
    act(() => {
      result.current.setStartWalkAnimation(fn)
    })
    expect(fn).not.toHaveBeenCalled() // 只设置不调用
  })

  it('卸载时清理行为定时器', () => {
    const { result, unmount } = setup()
    act(() => {
      result.current.scheduleNextBehavior()
    })
    const beforeCalls = mocks.getCurrentStats.mock.calls.length
    unmount()
    act(() => {
      vi.advanceTimersByTime(100000)
    })
    // 卸载后定时器不应再触发 pickBehavior → getCurrentStats 不再被调用
    expect(mocks.getCurrentStats).toHaveBeenCalledTimes(beforeCalls)
  })
})
