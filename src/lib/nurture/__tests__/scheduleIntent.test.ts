/**
 * @file scheduleIntent.test.ts
 * @description 日程自动提取的意图门槛回归（2026-10-25 缺陷修复）
 *
 * 缺陷背景：聊天主流程对每条用户消息调用 addFromChat 自动提取日程，而
 * parseScheduleFromText 是纯时间表达解析（"明天"/"X分钟后"/"每天"即命中），
 * 闲聊时间词（"明天再说吧"、"3分钟后就到饭点了"）会被误建成幽灵日程。
 * 修复：addFromChat 自动提取路径默认 requireIntent=true —— 需同时命中时间表达与
 * 提醒/日程意图关键词；显式工具调用路径（set_reminder）传 requireIntent:false。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getScheduleManager, hasReminderIntent, parseScheduleFromText } from '../scheduleManager'

// scheduleManager 模块级引入 Tauri 插件与 DB 封装；纯函数/本地链路测试将其 mock 掉，
// 保证评测在无 Tauri 运行时的条件下可复现（与 prompt.eval.test.ts 同口径）。
// （vi.mock 会被 hoist 到 import 之前，故置于被测模块 import 之后仍生效）
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => 'granted'),
}))
vi.mock('@/lib/data/db', () => ({
  deleteSchedule: vi.fn(async () => undefined),
  getSchedules: vi.fn(async () => []),
  saveSchedule: vi.fn(async () => undefined),
}))

describe('hasReminderIntent · 提醒/日程意图判定', () => {
  it.each([
    ['明天9点提醒我开会', true],
    ['别忘了明天交报告', true],
    ['30分钟后叫我喝水', true],
    ['设置一下日程：周五下午3点复盘', true],
    ['project deadline is Friday', true],
  ])('正向（显式意图）：%s', (text, expected) => {
    expect(hasReminderIntent(text)).toBe(expected)
  })

  it.each([
    ['明天再说吧', false],
    ['我明天想去北京旅游', false],
    ['3分钟后就到饭点了', false],
    ['每天都好累啊', false],
  ])('反向（闲聊时间词不触发）：%s', (text, expected) => {
    expect(hasReminderIntent(text)).toBe(expected)
  })
})

describe('parseScheduleFromText · 纯时间解析语义保持不变', () => {
  // 门槛加在 addFromChat（自动提取路径），不改动纯解析函数本身——
  // 显式工具调用（set_reminder）依旧能解析不含意图词的内容（"30分钟后喝水"）。
  it('不含意图词的纯时间表达仍可被解析（供显式工具调用复用）', () => {
    expect(parseScheduleFromText('30分钟后喝水')).not.toBeNull()
    expect(parseScheduleFromText('明天下午3点开会')).not.toBeNull()
  })
})

describe('addFromChat · 自动提取路径的意图门槛', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('闲聊时间词不再误建日程（默认 requireIntent=true）', () => {
    const mgr = getScheduleManager()
    expect(mgr.addFromChat('明天再说吧')).toBeNull()
    expect(mgr.addFromChat('我明天想去北京旅游')).toBeNull()
    expect(mgr.addFromChat('30分钟后喝水')).toBeNull()
  })

  it('时间表达 + 显式意图仍可自动建日程', () => {
    const mgr = getScheduleManager()
    const event = mgr.addFromChat('明天9点提醒我开会')
    expect(event).not.toBeNull()
    expect(event?.status).toBe('pending')
  })

  it('显式工具调用路径（requireIntent:false）可建无意图词的日程', () => {
    const mgr = getScheduleManager()
    const event = mgr.addFromChat('30分钟后喝水', undefined, { requireIntent: false })
    expect(event).not.toBeNull()
  })
})
