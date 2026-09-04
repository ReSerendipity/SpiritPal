/**
 * 记忆可视化组件集合
 *
 * 功能概述：
 * - TagCloud: 标签云组件，按频率显示记忆标签，频率越高字号越大
 * - EmotionCurve: 情感曲线组件，近30天情感强度变化折线图（SVG绘制）
 * - TimeDensityChart: 时间密度图组件，近12个月记忆数量柱状图
 * - P3-25: 增强用户对记忆的感知，时间轴+标签云+情感曲线
 *
 * 核心Hooks/状态：
 * - useMemo: 计算标签频率、每日情感聚合、月度记忆计数
 */
import { useMemo, useState, useCallback } from 'react'
import { Tag, TrendingUp, BarChart3, Calendar } from 'lucide-react'
import type { EnhancedMemory } from '@/lib/memory/enhancedMemory'

// ============ 标签云 ============

/** 标签云组件Props */
interface TagCloudProps {
  /** 记忆列表 */
  memories: EnhancedMemory[]
  /** 选择标签回调 */
  onSelectTag?: (tag: string) => void
  /** 当前选中的标签 */
  selectedTag?: string | null
}

/**
 * 标签云组件
 *
 * 按频率显示所有记忆标签，频率越高字号越大、颜色越亮，
 * 点击标签可触发筛选，最多显示30个标签。
 */
export function TagCloud({ memories, onSelectTag, selectedTag }: TagCloudProps) {
  const tagStats = useMemo(() => {
    const freq = new Map<string, number>()
    for (const mem of memories) {
      for (const tag of mem.tags) {
        freq.set(tag, (freq.get(tag) ?? 0) + 1)
      }
    }
    // 按频率降序排序
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30) // 最多显示 30 个标签
  }, [memories])

  if (tagStats.length === 0) {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <Tag size={14} className="text-tangerine" />
          <h4 className="text-xs font-semibold text-ink">标签云</h4>
        </div>
        <div className="py-4 text-center text-[11px] text-ink-faint">暂无标签数据</div>
      </div>
    )
  }

  const maxFreq = tagStats[0][1]
  const minFreq = tagStats[tagStats.length - 1][1]

  function getTagSize(freq: number): string {
    if (maxFreq === minFreq) return 'text-sm'
    const ratio = (freq - minFreq) / (maxFreq - minFreq)
    if (ratio > 0.75) return 'text-lg font-bold'
    if (ratio > 0.5) return 'text-base font-semibold'
    if (ratio > 0.25) return 'text-sm font-medium'
    return 'text-xs'
  }

  function getTagColor(freq: number): string {
    if (maxFreq === minFreq) return 'text-tangerine-deep'
    const ratio = (freq - minFreq) / (maxFreq - minFreq)
    if (ratio > 0.75) return 'text-tangerine'
    if (ratio > 0.5) return 'text-tangerine-deep'
    if (ratio > 0.25) return 'text-ink-muted'
    return 'text-ink-faint'
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Tag size={14} className="text-tangerine" />
        <h4 className="text-xs font-semibold text-ink">标签云</h4>
        <span className="text-[10px] text-ink-faint">（{tagStats.length} 个标签）</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tagStats.map(([tag, freq]) => (
          <button
            key={tag}
            onClick={() => onSelectTag?.(tag)}
            className={`rounded px-1.5 py-0.5 transition-colors ${getTagSize(freq)} ${getTagColor(freq)} ${
              selectedTag === tag
                ? 'bg-amber-400/20 ring-1 ring-amber-400'
                : 'hover:bg-ink/5'
            }`}
            title={`${tag}: ${freq} 条记忆`}
          >
            #{tag}
            {freq > 1 && <span className="ml-0.5 text-[9px] opacity-50">({freq})</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ============ 情感曲线 ============

/** 情感曲线组件Props */
interface EmotionCurveProps {
  /** 记忆列表 */
  memories: EnhancedMemory[]
}

/**
 * 情感曲线组件
 *
 * 使用SVG绘制近30天记忆情感强度变化折线图，
 * 带填充区域和数据点，按天聚合平均情感强度，
 * 高/中/低情感用不同颜色数据点区分。
 */
export function EmotionCurve({ memories }: EmotionCurveProps) {
  // "当前时间"在组件挂载时固定一次（惰性初始化），避免渲染期调用不纯函数 Date.now()
  const [now] = useState(() => Date.now())
  const chartData = useMemo(() => {
    // 取最近 30 天的数据，按天聚合情感强度
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
    const recentMemories = memories.filter(
      (m) => new Date(m.created_at).getTime() > thirtyDaysAgo,
    )

    if (recentMemories.length === 0) return []

    // 按天聚合
    const dailyMap = new Map<string, { total: number; count: number; maxIntensity: number }>()
    for (const mem of recentMemories) {
      const date = new Date(mem.created_at)
      const key = `${date.getMonth() + 1}/${date.getDate()}`
      const existing = dailyMap.get(key) ?? { total: 0, count: 0, maxIntensity: 0 }
      existing.total += mem.emotionalIntensity
      existing.count += 1
      existing.maxIntensity = Math.max(existing.maxIntensity, mem.emotionalIntensity)
      dailyMap.set(key, existing)
    }

    return Array.from(dailyMap.entries()).map(([date, stats]) => ({
      date,
      avgIntensity: stats.count > 0 ? stats.total / stats.count : 0,
      maxIntensity: stats.maxIntensity,
      count: stats.count,
    }))
  }, [memories, now])

  if (chartData.length === 0) {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <TrendingUp size={14} className="text-tangerine" />
          <h4 className="text-xs font-semibold text-ink">情感曲线</h4>
        </div>
        <div className="py-4 text-center text-[11px] text-ink-faint">近 30 天无记忆数据</div>
      </div>
    )
  }

  const maxAvg = Math.max(...chartData.map((d) => d.avgIntensity), 0.01)
  const chartHeight = 60

  return (
    <div className="rounded-xl border border-ink/10 bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <TrendingUp size={14} className="text-tangerine" />
        <h4 className="text-xs font-semibold text-ink">情感曲线（近 30 天）</h4>
      </div>

      {/* SVG 折线图 */}
      <div className="relative" style={{ height: chartHeight + 20 }}>
        <svg
          className="w-full"
          height={chartHeight + 20}
          viewBox={`0 0 ${chartData.length * 30} ${chartHeight + 20}`}
          preserveAspectRatio="none"
        >
          {/* 背景网格线 */}
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1={0}
              y1={chartHeight * (1 - ratio)}
              x2={chartData.length * 30}
              y2={chartHeight * (1 - ratio)}
              stroke="rgba(74,54,38,0.08)"
              strokeWidth={1}
            />
          ))}

          {/* 情感曲线（填充区域） */}
          {chartData.length > 1 && (
            <>
              <path
                d={chartData
                  .map((d, i) => {
                    const x = i * 30 + 15
                    const y = chartHeight - (d.avgIntensity / maxAvg) * (chartHeight - 10)
                    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
                  })
                  .join(' ')}
                fill="none"
                stroke="rgba(232, 135, 74, 0.8)"
                strokeWidth={2}
              />
              {/* 填充区域 */}
              <path
                d={
                  chartData
                    .map((d, i) => {
                      const x = i * 30 + 15
                      const y = chartHeight - (d.avgIntensity / maxAvg) * (chartHeight - 10)
                      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
                    })
                    .join(' ') +
                  ` L ${((chartData.length - 1) * 30 + 15)} ${chartHeight} L 15 ${chartHeight} Z`
                }
                fill="rgba(232, 135, 74, 0.12)"
              />
            </>
          )}

          {/* 数据点 */}
          {chartData.map((d, i) => {
            const x = i * 30 + 15
            const y = chartHeight - (d.avgIntensity / maxAvg) * (chartHeight - 10)
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={3}
                fill={d.avgIntensity > 0.7 ? '#e8874a' : d.avgIntensity > 0.3 ? '#b3a18c' : '#d06a2f'}
                stroke="rgba(74,54,38,0.3)"
                strokeWidth={1}
              />
            )
          })}

          {/* 日期标签 */}
          {chartData.map((d, i) => (
            <text
              key={i}
              x={i * 30 + 15}
              y={chartHeight + 14}
              textAnchor="middle"
              fill="rgba(74,54,38,0.4)"
              fontSize={8}
            >
              {d.date}
            </text>
          ))}
        </svg>
      </div>

      {/* 图例 */}
      <div className="mt-1 flex items-center justify-center gap-3 text-[10px] text-ink-faint">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-tangerine" /> 高情感
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-ink-faint" /> 中情感
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-tangerine-deep" /> 低情感
        </span>
      </div>
    </div>
  )
}

// ============ 时间密度图 ============

/** 时间密度图组件Props */
interface TimeDensityChartProps {
  /** 记忆列表 */
  memories: EnhancedMemory[]
  /** 选择月份回调（点击柱子时触发） */
  onSelectMonth?: (yearMonth: string | null) => void
  /** 当前选中的月份（YYYY-MM 格式） */
  selectedMonth?: string | null
}

/**
 * 时间密度图组件
 *
 * 使用CSS柱状图展示近12个月每月记忆条目数量，
 * 柱子高度和颜色深浅表示记忆密度。
 * 2.2 增强：支持点击柱子筛选该月记忆，选中月份高亮显示。
 */
export function TimeDensityChart({ memories, onSelectMonth, selectedMonth }: TimeDensityChartProps) {
  const monthlyData = useMemo(() => {
    const map = new Map<string, number>()
    for (const mem of memories) {
      const date = new Date(mem.created_at)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12) // 最近 12 个月
  }, [memories])

  const handleClick = useCallback((month: string) => {
    if (onSelectMonth) {
      // 再次点击同一个月 → 取消选择
      onSelectMonth(selectedMonth === month ? null : month)
    }
  }, [onSelectMonth, selectedMonth])

  if (monthlyData.length === 0) {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 size={14} className="text-tangerine" />
          <h4 className="text-xs font-semibold text-ink">记忆密度</h4>
        </div>
        <div className="py-4 text-center text-[11px] text-ink-faint">暂无数据</div>
      </div>
    )
  }

  const maxCount = Math.max(...monthlyData.map((d) => d[1]), 1)
  const barHeight = 50

  return (
    <div className="rounded-xl border border-ink/10 bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <BarChart3 size={14} className="text-tangerine" />
        <h4 className="text-xs font-semibold text-ink">记忆密度（近 12 个月）</h4>
        {selectedMonth && (
          <button
            onClick={() => onSelectMonth?.(null)}
            className="ml-auto flex items-center gap-1 rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-muted transition-colors hover:bg-ink/10"
          >
            <Calendar size={10} />
            {selectedMonth}
            <span className="text-ink-faint">✕</span>
          </button>
        )}
      </div>

      <div className="flex items-end gap-1" style={{ height: barHeight + 16 }}>
        {monthlyData.map(([month, count]) => {
          const height = Math.max(2, (count / maxCount) * barHeight)
          const ratio = count / maxCount
          const isSelected = selectedMonth === month
          const color =
            isSelected
              ? 'bg-tangerine ring-2 ring-tangerine/30'
              : ratio > 0.7
              ? 'bg-tangerine'
              : ratio > 0.4
              ? 'bg-tangerine/70'
              : 'bg-tangerine-deep/50'
          return (
            <button
              key={month}
              onClick={() => handleClick(month)}
              className="flex flex-1 flex-col items-center transition-transform hover:scale-105"
              title={`${month}: ${count} 条记忆${onSelectMonth ? '（点击筛选）' : ''}`}
            >
              <div
                className={`w-full rounded-t ${color} transition-all`}
                style={{ height }}
              />
              <span className={`mt-1 text-[8px] ${isSelected ? 'font-bold text-tangerine' : 'text-ink-faint'}`}>
                {month.slice(5)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
