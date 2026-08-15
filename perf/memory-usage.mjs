// perf/memory-usage.mjs — 内存占用测试
//
// 测试目标（PRD v0.2）：运行时稳定内存 < 80 MB
//
// 实现方案：
//   1. 自动探测构建产物 exe（release > debug > dev 模式）
//   2. 先清理残留进程，再启动应用
//   3. 等待 10 秒让内存稳定（应用初始化 + 窗口渲染完成后）
//   4. 通过 PowerShell Get-Process 获取 WorkingSet64（工作集内存，字节）
//   5. 字节 → MB 转换
//   6. 多次采样取平均值以减少波动
//   7. 清理进程，输出结果并判断是否 < 80MB
//
// 环境变量：
//   SPIRITPAL_EXE   — 显式指定 exe 路径（优先级最高）
//   SPIRITPAL_DEV=1 — 强制使用 dev 模式（pnpm tauri dev）
//   SPIRITPAL_STABILIZE_MS — 稳定等待时间（ms，默认 10000）
//   SPIRITPAL_SAMPLE_COUNT — 采样次数（默认 3，每次间隔 2 秒）
//
// 运行方式：
//   node perf/memory-usage.mjs
//   pnpm perf:memory

import { spawn } from 'node:child_process'
import {
  THRESHOLDS,
  resolveExePath,
  launchExe,
  killProcess,
  getProcessMemoryMB,
  isProcessRunning,
  waitForProcess,
  sleep,
  formatResult,
  printResult,
  EXE_CANDIDATES,
  PROJECT_ROOT,
} from './_helpers.mjs'

// ============================================================
// 主测试函数
// ============================================================
async function runMemoryTest() {
  console.log('━'.repeat(60))
  console.log('  💾 内存占用测试 (Memory Usage Test)')
  console.log('━'.repeat(60))

  // --- 1. 探测 exe 路径 ---
  const { mode, exePath } = resolveExePath()
  const useDev = process.env.SPIRITPAL_DEV === '1' || mode === 'dev'

  if (useDev) {
    console.log('  ℹ️  模式: dev (pnpm tauri dev)')
    console.log('     注意: dev 模式内存偏高（含 Vite + Rust debug 符号）')
  } else {
    console.log(`  ℹ️  模式: ${mode}`)
    console.log(`     exe:  ${exePath}`)
  }

  // --- 2. 清理残留进程 ---
  console.log('  ℹ️  清理残留进程...')
  for (const exeName of EXE_CANDIDATES) {
    killProcess(exeName)
  }
  await sleep(500)

  // --- 3. 启动应用 ---
  console.log('  ℹ️  启动应用...')
  let childProc = null
  let devProc = null

  if (useDev) {
    devProc = spawn('pnpm', ['tauri', 'dev'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      shell: true,
    })
  } else {
    childProc = launchExe(exePath)
  }

  // --- 4. 等待应用启动 + 内存稳定 ---
  const stabilizeMs = parseInt(process.env.SPIRITPAL_STABILIZE_MS || '10000', 10)
  const timeoutMs = parseInt(process.env.SPIRITPAL_PERF_TIMEOUT || '60000', 10)

  console.log(`  ℹ️  等待应用启动（超时 ${timeoutMs}ms）...`)
  let detectedExe = null
  for (const exeName of EXE_CANDIDATES) {
    const result = await waitForProcess({
      processName: exeName,
      timeoutMs,
      intervalMs: 200,
      checkWindow: false,
    })
    if (result.found) {
      detectedExe = exeName
      console.log(`  ℹ️  检测到进程: ${exeName}（${result.elapsedMs}ms）`)
      break
    }
  }

  if (!detectedExe) {
    console.log('  ❌ 应用未启动（超时）')
    const result = formatResult({
      name: '内存占用',
      value: Infinity,
      unit: 'MB',
      threshold: THRESHOLDS.memoryMB,
      compare: 'lt',
      detail: '应用未启动，无法测量内存',
    })
    printResult(result)

    // 清理
    if (devProc && devProc.pid) {
      try { process.kill(-devProc.pid) } catch {}
    }
    return result
  }

  console.log(`  ℹ️  等待内存稳定（${stabilizeMs / 1000}秒）...`)
  await sleep(stabilizeMs)

  // --- 5. 多次采样 ---
  const sampleCount = parseInt(process.env.SPIRITPAL_SAMPLE_COUNT || '3', 10)
  const samples = []
  console.log(`  ℹ️  采样内存（${sampleCount} 次，每次间隔 2 秒）...`)

  for (let i = 0; i < sampleCount; i++) {
    if (!isProcessRunning(detectedExe)) {
      console.log(`  ⚠️  第 ${i + 1} 次采样时进程已退出`)
      break
    }
    const memMB = getProcessMemoryMB(detectedExe)
    samples.push(memMB)
    console.log(`     采样 ${i + 1}: ${memMB.toFixed(2)} MB`)
    if (i < sampleCount - 1) await sleep(2000)
  }

  // --- 6. 清理进程 ---
  console.log('  ℹ️  清理测试进程...')
  await sleep(500)

  if (childProc && childProc.pid) {
    try { process.kill(-childProc.pid) } catch {}
  }
  if (devProc && devProc.pid) {
    try { process.kill(-devProc.pid) } catch {}
  }
  for (const exeName of EXE_CANDIDATES) {
    killProcess(exeName)
  }

  // --- 7. 输出结果 ---
  if (samples.length === 0) {
    console.log('  ❌ 未能采集到内存数据')
    const result = formatResult({
      name: '内存占用',
      value: Infinity,
      unit: 'MB',
      threshold: THRESHOLDS.memoryMB,
      compare: 'lt',
      detail: '进程在采样前已退出',
    })
    printResult(result)
    return result
  }

  const avgMB = samples.reduce((a, b) => a + b, 0) / samples.length
  const maxMB = Math.max(...samples)
  const minMB = Math.min(...samples)

  const result = formatResult({
    name: '内存占用',
    value: avgMB,
    unit: 'MB',
    threshold: THRESHOLDS.memoryMB,
    compare: 'lt',
    detail: `平均 ${avgMB.toFixed(2)} MB | 最高 ${maxMB.toFixed(2)} MB | 最低 ${minMB.toFixed(2)} MB | 采样 ${samples.length} 次`,
  })
  printResult(result)
  return result
}

// ============================================================
// 入口
// ============================================================
try {
  const result = await runMemoryTest()
  process.exit(result.passed ? 0 : 1)
} catch (err) {
  console.error('\n  💥 测试发生异常:', err.message)
  console.error(err.stack)
  process.exit(2)
}
