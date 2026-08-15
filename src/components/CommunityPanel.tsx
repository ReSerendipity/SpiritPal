/**
 * 社区形象浏览面板组件
 *
 * 功能概述：
 * - 社区形象列表浏览，支持热门/最新/评分排序
 * - 关键词搜索（形象名、作者、标签）
 * - 形象详情查看，包含预览图、描述、评分、标签
 * - .petmod文件下载与一键自动安装
 * - 5星评分功能和评论系统
 * - 本地.petmod文件上传分享到社区
 * - 分页加载
 *
 * 核心Hooks/状态：
 * - useState: 视图切换（列表/详情/上传）、加载状态、表单数据
 * - useEffect/useCallback: 数据加载、上传/下载处理
 * - useRef: 评论区滚动、文件输入引用
 *
 * 子组件：
 * - StarRating: 5星评分组件（支持只读和交互模式）
 * - CharacterCard: 社区形象卡片
 * - ListView: 列表视图（搜索、排序、分页）
 * - DetailView: 详情视图（预览、评分、评论、下载安装）
 * - UploadView: 上传视图（表单提交）
 *
 * 使用模块：
 * - communityApi: 社区API接口
 * - modManager: 模组管理器（下载后自动安装）
 * - Tauri fs/path API: 文件系统操作
 */
import { useState, useEffect, useRef } from 'react'
import {
  Search, Star, Download, Upload, ArrowLeft, ArrowRight, X, Loader2,
  MessageSquare, Send, Package, AlertCircle, CheckCircle2, Tag, User,
} from 'lucide-react'
import {
  fetchCommunityCharacters, fetchCharacterDetail, downloadCharacter,
  uploadCharacter, rateCharacter, fetchComments, addComment,
  type CommunityCharacterSummary, type CommunityCharacterDetail,
  type CommunityComment, type CharacterSort,
} from '../lib/communityApi'
import { getModManager } from '../lib/modManager'
import { invoke } from '@tauri-apps/api/core'
import { validateUploadMagic } from '../lib/uploadMagic'
import { writeFile, mkdir } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

// ============ 工具函数 ============

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// ============ 5 星评分组件 ============

/** 星级评分组件Props */
interface StarRatingProps {
  /** 当前评分值 */
  value: number
  /** 星星图标大小 */
  size?: number
  /** 是否只读模式 */
  readonly?: boolean
  /** 评分变化回调 */
  onChange?: (rating: number) => void
}

/**
 * 5星评分组件
 * 支持悬停预览、半星显示、只读和交互两种模式
 */
function StarRating({ value, size = 18, readonly = false, onChange }: StarRatingProps) {
  const [hover, setHover] = useState(0)
  const display = hover || value
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.floor(display)
        const half = !filled && star - 0.5 <= display
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            onMouseEnter={() => !readonly && setHover(star)}
            onClick={(e) => {
              e.stopPropagation()
              if (!readonly && onChange) onChange(star)
            }}
            className={`relative ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'} transition-transform`}
            style={{ width: size, height: size }}
            aria-label={`${star} 星`}
          >
            <Star
              size={size}
              className={filled ? 'fill-amber-400 text-amber-400' : half ? 'fill-amber-400/50 text-amber-400' : 'text-ink-muted'}
            />
          </button>
        )
      })}
    </div>
  )
}

// ============ 形象卡片 ============

/** 形象卡片组件Props */
interface CharacterCardProps {
  /** 社区形象摘要数据 */
  character: CommunityCharacterSummary
  /** 点击卡片回调 */
  onClick: () => void
}

/**
 * 社区形象卡片组件
 * 展示预览图、名称、作者、评分、下载数等信息
 */
function CharacterCard({ character: c, onClick }: CharacterCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-ink/10 bg-cream-deep/60 text-left transition-all hover:border-amber-400/40 hover:bg-cream-deep"
    >
      {/* 预览图（无图时用主题渐变占位） */}
      <div
        className="relative flex h-32 items-center justify-center overflow-hidden"
        style={{
          background: c.previewImage
            ? `url(${c.previewImage}) center/cover`
            : `linear-gradient(135deg, #4a5568, #2d3748)`,
        }}
      >
        {!c.previewImage && (
          <Package size={40} className="text-white/30" />
        )}
        <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          v{c.version ?? '1.0'}
        </div>
      </div>
      {/* 信息 */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="truncate text-sm font-medium text-white">{c.displayName}</div>
        <div className="flex items-center gap-1 text-xs text-ink-muted">
          <User size={10} /> <span className="truncate">{c.author}</span>
        </div>
        <div className="mt-1 line-clamp-2 text-xs text-ink-muted">{c.description}</div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <StarRating value={c.rating} size={12} readonly />
            <span className="text-xs text-ink-muted">{c.rating.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-ink-muted">
            <Download size={10} /> {c.downloadCount}
          </div>
        </div>
      </div>
    </button>
  )
}

// ============ 列表视图 ============

/** 列表视图Props */
interface ListViewProps {
  /** 打开详情页回调 */
  onOpenDetail: (id: string) => void
  /** 打开上传页回调 */
  onOpenUpload: () => void
}

/**
 * 社区形象列表视图
 * 提供搜索、排序、分页、卡片网格展示功能
 */
function ListView({ onOpenDetail, onOpenUpload }: ListViewProps) {
  const [items, setItems] = useState<CommunityCharacterSummary[]>([])
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<CharacterSort>('hot')
  const [query, setQuery] = useState<string | undefined>(undefined)
  const [queryInput, setQueryInput] = useState('')
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pageSize = 12

  useEffect(() => {
    // 数据加载：setState 延后到微任务，effect 主体不直接同步 setState
    let cancelled = false
    void Promise.resolve().then(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchCommunityCharacters(page, sort, query, pageSize)
        if (cancelled) return
        setItems(res.items)
        setTotal(res.total)
        setHasMore(res.hasMore)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [page, sort, query])

  function handleSearch() {
    setPage(1)
    setQuery(queryInput.trim() || undefined)
  }

  function handleSortChange(s: CharacterSort) {
    setPage(1)
    setSort(s)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-1 rounded-lg bg-cream-deep px-2 py-1.5">
          <Search size={14} className="text-ink-muted" />
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索形象 / 作者 / 标签…"
            className="flex-1 bg-transparent text-sm text-white placeholder-ink-muted focus:outline-none"
          />
          {queryInput && (
            <button
              onClick={() => { setQueryInput(''); setQuery(undefined); setPage(1) }}
              className="text-ink-muted hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* 排序 */}
        <div className="flex rounded-lg bg-cream-deep p-0.5">
          {([
            { key: 'hot', label: '热门' },
            { key: 'latest', label: '最新' },
            { key: 'rating', label: '评分' },
          ] as { key: CharacterSort; label: string }[]).map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleSortChange(opt.key)}
              className={`rounded-md px-3 py-1 text-xs transition-colors ${
                sort === opt.key ? 'bg-amber-400 text-gray-900' : 'text-ink hover:bg-cream-deep'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={onOpenUpload}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-amber-400"
        >
          <Upload size={14} /> 上传形象
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-ink-muted">
          <Loader2 size={24} className="animate-spin" />
          <span className="ml-2 text-sm">加载中…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-ink-muted">
          <Package size={40} className="mb-2 opacity-50" />
          <span className="text-sm">未找到形象</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((c) => (
              <CharacterCard key={c.id} character={c} onClick={() => onOpenDetail(c.id)} />
            ))}
          </div>
          {/* 分页 */}
          <div className="flex items-center justify-between pt-2 text-xs text-ink-muted">
            <span>共 {total} 个形象 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 disabled:opacity-40 hover:bg-cream-deep"
              >
                <ArrowLeft size={12} /> 上一页
              </button>
              <button
                onClick={() => setPage((p) => (hasMore ? p + 1 : p))}
                disabled={!hasMore}
                className="flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 disabled:opacity-40 hover:bg-cream-deep"
              >
                下一页 <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ============ 详情视图 ============

/** 详情视图Props */
interface DetailViewProps {
  /** 形象ID */
  characterId: string
  /** 返回列表回调 */
  onBack: () => void
}

/**
 * 社区形象详情视图
 * 展示大图预览、详细信息、评分、评论区，支持下载安装和评论发表
 */
function DetailView({ characterId, onBack }: DetailViewProps) {
  const [detail, setDetail] = useState<CommunityCharacterDetail | null>(null)
  const [comments, setComments] = useState<CommunityComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadMsg, setDownloadMsg] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const [commentInput, setCommentInput] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [userRating, setUserRating] = useState(0)
  const [ratingSubmitting, setRatingSubmitting] = useState(false)
  const commentsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 详情加载：setState 延后到微任务，effect 主体不直接同步 setState
    let cancelled = false
    void Promise.resolve().then(async () => {
      setLoading(true)
      setError(null)
      try {
        const [d, cs] = await Promise.all([
          fetchCharacterDetail(characterId),
          fetchComments(characterId),
        ])
        if (cancelled) return
        setDetail(d)
        setComments(cs)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [characterId])

  // 下载并自动调用 importPetmodFile 安装
  async function handleDownloadAndInstall() {
    if (!detail) return
    setDownloading(true)
    setDownloadMsg(null)
    try {
      const blob = await downloadCharacter(detail.id)
      // 将 Blob 写入临时文件，然后直接调用后端 import_petmod 命令安装
      // （与 modManager.importPetmodFile 内部使用相同的后端命令，跳过文件选择对话框）
      let installResult: { success: boolean; modId: string; sha256: string; error?: string; warning?: string }
      try {
        const baseDir = await appDataDir()
        const downloadsDir = await join(baseDir, 'downloads')
        try { await mkdir(downloadsDir, { recursive: true }) } catch { /* 已存在忽略 */ }
        const tempPath = await join(downloadsDir, `${detail.id}-${Date.now()}.petmod`)
        const buf = new Uint8Array(await blob.arrayBuffer())
        await writeFile(tempPath, buf)
        const modsDir = await getModManager().getModsDir()
        const r = await invoke<{ success: boolean; modId: string; sha256: string; error?: string }>('import_petmod', {
          filePath: tempPath,
          targetDir: modsDir,
        })
        installResult = r
        // 加载并安装到 modManager
        if (r.success) {
          const modMgr = getModManager()
          const modPath = await join(modsDir, r.modId)
          const loaded = await modMgr.loadModFromDirectory(modPath)
          if (loaded) {
            modMgr.installMod(loaded, r.sha256, modPath)
          } else {
            installResult.warning = '解压成功但配置加载失败'
          }
        }
      } catch {
        // 后端不可用时回退：调用 importPetmodFile（会弹出文件选择对话框）
        // 此时 blob 已下载但无法直接安装，提示用户使用模组管理面板手动导入
        const modMgr = getModManager()
        const fallback = await modMgr.importPetmodFile()
        installResult = fallback
      }
      if (installResult.success) {
        setDownloadMsg({
          type: installResult.warning ? 'warning' : 'success',
          text: installResult.warning
            ? `安装成功（有警告）：${installResult.warning}`
            : `已下载并安装：${detail.displayName}（SHA-256: ${installResult.sha256.slice(0, 12)}…）`,
        })
      } else {
        setDownloadMsg({ type: 'error', text: `安装失败：${installResult.error ?? '未知错误'}` })
      }
    } catch (e) {
      setDownloadMsg({ type: 'error', text: e instanceof Error ? e.message : '下载失败' })
    } finally {
      setDownloading(false)
    }
  }

  async function handleRate(rating: number) {
    if (!detail || ratingSubmitting) return
    setUserRating(rating)
    setRatingSubmitting(true)
    try {
      const result = await rateCharacter(detail.id, rating)
      setDetail((prev) => prev ? { ...prev, rating: result.rating, ratingCount: result.ratingCount } : prev)
    } catch {
      // 忽略评分错误，UI 已更新
    } finally {
      setRatingSubmitting(false)
    }
  }

  async function handleSubmitComment() {
    if (!detail || !commentInput.trim() || submittingComment) return
    setSubmittingComment(true)
    try {
      const newComment = await addComment(detail.id, commentInput.trim())
      setComments((prev) => [newComment, ...prev])
      setCommentInput('')
    } catch {
      // 忽略评论错误
    } finally {
      setSubmittingComment(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-ink-muted">
        <Loader2 size={24} className="animate-spin" />
        <span className="ml-2 text-sm">加载详情…</span>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-ink-muted hover:text-white">
          <ArrowLeft size={14} /> 返回列表
        </button>
        <div className="flex items-center gap-2 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error ?? '形象不存在'}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 返回 */}
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-ink-muted hover:text-white">
        <ArrowLeft size={14} /> 返回列表
      </button>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* 大图预览 */}
        <div
          className="flex h-64 w-full items-center justify-center overflow-hidden rounded-xl md:w-64"
          style={{
            background: detail.previewImage
              ? `url(${detail.previewImage}) center/cover`
              : `linear-gradient(135deg, ${detail.themeColor?.primary ?? '#4a5568'}, ${detail.themeColor?.secondary ?? '#2d3748'})`,
          }}
        >
          {!detail.previewImage && <Package size={64} className="text-white/40" />}
        </div>

        {/* 信息 */}
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{detail.displayName}</h2>
            <div className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
              <span className="flex items-center gap-1"><User size={11} /> {detail.author}</span>
              <span>·</span>
              <span>v{detail.version}</span>
              <span>·</span>
              <span>{formatSize(detail.fileSize)}</span>
            </div>
          </div>

          {/* 评分 */}
          <div className="rounded-lg bg-cream-deep/60 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StarRating value={detail.rating} size={16} readonly />
                <span className="text-sm font-medium text-amber-300">{detail.rating.toFixed(1)}</span>
                <span className="text-xs text-ink-muted">({detail.ratingCount} 人评分)</span>
              </div>
              <span className="text-xs text-ink-muted">{detail.downloadCount} 次下载</span>
            </div>
            <div className="mt-2 border-t border-ink/10 pt-2">
              <div className="mb-1 text-xs text-ink-muted">我的评分：</div>
              <StarRating
                value={userRating}
                size={20}
                onChange={handleRate}
              />
              {ratingSubmitting && <span className="ml-2 text-xs text-ink-muted">提交中…</span>}
              {userRating > 0 && !ratingSubmitting && (
                <span className="ml-2 text-xs text-green-400">已评分 {userRating} 星 ✓</span>
              )}
            </div>
          </div>

          {/* 描述 */}
          <div>
            <div className="mb-1 text-xs text-ink-muted">描述</div>
            <p className="text-sm leading-relaxed text-ink">{detail.description}</p>
          </div>

          {/* 标签 */}
          {detail.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag size={11} className="text-ink-muted" />
              {detail.tags.map((t, i) => (
                <span key={i} className="rounded-full bg-cream-deep/70 px-2 py-0.5 text-xs text-ink">{t.trim()}</span>
              ))}
            </div>
          )}

          {/* 上传时间 */}
          <div className="text-xs text-ink-muted">上传于 {formatTime(detail.uploadAt)}</div>

          {/* 下载按钮 */}
          <div className="space-y-2">
            <button
              onClick={handleDownloadAndInstall}
              disabled={downloading}
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {downloading ? '下载安装中…' : '下载并安装'}
            </button>
            {downloadMsg && (
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                  downloadMsg.type === 'success'
                    ? 'bg-green-900/30 text-green-300'
                    : downloadMsg.type === 'warning'
                    ? 'bg-amber-900/30 text-amber-300'
                    : 'bg-red-900/30 text-red-300'
                }`}
              >
                {downloadMsg.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span className="flex-1">{downloadMsg.text}</span>
                <button onClick={() => setDownloadMsg(null)} className="text-ink-muted hover:text-white">
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 评论区 */}
      <div className="space-y-3 rounded-xl bg-cream-deep/40 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <MessageSquare size={14} /> 评论 <span className="text-xs text-ink-muted">({comments.length})</span>
        </div>

        {/* 评论输入 */}
        <div className="flex items-end gap-2">
          <textarea
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            placeholder="写下你的评论…"
            rows={2}
            className="flex-1 resize-none rounded-lg bg-cream-deep/60 px-3 py-2 text-sm text-white placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmitComment()
            }}
          />
          <button
            onClick={handleSubmitComment}
            disabled={!commentInput.trim() || submittingComment}
            className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
          >
            {submittingComment ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            发表
          </button>
        </div>
        <div className="text-xs text-ink-muted">Ctrl+Enter 快捷发送</div>

        {/* 评论列表 */}
        {comments.length === 0 ? (
          <div className="py-6 text-center text-xs text-ink-muted">还没有评论，快来说点什么吧～</div>
        ) : (
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-cream-deep/40 p-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-amber-300">{c.userName}</span>
                  <span className="text-ink-muted">{formatTime(c.createdAt)}</span>
                </div>
                <p className="text-sm text-ink">{c.content}</p>
              </div>
            ))}
            <div ref={commentsEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 上传视图 ============

/** 上传视图Props */
interface UploadViewProps {
  /** 返回列表回调 */
  onBack: () => void
  /** 上传完成回调 */
  onUploaded: (id: string) => void
}

/**
 * 社区形象上传视图
 * 提供.petmod文件选择、表单填写和上传提交功能
 */
function UploadView({ onBack, onUploaded }: UploadViewProps) {
  const [file, setFile] = useState<File | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUpload() {
    if (!file) {
      setError('请选择 .petmod 文件')
      return
    }
    if (!displayName.trim()) {
      setError('请填写形象名称')
      return
    }
    // [SECURITY] 魔数校验：.petmod 必须是 zip 压缩包，阻断伪装文件上传到社区
    const magicError = await validateUploadMagic(file)
    if (magicError) {
      setError(magicError)
      return
    }
    setUploading(true)
    setError(null)
    try {
      const tags = tagsInput.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean)
      const result = await uploadCharacter({
        file,
        displayName: displayName.trim(),
        description: description.trim() || '社区分享的形象',
        author: author.trim() || '匿名用户',
        tags,
      })
      onUploaded(result.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-ink-muted hover:text-white">
        <ArrowLeft size={14} /> 返回列表
      </button>

      <h2 className="text-lg font-semibold">上传形象到社区</h2>

      <div className="space-y-3 rounded-xl bg-cream-deep/50 p-4">
        {/* 文件选择 */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">.petmod 文件</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".petmod,application/octet-stream"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) {
                setFile(f)
                if (!displayName) setDisplayName(f.name.replace(/\.petmod$/i, ''))
              }
            }}
            className="w-full text-xs text-ink file:mr-2 file:rounded file:border-0 file:bg-amber-500 file:px-3 file:py-1.5 file:text-xs file:text-gray-900 hover:file:bg-amber-400"
          />
          {file && (
            <div className="mt-1 text-xs text-ink-muted">
              已选择：{file.name} ({formatSize(file.size)})
            </div>
          )}
        </div>

        {/* 名称 */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">形象名称 *</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例如：初音未来 · 社区版"
            className="w-full rounded-lg bg-cream-deep px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>

        {/* 作者 */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">作者</label>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="匿名用户"
            className="w-full rounded-lg bg-cream-deep px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>

        {/* 描述 */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="介绍形象特色、动作数量、对话风格等…"
            className="w-full resize-none rounded-lg bg-cream-deep px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>

        {/* 标签 */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">标签（逗号分隔）</label>
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="二次元, 萌宠, 赛博"
            className="w-full rounded-lg bg-cream-deep px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onBack}
            className="rounded-lg bg-cream-deep px-4 py-2 text-sm text-ink hover:bg-blush-soft"
          >
            取消
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !file || !displayName.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? '上传中…' : '上传'}
          </button>
        </div>
      </div>

      <div className="text-xs text-ink-muted">
        上传即表示你拥有该形象的分享授权。上传后形象将出现在社区列表，可供其他用户下载、评分与评论。
      </div>
    </div>
  )
}

// ============ 主面板 ============

/**
 * 社区形象主面板
 *
 * 根据当前视图状态切换显示列表、详情或上传页面
 */
export function CommunityPanel() {
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'upload' }>({
    kind: 'list',
  })

  if (view.kind === 'detail') {
    return (
      <DetailView
        characterId={view.id}
        onBack={() => setView({ kind: 'list' })}
      />
    )
  }

  if (view.kind === 'upload') {
    return (
      <UploadView
        onBack={() => setView({ kind: 'list' })}
        onUploaded={(_id) => setView({ kind: 'list' })}
      />
    )
  }

  return (
    <ListView
      onOpenDetail={(id) => setView({ kind: 'detail', id })}
      onOpenUpload={() => setView({ kind: 'upload' })}
    />
  )
}
