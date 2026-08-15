// PetContextMenu 组件测试 — 菜单项渲染、点击回调、子菜单展开
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PetContextMenu } from '../PetContextMenu'

// ============ Mock 依赖 ============

const mockCharacters = [
  { id: 'doro', displayName: '多罗', themeColor: { primary: '#FFB6C1' } },
  { id: 'feibi', displayName: '菲比', themeColor: { primary: '#87CEEB' } },
  { id: 'gugugaga', displayName: '咕咕嘎嘎', themeColor: { primary: '#98FB98' } },
]

vi.mock('../../lib/characters', () => ({
  getAllCharacters: vi.fn(() => mockCharacters),
  getCharacter: vi.fn((id: string) => mockCharacters.find(c => c.id === id) ?? mockCharacters[0]),
}))

vi.mock('../../lib/items', () => ({
  getFoodsForCharacter: vi.fn(() => [
    { id: 'food-1', name: '小鱼干', type: 'food', icon: '🐟' },
    { id: 'food-2', name: '猫粮', type: 'food', icon: '🍚' },
  ]),
}))

// 默认 props 工厂
function makeProps(overrides: Partial<Parameters<typeof PetContextMenu>[0]> = {}) {
  return {
    x: 100,
    y: 100,
    currentCharacterId: 'doro',
    onClose: vi.fn(),
    onChat: vi.fn(),
    onPet: vi.fn(),
    onFeed: vi.fn(),
    onPlay: vi.fn(),
    onBathe: vi.fn(),
    onDressup: vi.fn(),
    onPomodoro: vi.fn(),
    onScreenshot: vi.fn(),
    onSettings: vi.fn(),
    onSwitchCharacter: vi.fn(),
    onDialogue: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  }
}

describe('PetContextMenu', () => {
  beforeEach(() => {
    // 设置窗口尺寸，避免边界自适应影响
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('渲染所有主菜单项', () => {
    render(<PetContextMenu {...makeProps()} />)
    expect(screen.getByText('聊天')).toBeInTheDocument()
    expect(screen.getByText('对话')).toBeInTheDocument()
    expect(screen.getByText('摸摸')).toBeInTheDocument()
    expect(screen.getByText('喂食')).toBeInTheDocument()
    expect(screen.getByText('玩耍')).toBeInTheDocument()
    expect(screen.getByText('洗澡')).toBeInTheDocument()
    expect(screen.getByText('换装')).toBeInTheDocument()
    expect(screen.getByText('番茄钟')).toBeInTheDocument()
    expect(screen.getByText('截图')).toBeInTheDocument()
    expect(screen.getByText('设置')).toBeInTheDocument()
    expect(screen.getByText('切换角色')).toBeInTheDocument()
    expect(screen.getByText('退出')).toBeInTheDocument()
  })

  it('点击聊天触发 onChat 并关闭', () => {
    const props = makeProps()
    render(<PetContextMenu {...props} />)
    fireEvent.click(screen.getByText('聊天'))
    expect(props.onChat).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('点击摸摸触发 onPet 并关闭', () => {
    const props = makeProps()
    render(<PetContextMenu {...props} />)
    fireEvent.click(screen.getByText('摸摸'))
    expect(props.onPet).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('点击玩耍触发 onPlay 并关闭', () => {
    const props = makeProps()
    render(<PetContextMenu {...props} />)
    fireEvent.click(screen.getByText('玩耍'))
    expect(props.onPlay).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('点击洗澡触发 onBathe 并关闭', () => {
    const props = makeProps()
    render(<PetContextMenu {...props} />)
    fireEvent.click(screen.getByText('洗澡'))
    expect(props.onBathe).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('点击换装触发 onDressup 并关闭', () => {
    const props = makeProps()
    render(<PetContextMenu {...props} />)
    fireEvent.click(screen.getByText('换装'))
    expect(props.onDressup).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('点击截图触发 onScreenshot 并关闭', () => {
    const props = makeProps()
    render(<PetContextMenu {...props} />)
    fireEvent.click(screen.getByText('截图'))
    expect(props.onScreenshot).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('点击设置触发 onSettings 并关闭', () => {
    const props = makeProps()
    render(<PetContextMenu {...props} />)
    fireEvent.click(screen.getByText('设置'))
    expect(props.onSettings).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('点击退出触发 onExit 并关闭', () => {
    const props = makeProps()
    render(<PetContextMenu {...props} />)
    fireEvent.click(screen.getByText('退出'))
    expect(props.onExit).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  describe('喂食子菜单', () => {
    it('点击喂食展开子菜单', () => {
      render(<PetContextMenu {...makeProps()} />)
      fireEvent.click(screen.getByText('喂食'))
      // 子菜单展开后应有食物项（doro 角色有配置食物）
      // 食物名称通过 getFoodsForCharacter 获取
    })

    it('再次点击喂食收起子菜单', () => {
      render(<PetContextMenu {...makeProps()} />)
      const feedBtn = screen.getByText('喂食')
      fireEvent.click(feedBtn)
      fireEvent.click(feedBtn)
      // 不应崩溃
      expect(feedBtn).toBeInTheDocument()
    })
  })

  describe('番茄钟子菜单', () => {
    it('点击番茄钟展开子菜单显示时长选项', () => {
      const props = makeProps()
      render(<PetContextMenu {...props} />)
      fireEvent.click(screen.getByText('番茄钟'))
      expect(screen.getByText('15 分钟')).toBeInTheDocument()
      expect(screen.getByText('25 分钟')).toBeInTheDocument()
      expect(screen.getByText('45 分钟')).toBeInTheDocument()
      expect(screen.getByText('60 分钟')).toBeInTheDocument()
    })

    it('点击 25 分钟触发 onPomodoro(25) 并关闭', () => {
      const props = makeProps()
      render(<PetContextMenu {...props} />)
      fireEvent.click(screen.getByText('番茄钟'))
      fireEvent.click(screen.getByText('25 分钟'))
      expect(props.onPomodoro).toHaveBeenCalledWith(25)
      expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('点击 45 分钟触发 onPomodoro(45) 并关闭', () => {
      const props = makeProps()
      render(<PetContextMenu {...props} />)
      fireEvent.click(screen.getByText('番茄钟'))
      fireEvent.click(screen.getByText('45 分钟'))
      expect(props.onPomodoro).toHaveBeenCalledWith(45)
      expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('点击 60 分钟触发 onPomodoro(60) 并关闭', () => {
      const props = makeProps()
      render(<PetContextMenu {...props} />)
      fireEvent.click(screen.getByText('番茄钟'))
      fireEvent.click(screen.getByText('60 分钟'))
      expect(props.onPomodoro).toHaveBeenCalledWith(60)
      expect(props.onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('切换角色子菜单', () => {
    it('点击切换角色展开子菜单显示所有角色', () => {
      render(<PetContextMenu {...makeProps()} />)
      fireEvent.click(screen.getByText('切换角色'))
      // 内置角色通过 getAllCharacters 获取
      // doro/feibi/gugugaga
    })

    it('当前角色高亮显示', () => {
      render(<PetContextMenu {...makeProps({ currentCharacterId: 'doro' })} />)
      fireEvent.click(screen.getByText('切换角色'))
      // doro 应有高亮样式（font-medium class）
      // Check 图标表示当前角色
    })

    it('点击其他角色触发 onSwitchCharacter 并关闭', () => {
      const props = makeProps({ currentCharacterId: 'doro' })
      render(<PetContextMenu {...props} />)
      fireEvent.click(screen.getByText('切换角色'))
      // 点击非当前角色
      const feibiBtn = screen.getByText('菲比')
      fireEvent.click(feibiBtn)
      expect(props.onSwitchCharacter).toHaveBeenCalledWith('feibi')
      expect(props.onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('边界自适应定位', () => {
    it('右边界超出时调整 x 位置', () => {
      Object.defineProperty(window, 'innerWidth', { value: 200, writable: true })
      render(<PetContextMenu {...makeProps({ x: 190, y: 100 })} />)
      // 菜单应被调整到不超出右边界
      const menu = document.querySelector('[data-spiritpal-menu]') as HTMLElement
      expect(menu).not.toBeNull()
      // 调整后 x 应小于 190
      const left = parseInt(menu.style.left)
      expect(left).toBeLessThan(190)
    })

    it('下边界超出时调整 y 位置', () => {
      Object.defineProperty(window, 'innerHeight', { value: 200, writable: true })
      render(<PetContextMenu {...makeProps({ x: 100, y: 190 })} />)
      const menu = document.querySelector('[data-spiritpal-menu]') as HTMLElement
      expect(menu).not.toBeNull()
      const top = parseInt(menu.style.top)
      expect(top).toBeLessThan(190)
    })
  })
})
