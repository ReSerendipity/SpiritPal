/**
 * bargeIn 单元测试
 *
 * 覆盖：
 * - 有效开口判定（过滤单字/语气词/纯标点）
 * - 打断开关与 stopper 调用
 * - 多次打断只返回一次 true
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSpeechStoppersForTests,
  interruptSpeech,
  isBargeInEnabled,
  isSubstantiveUtterance,
  registerSpeechStopper,
  setBargeInEnabled,
} from '@/lib/ai/bargeIn'

describe('isSubstantiveUtterance', () => {
  it('单字/语气词/纯标点不算有效开口', () => {
    expect(isSubstantiveUtterance('')).toBe(false)
    expect(isSubstantiveUtterance('嗯')).toBe(false)
    expect(isSubstantiveUtterance('啊？')).toBe(false)
    expect(isSubstantiveUtterance('。。。')).toBe(false)
  })

  it('两个汉字或英文词算有效开口', () => {
    expect(isSubstantiveUtterance('你好')).toBe(true)
    expect(isSubstantiveUtterance('等一下')).toBe(true)
    expect(isSubstantiveUtterance('ok')).toBe(true)
  })

  it('可通过阈值放宽', () => {
    expect(isSubstantiveUtterance('嗯', 1)).toBe(true)
  })
})

describe('interruptSpeech', () => {
  beforeEach(() => {
    clearSpeechStoppersForTests()
    setBargeInEnabled(true)
  })

  afterEach(() => {
    clearSpeechStoppersForTests()
    setBargeInEnabled(true)
  })

  it('开关关闭时不调用 stopper', () => {
    const stopper = vi.fn(() => true)
    registerSpeechStopper(stopper)
    setBargeInEnabled(false)
    expect(isBargeInEnabled()).toBe(false)
    expect(interruptSpeech('manual')).toBe(false)
    expect(stopper).not.toHaveBeenCalled()
  })

  it('调用已注册 stopper 并报告是否打断成功', () => {
    const stopper = vi.fn(() => true)
    const unregister = registerSpeechStopper(stopper)
    expect(interruptSpeech('mic')).toBe(true)
    expect(stopper).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('注册后再次打断不会重复报告播放中', () => {
    registerSpeechStopper(() => false)
    expect(interruptSpeech('send')).toBe(false)
  })

  it('stopper 抛错不影响主流程', () => {
    registerSpeechStopper(() => {
      throw new Error('boom')
    })
    expect(() => interruptSpeech('voice')).not.toThrow()
  })
})
