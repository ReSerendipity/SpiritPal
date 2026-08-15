/**
 * 插件管理器模块
 *
 * @fileoverview 插件加载、沙箱构建与生命周期管理（参考OpenPets SDK架构）
 *
 * 主要模块：
 * - PluginState: 插件状态类型（registered/approved/running/paused/stopped/error）
 * - PluginRecord: 插件内部记录
 * - PluginManager: 插件管理器主类
 *
 * 依赖关系：
 * - @tauri-apps/api/event: 事件系统
 * - pluginSdk.ts: Plugin/PluginManifest等类型定义
 * - pluginPermissions.ts: 沙箱管理器与权限审批
 *
 * 核心接口：
 * - registerPlugin(): 注册插件
 * - unregisterPlugin(): 卸载插件
 * - startPlugin()/stopPlugin(): 启动/停止插件
 * - pausePlugin()/resumePlugin(): 暂停/恢复插件
 * - getPlugin(): 获取插件实例
 * - listPlugins(): 列出所有已注册插件
 *
 * 核心职责（参考OpenPets packages/sdk/）：
 * 1. 清单加载：验证插件manifest格式与兼容性
 * 2. 权限守门：通过PermissionManager进行权限审批
 * 3. 沙箱构建：构建隔离的SpiritPalPluginContext
 * 4. 生命周期：管理start/stop/pause/resume状态转换
 */

import { emit } from '@tauri-apps/api/event'
import type {
  Plugin,
  PluginManifest,
  PluginPermission,
  PluginRegisterFunction,
  SpiritPalPluginContext,
  PluginUI,
  PluginPets,
  PluginAudio,
  PluginEvents,
  PluginSchedule,
  PluginStorage,
  PluginNet,
  PluginAI,
  PluginVoice,
} from './pluginSdk'
import {
  getPluginSandboxManager,
  type PermissionApproval,
} from './pluginPermissions'

// ============ 插件加载状态 ============

export type PluginState = 'registered' | 'approved' | 'running' | 'paused' | 'stopped' | 'error'

interface PluginRecord {
  manifest: PluginManifest
  instance: Plugin | null
  state: PluginState
  registerFn: PluginRegisterFunction
  approval: PermissionApproval | null
  loadedAt: number
  error?: string
}

// ============ 插件管理器 ============

export class PluginManager {
  private plugins = new Map<string, PluginRecord>()
  private sandboxManager = getPluginSandboxManager()

  /**
   * 注册插件（安装时调用）
   * @param manifest 插件清单
   * @param registerFn 插件注册函数
   * @param userApprovedPermissions 用户批准的权限列表（null=全部批准）
   * @returns 审批结果
   */
  registerPlugin(
    manifest: PluginManifest,
    registerFn: PluginRegisterFunction,
    userApprovedPermissions?: PluginPermission[] | null,
  ): PermissionApproval {
    // 1. 权限审批
    const approval = this.sandboxManager.permissions.requestApproval(
      manifest,
      userApprovedPermissions,
    )

    // 2. 注册沙箱配置
    this.sandboxManager.registerPlugin(manifest)

    // 3. 记录插件
    this.plugins.set(manifest.id, {
      manifest,
      instance: null,
      state: approval.granted ? 'approved' : 'error',
      registerFn,
      approval,
      loadedAt: Date.now(),
      error: approval.granted ? undefined : `权限审批失败: ${approval.reason}`,
    })

    return approval
  }

  /**
   * 启动插件
   * @param pluginId 插件 ID
   */
  async startPlugin(pluginId: string): Promise<void> {
    const record = this.plugins.get(pluginId)
    if (!record) throw new Error(`Plugin "${pluginId}" not found`)
    if (record.state !== 'approved') {
      throw new Error(`Plugin "${pluginId}" is in state "${record.state}", expected "approved"`)
    }

    try {
      // 构建沙箱化的插件上下文
      const ctx = this.buildContext(pluginId)

      // 执行插件注册函数
      const instance = await record.registerFn(ctx)
      record.instance = instance
      record.state = 'running'

      // 启动插件
      await instance.start()
    } catch (e) {
      record.state = 'error'
      record.error = e instanceof Error ? e.message : String(e)
      console.error(`[PluginManager] Failed to start plugin "${pluginId}":`, e)
    }
  }

  /**
   * 停止插件
   * @param pluginId 插件 ID
   */
  async stopPlugin(pluginId: string): Promise<void> {
    const record = this.plugins.get(pluginId)
    if (!record) throw new Error(`Plugin "${pluginId}" not found`)
    if (record.state !== 'running' && record.state !== 'paused') return

    try {
      await record.instance?.stop()
      record.state = 'stopped'
      record.instance = null
    } catch (e) {
      console.error(`[PluginManager] Failed to stop plugin "${pluginId}":`, e)
    }
  }

  /**
   * 暂停插件
   * @param pluginId 插件 ID
   */
  pausePlugin(pluginId: string): void {
    const record = this.plugins.get(pluginId)
    if (!record || record.state !== 'running') return
    record.instance?.pause?.()
    record.state = 'paused'
  }

  /**
   * 恢复插件
   * @param pluginId 插件 ID
   */
  resumePlugin(pluginId: string): void {
    const record = this.plugins.get(pluginId)
    if (!record || record.state !== 'paused') return
    record.instance?.resume?.()
    record.state = 'running'
  }

  /**
   * 卸载插件
   * @param pluginId 插件 ID
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const record = this.plugins.get(pluginId)
    if (!record) return

    if (record.state === 'running' || record.state === 'paused') {
      await this.stopPlugin(pluginId)
    }

    this.sandboxManager.removePlugin(pluginId)
    this.plugins.delete(pluginId)
  }

  /**
   * 检查插件是否拥有指定权限
   * @param pluginId 插件 ID
   * @param permission 权限
   */
  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    return this.sandboxManager.permissions.hasPermission(pluginId, permission)
  }

  /**
   * 获取插件状态
   * @param pluginId 插件 ID
   */
  getPluginState(pluginId: string): PluginState | undefined {
    return this.plugins.get(pluginId)?.state
  }

  /**
   * 获取所有已加载的插件 ID
   */
  getLoadedPluginIds(): string[] {
    return Array.from(this.plugins.keys())
  }

  /**
   * 获取指定插件的 manifest
   */
  getManifest(pluginId: string): PluginManifest | undefined {
    return this.plugins.get(pluginId)?.manifest
  }

  // ============ 内部方法 ============

  /**
   * 构建沙箱化的插件上下文
   * 根据插件被批准的权限，只暴露允许的能力
   */
  private buildContext(pluginId: string): SpiritPalPluginContext {
    const has = (perm: PluginPermission) =>
      this.sandboxManager.permissions.hasPermission(pluginId, perm)

    const ui: PluginUI = {
      bubble: (msg, opts) => {
        if (!has('ui:bubble')) return
        void emit('spiritpal-plugin-bubble', { pluginId, message: msg, ...opts })
      },
      notification: (title, body) => {
        if (!has('ui:notification')) return
        void emit('spiritpal-plugin-notification', { pluginId, title, body })
      },
      openPanel: (panelId) => {
        if (!has('ui:panel')) return
        void emit('spiritpal-plugin-panel', { pluginId, panelId, action: 'open' })
      },
      closePanel: (panelId) => {
        if (!has('ui:panel')) return
        void emit('spiritpal-plugin-panel', { pluginId, panelId, action: 'close' })
      },
    }

    const pets: PluginPets = {
      getStatus: async () => {
        if (!has('pet:read_status')) {
          return { hunger: 0, mood: 0, health: 0, affection: 0, level: 0, characterId: '' }
        }
        // 通过事件系统请求状态（实际运行时由 PetWindow 响应）
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve({
            hunger: 0, mood: 0, health: 0, affection: 0, level: 0, characterId: '',
          }), 3000)
          void emit('spiritpal-plugin-get-status', { pluginId }).then((result) => {
            clearTimeout(timeout)
            resolve(result as never)
          }).catch(() => {
            clearTimeout(timeout)
            resolve({ hunger: 0, mood: 0, health: 0, affection: 0, level: 0, characterId: '' })
          })
        })
      },
      react: (reaction) => {
        if (!has('pet:react')) return
        void emit('spiritpal-mcp-react', reaction)
      },
      say: (message) => {
        if (!has('pet:speak')) return
        // 内容过滤
        const filterResult = this.sandboxManager.contentFilter.filter(message)
        void emit('spiritpal-mcp-say', filterResult.filtered)
      },
      modifyState: (changes) => {
        if (!has('pet:modify_state')) return
        void emit('spiritpal-plugin-modify-state', { pluginId, ...changes })
      },
    }

    const audio: PluginAudio = {
      play: async (url, opts) => {
        if (!has('audio:play')) return
        // SSRF 检查
        if (!this.sandboxManager.validateNetworkRequest(pluginId, url)) {
          console.warn(`[Plugin] SSRF blocked: ${url}`)
          return
        }
        void emit('spiritpal-plugin-audio-play', { pluginId, url, ...opts })
      },
      speak: async (text, _opts) => {
        if (!has('audio:tts')) return
        const filterResult = this.sandboxManager.contentFilter.filter(text)
        void emit('spiritpal-mcp-say', filterResult.filtered)
      },
      stop: () => {
        if (!has('audio:stop')) return
        void emit('spiritpal-plugin-audio-stop', { pluginId })
      },
      isPlaying: () => false,
    }

    const events: PluginEvents = {
      on: (event, _callback) => {
        // 事件监听在运行时由应用层桥接
        void emit('spiritpal-plugin-register-listener', { pluginId, event })
        return () => { /* cleanup handled by app */ }
      },
      emit: (event, payload) => {
        if (!has('events:emit')) return
        void emit(`spiritpal-plugin-event:${event}`, { pluginId, payload })
      },
      off: (_event, _callback) => {
        // cleanup handled by app
      },
    }

    const schedule: PluginSchedule = {
      every: (interval, callback) => {
        if (!has('schedule')) return () => {}
        const ms = parseInterval(interval)
        const id = setInterval(callback, ms)
        return () => clearInterval(id)
      },
      at: (time, callback) => {
        if (!has('schedule')) return () => {}
        const targetMs = parseTime(time)
        const delay = targetMs - Date.now()
        if (delay <= 0) { callback(); return () => {} }
        const id = setTimeout(callback, delay)
        return () => clearTimeout(id)
      },
      after: (delay, callback) => {
        if (!has('schedule')) return () => {}
        const ms = parseInterval(delay)
        const id = setTimeout(callback, ms)
        return () => clearTimeout(id)
      },
      cancelAll: () => {
        // 由应用层管理清理
      },
    }

    const storage: PluginStorage = {
      get: async <T = unknown>(key: string): Promise<T | null> => {
        if (!has('storage:read')) return null
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const result = await invoke<unknown>('plugin_storage_get', {
            pluginId,
            key: `plugin_${pluginId}_${key}`,
          })
          return (result as T) ?? null
        } catch { return null }
      },
      set: async (key, value) => {
        if (!has('storage:write')) return
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('plugin_storage_set', {
            pluginId,
            key: `plugin_${pluginId}_${key}`,
            value: JSON.stringify(value),
          })
        } catch { /* ignore */ }
      },
      delete: async (key) => {
        if (!has('storage:delete')) return
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('plugin_storage_delete', {
            pluginId,
            key: `plugin_${pluginId}_${key}`,
          })
        } catch { /* ignore */ }
      },
      keys: async () => {
        if (!has('storage:read')) return []
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          return await invoke<string[]>('plugin_storage_keys', { pluginId })
        } catch { return [] }
      },
    }

    const net: PluginNet = {
      fetch: async (url, options) => {
        if (!has('net:http')) throw new Error('Permission denied: net:http')
        if (!this.sandboxManager.validateNetworkRequest(pluginId, url)) {
          throw new Error(`SSRF blocked: ${url}`)
        }
        return fetch(url, options)
      },
      connect: async (url) => {
        if (!has('net:websocket')) throw new Error('Permission denied: net:websocket')
        if (!this.sandboxManager.validateNetworkRequest(pluginId, url)) {
          throw new Error(`SSRF blocked: ${url}`)
        }
        return new WebSocket(url)
      },
    }

    const ai: PluginAI = {
      chat: async (messages) => {
        if (!has('ai:chat')) throw new Error('Permission denied: ai:chat')
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          return await invoke<string>('plugin_ai_chat', { pluginId, messages })
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
      analyze: async (input, type) => {
        if (!has('ai:analyze')) throw new Error('Permission denied: ai:analyze')
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          return await invoke<string>('plugin_ai_analyze', { pluginId, input, type })
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
      extractMemories: async (context) => {
        if (!has('ai:extract_memory')) throw new Error('Permission denied: ai:extract_memory')
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          return await invoke<string[]>('plugin_ai_extract_memories', { pluginId, context })
        } catch { return [] }
      },
    }

    const voice: PluginVoice = {
      startListening: () => {
        if (!has('voice:listen')) return
        void emit('spiritpal-plugin-voice-start', { pluginId })
      },
      stopListening: () => {
        if (!has('voice:listen')) return
        void emit('spiritpal-plugin-voice-stop', { pluginId })
      },
      recognize: async () => {
        if (!has('voice:recognize')) throw new Error('Permission denied: voice:recognize')
        return ''
      },
    }

    return { ui, pets, audio, events, schedule, storage, net, ai, voice }
  }
}

// ============ 时间解析工具 ============

function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 60000 // 默认 1 分钟
  const val = parseInt(match[1])
  switch (match[2]) {
    case 's': return val * 1000
    case 'm': return val * 60 * 1000
    case 'h': return val * 60 * 60 * 1000
    case 'd': return val * 24 * 60 * 60 * 1000
    default: return 60000
  }
}

function parseTime(str: string): number {
  // 解析 "HH:MM" 格式
  const match = str.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return Date.now()
  const now = new Date()
  const h = parseInt(match[1])
  const m = parseInt(match[2])
  const target = new Date(now)
  target.setHours(h, m, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target.getTime()
}

// ============ 单例 ============

let instance: PluginManager | null = null

export function getPluginManager(): PluginManager {
  if (!instance) {
    instance = new PluginManager()
  }
  return instance
}

export function resetPluginManager(): void {
  instance = null
}
