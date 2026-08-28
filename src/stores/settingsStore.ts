/**
 * 应用设置状态管理 Store
 * @module stores/settingsStore
 * @description
 * 管理应用偏好设置（外观、语言、当前角色、通知等）。
 * 使用 zustand v5 + persist 中间件，AES-256-GCM 加密 localStorage 持久化。
 *
 * 安全说明（H-1 修复）：
 * - 偏好设置通过 Rust 端 encrypt_data/decrypt_data 命令加密后写入 localStorage
 * - 密钥由机器 ID 派生（PBKDF2-HMAC-SHA256，100,000 次迭代）
 * - Tauri 不可用时（开发/测试环境）降级为明文存储 + console.warn
 *
 * @see {@link ../lib/types/AppSettings} 设置类型定义
 * @see {@link ../lib/characters} 角色配置（依赖默认角色）
 * @see {@link ../lib/encryptedStorage} 加密存储适配器
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AppSettings } from '../lib/types'
import { getDefaultCharacter } from '../lib/characters'
import { encryptedStorage } from '../lib/encryptedStorage'

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
  statusCardMode: 'off',
  edgeSnapEnabled: true,
  // A-5：静默模式已由 silentModeManager 统一接管（手动/临时/计划/会议/专注）。
  // 以下两个字段为早期实现遗留，保持占位以兼容持久化 schema，不再消费。
  silentModeEnabled: false,
  silentModeDuration: null,
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
        // 同步 index.html lang 属性以支持无障碍工具与浏览器语言检测
        const langMap: Record<string, string> = { 'zh': 'zh-CN', 'en': 'en-US', 'ja': 'ja-JP', 'ko': 'ko-KR', 'zh-TW': 'zh-TW' }
        try { document.documentElement.lang = langMap[lang] ?? 'zh-CN' } catch { /* no-op */ }
      },

      resetSettings: () => {
        set({ ...DEFAULT_SETTINGS })
      },
    }),
    {
      name: 'spiritpal-settings-store',
      storage: createJSONStorage(() => encryptedStorage),
      // H-1 修复：版本迁移 — 旧版明文 localStorage 数据自动兼容
      // encryptedStorage.getItem 检测到无 ENC2: 前缀时直接返回明文（旧数据）
      version: 1,
      migrate: (persistedState: unknown, _version: number) => {
        // version 0 = 旧版明文 localStorage，直接兼容
        // version 1 = 加密 localStorage
        return persistedState as SettingsStoreState
      },
    },
  ),
)
