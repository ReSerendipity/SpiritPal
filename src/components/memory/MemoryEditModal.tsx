/**
 * MemoryEditModal — 记忆手动编辑弹窗
 *
 * 从记忆列表项的「铅笔」按钮打开，可编辑：
 * - 记忆文本（textarea）
 * - 标签（带维度选择的 tag input，可添加 / 删除）
 * - 时间（datetime-local 选择器，保存时转回 ISO）
 * - 分类（下拉：偏好/习惯/关系/事件/情感）
 *
 * 保存由父组件调用 MemoryEditor.updateMemory，本组件只负责表单状态与回显。
 *
 * @module components/memory/MemoryEditModal
 */

import { useEffect, useState } from 'react'
import { X, Plus, Pencil } from 'lucide-react'
import { BrandButton } from '@/components/ui/BrandButton'
import { BrandInput } from '@/components/ui/BrandInput'
import { BrandSelect } from '@/components/ui/BrandSelect'
import type { DisplayMemory } from '@/lib/memory/memoryEditor'
import {
  TAG_DIMENSIONS,
  TAG_DIMENSION_LABEL_MAP,
  MEMORY_CATEGORIES,
  makeTag,
  parseTag,
  type TagDimension,
} from '@/lib/memory/tagCategories'

/** 表单提交给父组件的更新载荷 */
export interface MemoryFormValues {
  content: string
  category: string
  tags: string[]
  /** ISO 时间字符串；空串表示未改动 */
  createdAt: string
}

export interface MemoryEditModalProps {
  /** 待编辑记忆；null 时弹窗关闭 */
  memory: DisplayMemory | null
  /** 保存中（禁用按钮） */
  saving?: boolean
  onCancel: () => void
  onSave: (values: MemoryFormValues) => void
}

/** ISO 字符串 → datetime-local 输入框值（本地时区） */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local 输入框值 → ISO 字符串 */
function localInputToIso(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

export function MemoryEditModal({ memory, saving = false, onCancel, onSave }: MemoryEditModalProps) {
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<string>(MEMORY_CATEGORIES[0]!.value)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [tagDimension, setTagDimension] = useState<TagDimension>('person')
  const [createdAtLocal, setCreatedAtLocal] = useState('')

  // memory 切换时用其值回填表单
  useEffect(() => {
    if (!memory) return
    setContent(memory.user)
    setCategory(memory.category || MEMORY_CATEGORIES[0]!.value)
    setTags([...memory.tags])
    setTagInput('')
    setTagDimension('person')
    setCreatedAtLocal(isoToLocalInput(memory.created_at))
  }, [memory])

  if (!memory) return null

  const handleAddTag = () => {
    const trimmed = tagInput.trim()
    if (!trimmed) return
    const next = makeTag(tagDimension, trimmed)
    if (next && !tags.includes(next)) setTags((prev) => [...prev, next])
    setTagInput('')
  }

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  const handleSubmit = () => {
    onSave({
      content,
      category,
      tags,
      createdAt: localInputToIso(createdAtLocal),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="编辑记忆"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-ink/10 bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Pencil size={16} className="text-tangerine" />
            编辑记忆
          </h2>
          <button
            onClick={onCancel}
            className="rounded p-1 text-ink-faint hover:bg-ink/5 hover:text-ink"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* 记忆文本 */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">记忆内容</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-tangerine"
              placeholder="记录了什么……"
            />
          </label>

          {/* 分类 */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">分类</span>
            <BrandSelect
              aria-label="分类"
              value={category}
              onChange={setCategory}
              options={MEMORY_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            />
          </label>

          {/* 标签：维度选择 + 输入 + 添加 */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">标签</span>
            <div className="flex gap-2">
              <div className="w-28 shrink-0">
                <BrandSelect
                  aria-label="标签维度"
                  value={tagDimension}
                  onChange={(v) => setTagDimension(v as TagDimension)}
                  options={TAG_DIMENSIONS.map((d) => ({ value: d.value, label: d.label }))}
                />
              </div>
              <div className="flex-1">
                <BrandInput
                  aria-label="标签内容"
                  value={tagInput}
                  onChange={setTagInput}
                  placeholder="如：妈妈、公司、生日"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddTag()
                    }
                  }}
                />
              </div>
              <BrandButton variant="secondary" size="sm" icon={<Plus size={14} />} onClick={handleAddTag}>
                添加
              </BrandButton>
            </div>
            {/* 已有标签列表 */}
            {tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.map((tag) => {
                  const { dimension, value } = parseTag(tag)
                  return (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-tangerine/10 px-2 py-0.5 text-xs text-tangerine"
                    >
                      {dimension && (
                        <span className="text-[10px] opacity-70">
                          {TAG_DIMENSION_LABEL_MAP[dimension]}
                        </span>
                      )}
                      <span>{value}</span>
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-0.5 text-tangerine/60 hover:text-tangerine"
                        aria-label={`删除标签 ${value}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* 时间 */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">发生时间</span>
            <input
              type="datetime-local"
              value={createdAtLocal}
              onChange={(e) => setCreatedAtLocal(e.target.value)}
              className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-tangerine"
            />
          </label>

          {/* 操作按钮 */}
          <div className="mt-1 flex justify-end gap-2">
            <BrandButton variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              取消
            </BrandButton>
            <BrandButton variant="primary" size="sm" onClick={handleSubmit} disabled={saving || !content.trim()}>
              {saving ? '保存中…' : '保存'}
            </BrandButton>
          </div>
        </div>
      </div>
    </div>
  )
}
