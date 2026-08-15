/**
 * 结构化用户画像层（Owner Facts）
 *
 * P2-1：让宠物"记得主人"的地基。
 * 独立于四层记忆，作为顶层事实始终注入到每条对话的 system prompt 中。
 *
 * 设计参考：
 * - Open Cloud Memory：自进化记忆系统——事实层独立于情景层，高置信度事实优先注入
 * - Hermes Agent：结构化 entity memory——key-value 事实存储 + 置信度 + 来源追溯
 * - mem0：用户画像自动提取——LLM 判断"这条对话是否包含关于用户的稳定事实"
 *
 * @fileoverview
 * 主要模块：
 * - OwnerFact 接口：结构化事实条目
 * - OwnerFactsManager 类：事实管理器（单例），支持 CRUD、规则提取、LLM 提取、上下文注入
 *
 * 核心功能：
 * 1. 规则层兜底：检测"我叫/我是/我有/我的"等句式自动提取事实
 * 2. LLM 提取（可选）：由 LLM 判断对话中是否包含关于用户的稳定事实
 * 3. 用户主动填写：设置页提供"宠物应该记住我什么"表单
 * 4. 上下文注入：每条对话的 system prompt 顶层固定注入（预算 300~500 token）
 */

import { getSetting, setSetting, getOwnerFacts, upsertOwnerFact, deleteOwnerFact, clearOwnerFacts, isOwnerFactsMigrated, setOwnerFactsMigrated } from './db'
import { invoke } from '@tauri-apps/api/core'
import { generateId } from './commonUtils'
import { estimateTokens } from './stringSimilarity'

// ============ 类型定义 ============

/** 结构化用户事实 */
export interface OwnerFact {
  /** 唯一 ID */
  id: string
  /** 事实键名：name / pet / job / birthday / hobby / location / family 等 */
  key: string
  /** 事实值：如 "阿明" / "团子(猫)" / "3月15日" */
  value: string
  /** 来源记忆 ID（如果从对话中提取） */
  sourceMemoryId?: string
  /** 置信度 0-1：用户填写=1.0，LLM 提取=0.7~0.9，规则提取=0.5~0.7 */
  confidence: number
  /** 最后更新时间 */
  updatedAt: number
  /** 是否由用户手动填写（手动填写的事实不可被自动覆盖） */
  userProvided: boolean
}

// ============ 规则提取模式 ============

/** 规则提取的句式匹配 */
interface ExtractionRule {
  /** 事实键名 */
  key: string
  /** 匹配正则 */
  pattern: RegExp
  /** 提取分组索引（从 1 开始） */
  group: number
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // 姓名
  { key: 'name', pattern: /(?:我叫|我的名字是|我是|I am|I'm|my name is)\s*([^\s,，。.!！?？]{1,10})/i, group: 1 },
  // 宠物
  { key: 'pet', pattern: /(?:我养了|我有|我的宠物是|my pet is|I have a)\s*(?:一只|个|条)?\s*([^\s,，。.!！?？]{1,15})/i, group: 1 },
  // 职业
  { key: 'job', pattern: /(?:我是做|我的工作|我在|I work as|my job is)\s*([^\s,，。.!！?？]{1,20})/i, group: 1 },
  // 生日
  { key: 'birthday', pattern: /(?:我的生日|我生日是|my birthday is)\s*([^\s,，。.!！?？]{1,15})/i, group: 1 },
  // 位置
  { key: 'location', pattern: /(?:我在|我住在|我位于|I live in|I'm in)\s*([^\s,，。.!！?？]{1,15})/i, group: 1 },
  // 偏好
  { key: 'preference', pattern: /(?:我喜欢|我爱|我偏好|I like|I love|I prefer)\s*([^\s,，。.!！?？]{1,20})/i, group: 1 },
  // 家人
  { key: 'family', pattern: /(?:我的(?:爸爸|妈妈|老公|老婆|儿子|女儿|哥哥|姐姐|弟弟|妹妹)|my (?:father|mother|husband|wife|son|daughter))\s*(?:是|叫)?\s*([^\s,，。.!！?？]{1,10})/i, group: 1 },
]

// ============ 事实显示标签 ============

const FACT_LABELS: Record<string, string> = {
  name: '名字',
  pet: '宠物',
  job: '职业',
  birthday: '生日',
  location: '所在地',
  preference: '偏好',
  family: '家人',
}

// ============ 用户画像管理器 ============

export class OwnerFactsManager {
  private characterId: string
  private storageKey: string
  private facts: Map<string, OwnerFact> = new Map() // key → fact
  private initPromise: Promise<void>
  /** T-1: 是否使用行级存储 */
  private useRowLevelStorage: boolean = false

  constructor(characterId: string) {
    this.characterId = characterId
    this.storageKey = `spiritpal-owner-facts-${characterId}`
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
      this.useRowLevelStorage = await isOwnerFactsMigrated()
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
      const rows = await getOwnerFacts(this.characterId)
      this.facts.clear()
      for (const row of rows) {
        this.facts.set(row.fact_key, {
          id: row.fact_id,
          key: row.fact_key,
          value: row.fact_value,
          sourceMemoryId: row.source_memory_id ?? undefined,
          confidence: row.confidence,
          updatedAt: row.updated_at,
          userProvided: row.user_provided === 1,
        })
      }
    } catch (e) {
      console.error(`[OwnerFacts] 行级加载失败:`, e)
      // 回退到 blob
      this.useRowLevelStorage = false
      await this.loadFromBlob()
    }
  }

  /**
   * T-1: 从旧 blob 加载（双模式兼容）
   */
  private async loadFromBlob(): Promise<void> {
    try {
      const raw = await getSetting(this.storageKey)
      if (!raw) return

      let jsonStr: string
      // D1 修复：兼容 Rust 端新版 ENC2: 加密前缀
      if (raw.startsWith('ENC1:') || raw.startsWith('ENC2:')) {
        try {
          jsonStr = await invoke<string>('decrypt_data', { encrypted: raw, password: '' })
        } catch (e) {
          console.warn(`[OwnerFacts] 解密失败:`, e)
          return
        }
      } else {
        jsonStr = raw
      }

      const data = JSON.parse(jsonStr)
      const facts: OwnerFact[] = data.facts ?? []
      this.facts.clear()
      for (const f of facts) {
        this.facts.set(f.key, f)
      }

      // T-1: 旧 blob 加载成功后，自动迁移到行级存储
      await this.migrateToRows()
    } catch (e) {
      console.error(`[OwnerFacts] 加载失败:`, e)
    }
  }

  /**
   * T-1: 将当前内存中的事实迁移到行级存储
   */
  private async migrateToRows(): Promise<void> {
    try {
      for (const fact of this.facts.values()) {
        await upsertOwnerFact({
          character_id: this.characterId,
          fact_id: fact.id,
          fact_key: fact.key,
          fact_value: fact.value,
          source_memory_id: fact.sourceMemoryId ?? null,
          confidence: fact.confidence,
          updated_at: fact.updatedAt,
          user_provided: fact.userProvided ? 1 : 0,
        })
      }
      // 旧 blob 备份
      const raw = await getSetting(this.storageKey)
      if (raw) {
        await setSetting(`${this.storageKey}.legacy`, raw)
      }
      await setOwnerFactsMigrated()
      this.useRowLevelStorage = true
      console.log(`[OwnerFacts] Migrated ${this.facts.size} facts to row-level storage`)
    } catch (e) {
      console.error(`[OwnerFacts] 迁移失败，继续使用 blob:`, e)
    }
  }

  private async save(): Promise<void> {
    if (this.useRowLevelStorage) {
      // T-1: 行级路径 — 无需全量保存，CRUD 操作已实时写入行
      // 此处仅作为兜底（如 import 后的全量同步）
      return
    }

    // 旧路径 — 全量 JSON 序列化 + AES 加密 + 写 settings blob
    try {
      const jsonStr = JSON.stringify({
        facts: Array.from(this.facts.values()),
      })

      let toStore: string
      try {
        toStore = await invoke<string>('encrypt_data', { data: jsonStr, password: '' })
      } catch (e) {
        console.error(`[OwnerFacts] 加密失败，拒绝写入明文:`, e)
        return
      }

      await setSetting(this.storageKey, toStore)
    } catch (e) {
      console.error(`[OwnerFacts] 保存失败:`, e)
    }
  }

  // ============ 事实 CRUD ============

  /** 添加或更新事实 */
  async upsertFact(key: string, value: string, confidence: number, userProvided: boolean = false, sourceMemoryId?: string): Promise<void> {
    const existing = this.facts.get(key)
    // 用户已提供的事实不可被自动提取覆盖
    if (existing?.userProvided && !userProvided) return

    const fact: OwnerFact = {
      id: existing?.id ?? generateId('fact'),
      key,
      value,
      sourceMemoryId,
      confidence: userProvided ? 1.0 : confidence,
      updatedAt: Date.now(),
      userProvided,
    }
    this.facts.set(key, fact)
    // T-1: 行级路径实时写入
    if (this.useRowLevelStorage) {
      try {
        await upsertOwnerFact({
          character_id: this.characterId,
          fact_id: fact.id,
          fact_key: fact.key,
          fact_value: fact.value,
          source_memory_id: fact.sourceMemoryId ?? null,
          confidence: fact.confidence,
          updated_at: fact.updatedAt,
          user_provided: fact.userProvided ? 1 : 0,
        })
      } catch (e) {
        console.error(`[OwnerFacts] 行级写入失败:`, e)
      }
    } else {
      await this.save()
    }
  }

  /** 删除事实 */
  async deleteFact(key: string): Promise<void> {
    this.facts.delete(key)
    // T-1: 行级路径实时删除
    if (this.useRowLevelStorage) {
      try {
        await deleteOwnerFact(this.characterId, key)
      } catch (e) {
        console.error(`[OwnerFacts] 行级删除失败:`, e)
      }
    } else {
      await this.save()
    }
  }

  /** 获取所有事实 */
  getAllFacts(): OwnerFact[] {
    return Array.from(this.facts.values()).sort((a, b) => b.confidence - a.confidence)
  }

  /** 获取指定键的事实 */
  getFact(key: string): OwnerFact | undefined {
    return this.facts.get(key)
  }

  /** 获取事实数量 */
  get size(): number {
    return this.facts.size
  }

  // ============ 规则提取 ============

  /**
   * 从对话文本中提取用户事实（规则层）
   * @param userMessage 用户消息
   * @returns 提取到的事实列表
   */
  extractFromText(userMessage: string): { key: string; value: string }[] {
    const extracted: { key: string; value: string }[] = []

    for (const rule of EXTRACTION_RULES) {
      const match = userMessage.match(rule.pattern)
      if (match && match[rule.group]) {
        const value = match[rule.group].trim()
        if (value.length > 0 && value.length <= 30) {
          // 避免提取到代词等无意义词
          const stopWords = ['你', '我', '他', '她', '它', '什么', '怎么', 'why', 'what', 'how']
          if (!stopWords.includes(value.toLowerCase())) {
            extracted.push({ key: rule.key, value })
          }
        }
      }
    }

    return extracted
  }

  /**
   * 从对话中提取并保存事实
   * @param userMessage 用户消息
   * @returns 是否提取到新事实
   */
  async extractAndSave(userMessage: string): Promise<boolean> {
    const extracted = this.extractFromText(userMessage)
    if (extracted.length === 0) return false

    let hasNew = false
    for (const { key, value } of extracted) {
      const existing = this.facts.get(key)
      // 已有同值事实则跳过
      if (existing?.value === value) continue
      // 规则提取置信度 0.6
      await this.upsertFact(key, value, 0.6, false)
      hasNew = true
    }

    return hasNew
  }

  // ============ LLM 提取 ============

  /**
   * 使用 LLM 从对话中提取用户事实
   * @param userMessage 用户消息
   * @param aiReply AI 回复
   * @param llmExtractor LLM 提取函数
   */
  async extractWithLLM(
    userMessage: string,
    aiReply: string,
    llmExtractor: (context: string) => Promise<{ key: string; value: string; confidence: number }[]>,
  ): Promise<boolean> {
    try {
      const context = `User: ${userMessage}\nAI: ${aiReply}`
      const facts = await llmExtractor(context)
      let hasNew = false
      for (const { key, value, confidence } of facts) {
        if (!key || !value || value.length > 100) continue
        const existing = this.facts.get(key)
        if (existing?.value === value) continue
        await this.upsertFact(key, value, Math.min(0.95, Math.max(0.7, confidence)), false)
        hasNew = true
      }
      return hasNew
    } catch {
      return false
    }
  }

  /**
   * P3-3：使用内置 LLM 客户端自动提取用户事实
   * 在对话完成后异步调用，不需要外部传入提取函数
   * P4-5：提取前先检查已有事实，如果所有可提取的事实都已存在则跳过 LLM 调用
   * @param userMessage 用户消息
   * @param aiReply AI 回复
   */
  async autoExtractWithLLM(userMessage: string, aiReply: string): Promise<boolean> {
    // P4-5：先通过规则层快速检查——如果规则层已经提取过且无新事实，跳过 LLM 调用
    const ruleExtracted = this.extractFromText(userMessage)
    const allExisting = ruleExtracted.every(({ key, value }) => {
      const existing = this.facts.get(key)
      return existing?.value === value
    })
    if (ruleExtracted.length > 0 && allExisting) {
      // 规则层已提取过且全部已存在，不需要 LLM 再提取
      return false
    }

    try {
      const { getLLMClient } = await import('./llmClient')
      const client = getLLMClient()
      const context = `User: ${userMessage}\nAI: ${aiReply}`

      const response = await client.chatOnce([
        {
          id: 'fact-extract-sys',
          role: 'system',
          content: `你是一个信息提取助手。请分析对话，提取关于用户（User）的稳定事实。
只提取以下类别的事实：name(名字)、pet(宠物)、job(职业)、birthday(生日)、location(位置)、preference(偏好)、family(家人)
输出 JSON 数组格式，每个元素包含 key、value、confidence(0.7-0.95)。
如果没有可提取的事实，输出空数组 []。
示例：[{"key":"name","value":"小明","confidence":0.9}]`,
          timestamp: Date.now(),
        },
        {
          id: 'fact-extract-user',
          role: 'user',
          content: context,
          timestamp: Date.now(),
        },
      ])

      // 解析 JSON 响应
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return false

      const facts = JSON.parse(jsonMatch[0]) as { key: string; value: string; confidence: number }[]
      let hasNew = false
      for (const { key, value, confidence } of facts) {
        if (!key || !value || value.length > 100) continue
        const existing = this.facts.get(key)
        if (existing?.value === value) continue
        await this.upsertFact(key, value, Math.min(0.95, Math.max(0.7, confidence)), false)
        hasNew = true
      }
      return hasNew
    } catch {
      return false
    }
  }

  // ============ 上下文注入 ============

  /**
   * 生成注入到 system prompt 的事实上下文
   * 始终注入，预算约 300~500 token
   * @param tokenBudget token 预算上限
   * @returns 格式化的事实上下文字符串（空字符串表示无事实）
   */
  buildContext(tokenBudget: number = 500): string {
    if (this.facts.size === 0) return ''

    const parts: string[] = ['【关于主人】']
    let usedTokens = estimateTokens('【关于主人】')

    // 按置信度排序，高置信度优先
    const sorted = this.getAllFacts()
    for (const fact of sorted) {
      const label = FACT_LABELS[fact.key] ?? fact.key
      const line = `${label}：${fact.value}`
      const lineTokens = estimateTokens(line) + 2
      if (usedTokens + lineTokens > tokenBudget) break
      parts.push(line)
      usedTokens += lineTokens
    }

    if (parts.length <= 1) return ''

    parts.push('（以上是关于主人已知的信息，请在对话中自然运用，不要生硬复述。）')
    return parts.join('\n')
  }

  // ============ 导出/导入 ============

  export(): string {
    return JSON.stringify({
      facts: Array.from(this.facts.values()),
    }, null, 2)
  }

  async import(jsonStr: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonStr)
      const facts: OwnerFact[] = data.facts ?? []
      this.facts.clear()
      for (const f of facts) {
        this.facts.set(f.key, f)
      }
      // T-1: 行级路径下全量同步到表
      if (this.useRowLevelStorage) {
        await clearOwnerFacts(this.characterId)
        for (const fact of this.facts.values()) {
          await upsertOwnerFact({
            character_id: this.characterId,
            fact_id: fact.id,
            fact_key: fact.key,
            fact_value: fact.value,
            source_memory_id: fact.sourceMemoryId ?? null,
            confidence: fact.confidence,
            updated_at: fact.updatedAt,
            user_provided: fact.userProvided ? 1 : 0,
          })
        }
      } else {
        await this.save()
      }
      return true
    } catch {
      return false
    }
  }

  // ============ 清空 ============

  async clear(): Promise<void> {
    this.facts.clear()
    // T-1: 行级路径清空表
    if (this.useRowLevelStorage) {
      try {
        await clearOwnerFacts(this.characterId)
      } catch (e) {
        console.error(`[OwnerFacts] 行级清空失败:`, e)
      }
    } else {
      await this.save()
    }
  }

  // ============ 销毁 ============

  dispose(): void {
    this.facts.clear()
    removeOwnerFactsManager(this.characterId)
  }
}

// ============ 单例缓存 ============

const managers = new Map<string, OwnerFactsManager>()

export function getOwnerFactsManager(characterId: string): OwnerFactsManager {
  let mgr = managers.get(characterId)
  if (!mgr) {
    mgr = new OwnerFactsManager(characterId)
    managers.set(characterId, mgr)
  }
  return mgr
}

export function removeOwnerFactsManager(characterId: string): void {
  managers.delete(characterId)
}
