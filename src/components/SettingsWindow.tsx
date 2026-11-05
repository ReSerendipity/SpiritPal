/**
 * 设置窗口组件（壳层）
 *
 * 功能概述：
 * - 多标签页设置界面：AI配置、外观、性格编辑、养成、商店、背包、记忆、成就、排行榜、日程、模组、相册、数据、快捷控制、精灵图工具、社区、通用、关于
 * - 重量级标签页已拆分为自包含子组件（2026-11-06 巨型组件整改）：
 *   AI 配置 → settings/SettingsAITab（含 secureStorage / Ollama 检测 / 出境确认）
 *   外观 → settings/SettingsAppearanceTab（主题 / 角色 / 背景 / 装饰品）
 *   通用 → settings/SettingsGeneralTab（开关 / 形态 / 语言）
 *   关于 → settings/SettingsAboutTab（版本 / 诊断 / 社链 / 法律文档）
 * - 本壳层保留：侧边栏与标签路由、跨窗口「打开指定标签页」事件、
 *   窗口关闭（Esc / 按钮）、轻量面板标签页、角色创建/导入/GIF 工具弹窗
 *
 * 使用模块：
 * - settingsStore: 语言初始化（其余状态下沉到各标签页子组件）
 * - Tauri API: 窗口管理
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import {
  X,
  Bot,
  Palette,
  Settings as SettingsIcon,
  Info,
  Heart,
  ShoppingBag,
  Backpack,
  Brain,
  SlidersHorizontal,
  Trophy,
  Calendar,
  Package,
  Camera,
  Database,
  Sliders,
  Grid3x3,
  Activity,
  Users,
  Plug,
  BookOpen,
  Cpu,
} from 'lucide-react'
import { AchievementPanel } from '@/components/AchievementPanel'
import { AlbumPanel } from '@/components/AlbumPanel'
import { CharacterCreationWizard } from '@/components/CharacterCreationWizard'
import { CharacterCreator } from '@/components/CharacterCreator'
import { CharacterImportWizard } from '@/components/CharacterImportWizard'
import { CommunityPanel } from '@/components/CommunityPanel'
import { DataPanel } from '@/components/DataPanel'
import { FramelessResizeHandles } from '@/components/FramelessChrome'
import { GifToSpriteTool } from '@/components/GifToSpriteTool'
import { InventoryPanel } from '@/components/InventoryPanel'
import { JournalPanel } from '@/components/JournalPanel'
import { LeaderboardPanel } from '@/components/LeaderboardPanel'
import { McpSettingsPanel } from '@/components/McpSettingsPanel'
import { MemoryPanel } from '@/components/MemoryPanel'
import { MemoryVisualizer } from '@/components/MemoryVisualizer'
import { ModPanel } from '@/components/ModPanel'
import { NurturingPanel } from '@/components/NurturingPanel'
import { OnDeviceModelPanel } from '@/components/OnDeviceModelPanel'
import { PersonalityEditor } from '@/components/PersonalityEditor'
import { PersonalityPanel } from '@/components/PersonalityPanel'
import { QuickControlsPanel } from '@/components/QuickControlsPanel'
import { SchedulePanel } from '@/components/SchedulePanel'
import SettingsAboutTab from '@/components/settings/SettingsAboutTab'
import SettingsAITab from '@/components/settings/SettingsAITab'
import SettingsAppearanceTab from '@/components/settings/SettingsAppearanceTab'
import SettingsGeneralTab from '@/components/settings/SettingsGeneralTab'
import { ShopPanel } from '@/components/ShopPanel'
import { SpriteSheetPanel } from '@/components/SpriteSheetPanel'
import { WindowControls } from '@/components/WindowControls'
import { setLanguage as i18nSetLanguage } from '@/lib/system/i18n'
import { windowEventBus } from '@/lib/system/windowEventBus'
import { useSettingsStore } from '@/stores/settingsStore'

const selectLanguage = (s: ReturnType<typeof useSettingsStore.getState>) => s.language

type Tab =
  | 'ai'
  | 'appearance'
  | 'personality'
  | 'personalityEditor'
  | 'nurturing'
  | 'shop'
  | 'inventory'
  | 'memory'
  | 'achievements'
  | 'leaderboard'
  | 'schedule'
  | 'journal'
  | 'mods'
  | 'album'
  | 'data'
  | 'quick'
  | 'sprite'
  | 'mcp'
  | 'ondevice'
  | 'community'
  | 'general'
  | 'about'

/** H-3: Tab 分组定义（3 大类：基础 / 高级 / 关于） */
interface TabGroup {
  /** 分组标题 i18n key */ groupLabel: string
  /** 该组下的 Tab 列表 */
  tabs: { key: Tab; label: string; icon: typeof Bot }[]
}

/** 侧边栏分组定义（模块级常量，供跨窗口「打开指定标签页」事件校验使用） */
const TAB_GROUPS: TabGroup[] = [
  {
    groupLabel: 'settings.group.basic',
    tabs: [
      { key: 'ai', label: 'AI', icon: Bot },
      { key: 'appearance', label: '外观', icon: Palette },
      { key: 'personality', label: '性格', icon: SlidersHorizontal },
      { key: 'personalityEditor', label: '性格编辑', icon: Activity },
      { key: 'general', label: '通用', icon: SettingsIcon },
    ],
  },
  {
    groupLabel: 'settings.group.advanced',
    tabs: [
      { key: 'nurturing', label: '养成', icon: Heart },
      { key: 'shop', label: '商店', icon: ShoppingBag },
      { key: 'inventory', label: '背包', icon: Backpack },
      { key: 'memory', label: '记忆', icon: Brain },
      { key: 'achievements', label: '成就', icon: Trophy },
      { key: 'leaderboard', label: '排行', icon: Trophy },
      { key: 'schedule', label: '日程', icon: Calendar },
      { key: 'journal', label: '日记', icon: BookOpen },
      { key: 'album', label: '相册', icon: Camera },
      { key: 'community', label: '社区', icon: Users },
    ],
  },
  {
    groupLabel: 'settings.group.tools',
    tabs: [
      { key: 'mods', label: '模组', icon: Package },
      { key: 'data', label: '数据', icon: Database },
      { key: 'quick', label: '快捷', icon: Sliders },
      { key: 'sprite', label: '精灵图', icon: Grid3x3 },
      { key: 'mcp', label: 'MCP', icon: Plug },
      { key: 'ondevice', label: '端侧模型', icon: Cpu },
    ],
  },
  {
    groupLabel: 'settings.group.about',
    tabs: [{ key: 'about', label: '关于', icon: Info }],
  },
]

/** 兼容旧代码：扁平化 TABS 列表 */
const TABS: { key: Tab; label: string; icon: typeof Bot }[] = TAB_GROUPS.flatMap((g) => g.tabs)

/**
 * 设置主窗口
 *
 * 集成所有设置面板和管理功能的Tab式设置界面。
 */
export default function SettingsWindow() {
  const language = useSettingsStore(selectLanguage)

  const [tab, setTab] = useState<Tab>('ai')
  // A-4：记忆 Tab 视图模式（精简折叠列表 / 可视化）。默认精简，不回归旧行为
  const [memoryView, setMemoryView] = useState<'compact' | 'visual'>('compact')
  // AI 创建角色向导
  const [showWizard, setShowWizard] = useState(false)
  // 可视化角色创作工具
  const [showCreator, setShowCreator] = useState(false)
  // 角色导入向导
  const [showImporter, setShowImporter] = useState(false)
  // GIF 转精灵图工具
  const [showGifTool, setShowGifTool] = useState(false)

  // 初始化时同步 i18n 语言
  useEffect(() => {
    i18nSetLanguage(language)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 跨窗口「打开指定标签页」请求（如宠物右键菜单「换装」直达外观页）
  useEffect(() => {
    let unlisten: (() => void) | null = null
    void windowEventBus
      .on('open-settings-tab', (payload) => {
        if (TABS.some((t) => t.key === payload.tab)) {
          setTab(payload.tab as Tab)
        }
      })
      .then((fn) => {
        unlisten = fn
      })
    return () => {
      unlisten?.()
    }
  }, [])

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

  async function handleClose() {
    try {
      await getCurrentWindow().hide()
    } catch {
      // 忽略窗口操作错误
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-cream text-ink">
      {/* 无边框窗口标题栏 */}
      <div className="relative z-50 shrink-0">
        <WindowControls title="SpiritPal 设置" onClose={handleClose} />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 侧边栏 */}
        <div className="flex w-44 flex-col overflow-y-auto border-r border-ink/10 bg-cream-deep/60 p-3">
          <div className="mb-4 px-2 text-sm font-bold text-tangerine-deep">SpiritPal 设置</div>
          {TAB_GROUPS.map((group) => (
            <div key={group.groupLabel} className="mb-3">
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {group.groupLabel}
              </div>
              {group.tabs.map((t) => {
                const Icon = t.icon
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    aria-current={tab === t.key ? 'page' : undefined}
                    aria-label={`${t.label} 标签页`}
                    className={`spiritpal-focusable mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      tab === t.key ? 'bg-tangerine text-white' : 'text-ink-muted hover:bg-ink/5'
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" /> {t.label}
                  </button>
                )
              })}
            </div>
          ))}
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
          {tab === 'ai' && <SettingsAITab />}

          {tab === 'appearance' && (
            <SettingsAppearanceTab
              onOpenCreator={() => setShowCreator(true)}
              onOpenWizard={() => setShowWizard(true)}
              onOpenImporter={() => setShowImporter(true)}
            />
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
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">记忆管理</h2>
                <div className="flex overflow-hidden rounded-lg border border-ink/15">
                  <button
                    type="button"
                    onClick={() => setMemoryView('compact')}
                    className={`px-3 py-1 text-sm ${memoryView === 'compact' ? 'bg-tangerine text-white' : 'text-ink-muted hover:bg-cream-deep'}`}
                  >
                    精简
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemoryView('visual')}
                    className={`px-3 py-1 text-sm ${memoryView === 'visual' ? 'bg-tangerine text-white' : 'text-ink-muted hover:bg-cream-deep'}`}
                  >
                    可视化
                  </button>
                </div>
              </div>
              {memoryView === 'compact' ? (
                <MemoryPanel />
              ) : (
                <div className="overflow-auto">
                  <MemoryVisualizer />
                </div>
              )}
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

          {tab === 'journal' && <JournalPanel />}

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

          {tab === 'mcp' && (
            <div className="max-w-2xl">
              <h2 className="mb-4 text-lg font-semibold">MCP 管理</h2>
              <McpSettingsPanel />
            </div>
          )}

          {tab === 'ondevice' && (
            <div className="max-w-2xl">
              <h2 className="mb-4 text-lg font-semibold">端侧模型</h2>
              <OnDeviceModelPanel />
            </div>
          )}

          {tab === 'community' && (
            <div className="max-w-4xl">
              <h2 className="mb-1 text-lg font-semibold">社区形象</h2>
              <div className="mb-4 text-xs text-ink-faint">功能尚未完善，敬请期待后续版本。</div>
              <CommunityPanel />
            </div>
          )}

          {tab === 'general' && <SettingsGeneralTab />}

          {tab === 'about' && <SettingsAboutTab />}
        </div>
      </div>

      {/* AI 创建角色向导 */}
      {showWizard && <CharacterCreationWizard onClose={() => setShowWizard(false)} />}

      {/* 可视化角色创作工具 */}
      {showCreator && <CharacterCreator onClose={() => setShowCreator(false)} />}

      {/* 角色导入向导 */}
      {showImporter && <CharacterImportWizard onClose={() => setShowImporter(false)} />}

      {/* GIF 转精灵图工具 */}
      {showGifTool && <GifToSpriteTool onClose={() => setShowGifTool(false)} />}

      {/* 无边框窗口缩放手柄 */}
      <FramelessResizeHandles />
    </div>
  )
}
