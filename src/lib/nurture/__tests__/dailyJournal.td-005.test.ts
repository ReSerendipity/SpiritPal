/**
 * @file dailyJournal.td-005.test.ts
 * @description TD-005「智能日记为模板拼装」的回归用例（2026-11-08）
 *
 * 债项原本登记的是「5 处 TODO」，实测是五种不同的错：
 * 1. `fetchTodaysMemories` / `fetchTodaysActivities` 都是 `return []`，于是「生成今日草稿」
 *    永远产出一篇空日记——而且**看不出是空的**（没有报告、没有日志）;
 * 2. `search()` 只翻内存缓存，`startDate` / `endDate` / `tags` 三个参数一个都没用上，
 *    新进程里搜索历史日记必然返回空;
 * 3. `generateAutoSummary` 把今日记忆正文拼起来 `substring(0, max)` 当摘要（截断而非摘要），
 *    `activities` 参数带下划线、整个被丢弃;
 * 4. `analyzeMood` 是仓内第三套「情绪→分数」人肉词典，与 TD-012 已统一的 emotionEngine 口径不一致;
 * 5. 全模块用 `toISOString().split('T')[0]` 取「今天」，那是 **UTC 日期**：
 *    东八区早上 7 点会把草稿写成前一天，覆盖昨天那份文件。
 *
 * 本文件按这五条分别钉住行为，并要求「读不到数据」时**如实报告**而不是假装成功。
 */

import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DailyJournalManager,
  localDayRange,
  toLocalDateKey,
  valenceFromTexts,
  type DailyJournalDeps,
  type JournalEntry,
} from '../dailyJournal'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spiritpal-journal-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    date: '2026-11-08',
    title: '📅 2026-11-08',
    content: '今天写了代码',
    tags: ['work'],
    categories: ['work'],
    highlights: [],
    createdAt: 1,
    updatedAt: 1,
    synced: false,
    ...overrides,
  }
}

describe('TD-005 · 本地日期边界', () => {
  it('toLocalDateKey 用本地年月日，不再按 UTC 判日', () => {
    // 东八区 2026-11-08 07:00 = UTC 2026-11-07 23:00：旧实现会给出 '2026-11-07'
    const morning = new Date(2026, 10, 8, 7, 0, 0)
    expect(toLocalDateKey(morning)).toBe('2026-11-08')

    const lateNight = new Date(2026, 10, 8, 23, 30, 0)
    expect(toLocalDateKey(lateNight)).toBe('2026-11-08')
  })

  it('localDayRange 覆盖 [当日 0 点, 次日 0 点) 且跨月正确', () => {
    const range = localDayRange('2026-10-31')
    const start = new Date(range.startTime)
    const end = new Date(range.endTime)
    expect(start.getMonth()).toBe(9)
    expect(start.getDate()).toBe(31)
    expect(end.getMonth()).toBe(10)
    expect(end.getDate()).toBe(1)
    expect(range.endTime - range.startTime).toBe(24 * 60 * 60 * 1000)
  })

  it('非法日期返回 NaN 区间，不抛出', () => {
    const range = localDayRange('not-a-date')
    expect(Number.isNaN(range.startTime)).toBe(true)
    expect(Number.isNaN(range.endTime)).toBe(true)
  })
})

describe('TD-005 · 今日记忆与活动来源', () => {
  it('没有 characterId 时不猜角色：草稿为空且报告写明原因', async () => {
    const manager = new DailyJournalManager(dir, undefined, { now: () => new Date(2026, 10, 8, 9, 0, 0) })
    const draft = await manager.generateTodayDraft()

    expect(draft.date).toBe('2026-11-08')
    expect(draft.summary).toBeTruthy()
    const report = manager.getLastDraftReport()
    expect(report?.memorySource).toBe('unavailable')
    expect(report?.memoryCount).toBe(0)
    expect(report?.notes.join('\n')).toContain('未传 characterId')
  })

  it('注入 loadMemories 后，今日记忆真的进正文、进 relatedMemoryIds', async () => {
    const deps: DailyJournalDeps = {
      now: () => new Date(2026, 10, 8, 9, 0, 0),
      loadMemories: async (characterId, dateKey) => {
        expect(characterId).toBe('spirit-1')
        expect(dateKey).toBe('2026-11-08')
        return [
          { id: 'm1', content: '今天把日记模块接上了', created_at: '2026-11-08T01:00:00.000Z' },
          { id: 'm2', content: '顺手修了搜索一直空的问题', created_at: '2026-11-08T02:00:00.000Z' },
        ]
      },
    }
    const manager = new DailyJournalManager(dir, undefined, deps)
    const draft = await manager.generateTodayDraft('spirit-1')

    expect(draft.content).toContain('今天把日记模块接上了')
    expect(draft.content).toContain('顺手修了搜索一直空的问题')
    expect(draft.relatedMemoryIds).toEqual(['m1', 'm2'])
    const report = manager.getLastDraftReport()
    expect(report?.memorySource).toBe('injected')
    expect(report?.memoryCount).toBe(2)
  })

  it('注入 loadActivities 后，活动进正文；未注入时如实报 none', async () => {
    const withActivities = new DailyJournalManager(dir, undefined, {
      now: () => new Date(2026, 10, 8, 9, 0, 0),
      loadActivities: async () => [
        { app: 'Code', duration: 180 },
        { app: 'Chrome', duration: 40 },
      ],
    })
    const draft = await withActivities.generateTodayDraft()
    expect(draft.content).toContain('Code: 180')
    expect(withActivities.getLastDraftReport()?.activitySource).toBe('injected')
    expect(withActivities.getLastDraftReport()?.activityCount).toBe(2)

    const withoutActivities = new DailyJournalManager(dir, undefined, {
      now: () => new Date(2026, 10, 8, 9, 0, 0),
    })
    await withoutActivities.generateTodayDraft()
    const report = withoutActivities.getLastDraftReport()
    expect(report?.activitySource).toBe('none')
    expect(report?.notes.join('\n')).toContain('窗口活动日志数据源')
  })
})

describe('TD-005 · 摘要是摘要，不是原文截断', () => {
  const memories = [
    { id: 'a', content: '今天开了项目评审会，讨论了发布节奏', created_at: '2026-11-08T01:00:00.000Z' },
    { id: 'b', content: '下午去跑步，心情不错', created_at: '2026-11-08T08:00:00.000Z' },
  ]

  it('未注入 LLM 时走结构化启发式，且 source 如实标 heuristic', async () => {
    const manager = new DailyJournalManager(dir, { maxSummaryLength: 500 }, {
      now: () => new Date(2026, 10, 8, 20, 0, 0),
      loadMemories: async () => memories,
      loadActivities: async () => [{ app: 'Code', duration: 200 }],
    })
    const draft = await manager.generateTodayDraft('spirit-1')

    expect(draft.summary).toContain('今天共记下 2 条对话')
    expect(draft.summary).toContain('Code')
    // 不是「记忆正文的前 500 字」
    expect(draft.summary?.startsWith('今天开了项目评审会')).toBe(false)
    expect(manager.getLastDraftReport()?.summarySource).toBe('heuristic')
  })

  it('maxSummaryLength 生效，且尽量在句末截断而不是切在半句', async () => {
    const longMemory = [
      { content: '第一句话说明今天的进展。' + 'x'.repeat(60) + '第二句开始补充细节。', created_at: '2026-11-08T01:00:00.000Z' },
    ]
    const manager = new DailyJournalManager(dir, { maxSummaryLength: 40 }, {
      now: () => new Date(2026, 10, 8, 20, 0, 0),
      loadMemories: async () => longMemory,
    })
    const draft = await manager.generateTodayDraft('spirit-1')
    expect((draft.summary ?? '').length).toBeLessThanOrEqual(41) // 允许末尾补一个 …
  })

  it('注入 LLM 时真调用一次，摘要取 LLM 返回，prompt 里含记忆与活动素材', async () => {
    const calls: Array<Array<{ role: string; content: string }>> = []
    const manager = new DailyJournalManager(dir, undefined, {
      now: () => new Date(2026, 10, 8, 20, 0, 0),
      loadMemories: async () => memories,
      loadActivities: async () => [{ app: 'Code', duration: 200 }],
      llm: {
        chat: async (messages) => {
          calls.push(messages)
          return '今天主要是项目评审与跑步，心情不错。'
        },
      },
    })
    const draft = await manager.generateTodayDraft('spirit-1')

    expect(calls).toHaveLength(1)
    const prompt = calls[0].map((m) => m.content).join('\n')
    expect(prompt).toContain('项目评审会')
    expect(prompt).toContain('Code 200')
    expect(prompt).toContain('日记摘要')
    expect(draft.summary).toBe('今天主要是项目评审与跑步，心情不错。')
    expect(manager.getLastDraftReport()?.summarySource).toBe('llm')
  })

  it('LLM 返回空串按失败处理，降级启发式并写明原因', async () => {
    const manager = new DailyJournalManager(dir, undefined, {
      now: () => new Date(2026, 10, 8, 20, 0, 0),
      loadMemories: async () => memories,
      llm: { chat: async () => '   ' },
    })
    const draft = await manager.generateTodayDraft('spirit-1')
    expect(draft.summary).toContain('今天共记下 2 条对话')
    const report = manager.getLastDraftReport()
    expect(report?.summarySource).toBe('heuristic')
    expect(report?.notes.join('\n')).toContain('空文本')
  })

  it('LLM 抛错不吞：降级启发式且备注保留错误信息', async () => {
    const manager = new DailyJournalManager(dir, undefined, {
      now: () => new Date(2026, 10, 8, 20, 0, 0),
      loadMemories: async () => memories,
      llm: {
        chat: async () => {
          throw new Error('connection refused')
        },
      },
    })
    const draft = await manager.generateTodayDraft('spirit-1')
    expect(draft.summary).toContain('今天共记下 2 条对话')
    expect(manager.getLastDraftReport()?.notes.join('\n')).toContain('connection refused')
  })
})

describe('TD-005 · 情绪分统一到 emotionEngine 口径', () => {
  it('valenceFromTexts 落在 -1~1，且正负与情绪一致', () => {
    const positive = valenceFromTexts(['今天很开心，顺利完成发布'])
    const negative = valenceFromTexts(['很难过，事情全砸了，太糟糕'])
    expect(positive).toBeGreaterThan(0)
    expect(negative).toBeLessThan(0)
    expect(positive).toBeLessThanOrEqual(1)
    expect(negative).toBeGreaterThanOrEqual(-1)
    expect(valenceFromTexts([])).toBe(0)
  })

  it('草稿里的 moodScore 走同一函数，不再有人肉词典', async () => {
    const manager = new DailyJournalManager(dir, undefined, {
      now: () => new Date(2026, 10, 8, 20, 0, 0),
      loadMemories: async () => [{ content: '很难过，事情全砸了，太糟糕', created_at: '2026-11-08T01:00:00.000Z' }],
    })
    const draft = await manager.generateTodayDraft('spirit-1')
    expect(draft.moodScore).toBe(valenceFromTexts(['很难过，事情全砸了，太糟糕']))
    expect(draft.moodScore).toBeLessThan(0)
  })
})

describe('TD-005 · 搜索真的扫盘', () => {
  async function seed(files: JournalEntry[]): Promise<void> {
    for (const entry of files) {
      await writeFile(join(dir, `${entry.date}.json`), JSON.stringify(entry, null, 2), 'utf-8')
    }
  }

  it('新进程（缓存为空）也能搜到磁盘上的日记', async () => {
    await seed([
      makeEntry({ date: '2026-11-01', content: '部署了安装包并写了 provenance 说明' }),
      makeEntry({ date: '2026-11-05', content: '今天只是普通的一天' }),
    ])
    const manager = new DailyJournalManager(dir)
    const results = await manager.search(['provenance'])
    expect(results).toHaveLength(1)
    expect(results[0].date).toBe('2026-11-01')
  })

  it('startDate / endDate 现在真的生效', async () => {
    await seed([
      makeEntry({ date: '2026-10-30', content: '关键词命中' }),
      makeEntry({ date: '2026-11-02', content: '关键词命中' }),
      makeEntry({ date: '2026-11-04', content: '关键词命中' }),
    ])
    const manager = new DailyJournalManager(dir)
    const results = await manager.search(['关键词'], { startDate: '2026-11-01', endDate: '2026-11-03' })
    expect(results.map((r) => r.date)).toEqual(['2026-11-02'])
  })

  it('tags 过滤生效（任一命中即保留），结果按日期倒序', async () => {
    await seed([
      makeEntry({ date: '2026-11-02', content: '开会被提了一嘴', tags: ['work'] }),
      makeEntry({ date: '2026-11-06', content: '开会被提了一嘴', tags: ['social'] }),
      makeEntry({ date: '2026-11-07', content: '没提到', tags: ['work'] }),
    ])
    const manager = new DailyJournalManager(dir)
    const results = await manager.search([], { tags: ['work'] })
    // 命中 work 的是 11-02 与 11-07（内容无关，只看标签）；social 那条被排除；倒序输出
    expect(results.map((r) => r.date)).toEqual(['2026-11-07', '2026-11-02'])
  })

  it('limit 生效，且空关键词等价于「全部命中」', async () => {
    await seed([
      makeEntry({ date: '2026-11-02', content: 'a' }),
      makeEntry({ date: '2026-11-03', content: 'b' }),
      makeEntry({ date: '2026-11-05', content: 'c' }),
    ])
    const manager = new DailyJournalManager(dir)
    expect(await manager.search([], { limit: 2 })).toHaveLength(2)
  })

  it('userNotes 也算正文，可被搜到', async () => {
    await seed([makeEntry({ date: '2026-11-03', content: '正文没写', userNotes: '补一句：明天交报告' })])
    const manager = new DailyJournalManager(dir)
    const results = await manager.search(['明天交报告'])
    expect(results).toHaveLength(1)
  })

  it('目录不存在时不抛出，返回空', async () => {
    const missing = join(dir, 'nope')
    const manager = new DailyJournalManager(missing)
    expect(await manager.search(['anything'])).toEqual([])
  })
})

describe('TD-005 · 保存/读取路径仍然自洽', () => {
  it('saveEntry 落盘后 getEntry 能读回，日期键一致', async () => {
    await mkdir(dir, { recursive: true })
    const manager = new DailyJournalManager(dir, undefined, { now: () => new Date(2026, 10, 8, 9, 0, 0) })
    const entry = makeEntry({ date: '2026-11-08' })
    await manager.saveEntry(entry)
    const loaded = await manager.getEntry('2026-11-08')
    expect(loaded?.content).toBe(entry.content)
  })
})
