// MobileChatView smoke 测试（审计 P3-10 S1）
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileChatView } from './MobileChatView'

// react-markdown 在 jsdom 下可运行，但为 smoke 稳定性将其 mock
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}))

describe('MobileChatView', () => {
  it('渲染消息列表与输入区（无消息时为空态）', () => {
    render(<MobileChatView isDark={false} />)
    // 输入框存在即可用
    const input = screen.queryByPlaceholderText(/输入|消息/i) ?? screen.queryByRole('textbox')
    expect(input).toBeTruthy()
  })

  it('深色模式下可渲染', () => {
    render(<MobileChatView isDark={true} />)
    expect(document.body).toBeTruthy()
  })
})
