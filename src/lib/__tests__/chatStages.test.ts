// chatStages 单元测试 — 4 阶段状态机转换
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ChatStageManager,
  STAGE_ANIMATION,
  STAGE_BUBBLE,
  getChatStageManager,
} from '../chatStages'

describe('STAGE_ANIMATION / STAGE_BUBBLE 常量', () => {
  it('每个阶段都有动画映射', () => {
    expect(STAGE_ANIMATION.idle).toBe('idle')
    expect(STAGE_ANIMATION.input).toBe('sit')
    expect(STAGE_ANIMATION.waiting).toBe('eat')
    expect(STAGE_ANIMATION.reply).toBe('happy')
    expect(STAGE_ANIMATION.error).toBe('sad')
  })

  it('每个阶段都有气泡消息（idle 为空）', () => {
    expect(STAGE_BUBBLE.idle).toBe('')
    expect(STAGE_BUBBLE.input).toContain('听')
    expect(STAGE_BUBBLE.waiting).toBeTruthy()
    expect(STAGE_BUBBLE.reply).toBeTruthy()
    expect(STAGE_BUBBLE.error).toBeTruthy()
  })
})

describe('ChatStageManager', () => {
  let mgr: ChatStageManager

  beforeEach(() => {
    // 每个测试创建新实例，避免单例污染
    mgr = new ChatStageManager()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始阶段为 idle', () => {
    expect(mgr.getStage()).toBe('idle')
  })

  it('setStage 更新当前阶段', () => {
    mgr.setStage('waiting')
    expect(mgr.getStage()).toBe('waiting')
  })

  it('onStageChange 监听器被触发并返回动画和气泡', () => {
    const fn = vi.fn()
    const unsub = mgr.onStageChange(fn)
    mgr.setStage('reply')
    expect(fn).toHaveBeenCalledWith('reply', 'happy', STAGE_BUBBLE.reply)
    unsub()
  })

  it('onStageChange 取消订阅后不再触发', () => {
    const fn = vi.fn()
    const unsub = mgr.onStageChange(fn)
    unsub()
    mgr.setStage('reply')
    expect(fn).not.toHaveBeenCalled()
  })

  it('reply 阶段在 8 秒后自动恢复 idle', () => {
    const fn = vi.fn()
    mgr.onStageChange(fn)
    mgr.setStage('reply')
    expect(mgr.getStage()).toBe('reply')
    // 推进 8 秒
    vi.advanceTimersByTime(8000)
    expect(mgr.getStage()).toBe('idle')
    // 至少触发过 reply 和 idle 两次
    expect(fn).toHaveBeenCalledWith('reply', 'happy', STAGE_BUBBLE.reply)
    expect(fn).toHaveBeenCalledWith('idle', 'idle', STAGE_BUBBLE.idle)
  })

  it('error 阶段在 8 秒后自动恢复 idle', () => {
    mgr.setStage('error')
    expect(mgr.getStage()).toBe('error')
    vi.advanceTimersByTime(8000)
    expect(mgr.getStage()).toBe('idle')
  })

  it('连续设置阶段时取消之前的恢复定时器', () => {
    mgr.setStage('reply')
    vi.advanceTimersByTime(5000) // 5 秒，未到 8 秒
    mgr.setStage('error') // 切换到 error 应取消 reply 的恢复定时器
    expect(mgr.getStage()).toBe('error')
    vi.advanceTimersByTime(3000) // 距离 reply 8 秒，但 error 只过了 3 秒
    expect(mgr.getStage()).toBe('error') // 仍是 error
    vi.advanceTimersByTime(5000) // error 8 秒到
    expect(mgr.getStage()).toBe('idle')
  })

  it('restore 取消定时器并恢复 idle', () => {
    mgr.setStage('reply')
    mgr.restore()
    expect(mgr.getStage()).toBe('idle')
    // 推进 8 秒不应触发任何变化
    vi.advanceTimersByTime(8000)
    expect(mgr.getStage()).toBe('idle')
  })
})

describe('getChatStageManager 单例', () => {
  it('多次调用返回同一实例', () => {
    const a = getChatStageManager()
    const b = getChatStageManager()
    expect(a).toBe(b)
  })
})
