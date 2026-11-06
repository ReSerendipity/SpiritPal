// TD-006：静音模式的跨重启持久化 + 会议状态联动（2026-11-06）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workStateListeners: Array<(state: string) => void> = []
const unsubscribeSpy = vi.fn()

vi.mock('@/lib/ai/contextAwareness', () => ({
  getContextAwarenessManager: () => ({
    onWorkStateChange: (cb: (state: string) => void) => {
      workStateListeners.push(cb)
      return () => {
        unsubscribeSpy()
        const idx = workStateListeners.indexOf(cb)
        if (idx >= 0) workStateListeners.splice(idx, 1)
      }
    },
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(async () => undefined),
  unregisterAll: vi.fn(async () => undefined),
}))
vi.mock('@/lib/system/appWindows', () => ({ ensureAppWindow: vi.fn(async () => null) }))

import { SilentModeManager } from '@/lib/system/silentModeManager'

const STORAGE_KEY = 'spiritpal:silent-mode'

/** 构造管理器并把 init() 的微任务跑完 */
async function createManager(): Promise<SilentModeManager> {
  const mgr = new SilentModeManager()
  await vi.advanceTimersByTimeAsync(0)
  return mgr
}

/** 模拟情境感知推送工作状态 */
function fireWorkState(state: string): void {
  workStateListeners.forEach((cb) => cb(state))
}

describe('静音模式持久化与会议联动（TD-006）', () => {
  beforeEach(() => {
    localStorage.clear()
    workStateListeners.length = 0
    unsubscribeSpy.mockClear()
    vi.useFakeTimers()
    // 14:30 不在默认深夜调度（23:00-7:00）范围内，避免调度逻辑干扰断言
    vi.setSystemTime(new Date(2026, 10, 6, 14, 30, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('手动静音写盘，重建管理器后仍恢复静音', async () => {
    const first = await createManager()
    await first.enableSilentMode('manual')

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').isActive).toBe(true)

    const second = await createManager()
    expect(second.isSilent()).toBe(true)
    expect(second.getState().reason).toBe('manual')
    second.destroy()
    first.destroy()
  })

  it('已过期的临时静音不跨重启恢复', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isActive: true,
        reason: 'temporary',
        startedAt: Date.now() - 10 * 60 * 1000,
        resumeAt: Date.now() - 60 * 1000,
      })
    )

    const mgr = await createManager()
    expect(mgr.isSilent()).toBe(false)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').isActive).toBe(false)
    mgr.destroy()
  })

  it('未过期的临时静音跨重启恢复，并按剩余时长自动恢复', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isActive: true,
        reason: 'temporary',
        startedAt: Date.now() - 60 * 1000,
        resumeAt: Date.now() + 4 * 60 * 1000,
      })
    )

    const mgr = await createManager()
    expect(mgr.isSilent()).toBe(true)

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 1000)
    expect(mgr.isSilent()).toBe(false)
    mgr.destroy()
  })

  it('会议静音不跨会话恢复（否则重启后莫名没声音）', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ isActive: true, reason: 'meeting', startedAt: Date.now() - 1000 })
    )

    const mgr = await createManager()
    expect(mgr.isSilent()).toBe(false)
    mgr.destroy()
  })

  it('进入会议自动静音，离开会议自动恢复', async () => {
    const mgr = await createManager()

    fireWorkState('meeting')
    await vi.advanceTimersByTimeAsync(0)
    expect(mgr.isSilent()).toBe(true)
    expect(mgr.getState().reason).toBe('meeting')

    fireWorkState('coding')
    await vi.advanceTimersByTimeAsync(0)
    expect(mgr.isSilent()).toBe(false)
    mgr.destroy()
  })

  it('用户已手动静音时进会议不覆盖原因，出会议也不解除静音', async () => {
    const mgr = await createManager()
    await mgr.enableSilentMode('manual')

    fireWorkState('meeting')
    await vi.advanceTimersByTimeAsync(0)
    expect(mgr.getState().reason).toBe('manual')

    fireWorkState('coding')
    await vi.advanceTimersByTimeAsync(0)
    expect(mgr.isSilent()).toBe(true)
    expect(mgr.getState().reason).toBe('manual')
    mgr.destroy()
  })

  it('会议中用户手动关静音：本轮会议不再自动重开，下一轮会议恢复联动', async () => {
    const mgr = await createManager()

    fireWorkState('meeting')
    await vi.advanceTimersByTimeAsync(0)
    expect(mgr.isSilent()).toBe(true)

    await mgr.disableSilentMode() // 用户手动关闭

    fireWorkState('meeting') // 同一轮会议的后续事件
    await vi.advanceTimersByTimeAsync(0)
    expect(mgr.isSilent()).toBe(false)

    // 会议结束 → 复位，下一轮会议重新自动静音
    fireWorkState('coding')
    await vi.advanceTimersByTimeAsync(0)
    fireWorkState('meeting')
    await vi.advanceTimersByTimeAsync(0)
    expect(mgr.isSilent()).toBe(true)
    mgr.destroy()
  })

  it('destroy() 退订情境感知监听，不再响应会议事件', async () => {
    const mgr = await createManager()
    expect(workStateListeners.length).toBe(1)

    mgr.destroy()
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
    expect(workStateListeners.length).toBe(0)
  })
})
