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
  let envError = null

  console.log('  ℹ️  等待窗口出现...')

  // 先等进程出现（拿到 PID），再按 PID 判窗口是否真的映射出来。
  // 这里刻意没有"进程出现即算时间"的回退：那等于把"起没起来"和"界面出不来"混为一谈，
  // run 36131292512 就是靠这条回退在无 DISPLAY 时给出 8ms 的假 PASS。
  let procPid = null
  let procName = null
  for (const exeName of EXE_CANDIDATES) {
    const procResult = await waitForProcess({
      processName: exeName,
      timeoutMs: useDev ? timeoutMs : Math.min(timeoutMs, 15000),
      intervalMs: 100,
      checkWindow: false,
    })
    if (procResult.found) {
      procName = exeName.replace(/\.exe$/i, '')
      procPid = useDev ? null : (childProc && childProc.pid) || null
      break
    }
  }

  if (!procName) {
    found = false
    console.log('  ❌ 应用进程未在超时内出现')
  } else if (isWindows()) {
    // Windows：沿用 MainWindowTitle 判定，但同样去掉"进程在就算冷启动成功"的回退
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (hasProcessWindow(procName)) {
        found = true; elapsedMs = Date.now() - startTime
        console.log(`  ✅ 窗口已出现：${procName}（${elapsedMs}ms）`)
        break
      }
      await sleep(100)
    }
    if (!found) console.log(`  ❌ 超时 ${timeoutMs}ms 内未出现窗口（进程 ${procName} 存活）`)
  } else {
    // Linux/macOS：按 PID 判窗口。工具或窗口管理器缺失时判"环境错误"，不给分数。
    const tool = windowTool()
    const pid = procPid
    if (!tool) {
      envError = '缺少 X 侧窗口检测工具（xdotool / wmctrl），无法判定窗口是否出现'
    } else if (!pid && !useDev) {
      envError = `拿不到子进程 PID，无法用 ${tool} 按 PID 判定窗口`
    } else {
      const deadline = Date.now() + timeoutMs
      let last = null
      while (Date.now() < deadline) {
        last = hasWindowForPid(pid)
        if (last === null) {
          envError = `${tool} 无法完成检测（无 DISPLAY，或 Xvfb 上没起窗口管理器）`
          break
        }
        if (last === true) {
          found = true; elapsedMs = Date.now() - startTime
          console.log(`  ✅ 窗口已出现：pid=${pid} via ${tool}（${elapsedMs}ms）`)
          break
        }
        await sleep(100)
      }
      if (!found && !envError) {
        console.log(`  ❌ 超时 ${timeoutMs}ms 内未出现窗口（pid=${pid} 存活，via ${tool}）`)
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
  if (envError) {
    // 环境不可用 ≠ 性能不达标：抛给入口按 exit 2 结束，原因写进日志。
    // 绝不复用"进程出现即 PASS"那条路，否则又变回假绿。
    throw new Error(`检测环境不可用：${envError}`)
  }
  if (!found) {
    console.log(`  ❌ 判 FAIL：窗口未在 ${timeoutMs}ms 内出现（进程名 ${procName || '未检出'}）`)
    const result = formatResult({
      name: '冷启动时间',
      value: timeoutMs,
      unit: 'ms',
      threshold: THRESHOLDS.coldStartMs,
      compare: 'lt',
      detail: `超时未出现窗口（${timeoutMs}ms）`,
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
