/**
 * @file useSafeTimeout.ts
 * @description 安全的 setTimeout Hook — 自动注册定时器，组件卸载时统一清理
 *
 * 解决的问题：
 * - React 组件中 setTimeout 后如果组件卸载，回调仍然执行导致 "setState on unmounted component" 警告
 * - 多个 setTimeout 需要手动追踪 ID 并在 cleanup 中清理
 *
 * @example
 * ```tsx
 * const safeTimeout = useSafeTimeout()
 * safeTimeout(() => setBubble(''), 3000)
 * ```
 */

import { useCallback, useEffect, useRef } from 'react'

export function useSafeTimeout() {
  const pendingRef = useRef<Set<number>>(new Set())

  // 组件卸载时清理所有未执行的定时器
  useEffect(() => {
    const pending = pendingRef.current
    return () => {
      pending.forEach((id) => clearTimeout(id))
      pending.clear()
    }
  }, [])

  const safeTimeout = useCallback((fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      pendingRef.current.delete(id)
      fn()
    }, ms)
    pendingRef.current.add(id)
    return id
  }, [])

  const clearSafeTimeout = useCallback((id: number) => {
    clearTimeout(id)
    pendingRef.current.delete(id)
  }, [])

  return { safeTimeout, clearSafeTimeout }
}

/**
 * 简化版本：直接返回 safeTimeout 函数
 */
export function useTimeout() {
  return useSafeTimeout().safeTimeout
}
