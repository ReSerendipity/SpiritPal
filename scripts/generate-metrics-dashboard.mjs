#!/usr/bin/env node
/**
 * generate-metrics-dashboard.mjs — 产品指标看板生成器
 *
 * 读取 SpiritPal 应用的埋点数据（localStorage 中的 spiritpal-analytics-events），
 * 生成本地 HTML 指标看板，覆盖 PRD §15.1 定义的核心指标：
 *   - DAU（日活跃用户 = 当日 app_launch 事件数）
 *   - 交互次数（pet_interaction 事件按类型聚合）
 *   - 对话轮次（chat_send 事件数）
 *   - AI 响应延迟（chat_receive 事件的 latency_ms 统计）
 *   - 记忆触发次数（memory_trigger 按类型聚合）
 *   - 功能使用率（各事件 / DAU）
 *   - 崩溃率（error_occurred / app_launch）
 *   - 番茄钟完成数（tomato_complete）
 *   - 模组安装数（mod_install）
 *   - 形象切换次数（image_switch）
 *   - UX 路径事件（firstrun_complete/skip, panel_open/close, roam_toggle, edge_snap_toggle）
 *
 * 用法:
 *   node scripts/generate-metrics-dashboard.mjs [dataPath]
 *
 * dataPath 可选，默认读取:
 *   1. 命令行参数指定的 JSON 文件
 *   2. 环境变量 SPIRITPAL_ANALYTICS_DATA
 *   3. 标准输入（管道模式）
 *
 * 数据格式:
 *   - JSON 数组: [{ name: "app_launch", timestamp: 1234567890, data: {...} }, ...]
 *   - 或 analytics.exportEvents() 的输出格式: { exportedAt: "...", events: [...] }
 *
 * 输出:
 *   - perf/results/metrics-dashboard.html（可在浏览器直接打开）
 *   - perf/results/metrics-dashboard.json（机器可读摘要）
 *
 * @module generate-metrics-dashboard
 */

import fs from 'node:fs'
import path from 'node:path'

// ============ 数据加载 ============

/**
 * 加载埋点数据
 * 支持多种输入方式：文件路径 > 环境变量 > 标准输入
 */
function loadAnalyticsData() {
  const dataPath = process.argv[2] || process.env.SPIRITPAL_ANALYTICS_DATA

  let raw = ''
  if (dataPath && fs.existsSync(dataPath)) {
    raw = fs.readFileSync(dataPath, 'utf8')
  } else if (dataPath) {
    // 可能直接是 JSON 字符串
    raw = dataPath
  } else {
    // 尝试从标准输入读取（管道模式）
    try {
      if (!process.stdin.isTTY) {
        raw = fs.readFileSync(0, 'utf8')
      }
    } catch {
      // 标准输入不可用
    }
  }

  if (!raw.trim()) {
    console.warn('[metrics-dashboard] 未提供数据输入。')
    console.warn('  用法: node scripts/generate-metrics-dashboard.mjs <analytics-export.json>')
    console.warn('  或通过管道: cat analytics.json | node scripts/generate-metrics-dashboard.mjs')
    console.warn('  或设置环境变量: SPIRITPAL_ANALYTICS_DATA=<json-string>')
    process.exit(0)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.error('[metrics-dashboard] JSON 解析失败:', e.message)
    process.exit(1)
  }

  // 兼容两种格式：裸数组 或 { exportedAt, events }
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (parsed.events && Array.isArray(parsed.events)) {
    return parsed.events
  }
  console.error('[metrics-dashboard] 无法识别的数据格式。期望 JSON 数组或 { events: [...] }')
  process.exit(1)
}

// ============ 指标计算 ============

/** 按天分组事件 */
function groupByDay(events) {
  const byDay = new Map()
  for (const ev of events) {
    const date = new Date(ev.timestamp)
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    if (!byDay.has(dayKey)) byDay.set(dayKey, [])
    byDay.get(dayKey).push(ev)
  }
  return byDay
}

/** 计算事件计数 */
function countEvents(events, name) {
  return events.filter((e) => e.name === name).length
}

/** 提取事件的数值字段统计 */
function numericStats(events, name, field) {
  const values = events
    .filter((e) => e.name === name && e.data && typeof e.data[field] === 'number')
    .map((e) => e.data[field])
  if (values.length === 0) return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0 }
  values.sort((a, b) => a - b)
  const sum = values.reduce((a, b) => a + b, 0)
  return {
    count: values.length,
    min: values[0],
    max: values[values.length - 1],
    avg: Math.round(sum / values.length),
    p50: values[Math.floor(values.length * 0.5)],
    p95: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))],
  }
}

/** 按子类型分组计数 */
function countBySubType(events, name, field) {
  const counts = {}
  for (const ev of events) {
    if (ev.name !== name) continue
    const key = String(ev.data?.[field] ?? 'unknown')
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

/** 计算核心指标 */
function computeMetrics(events) {
  const totalLaunches = countEvents(events, 'app_launch')
  const totalErrors = countEvents(events, 'error_occurred')
  const chatSendCount = countEvents(events, 'chat_send')
  const chatReceiveStats = numericStats(events, 'chat_receive', 'latency_ms')
  const interactionCount = countEvents(events, 'pet_interaction')
  const memoryTriggerCount = countEvents(events, 'memory_trigger')
  const tomatoCount = countEvents(events, 'tomato_complete')
  const modInstallCount = countEvents(events, 'mod_install')
  const imageSwitchCount = countEvents(events, 'image_switch')
  const itemUseCount = countEvents(events, 'item_use')
  const firstrunComplete = countEvents(events, 'firstrun_complete')
  const firstrunSkip = countEvents(events, 'firstrun_skip')
  const panelOpen = countEvents(events, 'panel_open')
  const panelClose = countEvents(events, 'panel_close')
  const roamToggle = countEvents(events, 'roam_toggle')
  const edgeSnapToggle = countEvents(events, 'edge_snap_toggle')
  const experimentVariants = countEvents(events, 'experiment_variant')

  const byDay = groupByDay(events)
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const todayEvents = byDay.get(todayKey) || []
  const dau = countEvents(todayEvents, 'app_launch')

  return {
    summary: {
      totalEvents: events.length,
      totalLaunches,
      dau,
      totalDays: byDay.size,
      crashRate: totalLaunches > 0 ? ((totalErrors / totalLaunches) * 100).toFixed(2) + '%' : 'N/A',
    },
    coreMetrics: {
      'DAU (今日)': dau,
      '总启动次数': totalLaunches,
      '交互总次数': interactionCount,
      '对话总轮次': chatSendCount,
      '记忆触发次数': memoryTriggerCount,
      '番茄钟完成数': tomatoCount,
      '模组安装数': modInstallCount,
      '形象切换次数': imageSwitchCount,
      '物品使用次数': itemUseCount,
      '崩溃率': totalLaunches > 0 ? ((totalErrors / totalLaunches) * 100).toFixed(2) + '%' : 'N/A',
    },
    aiMetrics: {
      'AI 响应延迟 (avg ms)': chatReceiveStats.avg,
      'AI 响应延迟 (p50 ms)': chatReceiveStats.p50,
      'AI 响应延迟 (p95 ms)': chatReceiveStats.p95,
      'AI 响应延迟 (max ms)': chatReceiveStats.max,
      'AI 响应样本数': chatReceiveStats.count,
    },
    uxMetrics: {
      '首次引导完成': firstrunComplete,
      '首次引导跳过': firstrunSkip,
      '面板展开次数': panelOpen,
      '面板收起次数': panelClose,
      '漫游开关切换': roamToggle,
      '边缘吸附切换': edgeSnapToggle,
      '灰度实验分组记录': experimentVariants,
    },
    breakdowns: {
      '交互类型分布': countBySubType(events, 'pet_interaction', 'type'),
      '记忆触发类型': countBySubType(events, 'memory_trigger', 'trigger_type'),
      '物品使用类型': countBySubType(events, 'item_use', 'item_type'),
    },
    dailyTrend: Array.from(byDay.entries()).map(([day, dayEvents]) => ({
      date: day,
      launches: countEvents(dayEvents, 'app_launch'),
      interactions: countEvents(dayEvents, 'pet_interaction'),
      chats: countEvents(dayEvents, 'chat_send'),
      errors: countEvents(dayEvents, 'error_occurred'),
    })).sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// ============ HTML 生成 ============

function generateHTML(metrics) {
  const { summary, coreMetrics, aiMetrics, uxMetrics, breakdowns, dailyTrend } = metrics

  const cardHTML = (title, value, subtitle = '') => `
    <div class="card">
      <div class="card-title">${title}</div>
      <div class="card-value">${value}</div>
      ${subtitle ? `<div class="card-subtitle">${subtitle}</div>` : ''}
    </div>`

  const tableHTML = (title, rows) => `
    <div class="section">
      <h2>${title}</h2>
      <table>
        <thead><tr><th>指标</th><th>值</th></tr></thead>
        <tbody>
          ${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`

  const breakdownHTML = (title, data) => {
    const entries = Object.entries(data)
    if (entries.length === 0) return `<div class="section"><h2>${title}</h2><p class="muted">无数据</p></div>`
    const total = entries.reduce((sum, [, v]) => sum + v, 0)
    return `
    <div class="section">
      <h2>${title}</h2>
      <div class="bar-chart">
        ${entries.map(([k, v]) => {
          const pct = total > 0 ? ((v / total) * 100).toFixed(1) : 0
          return `
          <div class="bar-row">
            <span class="bar-label">${k}</span>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${pct}%"></div>
            </div>
            <span class="bar-value">${v} (${pct}%)</span>
          </div>`
        }).join('')}
      </div>
    </div>`
  }

  const trendMax = Math.max(...dailyTrend.map(d => Math.max(d.launches, d.interactions, d.chats)), 1)
  const trendHTML = dailyTrend.length > 0 ? `
    <div class="section">
      <h2>每日趋势（最近 ${dailyTrend.length} 天）</h2>
      <div class="trend-chart">
        ${dailyTrend.map(d => {
          const launchH = (d.launches / trendMax) * 100
          const interactH = (d.interactions / trendMax) * 100
          const chatH = (d.chats / trendMax) * 100
          return `
          <div class="trend-day">
            <div class="trend-bars">
              <div class="trend-bar trend-launch" style="height: ${launchH}%" title="启动: ${d.launches}"></div>
              <div class="trend-bar trend-interact" style="height: ${interactH}%" title="交互: ${d.interactions}"></div>
              <div class="trend-bar trend-chat" style="height: ${chatH}%" title="对话: ${d.chats}"></div>
            </div>
            <span class="trend-date">${d.date.slice(5)}</span>
          </div>`
        }).join('')}
      </div>
      <div class="legend">
        <span class="legend-item"><span class="legend-color trend-launch"></span>启动</span>
        <span class="legend-item"><span class="legend-color trend-interact"></span>交互</span>
        <span class="legend-item"><span class="legend-color trend-chat"></span>对话</span>
      </div>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpiritPal 产品指标看板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f17; color: #e0e0e8; padding: 24px; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .header { margin-bottom: 32px; }
    .header p { color: #888; font-size: 14px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #1a1a2e; border: 1px solid #2a2a40; border-radius: 12px; padding: 20px; }
    .card-title { font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 32px; font-weight: 700; margin-top: 4px; color: #6E8EFB; }
    .card-subtitle { font-size: 12px; color: #666; margin-top: 4px; }
    .section { background: #1a1a2e; border: 1px solid #2a2a40; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .section h2 { font-size: 18px; margin-bottom: 16px; color: #A777E3; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #2a2a40; }
    th { color: #888; font-size: 13px; font-weight: 600; }
    td { font-size: 14px; }
    .muted { color: #666; font-style: italic; }
    .bar-chart { display: flex; flex-direction: column; gap: 12px; }
    .bar-row { display: flex; align-items: center; gap: 12px; }
    .bar-label { width: 100px; font-size: 13px; }
    .bar-track { flex: 1; height: 24px; background: #2a2a40; border-radius: 6px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #6E8EFB, #A777E3); border-radius: 6px; transition: width 0.3s; }
    .bar-value { width: 120px; font-size: 13px; text-align: right; }
    .trend-chart { display: flex; gap: 4px; align-items: flex-end; height: 200px; overflow-x: auto; }
    .trend-day { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 60px; }
    .trend-bars { display: flex; gap: 2px; align-items: flex-end; height: 160px; }
    .trend-bar { width: 12px; border-radius: 3px 3px 0 0; min-height: 2px; }
    .trend-launch { background: #6E8EFB; }
    .trend-interact { background: #29ADB2; }
    .trend-chat { background: #A777E3; }
    .trend-date { font-size: 11px; color: #888; }
    .legend { display: flex; gap: 24px; margin-top: 12px; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #888; }
    .legend-color { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
    .footer { text-align: center; color: #555; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🐾 SpiritPal 产品指标看板</h1>
    <p>生成时间: ${new Date().toLocaleString('zh-CN')} | 数据源: 本地埋点 (analytics.ts) | 总事件: ${summary.totalEvents} 条</p>
  </div>

  <div class="cards">
    ${cardHTML('DAU (今日)', summary.dau, '当日启动应用次数')}
    ${cardHTML('总启动次数', summary.totalLaunches, `跨 ${summary.totalDays} 天`)}
    ${cardHTML('总事件数', summary.totalEvents, '最多保留 1000 条')}
    ${cardHTML('崩溃率', summary.crashRate, 'error_occurred / app_launch')}
  </div>

  ${tableHTML('核心指标 (PRD §15.1)', Object.entries(coreMetrics))}
  ${tableHTML('AI 响应指标', Object.entries(aiMetrics))}
  ${tableHTML('UX 关键路径指标', Object.entries(uxMetrics))}
  ${breakdownHTML('交互类型分布', breakdowns['交互类型分布'])}
  ${breakdownHTML('记忆触发类型', breakdowns['记忆触发类型'])}
  ${breakdownHTML('物品使用类型', breakdowns['物品使用类型'])}
  ${trendHTML}

  <div class="footer">
    SpiritPal Metrics Dashboard | 数据仅本地存储，不上传服务器 | PRD §15
  </div>
</body>
</html>`
}

// ============ 主入口 ============

function main() {
  const events = loadAnalyticsData()
  console.log(`[metrics-dashboard] 加载 ${events.length} 条埋点事件`)

  const metrics = computeMetrics(events)
  console.log('[metrics-dashboard] 指标计算完成:')
  console.log(`  DAU (今日): ${metrics.summary.dau}`)
  console.log(`  总启动: ${metrics.summary.totalLaunches}`)
  console.log(`  崩溃率: ${metrics.summary.crashRate}`)

  // 写入 HTML 报告
  const resultsDir = path.join(process.cwd(), 'perf', 'results')
  fs.mkdirSync(resultsDir, { recursive: true })

  const htmlPath = path.join(resultsDir, 'metrics-dashboard.html')
  fs.writeFileSync(htmlPath, generateHTML(metrics))
  console.log(`[metrics-dashboard] HTML 报告已生成: ${htmlPath}`)

  // 写入 JSON 摘要
  const jsonPath = path.join(resultsDir, 'metrics-dashboard.json')
  fs.writeFileSync(jsonPath, JSON.stringify(metrics, null, 2))
  console.log(`[metrics-dashboard] JSON 摘要已生成: ${jsonPath}`)
}

main()
