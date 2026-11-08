// batchOperationManager 撤销链路测试 — TD-003（批量回滚恒 undefined）
//
// 覆盖：① 不给回滚钩子时如实报 undoable=false（而不是返回一个假撤销）；
// ② 给了钩子时只撤销"真正成功"的项；③ toggle 的旧实现会把失败项也反向切换一遍（回归）；
// ④ undoLast 真的 await 异步撤销；⑤ 撤销抛错时保留历史项。
import { describe, it, expect, vi } from 'vitest'
import { BatchOperationManager, type BatchOperationResult } from '@/lib/data/batchOperationManager'

interface Fact {
  id: string
  key: string
  value: string
  tags: string[]
  confidence: number
  enabled: boolean
}

function makeStore(initial: Fact[]) {
  const rows = new Map<string, Fact>(initial.map((f) => [f.id, { ...f, tags: [...f.tags] }]))
  return {
    rows,
    get: (id: string) => rows.get(id),
    delete: async (id: string) => {
      rows.delete(id)
    },
    restore: async (item: Fact) => {
      rows.set(item.id, { ...item, tags: [...item.tags] })
    },
    setTags: async (id: string, tags: string[]) => {
      const row = rows.get(id)
      if (!row) throw new Error(`missing:${id}`)
      row.tags = [...tags]
    },
    readTags: (id: string) => {
      const row = rows.get(id)
      if (!row) throw new Error(`missing:${id}`)
      return [...row.tags]
    },
    patch: async (id: string, changes: Partial<Fact>) => {
      const row = rows.get(id)
      if (!row) throw new Error(`missing:${id}`)
      Object.assign(row, changes)
    },
    readConfidence: (id: string) => {
      const row = rows.get(id)
      if (!row) throw new Error(`missing:${id}`)
      return { confidence: row.confidence }
    },
    toggle: async (id: string, enabled: boolean) => {
      const row = rows.get(id)
      if (!row) throw new Error(`missing:${id}`)
      row.enabled = enabled
    },
    snapshot: (id: string) => {
      const row = rows.get(id)
      if (!row) throw new Error(`missing:${id}`)
      return { ...row, tags: [...row.tags] }
    },
  }
}

const seed: Fact[] = [
  { id: 'a', key: 'fact-a', value: 'A', tags: ['old'], confidence: 0.9, enabled: false },
  { id: 'b', key: 'fact-b', value: 'B', tags: ['old'], confidence: 0.8, enabled: false },
]

function selectAll(mgr: BatchOperationManager<Fact>, items: Fact[]) {
  mgr.updateItems(items)
  mgr.toggleSelectAll()
}

describe('batchOperationManager 撤销', () => {
  it('不给回滚钩子时如实报不可撤销，且历史项不被吞掉', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    const result = await mgr.bulkDelete(
      (f) => f.id,
      (id) => store.delete(id),
    )

    expect(result.success).toBe(true)
    expect(result.undoable).toBe(false)
    expect(result.undo).toBeUndefined()

    // 不可撤销 ⇒ undoLast 返回 false，但历史仍留着（不能被静默弹出）
    await expect(mgr.undoLast()).resolves.toBe(false)
    expect(mgr.getHistory()).toHaveLength(1)
    // 删除本身已生效
    expect(store.rows.size).toBe(0)
  })

  it('给 snapshot/restore 时只恢复真正删除成功的项', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    const result = await mgr.bulkDelete((f) => f.id, (id) => store.delete(id), {
      snapshot: (id) => store.snapshot(id),
      restore: (item) => store.restore(item),
    })

    expect(result.undoable).toBe(true)
    expect(store.rows.size).toBe(0)

    await expect(mgr.undoLast()).resolves.toBe(true)
    expect(store.rows.size).toBe(2)
    expect(store.get('a')?.value).toBe('A')
    expect(store.get('b')?.value).toBe('B')
    expect(mgr.getHistory()).toHaveLength(0)
  })

  it('部分失败时撤销不动失败项（失败项的现场已丢弃）', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    const deleteFn = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('locked')
      await store.delete(id)
    })
    const result = await mgr.bulkDelete((f) => f.id, deleteFn, {
      snapshot: (id) => store.snapshot(id),
      restore: (item) => store.restore(item),
    })

    expect(result.successCount).toBe(1)
    expect(result.failureCount).toBe(1)
    expect(store.rows.has('b')).toBe(true) // b 没被删掉

    // 撤销只把 a 写回来；b 本来就还在，且不会因为"撤销"被二次处理
    const restoreSpy = vi.spyOn(store, 'restore')
    await expect(mgr.undoLast()).resolves.toBe(true)
    expect(restoreSpy.mock.calls.map((c) => (c[0] as Fact).id)).toEqual(['a'])
    expect(store.rows.size).toBe(2)
  })

  it('撤销子集：只传成功的部分', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    const result = await mgr.bulkDelete((f) => f.id, (id) => store.delete(id), {
      snapshot: (id) => store.snapshot(id),
      restore: (item) => store.restore(item),
    })

    // 传入包含"未成功项"和"未知 ID"的子集，只有 a 会被恢复
    await Promise.resolve(result.undo?.(['a', 'zzz']))
    expect(store.rows.has('a')).toBe(true)
    expect(store.rows.has('b')).toBe(false)
  })

  it('标签撤销：把旧标签整组写回', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    const result = await mgr.bulkTag((id, tags) => store.setTags(id, tags), ['new'], {
      readTags: (id) => store.readTags(id),
    })

    expect(result.undoable).toBe(true)
    expect(store.get('a')?.tags).toEqual(['new'])

    await expect(mgr.undoLast()).resolves.toBe(true)
    expect(store.get('a')?.tags).toEqual(['old'])
    expect(store.get('b')?.tags).toEqual(['old'])
  })

  it('toggle 撤销只翻成功项（回归：旧实现把失败项也反向切换）', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    const enabledCalls: Array<[string, boolean]> = []
    const toggleFn = vi.fn(async (id: string, enabled: boolean) => {
      enabledCalls.push([id, enabled])
      if (id === 'b') throw new Error('locked')
      await store.toggle(id, enabled)
    })

    const result = await mgr.bulkToggle(toggleFn, true)
    expect(result.successCount).toBe(1)
    expect(store.get('a')?.enabled).toBe(true)
    expect(store.get('b')?.enabled).toBe(false)

    enabledCalls.length = 0
    await expect(mgr.undoLast()).resolves.toBe(true)
    expect(enabledCalls).toEqual([['a', false]]) // 只有 a，b 一次都没被碰
    expect(store.get('a')?.enabled).toBe(false)
    expect(store.get('b')?.enabled).toBe(false)
  })

  it('修改撤销：用同一把 modifyFn 把旧值写回', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    const result = await mgr.bulkModify((id, changes: { confidence: number }) => store.patch(id, changes), {
      confidence: 0.5,
    }, {
      readPrevious: (id) => store.readConfidence(id),
    })

    expect(result.undoable).toBe(true)
    expect(store.get('a')?.confidence).toBe(0.5)

    await expect(mgr.undoLast()).resolves.toBe(true)
    expect(store.get('a')?.confidence).toBe(0.9)
    expect(store.get('b')?.confidence).toBe(0.8)
  })

  it('undoLast 真的 await 异步撤销（不在恢复完成前返回 true）', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    await mgr.bulkDelete((f) => f.id, (id) => store.delete(id), {
      snapshot: (id) => store.snapshot(id),
      restore: async (item) => {
        await gate
        await store.restore(item)
      },
    })

    const pending = mgr.undoLast()
    // 放行前：恢复还没发生
    await Promise.resolve()
    expect(store.rows.size).toBe(0)
    release()
    await expect(pending).resolves.toBe(true)
    expect(store.rows.size).toBe(2)
  })

  it('撤销抛错时返回 false 且历史项保留', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)

    await mgr.bulkDelete((f) => f.id, (id) => store.delete(id), {
      snapshot: (id) => store.snapshot(id),
      restore: async () => {
        throw new Error('restore failed')
      },
    })

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(mgr.undoLast()).resolves.toBe(false)
    expect(mgr.getHistory()).toHaveLength(1)
    spy.mockRestore()
  })

  it('自定义操作的撤销由调用方给出；不给则不可撤销', async () => {
    const store = makeStore(seed)
    const mgr = new BatchOperationManager<Fact>(seed)
    selectAll(mgr, seed)
    const customFn = vi.fn(async (id: string) => {
      await store.toggle(id, false)
    })

    const noUndo = await mgr.bulkCustom('disable', customFn, {})
    expect(noUndo.undoable).toBe(false)

    // 全量成功后管理器会 clearSelection（既有行为），第二次操作前要重新选中
    selectAll(mgr, seed)
    const withUndo: BatchOperationResult = await mgr.bulkCustom('disable-2', customFn, {}, {
      makeUndo: () => async (ids) => {
        for (const id of ids) {
          await store.toggle(id, true)
        }
      },
    })
    expect(withUndo.undoable).toBe(true)
    await expect(mgr.undoLast()).resolves.toBe(true)
    expect(store.get('a')?.enabled).toBe(true)
  })
})
