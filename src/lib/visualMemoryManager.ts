/**
 * 多模态记忆模块（Visual Memory）
 *
 * P3-6：记录和检索视觉快照（截图、天气快照、心情快照）
 * 作为 EnhancedMemory 的补充层，存储视觉上下文信息
 *
 * 设计参考：
 * - airi 的 visual memory：截屏上下文感知
 * - mem0 的 entity linking：实体关联记忆
 * - Open Cloud Memory 的 multimodal layer
 */

import {
  getSetting,
  setSetting,
  getVisualMemories,
  insertVisualMemory,
  clearVisualMemories,
  isVisualMemoryMigrated,
  setVisualMemoryMigrated,
} from './db'
import { invoke } from '@tauri-apps/api/core'
import { generateId } from './commonUtils'

// ============ 类型定义 ============

/** 视觉记忆类型 */
export type VisualMemoryType =
  | 'screenshot'   // 截图
  | 'weather'      // 天气快照
  | 'mood'         // 心情快照
  | 'scene'        // 场景描述
  | 'custom'       // 自定义

/** 视觉记忆条目 */
export interface VisualMemory {
  /** 唯一 ID */
  id: string
  /** 类型 */
  type: VisualMemoryType
  /** 文本描述（如"晴天 28°C"、"在写代码"） */
  description: string
  /** 图片路径（可选，截图等） */
  imagePath?: string
  /** 关联的角色 ID */
  characterId: string
  /** 发生时间 */
  timestamp: number
  /** 情感标记 */
  sentiment: 'positive' | 'neutral' | 'negative'
  /** 关联的对话记忆 ID（可选） */
  relatedMemoryId?: string
}

// ============ 视觉记忆管理器 ============

export class VisualMemoryManager {
  private characterId: string
  private storageKey: string
  private memories: VisualMemory[] = []
  private initPromise: Promise<void>
  /** T-1: 是否使用行级存储（二期迁移） */
  private useRowLevelStorage: boolean = false

  constructor(characterId: string) {
    this.characterId = characterId
    this.storageKey = `spiritpal-visual-memory-${characterId}`
    this.initPromise = this.init()
  }

  private async init(): Promise<void> {
    await this.load()
  }

  async ensureLoaded(): Promise<void> {
    await this.initPromise
  }

  // ============ 持久化 ============

  private async load(): Promise<void> {
    // T-1: 检查是否已迁移到行级存储
    try {
      this.useRowLevelStorage = await isVisualMemoryMigrated()
    } catch {
      this.useRowLevelStorage = false
    }

    if (this.useRowLevelStorage) {
      await this.loadFromRows()
    } else {
      await this.loadFromBlob()
    }
  }

  /**
   * T-1: 从行级存储加载
   */
  private async loadFromRows(): Promise<void> {
    try {
      const rows = await getVisualMemories(this.characterId)
      this.memories = rows.map((r) => ({
        id: r.id,
        type: r.type as VisualMemoryType,
        description: r.description,
        imagePath: r.image_path ?? undefined,
        characterId: r.character_id,
        timestamp: r.timestamp,
        sentiment: r.sentiment as VisualMemory['sentiment'],
        relatedMemoryId: r.related_memory_id ?? undefined,
      }))
    } catch (e) {
      console.error(`[VisualMemory] 行级加载失败:`, e)
      // 回退到 blob
      this.useRowLevelStorage = false
      await this.loadFromBlob()
    }
  }

  /**
   * T-1: 从旧 blob 加载（双模式兼容），加载成功后自动迁移到行级
   */
  private async loadFromBlob(): Promise<void> {
    try {
      const raw = await getSetting(this.storageKey)
      if (!raw) return

      let jsonStr: string
      // D1 修复：兼容 Rust 端新版 ENC2: 加密前缀，避免密文被当作明文解析而丢失视觉记忆数据
      if (raw.startsWith('ENC1:') || raw.startsWith('ENC2:')) {
        try {
          jsonStr = await invoke<string>('decrypt_data', { encrypted: raw, password: '' })
        } catch (e) {
          console.warn(`[VisualMemory] 解密失败:`, e)
          return
        }
      } else {
        jsonStr = raw
      }

      const data = JSON.parse(jsonStr)
      this.memories = data.memories ?? []

      // T-1: 旧 blob 加载成功后，自动迁移到行级存储
      await this.migrateToRows()
    } catch (e) {
      console.error(`[VisualMemory] 加载失败:`, e)
    }
  }

  /**
   * T-1: 将当前内存中的视觉记忆迁移到行级存储
   */
  private async migrateToRows(): Promise<void> {
    try {
      for (const mem of this.memories) {
        await insertVisualMemory({
          id: mem.id,
          character_id: this.characterId,
          type: mem.type,
          description: mem.description,
          image_path: mem.imagePath ?? null,
          timestamp: mem.timestamp,
          sentiment: mem.sentiment,
          related_memory_id: mem.relatedMemoryId ?? null,
        })
      }
      // 旧 blob 备份
      const raw = await getSetting(this.storageKey)
      if (raw) {
        await setSetting(`${this.storageKey}.legacy`, raw)
      }
      await setVisualMemoryMigrated()
      this.useRowLevelStorage = true
      console.log(`[VisualMemory] Migrated ${this.memories.length} memories to row-level storage`)
    } catch (e) {
      console.error(`[VisualMemory] 迁移失败，继续使用 blob:`, e)
    }
  }

  private async save(): Promise<void> {
    if (this.useRowLevelStorage) {
      // T-1: 行级路径 — CRUD 已实时写入行，无需全量保存
      return
    }

    // 旧路径 — 全量 JSON 序列化 + AES 加密 + 写 settings blob
    try {
      const jsonStr = JSON.stringify({ memories: this.memories })

      let toStore: string
      try {
        toStore = await invoke<string>('encrypt_data', { data: jsonStr, password: '' })
      } catch (e) {
        console.error(`[VisualMemory] 加密失败:`, e)
        return
      }

      await setSetting(this.storageKey, toStore)
    } catch (e) {
      console.error(`[VisualMemory] 保存失败:`, e)
    }
  }

  // ============ 记录 ============

  /**
   * 记录一条视觉记忆
   */
  async record(
    type: VisualMemoryType,
    description: string,
    sentiment: 'positive' | 'neutral' | 'negative' = 'neutral',
    imagePath?: string,
    relatedMemoryId?: string,
  ): Promise<VisualMemory> {
    const memory: VisualMemory = {
      id: generateId('vm'),
      type,
      description,
      imagePath,
      characterId: this.characterId,
      timestamp: Date.now(),
      sentiment,
      relatedMemoryId,
    }

    this.memories.push(memory)

    // T-1: 行级路径 — 实时写入行
    if (this.useRowLevelStorage) {
      await insertVisualMemory({
        id: memory.id,
        character_id: this.characterId,
        type: memory.type,
        description: memory.description,
        image_path: memory.imagePath ?? null,
        timestamp: memory.timestamp,
        sentiment: memory.sentiment,
        related_memory_id: memory.relatedMemoryId ?? null,
      })
    }

    // 限制容量：保留最近 50 条
    if (this.memories.length > 50) {
      const removedCount = this.memories.length - 50
      this.memories = this.memories.slice(-50)
      // T-1: 行级路径下裁剪后重建行（保持与内存一致）
      if (this.useRowLevelStorage && removedCount > 0) {
        await clearVisualMemories(this.characterId)
        for (const m of this.memories) {
          await insertVisualMemory({
            id: m.id,
            character_id: this.characterId,
            type: m.type,
            description: m.description,
            image_path: m.imagePath ?? null,
            timestamp: m.timestamp,
            sentiment: m.sentiment,
            related_memory_id: m.relatedMemoryId ?? null,
          })
        }
      }
    }

    await this.save()
    return memory
  }

  /**
   * 记录天气快照
   */
  async recordWeather(description: string, sentiment: 'positive' | 'neutral' | 'negative' = 'neutral'): Promise<void> {
    await this.record('weather', description, sentiment)
  }

  /**
   * 记录心情快照
   */
  async recordMood(description: string, sentiment: 'positive' | 'neutral' | 'negative' = 'neutral'): Promise<void> {
    await this.record('mood', description, sentiment)
  }

  /**
   * 记录场景快照
   */
  async recordScene(description: string, sentiment: 'positive' | 'neutral' | 'negative' = 'neutral'): Promise<void> {
    await this.record('scene', description, sentiment)
  }

  /**
   * P4-4：记录截图快照（存储实际图片路径）
   * @param imagePath 截图文件路径
   * @param description 场景描述
   */
  async recordScreenshot(imagePath: string, description: string): Promise<void> {
    await this.record('screenshot', description, 'neutral', imagePath)
  }

  /**
   * P4-4：获取有图片的记忆
   */
  getMemoriesWithImages(): VisualMemory[] {
    return this.memories.filter(m => m.imagePath)
  }

  // ============ 检索 ============

  /**
   * 获取最近的视觉记忆
   */
  getRecent(count: number = 5): VisualMemory[] {
    return this.memories.slice(-count).reverse()
  }

  /**
   * 按类型筛选
   */
  getByType(type: VisualMemoryType): VisualMemory[] {
    return this.memories.filter(m => m.type === type)
  }

  /**
   * 获取所有
   */
  getAll(): VisualMemory[] {
    return [...this.memories]
  }

  /**
   * 获取数量
   */
  get size(): number {
    return this.memories.length
  }

  // ============ 上下文注入 ============

  /**
   * 生成注入到 system prompt 的视觉记忆上下文
   */
  buildContext(tokenBudget: number = 200): string {
    if (this.memories.length === 0) return ''

    const recent = this.getRecent(3)
    if (recent.length === 0) return ''

    const parts: string[] = ['【最近感知】']
    let usedTokens = 10

    for (const mem of recent) {
      const line = `- ${mem.description}`
      const lineTokens = Math.ceil(line.length / 3) + 2
      if (usedTokens + lineTokens > tokenBudget) break
      parts.push(line)
      usedTokens += lineTokens
    }

    if (parts.length <= 1) return ''
    return parts.join('\n')
  }

  // ============ 清空 ============

  async clear(): Promise<void> {
    this.memories = []
    // T-1: 行级路径下同步清空表
    if (this.useRowLevelStorage) {
      await clearVisualMemories(this.characterId)
    }
    await this.save()
  }

  // ============ 销毁 ============

  dispose(): void {
    this.memories = []
    removeVisualMemoryManager(this.characterId)
  }
}

// ============ 单例缓存 ============

const managers = new Map<string, VisualMemoryManager>()

export function getVisualMemoryManager(characterId: string): VisualMemoryManager {
  let mgr = managers.get(characterId)
  if (!mgr) {
    mgr = new VisualMemoryManager(characterId)
    managers.set(characterId, mgr)
  }
  return mgr
}

export function removeVisualMemoryManager(characterId: string): void {
  managers.delete(characterId)
}
