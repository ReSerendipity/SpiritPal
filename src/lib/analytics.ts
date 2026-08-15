/**
 * 数据埋点系统 — 本地存储，不上传服务器
 * PRD §15 定义的 10 个埋点事件
 *
 * @fileoverview
 * 主要模块：
 * - AnalyticsEventName 类型：10 种埋点事件（app_launch/pet_interaction/chat_send/...）
 * - AnalyticsEvent 接口：事件结构
 * - AnalyticsManager 类：埋点管理器（单例），支持启用/禁用、事件记录、导出
 * - getAnalytics()：获取单例入口
 * - trackXxx() 系列函数：10 个便捷埋点函数
 *
 * 设计原则：
 * 1. 本地优先：所有数据存储在 localStorage，不上传任何服务器
 * 2. 匿名化：不包含用户个人信息
 * 3. 可关闭：用户可在设置中完全关闭数据采集
 * 4. 可删除：用户可随时清除所有埋点数据
 * 5. 最多保留 1000 条事件
 *
 * R-14-lite v2.0: analytics localStorage 加密
 * - 写入时使用 AES-256-GCM 加密（复用 Rust encrypt_data 命令）
 * - 读取时先尝试解密，失败则兼容旧明文数据
 * - 加密失败时降级为明文存储（保证可用性）
 *
 * @module analytics
 */

import { invoke } from '@tauri-apps/api/core'

const ANALYTICS_ENABLED_KEY = 'spiritpal-analytics-enabled'
const ANALYTICS_EVENTS_KEY = 'spiritpal-analytics-events'
const MAX_EVENTS = 1000 // 最多保留 1000 条事件

// ============ 事件类型定义 ============

export type AnalyticsEventName =
  | 'app_launch'
  | 'pet_interaction'
  | 'chat_send'
  | 'chat_receive'
  | 'memory_trigger'
  | 'item_use'
  | 'tomato_complete'
  | 'setting_change'
  | 'mod_install'
  | 'image_switch'

export interface AnalyticsEvent {
  name: AnalyticsEventName
  timestamp: number
  data: Record<string, unknown>
}

// ============ 加密辅助函数 ============

/**
 * R-14-lite: 加密数据（使用 Rust AES-256-GCM）
 * 调用 Tauri 命令 encrypt_data，密码为空（自动使用机器 ID 派生）
 */
async function encryptAnalyticsData(plaintext: string): Promise<string | null> {
  try {
    const ciphertext = await invoke<string>('encrypt_data', { data: plaintext, password: '' })
    return ciphertext
  } catch {
    // 加密失败（如非 Tauri 环境或机器 ID 获取失败），返回 null 降级为明文
    return null
  }
}

/**
 * R-14-lite: 解密数据（使用 Rust AES-256-GCM）
 * 调用 Tauri 命令 decrypt_data，密码为空（自动使用机器 ID 派生）
 */
async function decryptAnalyticsData(ciphertext: string): Promise<string | null> {
  try {
    const plaintext = await invoke<string>('decrypt_data', { encrypted: ciphertext, password: '' })
    return plaintext
  } catch {
    // 解密失败，返回 null 让调用方尝试明文兼容
    return null
  }
}

/**
 * 检查字符串是否为加密数据（以 ENC1: 或 ENC2: 开头）
 */
function isEncryptedData(s: string): boolean {
  return s.startsWith('ENC1:') || s.startsWith('ENC2:')
}

// ============ 埋点管理器 ============

class AnalyticsManager {
  private enabled: boolean = true
  private events: AnalyticsEvent[] = []
  private initialized: boolean = false

  constructor() {
    this.loadEnabled()
    // R-14-lite: 异步加载事件（含解密），fire-and-forget
    this.init()
  }

  /**
   * R-14-lite: 异步初始化 — 加载并解密历史事件
   */
  private async init(): Promise<void> {
    await this.loadEventsAsync()
    this.initialized = true
  }

  private loadEnabled(): void {
    try {
      const raw = localStorage.getItem(ANALYTICS_ENABLED_KEY)
      if (raw !== null) {
        this.enabled = JSON.parse(raw)
      }
    } catch {
      this.enabled = true
    }
  }

  /**
   * R-14-lite: 异步加载事件 — 先尝试解密，失败则兼容旧明文数据
   */
  private async loadEventsAsync(): Promise<void> {
    try {
      const raw = localStorage.getItem(ANALYTICS_EVENTS_KEY)
      if (!raw) {
        this.events = []
        return
      }

      // R-14-lite: 如果是加密数据，先解密
      if (isEncryptedData(raw)) {
        const decrypted = await decryptAnalyticsData(raw)
        if (decrypted) {
          this.events = JSON.parse(decrypted)
          return
        }
        // 解密失败，可能是密钥不匹配（换机器），清空旧数据
        this.events = []
        return
      }

      // 兼容旧明文数据
      this.events = JSON.parse(raw)
    } catch {
      this.events = []
    }
  }

  /**
   * R-14-lite: 异步保存事件 — 加密后写入 localStorage
   * 加密失败时降级为明文存储（保证可用性）
   */
  private async saveEventsAsync(): Promise<void> {
    try {
      // 限制事件数量
      if (this.events.length > MAX_EVENTS) {
        this.events = this.events.slice(-MAX_EVENTS)
      }
      const json = JSON.stringify(this.events)
      // R-14-lite: 尝试加密
      const ciphertext = await encryptAnalyticsData(json)
      if (ciphertext) {
        localStorage.setItem(ANALYTICS_EVENTS_KEY, ciphertext)
      } else {
        // 加密失败，降级为明文
        localStorage.setItem(ANALYTICS_EVENTS_KEY, json)
      }
    } catch {
      // 存储失败静默忽略
    }
  }

  /** 检查埋点是否启用 */
  isEnabled(): boolean {
    return this.enabled
  }

  /** 设置埋点开关 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    try {
      localStorage.setItem(ANALYTICS_ENABLED_KEY, JSON.stringify(enabled))
    } catch {
      // 忽略
    }
  }

  /** 记录事件 */
  track(name: AnalyticsEventName, data: Record<string, unknown> = {}): void {
    if (!this.enabled) return

    const event: AnalyticsEvent = {
      name,
      timestamp: Date.now(),
      data,
    }

    this.events.push(event)
    // R-14-lite: 异步保存（fire-and-forget）
    void this.saveEventsAsync()
  }

  /** 获取所有事件 */
  getEvents(): AnalyticsEvent[] {
    return [...this.events]
  }

  /** 获取指定事件类型的统计 */
  getEventCount(name: AnalyticsEventName): number {
    return this.events.filter((e) => e.name === name).length
  }

  /** 清除所有事件 */
  clearEvents(): void {
    this.events = []
    try {
      localStorage.removeItem(ANALYTICS_EVENTS_KEY)
    } catch {
      // 忽略
    }
  }

  /** 导出事件数据 */
  exportEvents(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      events: this.events,
    }, null, 2)
  }
}

// 单例
let instance: AnalyticsManager | null = null

export function getAnalytics(): AnalyticsManager {
  if (!instance) {
    instance = new AnalyticsManager()
  }
  return instance
}

// ============ 便捷方法 ============

/** 应用启动 */
export function trackAppLaunch(platform: string, version: string, isAutostart: boolean): void {
  getAnalytics().track('app_launch', { platform, version, is_autostart: isAutostart })
}

/** 宠物交互 */
export function trackPetInteraction(type: 'click' | 'drag' | 'feed' | 'pet', duration?: number): void {
  getAnalytics().track('pet_interaction', { type, duration })
}

/** 发送聊天消息 */
export function trackChatSend(messageLength: number, model: string): void {
  getAnalytics().track('chat_send', { message_length: messageLength, model })
}

/** AI 回复完成 */
export function trackChatReceive(responseLength: number, model: string, latencyMs: number): void {
  getAnalytics().track('chat_receive', { response_length: responseLength, model, latency_ms: latencyMs })
}

/** 记忆触发 */
export function trackMemoryTrigger(triggerType: string, memoryId: string): void {
  getAnalytics().track('memory_trigger', { trigger_type: triggerType, memory_id: memoryId })
}

/** 使用物品 */
export function trackItemUse(itemId: string, itemType: string): void {
  getAnalytics().track('item_use', { item_id: itemId, item_type: itemType })
}

/** 完成番茄钟 */
export function trackTomatoComplete(durationMinutes: number): void {
  getAnalytics().track('tomato_complete', { duration_minutes: durationMinutes })
}

/** 修改设置 */
export function trackSettingChange(settingKey: string, oldValue: unknown, newValue: unknown): void {
  getAnalytics().track('setting_change', { setting_key: settingKey, old_value: oldValue, new_value: newValue })
}

/** 安装模组 */
export function trackModInstall(modId: string, modName: string): void {
  getAnalytics().track('mod_install', { mod_id: modId, mod_name: modName })
}

/** 切换形象 */
export function trackImageSwitch(fromImage: string, toImage: string): void {
  getAnalytics().track('image_switch', { from_image: fromImage, to_image: toImage })
}
