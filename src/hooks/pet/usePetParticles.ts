/**
 * @file usePetParticles.ts
 * @description 宠物粒子特效 Hook（A-7）
 *
 * 把 `GPUParticleSystem`（原为孤岛模块）接入抚摸/点击交互：宠物被摸头时
 * 在指针位置爆发一簇上飘的粒子。
 *
 * 设计要点：
 * - **懒初始化**：WebGL 上下文只在第一次 burst 时创建，不给所有用户增加启动开销
 * - **静默降级**：WebGL 不可用（虚拟机 / 禁用硬件加速 / Worker 环境）时 burst 变 no-op，
 *   绝不抛错影响主交互
 * - **按需帧循环**：粒子全部消亡后主动停止 requestAnimationFrame，避免常驻空转
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { GPUParticleSystem } from '../../lib/gpuParticleSystem'

export interface PetParticleBurstOptions {
  /** 爆发中心 X（画布像素坐标） */
  x: number
  /** 爆发中心 Y（画布像素坐标） */
  y: number
  /** 粒子数量，默认 24 */
  count?: number
}

export interface UsePetParticlesResult {
  /** 挂到覆盖层 <canvas> 的 ref */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  /** 触发一次粒子爆发；WebGL 不可用时为空操作 */
  burst: (options: PetParticleBurstOptions) => void
  /** WebGL 是否可用（false 表示已降级，UI 可据此隐藏画布） */
  supported: boolean
}

/** 抚摸反馈：粉色调、向上飘散、轻微上浮 */
const PET_BURST_CONFIG = {
  maxParticles: 256,
  emitRate: 0, // 只靠 burst 手动发射，不做持续喷发
  speedRange: [40, 130] as [number, number],
  // 角度取 π ~ 2π（sin < 0），粒子初速度朝上
  angleRange: [Math.PI, Math.PI * 2] as [number, number],
  // 坐标系 y 轴向下为正，负重力 = 粒子缓慢上浮
  gravity: [0, -25] as [number, number],
  particleSize: 14,
  color: [1, 0.55, 0.72, 1] as [number, number, number, number],
  lifetime: 1.1,
  fadeOutSeconds: 0.7,
}

export function usePetParticles(width: number, height: number): UsePetParticlesResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const systemRef = useRef<GPUParticleSystem | null>(null)
  const initTriedRef = useRef(false)

  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)
  const emitterRef = useRef({ x: 0, y: 0 })
  const pendingRef = useRef(0)

  const [supported, setSupported] = useState(true)

  /** 停止帧循环（卸载 / 粒子耗尽时调用） */
  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    lastTsRef.current = 0
  }, [])

  const tick = useCallback((timestamp: number) => {
    const system = systemRef.current
    if (!system) {
      rafRef.current = null
      return
    }

    const dt = lastTsRef.current > 0 ? (timestamp - lastTsRef.current) / 1000 : 1 / 60
    lastTsRef.current = timestamp

    if (pendingRef.current > 0) {
      system.burst(emitterRef.current, pendingRef.current)
      pendingRef.current = 0
    }

    system.update(dt, emitterRef.current)
    system.render()

    if (system.getParticleCount() > 0) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    // 粒子已全部消亡：再渲染一帧清空画布后停机
    system.render()
    rafRef.current = null
    lastTsRef.current = 0
  }, [])

  /** 首次 burst 时才创建 WebGL 上下文，失败则永久降级 */
  const ensureSystem = useCallback((): GPUParticleSystem | null => {
    if (systemRef.current) return systemRef.current
    if (initTriedRef.current) return null
    initTriedRef.current = true

    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return null

    try {
      systemRef.current = new GPUParticleSystem(canvas, PET_BURST_CONFIG)
    } catch (err) {
      console.warn('[usePetParticles] WebGL 不可用，粒子特效已降级:', err)
      systemRef.current = null
      setSupported(false)
    }
    return systemRef.current
  }, [width, height])

  const burst = useCallback(
    ({ x, y, count = 24 }: PetParticleBurstOptions) => {
      const system = ensureSystem()
      if (!system) return

      emitterRef.current = { x, y }
      pendingRef.current += count
      lastTsRef.current = 0

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick)
      }
    },
    [ensureSystem, tick],
  )

  // 画布尺寸随精灵区域变化（不重建 WebGL 上下文）
  useEffect(() => {
    const canvas = canvasRef.current
    const system = systemRef.current
    if (!canvas || !system || width <= 0 || height <= 0) return
    canvas.width = width
    canvas.height = height
    system.resize(width, height)
  }, [width, height])

  // 卸载时释放 GPU 资源
  useEffect(
    () => () => {
      stopLoop()
      systemRef.current?.destroy()
      systemRef.current = null
      initTriedRef.current = false
    },
    [stopLoop],
  )

  return { canvasRef, burst, supported }
}
