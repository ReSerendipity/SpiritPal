/**
 * @file icsParser.ts
 * @description ICS（iCalendar RFC 5545）文本解析器（A-8 外部日历数据源）
 *
 * 背景：日程此前只有「手动添加 / 对话创建」两个来源，`calendarIntegration.ts` 的
 * 系统日历读取依赖 Node `child_process`，webview 无法 import，且其 `fetchEvents`
 * 长期 `return []` 空占位。本模块提供 **webview 安全的真实外部日历能力**：
 * 用户从 Google / Outlook / Apple 日历导出的 `.ics` 文件可直接解析并汇入日程视图。
 *
 * 支持范围（够用的最小子集，不支持 RRULE 展开）：
 * - `BEGIN:VEVENT` / `END:VEVENT` 内的 UID / SUMMARY / DESCRIPTION / LOCATION / DTSTART / DTEND
 * - 折行（RFC 5545 folding：以空格或 TAB 开头的续行）
 * - 三种时间格式：`YYYYMMDDTHHMMSSZ`（UTC）、`YYYYMMDDTHHMMSS`（浮动，按本地时区）、
 *   `YYYYMMDD`（VALUE=DATE 全天事件，按本地 00:00）
 * - 文本转义还原：`\n` `\,` `\;` `\\`
 *
 * ⚠️ 不支持 RRULE 展开与 VTIMEZONE 解析：带重复规则的事件只取其首次发生时间
 * （后续发生由 scheduleManager 自身的重复规则体系负责，不在此处重复实现）。
 */

import type { CalendarSourceAdapter, CalendarSourceEvent } from '@/lib/nurture/scheduleManager'

/** 一个 VEVENT 的中间状态 */
interface RawEvent {
  uid?: string
  title?: string
  description?: string
  location?: string
  startTime?: number
  endTime?: number
}

/**
 * 展开 RFC 5545 折行：以空格/TAB 开头的行是上一行的续行
 */
export function unfoldIcsLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const out: string[] = []
  for (const line of normalized.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1]! += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

/**
 * 解析单行属性：`NAME;PARAM=VAL:value`
 * 只在第一个冒号处切分（值里允许含冒号，如 URL / 描述文本）
 */
function parseProperty(
  line: string,
): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(':')
  if (idx <= 0) return null

  const left = line.slice(0, idx)
  const value = line.slice(idx + 1)
  const segments = left.split(';')
  const name = segments[0]!.toUpperCase()

  const params: Record<string, string> = {}
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf('=')
    if (eq > 0) {
      params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1)
    }
  }
  return { name, params, value }
}

/**
 * 还原 ICS 文本转义
 */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * 解析 ICS 日期时间
 *
 * @returns 时间戳（毫秒），无法识别时返回 null
 */
export function parseIcsDateTime(value: string): number | null {
  // 1) YYYYMMDDTHHMMSS[Z]
  const withTime = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (withTime) {
    const [, y, mo, d, h, mi, s, utc] = withTime
    if (utc === 'Z') {
      return Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!)
    }
    // 浮动时间（无 Z / 带 TZID）：按本地时区解释
    return new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +s!).getTime()
  }

  // 2) YYYYMMDD（全天事件）
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) {
    return new Date(+dateOnly[1]!, +dateOnly[2]! - 1, +dateOnly[3]!, 0, 0, 0).getTime()
  }

  return null
}

/**
 * 解析 ICS 文本为外部日历事件列表（按开始时间升序）
 *
 * 无效输入（空文本 / 非 ICS / 无 VEVENT）一律返回空数组，**不抛异常**。
 */
export function parseIcs(text: string): CalendarSourceEvent[] {
  if (!text || !text.trim()) return []

  const events: CalendarSourceEvent[] = []
  let inEvent = false
  let current: RawEvent | null = null

  for (const line of unfoldIcsLines(text)) {
    const prop = parseProperty(line)
    if (!prop) continue

    if (prop.name === 'BEGIN' && prop.value.trim().toUpperCase() === 'VEVENT') {
      inEvent = true
      current = {}
      continue
    }

    if (prop.name === 'END' && prop.value.trim().toUpperCase() === 'VEVENT') {
      inEvent = false
      if (current && current.startTime != null) {
        // 位置信息并入描述（UI 只展示 description 字段）
        const extra = [current.location, current.description].filter(Boolean).join('\n')
        events.push({
          id: current.uid?.trim() || `ics-${events.length}`,
          title: current.title?.trim() || '(无标题日程)',
          startTime: current.startTime,
          ...(current.endTime != null ? { endTime: current.endTime } : {}),
          ...(extra ? { description: extra } : {}),
        })
      }
      current = null
      continue
    }

    if (!inEvent || !current) continue

    switch (prop.name) {
      case 'UID':
        current.uid = prop.value
        break
      case 'SUMMARY':
        current.title = unescapeText(prop.value)
        break
      case 'DESCRIPTION':
        current.description = unescapeText(prop.value)
        break
      case 'LOCATION':
        current.location = unescapeText(prop.value)
        break
      case 'DTSTART':
        current.startTime = parseIcsDateTime(prop.value) ?? undefined
        break
      case 'DTEND':
        current.endTime = parseIcsDateTime(prop.value) ?? undefined
        break
      default:
        break
    }
  }

  return events.sort((a, b) => a.startTime - b.startTime)
}

/**
 * 由 ICS 文本构造一个 `CalendarSourceAdapter`，可直接注册进 scheduleManager
 *
 * 用法：
 * ```ts
 * getScheduleManager().registerCalendarSource(createIcsCalendarSource('ics-1', '工作日历', text))
 * ```
 */
export function createIcsCalendarSource(
  id: string,
  label: string,
  icsText: string,
): CalendarSourceAdapter {
  const events = parseIcs(icsText)
  return {
    id,
    label,
    async fetchEvents(range: { start: number; end: number }): Promise<CalendarSourceEvent[]> {
      return events.filter(
        (e) => e.startTime >= range.start && e.startTime <= range.end,
      )
    },
  }
}
