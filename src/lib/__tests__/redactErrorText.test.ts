// redactErrorText 单元测试 — R-13 v2.0 密钥脱敏正则覆盖测试
import { describe, it, expect } from 'vitest'
import { redactErrorText } from '../llmClient'

describe('redactErrorText', () => {
  // ============ 原有用例（回归保护）============

  it('空字符串返回空', () => {
    expect(redactErrorText('')).toBe('')
  })

  it('普通错误文本不脱敏', () => {
    expect(redactErrorText('Internal Server Error')).toBe('Internal Server Error')
  })

  it('脱敏 OpenAI sk- 密钥', () => {
    const input = 'API key sk-abcdefgh1234567890invalid'
    const result = redactErrorText(input)
    expect(result).toContain('sk-abcdefgh')
    expect(result).toContain('***')
    expect(result).not.toContain('1234567890invalid')
  })

  it('脱敏 Anthropic sk-ant- 密钥', () => {
    const input = 'key: sk-ant-abcdefgh1234567890invalid'
    const result = redactErrorText(input)
    expect(result).toContain('sk-ant-abcdefgh')
    expect(result).not.toContain('1234567890invalid')
  })

  it('脱敏 Google AIza 密钥', () => {
    const input = 'AIzaSyABCDEFGHIJKLMNO1234567890'
    const result = redactErrorText(input)
    expect(result).toContain('AIzaSyABC')
    expect(result).not.toContain('DEFGHIJKLMNO1234567890')
  })

  // ============ R-13 v2.0 新增用例 ============

  it('脱敏长 Bearer JWT token（保留前 12 字符）— 模拟百度千帆/混元/OIDC', () => {
    // 构造 200 字符的 JWT token
    const longToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const input = `Authorization: Bearer ${longToken}`
    const result = redactErrorText(input)
    // 前 12 字符 "eyJhbGciOiJS" 应保留（"Bearer " + "eyJhbGciOiJS" = 12 chars after Bearer）
    expect(result).toContain('eyJhbGciOiJS')
    // 不应包含完整 token
    expect(result).not.toContain(longToken)
    // 应包含 ***
    expect(result).toContain('***')
  })

  it('脱敏短 Bearer token（< 12 字符，全部抹除）', () => {
    const input = 'Authorization: Bearer abc123'
    const result = redactErrorText(input)
    expect(result).toContain('Bearer')
    expect(result).toContain('***')
    expect(result).not.toContain('abc123')
  })

  it('脱敏 x-api-key 头回显', () => {
    const input = 'x-api-key: sk-ant-api03-1234567890abcdef'
    const result = redactErrorText(input)
    expect(result).toContain('x-api-key:')
    expect(result).toContain('***')
  })

  it('脱敏 api_key= 查询参数回显', () => {
    const input = 'api_key=sk-abcdefgh1234567890xyz'
    const result = redactErrorText(input)
    expect(result).toContain('api_key=')
    expect(result).toContain('***')
  })

  it('脱敏 api-key 头回显', () => {
    const input = 'api-key: abc123def456ghi789jkl012mno345pqr678'
    const result = redactErrorText(input)
    expect(result).toContain('api-key:')
    expect(result).toContain('***')
  })

  it('脱敏 authorization 字段回显', () => {
    const input = 'authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature'
    const result = redactErrorText(input)
    expect(result).toContain('authorization:')
    expect(result).toContain('***')
  })

  it('兜底脱敏：>40 字符的连续十六进制/base64 串', () => {
    const longHex = 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678'
    const input = `Error details: ${longHex}`
    const result = redactErrorText(input)
    // 前 8 位保留
    expect(result).toContain('a1b2c3d4')
    // 后续不应出现
    expect(result).not.toContain(longHex)
    expect(result).toContain('***')
  })

  it('不误伤短于 40 字符的普通 base64 串', () => {
    const shortB64 = 'SGVsbG8gV29ybGQ=' // "Hello World" in base64, 16 chars
    const input = `Data: ${shortB64}`
    const result = redactErrorText(input)
    expect(result).toBe(`Data: ${shortB64}`)
  })

  it('同时脱敏多种密钥格式', () => {
    const input = 'sk-abcdefgh1234 Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig x-api-key: AIzaSyABC1234567890'
    const result = redactErrorText(input)
    expect(result).toContain('sk-abcdefgh***')
    expect(result).toContain('***')
    expect(result).not.toContain('1234 Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig x-api-key: AIzaSyABC1234567890')
  })

  it('超长文本被截断到 500 字符', () => {
    const longText = 'A'.repeat(600)
    const result = redactErrorText(longText)
    expect(result.length).toBeLessThanOrEqual(504) // 500 + '...'
    expect(result).toContain('...')
  })
})
