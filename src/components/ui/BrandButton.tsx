/**
 * BrandButton — 统一按钮组件
 *
 * 替代散落各处的原生 <button>，统一视觉风格和可访问性。
 * 支持三种 variant：primary（暖橙实底）/ secondary（描边）/ ghost（无边框）。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface BrandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按钮变体 */
  variant?: 'primary' | 'secondary' | 'ghost'
  /** 按钮尺寸 */
  size?: 'sm' | 'md' | 'lg'
  /** 图标（放在文字左侧） */
  icon?: ReactNode
  /** 是否占满宽度 */
  fullWidth?: boolean
  /** 子元素 */
  children?: ReactNode
}

const variantClasses: Record<NonNullable<BrandButtonProps['variant']>, string> = {
  primary:
    'bg-tangerine text-white hover:bg-tangerine-deep disabled:opacity-50',
  secondary:
    'border border-ink/15 text-ink-muted hover:border-tangerine hover:text-tangerine-deep disabled:opacity-50',
  ghost:
    'text-ink-muted hover:bg-ink/5 disabled:opacity-50',
}

const sizeClasses: Record<NonNullable<BrandButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-6 py-3 text-base rounded-xl',
}

export function BrandButton({
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth,
  className = '',
  children,
  ...rest
}: BrandButtonProps) {
  return (
    <button
      {...rest}
      className={`spiritpal-focusable inline-flex items-center justify-center gap-1.5 font-medium transition-colors ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </button>
  )
}
