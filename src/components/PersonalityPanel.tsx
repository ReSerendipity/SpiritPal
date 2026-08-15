/**
 * 性格编辑面板组件
 *
 * 功能概述：
 * - 五维性格参数滑块调节（温暖/活泼/依赖/直接/理性）
 * - 角色切换选择器
 * - 实时预览生成的System Prompt
 * - 保存性格覆盖配置、重置到角色默认性格
 * - 保存成功提示
 *
 * 核心Hooks/状态：
 * - useState: 当前性格参数、预览弹窗、保存提示
 * - useEffect: 角色切换时重新加载性格
 * - useCallback: 滑块更新、保存、重置、切换角色
 *
 * 使用模块：
 * - personalityEngine: 性格引擎（加载/保存覆盖、提示词生成）
 */
import { useState, useCallback } from 'react'
import { RotateCcw, Eye } from 'lucide-react'
import type { Personality } from '../lib/types'
import {
  PERSONALITY_LABELS,
  composePersonalityPrompt,
  savePersonalityOverride,
  removePersonalityOverride,
  getEffectivePersonality,
} from '../lib/personalityEngine'
import { CHARACTERS, getCharacter } from '../lib/characters'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * 性格参数编辑面板
 *
 * 提供五维性格滑块调节、角色切换、System Prompt预览和保存重置功能。
 */
export function PersonalityPanel() {
  const currentCharacterId = useSettingsStore((s) => s.currentCharacterId)
  const character = getCharacter(currentCharacterId)

  const [personality, setPersonality] = useState<Personality>(() =>
    getEffectivePersonality(currentCharacterId, character?.personality ?? {
      warmth: 0, liveliness: 0, dependence: 0, directness: 0, rationality: 0,
    }),
  )
  const [showPreview, setShowPreview] = useState(false)
  const [savedTip, setSavedTip] = useState(false)

  // 角色切换时同步编辑中的性格（渲染期调整状态：仅当角色变化时执行一次）
  const [lastCharId, setLastCharId] = useState(currentCharacterId)
  if (currentCharacterId !== lastCharId) {
    setLastCharId(currentCharacterId)
    if (character) {
      setPersonality(getEffectivePersonality(currentCharacterId, character.personality))
    }
  }

  const handleSlider = useCallback((key: keyof Personality, value: number) => {
    setPersonality((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(() => {
    savePersonalityOverride(currentCharacterId, personality)
    setSavedTip(true)
    setTimeout(() => setSavedTip(false), 1200)
  }, [currentCharacterId, personality])

  const handleReset = useCallback(() => {
    if (!character) return
    removePersonalityOverride(currentCharacterId)
    setPersonality(character.personality)
    setSavedTip(true)
    setTimeout(() => setSavedTip(false), 1200)
  }, [currentCharacterId, character])

  const handleSwitchChar = useCallback((id: string) => {
    useSettingsStore.getState().switchCharacter(id)
  }, [])

  if (!character) return null

  const keys = Object.keys(PERSONALITY_LABELS) as (keyof Personality)[]

  return (
    <div className="space-y-5">
      {/* 角色选择器 */}
      <div className="flex gap-2">
        {CHARACTERS.map((c) => {
          const active = c.id === currentCharacterId
          return (
            <button
              key={c.id}
              onClick={() => handleSwitchChar(c.id)}
              className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm transition-all ${
                active ? 'border-amber-400 bg-amber-400/10' : 'border-ink/10 hover:border-ink/30'
              }`}
            >
              <div
                className="mx-auto mb-1 h-5 w-5 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${c.themeColor.primary}, ${c.themeColor.secondary})`,
                }}
              />
              {c.displayName}
            </button>
          )
        })}
      </div>

      {/* 五维滑块 */}
      <div className="space-y-4">
        {keys.map((key) => {
          const info = PERSONALITY_LABELS[key]
          const val = personality[key]
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-ink-muted">{info.label}</label>
                <span className="text-xs text-ink-muted">
                  {val < -0.1 ? info.min : val > 0.1 ? info.max : '中性'}
                  <span className="ml-2 tabular-nums text-ink-faint">{val.toFixed(1)}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 text-right text-[10px] text-ink-muted">{info.min}</span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.1}
                  value={val}
                  onChange={(e) => handleSlider(key, parseFloat(e.target.value))}
                  className="flex-1 accent-amber-400"
                />
                <span className="w-10 text-[10px] text-ink-muted">{info.max}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
        >
          保存性格
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-1 rounded-lg bg-surface px-3 py-2 text-sm text-ink hover:bg-cream-deep"
        >
          <RotateCcw size={14} /> 恢复默认
        </button>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-1 rounded-lg bg-surface px-3 py-2 text-sm text-ink hover:bg-cream-deep"
        >
          <Eye size={14} /> {showPreview ? '隐藏' : '预览'} Prompt
        </button>
      </div>

      {/* System Prompt 预览 */}
      {showPreview && (
        <div className="rounded-xl bg-surface p-4">
          <div className="mb-2 text-xs font-semibold text-amber-300">合成的性格 Prompt</div>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink">
            {composePersonalityPrompt(personality)}
          </pre>
        </div>
      )}

      {savedTip && (
        <div className="rounded-full bg-success px-4 py-1.5 text-center text-sm">
          已保存 ✓
        </div>
      )}
    </div>
  )
}
