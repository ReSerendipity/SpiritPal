/**
 * ExpressionSelector — 宠物表情手动切换器
 *
 * 功能概述：
 * - 枚举 EmotionManager 的全部可用表情（DEFAULT_EXPRESSIONS）
 * - 点击表情按钮 → 调用 setManualExpression 手动覆盖当前表情（优先级高于自动表情）
 * - 「恢复自动」按钮清除手动覆盖，交还自动表情系统
 * - 高亮当前手动选中项
 *
 * 设计说明：
 * - 本组件运行在宠物窗（PetWindow）上下文，直接操作 EmotionManager 单例；
 *   setManualExpression 会触发 onExpressionApply 回调（usePetSensors 已接线），
 *   因此无需跨窗口通信。
 * - 自动触发在手动覆盖期间被 EmotionManager 抑制，无需在 UI 层额外处理。
 *
 * @module components/pet/ExpressionSelector
 */

import { useState } from 'react'
import { Smile, RotateCcw } from 'lucide-react'
import { getEmotionManager, type ExpressionOption } from '@/lib/ai/emotionManager'

export interface ExpressionSelectorProps {
  /** 选中表情后回调（可选，便于外部同步状态/测试断言） */
  onSelect?: (option: ExpressionOption | null) => void
}

/**
 * 表情手动切换器
 *
 * 以按钮组形式列出所有可用表情，并提供「恢复自动」入口。
 */
export function ExpressionSelector({ onSelect }: ExpressionSelectorProps) {
  const manager = getEmotionManager()
  const expressions = manager.listAvailableExpressions()
  const [manualId, setManualId] = useState<string | null>(() => manager.getManualExpression()?.id ?? null)

  function handleSelect(option: ExpressionOption) {
    manager.setManualExpression(option)
    setManualId(option.id)
    onSelect?.(option)
  }

  function handleRestoreAuto() {
    manager.clearManualExpression()
    setManualId(null)
    onSelect?.(null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {expressions.map((opt) => {
          const active = manualId === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => handleSelect(opt)}
              aria-pressed={active}
              title={opt.name}
              className={`flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[10px] transition-colors ${
                active
                  ? 'bg-tangerine/20 text-tangerine font-medium'
                  : 'text-ink-muted hover:bg-ink/8'
              }`}
            >
              <Smile size={11} className={active ? 'text-tangerine' : 'text-ink-faint'} />
              <span>{opt.name}</span>
            </button>
          )
        })}
      </div>
      <button
        onClick={handleRestoreAuto}
        disabled={manualId === null}
        className={`flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[10px] transition-colors ${
          manualId === null
            ? 'cursor-not-allowed text-ink-faint opacity-60'
            : 'text-ink-muted hover:bg-ink/8'
        }`}
      >
        <RotateCcw size={11} />
        <span>恢复自动</span>
      </button>
    </div>
  )
}
