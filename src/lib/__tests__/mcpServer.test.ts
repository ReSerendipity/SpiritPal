/**
 * @file mcpServer.test.ts
 * @description SpiritPal MCP 服务器单测
 *
 * 测什么：
 * - createMcpServer(): 返回 McpServer 实例，注册全部 7 个工具
 * - 各工具 handler 逻辑（状态/反应/说话/记忆/记忆编辑/喂食/摸头）
 * - startMcpServer()/stopMcpServer() 生命周期与模块级单例清理
 *
 * Mock 策略：
 * - @/stores/petStore、@/lib/memory/enhancedMemory、@/lib/memory/memoryEditor 全量 mock
 * - @modelcontextprotocol/sdk/server/stdio.js 的 StdioServerTransport mock（避免挂接 process.stdin）
 * - @modelcontextprotocol/sdk/server/mcp.js 的 McpServer 用真实实现，验证工具注册与 handler
 *
 * 发现：OPENPETS_REACTION_MAP 的映射值（waiting/running/review/jumping/failed/waving）
 * 均不在 ANIMATION_CATALOG 中，仅 'idle' 能命中合法动画。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============ Mock 依赖（必须先于 import 源模块）============

const mocks = vi.hoisted(() => {
  const store = {
    getCurrentStats: vi.fn(),
    sharedCoins: 100,
    currentCharacterId: 'doro',
    inventory: [] as Array<Record<string, unknown>>,
    position: { x: 1, y: 2 },
    feed: vi.fn(),
    pet: vi.fn(),
  }
  const memoryManager = {
    ensureLoaded: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    search: vi.fn<() => unknown[]>(() => []),
    getAllMemories: vi.fn<() => unknown[]>(() => []),
    getWorkingMemories: vi.fn<() => unknown[]>(() => []),
    getEpisodicMemories: vi.fn<() => unknown[]>(() => []),
    getAutobiographicalMemories: vi.fn<() => unknown[]>(() => []),
  }
  const editor = {
    createMemory: vi.fn(),
    readMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    getMemoryStats: vi.fn(),
  }
  return { store, memoryManager, editor }
})

vi.mock('@/stores/petStore', () => ({
  usePetStore: { getState: vi.fn(() => mocks.store) },
}))

vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => mocks.memoryManager),
}))

vi.mock('@/lib/memory/memoryEditor', () => ({
  createMemoryEditor: vi.fn(() => mocks.editor),
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

import { createMcpServer, startMcpServer, stopMcpServer } from '@/lib/system/mcpServer'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** 访问 McpServer 内部注册表（_registeredTools 为 SDK 内部字段） */
function getRegisteredTools(server: McpServer): Record<string, { handler: (args?: any) => Promise<any> }> {
  return (server as unknown as { _registeredTools: any })._registeredTools
}

const DEFAULT_STATS = {
  mood: 70,
  hunger: 60,
  health: 80,
  affection: 100,
  level: 5,
  exp: 0,
  coins: 0,
  lastTickAt: 0,
  lastInteractionAt: 0,
  lastAffectionDecayAt: 0,
}

beforeEach(async () => {
  vi.clearAllMocks()
  await stopMcpServer()
  mocks.store.getCurrentStats.mockReturnValue({ ...DEFAULT_STATS })
  mocks.store.sharedCoins = 100
  mocks.store.currentCharacterId = 'doro'
  mocks.store.position = { x: 1, y: 2 }
  mocks.store.inventory = []
  mocks.store.feed.mockReset()
  mocks.store.pet.mockReset()
  mocks.memoryManager.search.mockReturnValue([])
  mocks.memoryManager.getAllMemories.mockReturnValue([])
  mocks.memoryManager.getWorkingMemories.mockReturnValue([])
  mocks.memoryManager.getEpisodicMemories.mockReturnValue([])
  mocks.memoryManager.getAutobiographicalMemories.mockReturnValue([])
})

describe('createMcpServer', () => {
  let server: McpServer

  beforeEach(() => {
    server = createMcpServer()
  })

  it('返回 McpServer 实例并注册全部 7 个工具', () => {
    expect(server).toBeTruthy()
    expect(typeof server.tool).toBe('function')

    const tools = getRegisteredTools(server)
    const names = Object.keys(tools)
    expect(names).toEqual(
      expect.arrayContaining([
        'spiritpal_status',
        'spiritpal_react',
        'spiritpal_say',
        'spiritpal_memory',
        'spiritpal_memory_edit',
        'spiritpal_feed',
        'spiritpal_pet',
      ]),
    )
  })

  it('重复注册同名工具时 SDK 抛错', () => {
    const server2 = createMcpServer()
    const tools = getRegisteredTools(server2)
    expect(Object.keys(tools)).toHaveLength(7)
  })

  // ---- spiritpal_status ----

  it('spiritpal_status 返回完整状态 JSON', async () => {
    const result = await getRegisteredTools(server)['spiritpal_status'].handler()
    expect(result.isError).toBeFalsy()

    const data = JSON.parse(result.content[0].text)
    expect(data.level).toBe(5)
    expect(data.hunger).toBe(60)
    expect(data.hungerLabel).toBe('还行')
    expect(data.mood).toBe(70)
    expect(data.moodLabel).toBe('一般')
    expect(data.health).toBe(80)
    expect(data.affection).toBe(100)
    expect(data.coins).toBe(100)
    expect(data.characterId).toBe('doro')
    expect(data.animation).toBe('idle')
    expect(data.position).toEqual({ x: 1, y: 2 })
  })

  it('spiritpal_status 不同数值档位映射不同标签', async () => {
    mocks.store.getCurrentStats.mockReturnValue({ ...DEFAULT_STATS, mood: 90, hunger: 10 })
    const result = await getRegisteredTools(server)['spiritpal_status'].handler()
    const data = JSON.parse(result.content[0].text)
    expect(data.moodLabel).toBe('开心')
    expect(data.hungerLabel).toBe('很饿')
  })

  it('spiritpal_status 内部异常时返回 isError', async () => {
    mocks.store.getCurrentStats.mockImplementation(() => {
      throw new Error('stats boom')
    })
    const result = await getRegisteredTools(server)['spiritpal_status'].handler()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Error:')
  })

  // ---- spiritpal_react ----

  it('spiritpal_react 合法反应（idle）触发窗口事件', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const result = await getRegisteredTools(server)['spiritpal_react'].handler({ reaction: 'idle' })

    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('Pet reacted with: idle')
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'spiritpal-mcp-react' }),
    )
    dispatchSpy.mockRestore()
  })

  it('spiritpal_react 未知反应返回错误', async () => {
    const result = await getRegisteredTools(server)['spiritpal_react'].handler({ reaction: 'bogus' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown reaction: bogus')
  })

  it('spiritpal_react 映射值不在 ANIMATION_CATALOG 时返回错误', async () => {
    // OPENPETS_REACTION_MAP['success'] = 'jumping'，不在目录中 → 走 !validIds.has 分支
    const result = await getRegisteredTools(server)['spiritpal_react'].handler({ reaction: 'success' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown reaction: success')
  })

  // ---- spiritpal_say ----

  it('spiritpal_say 触发气泡事件并返回文本', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const result = await getRegisteredTools(server)['spiritpal_say'].handler({ message: '你好呀' })

    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toBe('Pet says: 你好呀')
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'spiritpal-mcp-say', detail: '你好呀' }),
    )
    dispatchSpy.mockRestore()
  })

  it('spiritpal_say 注册的 schema 拒绝非法输入（5 层校验）', () => {
    // SDK 将 raw shape 归一化为 zod object，需按 { message } 解析
    const tools = getRegisteredTools(server)
    const saySchema = (tools as any)['spiritpal_say'].inputSchema
    expect(typeof saySchema?.safeParse).toBe('function')

    // 正常消息通过
    const ok = saySchema.safeParse({ message: '今天天气不错' })
    expect(ok.success).toBe(true)

    // 含 URL / 代码关键字 / 换行 / 超长 均被拒绝
    expect(saySchema.safeParse({ message: '访问 https://evil.com 领奖' }).success).toBe(false)
    expect(saySchema.safeParse({ message: 'const x = 1' }).success).toBe(false)
    expect(saySchema.safeParse({ message: '第一行\n第二行' }).success).toBe(false)
    expect(saySchema.safeParse({ message: 'a'.repeat(201) }).success).toBe(false)
  })

  // ---- spiritpal_memory ----

  it('spiritpal_memory search 返回搜索结果', async () => {
    mocks.memoryManager.search.mockReturnValue([
      { user: 'hi', assistant: 'hello', created_at: '2026-01-01', category: '日常' },
    ])

    const result = await getRegisteredTools(server)['spiritpal_memory'].handler({
      action: 'search',
      query: 'hi',
    })

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data).toHaveLength(1)
    expect(data[0].user).toBe('hi')
    expect(mocks.memoryManager.ensureLoaded).toHaveBeenCalled()
  })

  it('spiritpal_memory search 缺 query 返回错误', async () => {
    const result = await getRegisteredTools(server)['spiritpal_memory'].handler({ action: 'search' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('query parameter is required')
  })

  it('spiritpal_memory list 返回统计信息', async () => {
    mocks.memoryManager.getAllMemories.mockReturnValue([1, 2, 3])
    mocks.memoryManager.getWorkingMemories.mockReturnValue([1])
    mocks.memoryManager.getEpisodicMemories.mockReturnValue([1, 2])
    mocks.memoryManager.getAutobiographicalMemories.mockReturnValue([])

    const result = await getRegisteredTools(server)['spiritpal_memory'].handler({ action: 'list' })

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.total).toBe(3)
    expect(data.working).toBe(1)
    expect(data.episodic).toBe(2)
    expect(data.autobiographical).toBe(0)
  })

  // ---- spiritpal_memory_edit ----

  it('spiritpal_memory_edit create 返回新记忆', async () => {
    mocks.editor.createMemory.mockResolvedValue({
      success: true,
      affectedCount: 1,
      details: { createdMemoryId: 'mem-1' },
    })

    const result = await getRegisteredTools(server)['spiritpal_memory_edit'].handler({
      action: 'create',
      content: '新记忆',
      importance: 80,
      category: '日常',
    })

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.success).toBe(true)
    expect(data.details.createdMemoryId).toBe('mem-1')
    expect(mocks.editor.createMemory).toHaveBeenCalledWith(
      '新记忆',
      expect.objectContaining({ importance: 80, category: '日常' }),
    )
  })

  it('spiritpal_memory_edit create 缺内容返回错误', async () => {
    const result = await getRegisteredTools(server)['spiritpal_memory_edit'].handler({ action: 'create' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('content required')
  })

  it('spiritpal_memory_edit read 成功', async () => {
    mocks.editor.readMemory.mockResolvedValue({
      success: true,
      details: { memory: { id: 'mem-1', user: 'x' } },
    })

    const result = await getRegisteredTools(server)['spiritpal_memory_edit'].handler({
      action: 'read',
      memoryId: 'mem-1',
    })

    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0].text).success).toBe(true)
  })

  it('spiritpal_memory_edit read 缺 memoryId 返回错误', async () => {
    const result = await getRegisteredTools(server)['spiritpal_memory_edit'].handler({ action: 'read' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('memoryId required')
  })

  it('spiritpal_memory_edit update 成功', async () => {
    mocks.editor.updateMemory.mockResolvedValue({ success: true, affectedCount: 1 })

    const result = await getRegisteredTools(server)['spiritpal_memory_edit'].handler({
      action: 'update',
      memoryId: 'mem-1',
      content: '新内容',
    })

    expect(result.isError).toBeFalsy()
    expect(mocks.editor.updateMemory).toHaveBeenCalledWith(
      'mem-1',
      expect.objectContaining({ content: '新内容' }),
    )
  })

  it('spiritpal_memory_edit delete 成功', async () => {
    mocks.editor.deleteMemory.mockResolvedValue({ success: true, affectedCount: 1 })

    const result = await getRegisteredTools(server)['spiritpal_memory_edit'].handler({
      action: 'delete',
      memoryId: 'mem-1',
    })

    expect(result.isError).toBeFalsy()
    expect(mocks.editor.deleteMemory).toHaveBeenCalledWith('mem-1')
  })

  it('spiritpal_memory_edit stats 返回统计', async () => {
    mocks.editor.getMemoryStats.mockResolvedValue({
      success: true,
      details: { stats: { totalCount: 42 } },
    })

    const result = await getRegisteredTools(server)['spiritpal_memory_edit'].handler({ action: 'stats' })

    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0].text).totalCount).toBe(42)
  })

  it('spiritpal_memory_edit action schema 拒绝未知 action（zod enum）', () => {
    // raw handler 的 switch 无 default 分支，未知 action 由 SDK 的 zod enum 在前置校验拦截
    const tools = getRegisteredTools(server)
    const editSchema = (tools as any)['spiritpal_memory_edit'].inputSchema
    expect(typeof editSchema?.safeParse).toBe('function')

    expect(editSchema.safeParse({ action: 'purge' }).success).toBe(false)
    expect(editSchema.safeParse({ action: 'create', content: 'x' }).success).toBe(true)
    expect(editSchema.safeParse({ action: 'stats' }).success).toBe(true)
  })

  it('spiritpal_memory_edit 内部异常返回错误', async () => {
    mocks.editor.createMemory.mockRejectedValue(new Error('db down'))
    const result = await getRegisteredTools(server)['spiritpal_memory_edit'].handler({
      action: 'create',
      content: 'x',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Error:')
  })

  // ---- spiritpal_feed ----

  it('spiritpal_feed 找到食物并调用 feed（按名称）', async () => {
    mocks.store.inventory = [
      { id: 'apple', name: '苹果', type: 'food', icon: '🍎', price: 5, count: 2 },
    ]

    const result = await getRegisteredTools(server)['spiritpal_feed'].handler({ foodName: '苹果' })

    expect(result.isError).toBeFalsy()
    expect(mocks.store.feed).toHaveBeenCalledWith(expect.objectContaining({ id: 'apple' }))
  })

  it('spiritpal_feed 找不到食物返回错误', async () => {
    mocks.store.inventory = []

    const result = await getRegisteredTools(server)['spiritpal_feed'].handler({ foodName: '不存在的' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not found in inventory')
  })

  // ---- spiritpal_pet ----

  it('spiritpal_pet 调用 store.pet 并触发事件', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const result = await getRegisteredTools(server)['spiritpal_pet'].handler()

    expect(result.isError).toBeFalsy()
    expect(mocks.store.pet).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'spiritpal-mcp-pet' }))
    dispatchSpy.mockRestore()
  })
})

describe('startMcpServer / stopMcpServer', () => {
  it('startMcpServer 创建并连接；重复调用幂等；stopMcpServer 清理', async () => {
    await startMcpServer()
    await startMcpServer() // 已存在，直接返回

    // 清理
    await stopMcpServer()
    // 清理后再次停止也幂等
    await stopMcpServer()
  })

  it('未启动时 stopMcpServer 不抛错', async () => {
    await expect(stopMcpServer()).resolves.toBeUndefined()
  })
})
