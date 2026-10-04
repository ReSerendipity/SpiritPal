// MobileNurturingView 番茄钟 UI 测试（审计工单 P1-6）
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetPomodoroManagerForTest, getPomodoroManager } from '@/lib/nurture/pomodoroManager'
import { MobileNurturingView } from '@/mobile/MobileNurturingView'
import { usePetStore } from '@/stores/petStore'

// 与既有 smoke 测试一致：商店/背包依赖角色与物品数据，mock 成固定值
vi.mock('@/lib/nurture/items', () => ({
  getAllShopItems: vi.fn(() => [
    { id: 'food-1', name: '测试食物', type: 'food', price: 10, rarity: 'common' as const },
  ]),
  getFoodsForCharacter: vi.fn(() => [{ id: 'food-1', name: '测试食物' }]),
  getRarityName: vi.fn((r: string) => r),
}))

/** 点击（包 act，避免 React 状态更新告警） */
function click(el: HTMLElement): void {
  act(() => {
    fireEvent.click(el)
  })
}

/** 切到「专注」子页 */
function openFocusTab(): void {
  click(screen.getByRole('button', { name: /专注/ }))
}

describe('MobileNurturingView 番茄钟（P1-6）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    __resetPomodoroManagerForTest()
    usePetStore.setState({ currentCharacterId: 'doro', sharedCoins: 100 })
    usePetStore.getState().initCharacter('doro')
  })

  afterEach(() => {
    getPomodoroManager().reset()
    __resetPomodoroManagerForTest()
    vi.useRealTimers()
  })

  it('默认不显示番茄钟，切到专注页后出现入口与时长档位', () => {
    render(<MobileNurturingView />)
    expect(screen.queryByTestId('pomodoro-card')).not.toBeInTheDocument()

    openFocusTab()
    expect(screen.getByTestId('pomodoro-card')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-duration-15')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-start')).toBeInTheDocument()
  })

  it('开始后倒计时推进，暂停期间不推进，继续后接着走', () => {
    render(<MobileNurturingView />)
    openFocusTab()

    click(screen.getByTestId('pomodoro-duration-15'))
    click(screen.getByTestId('pomodoro-start'))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByTestId('pomodoro-remaining').textContent).toBe('14:00')

    // 暂停 → 冻结
    click(screen.getByTestId('pomodoro-pause'))
    expect(screen.getByTestId('pomodoro-resume')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(screen.getByTestId('pomodoro-remaining').textContent).toBe('14:00')

    // 继续 → 接着走
    click(screen.getByTestId('pomodoro-resume'))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByTestId('pomodoro-remaining').textContent).toBe('13:00')
  })

  it('结束即回到空闲并可重新开始', () => {
    render(<MobileNurturingView />)
    openFocusTab()

    click(screen.getByTestId('pomodoro-duration-15'))
    click(screen.getByTestId('pomodoro-start'))
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    click(screen.getByTestId('pomodoro-stop'))

    expect(screen.getByTestId('pomodoro-start')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-stop-hint').textContent).toBe('已结束专注')
  })

  it('倒计时归零后展示完成反馈与奖励（经验+金币）', () => {
    render(<MobileNurturingView />)
    openFocusTab()

    const coinsBefore = usePetStore.getState().sharedCoins
    click(screen.getByTestId('pomodoro-duration-15'))
    click(screen.getByTestId('pomodoro-start'))
    act(() => {
      vi.advanceTimersByTime(15 * 60_000 + 1000)
    })

    expect(screen.getByTestId('pomodoro-done')).toBeInTheDocument()
    const reward = screen.getByTestId('pomodoro-reward').textContent ?? ''
    // 经验固定 +25；金币至少 +10（可能叠加任务系统奖励）
    expect(reward).toContain('+25')
    expect(usePetStore.getState().sharedCoins).toBeGreaterThanOrEqual(coinsBefore + 10)
    // 再来一轮按钮可重新开始
    click(screen.getByTestId('pomodoro-again'))
    expect(screen.getByTestId('pomodoro-pause')).toBeInTheDocument()
  })
})
