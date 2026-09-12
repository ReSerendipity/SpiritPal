/**
 * @file emotionManager.manual.test.ts
 * @description EmotionManager 手动表情覆盖逻辑单测
 *
 * 契约：
 *  1. listAvailableExpressions() 返回 DEFAULT_EXPRESSIONS 的拷贝
 *  2. setManualExpression(option) 立即应用表情并记录覆盖
 *  3. 手动覆盖期间 triggerEmotionSelection 被抑制（不抢戏）
 *  4. clearManualExpression() 清除覆盖并回退到 idle
 *  5. destroy()/reset() 一并清除手动覆盖
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  EmotionManager,
  DEFAULT_EXPRESSIONS,
  type ExpressionOption,
} from '@/lib/ai/emotionManager'

function makeCallbacks() {
  return {
    onExpressionApply: vi.fn(),
    onExpressionClear: vi.fn(),
    onEmotionTriggered: vi.fn(),
  }
}

describe('EmotionManager 手动表情覆盖', () => {
  let manager: EmotionManager
  let cbs: ReturnType<typeof makeCallbacks>

  beforeEach(() => {
    cbs = makeCallbacks()
    manager = new EmotionManager(cbs)
  })

  it('listAvailableExpressions 返回 DEFAULT_EXPRESSIONS 的拷贝', () => {
    const list = manager.listAvailableExpressions()
    expect(list).toEqual(DEFAULT_EXPRESSIONS)
    // 拷贝：外部修改不影响内部
    list.push({ id: 'hack', name: 'x', weight: 1 })
    expect(manager.listAvailableExpressions()).toHaveLength(DEFAULT_EXPRESSIONS.length)
  })

  it('初始无手动覆盖', () => {
    expect(manager.getManualExpression()).toBeNull()
  })

  it('setManualExpression 立即应用表情并记录覆盖', () => {
    const opt: ExpressionOption = DEFAULT_EXPRESSIONS[0]
    manager.setManualExpression(opt)

    expect(manager.getManualExpression()).toEqual(opt)
    expect(cbs.onExpressionApply).toHaveBeenCalledTimes(1)
    expect(cbs.onExpressionApply).toHaveBeenCalledWith(opt, expect.any(Number))
  })

  it('手动覆盖期间自动表情触发被抑制', async () => {
    const opt: ExpressionOption = DEFAULT_EXPRESSIONS[0]
    manager.setManualExpression(opt)
    cbs.onExpressionApply.mockClear()

    await manager.triggerEmotionSelection(false)

    expect(cbs.onExpressionApply).not.toHaveBeenCalled()
    expect(cbs.onEmotionTriggered).not.toHaveBeenCalled()
  })

  it('clearManualExpression 清除覆盖并回退到 idle', () => {
    manager.setManualExpression(DEFAULT_EXPRESSIONS[0])
    cbs.onExpressionClear.mockClear()

    manager.clearManualExpression()

    expect(manager.getManualExpression()).toBeNull()
    expect(cbs.onExpressionClear).toHaveBeenCalledTimes(1)
  })

  it('无覆盖时调用 clearManualExpression 不触发 onExpressionClear', () => {
    manager.clearManualExpression()
    expect(cbs.onExpressionClear).not.toHaveBeenCalled()
  })

  it('清除覆盖后自动表情恢复可用', async () => {
    manager.setManualExpression(DEFAULT_EXPRESSIONS[0])
    manager.clearManualExpression()
    cbs.onExpressionApply.mockClear()

    // 无 LLM 回调 → 随机选择路径，仍会调用 onExpressionApply
    await manager.triggerEmotionSelection(false)

    expect(cbs.onExpressionApply).toHaveBeenCalledTimes(1)
  })

  it('destroy() 清除手动覆盖状态', () => {
    manager.setManualExpression(DEFAULT_EXPRESSIONS[0])
    manager.destroy()
    expect(manager.getManualExpression()).toBeNull()
  })
})
