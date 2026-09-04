/**
 * @file i18nManager.ts
 * @deprecated 自 2026-08-27（批次二 A-9）起废弃。生产 i18n 由 `lib/i18n.ts`（react-i18next）统一承担，
 * 其 Intl 本地化格式化能力（formatDate/formatTime/formatRelativeTime/formatNumber/formatCurrency/getTextDirection）
 * 已并入 `lib/i18n.ts`。本文件仅作为历史兼容存根保留，禁止在新代码中 import。
 * @description 国际化（i18n）管理器（历史实现，已废弃）
 *
 * 曾实现：运行时语言切换、自动检测系统语言、时区与日期格式本地化、RTL 布局预留、复数处理、动态插值。
 */

import {
  translations_zh_CN,
  translations_en_US,
  translations_ja_JP,
  translations_ko_KR,
} from './i18nTranslations'
import type { Locale, TranslationBundle } from './i18nTranslations'

// ============ 类型定义 ============

export interface I18nConfig {
  /** 默认语言 */
  defaultLocale: Locale
  /** 支持的语言列表 */
  supportedLocales: Locale[]
  /** 是否自动检测系统语言 */
  autoDetect: boolean
  /** 缓存翻译文本 */
  cache: boolean
  /** 自定义翻译映射 */
  customTranslations?: Partial<Record<Locale, TranslationBundle>>
}

export interface InterpolationParams {
  [key: string]: string | number
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: I18nConfig = {
  defaultLocale: 'zh-CN',
  supportedLocales: ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'],
  autoDetect: true,
  cache: true,
}

// ============ 翻译注册表 ============

const TRANSLATIONS: Record<Locale, TranslationBundle> = {
  'zh-CN': translations_zh_CN,
  'en-US': translations_en_US,
  'ja-JP': translations_ja_JP,
  'ko-KR': translations_ko_KR,
}

// ============ 国际化管理器 ============

export class I18nManager {
  private config: I18nConfig
  private currentLocale: Locale
  private translations: Map<Locale, TranslationBundle> = new Map()
  private listeners: Array<(locale: Locale) => void> = []

  constructor(config?: Partial<I18nConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) }
    
    // 加载所有支持的翻译
    if (this.config.cache) {
      for (const locale of this.config.supportedLocales) {
        const translation = TRANSLATIONS[locale]
        if (translation) {
          this.translations.set(locale, translation)
        }
      }
    }
    
    // 设置当前语言
    if (this.config.autoDetect) {
      this.currentLocale = this.detectSystemLanguage()
    } else {
      this.currentLocale = this.config.defaultLocale
    }
    
    // 确保当前语言被支持
    if (!this.config.supportedLocales.includes(this.currentLocale)) {
      this.currentLocale = this.config.defaultLocale
    }
    
    console.log(`[I18n] Current locale: ${this.currentLocale}`)
  }

  /**
   * 检测系统语言
   */
  detectSystemLanguage(): Locale {
    const navigatorLang = typeof navigator !== 'undefined'
      ? navigator.language.toLowerCase()
      : 'zh-cn'
    
    // 语言代码映射
    const localeMap: Record<string, Locale> = {
      'zh-cn': 'zh-CN',
      'zh-tw': 'zh-CN',
      'zh-hk': 'zh-CN',
      'en-us': 'en-US',
      'en-gb': 'en-US',
      'en': 'en-US',
      'ja-jp': 'ja-JP',
      'ja': 'ja-JP',
      'ko-kr': 'ko-KR',
      'ko': 'ko-KR',
    }
    
    return localeMap[navigatorLang] || this.config.defaultLocale
  }

  /**
   * 切换语言
   */
  async setLocale(locale: Locale): Promise<void> {
    if (!this.config.supportedLocales.includes(locale)) {
      console.warn(`[I18n] Locale "${locale}" is not supported`)
      return
    }
    
    this.currentLocale = locale
    
    // 保存用户偏好
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('i18n_locale', locale)
      } catch (error) {
        console.warn('[I18n] Failed to save locale preference:', error)
      }
    }
    
    // 通知所有监听器
    this.notifyListeners(locale)
    
    console.log(`[I18n] Switched to: ${locale}`)
  }

  /**
   * 获取当前语言
   */
  getLocale(): Locale {
    return this.currentLocale
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLocales(): Locale[] {
    return [...this.config.supportedLocales]
  }

  /**
   * 翻译函数
   */
  t(keyPath: string, params?: InterpolationParams): string {
    const bundle = this.translations.get(this.currentLocale) || this.translations.get(this.config.defaultLocale)!
    
    // 使用点号路径访问嵌套对象
    const keys = keyPath.split('.')
    let value: any = bundle
    
    for (const k of keys) {
      value = value?.[k]
      if (value === undefined) {
        console.warn(`[I18n] Missing translation: ${keyPath}`)
        return keyPath // Fallback to key path
      }
    }
    
    if (typeof value !== 'string') {
      console.warn(`[I18n] Translation is not a string: ${keyPath}`)
      return keyPath
    }
    
    // 插值参数替换
    if (params) {
      value = this.interpolate(value, params)
    }
    
    return value
  }

  /**
   * 插值参数
   */
  private interpolate(template: string, params: InterpolationParams): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const value = params[key]
      return value !== undefined ? String(value) : `{${key}}`
    })
  }

  /**
   * 格式化日期
   */
  formatDate(date: Date, formatType: 'short' | 'long' | 'full' = 'short'): string {
    const options: Intl.DateTimeFormatOptions = {
      short: {
        year: '2-digit' as const,
        month: '2-digit' as const,
        day: '2-digit' as const,
      },
      long: {
        year: 'numeric' as const,
        month: 'long' as const,
        day: 'numeric' as const,
      },
      full: {
        year: 'numeric' as const,
        month: 'long' as const,
        day: 'numeric' as const,
        weekday: 'long' as const,
      },
    }[formatType]
    
    return new Intl.DateTimeFormat(this.currentLocale, options).format(date)
  }

  /**
   * 格式化时间
   */
  formatTime(date: Date, formatType: 'short' | 'long' = 'short'): string {
    const options: Intl.DateTimeFormatOptions = {
      short: {
        hour: '2-digit' as const,
        minute: '2-digit' as const,
      },
      long: {
        hour: '2-digit' as const,
        minute: '2-digit' as const,
        second: '2-digit' as const,
      },
    }[formatType]
    
    return new Intl.DateTimeFormat(this.currentLocale, options).format(date)
  }

  /**
   * 格式化日期时间
   */
  formatDateTime(date: Date): string {
    return `${this.formatDate(date)} ${this.formatTime(date)}`
  }

  /**
   * 相对时间（x 分钟前，x 小时前）
   */
  formatRelativeTime(date: Date): string {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)
    
    if (diffSecs < 60) {
      return this.t('time.now')
    } else if (diffMins < 60) {
      return this.t('time.minutesAgo', { n: diffMins })
    } else if (diffHours < 24) {
      return this.t('time.hoursAgo', { n: diffHours })
    } else {
      return this.t('time.daysAgo', { n: diffDays })
    }
  }

  /**
   * 格式化数字
   */
  formatNumber(num: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.currentLocale, options).format(num)
  }

  /**
   * 格式化货币
   */
  formatCurrency(amount: number, currency: string = 'CNY'): string {
    return this.formatNumber(amount, {
      style: 'currency',
      currency,
    })
  }

  /**
   * 添加翻译变更监听器
   */
  onLocaleChange(callback: (locale: Locale) => void): () => void {
    this.listeners.push(callback)
    
    // 返回取消订阅函数
    return () => {
      const index = this.listeners.indexOf(callback)
      if (index > -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(locale: Locale): void {
    for (const listener of this.listeners) {
      try {
        listener(locale)
      } catch (error) {
        console.error('[I18n] Listener error:', error)
      }
    }
  }

  /**
   * 获取方向（LTR/RTL）
   */
  getTextDirection(): 'ltr' | 'rtl' {
    const rtlLocales = ['ar', 'he', 'fa', 'ur']
    const langCode = this.currentLocale.split('-')[0]
    return rtlLocales.some(code => langCode.startsWith(code)) ? 'rtl' : 'ltr'
  }
}

// ============ 快捷函数 ============

let instance: I18nManager | null = null

export function getI18n(): I18nManager {
  if (!instance) {
    instance = new I18nManager()
  }
  return instance
}

export function t(keyPath: string, params?: InterpolationParams): string {
  return getI18n().t(keyPath, params)
}
