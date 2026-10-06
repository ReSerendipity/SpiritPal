// VR-6：触控命中区补齐——HUD 折叠钮 + 会话抽屉关闭钮
// 测量口径（工单要求）：实际可点范围 = 元素盒 + 伪元素扩展（after:-inset-N = N*4px 每边），
// jsdom 无布局引擎 → 在类名层面锁定约定（与 P2-1 既有测试同口径）：
//   - HUD 折叠钮：h-7 w-7（28）+ after:-inset-2.5（每边 10px）→ 可点 48×48
//   - 会话抽屉关闭钮：h-9 w-9（36）+ after:-inset-2（每边 8px）→ 可点 52×52
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { MobileChatView } from '@/mobile/MobileChatView'
import { MobilePetView } from '@/mobile/MobilePetView'
import { usePetStore } from '@/stores/petStore'

// MobilePetView 依赖链最小 mock（渲染层不依赖 LLM/DB）
vi.mock('@/lib/data/characters', () => ({
  getAllCharacters: vi.fn(() => [{ id: 'doro', displayName: '多萝' }]),
  getCharacter: vi.fn(() => ({
    id: 'doro',
    displayName: '多萝',
    bubbleMessages: { pet: [''], feed: [''], play: [''], bathe: [''] },
  })),
  getDefaultCharacter: vi.fn(() => ({ id: 'doro', displayName: '多萝' })),
}))
vi.mock('@/lib/data/modManager', () => ({ getModManager: () => ({ getMod: () => undefined }) }))
vi.mock('@/lib/ai/behaviorEngine', () => ({ pickPetReaction: () => 'happy' }))
vi.mock('@/lib/nurture/achievementSystem', () => ({
  getAchievementManager: () => ({
    recordPet: vi.fn(), recordFeed: vi.fn(), recordPlay: vi.fn(), recordBathe: vi.fn(), recordClick: vi.fn(),
  }),
}))
vi.mock('@/lib/nurture/petExperience', () => ({
  getPetExperienceManager: () => ({ record: vi.fn(() => Promise.resolve()) }),
}))
vi.mock('@/lib/nurture/items', () => ({ getFoodsForCharacter: () => [] }))

/** 计算含伪元素扩展后的实际可点边长（px） */
function effectiveSize(cls: string[], base: number): number {
  let extra = 0
  const inset = cls.find((c) => c.startsWith('after:-inset-'))
  if (inset) {
    const n = Number(inset.replace('after:-inset-', ''))
    extra = n * 4 * 2 // Tailwind -inset-N = N*0.25rem = N*4px，四边各扩 N*4
  }
  return base + extra
}

describe('触控命中区补齐（VR-6）', () => {
  beforeEach(() => {
    localStorage.clear()
    usePetStore.setState({ currentCharacterId: 'doro' })
    usePetStore.getState().initCharacter('doro')
  })

  it('HUD 折叠钮：28px 盒 + after:-inset-2.5 → 实际可点 48×48', () => {
    render(<MobilePetView isActive isDark={false} />)
    const btn = document.querySelector('[data-testid=hud-toggle]')
    expect(btn).not.toBeNull()
    const cls = Array.from(btn!.classList)
    expect(cls).toContain('h-7')
    expect(cls).toContain('w-7')
    expect(cls).toContain('after:-inset-2.5')
    // 28 + 10*2 = 48
    expect(effectiveSize(cls, 28)).toBeGreaterThanOrEqual(48)
  })

  it('会话抽屉关闭钮：36px 盒 + after:-inset-2 → 实际可点 52×52', () => {
    render(<MobileChatView />)
    // 先打开会话管理抽屉，关闭钮才在 DOM
    fireEvent.click(screen.getByLabelText('会话管理'))
    const close = screen.getByLabelText('关闭')
    const cls = Array.from(close.classList)
    expect(cls).toContain('h-9')
    expect(cls).toContain('w-9')
    expect(cls).toContain('after:-inset-2')
    // 36 + 8*2 = 52
    expect(effectiveSize(cls, 36)).toBeGreaterThanOrEqual(48)
  })
})
