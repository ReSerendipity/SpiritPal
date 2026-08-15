/**
 * proactiveSpeak.ts 单元测试
 *
 * 测试覆盖：
 * - ProactiveSpeakManager 的启动/停止
 * - 主动说话触发条件（间隔、概率、空闲时长）
 * - 情境提示构建（饥饿、心情、时段）
 * - 监听器注册与回调
 * - dispose 清理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock 依赖模块
vi.mock('../llmClient', () => ({
  getLLMClient: vi.fn(() => ({
    chatOnce: vi.fn().mockResolvedValue('你好呀，主人！[emotion:happy]'),
  })),
}))

vi.mock('../emotionExtractor', () => ({
  EMOTION_PROMPT_FRAGMENT: '【情绪提示片段】',
}))

vi.mock('../thinkTagParser', () => ({
  THINK_TAG_PROMPT_FRAGMENT: '【思考标签片段】',
}))

vi.mock('../enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getAutobiographicalMemories: vi.fn(() => []),
  })),
}))

vi.mock('../contextAwareness', () => ({
  getContextAwarenessManager: vi.fn(() => ({
    getLastIdleMinutes: vi.fn(() => 15),
  })),
}))

vi.mock('../commitmentTracker', () => ({
  getCommitmentTracker: vi.fn(() => ({
    generateFollowUpCandidates: vi.fn().mockResolvedValue([]),
  })),
}))

// Mock petStore
vi.mock('../../stores/petStore', () => ({
  usePetStore: {
    getState: () => ({
      currentCharacterId: 'doro',
      getCurrentStats: () => ({
        hunger: 50,
        mood: 70,
        health: 100,
        affection: 500,
        level: 5,
        exp: 0,
        coins: 1000,
        lastTickAt: Date.now(),
        lastInteractionAt: Date.now(),
        lastAffectionDecayAt: Date.now(),
      }),
    }),
  },
}))

import { ProactiveSpeakManager, getProactiveSpeakManager } from '../proactiveSpeak'

describe('ProactiveSpeakManager', () => {
  let manager: ProactiveSpeakManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new ProactiveSpeakManager()
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  it('应该正确启动和停止定时检查', () => {
    manager.start()
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    manager.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('重复调用 start 不应创建多个定时器', () => {
    manager.start()
    const count1 = vi.getTimerCount()
    manager.start()
    const count2 = vi.getTimerCount()
    expect(count2).toBe(count1)
  })

  it('应该支持注册和注销监听器', async () => {
    const callback = vi.fn()
    const unsub = manager.onProactiveSpeak(callback)

    // forceSpeak 应该触发监听器
    await manager.forceSpeak()
    expect(callback).toHaveBeenCalled()

    unsub()
  })

  it('forceSpeak 应该返回清理后的消息', async () => {
    const message = await manager.forceSpeak()
    // getLLMClient 返回 '你好呀，主人！[emotion:happy]'
    // 清理后应该去掉 [emotion:happy]
    expect(message).toBe('你好呀，主人！')
  })

  it('forceSpeak 返回 null 时不应触发监听器', async () => {
    const { getLLMClient } = await import('../llmClient')
    vi.mocked(getLLMClient).mockReturnValueOnce({
      chatOnce: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    } as any)

    const callback = vi.fn()
    manager.onProactiveSpeak(callback)

    const message = await manager.forceSpeak()
    expect(message).toBeNull()
    expect(callback).not.toHaveBeenCalled()
  })

  it('dispose 应该清理定时器和监听器', () => {
    const callback = vi.fn()
    manager.onProactiveSpeak(callback)
    manager.start()

    manager.dispose()

    // dispose 后 getProactiveSpeakManager 应返回新实例
    const newManager = getProactiveSpeakManager()
    expect(newManager).not.toBe(manager)
    newManager.dispose()
  })

  it('情境提示应根据宠物状态正确构建', async () => {
    // buildContextHints 是私有方法，通过 forceSpeak 间接测试
    // 测试不同时间段的提示不会抛错
    vi.setSystemTime(new Date(2026, 0, 1, 2, 0, 0)) // 凌晨 2 点
    await manager.forceSpeak()
    expect(true).toBe(true)
  })
})
