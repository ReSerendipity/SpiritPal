/**
 * 输入 → 桌宠闭环（C1，参考 BongoCat rdev 模式）
 *
 * 订阅 Rust 端全局键鼠事件（src-tauri/src/device.rs 已 emit）：
 *   device-mouse-move  → 宠物注视光标方向（gazeX/gazeY 归一化向量，供 sprite 偏头）
 *   device-key-press   → 感知用户打字（transient 反应信号）
 *   device-mouse-press → 感知用户点击（transient 反应信号）
 *
 * 返回响应式状态供 PetWindow 消费（如将 gazeX/gazeY 映射到精灵旋转/视线偏移）。
 * 全局监听由 Rust 端 start_device_listening 提供（幂等）；本 hook 仅做前端订阅与映射。
 */

import { useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

export interface InputReactionState {
  /** 归一化光标相对屏幕中心的 X（-1..1），null=未知 */
  gazeX: number | null
  /** 归一化光标相对屏幕中心的 Y（-1..1），null=未知 */
  gazeY: number | null
  lastReaction: 'keypress' | 'click' | 'idle'
  lastReactionAt: number
}

const MOVE_THROTTLE_MS = 60

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function useInputReactions(_petWindowLabel = 'pet-window'): InputReactionState {
  const [state, setState] = useState<InputReactionState>({
    gazeX: null,
    gazeY: null,
    lastReaction: 'idle',
    lastReactionAt: 0,
  })
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
      setState((s) => ({ ...s, gazeX: gx, gazeY: gy }))
    })
    const onKey = listen<{ key: string }>('device-key-press', () => {
      setState((s) => ({ ...s, lastReaction: 'keypress', lastReactionAt: Date.now() }))
    })
    const onPress = listen<{ button: string }>('device-mouse-press', () => {
      setState((s) => ({ ...s, lastReaction: 'click', lastReactionAt: Date.now() }))
    })

    Promise.all([onMove, onKey, onPress]).then((fns) => {
      if (active) unlisteners.current = fns
    })

    return () => {
      active = false
      unlisteners.current.forEach((f) => f())
      unlisteners.current = []
    }
  }, [_petWindowLabel])

  return state
}
