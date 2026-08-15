/**
 * @file usePetBehavior.ts
 * @description 宠物行为状态机 Hook
 *
 * 功能：
 * - 行为选择与调度（动画状态机驱动）
 * - 拖拽过多检测（晕晕的状态）
 * - 行走动画触发与状态管理
 * - 编码/会议模式下的行为调整
 *
 * 注意：startWalkAnimation 通过 ref 传入以避免 hook 循环依赖
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePetStore } from '../../stores/petStore'
import {
  getAnimationStateMachine,
  animationIdToPetState,
  type AnimationContext,
  type AnimationId,
} from '../../lib/animationConfig'
import type { PetState } from '../../lib/types'
import type { WorkState } from '../../lib/contextAwareness'

const WIN_W = 300
const SPRITE_W = 192

export interface UsePetBehaviorOptions {
  /** 角色气泡消息配置 */
  bubbleMessages: Record<string, string[]> | undefined
  /** 显示气泡回调 */
  showBubble: (msg: string) => void
  /** 工作状态 ref（从 usePetSensors 共享） */
  workStateRef: React.MutableRefObject<WorkState>
  /** 音乐摇摆状态 ref（从 usePetSensors 共享） */
  musicSwayingRef?: React.MutableRefObject<boolean>
}

export interface UsePetBehaviorReturn {
  /** 调度下一个行为定时器 */
  scheduleNextBehavior: () => void
  /** 设置行走动画启动回调（解决循环依赖） */
  setStartWalkAnimation: (fn: (targetX: number, animId: AnimationId, onComplete?: () => void) => void) => void
  /** 当前宠物状态 */
  petState: PetState
  /** 设置宠物状态 */
  setPetState: React.Dispatch<React.SetStateAction<PetState>>
  /** 当前动画 ID */
  currentAnimId: AnimationId
  /** 设置当前动画 ID */
  setCurrentAnimId: React.Dispatch<React.SetStateAction<AnimationId>>
  /** 朝向 */
  facing: 'left' | 'right'
  /** 设置朝向 */
  setFacing: React.Dispatch<React.SetStateAction<'left' | 'right'>>
  /** 拖拽次数 ref（晕晕检测） */
  dragCountRef: React.MutableRefObject<number>
  /** 宠物状态 ref（供回调读取最新值） */
  petStateRef: React.MutableRefObject<PetState>
  /** 上次交互类型 ref */
  lastInteractionTypeRef: React.MutableRefObject<string>
  /** 上次交互时间 ref */
  lastInteractionAtRef: React.MutableRefObject<number>
  /** 音乐摇摆状态 ref */
  musicSwayingRef: React.MutableRefObject<boolean>
}

export function usePetBehavior(options: UsePetBehaviorOptions): UsePetBehaviorReturn {
  const { showBubble, workStateRef, musicSwayingRef: externalMusicRef } = options

  const [petState, setPetState] = useState<PetState>('idle')
  const [currentAnimId, setCurrentAnimId] = useState<AnimationId>('idle')
  const [facing, setFacing] = useState<'left' | 'right'>('right')

  const behaviorTimerRef = useRef<number>(0)
  const dragCountRef = useRef(0)
  const petStateRef = useRef<PetState>('idle')
  const musicSwayingRef = useRef<boolean>(false)
  const lastInteractionTypeRef = useRef<string>('')
  const lastInteractionAtRef = useRef<number>(0)
  const startWalkAnimationRef = useRef<(targetX: number, animId: AnimationId, onComplete?: () => void) => void>(() => {})
  // pickBehaviorRef：打破 scheduleNextBehavior ↔ pickBehavior 的循环依赖，
  // 定时器回调始终调用最新一次渲染产生的 pickBehavior
  const pickBehaviorRef = useRef<() => void>(() => {})

  const animStateMachine = getAnimationStateMachine()

  // 同步最新 petState 到 ref（渲染期禁止写 ref，改在 effect 中同步）
  useEffect(() => {
    petStateRef.current = petState
  })

  // 如果外部传入了 musicSwayingRef，同步使用同一个 ref
  const activeMusicRef = externalMusicRef ?? musicSwayingRef

  const scheduleNextBehavior = useCallback(() => {
    if (behaviorTimerRef.current) clearTimeout(behaviorTimerRef.current)
    let delay = 5000 + Math.random() * 25000
    if (workStateRef.current === 'coding' || workStateRef.current === 'meeting') {
      delay = 30000 + Math.random() * 60000
    }
    behaviorTimerRef.current = window.setTimeout(() => {
      pickBehaviorRef.current()
    }, delay)
  }, [workStateRef])

  const pickBehavior = useCallback(() => {
    if (dragCountRef.current >= 3) {
      setPetState('sad')
      showBubble('晕晕的……别再晃我啦')
      dragCountRef.current = 0
      scheduleNextBehavior()
      return
    }
    const cur = usePetStore.getState().getCurrentStats()
    const ctx: AnimationContext = {
      petState: petStateRef.current,
      hp: cur.hunger,
      mood: cur.mood,
      health: cur.health,
      affection: cur.affection,
      level: cur.level,
      weather: 'normal' as const,
      workState: workStateRef.current,
      time: new Date().getHours(),
      lastInteraction: lastInteractionAtRef.current,
      interactionType: lastInteractionTypeRef.current,
      musicPlaying: activeMusicRef.current,
    }
    const animId = animStateMachine.select(ctx)
    const renderState = animationIdToPetState(animId)
    setCurrentAnimId(animId)
    if (renderState === 'walk') {
      const minX = 8
      const maxX = WIN_W - SPRITE_W - 8
      const targetX = minX + Math.random() * Math.max(1, maxX - minX)
      startWalkAnimationRef.current(targetX, animId, () => scheduleNextBehavior())
      return
    }
    setPetState(renderState)
    scheduleNextBehavior()
  }, [scheduleNextBehavior, showBubble, animStateMachine, workStateRef, activeMusicRef])

  // 每次渲染后同步最新 pickBehavior（供定时器回调调用）
  useEffect(() => {
    pickBehaviorRef.current = pickBehavior
  })

  const setStartWalkAnimation = useCallback((fn: (targetX: number, animId: AnimationId, onComplete?: () => void) => void) => {
    startWalkAnimationRef.current = fn
  }, [])

  useEffect(() => {
    return () => {
      if (behaviorTimerRef.current) clearTimeout(behaviorTimerRef.current)
    }
  }, [])

  return {
    scheduleNextBehavior,
    setStartWalkAnimation,
    petState,
    setPetState,
    currentAnimId,
    setCurrentAnimId,
    facing,
    setFacing,
    dragCountRef,
    petStateRef,
    lastInteractionTypeRef,
    lastInteractionAtRef,
    musicSwayingRef: activeMusicRef,
  }
}
