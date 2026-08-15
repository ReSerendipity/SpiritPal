// settingsStore 单元测试 — 设置更新、角色切换、语言切换、重置
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '../settingsStore'
import { getDefaultCharacter } from '../../lib/characters'

describe('settingsStore', () => {
  beforeEach(() => {
    // 重置 store 到初始状态
    useSettingsStore.setState({
      petSize: 1.0,
      petOpacity: 1.0,
      autoStart: false,
      startMinimized: false,
      notifications: true,
      language: 'zh',
      currentCharacterId: getDefaultCharacter().id,
    })
    localStorage.clear()
  })

  describe('updateSettings', () => {
    it('部分更新设置', () => {
      useSettingsStore.getState().updateSettings({ petSize: 1.5, autoStart: true })
      const state = useSettingsStore.getState()
      expect(state.petSize).toBe(1.5)
      expect(state.autoStart).toBe(true)
      // 未更新的字段保持不变
      expect(state.petOpacity).toBe(1.0)
      expect(state.notifications).toBe(true)
    })

    it('更新多个字段不丢失其他字段', () => {
      useSettingsStore.getState().updateSettings({ language: 'en', startMinimized: true })
      const state = useSettingsStore.getState()
      expect(state.language).toBe('en')
      expect(state.startMinimized).toBe(true)
      expect(state.petSize).toBe(1.0)
    })
  })

  describe('switchCharacter', () => {
    it('切换当前角色 ID', () => {
      const original = useSettingsStore.getState().currentCharacterId
      useSettingsStore.getState().switchCharacter('feibi')
      expect(useSettingsStore.getState().currentCharacterId).toBe('feibi')
      // 切换回来
      useSettingsStore.getState().switchCharacter(original)
      expect(useSettingsStore.getState().currentCharacterId).toBe(original)
    })
  })

  describe('setLanguage', () => {
    it.each(['zh', 'en', 'ja', 'ko'] as const)('设置语言为 %s', (lang) => {
      useSettingsStore.getState().setLanguage(lang)
      expect(useSettingsStore.getState().language).toBe(lang)
    })
  })

  describe('resetSettings', () => {
    it('重置为默认设置', () => {
      // 先修改
      useSettingsStore.getState().updateSettings({
        petSize: 2.0,
        petOpacity: 0.7,
        autoStart: true,
        startMinimized: true,
        notifications: false,
        language: 'en',
      })
      // 重置
      useSettingsStore.getState().resetSettings()
      const state = useSettingsStore.getState()
      expect(state.petSize).toBe(1.0)
      expect(state.petOpacity).toBe(1.0)
      expect(state.autoStart).toBe(false)
      expect(state.startMinimized).toBe(false)
      expect(state.notifications).toBe(true)
      expect(state.language).toBe('zh')
      expect(state.currentCharacterId).toBe(getDefaultCharacter().id)
    })
  })
})
