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
import { Heart, ShoppingBag, Backpack, Coins, Sparkles } from 'lucide-react'
import { usePetStore } from '../stores/petStore'
import { getCharacter } from '../lib/characters'
import { getAllShopItems, getFoodsForCharacter, getRarityName } from '../lib/items'
import type { BadgeTier, InventoryItem } from '../lib/types'

/**
 * MobileNurturingView 组件属性
 */
interface MobileNurturingViewProps {
  /** 是否深色模式 */
  isDark: boolean
}

/** 子 Tab 类型 */
type SubTab = 'stats' | 'shop' | 'inventory'

/** 属性颜色等级映射 */
const TIER_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-400',
  red: 'bg-red-500',
}

/** 徽章元信息映射 */
const BADGE_META: Record<BadgeTier, { label: string; emoji: string; color: string }> = {
  none: { label: '无', emoji: '⚪', color: 'text-gray-400' },
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
 * @param props 组件属性
 * @returns 养成界面组件
 */
export function MobileNurturingView({ isDark }: MobileNurturingViewProps) {
  const stats = usePetStore((s) => s.getCurrentStats())
  const sharedCoins = usePetStore((s) => s.sharedCoins)
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const inventory = usePetStore((s) => s.inventory)
  const getBadge = usePetStore((s) => s.getBadge)
  const getColorTier = usePetStore((s) => s.getColorTier)
  const buyItem = usePetStore((s) => s.buyItem)
  const consumeItem = usePetStore((s) => s.useItem)
  const character = getCharacter(currentCharacterId)

  const [subTab, setSubTab] = useState<SubTab>('stats')

  // 商店物品列表（合并食物和其他物品，去重，限制显示数量）
  const shopItems: InventoryItem[] = [
    ...getFoodsForCharacter(currentCharacterId),
    ...getAllShopItems(currentCharacterId).filter(
      (i) => !getFoodsForCharacter(currentCharacterId).some((f) => f.id === i.id),
    ),
  ].slice(0, 20) // 限制显示数量，避免移动端过长

  const badge = getBadge(stats.level)
  const badgeMeta = BADGE_META[badge]
  const expNeed = stats.level * 100
  const expPct = Math.min(100, (stats.exp / expNeed) * 100)

  // 主题样式类
  const bgClass = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const textClass = isDark ? 'text-gray-100' : 'text-gray-900'
  const cardBgClass = isDark ? 'bg-gray-800' : 'bg-white'
  const cardBorderClass = isDark ? 'border-gray-700' : 'border-gray-200'
  const subTabActiveClass = isDark
    ? 'bg-indigo-600 text-white'
    : 'bg-indigo-500 text-white'
  const subTabInactiveClass = isDark
    ? 'bg-gray-700 text-gray-300'
    : 'bg-gray-200 text-gray-600'

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
        <div className="flex items-center gap-1 text-sm text-amber-500">
          <Coins size={14} />
          <span className="tabular-nums">{sharedCoins}</span>
        </div>
      </header>

      {/* 经验条 */}
      <div className={`px-4 py-2 ${cardBgClass} border-b ${cardBorderClass}`}>
        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
          <span>经验</span>
          <span className="tabular-nums">{Math.floor(stats.exp)} / {expNeed}</span>
        </div>
        <div className={`h-1.5 w-full overflow-hidden rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${expPct}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-gray-500">
          亲密度 {Math.floor(stats.affection)} · 上次互动 {formatRelative(stats.lastInteractionAt)}
        </div>
      </div>

      {/* 子 Tab 切换 */}
      <div className="flex gap-1 p-2">
        {([
          { id: 'stats', label: '属性', icon: Heart },
          { id: 'shop', label: '商店', icon: ShoppingBag },
          { id: 'inventory', label: '背包', icon: Backpack },
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
                    <span className="text-sm tabular-nums text-gray-500">{Math.round(stat.value)} / 100</span>
                  </div>
                  <div className={`h-2 w-full overflow-hidden rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
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
              <div className="space-y-1 text-xs text-gray-500">
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
            <div className="mb-2 flex items-center gap-1 text-xs text-gray-500">
              <Sparkles size={12} />
              <span>购买物品后可在背包中使用</span>
            </div>
            {shopItems.map((item) => {
              const canAfford = sharedCoins >= item.price
              const rarity = getRarityName(item.fvLock)
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-2.5`}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xl dark:bg-gray-700">
                    {item.icon}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium">{item.name}</span>
                      {item.fvLock !== undefined && item.fvLock > 0 && (
                        <span className="text-[10px] text-amber-500">{rarity}</span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-gray-500">
                      {item.description ?? item.type}
                    </div>
                  </div>
                  <button
                    onClick={() => buyItem(item)}
                    disabled={!canAfford}
                    className={`flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs ${
                      canAfford
                        ? 'bg-amber-500 text-white'
                        : 'bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-500'
                    }`}
                  >
                    <Coins size={10} />
                    {item.price}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* 背包 */}
        {subTab === 'inventory' && (
          <div className="space-y-2">
            {inventory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400">
                <Backpack size={48} className="mb-3 opacity-40" />
                <p className="text-sm">背包是空的</p>
                <p className="mt-1 text-xs text-gray-500">去商店购买物品吧～</p>
              </div>
            ) : (
              inventory.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-2.5`}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xl dark:bg-gray-700">
                    {item.icon}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium">{item.name}</span>
                      <span className="text-[10px] text-gray-500">×{item.count}</span>
                    </div>
                    <div className="truncate text-[11px] text-gray-500">
                      {item.description ?? item.type}
                    </div>
                  </div>
                  <button
                    onClick={() => consumeItem(item.id)}
                    className="flex-shrink-0 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs text-white"
                  >
                    使用
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
