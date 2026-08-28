/**
 * @file typedEventEmitter.ts
 * @description 浏览器安全的极简（Typed）EventEmitter（Gotcha #31 修复配套）
 *
 * 背景：webview 不是 Node 环境，静态 `import { EventEmitter } from 'events'`
 * 会让 Vite 把模块 externalize，进 bundle 即构建失败（agentStateLayer/mcpHooks
 * 在接线后首次暴露）。本实现覆盖全仓 7 个模块实际用到的 API 子集：
 * on / once / off / removeListener / removeAllListeners / emit / listenerCount。
 *
 * 类型：与 Node 一致支持「接口声明合并 + 事件映射」的类型化用法——
 * `class X extends TypedEventEmitter<MyEvents> {}`，其中
 * `interface MyEvents { 'done': (result: string) => void }`；
 * 不声明映射时退化为宽松模式（事件名为 string，监听器参数不受约束），
 * 与 Node 默认 `(...args: any[]) => void` 行为等价。
 *
 * 与 Node 行为的差异（有意为之）：
 * - 监听器抛异常时 console.error 并继续执行后续监听器（Node 会中断并冒泡到
 *   process）；桌面宠物 UI 事件不允许单个坏监听器阻断整个事件链。
 * - `off(原始 listener)` 可以移除对应的 once 包装（Node 做不到这点）。
 */

/** 最宽监听器签名：任何具体签名都可赋给它（参数逆变，never 为底类型） */
export type AnyListener = (...args: never[]) => void
/** 宽松事件映射（未声明事件映射时的默认值） */
export type LooseEventMap = { [event: string]: AnyListener }

export class TypedEventEmitter<T extends Record<string, AnyListener> = LooseEventMap> {
  private listeners = new Map<string, Set<AnyListener>>()
  /** 原始 listener → once 包装（支持用原始引用注销） */
  private onceWrappers = new WeakMap<AnyListener, AnyListener>()

  addListener<K extends keyof T & string>(event: K, listener: T[K]): this {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return this
  }

  on<K extends keyof T & string>(event: K, listener: T[K]): this {
    return this.addListener(event, listener)
  }

  once<K extends keyof T & string>(event: K, listener: T[K]): this {
    const wrapper = ((...args: never[]) => {
      this.removeListener(event, wrapper as T[K])
      this.onceWrappers.delete(listener)
      ;(listener as unknown as (...a: unknown[]) => void)(...args)
    }) as T[K]
    this.onceWrappers.set(listener, wrapper)
    return this.addListener(event, wrapper)
  }

  removeListener<K extends keyof T & string>(event: K, listener: T[K]): this {
    const set = this.listeners.get(event)
    if (!set) return this
    set.delete(listener)
    const wrapped = this.onceWrappers.get(listener)
    if (wrapped) {
      set.delete(wrapped)
      this.onceWrappers.delete(listener)
    }
    if (set.size === 0) this.listeners.delete(event)
    return this
  }

  off<K extends keyof T & string>(event: K, listener: T[K]): this {
    return this.removeListener(event, listener)
  }

  removeAllListeners(event?: keyof T & string): this {
    if (event === undefined) {
      this.listeners.clear()
    } else {
      this.listeners.delete(event)
    }
    return this
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }

  eventNames(): string[] {
    return [...this.listeners.keys()]
  }

  /**
   * 触发事件。签名保持宽松（`...args: unknown[]`）：
   * 具体监听器签名经参数逆变可赋给 AnyListener，类型化映射的参数校验由
   * on/once 侧承担；宽松模式下与 Node 默认行为等价。
   */
  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event)
    if (!set || set.size === 0) return false
    for (const listener of [...set]) {
      try {
        ;(listener as unknown as (...a: unknown[]) => void)(...args)
      } catch (err) {
        console.error(`[EventEmitter] 事件 "${String(event)}" 监听器异常:`, err)
      }
    }
    return true
  }
}

/** 兼容别名：原 `import { EventEmitter } from 'events'` 改造后的惯用名 */
export const EventEmitter = TypedEventEmitter
