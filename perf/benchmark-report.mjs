// perf/benchmark-report.mjs — 性能基准综合报告生成器
//
// 聚合所有性能测试结果，生成 Markdown 格式的综合分析报告
// 包含趋势对比、回归检测和优化建议
//
// 运行方式：
//   node perf/benchmark-report.mjs
//   输出：perf/benchmark-report.md

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './_helpers.mjs'

const RESULTS_DIR = join(PROJECT_ROOT, 'perf', 'results')
const REPORT_FILE = join(PROJECT_ROOT, 'perf', 'benchmark-report.md')

const METRICS = [
  { key: 'coldStart', file: 'cold-start.json', label: '冷启动时间', unit: 'ms', better: 'less' },
  { key: 'memory', file: 'memory-usage.json', label: '内存占用', unit: 'MB', better: 'less' },
  { key: 'fps', file: 'fps-test.json', label: '帧率 (FPS)', unit: 'fps', better: 'more' },
  { key: 'packageSize', file: 'package-size.json', label: '安装包大小', unit: 'MB', better: 'less' },
  { key: 'modelSwitch', file: 'model-switch-latency.json', label: '模型切换延迟', unit: 'ms', better: 'less' },
]

function loadJson(file) {
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf-8')) } 
  catch { return null }
}

function generateReport() {
  console.log('━'.repeat(60))
  console.log('  📊 性能基准综合报告生成')
  console.log('━'.repeat(60))

  const results = []
  let allExist = true

  for (const m of METRICS) {
    const data = loadJson(join(RESULTS_DIR, m.file))
    if (!data) {
      allExist = false
      console.log(`  ⚠️  缺失数据：${m.label} (${m.file})`)
      results.push({ ...m, value: null, status: 'missing' })
    } else {
      const value = typeof data.value === 'number' ? data.value : null
      const passed = data.passed === true
      results.push({ ...m, value, passed, status: value !== null ? (passed ? 'pass' : 'fail') : 'error' })
    }
  }

  if (!allExist) {
    console.log('\n  ℹ️  部分性能测试尚未运行，请先执行相关测试:')
    console.log('    pnpm perf:cold-start')
    console.log('    pnpm perf:memory')
    console.log('    pnpm perf:fps')
    console.log('    pnpm perf:model-switch (new)\n')
  }

  // 生成 Markdown 报告
  const timestamp = new Date().toISOString()
  let md = `# 📈 SpiritPal 性能基准报告\n\n`
  md += `**生成时间**: ${timestamp}\n\n`
  md += `## 📊 综合指标概览\n\n`
  md += `| 指标 | 当前值 | 阈值 | 状态 |\n`
  md += `|------|--------|------|------|\n`

  for (const r of results) {
    const valueStr = r.value !== null ? `${r.value}${r.unit}` : '—'
    const statusIcon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️'
    const thresholdStr = r.better === 'less' ? `< ${r.threshold}${r.unit}` : `≥ ${r.threshold}${r.unit}`
    md += `| ${r.label} | ${valueStr} | ${thresholdStr} | ${statusIcon} |\n`
  }

  md += `\n## 📈 详细分析\n\n`

  // 逐项分析
  for (const r of results) {
    if (r.value === null) continue
    md += `### ${r.label}\n\n`
    md += `- **当前值**: ${r.value}${r.unit}\n`
    md += `- **阈值**: ${r.better === 'less' ? '<' : '>'} ${r.threshold}${r.unit}\n`
    md += `- **状态**: ${r.passed ? '✅ 通过' : '❌ 未通过'}\n`
    
    if (!r.passed) {
      md += `\n#### 🔧 优化建议\n\n`
      if (r.key === 'coldStart') {
        md += `- 减少 Live2D 模型加载数量\n`
        md += `- 启用模型预加载策略\n`
        md += `- 优化初始资源加载顺序\n`
      } else if (r.key === 'memory') {
        md += `- 实施内存泄漏修复\n`
        md += `- 优化纹理资源压缩\n`
        md += `- 定期释放未使用的缓存\n`
      } else if (r.key === 'fps') {
        md += `- 降低渲染分辨率\n`
        md += `- 限制粒子系统复杂度\n`
        md += `- 优化动画插值算法\n`
      } else if (r.key === 'modelSwitch') {
        md += `- 预加载常用模型\n`
        md += `- 采用增量加载策略\n`
        md += `- 优化模型解析流程\n`
      }
    }
    md += '\n'
  }

  // 趋势分析（如果存在 baseline）
  const baselineFile = join(RESULTS_DIR, 'baseline.json')
  if (existsSync(baselineFile)) {
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf-8'))
    md += `## 📉 趋势对比\n\n`
    md += `| 指标 | 基线值 | 当前值 | 变化 |\n`
    md += `|------|--------|--------|------|\n`
    
    for (const r of results) {
      if (r.value === null || !baseline[r.key]) continue
      const diff = r.value - baseline[r.key]
      const percent = ((diff / baseline[r.key]) * 100).toFixed(1)
      const arrow = diff > 0 ? '⬆️' : diff < 0 ? '⬇️' : '➡️'
      const color = r.better === 'less' 
        ? (diff <= 0 ? '✅' : '⚠️')
        : (diff >= 0 ? '✅' : '⚠️')
      md += `| ${r.label} | ${baseline[r.key]}${r.unit} | ${r.value}${r.unit} | ${arrow} ${percent}% ${color} |\n`
    }
    md += '\n'
  }

  // 保存报告
  mkdirSync(join(PROJECT_ROOT, 'perf'), { recursive: true })
  writeFileSync(REPORT_FILE, md)
  console.log(`\n  ✅ 报告已保存至：${REPORT_FILE}\n`)

  return results
}

// 入口
generateReport()
