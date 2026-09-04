/**
 * 插件权限与沙箱模块
 *
 * @fileoverview 插件权限审批、SSRF防护、内容过滤与沙箱安全模型（参考OpenPets）
 *
 * 主要模块：
 * - ApprovedPermissions/PermissionApproval: 权限记录与审批结果
 * - PermissionManager: 权限管理器（声明、审批、验证）
 * - PluginSandboxManager: 沙箱管理器（域名白名单、内容过滤）
 *
 * 依赖关系：
 * - pluginSdk.ts: PluginManifest/PluginPermission/PluginSandboxConfig类型
 *
 * 核心接口：
 * - PermissionManager.requestApproval(): 请求权限审批
 * - PermissionManager.checkPermission(): 验证权限是否已批准
 * - PluginSandboxManager.validateUrl(): SSRF防护URL验证
 * - PluginSandboxManager.filterContent(): AI输出内容过滤
 * - getPluginSandboxManager(): 获取沙箱管理器单例
 *
 * 核心机制（参考OpenPets沙箱安全设计）：
 * 1. 权限守门：manifest声明权限，安装时用户审批，细粒度控制
 * 2. SSRF防护：网络请求限制为manifest声明的域名白名单
 * 3. 内容过滤：AI输出经过本地敏感词/有害内容过滤
 * 4. 沙箱隔离：插件运行在隔离Context中，能力受限
 */

import type { PluginManifest, PluginPermission, PluginSandboxConfig } from './pluginSdk'

// ============ 权限管理 ============

/** 已批准的权限记录 */
interface ApprovedPermissions {
  pluginId: string
  permissions: PluginPermission[]
  approvedAt: number
  expiresAt?: number
}

/** 权限审批结果 */
export interface PermissionApproval {
  granted: boolean
  pluginId: string
  permissions: PluginPermission[]
  deniedPermissions?: PluginPermission[]
  reason?: string
}

/**
 * 权限管理器 — 管理插件权限的声明、审批和验证
 */
export class PermissionManager {
  private approvedPermissions = new Map<string, ApprovedPermissions>()

  /**
   * 请求权限审批
   * @param manifest 插件清单
   * @param userApproved 用户批准的权限列表（null = 全部批准）
   * @returns 审批结果
   */
  requestApproval(
    manifest: PluginManifest,
    userApproved?: PluginPermission[] | null,
  ): PermissionApproval {
    const requested = manifest.permissions

    if (userApproved === null) {
      // 用户批准所有权限
      this.approvedPermissions.set(manifest.id, {
        pluginId: manifest.id,
        permissions: requested,
        approvedAt: Date.now(),
      })
      return {
        granted: true,
        pluginId: manifest.id,
        permissions: requested,
      }
    }

    if (userApproved === undefined) {
      // 未做选择，拒绝所有
      return {
        granted: false,
        pluginId: manifest.id,
        permissions: requested,
        deniedPermissions: requested,
        reason: '用户未做出选择',
      }
    }

    // 部分批准
    const granted = requested.filter(p => userApproved.includes(p))
    const denied = requested.filter(p => !userApproved.includes(p))

    if (granted.length > 0) {
      this.approvedPermissions.set(manifest.id, {
        pluginId: manifest.id,
        permissions: granted,
        approvedAt: Date.now(),
      })
    }

    return {
      granted: granted.length > 0,
      pluginId: manifest.id,
      permissions: granted,
      deniedPermissions: denied.length > 0 ? denied : undefined,
      reason: denied.length > 0 ? `拒绝了 ${denied.length} 个权限` : undefined,
    }
  }

  /**
   * 检查插件是否拥有指定权限
   * @param pluginId 插件 ID
   * @param permission 权限
   * @returns 是否拥有
   */
  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    const approved = this.approvedPermissions.get(pluginId)
    if (!approved) return false
    return approved.permissions.includes(permission)
  }

  /**
   * 检查插件是否拥有所有指定权限
   * @param pluginId 插件 ID
   * @param permissions 权限列表
   * @returns 是否拥有所有权限
   */
  hasAllPermissions(pluginId: string, permissions: PluginPermission[]): boolean {
    return permissions.every(p => this.hasPermission(pluginId, p))
  }

  /**
   * 获取插件已批准的权限列表
   * @param pluginId 插件 ID
   * @returns 已批准的权限列表
   */
  getApprovedPermissions(pluginId: string): PluginPermission[] {
    return this.approvedPermissions.get(pluginId)?.permissions ?? []
  }

  /**
   * 撤销插件的所有权限
   * @param pluginId 插件 ID
   */
  revokeAll(pluginId: string): void {
    this.approvedPermissions.delete(pluginId)
  }

  /**
   * 获取所有已注册的插件 ID
   */
  getRegisteredPluginIds(): string[] {
    return Array.from(this.approvedPermissions.keys())
  }
}

// ============ SSRF 防护 ============

/**
 * SSRF 防护器 — 限制网络请求的目标域名
 */
export class SSRFGuard {
  private allowedDomains: Set<string>
  private blockedPatterns: RegExp[]

  constructor(
    allowedDomains: string[] = [],
    blockedPatterns: RegExp[] = [],
  ) {
    this.allowedDomains = new Set(allowedDomains)
    this.blockedPatterns = [
      // 内网地址
      /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i,
      /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
      /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/,
      /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
      // 元数据服务
      /^https?:\/\/169\.254\.\d+\.\d+(:\d+)?$/,
      // IPv6 本地地址
      /^https?:\/\/\[::1\](:\d+)?$/,
      ...blockedPatterns,
    ]
  }

  /**
   * 检查 URL 是否允许访问
   * @param url 目标 URL
   * @returns 是否允许
   */
  isAllowed(url: string): boolean {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname

      // 检查阻断模式
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(url)) return false
      }

      // 如果白名单为空，允许所有非内网地址
      if (this.allowedDomains.size === 0) {
        return true
      }

      // 检查白名单
      for (const domain of this.allowedDomains) {
        if (host === domain || host.endsWith(`.${domain}`)) {
          return true
        }
      }

      return false
    } catch {
      // URL 解析失败，拒绝
      return false
    }
  }

  /**
   * 添加允许的域名
   * @param domain 域名
   */
  addAllowedDomain(domain: string): void {
    this.allowedDomains.add(domain)
  }

  /**
   * 移除允许的域名
   * @param domain 域名
   */
  removeAllowedDomain(domain: string): void {
    this.allowedDomains.delete(domain)
  }

  /**
   * 获取所有允许的域名
   */
  getAllowedDomains(): string[] {
    return Array.from(this.allowedDomains)
  }
}

// ============ 内容过滤 ============

/** 过滤结果 */
export interface FilterResult {
  /** 是否通过过滤 */
  passed: boolean
  /** 过滤后的内容（可能被修改） */
  filtered: string
  /** 被检测到的问题 */
  issues: string[]
}

/**
 * 内容过滤器 — 过滤 AI 输出中的敏感内容
 * 用于 TTS 语音文本、气泡消息等
 */
export class ContentFilter {
  /** 敏感词列表（基础） */
  private sensitiveWords: Set<string>
  /** 自定义过滤规则 */
  private customRules: Array<{ pattern: RegExp; replacement: string }> = []

  constructor(sensitiveWords: string[] = []) {
    this.sensitiveWords = new Set(sensitiveWords.map(w => w.toLowerCase()))
  }

  /**
   * 过滤文本
   * @param text 待过滤文本
   * @returns 过滤结果
   */
  filter(text: string): FilterResult {
    const issues: string[] = []
    let filtered = text

    // 1. 基础敏感词过滤
    for (const word of this.sensitiveWords) {
      if (filtered.toLowerCase().includes(word)) {
        issues.push(`包含敏感词: ${word}`)
        filtered = filtered.replace(new RegExp(word, 'gi'), '***')
      }
    }

    // 2. 自定义规则过滤
    for (const rule of this.customRules) {
      if (rule.pattern.test(filtered)) {
        issues.push(`匹配规则: ${rule.pattern.source}`)
        filtered = filtered.replace(rule.pattern, rule.replacement)
      }
    }

    // 3. 代码注入检测
    if (/(?:import|require|eval|exec|system|cmd|shell)/i.test(filtered)) {
      issues.push('可能包含代码注入')
      filtered = filtered.replace(
        /(?:import|require|eval|exec|system|cmd|shell)\s*\([^)]*\)/gi,
        '[filtered]',
      )
    }

    // 4. URL/路径泄露检测
    if (/(?:file:\/\/|\\\\|[A-Z]:\\)/i.test(filtered)) {
      issues.push('可能包含文件路径泄露')
      filtered = filtered.replace(/(?:file:\/\/|\\\\[^\s]+|[A-Z]:\\[^\s]+)/gi, '[path]')
    }

    return {
      passed: issues.length === 0,
      filtered,
      issues,
    }
  }

  /**
   * 添加自定义过滤规则
   * @param pattern 正则表达式
   * @param replacement 替换文本
   */
  addRule(pattern: RegExp, replacement: string): void {
    this.customRules.push({ pattern, replacement })
  }

  /**
   * 添加敏感词
   * @param words 敏感词列表
   */
  addSensitiveWords(words: string[]): void {
    for (const word of words) {
      this.sensitiveWords.add(word.toLowerCase())
    }
  }

  /**
   * 移除敏感词
   * @param words 敏感词列表
   */
  removeSensitiveWords(words: string[]): void {
    for (const word of words) {
      this.sensitiveWords.delete(word.toLowerCase())
    }
  }
}

// ============ 沙箱管理器 ============

/**
 * 插件沙箱管理器 — 整合权限、SSRF、内容过滤
 */
export class PluginSandboxManager {
  readonly permissions: PermissionManager
  readonly ssrfGuard: SSRFGuard
  readonly contentFilter: ContentFilter
  private configs = new Map<string, PluginSandboxConfig>()

  constructor() {
    this.permissions = new PermissionManager()
    this.ssrfGuard = new SSRFGuard()
    this.contentFilter = new ContentFilter()
  }

  /**
   * 注册插件沙箱配置
   * @param manifest 插件清单
   * @param config 沙箱配置
   */
  registerPlugin(manifest: PluginManifest, config?: Partial<PluginSandboxConfig>): void {
    const fullConfig: PluginSandboxConfig = {
      allowNetwork: true,
      allowedDomains: [],
      allowFileSystem: false,
      allowedPathPrefixes: [],
      maxMemoryMB: 64,
      maxExecutionTimeS: 30,
      allowClipboard: false,
      ...config,
    }

    this.configs.set(manifest.id, fullConfig)

    // 将允许的域名添加到 SSRF 防护器
    for (const domain of fullConfig.allowedDomains) {
      this.ssrfGuard.addAllowedDomain(domain)
    }
  }

  /**
   * 验证网络请求是否允许
   * @param pluginId 插件 ID
   * @param url 目标 URL
   * @returns 是否允许
   */
  validateNetworkRequest(pluginId: string, url: string): boolean {
    const config = this.configs.get(pluginId)
    if (!config || !config.allowNetwork) return false
    return this.ssrfGuard.isAllowed(url)
  }

  /**
   * 验证文件路径是否允许
   * @param pluginId 插件 ID
   * @param filePath 文件路径
   * @returns 是否允许
   */
  validateFileSystemAccess(pluginId: string, filePath: string): boolean {
    const config = this.configs.get(pluginId)
    if (!config || !config.allowFileSystem) return false
    return config.allowedPathPrefixes.some(prefix => filePath.startsWith(prefix))
  }

  /**
   * 过滤插件输出内容
   * @param pluginId 插件 ID
   * @param content 待过滤内容
   * @returns 过滤结果
   */
  filterOutput(pluginId: string, content: string): FilterResult {
    return this.contentFilter.filter(content)
  }

  /**
   * 移除插件
   * @param pluginId 插件 ID
   */
  removePlugin(pluginId: string): void {
    this.configs.delete(pluginId)
    this.permissions.revokeAll(pluginId)
  }
}

// ============ 单例 ============

let instance: PluginSandboxManager | null = null

export function getPluginSandboxManager(): PluginSandboxManager {
  if (!instance) {
    instance = new PluginSandboxManager()
  }
  return instance
}

export function resetPluginSandboxManager(): void {
  instance = null
}
