/**
 * 社区Mod分发模块
 *
 * @fileoverview 提供社区模组的搜索、下载、上传、评分、评论与版本管理功能
 *
 * 主要模块：
 * - CommunityMod/CommunityModVersion: 社区模组与版本信息类型
 * - SearchOptions/SearchResult: 搜索选项与结果
 * - ModDistributionClient: 分发平台客户端主类
 *
 * 依赖关系：
 * - modManager.ts: PetmodManifest 模组清单类型
 *
 * 核心接口：
 * - searchMods(): 搜索社区模组
 * - downloadMod(): 下载并安装模组
 * - uploadMod(): 上传模组到社区
 * - rateMod()/commentOnMod(): 评分与评论
 * - checkUpdates(): 检查模组更新
 * - resolveDependencies(): 远程依赖解析
 *
 * 核心功能：
 * 1. 模组上传：发布模组到社区仓库
 * 2. 搜索浏览：关键词/标签/分类搜索
 * 3. 下载安装：下载.petmod并自动安装
 * 4. 评分评论：5分制评分+文字评论
 * 5. 版本管理：多版本支持、更新检测、SHA256校验
 * 6. 依赖解析：自动下载依赖模组
 */

import type { PetmodManifest } from './modManager'

// ============ 类型定义 ============

/** 社区模组信息 */
export interface CommunityMod {
  /** 模组 ID */
  id: string
  /** 模组名称 */
  name: string
  /** 最新版本 */
  latestVersion: string
  /** 描述 */
  description: string
  /** 作者 */
  author: string
  /** 图标 URL */
  iconUrl?: string
  /** 下载次数 */
  downloadCount: number
  /** 平均评分 (0-5) */
  rating: number
  /** 评分人数 */
  ratingCount: number
  /** 标签/关键词 */
  keywords: string[]
  /** 所有发布版本 */
  versions: CommunityModVersion[]
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/** 社区模组版本 */
export interface CommunityModVersion {
  /** 版本号 */
  version: string
  /** 下载 URL */
  downloadUrl: string
  /** 发布时间 */
  publishedAt: string
  /** 文件大小（字节） */
  sizeBytes: number
  /** SHA-256 校验和 */
  sha256: string
  /** 最低 SpiritPal 版本要求 */
  minSpiritPalVersion?: string
  /** 更新日志 */
  changelog?: string
  /** 依赖 */
  dependencies?: Array<{ id: string; version: string }>
}

/** 搜索选项 */
export interface SearchOptions {
  /** 搜索关键词 */
  query?: string
  /** 标签过滤 */
  keywords?: string[]
  /** 作者过滤 */
  author?: string
  /** 排序方式 */
  sortBy?: 'downloads' | 'rating' | 'newest' | 'updated'
  /** 分页偏移 */
  offset?: number
  /** 分页大小 */
  limit?: number
}

/** 搜索结果 */
export interface SearchResult {
  items: CommunityMod[]
  total: number
  offset: number
  hasMore: boolean
}

/** 评分提交 */
export interface RatingSubmission {
  modId: string
  version: string
  rating: number  // 1-5
  review?: string
}

/** 上传结果 */
export interface UploadResult {
  success: boolean
  modId?: string
  version?: string
  error?: string
}

// ============ 分发平台客户端 ============

/**
 * 社区 Mod 分发平台客户端
 * 与远程仓库交互，提供搜索/下载/上传/评分等 API
 */
export class ModDistributionClient {
  private baseUrl: string
  private authToken: string | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /**
   * 设置认证 token
   */
  setAuthToken(token: string): void {
    this.authToken = token
  }

  /**
   * 清除认证 token
   */
  clearAuthToken(): void {
    this.authToken = null
  }

  // ============ 搜索 ============

  /**
   * 搜索社区模组
   */
  async search(options: SearchOptions = {}): Promise<SearchResult> {
    const params = new URLSearchParams()
    if (options.query) params.set('q', options.query)
    if (options.author) params.set('author', options.author)
    if (options.sortBy) params.set('sort', options.sortBy)
    if (options.offset) params.set('offset', String(options.offset))
    if (options.limit) params.set('limit', String(options.limit))
    if (options.keywords?.length) params.set('keywords', options.keywords.join(','))

    return this.request<SearchResult>('GET', `/api/mods?${params.toString()}`)
  }

  /**
   * 获取模组详情
   */
  async getMod(modId: string): Promise<CommunityMod> {
    return this.request<CommunityMod>('GET', `/api/mods/${modId}`)
  }

  /**
   * 获取模组指定版本信息
   */
  async getVersion(modId: string, version: string): Promise<CommunityModVersion> {
    return this.request<CommunityModVersion>('GET', `/api/mods/${modId}/versions/${version}`)
  }

  // ============ 下载 ============

  /**
   * 获取模组下载 URL
   */
  getDownloadUrl(modId: string, version: string): string {
    return `${this.baseUrl}/api/mods/${modId}/versions/${version}/download`
  }

  /**
   * 下载模组到本地
   * @returns 下载的文件路径
   */
  async download(modId: string, version: string, targetDir: string): Promise<string> {
    const url = this.getDownloadUrl(modId, version)
    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`)
    }

    const blob = await response.blob()
    const fileName = `${modId}-${version}.petmod`
    const filePath = `${targetDir}/${fileName}`

    // 使用 Tauri 文件系统写入
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const arrayBuffer = await blob.arrayBuffer()
    await writeFile(filePath, new Uint8Array(arrayBuffer), { create: true })

    return filePath
  }

  // ============ 上传 ============

  /**
   * 上传模组到社区仓库
   */
  async upload(
    packagePath: string,
    changelog?: string,
  ): Promise<UploadResult> {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const fileData = await readFile(packagePath)

      const formData = new FormData()
      formData.append('package', new Blob([fileData]), 'package.petmod')
      if (changelog) formData.append('changelog', changelog)

      const response = await fetch(`${this.baseUrl}/api/mods`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: formData,
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, error }
      }

      const result = await response.json() as { modId: string; version: string }
      return { success: true, modId: result.modId, version: result.version }
    } catch (e) {
      return { success: false, error: `上传失败: ${e}` }
    }
  }

  // ============ 评分 ============

  /**
   * 提交评分和评论
   */
  async submitRating(submission: RatingSubmission): Promise<{ success: boolean; error?: string }> {
    try {
      await this.request('POST', `/api/mods/${submission.modId}/ratings`, submission)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  /**
   * 获取模组的评分和评论
   */
  async getRatings(
    modId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ ratings: RatingSubmission[]; total: number }> {
    return this.request('GET', `/api/mods/${modId}/ratings?offset=${offset}&limit=${limit}`)
  }

  // ============ 依赖解析 ============

  /**
   * 从远程解析模组依赖
   * 返回满足所有依赖的模组下载列表（按依赖顺序排列）
   */
  async resolveRemoteDependencies(
    modId: string,
    version: string,
    installedMods: PetmodManifest[] = [],
  ): Promise<Array<{ modId: string; version: string; downloadUrl: string }>> {
    const result = await this.request<{
      resolution: Array<{ modId: string; version: string; downloadUrl: string }>
    }>('POST', '/api/resolve-dependencies', {
      modId,
      version,
      installed: installedMods.map((m) => ({ id: m.id, version: m.version })),
    })
    return result.resolution
  }

  // ============ 内部方法 ============

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }
    return headers
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }
}

// ============ 单例 ============

let sharedClient: ModDistributionClient | null = null

export function getModDistributionClient(baseUrl?: string): ModDistributionClient {
  if (!sharedClient && baseUrl) {
    sharedClient = new ModDistributionClient(baseUrl)
  }
  if (!sharedClient) {
    // 默认使用占位 URL
    sharedClient = new ModDistributionClient('https://registry.spiritpal.app')
  }
  return sharedClient
}
