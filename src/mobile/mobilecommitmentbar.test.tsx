// P1-7-fe: 到期/逾期约定提示条（聊天页与记忆页共用）
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { MobileCommitmentBar } from './MobileCommitmentBar'

const dueMock = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]))
const overdueMock = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]))

vi.mock('@/lib/nurture/commitmentTracker', () => ({
  getCommitmentTracker: () => ({
    getDueTodayCommitments: dueMock,
    getOverdueCommitments: overdueMock,
  }),
}))

describe('MobileCommitmentBar（P1-7-fe）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dueMock.mockResolvedValue([])
    overdueMock.mockResolvedValue([])
  })

  it('无到期也无逾期时不渲染（不留空条）', async () => {
    render(<MobileCommitmentBar />)
    await waitFor(() => {
      expect(dueMock).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('commitment-bar')).not.toBeInTheDocument()
  })

  it('今天到期项：显示条数与首条内容', async () => {
    dueMock.mockResolvedValue([{ id: 1, content: '去爬山', due_at: Date.now(), status: 'open' }])
    render(<MobileCommitmentBar />)
    await waitFor(() => {
      expect(screen.getByTestId('commitment-bar')).toBeInTheDocument()
    })
    expect(screen.getByTestId('commitment-due').textContent).toBe('今天到期 1 项')
    expect(screen.getByTestId('commitment-bar').textContent).toContain('去爬山')
  })

  it('逾期项：显示逾期计数', async () => {
    overdueMock.mockResolvedValue([{ id: 2, content: '交周报', due_at: Date.now() - 86400000, status: 'open' }])
    render(<MobileCommitmentBar />)
    await waitFor(() => {
      expect(screen.getByTestId('commitment-overdue')).toBeInTheDocument()
    })
    expect(screen.getByTestId('commitment-overdue').textContent).toBe('已逾期 1 项')
  })

  it('读取失败静默降级（不渲染、不抛错）', async () => {
    dueMock.mockRejectedValue(new Error('db locked'))
    render(<MobileCommitmentBar />)
    await waitFor(() => {
      expect(dueMock).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('commitment-bar')).not.toBeInTheDocument()
  })
})
