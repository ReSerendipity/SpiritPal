/**
 * 设置窗口 · 通用标签页（自 SettingsWindow.tsx 拆出，2026-11-06 巨型组件整改）
 *
 * 自包含：开机自启/启动最小化/通知/窗口边框预览开关、界面形态
 * （窗口/桌面漫游）、全局快捷键展示、界面语言切换。
 * 无 props——不依赖父组件任何状态。
 */
import { disable, enable } from '@tauri-apps/plugin-autostart'
import type { AppSettings } from '@/lib/data/types'
import { switchPetForm } from '@/lib/nurture/petForm'
import { trackSettingChange } from '@/lib/system/analytics'
import { setLanguage as i18nSetLanguage } from '@/lib/system/i18n'
import { useSettingsStore } from '@/stores/settingsStore'

const selectUpdateSettings = (s: ReturnType<typeof useSettingsStore.getState>) => s.updateSettings
const selectSetLanguage = (s: ReturnType<typeof useSettingsStore.getState>) => s.setLanguage

type ToggleKey = 'autoStart' | 'startMinimized' | 'notifications' | 'showWindowBorder'

export default function SettingsGeneralTab() {
  const settings = useSettingsStore()
  const updateSettings = useSettingsStore(selectUpdateSettings)
  const setLanguage = useSettingsStore(selectSetLanguage)

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

  return (
    <div className="max-w-md space-y-5">
      <h2 className="text-lg font-semibold">通用</h2>

      {(
        [
          { key: 'autoStart', label: '开机自启' },
          { key: 'startMinimized', label: '启动时最小化' },
          { key: 'notifications', label: '通知' },
          { key: 'showWindowBorder', label: '窗口边框预览（调试）' },
        ] as { key: ToggleKey; label: string }[]
      ).map((item) => (
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
  )
}
