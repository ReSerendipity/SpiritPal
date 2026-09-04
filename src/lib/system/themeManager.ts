/**
 * @file themeManager.ts
 * @description 主题管理器模块 — 深浅色主题检测、切换与持久化
 *
 * 核心特性：
 * - 通过 matchMedia('(prefers-color-scheme: dark)') 检测系统主题
 * - 支持三种模式：'light' | 'dark' | 'system'（跟随系统）
 * - 主题偏好持久化到 localStorage（移动端/桌面端共享）
 * - 通过 data-theme 属性应用到 <html>，供 Tailwind CSS 读取
 * - 提供订阅机制：主题变化时通知所有监听者
 * - 主题预览模式：临时切换不持久化，方便用户预览
 * - 运行时热切换：无需重启即可切换主题，支持平滑过渡动画
 *
 * Chapter 8 增强：多角色主题系统
 * - 四种终端主题风格（light / dark / sakura / ocean）
 * - 每个角色独立记忆主题偏好
 * - 角色切换时平滑过渡主题
 * - 自定义 CSS 变量支持
 *
 * F7 移动端：支持系统主题跟随 + 手动切换深浅色
 *
 * 主要模块：
 * - ThemeMode/EffectiveTheme/TerminalTheme: 主题类型定义
 * - TerminalThemeConfig: 终端主题配置接口
 * - TERMINAL_THEMES: 四种预置主题配置
 * - ThemeManager: 主题管理器类（单例）
 * - themeManager: 全局单例导出
 * - useThemeSubscription(): React Hook 用于组件订阅
 *
 * 依赖关系：无外部依赖（使用浏览器原生 API）
 *
 * 核心接口：
 * - ThemeManager.init(): 初始化主题管理器
 * - ThemeManager.setMode(): 设置主题模式
 * - ThemeManager.toggle(): 切换深浅色
 * - ThemeManager.setTerminalTheme(): 设置终端主题
 * - ThemeManager.switchCharacterTheme(): 切换角色时自动切换主题
 * - ThemeManager.preview()/exitPreview(): 主题预览
 * - ThemeManager.hotSwitch(): 运行时热切换
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type EffectiveTheme = 'light' | 'dark'

/** Chapter 8 新增：终端主题风格（四种） */
export type TerminalTheme = 'light' | 'dark' | 'sakura' | 'ocean'

/** Chapter 8 新增：主题配置（包含颜色变量） */
export interface TerminalThemeConfig {
  /** 主题 ID */
  id: TerminalTheme
  /** 主题显示名称 */
  name: string
  /** 基础主题（light 或 dark，用于 Tailwind 判断） */
  baseTheme: EffectiveTheme
  /** CSS 变量覆盖 */
  cssVars: Record<string, string>
}

/** 四种终端主题定义 */
export const TERMINAL_THEMES: Record<TerminalTheme, TerminalThemeConfig> = {
  light: {
    id: 'light',
    name: '明亮',
    baseTheme: 'light',
    cssVars: {
      '--pet-primary': '#3b82f6',
      '--pet-secondary': '#6366f1',
      '--pet-bg': '#ffffff',
      '--pet-text': '#1f2937',
      '--pet-accent': '#f59e0b',
    },
  },
  dark: {
    id: 'dark',
    name: '暗黑',
    baseTheme: 'dark',
    cssVars: {
      '--pet-primary': '#60a5fa',
      '--pet-secondary': '#818cf8',
      '--pet-bg': '#111827',
      '--pet-text': '#f9fafb',
      '--pet-accent': '#fbbf24',
    },
  },
  sakura: {
    id: 'sakura',
    name: '樱花',
    baseTheme: 'light',
    cssVars: {
      '--pet-primary': '#ec4899',
      '--pet-secondary': '#f472b6',
      '--pet-bg': '#fdf2f8',
      '--pet-text': '#831843',
      '--pet-accent': '#fb7185',
    },
  },
  ocean: {
    id: 'ocean',
    name: '海洋',
    baseTheme: 'dark',
    cssVars: {
      '--pet-primary': '#06b6d4',
      '--pet-secondary': '#22d3ee',
      '--pet-bg': '#0c4a6e',
      '--pet-text': '#ecfeff',
      '--pet-accent': '#67e8f9',
    },
  },
}

const THEME_STORAGE_KEY = 'spiritpal-theme-mode'
/** Chapter 8 新增：角色-主题关联存储 key */
const CHARACTER_THEME_STORAGE_KEY = 'spiritpal-character-themes'
/** Chapter 8 新增：当前终端主题存储 key */
const TERMINAL_THEME_STORAGE_KEY = 'spiritpal-terminal-theme'

// 单例：全局主题管理器
class ThemeManager {
  private currentMode: ThemeMode = 'system'
  private currentEffective: EffectiveTheme = 'light'
  private listeners: Set<(theme: EffectiveTheme, mode: ThemeMode) => void> = new Set()
  private mediaQuery: MediaQueryList | null = null
  private initialized = false

  /**
   * 初始化主题管理器：读取持久化偏好 + 监听系统主题变化
   * 应在应用启动时调用一次
   */
  init(): void {
    if (this.initialized) return
    this.initialized = true

    // 1. 从 localStorage 读取已保存的主题模式
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        this.currentMode = saved
      }
    } catch {
      // localStorage 不可用时忽略
    }

    // 2. 监听系统主题变化
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      this.mediaQuery.addEventListener('change', this.handleSystemChange)
    }

    // 3. 计算并应用初始主题
    this.applyTheme()

    // 4. Chapter 8: 初始化终端主题
    this.initTerminalTheme()
  }

  /**
   * 销毁主题管理器，移除监听器
   */
  destroy(): void {
    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.handleSystemChange)
      this.mediaQuery = null
    }
    this.listeners.clear()
    this.initialized = false
    this.currentMode = 'system'
    this.currentEffective = 'light'
  }

  /**
   * 系统主题变化回调
   */
  private handleSystemChange = (e: MediaQueryListEvent): void => {
    // 仅在 system 模式下响应系统主题变化
    if (this.currentMode === 'system') {
      this.currentEffective = e.matches ? 'dark' : 'light'
      this.applyToDOM()
      this.notifyListeners()
    }
  }

  /**
   * 根据当前模式计算实际生效的主题
   */
  private computeEffective(): EffectiveTheme {
    if (this.currentMode === 'system') {
      if (this.mediaQuery?.matches) return 'dark'
      // fallback：检查当前 DOM 上是否有 dark 类
      if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
        return 'dark'
      }
      return 'light'
    }
    return this.currentMode
  }

  /**
   * 计算并应用主题到 DOM
   */
  private applyTheme(): void {
    this.currentEffective = this.computeEffective()
    this.applyToDOM()
    this.notifyListeners()
  }

  /**
   * 将主题应用到 <html> 元素：设置 data-theme 属性 + 切换 dark 类
   */
  private applyToDOM(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.setAttribute('data-theme', this.currentEffective)
    if (this.currentEffective === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    // 同时设置 color-scheme，让浏览器原生控件（滚动条等）跟随主题
    root.style.colorScheme = this.currentEffective
  }

  /**
   * 通知所有监听者主题已变化
   */
  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn(this.currentEffective, this.currentMode))
  }

  /**
   * 设置主题模式
   * @param mode 'light' | 'dark' | 'system'
   */
  setMode(mode: ThemeMode): void {
    if (mode === this.currentMode) return
    this.currentMode = mode
    // 持久化
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode)
    } catch {
      // localStorage 不可用时忽略
    }
    this.applyTheme()
  }

  /**
   * 在 light / dark 之间切换（忽略 system 模式，直接切换为明确的深浅色）
   */
  toggle(): void {
    this.setMode(this.currentEffective === 'dark' ? 'light' : 'dark')
  }

  /**
   * 获取当前主题模式
   */
  getMode(): ThemeMode {
    return this.currentMode
  }

  /**
   * 获取当前生效的实际主题（system 模式下返回解析后的 light/dark）
   */
  getEffective(): EffectiveTheme {
    return this.currentEffective
  }

  /**
   * 判断当前是否为深色主题
   */
  isDark(): boolean {
    return this.currentEffective === 'dark'
  }

  /**
   * 订阅主题变化
   * @returns 取消订阅函数
   */
  subscribe(listener: (theme: EffectiveTheme, mode: ThemeMode) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ============ Chapter 8 新增：终端主题 ============

  /** 当前终端主题 */
  private currentTerminalTheme: TerminalTheme = 'light'

  /** 获取当前终端主题 */
  getTerminalTheme(): TerminalTheme {
    return this.currentTerminalTheme
  }

  /**
   * 设置终端主题
   * 应用对应的 CSS 变量 + 基础主题
   * @param theme 终端主题 ID
   * @param animate 是否启用过渡动画（默认 true）
   */
  setTerminalTheme(theme: TerminalTheme, animate: boolean = true): void {
    if (theme === this.currentTerminalTheme) return

    this.currentTerminalTheme = theme

    const config = TERMINAL_THEMES[theme]
    if (!config) return

    // 平滑过渡
    if (animate && typeof document !== 'undefined') {
      const root = document.documentElement
      root.style.transition = 'background-color 0.3s ease, color 0.3s ease'
      setTimeout(() => {
        root.style.transition = ''
      }, 350)
    }

    // 设置基础主题（light/dark）
    this.setMode(config.baseTheme)

    // 应用 CSS 变量
    this.applyTerminalCssVars(config)

    // 持久化
    try {
      localStorage.setItem(TERMINAL_THEME_STORAGE_KEY, theme)
    } catch {
      // 忽略
    }
  }

  /**
   * 应用终端主题的 CSS 变量到 DOM
   */
  private applyTerminalCssVars(config: TerminalThemeConfig): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    for (const [key, value] of Object.entries(config.cssVars)) {
      root.style.setProperty(key, value)
    }
    root.setAttribute('data-terminal-theme', config.id)
  }

  /**
   * 清除终端主题的 CSS 变量
   */
  private clearTerminalCssVars(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    for (const themeConfig of Object.values(TERMINAL_THEMES)) {
      for (const key of Object.keys(themeConfig.cssVars)) {
        root.style.removeProperty(key)
      }
    }
    root.removeAttribute('data-terminal-theme')
  }

  // ============ Chapter 8 新增：角色主题关联 ============

  /**
   * 保存角色-主题关联
   * 每个角色记忆自己的终端主题偏好
   * @param characterId 角色 ID
   * @param theme 终端主题
   */
  saveCharacterTheme(characterId: string, theme: TerminalTheme): void {
    try {
      const all = this.loadAllCharacterThemes()
      all[characterId] = theme
      localStorage.setItem(CHARACTER_THEME_STORAGE_KEY, JSON.stringify(all))
    } catch {
      // 忽略
    }
  }

  /**
   * 获取角色的主题偏好
   * @param characterId 角色 ID
   * @returns 终端主题，无记录时返回 null
   */
  getCharacterTheme(characterId: string): TerminalTheme | null {
    const all = this.loadAllCharacterThemes()
    return all[characterId] ?? null
  }

  /**
   * 切换角色时自动切换主题
   * 一键角色+主题切换
   * @param characterId 角色 ID
   * @param defaultTheme 角色没有保存主题时的默认主题
   */
  switchCharacterTheme(characterId: string, defaultTheme?: TerminalTheme): void {
    const savedTheme = this.getCharacterTheme(characterId)
    const theme = savedTheme ?? defaultTheme ?? 'light'
    this.setTerminalTheme(theme)
  }

  /**
   * 删除角色-主题关联
   * @param characterId 角色 ID
   */
  removeCharacterTheme(characterId: string): void {
    try {
      const all = this.loadAllCharacterThemes()
      delete all[characterId]
      localStorage.setItem(CHARACTER_THEME_STORAGE_KEY, JSON.stringify(all))
    } catch {
      // 忽略
    }
  }

  /**
   * 加载所有角色-主题关联
   */
  private loadAllCharacterThemes(): Record<string, TerminalTheme> {
    try {
      const raw = localStorage.getItem(CHARACTER_THEME_STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {
      // 忽略
    }
    return {}
  }

  /**
   * 在已有 init 方法中初始化终端主题
   * 在原 init 逻辑之后调用
   */
  private initTerminalTheme(): void {
    try {
      const saved = localStorage.getItem(TERMINAL_THEME_STORAGE_KEY) as TerminalTheme | null
      if (saved && TERMINAL_THEMES[saved]) {
        this.currentTerminalTheme = saved
        const config = TERMINAL_THEMES[saved]
        this.applyTerminalCssVars(config)
      }
    } catch {
      // 忽略
    }
  }

  // ============ Chapter 10 新增：主题预览 + 运行时热切换 ============

  /** 预览模式状态 */
  private previewMode = false
  private savedMode: ThemeMode | null = null

  /**
   * 进入主题预览模式
   * 临时切换主题但不持久化，方便用户预览效果
   * @param mode 要预览的主题模式
   */
  preview(mode: ThemeMode): void {
    if (!this.previewMode) {
      this.savedMode = this.currentMode
      this.previewMode = true
    }
    this.currentMode = mode
    // 预览模式下不持久化
    this.currentEffective = this.computeEffective()
    this.applyToDOM()
    this.notifyListeners()
  }

  /**
   * 退出预览模式
   * @param apply 是否应用预览的主题（true=确认切换，false=恢复原主题）
   */
  exitPreview(apply: boolean): void {
    if (!this.previewMode) return
    this.previewMode = false

    if (apply) {
      // 确认切换：持久化当前预览的主题
      try {
        localStorage.setItem(THEME_STORAGE_KEY, this.currentMode)
      } catch {
        // 忽略
      }
    } else {
      // 取消预览：恢复原来的主题
      if (this.savedMode !== null) {
        this.currentMode = this.savedMode
        this.savedMode = null
      }
    }

    this.currentEffective = this.computeEffective()
    this.applyToDOM()
    this.notifyListeners()
  }

  /**
   * 是否处于预览模式
   */
  isPreviewMode(): boolean {
    return this.previewMode
  }

  /**
   * 运行时热切换 — 无需重启应用即可切换主题
   * 包含平滑过渡动画
   * @param mode 目标主题模式
   * @param animate 是否启用过渡动画（默认 true）
   */
  hotSwitch(mode: ThemeMode, animate: boolean = true): void {
    if (mode === this.currentMode) return

    // 添加过渡动画
    if (animate && typeof document !== 'undefined') {
      const root = document.documentElement
      root.style.transition = 'background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease'
      setTimeout(() => {
        root.style.transition = ''
      }, 350)
    }

    this.setMode(mode)
  }

  /**
   * 应用自定义 CSS 变量（用于声明式主题集成）
   * @param vars CSS 变量键值对
   */
  applyCSSVars(vars: Record<string, string>): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value)
    }
  }

  /**
   * 移除自定义 CSS 变量
   * @param keys CSS 变量键列表
   */
  removeCSSVars(keys: string[]): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    for (const key of keys) {
      root.style.removeProperty(key)
    }
  }
}

// 导出全局单例
export const themeManager = new ThemeManager()

/**
 * React Hook：在组件中使用主题
 * 返回 [当前生效主题, 当前模式, 设置模式函数]
 */
export function useThemeSubscription(): {
  theme: EffectiveTheme
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
} {
  // 这里的实现是同步读取，实际订阅由 React 组件中的 useEffect + useState 完成
  // 这里仅提供初始值，组件应使用 subscribe 监听变化
  return {
    theme: themeManager.getEffective(),
    mode: themeManager.getMode(),
    setMode: (mode: ThemeMode) => themeManager.setMode(mode),
    toggle: () => themeManager.toggle(),
  }
}
