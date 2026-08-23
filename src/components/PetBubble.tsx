/**
 * 宠物对话气泡组件
 *
 * 功能概述：
 * - 在宠物上方显示短消息气泡
 * - 支持自定义显示时长（默认3秒）
 * - 自动消失动画（淡出+上移）
 * - 带三角尾巴指向宠物
 * - pointer-events-none不阻挡交互
 *
 * 核心Hooks/状态：
 * - useState: 关闭动画状态
 * - useEffect: 定时器控制自动关闭
 */
import { useEffect, useState, type Ref } from 'react'

/** 气泡组件Props */
interface PetBubbleProps {
  /** 显示的消息文本 */
  message: string
  /** 关闭回调 */
  onClose: () => void
  /** 显示时长（毫秒，默认3000） */
  duration?: number
  /** 测量用 ref（挂在气泡外层定位 div 上，宠物窗口据此读取气泡实际尺寸做窗口自适应） */
  measureRef?: Ref<HTMLDivElement>
  /** 定位锚点：above-pet=贴宠物头顶上方（默认）；top-center=窗口顶部正中对话区（展开态） */
  anchor?: 'above-pet' | 'top-center'
}

/**
 * 宠物对话气泡
 *
 * 在宠物头顶显示消息，指定时长后自动淡出消失。
 */
export function PetBubble({ message, onClose, duration = 3000, measureRef, anchor = 'above-pet' }: PetBubbleProps) {
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setClosing(true), duration)
    const t2 = setTimeout(() => onClose(), duration + 300)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [duration, onClose])

  return (
    <div
      ref={measureRef}
      className={`absolute left-1/2 -translate-x-1/2 transition-all duration-300 ease-out ${
        anchor === 'top-center' ? 'top-0' : 'bottom-full mb-2'
      } ${
        closing ? 'opacity-0 -translate-y-1' : 'opacity-100'
      }`}
      style={{ pointerEvents: 'none' }}
    >
      <div className="relative max-w-[220px] whitespace-pre-wrap break-words rounded-2xl bg-white px-3 py-2 text-center text-sm text-gray-800 shadow-lg">
        {message}
        {/* 气泡尾巴 */}
        <div className="absolute left-1/2 -bottom-1 h-0 w-0 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white" />
      </div>
    </div>
  )
}
