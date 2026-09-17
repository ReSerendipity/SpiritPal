import { describe, it, expect, afterEach, vi } from 'vitest'
import { cogneeAdd, cogneeSearch, cogneeHealth } from '../memory/cogneeClient'

const originalUA = navigator.userAgent
function setUA(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}
afterEach(() => {
  setUA(originalUA)
  vi.restoreAllMocks()
})

describe('cogneeClient 移动端门控 (ADR-0005 #3)', () => {
  it('移动端 cogneeAdd 不发任何网络请求（sidecar 不存在）', async () => {
    setUA('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36')
    const spy = vi.spyOn(globalThis, 'fetch')
    await cogneeAdd('char1', 'hello')
    expect(spy).not.toHaveBeenCalled()
  })

  it('移动端 cogneeSearch 返回空数组', async () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')
    const r = await cogneeSearch('char1', 'query')
    expect(r).toEqual([])
  })

  it('移动端 cogneeHealth 返回 false', async () => {
    setUA('Mozilla/5.0 (Android)')
    expect(await cogneeHealth()).toBe(false)
  })

  it('桌面端 cogneeAdd 仍会请求 sidecar（行为不变）', async () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }) as Response)
    await cogneeAdd('char1', 'hello')
    expect(spy).toHaveBeenCalled()
  })
})
