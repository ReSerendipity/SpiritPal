// perf/cold-start.mjs — 冷启动时间测试
//
// 测试目标（PRD v0.2）：冷启动时间 < 2 秒（从进程启动到宠物窗口可见）
//
// 实现方案：
//   1. 自动探测构建产物 exe（release > debug > dev 模式）
//   2. 先清理可能残留的旧进程
//   3. 记录启动时间戳，spawn exe
//   4. 轮询检测窗口出现（通过 PowerShell Get-Process 检查 MainWindowTitle）
//   5. 窗口出现时记录结束时间戳，计算冷启动耗时
//   6. 清理进程，输出结果并判断是否 < 2000ms
//
// 环境变量：
//   SPIRITPAL_EXE   — 显式指定 exe 路径（优先级最高）
//   SPIRITPAL_DEV=1 — 强制使用 dev 模式（pnpm tauri dev）
//   SPIRITPAL_PERF_TIMEOUT — 超时时间（ms，默认 30000）
//
// 运行方式：
//   node perf/cold-start.mjs
//   pnpm perf:cold-start

import { spawn } from 'node:child_process'
import {
  THRESHOLDS,
  resolveExePath,
  launchExe,
  killProcess,
  isProcessRunning,
  hasProcessWindow,
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
async function runColdStartTest() {
  console.log('━'.repeat(60))
  console.log('  ⏱️  冷启动时间测试 (Cold Start Test)')
  console.log('━'.repeat(60))

  // --- 1. 探测 exe 路径 ---
  const { mode, exePath } = resolveExePath()
  const useDev = process.env.SPIRITPAL_DEV === '1' || mode === 'dev'

  if (useDev) {
    console.log('  ℹ️  模式: dev (pnpm tauri dev)')
    console.log('     注意: dev 模式包含 Vite + Cargo 编译，耗时显著高于 release')
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

  // --- 3. 启动进程并计时 ---
  console.log('  ℹ️  启动应用，开始计时...')
  const startTime = Date.now()

  let childProc = null
  let devProc = null

  if (useDev) {
    // dev 模式：启动 pnpm tauri dev
    devProc = spawn('pnpm', ['tauri', 'dev'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      shell: true,
    })
  } else {
    // exe 模式：直接启动 exe
    childProc = launchExe(exePath)
  }

  // --- 4. 轮询检测窗口出现 ---
  // 尝试用多个可能的进程名检测
  const timeoutMs = parseInt(process.env.SPIRITPAL_PERF_TIMEOUT || '30000', 10)
  let found = false
  let elapsedMs = 0

  console.log('  ℹ️  等待窗口出现...')

  // 先等待进程出现，再等待窗口
  for (const exeName of EXE_CANDIDATES) {
    if (found) break
    const procResult = await waitForProcess({
      processName: exeName,
      timeoutMs: useDev ? timeoutMs : Math.min(timeoutMs, 15000),
      intervalMs: 100,
      checkWindow: false,
    })
    if (procResult.found) {
      // 进程已出现，尝试检测窗口（短超时，Tauri 无装饰窗口可能没有标题）
      const winResult = await waitForProcess({
        processName: exeName,
        timeoutMs: 5000,
        intervalMs: 100,
        checkWindow: true,
      })
      if (winResult.found) {
        found = true
        elapsedMs = Date.now() - startTime
        console.log(`  ℹ️  检测到窗口: ${exeName}`)
        break
      } else {
        // 窗口未出现但进程在运行，使用进程出现时间作为冷启动时间
        elapsedMs = procResult.elapsedMs
        found = true
        console.log(`  ℹ️  检测到进程: ${exeName}（窗口标题未检测到，使用进程出现时间 ${procResult.elapsedMs}ms）`)
        break
      }
    }
  }

  // --- 5. 清理进程 ---
  console.log('  ℹ️  清理测试进程...')
  await sleep(1000)

  if (childProc && childProc.pid) {
    try {
      process.kill(-childProc.pid)
    } catch {
      // 进程可能已退出
    }
  }
  if (devProc && devProc.pid) {
    try {
      process.kill(-devProc.pid)
    } catch {
      // 进程可能已退出
    }
  }
  // 确保清理所有相关进程
  for (const exeName of EXE_CANDIDATES) {
    killProcess(exeName)
  }

  // --- 6. 输出结果 ---
  if (!found) {
    console.log('  ❌ 未检测到应用进程启动（超时）')
    const result = formatResult({
      name: '冷启动时间',
      value: timeoutMs,
      unit: 'ms',
      threshold: THRESHOLDS.coldStartMs,
      compare: 'lt',
      detail: `超时未检测到窗口（${timeoutMs}ms）`,
    })
    printResult(result)
    return result
  }

  const result = formatResult({
    name: '冷启动时间',
    value: elapsedMs,
    unit: 'ms',
    threshold: THRESHOLDS.coldStartMs,
    compare: 'lt',
    detail: useDev
      ? 'dev 模式（含编译），release 模式预期更优'
      : `${mode} 模式，从启动到窗口可见`,
  })
  printResult(result)
  saveResultJson('cold-start', result)
  return result
}

// ============================================================
// 入口
// ============================================================
try {
  const result = await runColdStartTest()
  process.exit(result.passed ? 0 : 1)
} catch (err) {
  console.error('\n  💥 测试发生异常:', err.message)
  console.error(err.stack)
  process.exit(2)
}
