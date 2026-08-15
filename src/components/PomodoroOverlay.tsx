/**
 * 番茄钟悬浮显示组件
 *
 * 功能概述：
 * - 宠物窗口上方悬浮显示番茄钟倒计时
 * - 圆形进度条显示剩余时间进度
 * - MM:SS格式倒计时显示
 * - 停止按钮可提前终止番茄钟
 * - 倒计时归零时显示庆祝提示，2.5秒后触发完成回调
 * - 每500ms刷新一次显示
 *
 * 核心Hooks/状态：
 * - useState: 当前时间戳（用于倒计时计算）、庆祝状态
 * - useEffect: 定时器刷新、完成检测
 */
import { useEffect, useRef, useState } from 'react'
import { Square } from 'lucide-react'

/** 番茄钟覆盖层Props */
interface PomodoroOverlayProps {
  /** 总时长（秒） */
  duration: number
  /** 开始时间戳（毫秒） */
  startedAt: number
  /** 停止回调 */
  onStop: () => void
  /** 完成回调 */
  onComplete: () => void
}

/**
 * 番茄钟悬浮倒计时
 *
 * 在宠物上方显示番茄钟进度，完成时触发庆祝动画和完成回调。
 */
export function PomodoroOverlay({ duration, startedAt, onStop, onComplete }: PomodoroOverlayProps) {
  const [now, setNow] = useState(() => Date.now())
  const [celebrating, setCelebrating] = useState(() => startedAt + duration * 1000 <= Date.now())
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  })

  useEffect(() => {
    const id = setInterval(() => {
      const nextNow = Date.now()
      setNow(nextNow)
      // 倒计时归零 → 进入庆祝状态（在定时器回调中更新状态，符合事件驱动语义）
      if (startedAt + duration * 1000 <= nextNow) {
        setCelebrating(true)
      }
    }, 500)
    return () => clearInterval(id)
  }, [startedAt, duration])

  const elapsed = Math.max(0, (now - startedAt) / 1000)
  const remaining = Math.max(0, duration - elapsed)
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0

  // 庆祝状态触发完成回调（celebrating 为单向锁存，定时器只挂载一次）
  useEffect(() => {
    if (!celebrating) return
    const t = setTimeout(() => onCompleteRef.current(), 2500)
    return () => clearTimeout(t)
  }, [celebrating])

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0')

  if (celebrating) {
    return (
      <div className="absolute left-1/2 bottom-full mb-2 -translate-x-1/2 rounded-2xl bg-gradient-to-r from-pink-400 to-amber-300 px-4 py-2 text-center text-sm font-bold text-white shadow-lg">
        🎉 完成！休息一下吧～
      </div>
    )
  }

  return (
    <div className="absolute left-1/2 bottom-full mb-2 w-44 -translate-x-1/2 rounded-2xl bg-gray-900/90 px-3 py-2 text-white shadow-lg">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-amber-300">🍅 番茄钟</span>
        <button
          onClick={onStop}
          className="flex items-center gap-1 rounded bg-red-500/80 px-1.5 py-0.5 text-[10px] hover:bg-red-500"
        >
          <Square size={10} /> 停止
        </button>
      </div>
      <div className="mb-1 text-center text-lg font-mono font-bold tabular-nums">
        {mm}:{ss}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  )
}
