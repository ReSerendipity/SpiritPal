/**
 * @file usePetDragging.ts
 * @description 宠物拖拽交互 Hook — 拖拽速度感知、惯性旋转、实时边缘磁吸
 *
 * 拖拽惯性 + 实时边缘吸附（对齐 Dororo 桌面宠物交互，本项目独立实现）
 *
 * 特性：
 * - 3px 阈值区分点击和拖拽
 * - 拖拽速度感知（用于惯性旋转效果）
 * - 拖动中实时边缘磁吸（窗口中心距屏幕边缘 < 阈值即贴边，参考 Dororo window.gd dock_to_edge）
 * - 吸附阈值 = max(40px, 窗口宽度 × 20%)（比例阈值，窗口放大后依然跟手）
 * - 防卡屏：鼠标距窗口中心超过窗口尺寸时跳过吸附（防止窗口吸住后拖不出来）
 * - 暴露 dockDir 停靠方向，供 UI 层做"贴边藏身/探头"视觉反馈
 * - 拖拽时窗口点击穿透，释放后恢复
 * - 使用 ref + rAF 直接操作 DOM，避免拖拽时高频 setState
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow, currentMonitor, PhysicalPosition } from '@tauri-apps/api/window'

const MOTION_MAX_SPEED = 2.0
const DRAG_DECELERATION = 0.15
const MAX_ROTATION_DEG = 15

/** 停靠方向（UI 层据此做贴边视觉反馈） */
export type DockDir = 'left' | 'right' | 'top' | 'bottom' | null

/** 吸附阈值比例：窗口宽度的 20%（参考 Dororo 的 30%，取 20% 更跟手） */
const DOCK_THRESHOLD_RATIO = 0.2
/** 吸附阈值保底（px，物理像素） */
const DOCK_THRESHOLD_MIN_PX = 40

interface DockResult {
  x: number
  y: number
  dir: Exclude<DockDir, null>
}

export interface UsePetDraggingOptions {
  /** 精灵容器 ref（用于直接操作 transform） */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 当前是否使用 Live2D 渲染 */
  useLive2D: boolean
  /** 点击缩放值 ref（用于 transform 计算） */
  clickScaleRef: React.RefObject<number>
  /** 朝向 ref */
  facingRef: React.RefObject<'left' | 'right'>
  /** 拖拽开始回调 */
  onDragStart?: () => void
  /** 拖拽结束回调（参数为拖拽次数） */
  onDragEnd?: (dragCount: number) => void
  /** 点击（非拖拽）回调 */
  onClick?: () => void
  /** 位置 ref（用于边缘吸附后同步） */
  posRef: React.MutableRefObject<{ x: number; y: number }>
}

export interface UsePetDraggingReturn {
  /** 是否正在拖拽 */
  dragging: boolean
  /** 拖拽次数（用于"晕晕的"检测） */
  dragCount: number
  /** 当前停靠方向（窗口贴边时为 'left'/'right'/'top'/'bottom'，否则 null） */
  dockDir: DockDir
  /** mousedown 处理器 */
  handleMouseDown: (e: React.MouseEvent) => void
  /** mousemove 处理器 */
  handleMouseMove: (e: React.MouseEvent) => void
  /** mouseup 处理器 */
  handleMouseUp: () => void
  /** mouseleave 处理器 */
  handleMouseLeave: () => void
  /** 中断行走动画的回调（供拖拽打断行走时调用） */
  interruptWalk: () => void
  /** 设置中断行走动画的回调 */
  setInterruptWalk: (fn: () => void) => void
}

export function usePetDragging(options: UsePetDraggingOptions): UsePetDraggingReturn {
  const { containerRef, useLive2D, clickScaleRef, facingRef, onDragStart, onDragEnd, onClick } = options

  const [dragging, setDragging] = useState(false)
  // dragCount 同时维护 state（供渲染期读取）与 ref（供回调同步使用）
  const [dragCount, setDragCount] = useState(0)
  // 停靠方向 state（供 UI 层视觉反馈）；ref 用于避免高频 setState（方向不变不重渲染）
  const [dockDir, setDockDirState] = useState<DockDir>(null)
  const dockDirRef = useRef<DockDir>(null)

  const dragVelocityRef = useRef({ x: 0, y: 0 })
  const dragLastPosRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const dragAnimFrameRef = useRef<number>(0)
  const downPosRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const dragStartedRef = useRef(false)
  const dragCountRef = useRef(0)
  const lastWinPosRef = useRef<{ x: number; y: number } | null>(null)
  const snapCheckRef = useRef<number>(0)
  const interruptWalkRef = useRef<() => void>(() => {})
  // 打破 rAF 自引用：循环回调通过 ref 调用最新一次渲染的动画函数
  const animateDragVelocityRef = useRef<() => void>(() => {})

  /** 仅方向变化时更新停靠状态（避免拖动中高频 setState） */
  const setDockDir = useCallback((dir: DockDir) => {
    if (dockDirRef.current !== dir) {
      dockDirRef.current = dir
      setDockDirState(dir)
    }
  }, [])

  // 拖动环境缓存（拖动开始一次性获取；实时磁吸判定走同步函数，不做高频 IPC）
  const dragEnvRef = useRef<{
    winPhysW: number
    winPhysH: number
    screenX: number
    screenY: number
    screenW: number
    screenH: number
  } | null>(null)

  /**
   * 同步边缘磁吸判定（参考 Dororo window.gd dock_to_edge）：
   * - 判定基准：窗口边缘距屏幕边缘（v1.9 修正：不能用窗口中心点判定——
   *   窗口放大后中心距边永远大于阈值，吸附会整体失效）
   * - 阈值：max(40px, 窗口宽 × 20%)（比例阈值，窗口放大后依然跟手）
   * - 防卡屏：鼠标距窗口中心超过窗口尺寸 → 跳过吸附（防止窗口吸住后拖不出来）
   * @returns 吸附后的窗口位置 + 停靠方向；不吸附返回 null
   */
  const dockToEdgeSync = useCallback((
    x: number,
    y: number,
    mousePhysX?: number,
    mousePhysY?: number,
  ): DockResult | null => {
    const env = dragEnvRef.current
    if (!env) return null
    const thresh = Math.max(DOCK_THRESHOLD_MIN_PX, Math.round(env.winPhysW * DOCK_THRESHOLD_RATIO))
    const cx = x + env.winPhysW / 2
    const cy = y + env.winPhysH / 2
    // 防卡屏：鼠标距窗口中心超过窗口尺寸时不停靠，窗口可继续拖出屏幕
    if (mousePhysX !== undefined && mousePhysY !== undefined) {
      if (Math.abs(mousePhysX - cx) > env.winPhysW || Math.abs(mousePhysY - cy) > env.winPhysH) {
        return null
      }
    }
    // 窗口边缘距屏幕边缘 < 阈值 → 贴边吸附（左/右/上/下）
    if (x - env.screenX < thresh) return { x: env.screenX, y, dir: 'left' }
    if (env.screenX + env.screenW - (x + env.winPhysW) < thresh) {
      return { x: env.screenX + env.screenW - env.winPhysW, y, dir: 'right' }
    }
    if (y - env.screenY < thresh) return { x, y: env.screenY, dir: 'top' }
    if (env.screenY + env.screenH - (y + env.winPhysH) < thresh) {
      return { x, y: env.screenY + env.screenH - env.winPhysH, dir: 'bottom' }
    }
    return null
  }, [])

  // 拖拽速度感知动画循环
  const animateDragVelocity = useCallback(() => {
    if (dragStartedRef.current) {
      // 拖拽中保持当前速度
    } else {
      dragVelocityRef.current.x += (0 - dragVelocityRef.current.x) * DRAG_DECELERATION
      dragVelocityRef.current.y += (0 - dragVelocityRef.current.y) * DRAG_DECELERATION
    }
    const speed = Math.abs(dragVelocityRef.current.x)
    const rotation = Math.min(speed * MAX_ROTATION_DEG, MAX_ROTATION_DEG) * Math.sign(dragVelocityRef.current.x || 1)
    const spriteEl = containerRef.current?.querySelector('[data-sprite]') as HTMLElement | null
    if (spriteEl) {
      const s = clickScaleRef.current ?? 1
      const f = facingRef.current ?? 'right'
      spriteEl.style.transform = useLive2D
        ? `scale(${s}) rotate(${dragStartedRef.current ? 8 : rotation}deg)`
        : `scaleX(${f === 'left' ? -1 : 1}) scale(${s}) rotate(${dragStartedRef.current ? 8 : rotation}deg)`
    }
    if (Math.abs(dragVelocityRef.current.x) > 0.01 || Math.abs(dragVelocityRef.current.y) > 0.01 || dragStartedRef.current) {
      dragAnimFrameRef.current = requestAnimationFrame(() => animateDragVelocityRef.current())
    }
  }, [containerRef, useLive2D, clickScaleRef, facingRef])

  // 每次渲染后同步最新动画函数（供 rAF 循环调用）
  useEffect(() => {
    animateDragVelocityRef.current = animateDragVelocity
  })

  // 屏幕边缘吸附（释放后兜底：与拖动中实时磁吸共用中心点 + 比例阈值逻辑）
  const snapToEdge = useCallback(async () => {
    try {
      const win = getCurrentWindow()
      const pos = await win.outerPosition()
      // 窗口尺寸动态获取：窗口会随宠物缩放（滚轮）而改变，不能用固定 300×400
      const size = await win.outerSize()
      const monitor = await currentMonitor()
      if (!monitor) return
      const x = pos.x
      const y = pos.y
      const screenX = monitor.position?.x ?? 0
      const screenY = monitor.position?.y ?? 0
      const screenW = monitor.size.width
      const screenH = monitor.size.height
      const winPhysW = size.width
      const winPhysH = size.height
      const thresh = Math.max(DOCK_THRESHOLD_MIN_PX, Math.round(winPhysW * DOCK_THRESHOLD_RATIO))
      let newX = x
      let newY = y
      let dir: Exclude<DockDir, null> | null = null
      // 窗口边缘距屏幕边缘 < 阈值 → 贴边吸附（与 dockToEdgeSync 判定一致）
      if (x - screenX < thresh) {
        newX = screenX
        dir = 'left'
      } else if (screenX + screenW - (x + winPhysW) < thresh) {
        newX = screenX + screenW - winPhysW
        dir = 'right'
      }
      if (y - screenY < thresh) {
        newY = screenY
        dir = dir ?? 'top'
      } else if (screenY + screenH - (y + winPhysH) < thresh) {
        newY = screenY + screenH - winPhysH
        dir = dir ?? 'bottom'
      }
      if (newX !== x || newY !== y) {
        await win.setPosition(new PhysicalPosition(newX, newY))
      }
      setDockDir(dir)
    } catch {
      // 忽略
    }
  }, [setDockDir])

  const startSnapPolling = useCallback(() => {
    let stableCount = 0
    if (snapCheckRef.current) clearInterval(snapCheckRef.current)
    snapCheckRef.current = window.setInterval(async () => {
      try {
        // 事件丢失兜底：像素穿透（WS_EX_TRANSPARENT）后 WebView 收不到 mouseup/mouseleave，
        // 若超过 3 秒无鼠标事件且拖拽未结束，强制清理拖拽状态，防止永久卡住
        if (downPosRef.current && Date.now() - downPosRef.current.t > 3000) {
          downPosRef.current = null
          dragStartedRef.current = false
          setDragging(false)
          dragWinOriginRef.current = null
          clearInterval(snapCheckRef.current)
          snapCheckRef.current = 0
          return
        }
        // 鼠标仍按住（拖拽进行中）→ 不结束拖拽、不吸附：
        // 否则拖动中短暂停顿 200ms 会被误判为"拖拽结束"，窗口立即 40px 吸边跳离光标，
        // 后续鼠标移动不再跟随（表现为"拖不动/拖飞"）
        if (downPosRef.current) {
          stableCount = 0
          return
        }
        const p = await getCurrentWindow().outerPosition()
        const last = lastWinPosRef.current
        if (last && Math.abs(p.x - last.x) < 2 && Math.abs(p.y - last.y) < 2) {
          stableCount++
          if (stableCount >= 2) {
            clearInterval(snapCheckRef.current)
            snapCheckRef.current = 0
            dragStartedRef.current = false
            setDragging(false)
            dragCountRef.current += 1
            setDragCount(dragCountRef.current)
            dragAnimFrameRef.current = requestAnimationFrame(animateDragVelocity)
            void snapToEdge()
            onDragEnd?.(dragCountRef.current)
          }
        } else {
          stableCount = 0
          lastWinPosRef.current = { x: p.x, y: p.y }
        }
      } catch {
        // 忽略
      }
    }, 100)
  }, [animateDragVelocity, snapToEdge, onDragEnd])

  // 清理
  useEffect(() => {
    return () => {
      if (dragAnimFrameRef.current) cancelAnimationFrame(dragAnimFrameRef.current)
      if (snapCheckRef.current) clearInterval(snapCheckRef.current)
    }
  }, [])

  // 窗口移动停止吸附：覆盖顶部拖拽条（Tauri 原生拖拽）/背景拖拽层等
  // 不走 usePetDragging 实时磁吸的路径 —— 任何原因导致窗口移动停止（400ms 静止）
  // 且靠近屏幕边缘时，自动吸附并更新 dockDir（拖宠物本体的实时磁吸已由 handleMouseMove 处理）
  useEffect(() => {
    const win = getCurrentWindow()
    let movedAt = 0
    let unlistenFn: (() => void) | null = null
    let disposed = false
    win.onMoved(() => {
      if (!disposed) movedAt = Date.now()
    }).then((fn) => {
      if (disposed) fn()
      else unlistenFn = fn
    }).catch(() => {})
    const timer = window.setInterval(() => {
      if (disposed) return
      // 鼠标拖拽中（usePetDragging）→ 跳过（实时磁吸已处理，避免拖拽停顿误吸）
      if (downPosRef.current) return
      if (movedAt === 0 || Date.now() - movedAt < 400) return
      movedAt = Date.now() // 防止重复吸附抖动
      void snapToEdge()
    }, 200)
    return () => {
      disposed = true
      unlistenFn?.()
      window.clearInterval(timer)
    }
  }, [snapToEdge])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) return
    downPosRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    dragStartedRef.current = false
    dragLastPosRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    dragVelocityRef.current = { x: 0, y: 0 }
  }, [])

  // 拖拽开始时记录的窗口位置 + 鼠标屏幕坐标（物理像素）
  const dragWinOriginRef = useRef<{ winX: number; winY: number; mouseX: number; mouseY: number } | null>(null)
  const dragScaleRef = useRef(1)

  const handleMouseMove = useCallback(async (e: React.MouseEvent) => {
    // 刷新按下时间戳：有鼠标事件说明事件流正常，超时兜底不触发
    if (downPosRef.current) downPosRef.current.t = Date.now()
    // 拖拽速度计算（用于惯性旋转）
    if (dragStartedRef.current && dragLastPosRef.current) {
      const now = Date.now()
      const lastDragPos = dragLastPosRef.current
      const dt = Math.max(1, now - lastDragPos.t)
      const dx = e.clientX - lastDragPos.x
      const dy = e.clientY - lastDragPos.y
      const instVx = (dx / dt) * 16
      const instVy = (dy / dt) * 16
      dragVelocityRef.current.x = Math.max(-MOTION_MAX_SPEED, Math.min(MOTION_MAX_SPEED, instVx))
      dragVelocityRef.current.y = Math.max(-MOTION_MAX_SPEED, Math.min(MOTION_MAX_SPEED, instVy))
      dragLastPosRef.current = { x: e.clientX, y: e.clientY, t: now }
      if (!dragAnimFrameRef.current) {
        dragAnimFrameRef.current = requestAnimationFrame(animateDragVelocity)
      }
    }

    // 拖拽中 —— 手动 setPosition（不依赖 startDragging，兼容 transparent 窗口）
    if (dragStartedRef.current && dragWinOriginRef.current) {
      const origin = dragWinOriginRef.current
      const sf = dragScaleRef.current
      let newX = Math.round(origin.winX + (e.screenX * sf - origin.mouseX))
      let newY = Math.round(origin.winY + (e.screenY * sf - origin.mouseY))
      // 拖动中实时边缘磁吸（Dororo 同款：窗口接近边缘即"贴"上去，而非释放后吸附）
      const docked = dockToEdgeSync(newX, newY, e.screenX * sf, e.screenY * sf)
      if (docked) {
        newX = docked.x
        newY = docked.y
        setDockDir(docked.dir)
      } else {
        setDockDir(null)
      }
      getCurrentWindow().setPosition(new PhysicalPosition(newX, newY)).catch(() => {})
      return
    }

    // 拖拽检测（3px 阈值）
    if (downPosRef.current && !dragStartedRef.current) {
      const dx = e.clientX - downPosRef.current.x
      const dy = e.clientY - downPosRef.current.y
      if (Math.sqrt(dx * dx + dy * dy) > 3) {
        dragStartedRef.current = true
        setDragging(true)
        interruptWalkRef.current()
        onDragStart?.()
        try {
          const win = getCurrentWindow()
          const p = await win.outerPosition()
          const sf = await win.scaleFactor()
          lastWinPosRef.current = { x: p.x, y: p.y }
          dragScaleRef.current = sf
          // eslint-disable-next-line react-hooks/immutability -- 拖拽起点是鼠标事件期间的一次性快照，写入 ref 供后续 rAF/吸附使用；该 ref 值仅被读取，不存在渲染期依赖，故意在回调内赋值
          dragWinOriginRef.current = {
            winX: p.x,
            winY: p.y,
            mouseX: e.screenX * sf,
            mouseY: e.screenY * sf,
          }
          // 缓存窗口/屏幕环境（实时磁吸判定用；拖拽中窗口尺寸不变，无需重复 IPC）
          // 注意：currentMonitor 是 @tauri-apps/api/window 的顶层函数，Window 实例没有该方法
          try {
            const size = await win.outerSize()
            const monitor = await currentMonitor()
            dragEnvRef.current = monitor ? {
              winPhysW: size.width,
              winPhysH: size.height,
              screenX: monitor.position.x,
              screenY: monitor.position.y,
              screenW: monitor.size.width,
              screenH: monitor.size.height,
            } : null
          } catch {
            dragEnvRef.current = null
          }
        } catch { /* 忽略 */ }
        startSnapPolling()
      }
    }
  }, [animateDragVelocity, startSnapPolling, dockToEdgeSync, setDockDir, onDragStart])

  const handleMouseUp = useCallback(() => {
    if (snapCheckRef.current) {
      clearInterval(snapCheckRef.current)
      snapCheckRef.current = 0
    }
    const down = downPosRef.current
    downPosRef.current = null
    if (dragStartedRef.current) {
      dragStartedRef.current = false
      setDragging(false)
      dragCountRef.current += 1
      setDragCount(dragCountRef.current)
      dragAnimFrameRef.current = requestAnimationFrame(animateDragVelocity)
      void snapToEdge()
      onDragEnd?.(dragCountRef.current)
      return
    }
    if (down) {
      onClick?.()
    }
  }, [animateDragVelocity, snapToEdge, onClick, onDragEnd])

  const handleMouseLeave = useCallback(() => {
    if (dragStartedRef.current) {
      dragStartedRef.current = false
      setDragging(false)
    }
    downPosRef.current = null
  }, [])

  const interruptWalk = useCallback(() => {
    interruptWalkRef.current()
  }, [])

  const setInterruptWalk = useCallback((fn: () => void) => {
    interruptWalkRef.current = fn
  }, [])

  return {
    dragging,
    dragCount,
    dockDir,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    interruptWalk,
    setInterruptWalk,
  }
}
