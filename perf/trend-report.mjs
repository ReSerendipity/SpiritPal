#!/usr/bin/env node
/**
 * trend-report.mjs — 性能/召回趋势看板生成器（B-4 收尾）
 *
 * 把分散的性能数据串成「可对比的回归看板」：
 *   1. perf/run-all.mjs 产出的历次运行记录  perf/results/perf-history.json
 *      （cold-start / memory / fps / drag-fps / package-size 随时间序列）
 *   2. 记忆检索延迟快照  perf/results/memory-recall-p95.json
 *   3. 记忆召回准确率快照 perf/results/memory-recall-accuracy.json
 *      （由 memoryRecall.eval.test.ts 写入；本脚本追加为时间序列 recall-history.json）
 *
 * 行为：
 *   - 把当前 recall 快照追加进 perf/results/recall-history.json（按 timestamp 去重，最多保留 200 点）
 *   - 生成自包含 HTML 看板 perf/results/perf-trend-dashboard.html（内联 SVG 折线图，无 CDN 依赖）
 *
 * 用法:
 *   node perf/trend-report.mjs
 *   pnpm perf:trend
 *
 * @module trend-report
 */

import fs from 'node:fs'
import path from 'node:path'

const RESULTS_DIR = path.join(process.cwd(), 'perf', 'results')
const HISTORY_FILE = path.join(RESULTS_DIR, 'perf-history.json')
const RECALL_HISTORY_FILE = path.join(RESULTS_DIR, 'recall-history.json')
const P95_FILE = path.join(RESULTS_DIR, 'memory-recall-p95.json')
const ACC_FILE = path.join(RESULTS_DIR, 'memory-recall-accuracy.json')
const OUT_HTML = path.join(RESULTS_DIR, 'perf-trend-dashboard.html')
const OUT_JSON = path.join(RESULTS_DIR, 'perf-trend.json')

const HISTORY_LIMIT = 200

function readJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

function tsLabel(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ============ 召回历史追加 ============

function appendRecallHistory(p95, acc) {
  const history = readJSON(RECALL_HISTORY_FILE, [])
  const ts = (p95?.timestamp && acc?.timestamp)
    ? (new Date(p95.timestamp) >= new Date(acc.timestamp) ? p95.timestamp : acc.timestamp)
    : (p95?.timestamp || acc?.timestamp)

  // 按 timestamp 去重：同一快照重复运行不重复追加
  if (ts && history.some((h) => h.timestamp === ts)) return history

  const record = {
    timestamp: ts,
    p95: p95?.value ?? null,
    p50: p95?.detail?.p50 ?? null,
    p99: p95?.detail?.p99 ?? null,
    avg: p95?.detail?.avg ?? null,
    poolSize: p95?.detail?.actualPoolSize ?? null,
    rate: acc?.value ?? null,
    hit: acc?.detail?.hit ?? null,
    total: acc?.detail?.total ?? null,
    misses: acc?.detail?.misses ?? null,
    passed: (p95?.passed !== false) && (acc?.passed !== false),
  }
  history.push(record)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(RECALL_HISTORY_FILE, JSON.stringify(history, null, 2))
  return history
}

// ============ SVG 折线图 ============

function buildLineChart({ title, unit, points, threshold, higherIsBetter, color, passNow }) {
  if (!points || points.length === 0) {
    return `<div class="chart-card">
      <div class="chart-head"><span class="chart-title">${title}</span></div>
      <div class="chart-empty">无数据</div>
    </div>`
  }

  const W = 720, H = 240, padL = 54, padR = 22, padT = 22, padB = 38
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const values = points.map((p) => p.v).filter((v) => typeof v === 'number')
  if (values.length === 0) {
    return `<div class="chart-card"><div class="chart-head"><span class="chart-title">${title}</span></div><div class="chart-empty">无数据</div></div>`
  }

  let minV = Math.min(...values)
  let maxV = Math.max(...values)
  if (threshold != null) {
    minV = Math.min(minV, threshold)
    maxV = Math.max(maxV, threshold)
  }
  if (minV === maxV) { minV -= 1; maxV += 1 }
  const pad = (maxV - minV) * 0.08
  minV -= pad; maxV += pad

  const y = (v) => padT + plotH * (1 - (v - minV) / (maxV - minV))
  const x = (i) => points.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (points.length - 1)

  const polyPts = points.map((p, i) => `${(x(i)).toFixed(1)},${(y(p.v)).toFixed(1)}`).join(' ')
  const dots = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5" fill="${color}" />`,
  ).join('')

  let thresholdSvg = ''
  if (threshold != null && threshold >= minV && threshold <= maxV) {
    const ty = y(threshold)
    const ok = passNow == null ? true : passNow
    const tcol = ok ? '#3ddc97' : '#ff6b6b'
    thresholdSvg = `<line x1="${padL}" y1="${ty.toFixed(1)}" x2="${W - padR}" y2="${ty.toFixed(1)}"
      stroke="${tcol}" stroke-width="1.2" stroke-dasharray="5 4" opacity="0.8" />
      <text x="${W - padR}" y="${(ty - 5).toFixed(1)}" text-anchor="end" font-size="11" fill="${tcol}">阈值 ${threshold}${unit}</text>`
  }

  const last = points[points.length - 1]
  const lastLabel = `<text x="${x(points.length - 1).toFixed(1)}" y="${(y(last.v) - 10).toFixed(1)}"
    text-anchor="end" font-size="12" font-weight="700" fill="${color}">${last.v}${unit}</text>`

  const yMin = `<text x="${padL - 8}" y="${H - padB}" text-anchor="end" font-size="10" fill="#888">${minV.toFixed(0)}</text>`
  const yMax = `<text x="${padL - 8}" y="${padT + 4}" text-anchor="end" font-size="10" fill="#888">${maxV.toFixed(0)}</text>`
  const xFirst = `<text x="${padL}" y="${H - padB + 16}" font-size="10" fill="#888">${tsLabel(points[0].t)}</text>`
  const xLast = `<text x="${W - padR}" y="${H - padB + 16}" text-anchor="end" font-size="10" fill="#888">${tsLabel(last.t)}</text>`

  return `<div class="chart-card">
    <div class="chart-head">
      <span class="chart-title">${title}</span>
      <span class="chart-now" style="color:${color}">当前 ${last.v}${unit}</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">
      ${thresholdSvg}
      <polyline points="${polyPts}" fill="none" stroke="${color}" stroke-width="2" />
      ${dots}
      ${lastLabel}
      ${yMin}${yMax}${xFirst}${xLast}
    </svg>
  </div>`
}

// ============ HTML 生成 ============

function buildPerfSeries(history) {
  // history: [{ timestamp, metrics:[{id,name,value,unit,threshold,passed,compare?}] }]
  const byId = new Map()
  for (const run of history) {
    for (const m of run.metrics || []) {
      if (typeof m.value !== 'number') continue
      if (!byId.has(m.id)) {
        byId.set(m.id, { name: m.name, unit: m.unit, threshold: m.threshold, compare: m.compare ?? (m.id.includes('fps') ? 'gte' : 'lt') })
      }
      byId.get(m.id).points.push({ t: run.timestamp, v: m.value })
    }
  }
  return byId
}

function generateHTML({ perfHistory, recallHistory, latestPerf, latestRecall }) {
  const COLORS = ['#6E8EFB', '#29ADB2', '#A777E3', '#F6C453', '#FF8C69', '#5BD1A0']
  const perfSeries = buildPerfSeries(perfHistory)

  const perfCharts = [...perfSeries.entries()].map(([id, s], idx) => {
    const higher = s.compare === 'gte'
    const last = s.points[s.points.length - 1]
    const passNow = last ? (higher ? last.v >= s.threshold : last.v <= s.threshold) : null
    return buildLineChart({
      title: s.name, unit: s.unit, points: s.points, threshold: s.threshold,
      higherIsBetter: higher, color: COLORS[idx % COLORS.length], passNow,
    })
  }).join('')

  const recallP95 = recallHistory
    .filter((r) => typeof r.p95 === 'number')
    .map((r) => ({ t: r.timestamp, v: r.p95 }))
  const recallRate = recallHistory
    .filter((r) => typeof r.rate === 'number')
    .map((r) => ({ t: r.timestamp, v: Math.round(r.rate * 1000) / 10 })) // 转成百分比数值便于看图

  const p95Color = '#FF8C69'
  const rateColor = '#5BD1A0'
  const recallCharts = [
    buildLineChart({
      title: '记忆检索 P95 延迟', unit: 'ms', points: recallP95, threshold: 100,
      higherIsBetter: false, color: p95Color,
      passNow: latestRecall?.p95 != null ? latestRecall.p95 < 100 : null,
    }),
    buildLineChart({
      title: '记忆召回准确率', unit: '%', points: recallRate, threshold: 70,
      higherIsBetter: true, color: rateColor,
      passNow: latestRecall?.rate != null ? latestRecall.rate >= 0.7 : null,
    }),
  ].join('')

  // 概览卡片
  const cards = []
  cards.push(card('性能运行记录', perfHistory.length, 'perf/results/perf-history.json'))
  cards.push(card('召回快照点数', recallHistory.length, 'perf/results/recall-history.json'))
  if (latestRecall?.rate != null) {
    cards.push(card('最近召回率', `${(latestRecall.rate * 100).toFixed(1)}%`, latestRecall.rate >= 0.7 ? '≥ 70% 回归线' : '低于回归线'))
  }
  if (latestRecall?.p95 != null) {
    cards.push(card('最近 P95 延迟', `${latestRecall.p95}ms`, latestRecall.p95 < 100 ? '< 100ms 阈值' : '超阈值'))
  }
  if (latestPerf) {
    const npass = (latestPerf.metrics || []).filter((m) => m.passed).length
    cards.push(card('最近性能跑批', `${npass}/${(latestPerf.metrics || []).length} 通过`, latestPerf.passed ? '全绿' : '有失败'))
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpiritPal 性能/召回趋势看板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f17; color: #e0e0e8; padding: 24px; }
    h1 { font-size: 26px; margin-bottom: 6px; }
    .header { margin-bottom: 28px; }
    .header p { color: #888; font-size: 14px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .card { background: #1a1a2e; border: 1px solid #2a2a40; border-radius: 12px; padding: 18px; }
    .card-title { font-size: 13px; color: #888; }
    .card-value { font-size: 28px; font-weight: 700; margin-top: 4px; color: #6E8EFB; }
    .card-sub { font-size: 12px; color: #666; margin-top: 4px; }
    .group { margin-bottom: 26px; }
    .group h2 { font-size: 18px; margin-bottom: 14px; color: #A777E3; border-left: 4px solid #A777E3; padding-left: 10px; }
    .charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
    .chart-card { background: #1a1a2e; border: 1px solid #2a2a40; border-radius: 12px; padding: 16px; }
    .chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .chart-title { font-size: 14px; color: #ccc; font-weight: 600; }
    .chart-now { font-size: 13px; }
    .chart-empty { color: #666; font-style: italic; padding: 40px 0; text-align: center; }
    .footer { text-align: center; color: #555; font-size: 12px; margin-top: 28px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📈 SpiritPal 性能 / 召回趋势看板</h1>
    <p>生成时间: ${new Date().toLocaleString('zh-CN')} | 数据源: perf-history.json + recall-history.json | 阈值参考线标红=当前未达标</p>
  </div>

  <div class="cards">
    ${cards.join('')}
  </div>

  <div class="group">
    <h2>性能验收指标（PRD v0.2）</h2>
    <div class="charts">
      ${perfCharts || '<div class="chart-empty">暂无 perf-history.json 数据，先运行 pnpm perf</div>'}
    </div>
  </div>

  <div class="group">
    <h2>B-4 记忆检索（延迟 + 召回准确率）</h2>
    <div class="charts">
      ${recallCharts}
    </div>
  </div>

  <div class="footer">SpiritPal Perf Trend Dashboard | 数据仅本地，不上传</div>
</body>
</html>`
}

function card(title, value, sub) {
  return `<div class="card">
    <div class="card-title">${title}</div>
    <div class="card-value">${value}</div>
    <div class="card-sub">${sub || ''}</div>
  </div>`
}

// ============ 主入口 ============

function main() {
  const perfHistory = readJSON(HISTORY_FILE, [])
  const p95 = readJSON(P95_FILE, null)
  const acc = readJSON(ACC_FILE, null)

  const recallHistory = appendRecallHistory(p95, acc)
  const latestRecall = recallHistory[recallHistory.length - 1] || null
  const latestPerf = perfHistory[perfHistory.length - 1] || null

  const dashboardData = { perfHistory, recallHistory, latestPerf, latestRecall }
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(OUT_JSON, JSON.stringify(dashboardData, null, 2))
  fs.writeFileSync(OUT_HTML, generateHTML(dashboardData))

  console.log('[perf-trend] 性能运行记录:', perfHistory.length, '条 | 召回快照:', recallHistory.length, '条')
  if (latestRecall?.rate != null) console.log(`[perf-trend] 最近召回率: ${(latestRecall.rate * 100).toFixed(1)}%  最近 P95: ${latestRecall.p95}ms`)
  console.log(`[perf-trend] 看板已生成: ${OUT_HTML}`)
}

main()
