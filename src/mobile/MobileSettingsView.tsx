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
 * - 数据同步：云端/局域网传输，自动同步间隔配置
 * - 角色切换：多角色选择
 * - 语言：中/英/日/韩多语言
 */
import { useState } from 'react'
import {
  Sun, Moon, Monitor, Bell, RefreshCw, Cloud, Wifi,
  Type, Info, ChevronRight,
} from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { usePetStore } from '../stores/petStore'
import { themeManager, type ThemeMode } from '../lib/themeManager'
import { syncManager, type SyncConfig } from '../lib/syncManager'
import { getAllCharacters } from '../lib/characters'

/**
 * 移动端设置视图组件属性
 */
interface MobileSettingsViewProps {
  /** 是否为深色主题 */
  isDark: boolean
}

/** 设置页面分区类型 */
type SettingsSection = 'main' | 'theme' | 'sync' | 'about'

/**
 * 移动端设置视图组件
 * @param props - 组件属性
 * @returns 设置界面 JSX 元素
 */
export function MobileSettingsView({ isDark }: MobileSettingsViewProps) {
  const settings = useSettingsStore()
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const switchSettingsChar = useSettingsStore((s) => s.switchCharacter)
  const switchPetChar = usePetStore((s) => s.switchCharacter)
  const sharedCoins = usePetStore((s) => s.sharedCoins)

  const [section, setSection] = useState<SettingsSection>('main')
  const [themeMode, setThemeMode] = useState<ThemeMode>(themeManager.getMode())
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(syncManager.getConfig())

  // 主题样式
  const bgClass = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const textClass = isDark ? 'text-gray-100' : 'text-gray-900'
  const cardBgClass = isDark ? 'bg-gray-800' : 'bg-white'
  const cardBorderClass = isDark ? 'border-gray-700' : 'border-gray-200'
  const subtitleClass = isDark ? 'text-gray-400' : 'text-gray-500'
  const chevronClass = isDark ? 'text-gray-600' : 'text-gray-400'

  /**
   * 设置主题模式
   * @param mode - 主题模式（light/dark/system）
   */
  function handleSetTheme(mode: ThemeMode) {
    themeManager.setMode(mode)
    setThemeMode(mode)
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
          <h2 className="text-base font-semibold">设置</h2>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* 主题 */}
          <SettingItem
            isDark={isDark}
            icon={themeMode === 'dark' ? Moon : Sun}
            iconBg="bg-indigo-500"
            title="外观主题"
            subtitle={
              themeMode === 'system' ? '跟随系统' : themeMode === 'dark' ? '深色' : '浅色'
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
              <Type size={16} className="text-gray-400" />
              <span className="text-sm font-medium">宠物大小</span>
              <span className="ml-auto text-xs text-gray-500">{settings.petSize.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={3.0}
              step={0.1}
              value={settings.petSize}
              onChange={(e) => updateSettings({ petSize: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* 通知开关 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-gray-400" />
              <span className="text-sm font-medium">推送通知</span>
              <label className="ml-auto flex items-center">
                <input
                  type="checkbox"
                  checked={settings.notifications}
                  onChange={(e) => updateSettings({ notifications: e.target.checked })}
                  className="h-4 w-4 accent-indigo-500"
                />
              </label>
            </div>
          </div>

          {/* 数据同步 */}
          <SettingItem
            isDark={isDark}
            icon={syncConfig.transport === 'cloud' ? Cloud : Wifi}
            iconBg="bg-blue-500"
            title="数据同步"
            subtitle={syncConfig.enabled ? `已启用 · ${syncConfig.transport === 'cloud' ? '云端' : '局域网'}` : '未启用'}
            chevronClass={chevronClass}
            cardBgClass={cardBgClass}
            cardBorderClass={cardBorderClass}
            subtitleClass={subtitleClass}
            onClick={() => setSection('sync')}
          />

          {/* 角色切换 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">当前角色</h3>
            <div className="flex flex-wrap gap-2">
              {getAllCharacters().map((char) => (
                <button
                  key={char.id}
                  onClick={() => handleSwitchCharacter(char.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    settings.currentCharacterId === char.id
                      ? 'bg-indigo-500 text-white'
                      : isDark
                        ? 'bg-gray-700 text-gray-300'
                        : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {char.displayName}
                </button>
              ))}
            </div>
          </div>

          {/* 语言 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">语言</h3>
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
                  onClick={() => setLanguage(lang.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    settings.language === lang.id
                      ? 'bg-indigo-500 text-white'
                      : isDark
                        ? 'bg-gray-700 text-gray-300'
                        : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* 关于 */}
          <SettingItem
            isDark={isDark}
            icon={Info}
            iconBg="bg-gray-500"
            title="关于"
            subtitle="SpiritPal v0.1.0"
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
      { id: 'light', label: '浅色', icon: Sun, desc: '明亮模式' },
      { id: 'dark', label: '深色', icon: Moon, desc: '暗黑模式' },
      { id: 'system', label: '跟随系统', icon: Monitor, desc: '自动跟随系统主题' },
    ]
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-indigo-500">
            ← 返回
          </button>
          <h2 className="text-base font-semibold">外观主题</h2>
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
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                    : `${cardBgClass} ${cardBorderClass}`
                }`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  isActive ? 'bg-indigo-500 text-white' : isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                }`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className={`text-xs ${subtitleClass}`}>{opt.desc}</div>
                </div>
                {isActive && (
                  <div className="h-2 w-2 rounded-full bg-indigo-500" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ===== 同步设置 =====
  if (section === 'sync') {
    return (
      <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
        <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
          <button onClick={() => setSection('main')} className="text-sm text-indigo-500">
            ← 返回
          </button>
          <h2 className="text-base font-semibold">数据同步</h2>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* 启用同步 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="text-gray-400" />
              <span className="text-sm font-medium">启用同步</span>
              <label className="ml-auto flex items-center">
                <input
                  type="checkbox"
                  checked={syncConfig.enabled}
                  onChange={(e) => handleUpdateSync({ enabled: e.target.checked })}
                  className="h-4 w-4 accent-indigo-500"
                />
              </label>
            </div>
            <p className={`mt-1 text-xs ${subtitleClass}`}>
              启用后可在多设备间同步宠物数据
            </p>
          </div>

          {/* 传输方式 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">传输方式</h3>
            <div className="flex gap-2">
              <button
                onClick={() => handleUpdateSync({ transport: 'cloud' })}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs ${
                  syncConfig.transport === 'cloud'
                    ? 'bg-indigo-500 text-white'
                    : isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                }`}
              >
                <Cloud size={14} />
                云端
              </button>
              <button
                onClick={() => handleUpdateSync({ transport: 'lan' })}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs ${
                  syncConfig.transport === 'lan'
                    ? 'bg-indigo-500 text-white'
                    : isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                }`}
              >
                <Wifi size={14} />
                局域网
              </button>
            </div>
          </div>

          {/* 自动同步间隔 */}
          <div className={`mb-3 rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">自动同步间隔</span>
              <span className="text-xs text-gray-500">
                {syncConfig.autoSyncInterval === 0 ? '禁用' : `${syncConfig.autoSyncInterval / 60000} 分钟`}
              </span>
            </div>
            <div className="flex gap-2">
              {[
                { val: 0, label: '禁用' },
                { val: 60000, label: '1分' },
                { val: 300000, label: '5分' },
                { val: 1800000, label: '30分' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => handleUpdateSync({ autoSyncInterval: opt.val })}
                  className={`flex-1 rounded-lg py-1.5 text-xs ${
                    syncConfig.autoSyncInterval === opt.val
                      ? 'bg-indigo-500 text-white'
                      : isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {opt.label}
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
                ? 'bg-indigo-500 text-white'
                : 'bg-gray-300 text-gray-500 dark:bg-gray-700'
            }`}
          >
            立即同步
          </button>

          {/* 同步信息 */}
          <div className={`rounded-xl ${cardBgClass} border ${cardBorderClass} p-3`}>
            <h3 className="mb-2 text-sm font-medium">同步信息</h3>
            <div className="space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>当前状态</span>
                <span>{syncManager.getStatus()}</span>
              </div>
              <div className="flex justify-between">
                <span>金币（共享）</span>
                <span>{sharedCoins}</span>
              </div>
              <div className="flex justify-between">
                <span>同步策略</span>
                <span>最后写入优先 (LWW)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== 关于 =====
  return (
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      <header className={`flex items-center gap-2 border-b ${cardBorderClass} px-4 py-3`}>
        <button onClick={() => setSection('main')} className="text-sm text-indigo-500">
          ← 返回
        </button>
        <h2 className="text-base font-semibold">关于</h2>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-6 text-center">
        <div className="mb-4 text-6xl">🐾</div>
        <h1 className="mb-1 text-xl font-bold">SpiritPal</h1>
        <p className={`mb-4 text-sm ${subtitleClass}`}>v0.1.0</p>
        <p className={`mx-auto max-w-xs text-sm ${subtitleClass}`}>
          SpiritPal 是一款跨平台桌宠应用，支持 Live2D 渲染、AI 对话、养成系统、情境感知等功能。
        </p>
        <div className={`mx-auto mt-6 max-w-xs rounded-xl ${cardBgClass} border ${cardBorderClass} p-4 text-left`}>
          <h3 className="mb-2 text-sm font-medium">功能特性</h3>
          <ul className="space-y-1 text-xs text-gray-500">
            <li>✓ 全屏 Live2D 宠物渲染</li>
            <li>✓ 触摸手势交互（点击/拖拽/双击/长按/捏合）</li>
            <li>✓ 深浅色主题切换</li>
            <li>✓ 数据多端同步</li>
            <li>✓ AI 聊天对话</li>
            <li>✓ 四维养成系统</li>
            <li>✓ Widget 桌面小组件</li>
            <li>✓ 推送通知</li>
          </ul>
        </div>
        <div className={`mx-auto mt-4 max-w-xs rounded-xl ${cardBgClass} border ${cardBorderClass} p-4 text-left`}>
          <h3 className="mb-2 text-sm font-medium">关注我们</h3>
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
              href="https://v.douyin.com/eJgZfhanu4I/"
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
  )
}

// ============ 通用设置项组件 ============
/**
 * 通用设置项组件属性
 */
interface SettingItemProps {
  /** 是否为深色主题 */
  isDark: boolean
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
