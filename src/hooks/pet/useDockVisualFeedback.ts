/**
 * @file useDockVisualFeedback.ts
 * @description 吸附交互视觉反馈 Hook — 贴边旋转、探头动画、表情变化
 *
 * 特性：
 * - 根据 dockDir 自动旋转宠物朝向屏幕中心
 * - 贴边时表情变化（好奇/警惕）
 * - 探头动画（从边缘探出头观察）
 * - 与 usePetDragging 的 dockDir 无缝集成
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DockDir } from './usePetDragging'

export interface DockVisualFeedbackOptions {
  /** 容器 ref */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 当前停靠方向 */
  dockDir: DockDir
  /** 是否正在拖拽 */
  dragging: boolean
  /** 朝向 ref（供直接操作） */
  facingRef: React.RefObject<'left' | 'right'>
  /** 是否启用视觉反馈 */
  enabled?: boolean
}

export interface DockVisualFeedbackReturn {
  /** 当前是否处于吸附状态 */
  isDocked: boolean
  /** 当前表情状态 */
  expression: 'normal' | 'curious' | 'alert' | 'hiding'
  /** 当前缩放倍率（探头时缩小） */
  peekScale: number
  /** 手动触发探头 */
  triggerPeek: () => void
  /** 手动返回正常 */
  returnToNormal: () => void
}

/** 探头缩放大小区间 */
const PEEK_SCALE_MIN = 0.7
const PEEK_SCALE_MAX = 1.0

/** 探头动画持续时间（毫秒） */
const PEEK_DURATION_MS = 1500

export function useDockVisualFeedback(
  options: DockVisualFeedbackOptions,
): DockVisualFeedbackReturn {
  const { containerRef, dockDir, dragging, facingRef, enabled = true } = options

  const [isDocked, setIsDocked] = useState(false)
  const [expression, setExpression] = useState<'normal' | 'curious' | 'alert' | 'hiding'>('normal')
  const [peekScale, setPeekScale] = useState(PEEK_SCALE_MAX)
  const peekTimeoutRef = useRef<number | null>(null)

  /** 根据停靠方向调整朝向 */
  const adjustFacingForDock = useCallback((dir: DockDir) => {
    if (!facingRef.current || !dir) return

    const spriteEl = containerRef.current?.querySelector('[data-sprite]') as HTMLElement | null
    if (!spriteEl) return

    switch (dir) {
      case 'left':
        // 左侧边缘 → 朝右（面向屏幕中心）
        facingRef.current = 'right'
        spriteEl.style.transform = `scaleX(1) scale(1) rotate(0deg)`
        break
      case 'right':
        // 右侧边缘 → 朝左
        facingRef.current = 'left'
        spriteEl.style.transform = `scaleX(-1) scale(1) rotate(0deg)`
        break
      case 'top':
        // 上侧边缘 → 默认朝右
        facingRef.current = 'right'
        spriteEl.style.transform = `scaleX(1) scale(1) rotate(0deg)`
        break
      case 'bottom':
        // 下侧边缘 → 默认朝右
        facingRef.current = 'right'
        spriteEl.style.transform = `scaleX(1) scale(1) rotate(0deg)`
        break
    }
  }, [containerRef, facingRef])

  // 吸附时更新表情和朝向
  useEffect(() => {
    if (!enabled || dragging) {
       
      setIsDocked(false)
      setExpression('normal')
      setPeekScale(PEEK_SCALE_MAX)
      return
    }

    if (dockDir) {
      setIsDocked(true)
      
      // 根据边缘方向设置表情
      if (dockDir === 'top' || dockDir === 'bottom') {
        setExpression('curious') // 上下边缘 → 好奇表情
      } else {
        setExpression('alert') // 左右边缘 → 警惕表情
      }

      // 自动调整朝向屏幕中心
      adjustFacingForDock(dockDir)
    } else {
      setIsDocked(false)
      setExpression('normal')
      setPeekScale(PEEK_SCALE_MAX)
    }
  }, [dockDir, dragging, enabled, adjustFacingForDock])

  /** 触发探头动画 */
  const triggerPeek = useCallback(() => {
    if (peekTimeoutRef.current !== null) {
      window.clearTimeout(peekTimeoutRef.current)
    }

    // 渐变小一点
    setPeekScale(PEEK_SCALE_MIN)
    setExpression('curious')

    // 1.5 秒后恢复
    peekTimeoutRef.current = window.setTimeout(() => {
      setPeekScale(PEEK_SCALE_MAX)
      setExpression(isDocked ? (dockDir === 'top' || dockDir === 'bottom' ? 'curious' : 'alert') : 'normal')
    }, PEEK_DURATION_MS)
  }, [isDocked, dockDir])

  /** 返回正常状态 */
  const returnToNormal = useCallback(() => {
    setPeekScale(PEEK_SCALE_MAX)
    setExpression('normal')
    if (peekTimeoutRef.current !== null) {
      window.clearTimeout(peekTimeoutRef.current)
      peekTimeoutRef.current = null
    }
  }, [])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (peekTimeoutRef.current !== null) {
        window.clearTimeout(peekTimeoutRef.current)
      }
    }
  }, [])

  return {
    isDocked,
    expression,
    peekScale,
    triggerPeek,
    returnToNormal,
  }
}
