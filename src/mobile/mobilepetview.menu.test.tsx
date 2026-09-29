// MobilePetView 长按菜单测试：喂食可选具体食物 + 宠物页内切换角色
//
// 这两项此前移动端都没有：喂食只能自动取背包第一项，角色切换只能进设置页。
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePetStore } from '../stores/petStore'
import { useSettingsStore } from '../stores/settingsStore'
import { MobilePetView } from './MobilePetView'

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
  getAllCharacters: vi.fn(() => [
    { id: 'doro', displayName: '多萝' },
    { id: 'star', displayName: '小星' },
  ]),
  getDefaultCharacter: vi.fn(() => ({ id: 'doro', displayName: '多萝', spriteAsset: '' })),
}))

/** 长按宠物容器打开菜单 */
function openMenu(container: HTMLElement) {
  const root = container.firstChild as HTMLElement
  fireEvent.touchStart(root, { touches: [{ clientX: 120, clientY: 160 }] })
  act(() => {
    vi.advanceTimersByTime(600)
  })
}

describe('MobilePetView 长按菜单', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
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

  it('长按打开菜单，包含「切换角色」入口', () => {
    const { container } = render(<MobilePetView isActive={true} isDark={false} />)
    openMenu(container)

    expect(screen.getByText('摸头')).toBeInTheDocument()
    expect(screen.getByText('切换角色')).toBeInTheDocument()
  })

  it('「喂食」展开食物列表，可选择具体食物', () => {
    const feedSpy = vi.spyOn(usePetStore.getState(), 'feed')
    const { container } = render(<MobilePetView isActive={true} isDark={false} />)
    openMenu(container)

    fireEvent.click(screen.getByText('喂食'))

    // 子菜单列出两种食物（此前无法选择，只能喂第一个）
    expect(screen.getByText('苹果')).toBeInTheDocument()
    expect(screen.getByText('小鱼干')).toBeInTheDocument()

    fireEvent.click(screen.getByText('小鱼干'))

    expect(feedSpy).toHaveBeenCalledTimes(1)
    expect(feedSpy.mock.calls[0][0]).toMatchObject({ id: 'fish' })
  })

  it('「切换角色」列出全部角色，选中后同时切换 settings 与 pet store', () => {
    const settingsSwitch = vi.spyOn(useSettingsStore.getState(), 'switchCharacter')
    const petSwitch = vi.spyOn(usePetStore.getState(), 'switchCharacter')
    const { container } = render(<MobilePetView isActive={true} isDark={false} />)
    openMenu(container)

    fireEvent.click(screen.getByText('切换角色'))
    expect(screen.getByText('小星')).toBeInTheDocument()

    fireEvent.click(screen.getByText('小星'))

    expect(settingsSwitch).toHaveBeenCalledWith('star')
    expect(petSwitch).toHaveBeenCalledWith('star')
  })

  it('二级面板可返回主菜单', () => {
    const { container } = render(<MobilePetView isActive={true} isDark={false} />)
    openMenu(container)

    fireEvent.click(screen.getByText('喂食'))
    expect(screen.queryByText('摸头')).toBeNull()

    fireEvent.click(screen.getByText('← 返回'))
    expect(screen.getByText('摸头')).toBeInTheDocument()
  })
})
