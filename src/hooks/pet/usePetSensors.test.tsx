// 最终放置位置: src/hooks/pet/usePetSensors.test.tsx
// 覆盖: usePetSensors —— smoke 渲染 + 返回结构、音乐状态触发摇摆、卸载清理不崩溃
// Smoke 级: 大量 manager 单例被 mock（musicAwareness/weatherAwareness/contextAwareness/schedule/bubble/event/emotion）
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePetSensors } from './usePetSensors'

const sensors = vi.hoisted(() => {
  const cbs: Record<string, (...a: any[]) => void> = {}
  const sub = (key: string) => (cb: (...a: any[]) => void) => {
    cbs[key] = cb
    return vi.fn()
  }
  return { cbs, sub }
})

vi.mock('../../lib/musicAwareness', () => {
  const mgr = {
    start: vi.fn(),
    stop: vi.fn(),
    onMusicChange: sensors.sub('musicChange'),
  }
  return { getMusicAwarenessManager: () => mgr }
})

vi.mock('../../lib/weatherAwareness', () => {
  const mgr = {
    start: vi.fn(),
    stop: vi.fn(),
    onWeatherChange: sensors.sub('weatherChange'),
  }
  return { getWeatherAwarenessManager: () => mgr }
})

vi.mock('../../lib/contextAwareness', () => {
  const contextMgr = {
    start: vi.fn(),
    stop: vi.fn(),
    onNetworkChange: sensors.sub('networkChange'),
    onWorkStateChange: sensors.sub('workStateChange'),
    onStateChange: sensors.sub('stateChange'),
    getCachedWeather: vi.fn(() => null),
    getLastIdleMinutes: vi.fn(() => 0),
  }
  const notifMgr = { onNotification: sensors.sub('notification') }
  return {
    getContextAwarenessManager: () => contextMgr,
    getNotificationManager: () => notifMgr,
    SOFT_REMINDERS: {
      rest_reminder: { petMessages: ['休息一下～'] },
      drink_reminder: { petMessages: ['喝口水～'] },
    },
  }
})

vi.mock('../../lib/scheduleManager', () => {
  const mgr = { start: vi.fn(), stop: vi.fn(), onReminder: sensors.sub('reminder') }
  return { getScheduleManager: () => mgr }
})

vi.mock('../../lib/bubbleManager', () => ({
  getBubbleManager: () => ({ sendMessage: vi.fn() }),
  MessagePriority: { Proactive: 2 },
}))

vi.mock('../../lib/eventSystem', () => {
  const mgr = {
    start: vi.fn(),
    stop: vi.fn(),
    onActiveEventsChange: sensors.sub('events'),
    getRandomActiveBubble: vi.fn(() => null),
  }
  return { getEventSystemManager: () => mgr }
})

vi.mock('../../lib/emotionManager', () => {
  const mgr = {
    start: vi.fn(),
    stop: vi.fn(),
    tick: vi.fn(),
    startTTSAlignment: vi.fn(),
    getRecentEvents: vi.fn(() => []),
  }
  return { getEmotionManager: vi.fn(() => mgr) }
})

vi.mock('../../lib/animationConfig', () => ({
  animationIdToPetState: vi.fn(() => 'idle'),
}))

describe('usePetSensors', () => {
  function setup() {
    const opts = {
      showBubble: vi.fn(),
      setPetState: vi.fn(),
      setCurrentAnimId: vi.fn(),
      currentCharacterId: 'doro',
      safeTimeout: vi.fn(),
    }
    return renderHook(() => usePetSensors(opts))
  }

  it('返回完整结构（初始 normal）', () => {
    const { result } = setup()
    expect(result.current.musicSwaying).toBe(false)
    expect(result.current.networkOffline).toBe(false)
    expect(result.current.weatherAction).toBe('normal')
    expect(result.current.workStateRef.current).toBe('unknown')
    expect(result.current.musicSwayingRef.current).toBe(false)
    expect(result.current.networkCooldownRef.current).toBe(0)
  })

  it('音乐状态变化触发摇摆', () => {
    const { result } = setup()
    act(() => {
      sensors.cbs.musicChange?.({ state: 'playing' })
    })
    expect(result.current.musicSwaying).toBe(true)
    expect(result.current.musicSwayingRef.current).toBe(true)
    act(() => {
      sensors.cbs.musicChange?.({ state: 'paused' })
    })
    expect(result.current.musicSwaying).toBe(false)
  })

  it('网络状态变化触发离线标志', () => {
    const { result } = setup()
    act(() => {
      sensors.cbs.networkChange?.({ online: false })
    })
    expect(result.current.networkOffline).toBe(true)
    act(() => {
      sensors.cbs.networkChange?.({ online: true })
    })
    expect(result.current.networkOffline).toBe(false)
  })

  it('卸载时清理（不崩溃）', () => {
    const { unmount } = setup()
    expect(() => unmount()).not.toThrow()
  })
})