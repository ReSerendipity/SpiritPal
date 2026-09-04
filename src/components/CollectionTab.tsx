/**
 * 收藏面板 — 展示收藏套件进度，支持装备/卸下、领取完成奖励
 */
import { useCollections } from '@/hooks/useCollections'
import { ITEM_DATABASE } from '@/lib/nurture/items'

export function CollectionTab() {
  const { sets, overallPercentage, equip, unequip, claimReward } = useCollections()

  const itemMeta = (itemId: string) => {
    const item = ITEM_DATABASE[itemId]
    return { name: item?.name ?? itemId.replace(/^col-/, ''), icon: item?.icon ?? '🎁' }
  }

  return (
    <div className="relative w-full rounded-xl bg-surface/95 p-3 text-white shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">🏆 收藏</span>
        <span className="text-xs text-ink-muted">总进度 {overallPercentage}%</span>
      </div>

      {sets.length === 0 ? (
        <div className="py-8 text-center text-sm text-ink-muted">暂无收藏套件</div>
      ) : (
        <div className="grid max-h-80 grid-cols-1 gap-3 overflow-y-auto pr-1">
          {sets.map((set) => (
            <div key={set.setId} className="rounded-lg bg-cream-deep/60 p-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{set.icon}</span>
                  <div>
                    <div className="text-sm font-medium">{set.name}</div>
                    <div className="text-[11px] text-ink-muted">
                      {set.collectedCount}/{set.totalCount}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {set.completed ? (
                    set.rewardClaimed ? (
                      <span className="rounded bg-emerald-600/70 px-2 py-1 text-[10px]">已领取</span>
                    ) : (
                      <button
                        onClick={() => claimReward(set.setId)}
                        className="rounded bg-amber-500 px-2 py-1 text-[11px] font-semibold hover:bg-amber-400"
                      >
                        领取奖励
                      </button>
                    )
                  ) : (
                    <span className="rounded bg-ink-faint px-2 py-1 text-[10px]">{set.percentage}%</span>
                  )}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {set.items.map((item) => {
                  const meta = itemMeta(item.itemId)
                  return (
                    <div
                      key={item.itemId}
                      className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] ${
                        item.collected ? 'bg-ink-faint' : 'bg-black/30 opacity-50'
                      }`}
                    >
                      <span>{meta.icon}</span>
                      <span className="truncate">{meta.name}</span>
                      {item.collected &&
                        (item.equipped ? (
                          <button
                            onClick={() => unequip(item.itemId)}
                            className="rounded bg-blue-600 px-1 text-[10px] hover:bg-blue-500"
                          >
                            卸下
                          </button>
                        ) : (
                          <button
                            onClick={() => equip(item.itemId)}
                            className="rounded bg-sky-600 px-1 text-[10px] hover:bg-sky-500"
                          >
                            装备
                          </button>
                        ))}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}