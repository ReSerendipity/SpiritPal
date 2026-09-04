/**
 * 记忆后台集成 — 把 entityGraph(实体图/PPR) 与 dreamingConsolidation(离线做梦)
 * 接入应用的生产链路。
 *
 * 原状态：两者均为自洽模块但从未被调用（仅单测引用），属"骨架"。
 * 本模块负责：
 *  - 初始化实体图表 + 从现有记忆重建实体图（initEntityGraphTables + buildEntityGraphFromMemories）
 *  - 启动做梦调度器（后台空闲/夜间语义巩固）
 * 幂等：同一角色只启动一次；stopMemoryBackground 可重置。
 */
import { usePetStore } from '@/stores/petStore'
import { startDreamingScheduler, stopDreamingScheduler } from './dreamingConsolidation'
import { getEnhancedMemoryManager } from './enhancedMemory'
import { initEntityGraphTables, buildEntityGraphFromMemories } from './entityGraph'
import { getMemorySummarizer } from './memorySummarizer'

let started = false
let activeCharacter = ''

/**
 * 初始化记忆后台任务（幂等）
 * @param characterId 缺省时取当前角色。
 */
export async function initMemoryBackground(characterId?: string): Promise<void> {
  const target = characterId ?? usePetStore.getState().currentCharacterId
  if (!target) return
  if (started && activeCharacter === target) return
  started = true
  activeCharacter = target
  try {
    const mgr = getEnhancedMemoryManager(target)
    await mgr.ensureLoaded()
    // 实体图：建表 + 从现有记忆重建
    await initEntityGraphTables()
    await buildEntityGraphFromMemories(mgr.getAllMemories())
    // 做梦调度器：空闲/夜间触发语义巩固
    startDreamingScheduler(mgr)
    // A-11：基于长期记忆生成时间线摘要（记忆巩固），非阻塞、非致命
    void getMemorySummarizer()
      .generateTimelineSummary(mgr.getAllMemories(), 'day')
      .catch((err) => console.warn('[memoryBackground] summarize failed (non-fatal):', err))
  } catch (err) {
    // 非致命：后台任务失败不影响应用主体
    console.warn('[memoryBackground] init failed (non-fatal):', err)
  }
}

/**
 * 手动触发实体图重建（可周期调用，保持图与新增记忆同步）
 */
export async function refreshEntityGraph(characterId?: string): Promise<void> {
  const target = characterId ?? usePetStore.getState().currentCharacterId
  if (!target) return
  try {
    const mgr = getEnhancedMemoryManager(target)
    await mgr.ensureLoaded()
    await initEntityGraphTables()
    await buildEntityGraphFromMemories(mgr.getAllMemories())
  } catch (err) {
    console.warn('[memoryBackground] refreshEntityGraph failed (non-fatal):', err)
  }
}

/**
 * 停止记忆后台任务（切换/退出时调用）
 */
export function stopMemoryBackground(): void {
  started = false
  activeCharacter = ''
  stopDreamingScheduler()
}