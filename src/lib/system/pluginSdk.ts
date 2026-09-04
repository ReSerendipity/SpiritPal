/**
 * 插件SDK类型定义模块
 *
 * @fileoverview Types-First设计的插件SDK，定义插件接口、权限和能力命名空间（参考OpenPets）
 *
 * 主要模块：
 * - PluginPermission: 30+权限类型枚举
 * - PluginManifest: 插件清单结构
 * - Plugin: 插件主接口
 * - SpiritPalPluginContext: 沙箱注入的上下文
 * - 能力命名空间: PluginUI/PluginPets/PluginAudio/PluginEvents/PluginSchedule/PluginStorage/PluginNet/PluginAI/PluginVoice
 *
 * 依赖关系：
 * - 无外部依赖（纯TypeScript类型定义）
 *
 * 核心接口：
 * - Plugin: 插件必须实现的接口（register/unregister）
 * - PluginManifest: 插件元数据与权限声明
 * - SpiritPalPluginContext: 插件运行时上下文（各能力命名空间）
 *
 * 能力命名空间（参考OpenPets packages/sdk/）：
 * - ctx.ui: UI操作（气泡、通知、面板）
 * - ctx.pets: 宠物操作（反应、说话、状态）
 * - ctx.audio: 音频操作（播放、TTS）
 * - ctx.events: 事件系统（监听、触发）
 * - ctx.schedule: 调度系统（定时任务）
 * - ctx.storage: 存储操作（读写数据）
 * - ctx.net: 网络请求（受SSRF防护）
 * - ctx.ai: AI能力（对话、分析）
 * - ctx.voice: 语音操作（监听、识别）
 *
 * 设计原则：Types-First，运行时由桌面应用在沙箱中注入
 */

// ============ 权限声明 ============

/** 所有可用的权限类型（30+） */
export type PluginPermission =
  // 宠物权限
  | 'pet:speak'           // 让宠物说话
  | 'pet:react'           // 触发宠物反应
  | 'pet:read_status'     // 读取宠物状态
  | 'pet:modify_state'    // 修改宠物状态
  // UI 权限
  | 'ui:bubble'           // 显示气泡消息
  | 'ui:notification'     // 发送系统通知
  | 'ui:panel'            // 打开自定义面板
  | 'ui:overlay'          // 显示覆盖层
  // 音频权限
  | 'audio:play'          // 播放音频
  | 'audio:tts'           // 语音合成
  | 'audio:stop'          // 停止音频
  // 事件权限
  | 'events:listen'       // 监听事件
  | 'events:emit'         // 触发事件
  // 调度权限
  | 'schedule'            // 创建定时任务
  // 存储权限
  | 'storage:read'        // 读取数据
  | 'storage:write'       // 写入数据
  | 'storage:delete'      // 删除数据
  // 网络权限
  | 'net:http'            // HTTP 请求
  | 'net:websocket'       // WebSocket 连接
  // AI 权限
  | 'ai:chat'             // 与 AI 对话
  | 'ai:analyze'          // AI 分析
  | 'ai:extract_memory'   // 提取记忆
  // 语音权限
  | 'voice:listen'        // 语音监听
  | 'voice:recognize'     // 语音识别
  // 系统权限
  | 'system:clipboard'    // 剪贴板访问
  | 'system:file_read'    // 文件读取
  | 'system:file_write'   // 文件写入
  | 'system:open_app'     // 打开应用

// ============ 能力命名空间 ============

/** UI 操作接口 */
export interface PluginUI {
  /** 显示气泡消息 */
  bubble(message: string, options?: { duration?: number; style?: string }): void
  /** 发送系统通知 */
  notification(title: string, body: string): void
  /** 打开自定义面板 */
  openPanel(panelId: string): void
  /** 关闭面板 */
  closePanel(panelId: string): void
}

/** 宠物操作接口 */
export interface PluginPets {
  /** 获取宠物当前状态 */
  getStatus(): Promise<{
    hunger: number
    mood: number
    health: number
    affection: number
    level: number
    characterId: string
  }>
  /** 触发宠物反应/动画 */
  react(reaction: string): void
  /** 让宠物说话 */
  say(message: string): void
  /** 修改宠物状态 */
  modifyState(changes: {
    hunger?: number
    mood?: number
    health?: number
    affection?: number
  }): void
}

/** 音频操作接口 */
export interface PluginAudio {
  /** 播放音频文件 */
  play(url: string, options?: { volume?: number; loop?: boolean }): Promise<void>
  /** 语音合成（TTS） */
  speak(text: string, options?: { voice?: string; speed?: number }): Promise<void>
  /** 停止当前音频 */
  stop(): void
  /** 获取当前播放状态 */
  isPlaying(): boolean
}

/** 事件系统接口 */
export interface PluginEvents {
  /** 监听事件 */
  on(event: string, callback: (payload: unknown) => void): () => void
  /** 触发事件 */
  emit(event: string, payload?: unknown): void
  /** 移除监听 */
  off(event: string, callback: (payload: unknown) => void): void
}

/** 调度系统接口 */
export interface PluginSchedule {
  /** 每隔指定时间执行 */
  every(interval: string, callback: () => void): () => void
  /** 在指定时间执行一次 */
  at(time: string, callback: () => void): () => void
  /** 延迟执行 */
  after(delay: string, callback: () => void): () => void
  /** 取消所有定时任务 */
  cancelAll(): void
}

/** 存储接口 */
export interface PluginStorage {
  /** 读取数据 */
  get<T = unknown>(key: string): Promise<T | null>
  /** 写入数据 */
  set(key: string, value: unknown): Promise<void>
  /** 删除数据 */
  delete(key: string): Promise<void>
  /** 获取所有键 */
  keys(): Promise<string[]>
}

/** 网络接口 */
export interface PluginNet {
  /** HTTP 请求（受 SSRF 防护） */
  fetch(url: string, options?: RequestInit): Promise<Response>
  /** WebSocket 连接 */
  connect(url: string): Promise<WebSocket>
}

/** AI 能力接口 */
export interface PluginAI {
  /** 与 AI 对话 */
  chat(messages: Array<{ role: string; content: string }>): Promise<string>
  /** AI 分析（如图片分析） */
  analyze(input: string, type?: string): Promise<string>
  /** 提取值得记忆的信息 */
  extractMemories(context: string): Promise<string[]>
}

/** 语音操作接口 */
export interface PluginVoice {
  /** 开始语音监听 */
  startListening(): void
  /** 停止语音监听 */
  stopListening(): void
  /** 识别语音文本 */
  recognize(): Promise<string>
}

// ============ 插件上下文 ============

/** 插件运行时上下文 — 由桌面应用注入 */
export interface SpiritPalPluginContext {
  readonly ui: PluginUI
  readonly pets: PluginPets
  readonly audio: PluginAudio
  readonly events: PluginEvents
  readonly schedule: PluginSchedule
  readonly storage: PluginStorage
  readonly net: PluginNet
  readonly ai: PluginAI
  readonly voice: PluginVoice
}

// ============ 插件定义 ============

/** 插件清单（manifest） */
export interface PluginManifest {
  /** 插件 ID */
  id: string
  /** 插件名称 */
  name: string
  /** 插件版本 */
  version: string
  /** 插件描述 */
  description: string
  /** 作者 */
  author: string
  /** 需要的权限列表 */
  permissions: PluginPermission[]
  /** 最低 SpiritPal 版本要求 */
  minVersion?: string
  /** 图标 URL */
  icon?: string
}

/** 插件入口函数 */
export type PluginRegisterFunction = (ctx: SpiritPalPluginContext) => Plugin | Promise<Plugin>

/** 插件接口 */
export interface Plugin {
  /** 插件启动 */
  start(): Promise<void> | void
  /** 插件停止 */
  stop(): Promise<void> | void
  /** 插件暂停（如窗口隐藏时） */
  pause?(): void
  /** 插件恢复 */
  resume?(): void
}

// ============ 全局声明（运行时注入） ============

/**
 * SpiritPal 插件 SDK 全局对象
 * 由桌面应用在沙箱中注入
 *
 * 用法：
 * ```ts
 * // 插件入口文件
 * export function register(SpiritPalPlugin: typeof globalThis.SpiritPalPlugin) {
 *   SpiritPalPlugin.register({
 *     async start(ctx) {
 *       ctx.pets.react('thinking')
 *       ctx.ui.bubble('Hello from my plugin!')
 *       ctx.schedule.every('30m', () => {
 *         ctx.ui.bubble('Reminder!')
 *       })
 *     },
 *     async stop() {
 *       // 清理资源
 *     },
 *   })
 * }
 * ```
 */
export interface SpiritPalPluginSDK {
  /** 注册插件 */
  register(entry: {
    start: (ctx: SpiritPalPluginContext) => Promise<void> | void
    stop?: () => Promise<void> | void
  }): void
}

// ============ 沙箱配置 ============

/** 插件沙箱配置 */
export interface PluginSandboxConfig {
  /** 是否允许访问网络 */
  allowNetwork: boolean
  /** 允许的网络域名白名单 */
  allowedDomains: string[]
  /** 是否允许访问文件系统 */
  allowFileSystem: boolean
  /** 允许的文件路径前缀 */
  allowedPathPrefixes: string[]
  /** 最大内存使用（MB） */
  maxMemoryMB: number
  /** 最大执行时间（秒） */
  maxExecutionTimeS: number
  /** 是否允许访问剪贴板 */
  allowClipboard: boolean
}

/** 默认沙箱配置 */
export const DEFAULT_SANDBOX_CONFIG: PluginSandboxConfig = {
  allowNetwork: true,
  allowedDomains: [],
  allowFileSystem: false,
  allowedPathPrefixes: [],
  maxMemoryMB: 64,
  maxExecutionTimeS: 30,
  allowClipboard: false,
}
