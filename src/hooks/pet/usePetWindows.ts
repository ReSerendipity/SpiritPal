/**
 * @file usePetWindows.ts
 * @description 窗口管理 Hook
 *
 * 功能：
 * - 子窗口（设置/聊天）按需创建与显示
 * - 窗口位置记忆初始化
 * - 启动最小化检查
 * - 托盘事件监听（番茄钟/专注模式/全局快捷键/情绪事件）
 * - 托盘图标状态同步（根据宠物状态切换）
 */

import { useCallback, useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettingsStore } from '../../stores/settingsStore'
import { animationIdToPetState, type AnimationId } from '../../lib/animationConfig'
import type { PetState } from '../../lib/types'
import { ensureAppWindow } from '../../lib/appWindows'
import { togglePetForm } from '../../lib/petForm'

export interface UsePetWindowsOptions {
  /** 设置番茄钟状态 */
  setPomodoro: React.Dispatch<React.SetStateAction<{ duration: number; startedAt: number } | null>>
  /** 显示气泡回调 */
  showBubble: (msg: string) => void
  /** 设置宠物状态 */
  setPetState: React.Dispatch<React.SetStateAction<PetState>>
  /** 设置当前动画 ID */
  setCurrentAnimId: React.Dispatch<React.SetStateAction<AnimationId>>
  /** 安全 setTimeout 包装 */
  safeTimeout: (fn: () => void, ms: number) => number
  /** 宠物状态 ref */
  petStateRef: React.MutableRefObject<PetState>
  /** 当前宠物状态（用于托盘图标同步） */
  petState: PetState
  /** 当前饱食度（用于托盘图标饥饿状态） */
  hunger: number
}

export interface UsePetWindowsReturn {
  /** 显示指定窗口 */
  showWindow: (label: string) => Promise<void>
  /** 隐藏宠物窗口 */
  hideWindow: () => Promise<void>
}

export function usePetWindows(options: UsePetWindowsOptions): UsePetWindowsReturn {
  const { setPomodoro, showBubble, setPetState, setCurrentAnimId, safeTimeout, petStateRef, petState, hunger } = options

  const showWindow = useCallback(async (label: string): Promise<void> => {
    try {
      const win = await ensureAppWindow(label)
      if (win) {
        await win.show()
        await win.setFocus()
      }
    } catch {
      // 忽略窗口操作错误
    }
  }, [])

  const hideWindow = useCallback(async () => {
    try {
      await getCurrentWindow().hide()
    } catch {
      // 忽略
    }
  }, [])

  // 窗口位置记忆初始化
  useEffect(() => {
    let cleanup: (() => void) | null = null
    const initPositionMemory = async () => {
      try {
        const { initPetWindowPosition } = await import('@/lib/windowPositionMemory')
        cleanup = await initPetWindowPosition()
      } catch {
        // 忽略（plugin-store 可能不可用）
      }
    }
    void initPositionMemory()
    return () => {
      cleanup?.()
    }
  }, [])

  // 启动最小化检查
  useEffect(() => {
    const checkMinimize = async () => {
      try {
        const shouldMinimize = useSettingsStore.getState().startMinimized
        if (shouldMinimize) {
          await getCurrentWindow().hide()
        }
      } catch {
        // 忽略窗口操作错误
      }
    }
    void checkMinimize()
  }, [])

  // 托盘事件监听
  useEffect(() => {
    const unlisteners: Array<() => void> = []

    const unsubPomodoro = listen<number>('start-pomodoro-from-tray', (event) => {
      const minutes = event.payload ?? 25
      setPomodoro({ duration: minutes * 60, startedAt: Date.now() })
      showBubble(`开始专注 ${minutes} 分钟！加油～`)
    })
    unlisteners.push(() => { void unsubPomodoro.then((fn) => fn()) })

    const unsubFocus = listen<boolean>('toggle-focus-mode', (event) => {
      if (event.payload) {
        setPetState('sit')
        showBubble('专注模式启动！一起加油～')
      }
    })
    unlisteners.push(() => { void unsubFocus.then((fn) => fn()) })

    const unsubShortcut = listen('global-shortcut-toggle', async () => {
      try {
        const win = getCurrentWindow()
        if (await win.isVisible()) {
          await win.hide()
        } else {
          await win.show()
          await win.setFocus()
        }
      } catch {
        // 忽略窗口操作错误
      }
    })
    unlisteners.push(() => { void unsubShortcut.then((fn) => fn()) })

    const unsubToggleForm = listen('toggle-pet-form', () => {
      togglePetForm()
    })
    unlisteners.push(() => { void unsubToggleForm.then((fn) => fn()) })

    const unsubEmotion = listen<{ animationIds: string[]; characterId: string }>('spiritpal-emotion', (event) => {
      const ids = event.payload?.animationIds ?? []
      if (ids.length === 0) return
      const animId = ids[0] as AnimationId
      const renderState = animationIdToPetState(animId)
      setCurrentAnimId(animId)
      setPetState(renderState)
      safeTimeout(() => {
        if (petStateRef.current === renderState) {
          setPetState('idle')
        }
      }, 1800)
    })
    unlisteners.push(() => { void unsubEmotion.then((fn) => fn()) })

    return () => {
      unlisteners.forEach((fn) => fn())
    }
  }, [showBubble, setPomodoro, setPetState, setCurrentAnimId, safeTimeout, petStateRef])

  // 托盘图标状态同步：根据宠物状态/饱食度切换图标
  useEffect(() => {
    let trayState = 'normal'
    if (petState === 'sick') {
      trayState = 'sick'
    } else if (petState === 'sleep') {
      trayState = 'sleeping'
    } else if (hunger < 30) {
      trayState = 'hungry'
    }
    invoke('update_tray_icon', { state: trayState }).catch(() => {})
  }, [petState, hunger])

  return { showWindow, hideWindow }
}
