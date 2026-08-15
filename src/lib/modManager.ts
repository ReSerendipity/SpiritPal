/**
 * Mod管理器模块
 *
 * @fileoverview JSON驱动的角色模组系统，实现.petmod包的导入、安装、启用与元数据管理
 *
 * 主要模块：
 * - PetmodManifest/ManifestValidationResult: 模组清单与验证结果
 * - SemVer工具: parseSemVer/compareSemVer/satisfiesVersionConstraint
 * - ModManager: 模组管理器主类
 *
 * 依赖关系：
 * - types.ts: CharacterProfile, Personality, InventoryItem等类型
 * - behaviorEngine.ts: DEFAULT_ANIMATIONS动画定义
 * - db.ts: 模组持久化（saveMod/getMods/deleteMod）
 * - @tauri-apps/api: Tauri核心API与文件对话框
 * - @tauri-apps/plugin-fs: 文件系统访问
 *
 * 核心接口：
 * - importMod(): 导入.petmod模组包
 * - uninstallMod(): 卸载模组
 * - enableMod()/disableMod(): 启用/禁用模组
 * - getInstalledMods(): 获取已安装模组列表
 * - validatePetmodManifest(): 验证模组清单
 *
 * 模组结构（三层配置架构，参考同类桌宠方案）：
 * 角色名/
 * ├── pet_conf.json    # 角色层：基础属性、性格、偏好
 * ├── act_conf.json    # 动作层：动画列表、概率矩阵
 * ├── items_config.json # 物品层：角色专属物品
 * ├── dialogue.json    # 对话层：System Prompt、Few-shot
 * └── sprites/         # 精灵图资源
 */

import type { CharacterProfile, Personality, InventoryItem } from './types'
import { DEFAULT_ANIMATIONS, type AnimationDef } from './behaviorEngine'
import { saveMod, getMods, deleteMod, updateModEnabled } from './db'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, ask as askDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, exists } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

// ============ SemVer 版本号工具 ============

/** SemVer 版本号结构 */
export interface SemVer {
  major: number
  minor: number
  patch: number
  prerelease?: string
}

/** 解析 SemVer 版本号字符串（如 "1.2.3" 或 "2.0.0-beta.1"） */
export function parseSemVer(version: string): SemVer | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!match) return null
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    prerelease: match[4],
  }
}

/** 校验 SemVer 版本号格式 */
export function isValidSemVer(version: string): boolean {
  return parseSemVer(version) !== null
}

/** SemVer 版本号比较（返回 -1 / 0 / 1） */
export function compareSemVer(a: string, b: string): number {
  const va = parseSemVer(a)
  const vb = parseSemVer(b)
  if (!va || !vb) return 0
  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1
  // 有 prerelease 的版本低于同版本的正式版
  if (va.prerelease && !vb.prerelease) return -1
  if (!va.prerelease && vb.prerelease) return 1
  if (va.prerelease && vb.prerelease) {
    return va.prerelease < vb.prerelease ? -1 : va.prerelease > vb.prerelease ? 1 : 0
  }
  return 0
}

/** 检查版本是否满足约束（如 "^1.2.3"、">=2.0.0"、"1.x"） */
export function satisfiesVersionConstraint(version: string, constraint: string): boolean {
  const v = parseSemVer(version)
  if (!v) return false

  // "^x.y.z" — 兼容版本范围（major 相同且 >=）
  const caretMatch = constraint.match(/^\^(\d+)\.(\d+)\.(\d+)$/)
  if (caretMatch) {
    const cmajor = parseInt(caretMatch[1])
    const cminor = parseInt(caretMatch[2])
    const cpatch = parseInt(caretMatch[3])
    if (v.major !== cmajor) return false
    if (v.minor > cminor) return true
    if (v.minor === cminor && v.patch >= cpatch) return true
    return false
  }

  // ">=x.y.z"
  const gteMatch = constraint.match(/^>=(\d+)\.(\d+)\.(\d+)$/)
  if (gteMatch) {
    return compareSemVer(version, `${gteMatch[1]}.${gteMatch[2]}.${gteMatch[3]}`) >= 0
  }

  // "x.y.z" — 精确匹配
  if (isValidSemVer(constraint)) {
    return compareSemVer(version, constraint) === 0
  }

  // "x.*" 或 "x.y.*" — 通配符匹配
  const wildMatch = constraint.match(/^(\d+)(?:\.(\d+))?(?:\.\*)?$/)
  if (wildMatch) {
    const wmajor = parseInt(wildMatch[1])
    if (v.major !== wmajor) return false
    if (wildMatch[2] !== undefined) {
      return v.minor === parseInt(wildMatch[2])
    }
    return true
  }

  return false
}

// ============ petmod.json 元数据类型 ============

/** petmod.json 依赖声明 */
export interface ModDependency {
  /** 依赖模组 ID */
  id: string
  /** 版本约束（SemVer 范围，如 "^1.2.3"） */
  version: string
  /** 是否为可选依赖 */
  optional?: boolean
}

/** petmod.json 权限声明 */
export interface ModPermission {
  /** 权限名称 */
  name: string
  /** 权限说明 */
  description?: string
  /** 是否为必需权限（必需权限被拒绝时模组无法运行） */
  required?: boolean
}

/** petmod.json 清单 — Mod 包格式规范 */
export interface PetmodManifest {
  /** 模组唯一 ID（kebab-case） */
  id: string
  /** 模组名称 */
  name: string
  /** SemVer 版本号 */
  version: string
  /** 作者 */
  author: string
  /** 描述 */
  description: string
  /** 模组图标路径（相对于模组根目录） */
  icon?: string
  /** 模组主页/仓库 URL */
  homepage?: string
  /** 最低 SpiritPal 版本要求 */
  minSpiritPalVersion?: string
  /** 依赖声明 */
  dependencies?: ModDependency[]
  /** 权限声明 */
  permissions?: ModPermission[]
  /** 入口文件路径（默认 pet_conf.json） */
  entry?: string
  /** 标签/关键词 */
  keywords?: string[]
}

/** petmod.json 校验结果 */
export interface ManifestValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/** 校验 petmod.json 清单格式 */
export function validatePetmodManifest(manifest: unknown): ManifestValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['清单不是有效对象'], warnings }
  }

  const m = manifest as Record<string, unknown>

  // 必需字段
  if (!m.id || typeof m.id !== 'string') {
    errors.push('id 字段缺失或类型错误（应为 string）')
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(m.id as string)) {
    errors.push('id 字段格式错误（应为 kebab-case）')
  }

  if (!m.name || typeof m.name !== 'string') {
    errors.push('name 字段缺失或类型错误')
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push('version 字段缺失或类型错误')
  } else if (!isValidSemVer(m.version as string)) {
    errors.push(`version "${m.version}" 不符合 SemVer 格式`)
  }

  if (!m.author || typeof m.author !== 'string') {
    errors.push('author 字段缺失或类型错误')
  }

  if (!m.description || typeof m.description !== 'string') {
    warnings.push('description 字段缺失（建议填写）')
  }

  // 依赖校验
  if (m.dependencies && Array.isArray(m.dependencies)) {
    for (let i = 0; i < m.dependencies.length; i++) {
      const dep = m.dependencies[i] as Record<string, unknown>
      if (!dep.id || typeof dep.id !== 'string') {
        errors.push(`dependencies[${i}].id 缺失或类型错误`)
      }
      if (!dep.version || typeof dep.version !== 'string') {
        errors.push(`dependencies[${i}].version 缺失或类型错误`)
      }
    }
  }

  // 权限校验
  if (m.permissions && Array.isArray(m.permissions)) {
    for (let i = 0; i < m.permissions.length; i++) {
      const perm = m.permissions[i] as Record<string, unknown>
      if (!perm.name || typeof perm.name !== 'string') {
        errors.push(`permissions[${i}].name 缺失或类型错误`)
      }
    }
  }

  // minSpiritPalVersion 校验
  if (m.minSpiritPalVersion && typeof m.minSpiritPalVersion === 'string') {
    if (!isValidSemVer(m.minSpiritPalVersion as string)) {
      warnings.push(`minSpiritPalVersion "${m.minSpiritPalVersion}" 不符合 SemVer 格式`)
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ============ 模组配置文件类型 ============

export interface PetConfJSON {
  id: string
  name: string
  displayName: string
  source: string
  birthBackground: string
  emotionalCore: string
  personality: Personality
  signaturePhrase: string
  classicQuotes: string[]
  themeColor: { primary: string; secondary: string }
  favoriteItems: string[]
  dislikeItems: string[]
  spriteAsset: string
  spriteType: 'atlas' | 'svg' | 'gif' | 'video'
  activeHours: { start: number; end: number }
}

export interface ActConfJSON {
  animations: AnimationDef[]
  hpTiers: {
    tier3: { min: number; label: string }
    tier2: { min: number; label: string }
    tier1: { min: number; label: string }
    tier0: { min: number; label: string }
  }
  anchors: Record<string, { anchorX: number; anchorY: number; loop: boolean; next?: string }>
  // Live2D 动作映射：PetState → Live2D motion group 名称
  // 缺省时使用 Live2DRenderer 内置的默认映射
  motionMap?: Record<string, string>
}

export interface ItemsConfJSON {
  foods: Omit<InventoryItem, 'count'>[]
  toys: Omit<InventoryItem, 'count'>[]
  medicines: Omit<InventoryItem, 'count'>[]
}

export interface DialogueConfJSON {
  systemPrompt: string
  fewShotExamples: { user: string; assistant: string }[]
  bubbleMessages: {
    idle: string[]
    hungry: string[]
    sad: string[]
    pet: string[]
    feed: string[]
    pomodoroDone: string[]
  }
}

// ============ 完整模组包 ============

export interface CharacterMod {
  petConf: PetConfJSON
  actConf?: ActConfJSON
  itemsConf?: ItemsConfJSON
  dialogueConf: DialogueConfJSON
}

// ============ 模组信息（管理界面用）============

export interface ModInfo {
  id: string
  displayName: string
  source: string
  version: string
  enabled: boolean
  isBuiltIn: boolean
  installedAt: number
  modData: CharacterMod
  /** SHA-256 签名（.petmod 导入时计算） */
  sha256?: string
  /** 模组在文件系统中的路径（.petmod 导入时记录） */
  modPath?: string
}

/** 文件系统扫描得到的模组信息（轻量级，不含完整 modData） */
export interface ScannedModInfo {
  id: string
  name: string
  path: string
}

// ============ 模组管理器 ============

export class ModManager {
  private mods: ModInfo[] = []
  private listeners: Set<() => void> = new Set()
  private initPromise: Promise<void>

  constructor() {
    this.initPromise = this.load()
  }

  /** 等待异步加载完成（外部调用可选） */
  async ensureLoaded(): Promise<void> {
    await this.initPromise
  }

  private async load(): Promise<void> {
    try {
      const rows = await getMods()
      this.mods = rows.map((row) => {
        // config 字段存储了完整的 ModInfo JSON
        const fullMod = JSON.parse(row.config) as Partial<ModInfo>
        return {
          id: row.id,
          displayName: row.name ?? fullMod.displayName ?? fullMod.id ?? row.id,
          source: fullMod.source ?? '',
          version: row.version ?? fullMod.version ?? '1.0.0',
          enabled: row.enabled === 1,
          isBuiltIn: fullMod.isBuiltIn ?? false,
          installedAt: row.installed_at ?? fullMod.installedAt ?? Date.now(),
          modData: fullMod.modData as CharacterMod,
          sha256: fullMod.sha256,
          modPath: fullMod.modPath,
        }
      })
    } catch {
      // 使用默认空列表
    }
    this.notifyListeners()
  }

  /** 将单个模组持久化到 SQLite（异步，不阻塞调用方） */
  private async persistMod(mod: ModInfo): Promise<void> {
    try {
      await saveMod({
        id: mod.id,
        name: mod.displayName,
        version: mod.version,
        config: mod,
        enabled: mod.enabled,
      })
    } catch (e) {
      console.warn(`[ModManager] Failed to persist mod "${mod.id}":`, e)
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ============ 安装模组 ============

  installMod(modData: CharacterMod, sha256?: string, modPath?: string): ModInfo {
    // 检查是否已存在
    const existing = this.mods.find((m) => m.id === modData.petConf.id)
    if (existing) {
      // 更新
      existing.modData = modData
      existing.installedAt = Date.now()
      if (sha256) existing.sha256 = sha256
      if (modPath) existing.modPath = modPath
      void this.persistMod(existing)
      this.notifyListeners()
      return existing
    }

    const modInfo: ModInfo = {
      id: modData.petConf.id,
      displayName: modData.petConf.displayName,
      source: modData.petConf.source,
      version: '1.0.0',
      enabled: true,
      isBuiltIn: false,
      installedAt: Date.now(),
      modData,
      sha256,
      modPath,
    }
    this.mods.push(modInfo)
    void this.persistMod(modInfo)
    this.notifyListeners()
    return modInfo
  }

  // 从 JSON 字符串安装
  installFromJSON(jsonStr: string): ModInfo | null {
    try {
      const data = JSON.parse(jsonStr) as CharacterMod
      if (!data.petConf || !data.dialogueConf) return null
      return this.installMod(data)
    } catch {
      return null
    }
  }

  // ============ 卸载模组 ============

  uninstallMod(id: string): void {
    this.mods = this.mods.filter((m) => m.id !== id || m.isBuiltIn)
    void deleteMod(id)
    this.notifyListeners()
  }

  // ============ 启用/禁用 ============

  enableMod(id: string): void {
    const mod = this.mods.find((m) => m.id === id)
    if (mod) {
      mod.enabled = true
      void updateModEnabled(id, true)
      this.notifyListeners()
    }
  }

  disableMod(id: string): void {
    const mod = this.mods.find((m) => m.id === id)
    if (mod && !mod.isBuiltIn) {
      mod.enabled = false
      void updateModEnabled(id, false)
      this.notifyListeners()
    }
  }

  // ============ 查询 ============

  getMods(): ModInfo[] {
    return [...this.mods]
  }

  getEnabledMods(): ModInfo[] {
    return this.mods.filter((m) => m.enabled)
  }

  getMod(id: string): ModInfo | undefined {
    return this.mods.find((m) => m.id === id)
  }

  // ============ 转换为 CharacterProfile ============

  toCharacterProfile(mod: ModInfo): CharacterProfile {
    const { petConf, dialogueConf } = mod.modData
    return {
      id: petConf.id,
      name: petConf.name,
      displayName: petConf.displayName,
      source: petConf.source,
      birthBackground: petConf.birthBackground,
      emotionalCore: petConf.emotionalCore,
      personality: petConf.personality,
      signaturePhrase: petConf.signaturePhrase,
      classicQuotes: petConf.classicQuotes,
      systemPrompt: dialogueConf.systemPrompt,
      fewShotExamples: dialogueConf.fewShotExamples,
      spriteAsset: petConf.spriteAsset,
      spriteType: petConf.spriteType,
      themeColor: petConf.themeColor,
      bubbleMessages: dialogueConf.bubbleMessages,
      favoriteItems: petConf.favoriteItems,
      dislikeItems: petConf.dislikeItems,
    }
  }

  // ============ 导出模组 ============

  exportMod(id: string): string | null {
    const mod = this.getMod(id)
    if (!mod) return null
    return JSON.stringify(mod.modData, null, 2)
  }

  // ============ 扫描本地模组目录 ============

  /**
   * 扫描本地模组目录，返回文件系统中发现的所有模组
   * 调用后端 scan_mods_directory 命令遍历子文件夹
   */
  async scanLocalMods(dirPath?: string): Promise<ScannedModInfo[]> {
    try {
      const targetDir = dirPath ?? (await this.getModsDir())
      const result = await invoke<{ mods: ScannedModInfo[] }>('scan_mods_directory', {
        dirPath: targetDir,
      })
      return result.mods
    } catch (e) {
      console.error('[modManager] scanLocalMods failed:', e)
      return []
    }
  }

  // ============ .petmod 压缩包导入 ============

  /** 获取模组目录路径（appDataDir/mods） */
  async getModsDir(): Promise<string> {
    const base = await appDataDir()
    return await join(base, 'mods')
  }

  /**
   * 导入 .petmod 压缩包文件
   * 1. 打开文件选择对话框让用户选择 .petmod 文件
   * 2. 调用后端 import_petmod 解压 + SHA-256 校验
   * 3. 加载解压后的模组配置
   * 4. 验证签名（与 manifest 中的预期签名比对）
   */
  async importPetmodFile(): Promise<{
    success: boolean
    modId: string
    sha256: string
    error?: string
    warning?: string
  }> {
    // 1. 打开文件选择对话框
    let selected: string | null = null
    try {
      const result = await openDialog({
        filters: [{ name: 'SpiritPal Mod', extensions: ['petmod'] }],
        multiple: false,
      })
      if (typeof result === 'string') {
        selected = result
      }
    } catch (e) {
      return { success: false, modId: '', sha256: '', error: `文件选择失败: ${e}` }
    }

    if (!selected) {
      return { success: false, modId: '', sha256: '', error: '未选择文件' }
    }

    // 2. 获取模组目录
    let modsDir: string
    try {
      modsDir = await this.getModsDir()
    } catch (e) {
      return { success: false, modId: '', sha256: '', error: `获取模组目录失败: ${e}` }
    }

    // 3. 调用后端解压 + 校验
    let importResult: { success: boolean; modId: string; sha256: string; error?: string }
    try {
      importResult = await invoke<{
        success: boolean
        modId: string
        sha256: string
        error?: string
      }>('import_petmod', { filePath: selected, targetDir: modsDir })
    } catch (e) {
      return { success: false, modId: '', sha256: '', error: `后端调用失败: ${e}` }
    }

    if (!importResult.success) {
      return importResult
    }

    // 4. SHA-256 签名校验（在安装前进行，确保用户决策权）
    // SECURITY: [R7-A] 签名不匹配时让用户决策是否继续安装
    //   - 旧实现：签名不匹配仅 warning，installMod 已执行，安全风险静默通过
    //   - 修复：校验前置到 installMod 之前；不匹配时弹窗询问用户
    //   - 用户拒绝 → 不安装，返回 error
    //   - 用户确认 → 继续安装，warning 标注"用户已确认"
    // ROBUSTNESS: [D6] 纵深防御——签名校验失败时暴露风险而非静默吞过
    const modPath = await join(modsDir, importResult.modId)
    const actualSha = importResult.sha256
    let warning: string | undefined
    let signatureMismatch = false
    let expectedSha: string | undefined

    try {
      const manifestPath = await join(modPath, 'manifest.json')
      if (await exists(manifestPath)) {
        const manifestRaw = await readTextFile(manifestPath)
        const manifest = JSON.parse(manifestRaw) as { expectedSha256?: string }
        expectedSha = manifest.expectedSha256
        if (expectedSha && expectedSha !== actualSha) {
          signatureMismatch = true
        }
      }
    } catch (e) {
      // manifest 解析失败不阻断导入，但记录 warning 供用户感知
      warning = `manifest 解析失败: ${e}`
    }

    if (signatureMismatch) {
      const msg =
        `SHA-256 签名不匹配！\n\n` +
        `预期: ${(expectedSha ?? '').slice(0, 16)}...\n` +
        `实际: ${actualSha.slice(0, 16)}...\n\n` +
        `继续安装可能存在安全风险（如模组被篡改）。是否继续？`
      let userConfirmed: boolean
      try {
        // PLATFORM-SPECIFIC: [P3.1] 调用 Tauri dialog 插件在主进程弹窗
        // kind: 'warning' 在 Windows 上显示黄色感叹号图标
        userConfirmed = await askDialog(msg, { title: '签名校验失败', kind: 'warning' })
      } catch {
        // dialog 调用失败时保守拒绝（永不信任原则）
        userConfirmed = false
      }
      if (!userConfirmed) {
        return {
          success: false,
          modId: importResult.modId,
          sha256: actualSha,
          error: '签名校验失败，用户取消安装',
        }
      }
      warning = `SHA-256 签名不匹配（用户已确认继续安装）`
    }

    // 5. 加载模组配置并安装（签名校验通过或用户确认后）
    try {
      const loaded = await this.loadModFromDirectory(modPath)
      if (loaded) {
        this.installMod(loaded, actualSha, modPath)
      } else {
        warning = warning ?? '模组解压成功但配置加载失败'
      }
    } catch (e) {
      warning = warning ?? `模组导入成功但配置加载失败: ${e}`
    }

    return { ...importResult, warning }
  }

  /**
   * 从已解压的模组目录加载完整配置
   * 读取 pet_conf.json / act_conf.json / items_config.json / dialogue.json
   *
   * ROBUSTNESS: [R7-B] 单文件失败隔离策略
   *   - pet_conf.json 必需：缺失或解析失败 → 返回 null（核心配置不可降级）
   *   - act_conf.json / items_config.json / dialogue.json 可选：解析失败仅 console.warn
   *     跳过该文件继续加载其他配置，避免单文件损坏导致整个模组不可用
   *   - dialogue.json 缺失时使用默认值（保留原行为）
   */
  async loadModFromDirectory(modDir: string): Promise<CharacterMod | null> {
    // 读取 pet_conf.json（必需）—— 失败立即返回 null，不进入降级路径
    let petConf: PetConfJSON
    try {
      const petConfPath = await join(modDir, 'pet_conf.json')
      if (!(await exists(petConfPath))) {
        console.error('[modManager] pet_conf.json not found in', modDir)
        return null
      }
      petConf = JSON.parse(await readTextFile(petConfPath)) as PetConfJSON
    } catch (e) {
      // pet_conf.json 是核心配置，解析失败不可降级
      console.error('[modManager] pet_conf.json 解析失败:', e)
      return null
    }

    // 读取 act_conf.json（可选）—— 单文件失败隔离
    let actConf: ActConfJSON | undefined
    try {
      const actConfPath = await join(modDir, 'act_conf.json')
      if (await exists(actConfPath)) {
        actConf = JSON.parse(await readTextFile(actConfPath)) as ActConfJSON
      }
    } catch (e) {
      // ROBUSTNESS: [E1] act_conf.json 损坏不阻断整个模组加载，降级使用默认动画
      console.warn('[modManager] act_conf.json 解析失败，将使用默认动画配置:', e)
    }

    // 读取 items_config.json（可选）—— 单文件失败隔离
    let itemsConf: ItemsConfJSON | undefined
    try {
      const itemsConfPath = await join(modDir, 'items_config.json')
      if (await exists(itemsConfPath)) {
        itemsConf = JSON.parse(await readTextFile(itemsConfPath)) as ItemsConfJSON
      }
    } catch (e) {
      console.warn('[modManager] items_config.json 解析失败，将使用默认物品配置:', e)
    }

    // 读取 dialogue.json（可选，缺失或解析失败时使用默认）
    let dialogueConf: DialogueConfJSON
    try {
      const dialoguePath = await join(modDir, 'dialogue.json')
      if (await exists(dialoguePath)) {
        dialogueConf = JSON.parse(await readTextFile(dialoguePath)) as DialogueConfJSON
      } else {
        dialogueConf = {
          systemPrompt: `你是${petConf.displayName}，一个可爱的虚拟宠物。`,
          fewShotExamples: [],
          bubbleMessages: {
            idle: [],
            hungry: [],
            sad: [],
            pet: [],
            feed: [],
            pomodoroDone: [],
          },
        }
      }
    } catch (e) {
      // ROBUSTNESS: [E2] dialogue.json 解析失败时降级到默认对话配置，保证模组可用
      console.warn('[modManager] dialogue.json 解析失败，使用默认对话配置:', e)
      dialogueConf = {
        systemPrompt: `你是${petConf.displayName}，一个可爱的虚拟宠物。`,
        fewShotExamples: [],
        bubbleMessages: {
          idle: [],
          hungry: [],
          sad: [],
          pet: [],
          feed: [],
          pomodoroDone: [],
        },
      }
    }

    return { petConf, actConf, itemsConf, dialogueConf }
  }

  /**
   * 计算文件的 SHA-256 校验和
   * 用于安装前签名校验
   */
  async computeSha256(filePath: string): Promise<string | null> {
    try {
      return await invoke<string>('compute_sha256', { filePath })
    } catch (e) {
      console.error('[modManager] computeSha256 failed:', e)
      return null
    }
  }

  /**
   * 校验已安装模组的 SHA-256 签名
   * 与 manifest 中的预期签名比对，不匹配时返回警告信息
   */
  async verifyModSignature(modId: string): Promise<{ valid: boolean; message: string }> {
    const mod = this.getMod(modId)
    if (!mod || !mod.modPath) {
      return { valid: true, message: '模组无路径信息，跳过校验' }
    }

    try {
      const manifestPath = await join(mod.modPath, 'manifest.json')
      if (!(await exists(manifestPath))) {
        return { valid: true, message: '模组无 manifest，跳过签名校验' }
      }

      const manifest = JSON.parse(await readTextFile(manifestPath))
      if (!manifest.expectedSha256) {
        return { valid: true, message: 'manifest 未指定预期签名，跳过校验' }
      }

      if (!mod.sha256) {
        return { valid: false, message: '模组未记录 SHA-256 签名' }
      }

      if (manifest.expectedSha256 !== mod.sha256) {
        return {
          valid: false,
          message: `SHA-256 签名不匹配！预期: ${manifest.expectedSha256.slice(0, 16)}... 实际: ${mod.sha256.slice(0, 16)}...`,
        }
      }

      return { valid: true, message: '签名校验通过' }
    } catch (e) {
      return { valid: false, message: `签名校验失败: ${e}` }
    }
  }
}

// ============ 模组创建模板 ============

export function createModTemplate(): CharacterMod {
  return {
    petConf: {
      id: 'custom-pet',
      name: 'custom',
      displayName: '自定义宠物',
      source: '自定义',
      birthBackground: '一只由用户创建的虚拟宠物',
      emotionalCore: '温柔善良，喜欢陪伴主人',
      personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0, rationality: 0 },
      signaturePhrase: '你好呀！',
      classicQuotes: ['很高兴见到你！'],
      themeColor: { primary: '#FFB6C1', secondary: '#A777E3' },
      favoriteItems: [],
      dislikeItems: [],
      spriteAsset: '/pets/doro/spritesheet.webp',
      spriteType: 'atlas',
      activeHours: { start: 8, end: 23 },
    },
    actConf: {
      animations: DEFAULT_ANIMATIONS,
      hpTiers: {
        tier3: { min: 80, label: '活力' },
        tier2: { min: 50, label: '正常' },
        tier1: { min: 20, label: '饥饿' },
        tier0: { min: 0, label: '濒死' },
      },
      anchors: {
        idle: { anchorX: 150, anchorY: 380, loop: true },
        walk: { anchorX: 150, anchorY: 380, loop: true, next: 'idle' },
        sleep: { anchorX: 150, anchorY: 390, loop: true },
      },
    },
    itemsConf: {
      foods: [],
      toys: [],
      medicines: [],
    },
    dialogueConf: {
      systemPrompt: '你是一个可爱的虚拟宠物，请用温暖可爱的语气回答主人。',
      fewShotExamples: [
        { user: '你好', assistant: '你好呀！很高兴见到你！' },
      ],
      bubbleMessages: {
        idle: ['在想什么呢～', '今天也要加油哦！'],
        hungry: ['肚子饿了……'],
        sad: ['呜呜……'],
        pet: ['好舒服～'],
        feed: ['谢谢主人！'],
        pomodoroDone: ['完成啦！'],
      },
    },
  }
}

// ============ 单例 ============

let sharedMgr: ModManager | null = null

export function getModManager(): ModManager {
  if (!sharedMgr) {
    sharedMgr = new ModManager()
  }
  return sharedMgr
}
