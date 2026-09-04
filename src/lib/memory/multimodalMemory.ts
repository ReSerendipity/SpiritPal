/**
 * @file multimodalMemory.ts
 * @description 多模态记忆模块 — 支持语音、图像、文本等多种类型的记忆融合
 * 
 * 实现功能：
 * - 扩展记忆数据结构支持多模态内容
 * - 语音记忆：录音文件 + 转写文本 + 情感分析
 * - 图像记忆：截图/照片 + OCR 文本 + 视觉标签
 * - 文本记忆：纯文本对话/笔记
 * - 统一检索接口：跨模态语义搜索
 * 
 * 参考：Live2DPet multimodal_memory.py / OpenPets packages/memory/multimodal/
 */

import type { MemoryEntry } from '@/lib/data/types'

// ============ 类型定义 ============

/** 记忆类型枚举 */
export type MemoryType = 'text' | 'voice' | 'image' | 'mixed'

/** 基础记忆元数据 */
export interface MemoryMetadata {
  /** 记忆唯一 ID */
  id: string
  /** 创建时间戳 */
  createdAt: number
  /** 最后访问时间戳 */
  lastAccessedAt: number
  /** 记忆类型 */
  type: MemoryType
  /** 关联的角色 ID */
  characterId?: string
  /** 标签列表 */
  tags: string[]
  /** 重要性评分（0-1） */
  importance: number
  /** 情感倾向（positive/neutral/negative） */
  sentiment?: 'positive' | 'neutral' | 'negative'
  /** 上下文信息 */
  context?: {
    location?: string
    application?: string
    activity?: string
  }
}

/** 语音记忆详情 */
export interface VoiceMemoryContent {
  /** 音频文件路径/URL */
  audioPath: string
  /** 音频时长（秒） */
  duration: number
  /** 语音转写文本 */
  transcribedText: string
  /** 转写置信度（0-1） */
  transcriptionConfidence: number
  /** 说话人 ID（可选） */
  speakerId?: string
  /** 语音情感分析结果 */
  emotionAnalysis?: {
    primaryEmotion: string
    emotions: Record<string, number>
  }
  /** 关键短语提取 */
  keyPhrases?: string[]
}

/** 图像记忆详情 */
export interface ImageMemoryContent {
  /** 图片文件路径/URL */
  imagePath: string
  /** 图片尺寸 */
  dimensions?: { width: number; height: number }
  /** OCR 提取的文本 */
  ocrText?: string
  /** OCR 置信度 */
  ocrConfidence?: number
  /** 视觉标签（物体/场景/人脸等） */
  visualTags?: Array<{
    label: string
    confidence: number
    boundingBox?: { x: number; y: number; w: number; h: number }
  }>
  /** 图像描述（Vision LLM 生成） */
  imageDescription?: string
  /** 图片颜色主题 */
  colorPalette?: string[]
}

/** 文本记忆详情 */
export interface TextMemoryContent {
  /** 主文本内容 */
  text: string
  /** 分段内容（长文本时） */
  segments?: Array<{
    text: string
    startOffset: number
    endOffset: number
  }>
  /** 关键词提取 */
  keywords?: string[]
  /** 摘要（自动生成） */
  summary?: string
  /** 语言代码 */
  language?: string
}

/** 统一的记忆条目 */
export interface MultimodalMemoryEntry extends MemoryMetadata {
  /** 内容类型相关的详细数据 */
  content: {
    type: 'text'
    data: TextMemoryContent
  } | {
    type: 'voice'
    data: VoiceMemoryContent
  } | {
    type: 'image'
    data: ImageMemoryContent
  } | {
    type: 'mixed'
    text?: TextMemoryContent
    voice?: VoiceMemoryContent
    image?: ImageMemoryContent
  }
  
  /** 用于向量检索的嵌入表示 */
  embedding?: Float32Array
  
  /** 关联的记忆条目 ID（用于建立关系） */
  relatedMemoryIds?: string[]
}

/** 记忆查询参数 */
export interface MemoryQuery {
  /** 搜索关键词 */
  query?: string
  /** 记忆类型过滤 */
  type?: MemoryType
  /** 时间范围 */
  timeRange?: {
    start: number
    end: number
  }
  /** 标签过滤 */
  tags?: string[]
  /** 角色过滤 */
  characterId?: string
  /** 最小重要性 */
  minImportance?: number
  /** 返回数量限制 */
  limit?: number
  /** 是否包含嵌入向量 */
  includeEmbedding?: boolean
}

/** 记忆搜索结果 */
export interface MemorySearchResult {
  /** 匹配的记忆条目 */
  memories: MultimodalMemoryEntry[]
  /** 总匹配数 */
  total: number
  /** 搜索耗时（毫秒） */
  latency: number
  /** 相关性分数（按条目排序） */
  scores?: number[]
}

// ============ 多模态记忆管理器 ============

export class MultimodalMemoryManager {
  private memories: Map<string, MultimodalMemoryEntry> = new Map()
  private indexBuilt: boolean = false
  
  /**
   * 添加新的记忆条目
   */
  addMemory(memory: MultimodalMemoryEntry): void {
    this.memories.set(memory.id, memory)
    this.indexBuilt = false // 标记索引需要重建
  }

  /**
   * 批量添加记忆
   */
  addMemories(memories: MultimodalMemoryEntry[]): void {
    memories.forEach(m => this.memories.set(m.id, m))
    this.indexBuilt = false
  }

  /**
   * 根据 ID 获取记忆
   */
  getMemory(id: string): MultimodalMemoryEntry | undefined {
    const memory = this.memories.get(id)
    if (memory) {
      // 更新访问时间
      memory.lastAccessedAt = Date.now()
    }
    return memory
  }

  /**
   * 删除记忆
   */
  deleteMemory(id: string): boolean {
    return this.memories.delete(id)
  }

  /**
   * 搜索记忆（支持跨模态）
   */
  async search(query: MemoryQuery): Promise<MemorySearchResult> {
    const startTime = Date.now()
    
    let results = Array.from(this.memories.values())
    
    // 应用过滤器
    if (query.type) {
      results = results.filter(m => m.type === query.type || m.type === 'mixed')
    }
    
    if (query.timeRange) {
      results = results.filter(m => 
        m.createdAt >= query.timeRange!.start && 
        m.createdAt <= query.timeRange!.end
      )
    }
    
    if (query.tags && query.tags.length > 0) {
      results = results.filter(m => 
        query.tags!.some(tag => m.tags.includes(tag))
      )
    }
    
    if (query.characterId) {
      results = results.filter(m => m.characterId === query.characterId)
    }
    
    if (query.minImportance !== undefined) {
      results = results.filter(m => m.importance >= query.minImportance!)
    }
    
    // 关键词搜索
    if (query.query) {
      const queryLower = query.query.toLowerCase()
      results = results.filter(m => this.matchesQuery(m, queryLower))
    }
    
    // 按时间倒序排序
    results.sort((a, b) => b.createdAt - a.createdAt)
    
    // 限制数量
    const limit = query.limit ?? 50
    results = results.slice(0, limit)
    
    const latency = Date.now() - startTime
    
    return {
      memories: results,
      total: results.length,
      latency,
    }
  }

  /**
   * 检查记忆是否匹配查询
   */
  private matchesQuery(memory: MultimodalMemoryEntry, query: string): boolean {
    // 在文本内容中搜索
    if (memory.content.type === 'text' && memory.content.data.text.toLowerCase().includes(query)) {
      return true
    }
    
    if (memory.content.type === 'voice' && memory.content.data.transcribedText.toLowerCase().includes(query)) {
      return true
    }
    
    if (memory.content.type === 'image' && memory.content.data.ocrText?.toLowerCase().includes(query)) {
      return true
    }
    
    if (memory.content.type === 'mixed') {
      if (memory.content.text?.text.toLowerCase().includes(query)) return true
      if (memory.content.voice?.transcribedText.toLowerCase().includes(query)) return true
      if (memory.content.image?.ocrText?.toLowerCase().includes(query)) return true
    }
    
    // 在标签和关键词中搜索
    if (memory.tags.some(tag => tag.toLowerCase().includes(query))) {
      return true
    }
    
    if (memory.content.type === 'text' && memory.content.data.keywords?.some(kw => kw.toLowerCase().includes(query))) {
      return true
    }
    
    // 在上下文中搜索
    if (memory.context) {
      const contextStr = JSON.stringify(memory.context).toLowerCase()
      if (contextStr.includes(query)) {
        return true
      }
    }
    
    return false
  }

  /**
   * 获取所有记忆（可选过滤）
   */
  getAllMemories(filters?: {
    type?: MemoryType
    characterId?: string
    limit?: number
  }): MultimodalMemoryEntry[] {
    let result = Array.from(this.memories.values())
    
    if (filters?.type) {
      result = result.filter(m => m.type === filters.type || m.type === 'mixed')
    }
    
    if (filters?.characterId) {
      result = result.filter(m => m.characterId === filters.characterId)
    }
    
    if (filters?.limit) {
      result = result.slice(0, filters.limit)
    }
    
    return result
  }

  /**
   * 获取记忆统计信息
   */
  getStatistics(): {
    total: number
    byType: Record<MemoryType, number>
    recentCount: number
    avgImportance: number
  } {
    const allMemories = Array.from(this.memories.values())
    
    const byType: Record<MemoryType, number> = {
      text: 0,
      voice: 0,
      image: 0,
      mixed: 0,
    }
    
    allMemories.forEach(m => {
      byType[m.type]++
    })
    
    const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000 // 最近 7 天
    const recentCount = allMemories.filter(m => m.createdAt > recentCutoff).length
    
    const avgImportance = allMemories.length > 0
      ? allMemories.reduce((sum, m) => sum + m.importance, 0) / allMemories.length
      : 0
    
    return {
      total: allMemories.length,
      byType,
      recentCount,
      avgImportance,
    }
  }

  /**
   * 清空所有记忆
   */
  clear(): void {
    this.memories.clear()
    this.indexBuilt = false
  }

  /**
   * 导出记忆为 JSON
   */
  exportToJson(): string {
    const allMemories = Array.from(this.memories.values())
    // 注意：移除 embedding 字段（Float32Array 不可 JSON 序列化）
    const exportable = allMemories.map(m => ({
      ...m,
      embedding: m.embedding ? `[Float32Array(${m.embedding.length})]` : undefined,
    }))
    return JSON.stringify(exportable, null, 2)
  }

  /**
   * 从 JSON 导入记忆
   */
  importFromJson(jsonString: string): number {
    try {
      const imported = JSON.parse(jsonString) as MultimodalMemoryEntry[]
      this.addMemories(imported)
      return imported.length
    } catch (error) {
      console.error('[MultimodalMemory] Failed to import:', error)
      return 0
    }
  }
}

// ============ 单例 ============

let instance: MultimodalMemoryManager | null = null

export function getMultimodalMemoryManager(): MultimodalMemoryManager {
  if (!instance) {
    instance = new MultimodalMemoryManager()
  }
  return instance
}

export function resetMultimodalMemoryManager(): void {
  if (instance) {
    instance.clear()
    instance = null
  }
}
