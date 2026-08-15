/**
 * 数据管理器 — 配置文件导入/导出、全量数据备份/恢复、存档延迟恢复
 * PRD Phase 3: 配置文件导入/导出
 *
 * @fileoverview
 * 主要模块：
 * - AppExportData 接口：导出数据结构（版本/设置/AI配置/宠物数据/背包/记忆/模组/成就）
 * - DataManager 类：数据管理器，支持导出/导入/备份/恢复/存档延迟恢复
 * - 存档延迟恢复常量（STRENGTH_CONVERSION_RATE = 0.1）
 *
 * 导出格式：JSON 文件包含：
 * - 应用设置 (settings)
 * - AI 配置 (aiConfig)
 * - 宠物养成数据 (petStats per character)
 * - 背包数据 (inventory)
 * - 记忆数据 (per character)
 * - 模组数据 (installed mods)
 * - 成就数据 (achievements)
 *
 * [REFACTOR] R3 - 修复数据源不一致 Bug：双读双写策略（SQLite 优先 + localStorage fallback）
 *
 * 存档延迟恢复（参考 VPet StoreStrength 机制）：
 *   - StoreStrength / StoreStrengthFood 分离存储
 *   - 离线恢复时，1/10 比例逐渐转换存储强度到实际数值
 *   - 防止长时间离线后瞬间满血恢复
 *
 * @module dataManager
 * @requires ./modManager - 模组管理器
 * @requires ./enhancedMemory - 增强记忆管理器
 * @requires ./achievementSystem - 成就管理器
 * @requires ./characters - 角色定义
 * @requires ./db - SQLite 持久化
 * @requires ./types - 类型定义
 */

import { getModManager } from './modManager'
import { CHARACTERS } from './characters'
import { getSetting, setSetting, getDb } from './db'
import type { AppSettings, AIConfig, NurturingStats, InventoryItem } from './types'

// ============ 导出数据结构 ============

export interface AppExportData {
  version: string
  exportedAt: string
  appVersion: string
  /** T-11: 本次导出包含的数据项清单（GDPR 知情权：让用户知道备份文件里有哪些个人数据） */
  exportedItems?: string[]
  settings?: AppSettings
  aiConfig?: AIConfig
  petStats?: Record<string, NurturingStats>
  inventory?: InventoryItem[]
  memories?: Record<string, unknown>
  enhancedMemories?: Record<string, unknown>
  achievements?: unknown
  mods?: unknown
}

const APP_VERSION = '0.1.0'
const EXPORT_VERSION = '1.0'

// ============ 存档延迟恢复常量（参考 VPet StoreStrength 机制）============
// 转换率：每次恢复时从存储强度中转换的比例
// 0.1 表示每次恢复 10% 的存储强度，防止瞬间满血恢复
const STRENGTH_CONVERSION_RATE = 0.1

// ============ 存储读写辅助函数 ============
// [REFACTOR] R3 - I3 修复：petStore 和记忆数据通过 SQLite 读写
// 问题：petStore 使用 sqliteStorage（SQLite），但 dataManager 直接操作 localStorage
//       导致迁移后 localStorage 被清除，importAll/exportAll 读不到数据
// 方案：双读策略 — 优先读 SQLite，fallback 到 localStorage（兼容测试环境和未迁移数据）
//       双写策略 — 同时写 SQLite 和 localStorage（确保两种存储方式都能读到）

/**
 * 读取 store 数据（SQLite 优先，localStorage fallback）
 * [OPTIMIZE] I3 - 修复 petStore 数据源不一致 Bug
 */
async function readStoreData(key: string): Promise<string | null> {
  // 优先尝试 SQLite（生产环境：petStore 使用 sqliteStorage）
  try {
    const value = await getSetting(key)
    if (value !== null) return value
  } catch (e) {
    // [OPTIMIZE] E1 - 记录错误日志，便于排查 SQLite 读取失败
    console.warn(`[DataManager] SQLite 读取失败 ${key}，回退到 localStorage:`, e)
  }
  // Fallback: localStorage（测试环境或未迁移数据）
  return localStorage.getItem(key)
}

/**
 * 写入 store 数据（双写 SQLite + localStorage）
 * [OPTIMIZE] I3 - 确保数据同时写入两种存储，兼容所有 store 配置
 */
async function writeStoreData(key: string, value: string): Promise<void> {
  // 写入 SQLite（生产环境：petStore 从 SQLite 读取）
  try {
    await setSetting(key, value)
  } catch (e) {
    // [OPTIMIZE] E1 - 记录错误日志，避免静默吞错
    console.warn(`[DataManager] SQLite 写入失败 ${key}，仅写入 localStorage:`, e)
  }
  // 同时写入 localStorage（兼容 settingsStore/chatStore/aiConfig 和测试环境）
  localStorage.setItem(key, value)
}

// ============ 数据管理器 ============

export class DataManager {
  private static instance: DataManager | null = null

  static getInstance(): DataManager {
    if (!DataManager.instance) {
      DataManager.instance = new DataManager()
    }
    return DataManager.instance
  }

  static resetInstance(): void {
    DataManager.instance = null
  }

  dispose(): void {
    DataManager.resetInstance()
  }

  // ============ 导出全部数据 ============

  async exportAll(): Promise<string> {
    const data: AppExportData = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      // T-11: 导出内容清单（GDPR 知情权）——下方按实际导出项填充
      exportedItems: [],
    }

    // 应用设置（settingsStore 使用 localStorage）
    try {
      const settingsRaw = localStorage.getItem('spiritpal-settings-store')
      if (settingsRaw) {
        const parsed = JSON.parse(settingsRaw)
        data.settings = { ...parsed.state }
        data.exportedItems?.push('应用设置')
      }
    } catch (e) {
      // [OPTIMIZE] E1 - 记录错误日志
      console.warn('[DataManager] 导出应用设置失败:', e)
    }

    // AI 配置（[Tauri Review] 不导出 API Key 明文，仅导出 provider 等非敏感配置）
    try {
      const aiRaw = localStorage.getItem('spiritpal-ai-config')
      if (aiRaw) {
        const config = JSON.parse(aiRaw)
        // [Tauri Review] 剥离 apiKey 字段，防止导出文件泄露密钥
        const { apiKey: _stripped, ...safeConfig } = config
        void _stripped
        data.aiConfig = safeConfig
        data.exportedItems?.push('AI 模型配置（不含 API Key）')
      }
    } catch (e) {
      console.warn('[DataManager] 导出 AI 配置失败:', e)
    }

    // 宠物养成数据（petStore 使用 SQLite — 双读策略）
    // [OPTIMIZE] I3 - 修复数据源：改为 readStoreData（SQLite 优先 + localStorage fallback）
    try {
      const petRaw = await readStoreData('spiritpal-pet-store')
      if (petRaw) {
        const parsed = JSON.parse(petRaw)
        data.petStats = parsed.state?.stats
        data.inventory = parsed.state?.inventory
        if (parsed.state?.stats) data.exportedItems?.push('宠物养成数据')
        if (parsed.state?.inventory) data.exportedItems?.push('背包物品')
      }
    } catch (e) {
      console.warn('[DataManager] 导出宠物养成数据失败:', e)
    }

    // 记忆数据（每个角色 — enhancedMemory 使用 SQLite）
    // [OPTIMIZE] I3 - 修复数据源：记忆数据通过 readStoreData 读取
    const memories: Record<string, unknown> = {}
    const enhancedMemories: Record<string, unknown> = {}
    for (const char of CHARACTERS) {
      try {
        const memRaw = await readStoreData(`spiritpal-memory-${char.id}`)
        if (memRaw) memories[char.id] = JSON.parse(memRaw)
        const enhancedRaw = await readStoreData(`spiritpal-enhanced-memory-${char.id}`)
        if (enhancedRaw) enhancedMemories[char.id] = JSON.parse(enhancedRaw)
      } catch (e) {
        console.warn(`[DataManager] 导出角色 ${char.id} 记忆数据失败:`, e)
      }
    }
    data.memories = memories
    data.enhancedMemories = enhancedMemories
    if (Object.keys(memories).length > 0 || Object.keys(enhancedMemories).length > 0) {
      data.exportedItems?.push(`记忆与对话历史（${Object.keys(enhancedMemories).length + Object.keys(memories).length} 个角色）`)
    }

    // 成就数据
    try {
      const achRaw = localStorage.getItem('spiritpal-achievements')
      if (achRaw) data.achievements = JSON.parse(achRaw)
      if (data.achievements) data.exportedItems?.push('成就数据')
    } catch (e) {
      console.warn('[DataManager] 导出成就数据失败:', e)
    }

    // 模组数据
    try {
      const modMgr = getModManager()
      data.mods = modMgr.getMods()
      if (data.mods && (data.mods as unknown[]).length > 0) {
        data.exportedItems?.push(`模组配置（${(data.mods as unknown[]).length} 个）`)
      }
    } catch (e) {
      console.warn('[DataManager] 导出模组数据失败:', e)
    }

    return JSON.stringify(data, null, 2)
  }

  // 导出为文件
  async exportToFile(): Promise<void> {
    const json = await this.exportAll()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spiritpal-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ============ 导入全部数据 ============

  async importAll(jsonStr: string): Promise<{ success: boolean; message: string }> {
    try {
      const data = JSON.parse(jsonStr) as AppExportData
      if (!data.version) {
        return { success: false, message: '无效的备份文件：缺少版本信息' }
      }

      let restoredCount = 0

      // 导入应用设置（settingsStore 使用 localStorage）
      if (data.settings) {
        try {
          const existing = localStorage.getItem('spiritpal-settings-store')
          const parsed = existing ? JSON.parse(existing) : { state: {}, version: 0 }
          parsed.state = { ...parsed.state, ...data.settings }
          localStorage.setItem('spiritpal-settings-store', JSON.stringify(parsed))
          restoredCount++
        } catch (e) {
          // [OPTIMIZE] E1 - 记录错误日志
          console.warn('[DataManager] 导入应用设置失败:', e)
        }
      }

      // 导入 AI 配置（[Tauri Review] 不从备份文件导入 API Key，提示用户重新配置）
      if (data.aiConfig) {
        const { apiKey: _k, ...rest } = data.aiConfig
        void _k
        localStorage.setItem('spiritpal-ai-config', JSON.stringify(rest))
        // [Tauri Review] 如果备份文件中包含 apiKey，警告用户但不自动导入
        if (_k) {
          console.warn('[DataManager] 备份文件包含 API Key，已跳过导入。请手动配置 API Key。')
        }
        restoredCount++
      }

      // 导入宠物养成数据（petStore 使用 SQLite — 双写策略）
      // [OPTIMIZE] I3 - 修复数据源：改为 writeStoreData（同时写 SQLite + localStorage）
      if (data.petStats || data.inventory) {
        try {
          const existing = await readStoreData('spiritpal-pet-store')
          const parsed = existing ? JSON.parse(existing) : { state: {}, version: 0 }
          if (data.petStats) parsed.state.stats = data.petStats
          if (data.inventory) parsed.state.inventory = data.inventory
          await writeStoreData('spiritpal-pet-store', JSON.stringify(parsed))
          restoredCount++
        } catch (e) {
          console.warn('[DataManager] 导入宠物养成数据失败:', e)
        }
      }

      // 导入记忆数据（enhancedMemory 使用 SQLite — 双写策略）
      // [OPTIMIZE] I3 - 修复数据源：记忆数据通过 writeStoreData 写入
      if (data.memories) {
        for (const [charId, memData] of Object.entries(data.memories)) {
          await writeStoreData(`spiritpal-memory-${charId}`, JSON.stringify(memData))
        }
        restoredCount++
      }
      if (data.enhancedMemories) {
        for (const [charId, memData] of Object.entries(data.enhancedMemories)) {
          await writeStoreData(`spiritpal-enhanced-memory-${charId}`, JSON.stringify(memData))
        }
      }

      // 导入成就数据
      if (data.achievements) {
        localStorage.setItem('spiritpal-achievements', JSON.stringify(data.achievements))
        restoredCount++
      }

      // 导入模组数据
      if (data.mods && Array.isArray(data.mods)) {
        try {
          localStorage.setItem('spiritpal-mods', JSON.stringify(data.mods))
          restoredCount++
        } catch (e) {
          console.warn('[DataManager] 导入模组数据失败:', e)
        }
      }

      return {
        success: true,
        message: `成功恢复 ${restoredCount} 项数据。请重启应用以完全生效。`,
      }
    } catch (e) {
      // [OPTIMIZE] E1 - 记录错误日志，便于排查导入失败
      console.error('[DataManager] 导入数据失败:', e)
      return { success: false, message: '文件解析失败，请检查 JSON 格式' }
    }
  }

  // 从文件导入
  async importFromFile(file: File): Promise<{ success: boolean; message: string }> {
    try {
      const text = await file.text()
      return await this.importAll(text)
    } catch (e) {
      // [OPTIMIZE] E1 - 记录错误日志
      console.error('[DataManager] 文件读取失败:', e)
      return { success: false, message: '文件读取失败' }
    }
  }

  // ============ 重置所有数据 ============

  /**
   * F6 修复：resetAll 现在同时清理 localStorage 和 SQLite
   * 覆盖：memories / commitments / context_episodes / settings 表
   * 确保 GDPR 删除权彻底
   */
  async resetAll(): Promise<void> {
    // 1. 清理 localStorage 中所有 spiritpal- 前缀的键
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('spiritpal-')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k))

    // 2. F6：清理 SQLite 中的所有记忆相关数据
    try {
      const db = await getDb()
      // 清空记忆表（含 embedding）
      await db.execute('DELETE FROM memories')
      // 清空约定追踪表
      await db.execute('DELETE FROM commitments')
      // 清空上下文快照表
      await db.execute('DELETE FROM context_episodes')
      // 清空 settings 表中所有记忆相关键（enhancedMemory / ownerFacts / petExperience / visualMemory 等）
      await db.execute("DELETE FROM settings WHERE key LIKE 'spiritpal:%'")
      // 清空 schedules 表
      await db.execute('DELETE FROM schedules')
      console.info('[DataManager] SQLite 数据已清除')
    } catch (e) {
      console.error('[DataManager] SQLite 清理失败:', e)
    }
  }

  // ============ 存档延迟恢复（参考 VPet StoreStrength 机制）============

  /**
   * 计算延迟恢复后的数值
   *
   * 参考 VPet 的 StoreStrength / StoreStrengthFood 机制：
   * - 离线时间越长，存储强度越大
   * - 恢复时不一次性应用全部存储强度，而是按 1/10 比例逐渐转换
   * - 这防止了长时间离线后瞬间满血恢复的问题
   *
   * @param currentValue 当前数值（衰减后的值）
   * @param storedStrength 存储的恢复强度（离线期间积累的潜在恢复量）
   * @param conversionRate 转换率（默认 0.1 = 每次恢复 10% 的存储强度）
   * @param maxStat 数值上限（默认 100）
   * @returns 恢复后的 { value, remainingStrength }
   */
  calculateDelayedRecovery(
    currentValue: number,
    storedStrength: number,
    conversionRate: number = STRENGTH_CONVERSION_RATE,
    maxStat: number = 100,
  ): { value: number; remainingStrength: number } {
    if (storedStrength <= 0) {
      return { value: currentValue, remainingStrength: 0 }
    }

    // 按转换率从存储强度中取出一部分
    const recoveryAmount = Math.min(
      storedStrength * conversionRate,
      maxStat - currentValue, // 不超过上限
    )

    const newValue = Math.min(maxStat, currentValue + Math.max(0, recoveryAmount))
    const newStrength = Math.max(0, storedStrength - recoveryAmount)

    return { value: newValue, remainingStrength: newStrength }
  }

  /**
   * 计算离线期间积累的存储强度
   *
   * @param elapsedMs 离线时长（毫秒）
   * @param recoveryRate 每小时恢复量
   * @returns 积累的存储强度
   */
  calculateAccumulatedStrength(
    elapsedMs: number,
    recoveryRate: number = 2, // 默认每小时恢复 2 点
  ): number {
    const hours = elapsedMs / (1000 * 60 * 60)
    return hours * recoveryRate
  }

  /**
   * 延迟恢复养成数值
   * 离线后不瞬间恢复，而是将恢复量存为"存储强度"，后续按比例逐渐转换
   *
   * @param stats 当前养成数值（已衰减后的）
   * @param elapsedMs 离线时长（毫秒）
   * @param storedStrengths 之前存储的恢复强度
   * @returns 恢复后的数值和剩余存储强度
   */
  applyDelayedRecovery(
    stats: { hunger: number; mood: number; health: number },
    elapsedMs: number,
    storedStrengths?: { hunger: number; mood: number; health: number },
  ): {
    stats: { hunger: number; mood: number; health: number }
    strengths: { hunger: number; mood: number; health: number }
  } {
    const strengths = storedStrengths ?? { hunger: 0, mood: 0, health: 0 }

    // 计算离线期间新积累的存储强度
    const newHungerStrength = this.calculateAccumulatedStrength(elapsedMs, 2)
    const newMoodStrength = this.calculateAccumulatedStrength(elapsedMs, 1.5)
    const newHealthStrength = this.calculateAccumulatedStrength(elapsedMs, 1)

    // 合并已有存储强度和新积累的强度
    const totalHungerStrength = strengths.hunger + newHungerStrength
    const totalMoodStrength = strengths.mood + newMoodStrength
    const totalHealthStrength = strengths.health + newHealthStrength

    // 按转换率逐渐恢复
    const hungerResult = this.calculateDelayedRecovery(stats.hunger, totalHungerStrength)
    const moodResult = this.calculateDelayedRecovery(stats.mood, totalMoodStrength)
    const healthResult = this.calculateDelayedRecovery(stats.health, totalHealthStrength, 0.1, 100)

    return {
      stats: {
        hunger: hungerResult.value,
        mood: moodResult.value,
        health: healthResult.value,
      },
      strengths: {
        hunger: hungerResult.remainingStrength,
        mood: moodResult.remainingStrength,
        health: healthResult.remainingStrength,
      },
    }
  }
}

// ============ 单例 ============

export function getDataManager(): DataManager {
  return DataManager.getInstance()
}