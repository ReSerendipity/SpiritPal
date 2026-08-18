// 最终放置位置: src/hooks/pet/usePetTimers.test.tsx
// 覆盖: usePetTimers —— smoke 渲染 + 返回 interactionCounterRef、挂载初始化（applyOfflineDecay/scheduleNextBehavior）、卸载清理
// Smoke 级: 大量 manager 单例被 mock，仅验证"能渲染 + 返回结构 + 挂载/卸载副作用"
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePetTimers } from './usePetTimers'

const timers = vi.hoisted(() => {
  const state = {
    applyOfflineDecay: vi.fn(),
    tick: vi.fn(),
    getCurrentStats: vi.fn(() => ({
      hunger: 80,
      mood: 70,
      health: 100,
      affection: 500,
      level: 5,
    })),
  }
  const usePetStore = ((selector?: (s: any) => any) =>
    selector ? selector(state) : state) as any
  usePetStore.getState = () => state
  return { state, usePetStore }
})

vi.mock('../../stores/petStore', () => ({
  usePetStore: timers.usePetStore,
}))

vi.mock('../../lib/dialogueManager', () => ({
  getDialogueManager: () => ({ loadFromConfig: vi.fn() }),
}))

vi.mock('../../lib/dialogueConfig', () => ({
  WELCOME_DIALOGUE: {},
}))

vi.mock('../../lib/updater', () => ({
  initAutoUpdateChecker: vi.fn(),
}))

vi.mock('../../lib/bubbleManager', () => {
  const bubbleMgr = {
    checkHungerBubbles: vi.fn(),
    setOnBubble: vi.fn(),
    setCharacter: vi.fn(),
    resetCooldowns: vi.fn(),
    sendMessage: vi.fn(),
  }
  return {
    getBubbleManager: vi.fn(() => bubbleMgr),
    MessagePriority: { Proactive: 2 },
  }
})

vi.mock('../../lib/chatStages', () => ({
  getChatStageManager: () => ({ onStageChange: vi.fn(() => vi.fn()) }),
}))

vi.mock('../../lib/achievementSystem', () => ({
  getAchievementManager: () => ({ recordLogin: vi.fn() }),
}))

vi.mock('../../lib/interactionCounter', () => ({
  InteractionCounter: class {
    tick(_ms?: number) {}
  },
}))

vi.mock('../../lib/animationConfig', () => ({
  getAnimationStateMachine: () => ({ resetCooldowns: vi.fn() }),
}))

vi.mock('../../lib/characters', () => ({
  getCharacter: vi.fn(() => ({ id: 'doro', name: 'doro' })),
}))

vi.mock('../../lib/emotionManager', () => ({
  getEmotionManager: vi.fn(() => ({ tick: vi.fn() })),
}))

vi.mock('../../lib/proactiveSpeak', () => ({
  getProactiveSpeakManager: () => ({ onProactiveSpeak: vi.fn(() => vi.fn()) }),
}))

vi.mock('../../lib/enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    maintainMemories: vi.fn().mockResolvedValue(undefined),
    buildRAGIndex: vi.fn(),
    runNightlyConsolidation: vi.fn().mockResolvedValue(undefined),
    addExchange: vi.fn(() => ({ sourceKind: '' })),
  })),
}))

vi.mock('../../lib/diarySystem', () => ({
  getDiarySystemManager: vi.fn(() => ({
    getDiary: vi.fn(() => null),
    getTodayExchangeCount: vi.fn(() => 0),
    generateDiary: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../../lib/contextEpisodeManager', () => ({
  getContextEpisodeManager: vi.fn(() => ({
    recordStateChange: vi.fn().mockResolvedValue(undefined),
    condenseToObservation: vi.fn(),
  })),
}))

vi.mock('../../lib/contextAwareness', () => ({
  getContextAwarenessManager: () => ({
    onWorkStateChange: vi.fn(() => vi.fn()),
    getCachedWeather: vi.fn(() => null),
    getLastIdleMinutes: vi.fn(() => 0),
  }),
}))

describe('usePetTimers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    timers.state.applyOfflineDecay.mockReset()
    timers.state.tick.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const scheduleNextBehavior = vi.fn()
    const opts = {
      currentCharacterId: 'doro',
      scheduleNextBehavior,
      showBubble: vi.fn(),
      pickBubble: vi.fn(() => 'hi'),
      setPetState: vi.fn(),
      setCurrentAnimId: vi.fn(),
      safeTimeout: vi.fn(),
      petStateRef: { current: 'idle' as any },
    }
    return { ...renderHook(() => usePetTimers(opts)), scheduleNextBehavior }
  }

  it('返回 interactionCounterRef', () => {
    const { result } = setup()
    expect(result.current.interactionCounterRef).toBeDefined()
    expect(result.current.interactionCounterRef.current).toBeTruthy()
  })

  it('挂载时初始化（applyOfflineDecay + scheduleNextBehavior）', () => {
    const { scheduleNextBehavior } = setup()
    expect(timers.state.applyOfflineDecay).toHaveBeenCalledTimes(1)
    expect(scheduleNextBehavior).toHaveBeenCalledTimes(1)
  })

  it('卸载时清理所有定时器与订阅（不崩溃）', () => {
    const { unmount } = setup()
    expect(() => unmount()).not.toThrow()
  })
})