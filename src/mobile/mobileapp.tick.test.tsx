// P1-5：MobileApp 常驻衰减计时器——挂机期间饱食/心情随时间下降（与桌面每小时间隔同速率）
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markAgreementAccepted } from '@/components/AgreementGate'
import { usePetStore } from '@/stores/petStore'
import MobileApp from './MobileApp'

// 子视图 mock：只验证 MobileApp 的计时器接线
vi.mock('./MobilePetView', () => ({
  MobilePetView: () => <div data-testid="mobile-pet-view" />,
}))
vi.mock('./MobileChatView', () => ({
  MobileChatView: () => <div data-testid="mobile-chat-view" />,
}))
vi.mock('./MobileNurturingView', () => ({
  MobileNurturingView: () => <div data-testid="mobile-nurturing-view" />,
}))
vi.mock('./MobileSettingsView', () => ({
  MobileSettingsView: () => <div data-testid="mobile-settings-view" />,
}))

/** 把当前角色数值固定到已知基线（hunger/mood=80，lastTickAt=现在） */
function seedStats(): void {
  usePetStore.getState().initCharacter('doro')
  usePetStore.setState((s) => ({
    stats: {
      ...s.stats,
      doro: { ...s.stats['doro'], hunger: 80, mood: 80, lastTickAt: Date.now() },
    },
  }))
}

describe('MobileApp 衰减计时器（P1-5）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
    localStorage.clear()
    markAgreementAccepted()
    usePetStore.setState({ currentCharacterId: 'doro' })
    seedStats()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('挂载后挂机满一小时，饱食度与心情下降', () => {
    render(<MobileApp />)
    expect(screen.getByTestId('mobile-pet-view')).toBeInTheDocument()

    // 看门狗每分钟轮询一次，推进 1 小时 + 1 分钟
    act(() => {
      vi.advanceTimersByTime(61 * 60 * 1000)
    })

    const stats = usePetStore.getState().stats['doro']
    expect(stats.hunger).toBeCloseTo(78, 5)
    expect(stats.mood).toBeCloseTo(78.5, 5)
  })

  it('不足一小时不衰减', () => {
    render(<MobileApp />)

    act(() => {
      vi.advanceTimersByTime(59 * 60 * 1000)
    })

    const stats = usePetStore.getState().stats['doro']
    expect(stats.hunger).toBeCloseTo(80, 5)
    expect(stats.mood).toBeCloseTo(80, 5)
  })

  it('卸载后清理定时器，不再继续衰减', () => {
    const { unmount } = render(<MobileApp />)
    unmount()
    seedStats()

    act(() => {
      vi.advanceTimersByTime(3 * 60 * 60 * 1000)
    })

    const stats = usePetStore.getState().stats['doro']
    expect(stats.hunger).toBeCloseTo(80, 5)
    expect(stats.mood).toBeCloseTo(80, 5)
  })
})
