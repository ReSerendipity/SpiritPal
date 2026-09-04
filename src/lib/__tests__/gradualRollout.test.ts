import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  shouldApplyRollout,
  getRolloutConfig,
  setRolloutConfig,
  setRolloutUserId,
  getRolloutOverrides,
  clearRolloutCache,
  type RolloutItem,
  type RolloutConfig,
} from '@/lib/system/gradualRollout'

// Mock promptRegistry
vi.mock('@/lib/ai/promptRegistry', () => ({
  getAllPromptVersions: () => ({
    'agent.intent': 1,
    'llm.emotion_select': 1,
  }),
}))

import { vi } from 'vitest'

describe('gradualRollout', () => {
  beforeEach(() => {
    clearRolloutCache()
    setRolloutUserId('test-user-123')
  })

  afterEach(() => {
    clearRolloutCache()
  })

  describe('shouldApplyRollout', () => {
    it('should apply when current version >= target version', () => {
      const item: RolloutItem = {
        key: 'agent.intent',
        targetVersion: 1,
        rolloutPercentage: 50,
      }
      const decision = shouldApplyRollout('user1', item, 1)
      expect(decision.shouldApply).toBe(true)
      expect(decision.reason).toBe('current_version_already_at_target')
    })

    it('should not apply when rollout percentage is 0', () => {
      const item: RolloutItem = {
        key: 'test.key',
        targetVersion: 2,
        rolloutPercentage: 0,
      }
      const decision = shouldApplyRollout('user1', item, 1)
      expect(decision.shouldApply).toBe(false)
      expect(decision.reason).toBe('rollout_percentage_zero')
    })

    it('should apply when rollout percentage is 100', () => {
      const item: RolloutItem = {
        key: 'test.key',
        targetVersion: 2,
        rolloutPercentage: 100,
      }
      const decision = shouldApplyRollout('user1', item, 1)
      expect(decision.shouldApply).toBe(true)
      expect(decision.reason).toBe('rollout_percentage_full')
    })

    it('should produce deterministic results for same user+key', () => {
      const item: RolloutItem = {
        key: 'test.key',
        targetVersion: 2,
        rolloutPercentage: 50,
      }
      const decision1 = shouldApplyRollout('user1', item, 1)
      const decision2 = shouldApplyRollout('user1', item, 1)
      expect(decision1.shouldApply).toBe(decision2.shouldApply)
    })

    it('should produce different results for different users', () => {
      const item: RolloutItem = {
        key: 'test.key',
        targetVersion: 2,
        rolloutPercentage: 50,
      }
      const results = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const d = shouldApplyRollout(`user${i}`, item, 1)
        results.add(d.shouldApply.toString())
      }
      // With 50% rollout, we should get both true and false
      expect(results.size).toBeGreaterThan(1)
    })

    it('should distribute approximately correctly for 50% rollout', () => {
      const item: RolloutItem = {
        key: 'test.key',
        targetVersion: 2,
        rolloutPercentage: 50,
      }
      let appliedCount = 0
      for (let i = 0; i < 1000; i++) {
        if (shouldApplyRollout(`user${i}`, item, 1).shouldApply) {
          appliedCount++
        }
      }
      // Should be roughly 500 ± 50 (10% tolerance)
      expect(appliedCount).toBeGreaterThan(400)
      expect(appliedCount).toBeLessThan(600)
    })
  })

  describe('getRolloutConfig / setRolloutConfig', () => {
    it('should return default config when nothing set', () => {
      clearRolloutCache()
      const config = getRolloutConfig()
      expect(config.configVersion).toBe(1)
      expect(config.items).toEqual([])
    })

    it('should persist config after set', () => {
      const config: RolloutConfig = {
        configVersion: 2,
        items: [{ key: 'test.key', targetVersion: 2, rolloutPercentage: 30 }],
      }
      setRolloutConfig(config)
      const retrieved = getRolloutConfig()
      expect(retrieved.configVersion).toBe(2)
      expect(retrieved.items).toHaveLength(1)
    })
  })

  describe('getRolloutOverrides', () => {
    it('should return empty array when no rollout items configured', () => {
      clearRolloutCache()
      const overrides = getRolloutOverrides()
      expect(overrides).toEqual([])
    })

    it('should return decisions for configured items', () => {
      const config: RolloutConfig = {
        configVersion: 1,
        items: [
          { key: 'agent.intent', targetVersion: 2, rolloutPercentage: 100 },
          { key: 'llm.emotion_select', targetVersion: 2, rolloutPercentage: 0 },
        ],
      }
      setRolloutConfig(config)
      const overrides = getRolloutOverrides()
      expect(overrides).toHaveLength(2)
      expect(overrides[0]!.shouldApply).toBe(true) // 100% rollout
      expect(overrides[1]!.shouldApply).toBe(false) // 0% rollout
    })
  })

  describe('clearRolloutCache', () => {
    it('should clear all cached data', () => {
      setRolloutConfig({ configVersion: 99, items: [] })
      clearRolloutCache()
      const config = getRolloutConfig()
      expect(config.configVersion).toBe(1)
      expect(config.items).toEqual([])
    })
  })
})
