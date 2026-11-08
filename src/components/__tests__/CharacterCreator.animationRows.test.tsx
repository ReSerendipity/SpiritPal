/**
 * CharacterCreator 动画行编辑的写回用例（TD-011）。
 *
 * 债项真正的问题是「改了不生效」：行编辑 UI 被删掉，编辑结果没有写回角色档案。
 * 所以这里不看 UI 长什么样，只看**点保存之后交给 store 的 profile 里有没有 animationRows**，
 * 以及非法输入时**不会**把坏值塞进档案。
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CharacterCreator } from '@/components/CharacterCreator'
import { ANIMATION_ROWS } from '@/lib/data/types'

const { addCustomCharacter, switchPetChar, switchSettingsChar } = vi.hoisted(() => ({
  addCustomCharacter: vi.fn(),
  switchPetChar: vi.fn(),
  switchSettingsChar: vi.fn(),
}))

vi.mock('@/stores/petStore', () => ({
  usePetStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ addCustomCharacter, switchCharacter: switchPetChar }),
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ switchCharacter: switchSettingsChar }),
}))

beforeEach(() => {
  addCustomCharacter.mockReset()
  switchPetChar.mockReset()
  switchSettingsChar.mockReset()
})

function openCustomEditor(): void {
  render(<CharacterCreator onClose={() => {}} />)
  fireEvent.change(screen.getByPlaceholderText('例如：小花'), { target: { value: '测试角色' } })
  fireEvent.click(screen.getByText('自定义'))
}

function save(): Record<string, unknown> {
  fireEvent.click(screen.getByRole('button', { name: /保存角色/ }))
  expect(addCustomCharacter).toHaveBeenCalledTimes(1)
  return addCustomCharacter.mock.calls[0][0] as Record<string, unknown>
}

describe('CharacterCreator · 自定义动画行', () => {
  it('默认预设不写 animationRows（回落全局口径）', () => {
    render(<CharacterCreator onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('例如：小花'), { target: { value: '测试角色' } })
    const profile = save()
    expect(profile.animationRows).toBeUndefined()
  })

  it('选「自定义」后展开 9 行编辑，且立刻写回 animationRows', () => {
    openCustomEditor()
    expect(screen.getByLabelText('第 0 行动画名')).toBeInTheDocument()
    expect(screen.getByLabelText('第 8 行帧数')).toBeInTheDocument()

    const profile = save()
    expect(profile.animationRows).toEqual(ANIMATION_ROWS)
  })

  it('改第 4 行帧数会写进保存的 profile（这就是债项缺的那一跳）', () => {
    openCustomEditor()
    fireEvent.change(screen.getByLabelText('第 4 行帧数'), { target: { value: '1' } })

    const profile = save()
    expect((profile.animationRows as Record<string, unknown>).jumping).toEqual({ row: 4, frames: 1 })
  })

  it('帧数超过列数时不写回，并给出错误提示', () => {
    openCustomEditor()
    fireEvent.change(screen.getByLabelText('第 0 行帧数'), { target: { value: '99' } })

    expect(screen.getByText('未写回：请先修正')).toBeInTheDocument()
    expect(screen.getByText(/超过最大列数/)).toBeInTheDocument()

    const profile = save()
    // 上一次合法值仍在（第 4 行默认 5 帧），而不是把 99 帧写进档案
    expect((profile.animationRows as Record<string, unknown>).idle).toEqual(ANIMATION_ROWS.idle)
  })

  it('「简单动画集」只写 idle / walk 两行', () => {
    render(<CharacterCreator onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('例如：小花'), { target: { value: '测试角色' } })
    fireEvent.click(screen.getByText('简单动画集'))

    const profile = save()
    expect(Object.keys(profile.animationRows as Record<string, unknown>).sort()).toEqual(['idle', 'walk'])
  })
})
