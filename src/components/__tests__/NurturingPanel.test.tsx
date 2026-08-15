// NurturingPanel 组件测试 — 四维数值显示、等级徽章、金币
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { NurturingStats, BadgeTier } from '../../lib/types'

// ============ 使用 vi.hoisted 定义 mock state（避免 hoisting 问题）============
const { mockState } = vi.hoisted(() => {
  const stats: NurturingStats = {
    hunger: 80,
    mood: 60,
    health: 90,
    affection: 100,
    level: 1,
    exp: 20,
    coins: 0,
    lastTickAt: Date.now(),
    lastInteractionAt: Date.now(),
    lastAffectionDecayAt: Date.now(),
  }
  return {
    mockState: {
      getCurrentStats: () => stats,
      sharedCoins: 100,
      currentCharacterId: 'doro',
      getBadge: ((level: number): BadgeTier => {
        if (level >= 256) return 'crown'
        if (level >= 128) return 'sun'
        if (level >= 64) return 'moon'
        if (level >= 32) return 'star'
        return 'none'
      }) as (level: number) => BadgeTier,
      getColorTier: ((value: number): 'green' | 'yellow' | 'orange' | 'red' => {
        if (value >= 80) return 'green'
        if (value >= 50) return 'yellow'
        if (value >= 20) return 'orange'
        return 'red'
      }) as (value: number) => 'green' | 'yellow' | 'orange' | 'red',
      _stats: stats,
    },
  }
})

vi.mock('../../stores/petStore', () => ({
  usePetStore: Object.assign(
    vi.fn((selector: (s: typeof mockState) => unknown) => selector(mockState)),
    { getState: () => mockState },
  ),
}))

import { NurturingPanel } from '../NurturingPanel'

// 辅助函数：更新 mock state
function setStats(stats: Partial<NurturingStats>) {
  Object.assign(mockState._stats, stats)
}
function setSharedCoins(coins: number) {
  mockState.sharedCoins = coins
}

describe('NurturingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重置为默认值
    Object.assign(mockState._stats, {
      hunger: 80, mood: 60, health: 90, affection: 100,
      level: 1, exp: 20, coins: 0,
      lastTickAt: Date.now(), lastInteractionAt: Date.now(), lastAffectionDecayAt: Date.now(),
    })
    mockState.sharedCoins = 100
    mockState.currentCharacterId = 'doro'
    mockState.getBadge = (level: number): BadgeTier => {
      if (level >= 256) return 'crown'
      if (level >= 128) return 'sun'
      if (level >= 64) return 'moon'
      if (level >= 32) return 'star'
      return 'none'
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('渲染角色名称', () => {
    render(<NurturingPanel />)
    expect(screen.getByText('多罗')).toBeInTheDocument()
  })

  it('显示等级数字', () => {
    setStats({ level: 5 })
    render(<NurturingPanel />)
    expect(screen.getByText(/Lv\.5/)).toBeInTheDocument()
  })

  it('显示金币数量', () => {
    setSharedCoins(250)
    render(<NurturingPanel />)
    expect(screen.getByText('250')).toBeInTheDocument()
  })

  it('显示四维数值', () => {
    setStats({ hunger: 75, mood: 55, health: 90, affection: 100 })
    render(<NurturingPanel />)
    expect(screen.getByText('饱食度')).toBeInTheDocument()
    expect(screen.getByText('心情')).toBeInTheDocument()
    expect(screen.getByText('健康')).toBeInTheDocument()
    expect(screen.getByText('亲密度')).toBeInTheDocument()
  })

  it('显示经验进度', () => {
    setStats({ level: 3, exp: 50 })
    render(<NurturingPanel />)
    expect(screen.getByText(/50/)).toBeInTheDocument()
    expect(screen.getByText(/300/)).toBeInTheDocument()
  })

  describe('等级徽章', () => {
    it('level < 32 显示 ⚪', () => {
      setStats({ level: 10 })
      render(<NurturingPanel />)
      expect(screen.getByText(/⚪/)).toBeInTheDocument()
    })

    it('level >= 32 显示 ⭐', () => {
      setStats({ level: 32 })
      render(<NurturingPanel />)
      expect(screen.getByText(/⭐/)).toBeInTheDocument()
    })

    it('level >= 64 显示 🌙', () => {
      setStats({ level: 64 })
      render(<NurturingPanel />)
      expect(screen.getByText(/🌙/)).toBeInTheDocument()
    })

    it('level >= 128 显示 ☀️', () => {
      setStats({ level: 128 })
      render(<NurturingPanel />)
      expect(screen.getByText(/☀️/)).toBeInTheDocument()
    })

    it('level >= 256 显示 👑', () => {
      setStats({ level: 256 })
      render(<NurturingPanel />)
      expect(screen.getByText(/👑/)).toBeInTheDocument()
    })
  })

  it('显示最后互动时间', () => {
    const recentTs = Date.now() - 5000
    setStats({ lastInteractionAt: recentTs })
    render(<NurturingPanel />)
    expect(screen.getByText(/最后互动/)).toBeInTheDocument()
  })

  it('数值为 0 时不崩溃', () => {
    setStats({ hunger: 0, mood: 0, health: 0, affection: 0 })
    render(<NurturingPanel />)
    expect(screen.getByText('饱食度')).toBeInTheDocument()
  })

  it('数值为 100 时显示绿色进度条', () => {
    setStats({ hunger: 100 })
    render(<NurturingPanel />)
    const greenBar = document.querySelector('.bg-green-500')
    expect(greenBar).not.toBeNull()
  })

  it('数值低于 20 时显示红色进度条', () => {
    setStats({ hunger: 10 })
    render(<NurturingPanel />)
    const redBar = document.querySelector('.bg-red-500')
    expect(redBar).not.toBeNull()
  })

  it('数值 50-79 显示黄色进度条', () => {
    setStats({ hunger: 60 })
    render(<NurturingPanel />)
    const yellowBar = document.querySelector('.bg-yellow-400')
    expect(yellowBar).not.toBeNull()
  })

  it('数值 20-49 显示橙色进度条', () => {
    setStats({ hunger: 30 })
    render(<NurturingPanel />)
    const orangeBar = document.querySelector('.bg-orange-400')
    expect(orangeBar).not.toBeNull()
  })
})
