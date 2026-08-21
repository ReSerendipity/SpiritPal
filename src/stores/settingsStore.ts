/**
 * 应用设置状态管理 Store
 * @module stores/settingsStore
 * @description
 * 管理应用偏好设置（外观、语言、当前角色、通知等）。
 * 使用 zustand v5 + persist 中间件，localStorage 持久化。
 *
 * @see {@link ../lib/types/AppSettings} 设置类型定义
 * @see {@link ../lib/characters} 角色配置（依赖默认角色）
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AppSettings } from '../lib/types'
import { getDefaultCharacter } from '../lib/characters'

/** 默认设置 */
const DEFAULT_SETTINGS: AppSettings = {
  petSize: 1.0,
  petOpacity: 1.0,
  autoStart: false,
  startMinimized: false,
  notifications: true,
  language: 'zh',
  petForm: 'window',
  currentCharacterId: getDefaultCharacter().id,
  showWindowBorder: false,
}

/**
 * 设置 Store 状态接口
 */
interface SettingsStoreState extends AppSettings {
  /**
   * 部分更新设置
   * @param partial 要更新的设置字段
   */
  updateSettings: (partial: Partial<AppSettings>) => void

  /**
   * 切换当前角色
   * @param id 角色 ID
   */
  switchCharacter: (id: string) => void

  /**
   * 切换界面语言
   * @param lang 语言代码（zh/en/ja/ko）
   */
  setLanguage: (lang: 'zh' | 'en' | 'ja' | 'ko' | 'zh-TW') => void

  /** 重置为默认设置 */
  resetSettings: () => void
}

/**
 * 设置状态 Store Hook
 * @example
 * ```tsx
 * const language = useSettingsStore(s => s.language)
 * const updateSettings = useSettingsStore(s => s.updateSettings)
 * ```
 */
export const useSettingsStore = create<SettingsStoreState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      updateSettings: (partial) => {
        set((state) => ({ ...state, ...partial }))
      },

      switchCharacter: (id) => {
        set({ currentCharacterId: id })
      },

      setLanguage: (lang) => {
        set({ language: lang })
      },

      resetSettings: () => {
        set({ ...DEFAULT_SETTINGS })
      },
    }),
    {
      name: 'spiritpal-settings-store',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
