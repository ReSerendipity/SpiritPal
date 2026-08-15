/**
 * 养成数值面板组件
 *
 * 功能概述：
 * - 展示四维养成进度条（饱食/心情/健康/精力）
 * - 根据数值自动变化颜色（绿→黄→橙→红）
 * - 显示角色等级、经验值进度条、等级徽章
 * - 显示金币数量和最后互动时间（相对时间格式化）
 *
 * 核心Hooks/状态：
 * - usePetStore: 当前角色统计、共享金币、徽章获取、颜色分级
 */
import { usePetStore } from '../stores/petStore'
import { getCharacter } from '../lib/characters'
import type { BadgeTier } from '../lib/types'

const selectCurrentStats = (s: ReturnType<typeof usePetStore.getState>) => s.getCurrentStats()
const selectSharedCoins = (s: ReturnType<typeof usePetStore.getState>) => s.sharedCoins
const selectCurrentCharacterId = (s: ReturnType<typeof usePetStore.getState>) => s.currentCharacterId
const selectGetBadge = (s: ReturnType<typeof usePetStore.getState>) => s.getBadge

const TIER_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-400',
  red: 'bg-red-500',
}

const BADGE_META: Record<BadgeTier, { label: string; emoji: string; color: string }> = {
  none: { label: '无', emoji: '⚪', color: 'text-ink-muted' },
  star: { label: '星辰', emoji: '⭐', color: 'text-yellow-400' },
  moon: { label: '皓月', emoji: '🌙', color: 'text-indigo-300' },
  sun: { label: '骄阳', emoji: '☀️', color: 'text-orange-400' },
  crown: { label: '皇冠', emoji: '👑', color: 'text-amber-300' },
}

/**
 * 数值进度条子组件
 * 显示带颜色分级的进度条，颜色随数值变化
 */
function StatBar({ label, value, max = 100 }: {
  /** 进度条标签 */
  label: string
  /** 当前值 */
  value: number
  /** 最大值（默认100） */
  max?: number
}) {
  const tier = usePetStore.getState().getColorTier(value)
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex items-center justify-between text-xs text-ink">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value)}{max === 100 ? '' : ''}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-cream-deep">
        <div
          className={`h-full rounded-full transition-all duration-300 ${TIER_COLORS[tier]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/**
 * 格式化相对时间
 * @param ts 时间戳（毫秒）
 * @returns 友好的相对时间字符串
 */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

/**
 * 养成数值面板
 *
 * 展示当前角色的四维状态、等级经验、金币和徽章信息。
 */
export function NurturingPanel() {
  const stats = usePetStore(selectCurrentStats)
  const sharedCoins = usePetStore(selectSharedCoins)
  const currentCharacterId = usePetStore(selectCurrentCharacterId)
  const getBadge = usePetStore(selectGetBadge)
  const character = getCharacter(currentCharacterId)

  const badge = getBadge(stats.level)
  const badgeMeta = BADGE_META[badge]
  const expNeed = stats.level * 100
  const expPct = Math.min(100, (stats.exp / expNeed) * 100)

  return (
    <div className="w-full rounded-xl bg-surface/95 p-3 text-white shadow-xl">
      {/* 头部：角色 + 等级 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{character?.displayName ?? '宠物'}</span>
          <span className={`text-sm ${badgeMeta.color}`} title={badgeMeta.label}>
            {badgeMeta.emoji} Lv.{stats.level}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm text-amber-300">
          🪙 <span className="tabular-nums">{sharedCoins}</span>
        </div>
      </div>

      {/* 经验条 */}
      <div className="mb-3">
        <div className="mb-0.5 flex items-center justify-between text-xs text-ink-muted">
          <span>经验</span>
          <span className="tabular-nums">
            {Math.floor(stats.exp)} / {expNeed}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-deep">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${expPct}%` }}
          />
        </div>
      </div>

      {/* 四维数值 */}
      <StatBar label="饱食度" value={stats.hunger} />
      <StatBar label="心情" value={stats.mood} />
      <StatBar label="健康" value={stats.health} />
      <StatBar label="亲密度" value={stats.affection} max={9999} />

      {/* 最后互动 */}
      <div className="mt-2 border-t border-ink/15 pt-2 text-[11px] text-ink-muted">
        最后互动：{formatRelative(stats.lastInteractionAt)}
      </div>
    </div>
  )
}
