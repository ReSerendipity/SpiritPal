// T-22: 性能基线趋势监控 — 记录历次性能数据，设置回归告警
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, THRESHOLDS } from './_helpers.mjs'

const RESULTS_DIR = join(PROJECT_ROOT, 'perf', 'results')
const BASELINE_FILE = join(RESULTS_DIR, 'baseline.json')
const REGRESSION_THRESHOLD = 0.2 // 20% 回归触发告警

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return null
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'))
  } catch { return null }
}

function saveBaseline(data) {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2))
}

function checkRegression(current, baseline) {
  const regressions = []
  for (const metric of ['coldStart', 'memory', 'packageSize']) {
    if (current[metric] && baseline[metric]) {
      const ratio = (current[metric] - baseline[metric]) / baseline[metric]
      if (ratio > REGRESSION_THRESHOLD) {
        regressions.push({
          metric,
          baseline: baseline[metric],
          current: current[metric],
          regression: `${(ratio * 100).toFixed(1)}%`,
        })
      }
    }
  }
  // FPS 回归（下降超过 20%）
  if (current.fps && baseline.fps) {
    const ratio = (baseline.fps - current.fps) / baseline.fps
    if (ratio > REGRESSION_THRESHOLD) {
      regressions.push({ metric: 'fps', baseline: baseline.fps, current: current.fps, regression: `-${(ratio * 100).toFixed(1)}%` })
    }
  }
  return regressions
}

function main() {
  console.log('━'.repeat(60))
  console.log('  📈 性能基线趋势监控 (Performance Baseline Trend)')
  console.log('━'.repeat(60))

  // --read-only: 只比对、不更新基线（供并发 CI job 使用，避免跨 job 写竞态）
  const readOnly = process.argv.includes('--read-only')
  if (readOnly) console.log('  ℹ️  只读模式：仅比对回归，不更新基线')

  // 读取当前性能结果
  const current = {}
  const coldStartFile = join(RESULTS_DIR, 'cold-start.json')
  const memoryFile = join(RESULTS_DIR, 'memory-usage.json')
  const fpsFile = join(RESULTS_DIR, 'fps-test.json')
  const packageFile = join(RESULTS_DIR, 'package-size.json')

  if (existsSync(packageFile)) {
    try {
      const pkg = JSON.parse(readFileSync(packageFile, 'utf-8'))
      if (pkg.packages?.[0]) current.packageSize = pkg.packages[0].sizeMB
    } catch {}
  }

  // 读取单项指标 JSON（P3-12 S1：由各 perf 脚本 saveResultJson 留存）
  const missing = []
  for (const [file, key] of [['cold-start.json', 'coldStart'], ['memory-usage.json', 'memory'], ['fps-test.json', 'fps']]) {
    const fp = join(RESULTS_DIR, file)
    if (!existsSync(fp)) {
      missing.push(`${file}（不存在）`)
      continue
    }
    let rec = null
    try { rec = JSON.parse(readFileSync(fp, 'utf-8')) } catch { missing.push(`${file}（JSON 解析失败）`); continue }
    if (typeof rec.value !== 'number' || !Number.isFinite(rec.value)) {
      missing.push(`${file}（value 非有限数值：${JSON.stringify(rec.value)}）`)
      continue
    }
    current[key] = rec.value
  }

  // fail-closed：缺任何一项指标就不放行。run 36097921523 的反例——四项采集步骤全
  // continue-on-error、结果文件一个没落，闸门却因"无可比数据 ⇒ 无回归"判 ✅ 并 exit 0，
  // 报告里五项指标全是 `—`、阈值 `undefined`，绿而空。
  // 也不允许在缺数据时把空 current 写成新基线（那会把"从没测过"固化成基准）。
  if (missing.length > 0 && !process.argv.includes('--allow-partial')) {
    console.error('  [FAIL] 指标缺数据，闸门判红（禁止 ⚠️ 后继续 success）:')
    for (const m of missing) console.error(`     - ${m}`)
    console.error('     采到全部指标后再跑；确需部分指标请显式加 --allow-partial。')
    process.exit(1)
  }
  if (missing.length > 0) {
    console.log(`  ⚠️  --allow-partial：忽略 ${missing.length} 项缺数据（CI 不使用该开关）`)
  }

  const baseline = loadBaseline()

  if (!baseline) {
    console.log('  ⚠️  无历史基线（perf/results/baseline.json 缺失）。')
    if (readOnly) {
      // 只读模式不落盘：等待可写 job（Windows）首跑成基
      console.log('  ⚠️  只读模式跳过成基，等待主 job 生成基线入库。')
      process.exit(0)
    }
    console.log('  ℹ️  当前结果将作为新基线保存（建议将真实基线提交入库，作为长期回归基准）。')
    saveBaseline({ timestamp: new Date().toISOString(), ...current })
    console.log('  ✅ 基线已保存。')
    process.exit(0)
  }

  console.log(`  ℹ️  基线日期: ${baseline.timestamp || 'unknown'}`)
  console.log(`  ℹ️  回归阈值: ${REGRESSION_THRESHOLD * 100}%`)

  const regressions = checkRegression(current, baseline)

  if (regressions.length === 0) {
    console.log('  ✅ 无性能回归。')
    // 更新基线（取更好值）；只读模式不落盘
    if (!readOnly) {
      const updated = { ...baseline, ...current, timestamp: new Date().toISOString() }
      saveBaseline(updated)
    }
  } else {
    console.log(`  ⚠️  检测到 ${regressions.length} 项性能回归:`)
    for (const r of regressions) {
      console.log(`     ${r.metric}: ${r.baseline} → ${r.current} (${r.regression})`)
    }
  }

  process.exit(regressions.length > 0 ? 1 : 0)
}

main()
