/**
 * BrandSlider — 统一滑块组件
 *
 * 替代原生 <input type="range">，统一焦点样式和强调色。
 * 支持刻度标注和实时值显示。
 */
import type { InputHTMLAttributes } from 'react'

export interface BrandSliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /** 当前值 */
  value: number
  /** 最小值 */
  min: number
  /** 最大值 */
  max: number
  /** 步长 */
  step?: number
  /** 值变化回调 */
  onChange: (value: number) => void
  /** 格式化显示值的函数 */
  formatValue?: (value: number) => string
  /** 是否显示刻度标记 */
  showTicks?: boolean
  /** 刻度标记列表（值 + 标签） */
  ticks?: Array<{ value: number; label: string }>
}

export function BrandSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  showTicks = false,
  ticks = [],
  disabled,
  ...rest
}: BrandSliderProps) {
  return (
    <div className="w-full">
      {formatValue && (
        <div className="mb-1 flex items-center justify-between text-xs text-ink-faint">
          <span>{formatValue(min)}</span>
          <span className="font-medium text-ink-muted">{formatValue(value)}</span>
          <span>{formatValue(max)}</span>
        </div>
      )}
      <input
        {...rest}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-tangerine disabled:opacity-50"
      />
      {showTicks && ticks.length > 0 && (
        <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
          {ticks.map((t) => (
            <span key={t.value}>{t.label}</span>
          ))}
        </div>
      )}
    </div>
  )
}
