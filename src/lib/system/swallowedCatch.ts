/**
 * @file swallowedCatch.ts
 * @description M-2 修复：替换前端 `.catch(() => {})` 静默吞错模式
 *
 * 提供安全的 catch handler，在静默吞错时记录 console.warn，
 * 避免安全异常被完全隐藏。
 */

/**
 * 创建一个记录错误的 catch handler（不抛出，不阻断业务）
 *
 * @param context 错误来源描述（如 "set_tray_icon" / "remove_click_through"）
 * @returns catch handler 函数
 *
 * @example
 * ```ts
 * // 之前：
 * invoke('set_tray_icon', { state }).catch(() => {})
 *
 * // 之后：
 * import { swallowedCatch } from '@/lib/system/swallowedCatch'
 * invoke('set_tray_icon', { state }).catch(swallowedCatch('set_tray_icon'))
 * ```
 */
export function swallowedCatch(context: string): (e: unknown) => void {
  return (e: unknown) => {
    if (e instanceof Error && e.message) {
      console.warn(`[swallowedCatch] ${context}:`, e.message)
    } else {
      console.warn(`[swallowedCatch] ${context}:`, e)
    }
  }
}

/**
 * 安全执行异步操作，捕获错误并记录（不抛出）
 *
 * @param fn 异步函数
 * @param context 错误来源描述
 *
 * @example
 * ```ts
 * import { safeRun } from '@/lib/system/swallowedCatch'
 * safeRun(() => invoke('set_tray_icon', { state }), 'set_tray_icon')
 * ```
 */
export async function safeRun<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[safeRun] ${context}:`, e instanceof Error ? e.message : e)
    return undefined
  }
}
