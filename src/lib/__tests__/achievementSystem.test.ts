// achievementSystem 模块测试 — 成就/徽章系统
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../behaviorEngine', () => ({
  getAffectionLevel: vi.fn((affection: number) => {
    if (affection >= 500) return 5
    if (affection >= 300) return 4
    if (affection >= 180) return 3
    if (affection >= 100) return 2
    if (affection >= 50) return 1
    return 0
  }),
}))

import {
  AchievementManager,
  getAchievementManager,
  ACHIEVEMENTS,
  getBadgeTier,
  BADGE_NAMES,
  BADGE_COLORS,
} from '../achievementSystem'

describe('achievementSystem 纯函数', () => {
  describe('getBadgeTier', () => {
    it('affectionLevel 0 返回 none', () => {
      expect(getBadgeTier(0)).toBe('none')
    })
    it('affectionLevel 1 返回 star', () => {
      expect(getBadgeTier(1)).toBe('star')
    })
    it('affectionLevel 2 返回 moon', () => {
      expect(getBadgeTier(2)).toBe('moon')
    })
    it('affectionLevel 3 返回 sun', () => {
      expect(getBadgeTier(3)).toBe('sun')
    })
    it('affectionLevel 5 返回 crown', () => {
      expect(getBadgeTier(5)).toBe('crown')
    })
  })

  describe('BADGE_NAMES / BADGE_COLORS', () => {
    it('包含所有 tier', () => {
      expect(BADGE_NAMES.none).toBeTruthy()
      expect(BADGE_NAMES.star).toBeTruthy()
      expect(BADGE_NAMES.moon).toBeTruthy()
      expect(BADGE_NAMES.sun).toBeTruthy()
      expect(BADGE_NAMES.crown).toBeTruthy()
      expect(BADGE_COLORS.none).toMatch(/^#/)
      expect(BADGE_COLORS.crown).toMatch(/^#/)
    })
  })

  describe('ACHIEVEMENTS', () => {
    it('包含多个成就', () => {
      expect(ACHIEVEMENTS.length).toBeGreaterThan(10)
    })
    it('每个成就有 id/name/condition', () => {
      for (const a of ACHIEVEMENTS) {
        expect(a.id).toBeTruthy()
        expect(a.name).toBeTruthy()
        expect(typeof a.condition).toBe('function')
      }
    })
  })
})

describe('AchievementManager', () => {
  let mgr: AchievementManager

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mgr = new AchievementManager()
  })

  describe('初始状态', () => {
    it('初始统计为默认值', () => {
      const stats = mgr.getStats()
      expect(stats.totalClicks).toBe(0)
      expect(stats.totalPets).toBe(0)
      expect(stats.unlockedAchievements).toEqual([])
    })
  })

  describe('记录互动', () => {
    it('recordClick 增加点击数', () => {
      mgr.recordClick()
      mgr.recordClick()
      expect(mgr.getStats().totalClicks).toBe(2)
    })

    it('recordPet 增加摸头数', () => {
      mgr.recordPet()
      expect(mgr.getStats().totalPets).toBe(1)
    })

    it('recordFeed 增加喂食数', () => {
      mgr.recordFeed()
      expect(mgr.getStats().totalFeeds).toBe(1)
    })

    it('recordPlay 增加玩耍数', () => {
      mgr.recordPlay()
      expect(mgr.getStats().totalPlays).toBe(1)
    })

    it('recordBathe 增加洗澡数', () => {
      mgr.recordBathe()
      expect(mgr.getStats().totalBathes).toBe(1)
    })

    it('recordChat 增加聊天数', () => {
      mgr.recordChat()
      expect(mgr.getStats().totalChats).toBe(1)
    })

    it('recordPomodoro 增加番茄钟数和分钟数', () => {
      mgr.recordPomodoro(25)
      expect(mgr.getStats().totalPomodoros).toBe(1)
      expect(mgr.getStats().totalPomodoroMinutes).toBe(25)
    })

    it('recordCoinsEarned 增加金币', () => {
      mgr.recordCoinsEarned(100)
      expect(mgr.getStats().totalCoinsEarned).toBe(100)
    })

    it('recordItemBought 增加购买数', () => {
      mgr.recordItemBought()
      expect(mgr.getStats().totalItemsBought).toBe(1)
    })

    it('recordItemUsed 增加使用数', () => {
      mgr.recordItemUsed()
      expect(mgr.getStats().totalItemsUsed).toBe(1)
    })
  })

  describe('成就解锁', () => {
    it('点击1次解锁 first-click', () => {
      mgr.recordClick()
      const unlocked = mgr.getUnlockedAchievements()
      expect(unlocked.some((a) => a.id === 'first-click')).toBe(true)
    })

    it('点击100次解锁 click-100', () => {
      for (let i = 0; i < 100; i++) mgr.recordClick()
      const unlocked = mgr.getUnlockedAchievements()
      expect(unlocked.some((a) => a.id === 'click-100')).toBe(true)
    })

    it('解锁成就获得金币奖励', () => {
      mgr.recordClick()
      const stats = mgr.getStats()
      expect(stats.totalCoinsEarned).toBeGreaterThanOrEqual(5)
    })

    it('getNewlyUnlocked 返回新解锁的成就', () => {
      mgr.recordClick()
      const newly = mgr.getNewlyUnlocked()
      expect(newly.length).toBeGreaterThan(0)
      // 再次获取应清空
      expect(mgr.getNewlyUnlocked().length).toBe(0)
    })
  })

  describe('updateMaxAffectionLevel', () => {
    it('更新最高亲密度等级', () => {
      mgr.updateMaxAffectionLevel({ affection: 200 } as any)
      expect(mgr.getStats().maxAffectionLevel).toBe(3)
    })

    it('不降低最高等级', () => {
      mgr.updateMaxAffectionLevel({ affection: 500 } as any)
      mgr.updateMaxAffectionLevel({ affection: 100 } as any)
      expect(mgr.getStats().maxAffectionLevel).toBe(5)
    })
  })

  describe('updateMaxCharacterLevel', () => {
    it('更新最高角色等级', () => {
      mgr.updateMaxCharacterLevel(10)
      expect(mgr.getStats().maxCharacterLevel).toBe(10)
    })
  })

  describe('setCharactersUnlocked', () => {
    it('设置解锁角色数', () => {
      mgr.setCharactersUnlocked(3)
      expect(mgr.getStats().charactersUnlocked).toBe(3)
    })
  })

  describe('recordLogin', () => {
    it('首次登录设置 totalLoginDays=2（load 默认1 + 1）', () => {
      mgr.recordLogin()
      expect(mgr.getStats().totalLoginDays).toBe(2)
    })
  })

  describe('查询方法', () => {
    it('getUnlockedAchievements 返回已解锁', () => {
      expect(mgr.getUnlockedAchievements().length).toBe(0)
      mgr.recordClick()
      expect(mgr.getUnlockedAchievements().length).toBeGreaterThan(0)
    })

    it('getLockedAchievements 返回未解锁', () => {
      const locked = mgr.getLockedAchievements()
      expect(locked.length).toBeGreaterThan(0)
    })

    it('getProgress 返回 0-1 进度', () => {
      const ach = ACHIEVEMENTS.find((a) => a.id === 'first-click')!
      expect(mgr.getProgress(ach)).toBe(0)
      mgr.recordClick()
      expect(mgr.getProgress(ach)).toBe(1)
    })

    it('getRankingData 返回排行榜数据', () => {
      const data = mgr.getRankingData()
      expect(data.length).toBeGreaterThan(0)
      expect(data[0].name).toBeTruthy()
      expect(data[0].unit).toBeTruthy()
    })
  })

  describe('onChange 订阅', () => {
    it('数据变化时通知监听器', () => {
      const listener = vi.fn()
      const unsub = mgr.onChange(listener)
      mgr.recordClick()
      expect(listener).toHaveBeenCalled()
      unsub()
      const callCount = listener.mock.calls.length
      mgr.recordClick()
      expect(listener.mock.calls.length).toBe(callCount)
    })
  })

  describe('getAchievementManager 单例', () => {
    it('返回同一实例', () => {
      const m1 = getAchievementManager()
      const m2 = getAchievementManager()
      expect(m1).toBe(m2)
    })
  })

  describe('localStorage 持久化', () => {
    it('新实例从 localStorage 加载数据', () => {
      mgr.recordClick()
      mgr.recordClick()
      const mgr2 = new AchievementManager()
      expect(mgr2.getStats().totalClicks).toBe(2)
    })
  })
})
