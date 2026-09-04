// MobileAchievementView smoke 测试 — 成就/排行榜子页渲染
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MobileAchievementView } from '@/mobile/MobileAchievementView'

// mock achievementSystem：避免触发真实成就管理器持久化
vi.mock('@/lib/nurture/achievementSystem', () => ({
  getAchievementManager: vi.fn(() => ({
    onChange: vi.fn(() => () => {}),
    updateMaxAffectionLevel: vi.fn(),
    getUnlockedAchievements: vi.fn(() => []),
    getRankingData: vi.fn(() => [{ name: '总点击', value: 10, unit: '次' }]),
    getProgress: vi.fn(() => 0),
  })),
  ACHIEVEMENTS: [
    { id: 'a1', name: '初次互动', description: '第一次点击', icon: '🏆', category: 'interaction', tier: 'star', reward: 5 },
  ],
  BADGE_NAMES: { none: '无', star: '星辰', moon: '皓月', sun: '骄阳', crown: '皇冠' },
  BADGE_COLORS: { none: '#9e9e9e', star: '#ffd54f', moon: '#cfd8dc', sun: '#ff8a65', crown: '#ffc107' },
}))

describe('MobileAchievementView', () => {
  beforeEach(() => {
    cleanup()
  })

  it('渲染成就子页（统计 + 成就列表）', () => {
    render(<MobileAchievementView />)
    expect(screen.getByText('成就')).toBeInTheDocument()
    expect(screen.getByText('排行榜')).toBeInTheDocument()
    expect(screen.getByText('已解锁')).toBeInTheDocument()
    expect(screen.getByText('初次互动')).toBeInTheDocument()
  })

  it('切换到排行榜子页', () => {
    render(<MobileAchievementView />)
    fireEvent.click(screen.getByText('排行榜'))
    expect(screen.getByText('个人数据统计')).toBeInTheDocument()
    expect(screen.getByText('总点击')).toBeInTheDocument()
  })
})
