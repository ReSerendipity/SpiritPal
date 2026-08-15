/**
 * 标签页导航状态管理 Store
 * @module stores/tabStore
 * @description
 * 管理设置窗口和聊天窗口的标签页导航状态，支持标签页历史返回功能。
 *
 * 标签页列表：
 * - general: 常规设置
 * - character: 角色设置
 * - ai: AI 配置
 * - appearance: 外观主题
 * - nurturing: 养成设置
 * - mods: 模组管理
 * - memory: 记忆管理
 * - schedule: 日程管理
 * - about: 关于
 */

import { create } from 'zustand'

// ============ 标签页类型 ============

/** 设置窗口标签页类型 */
export type SettingsTab =
  | 'general'
  | 'character'
  | 'ai'
  | 'appearance'
  | 'nurturing'
  | 'mods'
  | 'memory'
  | 'schedule'
  | 'about'

/**
 * 标签页元信息接口
 */
export interface TabMeta {
  /** 标签页 ID */
  id: SettingsTab
  /** i18n 翻译键 */
  labelKey: string
  /** 图标名称（可选） */
  icon?: string
}

/** 设置窗口标签页配置列表 */
export const SETTINGS_TABS: TabMeta[] = [
  { id: 'general',    labelKey: 'settings.tab.general',    icon: 'settings' },
  { id: 'character',  labelKey: 'settings.tab.character',  icon: 'pet' },
  { id: 'ai',         labelKey: 'settings.tab.ai',         icon: 'brain' },
  { id: 'appearance', labelKey: 'settings.tab.appearance', icon: 'palette' },
  { id: 'nurturing',  labelKey: 'settings.tab.nurturing',  icon: 'heart' },
  { id: 'mods',       labelKey: 'settings.tab.mods',       icon: 'puzzle' },
  { id: 'memory',     labelKey: 'settings.tab.memory',     icon: 'database' },
  { id: 'schedule',   labelKey: 'settings.tab.schedule',   icon: 'calendar' },
  { id: 'about',      labelKey: 'settings.tab.about',      icon: 'info' },
]

// ============ Tab Store 状态接口 ============

interface TabStoreState {
  /** 当前激活的设置标签页 */
  activeSettingsTab: SettingsTab
  /** 聊天窗口激活的标签 */
  activeChatTab: 'chat' | 'schedule' | 'memory'
  /** 标签页历史（用于返回，最多保留 10 步） */
  tabHistory: SettingsTab[]

  /**
   * 设置激活的设置标签页
   * @param tab 目标标签页
   */
  setActiveSettingsTab: (tab: SettingsTab) => void

  /**
   * 设置聊天窗口激活标签
   * @param tab 聊天标签页
   */
  setActiveChatTab: (tab: 'chat' | 'schedule' | 'memory') => void

  /** 返回上一个标签页（从历史恢复） */
  goBack: () => void
}

/**
 * 标签页状态 Store Hook
 * @example
 * ```tsx
 * const activeTab = useTabStore(s => s.activeSettingsTab)
 * const setActiveTab = useTabStore(s => s.setActiveSettingsTab)
 * ```
 */
export const useTabStore = create<TabStoreState>()((set, get) => ({
  activeSettingsTab: 'general',
  activeChatTab: 'chat',
  tabHistory: [],

  setActiveSettingsTab: (tab) => {
    const { activeSettingsTab, tabHistory } = get()
    if (tab === activeSettingsTab) return
    set({
      activeSettingsTab: tab,
      tabHistory: [...tabHistory, activeSettingsTab].slice(-10), // 最多保留 10 步历史
    })
  },

  setActiveChatTab: (tab) => set({ activeChatTab: tab }),

  goBack: () => {
    const { tabHistory } = get()
    if (tabHistory.length === 0) return
    const prev = tabHistory[tabHistory.length - 1]
    set({
      activeSettingsTab: prev,
      tabHistory: tabHistory.slice(0, -1),
    })
  },
}))
