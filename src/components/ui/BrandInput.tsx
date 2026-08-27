/**
 * BrandInput — 统一文本输入组件
 *
 * 替代散落各处的原生 <input>，统一视觉样式、焦点轮廓和错误状态。
 * 支持密码可见性切换（type=password 时自动显示切换按钮）。
 */
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

export interface BrandInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /** 当前值 */
  value: string
  /** 值变化回调 */
  onChange: (value: string) => void
  /** 无障碍标签 */
  'aria-label'?: string
  /** 是否显示错误状态 */
  error?: boolean
}

export function BrandInput({
  value,
  onChange,
  type = 'text',
  error = false,
  ...rest
}: BrandInputProps) {
  const [showPassword, setShowPassword] = useState(false)
  const isPassword = type === 'password'
  const effectiveType = isPassword && showPassword ? 'text' : type

  return (
    <div className="relative w-full">
      <input
        {...rest}
        type={effectiveType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-tangerine ${
          error ? 'ring-1 ring-error' : ''
        } ${isPassword ? 'pr-10' : ''}`}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setShowPassword((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
          aria-label={showPassword ? '隐藏密码' : '显示密码'}
          tabIndex={-1}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      )}
    </div>
  )
}
