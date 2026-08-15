/**
 * 像素级点击穿透模块
 *
 * @fileoverview Canvas Alpha检测实现透明区域点击穿透+悬停自动隐藏（参考CodeWalkers/BongoCat）
 *
 * 主要模块：
 * - usePixelClickThrough(): React Hook，封装点击穿透逻辑
 * - isPointTransparent(): 检测指定坐标是否透明
 * - isInteractiveElementUnderPoint(): 检测鼠标下是否有交互元素
 *
 * 依赖关系：
 * - react: useEffect/useRef Hooks
 * - @tauri-apps/api/core: invoke调用Rust设置点击穿透
 * - @tauri-apps/api/window: getCurrentWindow窗口控制
 *
 * 核心接口：
 * - usePixelClickThrough(): 启用像素级点击穿透
 * - disableClickThrough(): 临时禁用穿透
 * - enableClickThrough(): 重新启用穿透
 *
 * 核心机制（参考CodeWalkers/BongoCat）：
 * 1. 100ms轮询：定时检测鼠标位置，并发控制防止重叠
 * 2. Alpha检测：复用单例1x1 Canvas，alpha>10视为实体区域
 * 3. 交互元素检测：bubble/panel/dialog/Radix组件等不穿透
 * 4. DevTools检测：打开时自动禁用穿透方便调试
 * 5. IPC优化：仅状态变化时调用Rust命令
 * 6. 悬停隐藏：鼠标停留角色区域2秒自动隐藏，离开500ms恢复
 * 7. z-index兜底：z-index>1000元素自动不穿透
 */

import React, { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 检测间隔（毫秒） */
const CHECK_INTERVAL_MS = 100

/** Alpha 阈值：低于此值视为透明区域（容忍抗锯齿边缘） */
const ALPHA_THRESHOLD = 10

/** 悬停隐藏触发时间（毫秒）— 鼠标在角色上停留超过此时间触发隐藏 */
const HOVER_HIDE_DELAY_MS = 2000

/** 自动隐藏后恢复显示的延迟（毫秒）— 鼠标离开后恢复显示 */
const AUTO_SHOW_DELAY_MS = 500

/** 交互式 UI 元素选择器 — 参考 CodeWalkers 完整白名单 */
const INTERACTIVE_SELECTORS = [
  // 顶部原生拖拽条与窗口边缘缩放手柄保持可交互（窗口拖动/缩放入口；
  // 宠物本体拖动走 usePetDragging）。
  // 注意：全窗口的背景拖拽层（.spiritpal-drag-surface）不能进白名单——
  // 它覆盖整个窗口，若判定为交互区域则所有空白都会拦截鼠标（像素穿透失效）。
  // 穿透后空白区域点击直达桌面，窗口拖动通过宠物本体/顶部拖拽条完成，缩放通过边缘手柄。
  '[data-tauri-drag-region]',
  '.spiritpal-resize-handle',
  '.pet-bubble',
  '.bubble-content',
  '.panel',
  '[class*="panel"]',
  '.context-menu',
  '.settings-modal',
  '.chat-panel',
  '.dialog-overlay',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[data-radix-popper-content-wrapper]',
  '[data-radix-select-content]',
  '.radix-select-content',
  'button',
  'input',
  'select',
  'textarea',
]

/** 角色容器选择器 */
const CHARACTER_SELECTORS = [
  '.pet-character',
  '.sprite-renderer',
  '.live2d-renderer',
  '.decoration-layer',
  '[data-sprite]',
]

/**
 * 检测 DevTools 是否打开（启发式检测）
 * 参考 CodeWalkers: 开发者工具打开时禁用点击穿透方便调试
 *
 * 注意：不使用 debugger 语句，避免意外暂停执行
 */
function isDevToolsOpen(): boolean {
  // 方法 1: window.devtools API (Tauri WebView2 可能支持)
  if (typeof (window as any).devtools !== 'undefined') {
    return true
  }
  // 方法 2: 检测 outerWidth/outerHeight 与 innerWidth/innerHeight 差异（DevTools 停靠时）
  const widthDiff = window.outerWidth - window.innerWidth
  const heightDiff = window.outerHeight - window.innerHeight
  if (widthDiff > 160 || heightDiff > 160) {
    return true
  }
  return false
}

/**
 * 像素级点击穿透 Hook
 *
 * 在 PetWindow 组件中使用，自动管理窗口的鼠标穿透状态：
 * - 角色实体区域（alpha > 10）→ 不穿透，可点击/拖拽
 * - 透明区域 → 穿透到底层应用
 * - 交互式 UI 元素（气泡、面板等）→ 不穿透
 * - DevTools 打开 → 不穿透（方便元素检查）
 *
 * @param enabled 是否启用点击穿透检测
 * @param interactiveSelectors 额外的交互元素选择器
 * @param autoHideOnHover 是否启用悬停自动隐藏（默认 false）
 */
export function usePixelClickThrough(
  enabled = true,
  interactiveSelectors?: string[],
  autoHideOnHover = false,
) {
  const lastIgnoreState = useRef<boolean | null>(null)
  const isCheckingRef = useRef(false)
  // 复用单例 1x1 Canvas（参考 CodeWalkers 性能优化）
  const pixelCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const pixelCtxRef = useRef<CanvasRenderingContext2D | null>(null)

  // 悬停自动隐藏状态
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHiddenRef = useRef(false)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMouseOnCharacter = useRef(false)

  useEffect(() => {
    if (!enabled) {
      // 禁用时恢复不穿透状态
      if (lastIgnoreState.current !== false) {
        invoke('remove_pet_click_through').catch(() => {})
        lastIgnoreState.current = false
      }
      return
    }

    // 懒初始化 1x1 离屏 Canvas（单例复用，避免每帧创建 GC 压力）
    if (!pixelCanvasRef.current) {
      pixelCanvasRef.current = document.createElement('canvas')
      pixelCanvasRef.current.width = 1
      pixelCanvasRef.current.height = 1
      pixelCtxRef.current = pixelCanvasRef.current.getContext('2d', { willReadFrequently: true })
    }

    const allInteractive = [
      ...INTERACTIVE_SELECTORS,
      ...(interactiveSelectors ?? []),
    ]

    const checkMouse = async () => {
      if (isCheckingRef.current) return
      isCheckingRef.current = true

      try {
        // 1. DevTools 打开时禁用穿透（方便调试）
        if (isDevToolsOpen()) {
          if (lastIgnoreState.current !== false) {
            await invoke('remove_pet_click_through')
            lastIgnoreState.current = false
          }
          isCheckingRef.current = false
          return
        }

        // 2. 获取鼠标在窗口客户区的逻辑坐标
        const [x, y] = await invoke<[number, number]>('get_mouse_pos')

        // 3. 获取鼠标下的 DOM 元素
        const target = document.elementFromPoint(x, y) as HTMLElement | null

        let shouldIgnore = true // 默认穿透
        let mouseOnCharacter = false

        if (!target) {
          shouldIgnore = true
        } else {
          // 4. 检查是否在交互式 UI 元素上 → 不穿透
          const isInteractive = allInteractive.some(sel => target.closest(sel))
          if (isInteractive) {
            shouldIgnore = false
          }

          // 5. 检查是否在角色元素上 → 像素级 Alpha 检测（复用 Canvas）
          if (shouldIgnore) {
            const charEl = findCharacterElement(target)
            if (charEl) {
              const media = charEl.querySelector('video') || charEl.querySelector('img')
              if (media && media instanceof HTMLElement) {
                const hasAlpha = checkPixelAlpha(media, x, y, pixelCtxRef.current)
                shouldIgnore = !hasAlpha
                mouseOnCharacter = hasAlpha
              } else {
                // 角色元素但没有媒体内容 → 不穿透（是装饰层或其他交互元素）
                shouldIgnore = false
                mouseOnCharacter = true
              }
            }
          }

          // 6. 检查高 z-index 元素（兜底策略）
          if (shouldIgnore) {
            const computedStyle = window.getComputedStyle(target)
            const zIndex = parseInt(computedStyle.zIndex)
            if (!isNaN(zIndex) && zIndex > 1000) {
              shouldIgnore = false
            }
          }
        }

        // 7. 仅在状态变化时调用 Rust 命令（IPC 去抖，减少开销）
        if (lastIgnoreState.current !== shouldIgnore) {
          if (shouldIgnore) {
            await invoke('set_pet_click_through')
          } else {
            await invoke('remove_pet_click_through')
          }
          lastIgnoreState.current = shouldIgnore
        }

        // 8. 悬停自动隐藏 + 穿透联动
        if (autoHideOnHover) {
          handleHoverAutoHide(
            mouseOnCharacter,
            lastMouseOnCharacter,
            hoverTimerRef,
            isHiddenRef,
            showTimerRef,
          )
        }
      } catch {
        // 静默处理错误（窗口可能在移动中或被关闭）
      } finally {
        isCheckingRef.current = false
      }
    }

    const interval = setInterval(checkMouse, CHECK_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      // 清理定时器
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
      // 清理时恢复不穿透
      invoke('remove_pet_click_through').catch(() => {})
      lastIgnoreState.current = false
      // 如果被隐藏了，恢复显示
      if (isHiddenRef.current) {
        const appWindow = getCurrentWindow()
        appWindow.show().catch(() => {})
        isHiddenRef.current = false
      }
    }
  }, [enabled, interactiveSelectors, autoHideOnHover])
}

/**
 * 悬停自动隐藏处理
 * 参考 BongoCat：鼠标在角色上停留超过阈值时隐藏窗口，
 * 鼠标离开角色后延迟恢复显示
 *
 * 与点击穿透联动：
 * - 点击穿透启用时（鼠标在透明区域），不触发自动隐藏
 * - 仅当鼠标在角色实体区域停留时才触发隐藏
 *
 * @param mouseOnCharacter 鼠标是否在角色实体区域上
 */
function handleHoverAutoHide(
  mouseOnCharacter: boolean,
  lastMouseOnCharacterRef: React.MutableRefObject<boolean>,
  hoverTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  isHiddenRef: React.MutableRefObject<boolean>,
  showTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
): void {
  // 鼠标刚进入角色区域
  if (mouseOnCharacter && !lastMouseOnCharacterRef.current) {
    // 取消之前的恢复显示定时器
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }

    // 开始悬停计时
    if (!hoverTimerRef.current && !isHiddenRef.current) {
      hoverTimerRef.current = setTimeout(async () => {
        hoverTimerRef.current = null
        try {
          const appWindow = getCurrentWindow()
          await appWindow.hide()
          isHiddenRef.current = true
        } catch {
          // 忽略
        }
      }, HOVER_HIDE_DELAY_MS)
    }
  }

  // 鼠标刚离开角色区域
  if (!mouseOnCharacter && lastMouseOnCharacterRef.current) {
    // 取消悬停计时（还没到隐藏阈值）
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }

    // 如果已经隐藏了，延迟恢复显示
    if (isHiddenRef.current && !showTimerRef.current) {
      showTimerRef.current = setTimeout(async () => {
        showTimerRef.current = null
        try {
          const appWindow = getCurrentWindow()
          await appWindow.show()
          isHiddenRef.current = false
        } catch {
          // 忽略
        }
      }, AUTO_SHOW_DELAY_MS)
    }
  }

  lastMouseOnCharacterRef.current = mouseOnCharacter
}

/**
 * 向上查找最近的角色容器元素
 */
function findCharacterElement(target: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = target
  while (el) {
    if (CHARACTER_SELECTORS.some(sel => el!.matches(sel))) {
      return el
    }
    el = el.parentElement
  }
  return null
}

/**
 * 检查媒体元素在指定坐标处的像素 Alpha 值
 * 使用复用的 1x1 离屏 Canvas 读取 alpha 通道（参考 CodeWalkers 性能优化）
 *
 * @param media 视频或图片元素
 * @param screenX 鼠标 X 坐标（窗口客户区）
 * @param screenY 鼠标 Y 坐标（窗口客户区）
 * @param ctx 复用的 Canvas 2D 上下文（单例，避免每帧 GC）
 */
function checkPixelAlpha(
  media: HTMLElement,
  screenX: number,
  screenY: number,
  ctx: CanvasRenderingContext2D | null,
): boolean {
  if (!ctx) return true // 兜底：无法获取 Canvas 时视为可交互

  const rect = media.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return true

  const mediaX = screenX - rect.left
  const mediaY = screenY - rect.top

  // 边界检查：鼠标在媒体元素外面
  if (mediaX < 0 || mediaX > rect.width || mediaY < 0 || mediaY > rect.height) {
    return false
  }

  const isVideo = media.tagName.toLowerCase() === 'video'
  const naturalWidth = isVideo
    ? (media as HTMLVideoElement).videoWidth
    : (media as HTMLImageElement).naturalWidth
  const naturalHeight = isVideo
    ? (media as HTMLVideoElement).videoHeight
    : (media as HTMLImageElement).naturalHeight

  if (naturalWidth <= 0 || naturalHeight <= 0) return true

  // DPI 适配：逻辑坐标 → 媒体像素坐标缩放因子
  const scaleX = naturalWidth / rect.width
  const scaleY = naturalHeight / rect.height

  // 清除画布（复用单例 Canvas）
  ctx.clearRect(0, 0, 1, 1)

  // 绘制鼠标位置对应的 1x1 像素
  ctx.drawImage(
    media as unknown as CanvasImageSource,
    mediaX * scaleX, mediaY * scaleY, 1, 1,
    0, 0, 1, 1,
  )

  const pixel = ctx.getImageData(0, 0, 1, 1).data
  const alpha = pixel[3]

  // alpha > 阈值 → 角色有内容，不穿透
  return alpha > ALPHA_THRESHOLD
}
