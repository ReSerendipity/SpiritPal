import { describe, it, expect, afterEach } from 'vitest'
import { isMobileRuntime, isDesktopRuntime } from '../platform'

const originalUA = navigator.userAgent
function setUA(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}
afterEach(() => setUA(originalUA))

describe('platform 判定 (ADR-0005 #3)', () => {
  it('Android userAgent → 移动端', () => {
    setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36')
    expect(isMobileRuntime()).toBe(true)
    expect(isDesktopRuntime()).toBe(false)
  })

  it('iPhone userAgent → 移动端', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    expect(isMobileRuntime()).toBe(true)
  })

  it('Windows userAgent → 桌面端', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect(isMobileRuntime()).toBe(false)
    expect(isDesktopRuntime()).toBe(true)
  })

  it('macOS userAgent → 桌面端', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(isMobileRuntime()).toBe(false)
  })

  it('Linux 桌面 userAgent → 桌面端', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')
    expect(isMobileRuntime()).toBe(false)
  })
})
