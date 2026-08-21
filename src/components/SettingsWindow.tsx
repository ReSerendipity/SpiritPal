/**
 * 设置窗口组件
 *
 * 功能概述：
 * - 多标签页设置界面：AI配置、外观、性格编辑、养成、商店、背包、记忆、成就、排行榜、日程、模组、相册、数据、快捷控制、精灵图工具、社区、通用、关于
 * - AI配置：多LLM提供商选择、API Key安全存储、Ollama本地模型检测
 * - 外观设置：背景配置、宠物大小、语言切换
 * - 性格编辑：简单滑块版(PersonalityPanel)和高级可视化版(PersonalityEditor)
 * - 角色创建：AI对话向导(CharacterCreationWizard)、可视化编辑器(CharacterCreator)、GIF转精灵图工具
 * - 集成所有管理面板：NurturingPanel/ShopPanel/InventoryPanel/MemoryPanel/AchievementPanel等
 * - 开机自启动配置、通知设置、法律文档（隐私政策/用户协议）
 * - 窗口拖拽关闭、Tauri窗口管理
 * - API Key加密存储到系统Keychain
 * - analytics埋点追踪设置变更
 *
 * 核心Hooks/状态：
 * - useState: 当前标签页、AI配置、保存提示、Ollama状态、弹窗状态
 * - useRef: 跳过首次持久化引用
 * - useEffect: 加载AI配置、API Key、自动保存配置
 *
 * 使用模块：
 * - settingsStore/petStore: Zustand状态管理
 * - llmProviders/llmClient: LLM多提供商支持
 * - secureStorage: API Key加密存储
 * - Tauri API: 窗口管理、自启动插件
 */
import { useEffect, useRef, useState } from 'react'
import { appDataDir } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
X, Bot, Palette, Settings as SettingsIcon, Info,
Heart, ShoppingBag, Backpack, Brain, SlidersHorizontal, Trophy, Calendar, Package, Camera, Database, Sliders, Grid3x3, Activity, Sparkles, Users,
} from 'lucide-react'
import { enable, disable } from '@tauri-apps/plugin-autostart'
import { useSettingsStore } from '../stores/settingsStore'
import { validateUploadMagic } from '../lib/uploadMagic'
import { usePetStore } from '../stores/petStore'
import { switchPetForm } from '../lib/petForm'
import { getCharacter, getAllCharacters } from '../lib/characters'
import { LLM_PROVIDERS, getProvider, detectOllama, listOllamaModels } from '../lib/llmProviders'
import { DEFAULT_AI_CONFIG } from '../lib/llmClient'
import { setApiKey, getApiKey, deleteApiKey } from '../lib/secureStorage'
import { NurturingPanel } from './NurturingPanel'
import { ShopPanel } from './ShopPanel'
import { InventoryPanel } from './InventoryPanel'
import { MemoryPanel } from './MemoryPanel'
import { PersonalityPanel } from './PersonalityPanel'
import { PersonalityEditor } from './PersonalityEditor'
import { AchievementPanel } from './AchievementPanel'
import { SchedulePanel } from './SchedulePanel'
import { ModPanel } from './ModPanel'
import { AlbumPanel } from './AlbumPanel'
import { DataPanel } from './DataPanel'
import { QuickControlsPanel } from './QuickControlsPanel'
import { SpriteSheetPanel } from './SpriteSheetPanel'
import { CharacterCreationWizard } from './CharacterCreationWizard'
import { CharacterCreator } from './CharacterCreator'
import { GifToSpriteTool } from './GifToSpriteTool'
import { LegalDocument } from './LegalDocument'
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../lib/legalDocuments'
import { CommunityPanel } from './CommunityPanel'
import { DecorationEditor } from './DecorationEditor'
import { LeaderboardPanel } from './LeaderboardPanel'
import { WindowControls } from './WindowControls'
import { FramelessResizeHandles } from './FramelessChrome'
import { setLanguage as i18nSetLanguage } from '../lib/i18n'
import { windowEventBus } from '../lib/windowEventBus'
import { trackSettingChange, trackImageSwitch } from '../lib/analytics'
import type { AIConfig, AppSettings, BackgroundConfig, BackgroundType } from '../lib/types'

const selectUpdateSettings = (s: ReturnType<typeof useSettingsStore.getState>) => s.updateSettings
const selectSwitchSettingsChar = (s: ReturnType<typeof useSettingsStore.getState>) => s.switchCharacter
const selectSetLanguage = (s: ReturnType<typeof useSettingsStore.getState>) => s.setLanguage
const selectSwitchPetChar = (s: ReturnType<typeof usePetStore.getState>) => s.switchCharacter
const selectInitCharacter = (s: ReturnType<typeof usePetStore.getState>) => s.initCharacter
const selectBackground = (s: ReturnType<typeof usePetStore.getState>) => s.background
const selectSetBackground = (s: ReturnType<typeof usePetStore.getState>) => s.setBackground

type Tab = 'ai' | 'appearance' | 'personality' | 'personalityEditor' | 'nurturing' | 'shop' | 'inventory' | 'memory' | 'achievements' | 'leaderboard' | 'schedule' | 'mods' | 'album' | 'data' | 'quick' | 'sprite' | 'community' | 'general' | 'about'
type ToggleKey = 'autoStart' | 'startMinimized' | 'notifications' | 'showWindowBorder'

/** 侧边栏标签页定义（模块级常量，供跨窗口「打开指定标签页」事件校验使用） */
const TABS: { key: Tab; label: string; icon: typeof Bot }[] = [
  { key: 'ai', label: 'AI', icon: Bot },
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'personality', label: '性格', icon: SlidersHorizontal },
  { key: 'personalityEditor', label: '性格编辑', icon: Activity },
  { key: 'nurturing', label: '养成', icon: Heart },
  { key: 'shop', label: '商店', icon: ShoppingBag },
  { key: 'inventory', label: '背包', icon: Backpack },
  { key: 'memory', label: '记忆', icon: Brain },
  { key: 'achievements', label: '成就', icon: Trophy },
  { key: 'leaderboard', label: '排行', icon: Trophy },
  { key: 'schedule', label: '日程', icon: Calendar },
  { key: 'mods', label: '模组', icon: Package },
  { key: 'album', label: '相册', icon: Camera },
  { key: 'data', label: '数据', icon: Database },
  { key: 'quick', label: '快捷', icon: Sliders },
  { key: 'sprite', label: '精灵图', icon: Grid3x3 },
  { key: 'community', label: '社区', icon: Users },
  { key: 'general', label: '通用', icon: SettingsIcon },
  { key: 'about', label: '关于', icon: Info },
]

const AI_CONFIG_KEY = 'spiritpal-ai-config'

/**
 * 从localStorage加载AI配置
 * @returns 合并默认值后的AI配置
 */
function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (raw) return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) }
  } catch {
    // 忽略解析错误
  }
  return DEFAULT_AI_CONFIG
}

/**
 * 设置主窗口
 *
 * 集成所有设置面板和管理功能的Tab式设置界面。
 */
export default function SettingsWindow() {
  const settings = useSettingsStore()
  const updateSettings = useSettingsStore(selectUpdateSettings)
  const switchSettingsChar = useSettingsStore(selectSwitchSettingsChar)
  const setLanguage = useSettingsStore(selectSetLanguage)
  const switchPetChar = usePetStore(selectSwitchPetChar)
  const initCharacter = usePetStore(selectInitCharacter)
  const background = usePetStore(selectBackground)
  const setBackground = usePetStore(selectSetBackground)

  const [tab, setTab] = useState<Tab>('ai')
  const [ai, setAI] = useState<AIConfig>(loadAIConfig)
  const [savedTip, setSavedTip] = useState(false)
  // Ollama 本地服务检测状态与运行时模型列表
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle')
  // AI 创建角色向导
  const [showWizard, setShowWizard] = useState(false)
  // 可视化角色创作工具
  const [showCreator, setShowCreator] = useState(false)
  // GIF 转精灵图工具
  const [showGifTool, setShowGifTool] = useState(false)
  // 法律文档弹窗
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null)
  const [live2dCoreReady, setLive2dCoreReady] = useState(false)
  const [coreDir, setCoreDir] = useState('')
  const [pendingOverseasProvider, setPendingOverseasProvider] = useState<string | null>(null)
  const [rememberOverseas, setRememberOverseas] = useState(false)

  // 跨窗口「打开指定标签页」请求（如宠物右键菜单「换装」直达外观页）
  useEffect(() => {
    let unlisten: (() => void) | null = null
    void windowEventBus.on('open-settings-tab', (payload) => {
      if (TABS.some((t) => t.key === payload.tab)) {
        setTab(payload.tab as Tab)
      }
    }).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  // 检测 Live2D Cubism Core 是否已就绪（用户自装）
  useEffect(() => {
    const check = async () => {
      const win = window as unknown as { Live2DCubismCore?: unknown }
      setLive2dCoreReady(!!win.Live2DCubismCore)
      try {
        setCoreDir(await appDataDir())
      } catch {
        setCoreDir('')
      }
    }
    check()
    const t = setInterval(check, 5000)
    return () => clearInterval(t)
  }, [])

  // 跳过首次 localStorage 持久化，避免覆盖旧 apiKey（待 secureStorage 迁移读取）
  const skipFirstPersistRef = useRef(true)
  // 跳过 secureStorage 自动保存（加载时设为 true，避免回写覆盖）
  const skipNextSaveRef = useRef(true)

  // AI 配置变更时持久化（不含 API Key — API Key 由 secureStorage 管理）
  useEffect(() => {
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false
      return
    }
    try {
      const { apiKey: _k, ...rest } = ai
      void _k // 避免未使用变量告警
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(rest))
    } catch {
      // 忽略存储错误
    }
  }, [ai])

  // 加载 API Key：从 secureStorage 读取；首次升级时从 localStorage 迁移
  useEffect(() => {
    const currentProvider = ai.provider
    let cancelled = false

    async function loadApiKeyForProvider() {
      try {
        let key = await getApiKey(currentProvider)

        // 兼容旧数据：secureStorage 中没有时，尝试从 localStorage 读取并迁移
        if (key === null) {
          try {
            const raw = localStorage.getItem(AI_CONFIG_KEY)
            if (raw) {
              const config = JSON.parse(raw)
              if (config.apiKey) {
                await setApiKey(currentProvider, config.apiKey)
                key = config.apiKey as string
                console.log(`[SpiritPal] Migrated API key for ${currentProvider} to secureStorage`)
              }
            }
          } catch {
            // 忽略迁移错误
          }
        }

        if (!cancelled) {
          skipNextSaveRef.current = true
          setAI(prev => ({ ...prev, apiKey: key ?? '' }))
        }
      } catch {
        // 加载失败，保持空 apiKey
      }
    }

    loadApiKeyForProvider()
    return () => { cancelled = true }
  }, [ai.provider])

  // API Key 变更时保存到 secureStorage（加载时跳过，避免回写覆盖）
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    const provider = ai.provider
    const key = ai.apiKey
    if (key) {
      setApiKey(provider, key).catch(() => {
        // 忽略存储错误
      })
    } else {
      deleteApiKey(provider).catch(() => {
        // 忽略删除错误
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 apiKey 变化时保存；若加入 ai.provider，切换 provider 时会把旧 provider 的 key 误写到新 provider
  }, [ai.apiKey])

  // 初始化时同步 i18n 语言
  useEffect(() => {
    i18nSetLanguage(settings.language)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc 键关闭窗口（无障碍键盘导航）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const OVERSEAS_PROVIDERS = new Set(['openai', 'claude', 'gemini'])

  function handleProviderChange(providerId: string) {
    // 数据出境确认：境外服务商（OpenAI / Claude / Gemini）切换前需用户确认
    // 已"记住选择"的服务商直接通过
    if (OVERSEAS_PROVIDERS.has(providerId) && providerId !== ai.provider) {
      try {
        if (localStorage.getItem(`spiritpal:overseas-consent:${providerId}`)) {
          applyProvider(providerId)
          return
        }
      } catch { /* localStorage 不可用时走确认流程 */ }
      setPendingOverseasProvider(providerId)
      return
    }
    applyProvider(providerId)
  }

  function applyProvider(providerId: string) {
    const p = getProvider(providerId)
    trackSettingChange('provider', ai.provider, providerId)
    setAI((prev) => ({
      ...prev,
      provider: providerId,
      baseUrl: p?.baseUrl ?? prev.baseUrl,
      model: p?.defaultModel ?? prev.model,
    }))
    // 切换到 Ollama 时重置检测状态
    if (providerId !== 'ollama') {
      setOllamaStatus('idle')
      setOllamaModels([])
    }
  }

  // 检测本地 Ollama 服务并拉取可用模型列表
  async function handleDetectOllama() {
    setOllamaStatus('checking')
    const online = await detectOllama()
    if (online) {
      const models = await listOllamaModels()
      setOllamaModels(models)
      setOllamaStatus('online')
      // 若当前未选模型且拉取到了模型，默认选第一个
      if (models.length > 0 && !ai.model) {
        setAI((prev) => ({ ...prev, model: models[0] }))
      }
    } else {
      setOllamaModels([])
      setOllamaStatus('offline')
    }
  }

  function handleSwitchCharacter(id: string) {
    trackImageSwitch(settings.currentCharacterId, id)
    initCharacter(id)
    switchPetChar(id)
    switchSettingsChar(id)
  }

  // 开机自启切换——实际调用 autostart 插件
  async function handleAutoStartToggle(enabled: boolean) {
    try {
      if (enabled) {
        await enable()
      } else {
        await disable()
      }
    } catch {
      // 插件调用失败时静默忽略（开发环境下可能不可用）
    }
    updateSettings({ autoStart: enabled })
    trackSettingChange('autoStart', !enabled, enabled)
  }

  // 语言切换——同步 i18n
  function handleLanguageChange(lang: 'zh' | 'en' | 'ja' | 'ko' | 'zh-TW') {
    trackSettingChange('language', settings.language, lang)
    i18nSetLanguage(lang)
    setLanguage(lang)
  }

  async function handleClose() {
    try {
      await getCurrentWindow().hide()
    } catch {
      // 忽略窗口操作错误
    }
  }

  function flashSaved() {
    setSavedTip(true)
    setTimeout(() => setSavedTip(false), 1200)
  }

  // 背景图片选择——读取为 data URL 以持久化
  async function handleBackgroundImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // [SECURITY] 魔数校验：叠加 Rust 端纵深防御，阻断伪装图片（未知扩展名如 svg/avif 跳过）
    const magicError = await validateUploadMagic(file)
    if (magicError) {
      alert(magicError)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setBackground({ type: 'image', imagePath: reader.result as string })
    }
    reader.readAsDataURL(file)
  }

  function handleBackgroundTypeChange(type: BackgroundType) {
    const defaults: Record<BackgroundType, BackgroundConfig> = {
      none: { type: 'none' },
      solid: { type: 'solid', color: '#1a1a2e' },
      gradient: { type: 'gradient', color: '#667eea', color2: '#764ba2', direction: 'to bottom' },
      image: { type: 'image' },
    }
    setBackground({ ...defaults[type], imagePath: type === 'image' ? background.imagePath : undefined })
  }

  const character = getCharacter(settings.currentCharacterId)

  return (
    <div className="flex h-full w-full flex-col bg-cream text-ink">
      {/* 无边框窗口标题栏 */}
      <div className="relative z-50 shrink-0">
        <WindowControls title="SpiritPal 设置" onClose={handleClose} />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 侧边栏 */}
      <div className="flex w-40 flex-col overflow-y-auto border-r border-ink/10 bg-cream-deep/60 p-3">
        <div className="mb-4 px-2 text-sm font-bold text-tangerine-deep">SpiritPal 设置</div>
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              aria-label={`${t.label} 标签页`}
              className={`spiritpal-focusable mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                tab === t.key
                  ? 'bg-tangerine text-white'
                  : 'text-ink-muted hover:bg-ink/5'
              }`}
            >
              <Icon size={16} aria-hidden="true" /> {t.label}
            </button>
          )
        })}
        <button
          onClick={handleClose}
          aria-label="关闭设置窗口"
          className="spiritpal-focusable mt-auto flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm text-ink-muted hover:bg-cream-deep"
        >
          <X size={16} aria-hidden="true" /> 关闭
        </button>
      </div>

      {/* 内容区 */}
      <div className="relative flex-1 overflow-y-auto p-6">
        {tab === 'ai' && (
          <div className="max-w-md space-y-4">
            <h2 className="text-lg font-semibold">AI 配置</h2>

            <div>
              <label className="mb-1 block text-xs text-ink-faint">服务商</label>
              <select
                value={ai.provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
              >
                {LLM_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key：Ollama 不需要，其余服务商显示 */}
            {getProvider(ai.provider)?.apiKeyRequired !== false && (
              <div>
                <label className="mb-1 block text-xs text-ink-faint">API Key</label>
                <input
                  type="password"
                  value={ai.apiKey}
                  onChange={(e) => setAI({ ...ai, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
                />
              </div>
            )}

            {/* Ollama 本地服务检测 */}
            {ai.provider === 'ollama' && (
              <div className="space-y-2 rounded-lg bg-cream-deep/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-faint">Ollama 本地服务</span>
                  <button
                    onClick={handleDetectOllama}
                    disabled={ollamaStatus === 'checking'}
                    className="rounded-lg bg-tangerine px-3 py-1 text-xs font-medium text-white hover:bg-tangerine-deep disabled:opacity-50"
                  >
                    {ollamaStatus === 'checking' ? '检测中…' : '检测服务'}
                  </button>
                </div>
                {ollamaStatus === 'online' && (
                  <div className="text-xs text-success-deep">
                    ● 已连接 — 共 {ollamaModels.length} 个可用模型
                  </div>
                )}
                {ollamaStatus === 'offline' && (
                  <div className="text-xs text-red-400">
                    ● 未检测到 Ollama 服务，请确认已启动 ollama serve（默认端口 11434）
                  </div>
                )}
                {ollamaStatus === 'idle' && (
                  <div className="text-xs text-ink-faint">
                    点击「检测服务」从本地 Ollama 拉取已安装的模型列表
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-ink-faint">接口地址</label>
              <input
                value={ai.baseUrl}
                onChange={(e) => setAI({ ...ai, baseUrl: e.target.value })}
                className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-ink-faint">模型</label>
              {/* Ollama：优先使用运行时拉取的模型列表，其次回退到预设模型 */}
              {ai.provider === 'ollama' && ollamaModels.length > 0 ? (
                <select
                  value={ai.model}
                  onChange={(e) => setAI({ ...ai, model: e.target.value })}
                  className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
                >
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : getProvider(ai.provider)?.models.length ? (
                <select
                  value={ai.model}
                  onChange={(e) => setAI({ ...ai, model: e.target.value })}
                  className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
                >
                  {getProvider(ai.provider)!.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={ai.model}
                  onChange={(e) => setAI({ ...ai, model: e.target.value })}
                  placeholder="model-name"
                  className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
                />
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-ink-faint">
                温度：{ai.temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={ai.temperature}
                onChange={(e) => setAI({ ...ai, temperature: parseFloat(e.target.value) })}
                className="w-full accent-tangerine"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-ink-faint">最大 Token</label>
              <input
                type="number"
                min={64}
                max={8192}
                value={ai.maxTokens}
                onChange={(e) => setAI({ ...ai, maxTokens: parseInt(e.target.value) || 1024 })}
                className="w-full rounded-lg bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
              />
            </div>

            <button
              onClick={flashSaved}
              aria-label="保存 AI 配置"
              className="spiritpal-focusable rounded-lg bg-tangerine px-4 py-2 text-sm font-medium text-white hover:bg-tangerine-deep"
            >
              保存
            </button>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="max-w-md space-y-6">
            <h2 className="text-lg font-semibold">外观</h2>

            <div>
              <label className="mb-1 block text-xs text-ink-faint">
                宠物大小：{settings.petSize.toFixed(1)}×
              </label>
              <input
                type="range"
                min={0.5}
                max={3.0}
                step={0.1}
                value={settings.petSize}
                onChange={(e) => updateSettings({ petSize: parseFloat(e.target.value) })}
                className="w-full accent-tangerine"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-ink-faint">
                宠物透明度：{Math.round(settings.petOpacity * 100)}%
              </label>
              <input
                type="range"
                min={0.3}
                max={1.0}
                step={0.05}
                value={settings.petOpacity}
                onChange={(e) => updateSettings({ petOpacity: parseFloat(e.target.value) })}
                className="w-full accent-tangerine"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs text-ink-faint">当前角色</label>
              <div className="flex gap-2 flex-wrap">
                {getAllCharacters().map((c) => {
                  const active = c.id === settings.currentCharacterId
                  return (
                    <button
                      key={c.id}
                      onClick={() => handleSwitchCharacter(c.id)}
                      className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm transition-all ${
                        active ? 'border-tangerine bg-tangerine/10' : 'border-ink/10 hover:border-ink/30'
                      }`}
                    >
                      <div
                        className="mx-auto mb-1 h-6 w-6 rounded-full"
                        style={{
                          background: `linear-gradient(135deg, ${c.themeColor.primary}, ${c.themeColor.secondary})`,
                        }}
                      />
                      {c.displayName}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setShowCreator(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-tangerine/40 px-3 py-2 text-sm text-tangerine-deep hover:bg-tangerine/10"
                >
                  <Bot size={14} /> 创建新角色
                </button>
                <button
                  onClick={() => setShowWizard(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-tangerine/40 px-3 py-2 text-sm text-tangerine-deep hover:bg-tangerine/10"
                >
                  <Sparkles size={14} /> AI 创建角色
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-ink-faint">主题色预览</label>
              <div className="flex gap-2">
                <div
                  className="h-10 flex-1 rounded-lg"
                  style={{ background: character?.themeColor.primary }}
                />
                <div
                  className="h-10 flex-1 rounded-lg"
                  style={{ background: character?.themeColor.secondary }}
                />
              </div>
            </div>

            {/* 背景自定义 */}
            <div>
              <label className="mb-2 block text-xs text-ink-faint">背景</label>
              <div className="space-y-3 rounded-lg bg-cream-deep/50 p-3">
                {/* 背景类型选择 */}
                <div className="flex gap-1 rounded-lg bg-cream-deep p-1">
                  {([
                    { type: 'none', label: '无' },
                    { type: 'solid', label: '纯色' },
                    { type: 'gradient', label: '渐变' },
                    { type: 'image', label: '图片' },
                  ] as { type: BackgroundType; label: string }[]).map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => handleBackgroundTypeChange(opt.type)}
                      className={`flex-1 rounded-md px-2 py-1 text-xs transition-colors ${
                        background.type === opt.type
                          ? 'bg-tangerine text-white'
                          : 'text-ink-muted hover:bg-ink/20'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 纯色背景 */}
                {background.type === 'solid' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-faint">颜色</span>
                    <input
                      type="color"
                      value={background.color ?? '#1a1a2e'}
                      onChange={(e) => setBackground({ ...background, color: e.target.value })}
                      className="h-8 w-12 cursor-pointer rounded border border-ink/10 bg-transparent"
                    />
                    <span className="text-xs text-ink-faint">{background.color}</span>
                  </div>
                )}

                {/* 渐变背景 */}
                {background.type === 'gradient' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-faint">颜色1</span>
                      <input
                        type="color"
                        value={background.color ?? '#667eea'}
                        onChange={(e) => setBackground({ ...background, color: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded border border-ink/10 bg-transparent"
                      />
                      <span className="text-xs text-ink-faint">颜色2</span>
                      <input
                        type="color"
                        value={background.color2 ?? '#764ba2'}
                        onChange={(e) => setBackground({ ...background, color2: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded border border-ink/10 bg-transparent"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-faint">方向</span>
                      <select
                        value={background.direction ?? 'to bottom'}
                        onChange={(e) => setBackground({ ...background, direction: e.target.value })}
                        className="flex-1 rounded-lg bg-surface px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tangerine"
                      >
                        <option value="to top">向上</option>
                        <option value="to bottom">向下</option>
                        <option value="to left">向左</option>
                        <option value="to right">向右</option>
                        <option value="to top right">右上</option>
                        <option value="to bottom right">右下</option>
                        <option value="to top left">左上</option>
                        <option value="to bottom left">左下</option>
                        <option value="45deg">45°</option>
                        <option value="135deg">135°</option>
                      </select>
                    </div>
                    {/* 渐变预览 */}
                    <div
                      className="h-8 w-full rounded-lg"
                      style={{
                        background: `linear-gradient(${background.direction ?? 'to bottom'}, ${background.color ?? '#667eea'}, ${background.color2 ?? '#764ba2'})`,
                      }}
                    />
                  </div>
                )}

                {/* 图片背景 */}
                {background.type === 'image' && (
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleBackgroundImageSelect}
                      className="w-full text-xs text-ink-muted file:mr-2 file:rounded file:border-0 file:bg-tangerine file:px-2 file:py-1 file:text-xs file:text-white hover:file:bg-tangerine"
                    />
                    {background.imagePath && (
                      <div className="relative">
                        <img
                          src={background.imagePath}
                          alt="背景预览"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                        <button
                          onClick={() => setBackground({ type: 'image' })}
                          className="absolute right-1 top-1 rounded bg-ink/60 px-1.5 py-0.5 text-xs text-white hover:bg-ink/80"
                        >
                          清除
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* 装饰品管理 */}
            <DecorationEditor />
          </div>
        )}

        {tab === 'personality' && (
          <div className="max-w-md">
            <h2 className="mb-4 text-lg font-semibold">性格配置</h2>
            <PersonalityPanel />
          </div>
        )}

        {tab === 'personalityEditor' && (
          <div className="max-w-2xl">
            <h2 className="mb-4 text-lg font-semibold">性格可视化编辑器</h2>
            <div className="mb-3 text-xs text-ink-faint">
              五维雷达图 · 说话风格 · 互动偏好 · 作息时间 · 预设模板，一键应用并可微调
            </div>
            <PersonalityEditor />
          </div>
        )}

        {tab === 'nurturing' && (
          <div className="max-w-md">
            <h2 className="mb-4 text-lg font-semibold">养成</h2>
            <NurturingPanel />
          </div>
        )}

        {tab === 'shop' && (
          <div className="max-w-md">
            <h2 className="mb-4 text-lg font-semibold">商店</h2>
            <ShopPanel />
          </div>
        )}

        {tab === 'inventory' && (
          <div className="max-w-md">
            <h2 className="mb-4 text-lg font-semibold">背包</h2>
            <InventoryPanel />
          </div>
        )}

        {tab === 'memory' && (
          <div className="max-w-md">
            <h2 className="mb-4 text-lg font-semibold">记忆管理</h2>
            <MemoryPanel />
          </div>
        )}

        {tab === 'achievements' && (
          <div className="max-w-md">
            <h2 className="mb-4 text-lg font-semibold">成就</h2>
            <AchievementPanel />
          </div>
        )}

        {tab === 'leaderboard' && (
          <div className="max-w-md">
            <h2 className="mb-4 text-lg font-semibold">排行榜</h2>
            <LeaderboardPanel />
          </div>
        )}

        {tab === 'schedule' && (
          <div className="max-w-md">
            <h2 className="mb-4 text-lg font-semibold">日程管理</h2>
            <SchedulePanel />
          </div>
        )}

        {tab === 'mods' && (
          <div className="max-w-2xl">
            <h2 className="mb-4 text-lg font-semibold">模组管理</h2>
            <ModPanel />
          </div>
        )}

        {tab === 'album' && (
          <div className="max-w-2xl">
            <h2 className="mb-4 text-lg font-semibold">宠物相册</h2>
            <AlbumPanel />
          </div>
        )}

        {tab === 'data' && (
          <div className="max-w-2xl">
            <h2 className="mb-4 text-lg font-semibold">数据管理</h2>
            <DataPanel />
          </div>
        )}

        {tab === 'quick' && (
          <div className="max-w-2xl">
            <h2 className="mb-4 text-lg font-semibold">快捷控制</h2>
            <QuickControlsPanel />
          </div>
        )}

        {tab === 'sprite' && (
          <div className="max-w-2xl">
            <h2 className="mb-4 text-lg font-semibold">精灵图工具</h2>
            <div className="mb-3 flex gap-2">
              <button
                onClick={() => setShowGifTool(true)}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-tangerine/40 px-3 py-2 text-sm text-tangerine-deep hover:bg-tangerine/10"
              >
                <Grid3x3 size={14} /> GIF 转精灵图
              </button>
            </div>
            <div className="mb-2 text-xs text-ink-faint">
              将 GIF / 视频 / 图片转换为精灵图集，支持自定义行列数与帧尺寸，导出 PNG + JSON 元数据
            </div>
            <SpriteSheetPanel />
          </div>
        )}

        {tab === 'community' && (
          <div className="max-w-4xl">
            <h2 className="mb-1 text-lg font-semibold">社区形象</h2>
            <div className="mb-4 text-xs text-ink-faint">
              功能尚未完善，敬请期待后续版本。
            </div>
            <CommunityPanel />
          </div>
        )}

        {tab === 'general' && (
          <div className="max-w-md space-y-5">
            <h2 className="text-lg font-semibold">通用</h2>

            {([
              { key: 'autoStart', label: '开机自启' },
              { key: 'startMinimized', label: '启动时最小化' },
              { key: 'notifications', label: '通知' },
              { key: 'showWindowBorder', label: '窗口边框预览（调试）' },
            ] as { key: ToggleKey; label: string }[]).map((item) => (
              <div key={item.key} className="flex items-center justify-between">
                <span className="text-sm">{item.label}</span>
                <button
                  onClick={() => {
                    if (item.key === 'autoStart') {
                      handleAutoStartToggle(!settings[item.key])
                    } else {
                      updateSettings({ [item.key]: !settings[item.key] } as Partial<AppSettings>)
                    }
                  }}
                  role="switch"
                  aria-checked={settings[item.key]}
                  aria-label={item.label}
                  className={`spiritpal-focusable relative h-6 w-11 rounded-full transition-colors ${
                    settings[item.key] ? 'bg-tangerine' : 'bg-ink/20'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      settings[item.key] ? 'left-5' : 'left-0.5'
                    }`}
                    aria-hidden="true"
                  />
                </button>
              </div>
            ))}

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">界面形态</span>
                <div className="text-xs text-ink-faint">窗口形态 / 桌面漫游</div>
              </div>
              <div className="flex gap-1 rounded-lg bg-cream-deep p-1">
                {(['window', 'roam'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => void switchPetForm(f)}
                    aria-pressed={settings.petForm === f}
                    aria-label={f === 'window' ? '窗口形态' : '桌面漫游形态'}
                    className={`rounded-md px-3 py-1 text-xs transition-colors ${
                      settings.petForm === f ? 'bg-tangerine text-white' : 'text-ink-muted hover:bg-ink/8'
                    }`}
                  >
                    {f === 'window' ? '窗口' : '漫游'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">全局快捷键</span>
                <div className="text-xs text-ink-faint">切换宠物窗口显隐</div>
              </div>
              <kbd className="rounded-lg bg-surface px-3 py-1.5 text-sm font-mono text-tangerine-deep">
                Ctrl+Shift+P
              </kbd>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">语言</span>
              <select
                value={settings.language}
                onChange={(e) => handleLanguageChange(e.target.value as 'zh' | 'en' | 'ja' | 'ko' | 'zh-TW')}
                className="rounded-lg bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
              >
                <option value="zh">中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </div>
          </div>
        )}

        {tab === 'about' && (
          <div className="max-w-md space-y-4">
            <h2 className="text-lg font-semibold">关于</h2>
            <div className="rounded-xl bg-surface p-4">
              <div className="mb-2 text-2xl">🐾 SpiritPal 桌宠</div>
              <div className="text-sm text-ink-faint">版本：0.1.0</div>
              <div className="mt-2 text-sm text-ink-muted">
                一款基于 Tauri v2 的桌面宠物应用，支持多角色养成、AI 对话、记忆系统与番茄钟。
              </div>
            </div>
            <div className="rounded-xl bg-surface p-4">
              <div className="mb-2 text-sm font-semibold text-tangerine-deep">关注我们</div>
              <div className="flex flex-wrap gap-2 text-sm">
                <a
                  href="https://github.com/ReSerendipity/SpiritPal"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
                  title="GitHub 仓库"
                >
                  GitHub
                </a>
                <a
                  href="https://www.xiaohongshu.com/user/profile/6a606c140000000010000801"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
                  title="小红书"
                >
                  小红书
                </a>
                <a
                  href="https://v.douyin.com/eJgZfhanu4I/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
                  title="抖音"
                >
                  抖音
                </a>
                <a
                  href="https://www.kuaishou.com/profile/3x2sk6hj48i2mhs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
                  title="快手"
                >
                  快手
                </a>
                <a
                  href="https://space.bilibili.com/499527473"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
                  title="B站"
                >
                  B站
                </a>
              </div>
            </div>
            <div className="rounded-xl bg-surface p-4 text-sm text-ink-muted">
              <div className="mb-1 font-semibold text-tangerine-deep">角色列表</div>
              {getAllCharacters().map((c) => (
                <div key={c.id} className="mb-1">
                  <span style={{ color: c.themeColor.primary }}>●</span> {c.displayName} — {c.source}
                </div>
              ))}
            </div>
            {/* Live2D 使用指引 */}
            <div className="rounded-xl bg-surface p-4">
              <div className="mb-2 text-sm font-semibold text-tangerine-deep">Live2D</div>
              <div className="mb-2 text-xs">
                {live2dCoreReady ? (
                  <span className="text-green-600">● Cubism Core 已就绪，Live2D 可用</span>
                ) : (
                  <span className="text-amber-600">● Cubism Core 未安装，当前使用精灵图模式</span>
                )}
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-muted">
                <li>打开 Live2D 官网，下载「Cubism SDK for Web」：</li>
              </ol>
              <a
                href="https://www.live2d.com/zh-CHS/sdk/download/"
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-tangerine-deep underline decoration-dotted underline-offset-4"
              >
                https://www.live2d.com/zh-CHS/sdk/download/
              </a>
              <ol className="list-decimal space-y-1 pl-4 pt-1 text-xs text-ink-muted" start={2}>
                <li>解压 SDK，找到 <code className="rounded bg-cream-deep px-1">Core/live2dcubismcore.js</code>；</li>
                <li>将其复制到应用数据目录（下方路径）后重启应用：</li>
              </ol>
              <div className="mt-1 break-all rounded bg-cream-deep p-2 font-mono text-[10px] text-ink-faint">
                {coreDir || '（获取路径中…）'}
              </div>
              <div className="mt-1 text-[10px] text-ink-faint">
                最终文件应为：{coreDir ? `${coreDir}live2dcubismcore.js` : '…/live2dcubismcore.js'}
              </div>
              <button
                onClick={async () => {
                  try {
                    const { invoke } = await import('@tauri-apps/api/core')
                    await invoke('open_path', { path: coreDir })
                  } catch { /* 平台不支持时忽略 */ }
                }}
                className="mt-2 rounded-lg bg-cream-deep px-3 py-1.5 text-xs text-ink-muted hover:bg-ink/5"
              >
                打开应用数据目录
              </button>
            </div>
            {/* 法律文档链接 */}
            <div className="rounded-xl bg-surface p-4">
              <div className="mb-2 text-sm font-semibold text-tangerine-deep">法律信息</div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setLegalDoc('privacy')}
                  className="text-left text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-tangerine-deep"
                >
                  隐私政策
                </button>
                <button
                  onClick={() => setLegalDoc('terms')}
                  className="text-left text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-tangerine-deep"
                >
                  用户协议
                </button>
              </div>
            </div>
            <div className="text-xs text-ink-faint">
              技术栈：React 19 · TypeScript · Tailwind CSS v4 · Tauri v2 · Zustand
            </div>
          </div>
        )}

        {pendingOverseasProvider && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="mx-4 max-w-sm rounded-2xl bg-surface p-5 shadow-xl">
              <div className="mb-2 text-base font-semibold">数据出境确认</div>
              <p className="mb-4 text-sm text-ink-muted">
                你选择的 {getProvider(pendingOverseasProvider)?.name ?? '服务商'} 位于境外，
                使用后对话内容将传输至境外服务器。请勿输入敏感个人信息。
                是否继续？
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPendingOverseasProvider(null)}
                  className="rounded-lg bg-cream-deep px-4 py-2 text-sm text-ink-muted hover:bg-ink/5"
                >
                  取消
                </button>
                <label className="mb-3 flex items-center gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={rememberOverseas}
                    onChange={(e) => setRememberOverseas(e.target.checked)}
                    className="accent-tangerine"
                  />
                  记住我的选择（下次不再询问）
                </label>
                <button
                  onClick={() => {
                    if (rememberOverseas) {
                      try {
                        localStorage.setItem(`spiritpal:overseas-consent:${pendingOverseasProvider}`, '1')
                      } catch { /* ignore */ }
                    }
                    applyProvider(pendingOverseasProvider)
                    setPendingOverseasProvider(null)
                  }}
                  className="rounded-lg bg-tangerine px-4 py-2 text-sm text-white"
                >
                  同意并继续
                </button>
              </div>
            </div>
          </div>
        )}

        {savedTip && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-green-600 px-4 py-1.5 text-sm">
            已保存 ✓
          </div>
        )}
      </div>
      </div>

      {/* AI 创建角色向导 */}
      {showWizard && (
        <CharacterCreationWizard onClose={() => setShowWizard(false)} />
      )}

      {/* 可视化角色创作工具 */}
      {showCreator && (
        <CharacterCreator onClose={() => setShowCreator(false)} />
      )}

      {/* GIF 转精灵图工具 */}
      {showGifTool && (
        <GifToSpriteTool onClose={() => setShowGifTool(false)} />
      )}

      {/* 法律文档弹窗 */}
      {legalDoc && (
        <LegalDocument
          title={legalDoc === 'privacy' ? '隐私政策' : '用户协议'}
          content={legalDoc === 'privacy' ? PRIVACY_POLICY : TERMS_OF_SERVICE}
          onClose={() => setLegalDoc(null)}
        />
      )}

      {/* 无边框窗口缩放手柄 */}
      <FramelessResizeHandles />
    </div>
  )
}
