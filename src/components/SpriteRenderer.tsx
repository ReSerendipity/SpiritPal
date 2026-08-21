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
 * - 支持size缩放、自定义className和style
 *
 * 核心Hooks/状态：
 * - useState: 当前帧号、激活缓冲区、视频源
 * - useRef: RAF句柄、上一帧时间、双缓冲video元素引用、激活缓冲区引用
 * - useEffect: RAF动画循环、视频源切换、状态变化处理
 * - useCallback: 帧渲染函数
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { ATLAS, ANIMATION_ROWS, type PetState } from '../lib/types'
import { getCharacter } from '../lib/characters'

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

  const animKey = stateToAnimKey(state)
  const animRow = ANIMATION_ROWS[animKey] ?? ANIMATION_ROWS.idle

  // 状态变化时重置帧计数（渲染期调整，保证动画从第一帧开始）
  const [prevAnimKey, setPrevAnimKey] = useState(animKey)
  if (prevAnimKey !== animKey) {
    setPrevAnimKey(animKey)
    setFrame(0)
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

    if (isFirstLoad) {
      // 首次加载：直接在前缓冲播放
      loadWithFallback(front, videoSrc, () => {}, () => {})
      return
    }

    // 非首次：在后缓冲加载新视频，播放就绪后交换到前缓冲
    loadWithFallback(back, videoSrc, () => finishSwap(backIdx), () => {})
  }, [videoSrc, character?.spriteType, finishSwap, loadWithFallback])

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

  // 视频类型：双缓冲 <video> 播放
  // 两个 <video> 元素堆叠，使用 visibility 控制可见性
  // visibility:hidden（非 display:none）让浏览器继续解码帧
  if (character.spriteType === 'video') {
    const videoStyle = (isFront: boolean): CSSProperties => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: displayW,
      height: displayH,
      objectFit: 'contain',
      filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))',
      // 使用 visibility 而非 opacity —— opacity 会让两个元素在过渡期间都半透明
      visibility: isFront ? 'visible' : 'hidden',
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
