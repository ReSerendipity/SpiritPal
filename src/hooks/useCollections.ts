/**
 * 收藏系统 Hook — 启用 CollectionManager 并接入背包/持久化/奖励
 *
 * 数据一致性：以背包 inventory 为「已收集」的事实来源，每次 inventory 变化时同步到 CollectionManager；
 * equip(装备)、claimReward(领奖) 状态通过 localStorage 持久化（含 rewardClaimed / inUseItems）。
 * 奖励发放：金币走 petStore.addCoins，亲密度走 petStore stats 更新。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCollectionManager, type CollectionSet, DEFAULT_COLLECTION_SETS } from '@/lib/data/collectionManager'
import { usePetStore } from '@/stores/petStore'

const STORAGE_KEY = 'spiritpal:collections'

export interface CollectionItemView {
  itemId: string
  name: string
  icon: string
  collected: boolean
  equipped: boolean
  equippedImpossible: boolean // 未收集或前置未满足
}

export interface CollectionSetView {
  setId: string
  name: string
  description: string
  icon: string
  collectedCount: number
  totalCount: number
  percentage: number
  completed: boolean
  rewardClaimed: boolean
  claimable: boolean
  items: CollectionItemView[]
}

function loadPersisted(viewByKey: string): {
  collected: string[]
  equipped: string[]
  claimed: string[]
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { collected: [], equipped: [], claimed: [] }
    const all = JSON.parse(raw)
    return all[viewByKey] ?? { collected: [], equipped: [], claimed: [] }
  } catch {
    return { collected: [], equipped: [], claimed: [] }
  }
}

function savePersisted(
  viewByKey: string,
  state: { collected: string[]; equipped: string[]; claimed: string[] },
): void {
  try {
    let all: Record<string, unknown> = {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) all = JSON.parse(raw)
    all[viewByKey] = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* 忽略存储失败 */
  }
}

function applyReward(set: CollectionSet): void {
  const store = usePetStore.getState()
  const coins = set.bonusRewards?.coins ?? 0
  if (coins > 0) store.addCoins(coins)
  if (set.fvReward > 0) {
    const characterId = store.currentCharacterId
    const cur = store.getCurrentStats()
    usePetStore.setState((s) => ({
      stats: {
        ...s.stats,
        [characterId]: {
          ...cur,
          affection: Math.min(9999, cur.affection + set.fvReward),
          lastInteractionAt: Date.now(),
        },
      },
    }))
  }
}

export function useCollections(): {
  sets: CollectionSetView[]
  overallPercentage: number
  equip: (itemId: string) => void
  unequip: (itemId: string) => void
  claimReward: (setId: string) => void
} {
  const characterId = usePetStore((s) => s.currentCharacterId)
  const inventory = usePetStore((s) => s.inventory)
  const viewByKey = `char:${characterId}`

  const [persisted, setPersisted] = useState(() => loadPersisted(viewByKey))

  // 背包中的收藏品 id（派生）
  const presentIds = useMemo(
    () => inventory.filter((i) => i.type === 'collection').map((i) => i.id),
    [inventory],
  )

  // 有效已收集 = 持久化 collected ∪ 背包现存收藏品（渲染期派生，立即反映背包状态，
  // 不依赖 effect 同步时序；持久化写入由下方 effect 延后完成）
  const effectiveCollected = useMemo(
    () => Array.from(new Set([...persisted.collected, ...presentIds])),
    [persisted.collected, presentIds],
  )

  // 单例初始化 + 按角色恢复（仅一次）
  useEffect(() => {
    const mgr = getCollectionManager()
    const p = loadPersisted(viewByKey)
    mgr.deserialize([
      {
        setId: 'set-stars',
        collectedItems: p.collected,
        completed: false,
        rewardClaimed: p.claimed.includes('set-stars'),
        inUseItems: p.equipped,
      },
      {
        setId: 'set-gems',
        collectedItems: p.collected,
        completed: false,
        rewardClaimed: p.claimed.includes('set-gems'),
        inUseItems: p.equipped,
      },
      {
        setId: 'set-medals',
        collectedItems: p.collected,
        completed: false,
        rewardClaimed: p.claimed.includes('set-medals'),
        inUseItems: p.equipped,
      },
      {
        setId: 'set-master',
        collectedItems: p.collected,
        completed: false,
        rewardClaimed: p.claimed.includes('set-master'),
        inUseItems: p.equipped,
      },
    ])
  }, [viewByKey])

  // 以背包为准同步「已收集」到持久化（展示已由 effectiveCollected 派生；此处仅补 manager 状态与落盘）
  useEffect(() => {
    const mgr = getCollectionManager()
    const present = new Set(presentIds)
    for (const id of present) mgr.collectItem(id)
    // 背包中已不存在的收藏品：仅撤销后再从持久化 collected 计算（此项目前不主动 removeItem，避免误删已领取奖励）
    // 同步 setState 会触发级联渲染（react-hooks 规则），延后到微任务执行，语义不变
    const task = window.setTimeout(() => {
      setPersisted((prev) => {
        const collected = Array.from(
          new Set([...prev.collected, ...Array.from(present)]),
        )
        const next = { ...prev, collected }
        savePersisted(viewByKey, next)
        return next
      })
    }, 0)
    return () => window.clearTimeout(task)
  }, [presentIds, viewByKey])

  // 由持久化 + manager 计算展示视图
  const sets: CollectionSetView[] = DEFAULT_COLLECTION_SETS.map((set) => {
    const setStateCollected = set.itemIds.filter((id) => effectiveCollected.includes(id))
    const completed = set.itemIds.every((id) => setStateCollected.includes(id))
    const rewardClaimed = persisted.claimed.includes(set.id)
    return {
      setId: set.id,
      name: set.name,
      description: set.description,
      icon: set.icon,
      collectedCount: setStateCollected.length,
      totalCount: set.itemIds.length,
      percentage: Math.round((setStateCollected.length / set.itemIds.length) * 100),
      completed,
      rewardClaimed,
      claimable: completed && !rewardClaimed,
      items: set.itemIds.map((itemId) => ({
        itemId,
        name: itemId,
        icon: '🎁',
        collected: setStateCollected.includes(itemId),
        equipped: persisted.equipped.includes(itemId),
        equippedImpossible: !setStateCollected.includes(itemId),
      })),
    }
  })

  const overallPercentage = Math.round(
    (sets.reduce((acc, s) => acc + s.collectedCount, 0) /
      sets.reduce((acc, s) => acc + s.totalCount, 0) || 0) * 100,
  )

  const persist = useCallback(
    (updater: (prev: { collected: string[]; equipped: string[]; claimed: string[] }) => { collected: string[]; equipped: string[]; claimed: string[] }) => {
      setPersisted((prev) => {
        const next = updater(prev)
        savePersisted(viewByKey, next)
        return next
      })
    },
    [viewByKey],
  )

  const equip = useCallback(
    (itemId: string) => {
      getCollectionManager().equipItem(itemId)
      persist((prev) => ({ ...prev, equipped: Array.from(new Set([...prev.equipped, itemId])) }))
    },
    [persist],
  )

  const unequip = useCallback(
    (itemId: string) => {
      getCollectionManager().unequipItem(itemId)
      persist((prev) => ({ ...prev, equipped: prev.equipped.filter((id) => id !== itemId) }))
    },
    [persist],
  )

  const claimReward = useCallback(
    (setId: string) => {
      const set = DEFAULT_COLLECTION_SETS.find((s) => s.id === setId)
      if (!set) return
      const result = getCollectionManager().claimReward(setId)
      if (!result) return
      applyReward(set)
      persist((prev) => ({ ...prev, claimed: Array.from(new Set([...prev.claimed, setId])) }))
    },
    [persist],
  )

  return { sets, overallPercentage, equip, unequip, claimReward }
}