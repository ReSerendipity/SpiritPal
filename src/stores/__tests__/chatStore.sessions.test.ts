import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMemoryTrace, ChatMessage, MessageMetrics } from '@/lib/data/types'
import { useChatStore } from '../chatStore'
import { usePetStore } from '../petStore'

// db.ts: sqliteStorage 是异步 settings blob 适配器；底层触发迁移、LRU 缓存、
// 跨窗口事件及退出加密。仅替换外部存储边界，保留真实 store / persist / JSON。
const disk = vi.hoisted(() => new Map<string, string>())
vi.mock('@/lib/data/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/db')>()),
  sqliteStorage: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      disk.set(key, value)
    },
    removeItem: async (key: string) => {
      disk.delete(key)
    },
  },
}))

const key = 'spiritpal-chat-store'
const store = () => useChatStore.getState()
const message = (id: string) =>
  Object.values(store().messagesBySession)
    .flat()
    .find((m) => m.id === id)
const trace: ChatMemoryTrace = {
  mode: 'enabled',
  sections: [{ id: 'facts', label: '已知事实', content: '喜欢猫', estimatedTokens: 3 }],
  capturedAt: 123,
}
const metrics = (overrides: Partial<MessageMetrics> = {}): MessageMetrics => ({
  requestStartTs: 100,
  responseEndTs: 200,
  durationMs: 100,
  promptTokens: 10,
  completionTokens: 4,
  ...overrides,
})

beforeEach(async () => {
  await Promise.resolve()
  store().stopGeneration()
  usePetStore.setState({ currentCharacterId: 'doro' })
  useChatStore.setState({
    sessions: {},
    messagesBySession: {},
    activeSessionByCharacter: {},
    isLoading: false,
    abortController: null,
    activeGenerationId: null,
  })
  disk.clear()
})

describe('message ID ownership', () => {
  it('flush 在切会话和角色后仍写原消息，不丢并存会话', async () => {
    const first = store().createSession()
    const id = store().sendMessage('first')
    store().appendAssistantChunk(id, 'buffered')
    const second = store().createSession()
    store().addMessage({ id: 'second-msg', role: 'user', content: 'second', timestamp: 1 })
    usePetStore.setState({ currentCharacterId: 'feibi' })
    const third = store().createSession()
    await Promise.resolve()
    expect(message(id)?.content).toBe('buffered')
    expect(store().messagesBySession[first]).toHaveLength(2)
    expect(store().messagesBySession[second][0].content).toBe('second')
    expect(store().messagesBySession[third]).toEqual([])
  })

  it.each(['content', 'think', 'flag', 'consistency', 'status', 'trace', 'metrics'] as const)(
    '%s 按 ID 写回原角色原会话',
    (operation) => {
      const first = store().createSession()
      const id = store().sendMessage('first')
      store().createSession()
      usePetStore.setState({ currentCharacterId: 'feibi' })
      store().createSession()
      switch (operation) {
        case 'content':
          store().updateMessageContent(id, 'changed')
          expect(message(id)?.content).toBe('changed')
          break
        case 'think':
          store().updateMessageThink(id, 'thinking')
          expect(message(id)?.thinkContent).toBe('thinking')
          break
        case 'flag':
          store().flagMessage(id, ['conflict'])
          expect(message(id)?.flagged).toBe(true)
          break
        case 'consistency':
          store().setMessageConsistency(id, ['conflict'])
          expect(message(id)?.consistencyViolations).toEqual(['conflict'])
          break
        case 'status':
          store().setMessageStatus(id, 'timeout')
          expect(message(id)?.sendStatus).toBe('timeout')
          break
        case 'trace':
          store().setMessageMemoryTrace(id, trace)
          expect(message(id)?.memoryTrace).toEqual(trace)
          break
        case 'metrics':
          store().setMessageMetrics(id, metrics())
          expect(message(id)?.metrics).toEqual(metrics())
          expect(store().sessions.doro.find((s) => s.id === first)?.totalPromptTokens).toBe(10)
          expect(store().sessions.feibi[0].requestCount).toBe(0)
          break
      }
      expect(store().getMessages()).toEqual([])
      expect(store().sessions.doro).toHaveLength(2)
    },
  )

  it('finish flush 各 ID 的真实归属，不能结束其它流式消息', () => {
    const first = store().createSession()
    store().addMessage({ id: 'a', role: 'assistant', content: '', timestamp: 1, isStreaming: true })
    const second = store().createSession()
    store().addMessage({ id: 'b', role: 'assistant', content: '', timestamp: 2, isStreaming: true })
    store().appendAssistantChunk('a', 'A')
    store().appendAssistantChunk('b', 'B')
    store().finishStreaming('a')
    expect(store().messagesBySession[first][0]).toMatchObject({ content: 'A', isStreaming: false })
    expect(store().messagesBySession[second][0]).toMatchObject({ content: 'B', isStreaming: true })
  })

  it('不能切入另一个角色的 session 或不存在的 session', () => {
    const own = store().createSession()
    usePetStore.setState({ currentCharacterId: 'feibi' })
    const foreign = store().createSession()
    usePetStore.setState({ currentCharacterId: 'doro' })
    store().switchSession(foreign)
    expect(store().activeSessionByCharacter.doro).toBe(own)
    store().switchSession('missing')
    expect(store().activeSessionByCharacter.doro).toBe(own)
  })
})

describe('generation lifecycle', () => {
  it('新 send 替换唯一请求时中断旧请求且保存其 buffer', () => {
    const oldId = store().sendMessage('old')
    const controller = new AbortController()
    store().setAbortController(controller, oldId)
    store().appendAssistantChunk(oldId, 'partial')
    const newId = store().sendMessage('new')
    expect(controller.signal.aborted).toBe(true)
    expect(message(oldId)).toMatchObject({ content: 'partial', isStreaming: false, sendStatus: 'aborted' })
    expect(store().activeGenerationId).toBe(newId)
    expect(message(newId)?.isStreaming).toBe(true)
  })

  it('删除正在生成的 session 释放所属请求，不依赖迟到 finish', () => {
    const session = store().createSession()
    const id = store().sendMessage('old')
    const controller = new AbortController()
    store().setAbortController(controller, id)
    store().deleteSession(session)
    expect(controller.signal.aborted).toBe(true)
    expect(store().isLoading).toBe(false)
    expect(store().activeGenerationId).toBeNull()
    expect(store().abortController).toBeNull()
  })

  it('不能通过当前角色删除另一角色的 session 消息', () => {
    const own = store().createSession()
    store().sendMessage('keep')
    usePetStore.setState({ currentCharacterId: 'feibi' })
    store().createSession()
    store().deleteSession(own)
    expect(store().messagesBySession[own][0].content).toBe('keep')
  })

  it('clearHistory 释放被清空会话的生成，不影响其它会话请求', () => {
    const original = store().createSession()
    const id = store().sendMessage('old')
    const controller = new AbortController()
    store().setAbortController(controller, id)
    store().createSession()
    store().clearHistory()
    expect(controller.signal.aborted).toBe(false)
    expect(store().activeGenerationId).toBe(id)
    store().switchSession(original)
    store().clearHistory()
    expect(controller.signal.aborted).toBe(true)
    expect(store().activeGenerationId).toBeNull()
    expect(store().getMessages()).toEqual([])
  })

  it('send 关联 activeGenerationId；old finish 不清理新请求控制器或 loading', () => {
    const oldId = store().sendMessage('old')
    const oldController = new AbortController()
    store().setAbortController(oldController, oldId)
    store().createSession()
    const newId = store().sendMessage('new')
    const controller = new AbortController()
    store().setAbortController(controller, newId)
    store().appendAssistantChunk(newId, 'new content')
    store().finishStreaming(oldId)
    expect(store().activeGenerationId).toBe(newId)
    expect(store().isLoading).toBe(true)
    expect(store().abortController).toBe(controller)
    expect(message(newId)?.isStreaming).toBe(true)
  })

  it('旧异步 setAbortController 不能覆盖新请求（兼容单参）', () => {
    const oldId = store().sendMessage('old')
    const newId = store().sendMessage('new')
    const controller = new AbortController()
    store().setAbortController(controller)
    store().setAbortController(new AbortController(), oldId)
    store().setAbortController(null, oldId)
    expect(store().abortController).toBe(controller)
    store().finishStreaming(newId)
    store().setAbortController(new AbortController(), newId)
    expect(store().abortController).toBeNull()
  })

  it('stop 保留未执行微任务的 buffer，切角色后仍标原消息 aborted', async () => {
    const id = store().sendMessage('hello')
    const controller = new AbortController()
    store().setAbortController(controller, id)
    store().appendAssistantChunk(id, 'one')
    store().appendAssistantChunk(id, 'two')
    store().createSession()
    usePetStore.setState({ currentCharacterId: 'feibi' })
    store().stopGeneration()
    expect(controller.signal.aborted).toBe(true)
    expect(message(id)).toMatchObject({ content: 'onetwo', isStreaming: false, sendStatus: 'aborted' })
    expect(store().activeGenerationId).toBeNull()
    await Promise.resolve()
    expect(message(id)?.content).toBe('onetwo')
  })

  it('startGeneration 清旧内容、思考、状态和指标，重试汇总不重复', () => {
    const id = store().sendMessage('hello')
    store().updateMessageContent(id, 'old')
    store().updateMessageThink(id, 'old thought')
    store().setMessageMetrics(id, metrics())
    store().setMessageStatus(id, 'failed')
    store().finishStreaming(id)
    store().startGeneration(id)
    expect(message(id)).toMatchObject({ content: '', isStreaming: true })
    expect(message(id)?.thinkContent).toBeUndefined()
    expect(message(id)?.sendStatus).toBeUndefined()
    expect(message(id)?.metrics).toBeUndefined()
    expect(store().activeGenerationId).toBe(id)
    expect(store().isLoading).toBe(true)
    expect(store().sessions.doro[0]).toMatchObject({ totalPromptTokens: 0, totalCompletionTokens: 0, requestCount: 0 })
    store().setMessageMetrics(id, metrics({ promptTokens: 7 }))
    expect(store().sessions.doro[0]).toMatchObject({ totalPromptTokens: 7, requestCount: 1 })
  })

  it('已删除 session 的所有迟到回调不复活、不污染新 session', async () => {
    const removed = store().createSession()
    const id = store().sendMessage('deleted')
    store().appendAssistantChunk(id, 'queued')
    store().deleteSession(removed)
    const next = store().sendMessage('new')
    store().appendAssistantChunk(id, 'late')
    store().updateMessageContent(id, 'late')
    store().updateMessageThink(id, 'late')
    store().setMessageStatus(id, 'failed')
    store().setMessageConsistency(id, ['late'])
    store().flagMessage(id, ['late'])
    store().setMessageMemoryTrace(id, trace)
    store().setMessageMetrics(id, metrics())
    store().startGeneration(id)
    store().finishStreaming(id)
    await Promise.resolve()
    expect(store().messagesBySession[removed]).toBeUndefined()
    expect(store().sessions.doro.some((s) => s.id === removed)).toBe(false)
    expect(store().sessions.doro[0].requestCount).toBe(0)
    expect(store().activeGenerationId).toBe(next)
    expect(store().getMessages()).toHaveLength(2)
  })
})

describe('metrics accounting', () => {
  it('progress 与 final 多次回写只计差额，每 assistant 一次 requestCount', () => {
    const id = store().sendMessage('one')
    store().setMessageMetrics(id, metrics())
    store().setMessageMetrics(id, metrics())
    store().setMessageMetrics(id, metrics({ promptTokens: 8, completionTokens: 9 }))
    const next = store().sendMessage('two')
    store().setMessageMetrics(next, metrics({ promptTokens: 2, completionTokens: 1 }))
    expect(store().sessions.doro[0]).toMatchObject({
      totalPromptTokens: 10,
      totalCompletionTokens: 10,
      requestCount: 2,
    })
  })

  it('未知 usage 保留 undefined，仅已知值进入 aggregate', () => {
    const id = store().sendMessage('unknown')
    store().setMessageMetrics(
      id,
      metrics({ promptTokens: undefined, completionTokens: undefined, usageSource: 'unavailable' }),
    )
    expect(message(id)?.metrics?.promptTokens).toBeUndefined()
    expect(message(id)?.metrics?.completionTokens).toBeUndefined()
    expect(store().sessions.doro[0]).toMatchObject({ totalPromptTokens: 0, totalCompletionTokens: 0, requestCount: 1 })
    store().setMessageMetrics(id, metrics({ promptTokens: undefined }))
    expect(store().sessions.doro[0]).toMatchObject({ totalPromptTokens: 0, totalCompletionTokens: 4, requestCount: 1 })
  })

  it('不存在的消息不能增加会话统计', () => {
    store().sendMessage('hello')
    store().setMessageMetrics('missing', metrics())
    expect(store().sessions.doro[0]).toMatchObject({ totalPromptTokens: 0, requestCount: 0 })
  })
})

describe('fork session', () => {
  it('复制目标之前的前缀，全部新 ID，旧 session 完整保留并继承 temporary', () => {
    const original = store().createSession({ temporary: true })
    const a = store().sendMessage('first')
    store().updateMessageContent(a, 'answer')
    store().setMessageMemoryTrace(a, trace)
    store().setMessageMetrics(a, metrics())
    store().finishStreaming(a)
    const b = store().sendMessage('edit me')
    store().finishStreaming(b)
    const before = structuredClone(store().messagesBySession[original])
    const oldSession = structuredClone(store().sessions.doro[0])
    const fork = store().forkSessionAtMessage(before[2].id)
    expect(fork).toBeTruthy()
    expect(fork).not.toBe(original)
    expect(store().activeSessionByCharacter.doro).toBe(fork)
    const copied = store().getMessages()
    expect(copied.map((m) => m.content)).toEqual(['first', 'answer'])
    expect(copied.every((m) => !before.some((old) => old.id === m.id))).toBe(true)
    expect(copied.every((m) => m.isStreaming === false)).toBe(true)
    expect(copied[1].memoryTrace).toEqual(trace)
    expect(store().sessions.doro.find((s) => s.id === fork)).toMatchObject({
      temporary: true,
      messageCount: 2,
      requestCount: 1,
      totalPromptTokens: 10,
    })
    store().updateMessageContent(copied[1].id, 'fork only')
    expect(store().messagesBySession[original]).toEqual(before)
    expect(store().sessions.doro.find((s) => s.id === original)).toEqual(oldSession)
  })

  it('首条消息之前 fork 产生空 session；新发送不修改旧会话', () => {
    const id = store().sendMessage('old')
    store().finishStreaming(id)
    const old = store().activeSessionByCharacter.doro
    const user = store().getMessages()[0].id
    expect(store().forkSessionAtMessage(user)).toBeTruthy()
    expect(store().getMessages()).toEqual([])
    store().sendMessage('edited')
    expect(store().getMessages()[0].content).toBe('edited')
    expect(store().messagesBySession[old][0].content).toBe('old')
  })

  it('生成中、跨角色或未知 ID 的 fork 返回 null 且不改 active', () => {
    const id = store().sendMessage('hello')
    const own = store().activeSessionByCharacter.doro
    expect(store().forkSessionAtMessage(id)).toBeNull()
    expect(store().activeSessionByCharacter.doro).toBe(own)
    store().finishStreaming(id)
    usePetStore.setState({ currentCharacterId: 'feibi' })
    const foreign = store().createSession()
    expect(store().forkSessionAtMessage(id)).toBeNull()
    expect(store().forkSessionAtMessage('missing')).toBeNull()
    expect(store().activeSessionByCharacter.feibi).toBe(foreign)
  })
})

describe('persistence boundary', () => {
  it('没有 persisted 数据时 hydrate 不取消内存中新开始的请求', async () => {
    const id = store().sendMessage('in memory')
    disk.delete(key)
    await useChatStore.persist.rehydrate()
    expect(store().isLoading).toBe(true)
    expect(store().activeGenerationId).toBe(id)
    expect(message(id)?.isStreaming).toBe(true)
  })

  it.each([false, true])(
    'temporary 的消息/title/active 不进 serialize 或 reload（常规会话=%s）',
    async (hasRegular) => {
      let regular: string | undefined
      if (hasRegular) {
        regular = store().createSession()
        const id = store().sendMessage('keep this')
        store().finishStreaming(id)
      }
      const temporary = store().createSession({ temporary: true })
      const id = store().sendMessage('private-title-and-message')
      store().setMessageMemoryTrace(id, { ...trace, mode: 'temporary' })
      const serialized = disk.get(key)!
      expect(serialized).not.toContain(temporary)
      expect(serialized).not.toContain('private-title-and-message')
      expect(serialized).not.toContain(id)
      expect(JSON.parse(serialized).state.activeSessionByCharacter.doro || undefined).toBe(regular)
      // 模拟进程重载：重新 import 真 store，通过原 persist storage 自动 hydrate。
      vi.resetModules()
      const { useChatStore: reloaded } = await import('../chatStore')
      await reloaded.persist.rehydrate()
      expect(reloaded.getState().messagesBySession[temporary]).toBeUndefined()
      expect(reloaded.getState().sessions.doro.some((s) => s.id === temporary)).toBe(false)
      if (regular) expect(reloaded.getState().messagesBySession[regular][0].content).toBe('keep this')
    },
  )

  it('跨会话 search 排除 temporary 消息', () => {
    const regular = store().createSession()
    const id = store().sendMessage('needle normal')
    store().finishStreaming(id)
    store().createSession({ temporary: true })
    store().sendMessage('needle private')
    const hits = store().searchMessages('needle')
    expect(hits).toHaveLength(1)
    expect(hits[0].sessionId).toBe(regular)
  })

  it('同版本历史 pending/isStreaming hydrate 成 aborted，完整保留历史', async () => {
    const session = store().createSession()
    const history: ChatMessage[] = [
      { id: 'streaming', role: 'assistant', content: 'partial', timestamp: 1, isStreaming: true },
      { id: 'pending', role: 'assistant', content: '', timestamp: 2, sendStatus: 'pending' },
      { id: 'done', role: 'assistant', content: 'saved', timestamp: 3 },
      { id: 'failed', role: 'assistant', content: '', timestamp: 4, sendStatus: 'failed' },
    ]
    disk.set(
      key,
      JSON.stringify({
        version: 2,
        state: {
          sessions: store().sessions,
          messagesBySession: { [session]: history },
          activeSessionByCharacter: { doro: session },
          isLoading: true,
          activeGenerationId: 'streaming',
        },
      }),
    )
    await useChatStore.persist.rehydrate()
    expect(store().getMessages()).toHaveLength(4)
    expect(message('streaming')).toMatchObject({ content: 'partial', isStreaming: false, sendStatus: 'aborted' })
    expect(message('pending')).toMatchObject({ content: '', isStreaming: false, sendStatus: 'aborted' })
    expect(message('done')).toEqual(history[2])
    expect(message('failed')?.sendStatus).toBe('failed')
    expect(store().isLoading).toBe(false)
    expect(store().activeGenerationId).toBeNull()
    expect(store().abortController).toBeNull()
  })
})
