/**
 * 宠物右键菜单组件
 *
 * 功能概述：
 * - 右键点击宠物弹出上下文菜单
 * - 支持多级子菜单（喂食、番茄钟、切换角色）
 * - 高亮当前选中角色
 * - 边界自适应定位防止超出屏幕
 * - 点击外部自动关闭、ESC键关闭
 * - 菜单项：聊天、抚摸、喂食、玩耍、洗澡、装扮、番茄钟、截图、设置、切换角色、对话、退出
 *
 * 核心Hooks/状态：
 * - useState: 当前展开的子菜单
 * - useRef: 菜单DOM引用（用于点击外部检测）
 * - useEffect: 点击外部关闭、键盘ESC关闭
 */
import { useEffect, useState, useRef, useMemo } from 'react'
import {
  MessageCircle,
  MessageSquare,
  Hand,
  UtensilsCrossed,
  Gamepad2,
  Bath,
  Shirt,
  Timer,
  Settings,
  RefreshCw,
  X,
  ChevronRight,
  ChevronDown,
  Check,
  Camera,
  Footprints,
} from 'lucide-react'
import { getAllCharacters, getCharacter } from '../lib/characters'
import { getFoodsForCharacter } from '../lib/items'
import type { InventoryItem } from '../lib/types'

/** 右键菜单组件Props */
interface PetContextMenuProps {
  /** 菜单X坐标 */
  x: number
  /** 菜单Y坐标 */
  y: number
  /** 当前角色ID */
  currentCharacterId: string
  /** 关闭菜单回调 */
  onClose: () => void
  /** 打开聊天回调 */
  onChat: () => void
  /** 抚摸回调 */
  onPet: () => void
  /** 喂食回调 */
  onFeed: (food: InventoryItem) => void
  /** 玩耍回调 */
  onPlay: () => void
  /** 洗澡回调 */
  onBathe: () => void
  /** 装扮回调 */
  onDressup: () => void
  /** 番茄钟回调 */
  onPomodoro: (minutes: number) => void
  /** 截图回调 */
  onScreenshot: () => void
  /** 设置回调 */
  onSettings: () => void
  /** 桌面漫游回调 */
  onRoam?: () => void
  /** 切换角色回调 */
  onSwitchCharacter: (id: string) => void
  /** 对话回调 */
  onDialogue: () => void
  /** 退出回调 */
  onExit: () => void
}

type SubKey = 'feed' | 'pomodoro' | 'switch' | null

// 菜单估算尺寸
const MENU_W = 192
const MENU_H_MAX = 420
const MARGIN = 4

/**
 * 宠物右键上下文菜单
 *
 * 提供宠物交互的快捷操作入口，支持多级子菜单和边界自适应定位。
 */
export function PetContextMenu(props: PetContextMenuProps) {
  const {
    x,
    y,
    currentCharacterId,
    onClose,
    onChat,
    onPet,
    onFeed,
    onPlay,
    onBathe,
    onDressup,
    onPomodoro,
    onScreenshot,
    onSettings,
    onRoam,
    onSwitchCharacter,
    onDialogue,
    onExit,
  } = props

  const [sub, setSub] = useState<SubKey>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const character = getCharacter(currentCharacterId)
  const themeColor = character?.themeColor.primary ?? '#FFB6C1'
  const foods = getFoodsForCharacter(currentCharacterId)

  // 边界自适应：确保菜单不超出窗口可视区域（纯派生值，x/y 变化时重算）
  const adjustedPos = useMemo(() => {
    const winW = window.innerWidth
    const winH = window.innerHeight
    let mx = x
    let my = y
    // 右边界检测
    if (mx + MENU_W + MARGIN > winW) {
      mx = Math.max(MARGIN, winW - MENU_W - MARGIN)
    }
    // 下边界检测
    if (my + MENU_H_MAX + MARGIN > winH) {
      my = Math.max(MARGIN, winH - MENU_H_MAX - MARGIN)
    }
    return { x: mx, y: my }
  }, [x, y])

  // 点击外部关闭（延迟绑定避免立即触发）
  useEffect(() => {
    const timer = setTimeout(() => {
      const onDown = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        if (!target.closest('[data-spiritpal-menu]')) {
          onClose()
        }
      }
      window.addEventListener('mousedown', onDown)
      return () => window.removeEventListener('mousedown', onDown)
    }, 10)
    return () => clearTimeout(timer)
  }, [onClose])

  const itemBase =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-ink/8 transition-colors cursor-pointer select-none'

  function toggleSub(key: SubKey) {
    setSub((prev) => (prev === key ? null : key))
  }

  return (
    <>
      {/* 透明遮罩 */}
      <div className="fixed inset-0 z-40" />
      <div
        ref={menuRef}
        data-spiritpal-menu
        className="fixed z-50 w-48 max-h-[420px] overflow-y-auto rounded-xl border border-ink/10 bg-surface/95 p-1.5 text-ink shadow-warm"
        style={{
          left: adjustedPos.x,
          top: adjustedPos.y,
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(74,54,38,0.25) transparent',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {/* 聊天 */}
        <button className={itemBase} onClick={() => { onChat(); onClose() }}>
          <MessageCircle size={15} style={{ color: themeColor }} /> 聊天
        </button>

        <button className={itemBase} onClick={() => { onDialogue(); onClose() }}>
          <MessageSquare size={15} style={{ color: themeColor }} /> 对话
        </button>
        {/* 摸摸 */}
        <button className={itemBase} onClick={() => { onPet(); onClose() }}>
          <Hand size={15} style={{ color: themeColor }} /> 摸摸
        </button>

        <div className="my-1 h-px bg-ink/10" />

        {/* 喂食 — 点击展开 */}
        <div>
          <button className={itemBase} onClick={() => toggleSub('feed')}>
            <UtensilsCrossed size={15} style={{ color: themeColor }} /> 喂食
            {sub === 'feed'
              ? <ChevronDown size={13} className="ml-auto text-ink-faint" />
              : <ChevronRight size={13} className="ml-auto text-ink-faint" />}
          </button>
          {sub === 'feed' && (
            <div className="ml-3 mt-0.5 border-l border-ink/10 pl-1">
              {foods.map((f) => (
                <button
                  key={f.id}
                  className={itemBase}
                  onClick={() => { onFeed(f); onClose() }}
                >
                  <span className="text-base">{f.icon}</span>
                  <span className="text-xs">{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 玩耍 */}
        <button className={itemBase} onClick={() => { onPlay(); onClose() }}>
          <Gamepad2 size={15} style={{ color: themeColor }} /> 玩耍
        </button>
        {/* 洗澡 */}
        <button className={itemBase} onClick={() => { onBathe(); onClose() }}>
          <Bath size={15} style={{ color: themeColor }} /> 洗澡
        </button>
        {/* 换装 */}
        <button className={itemBase} onClick={() => { onDressup(); onClose() }}>
          <Shirt size={15} style={{ color: themeColor }} /> 换装
        </button>

        <div className="my-1 h-px bg-ink/10" />

        {/* 番茄钟 — 点击展开 */}
        <div>
          <button className={itemBase} onClick={() => toggleSub('pomodoro')}>
            <Timer size={15} style={{ color: themeColor }} /> 番茄钟
            {sub === 'pomodoro'
              ? <ChevronDown size={13} className="ml-auto text-ink-faint" />
              : <ChevronRight size={13} className="ml-auto text-ink-faint" />}
          </button>
          {sub === 'pomodoro' && (
            <div className="ml-3 mt-0.5 border-l border-ink/10 pl-1">
              {[15, 25, 45, 60].map((m) => (
                <button
                  key={m}
                  className={itemBase}
                  onClick={() => { onPomodoro(m); onClose() }}
                >
                  <span className="text-xs">{m} 分钟</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 截图 */}
        <button className={itemBase} onClick={() => { onScreenshot(); onClose() }}>
          <Camera size={15} style={{ color: themeColor }} /> 截图
        </button>

        {/* 设置 */}
        <button className={itemBase} onClick={() => { onSettings(); onClose() }}>
          <Settings size={15} style={{ color: themeColor }} /> 设置
        </button>

        {/* 桌面漫游 */}
        <button className={itemBase} onClick={() => { onRoam?.(); onClose() }}>
          <Footprints size={15} style={{ color: themeColor }} /> 桌面漫游
        </button>

        <div className="my-1 h-px bg-ink/10" />

        {/* 切换角色 — 点击展开，高亮当前 */}
        <div>
          <button className={itemBase} onClick={() => toggleSub('switch')}>
            <RefreshCw size={15} style={{ color: themeColor }} /> 切换角色
            {sub === 'switch'
              ? <ChevronDown size={13} className="ml-auto text-ink-faint" />
              : <ChevronRight size={13} className="ml-auto text-ink-faint" />}
          </button>
          {sub === 'switch' && (
            <div className="ml-3 mt-0.5 border-l border-ink/10 pl-1">
              {getAllCharacters().map((c) => {
                const isCurrent = c.id === currentCharacterId
                return (
                  <button
                    key={c.id}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer select-none ${
                      isCurrent
                        ? 'bg-tangerine/15 text-ink font-medium'
                        : 'text-ink-muted hover:bg-ink/8'
                    }`}
                    onClick={() => { onSwitchCharacter(c.id); onClose() }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                      style={{ background: c.themeColor.primary }}
                    />
                    <span className="text-xs">{c.displayName}</span>
                    {isCurrent && (
                      <Check size={12} className="ml-auto" style={{ color: themeColor }} />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="my-1 h-px bg-ink/10" />

        {/* 退出 */}
        <button className={itemBase} onClick={() => { onExit(); onClose() }}>
          <X size={15} style={{ color: themeColor }} /> 退出
        </button>
      </div>
    </>
  )
}
