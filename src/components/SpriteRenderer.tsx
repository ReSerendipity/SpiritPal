/**
 * 精灵动画渲染器组件
 *
 * 功能概述：
 * - 支持三种渲染类型：图集(atlas)、视频(webm)、SVG
 * - 图集模式：通过background-position切换帧，requestAnimationFrame驱动动画
 * - 视频模式：每个动画状态对应webm文件，双缓冲播放避免切换闪白
 * - 双缓冲视频播放（移植自OC-Claw）：
 *   1. vid.load()会同步清除帧缓冲区，单元素方案会闪白
 *   2. 不在切换时清除旧缓冲区src
 *   3. 使用visibility而非opacity淡入淡出
 *   4. 后缓冲区使用visibility:hidden保持解码
 * - 色度键兜底（Windows WebView2 丢 VP9 alpha 通道）：
 *   视频加载后自动检测（或按角色 chromaKey 配置强制/禁用）；
 *   启用后 <video> 仅作解码源（隐藏），canvas 逐帧取帧 → 离屏抠像
 *   （近黑像素 maxRgb<=12 置透明，参考 OC-Claw）→ contain 绘制显示。
 * - 支持size缩放、自定义className和style
 *
 * 核心Hooks/状态：
 * - useState: 当前帧号、激活缓冲区、视频源、色度键模式
 * - useRef: RAF句柄、上一帧时间、双缓冲video元素引用、激活缓冲区引用、离屏canvas
 * - useEffect: RAF动画循环、视频源切换、状态变化处理、色度键绘制循环
 * - useCallback: 帧渲染函数
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { ATLAS, ANIMATION_ROWS, type PetState } from '../lib/types'
import { getCharacter } from '../lib/characters'
import { detectVideoChromaKeyNeed, drawChromaKeyFrame } from '../lib/chromaKey'

/** 精灵渲染器Props */
interface SpriteRendererProps {
  /** 角色ID */
  characterId: string
  /** 当前宠物状态 */
  state: PetState
  /** 缩放比例（默认1） */
  size?: number
  /** 自定义CSS类名 */
  className?: string
  /** 自定义内联样式 */
  style?: CSSProperties
  /** 当前帧号变化回调（供托盘图标渲染等外部取帧使用） */
  onFrameChange?: (frame: number) => void
}

/**
 * 将宠物状态映射到ANIMATION_ROWS中的动画行key
 */
function stateToAnimKey(state: PetState): string {
  switch (state) {
    case 'idle': return 'idle'
    case 'walk': return 'walk'
    case 'sleep': return 'waiting'
    case 'sit': return 'waiting'
    case 'eat': return 'waving'
    case 'drag': return 'jumping'
    case 'happy': return 'jumping'
    case 'sad': return 'failed'
    case 'sick': return 'failed'
    case 'pet': return 'waving'
    // 2.4: hide 状态复用 idle 动画行（无专用素材时回退）
    case 'hide': return 'idle'
    default: return 'idle'
  }
}

/**
 * 将宠物状态映射到webm视频文件名
 */
function stateToVideoFile(state: PetState): string {
  switch (state) {
    case 'idle': return 'idle.webm'
    case 'walk': return 'walk.webm'
    case 'sleep': return 'rest.webm'
    case 'sit': return 'rest.webm'
    case 'eat': return 'eat.webm'
    case 'drag': return 'spin.webm'
    case 'happy': return 'dance.webm'
    case 'sad': return 'rest.webm'
    case 'sick': return 'angry.webm'
    case 'pet': return 'headpat.webm'
    // 2.4: hide 状态复用 idle 视频（无专用素材时回退）
    case 'hide': return 'idle.webm'
    default: return 'idle.webm'
  }
}

/**
 * 精灵动画渲染器
 *
 * 根据角色精灵图类型自动选择图集/视频/SVG渲染方式，支持状态切换动画。
 * 视频模式使用双缓冲技术避免切换闪白。
 */
export function SpriteRenderer({
  characterId,
  state,
  size = 1,
  className,
  style,
  onFrameChange,
}: SpriteRendererProps) {
  const character = getCharacter(characterId)
  const [frame, setFrame] = useState(0)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

  // 帧号变化通知（托盘图标等外部取帧）
  useEffect(() => {
    onFrameChange?.(frame)
  }, [frame, onFrameChange])

  // ===== 双缓冲视频 refs =====
  const videoRefA = useRef<HTMLVideoElement>(null)
  const videoRefB = useRef<HTMLVideoElement>(null)
  // 哪个缓冲区是当前可见的前缓冲（0=A, 1=B）
  const activeBufferRef = useRef<0 | 1>(0)
  const [activeBuffer, setActiveBuffer] = useState<0 | 1>(0)
  const prevVideoUrlRef = useRef<string | undefined>(undefined)

  // ===== 2.3: 动画多级回退状态 =====
  // 视频加载失败时逐级回退：video → idle video → atlas → svg
  // fallbackToAtlas=true 时跳出 video 分支，改用图集渲染
  const [fallbackToAtlas, setFallbackToAtlas] = useState(false)

  // 视频加载失败计数：同一角色连续失败 2 次（当前状态 + idle）后触发图集回退
  const [videoFailCount, setVideoFailCount] = useState(0)

  // 角色切换时重置回退状态（渲染期调整，非 effect——避免级联渲染）
  const [prevCharForFallback, setPrevCharForFallback] = useState(characterId)
  if (prevCharForFallback !== characterId) {
    setPrevCharForFallback(characterId)
    setFallbackToAtlas(false)
    setVideoFailCount(0)
  }

  // ===== 色度键兜底（Windows WebView2 丢 VP9 alpha） =====
  // null=未检测 / true=canvas 抠像渲染 / false=正常 video 播放
  const [chromaKeyMode, setChromaKeyMode] = useState<boolean | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const chromaRafRef = useRef<number>(0)

  const animKey = stateToAnimKey(state)
  const animRow = ANIMATION_ROWS[animKey] ?? ANIMATION_ROWS.idle

  // 状态变化时重置帧计数（渲染期调整，保证动画从第一帧开始）
  const [prevAnimKey, setPrevAnimKey] = useState(animKey)
  if (prevAnimKey !== animKey) {
    setPrevAnimKey(animKey)
    setFrame(0)
  }

  // 角色切换时重置色度键检测状态（渲染期同步调整，触发新角色视频的重新检测）
  const [prevCharacterId, setPrevCharacterId] = useState(characterId)
  if (prevCharacterId !== characterId) {
    setPrevCharacterId(characterId)
    setChromaKeyMode(null)
  }

  // 视频类型：视频 URL 为派生值（每次渲染直接计算；字符串原语值比较，下游 effect 不受影响）
  const videoSrc = character?.spriteType === 'video'
    ? `${character.spriteAsset.replace(/\/[^/]*$/, '')}/${stateToVideoFile(state)}`
    : ''

  // 图集帧动画
  useEffect(() => {
    if (character?.spriteType === 'video') return
    let mounted = true
    const slow = state === 'idle' || state === 'sleep' || state === 'sit'
    const fps = slow ? 2 : 12
    const interval = 1000 / fps

    const loop = (time: number) => {
      if (!mounted) return
      if (time - lastTimeRef.current >= interval) {
        lastTimeRef.current = time
        setFrame((f) => (f + 1) % animRow.frames)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    lastTimeRef.current = 0
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [animRow.frames, state, character?.spriteType])

  // ===== 双缓冲视频切换逻辑（移植自 OC-Claw） =====
  const finishSwap = useCallback((newFront: 0 | 1) => {
    activeBufferRef.current = newFront
    setActiveBuffer(newFront)
    // 只暂停旧缓冲区 —— 绝不清除旧 src
    // setActiveBuffer 触发异步 React 渲染设置 visibility:hidden，
    // 但 removeAttribute('src')+load() 会在 React 隐藏元素之前清除帧缓冲，导致闪白
    // 旧内容是安全的：旧缓冲区被隐藏，loadWithFallback 在它再次成为前缓冲之前会替换 src
    const old = newFront === 0 ? videoRefB.current : videoRefA.current
    if (old) {
      old.pause()
    }
  }, [setActiveBuffer])

  const loadWithFallback = useCallback(
    (
      target: HTMLVideoElement,
      url: string,
      onReady: () => void,
      onFailed: () => void,
    ) => {
      let settled = false
      const onPlaying = () => {
        if (settled) return
        settled = true
        target.removeEventListener('playing', onPlaying)
        target.removeEventListener('error', onError)
        onReady()
      }
      const onError = () => {
        if (settled) return
        settled = true
        target.removeEventListener('playing', onPlaying)
        target.removeEventListener('error', onError)
        onFailed()
      }
      target.addEventListener('playing', onPlaying)
      target.addEventListener('error', onError)
      target.currentTime = 0
      target.src = url
      target.load()
      target.play().catch(() => {})
    },
    [],
  )

  // 视频双缓冲效果：URL 变化时在后缓冲加载，播放后交换
  // 每次加载就绪后顺带做色度键检测（函数式 setState 天然去重：
  // 已有检测结果则跳过；角色切换重置为 null 后新视频会重新检测）
  useEffect(() => {
    if (character?.spriteType !== 'video' || !videoSrc) {
      prevVideoUrlRef.current = undefined
      return
    }

    const frontIdx = activeBufferRef.current
    const backIdx: 0 | 1 = frontIdx === 0 ? 1 : 0
    const front = frontIdx === 0 ? videoRefA.current : videoRefB.current
    const back = backIdx === 0 ? videoRefA.current : videoRefB.current
    if (!front || !back) {
      prevVideoUrlRef.current = undefined
      return
    }

    // URL 未变化则不处理
    if (prevVideoUrlRef.current === videoSrc) return

    const isFirstLoad = prevVideoUrlRef.current === undefined
    prevVideoUrlRef.current = videoSrc

    // 色度键检测：角色 chromaKey 配置优先，否则运行时自动检测
    // 检测结果在 setState 之外计算（updater 内不应有 DOM 副作用），
    // 并用函数式 setState 去重：prev 非 null 说明已有结果，跳过重复检测
    const detectChromaKeyNeed = (video: HTMLVideoElement): boolean => {
      const config = character?.chromaKey ?? 'auto'
      if (config === true) return true
      if (config === false) return false
      return detectVideoChromaKeyNeed(video)
    }
    const maybeDetectChromaKey = (video: HTMLVideoElement) => {
      const result = detectChromaKeyNeed(video)
      setChromaKeyMode((prev) => (prev !== null ? prev : result))
    }

    // 2.3: 视频加载失败时的回退回调（普通函数，非 useCallback——在 effect 内部定义）
    // 第一次失败：回退到 idle 视频（如果是非 idle 状态）
    // 第二次失败（idle 也失败）：触发图集回退
    const handleVideoFailed = () => {
      setVideoFailCount((prev) => {
        const next = prev + 1
        if (next >= 2) {
          console.warn(`[SpriteRenderer] Video failed ${next}x, falling back to atlas`)
          setFallbackToAtlas(true)
        } else if (state !== 'idle') {
          // 回退到 idle 视频（最基础动画，几乎所有角色都有）
          console.warn(`[SpriteRenderer] Video "${videoSrc}" failed, trying idle.webm`)
          prevVideoUrlRef.current = undefined // 强制重新加载
        } else {
          // idle 本身就失败了，直接图集回退
          setFallbackToAtlas(true)
        }
        return next
      })
    }

    if (isFirstLoad) {
      // 首次加载：直接在前缓冲播放
      loadWithFallback(front, videoSrc, () => maybeDetectChromaKey(front), handleVideoFailed)
      return
    }

    // 非首次：在后缓冲加载新视频，播放就绪后交换到前缓冲
    loadWithFallback(back, videoSrc, () => {
      maybeDetectChromaKey(back)
      finishSwap(backIdx)
    }, handleVideoFailed)
  }, [videoSrc, character, finishSwap, loadWithFallback])

  // ===== 色度键绘制循环 =====
  // 启用色度键后：RAF 每帧从当前前缓冲视频取帧 → 离屏抠像 → contain 绘制到显示 canvas
  useEffect(() => {
    if (character?.spriteType !== 'video' || chromaKeyMode !== true) return
    let mounted = true
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const loop = () => {
      if (!mounted) return
      const front = activeBufferRef.current === 0 ? videoRefA.current : videoRefB.current
      if (front && front.readyState >= 2 && front.videoWidth > 0) {
        drawChromaKeyFrame(ctx, canvas, front, offscreenRef)
      }
      chromaRafRef.current = requestAnimationFrame(loop)
    }
    chromaRafRef.current = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(chromaRafRef.current)
    }
  }, [character?.spriteType, chromaKeyMode])

  // 2.3: 视频加载失败时回退到图集渲染（fallbackToAtlas=true）
  if (character && character.spriteType === 'video' && fallbackToAtlas) {
    const bgX = -(frame % ATLAS.cols) * ATLAS.cellW * size
    const bgY = -animRow.row * ATLAS.cellH * size
    return (
      <div
        className={className}
        style={{
          width: ATLAS.cellW * size,
          height: ATLAS.cellH * size,
          backgroundImage: `url(${character.spriteAsset.replace(/\/[^/]*$/, '/atlas.png')})`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          backgroundSize: `${ATLAS.cols * ATLAS.cellW * size}px ${ATLAS.rows * ATLAS.cellH * size}px`,
          backgroundRepeat: 'no-repeat',
          imageRendering: 'pixelated',
          filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))',
          ...style,
        }}
      />
    )
  }

  if (!character) return null

  // Phase 1.6: 优先使用角色自身的 atlasLayout（shimeji 为 128×128），
  // 回退到全局 ATLAS 常量（192×208）
  const atlas = character.atlasLayout ?? {
    cellW: ATLAS.cellW,
    cellH: ATLAS.cellH,
    cols: ATLAS.cols,
    rows: ATLAS.rows,
  }

  const displayW = atlas.cellW * size
  const displayH = atlas.cellH * size

  // SVG 类型
  if (character.spriteType === 'svg') {
    return (
      <img
        src={character.spriteAsset}
        alt={character.displayName}
        className={className}
        style={{
          width: displayW,
          height: displayH,
          objectFit: 'contain',
          filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))',
          ...style,
        }}
        draggable={false}
      />
    )
  }

  // 视频类型：双缓冲 <video> 播放（解码源）+ 可选 canvas 色度键显示层
  // 色度键模式（chromaKeyMode === true）：
  //   两个 <video> 均隐藏（visibility:hidden 保持解码），canvas 显示抠像帧
  // 普通模式：两个 <video> 堆叠，使用 visibility 控制可见性
  //   visibility:hidden（非 display:none）让浏览器继续解码帧
  if (character.spriteType === 'video') {
    const chromaActive = chromaKeyMode === true
    const videoStyle = (isFront: boolean): CSSProperties => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: displayW,
      height: displayH,
      objectFit: 'contain',
      filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))',
      // 色度键模式下 video 仅作解码源，一律隐藏；普通模式按双缓冲前后切换
      visibility: chromaActive ? 'hidden' : (isFront ? 'visible' : 'hidden'),
      pointerEvents: 'none',
      ...style,
    })

    return (
      <div
        className={className}
        style={{
          position: 'relative',
          width: displayW,
          height: displayH,
        }}
      >
        {chromaActive && (
          <canvas
            ref={canvasRef}
            width={Math.max(1, Math.round(displayW))}
            height={Math.max(1, Math.round(displayH))}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: displayW,
              height: displayH,
              filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))',
              pointerEvents: 'none',
            }}
          />
        )}
        <video
          ref={videoRefA}
          style={videoStyle(activeBuffer === 0)}
          loop
          muted
          playsInline
          autoPlay
          preload="auto"
        />
        <video
          ref={videoRefB}
          style={videoStyle(activeBuffer === 1)}
          loop
          muted
          playsInline
          preload="auto"
        />
      </div>
    )
  }

  // 图集类型：background-position 选取当前帧
  // 关键修复：所有像素值必须乘以 size，否则放大时相邻帧内容溢出
  // Phase 1.6: 使用角色自身 atlasLayout（shimeji 为 128×128）
  const bgX = -(frame % atlas.cols) * atlas.cellW * size
  const bgY = -animRow.row * atlas.cellH * size
  const isIdle = state === 'idle'

  return (
    <div
      className={className}
      style={{
        width: displayW,
        height: displayH,
        backgroundImage: `url(${character.spriteAsset})`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        backgroundSize: `${atlas.cols * atlas.cellW * size}px ${atlas.rows * atlas.cellH * size}px`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))',
        animation: isIdle ? 'spiritpal-breathe 3s ease-in-out infinite' : undefined,
        ...style,
      }}
    />
  )
}
