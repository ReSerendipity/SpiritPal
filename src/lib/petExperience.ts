/**
 * 宠物共同经历记忆层（Pet Experience Memory）
 *
 * P2-4：让宠物记住"我们的故事"——不是"你的事"，而是"我们之间发生的事"。
 * 记录宠物视角的事件：被喂食、被打扮、陪着工作、被遗忘、第一次聊天等。
 *
 * 设计参考：
 * - super-agent-party 的"日记"功能——宠物写自己的日记
 * - airi 的 emotional memory——情感标记的交互记忆
 * - Open Cloud Memory 的 autobiographical layer——自传式记忆
 *
 * 与 EnhancedMemory 的关系：
 * - EnhancedMemory 记的是"用户说了什么"（对话记忆）
 * - PetExperience 记的是"我们之间发生了什么"（事件记忆）
 * - 两者独立存储，检索时可合并
 *
 * @fileoverview
 * 主要模块：
 * - PetExperience 接口：经历条目
 * - PetExperienceManager 类：经历管理器，支持记录、检索、注入
 * - 事件类型：喂食/玩耍/打扮/陪伴工作/被遗忘/第一次聊天/升级等
 */

import {
  getSetting,
  setSetting,
  getPetExperiences,
  insertPetExperience,
  clearPetExperiences,
  isPetExperienceMigrated,
  setPetExperienceMigrated,
} from './db'
import { invoke } from '@tauri-apps/api/core'
import { generateId } from './commonUtils'

// ============ 类型定义 ============

/** 经历类型 */
export type ExperienceType =
  | 'feed'          // 被喂食
  | 'play'          // 被逗玩
  | 'bathe'         // 洗澡
  | 'dress_up'      // 被打扮
  | 'pet'           // 被摸头
  | 'accompany_work' // 陪伴工作
  | 'accompany_meeting' // 陪伴开会
  | 'ignored'       // 被遗忘
  | 'first_chat'    // 第一次聊天
  | 'level_up'      // 升级
  | 'achievement'   // 解锁成就
  | 'pomodoro'      // 一起完成番茄钟
  | 'weather'       // 天气事件
  | 'festival'      // 节日互动
  | 'anniversary'   // 纪念日
  | 'custom'        // 自定义

/** 经历条目 */
export interface PetExperience {
  /** 唯一 ID */
  id: string
  /** 经历类型 */
  type: ExperienceType
  /** 宠物视角的描述：如"今天主人喂了我好吃的，好幸福～" */
  description: string
  /** 发生时间 */
  timestamp: number
  /** 情感标记：positive / neutral / negative */
  sentiment: 'positive' | 'neutral' | 'negative'
  /** 情感强度 0-1 */
  intensity: number
  /** 关联的角色 ID */
  characterId: string
}

// ============ 经历描述模板 ============

const EXPERIENCE_TEMPLATES: Partial<Record<ExperienceType, string[]>> = {
  feed: ['今天主人喂了我好吃的，好幸福～', '又到了吃饭时间！主人对我真好～'],
  play: ['和主人一起玩耍了！好开心～', '主人陪我玩了！最喜欢这种时光了～'],
  bathe: ['今天洗澡了，洗得香喷喷的～', '主人给我洗澡了，虽然不太喜欢水但舒服～'],
  dress_up: ['主人给我换了新装扮！好看吗～', '换上了新衣服，感觉精神多了～'],
  pet: ['主人摸了我的头～好舒服～', '被摸头了！最喜欢这个～'],
  accompany_work: ['今天陪主人工作了很久，主人辛苦了～', '主人一直在工作，我安静陪着～'],
  accompany_meeting: ['主人在开会，我安静陪着～', '会议好无聊，但陪着主人也还好～'],
  ignored: ['主人好久没理我了……有点孤单', '今天主人好像很忙，一直没和我说话……'],
  first_chat: ['我们第一次聊天了！好开心认识了主人～', '第一次和主人对话！感觉我们会成为好朋友～'],
  level_up: ['升级了！我变强了～', '又升级啦！感谢主人一直的照顾～'],
  achievement: ['解锁了新成就！好厉害～', '达成新成就了！和主人一起的功劳～'],
  pomodoro: ['和主人一起完成了专注！好有成就感～', '番茄钟结束了！主人好棒～'],
  weather: ['今天的天气让我有不一样的感觉～', '天气变化了，我要照顾好自己～'],
  festival: ['今天是特别的节日！和主人一起过节好开心～', '节日快乐！能和主人一起度过真好～'],
  anniversary: ['今天是我们的纪念日！时间过得真快～', '又到了这个特别的日子！感谢主人一直陪着我～'],
}

// ============ 情感映射 ============

const EXPERIENCE_SENTIMENT: Record<ExperienceType, 'positive' | 'neutral' | 'negative'> = {
  feed: 'positive',
  play: 'positive',
  bathe: 'neutral',
  dress_up: 'positive',
  pet: 'positive',
  accompany_work: 'neutral',
  accompany_meeting: 'neutral',
  ignored: 'negative',
  first_chat: 'positive',
  level_up: 'positive',
  achievement: 'positive',
  pomodoro: 'positive',
  weather: 'neutral',
  festival: 'positive',
  anniversary: 'positive',
  custom: 'neutral',
}

// ============ 宠物经历管理器 ============

export class PetExperienceManager {
  private characterId: string
  private storageKey: string
  private experiences: PetExperience[] = []
  private initPromise: Promise<void>
  /** T-1: 是否使用行级存储（二期迁移） */
  private useRowLevelStorage: boolean = false

  constructor(characterId: string) {
    this.characterId = characterId
    this.storageKey = `spiritpal-pet-experience-${characterId}`
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
      this.useRowLevelStorage = await isPetExperienceMigrated()
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
      const rows = await getPetExperiences(this.characterId)
      this.experiences = rows.map((r) => ({
        id: r.id,
        type: r.type as ExperienceType,
        description: r.description,
        timestamp: r.timestamp,
        sentiment: r.sentiment as PetExperience['sentiment'],
        intensity: r.intensity,
        characterId: r.character_id,
      }))
    } catch (e) {
      console.error(`[PetExperience] 行级加载失败:`, e)
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
      // D1 修复：兼容 Rust 端新版 ENC2: 加密前缀，避免密文被当作明文解析而丢失共同经历数据
      if (raw.startsWith('ENC1:') || raw.startsWith('ENC2:')) {
        try {
          jsonStr = await invoke<string>('decrypt_data', { encrypted: raw, password: '' })
        } catch (e) {
          console.warn(`[PetExperience] 解密失败:`, e)
          return
        }
      } else {
        jsonStr = raw
      }

      const data = JSON.parse(jsonStr)
      this.experiences = data.experiences ?? []

      // T-1: 旧 blob 加载成功后，自动迁移到行级存储
      await this.migrateToRows()
    } catch (e) {
      console.error(`[PetExperience] 加载失败:`, e)
    }
  }

  /**
   * T-1: 将当前内存中的经历迁移到行级存储
   */
  private async migrateToRows(): Promise<void> {
    try {
      for (const exp of this.experiences) {
        await insertPetExperience({
          id: exp.id,
          character_id: this.characterId,
          type: exp.type,
          description: exp.description,
          timestamp: exp.timestamp,
          sentiment: exp.sentiment,
          intensity: exp.intensity,
        })
      }
      // 旧 blob 备份
      const raw = await getSetting(this.storageKey)
      if (raw) {
        await setSetting(`${this.storageKey}.legacy`, raw)
      }
      await setPetExperienceMigrated()
      this.useRowLevelStorage = true
      console.log(`[PetExperience] Migrated ${this.experiences.length} experiences to row-level storage`)
    } catch (e) {
      console.error(`[PetExperience] 迁移失败，继续使用 blob:`, e)
    }
  }

  private async save(): Promise<void> {
    if (this.useRowLevelStorage) {
      // T-1: 行级路径 — CRUD 已实时写入行，无需全量保存
      return
    }

    // 旧路径 — 全量 JSON 序列化 + AES 加密 + 写 settings blob
    try {
      const jsonStr = JSON.stringify({ experiences: this.experiences })

      let toStore: string
      try {
        toStore = await invoke<string>('encrypt_data', { data: jsonStr, password: '' })
      } catch (e) {
        console.error(`[PetExperience] 加密失败:`, e)
        return
      }

      await setSetting(this.storageKey, toStore)
    } catch (e) {
      console.error(`[PetExperience] 保存失败:`, e)
    }
  }

  // ============ 记录经历 ============

  /**
   * 记录一次经历
   * @param type 经历类型
   * @param description 可选描述（不传则从模板随机选择）
   * @param intensity 情感强度 0-1（默认 0.5）
   */
  async record(type: ExperienceType, description?: string, intensity: number = 0.5): Promise<PetExperience> {
    const templates = EXPERIENCE_TEMPLATES[type]
    const desc = description ?? (templates ? templates[Math.floor(Math.random() * templates.length)] : '发生了一件事～')

    const experience: PetExperience = {
      id: generateId('exp'),
      type,
      description: desc,
      timestamp: Date.now(),
      sentiment: EXPERIENCE_SENTIMENT[type],
      intensity: Math.max(0, Math.min(1, intensity)),
      characterId: this.characterId,
    }

    this.experiences.push(experience)

    // T-1: 行级路径 — 实时写入行
    if (this.useRowLevelStorage) {
      await insertPetExperience({
        id: experience.id,
        character_id: this.characterId,
        type: experience.type,
        description: experience.description,
        timestamp: experience.timestamp,
        sentiment: experience.sentiment,
        intensity: experience.intensity,
      })
    }

    // 限制容量：保留最近 200 条 + 所有纪念日/第一次类经历
    if (this.experiences.length > 200) {
      // 永远保留 first_chat 和 anniversary
      const precious = this.experiences.filter(e => e.type === 'first_chat' || e.type === 'anniversary')
      const others = this.experiences.filter(e => e.type !== 'first_chat' && e.type !== 'anniversary')
      this.experiences = [...precious, ...others.slice(-150)]

      // T-1: 行级路径下裁剪后重建行（保持与内存一致）
      if (this.useRowLevelStorage) {
        await clearPetExperiences(this.characterId)
        for (const e of this.experiences) {
          await insertPetExperience({
            id: e.id,
            character_id: this.characterId,
            type: e.type,
            description: e.description,
            timestamp: e.timestamp,
            sentiment: e.sentiment,
            intensity: e.intensity,
          })
        }
      }
    }

    await this.save()
    return experience
  }

  // ============ 检索 ============

  /**
   * 获取最近的经历
   * @param count 数量
   */
  getRecent(count: number = 5): PetExperience[] {
    return this.experiences.slice(-count).reverse()
  }

  /**
   * 按类型筛选
   */
  getByType(type: ExperienceType): PetExperience[] {
    return this.experiences.filter(e => e.type === type)
  }

  /**
   * 获取所有经历
   */
  getAll(): PetExperience[] {
    return [...this.experiences]
  }

  /**
   * 获取正面经历
   */
  getPositive(): PetExperience[] {
    return this.experiences.filter(e => e.sentiment === 'positive')
  }

  /**
   * 获取经历数量
   */
  get size(): number {
    return this.experiences.length
  }

  // ============ 上下文注入 ============

  /**
   * 生成注入到 system prompt 的经历上下文
   * 精选最近的、有代表性的经历
   * @param tokenBudget token 预算上限
   * @returns 格式化的经历上下文字符串
   */
  buildContext(tokenBudget: number = 300): string {
    if (this.experiences.length === 0) return ''

    // 策略：取最近的 3 条正面经历 + 1 条最近的负面经历（如有）
    const recent = this.getRecent(10)
    const positive = recent.filter(e => e.sentiment === 'positive').slice(0, 3)
    const negative = recent.filter(e => e.sentiment === 'negative').slice(0, 1)
    const selected = [...positive, ...negative]

    if (selected.length === 0) return ''

    const parts: string[] = ['【我们的故事】']
    let usedTokens = estimateTokensApprox('【我们的故事】')

    for (const exp of selected) {
      const line = `- ${exp.description}`
      const lineTokens = estimateTokensApprox(line) + 2
      if (usedTokens + lineTokens > tokenBudget) break
      parts.push(line)
      usedTokens += lineTokens
    }

    if (parts.length <= 1) return ''

    parts.push('（以上是我们之间发生过的事，可以在对话中自然提及。）')
    return parts.join('\n')
  }

  // ============ 清空 ============

  async clear(): Promise<void> {
    this.experiences = []
    // T-1: 行级路径下同步清空表
    if (this.useRowLevelStorage) {
      await clearPetExperiences(this.characterId)
    }
    await this.save()
  }

  // ============ 销毁 ============

  dispose(): void {
    this.experiences = []
    removePetExperienceManager(this.characterId)
  }
}

// ============ 简易 token 估算 ============

function estimateTokensApprox(text: string): number {
  return Math.ceil(text.length / 3)
}

// ============ 单例缓存 ============

const managers = new Map<string, PetExperienceManager>()

export function getPetExperienceManager(characterId: string): PetExperienceManager {
  let mgr = managers.get(characterId)
  if (!mgr) {
    mgr = new PetExperienceManager(characterId)
    managers.set(characterId, mgr)
  }
  return mgr
}

export function removePetExperienceManager(characterId: string): void {
  managers.delete(characterId)
}
