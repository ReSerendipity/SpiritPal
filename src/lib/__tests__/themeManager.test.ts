// themeManager 模块测试 — 主题检测、切换、持久化、订阅
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { themeManager } from '../themeManager'

// 辅助函数：设置 matchMedia mock
function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('themeManager', () => {
  beforeEach(() => {
    localStorage.clear()
    // 设置 localStorage 为 system，确保 init() 时 currentMode 重置为 system
    localStorage.setItem('spiritpal-theme-mode', 'system')
    // 重置 DOM 状态
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
    // 默认 matchMedia 返回非 dark
    setMatchMedia(false)
    // 销毁后重新初始化以重置单例状态
    themeManager.destroy()
  })

  afterEach(() => {
    themeManager.destroy()
    vi.restoreAllMocks()
  })

  describe('init', () => {
    it('初始化后默认为 system 模式', () => {
      themeManager.init()
      expect(themeManager.getMode()).toBe('system')
    })

    it('从 localStorage 读取已保存的模式', () => {
      localStorage.setItem('spiritpal-theme-mode', 'dark')
      themeManager.init()
      expect(themeManager.getMode()).toBe('dark')
      expect(themeManager.isDark()).toBe(true)
    })

    it('localStorage 为 light 时生效', () => {
      localStorage.setItem('spiritpal-theme-mode', 'light')
      themeManager.init()
      expect(themeManager.getMode()).toBe('light')
      expect(themeManager.isDark()).toBe(false)
    })

    it('localStorage 无效值时保留 system', () => {
      localStorage.setItem('spiritpal-theme-mode', 'invalid')
      themeManager.init()
      // 无效值不更新 currentMode，保持之前的 system（由 beforeEach 设置）
      expect(themeManager.getMode()).toBe('system')
    })

    it('重复 init 不重复初始化', () => {
      themeManager.init()
      const mode1 = themeManager.getMode()
      themeManager.init()
      expect(themeManager.getMode()).toBe(mode1)
    })

    it('system 模式下根据 matchMedia 判断深浅', () => {
      setMatchMedia(true)
      themeManager.init()
      expect(themeManager.getEffective()).toBe('dark')
      expect(themeManager.isDark()).toBe(true)
    })

    it('应用到 DOM：dark 模式添加 dark 类和 data-theme', () => {
      localStorage.setItem('spiritpal-theme-mode', 'dark')
      themeManager.init()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })

    it('应用到 DOM：light 模式移除 dark 类', () => {
      localStorage.setItem('spiritpal-theme-mode', 'light')
      themeManager.init()
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.style.colorScheme).toBe('light')
    })
  })

  describe('setMode', () => {
    it('设置 dark 模式并持久化', () => {
      themeManager.init()
      themeManager.setMode('dark')
      expect(themeManager.getMode()).toBe('dark')
      expect(localStorage.getItem('spiritpal-theme-mode')).toBe('dark')
      expect(themeManager.isDark()).toBe(true)
    })

    it('设置 light 模式并持久化', () => {
      themeManager.init()
      themeManager.setMode('light')
      expect(themeManager.getMode()).toBe('light')
      expect(localStorage.getItem('spiritpal-theme-mode')).toBe('light')
      expect(themeManager.isDark()).toBe(false)
    })

    it('设置 system 模式', () => {
      themeManager.init()
      themeManager.setMode('dark')
      themeManager.setMode('system')
      expect(themeManager.getMode()).toBe('system')
      expect(localStorage.getItem('spiritpal-theme-mode')).toBe('system')
    })

    it('相同模式不重复设置', () => {
      themeManager.init()
      const listener = vi.fn()
      themeManager.subscribe(listener)
      themeManager.setMode(themeManager.getMode())
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('toggle', () => {
    it('从 dark 切换到 light', () => {
      themeManager.init()
      themeManager.setMode('dark')
      expect(themeManager.isDark()).toBe(true)
      themeManager.toggle()
      expect(themeManager.isDark()).toBe(false)
      expect(themeManager.getMode()).toBe('light')
    })

    it('从 light 切换到 dark', () => {
      themeManager.init()
      themeManager.setMode('light')
      expect(themeManager.isDark()).toBe(false)
      themeManager.toggle()
      expect(themeManager.isDark()).toBe(true)
      expect(themeManager.getMode()).toBe('dark')
    })
  })

  describe('subscribe', () => {
    it('主题变化时通知监听器', () => {
      themeManager.init()
      const listener = vi.fn()
      themeManager.subscribe(listener)
      themeManager.setMode('dark')
      expect(listener).toHaveBeenCalledWith('dark', 'dark')
    })

    it('取消订阅后不再接收通知', () => {
      themeManager.init()
      const listener = vi.fn()
      const unsub = themeManager.subscribe(listener)
      unsub()
      themeManager.setMode('dark')
      expect(listener).not.toHaveBeenCalled()
    })

    it('多监听器同时通知', () => {
      themeManager.init()
      const l1 = vi.fn()
      const l2 = vi.fn()
      themeManager.subscribe(l1)
      themeManager.subscribe(l2)
      themeManager.setMode('dark')
      expect(l1).toHaveBeenCalledTimes(1)
      expect(l2).toHaveBeenCalledTimes(1)
    })
  })

  describe('destroy', () => {
    it('销毁后清空监听器', () => {
      themeManager.init()
      const listener = vi.fn()
      themeManager.subscribe(listener)
      themeManager.destroy()
      // 重新 init 后 listener 不应被通知（因 destroy 清空了 Set）
      themeManager.init()
      themeManager.setMode('dark')
      expect(listener).not.toHaveBeenCalled()
    })

    it('允许 init → destroy → init 循环', () => {
      themeManager.init()
      themeManager.setMode('dark')
      themeManager.destroy()
      // localStorage 仍为 'dark'（destroy 不清空 localStorage）
      // 重新 init 会读取 localStorage 中的 'dark'
      themeManager.init()
      expect(themeManager.getMode()).toBe('dark')
    })
  })

  describe('getEffective / isDark', () => {
    it('dark 模式下 getEffective 返回 dark', () => {
      themeManager.init()
      themeManager.setMode('dark')
      expect(themeManager.getEffective()).toBe('dark')
      expect(themeManager.isDark()).toBe(true)
    })

    it('light 模式下 getEffective 返回 light', () => {
      themeManager.init()
      themeManager.setMode('light')
      expect(themeManager.getEffective()).toBe('light')
      expect(themeManager.isDark()).toBe(false)
    })

    it('system 模式 + 系统为 dark → dark', () => {
      setMatchMedia(true)
      themeManager.init()
      expect(themeManager.getEffective()).toBe('dark')
      expect(themeManager.isDark()).toBe(true)
    })

    it('system 模式 + 系统为 light → light', () => {
      setMatchMedia(false)
      themeManager.init()
      expect(themeManager.getEffective()).toBe('light')
      expect(themeManager.isDark()).toBe(false)
    })
  })
})
