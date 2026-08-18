/**
 * scheduleManager 边界补充测试
 *
 * 现有 scheduleManager.test.ts 已覆盖 parseScheduleFromText 主要分支、ScheduleManager 类
 * 的增删改查、提醒触发、重复日程、通知与 localStorage 持久化。
 * 本文件补充尚未覆盖的边界分支：
 * - "下周X" 的星期映射正确性（用固定系统时间断言）
 * - "明天/每天" 无具体时间时的默认 9:00 行为
 * - 时间段（上午/下午/晚上/早上）与 12 点边界
 *
 * 注意：parseTimePeriod 为模块私有函数，仅能通过 parseScheduleFromText 间接验证。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseScheduleFromText } from '@/lib/scheduleManager'

describe('parseScheduleFromText 边界（补充）', () => {
  // 固定系统时间为周一，保证 "下周X" / "明天" 判定确定性
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T10:00:00')) // 周一
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('下周X → 命中正确星期（下周一到周日映射）', () => {
    // 周一 + "下周三" = 周三（getDay() === 3）
    const wed = parseScheduleFromText('下周三提醒我开会')
    expect(wed).not.toBeNull()
    expect(new Date(wed!.triggerTime).getDay()).toBe(3)
    expect(wed!.title).toContain('开会')
  })

  it('下周X → "下周天" 与 "下周日" 均映射到周日', () => {
    const sunday1 = parseScheduleFromText('下周日提醒我')
    const sunday2 = parseScheduleFromText('下周天提醒我')
    expect(new Date(sunday1!.triggerTime).getDay()).toBe(0)
    expect(new Date(sunday2!.triggerTime).getDay()).toBe(0)
  })

  it('明天（无具体时间）默认 9:00', () => {
    const r = parseScheduleFromText('明天提醒我买东西')
    expect(r).not.toBeNull()
    const d = new Date(r!.triggerTime)
    expect(d.getDate()).toBe(18) // 8/17 的明天
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(0)
  })

  it('每天（无具体时间）默认 9:00 且 daily 重复', () => {
    const r = parseScheduleFromText('每天提醒我喝水')
    expect(r).not.toBeNull()
    expect(r!.repeatRule).toEqual({ type: 'daily', interval: 1 })
    expect(new Date(r!.triggerTime).getHours()).toBe(9)
  })

  it('后天（无具体时间）默认 9:00', () => {
    const r = parseScheduleFromText('后天提醒我交报告')
    expect(r).not.toBeNull()
    const d = new Date(r!.triggerTime)
    expect(d.getDate()).toBe(19) // 8/17 的后天
    expect(d.getHours()).toBe(9)
  })

  it('下午 12 点边界：小时保持 12', () => {
    const r = parseScheduleFromText('下午12点开会')
    expect(r).not.toBeNull()
    expect(new Date(r!.triggerTime).getHours()).toBe(12)
  })

  it('晚上时间转换为 24 小时制', () => {
    const r = parseScheduleFromText('晚上8点提醒我')
    expect(r).not.toBeNull()
    expect(new Date(r!.triggerTime).getHours()).toBe(20)
  })

  it('纯文本（无时间信息）返回 null', () => {
    expect(parseScheduleFromText('帮我看看今天的天气')).toBeNull()
  })
})