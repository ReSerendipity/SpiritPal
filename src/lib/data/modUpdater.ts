/**
 * Mod 本地升级模块
 *
 * @fileoverview 已安装 Mod 的版本检查、更新下载与原地替换升级
 *
 * 主要模块：
 * - ModRegistryEntry: 远程清单条目（modId/version/downloadUrl）
 * - ModUpdateCheckResult: 升级检查结果
 * - ModUpdaterTransport: 可注入的 IO 传输层（便于单元测试 mock）
 * - ModUpdater: 升级器主类
 *
 * 依赖关系：
 * - modManager.ts: compareSemVer 版本比较
 * - ssrfProtection.ts: safeFetch 统一网络出口（Tauri 下经 Rust 代理）
 * - @tauri-apps/api: invoke/path/plugin-fs 文件系统与 Rust 安装命令
 *
 * 核心接口：
 * - checkForUpdate(): 对比本地版本与远程清单，判断是否有新版本
 * - downloadUpdate(): 下载新版本 .petmod 包为 Blob
 * - applyUpdate(): 备份旧版 → 安装新版 → 迁移配置 → 清理
 *
 * 升级流程说明：
 * 1. checkForUpdate 从 registryUrl 拉取 JSON 数组清单，按 modId 匹配条目，
 *    使用 SemVer 比较远程版本是否高于本地版本。
 * 2. downloadUpdate 通过 safeFetch 下载 downloadUrl 指向的 .petmod 二进制。
 * 3. applyUpdate 先将旧版本模组目录重命名到 .backup 下（备份），
 *    再把 Blob 写入临时 .petmod 并调用 Rust install_petmod（overwrite）安装；
 *    安装失败时回滚备份。用户配置存储在 app data 数据库中，不随包替换而丢失。
 *
 * 远程清单格式（JSON 数组）：
 * [
 *   { "modId": "my-pet", "version": "1.2.0", "downloadUrl": "https://.../my-pet-1.2.0.petmod",
 *     "sha256": "...", "changelog": "..." }
 * ]
 */

import { invoke } from '@tauri-apps/api/core'
import { appDataDir, appCacheDir, join } from '@tauri-apps/api/path'
import { safeFetch } from '@/lib/system/ssrfProtection'
import { compareSemVer } from './modManager'

// ============ 类型定义 ============

/** 远程版本清单单条目 */
export interface ModRegistryEntry {
  /** 模组 ID（与 petmod.json 的 id 一致） */
  modId: string
  /** 新版本号（SemVer） */
  version: string
  /** .petmod 下载地址 */
  downloadUrl: string
  /** SHA-256 校验和（可选） */
  sha256?: string
  /** 更新日志（可选） */
  changelog?: string
  /** 发布时间（可选，ISO 字符串） */
  publishedAt?: string
}

/** 升级检查结果 */
export interface ModUpdateCheckResult {
  /** 是否有可用更新 */
  hasUpdate: boolean
  /** 远程最新版本号（无更新时回退为 currentVersion） */
  newVersion: string
  /** 更新包下载地址（有更新时提供） */
  downloadUrl?: string
  /** 更新日志 */
  changelog?: string
}

/** 一次升级的状态转换记录（用于观测/测试） */
export type ModUpdateStage =
  | 'backup-start'
  | 'backup-done'
  | 'temp-saved'
  | 'install-start'
  | 'install-done'
  | 'rollback'
  | 'cleanup'
  | 'failed'

/**
 * 升级器 IO 传输层
 * 生产实现走 Tauri 文件系统与 Rust 命令；测试可注入内存假实现。
 */
export interface ModUpdaterTransport {
  /** 拉取远程版本清单 JSON 数组 */
  fetchRegistry(url: string): Promise<ModRegistryEntry[]>
  /** 下载更新包为 Blob */
  downloadPackage(url: string): Promise<Blob>
  /** 将下载的 Blob 落盘为临时 .petmod，返回临时文件路径 */
  saveTempPackage(blob: Blob): Promise<string>
  /** 调用 Rust install_petmod 安装（覆盖），返回 modId 与新版本号 */
  installPackage(packagePath: string): Promise<{ modId: string; version: string }>
  /** 备份旧版本模组目录，返回备份路径 */
  backupMod(modId: string): Promise<string>
  /** 从备份路径恢复旧版本（安装失败回滚用） */
  restoreBackup(backupPath: string, modId: string): Promise<void>
  /** 清理临时文件或备份目录 */
  cleanupPath(path: string): Promise<void>
}

/** 默认远程清单地址 */
export const DEFAULT_MOD_REGISTRY_URL = 'https://registry.spiritpal.app/api/mods/updates.json'

// ============ 生产传输层（Tauri 环境） ============

/** 获取模组安装目录（appDataDir/mods） */
async function getModsDir(): Promise<string> {
  const base = await appDataDir()
  return await join(base, 'mods')
}

/** 生产传输层实现：safeFetch 出网 + Tauri fs/Rust 命令落地 */
const defaultTransport: ModUpdaterTransport = {
  async fetchRegistry(url) {
    const response = await safeFetch(url)
    if (!response.ok) {
      throw new Error(`清单请求失败: ${response.status} ${response.statusText}`)
    }
    const entries = (await response.json()) as unknown
    if (!Array.isArray(entries)) {
      throw new Error('远程清单格式错误：应为 JSON 数组')
    }
    return entries as ModRegistryEntry[]
  },

  async downloadPackage(url) {
    const response = await safeFetch(url)
    if (!response.ok) {
      throw new Error(`更新包下载失败: ${response.status} ${response.statusText}`)
    }
    return await response.blob()
  },

  async saveTempPackage(blob) {
    const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs')
    const cacheBase = await appCacheDir()
    const tmpDir = await join(cacheBase, 'spiritpal-updates')
    await mkdir(tmpDir, { recursive: true })
    const tmpPath = await join(tmpDir, `update-${Date.now()}.petmod`)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await writeFile(tmpPath, bytes, { create: true })
    return tmpPath
  },

  async installPackage(packagePath) {
    const modsDir = await getModsDir()
    return await invoke<{ modId: string; version: string }>('install_petmod', {
      packagePath,
      targetDir: modsDir,
      overwrite: true,
      skipSignatureCheck: false,
    })
  },

  async backupMod(modId) {
    const { rename, mkdir } = await import('@tauri-apps/plugin-fs')
    const modsDir = await getModsDir()
    const oldDir = await join(modsDir, modId)
    const backupRoot = await join(modsDir, '.backup')
    await mkdir(backupRoot, { recursive: true })
    const backupPath = await join(backupRoot, `${modId}-${Date.now()}`)
    await rename(oldDir, backupPath)
    return backupPath
  },

  async restoreBackup(backupPath, modId) {
    const { rename } = await import('@tauri-apps/plugin-fs')
    const modsDir = await getModsDir()
    const restoreTo = await join(modsDir, modId)
    await rename(backupPath, restoreTo)
  },

  async cleanupPath(path) {
    const { remove } = await import('@tauri-apps/plugin-fs')
    await remove(path, { recursive: true })
  },
}

// ============ 升级器 ============

/**
 * Mod 升级器
 *
 * 状态机：check → download → backup → temp-save → install → cleanup
 * 任意一步失败且已备份时执行 rollback 恢复旧版本。
 */
export class ModUpdater {
  private transport: ModUpdaterTransport
  /** 最近一次 applyUpdate 的状态转换轨迹（便于 UI 展示与测试断言） */
  public lastStages: ModUpdateStage[] = []

  constructor(transport?: ModUpdaterTransport) {
    this.transport = transport ?? defaultTransport
  }

  private record(stage: ModUpdateStage): void {
    this.lastStages.push(stage)
  }

  /**
   * 检查是否有新版本
   * @param modId 模组 ID
   * @param currentVersion 当前本地版本（SemVer）
   * @param registryUrl 远程清单地址（缺省使用官方 registry）
   */
  async checkForUpdate(
    modId: string,
    currentVersion: string,
    registryUrl: string = DEFAULT_MOD_REGISTRY_URL,
  ): Promise<ModUpdateCheckResult> {
    try {
      const entries = await this.transport.fetchRegistry(registryUrl)
      const entry = entries.find((e) => e.modId === modId)
      if (!entry) {
        return { hasUpdate: false, newVersion: currentVersion }
      }
      // 远程版本必须严格高于本地版本才算更新
      if (compareSemVer(entry.version, currentVersion) > 0) {
        return {
          hasUpdate: true,
          newVersion: entry.version,
          downloadUrl: entry.downloadUrl,
          changelog: entry.changelog,
        }
      }
      return { hasUpdate: false, newVersion: entry.version }
    } catch (e) {
      // 网络/解析失败不阻断使用：视为无更新，错误交由调用方日志感知
      console.warn(`[ModUpdater] checkForUpdate failed for "${modId}":`, e)
      return { hasUpdate: false, newVersion: currentVersion }
    }
  }

  /**
   * 下载更新包
   * @param downloadUrl 从 checkForUpdate 获得的下载地址
   */
  async downloadUpdate(downloadUrl: string): Promise<Blob> {
    return await this.transport.downloadPackage(downloadUrl)
  }

  /**
   * 应用更新：备份旧版 → 安装新版 → 清理；失败自动回滚
   *
   * 用户配置（app data 数据库中的启用状态/偏好）不在模组目录内，
   * 替换包文件不会丢失，因此无需额外配置迁移步骤。
   *
   * @param modId 要升级的模组 ID
   * @param updateBlob downloadUpdate 返回的新 .petmod Blob
   * @returns 是否升级成功
   */
  async applyUpdate(modId: string, updateBlob: Blob): Promise<boolean> {
    this.lastStages = []
    this.record('backup-start')

    let backupPath: string | null = null
    let tempPath: string | null = null
    try {
      // 1. 备份旧版本
      backupPath = await this.transport.backupMod(modId)
      this.record('backup-done')

      // 2. 新包落盘到临时文件
      tempPath = await this.transport.saveTempPackage(updateBlob)
      this.record('temp-saved')

      // 3. 安装新版（覆盖）
      this.record('install-start')
      const installed = await this.transport.installPackage(tempPath)
      this.record('install-done')

      if (installed.modId !== modId) {
        throw new Error(`安装包 modId 不匹配: 期望 ${modId}, 实际 ${installed.modId}`)
      }

      // 4. 成功：清理临时文件与旧版备份
      this.record('cleanup')
      await this.transport.cleanupPath(tempPath)
      await this.transport.cleanupPath(backupPath)
      return true
    } catch (e) {
      // 5. 失败回滚：恢复旧版本，清理残留
      this.record('failed')
      if (backupPath) {
        this.record('rollback')
        try {
          await this.transport.restoreBackup(backupPath, modId)
        } catch (restoreError) {
          console.error(`[ModUpdater] 回滚失败（请手动恢复 ${backupPath}）:`, restoreError)
        }
      }
      if (tempPath) {
        try {
          await this.transport.cleanupPath(tempPath)
        } catch {
          // 清理临时文件失败不影响回滚结论
        }
      }
      console.error(`[ModUpdater] applyUpdate failed for "${modId}":`, e)
      return false
    }
  }
}

// ============ 单例 ============

let sharedUpdater: ModUpdater | null = null

export function getModUpdater(): ModUpdater {
  if (!sharedUpdater) {
    sharedUpdater = new ModUpdater()
  }
  return sharedUpdater
}
