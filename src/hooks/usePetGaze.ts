/**
 * @file usePetGaze.ts
 * @description 宠物光标跟随（好奇心凝视）Hook
 *
 * 视线跟随与注视动画（参考同类桌宠交互设计，本项目独立实现）
 * 使用 ref + requestAnimationFrame 直接操作 DOM transform，避免每帧 setState 导致 60fps 重渲染
 *
 * 特性：
 * - 平滑跟随：使用指数平滑（lerp）让目光移动自然
 * - 与行走偏移合并：统一管理容器 transform
 * - Live2D 视线同步：支持 Live2D 模型的视线跟随
 *
 * @example
 * ```tsx
 * const { containerRef, setGazeTarget, setWalkOffset, focusLive2D } = usePetGaze()
 * <div ref={containerRef}>...</div>
 * ```
 */

import { useCallback, useEffect, useRef } from 'react'

// 光标跟随常量
const FOLLOW_SMOOTH = 0.15
const FOLLOW_MAX_OFFSET = 8

export interface UsePetGazeOptions {
  /** Live2D 视线聚焦回调（传入 canvas 内相对坐标） */
  onLive2DFocus?: (x: number, y: number) => void
  /** 是否启用跟随 */
  enabled?: boolean
}

export interface UsePetGazeReturn {
  /** 宠物容器 ref（用于直接设置 transform） */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 设置凝视目标位置（归一化坐标 [-1, 1]） */
  setGazeTarget: (x: number, y: number) => void
  /** 设置行走 X 偏移（像素，与 gaze 偏移合并到 transform） */
  setWalkOffset: (offsetX: number) => void
  /** 将鼠标坐标转换为 Live2D canvas 坐标并聚焦 */
  focusLive2D: (clientX: number, clientY: number, rect: DOMRect) => void
  /** 立即重置 gaze 和 walk 偏移 */
  reset: () => void
}

export function usePetGaze(options: UsePetGazeOptions = {}): UsePetGazeReturn {
  const { onLive2DFocus, enabled = true } = options
  const containerRef = useRef<HTMLDivElement | null>(null)
  const gazeTargetRef = useRef({ x: 0, y: 0 })
  const gazeCurrentRef = useRef({ x: 0, y: 0 })
  const walkOffsetRef = useRef(0)

  // 光标跟随动画循环
  useEffect(() => {
    if (!enabled) return

    let mounted = true
    const animate = () => {
      if (!mounted) return

      // 指数平滑插值
      gazeCurrentRef.current.x += (gazeTargetRef.current.x - gazeCurrentRef.current.x) * FOLLOW_SMOOTH
      gazeCurrentRef.current.y += (gazeTargetRef.current.y - gazeCurrentRef.current.y) * FOLLOW_SMOOTH

      const el = containerRef.current
      if (el) {
        const tx = walkOffsetRef.current + gazeCurrentRef.current.x
        const ty = gazeCurrentRef.current.y
        el.style.transform = `translate(${tx}px, ${ty}px)`
      }

      requestAnimationFrame(animate)
    }

    const rafId = requestAnimationFrame(animate)
    return () => {
      mounted = false
      cancelAnimationFrame(rafId)
    }
  }, [enabled])

  const setGazeTarget = useCallback((x: number, y: number) => {
    gazeTargetRef.current.x = x * FOLLOW_MAX_OFFSET
    gazeTargetRef.current.y = y * FOLLOW_MAX_OFFSET * 0.5
  }, [])

  const setWalkOffset = useCallback((offsetX: number) => {
    walkOffsetRef.current = offsetX
  }, [])

  const focusLive2D = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    onLive2DFocus?.(localX, localY)
  }, [onLive2DFocus])

  const reset = useCallback(() => {
    gazeTargetRef.current = { x: 0, y: 0 }
    gazeCurrentRef.current = { x: 0, y: 0 }
    walkOffsetRef.current = 0
    const el = containerRef.current
    if (el) el.style.transform = ''
  }, [])

  return { containerRef, setGazeTarget, setWalkOffset, focusLive2D, reset }
}
