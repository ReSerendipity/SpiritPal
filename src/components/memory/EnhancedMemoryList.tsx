/**
 * EnhancedMemoryList — 全部记忆（EnhancedMemory）列表 + 多维筛选 + 内联编辑
 *
 * 数据源：EnhancedMemoryManager（经 MemoryEditor 搜索/更新）。
 * 位于 MemoryPanel 的「全部记忆」Tab 内，顶部为 MemoryFilterBar，
 * 每项提供铅笔按钮打开 MemoryEditModal。
 *
 * 筛选为跨组 AND：标签维度（组内 OR）+ 分类（组内 OR）+ 时间范围。
 *
 * @module components/memory/EnhancedMemoryList
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Database } from 'lucide-react'
import { getEnhancedMemoryManager, type EnhancedMemory } from '@/lib/memory/enhancedMemory'
import {
  createMemoryEditor,
  sanitizeMemoryForDisplay,
  type MemorySearchOptions,
} from '@/lib/memory/memoryEditor'
import { TAG_DIMENSION_LABEL_MAP, parseTag, type TagDimension } from '@/lib/memory/tagCategories'
import { usePetStore } from '@/stores/petStore'
import { MemoryEditModal, type MemoryFormValues } from './MemoryEditModal'
import { MemoryFilterBar } from './MemoryFilterBar'

export interface EnhancedMemoryListProps {
  /** 结果数量变化时回调（供外层 Tab 角标展示） */
  onCountChange?: (n: number) => void
}

export function EnhancedMemoryList({ onCountChange }: EnhancedMemoryListProps) {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)

  const [items, setItems] = useState<EnhancedMemory[]>([])
  const [dimensions, setDimensions] = useState<TagDimension[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [editing, setEditing] = useState<EnhancedMemory | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const editor = useMemo(() => {
    const mgr = getEnhancedMemoryManager(currentCharacterId)
    return createMemoryEditor(mgr)
  }, [currentCharacterId])

  // 加载 + 多维筛选（标签维度 AND 分类 AND 时间）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const mgr = getEnhancedMemoryManager(currentCharacterId)
      await mgr.ensureLoaded()
      const hasTime = Boolean(start || end)
      const options: MemorySearchOptions = {
        categories: categories.length > 0 ? categories : undefined,
        tagDimensions: dimensions.length > 0 ? dimensions : undefined,
        timeRange: hasTime
          ? {
              start: start ? new Date(start).getTime() : undefined,
              end: end ? new Date(end).getTime() : undefined,
            }
          : undefined,
        sortBy: 'importance',
        sortOrder: 'desc',
      }
      const result = await editor.searchMemories(options)
      if (cancelled) return
      if (result.success) {
        const list = (result.details?.memories as EnhancedMemory[]) ?? []
        setItems(list)
        onCountChange?.(list.length)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentCharacterId, editor, categories, dimensions, start, end, refreshKey, onCountChange])

  const handleSave = useCallback(
    async (values: MemoryFormValues) => {
      if (!editing) return
      setSaving(true)
      try {
        await editor.updateMemory(editing.id, {
          content: values.content,
          category: values.category,
          tags: values.tags,
          ...(values.createdAt ? { createdAt: values.createdAt } : {}),
        })
        setEditing(null)
        setRefreshKey((k) => k + 1)
      } finally {
        setSaving(false)
      }
    },
    [editing, editor],
  )

  const handleClear = useCallback(() => {
    setDimensions([])
    setCategories([])
    setStart('')
    setEnd('')
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <MemoryFilterBar
        dimensions={dimensions}
        onDimensionsChange={setDimensions}
        categories={categories}
        onCategoriesChange={setCategories}
        start={start}
        onStartChange={setStart}
        end={end}
        onEndChange={setEnd}
        onClear={handleClear}
      />

      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink-muted">
            <Database size={32} className="mx-auto mb-2 opacity-30" />
            <p>没有匹配的记忆</p>
            <p className="mt-1 text-xs text-ink-faint">调整筛选条件，或在对话中积累记忆</p>
          </div>
        ) : (
          items.map((mem) => (
            <div key={mem.id} className="flex items-start gap-2 rounded-lg border border-ink/10 bg-surface px-3 py-2">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-muted">
                    {mem.category}
                  </span>
                  <span className="text-[10px] text-ink-faint">
                    {new Date(mem.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 text-sm text-ink">{mem.user}</div>
                {mem.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {mem.tags.map((tag) => {
                      const { dimension, value } = parseTag(tag)
                      return (
                        <span
                          key={tag}
                          className="rounded bg-tangerine/10 px-1.5 py-0.5 text-[10px] text-tangerine"
                          title={dimension ? TAG_DIMENSION_LABEL_MAP[dimension] : '未归类'}
                        >
                          {dimension ? `${TAG_DIMENSION_LABEL_MAP[dimension]}·` : ''}{value}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
              <button
                onClick={() => setEditing(mem)}
                className="rounded p-1 text-ink-faint hover:bg-tangerine/10 hover:text-tangerine"
                title="编辑记忆"
                aria-label="编辑记忆"
              >
                <Pencil size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      <MemoryEditModal
        memory={editing ? sanitizeMemoryForDisplay(editing) : null}
        saving={saving}
        onCancel={() => setEditing(null)}
        onSave={(v) => void handleSave(v)}
      />
    </div>
  )
}
