// T-12: 常态驻留稳定性测试（Long-Session Stability Test）
//
// 报告 Q2 「常态驻留 7 天稳定性方案」的落地脚本。完整 7 天方案 = 用本脚本按场景矩阵运行：
//   1. 空闲驻留（scenario=idle）：全天候 24h 挂机，观测主进程 RSS / CPU% / 句柄 / 子进程 是否随时间泄漏；
//   2. 多窗口开关（scenario=windows）：用 --window-toggle-min 每 10 分钟对主窗口执行
//      SW_MINIMIZE / SW_RESTORE 交替开关，模拟用户反复呼出/收起桌宠；
//   3. LLM 交换 / 记忆写入：这两类需要应用内用户操作（如开启对话、触发记忆写入），
//      属人工扩展场景，脚本框架已预留 scenario 枚举位（LongSessionScenario 校验），
//      后续可扩展对应自动化采样逻辑。
//
// 判据：
//   - 主进程 RSS 线性回归增长率 < 5MB/h → PASS（与 memory-leak-test 同标）；
//   - 同时采集 CPU% / 句柄数 / 子进程数 / DB 体积作为辅助指标线，用于观察是否随会话时间累积。
//
// 用法:
//   node perf/long-session-test.mjs [--scenario idle|windows] [--duration-min 60]
//     [--interval-sec 60] [--data-dir <path>] [--window-toggle-min 10]
//
// 输出:
//   - perf/results/long-session-results/<scenario>-<YYYYMMDD_HHMMSS>.json（含全量 samples + summary + env meta）
//   - perf/results/long-session-results/<scenario>-<YYYYMMDD_HHMMSS>.csv
//
// 说明：perf/results/long-session-results/ 已在 .gitignore 忽略。
import {
  resolveExePath, launchExe, killProcess, isProcessRunning,
  getProcessMemoryMB, waitForProcess, sleep, EXE_CANDIDATES, PROJECT_ROOT,
  isWindows, runPowerShell,
} from './_helpers.mjs'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { platform, arch } from 'node:os'

// ============================================================
// 常量与参数解析
// ============================================================
const RESULTS_DIR = join(PROJECT_ROOT, 'perf', 'results', 'long-session-results')

// 预留的 scenario 枚举位：当前仅实现 idle / windows；后续可扩展 llm-swap / memory-write 等人工扩展场景
const SCENARIOS = ['idle', 'windows']
const SCENARIO_LABEL = { idle: '空闲驻留', windows: '多窗口开关' }

// T-12: 参数解析，宽容接受 `--k v` / `--k=v` / `-k v` 三种格式
function parseArgs(argv) {
  const args = { scenario: 'idle', durationMin: 60, intervalSec: 60, dataDir: null, windowToggleMin: 10 }
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith('-')) continue
    const eqIdx = raw.indexOf('=')
    const key = (eqIdx >= 0 ? raw.slice(0, eqIdx) : raw).replace(/^-+/, '')
    const inlineVal = eqIdx >= 0 ? raw.slice(eqIdx + 1) : null
    const readVal = () => (inlineVal != null ? inlineVal : argv[++i])

    switch (key) {
      case 'scenario': args.scenario = readVal(); break
      case 'duration-min': args.durationMin = parseInt(readVal(), 10); break
      case 'interval-sec': args.intervalSec = parseInt(readVal(), 10); break
      case 'data-dir': args.dataDir = readVal(); break
      case 'window-toggle-min': args.windowToggleMin = parseInt(readVal(), 10); break
      default: /* 忽略未知参数 */ break
    }
  }
  args.scenario = args.scenario.toLowerCase()
  if (!SCENARIOS.includes(args.scenario)) {
    args.scenario = 'idle' // 宽容回退
  }
  return args
}

// ============================================================
// 采集辅助函数（PowerShell Windows 专属，失败一律降级为 null）
// ============================================================
// 单个属性求和
function psSumMetric(processName, expression) {
  if (!isWindows()) return null
  const out = runPowerShell(
    `Get-Process -Name '${processName.replace(/\.exe$/i, '')}' -ErrorAction SilentlyContinue | ForEach-Object { (${expression}) } | Measure-Object -Sum | Select-Object -ExpandProperty Sum`,
    { allowFail: true },
  )
  const n = parseInt(out, 10)
  return isNaN(n) ? null : n
}

// 句柄数：HandleCount 求和
function getHandleCount(processName) {
  return psSumMetric(processName, '$_.HandleCount')
}

// 线程数：Threads.Count 求和
function getThreadCount(processName) {
  return psSumMetric(processName, '$_.Threads.Count')
}

// CPU 秒数：所有同名进程 CPU 总秒数（用于计算两次采样间的 CPU%）
function getCpuSeconds(processName) {
  if (!isWindows()) return null
  const out = runPowerShell(
    `Get-Process -Name '${processName.replace(/\.exe$/i, '')}' -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum | Select-Object -ExpandProperty Sum`,
    { allowFail: true },
  )
  const n = parseFloat(out)
  return isNaN(n) ? null : n
}

// 子进程统计：父进程为 detectedExe 的进程列表，返回 { childCount, childRssMB }
function getChildProcessInfo(processName) {
  if (!isWindows()) return { childCount: null, childRssMB: null }
  const baseName = processName.replace(/\.exe$/i, '')
  const out = runPowerShell(
    `$ids = @(Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id);
     if ($ids.Count -gt 0) {
       Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -in $ids } | Select-Object Name, WorkingSetSize
     }`,
    { allowFail: true },
  )
  if (!out) return { childCount: 0, childRssMB: 0 }
  let count = 0
  let rssBytes = 0
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    count++
    // 行尾为 WorkingSetSize（字节）
    const m = t.match(/\s+(\d+)$/)
    if (m) rssBytes += parseInt(m[1], 10)
  }
  return { childCount: count, childRssMB: (rssBytes / (1024 * 1024)) }
}

// DB 体积：递归统计 dataDir 下所有 .db 文件总字节；目录不存在返回 null
function getDbBytes(dataDir) {
  if (!dataDir) return null
  if (!existsSync(dataDir)) return null
  let total = 0
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.db')) total += statSync(full).size
    }
  }
  walk(dataDir)
  return total
}

// Windows 下对主窗口执行 SW_MINIMIZE(nCmdShow=6) / SW_RESTORE(=9) 交替；失败静默
function toggleMainWindow(processName, minimize) {
  if (!isWindows()) return
  const baseName = processName.replace(/\.exe$/i, '')
  const cmdShow = minimize ? 6 : 9
  runPowerShell(
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W32 { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c); }';
     $w = Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;
     if ($w) { [W32]::ShowWindowAsync($w.MainWindowHandle, ${cmdShow}) }`,
    { allowFail: true },
  )
}

// ============================================================
// 线性回归（复用 memory-leak-test 复用公式）
// ============================================================
function linearRegression(y, intervalSec) {
  const n = y.length
  if (n < 2) return { slope: 0, slopePerHour: 0 }
  const x = y.map((_, i) => i)
  const xMean = x.reduce((a, b) => a + b, 0) / n
  const yMean = y.reduce((a, b) => a + b, 0) / n
  const ssxx = x.reduce((s, xi) => s + (xi - xMean) ** 2, 0)
  const ssxy = x.reduce((s, xi, i) => s + (xi - xMean) * (y[i] - yMean), 0)
  const slope = ssxx > 0 ? ssxy / ssxx : 0
  return { slope, slopePerHour: slope * (3600 / intervalSec) }
}

// ============================================================
// 结果落盘
// ============================================================
function timestampLabel() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

// ============================================================
// 主流程
// ============================================================
async function runLongSessionTest() {
  const args = parseArgs(process.argv.slice(2))

  console.log('━'.repeat(60))
  console.log(`  📊 常态驻留稳定性测试 (Long-Session Test) — ${SCENARIO_LABEL[args.scenario]}`)
  console.log('━'.repeat(60))

  const { mode, exePath } = resolveExePath()
  console.log(`  ℹ️  场景: ${args.scenario} (${SCENARIO_LABEL[args.scenario]}) | 时长: ${args.durationMin} 分钟 | 间隔: ${args.intervalSec} 秒 | 模式: ${mode}`)
  if (args.scenario === 'windows') console.log(`  ℹ️  窗口开关间隔: ${args.windowToggleMin} 分钟`)
  if (args.dataDir) console.log(`  ℹ️  数据目录(采集 DB 体积): ${args.dataDir}`)
  else console.log(`  ℹ️  未提供 --data-dir，跳过 DB 体积指标（输出中 dbBytes 恒为 null）`)

  // 清理残留进程 + 启动
  for (const exeName of EXE_CANDIDATES) killProcess(exeName)
  await sleep(500)
  if (!exePath) {
    console.log('  ❌ 应用未启动（未找到构建产物 exe，可设置 SPIRITPAL_EXE 指定）')
    return { aborted: true, reason: 'no-exe' }
  }
  const childProc = launchExe(exePath)

  // 探测实际匹配的 exe 名
  let detectedExe = null
  for (const exeName of EXE_CANDIDATES) {
    const result = await waitForProcess({ processName: exeName, timeoutMs: 30000, intervalMs: 200 })
    if (result.found) { detectedExe = exeName; break }
  }
  if (!detectedExe) {
    console.log('  ❌ 应用未启动')
    return { aborted: true, reason: 'not-found' }
  }
  console.log(`  ℹ️  已检测到进程: ${detectedExe}`)

  // 等待稳定
  console.log('  ℹ️  等待应用稳定（10秒）...')
  await sleep(10000)

  // 循环采样
  const totalSamples = Math.max(Math.floor((args.durationMin * 60) / args.intervalSec), 1)
  const samples = []
  let prevCpuSec = null
  let toggleCount = 0

  console.log(`  ℹ️  开始采样（共 ${totalSamples} 次）...`)
  for (let i = 0; i < totalSamples; i++) {
    if (!isProcessRunning(detectedExe)) { console.log('  ⚠️  进程已退出'); break }

    const elapsedSec = i * args.intervalSec
    const rssMB = getProcessMemoryMB(detectedExe)
    const handles = getHandleCount(detectedExe)
    const threads = getThreadCount(detectedExe)
    const cpuSec = getCpuSeconds(detectedExe)
    let cpuPercent = null
    if (prevCpuSec != null && cpuSec != null && args.intervalSec > 0) {
      cpuPercent = ((cpuSec - prevCpuSec) / args.intervalSec) * 100
      cpuPercent = Math.round(cpuPercent * 100) / 100
    }
    prevCpuSec = cpuSec
    const { childCount, childRssMB } = getChildProcessInfo(detectedExe)
    const dbBytes = getDbBytes(args.dataDir)

    samples.push({
      sample: i + 1,
      elapsedSec,
      elapsedMin: Math.round((elapsedSec / 60) * 10) / 10,
      rssMB: Math.round(rssMB * 100) / 100,
      handles,
      threads,
      cpuPercent,
      childCount,
      childRssMB: childRssMB != null ? Math.round(childRssMB * 100) / 100 : null,
      dbBytes,
    })
    console.log(
      `     [${i + 1}/${totalSamples}] RSS=${rssMB.toFixed(2)}MB` +
      ` | CPU%=${cpuPercent != null ? cpuPercent + '%' : 'N/A'}` +
      ` | 句柄=${handles ?? 'N/A'}` +
      ` | 线程=${threads ?? 'N/A'}` +
      ` | 子进程=${childCount ?? 'N/A'}` +
      ` | DB=${dbBytes != null ? (dbBytes / (1024 * 1024)).toFixed(2) + 'MB' : 'N/A'}`,
    )

    // 多窗口开关场景：每个 window-toggle-min 分钟交替最小化/恢复（按 (toggleCount+1) 递增阈值，保证每间隔仅触发一次）
    if (args.scenario === 'windows' && elapsedSec >= (toggleCount + 1) * args.windowToggleMin * 60) {
      const minimize = toggleCount % 2 === 0
      toggleMainWindow(detectedExe, minimize)
      toggleCount++
      console.log(`     🔄 窗口开关 #${toggleCount} (${minimize ? '最小化' : '恢复'}) @ ${elapsedSec}s`)
    }

    if (i < totalSamples - 1) await sleep(args.intervalSec * 1000)
  }

  // 清理
  if (childProc?.pid) { try { process.kill(-childProc.pid) } catch {} }
  for (const exeName of EXE_CANDIDATES) killProcess(exeName)

  // 统计
  const envMeta = { os: platform(), arch: arch(), mode, timestamp: new Date().toISOString() }
  if (samples.length < 3) {
    console.log('  ❌ 采样次数不足（samples<3），无法判定')
    writeResult(args, samples, { passed: false, reason: 'insufficient-samples' }, envMeta)
    return { aborted: true, reason: 'insufficient-samples' }
  }

  const y = samples.map((s) => s.rssMB)
  const { slopePerHour } = linearRegression(y, args.intervalSec)
  const first = samples[0]
  const last = samples[samples.length - 1]
  const deltaMB = last.rssMB - first.rssMB

  console.log('\n  📊 稳定性趋势分析:')
  console.log(`     RSS 初始: ${first.rssMB.toFixed(2)} MB | 末尾: ${last.rssMB.toFixed(2)} MB | 变化: ${deltaMB >= 0 ? '+' : ''}${deltaMB.toFixed(2)} MB`)
  console.log(`     增长率: ${slopePerHour.toFixed(2)} MB/h`)
  if (last.handles != null && first.handles != null) console.log(`     句柄: ${first.handles} → ${last.handles} (delta ${last.handles - first.handles})`)
  if (last.dbBytes != null && first.dbBytes != null) console.log(`     DB 体积: ${(first.dbBytes / (1024 * 1024)).toFixed(2)} → ${(last.dbBytes / (1024 * 1024)).toFixed(2)} MB`)

  const passed = slopePerHour < 5
  console.log(`\n  ${passed ? '✅ PASS' : '❌ FAIL'}（增长率 ${passed ? '<' : '≥'} 5MB/h）`)
  console.log('  📌 副指标（句柄/线程/子进程/DB体积）为辅助观察线，请结合 CSV 判断是否随会话时间累积')

  const summary = {
    scenario: args.scenario,
    scenarioLabel: SCENARIO_LABEL[args.scenario],
    durationMin: args.durationMin,
    intervalSec: args.intervalSec,
    sampleCount: samples.length,
    firstRssMB: first.rssMB,
    lastRssMB: last.rssMB,
    deltaMB: Math.round(deltaMB * 100) / 100,
    slopePerHour: Math.round(slopePerHour * 100) / 100,
    growthLimitMbPerHour: 5,
    passed,
    windowToggleCount: toggleCount,
    detectedExe,
  }

  writeResult(args, samples, summary, envMeta)
  console.log(`  💾 结果已写入: ${RESULTS_DIR}`)
  return { aborted: false, passed }
}

function writeResult(args, samples, summary, envMeta) {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
  const base = `${args.scenario}-${timestampLabel()}`
  const jsonPath = join(RESULTS_DIR, base + '.json')
  const csvPath = join(RESULTS_DIR, base + '.csv')

  writeFileSync(jsonPath, JSON.stringify(
    { env: envMeta, args, summary, samples },
    null, 2,
  ))

  const header = ['sample', 'elapsedSec', 'elapsedMin', 'rssMB', 'handles', 'threads', 'cpuPercent', 'childCount', 'childRssMB', 'dbBytes']
  const csv = [header.join(',')]
  for (const s of samples) {
    csv.push([
      s.sample, s.elapsedSec, s.elapsedMin, s.rssMB,
      s.handles ?? '', s.threads ?? '', s.cpuPercent ?? '', s.childCount ?? '', s.childRssMB ?? '', s.dbBytes ?? '',
    ].join(','))
  }
  writeFileSync(csvPath, csv.join('\n'))
}

runLongSessionTest()
  .catch((err) => { console.error('💥 异常:', err.message); process.exit(2) })