/**
 * Live2D Cubism渲染器组件
 *
 * 功能概述：
 * - 基于Pixi.js + pixi-live2d-display渲染Live2D Cubism 4模型(.model3.json)
 * - 透明背景适配透明置顶窗口
 * - 内置自动呼吸/眨眼（Live2D Cubism Core提供）
 * - 通过ref暴露playMotion/setExpression/focus三个命令式API
 * - 帧率目标60fps，满足30fps+要求
 * - Cubism Core SDK缺失时通过onError通知调用方fallback到精灵图
 * - 动态加载pixi-live2d-display避免Cubism Core缺失时崩溃
 * - 自动计算模型适配缩放，居中显示
 *
 * 核心Hooks/状态：
 * - useRef: 容器div、Pixi Application、Live2D模型、就绪状态、motionMap缓存
 * - useEffect: 创建Pixi应用、加载模型、清理资源
 * - useEffect: 响应scale/width/height/opacity变化更新模型
 * - useImperativeHandle: 暴露命令式API给父组件
 *
 * 依赖：
 * - pixi.js@^7
 * - pixi-live2d-display@^0.4
 * - live2dcubismcore.js（需放置在public/下，由index.html加载）
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Application, Ticker } from 'pixi.js'
import type { PetState } from '../lib/types'

// pixi-live2d-display 动态加载 — 避免 Cubism Core 缺失时崩溃整个应用
let _Live2DModel: any = null
let _tickerRegistered = false

/**
 * 动态加载用户自装的 Cubism Core（社区方案：应用不随包分发 Core）。
 * Core 文件位置：应用数据目录 / live2dcubismcore.js
 * 用户从 Live2D 官网下载 Cubism SDK for Web 后，将 Core 目录下的
 * live2dcubismcore.js 复制到该位置即可启用 Live2D。
 */
async function ensureCubismCoreLoaded(): Promise<boolean> {
  const win = window as unknown as { Live2DCubismCore?: unknown }
  if (win.Live2DCubismCore) return true
  try {
    const [{ readFile }, { appDataDir }] = await Promise.all([
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/api/path'),
    ])
    const dir = await appDataDir()
    const bytes = await readFile(`${dir}live2dcubismcore.js`)
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = blobUrl
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Cubism Core 脚本加载失败'))
      document.head.appendChild(script)
    })
    return !!win.Live2DCubismCore
  } catch {
    return false
  }
}

/**
 * 动态加载Live2D模块
 * 检查Cubism Core是否可用（含用户自装 Core 的加载），动态import pixi-live2d-display并注册Ticker
 */
async function loadLive2D() {
  if (_Live2DModel) return _Live2DModel
  const coreReady = await ensureCubismCoreLoaded()
  if (!coreReady) {
    // 社区方案：应用不随包分发 Cubism Core（Live2D 专有许可）。
    // 用户需自行从 Live2D 官网下载 Cubism SDK，将 live2dcubismcore.js 放入应用数据目录。
    throw new Error(
      'Live2D 渲染需要 Cubism Core 运行时。请从 Live2D 官网下载 Cubism SDK for Web，'
      + '将解压后 Core 目录中的 live2dcubismcore.js 复制到应用数据目录后重启应用。'
      + '（设置 → 关于 → Live2D 查看详细指引）当前已自动切换为精灵图模式。'
    )
  }
  const { Live2DModel } = await import(/* @vite-ignore */ 'pixi-live2d-display/cubism4')
  _Live2DModel = Live2DModel
  if (!_tickerRegistered) {
    _Live2DModel.registerTicker(Ticker as unknown as Parameters<typeof _Live2DModel.registerTicker>[0])
    _tickerRegistered = true
  }
  return _Live2DModel
}

// ============ 默认 PetState → Live2D motion group 映射 ============
// 模组可在 act_conf.motionMap 中覆盖此映射
const DEFAULT_STATE_MOTION_MAP: Record<PetState, string> = {
  idle: 'Idle',
  walk: 'Walk',
  sleep: 'Sleep',
  sit: 'Sit',
  eat: 'Eat',
  drag: 'TapBody',
  happy: 'TapBody',
  sad: 'FlickHead',
  sick: 'Sick',
  pet: 'FlickHead',
}

/**
 * 根据PetState获取对应的Live2D motion group名称
 * 优先使用模组自定义映射，否则使用默认映射
 * @param state 宠物状态
 * @param motionMap 模组自定义动作映射
 * @returns motion group名称
 */
// eslint-disable-next-line react-refresh/only-export-components -- 该函数被 MobilePetView 等组件复用，保持组件文件内导出以维持公共 API
export function getMotionGroupForState(
  state: PetState,
  motionMap?: Record<string, string>,
): string {
  return motionMap?.[state] ?? DEFAULT_STATE_MOTION_MAP[state] ?? 'Idle'
}

// ============ 通过 ref 暴露的句柄 ============
export interface Live2DRendererHandle {
  /** 触发动作：播放指定 group 的第 index 个动作（index 缺省随机） */
  playMotion: (group: string, index?: number) => void
  /** 切换表情 */
  setExpression: (name: string) => void
  /** 视线跟随：x, y 为 canvas 像素坐标（相对 canvas 左上角） */
  focus: (x: number, y: number) => void
  /** 当前是否已就绪可调用动作 */
  isReady: () => boolean
}

export interface Live2DRendererProps {
  /** .model3.json 路径（相对站点根目录，如 /pets/live2d/sample.model3.json） */
  modelPath: string
  /** 整体缩放倍率（相对 canvas 大小，1.0 = 充满） */
  scale?: number
  /** 透明度 0-1 */
  opacity?: number
  /** canvas 宽度（像素） */
  width?: number
  /** canvas 高度（像素） */
  height?: number
  /** 模组自定义动作映射（state → motion group） */
  motionMap?: Record<string, string>
  /** 模型加载就绪回调 */
  onReady?: () => void
  /** 加载失败回调（Cubism Core 缺失或模型加载失败时触发，调用方应 fallback） */
  onError?: (err: Error) => void
}

/**
 * Live2D Cubism模型渲染器
 *
 * 使用forwardRef暴露命令式API，支持动作播放、表情切换和视线跟随。
 * 自动管理Pixi Application生命周期和模型资源清理。
 */
export const Live2DRenderer = forwardRef<Live2DRendererHandle, Live2DRendererProps>(
  function Live2DRenderer(
    {
      modelPath,
      scale = 1,
      opacity = 1,
      width = 300,
      height = 400,
      motionMap,
      onReady,
      onError,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const appRef = useRef<Application | null>(null)
    const modelRef = useRef<any>(null)
    const readyRef = useRef(false)
    // 缓存最新 props 供命令式调用读取
    const motionMapRef = useRef(motionMap)
    motionMapRef.current = motionMap

    // ============ 创建 Pixi Application + 加载 Live2D 模型 ============
    useEffect(() => {
      let destroyed = false
      let app: Application | null = null

      // 1. 动态加载 Live2D Cubism（缺失时优雅降级）
      loadLive2D()
        .then((Live2DModel) => {
          if (destroyed) return

          // 2. 创建 Pixi Application（透明背景）
          app = new Application({
            width,
            height,
            backgroundAlpha: 0,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            powerPreference: 'high-performance',
          })
          appRef.current = app

          // 设置帧率上限
          app.ticker.maxFPS = 60

          // 3. 挂载 canvas 到容器
          const container = containerRef.current
          if (container) {
            const canvas = app.view as HTMLCanvasElement
            canvas.style.display = 'block'
            canvas.style.width = `${width}px`
            canvas.style.height = `${height}px`
            canvas.style.background = 'transparent'
            container.appendChild(canvas)
          }

          // 4. 异步加载 Live2D 模型
          return Live2DModel.from(modelPath).then((model: any) => {
            if (destroyed) {
              model.destroy()
              return
            }
            modelRef.current = model

            // 计算适配缩放
            const modelW = model.width || 1
            const modelH = model.height || 1
            const fit = Math.min(width / modelW, height / modelH)
            const finalScale = fit * scale
            model.scale.set(finalScale)
            model.x = (width - modelW * finalScale) / 2
            model.y = (height - modelH * finalScale) / 2
            model.alpha = opacity

            app!.stage.addChild(model as unknown as import('pixi.js').DisplayObject)

            // 自动播放 idle 动作
            try {
              const idleGroup = getMotionGroupForState('idle', motionMapRef.current)
              void model.motion(idleGroup, 0)
            } catch {
              // 忽略
            }

            readyRef.current = true
            onReady?.()
          })
        })
        .catch((err: unknown) => {
          if (destroyed) return
          const msg = err instanceof Error ? err.message : String(err)
          onError?.(new Error(msg.includes('Live2DCubismCore')
            ? 'Live2DCubismCore not loaded — place live2dcubismcore.js in public/'
            : `Live2D init failed: ${msg}`))
        })

      return () => {
        destroyed = true
        readyRef.current = false
        if (modelRef.current) {
          try { modelRef.current.destroy() } catch { /* ignore */ }
          modelRef.current = null
        }
        if (appRef.current) {
          try { appRef.current.destroy(true, { children: true }) } catch { /* ignore */ }
          appRef.current = null
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modelPath])

    // ============ scale / 尺寸变化时重新计算 ============
    useEffect(() => {
      const app = appRef.current
      if (!app) return
      // 同步 PIXI renderer 尺寸（petSize 滚轮缩放时触发）
      try {
        app.renderer.resize(width, height)
        const canvas = app.view as HTMLCanvasElement
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      } catch {
        // 忽略
      }
      const model = modelRef.current
      if (!model) return
      const modelW = model.width || 1
      const modelH = model.height || 1
      const fit = Math.min(width / modelW, height / modelH)
      const finalScale = fit * scale
      model.scale.set(finalScale)
      model.x = (width - modelW * finalScale) / 2
      model.y = (height - modelH * finalScale) / 2
    }, [scale, width, height])

    // ============ opacity 变化时更新 ============
    useEffect(() => {
      const model = modelRef.current
      if (!model) return
      model.alpha = opacity
    }, [opacity])

    // ============ 暴露命令式 API ============
    useImperativeHandle(
      ref,
      (): Live2DRendererHandle => ({
        playMotion: (group: string, index?: number) => {
          const model = modelRef.current
          if (!model || !readyRef.current) return
          try {
            // index 缺省时 pixi-live2d-display 会随机选择
            void model.motion(group, index)
          } catch {
            // 忽略动作不存在等错误
          }
        },
        setExpression: (name: string) => {
          const model = modelRef.current
          if (!model || !readyRef.current) return
          try {
            void model.expression(name)
          } catch {
            // 忽略表情不存在
          }
        },
        focus: (x: number, y: number) => {
          const model = modelRef.current
          if (!model || !readyRef.current) return
          try {
            model.focus(x, y)
          } catch {
            // 忽略
          }
        },
        isReady: () => readyRef.current,
      }),
      [],
    )

    return (
      <div
        ref={containerRef}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          background: 'transparent',
          pointerEvents: 'none',
        }}
      />
    )
  },
)
