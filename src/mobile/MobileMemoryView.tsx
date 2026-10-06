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
import { BarChart3, BookOpen, List, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EntityGraphView } from '@/components/memory/EntityGraphView'
import { MemoryPanel } from '@/components/MemoryPanel'
import { TagCloud, EmotionCurve, TimeDensityChart } from '@/components/MemoryVisualization'
import { getSemanticFacts, type SemanticFactRow } from '@/lib/data/db'
import { getEnhancedMemoryManager, type EnhancedMemory } from '@/lib/memory/enhancedMemory'
import { MobileCommitmentBar } from '@/mobile/MobileCommitmentBar'
import { usePetStore } from '@/stores/petStore'

/** 子页面类型 */
type SubView = 'viz' | 'list' | 'graph' | 'semantic'

/**
 * 移动端记忆视图组件
 * @returns 记忆界面组件
 */
export function MobileMemoryView() {
  const { t } = useTranslation()
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const [subView, setSubView] = useState<SubView>('viz')
  const [memories, setMemories] = useState<EnhancedMemory[]>([])
  // P3-7：语义事实只读列表（memory_semantic_facts 表）
  const [semanticFacts, setSemanticFacts] = useState<SemanticFactRow[]>([])
  const [semanticLoaded, setSemanticLoaded] = useState(false)

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

  // P3-7：语义事实加载（只读，进入该子页时惰性拉取 + 角色切换重取）
  useEffect(() => {
    if (subView !== 'semantic') return
    let cancelled = false
    void (async () => {
      try {
        const rows = await getSemanticFacts(currentCharacterId)
        if (cancelled) return
        setSemanticFacts(Array.isArray(rows) ? rows : [])
      } catch {
        if (!cancelled) setSemanticFacts([])
      } finally {
        if (!cancelled) setSemanticLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [subView, currentCharacterId])

  // 主题样式类（与移动端其他视图一致的语义 Token 配色）
  const bgClass = 'bg-cream'
  const textClass = 'text-ink'
  const subTabActiveClass = 'bg-tangerine text-white'
  const subTabInactiveClass = 'bg-cream-deep text-ink-muted'

  return (
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      {/* P1-7-fe: 到期/逾期约定提示（无数据时不渲染） */}
      <div className="px-3 pt-2">
        <MobileCommitmentBar />
      </div>
      {/* 子页面切换 */}
      <div className="flex gap-1 p-2">
        {([
          { id: 'viz', labelKey: 'memory.visual', icon: BarChart3 },
          { id: 'list', labelKey: 'memory.list', icon: List },
          { id: 'graph', labelKey: 'memory.graph', icon: Network },
          { id: 'semantic', labelKey: 'memory.semantic', icon: BookOpen },
        ] as const).map((tabDef) => {
          const Icon = tabDef.icon
          const isActive = subView === tabDef.id
          return (
            <button
              key={tabDef.id}
              onClick={() => setSubView(tabDef.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors ${
                isActive ? subTabActiveClass : subTabInactiveClass
              }`}
            >
              <Icon size={14} />
              {t(tabDef.labelKey)}
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

      {/* 记忆列表子页：复用桌面端 MemoryPanel。
          P2-6：embedded 变体——不渲染面板自带的「精简/可视化/图谱」切换条，
          视图选择统一由本页三个子页承担，消除「两处可视化」。 */}
      {subView === 'list' && (
        <div className="h-full overflow-hidden">
          <MemoryPanel variant="embedded" />
        </div>
      )}

      {/* P3-7：语义事实只读列表（memory_semantic_facts） */}
      {subView === 'semantic' && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
          {!semanticLoaded ? (
            <div className="py-8 text-center text-sm text-ink-muted">{t('memory.semanticLoading')}</div>
          ) : semanticFacts.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-muted">
              <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
              <p>{t('memory.semanticEmpty')}</p>
              <p className="mt-1 text-xs text-ink-faint">{t('memory.semanticEmptyHint')}</p>
            </div>
          ) : (
            semanticFacts.map((fact) => (
              <div
                key={fact.id ?? `${fact.fact_key}-${fact.fact_value}`}
                className={`rounded-xl border border-ink/10 bg-surface p-3`}
                data-testid="semantic-fact-card"
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-cream-deep px-1.5 py-0.5 text-[10px] text-ink-muted">
                    {fact.fact_key}
                  </span>
                  <span className="text-[10px] text-ink-faint">
                    {t('memory.semanticImportance', { score: Math.round(fact.importance) })}
                  </span>
                  <span className="ml-auto text-[10px] text-ink-faint">
                    {new Date(fact.updated_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-1 text-sm text-ink">{fact.fact_value}</div>
                <div className="mt-0.5 text-[10px] text-ink-faint">
                  {t('memory.semanticSources', {
                    count: (() => {
                      // P3-7 实机发现：DB 读回的 source_memory_ids 是 JSON 字符串，.length 会取字符数
                      if (Array.isArray(fact.source_memory_ids)) return fact.source_memory_ids.length
                      try {
                        const parsed = JSON.parse(fact.source_memory_ids as unknown as string)
                        return Array.isArray(parsed) ? parsed.length : 0
                      } catch {
                        return 0
                      }
                    })(),
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* P1-3-fe：实体图谱子页——复用桌面 Canvas 力导向视图 + 诚实的数据来源说明 */}
      {subView === 'graph' && (
        <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 pb-4">
          <p className="text-[10px] leading-4 text-ink-faint">{t('memory.graphHint')}</p>
          <div className="min-h-0 flex-1">
            <EntityGraphView
              emptyTitle={t('memory.graphEmpty')}
              emptyHint={t('memory.graphEmptyHint')}
            />
          </div>
        </div>
      )}
    </div>
  )
}
