/**
 * 性格可视化编辑器组件（F1.8）
 *
 * 功能概述：
 * - 五维性格参数可视化编辑（温暖/活泼/依赖/直接/理性）
 * - SVG雷达图实时预览性格分布
 * - 说话风格配置（语气、用词偏好、表情符号使用）
 * - 互动偏好设置（互动频率、主动搭话概率）
 * - 作息时间配置（活跃时段开始/结束）
 * - 预设性格模板快速应用
 * - 重置到默认性格、实时预览System Prompt
 *
 * 核心Hooks/状态：
 * - useState: 性格配置、预览弹窗、自定义预设
 * - useEffect: 加载当前角色性格配置
 * - useCallback: 配置更新、保存、重置、模板应用
 *
 * 使用模块：
 * - personalityEngine: 性格参数引擎（提示词组合、配置保存）
 * - personalityTemplates: 预设性格模板
 */
import { useState, useCallback } from 'react'
import {
  RotateCcw, Eye, Plus, Trash2, Sparkles, Clock,
} from 'lucide-react'
import type {
  Personality, PersonalityConfig, SpeakingStyle, InteractionPreferences,
  SchedulePeriod, Tone, WordPreference, InteractionFrequency,
} from '../lib/types'
import {
  PERSONALITY_LABELS,
  composePersonalityPrompt,
  buildDefaultPersonalityConfig,
  getEffectivePersonalityConfig,
  savePersonalityConfigOverride,
  removePersonalityConfigOverride,
} from '../lib/personalityEngine'
import { PERSONALITY_TEMPLATES } from '../lib/personalityTemplates'
import { getCharacter } from '../lib/characters'
import { CHARACTERS } from '../lib/characters'
import { useSettingsStore } from '../stores/settingsStore'

// ============ 五维雷达图（SVG）============
const DIM_KEYS: (keyof Personality)[] = ['warmth', 'liveliness', 'dependence', 'directness', 'rationality']

function RadarChart({ personality }: { personality: Personality }) {
  const size = 220
  const cx = size / 2
  const cy = size / 2
  const maxR = 80
  const levels = 5  // 网格层数

  // 计算第 i 个维度的角度（从正上方开始，顺时针）
  function angleOf(i: number): number {
    return -Math.PI / 2 + (i * 2 * Math.PI) / 5
  }

  // 将维度值（-1 ~ 1）映射为半径
  function radiusOf(v: number): number {
    return ((v + 1) / 2) * maxR
  }

  // 计算某维度某值对应的坐标
  function pointOf(i: number, v: number): { x: number; y: number } {
    const r = radiusOf(v)
    const a = angleOf(i)
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }

  // 网格五边形路径
  function gridPath(level: number): string {
    // level 0 → v=-1 (r=0), level 5 → v=1 (r=maxR)
    // Actually let's map: level 1→v=-0.6, level 2→v=-0.2, level 3→v=0.2, level 4→v=0.6, level 5→v=1
    const actualV = -1 + (level / levels) * 2
    const pts = DIM_KEYS.map((_, i) => {
      const p = pointOf(i, actualV)
      return `${p.x},${p.y}`
    })
    return `M ${pts.join(' L ')} Z`
  }

  // 数据多边形路径
  const dataPoints = DIM_KEYS.map((key, i) => {
    const p = pointOf(i, personality[key])
    return `${p.x},${p.y}`
  })
  const dataPath = `M ${dataPoints.join(' L ')} Z`

  // 轴线
  const axes = DIM_KEYS.map((_, i) => {
    const p = pointOf(i, 1)
    return { x1: cx, y1: cy, x2: p.x, y2: p.y }
  })

  // 标签位置
  const labels = DIM_KEYS.map((key, i) => {
    const p = pointOf(i, 1)
    const labelP = pointOf(i, 1.25)
    return {
      key,
      label: PERSONALITY_LABELS[key].label,
      x: labelP.x,
      y: labelP.y,
      anchor: Math.abs(p.x - cx) < 5 ? 'middle' : p.x > cx ? 'start' : 'end',
    }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      {/* 网格五边形 */}
      {[1, 2, 3, 4, 5].map((lv) => (
        <path
          key={lv}
          d={gridPath(lv)}
          fill="none"
          stroke="rgba(74,54,38,0.12)"
          strokeWidth={1}
        />
      ))}
      {/* 轴线 */}
      {axes.map((a, i) => (
        <line
          key={i}
          x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
          stroke="rgba(74,54,38,0.12)"
          strokeWidth={1}
        />
      ))}
      {/* 数据填充 */}
      <path
        d={dataPath}
        fill="rgba(251,191,36,0.25)"
        stroke="rgb(251,191,36)"
        strokeWidth={2}
      />
      {/* 数据点 */}
      {DIM_KEYS.map((key, i) => {
        const p = pointOf(i, personality[key])
        return (
          <circle
            key={key}
            cx={p.x} cy={p.y} r={3}
            fill="rgb(251,191,36)"
          />
        )
      })}
      {/* 维度标签 */}
      {labels.map((l) => (
        <text
          key={l.key}
          x={l.x} y={l.y}
          textAnchor={l.anchor as 'middle' | 'start' | 'end'}
          dominantBaseline="middle"
          className="fill-ink-muted text-[10px]"
        >
          {l.label}
        </text>
      ))}
      {/* 中心点 */}
      <circle cx={cx} cy={cy} r={2} fill="rgba(74,54,38,0.3)" />
    </svg>
  )
}

// ============ 五维滑块 ============
function PersonalitySliders({
  personality, onChange,
}: {
  personality: Personality
  onChange: (key: keyof Personality, value: number) => void
}) {
  return (
    <div className="space-y-3">
      {DIM_KEYS.map((key) => {
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
                onChange={(e) => onChange(key, parseFloat(e.target.value))}
                className="flex-1 accent-amber-400"
              />
              <span className="w-10 text-[10px] text-ink-muted">{info.max}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============ 说话风格编辑器 ============
const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: 'gentle', label: '温柔' },
  { value: 'lively', label: '活泼' },
  { value: 'cold', label: '冷淡' },
  { value: 'enthusiastic', label: '热情' },
]
const WORD_OPTIONS: { value: WordPreference; label: string }[] = [
  { value: 'formal', label: '正式' },
  { value: 'colloquial', label: '口语' },
  { value: 'internet', label: '网络用语' },
]

function SpeakingStyleEditor({
  style, onChange,
}: {
  style: SpeakingStyle
  onChange: (style: SpeakingStyle) => void
}) {
  const [newPhrase, setNewPhrase] = useState('')

  function addPhrase() {
    const trimmed = newPhrase.trim()
    if (!trimmed) return
    onChange({ ...style, catchphrases: [...style.catchphrases, trimmed] })
    setNewPhrase('')
  }

  function removePhrase(idx: number) {
    onChange({ ...style, catchphrases: style.catchphrases.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink-muted">语气</label>
          <select
            value={style.tone}
            onChange={(e) => onChange({ ...style, tone: e.target.value as Tone })}
            className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            {TONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-muted">用词偏好</label>
          <select
            value={style.wordPreference}
            onChange={(e) => onChange({ ...style, wordPreference: e.target.value as WordPreference })}
            className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            {WORD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-ink-muted">口头禅</label>
        <div className="flex gap-2">
          <input
            value={newPhrase}
            onChange={(e) => setNewPhrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addPhrase() }}
            placeholder="输入口头禅后回车添加"
            className="flex-1 rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <button
            onClick={addPhrase}
            className="flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-2 text-sm text-ink hover:bg-blush-soft"
          >
            <Plus size={14} />
          </button>
        </div>
        {style.catchphrases.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {style.catchphrases.map((phrase, idx) => (
              <span
                key={idx}
                className="flex items-center gap-1 rounded-full bg-amber-400/20 px-3 py-1 text-xs text-amber-200"
              >
                {phrase}
                <button
                  onClick={() => removePhrase(idx)}
                  className="text-amber-300/60 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 互动偏好编辑器 ============
const FREQ_OPTIONS: { value: InteractionFrequency; label: string }[] = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

function InteractionPrefsEditor({
  prefs, onChange,
}: {
  prefs: InteractionPreferences
  onChange: (prefs: InteractionPreferences) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink">喜欢被摸头</span>
        <button
          onClick={() => onChange({ ...prefs, likeHeadPat: !prefs.likeHeadPat })}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            prefs.likeHeadPat ? 'bg-amber-400' : 'bg-ink-faint'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              prefs.likeHeadPat ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink">讨厌被拖拽</span>
        <button
          onClick={() => onChange({ ...prefs, hateDrag: !prefs.hateDrag })}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            prefs.hateDrag ? 'bg-amber-400' : 'bg-ink-faint'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              prefs.hateDrag ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink">喜欢互动频率</span>
        <div className="flex gap-1">
          {FREQ_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => onChange({ ...prefs, interactionFrequency: o.value })}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                prefs.interactionFrequency === o.value
                  ? 'bg-amber-400 text-gray-900'
                  : 'bg-surface text-ink hover:bg-cream-deep'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============ 作息时间可视化编辑器 ============
function ScheduleEditor({
  schedule, onChange,
}: {
  schedule: SchedulePeriod[]
  onChange: (schedule: SchedulePeriod[]) => void
}) {
  function updatePeriod(id: string, partial: Partial<SchedulePeriod>) {
    onChange(schedule.map((s) => (s.id === id ? { ...s, ...partial } : s)))
  }
  function addPeriod() {
    const id = `p${Date.now()}`
    onChange([...schedule, { id, start: 12, end: 14, type: 'active' }])
  }
  function removePeriod(id: string) {
    onChange(schedule.filter((s) => s.id !== id))
  }

  return (
    <div className="space-y-3">
      {/* 24h 时间轴可视化 */}
      <div className="relative h-8 w-full overflow-hidden rounded-lg bg-cream-deep">
        {schedule.map((p) => {
          const leftPct = (p.start / 24) * 100
          const widthPct = ((p.end - p.start) / 24) * 100
          const color = p.type === 'active' ? 'bg-amber-400/70' : 'bg-indigo-500/70'
          return (
            <div
              key={p.id}
              className={`absolute top-0 h-full ${color} flex items-center justify-center text-[9px] text-gray-900`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${p.start}:00 - ${p.end}:00 (${p.type === 'active' ? '活跃' : '睡眠'})`}
            >
              {widthPct > 8 ? (p.type === 'active' ? '活跃' : '睡眠') : ''}
            </div>
          )
        })}
        {/* 小时刻度 */}
        {[0, 6, 12, 18, 24].map((h) => (
          <div
            key={h}
            className="absolute top-0 h-full border-l border-ink/20 text-[8px] text-ink-muted"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            <span className="ml-0.5">{h}</span>
          </div>
        ))}
      </div>

      {/* 时段列表 */}
      <div className="space-y-2">
        {schedule.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-lg bg-surface/50 p-2">
            <button
              onClick={() => updatePeriod(p.id, { type: p.type === 'active' ? 'sleep' : 'active' })}
              className={`rounded px-2 py-1 text-[10px] font-medium ${
                p.type === 'active'
                  ? 'bg-amber-400/30 text-amber-200'
                  : 'bg-indigo-500/30 text-indigo-200'
              }`}
            >
              {p.type === 'active' ? '活跃' : '睡眠'}
            </button>
            <div className="flex flex-1 items-center gap-1">
              <input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={p.start}
                onChange={(e) => updatePeriod(p.id, { start: parseFloat(e.target.value) || 0 })}
                className="w-14 rounded bg-surface px-2 py-1 text-xs"
              />
              <span className="text-xs text-ink-muted">→</span>
              <input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={p.end}
                onChange={(e) => updatePeriod(p.id, { end: parseFloat(e.target.value) || 0 })}
                className="w-14 rounded bg-surface px-2 py-1 text-xs"
              />
              <span className="text-[10px] text-ink-muted">时</span>
            </div>
            <button
              onClick={() => removePeriod(p.id)}
              className="text-ink-muted hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addPeriod}
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-ink/20 py-2 text-xs text-ink-muted hover:border-amber-400/50 hover:text-amber-300"
      >
        <Plus size={14} /> 添加时段
      </button>
    </div>
  )
}

// ============ 模板选择器 ============
function TemplateButtons({ onApply }: { onApply: (templateId: string) => void }) {
  const [appliedId, setAppliedId] = useState<string | null>(null)

  function handleApply(id: string) {
    onApply(id)
    setAppliedId(id)
    setTimeout(() => setAppliedId(null), 1500)
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-amber-300">
        <Sparkles size={14} /> 一键应用性格模板
      </div>
      <div className="grid grid-cols-5 gap-2">
        {PERSONALITY_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => handleApply(t.id)}
            title={t.description}
            className={`flex flex-col items-center rounded-lg border-2 px-1 py-2 transition-all ${
              appliedId === t.id
                ? 'border-green-400 bg-green-400/10'
                : 'border-ink/10 hover:border-amber-400/50 hover:bg-white/5'
            }`}
          >
            <span className="text-lg">{t.emoji}</span>
            <span className="mt-0.5 text-[10px] text-ink">{t.name}</span>
          </button>
        ))}
      </div>
      {appliedId && (
        <div className="mt-1 text-center text-[10px] text-green-400">
          已应用「{PERSONALITY_TEMPLATES.find((t) => t.id === appliedId)?.name}」模板，可继续微调
        </div>
      )}
    </div>
  )
}

// ============ 主组件 ============
export function PersonalityEditor() {
  const currentCharacterId = useSettingsStore((s) => s.currentCharacterId)
  const character = getCharacter(currentCharacterId)

  const [config, setConfig] = useState<PersonalityConfig>(() => {
    if (!character) {
      return {
        personality: { warmth: 0, liveliness: 0, dependence: 0, directness: 0, rationality: 0 },
        speakingStyle: { tone: 'gentle', wordPreference: 'colloquial', catchphrases: [] },
        interactionPrefs: { likeHeadPat: true, hateDrag: false, interactionFrequency: 'medium' },
        schedule: [{ id: 'd1', start: 7, end: 22, type: 'active' }],
        systemPrompt: '',
      }
    }
    return getEffectivePersonalityConfig(currentCharacterId, buildDefaultPersonalityConfig(character))
  })
  const [showPrompt, setShowPrompt] = useState(false)
  const [savedTip, setSavedTip] = useState(false)

  // 角色切换时同步编辑中的配置（渲染期调整状态：仅当角色变化时执行一次）
  const [lastCharId, setLastCharId] = useState(currentCharacterId)
  if (currentCharacterId !== lastCharId) {
    setLastCharId(currentCharacterId)
    if (character) {
      setConfig(getEffectivePersonalityConfig(currentCharacterId, buildDefaultPersonalityConfig(character)))
    }
  }

  const handleSlider = useCallback((key: keyof Personality, value: number) => {
    setConfig((prev) => ({ ...prev, personality: { ...prev.personality, [key]: value } }))
  }, [])

  const handleSpeakingStyle = useCallback((style: SpeakingStyle) => {
    setConfig((prev) => ({ ...prev, speakingStyle: style }))
  }, [])

  const handleInteractionPrefs = useCallback((prefs: InteractionPreferences) => {
    setConfig((prev) => ({ ...prev, interactionPrefs: prefs }))
  }, [])

  const handleSchedule = useCallback((schedule: SchedulePeriod[]) => {
    setConfig((prev) => ({ ...prev, schedule }))
  }, [])

  const handleApplyTemplate = useCallback((templateId: string) => {
    const template = PERSONALITY_TEMPLATES.find((t) => t.id === templateId)
    if (!template) return
    setConfig({
      personality: { ...template.config.personality },
      speakingStyle: { ...template.config.speakingStyle, catchphrases: [...template.config.speakingStyle.catchphrases] },
      interactionPrefs: { ...template.config.interactionPrefs },
      schedule: template.config.schedule.map((s: SchedulePeriod) => ({ ...s })),
      systemPrompt: template.config.systemPrompt,
    })
  }, [])

  const handleSystemPromptChange = useCallback((prompt: string) => {
    setConfig((prev) => ({ ...prev, systemPrompt: prompt }))
  }, [])

  const handleSave = useCallback(() => {
    savePersonalityConfigOverride(currentCharacterId, config)
    setSavedTip(true)
    setTimeout(() => setSavedTip(false), 1200)
  }, [currentCharacterId, config])

  const handleReset = useCallback(() => {
    if (!character) return
    removePersonalityConfigOverride(currentCharacterId)
    setConfig(buildDefaultPersonalityConfig(character))
    setSavedTip(true)
    setTimeout(() => setSavedTip(false), 1200)
  }, [currentCharacterId, character])

  const handleSwitchChar = useCallback((id: string) => {
    useSettingsStore.getState().switchCharacter(id)
  }, [])

  if (!character) return null

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

      {/* 模板按钮 */}
      <TemplateButtons onApply={handleApplyTemplate} />

      {/* 雷达图 + 滑块 */}
      <div className="grid grid-cols-2 gap-4 rounded-xl bg-surface/50 p-4">
        <div>
          <div className="mb-2 text-center text-xs font-semibold text-amber-300">五维性格雷达图</div>
          <RadarChart personality={config.personality} />
        </div>
        <div className="flex flex-col justify-center">
          <PersonalitySliders personality={config.personality} onChange={handleSlider} />
        </div>
      </div>

      {/* 说话风格 */}
      <div className="rounded-xl bg-surface/50 p-4">
        <div className="mb-3 text-xs font-semibold text-amber-300">说话风格</div>
        <SpeakingStyleEditor style={config.speakingStyle} onChange={handleSpeakingStyle} />
      </div>

      {/* 互动偏好 */}
      <div className="rounded-xl bg-surface/50 p-4">
        <div className="mb-3 text-xs font-semibold text-amber-300">互动偏好</div>
        <InteractionPrefsEditor prefs={config.interactionPrefs} onChange={handleInteractionPrefs} />
      </div>

      {/* 作息时间 */}
      <div className="rounded-xl bg-surface/50 p-4">
        <div className="mb-3 flex items-center gap-1 text-xs font-semibold text-amber-300">
          <Clock size={14} /> 作息时间（0-24h）
        </div>
        <ScheduleEditor schedule={config.schedule} onChange={handleSchedule} />
      </div>

      {/* System Prompt 编辑 */}
      <div className="rounded-xl bg-surface/50 p-4">
        <div className="mb-2 text-xs font-semibold text-amber-300">System Prompt</div>
        <textarea
          value={config.systemPrompt}
          onChange={(e) => handleSystemPromptChange(e.target.value)}
          rows={4}
          className="w-full rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
        >
          保存配置
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-1 rounded-lg bg-surface px-3 py-2 text-sm text-ink hover:bg-cream-deep"
        >
          <RotateCcw size={14} /> 恢复默认
        </button>
        <button
          onClick={() => setShowPrompt(!showPrompt)}
          className="flex items-center gap-1 rounded-lg bg-surface px-3 py-2 text-sm text-ink hover:bg-cream-deep"
        >
          <Eye size={14} /> {showPrompt ? '隐藏' : '预览'}合成 Prompt
        </button>
      </div>

      {/* 合成 Prompt 预览 */}
      {showPrompt && (
        <div className="rounded-xl bg-surface p-4">
          <div className="mb-2 text-xs font-semibold text-amber-300">合成的性格 Prompt（由五维参数自动生成）</div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink">
            {composePersonalityPrompt(config.personality)}
          </pre>
        </div>
      )}

      {savedTip && (
        <div className="rounded-full bg-green-600 px-4 py-1.5 text-center text-sm">
          已保存 ✓
        </div>
      )}
    </div>
  )
}
