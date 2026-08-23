import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeMcpTool } from '../mcpBridge'
import { usePetStore } from '../../stores/petStore'

vi.mock('../enhancedMemory', () => ({
  getEnhancedMemoryManager: () => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    search: vi.fn(() => []),
    getAllMemories: vi.fn(() => []),
    getWorkingMemories: () => [],
    getEpisodicMemories: () => [],
    getAutobiographicalMemories: () => [],
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
})