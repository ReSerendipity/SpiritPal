/**
 * 移动端宠物视图组件
 * @module mobile/MobilePetView
 * @description
 * 移动端全屏宠物展示组件，支持 Live2D/精灵图渲染和丰富的触摸手势交互。
 *
 * 手势映射：
 * - 单击：互动（点击宠物，触发 poke 动画）
 * - 双击：喂食（随机消耗背包中的食物，或默认互动）
 * - 长按：弹出互动菜单（喂食/玩耍/洗澡/摸头）
 * - 拖拽：移动宠物位置
 * - 双指捏合：缩放宠物大小
 *
 * 功能特性：
 * - 自动检测 Live2D 模型，失败时降级为精灵图
 * - 左上角状态显示（饱食度、心情、金币、等级）
 * - 互动气泡提示
 * - 爱心动画反馈
 * - 长按菜单
 *
 * @see {@link ../components/Live2DRenderer} Live2D 渲染器
 * @see {@link ../components/SpriteRenderer} 精灵图渲染器
 * @see {@link ../components/PetBubble} 宠物气泡组件
 * @see {@link ../lib/behaviorEngine} 行为引擎
 */
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { usePetStore } from '../stores/petStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getCharacter } from '../lib/characters'
import { getModManager } from '../lib/modManager'
import { Live2DRenderer, getMotionGroupForState } from '../components/Live2DRenderer'
import type { Live2DRendererHandle } from '../components/Live2DRenderer'
import { SpriteRenderer } from '../components/SpriteRenderer'
import { PetBubble } from '../components/PetBubble'
import { pickPetReaction } from '../lib/behaviorEngine'
import { getAchievementManager } from '../lib/achievementSystem'
import type { PetState, InventoryItem } from '../lib/types'

/**
 * MobilePetView 组件属性
 */
interface MobilePetViewProps {
  /** 当前 Tab 是否激活（非激活时禁用手势） */
  isActive: boolean
  /** 是否深色模式 */
  isDark: boolean
}

/** 长按触发阈值（毫秒） */
const LONG_PRESS_THRESHOLD = 500
/** 双击间隔阈值（毫秒） */
const DOUBLE_TAP_THRESHOLD = 300
/** 拖拽触发距离（像素） */
const DRAG_THRESHOLD = 8
/** 最小缩放比例 */
const MIN_SCALE = 0.5
/** 最大缩放比例 */
const MAX_SCALE = 3.0

/**
 * 互动菜单项接口
 */
interface MenuItem {
  /** 菜单项 ID */
  id: string
  /** 显示标签 */
  label: string
  /** 显示表情符号 */
  emoji: string
  /** 点击执行的动作 */
  action: () => void
}

/**
 * 移动端宠物视图组件
 * @param props 组件属性
 * @returns 宠物展示组件
 */
export function MobilePetView({ isActive, isDark }: MobilePetViewProps) {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const stats = usePetStore((s) => s.stats[s.currentCharacterId])
  const petStoreClick = usePetStore((s) => s.click)
  const petStorePet = usePetStore((s) => s.pet)
  const petStoreFeed = usePetStore((s) => s.feed)
  const petStorePlay = usePetStore((s) => s.play)
  const petStoreBathe = usePetStore((s) => s.bathe)
  const sharedCoins = usePetStore((s) => s.sharedCoins)
  const inventory = usePetStore((s) => s.inventory)
  const getColorTier = usePetStore((s) => s.getColorTier)

  const petSize = useSettingsStore((s) => s.petSize)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const character = getCharacter(currentCharacterId)

  // 模组 Live2D 动作映射
  const live2dMotionMap = useMemo(() => {
    try {
      const mod = getModManager().getMod(currentCharacterId)
      return mod?.modData.actConf?.motionMap
    } catch {
      return undefined
    }
  }, [currentCharacterId])

  const [petState, setPetState] = useState<PetState>('idle')
  const [bubble, setBubble] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [hearts, setHearts] = useState<number[]>([])
  const [clickScale, setClickScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [live2dModelPath, setLive2dModelPath] = useState<string | null>(null)
  const [live2dFailed, setLive2dFailed] = useState(false)

  const live2dRef = useRef<Live2DRendererHandle>(null)
  const live2dPathCacheRef = useRef<Map<string, string | null>>(new Map())

  // 手势状态 refs
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastTapRef = useRef<number>(0)
  const longPressTimerRef = useRef<number>(0)
  const dragStartedRef = useRef(false)
  const pinchInitialDistRef = useRef<number>(0)
  const pinchInitialScaleRef = useRef<number>(1)
  const containerRef = useRef<HTMLDivElement>(null)

  const useLive2D = live2dModelPath !== null && !live2dFailed

  /**
   * 显示气泡消息
   * @param msg 气泡文本内容
   */
  const showBubble = useCallback((msg: string) => {
    if (!msg) return
    setBubble(msg)
  }, [])

  /**
   * 从角色配置中随机选取气泡消息
   * @param cat 气泡类别
   * @returns 随机气泡文本
   */
  const pickBubble = useCallback(
    (cat: keyof NonNullable<typeof character>['bubbleMessages']): string => {
      const arr = character?.bubbleMessages[cat]
      if (!arr || arr.length === 0) return ''
      return arr[Math.floor(Math.random() * arr.length)]
    },
    [character],
  )

  /**
   * 触发爱心动画效果
   */
  const spawnHearts = useCallback(() => {
    const ids = [Date.now(), Date.now() + 1, Date.now() + 2]
    setHearts(ids)
    window.setTimeout(() => setHearts([]), 1500)
  }, [])

  // ===== Live2D 模型路径检测（与桌面端 PetWindow 逻辑一致）=====
  useEffect(() => {
    let cancelled = false
    const cache = live2dPathCacheRef.current
    if (cache.has(currentCharacterId)) {
      const cached = cache.get(currentCharacterId) ?? null
      setLive2dModelPath(cached)
      setLive2dFailed(false)
      return
    }
    const candidates = [
      `/pets/${currentCharacterId}/${currentCharacterId}.model3.json`,
      `/pets/live2d/${currentCharacterId}/${currentCharacterId}.model3.json`,
    ]
    void (async () => {
      for (const path of candidates) {
        try {
          const resp = await fetch(path, { method: 'HEAD' })
          if (resp.ok) {
            if (cancelled) return
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
      cache.set(currentCharacterId, null)
      setLive2dModelPath(null)
    })()
    return () => {
      cancelled = true
    }
  }, [currentCharacterId])

  // 监听屏幕尺寸变化
  const [screenSize, setScreenSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const update = () => {
      setScreenSize({ w: window.innerWidth, h: window.innerHeight })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // 宠物显示尺寸：默认占屏幕宽度的 70%，乘以 petSize
  const displayW = Math.max(100, screenSize.w * 0.7 * petSize)
  const displayH = displayW * (208 / 192) // 保持精灵图比例

  // 居中初始位置（setState 延后到微任务，effect 主体不直接同步 setState）
  useEffect(() => {
    if (screenSize.w > 0 && pos.x === 0 && pos.y === 0) {
      void Promise.resolve().then(() => {
        setPos({
          x: (screenSize.w - displayW) / 2,
          y: (screenSize.h - displayH) / 2 - 40,
        })
      })
    }
  }, [screenSize, displayW, displayH, pos])

  // ===== 互动动作 =====

  /**
   * 触发摸头互动
   */
  const triggerPet = useCallback(() => {
    const cur = usePetStore.getState().getCurrentStats()
    const reaction = pickPetReaction(cur)
    setPetState(reaction)
    petStorePet()
    getAchievementManager().recordPet()
    spawnHearts()
    showBubble(pickBubble('pet'))
    window.setTimeout(() => setPetState('idle'), 1200)
  }, [petStorePet, spawnHearts, showBubble, pickBubble])

  /**
   * 触发喂食互动
   */
  const triggerFeed = useCallback(() => {
    // 优先使用背包中第一个食物
    const food = inventory.find((i) => i.type === 'food') as InventoryItem | undefined
    if (food) {
      petStoreFeed(food)
      getAchievementManager().recordFeed()
      showBubble(pickBubble('feed'))
      setPetState('eat')
      window.setTimeout(() => setPetState('idle'), 1500)
    } else {
      // 背包空：提示
      showBubble('背包里没有食物啦～')
    }
  }, [inventory, petStoreFeed, showBubble, pickBubble])

  /**
   * 触发玩耍互动
   */
  const triggerPlay = useCallback(() => {
    petStorePlay()
    getAchievementManager().recordPlay()
    showBubble(pickBubble('pet'))
    setPetState('happy')
    window.setTimeout(() => setPetState('idle'), 1500)
  }, [petStorePlay, showBubble, pickBubble])

  /**
   * 触发洗澡互动
   */
  const triggerBathe = useCallback(() => {
    petStoreBathe()
    getAchievementManager().recordBathe()
    showBubble('洗得香喷喷～')
    setPetState('happy')
    window.setTimeout(() => setPetState('idle'), 1500)
  }, [petStoreBathe, showBubble])

  /**
   * 触发点击互动
   */
  const triggerClick = useCallback(() => {
    setClickScale(0.92)
    window.setTimeout(() => setClickScale(1), 150)
    petStoreClick()
    getAchievementManager().recordClick()
    showBubble(pickBubble('pet'))
  }, [petStoreClick, showBubble, pickBubble])

  // ===== 互动菜单 =====
  const menuItems: MenuItem[] = [
    { id: 'pet', label: '摸头', emoji: '🤚', action: triggerPet },
    { id: 'feed', label: '喂食', emoji: '🍎', action: triggerFeed },
    { id: 'play', label: '玩耍', emoji: '🎮', action: triggerPlay },
    { id: 'bathe', label: '洗澡', emoji: '🛁', action: triggerBathe },
  ]

  // ===== 触摸手势处理 =====

  /**
   * 触摸开始事件处理
   * @param e React 触摸事件
   */
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isActive) return
    const touches = e.touches

    // 双指捏合缩放
    if (touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      pinchInitialDistRef.current = Math.sqrt(dx * dx + dy * dy)
      pinchInitialScaleRef.current = petSize
      // 取消长按计时器
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = 0
      }
      return
    }

    // 单指触摸
    if (touches.length === 1) {
      const t = touches[0]
      touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
      dragStartedRef.current = false
      // 启动长按计时器
      longPressTimerRef.current = window.setTimeout(() => {
        if (!dragStartedRef.current && touchStartRef.current) {
          setMenu({ x: touchStartRef.current.x, y: touchStartRef.current.y })
        }
      }, LONG_PRESS_THRESHOLD)
    }
  }, [isActive, petSize])

  /**
   * 触摸移动事件处理（拖拽/捏合缩放）
   * @param e React 触摸事件
   */
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isActive) return
    const touches = e.touches

    // 双指捏合缩放
    if (touches.length === 2 && pinchInitialDistRef.current > 0) {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const ratio = dist / pinchInitialDistRef.current
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchInitialScaleRef.current * ratio))
      updateSettings({ petSize: +newScale.toFixed(2) })
      return
    }

    // 单指拖拽
    if (touches.length === 1 && touchStartRef.current) {
      const t = touches[0]
      const dx = t.clientX - touchStartRef.current.x
      const dy = t.clientY - touchStartRef.current.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      // 超过阈值时开始拖拽，并取消长按
      if (dist > DRAG_THRESHOLD) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = 0
        }
        if (!dragStartedRef.current) {
          dragStartedRef.current = true
          setPetState('drag')
        }
        setPos((p) => ({
          x: p.x + dx,
          y: p.y + dy,
        }))
        touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
      }
    }
  }, [isActive, updateSettings])

  /**
   * 触摸结束事件处理（单击/双击判断）
   * @param e React 触摸事件
   */
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isActive) return
    // 清除长按计时器
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = 0
    }
    // 重置捏合
    pinchInitialDistRef.current = 0

    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) return

    // 拖拽结束
    if (dragStartedRef.current) {
      dragStartedRef.current = false
      setPetState('idle')
      return
    }

    // 菜单已弹出时不触发点击
    if (menu) return

    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    // 移动距离小则视为点击
    if (dist < DRAG_THRESHOLD) {
      const now = Date.now()
      const lastTap = lastTapRef.current
      lastTapRef.current = now
      if (now - lastTap < DOUBLE_TAP_THRESHOLD) {
        // 双击：喂食
        lastTapRef.current = 0
        triggerFeed()
      } else {
        // 单击：互动
        triggerClick()
      }
    }
  }, [isActive, menu, triggerFeed, triggerClick])

  // Live2D 动画变化时触发动作
  const lastMotionGroupRef = useRef<string>('')
  useEffect(() => {
    if (!useLive2D) return
    const group = getMotionGroupForState(petState, live2dMotionMap)
    if (lastMotionGroupRef.current === group) return
    lastMotionGroupRef.current = group
    live2dRef.current?.playMotion(group, 0)
  }, [petState, useLive2D, live2dMotionMap])

  if (!character || !stats) return null

  const hungerTier = getColorTier(stats.hunger)
  const moodTier = getColorTier(stats.mood)
  const tierColor: Record<string, string> = {
    green: '#22c55e',
    yellow: '#eab308',
    orange: '#f97316',
    red: '#ef4444',
  }

  // 主题样式类
  const statusBgClass = isDark ? 'bg-black/50' : 'bg-black/30'

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${
        isDark ? 'bg-gradient-to-b from-gray-900 to-gray-800' : 'bg-gradient-to-b from-blue-50 to-pink-50'
      }`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: 'none' }}
    >
      {/* 状态栏（左上角） */}
      <div className={`absolute left-2 top-2 z-30 flex flex-col gap-1 rounded-lg ${statusBgClass} px-2 py-1.5 text-[11px] text-white backdrop-blur-sm`}>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: tierColor[hungerTier] }} />
          <span>饱食 {Math.round(stats.hunger)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: tierColor[moodTier] }} />
          <span>心情 {Math.round(stats.mood)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-amber-300">
          🪙 <span className="tabular-nums">{sharedCoins}</span>
        </div>
        <div className="flex items-center gap-1.5 text-indigo-300">
          ❤️ <span className="tabular-nums">Lv.{stats.level}</span>
        </div>
      </div>

      {/* 宠物容器 */}
      <div
        className="absolute"
        style={{
          left: pos.x,
          top: pos.y,
          width: displayW,
          height: displayH,
        }}
      >
        {/* 气泡 */}
        {bubble && <PetBubble message={bubble} onClose={() => setBubble(null)} />}

        {/* 爱心动画 */}
        {hearts.map((id, i) => (
          <div
            key={id}
            className="pointer-events-none absolute text-2xl"
            style={{
              left: `${20 + i * 25}%`,
              top: '20%',
              animation: 'spiritpal-heart 1.5s ease-out forwards',
            }}
          >
            ❤️
          </div>
        ))}

        {/* 宠物本体 */}
        <div
          style={{
            width: displayW,
            height: displayH,
            transform: `scale(${clickScale})`,
            transformOrigin: 'center bottom',
            transition: 'transform 0.15s ease',
          }}
        >
          {useLive2D && live2dModelPath ? (
            <Live2DRenderer
              ref={live2dRef}
              modelPath={live2dModelPath}
              scale={1}
              opacity={1}
              width={displayW}
              height={displayH}
              motionMap={live2dMotionMap}
              onError={() => setLive2dFailed(true)}
            />
          ) : (
            <SpriteRenderer
              characterId={currentCharacterId}
              state={petState}
              size={petSize}
            />
          )}
        </div>
      </div>

      {/* 长按互动菜单 */}
      {menu && (
        <div
          className="absolute z-40 flex flex-col gap-1 rounded-xl bg-white/95 p-2 shadow-2xl dark:bg-gray-800/95"
          style={{
            left: Math.min(menu.x, window.innerWidth - 120),
            top: Math.min(menu.y, window.innerHeight - 200),
          }}
        >
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                item.action()
                setMenu(null)
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <span className="text-lg">{item.emoji}</span>
              <span>{item.label}</span>
            </button>
          ))}
          <button
            onClick={() => setMenu(null)}
            className="mt-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
          >
            关闭
          </button>
        </div>
      )}

      {/* 底部提示 */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-center text-[10px] text-gray-400 dark:text-gray-500">
        单击互动 · 双击喂食 · 长按菜单 · 捏合缩放
      </div>
    </div>
  )
}
