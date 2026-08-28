/**
 * @file useMiniMode.ts
 * @description 迷你模式 Hook（A-14）
 *
 * 把 `miniMode.ts` 的 `MiniModeManager`（原为孤岛，零 importer）接入宠物窗口。
 *
 * 设计决策：**不新增 Rust 命令**。
 * 迷你模式所需的全部能力（缩放窗口、移动位置、边缘吸附、跨窗口事件）
 * 都能用 Tauri 官方 window API 完成。原先另有一份 `miniModeManager.ts`
 * invoke 了 `switch_mini_mode` / `set_window_*` / `resize_window` 五个
 * Rust 端并不存在的命令（属于静默假实现），已随该模块一并删除。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MiniModeManager, type MiniModeState } from '../../lib/miniMode'

export interface UseMiniModeResult {
  /** 当前模式：normal / mini / preview */
  state: MiniModeState
  /** 是否处于迷你态或悬停预览态（UI 应精简） */
  isMini: boolean
  /** 切换迷你模式 */
  toggle: () => Promise<void>
  /** 迷你态下鼠标移入 → 展开预览 */
  handleMouseEnter: () => void
  /** 迷你态下鼠标移出 → 收回预览 */
  handleMouseLeave: () => void
}

export function useMiniMode(): UseMiniModeResult {
  const managerRef = useRef<MiniModeManager | null>(null)
  const [state, setState] = useState<MiniModeState>('normal')

  useEffect(() => {
    const manager = new MiniModeManager(
      {},
      {
        onStateChange: (_from, to) => setState(to),
      },
    )
    managerRef.current = manager

    void manager.init().catch((err: unknown) => {
      console.warn('[useMiniMode] 迷你模式初始化失败，功能不可用:', err)
    })

    return () => {
      manager.destroy()
      managerRef.current = null
    }
  }, [])

  const toggle = useCallback(async () => {
    try {
      await managerRef.current?.toggleMiniMode()
    } catch (err) {
      console.warn('[useMiniMode] 切换迷你模式失败:', err)
    }
  }, [])

  const handleMouseEnter = useCallback(() => {
    managerRef.current?.handleMouseEnter()
  }, [])

  const handleMouseLeave = useCallback(() => {
    managerRef.current?.handleMouseLeave()
  }, [])

  return {
    state,
    isMini: state === 'mini' || state === 'preview',
    toggle,
    handleMouseEnter,
    handleMouseLeave,
  }
}
