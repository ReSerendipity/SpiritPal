/**
 * 商店面板组件
 *
 * 功能概述：
 * - 七标签页分类：食物/玩具/药品/装饰品/收藏/对话/副宠
 * - 搜索过滤（按名称/描述/标签匹配，不区分大小写）
 * - 商品购买和出售（标准折价）
 * - DyberPet锁状态机（物品解锁机制）
 * - 稀有度标签显示
 * - 装饰品直接穿戴选择（5个锚点位置）
 * - 购买/出售toast提示
 * - 实时更新目录（金币/背包变化时刷新锁状态）
 *
 * 核心Hooks/状态：
 * - useState: 当前标签页、搜索关键词、toast消息
 * - useMemo: shopManager实例、可见商品筛选
 *
 * 使用模块：
 * - shopManager: 商店管理器（锁状态机+折价逻辑+搜索）
 * - petStore: 金币、背包、穿戴操作
 */
import { useState, useMemo } from 'react'
import { usePetStore } from '../stores/petStore'
import type { InventoryItem, AnchorPoint, WornDecoration } from '../lib/types'
import { getShopManager, ShopLockState } from '../lib/shopManager'
import { getRarityDisplay } from '../lib/foodEffectContract'

const EMPTY_DECORATIONS: WornDecoration[] = []
const selectCurrentCharacterId = (s: ReturnType<typeof usePetStore.getState>) => s.currentCharacterId
const selectSharedCoins = (s: ReturnType<typeof usePetStore.getState>) => s.sharedCoins
const selectInventory = (s: ReturnType<typeof usePetStore.getState>) => s.inventory
const selectWornDecorations = (s: ReturnType<typeof usePetStore.getState>) => s.wornDecorations[s.currentCharacterId] ?? EMPTY_DECORATIONS
const selectWearDecoration = (s: ReturnType<typeof usePetStore.getState>) => s.wearDecoration
const selectRemoveDecoration = (s: ReturnType<typeof usePetStore.getState>) => s.removeDecoration

type Tab = 'food' | 'toy' | 'medicine' | 'accessory' | 'collection' | 'dialogue' | 'subpet'

const TAB_LABELS: Record<Tab, string> = {
  food: '食物',
  toy: '玩具',
  medicine: '药品',
  accessory: '装饰品',
  collection: '收藏',
  dialogue: '对话',
  subpet: '副宠',
}

const ANCHOR_OPTIONS: { value: AnchorPoint; label: string }[] = [
  { value: 'head', label: '头部' },
  { value: 'body', label: '身体' },
  { value: 'hand_left', label: '左手' },
  { value: 'hand_right', label: '右手' },
  { value: 'back', label: '背部' },
]

/**
 * 商店面板
 *
 * 提供物品购买、出售和装饰品穿戴功能，支持七分类标签页、搜索过滤和锁状态机制。
 */
export function ShopPanel() {
  const [tab, setTab] = useState<Tab>('food')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const currentCharacterId = usePetStore(selectCurrentCharacterId)
  const sharedCoins = usePetStore(selectSharedCoins)
  const inventory = usePetStore(selectInventory)
  const wornDecorations = usePetStore(selectWornDecorations)
  const wearDecoration = usePetStore(selectWearDecoration)
  const removeDecoration = usePetStore(selectRemoveDecoration)

  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 1500)
  }

  // Phase 2.4: 从 shopManager 获取带锁状态的目录
  // 目录为派生值：角色/库存/金币变化时自动重算，无需在 effect 中同步 setState
  const shop = useMemo(() => getShopManager(), [])
  const catalog = useMemo(
    () => shop.getCatalog(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 目录是 shopManager 的派生值，需在角色/库存/金币变化时重算刷新购买与解锁状态
    [shop, currentCharacterId, inventory, sharedCoins],
  )

  // 根据标签和搜索关键词筛选可见商品
  const visibleItems = useMemo(() => {
    const filtered = catalog.filter((entry) => entry.item.type === tab)

    // 搜索过滤：匹配名称、描述或标签
    const kw = searchQuery.trim().toLowerCase()
    if (!kw) return filtered

    return filtered.filter((entry) => {
      const name = entry.item.name.toLowerCase()
      const desc = (entry.item.description ?? '').toLowerCase()
      const tags = (entry.item.tags ?? []).join(' ').toLowerCase()
      return name.includes(kw) || desc.includes(kw) || tags.includes(kw)
    })
  }, [catalog, tab, searchQuery])

  function handleBuy(item: InventoryItem) {
    const ok = shop.buyItem(item.id)
    showToast(ok ? `已购买 ${item.name}` : (shop.getLockState(item.id) !== ShopLockState.NONE ? '该物品尚未解锁' : '金币不足'))
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

  // 查找物品当前穿戴的锚点
  function getWornAnchor(itemId: string): AnchorPoint | undefined {
    return wornDecorations.find((d) => d.itemId === itemId)?.anchor
  }

  return (
    <div className="relative w-full rounded-xl bg-surface/95 p-3 text-white shadow-xl">
      {/* 顶部栏：标题 + 金币 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">🛒 商店</span>
        <span className="flex items-center gap-1 text-sm text-amber-300">
          🪙 <span className="tabular-nums">{sharedCoins}</span>
        </span>
      </div>

      {/* 搜索框 */}
      <input
        type="text"
        placeholder="搜索物品名称/描述…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="mb-2 w-full rounded-lg bg-cream-deep/60 px-3 py-1.5 text-xs text-white placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-400"
      />

      {/* 标签页（可滚动） */}
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-lg bg-cream-deep p-1">
        {(Object.keys(TAB_LABELS) as Tab[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
              tab === k ? 'bg-amber-400 text-gray-900' : 'text-ink hover:bg-blush-soft'
            }`}
          >
            {TAB_LABELS[k]}
          </button>
        ))}
      </div>

      {/* 商品列表 */}
      <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1">
        {visibleItems.length === 0 && (
          <div className="py-8 text-center text-sm text-ink-muted">
            {searchQuery ? '未找到匹配的物品' : '暂无物品'}
          </div>
        )}
        {visibleItems.map((entry) => {
          const item = entry.item
          const ownedCount = entry.owned
          const wornAnchor = getWornAnchor(item.id)
          const isLocked = entry.lockState !== ShopLockState.NONE
          const isAccessory = item.type === 'accessory'
          const canBuy = !isLocked && sharedCoins >= item.price
          // 锁状态视觉指示器
          const lockConfig = {
            [ShopLockState.NONE]: { icon: '', label: '', color: '' },
            [ShopLockState.FVLOCK]: { icon: '🔒', label: '亲密度不足', color: 'text-orange-400' },
            [ShopLockState.PETLIMIT]: { icon: '🚫', label: '其他角色专属', color: 'text-red-400' },
          }[entry.lockState]
          // 折价出售价指示
          const sellPriceDisplay = entry.sellPrice > 0 ? `出售🪙${entry.sellPrice}` : ''
          return (
            <div
              key={item.id}
              className={`flex items-center gap-2 rounded-lg bg-cream-deep/60 p-2 ${isLocked ? 'opacity-50' : ''}`}
            >
              <span className="text-2xl">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm">{item.name}</span>
                  {/* 稀有度标签 */}
                  {item.fvLock !== undefined && item.fvLock > 0 && (
                    <span className={`rounded px-1 py-0.5 text-[10px] leading-none ${getRarityDisplay(item.fvLock).colors.text} ${getRarityDisplay(item.fvLock).colors.bg}`}>
                      {getRarityDisplay(item.fvLock).name}
                    </span>
                  )}
                  {lockConfig.icon && (
                    <span className={`text-xs ${lockConfig.color}`} title={lockConfig.label}>
                      {lockConfig.icon}
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-ink-muted">
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
                    ` ${sellPriceDisplay}`
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-amber-300">🪙 {item.price}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleBuy(item)}
                    disabled={!canBuy}
                    className="rounded bg-green-600 px-2 py-0.5 text-[11px] hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    购买
                  </button>
                  <button
                    onClick={() => handleSell(item)}
                    disabled={ownedCount < 1}
                    className="rounded bg-ink-faint px-2 py-0.5 text-[11px] hover:bg-blush-soft disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    出售
                  </button>
                </div>
                {/* 装饰品穿戴/取下控件（仅已拥有的装饰品显示） */}
                {isAccessory && ownedCount > 0 && (
                  <div className="flex items-center gap-1">
                    <select
                      value={wornAnchor ?? ''}
                      onChange={(e) => {
                        const val = e.target.value as AnchorPoint
                        if (val) handleWear(item.id, val, item.name)
                      }}
                      className="rounded bg-ink-faint px-1 py-0.5 text-[10px] focus:outline-none"
                    >
                      <option value="" disabled>穿戴到…</option>
                      {ANCHOR_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                    {wornAnchor && (
                      <button
                        onClick={() => handleRemove(item.id, item.name)}
                        className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] hover:bg-red-500"
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
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-xs text-white">
          {toast}
        </div>
      )}
    </div>
  )
}
