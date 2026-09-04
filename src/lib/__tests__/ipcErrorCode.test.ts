/**
 * ipcErrorCode.ts 单元测试
 *
 * 验证：
 * 1. 结构化格式 [IPC_ERROR:TYPE] message 正确解析
 * 2. 纯字符串（旧格式）通过关键词推断类型
 * 3. 各种错误类型正确分类
 * 4. 便捷判断函数
 */

import { describe, it, expect } from 'vitest'
import {
  parseIpcError,
  isValidationError,
  isPermissionError,
  isNotFoundError,
  isSystemError,
  IpcErrorType,
} from '@/lib/system/ipcErrorCode'

describe('ipcErrorCode', () => {
  describe('parseIpcError — 结构化格式', () => {
    it('应正确解析 [IPC_ERROR:VALIDATION] 格式', () => {
      const result = parseIpcError('[IPC_ERROR:VALIDATION] strength out of range: 15')
      expect(result.type).toBe(IpcErrorType.VALIDATION)
      expect(result.message).toBe('strength out of range: 15')
      expect(result.raw).toBe('[IPC_ERROR:VALIDATION] strength out of range: 15')
    })

    it('应正确解析 [IPC_ERROR:PERMISSION] 格式', () => {
      const result = parseIpcError('[IPC_ERROR:PERMISSION] capability not allowed: fs.readFile')
      expect(result.type).toBe(IpcErrorType.PERMISSION)
      expect(result.message).toBe('capability not allowed: fs.readFile')
    })

    it('应正确解析 [IPC_ERROR:NOT_FOUND] 格式', () => {
      const result = parseIpcError('[IPC_ERROR:NOT_FOUND] pet not found: pet-001')
      expect(result.type).toBe(IpcErrorType.NOT_FOUND)
      expect(result.message).toBe('pet not found: pet-001')
    })

    it('应正确解析 [IPC_ERROR:SYSTEM] 格式', () => {
      const result = parseIpcError('[IPC_ERROR:SYSTEM] database is locked')
      expect(result.type).toBe(IpcErrorType.SYSTEM)
      expect(result.message).toBe('database is locked')
    })

    it('未知类型码应回退为 UNKNOWN', () => {
      const result = parseIpcError('[IPC_ERROR:UNKNOWN_TYPE] something went wrong')
      expect(result.type).toBe(IpcErrorType.UNKNOWN)
      expect(result.message).toBe('something went wrong')
    })
  })

  describe('parseIpcError — 纯字符串（旧格式兼容）', () => {
    it('包含 permission/denied 应推断为 PERMISSION', () => {
      expect(parseIpcError('Permission denied').type).toBe(IpcErrorType.PERMISSION)
      expect(parseIpcError('capability scope denied').type).toBe(IpcErrorType.PERMISSION)
    })

    it('包含 not found/不存在 应推断为 NOT_FOUND', () => {
      expect(parseIpcError('pet not found').type).toBe(IpcErrorType.NOT_FOUND)
      expect(parseIpcError('宠物不存在').type).toBe(IpcErrorType.NOT_FOUND)
    })

    it('包含 invalid/out of range/参数 应推断为 VALIDATION', () => {
      expect(parseIpcError('invalid parameter').type).toBe(IpcErrorType.VALIDATION)
      expect(parseIpcError('strength out of range').type).toBe(IpcErrorType.VALIDATION)
      expect(parseIpcError('参数校验失败').type).toBe(IpcErrorType.VALIDATION)
    })

    it('包含 database/encrypt/系统 应推断为 SYSTEM', () => {
      expect(parseIpcError('database is locked').type).toBe(IpcErrorType.SYSTEM)
      expect(parseIpcError('encrypt failed').type).toBe(IpcErrorType.SYSTEM)
      expect(parseIpcError('系统错误').type).toBe(IpcErrorType.SYSTEM)
    })

    it('无法匹配任何关键词应推断为 UNKNOWN', () => {
      expect(parseIpcError('something unexpected happened').type).toBe(IpcErrorType.UNKNOWN)
    })
  })

  describe('parseIpcError — 输入类型', () => {
    it('Error 对象应提取 message', () => {
      const result = parseIpcError(new Error('not found error'))
      expect(result.type).toBe(IpcErrorType.NOT_FOUND)
      expect(result.message).toBe('not found error')
    })

    it('含 message 属性的对象应提取', () => {
      const result = parseIpcError({ message: 'invalid input' })
      expect(result.type).toBe(IpcErrorType.VALIDATION)
    })

    it('其他类型应转为字符串', () => {
      const result = parseIpcError(42)
      expect(result.type).toBe(IpcErrorType.UNKNOWN)
      expect(result.message).toBe('42')
    })
  })

  describe('便捷判断函数', () => {
    it('isValidationError 应正确判断', () => {
      expect(isValidationError('[IPC_ERROR:VALIDATION] bad param')).toBe(true)
      expect(isValidationError('[IPC_ERROR:SYSTEM] db error')).toBe(false)
    })

    it('isPermissionError 应正确判断', () => {
      expect(isPermissionError('[IPC_ERROR:PERMISSION] no access')).toBe(true)
      expect(isPermissionError('[IPC_ERROR:VALIDATION] bad param')).toBe(false)
    })

    it('isNotFoundError 应正确判断', () => {
      expect(isNotFoundError('[IPC_ERROR:NOT_FOUND] missing')).toBe(true)
      expect(isNotFoundError('[IPC_ERROR:SYSTEM] db error')).toBe(false)
    })

    it('isSystemError 应正确判断', () => {
      expect(isSystemError('[IPC_ERROR:SYSTEM] io failure')).toBe(true)
      expect(isSystemError('[IPC_ERROR:NOT_FOUND] missing')).toBe(false)
    })
  })
})
