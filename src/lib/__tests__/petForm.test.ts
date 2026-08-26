/**
 * petForm 单元测试 — 形态切换仅持久化（v2.16：漫游 = 窗口在桌面移动，由 PetWindow 驱动）
 * switchPetForm 只同步 settingsStore.petForm，不做任何窗口尺寸/位置操作
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSettingsState } = vi.hoisted(() => ({
  mockSettingsState: {
    petForm: 'window',
    updateSettings: vi.fn(),
  },
}))

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => mockSettingsState },
}))

import { switchPetForm, togglePetForm } from '../petForm'

describe('switchPetForm（漫游 = 仅持久化形态，窗口移动由 PetWindow 漫游行走控制器驱动）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsState.petForm = 'window'
  })

  it('切换到漫游：仅持久化 petForm=roam，不做窗口尺寸/位置操作', async () => {
    await switchPetForm('roam')
    expect(mockSettingsState.updateSettings).toHaveBeenCalledTimes(1)
    expect(mockSettingsState.updateSettings).toHaveBeenCalledWith({ petForm: 'roam' })
  })

  it('切换到窗口：仅持久化 petForm=window', async () => {
    await switchPetForm('window')
    expect(mockSettingsState.updateSettings).toHaveBeenCalledTimes(1)
    expect(mockSettingsState.updateSettings).toHaveBeenCalledWith({ petForm: 'window' })
  })

  it('togglePetForm：当前 window → 切 roam', () => {
    mockSettingsState.petForm = 'window'
    togglePetForm()
    expect(mockSettingsState.updateSettings).toHaveBeenCalledWith({ petForm: 'roam' })
  })

  it('togglePetForm：当前 roam → 切 window', () => {
    mockSettingsState.petForm = 'roam'
    togglePetForm()
    expect(mockSettingsState.updateSettings).toHaveBeenCalledWith({ petForm: 'window' })
  })
})
