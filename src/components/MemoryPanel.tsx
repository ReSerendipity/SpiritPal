/**
 * P3-5：记忆可视化面板
 *
 * 展示宠物的三层记忆系统：
 * 1. OwnerFacts（关于主人的事实）
 * 2. PetExperience（我们的故事）
 * 3. Diary（每日日记）
 *
 * 支持查看、删除、手动添加事实
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Trash2, Plus, Heart, BookOpen, User, Calendar, CheckSquare, XSquare, Database } from 'lucide-react'
import { EnhancedMemoryList } from '@/components/memory/EnhancedMemoryList'
import EntityGraphView from '@/components/memory/EntityGraphView'
import MemoryVisualizer from '@/components/MemoryVisualizer'
import { createBatchManager } from '@/lib/data/batchOperationManager'
import { exportMemories } from '@/lib/memory/memoryExporter'
import { getOwnerFactsManager, type OwnerFact } from '@/lib/memory/ownerFacts'
import { getDiarySystemManager, type DiaryEntry } from '@/lib/nurture/diarySystem'
import { getPetExperienceManager, type PetExperience } from '@/lib/nurture/petExperience'
import { usePetStore } from '@/stores/petStore'

type Tab = 'facts' | 'experiences' | 'diary' | 'all'

export function MemoryPanel() {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  // A-4：视图切换 —— 精简（默认，保持旧行为零回归）/ 可视化
  const [viewMode, setViewMode] = useState<'compact' | 'visual' | 'graph'>('compact')
  const [tab, setTab] = useState<Tab>('facts')
  const [facts, setFacts] = useState<OwnerFact[]>([])
  const [experiences, setExperiences] = useState<PetExperience[]>([])
  const [diaries, setDiaries] = useState<DiaryEntry[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newFactKey, setNewFactKey] = useState('')
  const [newFactValue, setNewFactValue] = useState('')
  // 「全部记忆」Tab 的结果数量角标
  const [allCount, setAllCount] = useState(0)

  // A-12：批量操作管理器（多选 + 批量删除 + 撤销快照）
  const batch = useMemo(() => createBatchManager<OwnerFact>([]), [])
  const [selVersion, setSelVersion] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showUndo, setShowUndo] = useState(false)
  const deletedSnapshot = useRef<OwnerFact[]>([])

  // 事实列表变化时同步到批量管理器（已删除项的选中态会自动失效）
  useEffect(() => {
    batch.updateItems(facts)
  }, [facts, batch])

  useEffect(() => {
    // 异步加载各层记忆（ensureLoaded 为异步操作，setState 在微任务回调中执行）
    let cancelled = false
    void (async () => {
      const factsMgr = getOwnerFactsManager(currentCharacterId)
      await factsMgr.ensureLoaded()
      if (cancelled) return
      setFacts(factsMgr.getAllFacts())

      const expMgr = getPetExperienceManager(currentCharacterId)
      await expMgr.ensureLoaded()
      if (cancelled) return
      setExperiences(expMgr.getRecent(20))

      const diaryMgr = getDiarySystemManager(currentCharacterId)
      setDiaries(diaryMgr.getRecentDiaries(7))
    })()
    return () => {
      cancelled = true
    }
  }, [currentCharacterId])

  const handleDeleteFact = useCallback(async (key: string) => {
    const mgr = getOwnerFactsManager(currentCharacterId)
    await mgr.deleteFact(key)
    setFacts(mgr.getAllFacts())
  }, [currentCharacterId])

  const handleAddFact = useCallback(async () => {
    if (!newFactKey.trim() || !newFactValue.trim()) return
    const mgr = getOwnerFactsManager(currentCharacterId)
    await mgr.upsertFact(newFactKey.trim(), newFactValue.trim(), 1.0, true)
    setFacts(mgr.getAllFacts())
    setNewFactKey('')
    setNewFactValue('')
    setShowAddForm(false)
  }, [currentCharacterId, newFactKey, newFactValue])

  // A-12：导出三层记忆（JSON / CSV / Markdown），webview 安全下载
  const handleExport = useCallback(async (format: 'json' | 'csv' | 'markdown') => {
    setExporting(true)
    try {
      const result = await exportMemories({ format, characterId: currentCharacterId })
      const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.warn('[MemoryPanel] 导出失败:', e)
    } finally {
      setExporting(false)
    }
  }, [currentCharacterId])

  // A-12：批量删除选中事实（通过 batchOperationManager），并保留快照以支持撤销
  const handleBulkDelete = useCallback(async () => {
    if (!batch.hasSelection) return
    const mgr = getOwnerFactsManager(currentCharacterId)
    const selected = batch.getSelectedItems()
    deletedSnapshot.current = selected.map((f) => ({ ...f }))
    setDeleting(true)
    try {
      const result = await batch.bulkDelete(
        (f) => f.id,
        async (id) => {
          const f = selected.find((x) => x.id === id)
          if (f) await mgr.deleteFact(f.key)
        },
      )
      if (result.successCount > 0) {
        batch.clearSelection()
        setShowUndo(true)
        const refreshed = getOwnerFactsManager(currentCharacterId)
        await refreshed.ensureLoaded()
        setFacts(refreshed.getAllFacts())
      }
    } catch (e) {
      console.warn('[MemoryPanel] 批量删除失败:', e)
    } finally {
      setDeleting(false)
      setSelVersion((v) => v + 1)
    }
  }, [batch, currentCharacterId])

  // A-12：撤销最近一次批量删除（恢复快照中的事实）
  const handleUndoDelete = useCallback(async () => {
    const mgr = getOwnerFactsManager(currentCharacterId)
    for (const f of deletedSnapshot.current) {
      await mgr.upsertFact(f.key, f.value, f.confidence, f.userProvided)
    }
    deletedSnapshot.current = []
    setShowUndo(false)
    const refreshed = getOwnerFactsManager(currentCharacterId)
    await refreshed.ensureLoaded()
    setFacts(refreshed.getAllFacts())
  }, [currentCharacterId])

  const tabButton = (t: Tab, label: string, icon: React.ReactNode, count: number) => (
    <button
      onClick={() => setTab(t)}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        tab === t
          ? 'bg-tangerine text-white'
          : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`text-xs ${tab === t ? 'text-white/70' : 'text-ink-faint'}`}>({count})</span>
    </button>
  )

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* A-4：视图切换 —— 精简（默认）/ 可视化 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setViewMode('compact')}
          className={`rounded border px-2.5 py-1 text-xs transition-colors ${
            viewMode === 'compact'
              ? 'border-pet-primary bg-pet-primary/10 text-pet-primary'
              : 'border-ink/15 text-ink-muted hover:bg-ink/5 hover:text-ink'
          }`}
        >
          精简
        </button>
        <button
          onClick={() => setViewMode('visual')}
          className={`rounded border px-2.5 py-1 text-xs transition-colors ${
            viewMode === 'visual'
              ? 'border-pet-primary bg-pet-primary/10 text-pet-primary'
              : 'border-ink/15 text-ink-muted hover:bg-ink/5 hover:text-ink'
          }`}
        >
          可视化
        </button>
        <button
          onClick={() => setViewMode('graph')}
          className={`rounded border px-2.5 py-1 text-xs transition-colors ${
            viewMode === 'graph'
              ? 'border-pet-primary bg-pet-primary/10 text-pet-primary'
              : 'border-ink/15 text-ink-muted hover:bg-ink/5 hover:text-ink'
          }`}
        >
          图谱
        </button>
      </div>

      {viewMode === 'visual' ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-ink/10">
          <MemoryVisualizer />
        </div>
      ) : viewMode === 'graph' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <EntityGraphView />
        </div>
      ) : (
        <>
      {/* A-12：工具条——导出 + 批量操作（仅事实页） */}
      <div key={`toolbar-${facts.length}`} className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-faint">导出记忆</span>
        <button
          onClick={() => void handleExport('json')}
          disabled={exporting}
          className="rounded border border-ink/15 px-2 py-1 text-xs text-ink-muted hover:bg-ink/5 hover:text-ink disabled:opacity-50"
        >
          JSON
        </button>
        <button
          onClick={() => void handleExport('csv')}
          disabled={exporting}
          className="rounded border border-ink/15 px-2 py-1 text-xs text-ink-muted hover:bg-ink/5 hover:text-ink disabled:opacity-50"
        >
          CSV
        </button>
        <button
          onClick={() => void handleExport('markdown')}
          disabled={exporting}
          className="rounded border border-ink/15 px-2 py-1 text-xs text-ink-muted hover:bg-ink/5 hover:text-ink disabled:opacity-50"
        >
          MD
        </button>
        {tab === 'facts' && (
          <>
            <span className="mx-1 h-4 w-px bg-ink/10" />
            <button
              onClick={() => { batch.toggleSelectAll(); setSelVersion((v) => v + 1) }}
              className="flex items-center gap-1 rounded border border-ink/15 px-2 py-1 text-xs text-ink-muted hover:bg-ink/5 hover:text-ink"
            >
              <CheckSquare size={14} />
              {batch.selectAll ? '取消全选' : '全选'}
            </button>
            <button
              onClick={() => void handleBulkDelete()}
              disabled={!batch.hasSelection || deleting}
              className="flex items-center gap-1 rounded border border-ink/15 px-2 py-1 text-xs text-ink-muted hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
            >
              <Trash2 size={14} />
              删除({batch.selectedCount})
            </button>
            {showUndo && (
              <button
                onClick={() => void handleUndoDelete()}
                className="flex items-center gap-1 rounded border border-tangerine/40 px-2 py-1 text-xs text-tangerine hover:bg-tangerine/10"
              >
                <XSquare size={14} />
                撤销
              </button>
            )}
          </>
        )}
      </div>

      {/* Tab 选择 */}
      <div className="flex gap-2 border-b border-ink/10 pb-3">
        {tabButton('facts', '主人画像', <User size={16} />, facts.length)}
        {tabButton('experiences', '我们的故事', <Heart size={16} />, experiences.length)}
        {tabButton('diary', '日记', <BookOpen size={16} />, diaries.length)}
        {tabButton('all', '全部记忆', <Database size={16} />, allCount)}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {/* 主人画像 Tab */}
        {tab === 'facts' && (
          <div className="space-y-2">
            {facts.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-muted">
                <User size={32} className="mx-auto mb-2 opacity-30" />
                <p>还没有关于主人的记忆</p>
                <p className="mt-1 text-xs text-ink-faint">对话中会自动提取，也可以手动添加</p>
              </div>
            ) : (
              facts.map((fact) => (
                <div key={fact.id} className="flex items-center gap-2 rounded-lg border border-ink/10 bg-surface px-3 py-2">
                  <input
                    type="checkbox"
                    checked={batch.isSelected(fact.id)}
                    onChange={() => { batch.toggleItem(fact.id); setSelVersion((v) => v + 1) }}
                    className="h-4 w-4 shrink-0 accent-tangerine"
                    aria-label={`选择事实 ${fact.key}`}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-ink-faint">{fact.key}</span>
                      {fact.userProvided && (
                        <span className="rounded bg-tangerine/10 px-1 text-[10px] text-tangerine">手动</span>
                      )}
                      <span className="text-[10px] text-ink-faint">置信度 {Math.round(fact.confidence * 100)}%</span>
                    </div>
                    <div className="mt-0.5 text-sm text-ink">{fact.value}</div>
                  </div>
                  <button
                    onClick={() => void handleDeleteFact(fact.key)}
                    className="rounded p-1 text-ink-faint hover:bg-red-50 hover:text-red-500"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}

            {/* 添加事实表单 */}
            {showAddForm ? (
              <div className="space-y-2 rounded-lg border border-ink/10 bg-surface p-3">
                <input
                  type="text"
                  placeholder="键名（如 name、birthday、preference）"
                  value={newFactKey}
                  onChange={(e) => setNewFactKey(e.target.value)}
                  className="w-full rounded border border-ink/15 px-2 py-1 text-sm outline-none focus:border-tangerine"
                />
                <input
                  type="text"
                  placeholder="值（如 小明、3月15日、喜欢喝咖啡）"
                  value={newFactValue}
                  onChange={(e) => setNewFactValue(e.target.value)}
                  className="w-full rounded border border-ink/15 px-2 py-1 text-sm outline-none focus:border-tangerine"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleAddFact()}
                    className="rounded bg-tangerine px-3 py-1 text-xs font-medium text-white hover:bg-tangerine-deep"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="rounded border border-ink/15 px-3 py-1 text-xs text-ink-muted hover:bg-ink/5"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-ink/20 py-2 text-sm text-ink-muted hover:border-tangerine hover:text-tangerine"
              >
                <Plus size={16} />
                <span>手动添加</span>
              </button>
            )}
          </div>
        )}

        {/* 我们的故事 Tab */}
        {tab === 'experiences' && (
          <div className="space-y-2">
            {experiences.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-muted">
                <Heart size={32} className="mx-auto mb-2 opacity-30" />
                <p>还没有共同经历</p>
                <p className="mt-1 text-xs text-ink-faint">喂食、玩耍、陪伴时会自动记录</p>
              </div>
            ) : (
              experiences.map((exp) => (
                <div key={exp.id} className="rounded-lg border border-ink/10 bg-surface px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${
                      exp.sentiment === 'positive' ? 'bg-green-400' :
                      exp.sentiment === 'negative' ? 'bg-red-400' : 'bg-gray-400'
                    }`} />
                    <span className="text-[10px] font-medium uppercase text-ink-faint">{exp.type}</span>
                    <span className="ml-auto text-[10px] text-ink-faint">
                      {new Date(exp.timestamp).toLocaleDateString()} {new Date(exp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-ink">{exp.description}</div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 日记 Tab */}
        {tab === 'diary' && (
          <div className="space-y-2">
            {diaries.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-muted">
                <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
                <p>还没有日记</p>
                <p className="mt-1 text-xs text-ink-faint">每天 23:30 会自动生成</p>
              </div>
            ) : (
              diaries.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-ink/10 bg-surface px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-ink-faint" />
                    <span className="text-xs font-medium text-ink-faint">{entry.date}</span>
                    <span className="ml-auto text-[10px] text-ink-faint">
                      {entry.exchangeCount} 轮对话
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-ink">{entry.summary}</div>
                  {entry.keyEvents.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.keyEvents.map((evt, i) => (
                        <span key={i} className="rounded bg-tangerine/10 px-1.5 py-0.5 text-[10px] text-tangerine">
                          {evt}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        {tab === 'all' && (
          <EnhancedMemoryList onCountChange={setAllCount} />
        )}
        </div>
        </>
      )}
    </div>
  )
}
