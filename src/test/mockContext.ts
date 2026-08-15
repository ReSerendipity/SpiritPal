/**
 * @file 模拟上下文测试工具
 * @module test/mockContext
 * @description
 * 提供完整的 SpiritPal 运行上下文模拟，用于单元测试。
 * 参考 OpenPets 测试基础设施的 MockContext 设计。
 *
 * 主要模拟内容：
 * - Tauri invoke 命令（加密解密、系统API、Mod管理等）
 * - LLM 聊天调用（支持预设响应序列）
 * - 键值存储操作
 * - 事件系统（emit/listen）
 * - 语义化断言辅助函数
 */

import { vi, expect } from 'vitest'
import type { NurturingStats, PetState } from '../lib/types'

/**
 * 模拟的 LLM 响应结构
 */
export interface MockLLMResponse {
  /** 响应内容文本 */
  content: string
  /** 工具调用列表 */
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
}

/**
 * 模拟的宠物状态
 */
export interface MockPetState {
  /** 当前角色ID */
  currentCharacterId: string
  /** 养成属性（饥饿、心情、健康、亲密度等） */
  stats: NurturingStats
  /** 宠物当前状态（idle/walk/talk等） */
  petState: PetState
  /** 等级 */
  level: number
  /** 共享金币 */
  sharedCoins: number
}

/**
 * MockContext 配置选项
 */
export interface MockContextOptions {
  /** 模拟的 LLM 响应序列（按调用顺序依次返回） */
  llmResponses?: MockLLMResponse[]
  /** 模拟的宠物初始状态（覆盖默认值） */
  petState?: Partial<MockPetState>
  /** 自定义模拟的 Tauri invoke 实现 */
  invokeImpl?: Record<string, (...args: unknown[]) => unknown>
}

const DEFAULT_STATS: NurturingStats = {
  hunger: 80,
  mood: 70,
  health: 100,
  affection: 500,
  level: 5,
  exp: 0,
  coins: 1000,
  lastTickAt: Date.now(),
  lastInteractionAt: Date.now(),
  lastAffectionDecayAt: Date.now(),
}

const DEFAULT_PET_STATE: MockPetState = {
  currentCharacterId: 'doro',
  stats: { ...DEFAULT_STATS },
  petState: 'idle',
  level: 5,
  sharedCoins: 1000,
}

/**
 * 创建完整的 SpiritPal 运行上下文模拟
 * 用于单元测试中模拟 Tauri invoke、LLM 调用、存储操作和事件系统
 *
 * @param options - 模拟配置选项
 * @returns 包含所有模拟对象和断言辅助函数的上下文对象
 *
 * @example
 * ```ts
 * const ctx = createMockContext({
 *   llmResponses: [{ content: '你好！' }],
 *   petState: { stats: { hunger: 50 } }
 * })
 * ```
 */
export function createMockContext(options: MockContextOptions = {}) {
  const llmResponses = options.llmResponses ?? []
  let llmCallIndex = 0
  const petState: MockPetState = {
    ...DEFAULT_PET_STATE,
    ...options.petState,
    stats: { ...DEFAULT_STATS, ...options.petState?.stats },
  }

  // ============ Tauri invoke 模拟 ============
  const invokeCalls: Array<{ command: string; args: unknown }> = []
  const invokeImpl: Record<string, (...args: unknown[]) => unknown> = {
    get_idle_time: () => 0,
    get_active_window: () => ({ title: 'Mock Window', process_name: 'mock.exe' }),
    set_pet_click_through: () => {},
    remove_pet_click_through: () => {},
    get_mouse_pos: () => [100, 200],
    set_ignore_cursor_events: () => {},
    open_application: () => {},
    encrypt_data: (...args: unknown[]) => {
      const { data } = args[0] as { data: string }
      // D1：与真实 Rust 实现（crypto.rs 输出 ENC2:）对齐，使测试覆盖新版加密格式的加载路径
      return `ENC2:${btoa(data)}`
    },
    decrypt_data: (...args: unknown[]) => {
      const { encrypted } = args[0] as { encrypted: string }
      const stripped = encrypted.replace(/^ENC[12]:/, '')
      return atob(stripped)
    },
    compute_sha256: () => 'mock-sha256-hash',
    set_secret: () => {},
    get_secret: () => null,
    delete_secret: () => {},
    set_tray_icon: () => {},
    update_tray_icon: () => {},
    import_petmod: () => ({ success: true, name: 'mock-mod' }),
    scan_mods_directory: () => [],
    ...options.invokeImpl,
  }

  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    invokeCalls.push({ command, args: args ?? {} })
    const impl = invokeImpl[command]
    if (!impl) throw new Error(`Mock invoke: unknown command "${command}"`)
    return impl(args)
  })

  // ============ LLM 调用模拟 ============
  const llmCalls: Array<{ messages: unknown[]; options?: unknown }> = []
  const llmChat = vi.fn(async (messages: unknown[], opts?: unknown) => {
    llmCalls.push({ messages, options: opts })
    const response = llmResponses[llmCallIndex] ?? { content: 'Mock response' }
    llmCallIndex++
    return response
  })

  // ============ 存储模拟 ============
  const storage = new Map<string, unknown>()
  const storageImpl = {
    get: vi.fn(async (key: string) => storage.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { storage.set(key, value) }),
    delete: vi.fn(async (key: string) => { storage.delete(key) }),
    clear: vi.fn(async () => { storage.clear() }),
    entries: vi.fn(async () => Array.from(storage.entries())),
  }

  // ============ 事件模拟 ============
  const events: Array<{ event: string; payload: unknown }> = []
  const eventListeners = new Map<string, Array<(payload: unknown) => void>>()
  const eventImpl = {
    emit: vi.fn((event: string, payload: unknown) => {
      events.push({ event, payload })
      const listeners = eventListeners.get(event) ?? []
      listeners.forEach(fn => fn(payload))
    }),
    listen: vi.fn((event: string, callback: (payload: unknown) => void) => {
      const listeners = eventListeners.get(event) ?? []
      listeners.push(callback)
      eventListeners.set(event, listeners)
      return Promise.resolve(() => {
        const idx = listeners.indexOf(callback)
        if (idx >= 0) listeners.splice(idx, 1)
      })
    }),
  }

  // ============ 语义断言辅助 ============

  /**
   * 断言宠物执行了指定的反应/动画
   * @param expectedAnim - 期望的动画ID
   */
  const expectReacted = (expectedAnim: string) => {
    const reactionEvent = events.find(e =>
      e.event === 'spiritpal-mcp-react' && e.payload === expectedAnim,
    )
    expect(reactionEvent).toBeDefined()
  }

  /**
   * 断言宠物说了指定的话语
   * @param expectedMessage - 期望的消息文本
   */
  const expectSpoke = (expectedMessage: string) => {
    const sayEvent = events.find(e =>
      e.event === 'spiritpal-mcp-say' && e.payload === expectedMessage,
    )
    expect(sayEvent).toBeDefined()
  }

  /**
   * 断言指定的 Tauri 命令被调用过
   * @param command - 期望调用的命令名
   */
  const expectCommandCalled = (command: string) => {
    const call = invokeCalls.find(c => c.command === command)
    expect(call).toBeDefined()
  }

  /**
   * 断言 LLM 被调用了指定次数
   * @param times - 期望的调用次数
   */
  const expectLLMCalled = (times: number) => {
    expect(llmChat).toHaveBeenCalledTimes(times)
  }

  /**
   * 断言指定的事件被触发过
   * @param event - 期望触发的事件名
   */
  const expectEventEmitted = (event: string) => {
    const found = events.find(e => e.event === event)
    expect(found).toBeDefined()
  }

  // ============ 宠物状态操作 ============

  /**
   * 更新宠物养成属性
   * @param partial - 要更新的属性片段
   */
  const updateStats = (partial: Partial<NurturingStats>) => {
    Object.assign(petState.stats, partial)
  }

  /**
   * 设置宠物当前状态
   * @param state - 目标状态
   */
  const setPetState = (state: PetState) => {
    petState.petState = state
  }

  return {
    invoke,
    invokeCalls,
    llmChat,
    llmCalls,
    storage,
    storageImpl,
    events,
    eventImpl,
    eventListeners,
    petState,
    updateStats,
    setPetState,
    expectReacted,
    expectSpoke,
    expectCommandCalled,
    expectLLMCalled,
    expectEventEmitted,
  }
}

/** MockContext 类型，由 createMockContext 返回值推导 */
export type MockContext = ReturnType<typeof createMockContext>
