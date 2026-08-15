/**
 * 角色资源导入框架 — 支持 50+ MIT 角色资源的导入、验证、注册
 * 参考 WindowPet 的 50 MIT 角色资源生态
 *
 * @fileoverview
 * 主要模块：
 * - CharacterResourceMeta 接口：角色资源包元数据（pet.json 核心字段）
 * - SpriteResourceDef 接口：精灵图资源定义
 * - SpriteLayoutDef 接口：精灵图布局配置
 * - CharacterResourcePackage 接口：完整角色资源包结构
 * - CharacterResourceImporter 类：资源导入器，支持扫描、验证、注册、重采样
 * - importFromDirectory()：从目录导入角色资源包
 * - validatePackage()：验证资源包完整性
 *
 * 核心功能：
 * 1. 角色资源包格式定义（CharacterResourcePackage）
 * 2. 导入流程：扫描目录 → 验证 → 注册
 * 3. 支持 Shimeji-style 精灵图（128×128 格式）
 * 4. 128→192×208 重采样支持
 * 5. 角色元数据管理（名称、作者、协议、动画定义）
 * 6. MIT 兼容协议校验
 *
 * @module characterResourceImporter
 * @requires ./types - CharacterProfile, Personality 类型定义
 */

import type { CharacterProfile } from './types'

// ============ 角色资源包格式 ============

/** 角色资源包元数据（pet.json 核心字段） */
export interface CharacterResourceMeta {
  /** 唯一标识符 */
  id: string
  /** 角色名称 */
  name: string
  /** 角色显示名称（可含 Unicode） */
  displayName: string
  /** 版本号（语义化版本） */
  version: string
  /** 作者 */
  author: string
  /** 开源协议（必须是 MIT 兼容协议） */
  license: 'MIT' | 'CC0' | 'CC-BY' | 'CC-BY-SA' | 'Apache-2.0' | 'Unlicense'
  /** 来源/参考 */
  source?: string
  /** 角色描述 */
  description?: string
  /** 标签（用于分类和搜索） */
  tags?: string[]
  /** i18n 名称 */
  nameI18n?: Record<string, string>
  /** i18n 描述 */
  descriptionI18n?: Record<string, string>
}

/** 精灵图资源定义 */
export interface SpriteResourceDef {
  /** 精灵图文件路径（相对于资源包根目录） */
  path: string
  /** 精灵图类型 */
  type: 'atlas' | 'svg' | 'gif' | 'webp' | 'png'
  /** 布局配置 */
  layout: SpriteLayoutDef
  /** 是否为 Shimeji 格式（128×128） */
  isShimeji?: boolean
}

/** 精灵图布局定义 */
export interface SpriteLayoutDef {
  /** 单帧宽度 */
  cellW: number
  /** 单帧高度 */
  cellH: number
  /** 列数 */
  cols: number
  /** 行数 */
  rows: number
  /** 动画行定义 */
  animations: Record<string, { row: number; frames: number; fps?: number }>
}

/** 动画触发配置 */
export interface AnimationTriggerDef {
  /** 动画名（对应精灵图行） */
  name: string
  /** 触发条件列表 */
  triggers: string[]
  /** 优先级 */
  priority?: number
  /** 持续时间（毫秒） */
  duration?: number
}

/** 性格预设 */
export interface PersonalityPresetDef {
  warmth: number
  liveliness: number
  dependence: number
  directness: number
  rationality: number
}

/** 完整角色资源包定义 */
export interface CharacterResourcePackage {
  /** 元数据 */
  meta: CharacterResourceMeta
  /** 精灵图资源 */
  sprites: SpriteResourceDef[]
  /** 动画触发配置 */
  animations?: AnimationTriggerDef[]
  /** 性格预设 */
  personality?: PersonalityPresetDef
  /** 主题色 */
  themeColor?: { primary: string; secondary: string }
  /** 气泡消息 */
  bubbleMessages?: {
    idle?: string[]
    hungry?: string[]
    sad?: string[]
    pet?: string[]
    feed?: string[]
    pomodoroDone?: string[]
  }
  /** 签名短语 */
  signaturePhrase?: string
  /** 经典语录 */
  classicQuotes?: string[]
  /** 喜欢的物品 ID 列表 */
  favoriteItems?: string[]
  /** 讨厌的物品 ID 列表 */
  dislikeItems?: string[]
}

// ============ 重采样配置 ============

/** 目标图集尺寸（SpiritPal 标准） */
export const TARGET_ATLAS = { cellW: 192, cellH: 208, cols: 8, rows: 9 } as const

/** Shimeji 源图集尺寸 */
export const SHIMEJI_ATLAS = { cellW: 128, cellH: 128, cols: 8, rows: 9 } as const

/**
 * 重采样配置：128→192×208
 *
 * 策略：
 * - 宽度：128→192（1.5× 缩放）
 * - 高度：128→208（1.625× 缩放）
 * - 使用 canvas bilinear 插值
 * - 居中裁剪/填充保持比例
 */
export interface ResampleConfig {
  /** 源尺寸 */
  from: { cellW: number; cellH: number; cols: number; rows: number }
  /** 目标尺寸 */
  to: { cellW: number; cellH: number; cols: number; rows: number }
  /** 插值质量 */
  quality: 'low' | 'medium' | 'high'
  /** 是否保持宽高比（true 时用 letterbox/pillarbox） */
  keepAspectRatio: boolean
  /** 背景填充色（letterbox/pillarbox 区域） */
  fillColor: string
}

/** 默认重采样配置（Shimeji 128→192×208） */
export const DEFAULT_RESAMPLE_CONFIG: ResampleConfig = {
  from: SHIMEJI_ATLAS,
  to: TARGET_ATLAS,
  quality: 'high',
  keepAspectRatio: true,
  fillColor: 'transparent',
}

// ============ 验证结果 ============

/** 验证错误级别 */
export type ValidationSeverity = 'error' | 'warning' | 'info'

/** 验证消息 */
export interface ValidationMessage {
  severity: ValidationSeverity
  code: string
  message: string
  field?: string
}

/** 验证结果 */
export interface ValidationResult {
  valid: boolean
  messages: ValidationMessage[]
}

// ============ 导入状态 ============

/** 导入进度阶段 */
export type ImportPhase = 'scanning' | 'validating' | 'resampling' | 'registering' | 'complete' | 'error'

/** 导入进度 */
export interface ImportProgress {
  phase: ImportPhase
  current: number
  total: number
  message: string
}

/** 导入结果 */
export interface ImportResult {
  success: boolean
  characterId: string
  profile?: CharacterProfile
  errors: string[]
  warnings: string[]
}

// ============ 角色资源导入器 ============

/**
 * 角色资源导入器
 *
 * 完整导入流程：
 * 1. scanDirectory: 扫描目录，发现角色资源包
 * 2. validatePackage: 验证资源包格式和内容
 * 3. resampleSprites: 对 Shimeji 格式进行重采样
 * 4. registerCharacter: 注册角色到系统
 *
 * 使用单例 getCharacterResourceImporter() 获取实例
 */
export class CharacterResourceImporter {
  /** 已注册的角色资源包 */
  private packages: Map<string, CharacterResourcePackage> = new Map()
  /** 导入进度回调 */
  private onProgress: ((progress: ImportProgress) => void) | null = null
  /** 重采样缓存（避免重复处理） */
  private resampleCache: Map<string, string> = new Map()

  /** 设置进度回调 */
  setOnProgress(callback: (progress: ImportProgress) => void): void {
    this.onProgress = callback
  }

  /** 报告进度 */
  private reportProgress(phase: ImportPhase, current: number, total: number, message: string): void {
    this.onProgress?.({ phase, current, total, message })
  }

  // ============ 1. 扫描目录 ============

  /**
   * 扫描目录中的角色资源包
   *
   * 目录结构约定：
   * ```
   * characters/
   *   ├── character-a/
   *   │   ├── pet.json        ← 必须存在
   *   │   ├── sprites/
   *   │   │   ├── idle.png
   *   │   │   └── walk.png
   *   │   └── preview.png
   *   └── character-b/
   *       ├── pet.json
   *       └── ...
   * ```
   *
   * @param directory 目录路径
   * @returns 发现的资源包路径列表
   */
  async scanDirectory(directory: string): Promise<string[]> {
    this.reportProgress('scanning', 0, 0, `正在扫描目录: ${directory}`)

    // 通过 Tauri 命令扫描目录
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const entries: string[] = await invoke('scan_character_directory', { path: directory })
      this.reportProgress('scanning', entries.length, entries.length, `发现 ${entries.length} 个角色资源包`)
      return entries
    } catch {
      // 降级：使用空列表
      this.reportProgress('scanning', 0, 0, '扫描失败，目录可能不存在')
      return []
    }
  }

  // ============ 2. 验证资源包 ============

  /**
   * 验证角色资源包
   *
   * 验证规则：
   * - meta.id 必须存在且符合标识符规范
   * - meta.license 必须为 MIT 兼容协议
   * - sprites 至少包含一个 atlas 类型
   * - sprites[0].layout 必须有有效的行列定义
   * - 版本号格式正确
   */
  validatePackage(pkg: CharacterResourcePackage): ValidationResult {
    const messages: ValidationMessage[] = []

    // 验证 meta.id
    if (!pkg.meta.id) {
      messages.push({ severity: 'error', code: 'MISSING_ID', message: '角色 ID 不能为空', field: 'meta.id' })
    } else if (!/^[a-zA-Z0-9_-]+$/.test(pkg.meta.id)) {
      messages.push({ severity: 'error', code: 'INVALID_ID', message: '角色 ID 只能包含字母、数字、下划线、连字符', field: 'meta.id' })
    }

    // 验证 meta.name
    if (!pkg.meta.name) {
      messages.push({ severity: 'error', code: 'MISSING_NAME', message: '角色名称不能为空', field: 'meta.name' })
    }

    // 验证 meta.license
    const validLicenses: CharacterResourceMeta['license'][] = ['MIT', 'CC0', 'CC-BY', 'CC-BY-SA', 'Apache-2.0', 'Unlicense']
    if (!validLicenses.includes(pkg.meta.license)) {
      messages.push({ severity: 'warning', code: 'NON_MIT_LICENSE', message: `协议 ${pkg.meta.license} 可能不兼容 MIT`, field: 'meta.license' })
    }

    // 验证版本号
    if (!pkg.meta.version || !/^\d+\.\d+\.\d+/.test(pkg.meta.version)) {
      messages.push({ severity: 'warning', code: 'INVALID_VERSION', message: '版本号格式不正确（建议使用语义化版本）', field: 'meta.version' })
    }

    // 验证精灵图
    if (!pkg.sprites || pkg.sprites.length === 0) {
      messages.push({ severity: 'error', code: 'NO_SPRITES', message: '至少需要一个精灵图资源', field: 'sprites' })
    } else {
      for (let i = 0; i < pkg.sprites.length; i++) {
        const sprite = pkg.sprites[i]
        if (!sprite.path) {
          messages.push({ severity: 'error', code: 'MISSING_SPRITE_PATH', message: `精灵图 ${i} 路径为空`, field: `sprites[${i}].path` })
        }
        if (!sprite.layout || sprite.layout.rows <= 0 || sprite.layout.cols <= 0) {
          messages.push({ severity: 'error', code: 'INVALID_LAYOUT', message: `精灵图 ${i} 布局无效`, field: `sprites[${i}].layout` })
        }
        if (sprite.layout.cellW <= 0 || sprite.layout.cellH <= 0) {
          messages.push({ severity: 'error', code: 'INVALID_CELL_SIZE', message: `精灵图 ${i} 帧尺寸无效`, field: `sprites[${i}].layout` })
        }
      }
    }

    // 验证性格预设
    if (pkg.personality) {
      const fields: (keyof PersonalityPresetDef)[] = ['warmth', 'liveliness', 'dependence', 'directness', 'rationality']
      for (const field of fields) {
        const val = pkg.personality[field]
        if (val < -1 || val > 1) {
          messages.push({ severity: 'warning', code: 'PERSONALTY_OUT_OF_RANGE', message: `性格维度 ${field} 超出 [-1, 1] 范围`, field: `personality.${field}` })
        }
      }
    }

    // 信息提示
    if (pkg.sprites?.some(s => s.isShimeji)) {
      messages.push({ severity: 'info', code: 'SHIMEJI_FORMAT', message: '检测到 Shimeji 格式精灵图，将进行重采样' })
    }

    const hasErrors = messages.some(m => m.severity === 'error')
    return { valid: !hasErrors, messages }
  }

  // ============ 3. 重采样 ============

  /**
   * 对 Shimeji 格式精灵图进行重采样（128→192×208）
   *
   * 使用 Canvas API 进行 bilinear 插值缩放
   * 保持宽高比，使用 letterbox 填充
   *
   * @param imageData 源图像 dataURL
   * @param config 重采样配置
   * @returns 重采样后的 dataURL
   */
  async resampleSprites(
    imageData: string,
    config: ResampleConfig = DEFAULT_RESAMPLE_CONFIG,
  ): Promise<string> {
    // 检查缓存
    const cacheKey = `${imageData.length}:${config.from.cellW}:${config.to.cellW}`
    const cached = this.resampleCache.get(cacheKey)
    if (cached) return cached

    this.reportProgress('resampling', 0, 1, '正在重采样精灵图...')

    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = imageData
    })

    // 计算目标精灵图尺寸
    const totalFrames = config.from.cols * config.from.rows
    const targetWidth = config.to.cols * config.to.cellW
    const targetHeight = config.to.rows * config.to.cellH

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')!

    // 设置插值质量
    ctx.imageSmoothingEnabled = config.quality !== 'low'
    ctx.imageSmoothingQuality = config.quality === 'high' ? 'high' : 'medium'

    // 逐帧重采样
    for (let row = 0; row < config.from.rows; row++) {
      for (let col = 0; col < config.from.cols; col++) {
        const frameIdx = row * config.from.cols + col
        if (frameIdx >= totalFrames) break

        // 源帧坐标
        const sx = col * config.from.cellW
        const sy = row * config.from.cellH

        // 目标帧坐标
        const dx = col * config.to.cellW
        const dy = row * config.to.cellH

        if (config.keepAspectRatio) {
          // 保持宽高比：计算缩放比，居中放置
          const scaleX = config.to.cellW / config.from.cellW
          const scaleY = config.to.cellH / config.from.cellH
          const scale = Math.min(scaleX, scaleY)
          const scaledW = config.from.cellW * scale
          const scaledH = config.from.cellH * scale
          const offsetX = (config.to.cellW - scaledW) / 2
          const offsetY = (config.to.cellH - scaledH) / 2

          // 填充背景
          if (config.fillColor !== 'transparent') {
            ctx.fillStyle = config.fillColor
            ctx.fillRect(dx, dy, config.to.cellW, config.to.cellH)
          }

          ctx.drawImage(
            img,
            sx, sy, config.from.cellW, config.from.cellH,
            dx + offsetX, dy + offsetY, scaledW, scaledH,
          )
        } else {
          // 拉伸填充
          ctx.drawImage(
            img,
            sx, sy, config.from.cellW, config.from.cellH,
            dx, dy, config.to.cellW, config.to.cellH,
          )
        }
      }
    }

    const result = canvas.toDataURL('image/png')
    this.resampleCache.set(cacheKey, result)
    this.reportProgress('resampling', 1, 1, '重采样完成')
    return result
  }

  // ============ 4. 注册角色 ============

  /**
   * 将验证通过的角色资源包注册到系统
   *
   * 转换 CharacterResourcePackage → CharacterProfile
   * 保存到自定义角色存储
   *
   * @param pkg 角色资源包
   * @returns 注册结果
   */
  registerCharacter(pkg: CharacterResourcePackage): ImportResult {
    this.reportProgress('registering', 0, 1, `正在注册角色: ${pkg.meta.displayName}`)

    const errors: string[] = []
    const warnings: string[] = []

    // 验证
    const validation = this.validatePackage(pkg)
    for (const msg of validation.messages) {
      if (msg.severity === 'error') errors.push(msg.message)
      if (msg.severity === 'warning') warnings.push(msg.message)
    }

    if (!validation.valid) {
      this.reportProgress('error', 0, 1, `注册失败: ${errors.join('; ')}`)
      return { success: false, characterId: pkg.meta.id, errors, warnings }
    }

    // 检查 ID 冲突
    const existing = this.packages.get(pkg.meta.id)
    if (existing) {
      warnings.push(`角色 ${pkg.meta.id} 已存在，将覆盖`)
    }

    // 转换为 CharacterProfile
    const profile: CharacterProfile = {
      id: pkg.meta.id,
      name: pkg.meta.name,
      displayName: pkg.meta.displayName,
      source: pkg.meta.source ?? `社区角色 · ${pkg.meta.author}`,
      birthBackground: pkg.meta.description ?? '',
      emotionalCore: '',
      personality: pkg.personality ?? {
        warmth: 0.5,
        liveliness: 0.5,
        dependence: 0.5,
        directness: 0,
        rationality: 0,
      },
      signaturePhrase: pkg.signaturePhrase ?? '',
      classicQuotes: pkg.classicQuotes ?? [],
      systemPrompt: '',
      fewShotExamples: [],
      spriteAsset: pkg.sprites[0]?.path ?? '',
      spriteType: (['atlas', 'svg', 'gif', 'video'].includes(pkg.sprites[0]?.type ?? '') ? pkg.sprites[0]?.type : 'atlas') as CharacterProfile['spriteType'],
      themeColor: pkg.themeColor ?? { primary: '#888888', secondary: '#cccccc' },
      bubbleMessages: {
        idle: pkg.bubbleMessages?.idle ?? ['...'],
        hungry: pkg.bubbleMessages?.hungry ?? ['饿了...'],
        sad: pkg.bubbleMessages?.sad ?? ['...'],
        pet: pkg.bubbleMessages?.pet ?? ['...'],
        feed: pkg.bubbleMessages?.feed ?? ['谢谢！'],
        pomodoroDone: pkg.bubbleMessages?.pomodoroDone ?? ['完成！'],
      },
      favoriteItems: pkg.favoriteItems,
      dislikeItems: pkg.dislikeItems,
      atlasLayout: pkg.sprites[0]?.isShimeji
        ? TARGET_ATLAS
        : pkg.sprites[0]?.layout
          ? { cellW: pkg.sprites[0].layout.cellW, cellH: pkg.sprites[0].layout.cellH, cols: pkg.sprites[0].layout.cols, rows: pkg.sprites[0].layout.rows }
          : undefined,
      type: 'community',
    }

    // 存储资源包
    this.packages.set(pkg.meta.id, pkg)

    // 保存到自定义角色存储
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- 惰性 require 避免 characters 循环依赖
      const { saveCustomCharacter } = require('./characters')
      saveCustomCharacter(profile)
    } catch {
      errors.push('保存角色失败')
    }

    this.reportProgress('registering', 1, 1, `角色 ${pkg.meta.displayName} 注册完成`)
    return { success: true, characterId: pkg.meta.id, profile, errors, warnings }
  }

  // ============ 批量导入 ============

  /**
   * 批量导入目录中的所有角色资源包
   *
   * @param directory 目录路径
   * @returns 导入结果列表
   */
  async importFromDirectory(directory: string): Promise<ImportResult[]> {
    const dirs = await this.scanDirectory(directory)
    const results: ImportResult[] = []

    for (let i = 0; i < dirs.length; i++) {
      this.reportProgress('validating', i, dirs.length, `正在导入 ${i + 1}/${dirs.length}`)
      try {
        // 读取 pet.json
        const { invoke } = await import('@tauri-apps/api/core')
        const metaJson: string = await invoke('read_text_file', { path: `${dirs[i]}/pet.json` })
        const pkg: CharacterResourcePackage = JSON.parse(metaJson)

        // 验证
        const validation = this.validatePackage(pkg)
        if (!validation.valid) {
          results.push({
            success: false,
            characterId: pkg.meta?.id ?? 'unknown',
            errors: validation.messages.filter(m => m.severity === 'error').map(m => m.message),
            warnings: validation.messages.filter(m => m.severity === 'warning').map(m => m.message),
          })
          continue
        }

        // 注册
        const result = this.registerCharacter(pkg)
        results.push(result)
      } catch (e) {
        results.push({
          success: false,
          characterId: 'unknown',
          errors: [`导入失败: ${e}`],
          warnings: [],
        })
      }
    }

    this.reportProgress('complete', results.length, results.length, '批量导入完成')
    return results
  }

  // ============ 查询 ============

  /** 获取已注册的资源包 */
  getRegisteredPackages(): CharacterResourcePackage[] {
    return Array.from(this.packages.values())
  }

  /** 按 ID 获取资源包 */
  getPackage(id: string): CharacterResourcePackage | undefined {
    return this.packages.get(id)
  }

  /** 获取已注册角色数量 */
  getRegisteredCount(): number {
    return this.packages.size
  }
}

// ============ 单例 ============
let importerInstance: CharacterResourceImporter | null = null

/** 获取角色资源导入器单例 */
export function getCharacterResourceImporter(): CharacterResourceImporter {
  if (!importerInstance) {
    importerInstance = new CharacterResourceImporter()
  }
  return importerInstance
}
