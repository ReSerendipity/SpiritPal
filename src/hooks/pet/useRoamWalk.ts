/**
 * 漫游行走控制器 Hook
 *
 * 借鉴 Dororo move.gd：进入漫游后，interval 驱动窗口 setPosition 向屏幕内随机目标点移动。
 * 移动中播放 walk 动画并朝向目标，到达后 30% 休息 1.5~4s 再换目标。
 * 用户交互优先（Dororo move_lock）：拖拽中/面板展开/鼠标悬停宠物时暂停行走。
 * 随机目标避开屏幕边缘 ROAM_EDGE_MARGIN px，避免到达后触发贴边吸附。
 *
 * @module useRoamWalk
 */

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, primaryMonitor, PhysicalPosition } from '@tauri-apps/api/window'
import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react'
import type { PetState } from '@/lib/data/types'

// ========== 漫游行走控制器常量 ==========

/** 随机目标点距屏幕边缘的最小安全距离（px），避免到达后触发贴边吸附 */
export const ROAM_EDGE_MARGIN = 40
/** 随机目标点距鼠标的最小距离（px），避免宠物主动走到鼠标下 */
export const ROAM_MOUSE_AVOID_DIST = 200
/** 随机目标点避让鼠标的最大重试次数 */
export const ROAM_MAX_PICK_RETRIES = 8
/** 漫行走 interval 周期（ms），~15 次/秒 setPosition IPC */
export const ROAM_TICK_MS = 66
/** 漫行走每帧步进（逻辑像素），~90px/s @ 66ms */
export const ROAM_STEP_PX = 6
/** 到达目标后休息的概率 */
export const ROAM_REST_PROBABILITY = 0.3
/** 休息时长范围（ms）：下限 */
export const ROAM_REST_MIN_MS = 1500
/** 休息时长范围（ms）：浮动范围 */
export const ROAM_REST_RANGE_MS = 2500

export interface UseRoamWalkOptions {
  /** 是否处于漫游模式 */
  isRoam: boolean
  /** 拖拽中状态 ref（拖拽时暂停行走） */
  draggingRef: RefObject<boolean>
  /** 面板展开状态 ref（展开时暂停行走） */
  panelOpenRef: RefObject<boolean>
  /** 鼠标悬停状态 ref（悬停时暂停行走） */
  hoveredRef: RefObject<boolean>
  /** 窗口逻辑尺寸 ref（winW/winH 的镜像，取即时值） */
  winSizeRef: RefObject<{ w: number; h: number }>
  /** 设置宠物状态 */
  setPetState: Dispatch<SetStateAction<PetState>>
  /** 设置朝向 */
  setFacing: (facing: 'left' | 'right') => void
}

/**
 * 漫游行走控制器
 *
 * 进入漫游模式后，窗口在桌面随机移动（~90px/s），到达目标后休息。
 * 退出漫游时停止行走并恢复待机。
 */
export function useRoamWalk({
  isRoam,
  draggingRef,
  panelOpenRef,
  hoveredRef,
  winSizeRef,
  setPetState,
  setFacing,
}: UseRoamWalkOptions): void {
  useEffect(() => {
    if (!isRoam) return
    let disposed = false
    const win = getCurrentWindow()
    const EDGE = ROAM_EDGE_MARGIN
    let screen = { x: 0, y: 0, w: 1920, h: 1080 }
    let target = { x: 0, y: 0 }
    let restUntil = 0

    const pickTarget = async () => {
      const winW = winSizeRef.current.w
      const winH = winSizeRef.current.h
      const minX = screen.x + EDGE
      const minY = screen.y + EDGE
      const maxX = Math.max(minX + 1, screen.x + screen.w - winW - EDGE)
      const maxY = Math.max(minY + 1, screen.y + screen.h - winH - EDGE)
      // 鼠标屏幕坐标（用于避开鼠标：宠物不主动走到鼠标下）
      let mouseX = Infinity
      let mouseY = Infinity
      try {
        const [cx, cy] = await invoke<[number, number]>('get_mouse_pos')
        const [pos, sf] = await Promise.all([win.outerPosition(), win.scaleFactor()])
        mouseX = pos.x / sf + cx
        mouseY = pos.y / sf + cy
      } catch {
        // 无法获取鼠标位置时不做避让
      }
      const MIN_DIST = ROAM_MOUSE_AVOID_DIST
      for (let i = 0; i < ROAM_MAX_PICK_RETRIES; i++) {
        const x = Math.round(minX + Math.random() * (maxX - minX))
        const y = Math.round(minY + Math.random() * (maxY - minY))
        if (Math.hypot(x - mouseX, y - mouseY) >= MIN_DIST || i === ROAM_MAX_PICK_RETRIES - 1) {
          target = { x, y }
          return
        }
      }
    }

    // 初始化屏幕可用区（逻辑坐标）
    void primaryMonitor()
      .then((m) => {
        if (disposed || !m) return
        const sf = m.scaleFactor || 1
        screen = {
          x: Math.round(m.position.x / sf),
          y: Math.round(m.position.y / sf),
          w: Math.round(m.size.width / sf),
          h: Math.round(m.size.height / sf),
        }
        void pickTarget()
      })
      .catch(() => {})

    const id = window.setInterval(() => {
      if (disposed) return
      // 交互优先：拖拽中/面板展开/鼠标悬停宠物 → 暂停行走（Dororo move_lock）
      if (draggingRef.current || panelOpenRef.current || hoveredRef.current) return
      const now = Date.now()
      if (now < restUntil) {
        setPetState('idle')
        return
      }
      void Promise.all([win.outerPosition(), win.scaleFactor()])
        .then(([pos, sf]) => {
          if (disposed) return
          const dx = target.x - pos.x / sf
          const dy = target.y - pos.y / sf
          const dist = Math.hypot(dx, dy)
          const step = ROAM_STEP_PX
          if (dist < step + 1) {
            // 到达目标：休息或换新目标
            setPetState('idle')
            if (Math.random() < ROAM_REST_PROBABILITY) {
              restUntil = now + ROAM_REST_MIN_MS + Math.random() * ROAM_REST_RANGE_MS
            } else {
              void pickTarget()
            }
            return
          }
          const nx = pos.x + Math.round(Math.sign(dx) * Math.min(step * sf, Math.abs(dx) * sf))
          const ny = pos.y + Math.round(Math.sign(dy) * Math.min(step * sf, Math.abs(dy) * sf))
          void win.setPosition(new PhysicalPosition(nx, ny)).catch(() => {})
          setFacing(dx > 0 ? 'right' : 'left')
          setPetState('walk')
        })
        .catch(() => {})
    }, ROAM_TICK_MS)

    return () => {
      disposed = true
      window.clearInterval(id)
      // 退出漫游：恢复待机动画
      setPetState('idle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isRoam 切换即挂载/卸载；内部 ref/state setter 稳定
  }, [isRoam])
}
