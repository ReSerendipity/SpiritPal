// scheduleManager 模块测试 — 对话式日程创建 + 提醒
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve('granted')),
}))

import {
  parseScheduleFromText,
  ScheduleManager,
  getScheduleManager,
} from '../scheduleManager'
import { sendNotification, isPermissionGranted } from '@tauri-apps/plugin-notification'

describe('parseScheduleFromText', () => {
  it('解析 "X分钟后"', () => {
    const result = parseScheduleFromText('30分钟后提醒我开会')
    expect(result).not.toBeNull()
    expect(result!.title).toContain('开会')
    expect(result!.triggerTime).toBeGreaterThan(Date.now())
  })

  it('解析 "X小时后"', () => {
    const result = parseScheduleFromText('2小时后提醒')
    expect(result).not.toBeNull()
    expect(result!.title).toBe('提醒事项')
    expect(result!.triggerTime).toBeGreaterThan(Date.now())
  })

  it('解析 "每天X点"（每日重复）', () => {
    const result = parseScheduleFromText('每天上午9点提醒我喝水')
    expect(result).not.toBeNull()
    expect(result!.repeatRule).toEqual({ type: 'daily', interval: 1 })
    expect(result!.title).toContain('喝水')
  })

  it('解析 "明天X点"', () => {
    const result = parseScheduleFromText('明天下午3点开会')
    expect(result).not.toBeNull()
    expect(result!.title).toContain('开会')
  })

  it('解析 "后天"', () => {
    const result = parseScheduleFromText('后天提醒我买东西')
    expect(result).not.toBeNull()
    expect(result!.title).toContain('买东西')
  })

  it('解析 "下午X点"', () => {
    const result = parseScheduleFromText('下午3点提醒我')
    expect(result).not.toBeNull()
  })

  it('解析 "下周X"', () => {
    const result = parseScheduleFromText('下周一提醒我')
    expect(result).not.toBeNull()
    expect(result!.title).toBeTruthy()
  })

  it('无法解析时返回 null', () => {
    const result = parseScheduleFromText('这是一段没有时间信息的文字')
    expect(result).toBeNull()
  })

  it('分钟解析提取标题', () => {
    const result = parseScheduleFromText('10分钟后提醒我吃饭')
    expect(result).not.toBeNull()
    expect(result!.title).toContain('吃饭')
  })
})

describe('ScheduleManager', () => {
  let mgr: ScheduleManager

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    mgr = new ScheduleManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('addEvent', () => {
    it('添加事件并返回 ID', () => {
      const id = mgr.addEvent({
        title: '测试事件',
        triggerTime: Date.now() + 3600000,
        source: 'manual',
        reminderMinutes: [5],
      })
      expect(id).toBeTruthy()
      expect(mgr.getEvents().length).toBe(1)
    })

    it('添加后事件为 pending 状态', () => {
      mgr.addEvent({
        title: '测试',
        triggerTime: Date.now() + 3600000,
        source: 'manual',
        reminderMinutes: [],
      })
      expect(mgr.getEvents()[0].status).toBe('pending')
    })
  })

  describe('addFromChat', () => {
    it('从对话文本创建日程', () => {
      const event = mgr.addFromChat('30分钟后提醒我开会', 'doro')
      expect(event).not.toBeNull()
      expect(event!.title).toContain('开会')
      expect(event!.source).toBe('chat')
      expect(event!.characterId).toBe('doro')
    })

    it('无法解析时返回 null', () => {
      const event = mgr.addFromChat('你好呀')
      expect(event).toBeNull()
    })
  })

  describe('事件管理', () => {
    it('removeEvent 删除事件', () => {
      const id = mgr.addEvent({
        title: '测试',
        triggerTime: Date.now() + 3600000,
        source: 'manual',
        reminderMinutes: [],
      })
      mgr.removeEvent(id)
      expect(mgr.getEvents().length).toBe(0)
    })

    it('completeEvent 标记完成', () => {
      const id = mgr.addEvent({
        title: '测试',
        triggerTime: Date.now() + 3600000,
        source: 'manual',
        reminderMinutes: [],
      })
      mgr.completeEvent(id)
      expect(mgr.getEvents()[0].status).toBe('completed')
    })

    it('cancelEvent 标记取消', () => {
      const id = mgr.addEvent({
        title: '测试',
        triggerTime: Date.now() + 3600000,
        source: 'manual',
        reminderMinutes: [],
      })
      mgr.cancelEvent(id)
      expect(mgr.getEvents()[0].status).toBe('cancelled')
    })
  })

  describe('查询方法', () => {
    beforeEach(() => {
      // 固定系统时间，避免事件跨过午夜导致"是否今日"判定不稳定（时区边界缺陷）
      vi.setSystemTime(new Date('2026-08-07T10:00:00'))
      mgr.addEvent({
        title: '未来事件1',
        triggerTime: Date.now() + 3600000,
        source: 'manual',
        reminderMinutes: [],
      })
      mgr.addEvent({
        title: '未来事件2',
        triggerTime: Date.now() + 7200000,
        source: 'manual',
        reminderMinutes: [],
      })
    })

    it('getEvents 按时间排序', () => {
      const events = mgr.getEvents()
      expect(events.length).toBe(2)
      expect(events[0].triggerTime).toBeLessThanOrEqual(events[1].triggerTime)
    })

    it('getPendingEvents 返回 pending 事件', () => {
      const pending = mgr.getPendingEvents()
      expect(pending.length).toBe(2)
    })

    it('getTodayEvents 返回今日事件', () => {
      const today = mgr.getTodayEvents()
      expect(today.length).toBe(2)
    })
  })

  describe('onChange 订阅', () => {
    it('事件变化时通知', () => {
      const listener = vi.fn()
      const unsub = mgr.onChange(listener)
      mgr.addEvent({
        title: '测试',
        triggerTime: Date.now() + 3600000,
        source: 'manual',
        reminderMinutes: [],
      })
      // 通知在防抖保存（SAVE_DEBOUNCE_MS=300ms）后触发
      vi.advanceTimersByTime(400)
      expect(listener).toHaveBeenCalled()
      unsub()
    })
  })

  describe('onReminder 订阅', () => {
    it('触发时通知监听器', async () => {
      const reminderListener = vi.fn()
      mgr.onReminder(reminderListener)

      // 添加一个立即过期的事件
      mgr.addEvent({
        title: '立即触发',
        triggerTime: Date.now() - 1000,
        source: 'manual',
        reminderMinutes: [],
      })

      // 触发检查（advance timer by 60s to trigger checkReminders）
      vi.advanceTimersByTime(60000)

      expect(reminderListener).toHaveBeenCalled()
    })
  })

  describe('重复日程', () => {
    it('daily 重复创建下一次触发', async () => {
      mgr.addEvent({
        title: '每日提醒',
        triggerTime: Date.now() - 1000,
        source: 'manual',
        reminderMinutes: [],
        repeatRule: { type: 'daily', interval: 1 },
      })

      vi.advanceTimersByTime(60000)

      // 应该有新的 pending 事件（重复）
      const pending = mgr.getPendingEvents()
      expect(pending.length).toBeGreaterThan(0)
    })

    it('weekly 重复创建下一次触发', async () => {
      mgr.addEvent({
        title: '每周提醒',
        triggerTime: Date.now() - 1000,
        source: 'manual',
        reminderMinutes: [],
        repeatRule: { type: 'weekly', interval: 1 },
      })

      vi.advanceTimersByTime(60000)

      const pending = mgr.getPendingEvents()
      expect(pending.length).toBeGreaterThan(0)
    })
  })

  describe('系统通知', () => {
    it('触发时发送系统通知', async () => {
      ;(isPermissionGranted as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      mgr.addEvent({
        title: '通知测试',
        triggerTime: Date.now() - 1000,
        source: 'manual',
        reminderMinutes: [],
      })

      vi.advanceTimersByTime(60000)

      // 等待异步 sendSystemNotification
      await vi.waitFor(() => {
        expect(sendNotification).toHaveBeenCalled()
      })
    })
  })

  describe('start / stop', () => {
    it('start 启动定时检查', () => {
      mgr.start()
      // 不抛出错误即可
    })

    it('stop 停止定时检查', () => {
      mgr.start()
      mgr.stop()
      // 不抛出错误即可
    })
  })

  describe('localStorage 持久化', () => {
    it('新实例从 localStorage 加载', () => {
      mgr.addEvent({
        title: '持久化测试',
        triggerTime: Date.now() + 3600000,
        source: 'manual',
        reminderMinutes: [],
      })
      // 先冲刷防抖保存（SAVE_DEBOUNCE_MS=300ms），确保 localStorage 已写入
      vi.advanceTimersByTime(400)
      const mgr2 = new ScheduleManager()
      expect(mgr2.getEvents().length).toBeGreaterThan(0)
    })

    it('清理过期已完成事件', () => {
      mgr.addEvent({
        title: '过期事件',
        triggerTime: Date.now() - 86400000 * 2, // 2天前
        source: 'manual',
        reminderMinutes: [],
      })
      // 手动标记完成
      const events = mgr.getEvents()
      mgr.completeEvent(events[0].id)
      // 新实例加载时应清理
      const mgr2 = new ScheduleManager()
      expect(mgr2.getEvents().length).toBe(0)
    })
  })

  describe('getScheduleManager 单例', () => {
    it('返回同一实例', () => {
      const m1 = getScheduleManager()
      const m2 = getScheduleManager()
      expect(m1).toBe(m2)
    })
  })
})
