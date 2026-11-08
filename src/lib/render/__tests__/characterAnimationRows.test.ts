/**
 * TD-011 自定义动画行编辑的回归用例。
 *
 * 债项原状：`CharacterCreator` 里「自定义」预设只有一个按钮，行编辑 UI 被整段删掉，
 * 因为编辑结果**没有写回**角色档案（改了不生效比不提供更误导）。
 * 这些用例钉的是新链路：草稿 → 校验 → `CharacterProfile.animationRows`（渲染侧读的就是它），
 * 并且**非法值绝不落库**（越界行号在渲染侧会把图集取到图外，表现为黑块/闪烁，比不生效更难查）。
 */

import { describe, expect, it } from 'vitest'
import { loadCustomCharacters, saveCustomCharacter } from '@/lib/data/characters'
import { ANIMATION_ROWS, ATLAS, type AnimationRow } from '@/lib/data/types'
import {
  animationRowsForPreset,
  availableAnimationNames,
  buildRowDraft,
  draftToAnimationRows,
  UNUSED_ROW_NAME,
  type AnimationRowDraft,
} from '@/lib/render/characterAnimationRows'

function draft(): AnimationRowDraft[] {
  return buildRowDraft()
}

describe('buildRowDraft', () => {
  it('无已有配置时按全局 ANIMATION_ROWS 生成 9 行', () => {
    const d = buildRowDraft()
    expect(d).toHaveLength(ATLAS.rows)
    expect(d.map((r) => r.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(d.map((r) => r.name)).toEqual([
      'idle',
      'walk',
      'run-left',
      'waving',
      'jumping',
      'failed',
      'waiting',
      'running',
      'review',
    ])
    expect(d[0].frames).toBe(ANIMATION_ROWS.idle.frames)
  })

  it('已有 animationRows 时以它为准，越界行号被忽略', () => {
    const current: Record<string, AnimationRow> = {
      idle: { row: 0, frames: 3 },
      jumping: { row: 4, frames: 1 },
      bogus: { row: 99, frames: 2 },
    }
    const d = buildRowDraft(ATLAS.rows, current)
    expect(d[0]).toEqual({ row: 0, name: 'idle', frames: 3 })
    expect(d[4]).toEqual({ row: 4, name: 'jumping', frames: 1 })
    expect(d.some((r) => r.name === 'bogus')).toBe(false)
  })

  it('行数随角色 atlasLayout 走（shimeji 只有 4 行时不出第 5 行）', () => {
    expect(buildRowDraft(4)).toHaveLength(4)
  })
})

describe('draftToAnimationRows', () => {
  it('默认草稿能写回，且值等于全局口径', () => {
    const result = draftToAnimationRows(draft())
    expect(result.errors).toEqual([])
    expect(result.animationRows).toEqual(ANIMATION_ROWS)
  })

  it('改帧数会真的写进映射（这是债项缺的那一跳）', () => {
    const d = draft().map((r) => (r.row === 4 ? { ...r, frames: 1 } : r))
    const result = draftToAnimationRows(d)
    expect(result.errors).toEqual([])
    expect(result.animationRows?.jumping).toEqual({ row: 4, frames: 1 })
  })

  it('动画名重复 → error 且不写回（映射会静默覆盖前一行）', () => {
    const d = draft().map((r) => (r.row === 1 ? { ...r, name: 'idle' } : r))
    const result = draftToAnimationRows(d)
    expect(result.animationRows).toBeUndefined()
    expect(result.errors.join('\n')).toContain('动画名 "idle" 同时用在行 0 和行 1')
  })

  it('帧数超过列数 → error 且不写回', () => {
    const d = draft().map((r) => (r.row === 0 ? { ...r, frames: ATLAS.cols + 1 } : r))
    const result = draftToAnimationRows(d)
    expect(result.animationRows).toBeUndefined()
    expect(result.errors.join('\n')).toContain('超过最大列数')
  })

  it('帧数 0 / 负数 → error 且不写回', () => {
    for (const frames of [0, -3]) {
      const d = draft().map((r) => (r.row === 2 ? { ...r, frames } : r))
      const result = draftToAnimationRows(d)
      expect(result.animationRows).toBeUndefined()
      expect(result.errors.join('\n')).toContain('帧数必须 > 0')
    }
  })

  it('标成「未使用」的行不产生映射键，也不因为帧数 0 报错', () => {
    const d = draft().map((r) => (r.row === 8 ? { ...r, name: UNUSED_ROW_NAME, frames: 0 } : r))
    const result = draftToAnimationRows(d)
    expect(result.errors).toEqual([])
    expect(result.animationRows?.review).toBeUndefined()
    expect(Object.keys(result.animationRows ?? {})).toHaveLength(8)
  })

  it('渲染侧只认 ANIMATION_ROWS 的键，下拉可选项与之一致', () => {
    expect(availableAnimationNames()).toEqual(Object.keys(ANIMATION_ROWS))
  })
})

describe('animationRowsForPreset', () => {
  it('default 回落到全局（返回 undefined，由渲染侧取 ANIMATION_ROWS）', () => {
    const result = animationRowsForPreset('default', draft())
    expect(result.animationRows).toBeUndefined()
    expect(result.errors).toEqual([])
  })

  it('simple 只留 idle / walk 两行', () => {
    const result = animationRowsForPreset('simple', draft())
    expect(Object.keys(result.animationRows ?? {}).sort()).toEqual(['idle', 'walk'])
  })

  it('custom 走草稿校验（非法时同样不写回）', () => {
    const bad = draft().map((r) => (r.row === 3 ? { ...r, frames: 99 } : r))
    expect(animationRowsForPreset('custom', bad).animationRows).toBeUndefined()
    expect(animationRowsForPreset('custom', draft()).animationRows).toEqual(ANIMATION_ROWS)
  })
})

describe('持久化链路', () => {
  it('animationRows 会随角色一起存进 localStorage 并能读回（不是内存里的假生效）', () => {
    const rows: Record<string, AnimationRow> = {
      idle: { row: 0, frames: 3 },
      jumping: { row: 4, frames: 1 },
    }
    const profile = {
      id: 'td011-test',
      name: 'td011',
      animationRows: rows,
    } as Parameters<typeof saveCustomCharacter>[0]

    saveCustomCharacter(profile)
    const saved = loadCustomCharacters().find((c) => c.id === 'td011-test')
    expect(saved?.animationRows).toEqual(rows)
  })
})
