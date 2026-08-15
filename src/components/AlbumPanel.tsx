/**
 * 宠物相册面板组件
 *
 * 功能概述：
 * - 截图管理：查看、删除、清空宠物截图
 * - 角色筛选：按角色筛选显示截图
 * - 滤镜系统：8种图片滤镜（原图/暖色/冷色/复古/可爱/戏剧/柔和/黑白）
 * - 图片操作：导出下载、复制到剪贴板、社交分享
 * - 截图说明：支持添加和编辑截图文字说明
 * - 大图预览：全屏预览模式带滤镜选择栏
 *
 * 核心Hooks/状态：
 * - useState: 管理截图列表、选中图片、复制状态、角色筛选、滤镜选择、说明编辑等
 * - useEffect/useCallback: 监听截图管理器变化并刷新列表
 * - useRef: Canvas引用用于滤镜导出
 *
 * 使用模块：
 * - screenshotManager: 截图管理器，提供截图CRUD、导出、复制功能
 * - characters: 角色信息查询
 */
// PRD Phase 3: 宠物相册/截图分享
// P3-27: 一键截图+滤镜+分享
import { useState, useEffect, useCallback, useRef } from 'react'
import { Camera, Download, Trash2, Copy, X, Check, Image as ImageIcon, Share2, Sparkles, Pencil } from 'lucide-react'
import { getScreenshotManager, type Screenshot } from '../lib/screenshotManager'
import { getCharacter } from '../lib/characters'

// ============ 滤镜定义 ============

export type FilterId = 'none' | 'warm' | 'cool' | 'vintage' | 'cute' | 'dramatic' | 'soft' | 'noir'

/** 滤镜定义接口 */
interface FilterDef {
  /** 滤镜唯一标识 */
  id: FilterId
  /** 滤镜显示名称 */
  name: string
  /** 滤镜图标emoji */
  icon: string
  /** CSS filter属性值 */
  cssFilter: string
}

const FILTERS: FilterDef[] = [
  { id: 'none', name: '原图', icon: '🖼️', cssFilter: 'none' },
  { id: 'warm', name: '暖色', icon: '🌅', cssFilter: 'saturate(1.3) sepia(0.2) brightness(1.05)' },
  { id: 'cool', name: '冷色', icon: '❄️', cssFilter: 'saturate(0.8) hue-rotate(20deg) brightness(1.05)' },
  { id: 'vintage', name: '复古', icon: '📷', cssFilter: 'sepia(0.5) contrast(1.1) brightness(0.9)' },
  { id: 'cute', name: '可爱', icon: '🎀', cssFilter: 'saturate(1.4) brightness(1.1) contrast(0.95)' },
  { id: 'dramatic', name: '戏剧', icon: '🎭', cssFilter: 'contrast(1.4) saturate(1.2) brightness(0.9)' },
  { id: 'soft', name: '柔和', icon: '☁️', cssFilter: 'blur(0.5px) brightness(1.1) contrast(0.9)' },
  { id: 'noir', name: '黑白', icon: '🎬', cssFilter: 'grayscale(1) contrast(1.2)' },
]

// ============ 相册面板 ============

/**
 * 相册面板组件
 *
 * 提供宠物截图的浏览、筛选、滤镜、导出、分享功能。
 * 支持网格缩略图浏览和全屏大图预览两种模式。
 */
export function AlbumPanel() {
  const mgr = getScreenshotManager()
  // 初始值来自管理器快照（惰性初始化），避免在 effect 中同步 setState
  const [screenshots, setScreenshots] = useState<Screenshot[]>(() => mgr.getScreenshots())
  const [selected, setSelected] = useState<Screenshot | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [filterChar, setFilterChar] = useState<string>('all')
  // P3-27: 滤镜与编辑
  const [activeFilter, setActiveFilter] = useState<FilterId>('none')
  const [editCaptionId, setEditCaptionId] = useState<string | null>(null)
  const [captionText, setCaptionText] = useState('')
  const [shareTip, setShareTip] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const refresh = useCallback(() => {
    setScreenshots(mgr.getScreenshots())
  }, [mgr])

  useEffect(() => {
    // 仅订阅变更，回调由管理器在变更时触发（非同步 setState）
    return mgr.onChange(() => setScreenshots(mgr.getScreenshots()))
  }, [mgr])

  function handleDelete(id: string) {
    mgr.deleteScreenshot(id)
    if (selected?.id === id) setSelected(null)
    refresh()
  }

  function handleExport(ss: Screenshot) {
    // 如果有滤镜，先应用滤镜再导出
    if (activeFilter !== 'none') {
      exportWithFilter(ss)
    } else {
      mgr.exportScreenshot(ss.id)
    }
  }

  async function handleCopy(ss: Screenshot) {
    if (activeFilter !== 'none') {
      const dataUrl = await applyFilterToDataUrl(ss.dataUrl, activeFilter)
      if (dataUrl) {
        try {
          const response = await fetch(dataUrl)
          const blob = await response.blob()
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          setCopiedId(ss.id)
          setTimeout(() => setCopiedId(null), 1500)
        } catch { /* 复制失败静默 */ }
      }
    } else {
      const ok = await mgr.copyToClipboard(ss.id)
      if (ok) {
        setCopiedId(ss.id)
        setTimeout(() => setCopiedId(null), 1500)
      }
    }
  }

  function handleClearAll() {
    if (confirm('确定清空所有截图吗？此操作不可撤销。')) {
      mgr.clearAll()
      setSelected(null)
      refresh()
    }
  }

  // P3-27: 保存截图说明
  function handleSaveCaption(id: string) {
    mgr.updateCaption(id, captionText)
    setEditCaptionId(null)
    setCaptionText('')
    refresh()
  }

  // P3-27: 社交分享（复制到剪贴板 + 提示）
  async function handleShare(ss: Screenshot) {
    const dataUrl = activeFilter !== 'none'
      ? (await applyFilterToDataUrl(ss.dataUrl, activeFilter)) ?? ss.dataUrl
      : ss.dataUrl
    try {
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setShareTip('已复制到剪贴板，可以粘贴分享啦～')
    } catch {
      // 回退：直接复制原图
      const ok = await mgr.copyToClipboard(ss.id)
      setShareTip(ok ? '已复制到剪贴板' : '分享失败，请尝试手动复制')
    }
    setTimeout(() => setShareTip(null), 3000)
  }

  // P3-27: 应用滤镜后导出
  async function exportWithFilter(ss: Screenshot) {
    const dataUrl = await applyFilterToDataUrl(ss.dataUrl, activeFilter)
    if (!dataUrl) {
      mgr.exportScreenshot(ss.id)
      return
    }
    const a = document.createElement('a')
    a.href = dataUrl
    const filterLabel = FILTERS.find(f => f.id === activeFilter)?.name ?? ''
    a.download = `spiritpal-${ss.characterName}-${filterLabel}-${new Date(ss.timestamp).toISOString().slice(0, 10)}.png`
    a.click()
  }

  // P3-27: Canvas 滤镜应用
  function applyFilterToDataUrl(dataUrl: string, filterId: FilterId): Promise<string | null> {
    return new Promise((resolve) => {
      const filterDef = FILTERS.find(f => f.id === filterId)
      if (!filterDef || filterDef.cssFilter === 'none') {
        resolve(null)
        return
      }

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }

        ctx.filter = filterDef.cssFilter
        ctx.drawImage(img, 0, 0)
        ctx.filter = 'none'

        try {
          resolve(canvas.toDataURL('image/png'))
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = dataUrl
    })
  }

  const filtered = filterChar === 'all'
    ? screenshots
    : screenshots.filter((s) => s.characterId === filterChar)

  const charIds = [...new Set(screenshots.map((s) => s.characterId))]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera size={16} className="text-amber-300" />
          <span className="text-sm">宠物相册 ({screenshots.length})</span>
        </div>
        {screenshots.length > 0 && (
          <button
            onClick={handleClearAll}
            className="flex items-center gap-1 rounded-lg bg-red-600/20 px-2 py-1 text-[11px] text-red-300 hover:bg-red-600/30"
          >
            <Trash2 size={12} /> 清空
          </button>
        )}
      </div>

      {charIds.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterChar('all')}
            className={`rounded px-2 py-0.5 text-[11px] ${
              filterChar === 'all' ? 'bg-amber-400 text-gray-900' : 'bg-cream-deep text-ink'
            }`}
          >
            全部
          </button>
          {charIds.map((id) => {
            const c = getCharacter(id)
            return (
              <button
                key={id}
                onClick={() => setFilterChar(id)}
                className={`rounded px-2 py-0.5 text-[11px] ${
                  filterChar === id ? 'bg-amber-400 text-gray-900' : 'bg-cream-deep text-ink'
                }`}
              >
                {c?.displayName ?? id}
              </button>
            )
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink/10 p-8 text-center">
          <ImageIcon size={32} className="mx-auto mb-2 opacity-40 text-ink-muted" />
          <div className="text-xs text-ink-muted">
            {screenshots.length === 0 ? '还没有截图' : '该角色暂无截图'}
          </div>
          <div className="mt-1 text-[10px] text-ink-faint">
            右键宠物菜单中选择「截图」来保存美好瞬间
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {filtered.map((ss) => (
            <div
              key={ss.id}
              className="group relative cursor-pointer overflow-hidden rounded-lg border border-ink/10"
              onClick={() => { setSelected(ss); setActiveFilter('none') }}
            >
              <img
                src={ss.dataUrl}
                alt={ss.caption ?? ss.characterName}
                className="aspect-square w-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={(e) => { e.stopPropagation(); handleShare(ss) }}
                  className="rounded bg-white/20 p-1.5 text-white hover:bg-white/30"
                  title="分享"
                >
                  <Share2 size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleExport(ss) }}
                  className="rounded bg-white/20 p-1.5 text-white hover:bg-white/30"
                  title="下载"
                >
                  <Download size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopy(ss) }}
                  className="rounded bg-white/20 p-1.5 text-white hover:bg-white/30"
                  title="复制"
                >
                  {copiedId === ss.id ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(ss.id) }}
                  className="rounded bg-red-600/40 p-1.5 text-white hover:bg-red-600/60"
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1">
                <div className="text-[9px] text-white/80">{ss.characterName}</div>
                <div className="text-[8px] text-white/50">
                  {new Date(ss.timestamp).toLocaleDateString('zh-CN')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分享提示 */}
      {shareTip && (
        <div className="flex items-center gap-2 rounded-lg bg-green-900/30 px-3 py-2 text-xs text-green-300">
          <Check size={14} /> {shareTip}
        </div>
      )}

      {/* 大图预览 + 滤镜 + 分享 */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => { setSelected(null); setActiveFilter('none') }}
        >
          <div className="relative max-h-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            {/* 滤镜预览 */}
            <div className="relative">
              <img
                src={selected.dataUrl}
                alt={selected.caption ?? selected.characterName}
                className="max-h-[70vh] rounded-lg"
                style={{
                  filter: FILTERS.find(f => f.id === activeFilter)?.cssFilter ?? 'none',
                }}
              />
              {/* 隐藏的 Canvas 用于导出 */}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* 滤镜选择栏 */}
            <div className="mt-2 flex items-center gap-1 overflow-x-auto rounded-lg bg-cream-deep/80 px-2 py-2">
              <Sparkles size={12} className="shrink-0 text-amber-300" />
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id)}
                  className={`shrink-0 rounded px-2 py-1 text-[10px] transition-colors ${
                    activeFilter === f.id
                      ? 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400'
                      : 'text-ink-muted hover:bg-cream-deep/50'
                  }`}
                >
                  <span className="mr-0.5">{f.icon}</span>{f.name}
                </button>
              ))}
            </div>

            {/* 截图说明编辑 */}
            <div className="mt-1 flex items-center gap-2 rounded-lg bg-cream-deep/80 px-3 py-2">
              {editCaptionId === selected.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={captionText}
                    onChange={(e) => setCaptionText(e.target.value)}
                    placeholder="添加说明…"
                    className="flex-1 rounded bg-cream-deep/50 px-2 py-1 text-xs text-white placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-400"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveCaption(selected.id)
                      if (e.key === 'Escape') setEditCaptionId(null)
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveCaption(selected.id)}
                    className="rounded bg-amber-500/20 px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-500/30"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditCaptionId(null)}
                    className="rounded bg-ink-faint/20 px-2 py-1 text-[10px] text-ink-muted hover:bg-ink-faint/30"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <Pencil size={12} className="shrink-0 text-ink-muted" />
                  <button
                    onClick={() => { setEditCaptionId(selected.id); setCaptionText(selected.caption ?? '') }}
                    className="text-left text-[11px] text-ink-muted hover:text-ink"
                  >
                    {selected.caption ?? '点击添加说明…'}
                  </button>
                </>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="mt-1 flex items-center justify-between rounded-lg bg-cream-deep/80 px-3 py-2">
              <div className="text-xs text-ink">
                {selected.characterName} · {new Date(selected.timestamp).toLocaleString('zh-CN')}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleShare(selected)}
                  className="rounded bg-indigo-500/20 p-1.5 text-indigo-300 hover:bg-indigo-500/30"
                  title="分享（复制到剪贴板）"
                >
                  <Share2 size={14} />
                </button>
                <button
                  onClick={() => handleExport(selected)}
                  className="rounded bg-white/10 p-1.5 text-white hover:bg-cream-deep/70"
                  title="下载"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => handleCopy(selected)}
                  className="rounded bg-white/10 p-1.5 text-white hover:bg-cream-deep/70"
                  title="复制到剪贴板"
                >
                  {copiedId === selected.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="rounded bg-red-600/30 p-1.5 text-white hover:bg-red-600/50"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => { setSelected(null); setActiveFilter('none') }}
                  className="rounded bg-white/10 p-1.5 text-white hover:bg-cream-deep/70"
                  title="关闭"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
