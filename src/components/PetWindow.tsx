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
import { getCharacter, getDefaultCharacter } from '../lib/characters'
import { getModManager } from '../lib/modManager'
import { PetBubble } from './PetBubble'
import { PetContextMenu } from './PetContextMenu'
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
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window'
import { switchPetForm } from '../lib/petForm'
import { FramelessResizeHandles, DRAG_SURFACE_CLASS } from './FramelessChrome'
import { usePixelClickThrough } from '../lib/pixelClickThrough'
// P2-4：宠物共同经历记忆
import { getPetExperienceManager } from '../lib/petExperience'

const WIN_W = 300
// 像素点击穿透的额外交互白名单（状态卡片等面板区域保持可点击）
const PET_FRAMELESS_INTERACTIVE = ['[class*="panel"]']

const WIN_H = 400
const SPRITE_W = 192
const SPRITE_H = 208
const __emptyDecorations: never[] = []

function DockStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1" role="progressbar" aria-label={`${label} ${value}%`}
      aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span className="text-[10px]">{label}</span>
      <span className="ml-auto tabular-nums text-[10px] text-ink-faint">{value}</span>
    </div>
  )
}

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
const selectGetColorTier = (s: ReturnType<typeof usePetStore.getState>) => s.getColorTier
const selectSharedCoins = (s: ReturnType<typeof usePetStore.getState>) => s.sharedCoins
const selectSetPosition = (s: ReturnType<typeof usePetStore.getState>) => s.setPosition
const selectWornDecorations = (s: ReturnType<typeof usePetStore.getState>) => s.wornDecorations[s.currentCharacterId] ?? __emptyDecorations
const selectBackground = (s: ReturnType<typeof usePetStore.getState>) => s.background

// Stable settings selectors
const selectPetSize = (s: ReturnType<typeof useSettingsStore.getState>) => s.petSize
const selectPetOpacity = (s: ReturnType<typeof useSettingsStore.getState>) => s.petOpacity
const selectSwitchSettingsChar = (s: ReturnType<typeof useSettingsStore.getState>) => s.switchCharacter
const selectUpdateSettings = (s: ReturnType<typeof useSettingsStore.getState>) => s.updateSettings

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
  const getColorTier = usePetStore(selectGetColorTier)
  const sharedCoins = usePetStore(selectSharedCoins)
  const setPosition = usePetStore(selectSetPosition)
  const wornDecorations = usePetStore(selectWornDecorations)
  const background = usePetStore(selectBackground)

  const petSize = useSettingsStore(selectPetSize)
  const petOpacity = useSettingsStore(selectPetOpacity)
  const switchSettingsChar = useSettingsStore(selectSwitchSettingsChar)
  const updateSettings = useSettingsStore(selectUpdateSettings)

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

  // 窗口宽度档位（S/M/L 自适应）
  const [winW, setWinW] = useState<number>(WIN_W)
  useEffect(() => {
    const win = getCurrentWindow()
    let disposed = false
    const sync = () => {
      win.outerSize().then((s) => { if (!disposed) setWinW(s.width) }).catch(() => {})
    }
    sync()
    let unlistenFn: (() => void) | null = null
    win.onResized(({ payload }) => { if (!disposed) setWinW(payload.width) })
      .then((fn) => { unlistenFn = fn; if (disposed) fn() })
      .catch(() => {})
    // 兜底：resize 事件可能因权限/时序丢失，周期轮询同步窗口尺寸（S/M/L 自适应档位）
    const timer = window.setInterval(sync, 2000)
    return () => { disposed = true; unlistenFn?.(); window.clearInterval(timer) }
  }, [])
  const winTier: 'S' | 'M' | 'L' = winW >= 540 ? 'L' : winW >= 360 ? 'M' : 'S'

  // ========== Core UI State (组件拥有) ==========
  const [pos, setPos] = useState<{ x: number; y: number }>(
    () => usePetStore.getState().position ?? { x: (WIN_W - SPRITE_W) / 2, y: WIN_H - SPRITE_H - 8 }
  )
  const [clickScale, setClickScale] = useState(1)
  const [bubble, setBubble] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dialogueGraphId, setDialogueGraphId] = useState<string | null>(null)
  const [hearts, setHearts] = useState<number[]>([])
  const [fading, setFading] = useState(false)
  const [pomodoro, setPomodoro] = useState<{ duration: number; startedAt: number } | null>(null)
  const [levelUp, setLevelUp] = useState<{ level: number; name: string } | null>(null)

  // ========== Refs ==========
  const posRef = useRef(pos)
  const clickScaleRef = useRef(clickScale)
  const menuRef = useRef<{ x: number; y: number } | null>(null)
  const fadeTimerRef = useRef(0)
  const petCooldownRef = useRef(0)
  const lastMouseRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const downPosRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const draggingRef = useRef(false)
  const live2dRef = useRef<import('../components/Live2DRenderer').Live2DRendererHandle | null>(null)

  // 渲染期禁止写 ref，改为 effect 中同步（事件处理器在渲染后执行，行为等价）
  useEffect(() => {
    posRef.current = pos
    clickScaleRef.current = clickScale
    menuRef.current = menu
  })

  const showBubble = useCallback((msg: string) => {
    if (msg) setBubble(msg)
  }, [])

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
      lastInteractionAtRef.current = Date.now()
      interruptWalk()
      setWalkOffset(0)
    },
    onDragEnd: (count) => {
      dragCountRef.current = count
      setPetState('idle')
      setCurrentAnimId('drop')
      lastInteractionTypeRef.current = 'drop'
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

  // 像素级点击穿透 —— 暂时禁用以修复窗口拖拽问题
  usePixelClickThrough(true, PET_FRAMELESS_INTERACTIVE)

  // ========== Effects ==========

  // 位置持久化
  useEffect(() => {
    setPosition(pos)
  }, [pos, setPosition])

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
    if (draggingRef.current) {
      dragHandleMouseLeave()
      setPetState('idle')
    }
    downPosRef.current = null
    resetGaze()
  }

  function handleMouseEnter() {
    getEmotionManager().setHovered(true)
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
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
      if (menu) {
        setMenu(null)
      } else {
        void handleExit()
      }
    }
  }

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const currentSize = useSettingsStore.getState().petSize
    const newSize = Math.min(3.0, Math.max(0.5, +(currentSize + delta).toFixed(1)))
    if (newSize !== currentSize) {
      updateSettings({ petSize: newSize })
      const newSpriteW = SPRITE_W * newSize
      const newSpriteH = SPRITE_H * newSize
      setPos({
        x: Math.max(0, (WIN_W - newSpriteW) / 2),
        y: Math.max(0, WIN_H - newSpriteH - 8),
      })
    }
  }, [updateSettings])

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
  const hungerTier = getColorTier(stats.hunger)
  const moodTier = getColorTier(stats.mood)
  const tierColor: Record<string, string> = {
    green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444',
  }

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
      tabIndex={0}
      aria-label="宠物窗口"
      role="application"
    >
      {/* 无边框窗口拖拽层（隐藏，仅用于窗口拖拽） */}
      <div className="absolute left-0 right-0 top-0 z-50 h-8" data-tauri-drag-region aria-hidden="true" />

      {/* 背景层（同时也是窗口拖拽面：按住空白背景可拖动无边框窗口） */}
      <div
        className={`${DRAG_SURFACE_CLASS} absolute inset-0`}
        style={bgStyle}
        onMouseDown={handleBgMouseDown}
        onMouseMove={handleBgMouseMove}
        onMouseUp={handleBgMouseUp}
        onMouseLeave={handleBgMouseUp}
      />

      {/* 升级动画 */}
      {levelUp && (
        <LevelUpOverlay level={levelUp.level} characterName={levelUp.name} onComplete={() => setLevelUp(null)} />
      )}

      {/* 状态栏（S 档紧凑显示；M/L 档由右侧面板承载） */}
      {winTier === 'S' && (
        <div
          className="absolute left-1 top-1 z-30 flex flex-col gap-0.5 rounded-panel border border-ink/10 bg-surface/90 px-2 py-1.5 text-[10px] text-ink shadow-soft"
          role="group" aria-label="宠物状态信息"
        >
          <div className="flex items-center gap-1" role="progressbar"
            aria-label={`饱食度 ${Math.round(stats.hunger)}%`}
            aria-valuenow={Math.round(stats.hunger)} aria-valuemin={0} aria-valuemax={100}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: tierColor[hungerTier] }} aria-hidden="true" />
            <span>饱食 {Math.round(stats.hunger)}</span>
          </div>
          <div className="flex items-center gap-1" role="progressbar"
            aria-label={`心情度 ${Math.round(stats.mood)}%`}
            aria-valuenow={Math.round(stats.mood)} aria-valuemin={0} aria-valuemax={100}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: tierColor[moodTier] }} aria-hidden="true" />
            <span>心情 {Math.round(stats.mood)}</span>
          </div>
          <div className="flex items-center gap-1 text-tangerine-deep" aria-label={`金币 ${sharedCoins}`}>
            <span aria-hidden="true">🪙</span> <span className="tabular-nums">{sharedCoins}</span>
          </div>
        </div>
      )}

      {/* 缩放档位面板（M/L 档出现，对应高保真 S/M/L 自适应布局） */}
      {winTier !== 'S' && character && (
        <div className="absolute right-1 top-1 z-30 flex w-[128px] flex-col gap-1 rounded-panel border border-ink/10 bg-surface/95 p-2 text-ink shadow-soft">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold">{character.displayName}</span>
            <span className="text-ink-faint">Lv.{stats.level}</span>
          </div>
          <DockStat label="心情" value={Math.round(stats.mood)} color={tierColor[moodTier]} />
          <DockStat label="饱食" value={Math.round(stats.hunger)} color={tierColor[hungerTier]} />
          <DockStat label="活力" value={Math.round(stats.health)} color="#22c55e" />
          <div className="flex items-center justify-between text-[10px] text-tangerine-deep">
            <span aria-hidden="true">🪙</span><span className="tabular-nums">{sharedCoins}</span>
          </div>
          <div className="mt-0.5 flex gap-1">
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
        {bubble && <PetBubble message={bubble} onClose={() => setBubble(null)} />}

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

        {/* 精灵本体 — 外层音乐/天气动画，usePetDragging 管理 [data-sprite] transform */}
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
              <SpriteRenderer characterId={currentCharacterId} state={petState} size={petSize} />
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
      </div>

      {/* 右键菜单 */}
      {menu && (
        <PetContextMenu
          x={menu.x} y={menu.y} currentCharacterId={currentCharacterId}
          onClose={() => setMenu(null)}
          onChat={() => void showWindow('chat-window')}
          onPet={triggerPet}
          onFeed={handleFeed}
          onPlay={handlePlay}
          onBathe={handleBathe}
          onDressup={() => void showWindow('settings-window')}
          onPomodoro={handleStartPomodoro}
          onScreenshot={handleScreenshot}
          onSettings={() => void showWindow('settings-window')}
          onRoam={() => void switchPetForm('roam')}
          onSwitchCharacter={handleSwitchCharacter}
          onDialogue={handleDialogue}
          onExit={() => void handleExit()}
        />
      )}

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
