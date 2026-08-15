/**
 * 装饰品穿戴管理器组件
 *
 * 功能概述：
 * - 管理宠物装饰品穿戴，支持5个锚点位置（头部/身体/左手/右手/背部）
 * - 同一锚点仅保留一个装饰品，新穿戴会替换旧的
 * - 展示当前已穿戴装饰品列表，支持一键取下
 * - 从背包筛选accessory类型物品供选择穿戴
 * - 锚点选择切换，点击装饰品穿戴到当前选中锚点
 *
 * 核心Hooks/状态：
 * - useState: 当前选中的锚点位置
 * - usePetStore: 背包物品、已穿戴装饰品、穿戴/取下操作
 */
import { useState } from 'react'
import { Shirt, X } from 'lucide-react'
import { usePetStore } from '../stores/petStore'
import type { InventoryItem, AnchorPoint, WornDecoration } from '../lib/types'

const EMPTY_DECORATIONS: WornDecoration[] = []
const selectInventory = (s: ReturnType<typeof usePetStore.getState>) => s.inventory
const selectWornDecorations = (s: ReturnType<typeof usePetStore.getState>) => s.wornDecorations[s.currentCharacterId] ?? EMPTY_DECORATIONS
const selectWearDecoration = (s: ReturnType<typeof usePetStore.getState>) => s.wearDecoration
const selectRemoveDecoration = (s: ReturnType<typeof usePetStore.getState>) => s.removeDecoration

const ANCHOR_LABELS: Record<AnchorPoint, string> = {
  head: '头部',
  body: '身体',
  hand_left: '左手',
  hand_right: '右手',
  back: '背部',
}

const ANCHOR_OPTIONS: AnchorPoint[] = ['head', 'body', 'hand_left', 'hand_right', 'back']

/**
 * 装饰品穿戴编辑器
 *
 * 提供装饰品穿戴管理界面，支持5个锚点位置切换、背包装饰品选择和已穿戴物品取下。
 */
export function DecorationEditor() {
  const inventory = usePetStore(selectInventory)
  const wornDecorations = usePetStore(selectWornDecorations)
  const wearDecoration = usePetStore(selectWearDecoration)
  const removeDecoration = usePetStore(selectRemoveDecoration)

  const [selectedAnchor, setSelectedAnchor] = useState<AnchorPoint>('head')

  // 从背包中筛选可穿戴的装饰品（type === 'accessory'，count > 0）
  const accessories: InventoryItem[] = inventory.filter(
    (i) => i.type === 'accessory' && i.count > 0,
  )

  // 按锚点分组已穿戴的装饰品
  const wornByAnchor = new Map<AnchorPoint, InventoryItem>()
  for (const w of wornDecorations) {
    const item = inventory.find((i) => i.id === w.itemId)
    if (item) {
      wornByAnchor.set(w.anchor, item)
    }
  }

  function handleWear(item: InventoryItem) {
    wearDecoration(item.id, selectedAnchor)
  }

  function handleRemove(anchor: AnchorPoint) {
    const worn = wornByAnchor.get(anchor)
    if (worn) {
      removeDecoration(worn.id)
    }
  }

  return (
    <div className="space-y-3 rounded-lg bg-surface/50 p-3">
      <div className="flex items-center gap-2">
        <Shirt size={14} className="text-amber-400" />
        <span className="text-xs font-semibold text-amber-300">装扮管理</span>
      </div>

      {/* 已穿戴的装饰品 */}
      <div>
        <div className="mb-2 text-[10px] text-ink-muted">当前穿戴</div>
        {ANCHOR_OPTIONS.map((anchor) => {
          const item = wornByAnchor.get(anchor)
          return (
            <div key={anchor} className="flex items-center justify-between py-1 text-xs">
              <span className="text-ink-muted">{ANCHOR_LABELS[anchor]}</span>
              {item ? (
                <div className="flex items-center gap-1.5">
                  <span>{item.icon} {item.name}</span>
                  <button
                    onClick={() => handleRemove(anchor)}
                    className="rounded p-0.5 text-ink-muted hover:bg-red-900/40 hover:text-red-400"
                    aria-label={`移除 ${ANCHOR_LABELS[anchor]} 的装饰品`}
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <span className="text-ink-faint">未穿戴</span>
              )}
            </div>
          )
        })}
      </div>

      {/* 锚点选择 */}
      <div>
        <div className="mb-1 text-[10px] text-ink-muted">穿戴位置</div>
        <div className="flex flex-wrap gap-1">
          {ANCHOR_OPTIONS.map((anchor) => (
            <button
              key={anchor}
              onClick={() => setSelectedAnchor(anchor)}
              className={`rounded-md px-2 py-0.5 text-[10px] transition-colors ${
                selectedAnchor === anchor
                  ? 'bg-amber-400 text-gray-900'
                  : 'bg-cream-deep text-ink hover:bg-blush-soft'
              }`}
            >
              {ANCHOR_LABELS[anchor]}
            </button>
          ))}
        </div>
      </div>

      {/* 可穿戴装饰品列表 */}
      <div>
        <div className="mb-1 text-[10px] text-ink-muted">
          背包装饰品（{accessories.length}）
        </div>
        {accessories.length === 0 ? (
          <div className="text-[11px] text-ink-faint">
            背包中没有装饰品，去商店购买吧～
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {accessories.map((item) => {
              const isWorn = wornDecorations.some((w) => w.itemId === item.id)
              return (
                <button
                  key={item.id}
                  onClick={() => (isWorn ? handleRemove(selectedAnchor) : handleWear(item))}
                  className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-all ${
                    isWorn
                      ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
                      : 'border-ink/10 bg-surface text-ink hover:border-ink/30'
                  }`}
                  title={item.description}
                >
                  <span>{item.icon}</span>
                  <span>{item.name}</span>
                  {item.count > 1 && (
                    <span className="text-[9px] text-ink-muted">×{item.count}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
