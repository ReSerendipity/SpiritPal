// MobileMemoryView smoke 测试 — 可视化 / 记忆列表子页导航
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MobileMemoryView } from '@/mobile/MobileMemoryView'

// mock enhancedMemory：避免测试环境触发真实存储加载
vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => ({
    ensureLoaded: vi.fn(async () => {}),
    getAllMemories: vi.fn(() => []),
  })),
  EnhancedMemoryManager: class {},
}))

// mock MemoryPanel：list 子页复用桌面面板，仅验证导航外壳
vi.mock('@/components/MemoryPanel', () => ({
  MemoryPanel: () => <div data-testid="memory-panel" />,
}))

describe('MobileMemoryView', () => {
  beforeEach(() => {
    cleanup()
  })

  it('默认渲染可视化子页（空记忆显示空状态）', async () => {
    render(<MobileMemoryView />)
    expect(screen.getByRole('button', { name: /可视化/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /记忆列表/i })).toBeInTheDocument()
    // 空记忆 → 三个可视化图表均显示空状态（findBy 等待异步记忆加载完成）
    expect(await screen.findByText('暂无标签数据')).toBeInTheDocument()
    expect(screen.getByText('近 30 天无记忆数据')).toBeInTheDocument()
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('切换到记忆列表子页渲染 MemoryPanel', async () => {
    render(<MobileMemoryView />)
    // 等待异步记忆加载完成，避免 act 警告
    await screen.findByText('暂无标签数据')
    fireEvent.click(screen.getByRole('button', { name: /记忆列表/i }))
    expect(screen.getByTestId('memory-panel')).toBeInTheDocument()
  })
})
