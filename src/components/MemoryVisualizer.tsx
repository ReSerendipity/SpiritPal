/**
 * @file MemoryVisualizer.tsx
 * @description 记忆可视化面板 — 四 Tab 完整 UI（时间线/语义搜索/情绪分布/知识图谱）
 *
 * 特性：
 * - Tab 1: 时间线视图 - 按时间顺序展示关键帧和记忆条目
 * - Tab 2: 语义搜索 - 支持关键词搜索记忆内容
 * - Tab 3: 情绪分布 - 图表化展示情绪变化趋势
 * - Tab 4: 知识图谱 - 交互式关系网络图
 *
 * 参考：Live2DPet memory_panel.py / OpenPets packages/ui/memory-panel/
 */

import React, { useState, useEffect, useMemo } from 'react'
import { getKeyframeMemory, type Keyframe, KeyframeLevel } from '../lib/keyframeMemory'
import { useEnhancedMemory } from '../hooks/useEnhancedMemory'
import { usePetStore } from '../stores/petStore'
import { getContextAwarenessManager, type WorkStateInfo } from '../lib/contextAwareness'
// A-10：情绪分布改用 emotionEngine 的真实今日统计（此前是 Math.random() 假数据）
import { getEmotionStateManager } from '../lib/emotionEngine'
import type { MemoryEntry } from '../lib/types'

/** 情绪中文标签（覆盖 emotionEngine 的全部 9 类基础情绪） */
const EMOTION_LABELS: Record<string, string> = {
  happy: '开心',
  sad: '难过',
  angry: '生气',
  excited: '兴奋',
  calm: '平静',
  confused: '困惑',
  tired: '疲惫',
  surprised: '惊讶',
  neutral: '中性',
}

const EMOTION_COLORS: Record<string, string> = {
  happy: '#4caf50',
  sad: '#2196f3',
  angry: '#f44336',
  excited: '#ff9800',
  calm: '#00bcd4',
  confused: '#9c27b0',
  tired: '#795548',
  surprised: '#ffc107',
  neutral: '#9e9e9e',
}

// ============ 样式常量 ============

const TABS = [
  { id: 'timeline', label: '时间线' },
  { id: 'search', label: '搜索' },
  { id: 'emotion', label: '情绪' },
  { id: 'graph', label: '图谱' },
] as const

type TabId = typeof TABS[number]['id']

const styles = {
  container: {
    width: '800px',
    height: '600px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #e0e0e0',
    backgroundColor: '#f5f5f5',
  },
  tab: (active: boolean) => ({
    flex: 1,
    padding: '12px 16px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    color: active ? '#1976d2' : '#666',
    borderBottom: active ? '2px solid #1976d2' : '2px solid transparent',
    transition: 'all 0.2s ease',
  }),
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '16px',
  },
  // 时间线样式
  timelineItem: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
    borderLeft: '3px solid #1976d2',
  },
  timestamp: {
    fontSize: '12px',
    color: '#999',
    minWidth: '80px',
  },
  contentText: {
    fontSize: '14px',
    lineHeight: 1.6,
    color: '#333',
  },
  levelBadge: (level: KeyframeLevel) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 600,
    backgroundColor: level === KeyframeLevel.L0 ? '#4caf50' : level === KeyframeLevel.L1 ? '#ff9800' : '#9c27b0',
    color: '#fff',
    marginRight: '8px',
  }),
  // 搜索样式
  searchInput: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    outline: 'none',
    marginBottom: '16px',
    boxSizing: 'border-box' as const,
  },
  resultItem: {
    padding: '12px',
    marginBottom: '8px',
    backgroundColor: '#fff',
    border: '1px solid #eee',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  // 情绪样式
  emotionChart: {
    width: '100%',
    height: '300px',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
    padding: '16px',
  },
  emotionBar: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '8px',
  },
  emotionLabel: {
    width: '80px',
    fontSize: '14px',
    color: '#666',
  },
  emotionBarFill: (value: number, color: string) => ({
    width: `${Math.min(value, 100)}%`,
    height: '20px',
    backgroundColor: color,
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  }),
  // 图谱样式
  graphCanvas: {
    width: '100%',
    height: '400px',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
  },
}

// ============ 时间线视图组件 ============

const TimelineView: React.FC = () => {
  const keyframeMem = getKeyframeMemory()
  const { getMemoryByTimeRange } = useEnhancedMemory()
  
  const frames = useMemo(() => {
    return keyframeMem.getAllFrames().sort((a, b) => b.timestamp - a.timestamp)
  }, [])

  // eslint-disable-next-line react-hooks/purity -- Date.now() 用于时间范围查询，仅在渲染期调用一次
  const timeRange = getMemoryByTimeRange(Date.now() - 24 * 60 * 60 * 1000, Date.now())

  const formatTime = (ts: number): string => {
    const date = new Date(ts)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={styles.content}>
      <h3 style={{ marginBottom: '16px', color: '#333' }}>最近 24 小时记忆</h3>
      
      {/* 关键帧时间线 */}
      <div style={{ marginBottom: '24px' }}>
        <h4 style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>视觉关键帧</h4>
        {frames.slice(0, 10).map((frame, idx) => (
          <div key={idx} style={styles.timelineItem}>
            <div style={styles.timestamp}>{formatTime(frame.timestamp)}</div>
            <div style={{ flex: 1 }}>
              <span style={styles.levelBadge(frame.level)}>{frame.level}</span>
              <span style={styles.contentText}>
                {frame.label || '屏幕截图'}
                {frame.windowInfo && ` (${frame.windowInfo})`}
              </span>
            </div>
          </div>
        ))}
        {frames.length === 0 && (
          <p style={{ color: '#999', textAlign: 'center' }}>暂无关键帧记录</p>
        )}
      </div>

      {/* 对话记忆时间线 */}
      <div>
        <h4 style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>对话记忆</h4>
        {timeRange.entries.slice(0, 5).map((entry: MemoryEntry, idx: number) => (
          <div key={idx} style={styles.timelineItem}>
            <div style={styles.timestamp}>{formatTime(new Date(entry.created_at).getTime())}</div>
            <div style={{ flex: 1 }}>
              <p style={{ ...styles.contentText, marginBottom: '4px' }}><strong>主人：</strong>{entry.user}</p>
              <p style={{ ...styles.contentText, color: '#666' }}><strong>宠物：</strong>{entry.assistant}</p>
            </div>
          </div>
        ))}
        {timeRange.entries.length === 0 && (
          <p style={{ color: '#999', textAlign: 'center' }}>暂无对话记录</p>
        )}
      </div>
    </div>
  )
}

// ============ 搜索视图组件 ============

const SearchView: React.FC = () => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ user: string; assistant: string; created_at: string }>>([])
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const { searchMemory, searchMemoryEnhanced } = useEnhancedMemory(currentCharacterId)

  useEffect(() => {
    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 清空搜索结果
      setResults([])
      return
    }
    // 本地时序索引即时命中（保持原同步契约）
    const found = searchMemory(query)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 搜索结果需要同步更新到 UI
    setResults(found)
    // B2（ADR-0003）：cognee 长期记忆增强检索，异步合并去重；
    // sidecar 离线/无结果时静默保持本地结果（cogneeClient 已做降级）。
    let cancelled = false
    void searchMemoryEnhanced(query).then((remote) => {
      if (cancelled || remote.length === 0) return
      setResults((prev) => {
        const seen = new Set(prev.map((e) => `${e.user}\n${e.assistant}`))
        const merged = [...prev]
        for (const r of remote) {
          const key = `${r.user}\n${r.assistant}`
          if (!seen.has(key)) {
            merged.push(r)
            seen.add(key)
          }
        }
        return merged
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchMemory/searchMemoryEnhanced 每次渲染重建，纳入依赖会因 setResults 重渲染而循环
  }, [query])

  const highlightText = (text: string, highlight: string): React.ReactNode => {
    if (!highlight.trim()) return text
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'))
    return parts.map((part, i) => 
      part.toLowerCase() === highlight.toLowerCase() 
        ? <mark key={i} style={{ backgroundColor: '#ffeb3b' }}>{part}</mark>
        : part
    )
  }

  return (
    <div style={styles.content}>
      <h3 style={{ marginBottom: '16px', color: '#333' }}>记忆搜索</h3>
      
      <input
        type="text"
        placeholder="搜索记忆内容..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={styles.searchInput}
      />

      {results.length > 0 ? (
        results.map((entry, idx) => (
          <div key={idx} style={styles.resultItem}>
            <p style={{ marginBottom: '4px' }}>
              <strong>主人：</strong>
              {highlightText(entry.user, query)}
            </p>
            <p style={{ color: '#666', marginBottom: '8px' }}>
              <strong>宠物：</strong>
              {highlightText(entry.assistant, query)}
            </p>
            <small style={{ color: '#999' }}>
              {new Date(entry.created_at).toLocaleString('zh-CN')}
            </small>
          </div>
        ))
      ) : (
        query && <p style={{ color: '#999', textAlign: 'center' }}>未找到相关记忆</p>
      )}
    </div>
  )
}

// ============ 情绪视图组件 ============

const EmotionView: React.FC = () => {
  // A-10：真实数据源 —— emotionEngine 的今日情绪计数（由 ChatWindow 每次对话回写更新）。
  // 此前这里用 Math.random() 生成"模拟情绪统计"，属静默假实现（界面看起来有数据，实际与用户无关）。
  const [emotionStats, setEmotionStats] = useState<Record<string, number>>(() =>
    getEmotionStateManager().getState().todayStats,
  )

  useEffect(() => {
    let cancelled = false
    const read = () => {
      const stats = getEmotionStateManager().getState().todayStats
      if (!cancelled) setEmotionStats(stats)
    }
    read()
    // 对话会持续更新情绪状态，轻量轮询让图表跟随（只读内存对象，开销可忽略）
    const timer = window.setInterval(read, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  // 真实统计为计数，展示前换算为百分比
  const total = Object.values(emotionStats).reduce((sum, n) => sum + n, 0)
  const pctOf = (n: number) => (total > 0 ? (n / total) * 100 : 0)
  const happyRatio = pctOf(emotionStats.happy ?? 0)
  const negativeRatio =
    pctOf(emotionStats.sad ?? 0) + pctOf(emotionStats.tired ?? 0) + pctOf(emotionStats.angry ?? 0)

  return (
    <div style={styles.content}>
      <h3 style={{ marginBottom: '16px', color: '#333' }}>情绪分布分析</h3>

      {total === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#999', fontSize: '14px' }}>
          今天还没有情绪记录
          <div style={{ marginTop: '8px', fontSize: '12px' }}>
            和宠物聊聊天，这里就会统计出真实的情绪分布
          </div>
        </div>
      ) : (
        <>
          <div style={styles.emotionChart}>
            {Object.entries(emotionStats)
              .filter(([, count]) => count > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => (
                <div key={label} style={styles.emotionBar}>
                  <div style={styles.emotionLabel}>{EMOTION_LABELS[label] ?? label}</div>
                  <div style={{ flex: 1, marginLeft: '8px' }}>
                    <div
                      style={styles.emotionBarFill(
                        pctOf(count),
                        EMOTION_COLORS[label] ?? '#9e9e9e',
                      )}
                    />
                  </div>
                  <div
                    style={{ width: '40px', textAlign: 'right', fontSize: '12px', color: '#999' }}
                  >
                    {Math.round(pctOf(count))}%
                  </div>
                </div>
              ))}
          </div>

          <div
            style={{
              marginTop: '24px',
              padding: '12px',
              backgroundColor: '#e3f2fd',
              borderRadius: '6px',
            }}
          >
            <p style={{ fontSize: '13px', color: '#1976d2', marginBottom: '8px' }}>
              <strong>💡 分析建议</strong>
            </p>
            <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>
              {happyRatio > 50
                ? '主人今天心情很好！可以继续互动增强亲密度～'
                : negativeRatio > 40
                ? '主人似乎有些疲惫或难过，要不要休息一下？'
                : '主人状态平稳，适合专注工作或适度放松～'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ============ 图谱视图组件 ============

const GraphView: React.FC = () => {
  const [nodes, setNodes] = useState<Array<{ id: string; label: string; category: string }>>([])
  const [links, setLinks] = useState<Array<{ source: string; target: string; relation: string }>>([])

  useEffect(() => {
    // 模拟知识图谱数据（实际应从 enhanced memory 提取实体关系）
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始化模拟图谱数据，仅执行一次
    setNodes([
      { id: 'user', label: '主人', category: 'person' },
      { id: 'pet', label: 'SpiritPal', category: 'pet' },
      { id: 'coding', label: '写代码', category: 'activity' },
      { id: 'meeting', label: '开会', category: 'activity' },
      { id: 'game', label: '玩游戏', category: 'activity' },
      { id: ' vscode', label: 'VS Code', category: 'app' },
      { id: 'feishu', label: '飞书', category: 'app' },
    ])

    setLinks([
      { source: 'user', target: 'coding', relation: '正在进行' },
      { source: 'user', target: 'meeting', relation: '经常参加' },
      { source: 'user', target: 'game', relation: '休闲时' },
      { source: 'coding', target: 'vscode', relation: '使用工具' },
      { source: 'meeting', target: 'feishu', relation: '使用工具' },
      { source: 'pet', target: 'coding', relation: '陪伴' },
      { source: 'pet', target: 'user', relation: '服务' },
    ])
  }, [])

  const categoryColors: Record<string, string> = {
    person: '#f44336',
    pet: '#4caf50',
    activity: '#2196f3',
    app: '#ff9800',
  }

  return (
    <div style={styles.content}>
      <h3 style={{ marginBottom: '16px', color: '#333' }}>知识图谱</h3>
      
      <div style={styles.graphCanvas}>
        <svg width="100%" height="100%" viewBox="0 0 768 400">
          {/* 连接线 */}
          {links.map((link, idx) => {
            const source = nodes.find(n => n.id === link.source)
            const target = nodes.find(n => n.id === link.target)
            if (!source || !target) return null
            
            // 简化布局：水平排列节点
            const sourceX = 100
            const targetX = 600
            const sourceY = 80 + (nodes.indexOf(source) * 40)
            const targetY = 80 + (nodes.indexOf(target) * 40)
            
            return (
              <line
                key={idx}
                x1={sourceX}
                y1={sourceY}
                x2={targetX}
                y2={targetY}
                stroke="#ddd"
                strokeWidth="2"
              />
            )
          })}

          {/* 节点 */}
          {nodes.map((node, idx) => {
            const x = idx % 2 === 0 ? 100 : 600
            const y = 80 + idx * 35
            
            return (
              <g key={node.id}>
                <circle
                  cx={x}
                  cy={y}
                  r="20"
                  fill={categoryColors[node.category]}
                  opacity="0.8"
                />
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="10"
                  fontWeight="bold"
                >
                  {node.label.substring(0, 2)}
                </text>
                <text
                  x={x}
                  y={y + 28}
                  textAnchor="middle"
                  fill="#666"
                  fontSize="11"
                >
                  {node.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div style={{ marginTop: '16px', fontSize: '12px', color: '#999' }}>
        <p>🔴 人物 | 🟢 宠物 | 🔵 活动 | 🟠 应用</p>
      </div>
    </div>
  )
}

// ============ 主组件 ============

export const MemoryVisualizer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('timeline')

  const renderContent = () => {
    switch (activeTab) {
      case 'timeline':
        return <TimelineView />
      case 'search':
        return <SearchView />
      case 'emotion':
        return <EmotionView />
      case 'graph':
        return <GraphView />
      default:
        return <TimelineView />
    }
  }

  return (
    <div style={styles.container}>
      {/* Tab 栏 */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={styles.tab(activeTab === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      {renderContent()}
    </div>
  )
}

export default MemoryVisualizer
