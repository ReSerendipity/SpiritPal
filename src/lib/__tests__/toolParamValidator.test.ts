import { describe, it, expect } from 'vitest'
import { validateToolParams, getToolSchemaSummary } from '@/lib/system/toolParamValidator'

describe('toolParamValidator', () => {
  describe('open_application', () => {
    it('should validate valid app name', () => {
      const result = validateToolParams('open_application', { app_name: 'calc' })
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should reject empty app name', () => {
      const result = validateToolParams('open_application', { app_name: '' })
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should reject shell injection in app name', () => {
      const result = validateToolParams('open_application', { app_name: 'calc; rm -rf /' })
      expect(result.valid).toBe(false)
    })

    it('should reject path traversal in app name', () => {
      const result = validateToolParams('open_application', { app_name: '../../../etc/passwd' })
      expect(result.valid).toBe(false)
    })

    it('should reject overly long app name', () => {
      const result = validateToolParams('open_application', { app_name: 'a'.repeat(101) })
      expect(result.valid).toBe(false)
    })

    it('should allow Chinese app names', () => {
      const result = validateToolParams('open_application', { app_name: '计算器' })
      expect(result.valid).toBe(true)
    })
  })

  describe('search_web', () => {
    it('should validate valid query', () => {
      const result = validateToolParams('search_web', { query: '今天天气怎么样' })
      expect(result.valid).toBe(true)
    })

    it('should reject empty query', () => {
      const result = validateToolParams('search_web', { query: '' })
      expect(result.valid).toBe(false)
    })

    it('should reject overly long query', () => {
      const result = validateToolParams('search_web', { query: 'a'.repeat(201) })
      expect(result.valid).toBe(false)
    })

    it('should reject dangerous characters in query', () => {
      const result = validateToolParams('search_web', { query: 'test; rm -rf /' })
      expect(result.valid).toBe(false)
    })
  })

  describe('set_reminder', () => {
    it('should validate valid reminder', () => {
      const result = validateToolParams('set_reminder', {
        message: '明天开会',
        time: '明天9点',
      })
      expect(result.valid).toBe(true)
    })

    it('should validate reminder without time', () => {
      const result = validateToolParams('set_reminder', { message: '记得喝水' })
      expect(result.valid).toBe(true)
    })

    it('should reject empty message', () => {
      const result = validateToolParams('set_reminder', { message: '' })
      expect(result.valid).toBe(false)
    })

    it('should reject dangerous chars in message', () => {
      const result = validateToolParams('set_reminder', { message: 'test|cat /etc/passwd' })
      expect(result.valid).toBe(false)
    })
  })

  describe('manage_schedule', () => {
    it('should validate valid list action', () => {
      const result = validateToolParams('manage_schedule', { action: 'list' })
      expect(result.valid).toBe(true)
    })

    it('should validate valid cancel action', () => {
      const result = validateToolParams('manage_schedule', {
        action: 'cancel',
        title: '会议',
      })
      expect(result.valid).toBe(true)
    })

    it('should reject invalid action', () => {
      const result = validateToolParams('manage_schedule', { action: 'delete' })
      expect(result.valid).toBe(false)
    })
  })

  describe('adjust_pet_state', () => {
    it('should validate valid action feed', () => {
      const result = validateToolParams('adjust_pet_state', { action: 'feed' })
      expect(result.valid).toBe(true)
    })

    it('should validate valid action play', () => {
      const result = validateToolParams('adjust_pet_state', { action: 'play' })
      expect(result.valid).toBe(true)
    })

    it('should reject invalid action', () => {
      const result = validateToolParams('adjust_pet_state', { action: 'destroy' })
      expect(result.valid).toBe(false)
    })
  })

  describe('get_weather / get_pet_status', () => {
    it('should validate get_weather with no params', () => {
      const result = validateToolParams('get_weather', {})
      expect(result.valid).toBe(true)
    })

    it('should validate get_pet_status with no params', () => {
      const result = validateToolParams('get_pet_status', {})
      expect(result.valid).toBe(true)
    })
  })

  describe('unknown tool', () => {
    it('should reject unknown tool name', () => {
      const result = validateToolParams('malicious_tool', { cmd: 'rm -rf /' })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('未知工具')
    })
  })

  describe('getToolSchemaSummary', () => {
    it('should return summary for all registered tools', () => {
      const summary = getToolSchemaSummary()
      expect(summary.length).toBeGreaterThanOrEqual(7)
      expect(summary.find((s) => s.tool === 'open_application')).toBeDefined()
    })
  })
})
