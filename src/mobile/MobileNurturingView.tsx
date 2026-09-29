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
import { useTranslation } from 'react-i18next'
import { getCharacter } from '@/lib/data/characters'
import type { BadgeTier } from '@/lib/data/types'
import { formatRelativeTime } from '@/lib/system/i18n'
import { MobileAchievementView } from '@/mobile/MobileAchievementView'
import { MobileInventoryView } from '@/mobile/MobileInventoryView'
import { MobileShopView } from '@/mobile/MobileShopView'
import { usePetStore } from '@/stores/petStore'

/** 子 Tab 类型 */
type SubTab = 'stats' | 'shop' | 'inventory' | 'achievement'

/** 属性颜色等级映射 */
const TIER_COLORS: Record<string, string> = {
  green: 'bg-stat-good',
  yellow: 'bg-stat-mid',
  orange: 'bg-warning',
  red: 'bg-error',
}

/** 徽章元信息映射 */
const BADGE_META: Record<BadgeTier, { labelKey: string; emoji: string; color: string }> = {
  none: { labelKey: 'badge.none', emoji: '⚪', color: 'text-ink-muted' },
  star: { labelKey: 'badge.star', emoji: '⭐', color: 'text-stat-mid' },
  moon: { labelKey: 'badge.moon', emoji: '🌙', color: 'text-indigo-300' },
  sun: { labelKey: 'badge.sun', emoji: '☀️', color: 'text-warning' },
  crown: { labelKey: 'badge.crown', emoji: '👑', color: 'text-tangerine-deep' },
}

/**
 * 格式化相对时间（委托 i18n 的 Intl.RelativeTimeFormat，随语言本地化）
 * @param ts 时间戳（毫秒）
 * @returns 相对时间字符串（如 "5 分钟前"）
 */
function formatRelative(ts: number): string {
  return formatRelativeTime(new Date(ts))
}

/**
 * 移动端养成视图组件
 * @returns 养成界面组件
 */
export function MobileNurturingView() {
  const { t } = useTranslation()
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
    { labelKey: 'stat.hunger', value: stats.hunger, icon: '🍖' },
    { labelKey: 'stat.mood', value: stats.mood, icon: '😊' },
    { labelKey: 'stat.health', value: stats.health, icon: '💚' },
  ]

  return (
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      {/* 顶部：角色 + 等级 + 金币 */}
      <header className={`flex items-center justify-between border-b ${cardBorderClass} px-4 py-3`}>
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{character?.displayName ?? t('tab.pet')}</span>
          <span className={`text-sm ${badgeMeta.color}`} title={t(badgeMeta.labelKey)}>
            {badgeMeta.emoji} Lv.{stats.level}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm text-tangerine-deep">
          <Coins size={14} />
          <span className="tabular-nums">{sharedCoins}</span>
        </div>
      </header>

      {/* 经验条 */}
      <div className={`px-4 py-2 ${cardBgClass} border-b ${cardBorderClass}`}>
        <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
          <span>{t('stat.exp')}</span>
          <span className="tabular-nums">{Math.floor(stats.exp)} / {expNeed}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-deep">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${expPct}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-ink-muted">
          {t('stat.affection')} {Math.floor(stats.affection)} · {t('nurture.lastInteraction')} {formatRelative(stats.lastInteractionAt)}
        </div>
      </div>

      {/* 子 Tab 切换 */}
      <div className="flex gap-1 p-2">
        {([
          { id: 'stats', labelKey: 'tab.stats', icon: Heart },
          { id: 'shop', labelKey: 'action.shop', icon: ShoppingBag },
          { id: 'inventory', labelKey: 'tab.inventory', icon: Backpack },
          { id: 'achievement', labelKey: 'tab.achievement', icon: Trophy },
        ] as const).map((tabDef) => {
          const Icon = tabDef.icon
          const isActive = subTab === tabDef.id
          return (
            <button
              key={tabDef.id}
              onClick={() => setSubTab(tabDef.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors ${
                isActive ? subTabActiveClass : subTabInactiveClass
              }`}
            >
              <Icon size={14} />
              {t(tabDef.labelKey)}
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
                <div key={stat.labelKey} className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg">{stat.icon}</span>
                      <span className="text-sm font-medium">{t(stat.labelKey)}</span>
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
              <h3 className="mb-2 text-sm font-medium">{t('nurture.info')}</h3>
              <div className="space-y-1 text-xs text-ink-muted">
                <div className="flex justify-between">
                  <span>{t('nurture.currentLevel')}</span>
                  <span>Lv.{stats.level}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('stat.affection')}</span>
                  <span>{Math.floor(stats.affection)} / 9999</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('nurture.badge')}</span>
                  <span className={badgeMeta.color}>{badgeMeta.emoji} {t(badgeMeta.labelKey)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('nurture.lastInteraction')}</span>
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
              <span>{t('nurture.buyHint')}</span>
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
