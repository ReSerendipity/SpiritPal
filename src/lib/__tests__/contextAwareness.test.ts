// contextAwareness 单元测试 — 通知管理器、网络状态、工作状态、跨平台窗口检测
// [P2-14] 增加跨平台活跃窗口检测测试
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  NotificationManager,
  ContextAwarenessManager,
  getContextAwarenessManager,
  getNotificationManager,
  SOFT_REMINDERS,
  type PetNotification,
} from '../contextAwareness'

describe('NotificationManager', () => {
  let mgr: NotificationManager

  beforeEach(() => {
    mgr = new NotificationManager()
  })

  describe('send', () => {
    it('已启用时通知监听器', () => {
      const received: PetNotification[] = []
      mgr.onNotification((n) => received.push(n))
      mgr.send({
        type: 'rest_reminder',
        title: '休息',
        body: '休息一下',
        petMessage: '主人休息吧',
      })
      expect(received).toHaveLength(1)
      expect(received[0].type).toBe('rest_reminder')
    })

    it('禁用时不发送通知', () => {
      const received: PetNotification[] = []
      mgr.onNotification((n) => received.push(n))
      mgr.setEnabled(false)
      mgr.send({ type: 'rest_reminder', title: 'test', body: 'test' })
      expect(received).toHaveLength(0)
    })

    it('同类通知一天只发一次（除番茄钟/成就/升级/每日目标）', () => {
      const received: PetNotification[] = []
      mgr.onNotification((n) => received.push(n))
      mgr.send({ type: 'rest_reminder', title: '1', body: '1' })
      mgr.send({ type: 'rest_reminder', title: '2', body: '2' })
      expect(received).toHaveLength(1)
    })

    it('番茄钟完成通知不去重', () => {
      const received: PetNotification[] = []
      mgr.onNotification((n) => received.push(n))
      mgr.send({ type: 'pomodoro_done', title: '1', body: '1' })
      mgr.send({ type: 'pomodoro_done', title: '2', body: '2' })
      expect(received).toHaveLength(2)
    })

    it('成就通知不去重', () => {
      const received: PetNotification[] = []
      mgr.onNotification((n) => received.push(n))
      mgr.send({ type: 'achievement', title: '1', body: '1' })
      mgr.send({ type: 'achievement', title: '2', body: '2' })
      expect(received).toHaveLength(2)
    })
  })

  describe('resetDaily', () => {
    it('重置后可再次发送同类通知', () => {
      const received: PetNotification[] = []
      mgr.onNotification((n) => received.push(n))
      mgr.send({ type: 'rest_reminder', title: '1', body: '1' })
      mgr.resetDaily()
      mgr.send({ type: 'rest_reminder', title: '2', body: '2' })
      expect(received).toHaveLength(2)
    })
  })

  describe('onNotification', () => {
    it('返回取消订阅函数', () => {
      const received: PetNotification[] = []
      const unsub = mgr.onNotification((n) => received.push(n))
      mgr.send({ type: 'rest_reminder', title: '1', body: '1' })
      expect(received).toHaveLength(1)
      unsub()
      mgr.send({ type: 'rest_reminder', title: '2', body: '2' })
      expect(received).toHaveLength(1)
    })
  })
})

describe('SOFT_REMINDERS', () => {
  it('包含所有通知类型的文案', () => {
    const types = ['rest_reminder', 'drink_reminder', 'hp_low', 'hp_zero', 'pomodoro_done', 'achievement', 'level_up', 'daily_goal']
    for (const type of types) {
      expect(SOFT_REMINDERS[type as keyof typeof SOFT_REMINDERS]).toBeDefined()
      expect(SOFT_REMINDERS[type as keyof typeof SOFT_REMINDERS].petMessages.length).toBeGreaterThan(0)
      expect(SOFT_REMINDERS[type as keyof typeof SOFT_REMINDERS].title).toBeTruthy()
    }
  })
})

describe('ContextAwarenessManager 单例', () => {
  it('getContextAwarenessManager 返回同一实例', () => {
    const a = getContextAwarenessManager()
    const b = getContextAwarenessManager()
    expect(a).toBe(b)
  })

  it('getNotificationManager 返回同一实例', () => {
    const a = getNotificationManager()
    const b = getNotificationManager()
    expect(a).toBe(b)
  })
})

describe('ContextAwarenessManager 网络状态', () => {
  let mgr: ReturnType<typeof getContextAwarenessManager>

  beforeEach(() => {
    mgr = getContextAwarenessManager()
  })

  it('onNetworkChange 返回取消订阅函数', () => {
    const calls: boolean[] = []
    const unsub = mgr.onNetworkChange((event) => calls.push(event.online))
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('isOnline 初始返回 navigator.onLine', () => {
    // jsdom 中 navigator.onLine 默认为 true
    expect(mgr.isOnline()).toBe(true)
  })
})

describe('ContextAwarenessManager 工作状态', () => {
  let mgr: ReturnType<typeof getContextAwarenessManager>

  beforeEach(() => {
    mgr = getContextAwarenessManager()
  })

  it('onWorkStateChange 返回取消订阅函数', () => {
    const unsub = mgr.onWorkStateChange(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('onStateChange 返回取消订阅函数', () => {
    const unsub = mgr.onStateChange(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('markBreak 重置工作计时', () => {
    // 不抛异常即可
    expect(() => mgr.markBreak()).not.toThrow()
  })
})

// ============ P2-14: 跨平台活跃窗口检测测试 ============

describe('ContextAwarenessManager 活跃窗口检测（跨平台）', () => {
  let mgr: ContextAwarenessManager

  beforeEach(() => {
    mgr = new ContextAwarenessManager()
  })

  describe('detectWorkState — 标题匹配', () => {
    it('通过窗口标题匹配 coding 状态', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: 'App.tsx - Visual Studio Code',
        process_name: 'Code',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('coding')
    })

    it('通过窗口标题匹配 meeting 状态', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: 'Zoom Meeting - Weekly Standup',
        process_name: 'zoom',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('meeting')
    })

    it('通过窗口标题匹配 browsing 状态', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: 'Google - Chrome',
        process_name: 'chrome',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('browsing')
    })
  })

  describe('detectWorkState — 进程名匹配', () => {
    it('macOS 风格进程名匹配 coding（Code 而非 Visual Studio Code）', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: 'App.tsx',  // macOS 标题可能不含完整应用名
        process_name: 'Code',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('coding')
    })

    it('Linux 风格进程名匹配 coding（code 全小写）', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: 'App.tsx - code',
        process_name: 'code',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('coding')
    })

    it('进程名匹配 meeting（Lark/飞书）', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: '飞书会议',
        process_name: 'Lark',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('meeting')
    })

    it('进程名匹配 browsing（msedge）', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: '某网页',
        process_name: 'msedge',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('browsing')
    })

    it('Cursor 编辑器通过进程名匹配 coding', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: 'main.ts - Cursor',
        process_name: 'cursor',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('coding')
    })
  })

  describe('detectWorkState — 降级场景', () => {
    it('标题和进程名都为空时返回 idle', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: '',
        process_name: '',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('idle')
    })

    it('invoke 抛错时返回 unknown', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockRejectedValue(new Error('platform not supported'))
      const state = await mgr.detectWorkState()
      expect(state).toBe('unknown')
    })

    it('不匹配任何规则时返回 idle', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: 'Notes',
        process_name: 'notes',
      })
      const state = await mgr.detectWorkState()
      expect(state).toBe('idle')
    })
  })

  describe('平台支持检测', () => {
    it('首次调用返回数据时标记为支持', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: 'Some Window',
        process_name: 'someapp',
      })
      expect(mgr.isWindowDetectionSupported()).toBeNull()
      await mgr.detectWorkState()
      expect(mgr.isWindowDetectionSupported()).toBe(true)
    })

    it('首次调用返回空时标记为不支持', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue({
        title: '',
        process_name: '',
      })
      expect(mgr.isWindowDetectionSupported()).toBeNull()
      await mgr.detectWorkState()
      expect(mgr.isWindowDetectionSupported()).toBe(false)
    })

    it('invoke 失败时不改变支持状态（仍为 null）', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockRejectedValue(new Error('not available'))
      expect(mgr.isWindowDetectionSupported()).toBeNull()
      await mgr.detectWorkState()
      // invoke 失败走 catch 分支，不设置 windowDetectionSupported
      expect(mgr.isWindowDetectionSupported()).toBeNull()
    })
  })
})
