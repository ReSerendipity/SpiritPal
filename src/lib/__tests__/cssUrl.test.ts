// cssUrl 单测 — 回归 2026-09-13「切换宠物后角色不可见」根因
// 无引号 CSS url-token 含空白会被 CSSOM 判非法并整条丢弃，故所有拼进 CSS 的资源路径必须经 cssUrl
import { describe, it, expect } from 'vitest'
import { cssUrl } from '../render/cssUrl'

describe('cssUrl', () => {
  it('should quote and percent-encode paths containing spaces', () => {
    expect(cssUrl('/pets/shimeji/Hu Tao.png')).toBe('url("/pets/shimeji/Hu%20Tao.png")')
  })

  it('should keep space-free asset paths intact inside quotes', () => {
    expect(cssUrl('/pets/doro/spritesheet.webp')).toBe('url("/pets/doro/spritesheet.webp")')
  })

  it('should not double-encode already percent-encoded paths', () => {
    expect(cssUrl('/pets/shimeji/The%20Chosen%20One.png'))
      .toBe('url("/pets/shimeji/The%20Chosen%20One.png")')
  })

  it('should encode non-ASCII characters', () => {
    expect(cssUrl('/pets/多罗/a.png')).toBe('url("/pets/%E5%A4%9A%E7%BD%97/a.png")')
  })

  it('should escape double quotes in pre-encoded paths', () => {
    expect(cssUrl('/pets/a"b%20c.png')).toBe('url("/pets/a\\"b%20c.png")')
  })

  it('should escape backslashes in pre-encoded paths', () => {
    expect(cssUrl('C:\\pets\\a%20b.png')).toBe('url("C:\\\\pets\\\\a%20b.png")')
  })

  it('should return none for empty or blank paths', () => {
    expect(cssUrl('')).toBe('none')
    expect(cssUrl('   ')).toBe('none')
    expect(cssUrl(undefined)).toBe('none')
    expect(cssUrl(null)).toBe('none')
  })

  it('should never emit a bare url token that can carry whitespace', () => {
    const risky = ['/pets/shimeji/Blooky Shimeji.png', '/pets/shimeji/Puro the Latex Wolf Shimeji.png']
    for (const p of risky) {
      expect(cssUrl(p)).toMatch(/^url\("/)
      expect(cssUrl(p)).not.toMatch(/^url\([^"']/)
    }
  })

  it('should survive CSSOM assignment (jsdom round-trip keeps the declaration)', () => {
    const el = document.createElement('div')
    el.style.backgroundImage = cssUrl('/pets/shimeji/Gengar Shimeji.png')
    expect(el.style.backgroundImage).toContain('Gengar%20Shimeji.png')
  })
})
