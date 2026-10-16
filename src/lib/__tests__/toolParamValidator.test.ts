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

  describe('path 字段敏感目录拦截（GAP-03 收口，2026-10-16）', () => {
    it('should reject Windows system32 paths at TS layer（原 A04 Rust 兜底登记项）', () => {
      const result = validateToolParams('read_file', { path: 'C:/Windows/System32/config/SAM' })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('敏感目录')
    })

    it('should reject SysWOW64 / Program Files / ProgramData / Start Menu（读写双端）', () => {
      const cases: Array<[string, string]> = [
        ['read_file', 'C:/Windows/SysWOW64/kernel32.dll'],
        ['write_file', 'C:/Program Files/App/payload.dll'],
        ['write_file', 'C:/Program Files (x86)/App/payload.dll'],
        ['write_file', 'C:/ProgramData/persistence.xml'],
        ['write_file', 'C:/Users/x/AppData/Roaming/Microsoft/Windows/Start Menu/evil.lnk'],
      ]
      for (const [tool, path] of cases) {
        const result = validateToolParams(tool, { path, content: 'x' })
        expect(result.valid, `${tool} ${path} 应被拦截`).toBe(false)
        expect(result.errors[0]).toContain('敏感目录')
      }
    })

    it('should reject backslash paths outright（既有纵深：DANGEROUS_CHARS 含反斜杠，先于分段规则生效）', () => {
      const result = validateToolParams('read_file', { path: 'C:\\Windows\\System32\\config\\SAM' })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('危险字符')
    })

    it('should NOT over-block：宠物数据目录（AppData）与项目相对路径保持放行', () => {
      const cases: Array<[string, string]> = [
        ['read_file', 'C:/Users/x/AppData/Roaming/com.spiritpal/memory.db'],
        ['write_file', 'notes.txt'],
        ['read_file', './src/lib/system/toolParamValidator.ts'],
        ['read_file', 'C:/myprojects/windows-notes/readme.md'], // 目录名含子串不误伤
      ]
      for (const [tool, path] of cases) {
        const result = validateToolParams(tool, { path, content: 'x' })
        expect(result.valid, `${tool} ${path} 不应被误伤`).toBe(true)
      }
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
