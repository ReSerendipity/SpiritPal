/**
 * @file useDecorationPhysics.ts
 * @description 装饰部件伪物理 Hook（A-13）
 *
 * 把 `live2dPhysicsParser`（原为孤岛模块）用于**非 Cubism 的精灵图宠物**：
 * 角色包若声明了 `physicsPath`（physics3.json），就用其中的摆锤/弹簧模拟器
 * 把宠物的水平运动换算成装饰部件（发饰、尾巴、挂件）的摆角。
 *
 * 边界：
 * - **不改动 Live2D/Cubism 链路**：Live2D 模型的物理由 Cubism 原生 SDK 处理，
 *   本 Hook 只会作用于精灵图角色的装饰层。
 * - **默认角色无回归**：没有 physics3.json 时返回空角度，装饰层行为与过去完全一致。
 * - **静默降级**：配置加载失败/解析失败时停用物理，不抛错。
 */

import { useEffect, useRef, useState } from 'react'
import type { AnchorPoint, DecorationRotations } from '@/lib/data/types'
import { Live2DPysicsParser } from '@/lib/render/live2dPhysicsParser'

export type { DecorationRotations }

export interface UseDecorationPhysicsOptions {
  /** physics3.json 的 URL；为空表示不启用物理 */
  physicsPath?: string
  /** 宠物水平速度（px/s，向右为正） */
  velocityX: number
  /** 总开关，默认 true */
  enabled?: boolean
}

/** physics3.json 的 output 参数映射到装饰锚点（尽力而为，未知参数回落到 body） */
function mapOutputToAnchor(outputId: string): AnchorPoint {
  const id = outputId.toLowerCase()
  if (id.includes('hair') || id.includes('head') || id.includes('face') || id.includes('brow')) {
    return 'head'
  }
  if (id.includes('hand') || id.includes('arm')) return 'hand_right'
  if (id.includes('back') || id.includes('tail') || id.includes('wing')) return 'back'
  return 'body'
}

/**
 * 装饰部件伪物理。
 * @returns 每个锚点当前的摆角（度）；未启用物理时为空对象
 */
export function useDecorationPhysics({
  physicsPath,
  velocityX,
  enabled = true,
}: UseDecorationPhysicsOptions): DecorationRotations {
  const [rotations, setRotations] = useState<DecorationRotations>({})
  const parserRef = useRef<Live2DPysicsParser | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)

  // 速度用 ref 读取，避免每帧重启 rAF 循环
  const velocityRef = useRef(velocityX)
  velocityRef.current = velocityX

  useEffect(() => {
    // 未声明 physics3.json：保持装饰层静态（默认角色无回归）
    if (!enabled || !physicsPath) {
      parserRef.current = null
      setRotations({})
      return
    }

    let cancelled = false
    const parser = new Live2DPysicsParser()
    parserRef.current = parser

    const tick = (timestamp: number) => {
      if (cancelled || parserRef.current !== parser) return
      const deltaMs = lastTsRef.current > 0 ? timestamp - lastTsRef.current : 16
      lastTsRef.current = timestamp

      // 宠物水平速度 → Live2D 风格的角度输入（归一化到 ±30 度）
      const input = Math.max(-30, Math.min(30, (velocityRef.current / 600) * 30))

      const outputs = parser.updateParameters(
        { ParamAngleX: input, ParamAngleZ: input * 0.3, ParamAngleY: 0 },
        deltaMs,
      )

      const next: DecorationRotations = {}
      for (const [outputId, value] of Object.entries(outputs)) {
        if (!Number.isFinite(value)) continue
        const anchor = mapOutputToAnchor(outputId)
        // 同一锚点有多个输出时取绝对值较大者
        const current = next[anchor]
        if (current === undefined || Math.abs(value) > Math.abs(current)) {
          next[anchor] = value
        }
      }
      setRotations(next)
      rafRef.current = requestAnimationFrame(tick)
    }

    void (async () => {
      try {
        const res = await fetch(physicsPath)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (cancelled) return
        await parser.loadConfig(text)
        if (cancelled) return
        lastTsRef.current = 0
        rafRef.current = requestAnimationFrame(tick)
      } catch (err) {
        if (!cancelled) {
          console.warn('[useDecorationPhysics] 物理配置加载失败，装饰层保持静态:', err)
          parserRef.current = null
        }
      }
    })()

    return () => {
      cancelled = true
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastTsRef.current = 0
      parserRef.current = null
      setRotations({})
    }
  }, [physicsPath, enabled])

  return rotations
}
