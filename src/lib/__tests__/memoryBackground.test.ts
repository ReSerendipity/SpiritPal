import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePetStore } from '../../stores/petStore'

const ensureLoaded = vi.fn().mockResolvedValue(undefined)
const getAllMemories = vi.fn(() => [{ id: 'm1' }, { id: 'm2' }])
const initTables = vi.fn().mockResolvedValue(undefined)
const buildGraph = vi.fn().mockResolvedValue(undefined)
const startScheduler = vi.fn()
const stopScheduler = vi.fn()

vi.mock('../entityGraph', () => ({
  initEntityGraphTables: (...a: unknown[]) => initTables(...a),
  buildEntityGraphFromMemories: (...a: unknown[]) => buildGraph(...a),
}))
vi.mock('../dreamingConsolidation', () => ({
  startDreamingScheduler: (...a: unknown[]) => startScheduler(...a),
  stopDreamingScheduler: () => stopScheduler(),
}))
vi.mock('../enhancedMemory', () => ({
  getEnhancedMemoryManager: () => ({ ensureLoaded, getAllMemories }),
}))

// 必须延迟引入被测模块（等 mock 注册）
const { initMemoryBackground, refreshEntityGraph, stopMemoryBackground } = await import('../memoryBackground')

beforeEach(() => {
  vi.clearAllMocks()
  usePetStore.setState({ currentCharacterId: 'doro' })
})

afterEach(() => {
  stopMemoryBackground()
})

describe('memoryBackground', () => {
  it('init 会初始化实体图、重建图并启动做梦调度器', async () => {
    await initMemoryBackground('doro')
    expect(ensureLoaded).toHaveBeenCalledTimes(1)
    expect(initTables).toHaveBeenCalledTimes(1)
    expect(buildGraph).toHaveBeenCalledTimes(1)
    expect(startScheduler).toHaveBeenCalledTimes(1)
  })

  it('同角色重复 init 幂等，不重复建图/启动', async () => {
    await initMemoryBackground('doro')
    await initMemoryBackground('doro')
    expect(initTables).toHaveBeenCalledTimes(1)
    expect(startScheduler).toHaveBeenCalledTimes(1)
  })

  it('refreshEntityGraph 触发重建，不重复启动调度器', async () => {
    await initMemoryBackground('doro')
    const before = startScheduler.mock.calls.length
    await refreshEntityGraph('doro')
    expect(buildGraph.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(startScheduler.mock.calls.length).toBe(before)
  })

  it('stopMemoryBackground 可重置幂等状态（再次可启动）', async () => {
    await initMemoryBackground('doro')
    stopMemoryBackground()
    expect(stopScheduler).toHaveBeenCalled()
    await initMemoryBackground('doro')
    expect(startScheduler).toHaveBeenCalledTimes(2)
  })
})