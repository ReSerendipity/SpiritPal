// chatStore 单元测试 — 消息发送、流式追加、中断、清空、标记、一致性更新
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatStore } from '../chatStore'
import { usePetStore } from '../petStore'

describe('chatStore', () => {
  beforeEach(() => {
    // 确保 petStore 有当前角色
    usePetStore.setState({ currentCharacterId: 'doro' })
    // 重置 chatStore
    useChatStore.setState({
      messagesByCharacter: {},
      isLoading: false,
      abortController: null,
    })
    localStorage.clear()
  })

  describe('sendMessage', () => {
    it('添加用户消息和 assistant 占位消息', () => {
      const assistantId = useChatStore.getState().sendMessage('你好')
      expect(assistantId).toBeTruthy()

      const messages = useChatStore.getState().getMessages()
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('你好')
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].content).toBe('')
      expect(messages[1].isStreaming).toBe(true)
    })

    it('设置 isLoading 为 true', () => {
      useChatStore.getState().sendMessage('test')
      expect(useChatStore.getState().isLoading).toBe(true)
    })

    it('多次发送消息追加到列表末尾', () => {
      useChatStore.getState().sendMessage('消息1')
      useChatStore.getState().sendMessage('消息2')
      const messages = useChatStore.getState().getMessages()
      expect(messages).toHaveLength(4)
      expect(messages[0].content).toBe('消息1')
      expect(messages[2].content).toBe('消息2')
    })
  })

  describe('appendAssistantChunk', () => {
    it('向流式消息追加内容', async () => {
      const assistantId = useChatStore.getState().sendMessage('hi')
      useChatStore.getState().appendAssistantChunk(assistantId, 'Hello')
      useChatStore.getState().appendAssistantChunk(assistantId, ' World')

      // [REFACTOR] R3 - appendAssistantChunk 使用微任务批处理，需要 await 微任务执行
      await Promise.resolve()

      const messages = useChatStore.getState().getMessages()
      const assistantMsg = messages.find((m) => m.id === assistantId)
      expect(assistantMsg?.content).toBe('Hello World')
    })

    it('不存在的 messageId 不影响其他消息', () => {
      useChatStore.getState().sendMessage('test')
      useChatStore.getState().appendAssistantChunk('nonexistent', 'content')
      const messages = useChatStore.getState().getMessages()
      expect(messages).toHaveLength(2)
      expect(messages[1].content).toBe('')
    })
  })

  describe('finishStreaming', () => {
    it('标记消息为非流式并清除 loading 状态', () => {
      const assistantId = useChatStore.getState().sendMessage('test')
      useChatStore.getState().appendAssistantChunk(assistantId, 'response')

      useChatStore.getState().finishStreaming(assistantId)

      const messages = useChatStore.getState().getMessages()
      const msg = messages.find((m) => m.id === assistantId)
      expect(msg?.isStreaming).toBe(false)
      expect(useChatStore.getState().isLoading).toBe(false)
      expect(useChatStore.getState().abortController).toBeNull()
    })
  })

  describe('stopGeneration', () => {
    it('中止 AbortController 并标记所有流式消息为完成', () => {
      const abort = vi.fn()
      useChatStore.setState({
        isLoading: true,
        abortController: { abort } as unknown as AbortController,
      })
      useChatStore.getState().sendMessage('test')
      // sendMessage 会覆盖 isLoading，手动恢复
      useChatStore.setState({ isLoading: true, abortController: { abort } as unknown as AbortController })

      useChatStore.getState().stopGeneration()

      expect(abort).toHaveBeenCalled()
      expect(useChatStore.getState().isLoading).toBe(false)
      expect(useChatStore.getState().abortController).toBeNull()

      const messages = useChatStore.getState().getMessages()
      const streaming = messages.filter((m) => m.isStreaming)
      expect(streaming).toHaveLength(0)
    })
  })

  describe('clearHistory', () => {
    it('清空当前角色的消息列表', () => {
      useChatStore.getState().sendMessage('msg1')
      useChatStore.getState().sendMessage('msg2')
      expect(useChatStore.getState().getMessages()).toHaveLength(4)

      useChatStore.getState().clearHistory()
      expect(useChatStore.getState().getMessages()).toHaveLength(0)
    })
  })

  describe('addMessage', () => {
    it('直接添加一条消息', () => {
      useChatStore.getState().addMessage({
        id: 'custom-1',
        role: 'assistant',
        content: 'direct message',
        timestamp: Date.now(),
      })
      const messages = useChatStore.getState().getMessages()
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe('custom-1')
      expect(messages[0].content).toBe('direct message')
    })
  })

  describe('flagMessage', () => {
    it('标记消息为不符性格并记录违规列表', () => {
      const assistantId = useChatStore.getState().sendMessage('test')
      useChatStore.getState().finishStreaming(assistantId)

      useChatStore.getState().flagMessage(assistantId, ['违规1', '违规2'])

      const msg = useChatStore.getState().getMessages().find((m) => m.id === assistantId)
      expect(msg?.flagged).toBe(true)
      expect(msg?.consistencyViolations).toEqual(['违规1', '违规2'])
    })
  })

  describe('updateMessageContent', () => {
    it('更新指定消息的内容', () => {
      const assistantId = useChatStore.getState().sendMessage('test')
      useChatStore.getState().updateMessageContent(assistantId, '新内容')
      const msg = useChatStore.getState().getMessages().find((m) => m.id === assistantId)
      expect(msg?.content).toBe('新内容')
    })
  })

  describe('setMessageConsistency', () => {
    it('有违规时保持 flagged 状态', () => {
      const assistantId = useChatStore.getState().sendMessage('test')
      useChatStore.getState().setMessageConsistency(assistantId, ['冲突'])
      const msg = useChatStore.getState().getMessages().find((m) => m.id === assistantId)
      expect(msg?.consistencyViolations).toEqual(['冲突'])
    })

    it('无违规时取消 flagged 状态', () => {
      const assistantId = useChatStore.getState().sendMessage('test')
      // 先标记
      useChatStore.getState().flagMessage(assistantId, ['old'])
      // 重新校验，无违规
      useChatStore.getState().setMessageConsistency(assistantId, [])
      const msg = useChatStore.getState().getMessages().find((m) => m.id === assistantId)
      expect(msg?.consistencyViolations).toEqual([])
      expect(msg?.flagged).toBe(false)
    })
  })

  describe('多角色隔离', () => {
    it('不同角色的消息列表独立', () => {
      // doro 发消息
      usePetStore.setState({ currentCharacterId: 'doro' })
      useChatStore.getState().sendMessage('doro msg')

      // 切换到 feibi
      usePetStore.setState({ currentCharacterId: 'feibi' })
      useChatStore.getState().sendMessage('feibi msg')

      // 切回 doro
      usePetStore.setState({ currentCharacterId: 'doro' })
      const doroMessages = useChatStore.getState().getMessages()
      expect(doroMessages).toHaveLength(2)
      expect(doroMessages[0].content).toBe('doro msg')

      // 切到 feibi
      usePetStore.setState({ currentCharacterId: 'feibi' })
      const feibiMessages = useChatStore.getState().getMessages()
      expect(feibiMessages).toHaveLength(2)
      expect(feibiMessages[0].content).toBe('feibi msg')
    })
  })
})
