/**
 * 移动端商店子视图组件
 * @module mobile/MobileShopView
 * @description
 * 移动端商店界面：七分类标签页 + 搜索过滤 + {t('app.buy')}/{t('shop.sell')} +
 * 锁状态（亲密度不足/其他角色专属）+ 装饰品穿戴（5 锚点）。
 *
 * 数据与桌面端同源（shopManager / petStore），视觉沿用语义 Token。
 *
 * @see {@link ./MobileNurturingView} 移动端养成视图（宿主）
 * @see {@link ../lib/shopManager} 商店管理器（分类/锁状态/买卖结算）
 */
import { useMemo, useState } from 'react'
import { Coins, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AnchorPoint, InventoryItem, WornDecoration } from '@/lib/data/types'
import { getRarityDisplay } from '@/lib/nurture/foodEffectContract'
import { getShopManager, ShopLockState, type ShopCategory } from '@/lib/nurture/shopManager'
import { usePetStore } from '@/stores/petStore'

/** 商店七分类配置 */
const CATEGORIES: { id: ShopCategory; labelKey: string; icon: string }[] = [
  { id: 'food', labelKey: 'shop.food', icon: '🍖' },
  { id: 'toy', labelKey: 'shop.toy', icon: '🧸' },
  { id: 'medicine', labelKey: 'shop.medicine', icon: '💊' },
  { id: 'accessory', labelKey: 'shop.decoration', icon: '🎀' },
  { id: 'collection', labelKey: 'shop.collection', icon: '🏆' },
  { id: 'dialogue', labelKey: 'shop.dialogue', icon: '💬' },
  { id: 'subpet', labelKey: 'shop.subpet', icon: '🐾' },
]

/** 装饰品穿戴锚点 */
const ANCHOR_OPTIONS: { value: AnchorPoint; labelKey: string }[] = [
  { value: 'head', labelKey: 'anchor.head' },
  { value: 'body', labelKey: 'anchor.body' },
  { value: 'hand_left', labelKey: 'anchor.handLeft' },
  { value: 'hand_right', labelKey: 'anchor.handRight' },
  { value: 'back', labelKey: 'anchor.back' },
]

/** 锁状态视觉指示 */
const LOCK_META: Record<ShopLockState, { icon: string; labelKey: string; color: string }> = {
  [ShopLockState.NONE]: { icon: '', labelKey: '', color: '' },
  [ShopLockState.FVLOCK]: { icon: '🔒', labelKey: 'shop.affectionNotEnough', color: 'text-tangerine-deep' },
  [ShopLockState.PETLIMIT]: { icon: '🚫', labelKey: 'shop.characterExclusive', color: 'text-error' },
}

const EMPTY_DECORATIONS: WornDecoration[] = []

/**
 * 移动端商店子视图
 * @returns 商店界面组件
 */
export function MobileShopView() {
  const { t } = useTranslation()
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
      showToast(t('shop.purchased', { name: item.name }))
    } else if (shop.getLockState(item.id) !== ShopLockState.NONE) {
      showToast(t('shop.locked'))
    } else {
      showToast(t('shop.coinsNotEnough'))
    }
  }

  function handleSell(item: InventoryItem) {
    const ok = shop.sellItem(item.id)
    if (!ok) {
      showToast(t('shop.notOwned'))
      return
    }
    const entry = catalog.find((e) => e.item.id === item.id)
    showToast(t('shop.sold', { name: item.name, price: entry?.sellPrice ?? 0 }))
  }

  function handleWear(itemId: string, anchor: AnchorPoint, name: string) {
    wearDecoration(itemId, anchor)
    showToast(
      t('inventory.worn', {
        name,
        anchor: t(ANCHOR_OPTIONS.find((a) => a.value === anchor)?.labelKey ?? ''),
      }),
    )
  }

  function handleRemove(itemId: string, name: string) {
    removeDecoration(itemId)
    showToast(t('shop.unequipped', { name }))
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
          placeholder={t('shop.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      {/* 分类 Tab（P2-9：换行铺开，七分类一眼可见，不再藏在横向滚动里） */}
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setTab(c.id)}
            className={`flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              tab === c.id ? 'bg-tangerine text-white' : 'bg-cream-deep text-ink-muted'
            }`}
          >
            <span>{c.icon}</span>
            {t(c.labelKey)}
          </button>
        ))}
      </div>

      {/* 商品列表 */}
      <div className="space-y-2">
        {visibleItems.length === 0 && (
          <div className="py-10 text-center text-sm text-ink-faint">
            {query ? t('shop.noMatch') : t('shop.empty')}
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
                  {item.hungerRestore ? `${t('stat.hunger')}+${item.hungerRestore} ` : ''}
                  {item.moodRestore ? `${t('stat.mood')}+${item.moodRestore} ` : ''}
                  {item.healthRestore ? `${t('stat.health')}+${item.healthRestore}` : ''}
                  {item.fvReward ? ` ${t('stat.affection')}+${item.fvReward}` : ''}
                  {item.dialogueTrigger ? ` ${t('shop.effectDialogue')}` : ''}
                  {item.subpetConfig ? ` ${t('shop.effectSummon', { name: item.subpetConfig.name })}` : ''}
                  {isAccessory && ownedCount > 0 ? ` ${t('shop.owned', { count: ownedCount })}` : ''}
                  {isLocked ? (
                    <span className={lockConfig.color}> {t(lockConfig.labelKey)}</span>
                  ) : (
                    entry.sellPrice > 0 && ` ${t('shop.sell')}🪙${entry.sellPrice}`
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="flex items-center gap-0.5 text-xs text-tangerine-deep">
                  <Coins size={12} /> {item.price}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleBuy(item)}
                    disabled={!canBuy}
                    data-testid={`buy-${item.id}`}
                    title={
                      isLocked
                        ? t(lockConfig.labelKey)
                        : !canBuy
                          ? t('shop.insufficientCoins', { need: item.price - sharedCoins })
                          : undefined
                    }
                    className="rounded-lg bg-tangerine px-2.5 py-1 text-[11px] text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('app.buy')}
                  </button>
                  <button
                    onClick={() => handleSell(item)}
                    disabled={ownedCount < 1}
                    className="rounded-lg bg-ink/10 px-2.5 py-1 text-[11px] text-ink-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('shop.sell')}
                  </button>
                </div>
                {/* P2-9：金币不足时说明原因（未解锁的原因已由 lockConfig.labelKey 展示） */}
                {!isLocked && sharedCoins < item.price && (
                  <span className="text-[9px] leading-3 text-error" data-testid="insufficient-reason">
                    {t('shop.insufficientCoins', { need: item.price - sharedCoins })}
                  </span>
                )}
                {/* 装饰品穿戴/{t('inventory.remove')}（仅已拥有） */}
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
                        {t('inventory.wearTo')}
                      </option>
                      {ANCHOR_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {t(a.labelKey)}
                        </option>
                      ))}
                    </select>
                    {wornAnchor && (
                      <button
                        onClick={() => handleRemove(item.id, item.name)}
                        className="rounded-lg bg-error/15 px-1.5 py-0.5 text-[10px] text-error"
                      >
                        {t('inventory.remove')}
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
