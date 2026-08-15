/**
 * 实体链接层（Entity Linking）
 *
 * P4-2：从对话中提取实体，存储为可关联的记忆节点
 * 检索时通过实体关联找到跨记忆的相关信息
 *
 * 设计参考：
 * - mem0 v2 的 entity linking：实体提取+嵌入+跨记忆关联
 * - 知识图谱的 entity-relation 模型
 *
 * 简化实现：使用规则+NER 模式提取实体，不做嵌入关联（留待 P5）
 */

import {
  getSetting,
  setSetting,
  getEntityNodes,
  upsertEntityNode,
  clearEntityNodes,
  isEntityNodesMigrated,
  setEntityNodesMigrated,
} from './db'
import { invoke } from '@tauri-apps/api/core'
import { generateId } from './commonUtils'

// ============ 类型定义 ============

export type EntityType = 'person' | 'place' | 'thing' | 'time' | 'concept' | 'event'

export interface EntityNode {
  id: string
  name: string
  type: EntityType
  /** 关联的记忆 ID 列表 */
  linkedMemoryIds: string[]
  /** 出现次数 */
  mentionCount: number
  /** 首次出现时间 */
  firstSeen: number
  /** 最后出现时间 */
  lastSeen: number
}

// ============ 实体提取规则 ============

interface EntityRule {
  type: EntityType
  pattern: RegExp
  group: number
}

const ENTITY_RULES: EntityRule[] = [
  // 人物名（中文 2-4 字 + 英文名）
  { type: 'person', pattern: /(?:叫|是|名字是)\s*([\u4e00-\u9fa5]{2,4}|[A-Z][a-z]{2,15})/g, group: 1 },
  // 地名
  { type: 'place', pattern: /(?:在|去|来自|住在)\s*([\u4e00-\u9fa5]{2,6}|[A-Z][a-z]{2,15})/g, group: 1 },
  // 物品
  { type: 'thing', pattern: /(?:买了|有一个|喜欢|用了)\s*(\S{2,15})/g, group: 1 },
  // 时间
  { type: 'time', pattern: /(?:今天|昨天|明天|下周|上周|这个月|下个月|今年|明年)/g, group: 0 },
  // 事件
  { type: 'event', pattern: /(?:开会|出差|考试|面试|旅行|聚餐|运动)/g, group: 0 },
]

// ============ 实体管理器 ============

export class EntityManager {
  private characterId: string
  private storageKey: string
  private entities: Map<string, EntityNode> = new Map() // name → entity
  private initPromise: Promise<void>
  /** T-1: 是否使用行级存储（二期迁移） */
  private useRowLevelStorage: boolean = false

  constructor(characterId: string) {
    this.characterId = characterId
    this.storageKey = `spiritpal-entities-${characterId}`
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
      this.useRowLevelStorage = await isEntityNodesMigrated()
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
      const rows = await getEntityNodes(this.characterId)
      this.entities.clear()
      for (const r of rows) {
        this.entities.set(r.name, {
          id: r.id,
          name: r.name,
          type: r.type as EntityType,
          linkedMemoryIds: JSON.parse(r.linked_memory_ids),
          mentionCount: r.mention_count,
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
        })
      }
    } catch (e) {
      console.error(`[EntityManager] 行级加载失败:`, e)
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
      // D1 修复：兼容 Rust 端新版 ENC2: 加密前缀，避免密文被当作明文解析而丢失实体数据
      if (raw.startsWith('ENC1:') || raw.startsWith('ENC2:')) {
        jsonStr = await invoke<string>('decrypt_data', { encrypted: raw, password: '' })
      } else {
        jsonStr = raw
      }

      const data = JSON.parse(jsonStr)
      const entities: EntityNode[] = data.entities ?? []
      this.entities.clear()
      for (const e of entities) {
        this.entities.set(e.name, e)
      }

      // T-1: 旧 blob 加载成功后，自动迁移到行级存储
      await this.migrateToRows()
    } catch (e) {
      console.error(`[EntityManager] 加载失败:`, e)
    }
  }

  /**
   * T-1: 将当前内存中的实体迁移到行级存储
   */
  private async migrateToRows(): Promise<void> {
    try {
      for (const e of this.entities.values()) {
        await upsertEntityNode({
          id: e.id,
          character_id: this.characterId,
          name: e.name,
          type: e.type,
          linked_memory_ids: JSON.stringify(e.linkedMemoryIds),
          mention_count: e.mentionCount,
          first_seen: e.firstSeen,
          last_seen: e.lastSeen,
        })
      }
      // 旧 blob 备份
      const raw = await getSetting(this.storageKey)
      if (raw) {
        await setSetting(`${this.storageKey}.legacy`, raw)
      }
      await setEntityNodesMigrated()
      this.useRowLevelStorage = true
      console.log(`[EntityManager] Migrated ${this.entities.size} entities to row-level storage`)
    } catch (e) {
      console.error(`[EntityManager] 迁移失败，继续使用 blob:`, e)
    }
  }

  private async save(): Promise<void> {
    if (this.useRowLevelStorage) {
      // T-1: 行级路径 — extractAndLink 已实时 upsert 行，无需全量保存
      return
    }

    // 旧路径 — 全量 JSON 序列化 + AES 加密 + 写 settings blob
    try {
      const jsonStr = JSON.stringify({ entities: Array.from(this.entities.values()) })
      let toStore: string
      try {
        toStore = await invoke<string>('encrypt_data', { data: jsonStr, password: '' })
      } catch {
        return
      }
      await setSetting(this.storageKey, toStore)
    } catch (e) {
      console.error(`[EntityManager] 保存失败:`, e)
    }
  }

  /**
   * T-1: 行级路径下批量 upsert 实体（extractAndLink 为同步方法，此处异步落库）
   */
  private async persistEntities(nodes: EntityNode[]): Promise<void> {
    try {
      for (const e of nodes) {
        await upsertEntityNode({
          id: e.id,
          character_id: this.characterId,
          name: e.name,
          type: e.type,
          linked_memory_ids: JSON.stringify(e.linkedMemoryIds),
          mention_count: e.mentionCount,
          first_seen: e.firstSeen,
          last_seen: e.lastSeen,
        })
      }
    } catch (e) {
      console.error(`[EntityManager] 实体落库失败:`, e)
    }
  }

  // ============ 提取 ============

  /**
   * 从文本中提取实体并关联到记忆
   */
  extractAndLink(text: string, memoryId: string): EntityNode[] {
    const found: EntityNode[] = []
    const now = Date.now()

    for (const rule of ENTITY_RULES) {
      const matches = text.matchAll(rule.pattern)
      for (const match of matches) {
        const name = match[rule.group]?.trim()
        if (!name || name.length < 1 || name.length > 30) continue

        // 过滤停用词
        const stopWords = ['你', '我', '他', '她', '什么', '怎么', '为什么', '怎样']
        if (stopWords.includes(name)) continue

        let entity = this.entities.get(name)
        if (!entity) {
          entity = {
            id: generateId('entity'),
            name,
            type: rule.type,
            linkedMemoryIds: [],
            mentionCount: 0,
            firstSeen: now,
            lastSeen: now,
          }
          this.entities.set(name, entity)
        }

        // 关联记忆（避免重复）
        if (!entity.linkedMemoryIds.includes(memoryId)) {
          entity.linkedMemoryIds.push(memoryId)
        }
        entity.mentionCount++
        entity.lastSeen = now
        found.push(entity)
      }
    }

    if (found.length > 0) {
      if (this.useRowLevelStorage) {
        // T-1: 行级路径 — 异步 upsert 实体行
        void this.persistEntities(found)
      } else {
        void this.save()
      }
    }
    return found
  }

  // ============ 检索 ============

  /**
   * 通过实体名查找关联的记忆 ID
   */
  getLinkedMemoryIds(entityName: string): string[] {
    return this.entities.get(entityName)?.linkedMemoryIds ?? []
  }

  /**
   * 获取所有实体
   */
  getAllEntities(): EntityNode[] {
    return Array.from(this.entities.values()).sort((a, b) => b.mentionCount - a.mentionCount)
  }

  /**
   * 获取实体数量
   */
  get size(): number {
    return this.entities.size
  }

  /**
   * P4-3：时间感知检索——根据时间实体筛选记忆
   */
  getTemporalEntities(): EntityNode[] {
    return Array.from(this.entities.values()).filter(e => e.type === 'time')
  }

  // ============ 清空 ============

  async clear(): Promise<void> {
    this.entities.clear()
    // T-1: 行级路径下同步清空表
    if (this.useRowLevelStorage) {
      await clearEntityNodes(this.characterId)
    }
    await this.save()
  }

  dispose(): void {
    this.entities.clear()
    removeEntityManager(this.characterId)
  }
}

// ============ 单例 ============

const managers = new Map<string, EntityManager>()

export function getEntityManager(characterId: string): EntityManager {
  let mgr = managers.get(characterId)
  if (!mgr) {
    mgr = new EntityManager(characterId)
    managers.set(characterId, mgr)
  }
  return mgr
}

export function removeEntityManager(characterId: string): void {
  managers.delete(characterId)
}
