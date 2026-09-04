/**
 * Mod打包工具模块
 *
 * @fileoverview 实现.petmod模组包的打包、校验、安装与卸载功能
 *
 * 主要模块：
 * - PackOptions/PackResult: 打包选项与结果
 * - PackageValidationResult: 包校验结果
 * - ModPackager: 打包工具类
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke调用（Rust后端压缩/解压）
 * - @tauri-apps/api/path: 路径操作
 * - @tauri-apps/plugin-fs: 文件系统操作
 * - modManager.ts: PetmodManifest类型与清单验证
 *
 * 核心接口：
 * - packMod(): 将模组目录打包为.petmod
 * - validatePackage(): 校验.petmod包完整性
 * - installPackage(): 从.petmod安装模组
 * - uninstallMod(): 卸载已安装模组
 *
 * 核心功能：
 * 1. 打包：目录→.petmod压缩包，支持排除模式
 * 2. 校验：清单验证+资源完整性+SHA256校验
 * 3. 安装：解压+验证+注册
 * 4. 卸载：移除文件+清理数据库
 * 5. 资产捆绑：自动包含精灵图、配置文件等
 * 6. 哈希校验：SHA256完整性验证
 */

import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { type PetmodManifest, type ManifestValidationResult, validatePetmodManifest, isValidSemVer } from './modManager'

// ============ 类型定义 ============

/** 打包选项 */
export interface PackOptions {
  /** 源目录路径 */
  sourceDir: string
  /** 输出文件路径（默认 sourceDir/../<id>-<version>.petmod） */
  outputPath?: string
  /** 是否压缩（默认 true） */
  compress?: boolean
  /** 是否生成完整性哈希（默认 true） */
  generateHash?: boolean
  /** 排除的文件模式（glob） */
  excludePatterns?: string[]
}

/** 打包结果 */
export interface PackResult {
  success: boolean
  outputPath?: string
  sha256?: string
  sizeBytes?: number
  error?: string
}

/** 校验结果 */
export interface PackageValidationResult {
  valid: boolean
  manifest?: PetmodManifest
  manifestValidation?: ManifestValidationResult
  integrityValid?: boolean
  errors: string[]
  warnings: string[]
}

/** 安装选项 */
export interface InstallOptions {
  /** 是否覆盖已存在的模组 */
  overwrite?: boolean
  /** 是否跳过签名校验 */
  skipSignatureCheck?: boolean
}

/** 安装结果 */
export interface InstallResult {
  success: boolean
  modId?: string
  version?: string
  error?: string
  warning?: string
}

// ============ Mod 打包器 ============

export class ModPackager {
  /**
   * 将模组目录打包为 .petmod 压缩包
   * 调用后端 Rust 实现进行压缩和哈希计算
   */
  async pack(options: PackOptions): Promise<PackResult> {
    const {
      sourceDir,
      compress = true,
      generateHash = true,
      excludePatterns = [],
    } = options

    // 1. 校验源目录是否存在 petmod.json
    try {
      const manifestPath = await join(sourceDir, 'petmod.json')
      if (!(await exists(manifestPath))) {
        return { success: false, error: 'petmod.json 不存在，无法打包' }
      }

      const manifestRaw = await readTextFile(manifestPath)
      const manifest = JSON.parse(manifestRaw) as PetmodManifest
      const validation = validatePetmodManifest(manifest)
      if (!validation.valid) {
        return {
          success: false,
          error: `清单校验失败: ${validation.errors.join('; ')}`,
        }
      }

      // 2. 确定输出路径
      let outputPath = options.outputPath
      if (!outputPath) {
        const parentDir = sourceDir.split('/').slice(0, -1).join('/') ||
          sourceDir.split('\\').slice(0, -1).join('\\')
        outputPath = await join(
          parentDir,
          `${manifest.id}-${manifest.version}.petmod`,
        )
      }

      // 3. 调用后端打包
      const result = await invoke<{
        success: boolean
        outputPath: string
        sha256?: string
        sizeBytes?: number
        error?: string
      }>('pack_petmod', {
        sourceDir,
        outputPath,
        compress,
        generateHash,
        excludePatterns,
      })

      if (!result.success) {
        return { success: false, error: result.error ?? '打包失败' }
      }

      return {
        success: true,
        outputPath: result.outputPath,
        sha256: result.sha256,
        sizeBytes: result.sizeBytes,
      }
    } catch (e) {
      return { success: false, error: `打包失败: ${e}` }
    }
  }

  /**
   * 校验 .petmod 包完整性
   */
  async validate(packagePath: string): Promise<PackageValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      // 1. 调用后端解压校验
      const result = await invoke<{
        valid: boolean
        manifestJson?: string
        sha256?: string
        expectedSha256?: string
        error?: string
      }>('validate_petmod', { packagePath })

      if (!result.valid) {
        errors.push(result.error ?? '包校验失败')
        return { valid: false, errors, warnings }
      }

      // 2. 解析清单
      let manifest: PetmodManifest | undefined
      if (result.manifestJson) {
        try {
          manifest = JSON.parse(result.manifestJson) as PetmodManifest
        } catch {
          errors.push('清单 JSON 解析失败')
        }
      }

      // 3. 清单格式校验
      let manifestValidation: ManifestValidationResult | undefined
      if (manifest) {
        manifestValidation = validatePetmodManifest(manifest)
        if (!manifestValidation.valid) {
          errors.push(...manifestValidation.errors)
        }
        warnings.push(...manifestValidation.warnings)
      }

      // 4. 完整性哈希校验
      let integrityValid = true
      if (result.sha256 && result.expectedSha256) {
        if (result.sha256 !== result.expectedSha256) {
          integrityValid = false
          errors.push('SHA-256 完整性校验失败：包可能被篡改')
        }
      }

      return {
        valid: errors.length === 0,
        manifest,
        manifestValidation,
        integrityValid,
        errors,
        warnings,
      }
    } catch (e) {
      errors.push(`校验失败: ${e}`)
      return { valid: false, errors, warnings }
    }
  }

  /**
   * 从 .petmod 包安装模组
   */
  async install(packagePath: string, options?: InstallOptions): Promise<InstallResult> {
    const { overwrite = false, skipSignatureCheck = false } = options ?? {}

    try {
      // 1. 获取模组安装目录
      const modsDir = await this.getModsDir()

      // 2. 调用后端安装
      const result = await invoke<{
        success: boolean
        modId: string
        version?: string
        error?: string
      }>('install_petmod', {
        packagePath,
        targetDir: modsDir,
        overwrite,
        skipSignatureCheck,
      })

      if (!result.success) {
        return { success: false, error: result.error ?? '安装失败' }
      }

      return {
        success: true,
        modId: result.modId,
        version: result.version,
      }
    } catch (e) {
      return { success: false, error: `安装失败: ${e}` }
    }
  }

  /**
   * 卸载已安装的模组
   */
  async uninstall(modId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const modsDir = await this.getModsDir()
      const modDir = await join(modsDir, modId)

      // 调用后端删除模组目录
      await invoke('uninstall_mod', { modDir })
      return { success: true }
    } catch (e) {
      return { success: false, error: `卸载失败: ${e}` }
    }
  }

  /**
   * 生成 petmod.json 清单模板
   */
  generateManifestTemplate(options: {
    id: string
    name: string
    version: string
    author: string
    description?: string
  }): PetmodManifest {
    return {
      id: options.id,
      name: options.name,
      version: isValidSemVer(options.version) ? options.version : '0.1.0',
      author: options.author,
      description: options.description ?? '',
      dependencies: [],
      permissions: [],
      keywords: [],
    }
  }

  /**
   * 将清单写入模组目录
   */
  async writeManifest(modDir: string, manifest: PetmodManifest): Promise<void> {
    const manifestPath = await join(modDir, 'petmod.json')
    await writeTextFile(manifestPath, JSON.stringify(manifest, null, 2))
  }

  /** 获取模组目录路径 */
  async getModsDir(): Promise<string> {
    const base = await appDataDir()
    return await join(base, 'mods')
  }
}

// ============ 单例 ============

let sharedPackager: ModPackager | null = null

export function getModPackager(): ModPackager {
  if (!sharedPackager) {
    sharedPackager = new ModPackager()
  }
  return sharedPackager
}
