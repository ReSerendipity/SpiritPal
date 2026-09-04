/**
 * @file icsParser.test.ts
 * @description ICS 解析器单测（A-8 外部日历导入）
 *
 * 契约：
 *  1. 标准 UTC 事件（DTSTART ...Z）解析正确
 *  2. 全天事件（VALUE=DATE）按本地 00:00
 *  3. 折行（folding）被正确展开
 *  4. 文本转义还原（\n \, \;）
 *  5. 位置信息并入描述
 *  6. 无效/空/非 ICS 输入返回空数组且不抛错
 *  7. createIcsCalendarSource 按 range 过滤
 */

import { describe, it, expect } from 'vitest'
import { parseIcs, createIcsCalendarSource, unfoldIcsLines, parseIcsDateTime } from '@/lib/system/icsParser'

/** 构造一个最小 ICS */
function ics(body: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SpiritPal//Test//EN',
    ...body.split('\n'),
    'END:VCALENDAR',
  ].join('\r\n')
}

const TWO_EVENTS = ics(`BEGIN:VEVENT
UID:evt-1
DTSTAMP:20260829T000000Z
DTSTART:20260829T100000Z
DTEND:20260829T110000Z
SUMMARY:晨会
LOCATION:会议室 A
END:VEVENT
BEGIN:VEVENT
UID:evt-2
DTSTART:20260830T020000Z
SUMMARY:写周报
END:VEVENT`)

describe('unfoldIcsLines', () => {
  it('把以空格开头的续行合并到上一行', () => {
    const lines = unfoldIcsLines('SUMMARY:很长的标\r\n 题内容\r\nX:1')
    expect(lines).toEqual(['SUMMARY:很长的标题内容', 'X:1'])
  })

  it('TAB 也是续行标记', () => {
    expect(unfoldIcsLines('A:1\n\t2')).toEqual(['A:12'])
  })
})

describe('parseIcsDateTime', () => {
  it('UTC 时间（Z 结尾）按 UTC 解释', () => {
    expect(parseIcsDateTime('20260829T100000Z')).toBe(Date.UTC(2026, 7, 29, 10, 0, 0))
  })

  it('浮动时间按本地时区解释', () => {
    const ts = parseIcsDateTime('20260829T100000')
    expect(ts).toBe(new Date(2026, 7, 29, 10, 0, 0).getTime())
  })

  it('VALUE=DATE 全天事件按本地 00:00', () => {
    expect(parseIcsDateTime('20260829')).toBe(new Date(2026, 7, 29, 0, 0, 0).getTime())
  })

  it('无法识别的格式返回 null', () => {
    expect(parseIcsDateTime('不是日期')).toBeNull()
    expect(parseIcsDateTime('')).toBeNull()
  })
})

describe('parseIcs', () => {
  it('解析多个事件并按开始时间升序', () => {
    const events = parseIcs(TWO_EVENTS)

    expect(events).toHaveLength(2)
    expect(events[0]?.title).toBe('晨会')
    expect(events[0]?.startTime).toBe(Date.UTC(2026, 7, 29, 10, 0, 0))
    expect(events[0]?.endTime).toBe(Date.UTC(2026, 7, 29, 11, 0, 0))
    expect(events[1]?.title).toBe('写周报')
  })

  it('折行的 SUMMARY 被正确拼接', () => {
    const text = ics(`BEGIN:VEVENT
UID:fold-1
DTSTART:20260829T100000Z
SUMMARY:这是一条很长的日
 程标题需要折行
END:VEVENT`)

    const events = parseIcs(text)
    expect(events[0]?.title).toBe('这是一条很长的日程标题需要折行')
  })

  it('文本转义被还原（\\n 与 \\,）', () => {
    const text = ics(`BEGIN:VEVENT
UID:esc-1
DTSTART:20260829T100000Z
SUMMARY:买咖啡\\, 面包
DESCRIPTION:第一行\\n第二行
END:VEVENT`)

    const events = parseIcs(text)
    expect(events[0]?.title).toBe('买咖啡, 面包')
    expect(events[0]?.description).toBe('第一行\n第二行')
  })

  it('位置信息并入描述', () => {
    const events = parseIcs(TWO_EVENTS)
    expect(events[0]?.description).toContain('会议室 A')
  })

  it('无标题事件回退为「(无标题日程)」而非空字符串', () => {
    const text = ics(`BEGIN:VEVENT
UID:no-title
DTSTART:20260829T100000Z
END:VEVENT`)

    expect(parseIcs(text)[0]?.title).toBe('(无标题日程)')
  })

  it('缺少 DTSTART 的事件被跳过（无法确定时间）', () => {
    const text = ics(`BEGIN:VEVENT
UID:no-start
SUMMARY:没有开始时间
END:VEVENT`)

    expect(parseIcs(text)).toHaveLength(0)
  })

  it.each(['', '   ', '这不是 ICS 文件', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'])(
    '无效输入返回空数组且不抛错：%j',
    (input) => {
      expect(() => parseIcs(input)).not.toThrow()
      expect(parseIcs(input)).toEqual([])
    },
  )
})

describe('createIcsCalendarSource', () => {
  it('按时间范围过滤事件', async () => {
    const source = createIcsCalendarSource('ics-test', '测试日历', TWO_EVENTS)

    const all = await source.fetchEvents({
      start: Date.UTC(2026, 7, 1),
      end: Date.UTC(2026, 8, 1),
    })
    expect(all).toHaveLength(2)

    const onlyFirst = await source.fetchEvents({
      start: Date.UTC(2026, 7, 29, 0, 0, 0),
      end: Date.UTC(2026, 7, 29, 23, 59, 59),
    })
    expect(onlyFirst).toHaveLength(1)
    expect(onlyFirst[0]?.title).toBe('晨会')
  })

  it('适配器保留 id 与 label（供 UI 标注来源）', () => {
    const source = createIcsCalendarSource('ics-1', '工作日历', TWO_EVENTS)
    expect(source.id).toBe('ics-1')
    expect(source.label).toBe('工作日历')
  })
})
