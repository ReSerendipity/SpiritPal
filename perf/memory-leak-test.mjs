// T-11: 内存泄漏检测测试脚本
// 检测长时间运行内存增长趋势，判定标准：增长率 < 5MB/h
import {
  THRESHOLDS, resolveExePath, launchExe, killProcess, getProcessMemoryMB,
  isProcessRunning, waitForProcess, sleep, formatResult, printResult,
  EXE_CANDIDATES, PROJECT_ROOT,
} from './_helpers.mjs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const RESULTS_DIR = join(PROJECT_ROOT, 'perf', 'results')

async function runMemoryLeakTest() {
  console.log('━'.repeat(60))
  console.log('  🔍 内存泄漏检测测试 (Memory Leak Test)')
  console.log('━'.repeat(60))

  const durationMin = parseInt(process.env.SPIRITPAL_LEAK_DURATION || '60', 10)
  const intervalSec = parseInt(process.env.SPIRITPAL_LEAK_INTERVAL || '60', 10)
  const { mode, exePath } = resolveExePath()
  const useDev = process.env.SPIRITPAL_DEV === '1' || mode === 'dev'

  console.log(`  ℹ️  测试时长: ${durationMin} 分钟`)
  console.log(`  ℹ️  采样间隔: ${intervalSec} 秒`)

  for (const exeName of EXE_CANDIDATES) killProcess(exeName)
  await sleep(500)

  let childProc = null
  if (!useDev) {
    childProc = launchExe(exePath)
  } else {
    childProc = spawn('pnpm', ['tauri', 'dev'], { cwd: PROJECT_ROOT, detached: true, stdio: 'ignore', shell: true })
  }

  let detectedExe = null
  for (const exeName of EXE_CANDIDATES) {
    const result = await waitForProcess({ processName: exeName, timeoutMs: 30000, intervalMs: 200 })
    if (result.found) { detectedExe = exeName; break }
  }

  if (!detectedExe) {
    console.log('  ❌ 应用未启动')
    printResult(formatResult({ name: '内存泄漏检测', value: Infinity, unit: 'MB/h', threshold: 5, compare: 'lt', detail: '应用未启动' }))
    process.exit(1)
  }

  console.log('  ℹ️  等待应用稳定（10秒）...')
  await sleep(10000)

  const totalSamples = Math.min(Math.floor((durationMin * 60) / intervalSec), 30)
  const samples = []
  console.log(`  ℹ️  开始采样（共 ${totalSamples} 次）...`)

  for (let i = 0; i < totalSamples; i++) {
    if (!isProcessRunning(detectedExe)) { console.log(`  ⚠️  进程已退出`); break }
    const memMB = getProcessMemoryMB(detectedExe)
    samples.push({ timestamp: Date.now(), sample: i + 1, memoryMB: Math.round(memMB * 100) / 100 })
    console.log(`     [${i + 1}/${totalSamples}] ${memMB.toFixed(2)} MB`)
    if (i < totalSamples - 1) await sleep(intervalSec * 1000)
  }

  if (childProc?.pid) { try { process.kill(-childProc.pid) } catch {} }
  for (const exeName of EXE_CANDIDATES) killProcess(exeName)

  if (samples.length < 3) {
    console.log('  ❌ 采样次数不足')
    process.exit(1)
  }

  const n = samples.length
  const x = samples.map((_, i) => i)
  const y = samples.map(s => s.memoryMB)
  const xMean = x.reduce((a, b) => a + b, 0) / n
  const yMean = y.reduce((a, b) => a + b, 0) / n
  const ssxx = x.reduce((s, xi) => s + (xi - xMean) ** 2, 0)
  const ssxy = x.reduce((s, xi, i) => s + (xi - xMean) * (y[i] - yMean), 0)
  const slope = ssxx > 0 ? ssxy / ssxx : 0
  const slopePerHour = slope * (3600 / intervalSec)

  const firstMB = samples[0].memoryMB
  const lastMB = samples[samples.length - 1].memoryMB
  const deltaMB = lastMB - firstMB

  console.log(`\n  📊 内存趋势分析:`)
  console.log(`     初始: ${firstMB.toFixed(2)} MB | 末尾: ${lastMB.toFixed(2)} MB | 变化: ${deltaMB > 0 ? '+' : ''}${deltaMB.toFixed(2)} MB`)
  console.log(`     增长率: ${slopePerHour.toFixed(2)} MB/h`)

  const passed = slopePerHour < 5
  const result = formatResult({
    name: '内存泄漏检测',
    value: Math.abs(slopePerHour),
    unit: 'MB/h',
    threshold: 5,
    compare: 'lt',
    detail: `增长率 ${slopePerHour.toFixed(2)} MB/h | 初始 ${firstMB.toFixed(2)} → 末尾 ${lastMB.toFixed(2)} MB | 采样 ${n} 次`,
  })
  printResult(result)

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(join(RESULTS_DIR, 'memory-leak.json'), JSON.stringify({ timestamp: new Date().toISOString(), ...result, samples }, null, 2))

  process.exit(passed ? 0 : 1)
}

runMemoryLeakTest().catch(err => { console.error('💥 异常:', err.message); process.exit(2) })
