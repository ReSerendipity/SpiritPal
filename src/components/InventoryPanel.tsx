/**
 * 背包面板组件
 *
 * 功能概述：
 * - 展示已拥有的所有道具列表
 * - 区分消耗品和装饰品两种类型
 * - 消耗品支持一键使用，恢复饱食/心情/健康
 * - 装饰品支持选择锚点位置穿戴和一键取下
 * - 显示物品稀有度标签和数量
 * - 操作后显示toast提示
 * - 物品使用数据上报analytics
 *
 * 核心Hooks/状态：
 * - useState: toast提示消息
 * - usePetStore: 背包物品、已穿戴装饰品、使用物品/穿戴/取下操作
 */
import { useState } from 'react'
import { usePetStore } from '../stores/petStore'
import type { AnchorPoint, WornDecoration } from '../lib/types'
import { getRarityDisplay } from '../lib/foodEffectContract'
import { trackItemUse } from '../lib/analytics'

const EMPTY_DECORATIONS: WornDecoration[] = []
const selectInventory = (s: ReturnType<typeof usePetStore.getState>) => s.inventory
const selectUseItem = (s: ReturnType<typeof usePetStore.getState>) => s.useItem
const selectWornDecorations = (s: ReturnType<typeof usePetStore.getState>) => s.wornDecorations[s.currentCharacterId] ?? EMPTY_DECORATIONS
const selectWearDecoration = (s: ReturnType<typeof usePetStore.getState>) => s.wearDecoration
const selectRemoveDecoration = (s: ReturnType<typeof usePetStore.getState>) => s.removeDecoration

const ANCHOR_OPTIONS: { value: AnchorPoint; label: string }[] = [
  { value: 'head', label: '头部' },
  { value: 'body', label: '身体' },
  { value: 'hand_left', label: '左手' },
  { value: 'hand_right', label: '右手' },
  { value: 'back', label: '背部' },
]

/**
 * 背包管理面板
 *
 * 展示玩家已拥有的所有道具，支持消耗品使用和装饰品穿戴/取下操作。
 */
export function InventoryPanel() {
  const inventory = usePetStore(selectInventory)
  const consumeItem = usePetStore(selectUseItem)
  const wornDecorations = usePetStore(selectWornDecorations)
  const wearDecoration = usePetStore(selectWearDecoration)
  const removeDecoration = usePetStore(selectRemoveDecoration)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 1500)
  }

  function handleUse(itemId: string, name: string) {
    consumeItem(itemId)
    trackItemUse(itemId, 'consumable')
    showToast(`使用了 ${name}`)
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

  return (
    <div className="relative w-full rounded-xl bg-surface/95 p-3 text-white shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">🎒 背包</span>
        <span className="text-xs text-ink-muted">共 {inventory.length} 种</span>
      </div>

      {inventory.length === 0 ? (
        <div className="py-8 text-center text-sm text-ink-muted">
          背包空空如也，去商店买点东西吧～
        </div>
      ) : (
        <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1">
          {inventory.map((item) => {
            const wornAnchor = getWornAnchor(item.id)
            const isAccessory = item.type === 'accessory'
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg bg-cream-deep/60 p-2"
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
                  </div>
                  <div className="truncate text-[11px] text-ink-muted">
                    {item.hungerRestore ? `饱食+${item.hungerRestore} ` : ''}
                    {item.moodRestore ? `心情+${item.moodRestore} ` : ''}
                    {item.healthRestore ? `健康+${item.healthRestore}` : ''}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded bg-ink-faint px-1.5 py-0.5 text-[11px]">×{item.count}</span>
                  {isAccessory ? (
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
                  ) : (
                    <button
                      onClick={() => handleUse(item.id, item.name)}
                      className="rounded bg-blue-600 px-2 py-0.5 text-[11px] hover:bg-blue-500"
                    >
                      使用
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-xs text-white">
          {toast}
        </div>
      )}
    </div>
  )
}
