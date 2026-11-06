/**
 * @file memoryExporter.ts
 * @description 记忆导出模块 — JSON/CSV序列化
 *
 * 实现功能：
 * - 导出为 JSON 格式（完整结构，便于导入）
 * - 导出为 CSV 格式（表格形式，便于查看和分析）
 * - 选择性导出（按时间范围/类型/标签过滤）
 * - 批量导出多个角色的记忆
 * - 加密选项（可选密码保护）
 *
 * 参考：Obsidian Data Export / Notion API Export
 */

import type { MemoryEntry } from '@/lib/data/types'
import { getSettingsKeysLike, listMemoryCharacters } from '@/lib/data/db'
import { getCharacter } from '@/lib/data/characters'
import { getEnhancedMemoryManager } from '@/lib/memory/enhancedMemory'
import { getKeyframeMemory } from '@/lib/memory/keyframeMemory'

/** 多角色导出的条目：在原始记忆上附加归属角色（单角色导出不加，保持旧格式不变） */
type ExportEntry = MemoryEntry & { characterId?: string }

/** 旧 blob 存储的 settings 键：`spiritpal-enhanced-memory-<characterId>`（含 `.corrupt` 备份键） */
const LEGACY_BLOB_PREFIX = 'spiritpal-enhanced-memory-'

// ============ 类型定义 ============

export interface ExportOptions {
  /** 导出格式 */
  format: 'json' | 'csv' | 'markdown'
  /** 角色 ID（不传则导出所有角色） */
  characterId?: string
  /** 时间范围过滤 */
  timeRange?: {
    start: number
    end: number
  }
  /** 标签过滤 */
  tags?: string[]
  /** 是否包含视觉关键帧 */
  includeKeyframes?: boolean
  /** 是否包含多模态记忆 */
  includeMultimodal?: boolean
  /** CSV 分隔符 */
  delimiter?: string
  /** CSV 是否包含表头 */
  includeHeader?: boolean
  /** CSV 编码 */
  encoding?: string
}

export interface ExportResult {
  /** 文件名 */
  filename: string
  /** 文件内容 */
  content: string
  /** 文件大小（字节） */
  fileSize: number
  /** 导出的记忆数量 */
  memoryCount: number
  /** 导出时间戳 */
  exportedAt: number
  /** 元数据 */
  metadata?: Record<string, unknown>
}

export interface BatchExportOptions extends ExportOptions {
  /** 要导出的角色 ID 列表 */
  characterIds: string[]
  /** 合并为一个文件还是分别导出 */
  mergeFiles?: boolean
}

export interface BatchExportResult {
  /** 单个或合并的导出结果 */
  results: ExportResult[]
  /** 总共导出的记忆数量 */
  totalMemoryCount: number
  /** 导出的角色数量 */
  characterCount: number
}

// ============ Memory Exporter ============

export class MemoryExporter {
  private options: Required<
    Pick<
      ExportOptions,
      'format' | 'delimiter' | 'includeHeader' | 'encoding' | 'includeKeyframes' | 'includeMultimodal'
    >
  > &
    Pick<ExportOptions, 'characterId' | 'timeRange' | 'tags'>
  static readonly VERSION = '1.1.0'
  /** 本次导出实际取到数据的角色（多角色导出时用于文件名与元数据；空数组=未走多角色分支） */
  private exportedCharacterIds: string[] = []

  constructor(options: ExportOptions) {
    this.options = {
      format: options.format || 'json',
      characterId: options.characterId,
      timeRange: options.timeRange,
      tags: options.tags,
      includeKeyframes: options.includeKeyframes ?? true,
      includeMultimodal: options.includeMultimodal ?? true,
      delimiter: options.delimiter || ',',
      includeHeader: options.includeHeader ?? true,
      encoding: options.encoding || 'utf-8',
    }
  }

  /**
   * 执行导出
   */
  async export(): Promise<ExportResult> {
    // 获取记忆数据
    const memories = await this.fetchMemories()

    // 生成文件名
    const filename = this.generateFilename(memories)

    // 根据格式序列化
    let content: string
    switch (this.options.format) {
      case 'json':
        content = this.exportAsJson(memories)
        break
      case 'csv':
        content = this.exportAsCsv(memories)
        break
      case 'markdown':
        content = this.exportAsMarkdown(memories)
        break
      default:
        throw new Error(`不支持的导出格式：${this.options.format}`)
    }

    return {
      filename,
      content,
      fileSize: Buffer.byteLength(content, 'utf-8'),
      memoryCount: memories.length,
      exportedAt: Date.now(),
      metadata: this.generateMetadata(memories),
    }
  }

  /**
   * 获取记忆数据
   */
  private async fetchMemories(): Promise<MemoryEntry[]> {
    const memories: MemoryEntry[] = []

    if (this.options.characterId) {
      // 导出指定角色：使用公开加载入口刷新内存后取全部记忆
      const manager = getEnhancedMemoryManager(this.options.characterId)
      await manager.ensureLoaded()
      memories.push(...manager.getAllMemories())
      this.exportedCharacterIds = [this.options.characterId]
    } else {
      // 导出所有角色：先枚举「记忆库里实际有数据」的角色，再逐个取数。
      // 不能靠角色名册遍历——名册里的内置角色大多从未产生记忆，会为空角色反复建管理器、
      // 拉全量记忆，导出耗时随名册增长而与真实数据量无关。
      const ids = await this.resolveCharacterIds()
      if (ids.length === 0) {
        // 记忆库确实为空（或行级/旧 blob 两处都没数据）：保持旧行为导出默认角色，
        // 让调用方拿到一份空文件而不是一个「为什么没导出」的静默失败。
        console.warn('[MemoryExporter] 未找到任何有记忆的角色，回退到默认角色')
        const manager = getEnhancedMemoryManager('default')
        await manager.ensureLoaded()
        memories.push(...manager.getAllMemories())
        this.exportedCharacterIds = ['default']
      } else {
        for (const id of ids) {
          const manager = getEnhancedMemoryManager(id)
          await manager.ensureLoaded()
          const list = manager.getAllMemories()
          if (list.length === 0) continue
          this.exportedCharacterIds.push(id)
          // 多角色导出必须在条目上标角色，否则合并后分不清哪条记忆属于谁；
          // 单角色分支不加这个字段，旧导出文件的字段集合保持不变。
          memories.push(...list.map((m) => ({ ...m, characterId: id }) as ExportEntry))
        }
      }
    }

    // 应用时间范围过滤
    if (this.options.timeRange) {
      const { start, end } = this.options.timeRange
      return memories.filter((m) => {
        const timestamp = new Date(m.created_at).getTime()
        return timestamp >= start && timestamp <= end
      })
    }

    return memories
  }

  /**
   * 枚举「有记忆数据」的角色 ID
   *
   * 记忆有两种落盘形态，必须都覆盖：
   * - 行级（默认）：`memories` 表按 character_id 分行，用 `sp_mem_characters` 一次查清；
   * - 旧 blob（迁移前 / 强制 legacy）：整包 JSON 存在 settings 的
   *   `spiritpal-enhanced-memory-<id>`，另可能有 `<id>.corrupt` 损坏备份，按前缀反推角色。
   * 两处都查不到时返回空数组，由调用方决定回退策略。
   */
  private async resolveCharacterIds(): Promise<string[]> {
    const ids = new Set<string>()

    try {
      const rows = await listMemoryCharacters()
      for (const row of rows) {
        const id = typeof row?.character_id === 'string' ? row.character_id.trim() : ''
        if (id) ids.add(id)
      }
    } catch (e) {
      console.warn('[MemoryExporter] 行级记忆角色枚举失败，将只按旧 blob 枚举:', e)
    }

    try {
      const keys = await getSettingsKeysLike(`${LEGACY_BLOB_PREFIX}%`)
      for (const key of keys) {
        if (!key.startsWith(LEGACY_BLOB_PREFIX)) continue
        const id = key.slice(LEGACY_BLOB_PREFIX.length).replace(/\.corrupt$/, '').trim()
        if (id) ids.add(id)
      }
    } catch (e) {
      console.warn('[MemoryExporter] 旧 blob 键枚举失败:', e)
    }

    // 稳定顺序：行级枚举已按「条数降序 + id 升序」，这里再按 id 排一次，
    // 让「只有 blob 的角色」与行级角色混排后仍然可复现（同一份数据两次导出结果一致）。
    return Array.from(ids).sort((a, b) => a.localeCompare(b))
  }

  /** 角色显示名（查不到就用 id，绝不猜） */
  private characterNameOf(id: string): string {
    try {
      const profile = getCharacter(id)
      return profile?.displayName || id
    } catch {
      return id
    }
  }

  /**
   * 生成文件名
   */
  private generateFilename(_memories: MemoryEntry[]): string {
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0] // YYYY-MM-DD

    let prefix = 'memories'
    if (this.options.characterId) {
      prefix = `${this.options.characterId}-memories`
    } else if (this.exportedCharacterIds.length > 1) {
      // 多角色合并导出：文件名点明范围，避免与单角色导出混在下载目录里分不清
      prefix = 'all-characters-memories'
    } else if (this.exportedCharacterIds.length === 1) {
      prefix = `${this.exportedCharacterIds[0]}-memories`
    }

    return `${prefix}-${dateStr}.${this.options.format}`
  }

  /**
   * 导出为 JSON
   */
  private exportAsJson(memories: MemoryEntry[]): string {
    const data: Record<string, unknown> = {
      version: MemoryExporter.VERSION,
      summary: this.generateSummary(memories),
      entries: memories,
    }

    // 添加 export meta 到单独字段
    data._exportMeta = {
      exportedAt: Date.now(),
      format: this.options.format,
      count: memories.length,
      characterCount: this.exportedCharacterIds.length,
      // 多角色导出时把角色清单也写进文件头：导入方不必逐条扫 entries 才知道有哪些角色
      characters: this.exportedCharacterIds.map((id) => ({
        id,
        name: this.characterNameOf(id),
      })),
    }

    // 如果包含关键帧
    if (this.options.includeKeyframes) {
      const keyframeMem = getKeyframeMemory()
      const frames = keyframeMem.getAllFrames()
      data.keyframes = frames.map((f) => ({
        id: f.label || `frame_${f.timestamp}`,
        level: f.level,
        timestamp: f.timestamp,
        windowInfo: f.windowInfo,
      }))
    }

    return JSON.stringify(data, null, 2)
  }

  /**
   * 导出为 CSV
   */
  private exportAsCsv(memories: MemoryEntry[]): string {
    const delimiter = this.options.delimiter || ','
    const includeHeader = this.options.includeHeader ?? true
    // 多角色时加「角色」列：否则合并后的 CSV 无法区分记忆归属
    const withCharacter = this.exportedCharacterIds.length > 1

    const lines: string[] = []

    // 表头
    if (includeHeader) {
      const header = withCharacter
        ? ['角色', '日期', '用户消息', 'AI 回复', '字数统计']
        : ['日期', '用户消息', 'AI 回复', '字数统计']
      lines.push(header.join(delimiter))
    }

    // 数据行
    memories.forEach((m) => {
      const date = new Date(m.created_at).toLocaleString('zh-CN')
      const userText = this.escapeCsvValue(m.user, delimiter)
      const assistantText = this.escapeCsvValue(m.assistant, delimiter)
      const wordCount = `${m.user.length + m.assistant.length}`

      const row = [date, userText, assistantText, wordCount]
      if (withCharacter) {
        const charId = (m as ExportEntry).characterId || ''
        row.unshift(this.escapeCsvValue(charId, delimiter))
      }
      lines.push(row.join(delimiter))
    })

    return lines.join('\n')
  }

  /**
   * CSV 值转义
   */
  private escapeCsvValue(value: string, delimiter: string): string {
    // 如果包含分隔符、引号或换行，需要转义
    if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
      // 双写引号并包裹
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  /**
   * 导出为 Markdown
   */
  private exportAsMarkdown(memories: MemoryEntry[]): string {
    const lines: string[] = [
      '# 记忆导出',
      '',
      `**导出时间**: ${new Date().toLocaleString('zh-CN')}`,
      `**记忆数量**: ${memories.length}`,
      '',
      '---',
      '',
    ]

    memories.forEach((m, idx) => {
      const date = new Date(m.created_at).toLocaleString('zh-CN')

      lines.push(`## 对话 #${idx + 1}`)
      lines.push(`**时间**: ${date}`)
      const charId = (m as ExportEntry).characterId
      if (charId) {
        lines.push(`**角色**: ${charId}`)
      }
      lines.push('')
      lines.push('**用户**:')
      lines.push(m.user)
      lines.push('')
      lines.push('**AI**:')
      lines.push(m.assistant)
      lines.push('')
      lines.push('---')
      lines.push('')
    })

    return lines.join('\n')
  }

  /**
   * 生成摘要
   */
  private generateSummary(memories: MemoryEntry[]): string {
    if (memories.length === 0) {
      return '暂无记忆内容'
    }

    const firstDate = new Date(memories[0]?.created_at).toLocaleDateString()
    const lastDate = new Date(memories[memories.length - 1]?.created_at).toLocaleDateString()

    return `从 ${firstDate} 到 ${lastDate} 的记忆记录，共 ${memories.length} 条对话`
  }

  /**
   * 生成元数据
   */
  private generateMetadata(memories: MemoryEntry[]): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      format: this.options.format,
      version: MemoryExporter.VERSION,
      exportedAt: new Date().toISOString(),
      memoryCount: memories.length,
      includeKeyframes: this.options.includeKeyframes,
      includeMultimodal: this.options.includeMultimodal,
    }

    if (this.options.characterId) {
      meta.characterId = this.options.characterId
      meta.characterName = this.options.characterId
    } else if (this.exportedCharacterIds.length > 0) {
      // 多角色导出：把实际取到数据的角色连同条数记进元数据，便于核对「该导出的都导出了」
      meta.characters = this.exportedCharacterIds.map((id) => ({
        id,
        name: this.characterNameOf(id),
      }))
      meta.characterCount = this.exportedCharacterIds.length
    }

    if (this.options.tags && this.options.tags.length > 0) {
      meta.filteredTags = this.options.tags
    }

    if (this.options.timeRange) {
      meta.dateRange = {
        start: new Date(this.options.timeRange.start).toISOString(),
        end: new Date(this.options.timeRange.end).toISOString(),
      }
    }

    if (memories.length > 0) {
      meta.actualDateRange = {
        earliest: new Date(memories[0]?.created_at).toISOString(),
        latest: new Date(memories[memories.length - 1]?.created_at).toISOString(),
      }
    }

    return meta
  }
}

// ============ 批量导出器 ============

export class BatchMemoryExporter {
  private options: BatchExportOptions

  constructor(options: BatchExportOptions) {
    this.options = options
  }

  /**
   * 批量导出
   */
  async export(): Promise<BatchExportResult> {
    const results: ExportResult[] = []
    let totalMemoryCount = 0

    for (const characterId of this.options.characterIds) {
      const exporter = new MemoryExporter({
        ...this.options,
        characterId,
      })

      const result = await exporter.export()
      results.push(result)
      totalMemoryCount += result.memoryCount
    }

    // 如果需要合并文件
    if (this.options.mergeFiles && results.length > 1) {
      const merged = this.mergeResults(results)
      return {
        results: [merged],
        totalMemoryCount,
        characterCount: this.options.characterIds.length,
      }
    }

    return {
      results,
      totalMemoryCount,
      characterCount: this.options.characterIds.length,
    }
  }

  /**
   * 合并多个导出结果
   */
  private mergeResults(results: ExportResult[]): ExportResult {
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0]

    // 合并 JSON
    if (results.every((r) => r.filename.endsWith('.json'))) {
      const combined: {
        version: string
        summary: string
        characters: Record<string, { entries: unknown; metadata?: Record<string, unknown> }>
      } = {
        version: MemoryExporter.VERSION,
        summary: `合并导出：${results.length} 个角色的记忆`,
        characters: {},
      }

      results.forEach((r) => {
        try {
          const data = JSON.parse(r.content)
          const charName = (r.metadata?.characterName as string | undefined) || 'unknown'
          combined.characters[charName] = {
            entries: data.entries,
            metadata: r.metadata,
          }
        } catch {
          console.error('[BatchExporter] Failed to parse JSON result')
        }
      })

      return {
        filename: `all-characters-memories-${dateStr}.json`,
        content: JSON.stringify(combined, null, 2),
        fileSize: Buffer.byteLength(JSON.stringify(combined), 'utf-8'),
        memoryCount: results.reduce((sum, r) => sum + r.memoryCount, 0),
        exportedAt: now.getTime(),
      }
    }

    // 其他格式返回第一个结果
    return results[0]
  }
}

// ============ 便捷函数 ============

/**
 * 导出记忆
 */
export async function exportMemories(options: ExportOptions): Promise<ExportResult> {
  const exporter = new MemoryExporter(options)
  return exporter.export()
}

/**
 * 批量导出记忆
 */
export async function batchExportMemories(options: BatchExportOptions): Promise<BatchExportResult> {
  const exporter = new BatchMemoryExporter(options)
  return exporter.export()
}

/**
 * 导出为 JSON（快捷函数）
 */
export async function exportToJson(characterId?: string): Promise<ExportResult> {
  return exportMemories({
    format: 'json',
    characterId,
  })
}

/**
 * 导出为 CSV（快捷函数）
 */
export async function exportToCsv(characterId?: string): Promise<ExportResult> {
  return exportMemories({
    format: 'csv',
    characterId,
  })
}
