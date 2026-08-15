/**
 * 移动端主应用组件
 * @module mobile/MobileApp
 * @description
 * 移动端入口组件（懒加载），提供全屏 Live2D 宠物展示 + 底部 Tab 导航 + 手势交互。
 *
 * 功能特性：
 * - 四个 Tab 页：宠物/聊天/养成/设置
 * - 左右滑动手势切换 Tab
 * - 底部 Tab 栏点击切换
 * - 深浅色主题切换按钮
 * - 同步状态显示
 * - 应用启动时自动计算离线衰减
 *
 * 手势支持：
 * - 左右滑动切换 Tab（阈值 50px）
 * - 底部 Tab 点击切换
 * - 右上角主题切换按钮
 *
 * @see {@link ./MobilePetView} 宠物视图组件
 * @see {@link ./MobileChatView} 聊天视图组件
 * @see {@link ./MobileNurturingView} 养成视图组件
 * @see {@link ./MobileSettingsView} 设置视图组件
 * @see {@link ../lib/themeManager} 主题管理器
 * @see {@link ../lib/syncManager} 同步管理器
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Cat, MessageCircle, Heart, Settings as SettingsIcon, Sun, Moon } from 'lucide-react'
import { themeManager, type EffectiveTheme, type ThemeMode } from '../lib/themeManager'
import { syncManager, type SyncStatus } from '../lib/syncManager'
import { usePetStore } from '../stores/petStore'
import { MobilePetView } from './MobilePetView'
import { MobileChatView } from './MobileChatView'
import { MobileNurturingView } from './MobileNurturingView'
import { MobileSettingsView } from './MobileSettingsView'

/** Tab 页 ID 类型 */
type TabId = 'pet' | 'chat' | 'nurture' | 'settings'

/**
 * Tab 定义接口
 */
interface TabDef {
  /** Tab ID */
  id: TabId
  /** Tab 显示标签 */
  label: string
  /** Tab 图标组件 */
  icon: typeof Cat
}

/** Tab 配置列表 */
const TABS: TabDef[] = [
  { id: 'pet', label: '宠物', icon: Cat },
  { id: 'chat', label: '聊天', icon: MessageCircle },
  { id: 'nurture', label: '养成', icon: Heart },
  { id: 'settings', label: '设置', icon: SettingsIcon },
]

/** 滑动切换 Tab 的最小距离阈值（像素） */
const SWIPE_THRESHOLD = 50

/**
 * 移动端主应用组件
 * @returns 移动端应用根组件
 */
export default function MobileApp() {
  const [activeTab, setActiveTab] = useState<TabId>('pet')
  const [theme, setTheme] = useState<EffectiveTheme>(themeManager.getEffective())
  const [themeMode, setThemeMode] = useState<ThemeMode>(themeManager.getMode())
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncManager.getStatus())

  // 手势状态 ref
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)

  // 初始化主题管理器 + 订阅主题变化
  useEffect(() => {
    themeManager.init()
    const unsub = themeManager.subscribe((effective, mode) => {
      setTheme(effective)
      setThemeMode(mode)
    })
    return unsub
  }, [])

  // 订阅同步状态
  useEffect(() => {
    const unsub = syncManager.subscribe((status) => setSyncStatus(status))
    return unsub
  }, [])

  // 应用离线衰减（与桌面端 PetWindow 保持一致）
  const applyOfflineDecay = usePetStore((s) => s.applyOfflineDecay)
  useEffect(() => {
    applyOfflineDecay()
  }, [applyOfflineDecay])

  /**
   * 切换主题模式（浅/深/系统循环切换）
   */
  const toggleTheme = useCallback(() => {
    themeManager.toggle()
  }, [])

  // ===== 手势：左右滑动切换 Tab =====
  /**
   * 触摸开始事件处理
   * @param e React 触摸事件
   */
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }, [])

  /**
   * 触摸结束事件处理：判断滑动方向并切换 Tab
   * @param e React 触摸事件
   */
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = touchStartRef.current
    if (!start) return
    touchStartRef.current = null
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // 仅在水平滑动距离 > 阈值且大于垂直滑动时触发
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const idx = TABS.findIndex((tab) => tab.id === activeTab)
      if (dx < 0 && idx < TABS.length - 1) {
        // 左滑：下一个 Tab
        setActiveTab(TABS[idx + 1].id)
      } else if (dx > 0 && idx > 0) {
        // 右滑：上一个 Tab
        setActiveTab(TABS[idx - 1].id)
      }
    }
  }, [activeTab])

  // 主题相关的样式类
  const isDark = theme === 'dark'
  const bgClass = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const textClass = isDark ? 'text-gray-100' : 'text-gray-900'
  const tabBarClass = isDark
    ? 'bg-gray-800/95 border-gray-700'
    : 'bg-white/95 border-gray-200'
  const activeTabClass = isDark ? 'text-indigo-400' : 'text-indigo-600'
  const inactiveTabClass = isDark ? 'text-gray-500' : 'text-gray-400'

  return (
    <div
      className={`flex h-[100dvh] w-screen flex-col ${bgClass} ${textClass} overflow-hidden`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 顶部状态栏 */}
      <header
        className={`flex items-center justify-between px-4 py-2 ${
          isDark ? 'bg-gray-800/80' : 'bg-white/80'
        } backdrop-blur-sm`}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">SpiritPal</span>
          {syncStatus === 'syncing' && (
            <span className="text-xs text-blue-400">同步中…</span>
          )}
          {syncStatus === 'success' && (
            <span className="text-xs text-green-400">已同步</span>
          )}
          {syncStatus === 'error' && (
            <span className="text-xs text-red-400">同步失败</span>
          )}
        </div>
        <button
          onClick={toggleTheme}
          className={`flex h-9 w-9 items-center justify-center rounded-full ${
            isDark ? 'bg-gray-700 text-yellow-300' : 'bg-gray-100 text-gray-700'
          }`}
          aria-label="切换主题"
          title={`当前: ${themeMode}`}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      {/* 内容区：全屏 Live2D 宠物始终渲染，其他 Tab 叠加在上层 */}
      <main className="relative flex-1 overflow-hidden">
        {/* 宠物视图始终挂载（保持 Live2D 模型不销毁）*/}
        <div className={`absolute inset-0 ${activeTab === 'pet' ? 'z-10' : 'z-0'}`}>
          <MobilePetView isActive={activeTab === 'pet'} isDark={isDark} />
        </div>

        {/* 聊天视图 */}
        {activeTab === 'chat' && (
          <div className="absolute inset-0 z-20">
            <MobileChatView isDark={isDark} />
          </div>
        )}

        {/* 养成视图 */}
        {activeTab === 'nurture' && (
          <div className="absolute inset-0 z-20 overflow-y-auto">
            <MobileNurturingView isDark={isDark} />
          </div>
        )}

        {/* 设置视图 */}
        {activeTab === 'settings' && (
          <div className="absolute inset-0 z-20 overflow-y-auto">
            <MobileSettingsView isDark={isDark} />
          </div>
        )}
      </main>

      {/* 底部 Tab 导航 */}
      <nav
        className={`flex items-center justify-around border-t ${tabBarClass} pb-[env(safe-area-inset-bottom)] backdrop-blur-md`}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors ${
                isActive ? activeTabClass : inactiveTabClass
              }`}
            >
              <Icon size={22} />
              <span className="text-[10px]">{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
