/**
 * MemoryFilterBar — 记忆多维筛选栏
 *
 * 三组条件，跨组 AND：
 * 1. 标签维度多选（人物/地点/事件/物品/概念，组内 OR）
 * 2. 记忆分类多选（偏好/习惯/关系/事件/情感，组内 OR）
 * 3. 时间范围（开始 / 结束 datetime-local）
 *
 * 纯受控组件，状态由 EnhancedMemoryList 持有。
 *
 * @module components/memory/MemoryFilterBar
 */

import { Filter, RotateCcw } from 'lucide-react'
import { TAG_DIMENSIONS, MEMORY_CATEGORIES, toggleInArray, type TagDimension } from '@/lib/memory/tagCategories'

export interface MemoryFilterBarProps {
  /** 已选标签维度 */
  dimensions: TagDimension[]
  onDimensionsChange: (dims: TagDimension[]) => void
  /** 已选分类 */
  categories: string[]
  onCategoriesChange: (cats: string[]) => void
  /** 开始时间（datetime-local 本地值，空串表示不限） */
  start: string
  onStartChange: (v: string) => void
  /** 结束时间 */
  end: string
  onEndChange: (v: string) => void
  /** 重置全部筛选 */
  onClear: () => void
}

function CheckPill({
  active,
  label,
  onToggle,
}: {
  active: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
        active
          ? 'border-tangerine bg-tangerine/10 text-tangerine'
          : 'border-ink/15 text-ink-muted hover:bg-ink/5 hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}

export function MemoryFilterBar({
  dimensions,
  onDimensionsChange,
  categories,
  onCategoriesChange,
  start,
  onStartChange,
  end,
  onEndChange,
  onClear,
}: MemoryFilterBarProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-medium text-ink-muted">
          <Filter size={13} />
          筛选
        </span>
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-ink-faint hover:text-tangerine"
          title="重置筛选"
        >
          <RotateCcw size={12} />
          重置
        </button>
      </div>

      {/* 标签维度 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 text-[11px] text-ink-faint">标签维度</span>
        {TAG_DIMENSIONS.map((d) => (
          <CheckPill
            key={d.value}
            active={dimensions.includes(d.value)}
            label={d.label}
            onToggle={() => onDimensionsChange(toggleInArray(dimensions, d.value))}
          />
        ))}
      </div>

      {/* 分类 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 text-[11px] text-ink-faint">分类</span>
        {MEMORY_CATEGORIES.map((c) => (
          <CheckPill
            key={c.value}
            active={categories.includes(c.value)}
            label={c.label}
            onToggle={() => onCategoriesChange(toggleInArray(categories, c.value))}
          />
        ))}
      </div>

      {/* 时间范围 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 text-[11px] text-ink-faint">时间范围</span>
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
          aria-label="开始时间"
          className="rounded border border-ink/15 bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-tangerine"
        />
        <span className="text-xs text-ink-faint">至</span>
        <input
          type="datetime-local"
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
          aria-label="结束时间"
          className="rounded border border-ink/15 bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-tangerine"
        />
      </div>
    </div>
  )
}
