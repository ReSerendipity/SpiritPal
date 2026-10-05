/**
 * @file 移动端设置视图
 * @module mobile/MobileSettingsView
 * @description
 * 移动端设置界面，支持主题切换、宠物大小调整、通知开关、数据同步配置、角色切换和语言选择。
 * 包含主页、主题设置、同步设置、关于四个子页面导航。
 *
 * 主要功能：
 * - 外观主题：浅色/深色/跟随系统
 * - 宠物大小：0.5x-3.0x 缩放调节
 * - 推送通知：开关控制
 * - 数据同步：WebDAV 传输（云端/局域网尚未实现，按钮显式禁用），自动同步间隔配置
 * - 角色切换：多角色选择
 * - 语言：中/英/日/韩多语言
 */
import { getVersion } from '@tauri-apps/api/app'
import { useEffect, useState } from 'react'
import {
  Sun, Moon, Monitor, Bell, RefreshCw, Cloud, Wifi,
  Type, Info, ChevronRight, Brain, Sparkles, Cpu,
  FileText, ShieldCheck, CloudUpload, Database, SlidersHorizontal,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LegalDocument } from '@/components/LegalDocument'
import { OnDeviceModelPanel } from '@/components/OnDeviceModelPanel'
import { LLM_PROVIDERS, getProvider } from '@/lib/ai/llmProviders'
import { getAllCharacters } from '@/lib/data/characters'
import { deleteApiKey, getApiKey, setApiKey } from '@/lib/data/secureStorage'
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '@/lib/system/legalDocuments'
import { getSilentModeManager } from '@/lib/system/silentModeManager'
import { syncManager, type SyncConfig, type SyncStatus } from '@/lib/system/syncManager'
import { themeManager, type ThemeMode } from '@/lib/system/themeManager'
import type { WebDAVTestResult } from '@/lib/system/webdavClient'
import { MobileMemoryView } from '@/mobile/MobileMemoryView'
import { MobilePersonalityView } from '@/mobile/MobilePersonalityView'
import { usePetStore } from '@/stores/petStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { MobileDataPanel } from './MobileDataPanel'

/** 设置页面分区类型 */
type SettingsSection = 'main' | 'theme' | 'sync' | 'memory' | 'personality' | 'ondevice' | 'ai' | 'advanced' | 'about' | 'data'

/** AI 配置在 localStorage 的键（与 SettingsWindow / MobileChatView 一致） */
const AI_CONFIG_KEY = 'spiritpal-ai-config'
/** 与 llmClient 的 DEFAULT_AI_CONFIG.provider 保持一致 */
const DEFAULT_PROVIDER = 'deepseek'
/** WebDAV 密码占位符（表示「keychain 中已有密码」，与 DataPanel 保持一致） */
const PASSWORD_PLACEHOLDER = '••••••••'
/** WebDAV 服务器默认值（坚果云，与 DataPanel 保持一致） */
const DEFAULT_WEBDAV_URL = 'https://dav.jianguoyun.com/dav/'

/** 读取当前 provider（MobileChatView 每次发送都会重读该配置，故改完即时生效） */
function readProvider(): string {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (raw) return JSON.parse(raw).provider ?? DEFAULT_PROVIDER
  } catch {
    // 忽略解析错误
  }
  return DEFAULT_PROVIDER
}

/** 写入 provider（保留其余字段；API Key 不在此处，由 secureStorage 管理） */
function writeProvider(id: string): void {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    const cfg = raw ? JSON.parse(raw) : {}
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ ...cfg, provider: id }))
  } catch {
    // 忽略存储错误
  }
}

/** 读取端点配置字段（MobileChatView 每次发送都会重读该配置，改完即时生效） */
function readEndpointConfig(): { baseUrl: string; model: string } {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (raw) {
      const j = JSON.parse(raw)
      return { baseUrl: j.baseUrl ?? '', model: j.model ?? '' }
    }
  } catch {
    // 忽略解析错误
  }
  return { baseUrl: '', model: '' }
}

/** 合并写入端点配置字段（保留其余字段；API Key 不在此处，由 secureStorage 管理） */
function writeEndpointConfig(patch: { baseUrl?: string; model?: string }): void {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    const cfg = raw ? JSON.parse(raw) : {}
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ ...cfg, ...patch }))
  } catch {
    // 忽略存储错误
  }
}

/**
 * 移动端设置视图组件
 * @returns 设置界面 JSX 元素
 */
export function MobileSettingsView() {
  const settings = useSettingsStore()
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const switchSettingsChar = useSettingsStore((s) => s.switchCharacter)
  // P2-2：useTranslation 在语言变化时触发本组件重渲染（此前静态 t()/硬编码
  // 中文使语言切换"看起来不生效"）；i18n.setLanguage 调用点不变
  const { t, i18n } = useTranslation()

  // AI 服务商（持久化在 localStorage，MobileChatView 每次发送重读 → 改完即时生效）
  const [provider, setProvider] = useState<string>(() => readProvider())
  const selectProvider = (id: string) => {
    writeProvider(id)
    setProvider(id)
  }
  // 端点配置（custom / ollama：Base URL + 模型名；llama.cpp 等本地服务无需 API Key）
  const [endpointCfg, setEndpointCfg] = useState(() => readEndpointConfig())
  const updateEndpointCfg = (patch: { baseUrl?: string; model?: string }) => {
    writeEndpointConfig(patch)
    setEndpointCfg((prev) => ({ ...prev, ...patch }))
  }
  // 云端供应商 API Key（存 secureStorage → Rust keychain；安卓为沙箱内加密文件）
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  useEffect(() => {
    let cancelled = false
    getApiKey(provider)
      .then((k) => {
        // 切换供应商时无论有无已存 Key 都重置草稿，避免残留上一个供应商的 Key 文本
        if (!cancelled) setApiKeyDraft(k ?? '')
      })
      .catch(() => {
        if (!cancelled) setApiKeyDraft('')
      })
    return () => {
      cancelled = true
    }
  }, [provider])

  /** Key 输入失焦时保存（清空 = 删除已存 Key）；与已存值相同则跳过 */
  async function handleApiKeyBlur() {
    const current = await getApiKey(provider).catch(() => null)
    const draft = apiKeyDraft.trim()
    if (draft === (current ?? '')) return
    try {
      if (draft) {
        await setApiKey(provider, draft)
      } else if (current) {
        await deleteApiKey(provider)
      }
    } catch {
      /* 存储失败静默：下次发送时该供应商会因缺 Key 报 401 */
    }
  }
  const switchPetChar = usePetStore((s) => s.switchCharacter)
  const sharedCoins = usePetStore((s) => s.sharedCoins)

  /** 语言切换：settingsStore 持久化 + i18n 即时生效 + html lang 同步（a11y） */
  function handleSetLanguage(lang: 'zh' | 'en' | 'ja' | 'ko' | 'zh-TW') {
    setLanguage(lang)
    void i18n.changeLanguage(lang)
    const langMap: Record<string, string> = {
      zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', 'zh-TW': 'zh-TW',
    }
    document.documentElement.lang = langMap[lang] ?? 'zh-CN'
  }

  const [section, setSection] = useState<SettingsSection>('main')
  // P2-11：静默模式切换后强制重渲染（manager 状态非响应式）
  const [, setSilentVersion] = useState(0)
  // P3-5：关于页版本号动态读取（与桌面同源，禁止硬编码）
  const [appVersion, setAppVersion] = useState<string>('')
  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(''))
  }, [])
  // 法律文档弹窗（隐私政策 / 用户协议）——与桌面端 SettingsWindow 的 legalDoc 同构
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null)
  // 主题模式订阅制：初始快照可能早于 themeManager.init()（MobileApp useEffect），
  // 故挂载后订阅权威状态回填，避免「选中态与实际渲染脱节」
  const [themeMode, setThemeMode] = useState<ThemeMode>(themeManager.getMode())
  useEffect(() => {
    setThemeMode(themeManager.getMode())
    return themeManager.subscribe((_effective, mode) => setThemeMode(mode))
  }, [])
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(syncManager.getConfig())
  // 同步状态需订阅（此前在渲染期直接读 getStatus()，按钮点完界面不会更新）
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncManager.getStatus())
  useEffect(() => syncManager.subscribe((status) => setSyncStatus(status)), [])

  // 主题样式（与桌面端 SettingsWindow 一致的语义 Token 配色）
  const bgClass = 'bg-cream'
  const textClass = 'text-ink'
  const cardBgClass = 'bg-surface'
  const cardBorderClass = 'border-ink/10'
  const subtitleClass = 'text-ink-muted'
  const chevronClass = 'text-ink-faint'

  /**
   * 设置主题模式
   * @param mode - 主题模式（light/dark/system）
   */
  function handleSetTheme(mode: ThemeMode) {
    // 权威状态由 themeManager.subscribe 回填（含 setMode 对相同值的 early-return 场景）
    themeManager.setMode(mode)
  }

  /**
   * 更新同步配置
   * @param partial - 部分同步配置
   */
  function handleUpdateSync(partial: Partial<SyncConfig>) {
    const newConfig = { ...syncConfig, ...partial }
    syncManager.configure(partial)
    setSyncConfig(newConfig)
  }

  /** 手动触发同步 */
  async function handleSyncNow() {
    await syncManager.sync()
  }

  // ===== WebDAV 配置（移动端此前只暴露 cloud/lan 两个未实现的通道，WebDAV 无入口） =====
  const [webdavServerUrl, setWebdavServerUrl] = useState(
    () => syncManager.getConfig().webdav?.serverUrl || DEFAULT_WEBDAV_URL,
  )
  const [webdavUsername, setWebdavUsername] = useState(
    () => syncManager.getConfig().webdav?.username ?? '',
  )
  const [webdavPassword, setWebdavPassword] = useState('')
  const [webdavBusy, setWebdavBusy] = useState(false)
  const [webdavStatus, setWebdavStatus] = useState<{ ok: boolean; text: string } | null>(null)

  // 挂载时读取 keychain 中是否已有密码（有则显示占位符，避免误清空）
  useEffect(() => {
    let cancelled = false
    void import('@/lib/system/webdavClient')
      .then(({ getWebDAVClient }) => getWebDAVClient().loadPassword())
      .then((pwd) => {
        if (!cancelled && pwd) setWebdavPassword(PASSWORD_PLACEHOLDER)
      })
      .catch(() => {
        // keychain 不可用（纯浏览器/权限受限）：保持空密码
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 将当前表单写入 webdavClient + syncManager（密码走 keychain，不进 syncConfig）
   */
  async function applyWebdavConfig(): Promise<void> {
    const { getWebDAVClient } = await import('@/lib/system/webdavClient')
    const client = getWebDAVClient()
    await client.configure({
      serverUrl: webdavServerUrl,
      username: webdavUsername,
      autoSync: syncConfig.enabled,
      autoSyncInterval: syncConfig.autoSyncInterval,
    })
    if (webdavPassword && webdavPassword !== PASSWORD_PLACEHOLDER) {
      await client.setPassword(webdavPassword)
    }
    handleUpdateSync({
      transport: 'webdav',
      webdav: { serverUrl: webdavServerUrl, username: webdavUsername },
    })
  }

  /** 测试 WebDAV 连接（先应用表单再探测） */
  async function handleTestWebdav() {
    setWebdavBusy(true)
    setWebdavStatus(null)
    try {
      await applyWebdavConfig()
      const { getWebDAVClient } = await import('@/lib/system/webdavClient')
      const result: WebDAVTestResult = await getWebDAVClient().testConnection()
      setWebdavStatus({
        ok: result.success,
        text: result.success
          ? t('settings.mobile.webdavTestOk')
          : `${t('settings.mobile.webdavTestFail')}${result.error ? `: ${result.error}` : ''}`,
      })
    } catch (err) {
      setWebdavStatus({
        ok: false,
        text: `${t('settings.mobile.webdavTestFail')}: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setWebdavBusy(false)
    }
  }

  /** 保存 WebDAV 配置 */
  async function handleSaveWebdav() {
    setWebdavBusy(true)
    setWebdavStatus(null)
    try {
      await applyWebdavConfig()
      setWebdavStatus({ ok: true, text: t('settings.mobile.webdavSaved') })
    } catch (err) {
      setWebdavStatus({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setWebdavBusy(false)
    }
  }

  /**
   * 切换当前角色
   * @param id - 角色ID
   */
  function handleSwitchCharacter(id: string) {
    switchSettingsChar(id)
    switchPetChar(id)
  }

  // ===== 主页 =====
  if (section === 'main') {
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`border-b ${cardBorderClass} px-4 py-3`}>
          <h2 className="text-base font-semibold">{t('settings.title')}</h2>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* 主题 */}
          <SettingItem
            icon={themeMode === 'dark' ? Moon : Sun}
            iconBg="bg-tangerine"
            title={t('settings.mobile.appearance')}
            subtitle={
              themeMode === 'system'
                ? t('settings.mobile.appearanceFollow')
                : themeMode === 'dark'
                  ? t('settings.mobile.appearanceDark')
                  : t('settings.mobile.appearanceLight')
            }
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('theme')}
          />

          {/* 宠物大小 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="mb-2 flex items-center gap-2">
              <Type size={16} className="text-ink-faint" />
              <span className="text-sm font-medium">{t('settings.mobile.petSize')}</span>
              <span className="ml-auto text-xs text-ink-muted">{settings.petSize.toFixed(1)}x</span>
            </div>
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

          {/* 通知开关 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-ink-faint" />
              <span className="text-sm font-medium">{t('settings.mobile.pushNotification')}</span>
              <label className="ml-auto flex items-center">
                <input
                  type="checkbox"
                  checked={settings.notifications}
                  onChange={(e) => {
                    updateSettings({ notifications: e.target.checked })
                    if (e.target.checked) {
                      // 合规（D-COMPLIANCE）：用户主动开启通知后才补请求权限
                      // （init 幂等；能进入设置页说明协议已同意）。
                      void import('@/lib/system/pushNotificationManager')
                        .then(({ pushNotificationManager }) => pushNotificationManager.init())
                        .catch((err: unknown) => {
                          // 推送初始化失败，静默降级——P0-4: 进日志可诊断
                          void import('@/lib/system/frontendErrorReport').then(({ reportWarn, formatError }) => {
                            reportWarn(`[pushNotification] 开关补触发失败: ${formatError(err)}`)
                          })
                        })
                    }
                  }}
                  className="h-4 w-4 accent-tangerine"
                />
              </label>
            </div>
          </div>

          {/* AI 服务商 */}
          <SettingItem
            icon={Sparkles}
            iconBg="bg-tangerine"
            title={t('settings.mobile.aiProvider')}
            subtitle={getProvider(provider)?.name ?? provider}
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('ai')}
          />

          {/* 端侧模型（MNN 内嵌，进程内推理） */}
          <SettingItem
            icon={Cpu}
            iconBg="bg-tangerine-deep"
            title={t('settings.mobile.onDevice')}
            subtitle={t('settings.mobile.onDeviceSub')}
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('ondevice')}
          />

          {/* 数据同步 */}
          <SettingItem
            icon={syncConfig.transport === 'webdav' ? CloudUpload : syncConfig.transport === 'cloud' ? Cloud : Wifi}
            iconBg="bg-tangerine-deep"
            title={t('settings.mobile.dataSync')}
            subtitle={
              syncConfig.enabled
                ? syncConfig.transport === 'webdav'
                  ? 'WebDAV'
                  : syncConfig.transport === 'cloud'
                    ? t('settings.mobile.transportCloud')
                    : t('settings.mobile.transportLan')
                : t('settings.mobile.syncDisabled')
            }
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('sync')}
          />

          {/* P1-4: 数据管理（备份/恢复/重置） */}
          <SettingItem
            icon={Database}
            iconBg="bg-tangerine-deep"
            title={t('settings.data.title')}
            subtitle={t('settings.data.subtitle')}
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('data')}
          />

          {/* 角色切换 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">{t('settings.character')}</h3>
            <div className="flex flex-wrap gap-2">
              {getAllCharacters().map((char) => (
                <button
                  key={char.id}
                  onClick={() => handleSwitchCharacter(char.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    settings.currentCharacterId === char.id
                      ? 'bg-tangerine text-white'
                      : 'bg-cream-deep text-ink-muted'
                  }`}
                >
                  {char.displayName}
                </button>
              ))}
            </div>
          </div>

          {/* 语言 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">{t('settings.language')}</h3>
            <div className="flex gap-2">
              {([
                { id: 'zh', label: '中文' },
                { id: 'zh-TW', label: '繁體中文' },
                { id: 'en', label: 'English' },
                { id: 'ja', label: '日本語' },
                { id: 'ko', label: '한국어' },
              ] as const).map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => handleSetLanguage(lang.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    settings.language === lang.id
                      ? 'bg-tangerine text-white'
                      : 'bg-cream-deep text-ink-muted'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* 记忆可视化 */}
          <SettingItem
            icon={Brain}
            iconBg="bg-tangerine"
            title={t('settings.mobile.memory')}
            subtitle={t('settings.mobile.memorySub')}
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('memory')}
          />

          {/* 性格编辑 */}
          <SettingItem
            icon={Sparkles}
            iconBg="bg-tangerine-deep"
            title={t('settings.mobile.personality')}
            subtitle={t('settings.mobile.personalitySub')}
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('personality')}
          />

          {/* P2-11：高级设置 */}
          <SettingItem
            icon={SlidersHorizontal}
            iconBg="bg-tangerine"
            title={t('settings.advanced.title')}
            subtitle={t('settings.advanced.subtitle')}
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('advanced')}
          />

          {/* 关于 */}
          <SettingItem
            icon={Info}
            iconBg="bg-ink/50"
            title={t('settings.mobile.about')}
            subtitle={appVersion ? `SpiritPal v${appVersion}` : 'SpiritPal'}
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('about')}
          />
        </div>
      </div>
    )
  }

  // ===== 主题设置 =====
  if (section === 'theme') {
    const themeOptions: Array<{ id: ThemeMode; label: string; icon: typeof Sun; desc: string }> = [
      { id: 'light', label: t('settings.mobile.appearanceLight'), icon: Sun, desc: t('settings.mobile.appearanceLightDesc') },
      { id: 'dark', label: t('settings.mobile.appearanceDark'), icon: Moon, desc: t('settings.mobile.appearanceDarkDesc') },
      { id: 'system', label: t('settings.mobile.appearanceFollow'), icon: Monitor, desc: t('settings.mobile.appearanceFollowDesc') },
    ]
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-tangerine">
            {t('settings.mobile.back')}
          </button>
          <h2 className="text-base font-semibold">{t('settings.mobile.appearance')}</h2>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {themeOptions.map((opt) => {
            const Icon = opt.icon
            const isActive = themeMode === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => handleSetTheme(opt.id)}
                className={`mb-2 flex w-full items-center gap-3 rounded-xl border p-3 transition-colors ${
                  isActive
                    ? 'border-tangerine bg-tangerine-soft'
                    : `${cardBgClass} ${cardBorderClass}`
                }`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  isActive ? 'bg-tangerine text-white' : 'bg-ink/5 text-ink-faint'
                }`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className={`text-xs ${subtitleClass}`}>{opt.desc}</div>
                </div>
                {isActive && (
                  <div className="h-2 w-2 rounded-full bg-tangerine" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ===== 同步设置 =====
  if (section === 'ai') {
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-tangerine">
            {t('settings.mobile.back')}
          </button>
          <h2 className="text-base font-semibold">{t('settings.mobile.aiProvider')}</h2>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <p className={`mb-3 text-xs ${subtitleClass}`}>{t('settings.mobile.aiHint')}</p>
          {LLM_PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProvider(p.id)}
              className={`mb-2 flex w-full items-center gap-3 rounded-xl ${cardBgClass} border ${
                provider === p.id ? 'border-tangerine' : cardBorderClass
              } p-3 text-left`}
            >
              <span className="flex-1 text-sm font-medium">{p.name}</span>
              {provider === p.id && <span className="text-xs text-tangerine">{t('settings.mobile.current')}</span>}
            </button>
          ))}
          {provider === 'custom' && (
            <div className={`mb-2 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
              <div className="mb-2 text-sm font-medium">{t('settings.mobile.connConfig')}</div>
              <input
                value={endpointCfg.baseUrl}
                onChange={(e) => updateEndpointCfg({ baseUrl: e.target.value })}
                placeholder={t('settings.mobile.apiBasePlaceholder')}
                className={`mb-2 w-full rounded-lg border ${cardBorderClass} bg-cream px-3 py-2 text-sm`}
              />
              <input
                value={endpointCfg.model}
                onChange={(e) => updateEndpointCfg({ model: e.target.value })}
                placeholder={t('settings.mobile.modelPlaceholder')}
                className={`w-full rounded-lg border ${cardBorderClass} bg-cream px-3 py-2 text-sm`}
              />
              <p className={`mt-2 text-xs ${subtitleClass}`}>{t('settings.mobile.apiHint')}</p>
            </div>
          )}
          {provider !== 'ollama' && provider !== 'ondevice' && (
            <div className={`mb-2 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
              <div className="mb-2 text-sm font-medium">API Key</div>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onBlur={() => void handleApiKeyBlur()}
                placeholder={t('settings.mobile.apiKeyPlaceholder')}
                autoComplete="off"
                className={`w-full rounded-lg border ${cardBorderClass} bg-cream px-3 py-2 text-sm`}
              />
              <p className={`mt-2 text-xs ${subtitleClass}`}>{t('settings.mobile.apiKeyHint')}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (section === 'ondevice') {
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-tangerine">
            {t('settings.mobile.back')}
          </button>
          <h2 className="text-base font-semibold">{t('settings.mobile.onDevice')}</h2>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <OnDeviceModelPanel />
        </div>
      </div>
    )
  }

  if (section === 'sync') {
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-tangerine">
            {t('settings.mobile.back')}
          </button>
          <h2 className="text-base font-semibold">{t('settings.mobile.dataSync')}</h2>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* 启用同步 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="text-ink-faint" />
              <span className="text-sm font-medium">{t('settings.mobile.enableSync')}</span>
              <label className="ml-auto flex items-center">
                <input
                  type="checkbox"
                  checked={syncConfig.enabled}
                  onChange={(e) => handleUpdateSync({ enabled: e.target.checked })}
                  className="h-4 w-4 accent-tangerine"
                />
              </label>
            </div>
            <p className={`mt-1 text-xs ${subtitleClass}`}>{t('settings.mobile.enableSyncHint')}</p>
          </div>

          {/* 传输方式（WebDAV 是唯一已实现的真实通道；cloud/lan 仍为占位，显式禁用而非静默失败） */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">{t('settings.mobile.transport')}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => handleUpdateSync({ transport: 'webdav' })}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs ${
                  syncConfig.transport === 'webdav'
                    ? 'bg-tangerine text-white'
                    : 'bg-cream-deep text-ink-muted'
                }`}
              >
                <CloudUpload size={14} />
                WebDAV
              </button>
              <button
                disabled
                aria-disabled="true"
                title={t('settings.mobile.transportUnavailable')}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-cream-deep py-2 text-xs text-ink-faint opacity-50"
              >
                <Cloud size={14} />
                {t('settings.mobile.transportCloud')}
              </button>
              <button
                disabled
                aria-disabled="true"
                title={t('settings.mobile.transportUnavailable')}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-cream-deep py-2 text-xs text-ink-faint opacity-50"
              >
                <Wifi size={14} />
                {t('settings.mobile.transportLan')}
              </button>
            </div>
            <p className={`mt-2 text-xs ${subtitleClass}`}>
              {t('settings.mobile.transportHint')}
            </p>
          </div>

          {/* WebDAV 连接配置（仅在选中 WebDAV 时展示） */}
          {syncConfig.transport === 'webdav' && (
            <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
              <h3 className="mb-2 text-sm font-medium">{t('settings.mobile.webdavConfig')}</h3>
              <label className="mb-2 block">
                <span className={`mb-1 block text-xs ${subtitleClass}`}>
                  {t('settings.mobile.webdavServer')}
                </span>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={webdavServerUrl}
                  onChange={(e) => setWebdavServerUrl(e.target.value)}
                  placeholder={DEFAULT_WEBDAV_URL}
                  className={`w-full rounded-lg border ${cardBorderClass} bg-cream px-2 py-1.5 text-xs text-ink outline-none`}
                />
              </label>
              <label className="mb-2 block">
                <span className={`mb-1 block text-xs ${subtitleClass}`}>
                  {t('settings.mobile.webdavUsername')}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  value={webdavUsername}
                  onChange={(e) => setWebdavUsername(e.target.value)}
                  className={`w-full rounded-lg border ${cardBorderClass} bg-cream px-2 py-1.5 text-xs text-ink outline-none`}
                />
              </label>
              <label className="mb-3 block">
                <span className={`mb-1 block text-xs ${subtitleClass}`}>
                  {t('settings.mobile.webdavPassword')}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={webdavPassword}
                  onChange={(e) => setWebdavPassword(e.target.value)}
                  onFocus={() => {
                    // 占位符状态下聚焦即清空，允许输入新密码
                    if (webdavPassword === PASSWORD_PLACEHOLDER) setWebdavPassword('')
                  }}
                  className={`w-full rounded-lg border ${cardBorderClass} bg-cream px-2 py-1.5 text-xs text-ink outline-none`}
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={handleTestWebdav}
                  disabled={webdavBusy}
                  className={`flex-1 rounded-lg border ${cardBorderClass} py-2 text-xs text-ink ${
                    webdavBusy ? 'opacity-50' : ''
                  }`}
                >
                  {webdavBusy ? t('settings.mobile.webdavTesting') : t('settings.mobile.webdavTest')}
                </button>
                <button
                  onClick={handleSaveWebdav}
                  disabled={webdavBusy}
                  className={`flex-1 rounded-lg bg-tangerine py-2 text-xs font-medium text-white ${
                    webdavBusy ? 'opacity-50' : ''
                  }`}
                >
                  {t('settings.mobile.webdavSave')}
                </button>
              </div>
              {webdavStatus && (
                <p
                  className={`mt-2 text-xs ${
                    webdavStatus.ok ? 'text-success-deep' : 'text-stat-bad'
                  }`}
                >
                  {webdavStatus.text}
                </p>
              )}
            </div>
          )}

          {/* 自动同步间隔 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{t('settings.mobile.syncInterval')}</span>
              <span className="text-xs text-ink-muted">
                {syncConfig.autoSyncInterval === 0
                  ? t('settings.mobile.intervalDisabled')
                  : t('settings.mobile.intervalMinutes', { n: syncConfig.autoSyncInterval / 60000 })}
              </span>
            </div>
            <div className="flex gap-2">
              {[
                { val: 0, labelKey: 'settings.mobile.intervalDisabled' },
                { val: 60000, labelKey: 'settings.mobile.interval1' },
                { val: 300000, labelKey: 'settings.mobile.interval5' },
                { val: 1800000, labelKey: 'settings.mobile.interval30' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => handleUpdateSync({ autoSyncInterval: opt.val })}
                  className={`flex-1 rounded-lg py-1.5 text-xs ${
                    syncConfig.autoSyncInterval === opt.val
                      ? 'bg-tangerine text-white'
                      : 'bg-cream-deep text-ink-muted'
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* 立即同步 */}
          <button
            onClick={handleSyncNow}
            disabled={!syncConfig.enabled}
            className={`mb-3 w-full rounded-xl py-3 text-sm font-medium ${
              syncConfig.enabled
                ? 'bg-tangerine text-white'
                : 'bg-ink/10 text-ink-faint'
            }`}
          >
            {t('settings.mobile.syncNow')}
          </button>

          {/* 同步信息 */}
          <div className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">{t('settings.mobile.syncInfo')}</h3>
            <div className="space-y-1 text-xs text-ink-muted">
              <div className="flex justify-between">
                <span>{t('settings.mobile.syncStatusLabel')}</span>
                <span>
                  {{
                    idle: t('settings.mobile.syncIdle'),
                    syncing: t('settings.mobile.syncSyncing'),
                    success: t('settings.mobile.syncDone'),
                    error: syncManager.getLastError() ?? t('settings.mobile.syncFailed'),
                    offline: t('settings.mobile.syncOffline'),
                  }[syncStatus] ?? syncStatus}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t('settings.mobile.syncCoins')}</span>
                <span>{sharedCoins}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('settings.mobile.syncStrategy')}</span>
                <span>{t('settings.mobile.syncStrategyLww')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== 记忆 =====
  // P1-4: 数据管理（完整性检查 / 备份 / 恢复 / 重置）
  if (section === 'data') {
    return (
      <MobileDataPanel
        onBack={() => setSection('main')}
        bgClass={bgClass}
        textClass={textClass}
        cardBgClass={cardBgClass}
        cardBorderClass={cardBorderClass}
        subtitleClass={subtitleClass}
      />
    )
  }

  if (section === 'memory') {
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-tangerine">
            {t('settings.mobile.back')}
          </button>
          <h2 className="text-base font-semibold">{t('tab.memory')}</h2>
        </header>
        <div className="flex-1 overflow-hidden">
          <MobileMemoryView />
        </div>
      </div>
    )
  }

  // ===== 性格 =====
  if (section === 'personality') {
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-tangerine">
            {t('settings.mobile.back')}
          </button>
          <h2 className="text-base font-semibold">{t('settings.mobile.personality')}</h2>
        </header>
        <div className="flex-1 overflow-hidden">
          <MobilePersonalityView />
        </div>
      </div>
    )
  }

  // ===== 高级设置（P2-11）=====
  if (section === 'advanced') {
    // 静默模式当前状态（含计划/会议自动静默）
    const silentActive = getSilentModeManager().getState().isActive
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-tangerine">
            {t('settings.mobile.back')}
          </button>
          <h2 className="text-base font-semibold">{t('settings.advanced.title')}</h2>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* 宠物透明度（移动端实时生效：MobilePetView 消费 petOpacity） */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">{t('settings.advanced.petOpacity')}</span>
              <span className="text-xs tabular-nums text-ink-muted">
                {Math.round(settings.petOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.05}
              value={settings.petOpacity}
              onChange={(e) => updateSettings({ petOpacity: parseFloat(e.target.value) })}
              data-testid="pet-opacity-slider"
              className="w-full accent-tangerine"
            />
          </div>

          {/* 边缘吸附（移动端拖拽宠物时贴边） */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('settings.advanced.edgeSnap')}</span>
              <input
                type="checkbox"
                checked={settings.edgeSnapEnabled}
                onChange={(e) => updateSettings({ edgeSnapEnabled: e.target.checked })}
                data-testid="edge-snap-toggle"
                className="h-4 w-4 accent-tangerine"
              />
            </div>
            <p className={`mt-1 text-xs ${subtitleClass}`}>{t('settings.advanced.edgeSnapHint')}</p>
          </div>

          {/* 静默模式（真实开关：silentModeManager.toggleSilentMode） */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('settings.advanced.silentMode')}</span>
              <input
                type="checkbox"
                checked={silentActive}
                onChange={() => {
                  void getSilentModeManager().toggleSilentMode()
                  // 触发一次重渲染以读取最新状态
                  setSilentVersion((v) => v + 1)
                }}
                data-testid="silent-mode-toggle"
                className="h-4 w-4 accent-tangerine"
              />
            </div>
            <p className={`mt-1 text-xs ${subtitleClass}`}>{t('settings.advanced.silentModeHint')}</p>
          </div>

          {/* AI 能力开关（经 capabilityToggles 实时应用） */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">{t('settings.advanced.capabilities')}</h3>
            {([
              { key: 'weatherEnabled', labelKey: 'settings.advanced.capWeather' },
              { key: 'proactiveSpeakEnabled', labelKey: 'settings.advanced.capProactive' },
              { key: 'emotionEnabled', labelKey: 'settings.advanced.capEmotion' },
              { key: 'contextAwarenessEnabled', labelKey: 'settings.advanced.capContext' },
            ] as const).map((cap) => (
              <div key={cap.key} className="flex items-center justify-between py-1.5">
                <span className="text-xs text-ink">{t(cap.labelKey)}</span>
                <input
                  type="checkbox"
                  checked={settings[cap.key]}
                  onChange={(e) => updateSettings({ [cap.key]: e.target.checked })}
                  data-testid={`cap-${cap.key}`}
                  className="h-4 w-4 accent-tangerine"
                />
              </div>
            ))}
            <p className={`mt-1 text-xs ${subtitleClass}`}>{t('settings.advanced.capHint')}</p>
          </div>

          {/* 桌面专属 / 系统托管：诚实禁用 + 说明 */}
          <div className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-3 opacity-70`}>
            <h3 className="mb-2 text-sm font-medium">{t('settings.advanced.desktopOnly')}</h3>
            {([
              { labelKey: 'settings.advanced.petForm', noteKey: 'settings.advanced.petFormMobileNote' },
              { labelKey: 'settings.advanced.statusCard', noteKey: 'settings.advanced.statusCardMobileNote' },
              { labelKey: 'settings.advanced.autoStart', noteKey: 'settings.advanced.autoStartMobileNote' },
            ] as const).map((row) => (
              <div key={row.labelKey} className="flex items-center justify-between py-1.5">
                <div>
                  <div className="text-xs text-ink">{t(row.labelKey)}</div>
                  <div className="text-[10px] text-ink-faint">{t(row.noteKey)}</div>
                </div>
                <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] text-ink-faint">
                  {t('settings.advanced.unavailable')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ===== 关于 =====
  return (
    <>
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
        <button onClick={() => setSection('main')} className="text-sm text-tangerine">
          ← {t('settings.mobile.back')}
        </button>
        <h2 className="text-base font-semibold">{t('settings.mobile.about')}</h2>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-6 text-center">
        <div className="mb-4 text-6xl">🐾</div>
        <h1 className="mb-1 text-xl font-bold">SpiritPal</h1>
        <p className={`mb-4 text-sm ${subtitleClass}`}>{appVersion ? `v${appVersion}` : 'SpiritPal'}</p>
        <p className={`mx-auto max-w-xs text-sm ${subtitleClass}`}>
          {t('settings.mobile.aboutDesc')}
        </p>
        <div className={`mx-auto mt-6 max-w-xs rounded-xl ${cardBgClass} border ${cardBorderClass} p-4 text-left`}>
          <h3 className="mb-2 text-sm font-medium">{t('settings.mobile.features')}</h3>
          <ul className="space-y-1 text-xs text-ink-muted">
            <li>✓ {t('settings.mobile.feature1')}</li>
            <li>✓ {t('settings.mobile.feature2')}</li>
            <li>✓ {t('settings.mobile.feature3')}</li>
            <li>✓ {t('settings.mobile.feature4')}</li>
            <li>✓ {t('settings.mobile.feature5')}</li>
            <li>✓ {t('settings.mobile.feature6')}</li>
            <li>✓ {t('settings.mobile.feature7')}</li>
            <li>✓ {t('settings.mobile.feature8')}</li>
          </ul>
        </div>
        {/* 法律信息（P0 合规）：移动端此前完全没有隐私政策 / 用户协议入口 */}
        <div className={`mx-auto mt-4 max-w-xs rounded-xl ${cardBgClass} border ${cardBorderClass} p-4 text-left`}>
          <h3 className="mb-2 text-sm font-medium">{t('settings.mobile.legal')}</h3>
          <div className="space-y-1">
            <button
              onClick={() => setLegalDoc('privacy')}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs text-ink hover:bg-ink/6"
            >
              <ShieldCheck size={14} className="text-ink-faint" />
              {t('settings.mobile.privacyPolicy')}
              <ChevronRight size={14} className={`ml-auto ${chevronClass}`} />
            </button>
            <button
              onClick={() => setLegalDoc('terms')}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs text-ink hover:bg-ink/6"
            >
              <FileText size={14} className="text-ink-faint" />
              {t('settings.mobile.userAgreement')}
              <ChevronRight size={14} className={`ml-auto ${chevronClass}`} />
            </button>
          </div>
        </div>

        <div className={`mx-auto mt-4 max-w-xs rounded-xl ${cardBgClass} border ${cardBorderClass} p-4 text-left`}>
          <h3 className="mb-2 text-sm font-medium">{t('settings.mobile.followUs')}</h3>
          <div className="flex flex-wrap gap-2 text-xs">
            <a
              href="https://github.com/ReSerendipity/SpiritPal"
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-lg px-2.5 py-1 ${cardBgClass} border ${cardBorderClass} hover:opacity-80`}
            >
              GitHub
            </a>
            <a
              href="https://www.xiaohongshu.com/user/profile/6a606c140000000010000801"
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-lg px-2.5 py-1 ${cardBgClass} border ${cardBorderClass} hover:opacity-80`}
            >
              小红书
            </a>
            <a
              href="https://www.douyin.com/user/MS4wLjABAAAAcEdOoxVlfk3Ulx_usqR-3PHW4xxp6wYzRmsuRI_-fHBigPETTKLsv4fknIpFq6sP"
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-lg px-2.5 py-1 ${cardBgClass} border ${cardBorderClass} hover:opacity-80`}
            >
              抖音
            </a>
            <a
              href="https://www.kuaishou.com/profile/3x2sk6hj48i2mhs"
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-lg px-2.5 py-1 ${cardBgClass} border ${cardBorderClass} hover:opacity-80`}
            >
              快手
            </a>
            <a
              href="https://space.bilibili.com/499527473"
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-lg px-2.5 py-1 ${cardBgClass} border ${cardBorderClass} hover:opacity-80`}
            >
              B站
            </a>
          </div>
        </div>
      </div>
    </div>
    {legalDoc && (
      <LegalDocument
        title={legalDoc === 'privacy' ? t('settings.mobile.privacyPolicy') : t('settings.mobile.userAgreement')}
        content={legalDoc === 'privacy' ? PRIVACY_POLICY : TERMS_OF_SERVICE}
        onClose={() => setLegalDoc(null)}
      />
    )}
    </>
  )
}

// ============ 通用设置项组件 ============
/**
 * 通用设置项组件属性
 */
interface SettingItemProps {
  /** 图标组件 */
  icon: typeof Sun
  /** 图标背景色类名 */
  iconBg: string
  /** 设置项标题 */
  title: string
  /** 设置项副标题 */
  subtitle: string
  /** 箭头图标类名 */
  chevronClass: string
  /** 卡片背景色类名 */
  cardBgClass: string
  /** 卡片边框色类名 */
  cardBorderClass: string
  /** 副标题文字色类名 */
  subtitleClass: string
  /** 点击回调 */
  onClick: () => void
}

/**
 * 通用设置项组件
 * @param props - 组件属性
 * @returns 设置项按钮 JSX 元素
 */
function SettingItem({
  icon: Icon,
  iconBg,
  title,
  subtitle,
  chevronClass,
  cardBgClass,
  cardBorderClass,
  subtitleClass,
  onClick,
}: SettingItemProps) {
  return (
    <button
      onClick={onClick}
      className={`mb-3 flex w-full items-center gap-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3 text-left`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-full ${iconBg} text-white`}>
        <Icon size={16} />
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className={`text-xs ${subtitleClass}`}>{subtitle}</div>
      </div>
      <ChevronRight size={16} className={chevronClass} />
    </button>
  )
}
