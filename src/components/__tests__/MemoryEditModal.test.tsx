/**
 * MemoryEditModal.test.tsx
 *
 * 记忆编辑弹窗数据绑定单测：
 * 1. 用 memory 回填文本/分类/标签/时间
 * 2. 添加 / 删除标签
 * 3. 保存把表单值回传给 onSave
 * 4. 取消调用 onCancel
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryEditModal, type MemoryFormValues } from '@/components/memory/MemoryEditModal'
import type { DisplayMemory } from '@/lib/memory/memoryEditor'

const baseMemory: DisplayMemory = {
  id: 'mem-1',
  created_at: '2026-01-01T10:00:00.000Z',
  user: '妈妈喜欢喝茶',
  assistant: '',
  category: '关系',
  tags: ['person:妈妈'],
  importance: 70,
  isAutobiographical: true,
}

describe('MemoryEditModal', () => {
  it('memory 为 null 时不渲染弹窗', () => {
    render(<MemoryEditModal memory={null} onCancel={vi.fn()} onSave={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('回填记忆文本 / 分类 / 标签', () => {
    render(<MemoryEditModal memory={baseMemory} onCancel={vi.fn()} onSave={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    // 文本
    const textarea = screen.getByPlaceholderText('记录了什么……') as HTMLTextAreaElement
    expect(textarea.value).toBe('妈妈喜欢喝茶')
    // 标签回显（person:妈妈 → 人物·妈妈）
    expect(screen.getByText('妈妈')).toBeTruthy()
    expect(dialog.textContent).toContain('人物')
  })

  it('添加标签：选择维度 + 输入文本 + 点击添加 → 出现带维度标签', () => {
    render(<MemoryEditModal memory={baseMemory} onCancel={vi.fn()} onSave={vi.fn()} />)
    // 维度选择默认 person；输入新标签内容
    const input = screen.getByPlaceholderText('如：妈妈、公司、生日')
    fireEvent.change(input, { target: { value: '公司' } })
    fireEvent.click(screen.getByText('添加'))
    // 新标签 place 维度默认是 person，所以会是 person:公司
    expect(screen.getByText('公司')).toBeTruthy()
  })

  it('删除标签：点击 x 后标签消失', () => {
    render(<MemoryEditModal memory={baseMemory} onCancel={vi.fn()} onSave={vi.fn()} />)
    const removeBtn = screen.getByLabelText('删除标签 妈妈')
    fireEvent.click(removeBtn)
    expect(screen.queryByText('妈妈')).toBeNull()
  })

  it('保存：修改文本后点击保存，onSave 收到表单值', () => {
    let submitted: MemoryFormValues | null = null
    const onSave = vi.fn((v: MemoryFormValues) => { submitted = v })
    render(
      <MemoryEditModal
        memory={baseMemory}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )
    const textarea = screen.getByPlaceholderText('记录了什么……')
    fireEvent.change(textarea, { target: { value: '妈妈喜欢喝绿茶' } })
    fireEvent.click(screen.getByText('保存'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(submitted).not.toBeNull()
    expect(submitted!.content).toBe('妈妈喜欢喝绿茶')
    expect(submitted!.category).toBe('关系')
    expect(submitted!.tags).toEqual(['person:妈妈'])
    expect(typeof submitted!.createdAt).toBe('string')
  })

  it('取消：点击取消调用 onCancel', () => {
    const onCancel = vi.fn()
    render(<MemoryEditModal memory={baseMemory} onCancel={onCancel} onSave={vi.fn()} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
