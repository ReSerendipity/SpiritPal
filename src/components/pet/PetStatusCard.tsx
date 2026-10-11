/**
 * 状态卡子系统（P0-2 从 PetWindow 拆分）
 *
 * 覆盖两种形态：
 * - 收起态胶囊按钮（面板关闭时显示，点击展开面板）
 * - 展开态状态卡（角色名/Lv/三围状态/金币/聊天与设置按钮）
 */
import type { RefObject } from 'react'
import { StatRow, tierColor } from '@/components/petPanelParts'
import { STATUS_PANEL_W, type StatusCardMode } from '@/lib/system/petWindowSizing'

export interface PetStatusCardProps {
  /** 状态卡模式：off 时不渲染任何形态 */
  mode: StatusCardMode
  /** 展开态面板是否打开（决定显示胶囊还是展开卡） */
  panelOpen: boolean
  /** 状态卡定位：left 模式时 top 跟随对话区高度 */
  dialogueZoneH: number
  /** 展开态状态卡容器 ref（面板尺寸测量用） */
  statusCardRef: RefObject<HTMLDivElement | null>
  characterName: string
  level: number
  mood: number
  hunger: number
  health: number
  coins: number
  /** 展开面板（胶囊点击） */
  onExpand: () => void
  /** 收起面板（展开卡右上角 ✕） */
  onCollapse: () => void
  onOpenChat: () => void
  onOpenSettings: () => void
}

export function PetStatusCard({
  mode,
  panelOpen,
  dialogueZoneH,
  statusCardRef,
  characterName,
  level,
  mood,
  hunger,
  health,
  coins,
  onExpand,
  onCollapse,
  onOpenChat,
  onOpenSettings,
}: PetStatusCardProps) {
  if (mode === 'off') return null

  // 收起态胶囊：状态卡开启（left/right）时显示，位置跟随状态卡模式；点击展开面板
  if (!panelOpen) {
    return (
      <div
        data-spiritpal-panel
        className="absolute top-1 z-30"
        style={{ left: mode === 'left' ? 4 : undefined, right: mode === 'right' ? 4 : undefined }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={onExpand}
          className="flex select-none items-center gap-1.5 rounded-full border border-ink/10 bg-surface/90 px-2 py-0.5 text-[10px] font-semibold text-ink shadow-soft backdrop-blur-sm hover:border-tangerine/40 hover:text-tangerine-deep"
          aria-label="展开状态卡"
        >
          <span>{characterName}</span>
          <span className="text-ink-faint">Lv.{level}</span>
          <span className="flex items-center gap-0.5 text-tangerine-deep">
            <span aria-hidden="true">🪙</span>
            <span className="tabular-nums">{coins}</span>
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      ref={statusCardRef}
      data-spiritpal-panel
      className="absolute z-30"
      style={{
        top: mode === 'left' ? dialogueZoneH : 4,
        left: mode === 'left' ? 4 : undefined,
        right: mode === 'right' ? 4 : undefined,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="select-none rounded-panel border border-ink/10 bg-surface/95 p-2 text-ink shadow-soft"
        style={{ width: STATUS_PANEL_W }}
      >
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold">{characterName}</span>
          <span className="flex items-center gap-1.5">
            <span className="text-ink-faint">Lv.{level}</span>
            <button
              onClick={onCollapse}
              className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-ink-muted hover:bg-ink/10 hover:text-ink"
              aria-label="收起面板"
            >
              ✕
            </button>
          </span>
        </div>
        <div className="mt-1 flex flex-col gap-0.5">
          <StatRow label="心情" value={mood} color={tierColor(mood)} />
          <StatRow label="饱食" value={hunger} color={tierColor(hunger)} />
          <StatRow label="活力" value={health} color={tierColor(health)} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-tangerine-deep">
          <span aria-hidden="true">🪙</span>
          <span className="tabular-nums">{coins}</span>
        </div>
        <div className="mt-1 flex gap-1">
          <button
            onClick={onOpenChat}
            className="flex-1 rounded-full bg-tangerine px-2 py-1 text-[11px] font-semibold text-white hover:bg-tangerine-deep"
          >
            聊天
          </button>
          <button
            onClick={onOpenSettings}
            className="flex-1 rounded-full border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink-muted hover:border-tangerine hover:text-tangerine-deep"
          >
            设置
          </button>
        </div>
      </div>
    </div>
  )
}
