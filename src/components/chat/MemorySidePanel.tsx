/**
 * 右侧记忆面板组件
 *
 * 可收起的右侧面板，展示宠物的记忆系统。
 * Tab 切换：短期记忆 | 长期记忆 | 实体图谱 | 用户画像
 * 复用现有 EnhancedMemoryList、EntityGraphView、MemoryPanel 中的 OwnerFacts 逻辑。
 */
import { useState, useEffect } from 'react'
import { X, Brain, Layers, Network, User } from 'lucide-react'
import { usePetStore } from '@/stores/petStore'
import { getEnhancedMemoryManager } from '@/lib/memory/enhancedMemory'
import { getOwnerFactsManager, type OwnerFact } from '@/lib/memory/ownerFacts'
import { EnhancedMemoryList } from '@/components/memory/EnhancedMemoryList'
import EntityGraphView from '@/components/memory/EntityGraphView'
import type { MemoryEntry } from '@/lib/data/types'

interface MemorySidePanelProps {
  /** 关闭面板的回调 */
  onClose: () => void
}

type MemoryTab = 'short' | 'long' | 'graph' | 'profile'

const TAB_CONFIG: { id: MemoryTab; label: string; icon: typeof Brain }[] = [
  { id: 'short', label: '短期', icon: Brain },
  { id: 'long', label: '长期', icon: Layers },
  { id: 'graph', label: '图谱', icon: Network },
  { id: 'profile', label: '画像', icon: User },
]

export function MemorySidePanel({ onClose }: MemorySidePanelProps) {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const [activeTab, setActiveTab] = useState<MemoryTab>('short')

  // 短期记忆（工作记忆）
  const [workingMemories, setWorkingMemories] = useState<MemoryEntry[]>([])
  // 用户画像
  const [facts, setFacts] = useState<OwnerFact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const mgr = getEnhancedMemoryManager(currentCharacterId)
        await mgr.ensureLoaded()
        if (cancelled) return
        setWorkingMemories(mgr.getWorkingMemories())

        const factsMgr = getOwnerFactsManager(currentCharacterId)
        await factsMgr.ensureLoaded()
        if (cancelled) return
        setFacts(factsMgr.getAllFacts())
      } catch {
        // 记忆加载失败不阻塞 UI
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [currentCharacterId])

  return (
    <div className="flex h-full w-72 flex-col border-l border-ink/10 bg-cream-deep">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-medium text-ink">记忆</span>
        <button
          onClick={onClose}
          className="spiritpal-focusable rounded-md p-1.5 text-ink-faint hover:bg-ink/8"
          title="关闭记忆面板"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tab 栏 */}
      <div className="flex border-b border-ink/10 px-2">
        {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-t-md px-2 py-1.5 text-[11px] transition-colors ${
              activeTab === id
                ? 'bg-surface text-tangerine-deep font-medium'
                : 'text-ink-faint hover:text-ink'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="flex h-32 items-center justify-center text-xs text-ink-faint">
            加载记忆中…
          </div>
        )}

        {!loading && activeTab === 'short' && (
          <div>
            <div className="mb-2 text-[11px] text-ink-faint">
              工作记忆（最近 {workingMemories.length} 条对话）
            </div>
            {workingMemories.length === 0 ? (
              <div className="py-4 text-center text-xs text-ink-faint">暂无短期记忆</div>
            ) : (
              <div className="space-y-1.5">
                {workingMemories.slice(-10).reverse().map((mem, i) => (
                  <div key={i} className="rounded-lg border border-ink/8 bg-surface px-2.5 py-2 text-xs">
                    <div className="truncate text-ink">{mem.user}</div>
                    <div className="mt-0.5 truncate text-ink-faint">{mem.assistant}</div>
                    <div className="mt-1 text-[10px] text-ink-faint/60">
                      {new Date(mem.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === 'long' && (
          <div>
            <div className="mb-2 text-[11px] text-ink-faint">长期记忆</div>
            <EnhancedMemoryList />
          </div>
        )}

        {!loading && activeTab === 'graph' && (
          <EntityGraphView />
        )}

        {!loading && activeTab === 'profile' && (
          <div>
            <div className="mb-2 text-[11px] text-ink-faint">
              关于你（{facts.length} 条已知信息）
            </div>
            {facts.length === 0 ? (
              <div className="py-4 text-center text-xs text-ink-faint">
                还没有关于你的画像信息
              </div>
            ) : (
              <div className="space-y-1.5">
                {facts.map((fact) => (
                  <div key={fact.key} className="rounded-lg border border-ink/8 bg-surface px-2.5 py-2 text-xs">
                    <span className="font-medium text-tangerine-deep">{fact.key}</span>
                    <span className="mx-1 text-ink-faint">:</span>
                    <span className="text-ink">{fact.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
