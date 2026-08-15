/**
 * Mod测试框架模块
 *
 * @fileoverview 提供模组开发者的隔离测试环境，参考OpenPets测试框架设计
 *
 * 主要模块：
 * - FakeClock: 可控时钟（替换Date.now/setTimeout/setInterval）
 * - MockContext: 隔离的插件上下文Mock
 * - TestHarness: 测试线束，提供语义断言
 * - ApiCompatibilityChecker: API兼容性检查
 *
 * 依赖关系：
 * - pluginSdk.ts: SpiritPalPluginContext等插件接口类型
 * - modManager.ts: PetmodManifest模组清单类型
 *
 * 核心接口：
 * - FakeClock: 时间控制（now/advance/tick）
 * - createMockContext(): 创建隔离测试上下文
 * - TestHarness: 断言工具（assertState/assertAnimation/assertBubble等）
 * - checkApiCompatibility(): API版本兼容性检查
 *
 * 核心组件：
 * 1. FakeClock：可控时钟，用于时间依赖测试（调度、冷却、衰减）
 * 2. MockContext：隔离的插件上下文Mock，防止测试污染生产状态
 * 3. TestHarness：测试线束，提供语义化断言API
 * 4. API兼容性检查：验证模组使用的API版本是否兼容
 */

import type { SpiritPalPluginContext, PluginUI, PluginPets, PluginAudio, PluginEvents, PluginSchedule, PluginStorage, PluginNet, PluginAI, PluginVoice } from './pluginSdk'

// ============ FakeClock ============

/**
 * 可控时钟 — 替换 Date.now() 和 setTimeout/setInterval
 * 用于时间依赖测试（如调度、冷却、衰减等）
 */
export class FakeClock {
  private currentTime: number
  private timers: Array<{
    id: number
    callback: () => void
    triggerAt: number
    interval?: number
    type: 'timeout' | 'interval'
  }> = []
  private nextTimerId = 1

  constructor(initialTime?: number) {
    this.currentTime = initialTime ?? Date.now()
  }

  /** 获取当前模拟时间 */
  now(): number {
    return this.currentTime
  }

  /** 推进时间（毫秒） */
  advance(ms: number): void {
    const target = this.currentTime + ms
    while (this.currentTime < target) {
      // 找到下一个最近的 timer
      const nextTimer = this.timers
        .filter((t) => t.triggerAt <= target)
        .sort((a, b) => a.triggerAt - b.triggerAt)[0]

      if (!nextTimer) {
        this.currentTime = target
        break
      }

      this.currentTime = nextTimer.triggerAt
      nextTimer.callback()

      if (nextTimer.type === 'interval' && nextTimer.interval) {
        nextTimer.triggerAt += nextTimer.interval
      } else {
        this.timers = this.timers.filter((t) => t.id !== nextTimer.id)
      }
    }
  }

  /** 模拟 setTimeout */
  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextTimerId++
    this.timers.push({
      id,
      callback,
      triggerAt: this.currentTime + ms,
      type: 'timeout',
    })
    return id
  }

  /** 模拟 setInterval */
  setInterval(callback: () => void, ms: number): number {
    const id = this.nextTimerId++
    this.timers.push({
      id,
      callback,
      triggerAt: this.currentTime + ms,
      interval: ms,
      type: 'interval',
    })
    return id
  }

  /** 清除 timer */
  clearInterval(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id)
  }

  clearTimeout(id: number): void {
    this.clearInterval(id)
  }

  /** 获取挂起的 timer 数量 */
  getPendingTimerCount(): number {
    return this.timers.length
  }

  /** 重置到初始状态 */
  reset(initialTime?: number): void {
    this.currentTime = initialTime ?? Date.now()
    this.timers = []
    this.nextTimerId = 1
  }
}

// ============ MockContext ============

/** Mock 存储实现 */
class MockStorage implements PluginStorage {
  private data = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys())
  }

  /** 测试辅助：检查是否有数据 */
  has(key: string): boolean {
    return this.data.has(key)
  }

  /** 测试辅助：清空所有数据 */
  clear(): void {
    this.data.clear()
  }
}

/** Mock UI 实现 */
class MockUI implements PluginUI {
  bubbles: Array<{ message: string; options?: { duration?: number; style?: string } }> = []
  notifications: Array<{ title: string; body: string }> = []
  openedPanels: string[] = []

  bubble(message: string, options?: { duration?: number; style?: string }): void {
    this.bubbles.push({ message, options })
  }

  notification(title: string, body: string): void {
    this.notifications.push({ title, body })
  }

  openPanel(panelId: string): void {
    this.openedPanels.push(panelId)
  }

  closePanel(panelId: string): void {
    this.openedPanels = this.openedPanels.filter((p) => p !== panelId)
  }

  /** 测试辅助：清空记录 */
  clear(): void {
    this.bubbles = []
    this.notifications = []
    this.openedPanels = []
  }
}

/** Mock 宠物实现 */
class MockPets implements PluginPets {
  private status = { hunger: 80, mood: 80, health: 80, affection: 0, level: 1, characterId: 'test' }
  reactions: string[] = []
  speeches: string[] = []
  stateChanges: Array<Record<string, number>> = []

  async getStatus() {
    return { ...this.status }
  }

  react(reaction: string): void {
    this.reactions.push(reaction)
  }

  say(message: string): void {
    this.speeches.push(message)
  }

  modifyState(changes: Record<string, number>): void {
    this.stateChanges.push(changes)
    Object.assign(this.status, changes)
  }

  /** 测试辅助：设置状态 */
  setStatus(status: Partial<typeof this.status>): void {
    Object.assign(this.status, status)
  }

  /** 测试辅助：清空记录 */
  clear(): void {
    this.reactions = []
    this.speeches = []
    this.stateChanges = []
  }
}

/** Mock 音频实现 */
class MockAudio implements PluginAudio {
  played: Array<{ url: string; volume?: number; loop?: boolean }> = []
  speeches: Array<{ text: string; voice?: string; speed?: number }> = []
  private playing = false

  async play(url: string, options?: { volume?: number; loop?: boolean }): Promise<void> {
    this.playing = true
    this.played.push({ url, ...options })
  }

  async speak(text: string, options?: { voice?: string; speed?: number }): Promise<void> {
    this.speeches.push({ text, ...options })
  }

  stop(): void {
    this.playing = false
  }

  isPlaying(): boolean {
    return this.playing
  }
}

/** Mock 事件实现 */
class MockEvents implements PluginEvents {
  private listeners = new Map<string, Set<(payload: unknown) => void>>()
  emitted: Array<{ event: string; payload?: unknown }> = []

  on(event: string, callback: (payload: unknown) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(callback)
    return () => this.listeners.get(event)!.delete(callback)
  }

  emit(event: string, payload?: unknown): void {
    this.emitted.push({ event, payload })
    this.listeners.get(event)?.forEach((fn) => fn(payload))
  }

  off(event: string, callback: (payload: unknown) => void): void {
    this.listeners.get(event)?.delete(callback)
  }
}

/** Mock 调度实现 */
class MockSchedule implements PluginSchedule {
  scheduled: Array<{ type: 'every' | 'at' | 'after'; interval: string }> = []

  every(interval: string, _callback: () => void): () => void {
    this.scheduled.push({ type: 'every', interval })
    return () => {}
  }

  at(time: string, _callback: () => void): () => void {
    this.scheduled.push({ type: 'at', interval: time })
    return () => {}
  }

  after(delay: string, _callback: () => void): () => void {
    this.scheduled.push({ type: 'after', interval: delay })
    return () => {}
  }

  cancelAll(): void {
    this.scheduled = []
  }
}

/** Mock 网络实现 */
class MockNet implements PluginNet {
  requests: Array<{ url: string; options?: RequestInit }> = []
  private responseOverrides = new Map<string, Response>()

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.requests.push({ url, options })
    const override = this.responseOverrides.get(url)
    if (override) return override
    return new Response('{}', { status: 200 })
  }

  async connect(_url: string): Promise<WebSocket> {
    throw new Error('MockNet.connect 未实现')
  }

  /** 测试辅助：设置 URL 的固定响应 */
  setResponse(url: string, response: Response): void {
    this.responseOverrides.set(url, response)
  }
}

/** Mock AI 实现 */
class MockAI implements PluginAI {
  chatResponses: string[] = []

  async chat(): Promise<string> {
    return this.chatResponses.shift() ?? 'mock response'
  }

  async analyze(): Promise<string> {
    return 'mock analysis'
  }

  async extractMemories(): Promise<string[]> {
    return []
  }
}

/** Mock 语音实现 */
class MockVoice implements PluginVoice {
  listening = false
  recognitionResult = ''

  startListening(): void {
    this.listening = true
  }

  stopListening(): void {
    this.listening = false
  }

  async recognize(): Promise<string> {
    return this.recognitionResult
  }
}

/**
 * 隔离的模组测试上下文 — 提供 Mock 版本的全部插件 API
 */
export class MockContext implements SpiritPalPluginContext {
  readonly ui: MockUI
  readonly pets: MockPets
  readonly audio: MockAudio
  readonly events: MockEvents
  readonly schedule: MockSchedule
  readonly storage: MockStorage
  readonly net: MockNet
  readonly ai: MockAI
  readonly voice: MockVoice

  constructor() {
    this.ui = new MockUI()
    this.pets = new MockPets()
    this.audio = new MockAudio()
    this.events = new MockEvents()
    this.schedule = new MockSchedule()
    this.storage = new MockStorage()
    this.net = new MockNet()
    this.ai = new MockAI()
    this.voice = new MockVoice()
  }

  /** 清空所有 mock 记录 */
  clear(): void {
    this.ui.clear()
    this.pets.clear()
    this.audio.played = []
    this.audio.speeches = []
    this.events.emitted = []
    this.schedule.scheduled = []
    this.net.requests = []
  }
}

// ============ TestHarness ============

/** 测试断言结果 */
export interface AssertionResult {
  passed: boolean
  message: string
  details?: string
}

/**
 * 测试线束 — 提供语义断言和测试辅助
 */
export class TestHarness {
  readonly context: MockContext
  readonly clock: FakeClock
  private assertions: AssertionResult[] = []

  constructor() {
    this.context = new MockContext()
    this.clock = new FakeClock()
  }

  // ============ 语义断言 ============

  /** 断言宠物说了包含指定文本的话 */
  petSaid(text: string): AssertionResult {
    const found = this.context.pets.speeches.some((s) => s.includes(text))
    const result: AssertionResult = {
      passed: found,
      message: found
        ? `宠物说了包含 "${text}" 的话`
        : `宠物没有说包含 "${text}" 的话`,
      details: `宠物说的话: [${this.context.pets.speeches.join(', ')}]`,
    }
    this.assertions.push(result)
    return result
  }

  /** 断言显示了气泡消息 */
  bubbleShown(text?: string): AssertionResult {
    const found = text
      ? this.context.ui.bubbles.some((b) => b.message.includes(text))
      : this.context.ui.bubbles.length > 0
    const result: AssertionResult = {
      passed: found,
      message: found
        ? `气泡消息已显示${text ? ` (包含 "${text}")` : ''}`
        : `气泡消息未显示${text ? ` (包含 "${text}")` : ''}`,
    }
    this.assertions.push(result)
    return result
  }

  /** 断言触发了宠物反应 */
  petReacted(reaction?: string): AssertionResult {
    const found = reaction
      ? this.context.pets.reactions.includes(reaction)
      : this.context.pets.reactions.length > 0
    const result: AssertionResult = {
      passed: found,
      message: found
        ? `宠物触发了反应${reaction ? ` "${reaction}"` : ''}`
        : `宠物未触发反应${reaction ? ` "${reaction}"` : ''}`,
    }
    this.assertions.push(result)
    return result
  }

  /** 断言发送了系统通知 */
  notificationSent(title?: string): AssertionResult {
    const found = title
      ? this.context.ui.notifications.some((n) => n.title.includes(title))
      : this.context.ui.notifications.length > 0
    const result: AssertionResult = {
      passed: found,
      message: found ? '通知已发送' : '通知未发送',
    }
    this.assertions.push(result)
    return result
  }

  /** 断言网络请求发送到指定 URL */
  networkRequestSent(urlPattern: string | RegExp): AssertionResult {
    const found = this.context.net.requests.some((r) =>
      typeof urlPattern === 'string'
        ? r.url.includes(urlPattern)
        : urlPattern.test(r.url),
    )
    const result: AssertionResult = {
      passed: found,
      message: found ? `网络请求已发送到 ${urlPattern}` : `网络请求未发送到 ${urlPattern}`,
    }
    this.assertions.push(result)
    return result
  }

  /** 断言事件触发 */
  eventEmitted(eventName: string): AssertionResult {
    const found = this.context.events.emitted.some((e) => e.event === eventName)
    const result: AssertionResult = {
      passed: found,
      message: found ? `事件 "${eventName}" 已触发` : `事件 "${eventName}" 未触发`,
    }
    this.assertions.push(result)
    return result
  }

  // ============ 结果收集 ============

  /** 获取所有断言结果 */
  getAssertions(): AssertionResult[] {
    return [...this.assertions]
  }

  /** 检查所有断言是否通过 */
  allPassed(): boolean {
    return this.assertions.every((a) => a.passed)
  }

  /** 获取失败的断言 */
  getFailures(): AssertionResult[] {
    return this.assertions.filter((a) => !a.passed)
  }

  /** 重置测试线束 */
  reset(): void {
    this.context.clear()
    this.clock.reset()
    this.assertions = []
  }
}

// ============ API 兼容性检查 ============

/** API 兼容性检查结果 */
export interface CompatibilityResult {
  compatible: boolean
  missingApis: string[]
  deprecatedApis: string[]
}

/**
 * 检查模组使用的 API 是否与当前 SDK 版本兼容
 * @param usedApis 模组使用的 API 列表
 * @param _sdkVersion 当前 SDK 版本（预留）
 */
export function checkApiCompatibility(
  usedApis: string[],
  _sdkVersion: string,
): CompatibilityResult {
  // 已知 API 列表（随 SDK 版本增长）
  const knownApis = new Set([
    'ctx.ui.bubble', 'ctx.ui.notification', 'ctx.ui.openPanel', 'ctx.ui.closePanel',
    'ctx.pets.getStatus', 'ctx.pets.react', 'ctx.pets.say', 'ctx.pets.modifyState',
    'ctx.audio.play', 'ctx.audio.speak', 'ctx.audio.stop', 'ctx.audio.isPlaying',
    'ctx.events.on', 'ctx.events.emit', 'ctx.events.off',
    'ctx.schedule.every', 'ctx.schedule.at', 'ctx.schedule.after', 'ctx.schedule.cancelAll',
    'ctx.storage.get', 'ctx.storage.set', 'ctx.storage.delete', 'ctx.storage.keys',
    'ctx.net.fetch', 'ctx.net.connect',
    'ctx.ai.chat', 'ctx.ai.analyze', 'ctx.ai.extractMemories',
    'ctx.voice.startListening', 'ctx.voice.stopListening', 'ctx.voice.recognize',
  ])

  // 已废弃 API
  const deprecatedApis = new Set<string>([
    // 预留：未来版本可能废弃的 API
  ])

  const missingApis = usedApis.filter((api) => !knownApis.has(api))
  const usedDeprecated = usedApis.filter((api) => deprecatedApis.has(api))

  return {
    compatible: missingApis.length === 0,
    missingApis,
    deprecatedApis: usedDeprecated,
  }
}
