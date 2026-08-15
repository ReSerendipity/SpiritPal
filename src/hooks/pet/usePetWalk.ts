/**
 * @file usePetWalk.ts
 * @description 宠物行走动画 Hook — 三段式梯形速度曲线（匀加速→匀速→匀减速）
 *
 * 移植自 CodeWalkers useCharacterMovement.ts
 * 使用 ref + rAF 动画，通过回调通知 walk offset 变化（与 usePetGaze 协同）
 */

import { useCallback, useEffect, useRef } from 'react'
import type { AnimationId } from '../../lib/animationConfig'

const WALK_ACCEL_START = 0.3
const WALK_FULL_SPEED_START = 1.0
const WALK_DECEL_START = 3.0
const WALK_STOP = 3.5
const WALK_VIDEO_DURATION = 4.0

export interface WalkState {
  isWalking: boolean
  startTime: number
  startX: number
  endX: number
}

export interface UsePetWalkOptions {
  /** 位置 ref */
  posRef: React.MutableRefObject<{ x: number; y: number }>
  /** 设置位置 state */
  setPos: (pos: { x: number; y: number }) => void
  /** 设置宠物状态 */
  setPetState: (state: any) => void
  /** 设置当前动画 ID */
  setCurrentAnimId: (id: AnimationId) => void
  /** 设置朝向 */
  setFacing: (facing: 'left' | 'right') => void
  /** 行走偏移变化回调（像素，供 usePetGaze 合并到 transform） */
  onWalkOffsetChange?: (offsetX: number) => void
  /** 行走完成回调 */
  onWalkComplete?: () => void
}

export interface UsePetWalkReturn {
  /** 行走状态 ref */
  walkStateRef: React.MutableRefObject<WalkState>
  /** 启动行走动画 */
  startWalkAnimation: (targetX: number, animId: AnimationId, onComplete?: () => void) => void
  /** 中断行走动画 */
  interruptWalk: () => void
}

export function usePetWalk(options: UsePetWalkOptions): UsePetWalkReturn {
  const { posRef, setPos, setPetState, setCurrentAnimId, setFacing, onWalkOffsetChange, onWalkComplete } = options

  const walkAnimFrameRef = useRef<number>(0)
  const walkStateRef = useRef<WalkState>({
    isWalking: false,
    startTime: 0,
    startX: 0,
    endX: 0,
  })

  const calcWalkPosition = useCallback((videoTime: number): number => {
    const dIn = WALK_FULL_SPEED_START - WALK_ACCEL_START
    const dLin = WALK_DECEL_START - WALK_FULL_SPEED_START
    const dOut = WALK_STOP - WALK_DECEL_START
    const v = 1.0 / (dIn / 2.0 + dLin + dOut / 2.0)

    if (videoTime <= WALK_ACCEL_START) return 0.0
    if (videoTime <= WALK_FULL_SPEED_START) {
      const t = videoTime - WALK_ACCEL_START
      return v * t * t / (2.0 * dIn)
    }
    if (videoTime <= WALK_DECEL_START) {
      const easeInDist = v * dIn / 2.0
      const t = videoTime - WALK_FULL_SPEED_START
      return easeInDist + v * t
    }
    if (videoTime <= WALK_STOP) {
      const easeInDist = v * dIn / 2.0
      const linearDist = v * dLin
      const t = videoTime - WALK_DECEL_START
      return easeInDist + linearDist + v * (t - t * t / (2.0 * dOut))
    }
    return 1.0
  }, [])

  const startWalkAnimation = useCallback((targetX: number, animId: AnimationId, onComplete?: () => void) => {
    if (walkStateRef.current.isWalking) {
      cancelAnimationFrame(walkAnimFrameRef.current)
    }

    const currentX = posRef.current.x
    setFacing(targetX < currentX ? 'left' : 'right')
    setPetState('walk')
    setCurrentAnimId(animId)

    walkStateRef.current = {
      isWalking: true,
      startTime: Date.now(),
      startX: currentX,
      endX: targetX,
    }

    const animateWalk = () => {
      const state = walkStateRef.current
      if (!state.isWalking) return

      const now = Date.now()
      const elapsed = (now - state.startTime) / 1000.0
      const videoTime = Math.min(elapsed, WALK_VIDEO_DURATION)
      const walkNorm = elapsed >= WALK_VIDEO_DURATION ? 1.0 : calcWalkPosition(videoTime)

      const currentXPos = state.startX + (state.endX - state.startX) * walkNorm
      const currentY = posRef.current.y

      const offsetX = currentXPos - state.startX
      onWalkOffsetChange?.(offsetX)
      posRef.current.x = currentXPos

      if (elapsed >= WALK_VIDEO_DURATION) {
        state.isWalking = false
        onWalkOffsetChange?.(0)
        setPos({ x: state.endX, y: currentY })
        setPetState('idle')
        setCurrentAnimId('idle')
        onComplete?.()
        onWalkComplete?.()
        return
      }

      walkAnimFrameRef.current = requestAnimationFrame(animateWalk)
    }

    walkAnimFrameRef.current = requestAnimationFrame(animateWalk)
  }, [calcWalkPosition, posRef, setPos, setPetState, setCurrentAnimId, setFacing, onWalkOffsetChange, onWalkComplete])

  const interruptWalk = useCallback(() => {
    if (walkStateRef.current.isWalking) {
      cancelAnimationFrame(walkAnimFrameRef.current)
      walkStateRef.current.isWalking = false
      onWalkOffsetChange?.(0)
    }
  }, [onWalkOffsetChange])

  useEffect(() => {
    return () => {
      if (walkAnimFrameRef.current) cancelAnimationFrame(walkAnimFrameRef.current)
      walkStateRef.current.isWalking = false
    }
  }, [])

  return { walkStateRef, startWalkAnimation, interruptWalk }
}
