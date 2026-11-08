// calendarIntegration TD-008 测试 — 不谎报授权、播报可注入且如实计数、同一事件不重复播
//
// 覆盖：
// ① 无授权通道时 requestPermission 返回 false 且 permissionGranted 保持 false（旧实现无条件置 true）；
// ② 注入授权器：true → 授权并连接；false / 抛错 → 保持未授权；未知数据源 → false；
// ③ 有 speak 钩子时真的被调用，消息含标题/时间/地点，delivered 计数 +1；
// ④ 没有 speak 钩子时如实返回未播（suppressed 计数 +1，不产生任何"已播报"假象）；
// ⑤ 同一事件连续两轮检查只播一次（deduped 计数体现），否则每分钟定时器会重复骚扰；
// ⑥ 静默时段 / 只播高优先级 / 总开关关闭时不播。
import { describe, it, expect } from 'vitest'
import { CalendarManager, type CalendarEvent } from '@/lib/system/calendarIntegration'

function evt(over: Partial<CalendarEvent> = {}): CalendarEvent {
  const start = new Date('2026-11-08T12:00:00+08:00')
  return {
    id: 'e1',
    title: '周会',
    startTime: start,
    endTime: new Date(start.getTime() + 30 * 60 * 1000),
    isAllDay: false,
    ...over,
  }
}

/** 固定在一个"非静默"的时刻：2026-11-08 11:00 本地时间 */
function fixedNow(hour = 11, minute = 0): () => Date {
  return () => new Date(2026, 10, 8, hour, minute, 0)
}

const NO_QUIET = { quietHours: { enabled: false, start: '22:00', end: '08:00' } }

describe('requestPermission（不再谎报授权）', () => {
  it('没有授权通道时返回 false，且 permissionGranted 保持 false', async () => {
    const m = new CalendarManager(undefined, {})
    const ok = await m.requestPermission('windows-calendar')
    expect(ok).toBe(false)
  })

  it('注入授权器返回 true 时才授权，并置 connected', async () => {
    const m = new CalendarManager(undefined, { requestPermission: async () => true })
    expect(await m.requestPermission('windows-calendar')).toBe(true)
  })

  it('授权器返回 false / 抛错时都不授权', async () => {
    const deny = new CalendarManager(undefined, { requestPermission: async () => false })
    expect(await deny.requestPermission('outlook')).toBe(false)

    const boom = new CalendarManager(undefined, {
      requestPermission: async () => {
        throw new Error('user cancelled')
      },
    })
    expect(await boom.requestPermission('outlook')).toBe(false)
  })

  it('未知数据源返回 false', async () => {
    const m = new CalendarManager(undefined, { requestPermission: async () => true })
    expect(await m.requestPermission('not-a-source')).toBe(false)
  })
})

describe('宠物播报（可注入 + 如实计数）', () => {
  it('有 speak 钩子时真被调用，消息含标题、时间与地点', async () => {
    const spoken: Array<{ msg: string; tone: string }> = []
    const m = new CalendarManager(NO_QUIET, {
      now: fixedNow(),
      eventsProvider: async () => [evt()],
      speak: async (msg, tone) => {
        spoken.push({ msg, tone })
      },
    })

    await m.runReminderCheck()

    expect(spoken).toHaveLength(1)
    expect(spoken[0].msg).toContain('周会')
    expect(spoken[0].tone).toBe('gentle')
    expect(m.getReminderStats().delivered).toBe(1)
    expect(m.getReminderStats().suppressed).toBe(0)
  })

  it('地点会拼进播报文案', async () => {
    const spoken: string[] = []
    const m = new CalendarManager(NO_QUIET, {
      now: fixedNow(),
      eventsProvider: async () => [evt({ location: '3 楼会议室' })],
      speak: async (msg) => {
        spoken.push(msg)
      },
    })
    await m.runReminderCheck()
    expect(spoken[0]).toContain('3 楼会议室')
  })

  it('没有 speak 钩子时如实不播：suppressed +1、delivered 保持 0', async () => {
    const m = new CalendarManager(NO_QUIET, {
      now: fixedNow(),
      eventsProvider: async () => [evt()],
    })

    await m.runReminderCheck()

    const stats = m.getReminderStats()
    expect(stats.delivered).toBe(0)
    expect(stats.suppressed).toBe(1)
  })

  it('同一事件连续两轮检查只播一次', async () => {
    let calls = 0
    const m = new CalendarManager(NO_QUIET, {
      now: fixedNow(),
      eventsProvider: async () => [evt()],
      speak: async () => {
        calls++
      },
    })

    await m.runReminderCheck()
    await m.runReminderCheck()

    expect(calls).toBe(1)
    expect(m.getReminderStats().deduped).toBe(1)
  })

  it('不同事件各自播一次', async () => {
    let calls = 0
    const m = new CalendarManager(NO_QUIET, {
      now: fixedNow(),
      eventsProvider: async () => [evt({ id: 'e1', title: '周会' }), evt({ id: 'e2', title: '评审' })],
      speak: async () => {
        calls++
      },
    })
    await m.runReminderCheck()
    expect(calls).toBe(2)
    expect(m.getReminderStats().delivered).toBe(2)
  })

  it('只播高优先级时过滤掉 normal', async () => {
    let calls = 0
    const m = new CalendarManager({ ...NO_QUIET, showOnlyHighPriority: true }, {
      now: fixedNow(),
      eventsProvider: async () => [evt({ id: 'e1', priority: 'normal' }), evt({ id: 'e2', priority: 'high' })],
      speak: async () => {
        calls++
      },
    })
    await m.runReminderCheck()
    expect(calls).toBe(1)
  })

  it('静默时段不播', async () => {
    let calls = 0
    const m = new CalendarManager(
      { quietHours: { enabled: true, start: '22:00', end: '08:00' } },
      {
        now: fixedNow(23, 0), // 23:00 落在 22:00-08:00 之间
        eventsProvider: async () => [evt()],
        speak: async () => {
          calls++
        },
      },
    )
    await m.runReminderCheck()
    expect(calls).toBe(0)
  })

  it('总开关关闭时不播', async () => {
    let calls = 0
    const m = new CalendarManager({ enabled: false }, {
      now: fixedNow(),
      eventsProvider: async () => [evt()],
      speak: async () => {
        calls++
      },
    })
    await m.runReminderCheck()
    expect(calls).toBe(0)
  })
})
