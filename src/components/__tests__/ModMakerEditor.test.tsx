// ModMakerEditor 组件测试 — 渲染/实时预览/动画行编辑/拖拽上传/导出流程（mock ModPackager）
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
// ============ mock ModPackager ============
const { mockPack, mockOnExported } = vi.hoisted(() => ({
  mockPack: vi.fn(),
  mockOnExported: vi.fn(),
}))

vi.mock('@/lib/data/modPackager', () => ({
  getModPackager: () => ({ pack: mockPack }),
}))

import { ModMakerEditor } from '@/components/mod-maker/ModMakerEditor'

beforeEach(() => {
  mockPack.mockReset()
  mockOnExported.mockReset()
})

describe('ModMakerEditor 渲染与实时预览', () => {
  it('应渲染标题、5 个编辑 tab 与导出按钮', () => {
    render(<ModMakerEditor />)
    expect(screen.getByText(/ModMaker/)).toBeInTheDocument()
    for (const label of ['基础属性', '动画', '表情', '物品', '对话']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /导出 .petmod/ })).toBeInTheDocument()
  })

  it('编辑角色名后右侧预览应实时更新', () => {
    render(<ModMakerEditor />)
    fireEvent.change(screen.getByLabelText('角色显示名'), { target: { value: '小咪' } })
    // 预览卡片显示新名字
    expect(screen.getByText('小咪')).toBeInTheDocument()
  })

  it('动画 tab 中添加一行动画后预览计数应更新', () => {
    render(<ModMakerEditor />)
    const initialCount = screen.getByText(/动画列表（\d+）/)
    const before = Number(initialCount.textContent?.match(/\d+/)?.[0] ?? 0)

    fireEvent.click(screen.getByRole('button', { name: '动画' }))
    fireEvent.click(screen.getByRole('button', { name: /添加动画/ }))

    expect(screen.getByText(`动画列表（${before + 1}）`)).toBeInTheDocument()
  })
})

describe('精灵图拖拽上传', () => {
  it('拖入文件后 spriteAsset 应记录为 sprites/<文件名>', () => {
    render(<ModMakerEditor />)
    const dropzone = screen.getByTestId('sprite-dropzone')
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['x'], 'hero.webp')] },
    })
    expect(dropzone.textContent).toContain('sprites/hero.webp')
  })
})

describe('导出流程（mock ModPackager.pack）', () => {
  it('校验失败时不应调用 pack 且展示错误', async () => {
    render(<ModMakerEditor />)
    // 初始 author 为空 → 校验失败
    fireEvent.click(screen.getByRole('button', { name: /导出 .petmod/ }))
    await waitFor(() => {
      expect(screen.getByTestId('export-errors')).toBeInTheDocument()
    })
    expect(mockPack).not.toHaveBeenCalled()
  })

  it('填写作者后导出应调用 pack 并回调 onExported', async () => {
    mockPack.mockResolvedValue({
      success: true,
      outputPath: '/mock/appdata/custom-pet-0.1.0.petmod',
      sha256: 'deadbeef',
    })
    render(<ModMakerEditor onExported={mockOnExported} />)

    fireEvent.change(screen.getByLabelText('作者'), { target: { value: 'qa' } })
    fireEvent.click(screen.getByRole('button', { name: /导出 .petmod/ }))

    await waitFor(() => {
      expect(mockPack).toHaveBeenCalledTimes(1)
    })
    // 源目录应包含 mod id
    const packArg = mockPack.mock.calls[0]?.[0] as { sourceDir: string }
    expect(packArg.sourceDir).toContain('custom-pet')

    await waitFor(() => {
      expect(mockOnExported).toHaveBeenCalledWith({
        outputPath: '/mock/appdata/custom-pet-0.1.0.petmod',
        sha256: 'deadbeef',
      })
    })
    expect(screen.getByText(/导出成功/)).toBeInTheDocument()
  })

  it('pack 失败时应展示错误信息', async () => {
    mockPack.mockResolvedValue({ success: false, error: '清单校验失败: bad' })
    render(<ModMakerEditor />)
    fireEvent.change(screen.getByLabelText('作者'), { target: { value: 'qa' } })
    fireEvent.click(screen.getByRole('button', { name: /导出 .petmod/ }))
    await waitFor(() => {
      expect(screen.getByText(/清单校验失败/)).toBeInTheDocument()
    })
  })
})
