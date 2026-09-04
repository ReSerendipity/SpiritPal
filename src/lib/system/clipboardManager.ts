/**
 * 剪贴板管理器 — 剪贴板历史记录、快速粘贴、搜索
 * PRD Phase 4: 剪贴板管理
 *
 * @fileoverview
 * 主要模块：
 * - ClipboardEntry 接口：剪贴板条目（ID/文本/时间戳/预览/置顶）
 * - ClipboardManager 类：剪贴板管理器（单例模式），支持历史记录、轮询监听、搜索、重新复制、置顶
 *
 * 功能：
 * - 监听剪贴板变化，记录历史
 * - 最多保存 50 条记录
 * - 支持文本类型
 * - 支持搜索历史
 * - 支持重新复制到剪贴板
 * - 支持置顶重要条目
 * - 条目标题预览（自动截断）
 *
 * @module clipboardManager
 */

const STORAGE_KEY = 'spiritpal-clipboard-history'
const MAX_ENTRIES = 50
const MAX_TEXT_LENGTH = 500

export interface ClipboardEntry {
  id: string
  text: string
  timestamp: number
  preview: string
  pinned: boolean
}

export class ClipboardManager {
  private history: ClipboardEntry[] = []
  private listeners: Set<() => void> = new Set()
  private lastClipboardText: string = ''
  private pollTimer: number | null = null

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        this.history = JSON.parse(raw)
      }
    } catch {
      this.history = []
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history))
    } catch {
      // 忽略
    }
    this.notifyListeners()
  }

  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // 开始监听剪贴板变化（轮询方式）
  start(): void {
    if (this.pollTimer) return
    // 每 2 秒检查一次剪贴板
    this.pollTimer = window.setInterval(() => {
      this.checkClipboard()
    }, 2000)
  }

  // 停止监听
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // 检查剪贴板是否有新内容
  private async checkClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText()
      if (text && text !== this.lastClipboardText) {
        this.lastClipboardText = text
        this.addEntry(text)
      }
    } catch {
      // 剪贴板 API 可能在非安全上下文中不可用
    }
  }

  // 手动添加条目
  addEntry(text: string): void {
    if (!text.trim()) return
    // 限制文本长度
    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH) + '...'
      : text
    const preview = text.slice(0, 80).replace(/\n/g, ' ')

    // 检查是否已存在（去重）
    const existing = this.history.find((e) => e.text === truncated && !e.pinned)
    if (existing) {
      // 移到最前面
      this.history = this.history.filter((e) => e.id !== existing.id)
      existing.timestamp = Date.now()
      this.history.unshift(existing)
      this.save()
      return
    }

    const entry: ClipboardEntry = {
      id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: truncated,
      timestamp: Date.now(),
      preview,
      pinned: false,
    }
    this.history.unshift(entry)
    // 限制最大数量
    if (this.history.length > MAX_ENTRIES) {
      // 保留 pinned 的，移除最旧的非 pinned
      const nonPinned = this.history.filter((e) => !e.pinned)
      if (nonPinned.length > MAX_ENTRIES - 10) {
        const toRemove = nonPinned[nonPinned.length - 1]
        this.history = this.history.filter((e) => e.id !== toRemove.id)
      }
    }
    this.save()
  }

  // 复制到剪贴板
  async copyToClipboard(id: string): Promise<boolean> {
    const entry = this.history.find((e) => e.id === id)
    if (!entry) return false
    try {
      await navigator.clipboard.writeText(entry.text)
      this.lastClipboardText = entry.text
      return true
    } catch {
      return false
    }
  }

  // 获取所有历史
  getHistory(): ClipboardEntry[] {
    return [...this.history]
  }

  // 搜索历史
  search(query: string): ClipboardEntry[] {
    if (!query.trim()) return this.getHistory()
    const q = query.toLowerCase()
    return this.history.filter((e) => e.text.toLowerCase().includes(q))
  }

  // 删除条目
  deleteEntry(id: string): void {
    this.history = this.history.filter((e) => e.id !== id)
    this.save()
  }

  // 固定/取消固定
  togglePin(id: string): void {
    const entry = this.history.find((e) => e.id === id)
    if (entry) {
      entry.pinned = !entry.pinned
      this.save()
    }
  }

  // 清空所有（保留 pinned）
  clearAll(): void {
    this.history = this.history.filter((e) => e.pinned)
    this.save()
  }

  // 完全清空
  clearAllForce(): void {
    this.history = []
    this.save()
  }
}

// ============ 单例 ============

let sharedMgr: ClipboardManager | null = null

export function getClipboardManager(): ClipboardManager {
  if (!sharedMgr) {
    sharedMgr = new ClipboardManager()
  }
  return sharedMgr
}
