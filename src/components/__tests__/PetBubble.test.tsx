// PetBubble 组件测试 — 气泡显示、自动消失、onClose 回调
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { PetBubble } from '../PetBubble'

describe('PetBubble', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('渲染消息文本', () => {
    render(<PetBubble message="你好呀主人" onClose={vi.fn()} />)
    expect(screen.getByText('你好呀主人')).toBeInTheDocument()
  })

  it('使用默认 duration=3000ms', () => {
    const onClose = vi.fn()
    render(<PetBubble message="测试消息" onClose={onClose} />)
    // 未到 duration 时不应调用 onClose
    vi.advanceTimersByTime(2999)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('duration 后触发 closing 状态（300ms 渐隐动画）', () => {
    render(<PetBubble message="消失测试" onClose={vi.fn()} duration={1000} />)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    // closing 状态：opacity-0 class 应出现
    const container = document.querySelector('.opacity-0')
    expect(container).not.toBeNull()
  })

  it('duration + 300ms 后调用 onClose', () => {
    const onClose = vi.fn()
    render(<PetBubble message="关闭测试" onClose={onClose} duration={1000} />)
    vi.advanceTimersByTime(1000)
    expect(onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('支持自定义 duration', () => {
    const onClose = vi.fn()
    render(<PetBubble message="自定义时长" onClose={onClose} duration={500} />)
    vi.advanceTimersByTime(499)
    expect(onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    // closing 已触发但 onClose 尚未（需 +300ms）
    expect(onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('卸载时清理定时器', () => {
    const onClose = vi.fn()
    const { unmount } = render(<PetBubble message="卸载测试" onClose={onClose} />)
    unmount()
    // 卸载后推进时间不应触发 onClose
    vi.advanceTimersByTime(5000)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('渲染空消息不崩溃', () => {
    render(<PetBubble message="" onClose={vi.fn()} />)
    // 空消息也应正常渲染容器
    const container = document.querySelector('.absolute')
    expect(container).not.toBeNull()
  })
})
