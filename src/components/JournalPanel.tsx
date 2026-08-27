/**
 * 日记面板组件（设置页「日记」Tab）
 *
 * 说明（A-8 批次二 / 诚实降级）：
 * - 原 dailyJournal.ts 依赖 Node 内置模块（fs/process），无法在 Tauri webview 直接 import，
 *   故本组件采用 webview 安全实现：基于 chatStore 的今日对话 + lib/i18n 的本地化格式化器
 *   生成日记草稿，并通过 Blob 下载导出 Markdown（不依赖 Node fs）。
 * - 情绪评分当前为轻量启发式；后续可由 A-10 的 emotionEngine 进一步增强（见下方 TODO）。
 */
import { useState } from 'react'
import { BookOpen, Download, Sparkles } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { formatDate, formatDateTime } from '@/lib/i18n'
import type { ChatMessage } from '@/lib/types'

interface JournalEntry {
  title: string
  content: string
  tags: string[]
  moodScore: number
}

function isToday(ts: number): boolean {
  const d = new Date(ts)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

const STOP_WORDS = new Set([
  '的', '了', '我', '你', '他', '她', '它', '是', '在', '和', '也', '就', '都', '把', '被', '吗', '呢', '吧', '啊', '不', '有', '这', '那',
  'we', 'the', 'a', 'is', 'to', 'and', 'you', 'i', 'it',
])

/** 极简关键词提取（中文 2-4 字 / 英文 3+ 字母，去停用词，取高频前 6） */
function extractTags(texts: string[]): string[] {
  const freq = new Map<string, number>()
  for (const t of texts) {
    const words = t.toLowerCase().match(/[一-龥]{2,4}|[a-z]{3,}/g) ?? []
    for (const w of words) {
      if (STOP_WORDS.has(w)) continue
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w)
}

function buildJournal(messages: ChatMessage[]): JournalEntry {
  const today = messages.filter((m) => isToday(m.timestamp))
  const userMsgs = today.filter((m) => m.role === 'user')
  const aiMsgs = today.filter((m) => m.role === 'assistant')
  const texts = today.map((m) => m.content).filter(Boolean)

  const tags = extractTags(texts)

  // TODO(A-10): 接入 emotionEngine.analyzeFromText 计算更精准的情绪评分
  const positiveHits = ['开心', '喜欢', '谢谢', '爱', '棒', '好', 'happy', 'love', 'thanks', 'great', 'good', 'nice']
  const positive = positiveHits.filter((w) => texts.join(' ').toLowerCase().includes(w)).length
  const moodScore = Math.max(0, Math.min(100, 50 + positive * 8 + (userMsgs.length - 3) * 2))

  const title = `今天与 SpiritPal 的对话（${userMsgs.length} 条）`
  const content = [
    `日期：${formatDate(new Date(), 'full')}`,
    `对话轮次：${userMsgs.length} 次提问 / ${aiMsgs.length} 次回复`,
    '',
    '【今日对话摘要】',
    ...today.slice(-12).map((m) => `${m.role === 'user' ? '我' : 'SpiritPal'}：${m.content.slice(0, 120)}`),
    '',
    `【心情】${moodScore >= 60 ? '愉悦' : moodScore >= 40 ? '平静' : '略低'}（评分 ${moodScore}）`,
    `【关键词】${tags.join('、') || '—'}`,
  ].join('\n')

  return { title, content, tags, moodScore }
}

function buildMarkdown(entry: JournalEntry, messages: ChatMessage[]): string {
  const today = messages.filter((m) => isToday(m.timestamp))
  return [
    `# SpiritPal 日记 · ${formatDate(new Date(), 'full')}`,
    '',
    `> ${entry.title}`,
    '',
    `**心情评分**：${entry.moodScore} / 100`,
    `**关键词**：${entry.tags.join('、') || '—'}`,
    '',
    '## 今日对话',
    ...today.map((m) => `- **${m.role === 'user' ? '我' : 'SpiritPal'}**：${m.content}`),
    '',
    '---',
    '_由 SpiritPal 自动生成_',
  ].join('\n')
}

export function JournalPanel() {
  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [todayCount, setTodayCount] = useState(0)

  function handleGenerate() {
    const messages = useChatStore.getState().getMessages()
    setTodayCount(messages.filter((m) => isToday(m.timestamp)).length)
    setEntry(buildJournal(messages))
  }

  function handleExport() {
    if (!entry) return
    const messages = useChatStore.getState().getMessages()
    const md = buildMarkdown(entry, messages)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spiritpal-diary-${formatDate(new Date(), 'short')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen size={18} /> 日记
        </h2>
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            className="flex items-center gap-1 rounded-lg bg-tangerine px-3 py-1.5 text-sm text-white hover:bg-tangerine-deep"
          >
            <Sparkles size={14} /> 生成今日日记
          </button>
          <button
            onClick={handleExport}
            disabled={!entry}
            className="flex items-center gap-1 rounded-lg bg-surface px-3 py-1.5 text-sm disabled:opacity-40"
          >
            <Download size={14} /> 导出 Markdown
          </button>
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        基于今日（{todayCount} 条）与 SpiritPal 的对话自动生成。导出为 Markdown 文件，可随时回顾。
      </p>
      {entry ? (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-cream-deep/60 p-4 text-sm text-ink">{entry.content}</pre>
      ) : (
        <div className="rounded-lg border border-dashed border-ink/20 p-10 text-center text-sm text-ink-muted">
          点击「生成今日日记」开始
        </div>
      )}
    </div>
  )
}
