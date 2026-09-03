/**
 * 输入 → 桌宠闭环（C1，参考 BongoCat rdev 模式）
 *
 * 订阅 Rust 端全局键鼠事件（src-tauri/src/device.rs 已 emit）：
 *   device-mouse-move  → onGaze（归一化 gazeX/gazeY，供 sprite 偏头 / Live2D 视线）
 *   device-key-press   → onKeyPress（全局打字感知，消费方自行节流）
 *   device-mouse-press → onClick（全局点击感知）
 *
 * 设计为**回调驱动、零重渲染**：键鼠事件高频（移动可达 ~60Hz），若走 React state
 * 会导致 PetWindow 这类重组件以 60ms 间隔整体重渲染；因此 gaze/按键/点击一律经
 * handlersRef 分发，消费方在回调内用 ref/命令式 API（如 usePetGaze 的 setGazeTarget）承接。
 *
 * 全局监听由 Rust 端 start_device_listening 提供（幂等）；权限未授予时静默降级。
 */

import { useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

export interface InputReactionHandlers {
  /** 光标移动（~60ms 节流；x/y 归一化到屏幕中心，范围 -1..1） */
  onGaze?: (gazeX: number, gazeY: number) => void
  /** 全局键盘按键（每次触发，消费方自行节流/去抖） */
  onKeyPress?: () => void
  /** 全局鼠标点击 */
  onClick?: () => void
}

const MOVE_THROTTLE_MS = 60

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function useInputReactions(handlers: InputReactionHandlers = {}): void {
  // 用 ref 持有最新 handlers：回调身份每次渲染都会变化，
  // 若作为 effect 依赖会导致反复退订/重订阅事件。
  const handlersRef = useRef<InputReactionHandlers>(handlers)
  handlersRef.current = handlers

  const unlisteners = useRef<UnlistenFn[]>([])
  const lastMoveAt = useRef(0)

  useEffect(() => {
    let active = true

    // 确保 Rust 端全局监听已启动（macOS 需授权「输入监视」，未授权时静默）
    invoke('start_device_listening').catch(() => {
      /* 权限未授予时静默降级 */
    })

    const onMove = listen<{ x: number; y: number }>('device-mouse-move', (e) => {
      const now = Date.now()
      if (now - lastMoveAt.current < MOVE_THROTTLE_MS) return
      lastMoveAt.current = now
      const gx = clamp((e.payload.x / window.screen.width - 0.5) * 2, -1, 1)
      const gy = clamp((e.payload.y / window.screen.height - 0.5) * 2, -1, 1)
      handlersRef.current.onGaze?.(gx, gy)
    })
    const onKey = listen<{ key: string }>('device-key-press', () => {
      handlersRef.current.onKeyPress?.()
    })
    const onPress = listen<{ button: string }>('device-mouse-press', () => {
      handlersRef.current.onClick?.()
    })

    Promise.all([onMove, onKey, onPress]).then((fns) => {
      if (active) {
        unlisteners.current = fns
      } else {
        // 卸载发生在监听注册完成之前：直接退订，避免泄漏
        fns.forEach((f) => f())
      }
    })

    return () => {
      active = false
      unlisteners.current.forEach((f) => f())
      unlisteners.current = []
    }
  }, [])
}
