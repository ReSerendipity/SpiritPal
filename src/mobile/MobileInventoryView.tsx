/**
 * 移动端背包子视图组件
 * @module mobile/MobileInventoryView
 * @description
 * 移动端背包界面：已拥有物品列表，消耗品一键{t('app.use')}，
 * 装饰品按 5 锚点穿戴/{t('inventory.remove')}，显示稀有度与数量。
 *
 * 数据与桌面端同源（petStore / foodEffectContract），视觉沿用语义 Token。
 *
 * @see {@link ./MobileNurturingView} 移动端养成视图（宿主）
 * @see {@link ../stores/petStore} 背包状态 Store
 */
import { useState } from 'react'
import { Backpack, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AnchorPoint, WornDecoration } from '@/lib/data/types'
import { getRarityDisplay } from '@/lib/nurture/foodEffectContract'
import { MobileCollectionView } from '@/mobile/MobileCollectionView'
import { usePetStore } from '@/stores/petStore'

/** 装饰品穿戴锚点 */
const ANCHOR_OPTIONS: { value: AnchorPoint; labelKey: string }[] = [
  { value: 'head', labelKey: 'anchor.head' },
  { value: 'body', labelKey: 'anchor.body' },
  { value: 'hand_left', labelKey: 'anchor.handLeft' },
  { value: 'hand_right', labelKey: 'anchor.handRight' },
  { value: 'back', labelKey: 'anchor.back' },
]

const EMPTY_DECORATIONS: WornDecoration[] = []

/** 背包子页类型 */
type SubTab = 'inventory' | 'collection'

/**
 * 移动端背包子视图
 * @returns 背包界面组件
 */
export function MobileInventoryView() {
  const { t } = useTranslation()
  const inventory = usePetStore((s) => s.inventory)
  const consumeItem = usePetStore((s) => s.useItem)
  const wornDecorations = usePetStore(
    (s) => s.wornDecorations[s.currentCharacterId] ?? EMPTY_DECORATIONS,
  )
  const wearDecoration = usePetStore((s) => s.wearDecoration)
  const removeDecoration = usePetStore((s) => s.removeDecoration)

  const [subTab, setSubTab] = useState<SubTab>('inventory')
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 1500)
  }

  function handleUse(itemId: string, name: string) {
    consumeItem(itemId)
    showToast(t('inventory.used', { name }))
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
  const subTabActiveClass = 'bg-tangerine text-white'
  const subTabInactiveClass = 'bg-cream-deep text-ink-muted'

  return (
    <div className="space-y-2">
      {/* 子页切换 */}
      <div className="flex gap-1">
        {([
          { id: 'inventory', labelKey: 'tab.inventory', icon: Backpack },
          { id: 'collection', labelKey: 'shop.collection', icon: Trophy },
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

      {/* 收藏子页 */}
      {subTab === 'collection' && <MobileCollectionView />}

      {/* 背包子页 */}
      {subTab === 'inventory' && (
        <>
          {inventory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Backpack size={48} className="mb-3 text-ink-faint opacity-40" />
              <p className="text-sm text-ink-faint">{t('inventory.empty')}</p>
              <p className={`mt-1 text-xs ${subTextClass}`}>{t('inventory.emptyHint')}</p>
            </div>
          ) : (
            inventory.map((item) => {
              const wornAnchor = getWornAnchor(item.id)
              const isAccessory = item.type === 'accessory'
              const rarity = item.fvLock !== undefined && item.fvLock > 0 ? getRarityDisplay(item.fvLock) : null
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 rounded-xl border ${cardBorderClass} ${cardBgClass} p-2.5`}
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
                      <span className="text-[10px] text-ink-faint">×{item.count}</span>
                    </div>
                    <div className={`mt-0.5 truncate text-[11px] ${subTextClass}`}>
                      {item.hungerRestore ? `${t('stat.hunger')}+${item.hungerRestore} ` : ''}
                      {item.moodRestore ? `${t('stat.mood')}+${item.moodRestore} ` : ''}
                      {item.healthRestore ? `${t('stat.health')}+${item.healthRestore}` : ''}
                      {wornAnchor && (
                        <span className="text-tangerine">
                          {' '}{t('inventory.wornAt', { anchor: t(ANCHOR_OPTIONS.find((a) => a.value === wornAnchor)?.labelKey ?? '') })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {isAccessory ? (
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
                    ) : (
                      <button
                        onClick={() => handleUse(item.id, item.name)}
                        className="rounded-lg bg-tangerine px-3 py-1 text-xs text-white"
                      >
                        {t('app.use')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </>
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink/85 px-4 py-1.5 text-xs text-white">
          {toast}
        </div>
      )}
    </div>
  )
}
