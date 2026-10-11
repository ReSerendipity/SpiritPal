/**
 * 右侧动作列表子系统（P0-2 从 PetWindow 拆分）
 *
 * 桌面宠物右键展开的菜单：喂食/玩耍/洗澡/对话/表情/番茄钟/截图/看看/静默/
 * 静默5分钟/迷你模式/换装/设置/窗口边框/边缘吸附/漫游/状态卡/切换角色/退出。
 * 依赖以「状态 + 回调」扁平 props 注入，内部只做渲染与子项展开切换。
 */
import type { RefObject } from 'react'
import {
  Hand,
  UtensilsCrossed,
  Gamepad2,
  Bath,
  MessageSquare,
  Smile,
  Timer,
  Camera,
  Eye,
  Volume2,
  VolumeX,
  MessageCircle,
  BellOff,
  Minimize2,
  Maximize2,
  Shirt,
  Settings,
  Frame,
  Magnet,
  Footprints,
  Check,
  RefreshCw,
  X,
} from 'lucide-react'
import { ExpressionSelector } from '@/components/pet/ExpressionSelector'
import { ActionButton, ActionRow } from '@/components/petPanelParts'
import { getAllCharacters } from '@/lib/data/characters'
import type { InventoryItem } from '@/lib/data/types'
import { getFoodsForCharacter } from '@/lib/nurture/items'
import { ACTIONS_PANEL_W, type StatusCardMode } from '@/lib/system/petWindowSizing'

/** 动作列表的可展开子项（与 PetWindow 原内联类型一致） */
export type ActionSub = 'feed' | 'pomodoro' | 'switch' | 'status' | 'expression' | null

export interface PetActionListProps {
  actionsListRef: RefObject<HTMLDivElement | null>
  /** 布局：right 模式时列表下移到状态卡下方 */
  statusCardMode: StatusCardMode
  statusHMeasured: number
  dialogueZoneH: number
  actionSub: ActionSub
  currentCharacterId: string
  silentActive: boolean
  isMini: boolean
  showWindowBorder: boolean
  edgeSnapEnabled: boolean
  isRoam: boolean
  /** 切换可展开子项（feed/pomodoro/...；父级负责展开↔收起切换） */
  onToggleSub: (sub: Exclude<ActionSub, null>) => void
  onTriggerPet: () => void
  onFeed: (food: InventoryItem) => void
  onPlay: () => void
  onBathe: () => void
  onDialogue: () => void
  onStartPomodoro: (minutes: number) => void
  onScreenshot: () => void
  onLook: () => void
  onSilence: () => void
  onSilenceFive: () => void
  onToggleMini: () => void
  onCollapsePanel: () => void
  onToggleWindowBorder: () => void
  onToggleEdgeSnap: () => void
  onToggleRoam: () => void
  onToggleStatusCard: (mode: StatusCardMode) => void
  onSwitchCharacter: (id: string) => void
  onExit: () => void
  onOpenSettings: () => void
  onOpenAppearanceSettings: () => void
  onOpenChat: () => void
}

export function PetActionList({
  actionsListRef,
  statusCardMode,
  statusHMeasured,
  dialogueZoneH,
  actionSub,
  currentCharacterId,
  silentActive,
  isMini,
  showWindowBorder,
  edgeSnapEnabled,
  isRoam,
  onToggleSub,
  onTriggerPet,
  onFeed,
  onPlay,
  onBathe,
  onDialogue,
  onStartPomodoro,
  onScreenshot,
  onLook,
  onSilence,
  onSilenceFive,
  onToggleMini,
  onCollapsePanel,
  onToggleWindowBorder,
  onToggleEdgeSnap,
  onToggleRoam,
  onToggleStatusCard,
  onSwitchCharacter,
  onExit,
  onOpenSettings,
  onOpenAppearanceSettings,
  onOpenChat,
}: PetActionListProps) {
  const foods = getFoodsForCharacter(currentCharacterId)
  const characters = getAllCharacters()

  return (
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
      <ActionButton icon={<Hand size={13} />} label="摸摸" onClick={onTriggerPet} />
      <ActionButton
        icon={<UtensilsCrossed size={13} />}
        label="喂食"
        onClick={() => onToggleSub('feed')}
        expanded={actionSub === 'feed'}
      >
        {foods.map((f) => (
          <ActionRow key={f.id} onClick={() => onFeed(f)}>
            <span className="text-xs">{f.icon}</span>
            <span className="text-[10px]">{f.name}</span>
          </ActionRow>
        ))}
      </ActionButton>
      <ActionButton icon={<Gamepad2 size={13} />} label="玩耍" onClick={onPlay} />
      <ActionButton icon={<Bath size={13} />} label="洗澡" onClick={onBathe} />
      <ActionButton icon={<MessageSquare size={13} />} label="对话" onClick={onDialogue} />
      <ActionButton
        icon={<Smile size={13} />}
        label="表情"
        onClick={() => onToggleSub('expression')}
        expanded={actionSub === 'expression'}
      >
        <ExpressionSelector />
      </ActionButton>
      <ActionButton
        icon={<Timer size={13} />}
        label="番茄钟"
        onClick={() => onToggleSub('pomodoro')}
        expanded={actionSub === 'pomodoro'}
      >
        {[15, 25, 45, 60].map((m) => (
          <ActionRow key={m} onClick={() => onStartPomodoro(m)}>
            <span className="text-[10px]">{m} 分钟</span>
          </ActionRow>
        ))}
      </ActionButton>
      <ActionButton icon={<Camera size={13} />} label="截图" onClick={onScreenshot} />
      <ActionButton icon={<Eye size={13} />} label="看看" onClick={onLook} />
      <ActionButton
        icon={silentActive ? <VolumeX size={13} /> : <Volume2 size={13} />}
        label={silentActive ? '取消静默' : '静默'}
        onClick={onSilence}
      />
      <ActionButton icon={<MessageCircle size={13} />} label="聊天" onClick={onOpenChat} />
      {/* A-5：静默 5 分钟 —— 临时静音，到期自动恢复；静默中点击则取消静默 */}
      <ActionButton
        icon={<BellOff size={13} />}
        label={silentActive ? '取消静默' : '静默5分钟'}
        onClick={silentActive ? onSilence : onSilenceFive}
      />
      {/* A-14：迷你模式 —— 窗口缩至 80×80 并吸附到最近边缘，悬停可预览 */}
      <ActionButton
        icon={isMini ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
        label={isMini ? '退出迷你' : '迷你模式'}
        onClick={() => {
          // 先收起面板，避免 MiniModeManager 缩窗后残留展开态尺寸
          onCollapsePanel()
          onToggleMini()
        }}
      />
      <ActionButton icon={<Shirt size={13} />} label="换装" onClick={onOpenAppearanceSettings} />
      <ActionButton icon={<Settings size={13} />} label="设置" onClick={onOpenSettings} />
      <ActionButton
        icon={<Frame size={13} />}
        label={`窗口边框${showWindowBorder ? '：开' : '：关'}`}
        onClick={onToggleWindowBorder}
      />
      <ActionButton
        icon={<Magnet size={13} />}
        label={`边缘吸附${edgeSnapEnabled ? '：开' : '：关'}`}
        onClick={onToggleEdgeSnap}
      />
      <ActionButton icon={<Footprints size={13} />} label={`漫游${isRoam ? '：开' : '：关'}`} onClick={onToggleRoam} />
      <ActionButton
        icon={<Eye size={13} />}
        label="状态卡"
        onClick={() => onToggleSub('status')}
        expanded={actionSub === 'status'}
      >
        {(
          [
            ['off', '关闭'],
            ['left', '左侧'],
            ['right', '右侧'],
          ] as Array<[StatusCardMode, string]>
        ).map(([mode, label]) => (
          <ActionRow key={mode} onClick={() => onToggleStatusCard(mode)} highlight={statusCardMode === mode}>
            <span className="text-[10px]">{label}</span>
            {statusCardMode === mode && <Check size={11} className="ml-auto" />}
          </ActionRow>
        ))}
      </ActionButton>
      <ActionButton
        icon={<RefreshCw size={13} />}
        label="切换角色"
        onClick={() => onToggleSub('switch')}
        expanded={actionSub === 'switch'}
      >
        <div className="max-h-56 overflow-y-auto">
          {characters.map((c) => {
            const isCurrent = c.id === currentCharacterId
            return (
              <ActionRow key={c.id} onClick={() => onSwitchCharacter(c.id)} highlight={isCurrent}>
                <span className="h-2 w-2 rounded-full" style={{ background: c.themeColor.primary }} />
                <span className="text-[10px]">{c.displayName}</span>
                {isCurrent && <Check size={11} className="ml-auto" />}
              </ActionRow>
            )
          })}
        </div>
      </ActionButton>
      <ActionButton icon={<X size={13} />} label="退出" onClick={onExit} />
    </div>
  )
}
