import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/lib/data/types'
import { ChatMessageCard } from '../chat/ChatMessageCard'
import { useChatViewStore } from '@/stores/chatViewStore'
import '@/lib/system/i18n'

// Vitest stubs CSS imports, including ?raw. Load the real stylesheet into jsdom.
const workspaceCss = readFileSync(resolve(process.cwd(), 'src/components/chat/chat-workspace.css'), 'utf8')

const message: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: '一段 **回答**',
  timestamp: 1760000000000,
  thinkContent: '先梳理问题',
  metrics: { requestStartTs: 0, responseEndTs: 1500, durationMs: 1500, promptTokens: 20, completionTokens: 10 },
}
const tracedMessage = {
  ...message,
  memoryTrace: {
    mode: 'enabled' as const,
    capturedAt: 1760000000000,
    sections: [{ id: 'facts', label: '用户偏好', content: '喜欢简洁的回答', estimatedTokens: 12 }],
  },
}

beforeEach(() => {
  useChatViewStore.setState({
    showMetrics: true,
    showThinking: true,
    showMemory: true,
    showTimestamps: true,
    compact: false,
  })
})
afterEach(() => vi.restoreAllMocks())

describe('ChatMessageCard', () => {
  it('renders independent display modules without changing content or actions', () => {
    const regenerate = vi.fn()
    const { container } = render(
      <ChatMessageCard message={tracedMessage} onRegenerate={regenerate} actions={<button>朗读</button>} />,
    )
    expect(container.querySelector('strong')).toHaveTextContent('回答')
    const thinking = screen.getByText('思考过程').closest('details')!
    expect(thinking.open).toBe(false)
    fireEvent.click(screen.getByText('思考过程'))
    expect(thinking.open).toBe(true)
    expect(screen.getByText('先梳理问题')).toBeVisible()
    expect(container.querySelector('time')).toBeInTheDocument()
    expect(screen.getByText('喜欢简洁的回答')).toBeInTheDocument()
    act(() => useChatViewStore.getState().setOption('showThinking', false))
    expect(screen.queryByText('先梳理问题')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /展开指标详情/ })).toBeInTheDocument()
    act(() => useChatViewStore.getState().setOption('showMetrics', false))
    expect(screen.queryByRole('button', { name: /展开指标详情/ })).not.toBeInTheDocument()
    expect(screen.getByText('喜欢简洁的回答')).toBeInTheDocument()
    act(() => useChatViewStore.getState().setOption('showMemory', false))
    expect(screen.queryByText('喜欢简洁的回答')).not.toBeInTheDocument()
    expect(container.querySelector('time')).toBeInTheDocument()
    act(() => useChatViewStore.getState().setOption('showTimestamps', false))
    expect(container.querySelector('time')).not.toBeInTheDocument()
    act(() => useChatViewStore.getState().setOption('compact', true))
    expect(screen.getByRole('article')).toHaveClass('chat-message--compact')
    expect(screen.getByRole('button', { name: '朗读' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect(regenerate).toHaveBeenCalledWith(tracedMessage)
  })

  it('copies the displayed message as plain text and confirms success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ChatMessageCard message={message} />)
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已复制')
    expect(writeText).toHaveBeenCalledWith('一段 **回答**')
  })

  it('shows clipboard failure and allows retry', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ChatMessageCard message={message} />)
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败')
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已复制')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports unavailable clipboard rather than claiming success', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    render(<ChatMessageCard message={message} />)
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败')
  })

  it('keeps long code in a focusable local scroll container', () => {
    const longCode = 'const text = "' + 'x'.repeat(800) + '"'
    const { container } = render(<ChatMessageCard message={{ ...message, content: '```js\n' + longCode + '\n```' }} />)
    const pre = container.querySelector('pre')!
    expect(pre).toHaveClass('chat-code-scroll')
    expect(pre).toHaveAttribute('tabindex', '0')
    expect(pre.querySelector('code')).toHaveTextContent(longCode)
    expect(screen.getByRole('article')).toHaveClass('chat-message--assistant')
  })

  it('applies local code overflow, full assistant width, and touch-sized actions from the shared stylesheet', () => {
    const style = document.createElement('style')
    style.textContent = workspaceCss
    document.head.append(style)
    try {
      const { container } = render(
        <ChatMessageCard message={{ ...message, content: '```\n' + 'x'.repeat(800) + '\n```' }} />,
      )
      const pre = container.querySelector('pre')!
      expect(getComputedStyle(pre).overflowX).toBe('auto')
      expect(getComputedStyle(pre).maxWidth).toBe('100%')
      expect(getComputedStyle(pre).whiteSpace).toBe('pre')
      expect(getComputedStyle(screen.getByRole('article')).width).toBe('100%')
      expect(getComputedStyle(container.querySelector('.chat-message-card')!).maxWidth).toBe('100%')
      expect(
        parseFloat(getComputedStyle(screen.getByRole('button', { name: '复制消息' })).minHeight),
      ).toBeGreaterThanOrEqual(40)
    } finally {
      style.remove()
    }
  })

  it('sanitizes markdown and filters both assistant content and thinking before rendering or copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container, rerender } = render(
      <ChatMessageCard
        message={{
          ...message,
          content: '<script>alert(1)</script>\n\n[link](javascript:alert(1))\n\n<img src=x onerror=alert(1)>',
        }}
      />,
    )
    expect(container.querySelector('script, img[onerror], [href^="javascript:"]')).toBeNull()
    rerender(<ChatMessageCard message={{ ...message, content: 'bomb making', thinkContent: 'explosive device' }} />)
    expect(container.textContent).not.toContain('bomb making')
    expect(container.textContent).not.toContain('explosive device')
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }))
    await screen.findByRole('status')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('已过滤'))
  })

  it.each([
    ['pending', '等待回复'],
    ['aborted', '已停止'],
    ['failed', '发送失败'],
    ['timeout', '响应超时'],
  ] as const)('shows %s explicitly without a fake loading ellipsis', (sendStatus, label) => {
    render(<ChatMessageCard message={{ ...message, content: '', isStreaming: false, sendStatus }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('暂无回复')).toBeInTheDocument()
    expect(screen.queryByText('...')).not.toBeInTheDocument()
  })

  it('disables edit and regenerate while generation is active', () => {
    const onEdit = vi.fn()
    const onRegenerate = vi.fn()
    const { rerender } = render(
      <ChatMessageCard message={{ ...message, isStreaming: true }} onRegenerate={onRegenerate} />,
    )
    const retry = screen.getByRole('button', { name: '重新生成' })
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(onRegenerate).not.toHaveBeenCalled()
    rerender(<ChatMessageCard message={{ ...message, role: 'user', sendStatus: 'pending' }} onEdit={onEdit} />)
    expect(screen.getByRole('button', { name: '编辑重发' })).toBeDisabled()
    rerender(<ChatMessageCard message={{ ...message, role: 'user' }} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑重发' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: message.id, role: 'user' }))
    expect(screen.getByRole('article')).toHaveClass('chat-message--user')
  })

  it('labels active streaming and resets copy feedback when the message changes', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const { rerender } = render(<ChatMessageCard message={message} />)
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }))
    await screen.findByText('已复制')
    rerender(<ChatMessageCard message={{ ...message, id: 'next', content: '', isStreaming: true }} />)
    expect(screen.queryByText('已复制')).not.toBeInTheDocument()
    expect(screen.getByText('正在生成')).toBeInTheDocument()
    expect(screen.queryByText('暂无回复')).not.toBeInTheDocument()
  })
})
