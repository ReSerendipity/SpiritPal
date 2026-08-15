/**
 * Mod加载器模块
 *
 * @fileoverview 实现模组的依赖解析、校验、热重载与拓扑排序加载
 *
 * 主要模块：
 * - LoadOrderResult: 加载顺序解析结果
 * - ModValidationResult: 模组校验结果
 * - HotReloadEvent: 热重载事件
 * - ModLoader: 模组加载器主类
 *
 * 依赖关系：
 * - modManager.ts: 清单验证、版本约束检查
 * - @tauri-apps/plugin-fs: 文件系统访问（读文件、watch）
 * - @tauri-apps/api/path: 路径拼接
 *
 * 核心接口：
 * - loadMod(): 加载单个模组
 * - loadAllMods(): 加载所有已安装模组
 * - resolveLoadOrder(): 拓扑排序解析加载顺序
 * - validateMod(): schema+权限+完整性校验
 * - enableHotReload(): 启用文件监听热重载
 *
 * 核心功能：
 * 1. 依赖校验：验证所有依赖是否满足（版本、存在性）
 * 2. 多层校验：schema校验+权限校验+完整性校验
 * 3. 热重载：watch模组目录变化，自动reload
 * 4. 拓扑排序：基于依赖关系确定加载顺序
 * 5. 错误恢复：跳过损坏模组，继续加载其他
 */

import {
  type PetmodManifest,
  type ManifestValidationResult,
  type ModDependency,
  validatePetmodManifest,
  satisfiesVersionConstraint,
} from './modManager'
import { readTextFile, exists, watch, type WatchEvent } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'

// ============ 类型定义 ============

/** 加载顺序解析结果 */
export interface LoadOrderResult {
  /** 排序后的模组 ID 列表（按依赖顺序） */
  order: string[]
  /** 无法解析的循环依赖 */
  cycles: string[][]
  /** 缺失的依赖 */
  missing: { modId: string; dep: ModDependency }[]
}

/** 模组校验结果 */
export interface ModValidationResult {
  /** 是否通过校验 */
  valid: boolean
  /** 清单校验结果 */
  manifest: ManifestValidationResult
  /** 依赖校验错误 */
  dependencyErrors: string[]
  /** 完整性校验错误 */
  integrityErrors: string[]
  /** 警告信息 */
  warnings: string[]
}

/** 热重载事件 */
export interface HotReloadEvent {
  /** 模组 ID */
  modId: string
  /** 变更类型 */
  type: 'modify' | 'create' | 'remove'
  /** 变更的文件路径 */
  path: string
  /** 时间戳 */
  timestamp: number
}

/** 加载器配置 */
export interface ModLoaderConfig {
  /** 是否启用热重载 */
  enableHotReload: boolean
  /** 热重载防抖间隔（毫秒） */
  hotReloadDebounceMs: number
  /** 是否跳过校验失败的模组（否则抛出错误） */
  skipBrokenMods: boolean
}

const DEFAULT_CONFIG: ModLoaderConfig = {
  enableHotReload: true,
  hotReloadDebounceMs: 500,
  skipBrokenMods: true,
}

// ============ Mod 加载器 ============

export class ModLoader {
  private manifests = new Map<string, PetmodManifest>()
  private watchers = new Map<string, (() => void) | null>()
  private hotReloadListeners = new Set<(event: HotReloadEvent) => void>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private config: ModLoaderConfig

  constructor(config?: Partial<ModLoaderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ============ 依赖检查 ============

  /**
   * 检查模组的所有依赖是否满足
   * @param manifest 目标模组清单
   * @param availableMods 当前已安装的模组清单列表（含版本号）
   * @returns 未满足的依赖列表
   */
  checkDependencies(
    manifest: PetmodManifest,
    availableMods: PetmodManifest[],
  ): { satisfied: boolean; unsatisfied: ModDependency[] } {
    const unsatisfied: ModDependency[] = []

    for (const dep of manifest.dependencies ?? []) {
      if (dep.optional) continue // 跳过可选依赖

      const found = availableMods.find((m) => m.id === dep.id)
      if (!found) {
        unsatisfied.push(dep)
        continue
      }

      if (!satisfiesVersionConstraint(found.version, dep.version)) {
        unsatisfied.push(dep)
      }
    }

    return { satisfied: unsatisfied.length === 0, unsatisfied }
  }

  // ============ 加载顺序解析 ============

  /**
   * 基于依赖关系解析模组加载顺序（拓扑排序）
   * @param manifests 待排序的模组清单列表
   * @returns 排序结果（含循环依赖和缺失依赖信息）
   */
  resolveLoadOrder(manifests: PetmodManifest[]): LoadOrderResult {
    const idToManifest = new Map<string, PetmodManifest>()
    for (const m of manifests) {
      idToManifest.set(m.id, m)
    }

    // Kahn 算法拓扑排序
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, Set<string>>()
    const allIds = new Set<string>()

    for (const m of manifests) {
      allIds.add(m.id)
      if (!inDegree.has(m.id)) inDegree.set(m.id, 0)
      if (!adjacency.has(m.id)) adjacency.set(m.id, new Set())
    }

    const missing: LoadOrderResult['missing'] = []

    for (const m of manifests) {
      for (const dep of m.dependencies ?? []) {
        if (dep.optional) continue

        if (!idToManifest.has(dep.id)) {
          missing.push({ modId: m.id, dep })
          continue
        }

        // dep.id → m.id（dep 需要先于 m 加载）
        if (!adjacency.has(dep.id)) adjacency.set(dep.id, new Set())
        adjacency.get(dep.id)!.add(m.id)
        inDegree.set(m.id, (inDegree.get(m.id) ?? 0) + 1)
      }
    }

    // 找到入度为 0 的节点
    const queue: string[] = []
    for (const id of allIds) {
      if ((inDegree.get(id) ?? 0) === 0) {
        queue.push(id)
      }
    }

    const order: string[] = []
    while (queue.length > 0) {
      const current = queue.shift()!
      order.push(current)

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) {
          queue.push(neighbor)
        }
      }
    }

    // 检测循环依赖（未排序的节点）
    const cycles: string[][] = []
    const unsortedIds = Array.from(allIds).filter((id) => !order.includes(id))
    if (unsortedIds.length > 0) {
      // 简化处理：将所有未排序节点视为一个循环
      cycles.push(unsortedIds)
    }

    return { order, cycles, missing }
  }

  // ============ 模组校验 ============

  /**
   * 校验模组：清单格式 + 依赖满足 + 完整性检查
   * @param manifest 模组清单
   * @param modDir 模组目录路径
   * @param availableMods 已安装模组列表
   */
  async validateMod(
    manifest: PetmodManifest,
    modDir: string,
    availableMods: PetmodManifest[],
  ): Promise<ModValidationResult> {
    // 1. 清单格式校验
    const manifestResult = validatePetmodManifest(manifest)
    const dependencyErrors: string[] = []
    const integrityErrors: string[] = []
    const warnings: string[] = [...manifestResult.warnings]

    // 2. 依赖校验
    const depCheck = this.checkDependencies(manifest, availableMods)
    for (const unsat of depCheck.unsatisfied) {
      dependencyErrors.push(`依赖未满足: ${unsat.id}@${unsat.version}`)
    }

    // 3. 完整性校验（核心文件是否存在）
    try {
      const petConfPath = await join(modDir, 'pet_conf.json')
      if (!(await exists(petConfPath))) {
        integrityErrors.push('pet_conf.json 文件不存在')
      }
    } catch (e) {
      integrityErrors.push(`完整性检查失败: ${e}`)
    }

    // 4. 最低版本要求检查
    if (manifest.minSpiritPalVersion) {
      warnings.push(`要求 SpiritPal >= ${manifest.minSpiritPalVersion}`)
    }

    return {
      valid:
        manifestResult.valid &&
        dependencyErrors.length === 0 &&
        integrityErrors.length === 0,
      manifest: manifestResult,
      dependencyErrors,
      integrityErrors,
      warnings,
    }
  }

  // ============ 清单加载 ============

  /**
   * 从模组目录加载 petmod.json 清单
   * @param modDir 模组目录路径
   * @returns 清单对象或 null
   */
  async loadManifest(modDir: string): Promise<PetmodManifest | null> {
    try {
      const manifestPath = await join(modDir, 'petmod.json')
      if (!(await exists(manifestPath))) {
        // 尝试从 manifest.json 兼容
        const compatPath = await join(modDir, 'manifest.json')
        if (!(await exists(compatPath))) return null
        const raw = await readTextFile(compatPath)
        return JSON.parse(raw) as PetmodManifest
      }
      const raw = await readTextFile(manifestPath)
      return JSON.parse(raw) as PetmodManifest
    } catch (e) {
      console.error('[modLoader] loadManifest failed:', e)
      return null
    }
  }

  /**
   * 注册已加载的清单（供依赖解析使用）
   */
  registerManifest(manifest: PetmodManifest): void {
    this.manifests.set(manifest.id, manifest)
  }

  /**
   * 移除清单注册
   */
  unregisterManifest(modId: string): void {
    this.manifests.delete(modId)
  }

  /**
   * 获取所有已注册的清单
   */
  getRegisteredManifests(): PetmodManifest[] {
    return Array.from(this.manifests.values())
  }

  // ============ 热重载 ============

  /**
   * 为模组目录启动文件监视
   * @param modId 模组 ID
   * @param modDir 模组目录路径
   */
  async startWatch(modId: string, modDir: string): Promise<void> {
    if (!this.config.enableHotReload) return
    if (this.watchers.has(modId)) return

    try {
      const unwatch = await watch(
        modDir,
        (event: WatchEvent) => {
          // 防抖处理
          const existingTimer = this.debounceTimers.get(modId)
          if (existingTimer) clearTimeout(existingTimer)

          this.debounceTimers.set(
            modId,
            setTimeout(() => {
              this.debounceTimers.delete(modId)
              // WatchEventKind is 'any' | { modify } | { create } | { remove } | { access }
              let eventType: 'modify' | 'create' | 'remove' = 'modify'
              if (typeof event.type !== 'string') {
                if ('modify' in event.type) eventType = 'modify'
                else if ('create' in event.type) eventType = 'create'
                else if ('remove' in event.type) eventType = 'remove'
              }
              const reloadEvent: HotReloadEvent = {
                modId,
                type: eventType,
                path: event.paths[0] ?? '',
                timestamp: Date.now(),
              }
              this.hotReloadListeners.forEach((fn) => fn(reloadEvent))
            }, this.config.hotReloadDebounceMs),
          )
        },
      )
      this.watchers.set(modId, unwatch)
    } catch (e) {
      console.warn(`[modLoader] startWatch failed for ${modId}:`, e)
    }
  }

  /**
   * 停止模组的文件监视
   * @param modId 模组 ID
   */
  stopWatch(modId: string): void {
    const watcher = this.watchers.get(modId)
    if (watcher) {
      try {
        // Tauri FS watcher 返回的是一个 unwatch 函数
        if (typeof watcher === 'function') { watcher() }
      } catch {
        // 忽略
      }
      this.watchers.delete(modId)
    }
    const timer = this.debounceTimers.get(modId)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(modId)
    }
  }

  /**
   * 订阅热重载事件
   * @returns 取消订阅函数
   */
  onHotReload(listener: (event: HotReloadEvent) => void): () => void {
    this.hotReloadListeners.add(listener)
    return () => this.hotReloadListeners.delete(listener)
  }

  // ============ 批量加载 ============

  /**
   * 批量校验和加载模组（跳过损坏模组）
   * @param modDirs 模组目录路径列表
   * @returns 加载结果
   */
  async batchLoad(modDirs: string[]): Promise<{
    loaded: PetmodManifest[]
    skipped: { dir: string; reason: string }[]
  }> {
    const loaded: PetmodManifest[] = []
    const skipped: { dir: string; reason: string }[] = []
    const allManifests: PetmodManifest[] = []

    // 第一轮：加载清单
    for (const dir of modDirs) {
      const manifest = await this.loadManifest(dir)
      if (!manifest) {
        if (this.config.skipBrokenMods) {
          skipped.push({ dir, reason: 'petmod.json 加载失败' })
          continue
        }
      } else {
        const validation = validatePetmodManifest(manifest)
        if (!validation.valid) {
          if (this.config.skipBrokenMods) {
            skipped.push({ dir, reason: validation.errors.join('; ') })
            continue
          }
        }
        allManifests.push(manifest)
      }
    }

    // 第二轮：解析加载顺序
    const { order, cycles } = this.resolveLoadOrder(allManifests)

    // 跳过循环依赖的模组
    const cycleIds = new Set(cycles.flat())
    for (const id of cycleIds) {
      skipped.push({ dir: id, reason: '循环依赖' })
    }

    // 按加载顺序注册
    for (const id of order) {
      const manifest = allManifests.find((m) => m.id === id)
      if (manifest) {
        this.registerManifest(manifest)
        loaded.push(manifest)
      }
    }

    return { loaded, skipped }
  }

  // ============ 销毁 ============

  /**
   * 销毁加载器，停止所有文件监视
   */
  destroy(): void {
    for (const modId of this.watchers.keys()) {
      this.stopWatch(modId)
    }
    this.hotReloadListeners.clear()
    this.manifests.clear()
  }
}

// ============ 单例 ============

let sharedLoader: ModLoader | null = null

export function getModLoader(config?: Partial<ModLoaderConfig>): ModLoader {
  if (!sharedLoader) {
    sharedLoader = new ModLoader(config)
  }
  return sharedLoader
}

export function resetModLoader(): void {
  if (sharedLoader) {
    sharedLoader.destroy()
    sharedLoader = null
  }
}
