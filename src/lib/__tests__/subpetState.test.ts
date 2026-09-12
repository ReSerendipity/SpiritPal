/**
 * @file subpetState.test.ts
 * @description 副宠状态机单元测试 — 四态转换与非法事件守卫
 */

import { describe, it, expect } from 'vitest'
import {
  SubpetStateMachine,
  canTransition,
  transitionSubpetState,
  isSubpetActive,
} from '@/lib/nurture/subpetState'

describe('subpetState', () => {
  describe('纯函数转换表', () => {
    it('recalled --summon--> summoned', () => {
      expect(canTransition('recalled', 'summon')).toBe(true)
      expect(transitionSubpetState('recalled', 'summon')).toBe('summoned')
    })

    it('summoned --startFollowing--> following', () => {
      expect(transitionSubpetState('summoned', 'startFollowing')).toBe('following')
    })

    it('following --stopFollowing--> idle', () => {
      expect(transitionSubpetState('following', 'stopFollowing')).toBe('idle')
    })

    it('idle --startFollowing--> following', () => {
      expect(transitionSubpetState('idle', 'startFollowing')).toBe('following')
    })

    it('任意活跃态 --recall--> recalled', () => {
      expect(transitionSubpetState('summoned', 'recall')).toBe('recalled')
      expect(transitionSubpetState('following', 'recall')).toBe('recalled')
      expect(transitionSubpetState('idle', 'recall')).toBe('recalled')
    })

    it('不合法事件保持原状态且 canTransition=false', () => {
      expect(canTransition('recalled', 'startFollowing')).toBe(false)
      expect(transitionSubpetState('recalled', 'startFollowing')).toBe('recalled')
      expect(canTransition('recalled', 'recall')).toBe(false)
      expect(transitionSubpetState('following', 'summon')).toBe('following')
    })
  })

  describe('SubpetStateMachine 类', () => {
    it('默认初始状态为 recalled', () => {
      const sm = new SubpetStateMachine()
      expect(sm.getState()).toBe('recalled')
      expect(sm.isActive()).toBe(false)
    })

    it('完整生命周期：召唤→跟随→闲置→跟随→收回', () => {
      const sm = new SubpetStateMachine()
      expect(sm.dispatch('summon')).toBe(true)
      expect(sm.getState()).toBe('summoned')
      expect(sm.isActive()).toBe(true)

      expect(sm.dispatch('startFollowing')).toBe(true)
      expect(sm.getState()).toBe('following')
      expect(sm.isFollowing()).toBe(true)

      expect(sm.dispatch('stopFollowing')).toBe(true)
      expect(sm.getState()).toBe('idle')

      expect(sm.dispatch('startFollowing')).toBe(true)
      expect(sm.getState()).toBe('following')

      expect(sm.dispatch('recall')).toBe(true)
      expect(sm.getState()).toBe('recalled')
      expect(sm.isActive()).toBe(false)
    })

    it('不合法事件返回 false 且不改变状态', () => {
      const sm = new SubpetStateMachine()
      expect(sm.dispatch('startFollowing')).toBe(false)
      expect(sm.getState()).toBe('recalled')
      // 已收回状态再次 summon 仍可召唤
      expect(sm.dispatch('summon')).toBe(true)
    })

    it('收回后可再次召唤', () => {
      const sm = new SubpetStateMachine('following')
      sm.dispatch('recall')
      expect(sm.getState()).toBe('recalled')
      expect(sm.dispatch('summon')).toBe(true)
      expect(sm.getState()).toBe('summoned')
    })

    it('isSubpetActive 工具函数', () => {
      expect(isSubpetActive('summoned')).toBe(true)
      expect(isSubpetActive('following')).toBe(true)
      expect(isSubpetActive('idle')).toBe(true)
      expect(isSubpetActive('recalled')).toBe(false)
    })
  })
})
