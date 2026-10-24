import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MessageMetrics } from '@/lib/data/types'
import { MessageMetricsBar } from '../chat/MessageMetricsBar'
import '@/lib/system/i18n'

const base: MessageMetrics = { requestStartTs: 0, responseEndTs: 1000, durationMs: 1000 }

function detail(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling!
}

describe('MessageMetricsBar', () => {
  it('keeps absent usage distinct from zero', () => {
    render(
      <MessageMetricsBar
        metrics={{ requestStartTs: 0, responseEndTs: 1000, durationMs: 1000, usageSource: 'unavailable' }}
      />,
    )
    expect(screen.getByText('用量未提供')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('NaN tok')).not.toBeInTheDocument()
    expect(screen.queryByText('0 tok')).not.toBeInTheDocument()
  })
  it('does not derive output rate from request duration', () => {
    render(
      <MessageMetricsBar
        metrics={{ requestStartTs: 0, responseEndTs: 1000, durationMs: 1000, promptTokens: 20, completionTokens: 10 }}
      />,
    )
    expect(screen.queryByText('10 tok/s')).not.toBeInTheDocument()
    expect(screen.getByText('30 tok')).toBeInTheDocument()
  })

  it('summarizes input/output/first output/duration and preserves genuine zero usage', () => {
    render(
      <MessageMetricsBar
        metrics={{ ...base, promptTokens: 0, completionTokens: 0, ttftMs: 0, usageSource: 'reported' }}
      />,
    )
    const summary = screen.getByRole('button', { name: /展开指标详情/ })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(within(summary).getByText('输入 0')).toBeInTheDocument()
    expect(within(summary).getByText('输出 0')).toBeInTheDocument()
    expect(within(summary).getByText('首输出 0ms')).toBeInTheDocument()
    expect(within(summary).getByText('耗时 1.0s')).toBeInTheDocument()
    fireEvent.click(summary)
    expect(detail('输入 tokens')).toHaveTextContent(/^0$/)
    expect(detail('输出 tokens')).toHaveTextContent(/^0$/)
    expect(detail('用量来源')).toHaveTextContent('服务商报告')
  })

  it('keeps partial usage unknown and marks older metrics as history', () => {
    render(<MessageMetricsBar metrics={{ ...base, completionTokens: 10 }} />)
    expect(screen.getByText('输入 未提供')).toBeInTheDocument()
    expect(screen.getByText('输出 10')).toBeInTheDocument()
    expect(screen.getByText('历史记录')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(detail('输入 tokens')).toHaveTextContent('未提供')
    expect(detail('输出速率')).toHaveTextContent('未提供')
    expect(screen.queryByText('输入速率')).not.toBeInTheDocument()
  })

  it('expands all reported metrics without inferring server timing', () => {
    render(
      <MessageMetricsBar
        metrics={{
          ...base,
          promptTokens: 120,
          completionTokens: 30,
          ttftMs: 150,
          firstTextMs: 280,
          generationMs: 700,
          tokensPerSec: 42.857142,
          serverOutputTokensPerSec: 45.6789,
          inputTokensPerSec: 1200.345,
          cachedInputTokens: 0,
          reasoningTokens: 5,
          usageSource: 'reported',
          status: 'completed',
          model: 'test-model',
          provider: 'local',
          firstTokenTs: 150,
          firstTextTs: 280,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(detail('首输出延迟')).toHaveTextContent('150ms')
    expect(detail('首正文延迟')).toHaveTextContent('280ms')
    expect(detail('生成耗时')).toHaveTextContent('700ms')
    expect(detail('输出速率')).toHaveTextContent('42.9 tok/s')
    expect(detail('服务端输出速率')).toHaveTextContent('45.7 tok/s')
    expect(detail('输入速率')).toHaveTextContent('1200.3 tok/s')
    expect(detail('缓存输入 tokens')).toHaveTextContent(/^0$/)
    expect(detail('推理 tokens')).toHaveTextContent(/^5$/)
    expect(detail('状态')).toHaveTextContent('已完成')
    expect(detail('模型')).toHaveTextContent('test-model')
    expect(detail('服务商')).toHaveTextContent('local')
  })

  it('renders invalid historic numbers as missing rather than NaN or Infinity', () => {
    const { container } = render(
      <MessageMetricsBar
        metrics={{
          ...base,
          promptTokens: Number.NaN,
          completionTokens: Infinity,
          durationMs: Number.NaN,
          tokensPerSec: -1,
          ttftMs: Infinity,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(container.textContent).not.toMatch(/NaN|Infinity|-1 tok/)
    expect(detail('总耗时')).toHaveTextContent('未提供')
    expect(detail('输出速率')).toHaveTextContent('未提供')
  })
})
