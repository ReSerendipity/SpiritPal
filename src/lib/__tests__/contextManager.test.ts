// contextManager 模块测试 — token 预算 / 优先级 / 压缩
// 第五轮评估补测：该文件此前无专属测试，且 F5/F5b 在 ChatWindow 中依赖其预算行为
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContextManager, getContextManager, resetContextManager } from '../contextManager'
import { estimateTokens } from '../stringSimilarity'

describe('ContextManager', () => {
  let mgr: ContextManager

  beforeEach(() => {
    resetContextManager()
    mgr = new ContextManager({ defaultMaxTokens: 100, preserveRecentRounds: 2 })
  })

  it('addMessage 自动 token 计数并返回消息', () => {
    const msg = mgr.addMessage('user', '你好世界')
    expect(msg.content).toBe('你好世界')
    expect(mgr.getMessageCount()).toBe(1)
    expect(mgr.getTotalTokens()).toBe(estimateTokens('你好世界'))
  })

  it('getContextWindow 在严格预算下（preserveSystem=false, preserveRecentRounds=0）只保留预算内消息', () => {
    const strict = new ContextManager({ defaultMaxTokens: 100, preserveSystem: false, preserveRecentRounds: 0 })
    strict.addMessage('user', '第一条用户消息内容')
    strict.addMessage('user', '第二条用户消息内容')
    strict.addMessage('user', '第三条用户消息内容')
    const window = strict.getContextWindow(8)
    const total = window.reduce((s, m) => s + estimateTokens(m.content), 0)
    expect(total).toBeLessThanOrEqual(8)
    expect(window.length).toBeLessThan(3)
  })

  it('preserveSystem=true 时 system 消息即使超预算也保留', () => {
    mgr.addMessage('system', '系统提示')
    mgr.addMessage('user', '用户消息内容')
    const window = mgr.getContextWindow(2) // 预算极小
    expect(window.some((m) => m.role === 'system' && m.content === '系统提示')).toBe(true)
  })

  it('preserveRecentRounds 强制保留最近 N 轮对话', () => {
    mgr.addMessage('user', '第一轮')
    mgr.addMessage('assistant', '第一轮回复')
    mgr.addMessage('user', '第二轮')
    mgr.addMessage('assistant', '第二轮回复')
    mgr.addMessage('user', '第三轮')
    mgr.addMessage('assistant', '第三轮回复')
    const window = mgr.getContextWindow(1) // 预算极小，但最近 2 轮应强制保留
    const contents = window.map((m) => m.content)
    expect(contents).toContain('第三轮')
    expect(contents).toContain('第三轮回复')
  })

  it('无 LLM 时压缩：生成简单摘要并移除旧消息', async () => {
    const mgr2 = new ContextManager({ defaultMaxTokens: 10, preserveRecentRounds: 1 })
    for (let i = 0; i < 10; i++) {
      mgr2.addMessage('user', `旧消息${i}内容`)
    }
    const before = mgr2.getTotalTokens()
    expect(before).toBeGreaterThan(10)

    const total = await mgr2.compressContext()
    expect(total).toBe(before)
    // 压缩后消息数减少
    expect(mgr2.getMessageCount()).toBeLessThan(10)
    // 压缩摘要出现在上下文中
    const window = mgr2.getContextWindow()
    expect(window.some((m) => m.content.includes('对话历史摘要'))).toBe(true)
  })

  it('LLM 压缩器生效时使用 LLM 摘要', async () => {
    const llmCompressor = vi.fn().mockResolvedValue('LLM 生成的对话摘要')
    const mgr2 = new ContextManager({ defaultMaxTokens: 10, preserveRecentRounds: 1 })
    for (let i = 0; i < 10; i++) {
      mgr2.addMessage('user', `旧消息${i}内容`)
    }
    await mgr2.compressContext(llmCompressor)
    expect(llmCompressor).toHaveBeenCalled()
    const window = mgr2.getContextWindow()
    expect(window.some((m) => m.content.includes('LLM 生成的对话摘要'))).toBe(true)
  })

  it('预算充足时所有消息按时间顺序返回', () => {
    mgr.addMessage('user', '第一条')
    mgr.addMessage('assistant', '回复一')
    mgr.addMessage('user', '第二条')
    const window = mgr.getContextWindow(1000)
    expect(window.map((m) => m.content)).toEqual(['第一条', '回复一', '第二条'])
  })

  it('clear 清空所有消息', () => {
    mgr.addMessage('user', 'x')
    mgr.clear()
    expect(mgr.getMessageCount()).toBe(0)
    expect(mgr.getTotalTokens()).toBe(0)
  })

  it('getContextManager 单例与 resetContextManager 重置', () => {
    const a = getContextManager()
    const b = getContextManager()
    expect(a).toBe(b)
    resetContextManager()
    expect(getContextManager()).not.toBe(a)
  })
})
