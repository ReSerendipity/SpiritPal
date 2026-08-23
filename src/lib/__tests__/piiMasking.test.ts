import { describe, it, expect } from 'vitest'
import { maskPII, maskPIIInObject } from '../piiMasking'

describe('maskPII', () => {
  it('掩码邮箱', () => {
    expect(maskPII('contact@example.com')).toBe('c****@example.com')
  })

  it('掩码中国大陆手机号', () => {
    expect(maskPII('手机 13812345678 联系')).toBe('手机 138****5678 联系')
  })

  it('掩码 18 位身份证号', () => {
    const masked = maskPII('id=11010519491231002X')
    expect(masked).toContain('1**********')
    expect(masked).toContain('X')
    expect(masked).not.toContain('11010519491231002')
  })

  it('不误伤普通中文文本', () => {
    expect(maskPII('今天天气不错，出来走走')).toBe('今天天气不错，出来走走')
  })
})

describe('maskPIIInObject', () => {
  it('递归掩码嵌套对象中的字符串', () => {
    const data = {
      settings: { email: 'a@b.com' },
      list: ['电话 13900000000'],
      num: 42,
      nested: { deep: '证件 110105194912310020' },
    }
    const out = maskPIIInObject(data)
    expect(out.settings.email).toBe('a****@b.com')
    expect(out.list[0]).toBe('电话 139****0000')
    expect(out.num).toBe(42)
    expect(out.nested.deep).toContain('*')
  })
})