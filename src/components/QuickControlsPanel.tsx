/**
 * 快捷控制面板组件
 *
 * 功能概述：
 * - 系统音量滑块控制（静音/低/高音量图标）
 * - 屏幕亮度滑块控制
 * - 剪贴板历史管理：搜索、一键复制、删除、固定
 * - 剪贴板监听自动启停
 *
 * 核心Hooks/状态：
 * - useState: 音量、亮度、剪贴板历史、搜索关键词、复制成功提示
 * - useEffect: 订阅系统控制变化、剪贴板变化、启停剪贴板监听
 * - useCallback: 刷新剪贴板历史
 *
 * 使用模块：
 * - systemControls: 系统音量/亮度控制
 * - clipboardManager: 剪贴板历史管理
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Volume2, VolumeX, Volume1, Sun, Moon, Clipboard,
  Copy, Trash2, Pin, Search, ChevronUp, ChevronDown,
} from 'lucide-react'
import { getSystemControls } from '../lib/systemControls'
import { getClipboardManager, type ClipboardEntry } from '../lib/clipboardManager'

/**
 * 快捷控制面板
 *
 * 提供系统音量/亮度调节和剪贴板历史管理功能。
 */
export function QuickControlsPanel() {
  // ============ 系统控制 ============
  const sysControls = getSystemControls()
  const [volume, setVolume] = useState(sysControls.getState().volume)
  const [brightness, setBrightness] = useState(sysControls.getState().brightness)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    const unsub = sysControls.onChange(() => {
      const s = sysControls.getState()
      setVolume(s.volume)
      setBrightness(s.brightness)
    })
    return unsub
  }, [sysControls])

  // ============ 剪贴板管理 ============
  const clipMgr = getClipboardManager()
  // 初始值来自管理器快照（惰性初始化），避免在 effect 中同步 setState
  const [clipHistory, setClipHistory] = useState<ClipboardEntry[]>(() => clipMgr.getHistory())
  const [clipSearch, setClipSearch] = useState('')

  useEffect(() => {
    // 仅订阅变更，回调由管理器在变更时触发（非同步 setState）
    return clipMgr.onChange(() => setClipHistory(clipMgr.getHistory()))
  }, [clipMgr])

  // 搜索过滤为纯派生值，输入变化时立即重新过滤
  const clipboardHistory = useMemo(() => {
    const q = clipSearch.trim().toLowerCase()
    if (!q) return clipHistory
    return clipHistory.filter((e) => e.text.toLowerCase().includes(q))
  }, [clipHistory, clipSearch])

  // 事件处理器内手动刷新（删除/复制后立即同步）
  const refreshClipboard = useCallback(() => {
    setClipHistory(clipMgr.getHistory())
  }, [clipMgr])

  // 启动剪贴板监听
  useEffect(() => {
    clipMgr.start()
    return () => clipMgr.stop()
  }, [clipMgr])

  async function handleCopyClip(entry: ClipboardEntry) {
    const ok = await clipMgr.copyToClipboard(entry.id)
    if (ok) {
      setCopiedId(entry.id)
      setTimeout(() => setCopiedId(null), 1500)
    }
  }

  return (
    <div className="space-y-6">
      {/* ===== 音量控制 ===== */}
      <div className="rounded-xl bg-surface/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          {volume === 0 ? (
            <VolumeX size={16} className="text-red-400" />
          ) : volume < 50 ? (
            <Volume1 size={16} className="text-amber-300" />
          ) : (
            <Volume2 size={16} className="text-green-400" />
          )}
          <h3 className="text-sm font-semibold">音量控制</h3>
          <span className="ml-auto text-sm tabular-nums text-ink-muted">{volume}%</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void sysControls.volumeDown()}
            className="rounded-lg bg-cream-deep p-2 hover:bg-blush-soft"
            title="减小"
          >
            <ChevronDown size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => void sysControls.setVolume(parseInt(e.target.value))}
            className="flex-1 accent-amber-400"
          />
          <button
            onClick={() => void sysControls.volumeUp()}
            className="rounded-lg bg-cream-deep p-2 hover:bg-blush-soft"
            title="增大"
          >
            <ChevronUp size={16} />
          </button>
          <button
            onClick={() => void sysControls.toggleMute()}
            className={`rounded-lg p-2 ${volume === 0 ? 'bg-red-600/30 text-red-400' : 'bg-cream-deep hover:bg-blush-soft'}`}
            title="静音/取消"
          >
            {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      {/* ===== 亮度控制 ===== */}
      <div className="rounded-xl bg-surface/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          {brightness < 50 ? (
            <Moon size={16} className="text-blue-300" />
          ) : (
            <Sun size={16} className="text-amber-300" />
          )}
          <h3 className="text-sm font-semibold">亮度控制</h3>
          <span className="ml-auto text-sm tabular-nums text-ink-muted">{brightness}%</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void sysControls.brightnessDown()}
            className="rounded-lg bg-cream-deep p-2 hover:bg-blush-soft"
            title="调暗"
          >
            <ChevronDown size={16} />
          </button>
          <input
            type="range"
            min={10}
            max={100}
            value={brightness}
            onChange={(e) => void sysControls.setBrightness(parseInt(e.target.value))}
            className="flex-1 accent-amber-400"
          />
          <button
            onClick={() => void sysControls.brightnessUp()}
            className="rounded-lg bg-cream-deep p-2 hover:bg-blush-soft"
            title="调亮"
          >
            <ChevronUp size={16} />
          </button>
        </div>
      </div>

      {/* ===== 剪贴板历史 ===== */}
      <div className="rounded-xl bg-surface/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clipboard size={16} className="text-purple-300" />
          <h3 className="text-sm font-semibold">剪贴板历史</h3>
          <span className="text-[11px] text-ink-muted">({clipboardHistory.length})</span>
          {clipboardHistory.length > 0 && (
            <button
              onClick={() => {
                if (confirm('清空所有未固定的剪贴板历史？')) {
                  clipMgr.clearAll()
                  refreshClipboard()
                }
              }}
              className="ml-auto flex items-center gap-1 text-[11px] text-red-300 hover:text-red-200"
            >
              <Trash2 size={12} /> 清空
            </button>
          )}
        </div>

        {/* 搜索 */}
        <div className="relative mb-3">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={clipSearch}
            onChange={(e) => setClipSearch(e.target.value)}
            placeholder="搜索剪贴板…"
            className="w-full rounded-lg bg-cream-deep py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>

        {/* 历史列表 */}
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {clipboardHistory.length === 0 ? (
            <div className="py-6 text-center text-xs text-ink-muted">
              暂无剪贴板历史
              <div className="mt-1 text-[10px]">复制文本后会自动记录</div>
            </div>
          ) : (
            clipboardHistory.map((entry) => (
              <div
                key={entry.id}
                className={`group flex items-start gap-2 rounded-lg p-2 ${
                  entry.pinned ? 'bg-amber-400/10 border border-amber-400/20' : 'bg-cream-deep/40'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-ink">{entry.preview}</div>
                  <div className="mt-0.5 text-[9px] text-ink-muted">
                    {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => handleCopyClip(entry)}
                    className="rounded p-1 text-ink-muted hover:bg-cream-deep/60 hover:text-blue-300"
                    title="复制"
                  >
                    {copiedId === entry.id ? <span className="text-green-400 text-[10px]">✓</span> : <Copy size={12} />}
                  </button>
                  <button
                    onClick={() => clipMgr.togglePin(entry.id)}
                    className={`rounded p-1 ${entry.pinned ? 'text-amber-300' : 'text-ink-muted hover:bg-cream-deep/60'}`}
                    title={entry.pinned ? '取消固定' : '固定'}
                  >
                    <Pin size={12} />
                  </button>
                  <button
                    onClick={() => { clipMgr.deleteEntry(entry.id); refreshClipboard() }}
                    className="rounded p-1 text-ink-muted hover:bg-red-600/20 hover:text-red-400"
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
