/**
 * 宠物面板共享小组件（窗口形态与桌面漫游形态共用）
 *
 * 从 PetWindow.tsx 抽取：动作列表按钮（ActionButton/ActionRow）、状态卡行（StatRow/tierColor）。
 * 纯展示组件，无业务逻辑，两个窗口形态复用避免重复维护。
 */
import type React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/** 状态卡单行统计项 */
export function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span className="text-[10px]">{label}</span>
      <span className="ml-auto tabular-nums text-[10px] text-ink-faint">{Math.round(value)}</span>
    </div>
  )
}

/** 数值 → 状态色语义 Token（≥70 好 / ≥40 中 / <40 差） */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数工具，与小组件同文件导出供 PetWindow 复用
export function tierColor(v: number): string {
  if (v >= 70) return 'var(--color-stat-good)'
  if (v >= 40) return 'var(--color-stat-mid)'
  return 'var(--color-stat-bad)'
}

/** 展开态动作列表单行按钮 */
export function ActionButton({
  icon,
  label,
  onClick,
  expanded = false,
  children,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  expanded?: boolean
  children?: React.ReactNode
}) {
  return (
    <div>
      <button
        onClick={onClick}
        aria-label={label}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[11px] text-ink transition-colors hover:bg-ink/8"
      >
        <span className="text-ink-muted" style={{ display: 'inline-flex' }}>{icon}</span>
        <span>{label}</span>
        {expanded
          ? <ChevronDown size={11} className="ml-auto text-ink-faint" />
          : <ChevronRight size={11} className="ml-auto text-ink-faint" />}
      </button>
      {expanded && <div className="ml-2.5 border-l border-ink/10 pl-1">{children}</div>}
    </div>
  )
}

/** 展开态动作列表子项行（喂食/番茄钟/切换角色） */
export function ActionRow({
  onClick,
  highlight = false,
  children,
}: {
  onClick: () => void
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={typeof children === 'string' ? children : undefined}
      className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-[3px] transition-colors ${
        highlight ? 'bg-tangerine/15 text-ink font-medium' : 'text-ink-muted hover:bg-ink/8'
      }`}
    >
      {children}
    </button>
  )
}
