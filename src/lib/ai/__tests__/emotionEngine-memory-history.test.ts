// TD-014：情绪引擎从情景记忆批量提取情绪时间线（2026-11-06）
import { beforeEach, describe, expect, it, vi } from 'vitest'

const episodicMemories: Array<{ id: string; user: string; assistant: string; created_at: string }> = []
const ensureLoaded = vi.fn(async () => undefined)

vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: () => ({
    ensureLoaded,
    getEpisodicMemories: () => [...episodicMemories],
  }),
}))

import { EmotionAnalyzer } from '@/lib/ai/emotionEngine'

function seed(): void {
  episodicMemories.length = 0
  episodicMemories.push(
    {
      id: 'm1',
      user: '今天好开心，终于把项目上线了！',
      assistant: '恭喜你！',
      created_at: '2026-11-01T02:30:00.000Z',
    },
    {
      id: 'm2',
      user: '好累，什么都不想做',
      assistant: '那就先休息一下',
      created_at: '2026-11-03T10:00:00.000Z',
    },
    // 空用户消息（不该进情绪线）
    { id: 'm3', user: '   ', assistant: '嗯', created_at: '2026-11-04T10:00:00.000Z' }
  )
}

describe('EmotionAnalyzer.analyzeMemoryHistory（TD-014）', () => {
  beforeEach(() => {
    seed()
    ensureLoaded.mockClear()
  })

  it('没有角色上下文时返回空（不跨角色串数据）', async () => {
    const analyzer = new EmotionAnalyzer()
    const result = await analyzer.analyzeMemoryHistory()
    expect(result).toEqual([])
    expect(ensureLoaded).not.toHaveBeenCalled()
  })

  it('按情景记忆逐条产出情绪点，时间戳取自记忆 created_at 而非当前时间', async () => {
    const analyzer = new EmotionAnalyzer()
    const result = await analyzer.analyzeMemoryHistory({ characterId: 'char-1' })

    // 空用户消息被过滤，只应剩 2 条
    expect(result).toHaveLength(2)
    expect(ensureLoaded).toHaveBeenCalledTimes(1)

    expect(result[0].relatedMemoryIds).toEqual(['m1'])
    expect(result[0].trigger).toMatchObject({ type: 'system_event', source: 'memory_history', context: 'm1' })
    expect(result[0].timestamp).toBe(Date.parse('2026-11-01T02:30:00.000Z'))
    expect(result[1].timestamp).toBe(Date.parse('2026-11-03T10:00:00.000Z'))

    // 情绪判定本身走既有 analyze()：开心 ≥ 不是 sad，抱怨累 ≠ happy
    expect(result[0].emotion).not.toBe('sad')
    expect(result[1].emotion).not.toBe('happy')
  })

  it('limit 只取最近 N 条', async () => {
    const analyzer = new EmotionAnalyzer()
    const result = await analyzer.analyzeMemoryHistory({ characterId: 'char-1', limit: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].relatedMemoryIds).toEqual(['m2'])
  })

  it('记忆栈不可用时降级为空，不抛错', async () => {
    const analyzer = new EmotionAnalyzer()
    ensureLoaded.mockRejectedValueOnce(new Error('db not ready'))
    const result = await analyzer.analyzeMemoryHistory({ characterId: 'char-1' })
    expect(result).toEqual([])
  })
})
