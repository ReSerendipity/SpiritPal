/**
 * BrandSwitch — 统一开关组件
 *
 * 替代原生 <input type="checkbox"> 和散落各处的手写 toggle。
 * 使用 role="switch" + aria-checked 满足 WCAG 可访问性要求。
 */
import type { ButtonHTMLAttributes } from 'react'

export interface BrandSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** 当前是否开启 */
  checked: boolean
  /** 切换回调 */
  onChange: (checked: boolean) => void
  /** 无障碍标签 */
  'aria-label': string
}

export function BrandSwitch({
  checked,
  onChange,
  disabled,
  ...rest
}: BrandSwitchProps) {
  return (
    <button
      {...rest}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`spiritpal-focusable relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-tangerine' : 'bg-ink/20'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          checked ? 'left-5' : 'left-0.5'
        }`}
        aria-hidden="true"
      />
    </button>
  )
}
