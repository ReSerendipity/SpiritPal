// perf/memory-usage.mjs — 内存占用测试
//
// 测试目标（PRD v0.2）：运行时稳定内存 < 80 MB
//
// 实现方案：
//   1. 自动探测构建产物 exe（release > debug > dev 模式）
//   2. 先清理残留进程，再启动应用
//   3. 等进程出现 → 等窗口真的映射出来 → 才开始稳定倒计时
//      （旧实现从 spawn 起直接睡 10 秒，量到的是启动中途的 RSS，不是稳态，见下方注释）
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
//   SPIRITPAL_WINDOW_TIMEOUT_MS — 等窗口出现的预算（ms，默认 60000）
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
  isWindows,
  hasProcessWindow,
  hasWindowForPid,
  windowTool,
  waitForProcess,
  sleep,
  formatResult,
  saveResultJson,
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

  // 统一清理。窗口判定失败那条路也要走它——否则残留的 spiritpal-app 会一直占着 runner
  // 的内存，还会被后续步骤的 ps -C 匹配进去。
  const killTestProcs = () => {
    if (childProc && childProc.pid) {
      try { process.kill(-childProc.pid) } catch {}
    }
    if (devProc && devProc.pid) {
      try { process.kill(-devProc.pid) } catch {}
    }
    for (const exeName of EXE_CANDIDATES) {
      killProcess(exeName)
    }
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
      // EXE_CANDIDATES 是 Windows 形态的名字（isProcessRunning 会剥掉 .exe 再 pgrep），
      // 原样打印会让 Linux 日志谎称进程叫 spiritpal-app.exe —— run 36131292512 的日志就是这样。
      const shown = isWindows() ? exeName : exeName.replace(/\.exe$/i, '')
      console.log(`  ℹ️  检测到进程: ${shown}（${result.elapsedMs}ms）`)
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

    killTestProcs()
    return result
  }

  // --- 4.5 窗口真的映射出来之后，才起稳定倒计时 ---
  // run 36160969873 实测：同一个 deb 主二进制在 CI-Xvfb 下窗口要到 26.4s 才出现，而旧流程
  // 从 spawn 起就睡 stabilizeMs，三次采样落在 10.1s / 12.1s / 14.1s（全在窗口之前），
  // 读数 byte 级一致（90.74/90.74/90.74）——那量的是"启动中途停住"，不是稳态内存；
  // 收进基线后，任何启动时序变动都会让它动，与内存效率无关。
  // 判窗复用 #98 的按 PID 检测（xdotool 优先、wmctrl -lp 兜底）；判不了或超时未出现，
  // 一律按环境错误抛出 → 入口 exit 2，与 perf/cold-start.mjs 同构 fail-closed：
  // 宁可不给数，也不给一个"没窗也照采"的数。
  const winBudgetMs = parseInt(process.env.SPIRITPAL_WINDOW_TIMEOUT_MS || '60000', 10)
  const winPid = useDev ? null : (childProc && childProc.pid) || null
  const winName = detectedExe.replace(/\.exe$/i, '')
  console.log(`  ℹ️  等待窗口出现后再计时（超时 ${winBudgetMs}ms）...`)

  if (isWindows()) {
    const deadline = Date.now() + winBudgetMs
    let windowUp = false
    while (Date.now() < deadline) {
      if (hasProcessWindow(winName)) {
        windowUp = true
        console.log(`  ✅ 窗口已出现：${winName}`)
        break
      }
      await sleep(200)
    }
    if (!windowUp) {
      killTestProcs()
      throw new Error(`检测环境不可用：窗口未在 ${winBudgetMs}ms 内出现（进程 ${winName} 存活），内存稳态无法判定`)
    }
  } else {
    const tool = windowTool()
    if (!tool) {
      killTestProcs()
      throw new Error('检测环境不可用：缺少 X 侧窗口检测工具（xdotool / wmctrl），无法判定窗口是否出现')
    }
    if (!winPid && !useDev) {
      killTestProcs()
      throw new Error(`检测环境不可用：拿不到子进程 PID，无法用 ${tool} 按 PID 判定窗口`)
    }
    const deadline = Date.now() + winBudgetMs
    let windowUp = false
    while (Date.now() < deadline) {
      const state = hasWindowForPid(winPid)
      if (state === null) {
        killTestProcs()
        throw new Error(`检测环境不可用：${tool} 无法完成检测（无 DISPLAY，或 Xvfb 上没起窗口管理器）`)
      }
      if (state === true) {
        windowUp = true
        console.log(`  ✅ 窗口已出现：pid=${winPid} via ${tool}`)
        break
      }
      await sleep(200)
    }
    if (!windowUp) {
      killTestProcs()
      throw new Error(`检测环境不可用：窗口未在 ${winBudgetMs}ms 内出现（pid=${winPid} 存活，via ${tool}），内存稳态无法判定`)
    }
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
  killTestProcs()

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
  saveResultJson('memory-usage', result)
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
