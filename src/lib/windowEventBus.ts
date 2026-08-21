/**
 * @file windowEventBus.ts
 * @description 跨窗口事件总线模块
 *
 * 参考 WindowPet 的跨窗口通信机制实现，基于 Tauri v2 emit/listen API
 * 提供 pet-window、settings-window、chat-window 三窗口间的类型安全事件通信
 *
 * 核心特性：
 * 1. 基于 Tauri v2 的 emit/listen API 实现跨窗口事件通信
 * 2. 类型安全的事件定义，编译期检查事件名和载荷类型
 * 3. 支持 pet-window、settings-window、chat-window 三窗口间通信
 * 4. 自动清理监听器，防止内存泄漏
 * 5. 提供 React Hook 方便组件使用
 *
 * 主要模块：
 * - WindowLabel: 窗口标签类型
 * - 各事件 Payload 接口（ToggleVisibilityPayload、CharacterChangedPayload 等）
 * - WindowEventMap: 事件注册表（类型安全映射）
 * - WindowEventBus: 事件总线类
 * - windowEventBus: 单例实例
 * - useWindowEvent(): React Hook
 *
 * 依赖关系：
 * - @tauri-apps/api/event: Tauri 事件 API（emit/listen）
 */

import { useEffect, useRef } from 'react'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'

// ============ 窗口标签定义 ============

/** 应用中的窗口标签 */
export type WindowLabel = 'pet-window' | 'settings-window' | 'chat-window'

// ============ 事件类型定义 ============

/** 窗口可见性切换事件 */
export interface ToggleVisibilityPayload {
  /** 目标窗口 */
  target: WindowLabel
  /** 动作：show / hide / toggle */
  action: 'show' | 'hide' | 'toggle'
}

/** 角色切换事件 */
export interface CharacterChangedPayload {
  /** 新角色 ID */
  characterId: string
  /** 来源窗口 */
  source: WindowLabel
}

/** 设置更新事件 */
export interface SettingsUpdatedPayload {
  /** 更新的设置键列表 */
  changedKeys: string[]
  /** 来源窗口 */
  source: WindowLabel
}

/** 聊天消息事件 */
export interface ChatMessagePayload {
  /** 消息 ID */
  messageId: string
  /** 消息内容 */
  content: string
  /** 角色：user / assistant */
  role: 'user' | 'assistant'
  /** 来源窗口 */
  source: WindowLabel
}

/** 专注模式事件 */
export interface FocusModePayload {
  /** 是否启用专注模式 */
  enabled: boolean
  /** 来源窗口 */
  source: WindowLabel
}

/** 迷你模式事件 */
export interface MiniModePayload {
  /** 是否启用迷你模式 */
  enabled: boolean
  /** 来源窗口 */
  source: WindowLabel
}

/** 番茄钟事件 */
export interface PomodoroPayload {
  /** 动作 */
  action: 'start' | 'pause' | 'stop' | 'complete'
  /** 时长（分钟） */
  duration?: number
  /** 来源窗口 */
  source: WindowLabel
}

/** 系统空闲/活跃事件 */
export interface SystemIdlePayload {
  /** 是否空闲 */
  idle: boolean
  /** 空闲分钟数（仅空闲时有值） */
  idleMinutes?: number
}

/** 更新通知事件 */
export interface UpdateAvailablePayload {
  /** 新版本号 */
  version: string
  /** 更新说明 */
  body?: string
}

/** 全局快捷键切换事件 */
export type GlobalShortcutTogglePayload = void

/** 打开设置窗口指定标签页事件（如右键菜单「换装」直达外观/装饰页） */
export interface OpenSettingsTabPayload {
  /** 目标标签页 key（与 SettingsWindow 的 TABS 定义对齐） */
  tab: string
}

// ============ 事件注册表（类型安全）============

/**
 * 跨窗口事件注册表
 * 键为事件名，值为事件载荷类型
 * 新增事件必须在此处注册，确保类型安全
 */
export interface WindowEventMap {
  // 窗口管理
  'toggle-visibility': ToggleVisibilityPayload
  'character-changed': CharacterChangedPayload
  'settings-updated': SettingsUpdatedPayload
  'focus-mode': FocusModePayload
  'mini-mode': MiniModePayload

  // 聊天
  'chat-message': ChatMessagePayload
  'chat-opened': { source: WindowLabel }

  // 番茄钟
  'start-pomodoro-from-tray': number
  'pomodoro-event': PomodoroPayload

  // 系统
  'system-idle': number
  'system-active': void
  'global-shortcut-toggle': void

  // 更新
  'update-available': UpdateAvailablePayload

  // 设置
  'open-settings': void
  'toggle-focus-mode': boolean
  'open-settings-tab': OpenSettingsTabPayload

  // 宠物状态同步（宠物窗口 → 独立状态面板窗口）
  'pet-stats': PetStatsPayload
}

/** 宠物状态面板数据（宠物窗口周期同步到独立面板窗口） */
export interface PetStatsPayload {
  characterId: string
  /** 角色显示名 */
  name: string
  level: number
  mood: number
  hunger: number
  health: number
  coins: number
}

// ============ 事件总线类 ============

/**
 * 跨窗口事件总线
 *
 * 基于 Tauri v2 emit/listen 的类型安全事件通信系统。
 * 支持：
 *   - 跨窗口广播（emit → 所有窗口监听）
 *   - 类型安全的事件定义
 *   - 自动清理监听器
 *
 * 使用方式：
 * ```ts
 * // 发送事件
 * windowEventBus.emit('character-changed', { characterId: 'doro', source: 'settings-window' })
 *
 * // 监听事件
 * const unlisten = windowEventBus.on('character-changed', (payload) => {
 *   console.log('角色切换:', payload.characterId)
 * })
 *
 * // 清理
 * unlisten()
 * ```
 */
class WindowEventBus {
  /** 已注册的监听器取消函数列表 */
  private unlisteners: Map<string, UnlistenFn> = new Map()

  /**
   * 广播事件到所有窗口
   * @param event 事件名（必须为 WindowEventMap 中注册的键）
   * @param payload 事件载荷
   */
  async emit<K extends keyof WindowEventMap>(
    event: K,
    payload: WindowEventMap[K],
  ): Promise<void> {
    try {
      await emit(event as string, payload)
    } catch (e) {
      console.error(`[WindowEventBus] emit "${String(event)}" failed:`, e)
    }
  }

  /**
   * 监听跨窗口事件
   * @param event 事件名
   * @param handler 事件处理函数
   * @returns 取消监听函数
   */
  async on<K extends keyof WindowEventMap>(
    event: K,
    handler: (payload: WindowEventMap[K]) => void,
  ): Promise<() => void> {
    const eventKey = String(event)
    try {
      const unlisten = await listen<WindowEventMap[K]>(eventKey, (e) => {
        handler(e.payload)
      })

      // 存储取消函数，用于清理
      const listenerKey = `${eventKey}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      this.unlisteners.set(listenerKey, unlisten)

      // 返回组合取消函数
      return () => {
        unlisten()
        this.unlisteners.delete(listenerKey)
      }
    } catch (e) {
      console.error(`[WindowEventBus] on "${eventKey}" failed:`, e)
      return () => {}
    }
  }

  /**
   * 监听事件（仅触发一次）
   * @param event 事件名
   * @param handler 事件处理函数
   * @returns 取消监听函数
   */
  async once<K extends keyof WindowEventMap>(
    event: K,
    handler: (payload: WindowEventMap[K]) => void,
  ): Promise<() => void> {
    const eventKey = String(event)
    try {
      const unlisten = await listen<WindowEventMap[K]>(eventKey, (e) => {
        handler(e.payload)
        unlisten()
      })

      const listenerKey = `once-${eventKey}-${Date.now()}`
      this.unlisteners.set(listenerKey, unlisten)

      return () => {
        unlisten()
        this.unlisteners.delete(listenerKey)
      }
    } catch (e) {
      console.error(`[WindowEventBus] once "${eventKey}" failed:`, e)
      return () => {}
    }
  }

  /**
   * 清理所有已注册的监听器
   * 通常在组件卸载或应用退出时调用
   */
  cleanup(): void {
    for (const [key, unlisten] of this.unlisteners) {
      unlisten()
      this.unlisteners.delete(key)
    }
  }

  /**
   * 获取当前活跃的监听器数量
   */
  getListenerCount(): number {
    return this.unlisteners.size
  }
}

// ============ 单例导出 ============

/** 跨窗口事件总线单例 */
export const windowEventBus = new WindowEventBus()

// ============ React Hook ============

/**
 * 跨窗口事件监听 Hook
 *
 * 在 React 组件中使用，自动管理监听器生命周期：
 * - 组件挂载时注册监听
 * - 组件卸载时自动清理
 *
 * @param event 事件名
 * @param handler 事件处理函数
 * @param enabled 是否启用监听（默认 true）
 *
 * @example
 * ```tsx
 * function PetWindow() {
 *   useWindowEvent('character-changed', (payload) => {
 *     setCharacterId(payload.characterId)
 *   })
 *
 *   useWindowEvent('settings-updated', (payload) => {
 *     if (payload.changedKeys.includes('petSize')) {
 *       refreshPetSize()
 *     }
 *   })
 * }
 * ```
 */
export function useWindowEvent<K extends keyof WindowEventMap>(
  event: K,
  handler: (payload: WindowEventMap[K]) => void,
  enabled = true,
): void {
  // 使用 ref 避免频繁注册/取消
  const handlerRef = useRef(handler)

  // 在 effect 中同步最新 handler（渲染期禁止写 ref）
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!enabled) return

    let unlisten: (() => void) | null = null

    windowEventBus.on(event, (payload) => {
      handlerRef.current(payload)
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      unlisten?.()
    }
  }, [event, enabled])
}
