import { renderHook, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useCollections } from '@/hooks/useCollections'
import { getCollectionManager, resetCollectionManager } from '@/lib/data/collectionManager'
import { usePetStore } from '@/stores/petStore'

beforeEach(() => {
  localStorage.clear()
  resetCollectionManager()
  usePetStore.setState({
    inventory: [],
    currentCharacterId: 'doro',
    sharedCoins: 0,
  })
})

afterEach(() => {
  cleanup()
})

describe('CollectionManager 核心逻辑', () => {
  it('收集集齐 col-star 后完成 set-stars 并返回完成标记', () => {
    const mgr = getCollectionManager()
    expect(mgr.getProgress('set-stars')?.completed).toBe(false)
    const done = mgr.collectItem('col-star')
    expect(done).toBe(true)
    expect(mgr.getProgress('set-stars')?.completed).toBe(true)
  })

  it('claimReward 在未完成/已领取时空返回 null', () => {
    const mgr = getCollectionManager()
    // 未完成
    expect(mgr.claimReward('set-stars')).toBeNull()
  })

  it('装备/卸下收藏品由 inUseItems 反映', () => {
    const mgr = getCollectionManager()
    mgr.collectItem('col-star')
    expect(mgr.equipItem('col-star')).toBe(true)
    expect(mgr.isItemInUse('col-star')).toBe(true)
    mgr.unequipItem('col-star')
    expect(mgr.isItemInUse('col-star')).toBe(false)
  })

  it('serialize/deserialize 保持奖励与装备状态', () => {
    const mgr = getCollectionManager()
    mgr.collectItem('col-star')
    mgr.collectItem('col-gem')
    mgr.collectItem('col-medal')
    mgr.claimReward('set-gems')
    const data = mgr.serialize()
    expect(Array.isArray(data)).toBe(true)
    // 反序列化到新实例后仍能查询进度
    resetCollectionManager()
    const mgr2 = getCollectionManager()
    mgr2.deserialize(data)
    expect(mgr2.getProgress('set-gems')?.completed).toBe(true)
  })
})

describe('useCollections hook', () => {
  it('空背包返回 4 个套件、总进度 0、均不可领取', () => {
    const { result } = renderHook(() => useCollections())
    expect(result.current.sets).toHaveLength(4)
    expect(result.current.overallPercentage).toBe(0)
    expect(result.current.sets.every((s) => s.collectedCount === 0)).toBe(true)
    expect(result.current.sets.every((s) => !s.claimable)).toBe(true)
  })

  it('Bag 中已有 col-star 时，star 套件收集计数为 1', () => {
    usePetStore.setState({ inventory: [{ id: 'col-star', type: 'collection', name: '星星', icon: '⭐', price: 0, count: 1, maxQuantity: 1 }] })
    const { result } = renderHook(() => useCollections())
    const star = result.current.sets.find((s) => s.setId === 'set-stars')
    expect(star).toBeTruthy()
    expect(star?.collectedCount).toBe(1)
  })
})