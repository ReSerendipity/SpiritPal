/**
 * 移动端收藏子视图组件
 * @module mobile/MobileCollectionView
 * @description
 * 移动端收藏界面：展示收藏套件收集进度，支持装备/卸下收藏物品、
 * 领取完成奖励。数据与桌面端同源（useCollections / collectionManager），
 * 视觉沿用语义 Token。
 *
 * @see {@link ./MobileInventoryView} 移动端背包视图（宿主）
 * @see {@link ../hooks/useCollections} 收藏系统 Hook
 */
import { useCollections } from '@/hooks/useCollections'
import { ITEM_DATABASE } from '@/lib/nurture/items'

/**
 * 移动端收藏子视图
 * @returns 收藏界面组件
 */
export function MobileCollectionView() {
  const { sets, overallPercentage, equip, unequip, claimReward } = useCollections()

  const itemMeta = (itemId: string) => {
    const item = ITEM_DATABASE[itemId]
    return { name: item?.name ?? itemId.replace(/^col-/, ''), icon: item?.icon ?? '🎁' }
  }

  // 主题样式类（与移动端其他视图一致的语义 Token 配色）
  const cardBgClass = 'bg-surface'
  const cardBorderClass = 'border-ink/10'
  const subTextClass = 'text-ink-muted'

  return (
    <div className="space-y-2">
      {sets.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-faint">暂无收藏套件</div>
      ) : (
        sets.map((set) => (
          <div key={set.setId} className={`rounded-xl border ${cardBorderClass} ${cardBgClass} p-3`}>
            {/* 套件头：图标 + 名称 + 进度 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{set.icon}</span>
                <div>
                  <div className="text-sm font-medium text-ink">{set.name}</div>
                  <div className={`text-[11px] ${subTextClass}`}>
                    {set.collectedCount}/{set.totalCount}
                  </div>
                </div>
              </div>
              <div className="text-right">
                {set.completed ? (
                  set.rewardClaimed ? (
                    <span className="rounded-lg bg-success/20 px-2 py-1 text-[10px] text-success-deep">
                      已领取
                    </span>
                  ) : (
                    <button
                      onClick={() => claimReward(set.setId)}
                      className="rounded-lg bg-tangerine px-2.5 py-1 text-[11px] font-medium text-white"
                    >
                      领取奖励
                    </button>
                  )
                ) : (
                  <span className={`text-[11px] ${subTextClass}`}>{set.percentage}%</span>
                )}
              </div>
            </div>

            {/* 描述 */}
            {set.description && (
              <div className={`mt-1.5 text-[11px] ${subTextClass}`}>{set.description}</div>
            )}

            {/* 物品列表 */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {set.items.map((item) => {
                const meta = itemMeta(item.itemId)
                return (
                  <div
                    key={item.itemId}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] ${
                      item.collected ? 'bg-cream-deep text-ink' : 'bg-ink/5 text-ink-faint opacity-60'
                    }`}
                  >
                    <span>{item.collected ? meta.icon : '🔒'}</span>
                    <span className="truncate">{meta.name}</span>
                    {item.collected &&
                      (item.equipped ? (
                        <button
                          onClick={() => unequip(item.itemId)}
                          className="ml-0.5 rounded bg-tangerine-deep/20 px-1 text-[10px] text-tangerine-deep"
                        >
                          卸下
                        </button>
                      ) : (
                        <button
                          onClick={() => equip(item.itemId)}
                          className="ml-0.5 rounded bg-tangerine px-1 text-[10px] text-white"
                        >
                          装备
                        </button>
                      ))}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {/* 总进度 */}
      {sets.length > 0 && (
        <div className={`rounded-xl border ${cardBorderClass} ${cardBgClass} p-3`}>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-ink">收藏总进度</span>
            <span className="font-semibold text-tangerine tabular-nums">{overallPercentage}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-deep">
            <div
              className="h-full rounded-full bg-tangerine transition-all"
              style={{ width: `${overallPercentage}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
