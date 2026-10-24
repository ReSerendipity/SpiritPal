/**
 * @file chatStore.outputGuard.test.ts
 * @description LLM 维度 P1「输出内容护栏」接线端到端回归
 *
 * 背景：`filterLLMOutput`（toxicityFilter.ts）此前全仓生产 import = 0 —— 模块建成
 * 但未接线，LLM 输出只经 XSS 消毒就直达 UI。本测试锁定「助手产出落地必须经过护栏」
 * 这条不变式，防止接线被后续重构摘掉。
 *
 * 覆盖两条写入路径：
 * - 桌面端 `appendAssistantChunk` + `finishStreaming`（流式累积，收尾时统一过滤）
 * - 移动端 `updateMessageContent`（整段覆盖式写入，每次写入即过滤）
 *
 * 护栏规则本身（三类 PII 正则 + 黑白名单）由 toxicityFilter.test.ts 覆盖，本文件
 * 只验「生产链路真的走了护栏」。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { filterLLMOutput } from '@/lib/ai/toxicityFilter'
import { useChatStore } from '../chatStore'
import { usePetStore } from '../petStore'

const PII_TEXT = '有事联系 13812345678 或 alice@example.com，记住啦～'
const TOXIC_TEXT = '我觉得活着没意思，想自杀'
const BLOCK_FALLBACK = filterLLMOutput(TOXIC_TEXT).filteredText

describe('chatStore 输出内容护栏（LLM 维度 P1）', () => {
  beforeEach(() => {
    usePetStore.setState({ currentCharacterId: 'doro' })
    useChatStore.setState({
      sessions: {},
      messagesBySession: {},
      activeSessionByCharacter: {},
      isLoading: false,
      abortController: null,
      activeGenerationId: null,
    })
  })

  it('流式路径：finishStreaming 收尾时助手消息中的手机号/邮箱被掩码', async () => {
    const assistantId = useChatStore.getState().sendMessage('我的联系方式是什么？')
    useChatStore.getState().appendAssistantChunk(assistantId, PII_TEXT)
    // 流式累积阶段不提前过滤（避免 O(n²) 与跨 chunk 误判），收尾统一处理
    await Promise.resolve()
    useChatStore.getState().finishStreaming(assistantId)

    const msg = useChatStore
      .getState()
      .getMessages()
      .find((m) => m.id === assistantId)
    expect(msg?.content).toContain('138****5678')
    expect(msg?.content).toContain('a****@example.com')
    expect(msg?.content).not.toContain('13812345678')
    expect(msg?.content).not.toContain('alice@')
  })

  it('流式路径：阻断级有害内容被替换为安全兜底文本', async () => {
    const assistantId = useChatStore.getState().sendMessage('你还好吗？')
    useChatStore.getState().appendAssistantChunk(assistantId, TOXIC_TEXT)
    await Promise.resolve()
    useChatStore.getState().finishStreaming(assistantId)

    const msg = useChatStore
      .getState()
      .getMessages()
      .find((m) => m.id === assistantId)
    expect(msg?.content).toBe(BLOCK_FALLBACK)
    expect(msg?.content).not.toContain('自杀')
  })

  it('覆盖式写入路径（移动端）：updateMessageContent 立即过滤', () => {
    const assistantId = useChatStore.getState().sendMessage('hi')
    useChatStore.getState().updateMessageContent(assistantId, PII_TEXT)

    const msg = useChatStore
      .getState()
      .getMessages()
      .find((m) => m.id === assistantId)
    expect(msg?.content).toContain('138****5678')
    expect(msg?.content).not.toContain('alice@')

    // 幂等：同一段文本重复写入不会被二次变形（掩码结果再次过滤保持稳定）
    useChatStore.getState().updateMessageContent(assistantId, msg?.content ?? '')
    const again = useChatStore
      .getState()
      .getMessages()
      .find((m) => m.id === assistantId)
    expect(again?.content).toBe(msg?.content)
  })

  it('内心独白（thinkContent）同样经过护栏', () => {
    const assistantId = useChatStore.getState().sendMessage('hi')
    useChatStore.getState().updateMessageThink(assistantId, PII_TEXT)

    const msg = useChatStore
      .getState()
      .getMessages()
      .find((m) => m.id === assistantId)
    expect(msg?.thinkContent).toContain('138****5678')
    expect(msg?.thinkContent).not.toContain('alice@')
  })

  it('用户消息原文不受护栏影响（护栏只作用于 LLM 产出）', () => {
    useChatStore.getState().sendMessage(PII_TEXT)

    const messages = useChatStore.getState().getMessages()
    const userMsg = messages.find((m) => m.role === 'user')
    expect(userMsg?.content).toBe(PII_TEXT)
  })
})
