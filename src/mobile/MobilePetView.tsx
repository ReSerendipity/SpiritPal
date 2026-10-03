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
import { useTranslation } from 'react-i18next'
import { DecorationLayer } from '@/components/DecorationLayer'
import { Live2DRenderer, getMotionGroupForState } from '@/components/Live2DRenderer'
import type { Live2DRendererHandle } from '@/components/Live2DRenderer'
import { PetBubble } from '@/components/PetBubble'
import { SpriteRenderer } from '@/components/SpriteRenderer'
import { pickPetReaction } from '@/lib/ai/behaviorEngine'
import { getAllCharacters, getCharacter } from '@/lib/data/characters'
import { getModManager } from '@/lib/data/modManager'
import type { PetState, InventoryItem, WornDecoration } from '@/lib/data/types'
import { getAchievementManager } from '@/lib/nurture/achievementSystem'
import { getFoodsForCharacter } from '@/lib/nurture/items'
import { getPetExperienceManager } from '@/lib/nurture/petExperience'
import { usePetStore } from '@/stores/petStore'
import { useSettingsStore } from '@/stores/settingsStore'

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
 * 稳定的空装饰数组常量。
 * 用字面量 `?? []` 会每次渲染产生新引用 → 触发无谓重渲染（与桌面端 PetWindow 同处理）。
 */
const EMPTY_DECORATIONS: WornDecoration[] = []

/**
 * 互动菜单项接口
 */
interface MenuItem {
  /** 菜单项 ID */
  id: string
  /** 显示标签的 i18n 键（渲染时经 t() 解析） */
  labelKey: string
  /** 显示表情符号 */
  emoji: string
  /** 点击执行的动作 */
  action: () => void
  /** 若设置，点击后展开对应二级面板而不是关闭菜单 */
  opensSub?: 'feed' | 'character'
}

/**
 * 移动端宠物视图组件
 * @param props 组件属性
 * @returns 宠物展示组件
 */
export function MobilePetView({ isActive, isDark }: MobilePetViewProps) {
  const { t } = useTranslation()
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
  // 角色切换需要 settingsStore（当前角色偏好）与 petStore（宠物数据）同时切换，
  // 与 MobileSettingsView 的 handleSwitchCharacter 保持一致
  const switchPetCharacter = usePetStore((s) => s.switchCharacter)
  // 已穿戴装饰品（此前移动端只做穿戴写入、从不渲染，等于穿上看不到）
  const wornDecorations = usePetStore(
    (s) => s.wornDecorations[s.currentCharacterId] ?? EMPTY_DECORATIONS,
  )

  const petSize = useSettingsStore((s) => s.petSize)
  // 宠物透明度（此前移动端固定 1，不跟随设置）
  const petOpacity = useSettingsStore((s) => s.petOpacity)
  const switchSettingsCharacter = useSettingsStore((s) => s.switchCharacter)
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
  /** 长按菜单的二级面板（喂食选食物 / 切换角色） */
  const [menuSub, setMenuSub] = useState<'feed' | 'character' | null>(null)
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
      // 注意：character 与 bubbleMessages 都要可选链 —— 只护住前者时，
      // 缺少 bubbleMessages 的角色配置会在 `undefined[cat]` 处抛错
      const arr = character?.bubbleMessages?.[cat]
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

  // 装饰品分前后两层：back 锚点在精灵之前渲染（层级低于精灵），其余在精灵之后
  const backDecorations = wornDecorations.filter((d) => d.anchor === 'back')
  const frontDecorations = wornDecorations.filter((d) => d.anchor !== 'back')

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
   *
   * P2-4 经历记录此前只在桌面端 PetWindow 的四个动作里接了
   * （`getPetExperienceManager(id).record(...)`），移动端各写了一份 trigger* 却
   * 只记了成就没记经历 ⇒ 手机上「记忆 › 我们的故事」永远是 0，哪怕天天摸。
   * 这里按桌面端同一处位置补回，type 参数与 PetWindow 逐一对齐。
   */
  const triggerPet = useCallback(() => {
    const cur = usePetStore.getState().getCurrentStats()
    const reaction = pickPetReaction(cur)
    setPetState(reaction)
    petStorePet()
    getAchievementManager().recordPet()
    void getPetExperienceManager(currentCharacterId).record('pet')
    spawnHearts()
    showBubble(pickBubble('pet'))
    window.setTimeout(() => setPetState('idle'), 1200)
  }, [petStorePet, spawnHearts, showBubble, pickBubble, currentCharacterId])

  /**
   * 触发喂食互动
   */
  /**
   * 用指定食物喂食
   * @param food 目标食物
   */
  const feedWith = useCallback(
    (food: InventoryItem) => {
      petStoreFeed(food)
      getAchievementManager().recordFeed()
      void getPetExperienceManager(currentCharacterId).record('feed')
      showBubble(pickBubble('feed'))
      setPetState('eat')
      window.setTimeout(() => setPetState('idle'), 1500)
    },
    [petStoreFeed, showBubble, pickBubble, currentCharacterId],
  )

  /**
   * 可选食物列表
   * 优先取角色食谱（与桌面端 PetWindow 的 getFoodsForCharacter 一致），
   * 食谱为空时回退到背包里已有的食物 —— 此前移动端只能自动喂背包第一项，无法选择。
   */
  const feedOptions = useMemo(() => {
    const catalog = getFoodsForCharacter(currentCharacterId)
    if (catalog.length) return catalog
    return inventory.filter((i) => i.type === 'food')
  }, [currentCharacterId, inventory])

  /** 可切换的角色列表（宠物页此前无角色切换入口，只能进设置页） */
  const characterOptions = useMemo(
    () => getAllCharacters(),
    // 角色列表变更时 currentCharacterId 会变，用它做失效依据即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentCharacterId],
  )

  /**
   * 切换当前角色（宠物页内直接切换，无需进设置页）
   * @param id 目标角色 ID
   */
  const handleSwitchCharacter = useCallback(
    (id: string) => {
      if (id === currentCharacterId) return
      switchSettingsCharacter(id)
      switchPetCharacter(id)
    },
    [currentCharacterId, switchSettingsCharacter, switchPetCharacter],
  )

  /** 关闭长按菜单（含二级面板） */
  const closeMenu = useCallback(() => {
    setMenu(null)
    setMenuSub(null)
  }, [])

  // 切走 tab 时必须收起长按菜单。MobilePetView 在 MobileApp 里是常驻挂载的
  // （桌宠不能卸载，见 MobileApp.tsx 的 z-index 分层），而菜单此前只靠用户点
  // 「关闭」收起：切到聊天/养成/设置等 tab 后 menu 仍非 null，六个动作按钮会
  // 继续留在 DOM 且保有非零矩形 —— 视觉上被上层面板盖住，但键盘 Tab 焦点与
  // 读屏遍历仍然可达；切回宠物页时还会残留上次打开的二级面板。
  useEffect(() => {
    if (!isActive) closeMenu()
  }, [isActive, closeMenu])

  const triggerFeed = useCallback(() => {
    // 默认喂第一个可选食物（双击手势走这条快捷路径）
    const food = feedOptions[0]
    if (food) {
      feedWith(food)
    } else {
      // 背包空：提示
      showBubble(t('pet.noFood'))
    }
  }, [feedOptions, feedWith, showBubble, t])

  /**
   * 触发玩耍互动
   */
  const triggerPlay = useCallback(() => {
    petStorePlay()
    getAchievementManager().recordPlay()
    void getPetExperienceManager(currentCharacterId).record('play')
    showBubble(pickBubble('pet'))
    setPetState('happy')
    window.setTimeout(() => setPetState('idle'), 1500)
  }, [petStorePlay, showBubble, pickBubble, currentCharacterId])

  /**
   * 触发洗澡互动
   */
  const triggerBathe = useCallback(() => {
    petStoreBathe()
    getAchievementManager().recordBathe()
    void getPetExperienceManager(currentCharacterId).record('bathe')
    showBubble(t('pet.batheDone'))
    setPetState('happy')
    window.setTimeout(() => setPetState('idle'), 1500)
  }, [petStoreBathe, showBubble, t, currentCharacterId])

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
    { id: 'pet', labelKey: 'action.petHead', emoji: '🤚', action: triggerPet },
    { id: 'feed', labelKey: 'action.feed', emoji: '🍎', action: () => setMenuSub('feed'), opensSub: 'feed' },
    { id: 'play', labelKey: 'action.play', emoji: '🎮', action: triggerPlay },
    { id: 'bathe', labelKey: 'action.bathe', emoji: '🛁', action: triggerBathe },
    {
      id: 'character',
      labelKey: 'action.switchCharacter',
      emoji: '🔄',
      action: () => setMenuSub('character'),
      opensSub: 'character',
    },
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
          setMenuSub(null) // 每次重新长按都从主菜单开始
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
  // 状态色与桌面端 NurturingPanel 的 TIER_COLORS 保持一致
  const tierColor: Record<string, string> = {
    green: 'bg-stat-good',
    yellow: 'bg-stat-mid',
    orange: 'bg-warning',
    red: 'bg-error',
  }

  // 状态浮层：暖棕半透明（与桌面端宠物窗口浮层风格一致）
  const statusBgClass = 'bg-ink/45'

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${
        isDark ? 'bg-gradient-to-b from-ink to-ink/70' : 'bg-gradient-to-b from-cream to-blush-soft'
      }`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: 'none' }}
    >
      {/* 状态栏（左上角） */}
      <div className={`absolute left-2 top-2 z-30 flex flex-col gap-1 rounded-lg ${statusBgClass} px-2 py-1.5 text-[11px] text-white backdrop-blur-sm`}>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${tierColor[hungerTier]}`} />
          <span>{t('stat.hunger')} {Math.round(stats.hunger)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${tierColor[moodTier]}`} />
          <span>{t('stat.mood')} {Math.round(stats.mood)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-tangerine-soft">
          🪙 <span className="tabular-nums">{sharedCoins}</span>
        </div>
        <div className="flex items-center gap-1.5 text-tangerine-soft">
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

        {/* 宠物本体（含装饰图层） */}
        <div
          style={{
            width: displayW,
            height: displayH,
            // 装饰锚点按百分比相对本容器定位，必须建立定位上下文
            position: 'relative',
            // 透明度由设置驱动（同时作用于精灵与装饰，避免分层淡出不一致）
            opacity: petOpacity,
            transform: `scale(${clickScale})`,
            transformOrigin: 'center bottom',
            transition: 'transform 0.15s ease',
          }}
        >
          <DecorationLayer
            decorations={backDecorations}
            spriteW={displayW}
            spriteH={displayH}
            facing="right"
            clickScale={clickScale}
          />
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
          <DecorationLayer
            decorations={frontDecorations}
            spriteW={displayW}
            spriteH={displayH}
            facing="right"
            clickScale={clickScale}
          />
        </div>
      </div>

      {/* 长按互动菜单 */}
      {menu && (
        <div
          className="absolute z-40 flex flex-col gap-1 rounded-xl border border-ink/10 bg-surface/95 p-2 shadow-soft"
          style={{
            left: Math.min(menu.x, window.innerWidth - 120),
            top: Math.min(menu.y, window.innerHeight - 200),
          }}
        >
          {menuSub === 'feed' ? (
            <>
              <button
                onClick={() => setMenuSub(null)}
                className="rounded-lg px-3 py-1 text-xs text-tangerine-deep hover:bg-ink/5"
              >
                ← {t('settings.mobile.back')}
              </button>
              {feedOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-ink-muted">{t('pet.noFood')}</div>
              ) : (
                feedOptions.map((food) => (
                  <button
                    key={food.id}
                    onClick={() => {
                      feedWith(food)
                      closeMenu()
                    }}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink hover:bg-ink/5"
                  >
                    <span className="text-lg">{food.icon}</span>
                    <span>{food.name}</span>
                  </button>
                ))
              )}
            </>
          ) : menuSub === 'character' ? (
            <>
              <button
                onClick={() => setMenuSub(null)}
                className="rounded-lg px-3 py-1 text-xs text-tangerine-deep hover:bg-ink/5"
              >
                ← {t('settings.mobile.back')}
              </button>
              {characterOptions.map((char) => (
                <button
                  key={char.id}
                  onClick={() => {
                    handleSwitchCharacter(char.id)
                    closeMenu()
                  }}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-ink/5 ${
                    char.id === currentCharacterId ? 'text-tangerine-deep' : 'text-ink'
                  }`}
                >
                  <span className="text-lg">{char.id === currentCharacterId ? '✅' : '🐾'}</span>
                  <span>{char.displayName}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    item.action()
                    // 打开二级面板的项不关闭菜单
                    if (!item.opensSub) closeMenu()
                  }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink hover:bg-ink/5"
                >
                  <span className="text-lg">{item.emoji}</span>
                  <span>{t(item.labelKey)}</span>
                </button>
              ))}
              <button
                onClick={closeMenu}
                className="mt-1 rounded-lg bg-cream-deep px-3 py-1.5 text-xs text-ink-muted hover:bg-ink/10"
              >
                {t('app.close')}
              </button>
            </>
          )}
        </div>
      )}

      {/* 底部提示 */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-center text-[10px] text-ink-faint">
        {t('pet.hint')}
      </div>
    </div>
  )
}
