/**
 * 独立状态面板窗口
 *
 * 与宠物窗口分离的浮动状态卡：显示当前角色的等级/心情/饱食/活力/金币，
 * 并提供聊天/设置快捷入口。数据由宠物窗口通过 `pet-stats` 事件周期同步。
 *
 * 交互：
 * - 标题行（data-tauri-drag-region）可拖动整个窗口
 * - 透明区域像素穿透（仅卡片/标题行可交互），不遮挡桌面
 * - 角色/状态变化由宠物窗口推送，本窗口只读展示
 */
import { useEffect, useState } from 'react'
import { windowEventBus, type PetStatsPayload } from '../lib/windowEventBus'
import { ensureAppWindow } from '../lib/appWindows'
import { usePixelClickThrough } from '../lib/pixelClickThrough'

/** 面板可交互区域（像素穿透白名单：卡片 + 拖拽标题行） */
const PANEL_INTERACTIVE = ['[data-spiritpal-panel]']

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span className="text-[10px]">{label}</span>
      <span className="ml-auto tabular-nums text-[10px] text-ink-faint">{Math.round(value)}</span>
    </div>
  )
}

function tierColor(v: number): string {
  if (v >= 70) return '#22c55e'
  if (v >= 40) return '#eab308'
  return '#ef4444'
}

export default function PanelWindow() {
  const [stats, setStats] = useState<PetStatsPayload | null>(null)

  // 透明区域穿透（仅卡片可交互），标题行拖拽由 data-tauri-drag-region 处理
  usePixelClickThrough(true, PANEL_INTERACTIVE, false)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    void windowEventBus.on('pet-stats', (payload) => setStats(payload)).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  return (
    <div className="flex h-screen w-screen items-start justify-end p-2" data-tauri-drag-region>
      <div
        data-spiritpal-panel
        className="w-[196px] select-none rounded-panel border border-ink/10 bg-surface/95 p-2 text-ink shadow-soft"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 标题行（拖拽把手） */}
        <div className="flex items-center justify-between text-[11px]" data-tauri-drag-region>
          <span className="font-bold">{stats?.name ?? '加载中…'}</span>
          <span className="text-ink-faint">Lv.{stats?.level ?? 1}</span>
        </div>

        <div className="mt-1 flex flex-col gap-0.5">
          <StatRow label="心情" value={stats?.mood ?? 0} color={tierColor(stats?.mood ?? 0)} />
          <StatRow label="饱食" value={stats?.hunger ?? 0} color={tierColor(stats?.hunger ?? 0)} />
          <StatRow label="活力" value={stats?.health ?? 0} color={tierColor(stats?.health ?? 0)} />
        </div>

        <div className="mt-1 flex items-center justify-between text-[10px] text-tangerine-deep">
          <span aria-hidden="true">🪙</span>
          <span className="tabular-nums">{stats?.coins ?? 0}</span>
        </div>

        <div className="mt-1 flex gap-1">
          <button
            onClick={() => void ensureAppWindow('chat-window').then((w) => { void w?.show(); void w?.setFocus() })}
            className="flex-1 rounded-full bg-tangerine px-2 py-1 text-[11px] font-semibold text-white hover:bg-tangerine-deep"
          >
            聊天
          </button>
          <button
            onClick={() => void ensureAppWindow('settings-window').then((w) => { void w?.show(); void w?.setFocus() })}
            className="flex-1 rounded-full border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink-muted hover:border-tangerine hover:text-tangerine-deep"
          >
            设置
          </button>
        </div>
      </div>
    </div>
  )
}
