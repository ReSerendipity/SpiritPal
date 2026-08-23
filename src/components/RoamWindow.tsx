/**
 * 桌面漫游形态窗口（QQ 宠物式真漫游）
 *
 * 漫游窗口铺满主屏（透明 + 点击穿透），宠物在整个桌面上随机行走：
 * - 行走：随机目标点（水平为主、部分纵向），到达后随机换目标或暂停片刻
 * - 悬停：停下并浮现气泡；移开后继续漫游
 * - 右键：返回宠物主窗口（窗口形态）
 *
 * 对应高保真主流程 v1.0 · 桌面漫游场景。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePetStore } from '../stores/petStore'
import { getCharacter } from '../lib/characters'
import { switchPetForm } from '../lib/petForm'
import { SpriteRenderer } from './SpriteRenderer'
import { usePixelClickThrough } from '../lib/pixelClickThrough'
import { SPRITE_W, SPRITE_H } from '../lib/petWindowSizing'

/** 漫游宠物缩放（与旧版一致） */
const ROAM_SIZE = 0.7
const SPRITE_W_ROAM = SPRITE_W * ROAM_SIZE
const SPRITE_H_ROAM = SPRITE_H * ROAM_SIZE
/** 行走速度（px/帧，~33ms 一帧 ≈ 90px/s） */
const WALK_STEP_X = 3
const WALK_STEP_Y = 1

export default function RoamWindow() {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const character = getCharacter(currentCharacterId)

  // 像素级点击穿透：透明区域穿透到底层应用，悬停宠物实体区域才可交互
  usePixelClickThrough(true, ['.spiritpal-roam-bubble'], false)

  // 漫游窗口铺满主屏，innerWidth/Height 即屏幕尺寸
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1920
  const winH = typeof window !== 'undefined' ? window.innerHeight : 1080

  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.round(winW / 2 - SPRITE_W_ROAM / 2),
    y: winH - SPRITE_H_ROAM - 24,
  }))
  const [facing, setFacing] = useState<'left' | 'right'>('right')
  const [walking, setWalking] = useState(true)
  const [hovered, setHovered] = useState(false)

  const posRef = useRef(pos)
  const targetRef = useRef({ x: winW * 0.8, y: winH - SPRITE_H_ROAM - 24 })
  const pausedRef = useRef(false)
  const hoveredRef = useRef(false)

  // 渲染期禁止写 ref，改为 effect 中同步
  useEffect(() => {
    posRef.current = pos
  })
  useEffect(() => {
    hoveredRef.current = hovered
  })

  /** 随机选取下一个行走目标（水平随机为主，35% 概率同时换纵向） */
  const pickTarget = useCallback(() => {
    const minX = 8
    const maxX = Math.max(minX + 1, winW - SPRITE_W_ROAM - 8)
    const minY = Math.round(winH * 0.45)
    const maxY = Math.max(minY + 1, winH - SPRITE_H_ROAM - 24)
    targetRef.current = {
      x: Math.round(minX + Math.random() * (maxX - minX)),
      y: Math.random() < 0.35 ? Math.round(minY + Math.random() * (maxY - minY)) : posRef.current.y,
    }
  }, [winW, winH])

  /** 暂停行走（到达目标点 30% 概率休息，或悬停时） */
  const pauseWalk = useCallback(() => {
    pausedRef.current = true
    setWalking(false)
  }, [])

  /** 恢复行走并选新目标 */
  const resumeWalk = useCallback(() => {
    pausedRef.current = false
    pickTarget()
    setWalking(true)
  }, [pickTarget])

  // 行走主循环（rAF 粒度由 interval 33ms 近似；悬停/暂停时不移动）
  useEffect(() => {
    const id = window.setInterval(() => {
      if (hoveredRef.current || pausedRef.current) return
      const target = targetRef.current
      const cur = posRef.current
      const dx = target.x - cur.x
      const dist = Math.abs(dx)
      if (dist < WALK_STEP_X) {
        // 到达目标：30% 概率休息 1.5~4s，否则直接换下一个目标
        if (Math.random() < 0.3) {
          pauseWalk()
          window.setTimeout(() => {
            if (!hoveredRef.current) resumeWalk()
          }, 1500 + Math.random() * 2500)
        } else {
          pickTarget()
        }
        return
      }
      setPos((p) => ({ x: p.x + Math.sign(dx) * WALK_STEP_X, y: p.y }))
      setFacing(dx > 0 ? 'right' : 'left')
      // 纵向缓动（速度更慢，略微跟随目标 y）
      const dy = target.y - cur.y
      if (Math.abs(dy) > 1) {
        setPos((p) => ({ ...p, y: p.y + Math.sign(dy) * WALK_STEP_Y }))
      }
    }, 33)
    return () => window.clearInterval(id)
  }, [pickTarget, pauseWalk, resumeWalk])

  // 进入漫游时先选一个目标
  useEffect(() => {
    pickTarget()
  }, [pickTarget])

  async function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    // 返回窗口形态：隐藏漫游窗口、显示宠物主窗口，并同步持久化形态
    await switchPetForm('window')
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden" style={{ background: 'transparent' }}>
      {/* 漫游宠物：按目标点行走，悬停停下 */}
      <div
        className="absolute"
        style={{
          left: pos.x,
          top: pos.y,
          width: SPRITE_W_ROAM,
          height: SPRITE_H_ROAM,
          transition: 'none',
        }}
        data-sprite=""
        onContextMenu={handleContextMenu}
        onMouseEnter={() => { setHovered(true); pauseWalk() }}
        onMouseLeave={() => { setHovered(false); resumeWalk() }}
      >
        {/* 悬停气泡 */}
        <div className="spiritpal-pet-voice spiritpal-roam-bubble pointer-events-none absolute -top-11 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-2xl rounded-br-sm border border-blush bg-surface px-3 py-1 text-[13px] text-ink opacity-0 shadow-soft transition-opacity duration-200 group-hover:opacity-100" style={{ opacity: hovered ? 1 : 0 }}>
          我去溜达一下～
        </div>
        <div style={{ transform: `scaleX(${facing === 'left' ? -1 : 1})`, transformOrigin: 'bottom center' }}>
          <SpriteRenderer characterId={currentCharacterId} state={walking ? 'walk' : 'idle'} size={ROAM_SIZE} />
        </div>
      </div>

      {/* 空角色兜底提示 */}
      {!character && (
        <div className="spiritpal-pet-voice absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-2xl border border-blush bg-surface px-3 py-2 text-sm text-ink shadow-soft">
          还没有伙伴呢，先回主窗口选一个吧～
        </div>
      )}
    </div>
  )
}
