/**
 * 路径约定模块
 *
 * @fileoverview 约定优于配置的目录结构约定，通过目录名自动推断角色心情与动画（参考VPet）
 *
 * 主要模块：
 * - MOOD_DIR_MAP: 心情目录名→心情状态映射（支持中英文）
 * - ACTION_FILE_MAP: 动画文件名→动画ID映射
 * - PathConvention: 路径约定解析器
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke（Rust后端文件扫描）
 *
 * 核心接口：
 * - scanCharacterDirectory(): 扫描角色目录，自动发现心情和动画
 * - inferMoodFromDir(): 从目录名推断心情状态
 * - inferActionFromFile(): 从文件名推断动画ID
 * - getAnimationPath(): 获取动画资源的标准路径
 *
 * 目录约定（参考VPet）：
 *   {character}/
 *     happy/              ← 心情目录（开心/normal/糟糕/生病/睡觉/饥饿）
 *       idle.png          ← 默认动画（idle/walk/run/pet_head等）
 *       walk.png
 *       pet_head.png
 *     normal/
 *       idle.png
 *       walk.png
 *     poorcondition/
 *       idle.png
 *
 * 核心机制：通过目录名和文件名约定自动发现动画资源，无需显式配置
 */

import { invoke } from '@tauri-apps/api/core'

// ============ 配置常量 ============

/** 心情目录名 → 心情状态映射 */
const MOOD_DIR_MAP: Record<string, string> = {
  'happy': 'happy',
  '开心': 'happy',
  'normal': 'idle',
  '普通': 'idle',
  '默认': 'idle',
  'poorcondition': 'sad',
  '糟糕': 'sad',
  '低落': 'sad',
  'sad': 'sad',
  'ill': 'sick',
  '生病': 'sick',
  'sick': 'sick',
  'sleep': 'sleep',
  '睡觉': 'sleep',
  'hungry': 'hungry',
  '饥饿': 'hungry',
}

/** 动画文件名（不含扩展名）→ 动画 ID 映射 */
const ACTION_FILE_MAP: Record<string, string> = {
  'idle': 'idle',
  'stand': 'idle',
  '站': 'idle',
  'walk': 'walk',
  '走': 'walk',
  'run': 'walk',
  '跑': 'walk',
  'run-left': 'run-left',
  'run_left': 'run-left',
  'sleep': 'sleep',
  '睡觉': 'sleep',
  'sit': 'sit',
  '坐': 'sit',
  'eat': 'eat',
  '吃': 'eat',
  'happy': 'happy',
  '开心': 'happy',
  'sad': 'sad',
  '伤心': 'sad',
  'sick': 'sick',
  '生病': 'sick',
  'pet': 'pet',
  'pet_head': 'pet_head',
  '摸头': 'pet_head',
  'drag': 'drag',
  '拖拽': 'drag',
}

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

// ============ 类型定义 ============

/** 心情动画映射 */
export interface MoodAnimations {
  /** 心情状态 */
  mood: string
  /** 该心情下可用的动画 ID 列表 */
  animations: string[]
  /** 该心情目录路径 */
  directory: string
}

/** 角色动画发现结果 */
export interface CharacterAnimationDiscovery {
  /** 角色 ID */
  characterId: string
  /** 角色根目录 */
  rootDirectory: string
  /** 心情 → 动画映射列表 */
  moodAnimations: MoodAnimations[]
  /** 所有发现的动画 ID（去重） */
  allAnimations: string[]
  /** 是否发现成功 */
  success: boolean
  /** 错误信息（失败时） */
  error?: string
}

/** 路径约定配置 */
export interface PathConventionConfig {
  /** 角色资源根目录（相对于应用数据目录） */
  charactersRoot?: string
}

// ============ 心情推断 ============

/**
 * 从目录名推断心情状态
 *
 * @param dirName 目录名（如 "happy"、"poorcondition"、"开心"）
 * @returns 推断的心情状态，未知目录返回 "idle"
 */
export function inferMoodFromDirectory(dirName: string): string {
  const lower = dirName.toLowerCase().trim()
  return MOOD_DIR_MAP[lower] ?? MOOD_DIR_MAP[dirName] ?? 'idle'
}

/**
 * 从文件名推断动画 ID
 *
 * @param fileName 文件名（不含扩展名，如 "idle"、"walk"、"摸头"）
 * @returns 推断的动画 ID，未知文件名返回 "idle"
 */
export function inferAnimationFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase().trim()
  return ACTION_FILE_MAP[lower] ?? ACTION_FILE_MAP[fileName] ?? 'idle'
}

/**
 * 检查文件是否为支持的图片格式
 *
 * @param fileName 文件名
 * @returns 是否为图片文件
 */
export function isImageFile(fileName: string): boolean {
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

// ============ 角色动画发现器 ============

/**
 * 路径约定发现器
 * 参考 VPet 的目录约定，自动从文件系统发现角色动画
 *
 * 约定规则：
 * 1. 角色目录下的一级子目录名 → 心情状态
 * 2. 心情目录内的图片文件名 → 动画 ID
 * 3. 目录名和文件名均支持中英文映射
 */
export class PathConventionDiscovery {
  private config: Required<PathConventionConfig>

  constructor(config: PathConventionConfig = {}) {
    this.config = {
      charactersRoot: config.charactersRoot ?? 'characters',
    }
  }

  /**
   * 发现角色的所有动画
   * 扫描角色目录，按心情分组，自动推断动画 ID
   *
   * @param characterId 角色 ID
   * @returns 动画发现结果
   */
  async discoverCharacterAnimations(
    characterId: string,
  ): Promise<CharacterAnimationDiscovery> {
    const rootDir = `${this.config.charactersRoot}/${characterId}`

    try {
      // 1. 列出角色目录下的一级子目录
      const entries = await this.listDirectory(rootDir)

      // 2. 过滤出子目录（作为心情目录）
      const moodDirs = entries.filter(e => e.is_dir)

      // 3. 遍历每个心情目录，发现动画
      const moodAnimations: MoodAnimations[] = []
      const allAnimationsSet = new Set<string>()

      for (const moodDir of moodDirs) {
        const mood = inferMoodFromDirectory(moodDir.name)
        const dirPath = `${rootDir}/${moodDir.name}`

        // 列出心情目录内的文件
        const files = await this.listDirectory(dirPath)
        const animations: string[] = []

        for (const file of files) {
          if (!file.is_dir && isImageFile(file.name)) {
            // 去掉扩展名
            const baseName = file.name.substring(0, file.name.lastIndexOf('.'))
            const animId = inferAnimationFromFileName(baseName)
            if (!animations.includes(animId)) {
              animations.push(animId)
              allAnimationsSet.add(animId)
            }
          }
        }

        if (animations.length > 0) {
          moodAnimations.push({
            mood,
            animations,
            directory: dirPath,
          })
        }
      }

      // 4. 也检查根目录下的图片（无心情分组）
      const rootFiles = entries.filter(e => !e.is_dir && isImageFile(e.name))
      if (rootFiles.length > 0) {
        const rootAnimations: string[] = []
        for (const file of rootFiles) {
          const baseName = file.name.substring(0, file.name.lastIndexOf('.'))
          const animId = inferAnimationFromFileName(baseName)
          if (!rootAnimations.includes(animId)) {
            rootAnimations.push(animId)
            allAnimationsSet.add(animId)
          }
        }
        if (rootAnimations.length > 0) {
          moodAnimations.push({
            mood: 'idle',
            animations: rootAnimations,
            directory: rootDir,
          })
        }
      }

      return {
        characterId,
        rootDirectory: rootDir,
        moodAnimations,
        allAnimations: [...allAnimationsSet],
        success: true,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        characterId,
        rootDirectory: rootDir,
        moodAnimations: [],
        allAnimations: [],
        success: false,
        error: msg,
      }
    }
  }

  /**
   * 列出目录内容
   * 优先使用 Tauri Rust 后端，降级到空列表
   */
  private async listDirectory(
    dirPath: string,
  ): Promise<Array<{ name: string; is_dir: boolean }>> {
    try {
      return await invoke<Array<{ name: string; is_dir: boolean }>>(
        'list_directory', { path: dirPath },
      )
    } catch {
      // 目录不存在或无法访问
      return []
    }
  }

  /**
   * 获取角色在指定心情下的动画路径
   *
   * @param characterId 角色 ID
   * @param mood 心情状态
   * @param animationId 动画 ID
   * @returns 动画文件路径，未找到返回 null
   */
  async getAnimationPath(
    characterId: string,
    mood: string,
    animationId: string,
  ): Promise<string | null> {
    const discovery = await this.discoverCharacterAnimations(characterId)
    if (!discovery.success) return null

    const moodData = discovery.moodAnimations.find(m => m.mood === mood)
    if (!moodData || !moodData.animations.includes(animationId)) {
      // 尝试在默认心情下查找
      const defaultMood = discovery.moodAnimations.find(m => m.mood === 'idle')
      if (defaultMood && defaultMood.animations.includes(animationId)) {
        return `${defaultMood.directory}/${animationId}.png`
      }
      return null
    }

    return `${moodData.directory}/${animationId}.png`
  }
}

// ============ 便捷函数 ============

/**
 * 快捷发现角色动画
 *
 * @param characterId 角色 ID
 * @param config 路径约定配置
 * @returns 动画发现结果
 */
export async function discoverAnimations(
  characterId: string,
  config?: PathConventionConfig,
): Promise<CharacterAnimationDiscovery> {
  const discovery = new PathConventionDiscovery(config)
  return discovery.discoverCharacterAnimations(characterId)
}

// ============ 单例 ============

let instance: PathConventionDiscovery | null = null

export function getPathConventionDiscovery(
  config?: PathConventionConfig,
): PathConventionDiscovery {
  if (!instance) {
    instance = new PathConventionDiscovery(config)
  }
  return instance
}

export function resetPathConventionDiscovery(): void {
  instance = null
}
