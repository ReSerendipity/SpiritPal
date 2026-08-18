// MobilePetView smoke 测试（审计 P3-10 S1）
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobilePetView } from './MobilePetView'
import { usePetStore } from '../stores/petStore'

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
})
