/**
 * @file usePetLive2D.ts
 * @description Live2D 模型检测与动作映射 Hook
 *
 * 功能：
 * - Live2D 模型路径自动检测（LRU 缓存，最多 50 条）
 * - 动画状态 → Live2D motion group 映射
 * - Live2DRenderer 句柄管理
 */

import { useEffect, useRef, useState } from 'react'
import type { Live2DRendererHandle } from '@/components/Live2DRenderer'
import { fetchWithTimeout } from '@/lib/data/commonUtils'
import type { AnimationId } from '@/lib/render/animationConfig'
import { animationIdToMotionGroup } from '@/lib/render/animationConfig'

const LIVE2D_PATH_CACHE_MAX = 50

export interface UsePetLive2DOptions {
  /** 当前角色 ID */
  currentCharacterId: string
  /** 当前宠物状态 */
  petState: string
  /** 当前动画 ID */
  currentAnimId: AnimationId
  /** 模组自定义动作映射 */
  live2dMotionMap?: Record<string, string>
  /** 可选：外部传入的 Live2D 渲染器 ref（用于解决 Hook 顺序依赖） */
  live2dRef?: React.MutableRefObject<Live2DRendererHandle | null>
}

export interface UsePetLive2DReturn {
  /** 是否使用 Live2D 渲染 */
  useLive2D: boolean
  /** Live2D 模型路径 */
  live2dModelPath: string | null
  /** 设置 Live2D 加载失败状态 */
  setLive2dFailed: (failed: boolean) => void
  /** Live2D 渲染器 ref */
  live2dRef: React.MutableRefObject<Live2DRendererHandle | null>
  /** 上一次触发的 motion group ref（防抖用） */
  lastMotionGroupRef: React.MutableRefObject<string>
}

export function usePetLive2D(options: UsePetLive2DOptions): UsePetLive2DReturn {
  const { currentCharacterId, petState, currentAnimId, live2dMotionMap, live2dRef: externalRef } = options

  const [live2dModelPath, setLive2dModelPath] = useState<string | null>(null)
  const [live2dFailed, setLive2dFailed] = useState(false)
  const internalLive2dRef = useRef<Live2DRendererHandle>(null)
  const live2dRef = externalRef ?? internalLive2dRef
  const live2dPathCacheRef = useRef<Map<string, string | null>>(new Map())
  const lastMotionGroupRef = useRef<string>('')
  // 记录上一次渲染时的角色 ID，用于在渲染期检测角色切换
  // （useEffect 在渲染后才执行，期间 live2dModelPath 仍是旧值会导致闪烁）
  const prevCharacterIdRef = useRef<string>(currentCharacterId)

  // 角色切换时：渲染期立即将 useLive2D 置为 false，避免短暂渲染旧角色的 Live2D 模型
  // （旧角色可能有 Live2D，新角色可能没有——不立即切断会在探测期间残留旧模型造成闪烁）
  const charSwitched = prevCharacterIdRef.current !== currentCharacterId
  if (charSwitched) {
    prevCharacterIdRef.current = currentCharacterId
  }

  const useLive2D = !charSwitched && live2dModelPath !== null && !live2dFailed

  // Live2D 模型检测：角色切换时检查 .model3.json 是否存在
  useEffect(() => {
    let cancelled = false
    const cache = live2dPathCacheRef.current

    // 角色切换时立即清空旧模型路径，避免短暂渲染旧角色的 Live2D 导致闪烁
    // （旧角色可能有 Live2D，新角色可能没有——不清空会在探测期间残留旧模型）
    setLive2dModelPath(null)
    setLive2dFailed(false)

    if (cache.has(currentCharacterId)) {
      const cached = cache.get(currentCharacterId) ?? null
      cache.delete(currentCharacterId)
      cache.set(currentCharacterId, cached)
      if (!cancelled) setLive2dModelPath(cached)
      return
    }

    const candidates = [
      `/pets/${currentCharacterId}/${currentCharacterId}.model3.json`,
      `/pets/live2d/${currentCharacterId}/${currentCharacterId}.model3.json`,
    ]

    void (async () => {
      for (const path of candidates) {
        try {
          const resp = await fetchWithTimeout(path, { method: 'HEAD', timeout: 5000 })
          if (resp.ok) {
            if (cancelled) return
            if (cache.size >= LIVE2D_PATH_CACHE_MAX) {
              const oldestKey = cache.keys().next().value
              if (oldestKey !== undefined) cache.delete(oldestKey)
            }
            cache.delete(currentCharacterId)
            cache.set(currentCharacterId, path)
            setLive2dModelPath(path)
            setLive2dFailed(false)
            return
          }
        } catch {
          // 尝试下一个候选路径
        }
      }
      if (cancelled) return
      if (cache.size >= LIVE2D_PATH_CACHE_MAX) {
        const oldestKey = cache.keys().next().value
        if (oldestKey !== undefined) cache.delete(oldestKey)
      }
      cache.delete(currentCharacterId)
      cache.set(currentCharacterId, null)
      setLive2dModelPath(null)
    })()

    return () => {
      cancelled = true
    }
  }, [currentCharacterId])

  // 动画变化时触发 Live2D 对应动作
  useEffect(() => {
    if (!useLive2D) return
    const group = live2dMotionMap?.[currentAnimId]
      ?? live2dMotionMap?.[petState]
      ?? animationIdToMotionGroup(currentAnimId)
    if (lastMotionGroupRef.current === group) return
    lastMotionGroupRef.current = group
    live2dRef.current?.playMotion(group, 0)
  }, [petState, currentAnimId, useLive2D, live2dMotionMap, live2dRef])

  return {
    useLive2D,
    live2dModelPath,
    setLive2dFailed,
    live2dRef,
    lastMotionGroupRef,
  }
}
