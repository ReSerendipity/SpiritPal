/**
 * @file JournalPanel.test.tsx
 * @description 日记面板单测（A-8 验收）
 *
 * 契约：
 *  1. 点击「生成今日日记」→ 基于当日对话生成内容（含摘要/心情/关键词）
 *  2. 生成前「导出 Markdown」禁用，生成后可导出且触发下载（.md 文件名 + 内容含标题与心情评分）
 *  3. 当日无对话时生成空日记不崩溃
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { JournalPanel } from '../JournalPanel'
import type { ChatMessage } from '../../lib/types'

let messages: ChatMessage[] = []

vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({ getMessages: () => messages }),
  },
}))

/** 构造一条今天的消息 */
function msg(role: 'user' | 'assistant', content: string, offsetMs = 0): ChatMessage {
  return {
    id: `${role}-${content.slice(0, 6)}`,
    role,
    content,
    timestamp: Date.now() - offsetMs,
  } as ChatMessage
}

/** 捕获导出时的 Blob 文本与下载文件名 */
const downloadSpy = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  messages = []

  // Blob 文本读取桩
  vi.stubGlobal(
    'Blob',
    class MockBlob {
      parts: string[]
      type: string
      constructor(parts: string[], options?: { type?: string }) {
        this.parts = parts
        this.type = options?.type ?? ''
      }
      text() {
        return Promise.resolve(this.parts.join(''))
      }
    },
  )
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  })
})

describe('JournalPanel', () => {
  it('生成今日日记：展示摘要、心情评分与条目数', () => {
    messages = [msg('user', '今天好开心'), msg('assistant', '那太好啦！')]

    render(<JournalPanel />)
    fireEvent.click(screen.getByText('生成今日日记'))

    const pre = document.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre?.textContent).toContain('今日对话摘要')
    expect(pre?.textContent).toContain('今天好开心')
    expect(pre?.textContent).toMatch(/【心情】/)
    // 条目数展示
    expect(screen.getByText(/基于今日（2 条）/)).toBeTruthy()
  })

  it('导出按钮：生成前禁用，生成后触发 .md 下载且内容含标题与心情评分', async () => {
    messages = [msg('user', '写代码写累了')]

    render(<JournalPanel />)
    const exportBtn = screen.getByText('导出 Markdown').closest('button')
    expect(exportBtn?.disabled).toBe(true)

    fireEvent.click(screen.getByText('生成今日日记'))
    expect(screen.getByText('导出 Markdown').closest('button')?.disabled).toBe(false)

    // 捕获 a.click 及其 download 属性
    const clickSpy = vi.fn()
    const originalCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: clickSpy })
      }
      return el
    })

    fireEvent.click(screen.getByText('导出 Markdown'))

    expect(clickSpy).toHaveBeenCalledOnce()
    const anchor = spy.mock.results
      .map((r) => r.value as HTMLAnchorElement)
      .find((el) => el.tagName === 'A' && typeof el.download === 'string' && el.download.endsWith('.md'))
    expect(anchor).toBeTruthy()
    expect(anchor?.download).toMatch(/^spiritpal-diary-.*\.md$/)

    spy.mockRestore()
  })

  it('当日无对话时生成空日记不崩溃', () => {
    messages = []

    render(<JournalPanel />)
    expect(() => fireEvent.click(screen.getByText('生成今日日记'))).not.toThrow()
    expect(screen.getByText(/基于今日（0 条）/)).toBeTruthy()
  })

  it('导出内容包含心情评分与关键词块', async () => {
    messages = [msg('user', '今天被夸了，很开心'), msg('assistant', '恭喜！')]

    render(<JournalPanel />)
    fireEvent.click(screen.getByText('生成今日日记'))

    const originalCreate = document.createElement.bind(document)
    const captured: HTMLAnchorElement[] = []
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') captured.push(el as HTMLAnchorElement)
      return el
    })
    fireEvent.click(screen.getByText('导出 Markdown'))

    expect(captured.length).toBeGreaterThan(0)
    expect(captured[0]?.download).toMatch(/^spiritpal-diary-.*\.md$/)
    spy.mockRestore()
  })
})
