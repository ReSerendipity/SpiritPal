/**
 * BrandSelect — 统一下拉选择组件
 *
 * 替代原生 <select>，统一视觉样式和焦点轮廓。
 */
import type { SelectHTMLAttributes } from 'react'

export interface BrandSelectOption {
  /** 选项值 */
  value: string
  /** 选项显示文本 */
  label: string
  /** 是否禁用 */
  disabled?: boolean
}

export interface BrandSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  /** 当前选中值 */
  value: string
  /** 选项列表 */
  options: BrandSelectOption[]
  /** 值变化回调 */
  onChange: (value: string) => void
  /** 无障碍标签 */
  'aria-label'?: string
}

export function BrandSelect({
  value,
  options,
  onChange,
  disabled,
  ...rest
}: BrandSelectProps) {
  return (
    <select
      {...rest}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-tangerine disabled:opacity-50"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
