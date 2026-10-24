import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareChatMemory } from '@/lib/memory/chatMemoryContext'

const fixtures = vi.hoisted(() => ({
  owner: vi.fn(async () => '主人画像：喜欢茶'),
  memory: vi.fn(async () => '历史记忆：周末阅读'),
  experiences: vi.fn(async () => ''),
  commitments: vi.fn(async () => ''),
  visual: vi.fn(async () => ''),
  readCalls: [] as string[],
}))
vi.mock('@/lib/memory/ownerFacts', () => ({
  getOwnerFactsManager: (id: string) => {
    fixtures.readCalls.push(`owner:${id}`)
    return { ensureLoaded: async () => {}, buildContext: fixtures.owner }
  },
}))
vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: (id: string) => {
    fixtures.readCalls.push(`memory:${id}`)
    return { ensureLoaded: async () => {}, getContextForChat: fixtures.memory }
  },
}))
vi.mock('@/lib/nurture/petExperience', () => ({
  getPetExperienceManager: () => ({ ensureLoaded: async () => {}, buildContext: fixtures.experiences }),
}))
vi.mock('@/lib/nurture/commitmentTracker', () => ({
  getCommitmentTracker: () => ({ buildContext: fixtures.commitments }),
}))
vi.mock('@/lib/memory/visualMemoryManager', () => ({
  getVisualMemoryManager: () => ({ ensureLoaded: async () => {}, buildContext: fixtures.visual }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  fixtures.readCalls.length = 0
  fixtures.owner.mockResolvedValue('主人画像：喜欢茶')
  fixtures.memory.mockResolvedValue('历史记忆：周末阅读')
})
const options = {
  characterId: 'test-character',
  query: '你好',
  enabled: true,
  temporary: false,
  contextBudget: 1000,
  totalBudget: 1500,
}

describe('actual chat memory context', () => {
  it.each([
    { enabled: false, temporary: false, mode: 'disabled' },
    { enabled: true, temporary: true, mode: 'temporary' },
  ])('does not read memory in $mode mode', async ({ enabled, temporary, mode }) => {
    const result = await prepareChatMemory({ ...options, enabled, temporary })
    expect(result.messages).toEqual([])
    expect(result.trace.sections).toEqual([])
    expect(result.trace.mode).toBe(mode)
    expect(fixtures.readCalls).toEqual([])
    expect(fixtures.commitments).not.toHaveBeenCalled()
    expect(fixtures.experiences).not.toHaveBeenCalled()
    expect(fixtures.visual).not.toHaveBeenCalled()
  })
  it('records exactly the selected prompt sections with character-scoped loading', async () => {
    const result = await prepareChatMemory(options)
    expect(result.messages.map((m) => m.content)).toEqual(
      expect.arrayContaining(['主人画像：喜欢茶', '历史记忆：周末阅读']),
    )
    expect(result.trace.sections.map((s) => s.content)).toEqual(result.messages.map((m) => m.content))
    expect(result.trace.sections.map((s) => s.id)).toEqual(result.messages.map((m) => m.id))
    expect(fixtures.readCalls).toEqual(['owner:test-character', 'memory:test-character'])
    expect(fixtures.memory).toHaveBeenCalledWith(1000, '你好')
  })
  it('does not call a budget-rejected candidate an injected memory', async () => {
    fixtures.memory.mockResolvedValue('长'.repeat(1000))
    const result = await prepareChatMemory({ ...options, totalBudget: 50 })
    expect(result.trace.sections.some((s) => s.content.includes('长'))).toBe(false)
    expect(result.messages.map((m) => m.content)).toEqual(['主人画像：喜欢茶'])
  })
  it('isolates memory failure without blocking available context', async () => {
    fixtures.owner.mockRejectedValue(new Error('private backend detail'))
    const result = await prepareChatMemory(options)
    expect(result.messages.map((m) => m.content)).toContain('历史记忆：周末阅读')
    expect(result.trace.error).toContain('主人画像')
    expect(result.trace.error).not.toContain('private backend detail')
  })
})
