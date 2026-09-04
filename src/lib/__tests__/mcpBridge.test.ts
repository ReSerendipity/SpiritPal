import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeMcpTool } from '@/lib/system/mcpBridge'
import { setToolAllowed } from '@/lib/system/mcpPermissions'
import { usePetStore } from '@/stores/petStore'

vi.mock('@/lib/data/db', () => ({
  updateMemoryRow: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: () => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    search: vi.fn(() => []),
    getAllMemories: vi.fn(() => []),
    getWorkingMemories: () => [],
    getEpisodicMemories: () => [],
    getAutobiographicalMemories: () => [],
    addExchange: vi.fn(() => ({
      id: 'mem-test-1',
      user: '测试记忆',
      assistant: '',
      created_at: new Date().toISOString(),
      importance: 50,
      emotionalIntensity: 0,
      category: '日常',
      tags: [],
      accessCount: 0,
      lastAccessed: Date.now(),
      decayFactor: 1,
    })),
    deleteMemory: vi.fn(),
  }),
}))

function seedStore() {
  usePetStore.setState({
    currentCharacterId: 'doro',
    sharedCoins: 100,
    position: { x: 10, y: 20 },
    inventory: [{ id: 'apple', type: 'food', name: '苹果', icon: '🍎', price: 5, count: 2 }],
    stats: {
      doro: {
        level: 3,
        hunger: 60,
        mood: 80,
        health: 90,
        affection: 120,
        exp: 0,
        coins: 0,
        lastTickAt: Date.now(),
        lastInteractionAt: Date.now(),
        lastAffectionDecayAt: Date.now(),
      },
    },
  })
}

beforeEach(() => {
  seedStore()
})

describe('executeMcpTool', () => {
  it('spiritpal_status 返回真实宠物状态', async () => {
    const res = await executeMcpTool('spiritpal_status')
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.coins).toBe(100)
    expect(data.characterId).toBe('doro')
    expect(data.level).toBe(3)
  })

  it('未知工具返回错误', async () => {
    const res = await executeMcpTool('nope')
    expect(res.isError).toBe(true)
  })

  it('spiritpal_say 超长信息被校验拒绝', async () => {
    const res = await executeMcpTool('spiritpal_say', { message: 'a'.repeat(300) })
    expect(res.isError).toBe(true)
  })

  it('spiritpal_react 未知反应返回错误', async () => {
    const res = await executeMcpTool('spiritpal_react', { reaction: 'not_a_reaction' })
    expect(res.isError).toBe(true)
  })

  it('spiritpal_feed 找不到食物返回错误', async () => {
    const res = await executeMcpTool('spiritpal_feed', { foodName: '不存在的食物' })
    expect(res.isError).toBe(true)
  })

  it('spiritpal_memory 返回统计（list）', async () => {
    const res = await executeMcpTool('spiritpal_memory', { action: 'list' })
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(typeof data.total).toBe('number')
  })

  it('spiritpal_memory_edit create 返回新记忆 ID', async () => {
    const res = await executeMcpTool('spiritpal_memory_edit', {
      action: 'create',
      content: '主人喜欢吃火锅',
      importance: 80,
    })
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.success).toBe(true)
    expect(data.details.createdMemoryId).toBe('mem-test-1')
  })

  it('spiritpal_memory_edit create 缺内容返回错误', async () => {
    const res = await executeMcpTool('spiritpal_memory_edit', { action: 'create', content: '' })
    expect(res.isError).toBe(true)
  })

  it('spiritpal_memory_edit 未知 action 返回错误', async () => {
    const res = await executeMcpTool('spiritpal_memory_edit', { action: 'purge' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Supported: create, read, update, delete, stats')
  })

  it('被禁用的工具返回 PERMISSION_DENIED', async () => {
    setToolAllowed('spiritpal_pet', false)
    try {
      const res = await executeMcpTool('spiritpal_pet')
      expect(res.isError).toBe(true)
      expect(res.content[0].text).toContain('PERMISSION_DENIED')
    } finally {
      setToolAllowed('spiritpal_pet', true)
    }
  })
})