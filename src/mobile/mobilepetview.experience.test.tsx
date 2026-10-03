// 移动端四个互动动作必须把「经历」记进 PetExperienceManager。
//
// 缺陷背景：桌面端 PetWindow 的 triggerPet/handleFeed/handlePlay/handleBathe 各自
// 调了 getPetExperienceManager(id).record(...)，而 MobilePetView 是另写的一份 trigger*，
// 只记了成就（recordPet/recordFeed/...）没记经历 ⇒ 手机上
// 「记忆 › 我们的故事」永远是 0，无论互动多少次。
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@/lib/system/i18n'
import { usePetStore } from '../stores/petStore'
import { useSettingsStore } from '../stores/settingsStore'
import { MobilePetView } from './MobilePetView'

const recordSpy = vi.fn(() => Promise.resolve())

vi.mock('../components/Live2DRenderer', () => ({
  Live2DRenderer: () => <div data-testid="live2d-renderer" />,
  getMotionGroupForState: () => 'Idle',
}))
vi.mock('../components/SpriteRenderer', () => ({
  SpriteRenderer: () => <div data-testid="sprite-renderer" />,
}))
vi.mock('../components/PetBubble', () => ({
  PetBubble: () => <div data-testid="pet-bubble" />,
}))
vi.mock('@/lib/nurture/items', () => ({
  getFoodsForCharacter: vi.fn(() => [
    { id: 'apple', name: '苹果', icon: '🍎', type: 'food' },
    { id: 'fish', name: '小鱼干', icon: '🐟', type: 'food' },
  ]),
}))
vi.mock('@/lib/data/characters', () => ({
  getCharacter: vi.fn((id: string) => ({
    id,
    displayName: id === 'doro' ? '多萝' : '小星',
    spriteAsset: '',
    themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
  })),
  getAllCharacters: vi.fn(() => [{ id: 'doro', displayName: '多萝' }]),
  getDefaultCharacter: vi.fn(() => ({ id: 'doro', displayName: '多萝', spriteAsset: '' })),
}))
vi.mock('@/lib/nurture/petExperience', () => ({
  getPetExperienceManager: () => ({ record: recordSpy }),
}))

function openMenu(container: HTMLElement) {
  const root = container.firstChild as HTMLElement
  fireEvent.touchStart(root, { touches: [{ clientX: 120, clientY: 160 }] })
  act(() => {
    vi.advanceTimersByTime(600)
  })
}

describe('MobilePetView 互动 → 经历记录', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    recordSpy.mockClear()
    const now = Date.now()
    usePetStore.setState({
      currentCharacterId: 'doro',
      stats: {
        doro: {
          hunger: 80, mood: 80, health: 80, affection: 100,
          level: 1, exp: 0, coins: 10,
          lastTickAt: now, lastInteractionAt: now, lastAffectionDecayAt: now,
        },
      },
      inventory: [],
      wornDecorations: {},
    })
    useSettingsStore.setState({ currentCharacterId: 'doro' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('摸头 / 玩耍 / 洗澡分别记 pet / play / bathe', () => {
    const { container } = render(<MobilePetView isActive={true} isDark={false} />)

    openMenu(container)
    fireEvent.click(screen.getByText('摸头'))
    expect(recordSpy).toHaveBeenLastCalledWith('pet')

    openMenu(container)
    fireEvent.click(screen.getByText('玩耍'))
    expect(recordSpy).toHaveBeenLastCalledWith('play')

    openMenu(container)
    fireEvent.click(screen.getByText('洗澡'))
    expect(recordSpy).toHaveBeenLastCalledWith('bathe')

    expect(recordSpy).toHaveBeenCalledTimes(3)
  })

  it('喂食记 feed，且带的是所选角色对应的 manager 调用', () => {
    const { container } = render(<MobilePetView isActive={true} isDark={false} />)

    openMenu(container)
    fireEvent.click(screen.getByText('喂食'))
    fireEvent.click(screen.getByText('小鱼干'))

    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(recordSpy).toHaveBeenCalledWith('feed')
  })
})
