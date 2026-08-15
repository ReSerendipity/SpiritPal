/**
 * AI 辅助对话式创建角色向导组件
 *
 * 功能概述：
 * - 通过多步对话引导用户创建自定义宠物角色
 * - 流程：描述角色 → 口头禅 → 性格类型选择 → AI生成 → 预览微调 → 确认创建
 * - 支持五种性格原型：软萌、元气、毒舌、知性、傲娇
 * - 生成后提供五维性格参数滑块微调
 * - 自动从secureStorage读取API Key配置
 *
 * 核心Hooks/状态：
 * - useState: 管理当前步骤、用户输入、生成的角色配置、错误状态
 * - usePetStore: 添加自定义角色、切换角色、初始化角色
 *
 * 使用模块：
 * - llmClient: AI角色生成接口
 * - secureStorage: API Key安全存储
 * - personalityEngine: 五维性格标签定义
 */
import { useState } from 'react'
import { X, Send, Sparkles, Check, Loader2, Bot, User } from 'lucide-react'
import { usePetStore } from '../stores/petStore'
import { generateCharacterFromDescription, DEFAULT_AI_CONFIG } from '../lib/llmClient'
import { getApiKey } from '../lib/secureStorage'
import { PERSONALITY_LABELS } from '../lib/personalityEngine'
import type { AIConfig, CharacterProfile, Personality } from '../lib/types'

const AI_CONFIG_KEY = 'spiritpal-ai-config'

async function loadAIConfig(): Promise<AIConfig> {
  let config: AIConfig = DEFAULT_AI_CONFIG
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (raw) config = { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) }
  } catch {
    // 忽略解析错误
  }
  // apiKey 不在 localStorage 明文中，从 secureStorage 读取
  try {
    const apiKey = await getApiKey(config.provider)
    if (apiKey) config.apiKey = apiKey
  } catch {
    // 忽略 secureStorage 读取错误
  }
  return config
}

// 五种性格类型选项
const ARCHETYPE_OPTIONS = [
  { value: 'soft', label: '软萌', desc: '温柔可爱、治愈系' },
  { value: 'energetic', label: '元气', desc: '积极向上、充满活力' },
  { value: 'sharp', label: '毒舌', desc: '嘴硬心软、爱吐槽' },
  { value: 'intellectual', label: '知性', desc: '理性冷静、逻辑清晰' },
  { value: 'tsundere', label: '傲娇', desc: '外冷内热、别扭' },
] as const

type Step = 'description' | 'catchphrase' | 'archetype' | 'generating' | 'preview'

// 将 Partial<CharacterProfile> 填充为完整 CharacterProfile
function fillProfileDefaults(partial: Partial<CharacterProfile>): CharacterProfile {
  const id = partial.id ?? `custom-${Date.now().toString(36)}`
  const name = partial.name ?? '新角色'
  return {
    id,
    name,
    displayName: partial.displayName ?? name,
    source: 'AI 创建',
    birthBackground: partial.birthBackground ?? '由 AI 辅助创建的角色',
    emotionalCore: '',
    personality: partial.personality ?? {
      warmth: 0.5,
      liveliness: 0.5,
      dependence: 0.5,
      directness: 0,
      rationality: 0,
    },
    signaturePhrase: partial.signaturePhrase ?? '',
    classicQuotes: [],
    systemPrompt: partial.systemPrompt ?? `你是${name}，一个由 AI 创建的宠物角色。`,
    fewShotExamples: [],
    spriteAsset: '/pets/doro/spritesheet.webp',
    spriteType: 'atlas',
    themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
    bubbleMessages: {
      idle: [],
      hungry: [],
      sad: [],
      pet: [],
      feed: [],
      pomodoroDone: [],
    },
  }
}

/** 组件Props接口 */
interface Props {
  /** 关闭向导回调 */
  onClose: () => void
}

/**
 * AI对话式角色创建向导
 *
 * 五步式对话流程引导用户描述角色特征，调用LLM生成完整角色配置，
 * 支持预览后微调五维性格参数，最终确认创建并切换到新角色。
 */
export function CharacterCreationWizard({ onClose }: Props) {
  const addCustomCharacter = usePetStore((s) => s.addCustomCharacter)
  const switchCharacter = usePetStore((s) => s.switchCharacter)
  const initCharacter = usePetStore((s) => s.initCharacter)

  const [step, setStep] = useState<Step>('description')
  const [description, setDescription] = useState('')
  const [catchphrase, setCatchphrase] = useState('')
  const [archetype, setArchetype] = useState<string>('')
  const [profile, setProfile] = useState<CharacterProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')

  // 合成发送给 AI 的完整描述
  function buildFullDescription(archetypeOverride?: string): string {
    const effectiveArchetype = archetypeOverride ?? archetype
    const parts: string[] = []
    if (description) parts.push(`角色描述：${description}`)
    if (catchphrase) parts.push(`口头禅/标志性特征：${catchphrase}`)
    if (effectiveArchetype) {
      const opt = ARCHETYPE_OPTIONS.find((o) => o.value === effectiveArchetype)
      if (opt) parts.push(`性格偏向：${opt.label}（${opt.desc}）`)
    }
    return parts.join('\n')
  }

  // 调用 AI 生成角色配置
  async function handleGenerate(archetypeOverride?: string) {
    setStep('generating')
    setError(null)
    try {
      const config = await loadAIConfig()
      const fullDesc = buildFullDescription(archetypeOverride)
      const partial = await generateCharacterFromDescription(fullDesc, config)
      const full = fillProfileDefaults(partial)
      setProfile(full)
      setStep('preview')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      setError(`AI 生成失败：${msg}`)
      setStep('archetype')
    }
  }

  // 更新五维性格参数（滑块微调）
  function updatePersonality(key: keyof Personality, value: number) {
    if (!profile) return
    setProfile({
      ...profile,
      personality: { ...profile.personality, [key]: value },
    })
  }

  // 确认创建角色
  function handleConfirm() {
    if (!profile) return
    addCustomCharacter(profile)
    initCharacter(profile.id)
    switchCharacter(profile.id)
    onClose()
  }

  // 提交当前步骤的输入
  function handleSubmitCurrent() {
    const text = input.trim()
    if (!text) return
    if (step === 'description') {
      setDescription(text)
      setInput('')
      setStep('catchphrase')
    } else if (step === 'catchphrase') {
      setCatchphrase(text)
      setInput('')
      setStep('archetype')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (step === 'description' || step === 'catchphrase') {
        handleSubmitCurrent()
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[85vh] w-[640px] max-w-[90vw] flex-col rounded-2xl bg-gray-900 text-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-amber-400" />
            <h2 className="text-base font-semibold">AI 对话式创建角色</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-white/10"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* 对话区域 */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Step 1: 描述角色 */}
          <div className="flex gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
              <Bot size={14} className="text-amber-400" />
            </div>
            <div className="max-w-[80%] rounded-2xl bg-gray-800 px-3 py-2 text-sm">
              你想创建一个什么样的宠物？请描述它的性格、外观和背景。
            </div>
          </div>
          {description && (
            <div className="flex flex-row-reverse gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600">
                <User size={14} />
              </div>
              <div className="max-w-[80%] rounded-2xl bg-blue-600 px-3 py-2 text-sm">
                {description}
              </div>
            </div>
          )}

          {/* Step 2: 口头禅 */}
          {(step === 'catchphrase' || step === 'archetype' || step === 'generating' || step === 'preview') && (
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                <Bot size={14} className="text-amber-400" />
              </div>
              <div className="max-w-[80%] rounded-2xl bg-gray-800 px-3 py-2 text-sm">
                它有什么口头禅或标志性特征吗？
              </div>
            </div>
          )}
          {catchphrase && (
            <div className="flex flex-row-reverse gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600">
                <User size={14} />
              </div>
              <div className="max-w-[80%] rounded-2xl bg-blue-600 px-3 py-2 text-sm">
                {catchphrase}
              </div>
            </div>
          )}

          {/* Step 3: 性格类型 */}
          {(step === 'archetype' || step === 'generating' || step === 'preview') && (
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                <Bot size={14} className="text-amber-400" />
              </div>
              <div className="max-w-[80%] rounded-2xl bg-gray-800 px-3 py-2 text-sm">
                它的性格偏向哪种？软萌/元气/毒舌/知性/傲娇？
              </div>
            </div>
          )}
          {archetype && (step === 'generating' || step === 'preview') && (
            <div className="flex flex-row-reverse gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600">
                <User size={14} />
              </div>
              <div className="max-w-[80%] rounded-2xl bg-blue-600 px-3 py-2 text-sm">
                {ARCHETYPE_OPTIONS.find((o) => o.value === archetype)?.label}
              </div>
            </div>
          )}

          {/* 生成中 */}
          {step === 'generating' && (
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                <Bot size={14} className="text-amber-400" />
              </div>
              <div className="max-w-[80%] rounded-2xl bg-gray-800 px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  正在生成角色配置…
                </span>
              </div>
            </div>
          )}

          {/* 预览 */}
          {step === 'preview' && profile && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                  <Bot size={14} className="text-amber-400" />
                </div>
                <div className="max-w-[80%] rounded-2xl bg-gray-800 px-3 py-2 text-sm">
                  角色已生成！你可以微调五维参数后确认创建。
                </div>
              </div>

              {/* 角色预览卡片 */}
              <div className="rounded-xl border border-white/10 bg-gray-800/50 p-4">
                <div className="mb-3 flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                    style={{
                      background: `linear-gradient(135deg, ${profile.themeColor.primary}, ${profile.themeColor.secondary})`,
                    }}
                  >
                    {profile.displayName.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{profile.displayName}</div>
                    <div className="text-xs text-gray-400">{profile.signaturePhrase}</div>
                  </div>
                </div>
                <div className="mb-2 text-xs text-gray-400">背景：{profile.birthBackground}</div>
                <div className="mb-3 text-xs text-gray-400">
                  System Prompt：{profile.systemPrompt.slice(0, 100)}
                  {profile.systemPrompt.length > 100 ? '…' : ''}
                </div>

                {/* 五维参数滑块 */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-gray-300">五维性格参数（可微调）</div>
                  {(Object.keys(PERSONALITY_LABELS) as (keyof Personality)[]).map((key) => {
                    const label = PERSONALITY_LABELS[key]
                    const val = profile.personality[key]
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-12 text-xs text-gray-400">{label.label}</span>
                        <span className="w-10 text-[10px] text-gray-500">{label.min}</span>
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.1}
                          value={val}
                          onChange={(e) => updatePersonality(key, parseFloat(e.target.value))}
                          className="flex-1 accent-amber-400"
                        />
                        <span className="w-10 text-[10px] text-gray-500">{label.max}</span>
                        <span className="w-10 text-right text-xs text-amber-300">{val.toFixed(1)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
        </div>

        {/* 输入区域 */}
        <div className="border-t border-white/10 p-4">
          {step === 'description' && (
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="描述角色的性格、外观和背景…"
                rows={2}
                className="flex-1 resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
                autoFocus
              />
              <button
                onClick={handleSubmitCurrent}
                disabled={!input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-gray-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                title="发送"
              >
                <Send size={16} />
              </button>
            </div>
          )}

          {step === 'catchphrase' && (
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入口头禅或标志性特征…"
                rows={2}
                className="flex-1 resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
                autoFocus
              />
              <button
                onClick={handleSubmitCurrent}
                disabled={!input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-gray-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                title="发送"
              >
                <Send size={16} />
              </button>
            </div>
          )}

          {step === 'archetype' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {ARCHETYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setArchetype(opt.value)
                      void handleGenerate(opt.value)
                    }}
                    className={`rounded-lg border-2 px-3 py-2 text-sm transition-all ${
                      archetype === opt.value
                        ? 'border-amber-400 bg-amber-400/10'
                        : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-[10px] text-gray-400">{opt.desc}</div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setArchetype('')
                  void handleGenerate('')
                }}
                className="text-xs text-gray-500 hover:text-amber-400"
              >
                跳过，让 AI 自由发挥 →
              </button>
            </div>
          )}

          {step === 'generating' && (
            <div className="flex items-center justify-center py-2 text-xs text-gray-500">
              <Loader2 size={14} className="mr-2 animate-spin" />
              AI 正在生成角色配置…
            </div>
          )}

          {step === 'preview' && profile && (
            <div className="flex gap-2">
              <button
                onClick={() => setStep('description')}
                className="flex-1 rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
              >
                重新描述
              </button>
              <button
                onClick={() => void handleGenerate()}
                className="flex-1 rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
              >
                重新生成
              </button>
              <button
                onClick={handleConfirm}
                className="flex items-center justify-center gap-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
              >
                <Check size={16} /> 确认创建
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
