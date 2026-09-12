/**
 * @file ExpressionSelector.test.tsx
 * @description ExpressionSelector 表情手动切换器组件单测
 *
 * 契约：
 *  1. 渲染全部可用表情按钮 + 「恢复自动」按钮
 *  2. 初始「恢复自动」禁用（无手动覆盖）
 *  3. 点击表情 → 调用 setManualExpression，onSelect 回调上报
 *  4. 点击「恢复自动」→ 清除覆盖，onSelect(null)
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getEmotionManager,
  resetEmotionManager,
  DEFAULT_EXPRESSIONS,
} from '@/lib/ai/emotionManager'
import { ExpressionSelector } from '../pet/ExpressionSelector'

describe('ExpressionSelector', () => {
  beforeEach(() => {
    resetEmotionManager()
  })

  afterEach(() => {
    resetEmotionManager()
  })

  it('渲染全部可用表情按钮', () => {
    render(<ExpressionSelector />)
    for (const opt of DEFAULT_EXPRESSIONS) {
      expect(screen.getByTitle(opt.name)).toBeInTheDocument()
    }
  })

  it('初始「恢复自动」按钮禁用', () => {
    render(<ExpressionSelector />)
    expect(screen.getByRole('button', { name: '恢复自动' })).toBeDisabled()
  })

  it('点击表情按钮设置手动覆盖并回调', () => {
    const onSelect = vi.fn()
    render(<ExpressionSelector onSelect={onSelect} />)

    const target = DEFAULT_EXPRESSIONS[0]
    fireEvent.click(screen.getByTitle(target.name))

    expect(onSelect).toHaveBeenCalledWith(target)
    expect(getEmotionManager().getManualExpression()?.id).toBe(target.id)
    // 选中后「恢复自动」可用
    expect(screen.getByRole('button', { name: '恢复自动' })).not.toBeDisabled()
  })

  it('点击「恢复自动」清除手动覆盖', () => {
    const onSelect = vi.fn()
    render(<ExpressionSelector onSelect={onSelect} />)

    fireEvent.click(screen.getByTitle(DEFAULT_EXPRESSIONS[1].name))
    fireEvent.click(screen.getByRole('button', { name: '恢复自动' }))

    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(getEmotionManager().getManualExpression()).toBeNull()
    expect(screen.getByRole('button', { name: '恢复自动' })).toBeDisabled()
  })
})
