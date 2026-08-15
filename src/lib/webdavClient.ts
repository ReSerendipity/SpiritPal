/**
 * @file webdavClient.ts
 * @description WebDAV 客户端模块
 *
 * 支持坚果云等 WebDAV 兼容服务的数据同步（P3-21 决策#2+#6+#7：导入导出 + WebDAV 自动同步，无服务器成本）
 *
 * 支持的 WebDAV 操作：
 *   1. PROPFIND — 检查远程文件/目录是否存在
 *   2. GET — 下载同步数据
 *   3. PUT — 上传同步数据
 *   4. MKCOL — 创建远程目录
 *   5. DELETE — 删除远程文件
 *
 * 安全设计：
 *   - 密码通过系统 Keychain 存储（secureStorage.ts）
 *   - 所有请求使用 HTTPS + Basic Auth
 *   - 请求超时防 hang 死
 *   - SSRF 防护（通过 safeFetch）
 *   - 抖动指数退避重试，避免服务器过载
 *
 * 同步文件结构：
 *   /SpiritPal/
 *   ├── manifest.json       # 同步清单（设备列表 + 最后同步时间）
 *   ├── data/
 *   │   ├── pet-data.json   # 宠物养成数据（stats/coins/inventory）
 *   │   ├── settings.json   # 应用设置
 *   │   └── chat/
 *   │       └── {charId}.json  # 各角色聊天记录
 *   └── backup/             # 历史备份（按日期归档）
 *
 * 主要模块：
 * - WebDAVConfig: 连接配置接口
 * - WebDAVTestResult: 连接测试结果接口
 * - WebDAVManifest/WebDAVSyncData: 同步数据结构
 * - WebDAVClient: WebDAV 客户端类
 * - getWebDAVClient()/resetWebDAVClient(): 单例管理
 *
 * 依赖关系：
 * - ./secureStorage: 系统 Keychain 密码存储
 * - ./ssrfProtection: SSRF 防护的 safeFetch
 */

import { setSecret, getSecret, deleteSecret } from './secureStorage'
import { safeFetch } from './ssrfProtection'

// ============ 常量 ============

/** WebDAV 密码在 Keychain 中的存储键 */
const WEBDAV_PASSWORD_KEY = 'webdav-password'
/** WebDAV 远程根目录 */
const WEBDAV_REMOTE_DIR = '/SpiritPal'
/** 数据目录 */
const WEBDAV_DATA_DIR = `${WEBDAV_REMOTE_DIR}/data`
/** 聊天记录目录 */
const WEBDAV_CHAT_DIR = `${WEBDAV_DATA_DIR}/chat`
/** 备份目录 */
const WEBDAV_BACKUP_DIR = `${WEBDAV_REMOTE_DIR}/backup`
/** 同步清单路径 */
const WEBDAV_MANIFEST_PATH = `${WEBDAV_REMOTE_DIR}/manifest.json`
/** 宠物数据路径 */
const WEBDAV_PET_DATA_PATH = `${WEBDAV_DATA_DIR}/pet-data.json`
/** 设置数据路径 */
const WEBDAV_SETTINGS_PATH = `${WEBDAV_DATA_DIR}/settings.json`

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 15000

/** 最大重试次数 */
const MAX_RETRIES = 2

/** 重试延迟基础值（毫秒），使用抖动指数退避 */
const RETRY_BASE_DELAY_MS = 1000

// ============ 类型定义 ============

/**
 * WebDAV 连接配置接口
 */
export interface WebDAVConfig {
  /** 服务器地址（如 https://dav.jianguoyun.com/dav/） */
  serverUrl: string
  /** 用户名 */
  username: string
  /** 远程根目录（默认 /SpiritPal） */
  remoteDir?: string
  /** 是否启用自动同步 */
  autoSync: boolean
  /** 自动同步间隔（毫秒，0=禁用） */
  autoSyncInterval: number
}

/**
 * WebDAV 连接测试结果接口
 */
export interface WebDAVTestResult {
  /** 是否连接成功 */
  success: boolean
  /** 错误信息（失败时） */
  error?: string
  /** 服务器信息（成功时） */
  serverInfo?: string
}

/**
 * WebDAV 同步清单接口
 */
export interface WebDAVManifest {
  /** 清单版本 */
  version: number
  /** 最后同步时间戳 */
  lastSyncAt: number
  /** 设备列表 */
  devices: Array<{
    deviceId: string
    deviceName: string
    lastSeenAt: number
  }>
}

/**
 * 同步数据包接口（上传/下载的数据结构）
 */
export interface WebDAVSyncData {
  /** 数据时间戳 */
  timestamp: number
  /** 设备 ID */
  deviceId: string
  /** 宠物养成数据 */
  petData?: unknown
  /** 应用设置 */
  settings?: unknown
  /** 聊天记录（按角色 ID 索引） */
  chatData?: Record<string, unknown>
}

// ============ 工具函数 ============

/**
 * 构造 Basic Auth 请求头
 * @param username 用户名
 * @param password 密码
 * @returns Authorization 请求头
 */
function basicAuthHeader(username: string, password: string): Record<string, string> {
  const encoded = btoa(`${username}:${password}`)
  return { Authorization: `Basic ${encoded}` }
}

/**
 * 规范化 WebDAV URL（移除末尾斜杠，确保路径拼接正确）
 * @param baseUrl 基础 URL
 * @param path 路径
 * @returns 拼接后的完整 URL
 */
function normalizeUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}`
}

/**
 * 抖动指数退避延迟计算
 * 避免多设备同时重试导致服务器过载
 * @param attempt 重试次数（从 0 开始）
 * @returns 延迟毫秒数
 */
function retryDelay(attempt: number): number {
  const jitter = Math.random() * RETRY_BASE_DELAY_MS
  return Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + jitter, 30000)
}

/**
 * 带超时的 fetch 请求
 * @param url 请求 URL
 * @param options 请求选项
 * @param timeoutMs 超时毫秒数
 * @returns Response 对象
 * @throws 请求超时或网络错误时抛出异常
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const mergedOptions: RequestInit = {
      ...options,
      signal: controller.signal,
    }
    return await safeFetch(url, mergedOptions, undefined, 'webdav')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 带重试的请求
 * 5xx 错误和网络错误时自动重试，使用抖动指数退避
 * @param url 请求 URL
 * @param options 请求选项
 * @param maxRetries 最大重试次数
 * @returns Response 对象
 * @throws 所有重试失败后抛出最后一次错误
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options)
      // 5xx 错误时重试
      if (response.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelay(attempt)))
        continue
      }
      return response
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelay(attempt)))
      }
    }
  }
  throw lastError ?? new Error('请求失败')
}

// ============ WebDAV 客户端 ============

/**
 * WebDAV 客户端类
 *
 * 提供 WebDAV 协议的高层封装，支持：
 * - 连接配置和测试
 * - 密码安全存储（系统 Keychain）
 * - 同步数据的上传/下载
 * - 远程目录自动创建
 * - 超时、重试、SSRF 防护
 */
export class WebDAVClient {
  private config: WebDAVConfig | null = null
  private password: string | null = null

  /**
   * 配置 WebDAV 连接
   * @param config 连接配置（密码需单独通过 setPassword 设置）
   */
  async configure(config: WebDAVConfig): Promise<void> {
    this.config = config
  }

  /**
   * 设置 WebDAV 密码（存储到系统 Keychain）
   * @param password 密码明文
   */
  async setPassword(password: string): Promise<void> {
    this.password = password
    await setSecret(WEBDAV_PASSWORD_KEY, password)
  }

  /**
   * 获取 WebDAV 密码（从系统 Keychain 读取）
   * @returns 密码，未设置时返回 null
   */
  async loadPassword(): Promise<string | null> {
    if (this.password) return this.password
    this.password = await getSecret(WEBDAV_PASSWORD_KEY)
    return this.password
  }

  /**
   * 清除 WebDAV 密码（从内存和 Keychain 中移除）
   */
  async clearPassword(): Promise<void> {
    this.password = null
    await deleteSecret(WEBDAV_PASSWORD_KEY)
  }

  /**
   * 获取当前配置（副本）
   * @returns 配置对象，未配置时返回 null
   */
  getConfig(): WebDAVConfig | null {
    return this.config ? { ...this.config } : null
  }

  /**
   * 测试 WebDAV 连接
   * 尝试 PROPFIND 请求验证服务器可达且凭据正确
   * @returns 测试结果
   */
  async testConnection(): Promise<WebDAVTestResult> {
    if (!this.config) {
      return { success: false, error: '未配置 WebDAV 连接' }
    }
    const password = await this.loadPassword()
    if (!password) {
      return { success: false, error: '未设置 WebDAV 密码' }
    }

    try {
      const url = normalizeUrl(this.config.serverUrl, '/')
      const headers = {
        ...basicAuthHeader(this.config.username, password),
        Depth: '0',
      }

      const response = await fetchWithTimeout(url, {
        method: 'PROPFIND',
        headers,
      })

      if (response.status === 207) {
        // Multi-Status = 认证成功
        return { success: true, serverInfo: 'WebDAV 连接成功' }
      } else if (response.status === 401) {
        return { success: false, error: '认证失败：用户名或密码错误' }
      } else if (response.status === 403) {
        return { success: false, error: '权限不足：无法访问该目录' }
      } else if (response.status === 404) {
        // 404 可能只是根目录不存在，但认证通过
        return { success: true, serverInfo: 'WebDAV 连接成功（根目录不存在，同步时将创建）' }
      } else {
        return {
          success: false,
          error: `服务器返回错误: HTTP ${response.status}`,
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `连接失败: ${msg}` }
    }
  }

  /**
   * 确保远程目录结构存在
   * 依次创建 SpiritPal 根目录、data 目录、chat 目录、backup 目录
   */
  async ensureRemoteDirs(): Promise<void> {
    const dirs = [WEBDAV_REMOTE_DIR, WEBDAV_DATA_DIR, WEBDAV_CHAT_DIR, WEBDAV_BACKUP_DIR]
    for (const dir of dirs) {
      await this.mkcol(dir)
    }
  }

  /**
   * 上传同步数据到 WebDAV
   * @param data 同步数据包
   * @throws 未配置或密码未设置时抛出异常
   */
  async uploadSyncData(data: WebDAVSyncData): Promise<void> {
    if (!this.config) throw new Error('未配置 WebDAV')
    const password = await this.loadPassword()
    if (!password) throw new Error('未设置 WebDAV 密码')

    // 确保目录存在
    await this.ensureRemoteDirs()

    const headers = {
      ...basicAuthHeader(this.config.username, password),
      'Content-Type': 'application/json',
    }

    // 上传宠物数据
    if (data.petData !== undefined) {
      await this.put(
        WEBDAV_PET_DATA_PATH,
        JSON.stringify({ timestamp: data.timestamp, deviceId: data.deviceId, data: data.petData }),
        headers,
      )
    }

    // 上传设置
    if (data.settings !== undefined) {
      await this.put(
        WEBDAV_SETTINGS_PATH,
        JSON.stringify({ timestamp: data.timestamp, deviceId: data.deviceId, data: data.settings }),
        headers,
      )
    }

    // 上传聊天记录
    if (data.chatData) {
      for (const [charId, chatContent] of Object.entries(data.chatData)) {
        const chatPath = `${WEBDAV_CHAT_DIR}/${charId}.json`
        await this.put(
          chatPath,
          JSON.stringify({ timestamp: data.timestamp, deviceId: data.deviceId, data: chatContent }),
          headers,
        )
      }
    }

    // 更新同步清单
    const manifest = await this.downloadManifest()
    const existingIdx = manifest.devices.findIndex((d) => d.deviceId === data.deviceId)
    const deviceEntry = { deviceId: data.deviceId, deviceName: '', lastSeenAt: Date.now() }
    if (existingIdx >= 0) {
      manifest.devices[existingIdx] = deviceEntry
    } else {
      manifest.devices.push(deviceEntry)
    }
    manifest.lastSyncAt = Date.now()
    await this.put(WEBDAV_MANIFEST_PATH, JSON.stringify(manifest), headers)
  }

  /**
   * 从 WebDAV 下载同步数据
   * @returns 同步数据包，无数据时返回 null
   * @throws 未配置或密码未设置时抛出异常
   */
  async downloadSyncData(): Promise<WebDAVSyncData | null> {
    if (!this.config) throw new Error('未配置 WebDAV')
    const password = await this.loadPassword()
    if (!password) throw new Error('未设置 WebDAV 密码')

    const headers = basicAuthHeader(this.config.username, password)
    const result: WebDAVSyncData = {
      timestamp: 0,
      deviceId: '',
    }

    // 下载宠物数据
    const petData = await this.getJson<{ timestamp: number; deviceId: string; data: unknown }>(
      WEBDAV_PET_DATA_PATH,
      headers,
    )
    if (petData) {
      result.petData = petData.data
      result.timestamp = Math.max(result.timestamp, petData.timestamp)
      if (!result.deviceId) result.deviceId = petData.deviceId
    }

    // 下载设置
    const settings = await this.getJson<{ timestamp: number; deviceId: string; data: unknown }>(
      WEBDAV_SETTINGS_PATH,
      headers,
    )
    if (settings) {
      result.settings = settings.data
      result.timestamp = Math.max(result.timestamp, settings.timestamp)
    }

    // 下载聊天记录
    const chatData: Record<string, unknown> = {}
    // 注意：列出聊天目录下的文件需要 PROPFIND depth=1
    // 简化实现：尝试从 manifest 获取角色列表
    const manifest = await this.downloadManifest()
    // 跳过：角色列表需从 pet-data 获取，此处仅确认是否有设备记录
    if (manifest.devices.length > 0) {
      // 角色列表需从 pet-data 获取，此处跳过具体下载
    }

    // 如果有宠物数据，尝试下载已知角色的聊天记录
    // 这需要调用方提供角色列表，简化处理在此跳过
    if (Object.keys(chatData).length > 0) {
      result.chatData = chatData
    }

    return result.timestamp > 0 ? result : null
  }

  /**
   * 下载同步清单
   * @returns 同步清单，不存在时返回默认空清单
   */
  async downloadManifest(): Promise<WebDAVManifest> {
    const defaultManifest: WebDAVManifest = { version: 1, lastSyncAt: 0, devices: [] }
    if (!this.config) return defaultManifest
    const password = await this.loadPassword()
    if (!password) return defaultManifest

    const headers = basicAuthHeader(this.config.username, password)
    const manifest = await this.getJson<WebDAVManifest>(WEBDAV_MANIFEST_PATH, headers)
    return manifest ?? defaultManifest
  }

  // ============ WebDAV 原语操作 ============

  /**
   * PUT — 上传文件
   * @param path 远程路径
   * @param body 文件内容
   * @param headers 请求头
   */
  private async put(path: string, body: string, headers: Record<string, string>): Promise<void> {
    if (!this.config) throw new Error('未配置 WebDAV')
    const url = normalizeUrl(this.config.serverUrl, path)
    await fetchWithRetry(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body,
    })
  }

  /**
   * GET — 下载文件内容
   * @param path 远程路径
   * @param headers 请求头
   * @returns 文件内容，404 时返回 null
   */
  private async get(path: string, headers: Record<string, string>): Promise<string | null> {
    if (!this.config) return null
    const url = normalizeUrl(this.config.serverUrl, path)
    try {
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers,
      })
      if (response.ok) {
        return await response.text()
      }
      if (response.status === 404) return null
      throw new Error(`GET ${path} 失败: HTTP ${response.status}`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null
      throw err
    }
  }

  /**
   * GET — 下载并解析 JSON
   * @param path 远程路径
   * @param headers 请求头
   * @returns 解析后的对象，失败返回 null
   */
  private async getJson<T>(path: string, headers: Record<string, string>): Promise<T | null> {
    const text = await this.get(path, headers)
    if (!text) return null
    try {
      return JSON.parse(text) as T
    } catch {
      console.warn(`[WebDAV] 解析 JSON 失败: ${path}`)
      return null
    }
  }

  /**
   * MKCOL — 创建目录（幂等，已存在时忽略）
   * @param path 远程目录路径
   */
  private async mkcol(path: string): Promise<void> {
    if (!this.config) return
    const password = await this.loadPassword()
    if (!password) return

    const url = normalizeUrl(this.config.serverUrl, path)
    const headers = basicAuthHeader(this.config.username, password)
    try {
      const response = await fetchWithTimeout(url, {
        method: 'MKCOL',
        headers,
      })
      // 201 = 创建成功，405 = 已存在（坚果云返回 405）
      if (response.status !== 201 && response.status !== 405) {
        console.warn(`[WebDAV] MKCOL ${path}: HTTP ${response.status}`)
      }
    } catch {
      // 网络错误时静默忽略，后续 PUT 会再次尝试
    }
  }

  /**
   * DELETE — 删除文件
   * @param path 远程路径
   * @returns 是否删除成功
   */
  async delete(path: string): Promise<boolean> {
    if (!this.config) return false
    const password = await this.loadPassword()
    if (!password) return false

    const url = normalizeUrl(this.config.serverUrl, path)
    const headers = basicAuthHeader(this.config.username, password)
    try {
      const response = await fetchWithTimeout(url, {
        method: 'DELETE',
        headers,
      })
      return response.status === 204 || response.status === 200 || response.status === 404
    } catch {
      return false
    }
  }
}

// ============ 单例 ============

/** WebDAV 客户端单例 */
let webdavClient: WebDAVClient | null = null

/**
 * 获取 WebDAV 客户端单例
 * @returns WebDAV 客户端实例
 */
export function getWebDAVClient(): WebDAVClient {
  if (!webdavClient) {
    webdavClient = new WebDAVClient()
  }
  return webdavClient
}

/**
 * 重置 WebDAV 客户端单例（主要用于测试）
 */
export function resetWebDAVClient(): void {
  webdavClient = null
}
