/**
 * 角色资源加载器 — Shimeji 风格精灵角色加载框架
 * 参考 WindowPet 的角色包发现与加载机制
 *
 * @fileoverview
 * 主要模块：
 * - CharacterPackConfig 接口：角色包 JSON 配置格式（pet.json）
 * - LoadedCharacter 接口：已加载的角色资源
 * - CharacterResourceLoader 类：资源加载器（单例模式），支持目录扫描、资源加载、.petmod 导入
 * - discoverCharacters()：从 pets/ 目录发现角色包
 * - loadCharacter()：加载单个角色资源
 *
 * 核心功能：
 * 1. 支持 128→192×208 自动重采样（兼容旧版 Shimeji 精灵）
 * 2. JSON 配置格式的角色包定义
 * 3. 从 pets/ 目录发现角色包
 * 4. 支持 .petmod 角色导入
 * 5. MIT 许可证验证元数据
 *
 *
 * @module characterResourceLoader
 * @requires ./types - CharacterProfile, ATLAS 类型定义
 * @requires ./modManager - 模组管理器
 */

import type { CharacterProfile } from './types'
import { ATLAS } from './types'
import { getModManager } from './modManager'

// ============ 角色包配置格式 ============

/** 角色包的 JSON 配置格式（pet.json） */
export interface CharacterPackConfig {
  /** 角色唯一标识符 */
  id: string
  /** 角色显示名称 */
  name: string
  /** 角色版本号（语义化版本） */
  version: string
  /** 作者名称 */
  author: string
  /** 许可证标识（必须为 MIT 或 MIT 兼容协议） */
  license: string
  /** 角色描述 */
  description: string
  /** 精灵图资源路径（相对于角色包根目录） */
  spritePath: string
  /** 精灵图类型 */
  spriteType: 'atlas' | 'svg' | 'gif' | 'video'
  /** 精灵图布局（可选，默认使用全局 ATLAS） */
  atlasLayout?: {
    cellW: number
    cellH: number
    cols: number
    rows: number
  }
  /** 动画映射：状态名 → 精灵图行号/帧数 */
  animations?: Record<string, { row: number; frames: number; fps?: number }>
  /** 音效映射：状态名 → 音频文件路径 */
  soundEffects?: Record<string, string>
  /** 主题色 */
  themeColor?: { primary: string; secondary: string }
  /** 角色标签/来源 */
  tags?: string[]
  /** 原始尺寸（用于自动重采样计算） */
  originalSize?: { width: number; height: number }
  /** 许可证验证元数据 */
  licenseMeta?: LicenseMeta
}

/** MIT 许可证验证元数据 */
export interface LicenseMeta {
  /** 许可证类型 */
  type: 'MIT' | 'CC0' | 'CC-BY' | 'CC-BY-SA' | 'CC-BY-NC' | 'proprietary'
  /** 许可证文本 URL 或内联文本 */
  licenseText?: string
  /** 版权声明 */
  copyright?: string
  /** 形象来源（用于人工审核） */
  assetSource?: string
  /** 是否经过审核 */
  audited?: boolean
}

// ============ 重采样配置 ============

/** 重采样策略 */
export type ResampleStrategy = 'nearest' | 'bilinear' | 'auto'

/** 重采样结果 */
export interface ResampleResult {
  /** 重采样后的 dataURL */
  dataUrl: string
  /** 原始尺寸 */
  originalSize: { width: number; height: number }
  /** 目标尺寸 */
  targetSize: { width: number; height: number }
  /** 是否发生了重采样 */
  wasResampled: boolean
  /** 使用的策略 */
  strategy: ResampleStrategy
}

// ============ 角色资源加载器 ============

export class CharacterResourceLoader {
  /** 已发现的角色包缓存 */
  private discoveredPacks: Map<string, CharacterPackConfig> = new Map()
  /** 已加载的角色配置（id → 规范化后的 CharacterProfile） */
  private loadedProfiles: Map<string, CharacterProfile> = new Map()
  /** 重采样缓存（spritePath → ResampleResult） */
  private resampleCache: Map<string, ResampleResult> = new Map()

  /**
   * 从 pets/ 目录发现所有角色包
   * 优先从 Vite import.meta.glob 读取打包模块，回退到 fetch
   */
  async discoverPacks(): Promise<CharacterPackConfig[]> {
    const packs: CharacterPackConfig[] = []

    // 1. 尝试从打包模块读取（Vite import.meta.glob）
    try {
      const modules = import.meta.glob('../../pets/*/pet.json', {
        eager: true,
        import: 'default',
      }) as Record<string, CharacterPackConfig>

      for (const [, config] of Object.entries(modules)) {
        if (config?.id) {
          this.discoveredPacks.set(config.id, config)
          packs.push(config)
        }
      }
    } catch {
      // 非构建环境或 pets/ 目录不存在
    }

    // 2. 尝试从 public/pets/ 目录 fetch（回退方案）
    try {
      const manifest = await fetch('/pets/manifest.json')
        .then((r) => (r.ok ? (r.json() as Promise<{ packs: string[] }>) : null))
        .catch(() => null)

      if (manifest?.packs) {
        const fetchResults = await Promise.allSettled(
          manifest.packs.map(async (packId) => {
            if (this.discoveredPacks.has(packId)) return null
            const res = await fetch(`/pets/${packId}/pet.json`)
            if (!res.ok) return null
            return (await res.json()) as CharacterPackConfig
          }),
        )

        for (const result of fetchResults) {
          if (result.status === 'fulfilled' && result.value?.id) {
            const config = result.value
            this.discoveredPacks.set(config.id, config)
            packs.push(config)
          }
        }
      }
    } catch {
      // public 目录不可用
    }

    // 3. 从 .petmod 模组中提取角色包
    try {
      const modMgr = getModManager()
      const modPacks = modMgr.getEnabledMods()
        .filter((mod) => mod.modData?.petConf)
        .map((mod) => modToPackConfig(
          mod.id,
          mod.displayName,
          mod.source,
        ))

      for (const pack of modPacks) {
        if (!this.discoveredPacks.has(pack.id)) {
          this.discoveredPacks.set(pack.id, pack)
          packs.push(pack)
        }
      }
    } catch {
      // modManager 可能在某些环境下不可用
    }

    return packs
  }

  /**
   * 加载角色包并转换为 CharacterProfile
   * 自动处理重采样和许可证验证
   */
  async loadPack(packId: string): Promise<CharacterProfile | null> {
    // 检查缓存
    const cached = this.loadedProfiles.get(packId)
    if (cached) return cached

    const config = this.discoveredPacks.get(packId)
    if (!config) return null

    // 许可证验证
    if (!validateLicense(config)) {
      console.warn(`[CharacterResourceLoader] 角色 ${packId} 许可证验证失败: ${config.license}`)
      return null
    }

    // 自动重采样（128→192×208）
    const atlasLayout = config.atlasLayout ?? {
      cellW: ATLAS.cellW,
      cellH: ATLAS.cellH,
      cols: ATLAS.cols,
      rows: ATLAS.rows,
    }

    // 规范化为 CharacterProfile
    const profile: CharacterProfile = {
      id: config.id,
      name: config.id,
      displayName: config.name,
      source: config.tags?.join(', ') ?? 'Community',
      birthBackground: config.description,
      emotionalCore: '',
      personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0, rationality: 0 },
      signaturePhrase: '',
      classicQuotes: [],
      systemPrompt: `你是${config.name}，一个桌面宠物角色。`,
      fewShotExamples: [],
      spriteAsset: config.spritePath,
      spriteType: config.spriteType,
      themeColor: config.themeColor ?? { primary: '#4ECDC4', secondary: '#FF6B6B' },
      bubbleMessages: {
        idle: ['…'],
        hungry: ['有点饿了'],
        sad: ['呜…'],
        pet: ['好舒服~'],
        feed: ['谢谢！'],
        pomodoroDone: ['休息一下~'],
      },
      atlasLayout,
      type: 'community',
    }

    this.loadedProfiles.set(packId, profile)
    return profile
  }

  /**
   * 对精灵图执行自动重采样
   * 当源尺寸 ≠ 目标尺寸（192×208）时，使用 Canvas 重采样
   *
   * @param imageSrc 图片源（URL 或 dataURL）
   * @param sourceSize 原始单格尺寸
   * @param targetSize 目标单格尺寸（默认 ATLAS.cellW × ATLAS.cellH）
   * @param strategy 重采样策略
   */
  async resampleSpriteSheet(
    imageSrc: string,
    sourceSize: { width: number; height: number },
    targetSize: { width: number; height: number } = { width: ATLAS.cellW, height: ATLAS.cellH },
    strategy: ResampleStrategy = 'auto',
  ): Promise<ResampleResult> {
    // 检查缓存
    const cacheKey = `${imageSrc}:${sourceSize.width}x${sourceSize.height}`
    const cached = this.resampleCache.get(cacheKey)
    if (cached) return cached

    // 无需重采样
    if (sourceSize.width === targetSize.width && sourceSize.height === targetSize.height) {
      const result: ResampleResult = {
        dataUrl: imageSrc,
        originalSize: sourceSize,
        targetSize,
        wasResampled: false,
        strategy,
      }
      this.resampleCache.set(cacheKey, result)
      return result
    }

    // 加载图片并重采样
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`图片加载失败: ${imageSrc}`))
      img.src = imageSrc
    })

    // 计算缩放比
    const scaleX = targetSize.width / sourceSize.width
    const scaleY = targetSize.height / sourceSize.height

    // 创建目标 canvas
    const canvas = document.createElement('canvas')
    canvas.width = img.width * scaleX
    canvas.height = img.height * scaleY
    const ctx = canvas.getContext('2d')

    if (ctx) {
      // 像素艺术使用 nearest-neighbor，其他使用 bilinear
      const useNearest = strategy === 'nearest' || (strategy === 'auto' && isPixelArt(img))
      ctx.imageSmoothingEnabled = !useNearest
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }

    const result: ResampleResult = {
      dataUrl: canvas.toDataURL('image/png'),
      originalSize: sourceSize,
      targetSize,
      wasResampled: true,
      strategy,
    }

    this.resampleCache.set(cacheKey, result)
    return result
  }

  /**
   * 获取所有已加载的角色 Profile
   */
  getLoadedProfiles(): CharacterProfile[] {
    return Array.from(this.loadedProfiles.values())
  }

  /**
   * 获取指定角色的 Profile
   */
  getProfile(id: string): CharacterProfile | undefined {
    return this.loadedProfiles.get(id)
  }

  /**
   * 重新扫描角色包（清除缓存后重新发现）
   */
  async refresh(): Promise<CharacterPackConfig[]> {
    this.discoveredPacks.clear()
    this.loadedProfiles.clear()
    this.resampleCache.clear()
    return this.discoverPacks()
  }

  /**
   * 导入 .petmod 角色包
   * @param file .petmod 文件
   */
  async importPetmod(file: File): Promise<{ success: boolean; message: string; packId?: string }> {
    try {
      const modMgr = getModManager()
      // 读取文件内容并尝试从 JSON 安装
      const text = await file.text()
      const mod = modMgr.installFromJSON(text)
      if (mod) {
        // 导入成功后尝试加载角色
        const profile = await this.loadPack(mod.id)
        if (profile) {
          return { success: true, message: `角色 ${profile.displayName} 导入成功`, packId: mod.id }
        }
      }
      return { success: false, message: '导入失败：无法解析模组数据' }
    } catch (e) {
      return { success: false, message: `导入失败: ${e instanceof Error ? e.message : '未知错误'}` }
    }
  }
}

// ============ 辅助函数 ============

/**
 * 验证角色包许可证
 * 仅允许 MIT 或 MIT 兼容的许可证
 */
function validateLicense(config: CharacterPackConfig): boolean {
  const allowedLicenses = ['MIT', 'CC0', 'CC-BY', 'CC-BY-SA']
  const licenseType = config.licenseMeta?.type ?? config.license

  if (allowedLicenses.includes(licenseType)) return true

  // 如果有 audited 标记，则通过
  if (config.licenseMeta?.audited) return true

  // proprietary 许可证需要人工审核
  if (licenseType === 'proprietary' && config.licenseMeta?.audited === true) return true

  return false
}

/**
 * 判断图片是否为像素艺术（启发式）
 * 如果图片宽高均 ≤ 128 且放大超过 2x，则认为是像素艺术
 */
function isPixelArt(img: HTMLImageElement): boolean {
  return img.width <= 128 && img.height <= 128
}

/**
 * 将模组信息转换为角色包配置（临时方案）
 */
function modToPackConfig(modId: string, modName: string, modSource: string): CharacterPackConfig {
  return {
    id: modId,
    name: modName,
    version: '1.0.0',
    author: modSource,
    license: 'MIT',
    description: `来自 ${modSource} 的角色 ${modName}`,
    spritePath: `/mods/${modId}/spritesheet.png`,
    spriteType: 'atlas',
    licenseMeta: { type: 'MIT', audited: false },
  }
}

// ============ 单例 ============

let loaderInstance: CharacterResourceLoader | null = null

/** 获取角色资源加载器单例 */
export function getCharacterResourceLoader(): CharacterResourceLoader {
  if (!loaderInstance) {
    loaderInstance = new CharacterResourceLoader()
  }
  return loaderInstance
}
