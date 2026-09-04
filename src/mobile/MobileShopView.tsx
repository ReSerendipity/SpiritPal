/**
 * 移动端商店子视图组件
 * @module mobile/MobileShopView
 * @description
 * 移动端商店界面：七分类标签页 + 搜索过滤 + 购买/出售 +
 * 锁状态（亲密度不足/其他角色专属）+ 装饰品穿戴（5 锚点）。
 *
 * 数据与桌面端同源（shopManager / petStore），视觉沿用语义 Token。
 *
 * @see {@link ./MobileNurturingView} 移动端养成视图（宿主）
 * @see {@link ../lib/shopManager} 商店管理器（分类/锁状态/买卖结算）
 */
import { useMemo, useState } from 'react'
import { Coins, Search } from 'lucide-react'
import type { AnchorPoint, InventoryItem, WornDecoration } from '@/lib/data/types'
import { getRarityDisplay } from '@/lib/nurture/foodEffectContract'
import { getShopManager, ShopLockState, type ShopCategory } from '@/lib/nurture/shopManager'
import { usePetStore } from '@/stores/petStore'

/** 商店七分类配置 */
const CATEGORIES: { id: ShopCategory; label: string; icon: string }[] = [
  { id: 'food', label: '食物', icon: '🍖' },
  { id: 'toy', label: '玩具', icon: '🧸' },
  { id: 'medicine', label: '药品', icon: '💊' },
  { id: 'accessory', label: '装饰', icon: '🎀' },
  { id: 'collection', label: '收藏', icon: '🏆' },
  { id: 'dialogue', label: '对话', icon: '💬' },
  { id: 'subpet', label: '副宠', icon: '🐾' },
]

/** 装饰品穿戴锚点 */
const ANCHOR_OPTIONS: { value: AnchorPoint; label: string }[] = [
  { value: 'head', label: '头部' },
  { value: 'body', label: '身体' },
  { value: 'hand_left', label: '左手' },
  { value: 'hand_right', label: '右手' },
  { value: 'back', label: '背部' },
]

/** 锁状态视觉指示 */
const LOCK_META: Record<ShopLockState, { icon: string; label: string; color: string }> = {
  [ShopLockState.NONE]: { icon: '', label: '', color: '' },
  [ShopLockState.FVLOCK]: { icon: '🔒', label: '亲密度不足', color: 'text-tangerine-deep' },
  [ShopLockState.PETLIMIT]: { icon: '🚫', label: '其他角色专属', color: 'text-red-500' },
}

const EMPTY_DECORATIONS: WornDecoration[] = []

/**
 * 移动端商店子视图
 * @returns 商店界面组件
 */
export function MobileShopView() {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const sharedCoins = usePetStore((s) => s.sharedCoins)
  const inventory = usePetStore((s) => s.inventory)
  const wornDecorations = usePetStore(
    (s) => s.wornDecorations[s.currentCharacterId] ?? EMPTY_DECORATIONS,
  )
  const wearDecoration = usePetStore((s) => s.wearDecoration)
  const removeDecoration = usePetStore((s) => s.removeDecoration)

  const [tab, setTab] = useState<ShopCategory>('food')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 1500)
  }

  // 带锁状态/出售价/持有数的目录（派生值：角色/库存/金币变化时重算）
  const shop = useMemo(() => getShopManager(), [])
  const catalog = useMemo(
    () => shop.getCatalog(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 目录是 shopManager 的派生值，需在角色/库存/金币变化时重算
    [shop, currentCharacterId, inventory, sharedCoins],
  )

  // 分类 + 搜索过滤
  const visibleItems = useMemo(() => {
    const filtered = catalog.filter((entry) => entry.item.type === tab)
    const kw = query.trim().toLowerCase()
    if (!kw) return filtered
    return filtered.filter((entry) => {
      const item = entry.item
      return (
        item.name.toLowerCase().includes(kw) ||
        (item.description ?? '').toLowerCase().includes(kw) ||
        (item.tags ?? []).join(' ').toLowerCase().includes(kw)
      )
    })
  }, [catalog, tab, query])

  function handleBuy(item: InventoryItem) {
    const ok = shop.buyItem(item.id)
    if (ok) {
      showToast(`已购买 ${item.name}`)
    } else if (shop.getLockState(item.id) !== ShopLockState.NONE) {
      showToast('该物品尚未解锁')
    } else {
      showToast('金币不足')
    }
  }

  function handleSell(item: InventoryItem) {
    const ok = shop.sellItem(item.id)
    if (!ok) {
      showToast('没有可出售的该物品')
      return
    }
    const entry = catalog.find((e) => e.item.id === item.id)
    showToast(`出售 ${item.name} +${entry?.sellPrice ?? 0} 金币`)
  }

  function handleWear(itemId: string, anchor: AnchorPoint, name: string) {
    wearDecoration(itemId, anchor)
    showToast(`已穿戴 ${name} 到${ANCHOR_OPTIONS.find((a) => a.value === anchor)?.label}`)
  }

  function handleRemove(itemId: string, name: string) {
    removeDecoration(itemId)
    showToast(`已取下 ${name}`)
  }

  function getWornAnchor(itemId: string): AnchorPoint | undefined {
    return wornDecorations.find((d) => d.itemId === itemId)?.anchor
  }

  // 主题样式类（与移动端其他视图一致的语义 Token 配色）
  const cardBgClass = 'bg-surface'
  const cardBorderClass = 'border-ink/10'
  const subTextClass = 'text-ink-muted'

  return (
    <div className="space-y-2">
      {/* 搜索框 */}
      <div className={`flex items-center gap-2 rounded-xl border ${cardBorderClass} ${cardBgClass} px-3`}>
        <Search size={14} className="flex-shrink-0 text-ink-faint" />
        <input
          type="text"
          placeholder="搜索物品名称/描述…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      {/* 分类 Tab（横向滚动） */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setTab(c.id)}
            className={`flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              tab === c.id ? 'bg-tangerine text-white' : 'bg-cream-deep text-ink-muted'
            }`}
          >
            <span>{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>

      {/* 商品列表 */}
      <div className="space-y-2">
        {visibleItems.length === 0 && (
          <div className="py-10 text-center text-sm text-ink-faint">
            {query ? '未找到匹配的物品' : '暂无物品'}
          </div>
        )}
        {visibleItems.map((entry) => {
          const item = entry.item
          const ownedCount = entry.owned
          const wornAnchor = getWornAnchor(item.id)
          const isLocked = entry.lockState !== ShopLockState.NONE
          const isAccessory = item.type === 'accessory'
          const canBuy = !isLocked && sharedCoins >= item.price
          const lockConfig = LOCK_META[entry.lockState]
          const rarity = item.fvLock !== undefined && item.fvLock > 0 ? getRarityDisplay(item.fvLock) : null
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 rounded-xl border ${cardBorderClass} ${cardBgClass} p-2.5 ${isLocked ? 'opacity-60' : ''}`}
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-cream-deep text-xl">
                {item.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink">{item.name}</span>
                  {rarity && (
                    <span className={`rounded px-1 py-0.5 text-[10px] leading-none ${rarity.colors.text} ${rarity.colors.bg}`}>
                      {rarity.name}
                    </span>
                  )}
                  {lockConfig.icon && (
                    <span className={`text-xs ${lockConfig.color}`}>{lockConfig.icon}</span>
                  )}
                </div>
                <div className={`mt-0.5 truncate text-[11px] ${subTextClass}`}>
                  {item.hungerRestore ? `饱食+${item.hungerRestore} ` : ''}
                  {item.moodRestore ? `心情+${item.moodRestore} ` : ''}
                  {item.healthRestore ? `健康+${item.healthRestore}` : ''}
                  {item.fvReward ? ` 亲密度+${item.fvReward}` : ''}
                  {item.dialogueTrigger ? ' 触发对话' : ''}
                  {item.subpetConfig ? ` 召唤${item.subpetConfig.name}` : ''}
                  {isAccessory && ownedCount > 0 ? ` 已拥有×${ownedCount}` : ''}
                  {isLocked ? (
                    <span className={lockConfig.color}> {lockConfig.label}</span>
                  ) : (
                    entry.sellPrice > 0 && ` 出售🪙${entry.sellPrice}`
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="flex items-center gap-0.5 text-xs text-amber-500">
                  <Coins size={12} /> {item.price}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleBuy(item)}
                    disabled={!canBuy}
                    className="rounded-lg bg-tangerine px-2.5 py-1 text-[11px] text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    购买
                  </button>
                  <button
                    onClick={() => handleSell(item)}
                    disabled={ownedCount < 1}
                    className="rounded-lg bg-ink/10 px-2.5 py-1 text-[11px] text-ink-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    出售
                  </button>
                </div>
                {/* 装饰品穿戴/取下（仅已拥有） */}
                {isAccessory && ownedCount > 0 && (
                  <div className="flex items-center gap-1">
                    <select
                      value={wornAnchor ?? ''}
                      onChange={(e) => {
                        const val = e.target.value as AnchorPoint
                        if (val) handleWear(item.id, val, item.name)
                      }}
                      className="rounded-lg border border-ink/15 bg-surface px-1.5 py-0.5 text-[10px] text-ink focus:outline-none"
                    >
                      <option value="" disabled>
                        穿戴到…
                      </option>
                      {ANCHOR_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {wornAnchor && (
                      <button
                        onClick={() => handleRemove(item.id, item.name)}
                        className="rounded-lg bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-500"
                      >
                        取下
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink/85 px-4 py-1.5 text-xs text-white">
          {toast}
        </div>
      )}
    </div>
  )
}
