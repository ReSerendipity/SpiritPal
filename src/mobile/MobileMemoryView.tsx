/**
 * 移动端记忆视图组件
 * @module mobile/MobileMemoryView
 * @description
 * 移动端记忆查看界面，包含两个子页面：
 * - 可视化：标签云 + 情感曲线（近 30 天）+ 记忆密度（近 12 个月）
 * - 记忆列表：三层记忆（主人画像 / 我们的故事 / 日记）
 *
 * 数据与桌面端同源（enhancedMemory / ownerFacts / petExperience / diarySystem），
 * 视觉沿用语义 Token（cream/surface/ink/tangerine）。
 *
 * @see {@link ./MobileSettingsView} 移动端设置视图（入口宿主）
 * @see {@link ../lib/enhancedMemory} 增强记忆管理器
 * @see {@link ../components/MemoryPanel} 桌面端三层记忆面板（复用）
 * @see {@link ../components/MemoryVisualization} 记忆可视化组件（复用）
 */
import { useEffect, useState } from 'react'
import { BarChart3, List } from 'lucide-react'
import { usePetStore } from '../stores/petStore'
import { getEnhancedMemoryManager, type EnhancedMemory } from '../lib/enhancedMemory'
import { MemoryPanel } from '../components/MemoryPanel'
import { TagCloud, EmotionCurve, TimeDensityChart } from '../components/MemoryVisualization'

/** 子页面类型 */
type SubView = 'viz' | 'list'

/**
 * 移动端记忆视图组件
 * @returns 记忆界面组件
 */
export function MobileMemoryView() {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const [subView, setSubView] = useState<SubView>('viz')
  const [memories, setMemories] = useState<EnhancedMemory[]>([])

  // 异步加载全部记忆（可视化图表数据源）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const mgr = getEnhancedMemoryManager(currentCharacterId)
      await mgr.ensureLoaded()
      if (cancelled) return
      setMemories(mgr.getAllMemories())
    })()
    return () => {
      cancelled = true
    }
  }, [currentCharacterId])

  // 主题样式类（与移动端其他视图一致的语义 Token 配色）
  const bgClass = 'bg-cream'
  const textClass = 'text-ink'
  const subTabActiveClass = 'bg-tangerine text-white'
  const subTabInactiveClass = 'bg-cream-deep text-ink-muted'

  return (
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      {/* 子页面切换 */}
      <div className="flex gap-1 p-2">
        {([
          { id: 'viz', label: '可视化', icon: BarChart3 },
          { id: 'list', label: '记忆列表', icon: List },
        ] as const).map((t) => {
          const Icon = t.icon
          const isActive = subView === t.id
          return (
            <button
              key={t.id}
              onClick={() => setSubView(t.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors ${
                isActive ? subTabActiveClass : subTabInactiveClass
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 可视化子页 */}
      {subView === 'viz' && (
        <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-4">
          <TagCloud memories={memories} />
          <EmotionCurve memories={memories} />
          <TimeDensityChart memories={memories} />
        </div>
      )}

      {/* 记忆列表子页：复用桌面端 MemoryPanel（内部自带滚动） */}
      {subView === 'list' && (
        <div className="h-full overflow-hidden">
          <MemoryPanel />
        </div>
      )}
    </div>
  )
}
