/**
 * 可视化角色创作工具组件
 *
 * 功能概述：
 * - 表单式角色编辑器，支持完整角色配置
 * - 五维性格参数雷达图可视化
 * - 性格模板一键应用（软萌/元气/毒舌/知性/傲娇等）
 * - SVG外观预览（根据主题色动态渲染）
 * - System Prompt自动生成与手动编辑
 * - 口头禅/经典语录管理
 * - 喜欢/讨厌物品配置
 * - 动画配置预设与自定义
 * - JSON格式角色导入/导出
 *
 * 核心Hooks/状态：
 * - useState: 管理角色配置、新增口头禅、动画预设、保存提示等
 * - useCallback/useMemo: 字段更新函数、物品池构建
 * - useRef: 文件输入引用
 * - usePetStore/useSettingsStore: 添加角色、切换角色
 *
 * 子组件：
 * - RadarChart: 五维性格雷达图（SVG绘制）
 * - AppearancePreview: SVG外观预览
 */
import { useState, useRef, useCallback, useMemo } from 'react'
import {
  X, Save, Download, Upload, Plus, Trash2, Sparkles,
  Palette, Bot, ThumbsDown, ThumbsUp, Film, FileJson, Check,
} from 'lucide-react'
import { usePetStore } from '../stores/petStore'
import { useSettingsStore } from '../stores/settingsStore'
import { PERSONALITY_LABELS } from '../lib/personalityEngine'
import { PERSONALITY_TEMPLATES } from '../lib/personalityTemplates'
import { FOODS_BY_CHARACTER, TOYS, MEDICINES } from '../lib/items'
import { ANIMATION_ROWS, ATLAS } from '../lib/types'
import type { CharacterProfile, Personality } from '../lib/types'

// ============ 五维雷达图（SVG）============
const DIM_KEYS: (keyof Personality)[] = ['warmth', 'liveliness', 'dependence', 'directness', 'rationality']

/**
 * 五维性格雷达图组件
 * 使用SVG绘制五维性格参数的可视化雷达图
 */
function RadarChart({ personality }: { personality: Personality }) {
  const size = 200
  const cx = size / 2
  const cy = size / 2
  const maxR = 72

  function angleOf(i: number): number {
    return -Math.PI / 2 + (i * 2 * Math.PI) / 5
  }
  function radiusOf(v: number): number {
    return ((v + 1) / 2) * maxR
  }
  function pointOf(i: number, v: number): { x: number; y: number } {
    const r = radiusOf(v)
    const a = angleOf(i)
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }
  function gridPath(level: number): string {
    const v = -1 + (level / 5) * 2
    const pts = DIM_KEYS.map((_, i) => {
      const p = pointOf(i, v)
      return `${p.x},${p.y}`
    })
    return `M ${pts.join(' L ')} Z`
  }

  const dataPoints = DIM_KEYS.map((key, i) => {
    const p = pointOf(i, personality[key])
    return `${p.x},${p.y}`
  })
  const dataPath = `M ${dataPoints.join(' L ')} Z`
  const axes = DIM_KEYS.map((_, i) => {
    const p = pointOf(i, 1)
    return { x1: cx, y1: cy, x2: p.x, y2: p.y }
  })
  const labels = DIM_KEYS.map((key, i) => {
    const p = pointOf(i, 1)
    const labelP = pointOf(i, 1.3)
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
      {[1, 2, 3, 4, 5].map((lv) => (
        <path key={lv} d={gridPath(lv)} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
      ))}
      {axes.map((a, i) => (
        <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
      ))}
      <path d={dataPath} fill="rgba(251,191,36,0.25)" stroke="rgb(251,191,36)" strokeWidth={2} />
      {DIM_KEYS.map((key, i) => {
        const p = pointOf(i, personality[key])
        return <circle key={key} cx={p.x} cy={p.y} r={3} fill="rgb(251,191,36)" />
      })}
      {labels.map((l) => (
        <text
          key={l.key}
          x={l.x}
          y={l.y}
          textAnchor={l.anchor as 'middle' | 'start' | 'end'}
          dominantBaseline="middle"
          className="fill-gray-300 text-[10px]"
        >
          {l.label}
        </text>
      ))}
      <circle cx={cx} cy={cy} r={2} fill="rgba(255,255,255,0.3)" />
    </svg>
  )
}

// ============ 外观预览（SVG 占位图）============
/**
 * 外观预览组件
 * 使用SVG绘制宠物简单外观预览，根据主题色渐变
 */
function AppearancePreview({
  emoji, name, primary, secondary,
}: {
  /** 推荐emoji */
  emoji: string
  /** 角色名称 */
  name: string
  /** 主题主色 */
  primary: string
  /** 主题副色 */
  secondary: string
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="120" height="120" viewBox="0 0 120 120" className="drop-shadow-lg">
        <defs>
          <radialGradient id="bodyGrad" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor={primary} />
            <stop offset="100%" stopColor={secondary} />
          </radialGradient>
        </defs>
        {/* 身体 */}
        <ellipse cx="60" cy="70" rx="42" ry="40" fill="url(#bodyGrad)" />
        {/* 头部高光 */}
        <ellipse cx="48" cy="50" rx="14" ry="10" fill="rgba(255,255,255,0.3)" />
        {/* 眼睛 */}
        <circle cx="46" cy="62" r="4" fill="#1a1a1a" />
        <circle cx="74" cy="62" r="4" fill="#1a1a1a" />
        <circle cx="47.5" cy="60.5" r="1.5" fill="#fff" />
        <circle cx="75.5" cy="60.5" r="1.5" fill="#fff" />
        {/* 腮红 */}
        <ellipse cx="38" cy="74" rx="6" ry="4" fill="rgba(255,100,100,0.4)" />
        <ellipse cx="82" cy="74" rx="6" ry="4" fill="rgba(255,100,100,0.4)" />
        {/* 嘴巴 */}
        <path d="M 54 82 Q 60 88 66 82" stroke="#1a1a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      <div className="text-2xl">{emoji}</div>
      <div className="text-sm font-medium text-gray-200">{name || '未命名角色'}</div>
    </div>
  )
}

// ============ 根据 personality 推荐一个 emoji ============
function recommendEmoji(p: Personality): string {
  if (p.warmth > 0.6 && p.dependence > 0.5) return '🐶'
  if (p.liveliness > 0.6) return '⚡'
  if (p.rationality > 0.6) return '🦉'
  if (p.directness > 0.6) return '🌶️'
  if (p.warmth < 0) return '🐧'
  return '🐱'
}

// ============ 可选物品池（用于喜好/讨厌选择）============
function buildItemPool() {
  const pool: { id: string; name: string; icon: string }[] = []
  const seen = new Set<string>()
  const collect = (items: typeof TOYS) => {
    items.forEach((i) => {
      if (!seen.has(i.id)) {
        seen.add(i.id)
        pool.push({ id: i.id, name: i.name, icon: i.icon })
      }
    })
  }
  Object.values(FOODS_BY_CHARACTER).forEach(collect)
  collect(TOYS)
  collect(MEDICINES)
  return pool
}

// ============ 动画配置选项 ============
const ANIMATION_PRESETS = [
  { id: 'default', label: '默认动画集（8列×9行）', desc: 'idle/walk/run-left/waving/jumping/failed/waiting/running/review' },
  { id: 'simple', label: '简单动画集', desc: '仅 idle / walk 两行' },
  { id: 'custom', label: '自定义', desc: '手动指定每行动画名' },
] as const

// 默认角色模板（用于初始化）
function createBlankProfile(): CharacterProfile {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: '',
    displayName: '',
    source: '可视化创建',
    birthBackground: '',
    emotionalCore: '',
    personality: { warmth: 0, liveliness: 0, dependence: 0, directness: 0, rationality: 0 },
    signaturePhrase: '',
    classicQuotes: [],
    systemPrompt: '',
    fewShotExamples: [],
    spriteAsset: '/pets/doro/spritesheet.webp',
    spriteType: 'atlas',
    themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
    bubbleMessages: { idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] },
    favoriteItems: [],
    dislikeItems: [],
  }
}

/** 组件Props接口 */
interface Props {
  /** 关闭编辑器回调 */
  onClose: () => void
}

/**
 * 可视化角色创作工具
 *
 * 提供完整的角色配置表单，包括基本信息、五维性格、主题色、
 * System Prompt、口头禅、喜好物品、动画配置等，支持JSON导入导出。
 */
export function CharacterCreator({ onClose }: Props) {
  const addCustomCharacter = usePetStore((s) => s.addCustomCharacter)
  const switchPetChar = usePetStore((s) => s.switchCharacter)
  const switchSettingsChar = useSettingsStore((s) => s.switchCharacter)

  const [profile, setProfile] = useState<CharacterProfile>(createBlankProfile)
  const [newPhrase, setNewPhrase] = useState('')
  const [animPreset, setAnimPreset] = useState<'default' | 'simple' | 'custom'>('default')
  const [customAnimRows, setCustomAnimRows] = useState<{ name: string; frames: number }[]>(
    Object.entries(ANIMATION_ROWS).map(([name, v]) => ({ name, frames: v.frames })),
  )
  const [savedTip, setSavedTip] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importOk, setImportOk] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const itemPool = useMemo(() => buildItemPool(), [])

  // ---- 字段更新辅助 ----
  const updateField = useCallback(<K extends keyof CharacterProfile>(key: K, value: CharacterProfile[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }, [])

  const updatePersonality = useCallback((key: keyof Personality, value: number) => {
    setProfile((prev) => ({ ...prev, personality: { ...prev.personality, [key]: value } }))
  }, [])

  const updateThemeColor = useCallback((which: 'primary' | 'secondary', color: string) => {
    setProfile((prev) => ({ ...prev, themeColor: { ...prev.themeColor, [which]: color } }))
  }, [])

  // ---- 口头禅管理 ----
  function addCatchphrase() {
    const t = newPhrase.trim()
    if (!t) return
    // CharacterProfile 没有 catchphrases 字段，使用 classicQuotes 承载口头禅
    updateField('classicQuotes', [...profile.classicQuotes, t])
    setNewPhrase('')
  }
  function removeCatchphrase(idx: number) {
    updateField('classicQuotes', profile.classicQuotes.filter((_, i) => i !== idx))
  }

  // ---- 应用性格模板 ----
  function applyTemplate(templateId: string) {
    const tpl = PERSONALITY_TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    setProfile((prev) => ({
      ...prev,
      personality: { ...tpl.config.personality },
      systemPrompt: tpl.config.systemPrompt,
    }))
  }

  // ---- 物品选择 ----
  function toggleItem(list: 'favoriteItems' | 'dislikeItems', itemId: string) {
    const current = profile[list] ?? []
    const next = current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId]
    updateField(list, next)
  }

  // ---- 自动生成 System Prompt ----
  function autoGeneratePrompt() {
    const p = profile.personality
    const labels: string[] = []
    DIM_KEYS.forEach((k) => {
      const info = PERSONALITY_LABELS[k]
      const v = p[k]
      if (v > 0.5) labels.push(info.max)
      else if (v < -0.5) labels.push(info.min)
    })
    const name = profile.displayName || profile.name || '宠物'
    const phrase = profile.signaturePhrase ? `你的标志性台词是"${profile.signaturePhrase}"。` : ''
    const traits = labels.length > 0 ? `你的性格特点：${labels.join('、')}。` : ''
    const prompt = `你是${name}，一个可爱的桌面宠物。${phrase}${traits}你会陪伴主人工作、学习和休息，主动关心主人的状态。请保持角色一致性，用符合性格的方式与主人交流。`
    updateField('systemPrompt', prompt)
  }

  // ---- 导出 JSON ----
  function handleExport() {
    const json = JSON.stringify(profile, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${profile.id || 'character'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---- 导入 JSON ----
  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as CharacterProfile
        if (!parsed.id || !parsed.name) {
          setError('无效的角色 JSON：缺少 id 或 name 字段')
          return
        }
        // 合并默认值，保证字段完整
        const merged = { ...createBlankProfile(), ...parsed }
        setProfile(merged)
        setError(null)
        setImportOk(true)
        setTimeout(() => setImportOk(false), 2000)
      } catch {
        setError('JSON 解析失败，请检查文件格式')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ---- 保存角色 ----
  function handleSave() {
    if (!profile.displayName?.trim() && !profile.name?.trim()) {
      setError('请填写角色名称')
      return
    }
    const finalProfile: CharacterProfile = {
      ...profile,
      name: profile.name || profile.displayName || `custom-${Date.now().toString(36)}`,
      displayName: profile.displayName || profile.name,
      id: profile.id || `custom-${Date.now().toString(36)}`,
    }
    addCustomCharacter(finalProfile)
    switchPetChar(finalProfile.id)
    switchSettingsChar(finalProfile.id)
    setSavedTip(true)
    setTimeout(() => {
      setSavedTip(false)
      onClose()
    }, 800)
  }

  const emoji = recommendEmoji(profile.personality)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[90vh] w-[860px] max-w-[95vw] flex-col rounded-2xl bg-gray-900 text-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-amber-400" />
            <h2 className="text-base font-semibold">可视化角色创作</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-white/10 hover:text-amber-300"
              title="导入角色 JSON"
            >
              <Upload size={14} /> 导入
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-white/10 hover:text-amber-300"
              title="导出角色 JSON"
            >
              <Download size={14} /> 导出
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-white/10" title="关闭">
              <X size={18} />
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* ===== 左列：基本信息 + 外观预览 ===== */}
            <div className="space-y-4">
              {/* 外观预览 */}
              <div className="rounded-xl bg-gray-800/50 p-4">
                <div className="mb-2 text-xs font-semibold text-amber-300">外观预览</div>
                <AppearancePreview
                  emoji={emoji}
                  name={profile.displayName || profile.name}
                  primary={profile.themeColor.primary}
                  secondary={profile.themeColor.secondary}
                />
                {/* 主题色 */}
                <div className="mt-3 flex gap-3">
                  <div className="flex items-center gap-2">
                    <Palette size={14} className="text-gray-400" />
                    <input
                      type="color"
                      value={profile.themeColor.primary}
                      onChange={(e) => updateThemeColor('primary', e.target.value)}
                      className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                    />
                    <span className="text-[10px] text-gray-400">主色</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={profile.themeColor.secondary}
                      onChange={(e) => updateThemeColor('secondary', e.target.value)}
                      className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                    />
                    <span className="text-[10px] text-gray-400">副色</span>
                  </div>
                </div>
              </div>

              {/* 基本信息 */}
              <div className="rounded-xl bg-gray-800/50 p-4">
                <div className="mb-3 text-xs font-semibold text-amber-300">基本信息</div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">角色名称</label>
                    <input
                      value={profile.displayName}
                      onChange={(e) => updateField('displayName', e.target.value)}
                      placeholder="例如：小花"
                      className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">角色 ID（英文，留空自动生成）</label>
                    <input
                      value={profile.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      placeholder="例如：xiaohua"
                      className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">描述 / 背景故事</label>
                    <textarea
                      value={profile.birthBackground}
                      onChange={(e) => updateField('birthBackground', e.target.value)}
                      placeholder="描述角色的来历、性格底色、世界观…"
                      rows={3}
                      className="w-full resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">标志符号 / 口头禅核心</label>
                    <input
                      value={profile.signaturePhrase}
                      onChange={(e) => updateField('signaturePhrase', e.target.value)}
                      placeholder="例如：欧润吉！"
                      className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                </div>
              </div>

              {/* 雷达图 */}
              <div className="rounded-xl bg-gray-800/50 p-4">
                <div className="mb-2 text-xs font-semibold text-amber-300">五维性格雷达图</div>
                <RadarChart personality={profile.personality} />
              </div>
            </div>

            {/* ===== 右列：性格参数 + Prompt + 物品 + 动画 ===== */}
            <div className="space-y-4">
              {/* 性格模板 + 滑块 */}
              <div className="rounded-xl bg-gray-800/50 p-4">
                <div className="mb-3 flex items-center gap-1 text-xs font-semibold text-amber-300">
                  <Sparkles size={14} /> 五维性格参数
                </div>
                {/* 模板按钮 */}
                <div className="mb-3 grid grid-cols-5 gap-1.5">
                  {PERSONALITY_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => applyTemplate(t.id)}
                      title={t.description}
                      className="flex flex-col items-center rounded-lg border border-white/10 px-1 py-1.5 transition-all hover:border-amber-400/50 hover:bg-white/5"
                    >
                      <span className="text-base">{t.emoji}</span>
                      <span className="text-[9px] text-gray-300">{t.name}</span>
                    </button>
                  ))}
                </div>
                {/* 滑块 */}
                <div className="space-y-2.5">
                  {DIM_KEYS.map((key) => {
                    const info = PERSONALITY_LABELS[key]
                    const val = profile.personality[key]
                    return (
                      <div key={key}>
                        <div className="mb-0.5 flex items-center justify-between">
                          <label className="text-xs text-gray-400">{info.label}</label>
                          <span className="text-[10px] text-gray-500">
                            {val < -0.1 ? info.min : val > 0.1 ? info.max : '中性'}
                            <span className="ml-1.5 tabular-nums text-amber-300">{val.toFixed(1)}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-8 text-right text-[9px] text-gray-500">{info.min}</span>
                          <input
                            type="range"
                            min={-1}
                            max={1}
                            step={0.1}
                            value={val}
                            onChange={(e) => updatePersonality(key, parseFloat(e.target.value))}
                            className="flex-1 accent-amber-400"
                          />
                          <span className="w-8 text-[9px] text-gray-500">{info.max}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 口头禅列表 */}
              <div className="rounded-xl bg-gray-800/50 p-4">
                <div className="mb-2 text-xs font-semibold text-amber-300">口头禅 / 经典语录</div>
                <div className="flex gap-2">
                  <input
                    value={newPhrase}
                    onChange={(e) => setNewPhrase(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addCatchphrase() }}
                    placeholder="输入口头禅后回车添加"
                    className="flex-1 rounded-lg bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                  <button
                    onClick={addCatchphrase}
                    className="flex items-center gap-1 rounded-lg bg-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-600"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {profile.classicQuotes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {profile.classicQuotes.map((q, idx) => (
                      <span
                        key={idx}
                        className="flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-xs text-amber-200"
                      >
                        {q}
                        <button
                          onClick={() => removeCatchphrase(idx)}
                          className="text-amber-300/60 hover:text-red-400"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* System Prompt */}
              <div className="rounded-xl bg-gray-800/50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold text-amber-300">System Prompt</div>
                  <button
                    onClick={autoGeneratePrompt}
                    className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-amber-300"
                  >
                    <Sparkles size={11} /> 自动生成
                  </button>
                </div>
                <textarea
                  value={profile.systemPrompt}
                  onChange={(e) => updateField('systemPrompt', e.target.value)}
                  rows={4}
                  placeholder="可手动输入或从模板选择后微调…"
                  className="w-full resize-none rounded-lg bg-gray-800 px-3 py-2 text-xs leading-relaxed text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
                <div className="mt-1.5 text-[10px] text-gray-500">
                  字数：{profile.systemPrompt.length}
                </div>
              </div>

              {/* 喜欢物品 / 讨厌物品 */}
              <div className="rounded-xl bg-gray-800/50 p-4">
                <div className="mb-2 text-xs font-semibold text-amber-300">喜欢 / 讨厌物品</div>
                <div className="mb-2 flex items-center gap-3 text-[10px]">
                  <span className="flex items-center gap-1 text-green-400"><ThumbsUp size={11} /> 喜欢物品 ×2.0</span>
                  <span className="flex items-center gap-1 text-red-400"><ThumbsDown size={11} /> 讨厌物品 ×0.5</span>
                </div>
                <div className="max-h-32 overflow-y-auto rounded-lg bg-gray-900/50 p-2">
                  <div className="flex flex-wrap gap-1">
                    {itemPool.map((item) => {
                      const isFav = profile.favoriteItems?.includes(item.id)
                      const isDis = profile.dislikeItems?.includes(item.id)
                      return (
                        <button
                          key={item.id}
                          onClick={() => toggleItem(isFav ? 'favoriteItems' : isDis ? 'dislikeItems' : 'favoriteItems', item.id)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            toggleItem('dislikeItems', item.id)
                          }}
                          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                            isFav
                              ? 'bg-green-500/30 text-green-200'
                              : isDis
                                ? 'bg-red-500/30 text-red-200'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          }`}
                          title="左键=喜欢，右键=讨厌"
                        >
                          <span>{item.icon}</span>
                          <span>{item.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="mt-1.5 text-[10px] text-gray-500">左键点击标记为喜欢，右键点击标记为讨厌，再次点击取消</div>
              </div>

              {/* 动画配置 */}
              <div className="rounded-xl bg-gray-800/50 p-4">
                <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-amber-300">
                  <Film size={14} /> 动画配置
                </div>
                <div className="space-y-2">
                  {ANIMATION_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setAnimPreset(p.id as 'default' | 'simple' | 'custom')}
                      className={`block w-full rounded-lg border px-3 py-2 text-left transition-all ${
                        animPreset === p.id
                          ? 'border-amber-400 bg-amber-400/10'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <div className="text-xs font-medium text-gray-200">{p.label}</div>
                      <div className="text-[10px] text-gray-500">{p.desc}</div>
                    </button>
                  ))}
                </div>

                {/* 自定义动画行编辑 */}
                {animPreset === 'custom' && (
                  <div className="mt-3 space-y-1.5">
                    <div className="text-[10px] text-gray-500">
                      单格尺寸 {ATLAS.cellW}×{ATLAS.cellH}，共 {ATLAS.cols} 列
                    </div>
                    {customAnimRows.map((row, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="w-6 text-[10px] text-gray-500">行{idx}</span>
                        <input
                          value={row.name}
                          onChange={(e) => {
                            const next = [...customAnimRows]
                            next[idx] = { ...next[idx], name: e.target.value }
                            setCustomAnimRows(next)
                          }}
                          className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs"
                        />
                        <input
                          type="number"
                          min={1}
                          max={ATLAS.cols}
                          value={row.frames}
                          onChange={(e) => {
                            const next = [...customAnimRows]
                            next[idx] = { ...next[idx], frames: parseInt(e.target.value) || 1 }
                            setCustomAnimRows(next)
                          }}
                          className="w-14 rounded bg-gray-800 px-2 py-1 text-xs"
                        />
                        <span className="text-[9px] text-gray-500">帧</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 精灵图资源路径 */}
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-gray-400">精灵图资源路径</label>
                  <input
                    value={profile.spriteAsset}
                    onChange={(e) => updateField('spriteAsset', e.target.value)}
                    placeholder="/pets/xxx/spritesheet.webp"
                    className="w-full rounded-lg bg-gray-800 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
          {importOk && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-900/30 px-3 py-2 text-xs text-green-300">
              <Check size={14} /> JSON 导入成功
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <FileJson size={12} />
            ID: {profile.id}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-5 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
            >
              <Save size={16} /> 保存角色
            </button>
          </div>
        </div>

        {savedTip && (
          <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-green-600 px-4 py-1.5 text-sm">
            已保存，正在切换到新角色… ✓
          </div>
        )}
      </div>
    </div>
  )
}
