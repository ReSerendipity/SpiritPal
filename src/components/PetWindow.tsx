/**
 * 宠物主窗口组件
 *
 * 桌宠核心渲染组件，通过 10 个自定义 Hooks 管理子系统：
 * - useSafeTimeout: 安全定时器（卸载自动清理）
 * - usePetGaze: 光标跟随/好奇心凝视
 * - usePetDragging: 拖拽交互、惯性旋转、边缘吸附
 * - usePetWalk: 三段式梯形速度行走动画
 * - usePetLive2D: Live2D 模型检测与动作映射
 * - usePetBehavior: 行为状态机选择（拖拽检测、行走触发、编码/会议模式）
 * - usePetSensors: 上下文感知（音乐/天气/网络/工作/日程/情绪/闲置）
 * - usePetWindows: 窗口管理、托盘事件、图标同步
 * - usePetTimers: 初始化与周期定时器
 * - usePetMemoryTriggers: 纪念日/节日主动对话
 *
 * 组件本身负责：
 * - 核心 UI 状态（气泡/菜单/番茄钟/升级/爱心等）
 * - 事件处理协调（鼠标/键盘/滚轮）
 * - 菜单动作（喂食、玩耍、洗澡、截图等）
 * - 角色切换
 * - JSX 渲染
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

import { usePetStore } from '../stores/petStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getCharacter, getDefaultCharacter, getAllCharacters } from '../lib/characters'
import { getFoodsForCharacter } from '../lib/items'
import {
  Hand,
  UtensilsCrossed,
  Gamepad2,
  Bath,
  MessageSquare,
  Timer,
  Camera,
  MessageCircle,
  Settings,
  RefreshCw,
  X,
  ChevronDown,
  ChevronRight,
  Check,
  Shirt,
  Footprints,
  Frame,
  Eye,
} from 'lucide-react'
import { getModManager } from '../lib/modManager'
import { PetBubble } from './PetBubble'
import { PomodoroOverlay } from './PomodoroOverlay'
import { SpriteRenderer } from './SpriteRenderer'
import { Live2DRenderer } from './Live2DRenderer'
import { CharacterSelector } from './CharacterSelector'
import { FirstRunGreeting } from './FirstRunGreeting'
import { DialoguePanel } from './DialoguePanel'
import type { InventoryItem } from '../lib/types'
import { getDialogueManager } from '../lib/dialogueManager'
import { pickPetReaction } from '../lib/behaviorEngine'
import { trackPetInteraction, trackTomatoComplete, trackImageSwitch } from '../lib/analytics'
import { LevelUpOverlay } from './LevelUpOverlay'
import { getScreenshotManager } from '../lib/screenshotManager'
import { DecorationLayer } from './DecorationLayer'
import { getAchievementManager } from '../lib/achievementSystem'
import { getEmotionManager } from '../lib/emotionManager'
import {
  useSafeTimeout,
  usePetGaze,
  usePetDragging,
  usePetWalk,
  usePetLive2D,
  usePetBehavior,
  usePetSensors,
  usePetWindows,
  usePetTimers,
  usePetMemoryTriggers,
} from '../hooks'
import type { DockDir } from '../hooks/pet/usePetDragging'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { switchPetForm } from '../lib/petForm'
import { windowEventBus, useWindowEvent } from '../lib/windowEventBus'
import {
  SPRITE_W,
  SPRITE_H,
  computeWindowSizeFor,
  computeBubbleWindowSize,
  computePanelWindowSize,
  computePanelPetPos,
  computePetPosInWindow,
  computeWalkBounds,
  STATUS_PANEL_W,
  STATUS_PANEL_H,
  ACTIONS_PANEL_W,
  ACTIONS_PANEL_H,
  DIALOGUE_ZONE_PAD,
  type StatusCardMode,
} from '../lib/petWindowSizing'
import { renderPetTrayIcon } from '../lib/trayIconRenderer'
import { FramelessResizeHandles, DRAG_SURFACE_CLASS } from './FramelessChrome'
import { usePixelClickThrough } from '../lib/pixelClickThrough'
// P2-4：宠物共同经历记忆
import { getPetExperienceManager } from '../lib/petExperience'

// 像素点击穿透的额外交互白名单（状态卡/对话区/动作列表等面板区域保持可点击）
const PET_FRAMELESS_INTERACTIVE = [
  '[class*="panel"]',
  '[data-spiritpal-panel]',
  '[data-spiritpal-dialogue]',
  '[data-spiritpal-actions]',
]

// 默认窗口尺寸（Rust 启动时 inner_size 300×400 的首帧兜底；挂载后按宠物尺寸校正）
const WIN_W = 300
const WIN_H = 400
const __emptyDecorations: never[] = []

// Stable selector functions — defined OUTSIDE the component to avoid creating new
// function references on every render. In Zustand v5, useStore wraps each selector
// with useCallback([api, selector]). New selector refs → new getSnapshot →
// React 19 useSyncExternalStore triggers re-render → infinite loop (Error #185).
const selectCurrentCharacterId = (s: ReturnType<typeof usePetStore.getState>) => s.currentCharacterId
const selectHunger = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.hunger ?? 0
const selectMood = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.mood ?? 0
const selectHealth = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.health ?? 0
const selectAffection = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.affection ?? 0
const selectLevel = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.level ?? 1
const selectExp = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.exp ?? 0
const selectCoins = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.coins ?? 0
const selectLastTickAt = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.lastTickAt ?? 0
const selectLastInteractionAt = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.lastInteractionAt ?? 0
const selectLastAffectionDecayAt = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]?.lastAffectionDecayAt ?? 0
const selectClick = (s: ReturnType<typeof usePetStore.getState>) => s.click
const selectPet = (s: ReturnType<typeof usePetStore.getState>) => s.pet
const selectFeed = (s: ReturnType<typeof usePetStore.getState>) => s.feed
const selectPlay = (s: ReturnType<typeof usePetStore.getState>) => s.play
const selectBathe = (s: ReturnType<typeof usePetStore.getState>) => s.bathe
const selectSwitchCharacter = (s: ReturnType<typeof usePetStore.getState>) => s.switchCharacter
const selectInitCharacter = (s: ReturnType<typeof usePetStore.getState>) => s.initCharacter
const selectCompletePomodoro = (s: ReturnType<typeof usePetStore.getState>) => s.completePomodoro
const selectSetPosition = (s: ReturnType<typeof usePetStore.getState>) => s.setPosition
const selectWornDecorations = (s: ReturnType<typeof usePetStore.getState>) => s.wornDecorations[s.currentCharacterId] ?? __emptyDecorations
const selectBackground = (s: ReturnType<typeof usePetStore.getState>) => s.background

// Stable settings selectors
const selectPetSize = (s: ReturnType<typeof useSettingsStore.getState>) => s.petSize
const selectPetOpacity = (s: ReturnType<typeof useSettingsStore.getState>) => s.petOpacity
const selectSwitchSettingsChar = (s: ReturnType<typeof useSettingsStore.getState>) => s.switchCharacter
const selectUpdateSettings = (s: ReturnType<typeof useSettingsStore.getState>) => s.updateSettings
const selectShowWindowBorder = (s: ReturnType<typeof useSettingsStore.getState>) => s.showWindowBorder
const selectStatusCardMode = (s: ReturnType<typeof useSettingsStore.getState>) => s.statusCardMode

/** 状态卡单行统计项（内置状态卡用，迁移自原独立 PanelWindow） */
function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span className="text-[10px]">{label}</span>
      <span className="ml-auto tabular-nums text-[10px] text-ink-faint">{Math.round(value)}</span>
    </div>
  )
}

/** 数值 → 状态色（≥70 绿 / ≥40 黄 / 其余红） */
function tierColor(v: number): string {
  if (v >= 70) return '#22c55e'
  if (v >= 40) return '#eab308'
  return '#ef4444'
}

/** 展开态动作列表单行按钮 */
function ActionButton({
  icon,
  label,
  onClick,
  expanded = false,
  children,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  expanded?: boolean
  children?: React.ReactNode
}) {
  return (
    <div>
      <button
        onClick={onClick}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[11px] text-ink transition-colors hover:bg-ink/8"
      >
        <span className="text-ink-muted" style={{ display: 'inline-flex' }}>{icon}</span>
        <span>{label}</span>
        {expanded
          ? <ChevronDown size={11} className="ml-auto text-ink-faint" />
          : <ChevronRight size={11} className="ml-auto text-ink-faint" />}
      </button>
      {expanded && <div className="ml-2.5 border-l border-ink/10 pl-1">{children}</div>}
    </div>
  )
}

/** 展开态动作列表子项行（喂食/番茄钟/切换角色） */
function ActionRow({
  onClick,
  highlight = false,
  children,
}: {
  onClick: () => void
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-[3px] transition-colors ${
        highlight ? 'bg-tangerine/15 text-ink font-medium' : 'text-ink-muted hover:bg-ink/8'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * 宠物主窗口
 */
export default function PetWindow() {
  // ========== Store selectors (stable refs — selectors defined outside component) ==========
  const currentCharacterId = usePetStore(selectCurrentCharacterId)
  const hunger = usePetStore(selectHunger)
  const mood = usePetStore(selectMood)
  const health = usePetStore(selectHealth)
  const affection = usePetStore(selectAffection)
  const level = usePetStore(selectLevel)
  const exp = usePetStore(selectExp)
  const coins = usePetStore(selectCoins)
  const lastTickAt = usePetStore(selectLastTickAt)
  const lastInteractionAt = usePetStore(selectLastInteractionAt)
  const lastAffectionDecayAt = usePetStore(selectLastAffectionDecayAt)
  // Reconstruct stats object only when any primitive changes
  const stats = useMemo(() => ({
    hunger, mood, health, affection, level, exp, coins, lastTickAt, lastInteractionAt, lastAffectionDecayAt,
  }), [hunger, mood, health, affection, level, exp, coins, lastTickAt, lastInteractionAt, lastAffectionDecayAt])

  const petStoreClick = usePetStore(selectClick)
  const petStorePet = usePetStore(selectPet)
  const petStoreFeed = usePetStore(selectFeed)
  const petStorePlay = usePetStore(selectPlay)
  const petStoreBathe = usePetStore(selectBathe)
  const switchPetChar = usePetStore(selectSwitchCharacter)
  const initPetChar = usePetStore(selectInitCharacter)
  const completePomodoro = usePetStore(selectCompletePomodoro)
  const setPosition = usePetStore(selectSetPosition)
  const wornDecorations = usePetStore(selectWornDecorations)
  const background = usePetStore(selectBackground)

  const petSize = useSettingsStore(selectPetSize)
  const petOpacity = useSettingsStore(selectPetOpacity)
  const switchSettingsChar = useSettingsStore(selectSwitchSettingsChar)
  const updateSettings = useSettingsStore(selectUpdateSettings)
  const showWindowBorder = useSettingsStore(selectShowWindowBorder)
  const statusCardModeRaw = useSettingsStore(selectStatusCardMode)
  // 旧版本持久化的 'top-right' 归一化为 'right'（命名已统一，避免旧数据落在无定位分支）
  const statusCardMode: StatusCardMode = (statusCardModeRaw as string) === 'top-right' ? 'right' : statusCardModeRaw
  // 状态卡实测高度（right 模式：动作列表定位在状态卡下方；测量 effect 更新）
  const [statusHMeasured, setStatusHMeasured] = useState<number>(STATUS_PANEL_H)
  // 顶部对话区当前高度（气泡显示时为 16+气泡高，否则 16；动作列表定位随之下移）
  const [dialogueZoneH, setDialogueZoneH] = useState<number>(DIALOGUE_ZONE_PAD)

  const character = getCharacter(currentCharacterId)

  // 从模组读取 Live2D 动作映射
  const live2dMotionMap = useMemo(() => {
    try {
      const mod = getModManager().getMod(currentCharacterId)
      return mod?.modData.actConf?.motionMap
    } catch {
      return undefined
    }
  }, [currentCharacterId])

  const [firstRun, setFirstRun] = useState<boolean>(() => {
    try {
      return !localStorage.getItem('spiritpal-first-run-done')
    } catch {
      return false
    }
  })
  const [firstRunStep, setFirstRunStep] = useState<'greet' | 'select'>('greet')

  // 窗口尺寸（逻辑像素，S/M/L 自适应档位 + 停靠视觉对齐用）
  const [winW, setWinW] = useState<number>(WIN_W)
  const [winH, setWinH] = useState<number>(WIN_H)
  useEffect(() => {
    const win = getCurrentWindow()
    let disposed = false
    // outerSize 返回物理像素，÷scaleFactor 得到逻辑像素（与 pos/sprite 的 CSS px 一致）
    const sync = () => {
      Promise.all([win.outerSize(), win.scaleFactor()])
        .then(([s, sf]) => {
          if (disposed) return
          const w = Math.round(s.width / sf)
          const h = Math.round(s.height / sf)
          winSizeRef.current = { w, h }
          setWinW(w)
          setWinH(h)
        })
        .catch(() => {})
    }
    sync()
    let unlistenFn: (() => void) | null = null
    win.onResized(() => { sync() })
      .then((fn) => { unlistenFn = fn; if (disposed) fn() })
      .catch(() => {})
    // 兜底：resize 事件可能因权限/时序丢失，周期轮询同步窗口尺寸
    const timer = window.setInterval(sync, 2000)
    return () => { disposed = true; unlistenFn?.(); window.clearInterval(timer) }
  }, [])

  // ========== Core UI State (组件拥有) ==========
  const [pos, setPos] = useState<{ x: number; y: number }>(
    () => usePetStore.getState().position ?? { x: (WIN_W - SPRITE_W) / 2, y: WIN_H - SPRITE_H - 8 }
  )
  const [clickScale, setClickScale] = useState(1)
  const [bubble, setBubble] = useState<string | null>(null)
  // 展开态面板（对话顶中 + 状态卡按模式 + 动作右侧）：右键宠物/胶囊展开，移出防抖收起
  const [panelOpen, setPanelOpen] = useState(false)
  // 右侧动作列表的展开子菜单（喂食/番茄钟/切换角色/状态卡）
  const [actionSub, setActionSub] = useState<'feed' | 'pomodoro' | 'switch' | 'status' | null>(null)
  const [dialogueGraphId, setDialogueGraphId] = useState<string | null>(null)
  // 跨窗口：settings 窗口使用对话物品后，在此打开对应对话图
  useWindowEvent('open-dialogue', (payload) => {
    setDialogueGraphId(payload.graphId)
  })
  // MCP 工具桥接：监听 spiritpal-mcp-* 自定义事件，让外部 Agent 驱动的工具在 UI 上真实生效
  useEffect(() => {
    const onSay = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail
      if (typeof msg === 'string' && msg) setBubble(msg.slice(0, 200))
    }
    const onReact = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string' && id) {
        setBubble(`（${id}）`)
      }
    }
    const onFeed = () => setBubble('哇，好吃！')
    const onPet = () => setBubble('呼噜呼噜～')
    window.addEventListener('spiritpal-mcp-say', onSay)
    window.addEventListener('spiritpal-mcp-react', onReact)
    window.addEventListener('spiritpal-mcp-feed', onFeed)
    window.addEventListener('spiritpal-mcp-pet', onPet)
    return () => {
      window.removeEventListener('spiritpal-mcp-say', onSay)
      window.removeEventListener('spiritpal-mcp-react', onReact)
      window.removeEventListener('spiritpal-mcp-feed', onFeed)
      window.removeEventListener('spiritpal-mcp-pet', onPet)
    }
  }, [])
  const [hearts, setHearts] = useState<number[]>([])
  const [fading, setFading] = useState(false)
  const [pomodoro, setPomodoro] = useState<{ duration: number; startedAt: number } | null>(null)
  const [levelUp, setLevelUp] = useState<{ level: number; name: string } | null>(null)

  // ========== Refs ==========
  const posRef = useRef(pos)
  const clickScaleRef = useRef(clickScale)
  const fadeTimerRef = useRef(0)
  const petCooldownRef = useRef(0)
  const lastMouseRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const downPosRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const draggingRef = useRef(false)
  const live2dRef = useRef<import('../components/Live2DRenderer').Live2DRendererHandle | null>(null)

  // ========== 气泡驱动窗口自适应 refs ==========
  // 气泡 DOM 测量（挂在 PetBubble 外层 div 上，读取实际渲染尺寸）
  const bubbleMeasureRef = useRef<HTMLDivElement | null>(null)
  // 气泡导致窗口放大前的窗口逻辑尺寸（气泡关闭后恢复用；未放大过为 null）
  const preBubbleWinRef = useRef<{ w: number; h: number } | null>(null)
  // 上一帧气泡文本（effect 只对文本变化响应，避免窗口尺寸同步轮询触发重复测量）
  const prevBubbleRef = useRef<string | null>(null)
  // 当前窗口逻辑尺寸镜像（winW/winH 的状态更新是异步的，自适应判定用它取即时值）
  const winSizeRef = useRef<{ w: number; h: number }>({ w: WIN_W, h: WIN_H })
  // dockDir 镜像（自适应 effect 不依赖 dockDir 状态，避免贴边状态变化触发重跑）
  const dockDirRef = useRef<DockDir>(null)
  // 展开态面板状态镜像（悬停事件处理器用即时值判断）
  const panelOpenRef = useRef(false)
  // 收起防抖定时器（鼠标移出后延迟收起，避免宠物↔面板间移动闪烁）
  const panelCollapseTimerRef = useRef(0)
  // 展开态两栏 DOM 测量 refs（窗口尺寸计算用实测高度替代估算）
  const statusCardRef = useRef<HTMLDivElement | null>(null)
  const actionsListRef = useRef<HTMLDivElement | null>(null)
  // 两栏实测高度缓存（面板打开/子菜单展开后测量；气泡自适应与窗口尺寸计算共用）
  const measuredPanelRef = useRef<{ statusH: number; actionsH: number } | null>(null)
  // 上一面板模式（气泡 effect 检测模式切换，同一气泡文本在展开/收起间切换时强制重测重排）
  const prevModeRef = useRef<boolean>(false)

  // 渲染期禁止写 ref，改为 effect 中同步（事件处理器在渲染后执行，行为等价）
  useEffect(() => {
    posRef.current = pos
    clickScaleRef.current = clickScale
    panelOpenRef.current = panelOpen
  })

  const showBubble = useCallback((msg: string) => {
    if (msg) setBubble(msg)
  }, [setBubble])

  // ========== Hooks ==========

  // 安全定时器
  const { safeTimeout } = useSafeTimeout()

  // 光标跟随
  const { containerRef, setGazeTarget, setWalkOffset, focusLive2D, reset: resetGaze } = usePetGaze({
    onLive2DFocus: (x, y) => live2dRef.current?.focus(x, y),
  })

  // 占位 refs（用于解决 usePetBehavior 在 usePetSensors 之前初始化的循环依赖）
  // usePetSensors 创建真实 refs 后，通过 useEffect 保持同步
  const workStatePlaceholderRef = useRef<import('../lib/contextAwareness').WorkState>('unknown')
  const musicPlaceholderRef = useRef<boolean>(false)

  // 行走目标 x 范围：收起态按实际窗口宽计算（修复硬编码 300px 残留），展开态限定为面板内宠物区（列间缝隙）。
  // 区间过小 → usePetBehavior 跳过行走（宠物在面板里不游走，避免被挤到/游走到边缘列后面）
  const getWalkBounds = useCallback((): { minX: number; maxX: number } => {
    const petSize = useSettingsStore.getState().petSize
    return computeWalkBounds(
      petSize,
      winSizeRef.current.w,
      panelOpenRef.current,
      useSettingsStore.getState().statusCardMode,
    )
  }, [])

  // 行为状态机（核心状态管理）—— 必须在 usePetSensors 之前，因为后者依赖 setPetState/setCurrentAnimId
  const {
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
  } = usePetBehavior({
    bubbleMessages: character?.bubbleMessages,
    showBubble,
    workStateRef: workStatePlaceholderRef,
    musicSwayingRef: musicPlaceholderRef,
    getWalkBounds,
  })

  // 上下文感知（音乐/天气/网络/工作/日程/情绪/闲置）
  const { musicSwaying, networkOffline, weatherAction, workStateRef, musicSwayingRef: sensorsMusicRef } = usePetSensors({
    showBubble,
    setPetState,
    setCurrentAnimId,
    currentCharacterId,
    safeTimeout,
  })

  // 将 sensors 创建的 refs 同步到 behavior 使用的占位 refs（让 behavior 读到真实值）
  useEffect(() => {
    const sync = () => {
      workStatePlaceholderRef.current = workStateRef.current
      musicPlaceholderRef.current = sensorsMusicRef.current
    }
    sync()
    const id = window.setInterval(sync, 200)
    return () => clearInterval(id)
  }, [workStateRef, sensorsMusicRef, workStatePlaceholderRef, musicPlaceholderRef])

  // Live2D 模型检测与动作映射（使用外部传入的 ref 解决顺序依赖）
  const { useLive2D, live2dModelPath, setLive2dFailed } = usePetLive2D({
    currentCharacterId,
    petState,
    currentAnimId,
    live2dMotionMap,
    live2dRef,
  })
  const facingRef = useRef(facing)
  useEffect(() => {
    facingRef.current = facing
  })

  // 行走动画
  const { startWalkAnimation, interruptWalk } = usePetWalk({
    posRef,
    setPos,
    setPetState,
    setCurrentAnimId,
    setFacing,
    onWalkOffsetChange: (offset) => setWalkOffset(offset),
  })

  // 连接行为状态机到行走动画（解决循环依赖）
  useEffect(() => {
    setStartWalkAnimation(startWalkAnimation)
  }, [setStartWalkAnimation, startWalkAnimation])

  // 拖拽交互
  const {
    dragging,
    dockDir,
    handleMouseDown: dragHandleMouseDown,
    handleMouseMove: dragHandleMouseMove,
    handleMouseUp: dragHandleMouseUp,
    handleMouseLeave: dragHandleMouseLeave,
    setInterruptWalk,
  } = usePetDragging({
    containerRef,
    useLive2D,
    clickScaleRef,
    facingRef,
    posRef,
    onDragStart: () => {
      setPetState('drag')
      setCurrentAnimId('drag')
      lastInteractionTypeRef.current = 'drag'
      // eslint-disable-next-line react-hooks/purity -- 仅拖拽事件处理器执行路径（onDragStart），非渲染路径
      lastInteractionAtRef.current = Date.now()
      interruptWalk()
      setWalkOffset(0)
    },
    onDragEnd: (count) => {
      dragCountRef.current = count
      setPetState('idle')
      setCurrentAnimId('drop')
      lastInteractionTypeRef.current = 'drop'
      // eslint-disable-next-line react-hooks/purity -- 仅拖拽结束事件处理器执行路径（onDragEnd），非渲染路径
      lastInteractionAtRef.current = Date.now()
      trackPetInteraction('drag')
    },
    onClick: () => {
      setClickScale(0.92)
      safeTimeout(() => setClickScale(1), 150)
      petStoreClick()
      trackPetInteraction('click')
      getAchievementManager().recordClick()
      setBubble(pickBubble('pet'))
      setCurrentAnimId('poke')
      lastInteractionTypeRef.current = 'poke'
      // eslint-disable-next-line react-hooks/purity -- 仅事件处理器执行路径（onClick），非渲染路径
      lastInteractionAtRef.current = Date.now()
    },
  })
  useEffect(() => {
    draggingRef.current = dragging
  })
  useEffect(() => {
    dockDirRef.current = dockDir
  }, [dockDir])

  // 连接拖拽中断到行走动画
  useEffect(() => {
    setInterruptWalk(() => interruptWalk)
  }, [setInterruptWalk, interruptWalk])

  // 窗口管理
  const { showWindow, hideWindow } = usePetWindows({
    setPomodoro,
    showBubble,
    setPetState,
    setCurrentAnimId,
    safeTimeout,
    petStateRef,
    petState,
    hunger: stats?.hunger ?? 100,
  })

  // 随机气泡选择
  function pickBubble(cat: string): string {
    const arr = character?.bubbleMessages?.[cat as keyof NonNullable<typeof character>['bubbleMessages']]
    if (!arr || arr.length === 0) return ''
    // eslint-disable-next-line react-hooks/purity -- pickBubble 仅在事件处理器中调用（onClick/触发宠物等），非渲染路径
    return arr[Math.floor(Math.random() * arr.length)]
  }

  // 初始化与周期定时器
  const { interactionCounterRef } = usePetTimers({
    currentCharacterId,
    scheduleNextBehavior,
    showBubble,
    pickBubble,
    setPetState,
    setCurrentAnimId,
    safeTimeout,
    petStateRef,
  })

  // 记忆触发（纪念日/节日/生日）
  usePetMemoryTriggers({
    currentCharacterId,
    showBubble,
    setPetState,
    setCurrentAnimId,
    safeTimeout,
  })

  // ========== Effects ==========

  // 位置持久化
  useEffect(() => {
    setPosition(pos)
  }, [pos, setPosition])

  // 调整窗口物理尺寸并锚定：未贴边时保持窗口中心 X 与底部 Y 不变（宠物像"站在原地长大/缩小"）；
  // 已贴边停靠（dockDir 非空）时锚定对应的屏幕边缘（左贴边固定左缘、底贴边固定底缘…），
  // 避免气泡放大窗口时把贴边的窗口推离边缘，与 usePetDragging.snapToEdge 抢位置。
  // 供启动尺寸校正、滚轮缩放、气泡自适应三处复用。
  const applyWindowSize = useCallback((targetW: number, targetH: number): void => {
    const win = getCurrentWindow()
    const dir = dockDirRef.current
    void Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()])
      .then(async ([pos, size, sf]) => {
        const physW = Math.round(targetW * sf)
        const physH = Math.round(targetH * sf)
        const dW = size.width - physW
        const dH = size.height - physH
        const newX = dir === 'left' ? pos.x : dir === 'right' ? pos.x + dW : pos.x + Math.round(dW / 2)
        const newY = dir === 'top' ? pos.y : pos.y + dH
        await win.setSize(new PhysicalSize(physW, physH))
        await win.setPosition(new PhysicalPosition(newX, newY))
      })
      .catch(() => {})
  }, [])

  // ========== 展开态三区面板（对话顶中 + 状态左侧 + 动作右侧） ==========

  // 面板打开或右侧子菜单变化后：实测两栏实际高度（替代估算值）并校准窗口尺寸
  useEffect(() => {
    if (!panelOpen) return
    const raf = window.requestAnimationFrame(() => {
      const statusH = statusCardRef.current?.offsetHeight ?? STATUS_PANEL_H
      const actionsH = actionsListRef.current?.offsetHeight ?? ACTIONS_PANEL_H
      measuredPanelRef.current = { statusH, actionsH }
      const petSize = useSettingsStore.getState().petSize
      const el = bubbleMeasureRef.current
      const bw = el?.offsetWidth ?? 0
      const bh = el?.offsetHeight ?? 0
      const target = computePanelWindowSize(petSize, bw, bh, actionsH, statusH, statusCardMode)
      const cur = winSizeRef.current
      if (target.w !== cur.w || target.h !== cur.h) {
        applyWindowSize(target.w, target.h)
        setPos(computePanelPetPos(petSize, bw, bh, actionsH, statusH, statusCardMode))
      }
      setStatusHMeasured(statusH)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [panelOpen, actionSub, statusCardMode, applyWindowSize])

  // 展开/收起切换：按目标尺寸改窗口 + 宠物按并排行定位（锚定由 applyWindowSize 按贴边方向处理）
  const handlePanelModeChange = useCallback((open: boolean) => {
    const petSize = useSettingsStore.getState().petSize
    const mode = useSettingsStore.getState().statusCardMode
    const el = bubbleMeasureRef.current
    const bw = el?.offsetWidth ?? 0
    const bh = el?.offsetHeight ?? 0
    const actionsH = measuredPanelRef.current?.actionsH ?? ACTIONS_PANEL_H
    const statusH = measuredPanelRef.current?.statusH ?? STATUS_PANEL_H
    if (open) {
      const target = computePanelWindowSize(petSize, bw, bh, actionsH, statusH, mode)
      setPanelOpen(true)
      applyWindowSize(target.w, target.h)
      setPos(computePanelPetPos(petSize, bw, bh, actionsH, statusH, mode))
    } else {
      const target = computeWindowSizeFor(petSize)
      setPanelOpen(false)
      applyWindowSize(target.w, target.h)
      setPos(computePetPosInWindow(target, petSize))
    }
  }, [applyWindowSize])

  // 光标离开交互区（透明区/窗口外）→ 防抖收起面板。
  // 收起判断复用 usePixelClickThrough 的轮询回调，覆盖「从透明缝隙移出窗口」的 mouseleave 盲区。
  // 注意：面板只由右键/胶囊触发展开，悬停不会展开。
  const handlePanelInteractiveChange = useCallback((interactive: boolean) => {
    window.clearTimeout(panelCollapseTimerRef.current)
    if (interactive) return
    panelCollapseTimerRef.current = window.setTimeout(() => {
      if (panelOpenRef.current && !draggingRef.current) handlePanelModeChange(false)
    }, 600)
  }, [handlePanelModeChange])

  // 像素级点击穿透 —— 气泡/状态卡/动作列表/右键菜单等交互区域通过 PET_FRAMELESS_INTERACTIVE 白名单保持可交互；
  // 第 4 参回调：光标离开交互区（透明区/窗口外）时防抖收起展开面板
  usePixelClickThrough(true, PET_FRAMELESS_INTERACTIVE, false, handlePanelInteractiveChange)

  // 卸载清理收起定时器
  useEffect(() => {
    return () => window.clearTimeout(panelCollapseTimerRef.current)
  }, [])

  // 启动时按持久化的宠物尺寸校正窗口默认尺寸（Rust 初始 inner_size 只作首帧，
  // 这里立即把窗口贴合到「精灵 + 边距 + 气泡空间」的适配尺寸，避免小宠物配大窗口；
  // 锚定策略：窗口中心 X 与底部 Y 不动）。仅当当前尺寸与适配尺寸不符时才调整，
  // 用户手动缩放/拖动的窗口在启动时保持原状。
  useEffect(() => {
    let disposed = false
    const win = getCurrentWindow()
    void Promise.all([win.outerSize(), win.scaleFactor()])
      .then(async ([size, sf]) => {
        if (disposed) return
        const petSize = useSettingsStore.getState().petSize
        const target = computeWindowSizeFor(petSize)
        const curW = Math.round(size.width / sf)
        const curH = Math.round(size.height / sf)
        if (curW === target.w && curH === target.h) return
        const physW = Math.round(target.w * sf)
        const physH = Math.round(target.h * sf)
        const pos = await win.outerPosition()
        const newX = pos.x + Math.round((size.width - physW) / 2)
        const newY = pos.y + (size.height - physH)
        await win.setSize(new PhysicalSize(physW, physH))
        await win.setPosition(new PhysicalPosition(newX, newY))
        if (!disposed) setPos(computePetPosInWindow(target, petSize))
      })
      .catch(() => {})
    return () => { disposed = true }
  }, [])

  // ========== 气泡驱动窗口自适应（内容变长 → 窗口自动放大，气泡关闭 → 恢复） ==========
  useEffect(() => {
    const text = bubble
    // 面板模式切换（展开↔收起）时即使气泡文本不变也要重新计算（对话区位置/窗口尺寸基准都变了）
    const modeChanged = panelOpen !== prevModeRef.current
    prevModeRef.current = panelOpen
    if (text === prevBubbleRef.current && !modeChanged) return
    prevBubbleRef.current = text

    if (!text) {
      // 气泡关闭：恢复窗口尺寸
      const pre = preBubbleWinRef.current
      preBubbleWinRef.current = null
      if (!pre || draggingRef.current) return
      const petSize = useSettingsStore.getState().petSize
      setDialogueZoneH(DIALOGUE_ZONE_PAD)
      // 展开态 → 恢复到面板尺寸（无气泡）；收起态 → 恢复到 max(放大前尺寸, 基准适配)，尊重手动放大
      const target = panelOpen
        ? computePanelWindowSize(
            petSize,
            0,
            0,
            measuredPanelRef.current?.actionsH ?? ACTIONS_PANEL_H,
            measuredPanelRef.current?.statusH ?? STATUS_PANEL_H,
            useSettingsStore.getState().statusCardMode,
          )
        : (() => {
            const fit = computeWindowSizeFor(petSize)
            return { w: Math.max(fit.w, pre.w), h: Math.max(fit.h, pre.h) }
          })()
      const cur = winSizeRef.current
      if (target.w !== cur.w || target.h !== cur.h) {
        applyWindowSize(target.w, target.h)
        if (panelOpen) {
          setPos(computePanelPetPos(
            petSize,
            0,
            0,
            measuredPanelRef.current?.actionsH ?? ACTIONS_PANEL_H,
            measuredPanelRef.current?.statusH ?? STATUS_PANEL_H,
            useSettingsStore.getState().statusCardMode,
          ))
        } else {
          setPos(computePetPosInWindow(target, petSize))
        }
      }
      return
    }

    // 气泡出现：等布局完成后测量实际渲染尺寸（气泡宽度受 max-w 与文本换行影响）
    const raf = window.requestAnimationFrame(() => {
      const el = bubbleMeasureRef.current
      if (!el || draggingRef.current) return
      const petSize = useSettingsStore.getState().petSize
      setDialogueZoneH(DIALOGUE_ZONE_PAD + el.offsetHeight)
      const target = panelOpen
        ? computePanelWindowSize(
            petSize,
            el.offsetWidth,
            el.offsetHeight,
            measuredPanelRef.current?.actionsH ?? ACTIONS_PANEL_H,
            measuredPanelRef.current?.statusH ?? STATUS_PANEL_H,
            useSettingsStore.getState().statusCardMode,
          )
        : computeBubbleWindowSize(petSize, el.offsetWidth, el.offsetHeight)
      const cur = winSizeRef.current
      if (target.w > cur.w || target.h > cur.h) {
        if (!preBubbleWinRef.current) preBubbleWinRef.current = { w: cur.w, h: cur.h }
        applyWindowSize(target.w, target.h)
        if (panelOpen) {
          setPos(computePanelPetPos(
            petSize,
            el.offsetWidth,
            el.offsetHeight,
            measuredPanelRef.current?.actionsH ?? ACTIONS_PANEL_H,
            measuredPanelRef.current?.statusH ?? STATUS_PANEL_H,
            useSettingsStore.getState().statusCardMode,
          ))
        } else {
          setPos(computePetPosInWindow(target, petSize))
        }
      }
    })
    return () => window.cancelAnimationFrame(raf)
    // 依赖仅 [bubble, panelOpen, applyWindowSize]：applyWindowSize 是稳定回调（useCallback([])），
    // winW/winH 经 winSizeRef 即时读取不参与依赖，否则窗口尺寸同步轮询会触发重复测量循环
  }, [bubble, panelOpen, applyWindowSize])

  const spawnHearts = useCallback(() => {
    const ids = [Date.now(), Date.now() + 1, Date.now() + 2]
    setHearts(ids)
    safeTimeout(() => setHearts([]), 1500)
  }, [safeTimeout])

  // 升级检测（渲染期调整状态：检测到等级提升时触发一次升级动画）
  const [prevLevel, setPrevLevel] = useState(0)
  if (character && !levelUp && prevLevel > 0 && stats.level > prevLevel) {
    setPrevLevel(stats.level)
    setLevelUp({ level: stats.level, name: character.displayName })
  } else if (prevLevel !== stats.level) {
    setPrevLevel(stats.level)
  }

  // ========== Mouse Handlers ==========

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button === 2) return
    downPosRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    dragHandleMouseDown(e)
  }

  function handleMouseMove(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()

    // 光标跟随
    const relX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const relY = ((e.clientY - rect.top) / rect.height) * 2 - 1
    setGazeTarget(relX, relY)

    // Live2D 视线跟随
    if (useLive2D) {
      focusLive2D(e.clientX, e.clientY, rect)
    }

    // 摸头检测（非拖拽、非按下状态时）
    if (!downPosRef.current && !draggingRef.current) {
      const relY2 = e.clientY - rect.top
      const inHead = relY2 < rect.height * 0.3
      // eslint-disable-next-line react-hooks/purity -- 仅事件处理器执行路径（onMouseMove），用于速度计算
      const now = Date.now()
      const last = lastMouseRef.current
      if (last) {
        const dt = now - last.t
        const dx = e.clientX - last.x
        const dy = e.clientY - last.y
        const speed = Math.sqrt(dx * dx + dy * dy) / Math.max(1, dt)
        if (inHead && speed > 1.2 && now > petCooldownRef.current) {
          petCooldownRef.current = now + 1500
          triggerPet()
        }
      }
      lastMouseRef.current = { x: e.clientX, y: e.clientY, t: now }
      interactionCounterRef.current.bump()
      const emotion = interactionCounterRef.current.getEmotionAndCheckChange()
      if (emotion === 'curious') {
        setBubble('咦？你在看什么呀？')
      } else if (emotion === 'annoyed') {
        setBubble('哎呀……别老盯着我看啦！')
        setPetState('sad')
        safeTimeout(() => setPetState('idle'), 1500)
      }
      return
    }

    // 拖拽相关逻辑委托给 hook
    dragHandleMouseMove(e)
  }

  function handleMouseUp() {
    downPosRef.current = null
    dragHandleMouseUp()
  }

  function handleMouseLeave() {
    getEmotionManager().setHovered(false)
    setHovered(false)
    if (draggingRef.current) {
      dragHandleMouseLeave()
      setPetState('idle')
    }
    downPosRef.current = null
    resetGaze()
  }

  function handleMouseEnter() {
    getEmotionManager().setHovered(true)
    setHovered(true)
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    // 右键宠物 → 展开面板（右侧动作列表），不再弹独立右键菜单
    if (draggingRef.current) return
    window.clearTimeout(panelCollapseTimerRef.current)
    if (!panelOpenRef.current) handlePanelModeChange(true)
  }

  // ========== Background Drag (transparent window 手动 setPosition) ==========
  const bgDragRef = useRef<{ winX: number; winY: number; mouseX: number; mouseY: number; sf: number } | null>(null)

  function handleBgMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    if (downPosRef.current || draggingRef.current) return
    const win = getCurrentWindow()
    Promise.all([win.outerPosition(), win.scaleFactor()]).then(([p, sf]) => {
      bgDragRef.current = { winX: p.x, winY: p.y, mouseX: e.screenX * sf, mouseY: e.screenY * sf, sf }
    }).catch(() => {})
  }

  function handleBgMouseMove(e: React.MouseEvent) {
    const origin = bgDragRef.current
    if (!origin) return
    const newX = Math.round(origin.winX + (e.screenX * origin.sf - origin.mouseX))
    const newY = Math.round(origin.winY + (e.screenY * origin.sf - origin.mouseY))
    getCurrentWindow().setPosition(new PhysicalPosition(newX, newY)).catch(() => {})
  }

  function handleBgMouseUp() {
    bgDragRef.current = null
  }

  // ========== 停靠（贴边）视觉反馈 —— 对齐 Dororo 边缘吸附交互 ==========
  const [hovered, setHovered] = useState(false)
  const prevDockDirRef = useRef<DockDir>(null)

  // 停靠贴边变换：吸附的是「窗口」，但用户看到的是「宠物本体」——
  // 宠物在窗口内位置不定（行走/缩放），必须把宠物本体对齐到屏幕边缘，
  // 否则窗口贴边而宠物悬空（"没到边缘就吸附"的怪现象）。
  // 悬停时向屏幕内轻微探头（poke 24px）。
  const dockTransform = useMemo(() => {
    if (!dockDir) return undefined
    // sprite 尺寸在 render 前部才计算，这里直接按 petSize 派生（避免 TDZ）
    const sw = SPRITE_W * petSize
    const sh = SPRITE_H * petSize
    const poke = hovered ? 24 : 0
    switch (dockDir) {
      // 宠物左边缘 → 窗口左边缘（窗口贴边后即屏幕左边缘）
      case 'left': return `translateX(${Math.round(-pos.x + poke)}px)`
      case 'right': return `translateX(${Math.round(winW - pos.x - sw - poke)}px)`
      case 'top': return `translateY(${Math.round(-pos.y + poke)}px)`
      case 'bottom': return `translateY(${Math.round(winH - pos.y - sh - poke)}px)`
      default: return undefined
    }
  }, [dockDir, hovered, pos.x, pos.y, winW, winH, petSize])

  // 停靠进入时冒一句气泡（拖动中不提示；setTimeout 异步触发避免 effect 内同步 setState）
  useEffect(() => {
    const prev = prevDockDirRef.current
    prevDockDirRef.current = dockDir
    if (dockDir && !prev && !dragging) {
      const t = window.setTimeout(() => {
        setBubble('贴边休息一下～')
      }, 0)
      return () => window.clearTimeout(t)
    }
  }, [dockDir, dragging, setBubble])

  // ========== 托盘图标实时渲染（参考 ai-bubu：宠物当前帧 → 托盘图标） ==========
  // 当前精灵帧号（SpriteRenderer.onFrameChange 回传，图集动画帧变化时更新）
  const trayFrameRef = useRef(0)

  // 状态/角色变化立即更新托盘图标，并每 3s 定时抓帧（覆盖图集 idle 动画的帧推进）
  useEffect(() => {
    let disposed = false
    let timer = 0
    const update = () => {
      if (disposed) return
      void renderPetTrayIcon(currentCharacterId, petState, trayFrameRef.current)
        .then((png) => {
          if (png && !disposed) {
            void invoke('set_tray_icon_png', { png }).catch(() => {})
          }
        })
        .catch(() => {})
    }
    update()
    timer = window.setInterval(update, 3000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [currentCharacterId, petState])

  // ========== Actions ==========

  function triggerPet() {
    const cur = usePetStore.getState().getCurrentStats()
    const reaction = pickPetReaction(cur)
    setPetState(reaction)
    setCurrentAnimId('pet_head')
    petStorePet()
    trackPetInteraction('pet')
    getAchievementManager().recordPet()
    spawnHearts()
    setBubble(pickBubble('pet'))
    lastInteractionTypeRef.current = 'pet_head'
    // eslint-disable-next-line react-hooks/purity -- 仅事件处理器执行路径（triggerPet：点击/菜单/面板按钮），非渲染路径
    lastInteractionAtRef.current = Date.now()
    // P2-4：记录被摸头经历
    void getPetExperienceManager(currentCharacterId).record('pet')
    safeTimeout(() => setPetState('idle'), 1200)
  }

  function handleFeed(food: InventoryItem) {
    petStoreFeed(food)
    trackPetInteraction('feed')
    getAchievementManager().recordFeed()
    setBubble(pickBubble('feed'))
    setPetState('eat')
    setCurrentAnimId('feed')
    lastInteractionTypeRef.current = 'feed'
    // eslint-disable-next-line react-hooks/purity -- 仅事件处理器执行路径（handleFeed：菜单/面板按钮），非渲染路径
    lastInteractionAtRef.current = Date.now()
    // P2-4：记录被喂食经历
    void getPetExperienceManager(currentCharacterId).record('feed')
    safeTimeout(() => setPetState('idle'), 1500)
  }

  function handlePlay() {
    petStorePlay()
    getAchievementManager().recordPlay()
    setBubble(pickBubble('pet'))
    setPetState('happy')
    setCurrentAnimId('play')
    lastInteractionTypeRef.current = 'play'
    // eslint-disable-next-line react-hooks/purity -- 仅事件处理器执行路径（handlePlay：菜单/面板按钮），非渲染路径
    lastInteractionAtRef.current = Date.now()
    // P2-4：记录被逗玩经历
    void getPetExperienceManager(currentCharacterId).record('play')
    safeTimeout(() => setPetState('idle'), 1500)
  }

  function handleBathe() {
    petStoreBathe()
    getAchievementManager().recordBathe()
    setBubble('洗得香喷喷～')
    setPetState('happy')
    setCurrentAnimId('bath')
    lastInteractionTypeRef.current = 'bath'
    lastInteractionAtRef.current = Date.now()
    // P2-4：记录洗澡经历
    void getPetExperienceManager(currentCharacterId).record('bathe')
    safeTimeout(() => setPetState('idle'), 1500)
  }

  function handleStartPomodoro(minutes: number) {
    // eslint-disable-next-line react-hooks/purity -- 仅事件处理器执行路径（handleStartPomodoro：菜单/面板按钮），非渲染路径
    setPomodoro({ duration: minutes * 60, startedAt: Date.now() })
    setBubble(`开始专注 ${minutes} 分钟！加油～`)
  }

  function handleScreenshot() {
    const ssMgr = getScreenshotManager()
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (canvas) {
      const ss = ssMgr.captureFromCanvas(canvas, currentCharacterId, character?.displayName ?? 'Pet')
      setBubble(ss ? '截图已保存到相册～' : '截图失败…')
    } else {
      setBubble('截图失败…')
    }
  }

  const handlePomodoroComplete = useCallback(() => {
    completePomodoro(25)
    getAchievementManager().recordPomodoro(25)
    trackTomatoComplete(25)
    setBubble(pickBubble('pomodoroDone'))
    setPomodoro(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pickBubble 是组件内每次渲染新建的函数，加入依赖会导致回调每次渲染重建，行为不变且避免不必要的子组件重渲染
  }, [completePomodoro])

  function handleExit() {
    void hideWindow()
  }

  function handleDialogue() {
    const graphs = getDialogueManager().getRegisteredGraphIds()
    if (graphs.length === 0) return
    const graphId = graphs[Math.floor(Math.random() * graphs.length)]
    setDialogueGraphId(graphId)
  }

  function handleSwitchCharacter(id: string) {
    if (id === currentCharacterId) return
    trackImageSwitch(currentCharacterId, id)
    setFading(true)
    setBubble(null)
    fadeTimerRef.current = window.setTimeout(() => {
      switchPetChar(id)
      switchSettingsChar(id)
      setPetState('idle')
      setCurrentAnimId('idle')
      setFading(false)
    }, 300)
  }

  function confirmDefaultCharacter() {
    const def = getDefaultCharacter()
    if (!def) {
      setFirstRun(false)
      return
    }
    initPetChar(def.id)
    switchPetChar(def.id)
    switchSettingsChar(def.id)
    try {
      localStorage.setItem('spiritpal-first-run-done', '1')
    } catch {
      // 忽略存储错误
    }
    setFirstRun(false)
  }

  // 键盘导航
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void showWindow('chat-window')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (panelOpen) {
        handlePanelModeChange(false)
      } else {
        void handleExit()
      }
    }
  }

  // 滚轮缩放（窗口随宠物尺寸自适应：精灵放大时窗口同步变大，锚定中心 X 与底部 Y）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const currentSize = useSettingsStore.getState().petSize
    const newSize = Math.min(3.0, Math.max(0.5, +(currentSize + delta).toFixed(1)))
    if (newSize !== currentSize) {
      updateSettings({ petSize: newSize })
      // 目标窗口尺寸：展开态按三区面板计算（对话区叠加气泡尺寸）；收起态按宠物基准适配 + 气泡尺寸
      const bubbleEl = bubbleMeasureRef.current
      const bw = bubbleEl?.offsetWidth ?? 0
      const bh = bubbleEl?.offsetHeight ?? 0
      let needW: number
      let needH: number
      if (panelOpenRef.current) {
        const panelSize = computePanelWindowSize(
          newSize,
          bw,
          bh,
          measuredPanelRef.current?.actionsH ?? ACTIONS_PANEL_H,
          measuredPanelRef.current?.statusH ?? STATUS_PANEL_H,
          useSettingsStore.getState().statusCardMode,
        )
        needW = panelSize.w
        needH = panelSize.h
        setPos(computePanelPetPos(
          newSize,
          bw,
          bh,
          measuredPanelRef.current?.actionsH ?? ACTIONS_PANEL_H,
          measuredPanelRef.current?.statusH ?? STATUS_PANEL_H,
          useSettingsStore.getState().statusCardMode,
        ))
      } else {
        const fit = computeWindowSizeFor(newSize)
        const bubbleSize = computeBubbleWindowSize(newSize, bw, bh)
        needW = Math.max(fit.w, bubbleSize.w)
        needH = Math.max(fit.h, bubbleSize.h)
        setPos(computePetPosInWindow({ w: needW, h: needH }, newSize))
      }
      applyWindowSize(needW, needH)
    }
  }, [updateSettings, applyWindowSize])

  // ========== Render ==========

  if (firstRun) {
    return firstRunStep === 'greet' ? (
      <div className="relative h-full w-full">
        <FirstRunGreeting
          character={getDefaultCharacter()}
          onConfirm={confirmDefaultCharacter}
          onBrowse={() => setFirstRunStep('select')}
        />
        <FramelessResizeHandles />
      </div>
    ) : (
      <div className="relative h-full w-full">
        <CharacterSelector onSelect={() => setFirstRun(false)} />
        <FramelessResizeHandles />
      </div>
    )
  }

  if (!character) return (
    <div
      className="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden"
      style={{ opacity: petOpacity, background: 'transparent' }}
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink/10 bg-surface px-6 py-5 text-center text-ink shadow-soft">
        <div className="text-4xl">🐾</div>
        <div className="text-sm font-semibold">还没有角色哦</div>
        <div className="max-w-[200px] text-xs leading-relaxed text-ink-muted">
          当前没有可用的角色资源，请在设置中选择一个角色开始吧~
        </div>
      </div>
      <FramelessResizeHandles />
    </div>
  )

  const spriteW = SPRITE_W * petSize
  const spriteH = SPRITE_H * petSize

  const bgStyle: React.CSSProperties = (() => {
    switch (background.type) {
      case 'solid': return { background: background.color ?? 'transparent' }
      case 'gradient': return {
        background: `linear-gradient(${background.direction ?? 'to bottom'}, ${background.color ?? '#ffffff'}, ${background.color2 ?? '#ffffff'})`,
      }
      case 'image': return background.imagePath ? {
        backgroundImage: `url(${background.imagePath})`,
        backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      } : {}
      default: return {}
    }
  })()

  const backDecorations = wornDecorations.filter((d) => d.anchor === 'back')
  const frontDecorations = wornDecorations.filter((d) => d.anchor !== 'back')

  return (
    <div
      className="relative h-screen w-screen overflow-hidden spiritpal-focusable"
      style={{ opacity: petOpacity, background: 'transparent' }}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onMouseLeave={() => handlePanelInteractiveChange(false)}
      tabIndex={0}
      aria-label="宠物窗口"
      role="application"
    >
      {/* 无边框窗口拖拽层（隐藏，仅用于窗口拖拽）。
          z-20 低于状态面板/状态栏（z-30），避免遮挡面板导致其无法被按住拖动 */}
      <div className="absolute left-0 right-0 top-0 z-20 h-8" data-tauri-drag-region aria-hidden="true" />

      {/* 窗口边框预览（调试用）：虚线框标出宠物窗口的实际边界 + 角落显示尺寸/缩放。
          pointer-events-none 不拦截交互，也不会影响像素穿透判定 */}
      {showWindowBorder && (
        <div className="pointer-events-none absolute inset-0 z-[60]" aria-hidden="true">
          <div className="absolute inset-0 border-2 border-dashed border-tangerine/70" />
          <div className="absolute left-1 top-1 rounded bg-tangerine/80 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
            {winW}×{winH} · {petSize.toFixed(1)}×
          </div>
        </div>
      )}

      {/* 背景层（同时也是窗口拖拽面：按住空白背景可拖动无边框窗口） */}
      <div
        className={`${DRAG_SURFACE_CLASS} absolute inset-0`}
        style={bgStyle}
        onMouseDown={handleBgMouseDown}
        onMouseMove={handleBgMouseMove}
        onMouseUp={handleBgMouseUp}
        onMouseLeave={handleBgMouseUp}
      />

      {/* 收起态胶囊：状态卡开启（left/right）时显示，位置跟随状态卡模式（left=左上/right=右上）；点击展开面板 */}
      {!panelOpen && statusCardMode !== 'off' && (
        <div
          data-spiritpal-panel
          className="absolute top-1 z-30"
          style={{ left: statusCardMode === 'left' ? 4 : undefined, right: statusCardMode === 'right' ? 4 : undefined }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handlePanelModeChange(true)}
            className="flex select-none items-center gap-1.5 rounded-full border border-ink/10 bg-surface/90 px-2 py-0.5 text-[10px] font-semibold text-ink shadow-soft backdrop-blur-sm hover:border-tangerine/40 hover:text-tangerine-deep"
            aria-label="展开状态卡"
          >
            <span>{character.displayName}</span>
            <span className="text-ink-faint">Lv.{stats.level}</span>
            <span className="flex items-center gap-0.5 text-tangerine-deep">
              <span aria-hidden="true">🪙</span>
              <span className="tabular-nums">{coins}</span>
            </span>
          </button>
        </div>
      )}

      {/* 顶部对话区：宠物说话时自动显示在窗口正上方，随内容自适应高度（收起态与展开态通用） */}
      {bubble && (
        <div data-spiritpal-dialogue className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
          <PetBubble
            message={bubble}
            onClose={() => setBubble(null)}
            measureRef={bubbleMeasureRef}
            anchor="top-center"
          />
        </div>
      )}

      {/* ========== 展开态面板（对话顶中 + 状态卡按模式 + 动作右侧） ========== */}
      {panelOpen && (
        <>
          {/* 状态卡：left=内容行左侧（随对话区下移）/ right=窗口右侧；off=不显示 */}
          {statusCardMode !== 'off' && (
            <div
              ref={statusCardRef}
              data-spiritpal-panel
              className="absolute z-30"
              style={{
                top: statusCardMode === 'left' ? dialogueZoneH : 4,
                left: statusCardMode === 'left' ? 4 : undefined,
                right: statusCardMode === 'right' ? 4 : undefined,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                className="select-none rounded-panel border border-ink/10 bg-surface/95 p-2 text-ink shadow-soft"
                style={{ width: STATUS_PANEL_W }}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold">{character.displayName}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-ink-faint">Lv.{stats.level}</span>
                    <button
                      onClick={() => handlePanelModeChange(false)}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-ink-muted hover:bg-ink/10 hover:text-ink"
                      aria-label="收起面板"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <div className="mt-1 flex flex-col gap-0.5">
                  <StatRow label="心情" value={stats.mood} color={tierColor(stats.mood)} />
                  <StatRow label="饱食" value={stats.hunger} color={tierColor(stats.hunger)} />
                  <StatRow label="活力" value={stats.health} color={tierColor(stats.health)} />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-tangerine-deep">
                  <span aria-hidden="true">🪙</span>
                  <span className="tabular-nums">{coins}</span>
                </div>
                <div className="mt-1 flex gap-1">
                  <button
                    onClick={() => void showWindow('chat-window')}
                    className="flex-1 rounded-full bg-tangerine px-2 py-1 text-[11px] font-semibold text-white hover:bg-tangerine-deep"
                  >
                    聊天
                  </button>
                  <button
                    onClick={() => void showWindow('settings-window')}
                    className="flex-1 rounded-full border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink-muted hover:border-tangerine hover:text-tangerine-deep"
                  >
                    设置
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 右侧动作列表（右键宠物展开的就是它）：right 模式时下移到状态卡下方 */}
          <div
            ref={actionsListRef}
            data-spiritpal-actions
            className="absolute right-1 z-30 select-none rounded-panel border border-ink/10 bg-surface/95 p-1.5 text-ink shadow-soft"
            style={{
              width: ACTIONS_PANEL_W,
              top: statusCardMode === 'right' ? 4 + statusHMeasured + 6 : dialogueZoneH,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <ActionButton icon={<Hand size={13} />} label="摸摸" onClick={() => triggerPet()} />
            <ActionButton
              icon={<UtensilsCrossed size={13} />}
              label="喂食"
              onClick={() => setActionSub(actionSub === 'feed' ? null : 'feed')}
              expanded={actionSub === 'feed'}
            >
              {getFoodsForCharacter(currentCharacterId).map((f) => (
                <ActionRow key={f.id} onClick={() => handleFeed(f)}>
                  <span className="text-xs">{f.icon}</span>
                  <span className="text-[10px]">{f.name}</span>
                </ActionRow>
              ))}
            </ActionButton>
            <ActionButton icon={<Gamepad2 size={13} />} label="玩耍" onClick={() => handlePlay()} />
            <ActionButton icon={<Bath size={13} />} label="洗澡" onClick={() => handleBathe()} />
            <ActionButton icon={<MessageSquare size={13} />} label="对话" onClick={() => handleDialogue()} />
            <ActionButton
              icon={<Timer size={13} />}
              label="番茄钟"
              onClick={() => setActionSub(actionSub === 'pomodoro' ? null : 'pomodoro')}
              expanded={actionSub === 'pomodoro'}
            >
              {[15, 25, 45, 60].map((m) => (
                <ActionRow key={m} onClick={() => handleStartPomodoro(m)}>
                  <span className="text-[10px]">{m} 分钟</span>
                </ActionRow>
              ))}
            </ActionButton>
            <ActionButton icon={<Camera size={13} />} label="截图" onClick={() => handleScreenshot()} />
            <ActionButton
              icon={<MessageCircle size={13} />}
              label="聊天"
              onClick={() => void showWindow('chat-window')}
            />
            <ActionButton
              icon={<Shirt size={13} />}
              label="换装"
              onClick={() => {
                void windowEventBus.emit('open-settings-tab', { tab: 'appearance' })
                void showWindow('settings-window').then(() => {
                  window.setTimeout(() => {
                    void windowEventBus.emit('open-settings-tab', { tab: 'appearance' })
                  }, 250)
                })
              }}
            />
            <ActionButton
              icon={<Settings size={13} />}
              label="设置"
              onClick={() => void showWindow('settings-window')}
            />
            <ActionButton
              icon={<Frame size={13} />}
              label={`窗口边框${showWindowBorder ? '：开' : '：关'}`}
              onClick={() => updateSettings({ showWindowBorder: !showWindowBorder })}
            />
            <ActionButton
              icon={<Footprints size={13} />}
              label="漫游"
              onClick={() => void switchPetForm('roam')}
            />
            <ActionButton
              icon={<Eye size={13} />}
              label="状态卡"
              onClick={() => setActionSub(actionSub === 'status' ? null : 'status')}
              expanded={actionSub === 'status'}
            >
              {([['off', '关闭'], ['left', '左侧'], ['right', '右侧']] as Array<[StatusCardMode, string]>).map(([mode, label]) => (
                <ActionRow key={mode} onClick={() => updateSettings({ statusCardMode: mode })} highlight={statusCardMode === mode}>
                  <span className="text-[10px]">{label}</span>
                  {statusCardMode === mode && <Check size={11} className="ml-auto" />}
                </ActionRow>
              ))}
            </ActionButton>
            <ActionButton
              icon={<RefreshCw size={13} />}
              label="切换角色"
              onClick={() => setActionSub(actionSub === 'switch' ? null : 'switch')}
              expanded={actionSub === 'switch'}
            >
              {getAllCharacters().map((c) => {
                const isCurrent = c.id === currentCharacterId
                return (
                  <ActionRow key={c.id} onClick={() => handleSwitchCharacter(c.id)} highlight={isCurrent}>
                    <span className="h-2 w-2 rounded-full" style={{ background: c.themeColor.primary }} />
                    <span className="text-[10px]">{c.displayName}</span>
                    {isCurrent && <Check size={11} className="ml-auto" />}
                  </ActionRow>
                )
              })}
            </ActionButton>
            <ActionButton icon={<X size={13} />} label="退出" onClick={() => void handleExit()} />
          </div>
        </>
      )}

      {/* 升级动画 */}
      {levelUp && (
        <LevelUpOverlay level={levelUp.level} characterName={levelUp.name} onComplete={() => setLevelUp(null)} />
      )}

      {/* 宠物容器 — usePetGaze 管理 transform（gaze + walk offset） */}
      <div
        ref={containerRef}
        className="absolute"
        style={{
          left: pos.x, top: pos.y, width: spriteW, height: spriteH,
          opacity: fading ? 0 : 1,
          transition: dragging
            ? 'opacity 0.3s ease'
            : 'left 0.3s ease, top 0.3s ease, width 0.3s ease, height 0.3s ease, opacity 0.3s ease',
        }}
      >
        {pomodoro && (
          <PomodoroOverlay
            duration={pomodoro.duration} startedAt={pomodoro.startedAt}
            onStop={() => { setPomodoro(null); setBubble('已停止番茄钟') }}
            onComplete={handlePomodoroComplete}
          />
        )}

        {hearts.map((id, i) => (
          <div key={id} className="pointer-events-none absolute text-lg"
            style={{ left: `${20 + i * 25}%`, top: '20%', animation: 'spiritpal-heart 1.5s ease-out forwards' }}>
            ❤️
          </div>
        ))}

        {/* 断网指示器 */}
        {networkOffline && (
          <div className="pointer-events-none absolute z-20 text-xl" style={{ left: '12%', top: '4px' }}>📡</div>
        )}

        {/* 精灵本体 — 停靠(贴边)变换层：窗口吸附到屏幕边缘时整体向窗外偏移藏身，悬停探头。
            独立包裹层避免与 usePetGaze / usePetDragging / 音乐摇摆的 transform 互相覆盖 */}
        <div
          style={{
            transform: dockTransform,
            transition: dragging || !dockTransform ? 'none' : 'transform 0.3s ease',
          }}
        >
        <div
          className={
            (musicSwaying ? 'spiritpal-music-sway ' : '') +
            (weatherAction === 'fan' ? 'spiritpal-weather-fan' : '') +
            (weatherAction === 'cold' ? 'spiritpal-weather-cold' : '') +
            (weatherAction === 'umbrella' ? 'spiritpal-weather-umbrella' : '') +
            (weatherAction === 'sunny' ? 'spiritpal-weather-sunny' : '')
          }
          style={{ width: spriteW, height: spriteH, position: 'relative' }}
        >
          <DecorationLayer decorations={backDecorations} spriteW={spriteW} spriteH={spriteH}
            facing={facing} clickScale={clickScale} />

          <div
            data-sprite=""
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onContextMenu={handleContextMenu}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
              width: spriteW, height: spriteH,
              cursor: dragging ? 'grabbing' : 'grab',
              transform: useLive2D
                ? `scale(${clickScale}) rotate(${dragging ? 8 : 0}deg)`
                : `scaleX(${facing === 'left' ? -1 : 1}) scale(${clickScale}) rotate(${dragging ? 8 : 0}deg)`,
              transformOrigin: 'bottom center',
              transition: dragging ? 'none' : 'transform 0.15s ease',
            }}
            role="img"
            aria-label={`${character.displayName}，当前状态：${
              petState === 'idle' ? '待机' : petState === 'happy' ? '开心' :
              petState === 'sleep' ? '睡觉' : petState === 'drag' ? '被拖拽' :
              petState === 'eat' ? '吃东西' : petState === 'sad' ? '难过' :
              petState === 'sit' ? '坐着' : petState
            }`}
          >
            {useLive2D && live2dModelPath ? (
              <Live2DRenderer
                ref={live2dRef} modelPath={live2dModelPath} scale={1} opacity={petOpacity}
                width={spriteW} height={spriteH} motionMap={live2dMotionMap}
                onError={() => setLive2dFailed(true)}
              />
            ) : (
              <SpriteRenderer
                characterId={currentCharacterId}
                state={petState}
                size={petSize}
                onFrameChange={(f) => { trayFrameRef.current = f }}
              />
            )}
          </div>

          <DecorationLayer decorations={frontDecorations} spriteW={spriteW} spriteH={spriteH}
            facing={facing} clickScale={clickScale} />

          {/* 天气视觉效果 */}
          {weatherAction !== 'normal' && (
            <>
              <div className={`spiritpal-weather-overlay ${
                weatherAction === 'umbrella' ? 'spiritpal-rain-overlay' : ''
              }${weatherAction === 'cold' ? 'spiritpal-snow-overlay' : ''}`} />
              <div className="pointer-events-none absolute -top-2 -right-2 text-lg" title="天气效果">
                {weatherAction === 'umbrella' ? '☂️' :
                 weatherAction === 'fan' ? '🪭' :
                 weatherAction === 'cold' ? '🥶' :
                 weatherAction === 'sunny' ? '☀️' : ''}
              </div>
            </>
          )}
        </div>
        </div>{/* 停靠变换层闭合 */}
      </div>

      {/* 对话面板 */}
      {dialogueGraphId && character && (
        <DialoguePanel graphId={dialogueGraphId} characterName={character.displayName}
          onClose={() => setDialogueGraphId(null)} />
      )}

      {/* 无边框窗口缩放手柄：拖拽窗口边缘/角落缩放 */}
      <FramelessResizeHandles />
    </div>
  )
}
