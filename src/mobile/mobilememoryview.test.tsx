// MobileMemoryView smoke 测试 — 可视化 / 记忆列表子页导航
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EnhancedMemory } from '@/lib/memory/enhancedMemory'
import { MobileMemoryView } from '@/mobile/MobileMemoryView'

// mock enhancedMemory：避免测试环境触发真实存储加载
const { getAllMemoriesMock } = vi.hoisted(() => ({
  getAllMemoriesMock: vi.fn<() => EnhancedMemory[]>(() => []),
}))
vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => ({
    ensureLoaded: vi.fn(async () => {}),
    getAllMemories: getAllMemoriesMock,
  })),
  EnhancedMemoryManager: class {},
}))

// P3-7：语义事实读取走 db（jsdom 无 Tauri），mock 固定数据
const { semanticFactsMock } = vi.hoisted(() => ({
  semanticFactsMock: [
    {
      id: 1,
      character_id: 'doro',
      fact_key: '喜好',
      fact_value: '主人喜欢爬山',
      source_memory_ids: ['m1', 'm2'],
      importance: 80,
      created_at: Date.now(),
      updated_at: Date.now(),
      is_autobiographical: 0,
    },
  ],
}))
vi.mock('@/lib/data/db', () => ({
  getSemanticFacts: vi.fn(() => Promise.resolve(semanticFactsMock)),
}))

// mock MemoryPanel：list 子页复用桌面面板，仅验证导航外壳
vi.mock('@/components/MemoryPanel', () => ({
  MemoryPanel: () => <div data-testid="memory-panel" />,
}))

describe('MobileMemoryView', () => {
  beforeEach(() => {
    cleanup()
    getAllMemoriesMock.mockReturnValue([])
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

  it('从记忆列表切回可视化时重新读取记忆，删除后无需重启即可刷新', async () => {
    getAllMemoriesMock.mockReturnValue([
      {
        id: 'mem-refresh-1',
        user: '喜欢爬山',
        assistant: '记住啦',
        created_at: new Date().toISOString(),
        importance: 50,
        emotionalIntensity: 0.5,
        category: '日常',
        tags: ['爬山'],
        accessCount: 0,
        lastAccessed: Date.now(),
        decayFactor: 1,
        isAutobiographical: false,
      },
    ])
    render(<MobileMemoryView />)
    expect(await screen.findByText('#爬山')).toBeInTheDocument()

    // 模拟在记忆列表里删除后，管理器的数据已变化
    getAllMemoriesMock.mockReturnValue([])
    fireEvent.click(screen.getByRole('button', { name: /记忆列表/i }))
    fireEvent.click(screen.getByRole('button', { name: /可视化/i }))

    await waitFor(() => {
      expect(screen.getByText('暂无标签数据')).toBeInTheDocument()
    })
  })

  it('P3-7：语义事实子页渲染只读列表（key/重要性/来源数）', async () => {
    render(<MobileMemoryView />)
    await screen.findByText('暂无标签数据')
    fireEvent.click(screen.getByRole('button', { name: /语义事实/i }))
    await waitFor(() => {
      expect(screen.getByTestId('semantic-fact-card')).toBeInTheDocument()
    })
    expect(screen.getByText('主人喜欢爬山')).toBeInTheDocument()
    expect(screen.getByText('喜好')).toBeInTheDocument()
    expect(screen.getByText('重要性 80')).toBeInTheDocument()
    expect(screen.getByText('关联记忆 2 条')).toBeInTheDocument()
  })

  it('P1-3-fe：实体图谱子页渲染画布与诚实占位说明', async () => {
    render(<MobileMemoryView />)
    await screen.findByText('暂无标签数据')
    fireEvent.click(screen.getByRole('button', { name: /实体图谱/i }))
    expect(screen.getByTestId('entity-graph-canvas')).toBeInTheDocument()
    // 诚实占位：明确说明数据来源是规则层抽取、深度抽取未接入
    expect(screen.getByText(/规则层关键词抽取/)).toBeInTheDocument()
  })
})
