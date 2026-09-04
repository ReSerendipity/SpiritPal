/**
 * constants.ts 单元测试
 * 验证全局常量值合理且导出正确
 */

import { describe, it, expect } from 'vitest'
import * as C from '@/lib/data/constants'

describe('constants', () => {
  describe('窗口尺寸', () => {
    it('最小尺寸应 > 0 且 < 默认尺寸', () => {
      expect(C.WIN_MIN_W).toBeGreaterThan(0)
      expect(C.WIN_MIN_H).toBeGreaterThan(0)
      expect(C.WIN_MIN_W).toBeLessThan(C.WIN_DEFAULT_W)
      expect(C.WIN_MIN_H).toBeLessThan(C.WIN_DEFAULT_H)
    })

    it('默认尺寸应 < 最大尺寸', () => {
      expect(C.WIN_DEFAULT_W).toBeLessThanOrEqual(C.WIN_MAX_W)
      expect(C.WIN_DEFAULT_H).toBeLessThanOrEqual(C.WIN_MAX_H)
    })

    it('气泡预留空间应 > 0', () => {
      expect(C.BUBBLE_TOP_SPACE).toBeGreaterThan(0)
    })
  })

  describe('数据库', () => {
    it('DB_PATH 应以 sqlite: 前缀开头', () => {
      expect(C.DB_PATH).toMatch(/^sqlite:/)
    })

    it('缓存上限应 > 0', () => {
      expect(C.SETTINGS_CACHE_MAX).toBeGreaterThan(0)
    })
  })

  describe('IPC 超时', () => {
    it('默认超时应 > 0', () => {
      expect(C.IPC_DEFAULT_TIMEOUT_MS).toBeGreaterThan(0)
    })

    it('重试次数应 >= 0', () => {
      expect(C.IPC_DEFAULT_RETRY_COUNT).toBeGreaterThanOrEqual(0)
    })
  })

  describe('MCP 桥', () => {
    it('超时应 > 0', () => {
      expect(C.MCP_TIMEOUT_SECS).toBeGreaterThan(0)
    })
  })

  describe('IPC 安全', () => {
    it('消息大小上限应 > 0', () => {
      expect(C.IPC_MAX_MESSAGE_SIZE).toBeGreaterThan(0)
    })

    it('Token 轮换周期应 > 0', () => {
      expect(C.IPC_TOKEN_ROTATION_MINUTES).toBeGreaterThan(0)
    })
  })

  describe('记忆系统', () => {
    it('LRU 上限应 > 0', () => {
      expect(C.CHAT_HISTORY_LRU_MAX).toBeGreaterThan(0)
    })

    it('向量阈值应在 0~1 之间', () => {
      expect(C.MEMORY_VECTOR_THRESHOLD).toBeGreaterThan(0)
      expect(C.MEMORY_VECTOR_THRESHOLD).toBeLessThan(1)
    })
  })

  describe('喂食渐进恢复', () => {
    it('即时比例应在 0~1 之间', () => {
      expect(C.FEED_IMMEDIATE_RATIO).toBeGreaterThan(0)
      expect(C.FEED_IMMEDIATE_RATIO).toBeLessThan(1)
    })
  })

  describe('边缘吸附', () => {
    it('阈值比例应在 0~1 之间', () => {
      expect(C.DOCK_THRESHOLD_RATIO).toBeGreaterThan(0)
      expect(C.DOCK_THRESHOLD_RATIO).toBeLessThan(1)
    })
  })
})
