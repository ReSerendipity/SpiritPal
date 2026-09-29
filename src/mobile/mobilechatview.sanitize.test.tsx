// MobileChatView Markdown 消毒测试
//
// 背景（实测结论，勿过度声称）：
//   react-markdown v10 **默认就不解析原始 HTML**（需显式引入 rehype-raw 才会），
//   且自带 defaultUrlTransform 会清空 javascript:/data: 等危险协议。
//   因此移动端此前**并不存在可利用的 XSS**。
//
//   引入 rehype-sanitize 的实际差异（已用对照实验逐条验证）：
//     · 不加消毒：原始 HTML 会以**转义文本**形式显示给用户
//       （innerHTML 为 `&lt;script&gt;…`，textContent 含字面量 `<script>…`）
//     · 加消毒：该 raw 节点被整段剥离，不显示也不执行
//   即：从「安全但会显示乱码 HTML」变为「安全且不显示」，并与桌面端 ChatWindow
//   使用同一套配置（SECURITY R-02），属纵深防御 + 两端一致性，非漏洞修复。
//
// 本文件**不** mock react-markdown，走真实渲染链路才能验证消毒是否生效。
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatMessage } from '@/lib/data/types'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

vi.mock('@/lib/data/characters', () => ({
  getCharacter: vi.fn(() => ({
    id: 'doro',
    displayName: '多萝',
    themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
  })),
  getAllCharacters: vi.fn(() => []),
  getDefaultCharacter: vi.fn(() => ({ id: 'doro', displayName: '多萝', spriteAsset: '' })),
}))

/** 把一条助手消息塞进 chat store，使其渲染到气泡里 */
function seedAssistantMessage(content: string) {
  const charId = usePetStore.getState().currentCharacterId
  const sessionId = 'test-session'
  const msg: ChatMessage = {
    id: 'm1',
    role: 'assistant',
    content,
    timestamp: Date.now(),
  }
  useChatStore.setState({
    activeSessionByCharacter: { [charId]: sessionId },
    messagesBySession: { [sessionId]: [msg] },
  })
}

describe('MobileChatView Markdown 消毒', () => {
  beforeEach(() => {
    useChatStore.setState({ messagesBySession: {}, activeSessionByCharacter: {} })
  })

  it('原始 HTML 被整段剥离，而不是当作文本显示给用户', () => {
    seedAssistantMessage('你好\n\n<script>window.__pwned = true</script>')
    const { container } = render(<MobileChatView />)

    // 关键断言：不加消毒时这里会是字面量 `<script>window.__pwned = true</script>`
    expect(container.textContent).not.toContain('<script>')
    expect(container.querySelector('script')).toBeNull()
    // 正文仍应正常渲染
    expect(screen.getByText(/你好/)).toBeInTheDocument()
  })

  it('剥离 HTML 事件属性与危险协议链接', () => {
    seedAssistantMessage(
      '<img src="x" onerror="window.__pwned=true" />\n\n[点我](javascript:alert(1))',
    )
    const { container } = render(<MobileChatView />)

    // 原始 HTML 不解析 → 不应出现 img 元素；也不应把标签当文本显示
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).not.toContain('onerror')

    const links = Array.from(container.querySelectorAll('a'))
    for (const a of links) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
      expect(a.getAttribute('href') ?? '').not.toMatch(/^data:/i)
    }
  })

  it('保留安全的 Markdown 结构（加粗 / 列表 / 代码 / 正常链接）', () => {
    seedAssistantMessage('**加粗**\n\n- 项目一\n- 项目二\n\n`code`\n\n[官网](https://example.com)')
    const { container } = render(<MobileChatView />)

    expect(container.querySelector('strong')?.textContent).toBe('加粗')
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })
})
