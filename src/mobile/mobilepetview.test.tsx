// MobilePetView smoke 测试（审计 P3-10 S1）
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePetStore } from '../stores/petStore'
import { useSettingsStore } from '../stores/settingsStore'
import { MobilePetView } from './MobilePetView'

// 重度依赖组件 mock：Live2D / Sprite 渲染器依赖 pixi，jsdom 无法运行
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

function seedStore() {
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
}

describe('MobilePetView', () => {
  beforeEach(() => {
    seedStore()
  })

  it('有角色时渲染宠物渲染器且不崩溃', () => {
    render(<MobilePetView isActive={true} isDark={false} />)
    const rendered = screen.queryByTestId('live2d-renderer') ?? screen.queryByTestId('sprite-renderer')
    expect(rendered).toBeTruthy()
  })

  it('非活跃标签时同样可渲染', () => {
    render(<MobilePetView isActive={false} isDark={true} />)
    expect(document.body).toBeTruthy()
  })

  it('已穿戴的装饰品会真正渲染出来（此前只写状态、不渲染）', () => {
    usePetStore.setState({
      inventory: [
        {
          id: 'hat-1',
          name: '小帽子',
          icon: '🎩',
          type: 'accessory',
          quantity: 1,
        } as never,
      ],
      wornDecorations: {
        doro: [{ itemId: 'hat-1', anchor: 'head' }],
      },
    })

    render(<MobilePetView isActive={true} isDark={false} />)

    expect(screen.getByText('🎩')).toBeInTheDocument()
  })

  it('未穿戴装饰时不渲染装饰层', () => {
    render(<MobilePetView isActive={true} isDark={false} />)
    expect(screen.queryByText('🎩')).toBeNull()
  })

  it('宠物透明度由设置驱动（此前固定为 1）', () => {
    useSettingsStore.setState({ petOpacity: 0.4 })
    render(<MobilePetView isActive={true} isDark={false} />)

    const renderer = screen.queryByTestId('sprite-renderer') ?? screen.queryByTestId('live2d-renderer')
    // 透明度施加在精灵容器的父层（同时覆盖精灵与装饰）
    const container = renderer?.parentElement
    expect(container?.style.opacity).toBe('0.4')
  })
})
