// taskManager 单元测试 — 专注时间记录、奖励公式、连续天数
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TaskManager, getTaskManager } from '../taskManager'

describe('TaskManager', () => {
  let mgr: TaskManager

  beforeEach(() => {
    localStorage.clear()
    mgr = new TaskManager()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('初始状态', () => {
    it('默认每日目标 120 分钟', () => {
      expect(mgr.getDailyGoal()).toBe(120)
    })

    it('初始连续天数 0', () => {
      expect(mgr.getConsecutiveDays()).toBe(0)
    })

    it('初始今日未达标', () => {
      expect(mgr.isGoalCompletedToday()).toBe(false)
    })

    it('初始今日专注 0 分钟', () => {
      expect(mgr.getTodayFocusMinutes()).toBe(0)
    })
  })

  describe('addFocusMinutes', () => {
    it('累加今日专注时间', () => {
      mgr.addFocusMinutes(30)
      mgr.addFocusMinutes(45)
      expect(mgr.getTodayFocusMinutes()).toBe(75)
    })

    it('未达标时不返回奖励', () => {
      const reward = mgr.addFocusMinutes(30)
      expect(reward).toBeNull()
    })

    it('达到目标时返回奖励', () => {
      const reward = mgr.addFocusMinutes(120)
      expect(reward).not.toBeNull()
      expect(reward?.coins).toBeGreaterThan(0)
      expect(reward?.message).toContain('达成')
    })

    it('首次达标连续天数为 1', () => {
      mgr.addFocusMinutes(120)
      expect(mgr.getConsecutiveDays()).toBe(1)
    })

    it('已达标后再次累加不重复奖励', () => {
      mgr.addFocusMinutes(120)
      const reward2 = mgr.addFocusMinutes(30)
      expect(reward2).toBeNull()
    })

    it('奖励 = round(10 × ratio × (1 + nDays × 0.2))', () => {
      // 第一次达标，nDays=1, ratio=1.0
      const reward = mgr.addFocusMinutes(120)
      // 10 × 1.0 × (1 + 1 × 0.2) = 12
      expect(reward?.coins).toBe(12)
    })

    it('history 限制 30 条', () => {
      // 预加载 30 天历史数据（不含今天）
      // 注意：load() 不裁剪 history，裁剪仅在 addFocusMinutes 中触发（length > 30 时 slice(-30)）
      const data = mgr.getData()
      for (let i = 30; i >= 1; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        data.history.push([dateStr, 60])
      }
      localStorage.setItem('spiritpal-tasks', JSON.stringify(data))

      // 创建新实例加载历史（load 不裁剪，仍为 30）
      const newMgr = new TaskManager()
      expect(newMgr.getData().history.length).toBe(30)

      // 再添加今天的记录，长度变为 31 > 30，触发裁剪到 30
      newMgr.addFocusMinutes(30)
      expect(newMgr.getData().history.length).toBe(30)
    })
  })

  describe('setDailyGoal', () => {
    it('设置目标（限制 10-480 分钟）', () => {
      mgr.setDailyGoal(180)
      expect(mgr.getDailyGoal()).toBe(180)
    })

    it('小于 10 被裁剪为 10', () => {
      mgr.setDailyGoal(5)
      expect(mgr.getDailyGoal()).toBe(10)
    })

    it('大于 480 被裁剪为 480', () => {
      mgr.setDailyGoal(600)
      expect(mgr.getDailyGoal()).toBe(480)
    })
  })

  describe('reset', () => {
    it('重置所有数据', () => {
      mgr.addFocusMinutes(30)
      mgr.reset()
      expect(mgr.getTodayFocusMinutes()).toBe(0)
      expect(mgr.getConsecutiveDays()).toBe(0)
      expect(mgr.isGoalCompletedToday()).toBe(false)
    })
  })

  describe('checkDailyReset', () => {
    it('今天有记录时不重置', () => {
      mgr.addFocusMinutes(30)
      // 创建新实例加载同一份数据
      const newMgr = new TaskManager()
      expect(newMgr.getTodayFocusMinutes()).toBe(30)
    })
  })

  describe('onChange 监听器', () => {
    it('数据变化时通知监听器', () => {
      const fn = vi.fn()
      mgr.onChange(fn)
      mgr.addFocusMinutes(30)
      expect(fn).toHaveBeenCalled()
    })

    it('取消订阅后不再触发', () => {
      const fn = vi.fn()
      const unsub = mgr.onChange(fn)
      unsub()
      mgr.addFocusMinutes(30)
      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('getTaskManager 单例', () => {
    it('多次调用返回同一实例', () => {
      const a = getTaskManager()
      const b = getTaskManager()
      expect(a).toBe(b)
    })
  })
})
