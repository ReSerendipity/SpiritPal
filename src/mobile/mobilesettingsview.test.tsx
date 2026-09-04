// MobileSettingsView smoke 测试（审计 P3-10 S1）
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MobileSettingsView } from '@/mobile/MobileSettingsView'

// settingsStore 依赖 characters 的 getDefaultCharacter，mock 需完整
vi.mock('@/lib/data/characters', () => ({
  getAllCharacters: vi.fn(() => [{ id: 'doro', name: '多萝', spriteAsset: '' }]),
  getCharacter: vi.fn(() => null),
  getDefaultCharacter: vi.fn(() => ({ id: 'doro', name: '多萝', spriteAsset: '' })),
}))

describe('MobileSettingsView', () => {
  it('渲染设置项列表不崩溃', () => {
    render(<MobileSettingsView />)
    expect(document.body).toBeTruthy()
  })
})
