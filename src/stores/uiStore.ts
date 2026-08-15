/**
 * UI 全局状态管理 Store
 * @module stores/uiStore
 * @description
 * 管理 UI 相关的全局状态，包括主题、窗口可见性、模态框、Toast 通知、侧边栏等。
 * 使用 zustand v5 + persist 中间件，SQLite 持久化。
 *
 * 管理内容：
 * - 主题模式（深浅色/跟随系统）
 * - 语言设置
 * - 各窗口可见性（宠物/聊天/设置）
 * - 模态框状态及数据
 * - 侧边栏折叠状态
 * - Toast 通知队列
 * - 动画开关
 * - 宠物窗口拖拽状态
 *
 * @see {@link ../lib/themeManager/ThemeMode} 主题模式类型
 * @see {@link ../lib/db} SQLite 存储适配器
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ThemeMode } from '../lib/themeManager'
import { sqliteStorage } from '../lib/db'

// ============ 类型定义 ============

/** 模态框类型 */
export type ModalType =
  | 'settings'
  | 'shop'
  | 'memory'
  | 'achievement'
  | 'schedule'
  | 'mods'
  | 'personality'
  | 'pomodoro'
  | 'screenshot'
  | 'about'
  | 'custom-pet'
  | null

/**
 * Toast 通知消息接口
 */
export interface ToastMessage {
  /** 唯一 ID */
  id: string
  /** 消息类型 */
  type: 'success' | 'error' | 'warning' | 'info'
  /** 消息内容 */
  message: string
  /** 显示时长（毫秒，0 表示不自动关闭） */
  duration?: number
  /** 创建时间戳 */
  timestamp: number
}

// ============ UI Store 状态接口 ============

interface UIStoreState {
  /** 主题模式 */
  themeMode: ThemeMode
  /** 界面语言 */
  language: string
  /** 宠物窗口是否可见 */
  isPetWindowVisible: boolean
  /** 聊天窗口是否打开 */
  isChatWindowOpen: boolean
  /** 设置窗口是否打开 */
  isSettingsWindowOpen: boolean
  /** 当前激活的模态框 */
  activeModal: ModalType
  /** 模态框附加数据 */
  modalData: Record<string, unknown>
  /** 侧边栏是否折叠 */
  isSidebarCollapsed: boolean
  /** Toast 通知列表 */
  toasts: ToastMessage[]
  /** 是否启用动画 */
  animationsEnabled: boolean
  /** 宠物窗口是否正在拖拽 */
  isDragging: boolean

  /**
   * 设置主题模式
   * @param mode 主题模式
   */
  setThemeMode: (mode: ThemeMode) => void

  /**
   * 设置界面语言
   * @param lang 语言代码
   */
  setLanguage: (lang: string) => void

  /**
   * 设置宠物窗口可见性
   * @param visible 是否可见
   */
  setPetWindowVisible: (visible: boolean) => void

  /**
   * 打开/关闭聊天窗口
   * @param open 是否打开
   */
  setChatWindowOpen: (open: boolean) => void

  /**
   * 打开/关闭设置窗口
   * @param open 是否打开
   */
  setSettingsWindowOpen: (open: boolean) => void

  /**
   * 打开模态框
   * @param modal 模态框类型
   * @param data 附加数据（可选）
   */
  openModal: (modal: ModalType, data?: Record<string, unknown>) => void

  /** 关闭当前模态框并清空数据 */
  closeModal: () => void

  /** 切换侧边栏折叠状态 */
  toggleSidebar: () => void

  /**
   * 设置侧边栏折叠状态
   * @param collapsed 是否折叠
   */
  setSidebarCollapsed: (collapsed: boolean) => void

  /**
   * 添加 Toast 通知
   * @param toast Toast 消息（不含 id 和 timestamp，自动生成）
   */
  addToast: (toast: Omit<ToastMessage, 'id' | 'timestamp'>) => void

  /**
   * 移除指定 Toast
   * @param id Toast ID
   */
  removeToast: (id: string) => void

  /** 清空所有 Toast */
  clearToasts: () => void

  /**
   * 设置动画开关
   * @param enabled 是否启用动画
   */
  setAnimationsEnabled: (enabled: boolean) => void

  /**
   * 设置拖拽状态
   * @param dragging 是否正在拖拽
   */
  setDragging: (dragging: boolean) => void
}

/**
 * UI 状态 Store Hook
 * @example
 * ```tsx
 * const themeMode = useUIStore(s => s.themeMode)
 * const addToast = useUIStore(s => s.addToast)
 * ```
 */
export const useUIStore = create<UIStoreState>()(
  persist(
    (set, get) => ({
      themeMode: 'system',
      language: 'zh',
      isPetWindowVisible: true,
      isChatWindowOpen: false,
      isSettingsWindowOpen: false,
      activeModal: null,
      modalData: {},
      isSidebarCollapsed: false,
      toasts: [],
      animationsEnabled: true,
      isDragging: false,

      setThemeMode: (mode) => set({ themeMode: mode }),
      setLanguage: (lang) => set({ language: lang }),
      setPetWindowVisible: (visible) => set({ isPetWindowVisible: visible }),
      setChatWindowOpen: (open) => set({ isChatWindowOpen: open }),
      setSettingsWindowOpen: (open) => set({ isSettingsWindowOpen: open }),

      openModal: (modal, data = {}) => set({ activeModal: modal, modalData: data }),
      closeModal: () => set({ activeModal: null, modalData: {} }),

      toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),

      addToast: (toast) => {
        const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const newToast: ToastMessage = { ...toast, id, timestamp: Date.now() }
        set((s) => ({ toasts: [...s.toasts, newToast] }))
        // 自动移除（默认 5 秒）
        const duration = toast.duration ?? 5000
        if (duration > 0) {
          setTimeout(() => {
            get().removeToast(id)
          }, duration)
        }
      },

      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      clearToasts: () => set({ toasts: [] }),

      setAnimationsEnabled: (enabled) => set({ animationsEnabled: enabled }),
      setDragging: (dragging) => set({ isDragging: dragging }),
    }),
    {
      name: 'spiritpal-ui-store',
      storage: createJSONStorage(() => sqliteStorage),
      // 只持久化部分 UI 偏好状态，瞬态状态不持久化
      partialize: (state) => ({
        themeMode: state.themeMode,
        language: state.language,
        isSidebarCollapsed: state.isSidebarCollapsed,
        animationsEnabled: state.animationsEnabled,
      }),
    },
  ),
)
