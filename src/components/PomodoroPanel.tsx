/**
 * 番茄钟设置面板组件
 *
 * 功能概述：
 * - 提供专注时长选择（15/25/45/60分钟四档）
 * - 一键开始番茄钟
 * - 显示当前是否有番茄钟进行中
 * - 可选的关闭按钮
 *
 * 核心Hooks/状态：
 * - useState: 选中的时长
 */
import { useState } from 'react'
import { Timer, Play } from 'lucide-react'

/** 番茄钟面板Props */
interface PomodoroPanelProps {
  /** 是否有番茄钟正在进行 */
  active: boolean
  /** 开始番茄钟回调（参数：分钟数） */
  onStart: (minutes: number) => void
  /** 关闭面板回调（可选） */
  onClose?: () => void
}

const DURATIONS = [15, 25, 45, 60]

/**
 * 番茄钟启动面板
 *
 * 提供时长选择和开始按钮，用于启动番茄钟专注模式。
 */
export function PomodoroPanel({ active, onStart, onClose }: PomodoroPanelProps) {
  const [selected, setSelected] = useState(25)

  return (
    <div className="w-56 rounded-xl bg-surface/95 p-3 text-white shadow-xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Timer size={16} className="text-amber-300" /> 番茄钟
      </div>

      <div className="mb-3 text-xs text-ink-muted">选择专注时长（分钟）</div>

      <div className="mb-3 grid grid-cols-4 gap-1">
        {DURATIONS.map((d) => (
          <button
            key={d}
            onClick={() => setSelected(d)}
            className={`rounded-md py-1.5 text-xs transition-colors ${
              selected === d
                ? 'bg-amber-400 text-gray-900'
                : 'bg-cream-deep text-ink hover:bg-blush-soft'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <button
        onClick={() => onStart(selected)}
        disabled={active}
        className="flex w-full items-center justify-center gap-1 rounded-lg bg-green-600 py-2 text-sm font-medium hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Play size={14} /> {active ? '进行中…' : '开始专注'}
      </button>

      {onClose && (
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-lg bg-cream-deep py-1.5 text-xs text-ink hover:bg-blush-soft"
        >
          关闭
        </button>
      )}
    </div>
  )
}
