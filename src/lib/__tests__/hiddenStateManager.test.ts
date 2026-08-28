/**
 * @file hiddenStateManager.test.ts
 * @description 贴边隐藏状态管理器单测（A-2 接线配套）
 *
 * 契约：
 *  1. switchTo 切换状态并广播 CustomEvent
 *  2. 冷却期（2s）内重复切换被忽略
 *  3. 同状态切换被忽略
 *  4. 非正常状态到达最大时长自动回流 normal（autoReturnTimer）
 *  5. forceReturnToNormal 立即回流（绕过冷却）
 *  6. stop 清理所有定时器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// hiddenStateManager 的 gatherWindowState 使用 Tauri window API，mock 掉避免导入副作用
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    innerSize: vi.fn(() => Promise.resolve({ width: 200, height: 200 })),
    currentMonitor: vi.fn(() =>
      Promise.resolve({
        size: { width: 1920, height: 1080 },
        position: { x: 0, y: 0 },
        scaleFactor: 1,
      }),
    ),
  }),
}))

import {
  getHiddenStateManager,
  resetHiddenStateManager,
  type HiddenState,
} from '../hiddenStateManager'

function getState() {
  return getHiddenStateManager().getCurrentState()
}

beforeEach(() => {
  vi.useFakeTimers()
  resetHiddenStateManager()
  // 记录广播的事件
  window.dispatchEvent = vi.fn(window.dispatchEvent.bind(window))
})

afterEach(() => {
  getHiddenStateManager().stop()
  resetHiddenStateManager()
  vi.useRealTimers()
})

describe('HiddenStateManager', () => {
  it('switchTo 切换状态并广播 CustomEvent', async () => {
    const listener = vi.fn()
    window.addEventListener('spiritpal:hidden-state-change', listener)

    const ok = await getHiddenStateManager().switchTo('climbing', 'left')

    expect(ok).toBe(true)
    expect(getState().state).toBe('climbing')
    expect(getState().edgeDir).toBe('left')

    // 事件广播携带状态
    const events = listener.mock.calls.map((c) => c[0] as CustomEvent)
    expect(events.some((e) => e.detail?.state === 'climbing')).toBe(true)
  })

  it('冷却期（2s）内重复切换被忽略', async () => {
    const mgr = getHiddenStateManager()
    await mgr.switchTo('climbing', 'left')

    // 1 秒后尝试切 peeking → 冷却拒绝
    vi.advanceTimersByTime(1000)
    const ok = await mgr.switchTo('peeking', 'left')

    expect(ok).toBe(false)
    expect(getState().state).toBe('climbing')
  })

  it('同状态切换被忽略', async () => {
    const mgr = getHiddenStateManager()
    await mgr.switchTo('climbing', 'left')
    vi.advanceTimersByTime(3000) // 越过冷却

    const ok = await mgr.switchTo('climbing', 'right')

    expect(ok).toBe(false)
    expect(getState().edgeDir).toBe('left')
  })

  it('爬墙超时（30s）自动回流 normal', async () => {
    const mgr = getHiddenStateManager()
    await mgr.switchTo('climbing', 'left')

    vi.advanceTimersByTime(31_000)

    expect(getState().state).toBe('normal')
  })

  it('forceReturnToNormal 绕过冷却立即回流', async () => {
    const mgr = getHiddenStateManager()
    await mgr.switchTo('climbing', 'left')

    mgr.forceReturnToNormal()

    expect(getState().state).toBe('normal')
    // 回流后不再有自动返回定时器
    vi.advanceTimersByTime(60_000)
    expect(getState().state).toBe('normal')
  })

  it('stop 清理定时器（不再自动回流）', async () => {
    const mgr = getHiddenStateManager()
    await mgr.switchTo('climbing', 'left')

    mgr.stop()
    vi.advanceTimersByTime(60_000)

    // stop 后 autoReturnTimer 已清除，状态保持 climbing
    expect(getState().state).toBe('climbing')
  })
})

// 让 HiddenState 类型在测试中被引用，避免未使用告警（类型校验用）
export type _HiddenStateCheck = HiddenState
