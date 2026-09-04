/**
 * 移动端养成视图组件
 * @module mobile/MobileNurturingView
 * @description
 * 移动端养成系统界面，展示四维属性、经验等级、商店、背包。
 *
 * 子页面：
 * - 属性：饱食度、心情、健康进度条，养成信息统计
 * - 商店：展示可购买物品，按角色偏好过滤
 * - 背包：展示已拥有物品，支持使用
 *
 * @see {@link ../stores/petStore} 宠物养成状态 Store
 * @see {@link ../lib/items} 物品配置模块
 */
import { useState } from 'react'
import { Heart, ShoppingBag, Backpack, Trophy, Coins, Sparkles } from 'lucide-react'
import { getCharacter } from '@/lib/data/characters'
import type { BadgeTier } from '@/lib/data/types'
import { MobileAchievementView } from '@/mobile/MobileAchievementView'
import { MobileInventoryView } from '@/mobile/MobileInventoryView'
import { MobileShopView } from '@/mobile/MobileShopView'
import { usePetStore } from '@/stores/petStore'

/** 子 Tab 类型 */
type SubTab = 'stats' | 'shop' | 'inventory' | 'achievement'

/** 属性颜色等级映射 */
const TIER_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-400',
  red: 'bg-red-500',
}

/** 徽章元信息映射 */
const BADGE_META: Record<BadgeTier, { label: string; emoji: string; color: string }> = {
  none: { label: '无', emoji: '⚪', color: 'text-ink-muted' },
  star: { label: '星辰', emoji: '⭐', color: 'text-yellow-400' },
  moon: { label: '皓月', emoji: '🌙', color: 'text-indigo-300' },
  sun: { label: '骄阳', emoji: '☀️', color: 'text-orange-400' },
  crown: { label: '皇冠', emoji: '👑', color: 'text-amber-300' },
}

/**
 * 格式化相对时间
 * @param ts 时间戳（毫秒）
 * @returns 相对时间字符串（如 "刚刚"、"5 分钟前"）
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
 * 移动端养成视图组件
 * @returns 养成界面组件
 */
export function MobileNurturingView() {
  const stats = usePetStore((s) => s.getCurrentStats())
  const sharedCoins = usePetStore((s) => s.sharedCoins)
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const getBadge = usePetStore((s) => s.getBadge)
  const getColorTier = usePetStore((s) => s.getColorTier)
  const character = getCharacter(currentCharacterId)

  const [subTab, setSubTab] = useState<SubTab>('stats')

  const badge = getBadge(stats.level)
  const badgeMeta = BADGE_META[badge]
  const expNeed = stats.level * 100
  const expPct = Math.min(100, (stats.exp / expNeed) * 100)

  // 主题样式类（与桌面端 NurturingPanel 一致的语义 Token 配色）
  const bgClass = 'bg-cream'
  const textClass = 'text-ink'
  const cardBgClass = 'bg-surface'
  const cardBorderClass = 'border-ink/10'
  const subTabActiveClass = 'bg-tangerine text-white'
  const subTabInactiveClass = 'bg-cream-deep text-ink-muted'

  // 属性条配置
  const statBars = [
    { label: '饱食度', value: stats.hunger, icon: '🍖' },
    { label: '心情', value: stats.mood, icon: '😊' },
    { label: '健康', value: stats.health, icon: '💚' },
  ]

  return (
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      {/* 顶部：角色 + 等级 + 金币 */}
      <header className={`flex items-center justify-between border-b ${cardBorderClass} px-4 py-3`}>
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{character?.displayName ?? '宠物'}</span>
          <span className={`text-sm ${badgeMeta.color}`} title={badgeMeta.label}>
            {badgeMeta.emoji} Lv.{stats.level}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm text-amber-300">
          <Coins size={14} />
          <span className="tabular-nums">{sharedCoins}</span>
        </div>
      </header>

      {/* 经验条 */}
      <div className={`px-4 py-2 ${cardBgClass} border-b ${cardBorderClass}`}>
        <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
          <span>经验</span>
          <span className="tabular-nums">{Math.floor(stats.exp)} / {expNeed}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-deep">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${expPct}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-ink-muted">
          亲密度 {Math.floor(stats.affection)} · 上次互动 {formatRelative(stats.lastInteractionAt)}
        </div>
      </div>

      {/* 子 Tab 切换 */}
      <div className="flex gap-1 p-2">
        {([
          { id: 'stats', label: '属性', icon: Heart },
          { id: 'shop', label: '商店', icon: ShoppingBag },
          { id: 'inventory', label: '背包', icon: Backpack },
          { id: 'achievement', label: '成就', icon: Trophy },
        ] as const).map((t) => {
          const Icon = t.icon
          const isActive = subTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors ${
                isActive ? subTabActiveClass : subTabInactiveClass
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {/* 属性卡片 */}
        {subTab === 'stats' && (
          <div className="space-y-3">
            {statBars.map((stat) => {
              const tier = getColorTier(stat.value)
              const pct = Math.max(0, Math.min(100, stat.value))
              return (
                <div key={stat.label} className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg">{stat.icon}</span>
                      <span className="text-sm font-medium">{stat.label}</span>
                    </div>
                    <span className="text-sm tabular-nums text-ink-muted">{Math.round(stat.value)} / 100</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-cream-deep">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${TIER_COLORS[tier]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}

            {/* 互动统计 */}
            <div className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
              <h3 className="mb-2 text-sm font-medium">养成信息</h3>
              <div className="space-y-1 text-xs text-ink-muted">
                <div className="flex justify-between">
                  <span>当前等级</span>
                  <span>Lv.{stats.level}</span>
                </div>
                <div className="flex justify-between">
                  <span>亲密度</span>
                  <span>{Math.floor(stats.affection)} / 9999</span>
                </div>
                <div className="flex justify-between">
                  <span>徽章</span>
                  <span className={badgeMeta.color}>{badgeMeta.emoji} {badgeMeta.label}</span>
                </div>
                <div className="flex justify-between">
                  <span>上次互动</span>
                  <span>{formatRelative(stats.lastInteractionAt)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 商店 */}
        {subTab === 'shop' && (
          <div className="space-y-2">
            <div className="mb-1 flex items-center gap-1 text-xs text-ink-muted">
              <Sparkles size={12} />
              <span>购买物品后可在背包中使用</span>
            </div>
            <MobileShopView />
          </div>
        )}

        {/* 背包 */}
        {subTab === 'inventory' && <MobileInventoryView />}

        {/* 成就 */}
        {subTab === 'achievement' && <MobileAchievementView />}
      </div>
    </div>
  )
}
