/**
 * @file useDisposable.ts
 * @description 可销毁资源管理 Hook — 统一管理需要 cleanup 的资源（EventEmitter 监听器、定时器、管理器实例）
 *
 * 解决的问题：
 * - 组件中需要注册多个监听器，cleanup 时容易遗漏某个 off/removeEventListener
 * - 多个单例管理器（BubbleManager、MusicManager 等）需要在组件卸载时 dispose
 *
 * @example
 * ```tsx
 * const { addCleanup, dispose } = useDisposable()
 *
 * useEffect(() => {
 *   const mgr = getBubbleManager()
 *   const unsub = mgr.on('event', handler)
 *   addCleanup(unsub)
 *   addCleanup(() => clearInterval(timerId))
 *   return dispose
 * }, [])
 * ```
 */

import { useCallback, useEffect, useRef } from 'react'

type CleanupFn = () => void

export function useDisposable() {
  const cleanupsRef = useRef<CleanupFn[]>([])

  const addCleanup = useCallback((fn: CleanupFn) => {
    cleanupsRef.current.push(fn)
  }, [])

  const dispose = useCallback(() => {
    const fns = cleanupsRef.current
    cleanupsRef.current = []
    // 逆序执行（后注册的先清理，符合栈语义）
    for (let i = fns.length - 1; i >= 0; i--) {
      try {
        fns[i]!()
      } catch (e) {
        console.error('[useDisposable] cleanup error:', e)
      }
    }
  }, [])

  // 组件卸载时自动清理
  useEffect(() => {
    return dispose
  }, [dispose])

  return { addCleanup, dispose }
}

/**
 * 管理一个 EventEmitter 风格的管理器，自动处理订阅和取消订阅
 */
export function useEventListener<
  T extends { on: (event: string, fn: (...args: any[]) => void) => void; off?: (event: string, fn: (...args: any[]) => void) => void; removeListener?: (event: string, fn: (...args: any[]) => void) => void }
>(
  manager: T | (() => T),
  event: string,
  handler: (...args: any[]) => void,
  deps: React.DependencyList = [],
) {
  useEffect(() => {
    const mgr = typeof manager === 'function' ? manager() : manager
    mgr.on(event, handler)
    return () => {
      const off = mgr.off ?? mgr.removeListener
      off?.call(mgr, event, handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
