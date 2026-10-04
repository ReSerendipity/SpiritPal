// 番茄钟状态机单测（审计工单 P1-6）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPomodoroManagerForTest,
  getPomodoroManager,
  type PomodoroReward,
} from '@/lib/nurture/pomodoroManager'

describe('pomodoroManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetPomodoroManagerForTest()
  })

  afterEach(() => {
    getPomodoroManager().reset()
    vi.useRealTimers()
  })

  it('初始为 idle，无计时', () => {
    const snap = getPomodoroManager().getSnapshot()
    expect(snap.phase).toBe('idle')
    expect(snap.durationSec).toBe(0)
  })

  it('start 后进入 running，倒计时随真实时间推进', () => {
    const mgr = getPomodoroManager()
    mgr.start(25)
    expect(mgr.getSnapshot().phase).toBe('running')
    expect(mgr.getSnapshot().durationSec).toBe(1500)

    vi.advanceTimersByTime(60_000)
    const snap = mgr.getSnapshot()
    expect(snap.elapsedSec).toBeGreaterThanOrEqual(59)
    expect(snap.remainingSec).toBeLessThanOrEqual(1441)
  })

  it('pause 冻结计时，resume 从冻结点继续（暂停期间不计时）', () => {
    const mgr = getPomodoroManager()
    mgr.start(25)

    vi.advanceTimersByTime(60_000) // 专注 1 分钟
    mgr.pause()
    const paused = mgr.getSnapshot()
    expect(paused.phase).toBe('paused')
    expect(paused.elapsedSec).toBeGreaterThanOrEqual(59)

    vi.advanceTimersByTime(10 * 60_000) // 暂停 10 分钟
    expect(mgr.getSnapshot().elapsedSec).toBeCloseTo(paused.elapsedSec, 3)

    mgr.resume()
    expect(mgr.getSnapshot().phase).toBe('running')
    vi.advanceTimersByTime(60_000)
    // 暂停的 10 分钟不计入：约 2 分钟
    expect(mgr.getSnapshot().elapsedSec).toBeGreaterThanOrEqual(118)
    expect(mgr.getSnapshot().elapsedSec).toBeLessThan(125)
  })

  it('倒计时归零触发完成结算，回调返回奖励并进入 done', () => {
    const mgr = getPomodoroManager()
    const rewards: PomodoroReward[] = []
    mgr.setCompletionHandler((minutes) => {
      const r = { exp: 25, coins: 10 + minutes }
      rewards.push(r)
      return r
    })

    mgr.start(1) // 1 分钟档，便于推进
    vi.advanceTimersByTime(61_000)

    expect(rewards).toHaveLength(1)
    expect(rewards[0].exp).toBe(25)
    const snap = mgr.getSnapshot()
    expect(snap.phase).toBe('done')
    expect(snap.remainingSec).toBe(0)
    expect(snap.reward).toEqual({ exp: 25, coins: 11 })
  })

  it('提前 stop 不发放奖励并回到 idle', () => {
    const mgr = getPomodoroManager()
    const handler = vi.fn(() => ({ exp: 25, coins: 10 }))
    mgr.setCompletionHandler(handler)

    mgr.start(25)
    vi.advanceTimersByTime(30_000)
    mgr.stop()

    expect(handler).not.toHaveBeenCalled()
    const snap = mgr.getSnapshot()
    expect(snap.phase).toBe('idle')
    expect(snap.durationSec).toBe(0)
    expect(snap.reward).toBeNull()
  })

  it('订阅者可收到状态推送，退订后不再收到', () => {
    const mgr = getPomodoroManager()
    const seen: string[] = []
    const unsub = mgr.subscribe((s) => seen.push(s.phase))
    mgr.start(25)
    vi.advanceTimersByTime(1000)
    unsub()
    mgr.pause()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen).not.toContain('paused')
  })
})
