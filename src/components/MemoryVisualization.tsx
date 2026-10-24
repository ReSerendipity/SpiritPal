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
import { useTranslation } from 'react-i18next'
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
              selectedTag === tag ? 'bg-tangerine/20 ring-1 ring-tangerine' : 'hover:bg-ink/5'
            }`}
            title={`${tag}: ${freq} 条记忆`}
          >
            #{tag}
            {freq > 1 && <span className="ml-0.5 text-[9px] opacity-50">({freq})</span>}
          </button>
        ))}
      </div>

      {/* P2-3：层级说明——字号/颜色即提及频次 */}
      <div
        className="mt-2 border-t border-ink/8 pt-1.5 text-[10px] leading-4 text-ink-faint"
        data-testid="tagcloud-legend"
      >
        字号越大、颜色越亮 = 提及越多（最高 {maxFreq} 条）；点击标签可筛选该类记忆
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
  const { t } = useTranslation()
  // "当前时间"在组件挂载时固定一次（惰性初始化），避免渲染期调用不纯函数 Date.now()
  const [now] = useState(() => Date.now())
  const chartData = useMemo(() => {
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
    const recentMemories = memories.filter((m) => new Date(m.created_at).getTime() > thirtyDaysAgo)

    if (recentMemories.length === 0) return []

    const dailyMap = new Map<string, { total: number; count: number; ts: number; max: number }>()
    for (const mem of recentMemories) {
      const date = new Date(mem.created_at)
      const key = `${date.getMonth() + 1}/${date.getDate()}`
      const existing = dailyMap.get(key) ?? { total: 0, count: 0, ts: date.getTime(), max: 0 }
      existing.total += mem.emotionalIntensity
      existing.count += 1
      existing.max = Math.max(existing.max, mem.emotionalIntensity)
      dailyMap.set(key, existing)
    }

    // Map 按插入序，memories 数组顺序≠时间序 → 按日期升序
    return Array.from(dailyMap.entries())
      .map(([date, stats]) => ({
        date,
        ts: stats.ts,
        avgIntensity: stats.count > 0 ? stats.total / stats.count : 0,
        maxIntensity: stats.max,
      }))
      .sort((a, b) => a.ts - b.ts)
  }, [memories, now])

  if (chartData.length === 0) {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <TrendingUp size={14} className="text-tangerine" />
          <h4 className="text-xs font-semibold text-ink">{t('chatUi.emotion.heading')}</h4>
        </div>
        <div className="py-4 text-center text-[11px] text-ink-faint">{t('chatUi.emotion.empty')}</div>
      </div>
    )
  }

  const peakDay = chartData.reduce((a, b) => (b.avgIntensity > a.avgIntensity ? b : a))
  if (peakDay.maxIntensity <= 0) {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <TrendingUp size={14} className="text-tangerine" />
          <h4 className="text-xs font-semibold text-ink">{t('chatUi.emotion.heading')}</h4>
        </div>
        <div className="py-6 text-center text-[11px] leading-5 text-ink-faint">
          {t('chatUi.emotion.zeroTitle', { days: chartData.length })}
          <br />
          {t('chatUi.emotion.zeroHint')}
        </div>
      </div>
    )
  }
  // 曲线按本期峰值归一化铺满画布；纵轴标注相对百分比，避免 tiny 值被压成一条贴底直线，
  // 也避免「刻度取整后全部相同」或刻度上限与峰值文案互相矛盾。
  // 留 10% 顶部余量，避免峰值点贴着上边框像被裁掉。
  const scaleMax = peakDay.maxIntensity > 0 ? peakDay.maxIntensity * 1.1 : 0.0001
  const formatPeak = (value: number) =>
    value === 0 ? '0' : value < 0.001 ? '<0.001' : value < 0.01 ? value.toFixed(4) : value.toFixed(2)
  const yTicks = [1, 0.75, 0.5, 0.25, 0]
  const xOf = (index: number) =>
    chartData.length === 1 ? PLOT_LEFT + PLOT_WIDTH / 2 : PLOT_LEFT + (index / (chartData.length - 1)) * PLOT_WIDTH
  const yOf = (value: number) => PLOT_TOP + (1 - Math.min(1, value / scaleMax)) * (PLOT_BOTTOM - PLOT_TOP)
  const dateTickIndexes = pickDateTickIndexes(chartData.length)
  const peakPath = chartData
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(index).toFixed(2)} ${yOf(point.maxIntensity).toFixed(2)}`)
    .join(' ')
  const averagePath = chartData
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(index).toFixed(2)} ${yOf(point.avgIntensity).toFixed(2)}`)
    .join(' ')
  const areaPath = `${peakPath} L ${xOf(chartData.length - 1).toFixed(2)} ${PLOT_HEIGHT} L ${xOf(0).toFixed(2)} ${PLOT_HEIGHT} Z`
  const peakAverage = chartData.reduce((a, b) => (b.avgIntensity > a.avgIntensity ? b : a))

  return (
    <div className="rounded-xl border border-ink/10 bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <TrendingUp size={14} className="text-tangerine" />
        <h4 className="text-xs font-semibold text-ink">{t('chatUi.emotion.heading')}</h4>
      </div>

      <div style={{ height: CHART_HEIGHT }}>
        <svg
          data-testid="emotion-chart"
          className="block h-auto w-full"
          viewBox={`0 0 ${VIEW_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t('chatUi.emotion.conclusion', {
            peak: formatPeak(peakDay.maxIntensity),
            date: peakDay.date,
            avg: formatPeak(peakAverage.avgIntensity),
            days: chartData.length,
          })}
        >
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1={PLOT_LEFT}
              y1={PLOT_TOP + (1 - ratio) * (PLOT_BOTTOM - PLOT_TOP)}
              x2={PLOT_RIGHT}
              y2={PLOT_TOP + (1 - ratio) * (PLOT_BOTTOM - PLOT_TOP)}
              className="stroke-ink/10"
              strokeWidth={1}
            />
          ))}

          {chartData.length > 1 ? (
            <>
              <path d={areaPath} className="fill-tangerine/10" />
              <path
                data-testid="emotion-peak-line"
                d={peakPath}
                className="fill-none stroke-tangerine"
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <path
                data-testid="emotion-average-line"
                d={averagePath}
                className="fill-none stroke-ink-muted"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeLinejoin="round"
              />
            </>
          ) : (
            <>
              <line
                x1={PLOT_LEFT + PLOT_WIDTH * 0.2}
                y1={yOf(peakDay.maxIntensity)}
                x2={PLOT_LEFT + PLOT_WIDTH * 0.8}
                y2={yOf(peakDay.maxIntensity)}
                className="stroke-tangerine/50"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
              <line
                x1={PLOT_LEFT + PLOT_WIDTH * 0.2}
                y1={yOf(peakAverage.avgIntensity)}
                x2={PLOT_LEFT + PLOT_WIDTH * 0.8}
                y2={yOf(peakAverage.avgIntensity)}
                className="stroke-ink-muted"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                opacity={0.6}
              />
            </>
          )}

          {chartData.map((point, index) => (
            <circle
              key={point.date}
              cx={xOf(index)}
              cy={yOf(point.maxIntensity)}
              r={4}
              className={`stroke-surface ${
                point.maxIntensity > 0.7
                  ? 'fill-tangerine'
                  : point.maxIntensity > 0.3
                    ? 'fill-ink-muted'
                    : 'fill-tangerine-deep'
              }`}
              strokeWidth={1.5}
            />
          ))}

          {dateTickIndexes.map((index) => (
            <text
              key={chartData[index].date}
              x={xOf(index)}
              y={PLOT_HEIGHT + 15}
              textAnchor={index === 0 ? 'start' : index === chartData.length - 1 ? 'end' : 'middle'}
              className="fill-ink/50"
              fontSize={9}
            >
              {chartData[index].date}
            </text>
          ))}

          <g data-testid="emotion-y-ticks">
            {yTicks.map((tick) => {
              const y = PLOT_TOP + (1 - tick) * (PLOT_BOTTOM - PLOT_TOP)
              return (
                <text
                  key={tick}
                  x={PLOT_LEFT - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-ink/50 tabular-nums"
                  fontSize={9}
                >
                  {Math.round(tick * 100)}%
                </text>
              )
            })}
          </g>
        </svg>
      </div>

      <div className="mt-1 flex items-center justify-center gap-3 text-[10px] text-ink-faint">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-tangerine" /> {t('chatUi.emotion.peakLegend')}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-4 border-t-2 border-dashed border-ink-muted" /> {t('chatUi.emotion.avgLegend')}
        </span>
      </div>

      <div
        className="mt-1 border-t border-ink/8 pt-1.5 text-[10px] leading-4 text-ink-faint"
        data-testid="emotion-conclusion"
      >
        {t('chatUi.emotion.conclusion', {
          peak: formatPeak(peakDay.maxIntensity),
          date: peakDay.date,
          avg: formatPeak(peakAverage.avgIntensity),
          days: chartData.length,
        })}
        {chartData.length === 1 ? `；${t('chatUi.emotion.singleDay')}` : ''}
      </div>
    </div>
  )
}

const VIEW_WIDTH = 360
const PLOT_LEFT = 34
const PLOT_RIGHT = VIEW_WIDTH
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT
const PLOT_HEIGHT = 120
const PLOT_TOP = 6
const PLOT_BOTTOM = PLOT_HEIGHT - 6
const LABEL_HEIGHT = 22
const CHART_HEIGHT = PLOT_HEIGHT + LABEL_HEIGHT

/** 30 个点全标会重叠；最多保留 6 个（含首尾）。 */
function pickDateTickIndexes(length: number): number[] {
  if (length <= 6) return Array.from({ length }, (_, i) => i)
  const indexes = new Set<number>()
  for (let i = 0; i < 6; i++) indexes.add(Math.round((i / 5) * (length - 1)))
  return Array.from(indexes).sort((a, b) => a - b)
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

  const handleClick = useCallback(
    (month: string) => {
      if (onSelectMonth) {
        // 再次点击同一个月 → 取消选择
        onSelectMonth(selectedMonth === month ? null : month)
      }
    },
    [onSelectMonth, selectedMonth],
  )

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
  // P2-3：结论数据——峰值月与合计
  const peakMonth = monthlyData.reduce((a, b) => (b[1] > a[1] ? b : a))
  const totalCount = monthlyData.reduce((sum, [, c]) => sum + c, 0)

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

      <div className="flex items-end gap-1" style={{ height: barHeight + 28 }}>
        {monthlyData.map(([month, count]) => {
          const height = Math.max(2, (count / maxCount) * barHeight)
          const ratio = count / maxCount
          const isSelected = selectedMonth === month
          const color = isSelected
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
              {/* P2-3：柱顶数值标注 */}
              <span className="text-[8px] tabular-nums leading-3 text-ink-faint" data-testid="density-count">
                {count}
              </span>
              <div className={`w-full rounded-t ${color} transition-all`} style={{ height }} />
              <span className={`mt-1 text-[8px] ${isSelected ? 'font-bold text-tangerine' : 'text-ink-faint'}`}>
                {month.slice(5)}
              </span>
            </button>
          )
        })}
      </div>

      {/* P2-3：结论副标题——峰值月与合计 */}
      <div
        className="mt-1 border-t border-ink/8 pt-1.5 text-[10px] leading-4 text-ink-faint"
        data-testid="density-conclusion"
      >
        峰值 {peakMonth[0]}（{peakMonth[1]} 条）· 近 {monthlyData.length} 个月合计 {totalCount} 条记忆
        {onSelectMonth ? '；点击柱子可筛选该月' : ''}
      </div>
    </div>
  )
}
