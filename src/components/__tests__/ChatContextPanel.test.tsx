import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatContextPanel } from '../chat/ChatContextPanel'
import { useChatViewStore } from '@/stores/chatViewStore'
import type { ChatMessage } from '@/lib/data/types'
import '@/lib/system/i18n'

const message: ChatMessage = { id: 'a', role: 'assistant', content: 'answer', timestamp: 0 }
const trace = {
  mode: 'enabled' as const,
  capturedAt: 1760000000000,
  sections: [{ id: 'preferences', label: '用户偏好', content: '原始本地记忆 score=0.7', estimatedTokens: 12 }],
}
beforeEach(() => useChatViewStore.setState({ showMemory: true, showMetrics: true, showTimestamps: true }))

describe('ChatContextPanel', () => {
  it('does not claim missing trace means no memory', () => {
    render(<ChatContextPanel />)
    expect(screen.getByText('尚无本轮记忆记录')).toBeInTheDocument()
    expect(screen.queryByText('没有记忆')).not.toBeInTheDocument()
    expect(screen.getByText('尚无本轮指标')).toBeInTheDocument()
  })

  it('shows only captured sections, their estimates and honest context explanation', () => {
    const { container } = render(<ChatContextPanel message={{ ...message, memoryTrace: trace }} />)
    expect(screen.getByText('自动记忆')).toBeInTheDocument()
    expect(screen.getByText('已随本轮请求发送的上下文，不代表模型一定采用')).toBeInTheDocument()
    expect(screen.getByText('约 12 tokens')).toBeInTheDocument()
    const section = screen.getByText('用户偏好').closest('details')!
    expect(section.open).toBe(false)
    fireEvent.click(screen.getByText('用户偏好'))
    expect(section.open).toBe(true)
    expect(screen.getByText('原始本地记忆 score=0.7')).toBeVisible()
    expect(container.textContent).not.toContain('相似度')
    expect(container.textContent).not.toContain('70%')
  })

  it.each([
    ['disabled', '本轮记忆已关闭'],
    ['temporary', '临时会话'],
    ['enabled', '自动记忆'],
  ] as const)('shows %s mode without inventing sections', (mode, label) => {
    render(<ChatContextPanel message={{ ...message, memoryTrace: { ...trace, mode, sections: [] } }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('本轮未附加记忆内容')).toBeInTheDocument()
    expect(screen.queryByText('原始本地记忆 score=0.7')).not.toBeInTheDocument()
  })

  it('shows trace errors and raw content as text, never executable HTML', () => {
    const { container } = render(
      <ChatContextPanel
        message={{
          ...message,
          memoryTrace: {
            ...trace,
            error: '读取记忆失败',
            sections: [{ ...trace.sections[0], content: '<img src=x onerror=alert(1)>' }],
          },
        }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('读取记忆失败')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  })

  it('respects display switches while preserving the management action', () => {
    const manage = vi.fn()
    render(
      <ChatContextPanel
        message={{
          ...message,
          memoryTrace: trace,
          metrics: {
            requestStartTs: 0,
            responseEndTs: 100,
            durationMs: 100,
            model: 'local/model',
          },
        }}
        onManage={manage}
      />,
    )
    expect(screen.getByText('local/model')).toBeInTheDocument()
    act(() => useChatViewStore.getState().setOption('showMemory', false))
    expect(screen.queryByText('原始本地记忆 score=0.7')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /展开指标详情/ })).toBeInTheDocument()
    act(() => useChatViewStore.getState().setOption('showMetrics', false))
    expect(screen.queryByRole('button', { name: /展开指标详情/ })).not.toBeInTheDocument()
    expect(screen.getByText('local/model')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '管理记忆' }))
    expect(manage).toHaveBeenCalledOnce()
  })
})
