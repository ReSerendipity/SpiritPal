// perf/_helpers.mjs — 性能测试共享工具模块
//
// 提供以下公共能力：
// - THRESHOLDS：性能阈值常量（来自 PRD v0.2）
// - resolveExePath()：自动探测构建产物 exe 路径（release > debug > dev 模式）
// - killProcess()：跨平台清理残留进程（Windows: taskkill, Linux/macOS: pkill）
// - isProcessRunning()：跨平台检查指定进程名是否在运行
// - getProcessMemoryMB()：跨平台获取进程内存占用（Windows: PowerShell, Linux: /proc, macOS: ps）
// - hasProcessWindow()：跨平台检查进程是否有可见窗口
// - runPowerShell()：执行 PowerShell 命令并返回 stdout（仅 Windows）
// - formatResult()：格式化单项测试结果输出
// - sleep()：Promise 延时
// - isWindows()：检测当前平台是否为 Windows
//
// S3 修复：跨平台支持 — Linux 使用 /proc 和 ps，Windows 使用 PowerShell
//
// 使用方式：import { THRESHOLDS, resolveExePath, ... } from './_helpers.mjs'

import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

// ============================================================
// 性能阈值（PRD v0.2）
// ============================================================
export const THRESHOLDS = {
  coldStartMs: 2000, // 冷启动时间 < 2 秒
  memoryMB: 80, // 内存占用 < 80 MB
  fps: 30, // Live2D 帧率 ≥ 30 fps
  packageSizeMB: 30, // 安装包大小 < 30 MB
}

// ============================================================
// 路径常量
// ============================================================
const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
export const PROJECT_ROOT = resolve(__dirname, '..')
export const SRC_TAURI_DIR = join(PROJECT_ROOT, 'src-tauri')

// Tauri exe 可能的文件名
// - spiritpal-app.exe：Tauri release 构建产物（使用包名，保留连字符）
// - spiritpal_app.exe：Cargo debug 构建产物（连字符 → 下划线）
// - SpiritPal.exe：productName 可能的命名
export const EXE_CANDIDATES = ['spiritpal-app.exe', 'spiritpal_app.exe', 'SpiritPal.exe']

// ============================================================
// 平台检测
// ============================================================
export function isWindows() {
  return platform() === 'win32'
}

export function isLinux() {
  return platform() === 'linux'
}

export function isMacOS() {
  return platform() === 'darwin'
}

// ============================================================
// sleep — Promise 延时
// ============================================================
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ============================================================
// runPowerShell — 执行 PowerShell 命令，返回 stdout 字符串
// 仅 Windows 可用；非 Windows 调用方应使用跨平台替代函数
// ============================================================
export function runPowerShell(script, options = {}) {
  const cmd = `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: options.timeout ?? 15000,
      windowsHide: true,
    }).trim()
  } catch (e) {
    if (options.allowFail) return ''
    throw e
  }
}

// ============================================================
// runCommand — 跨平台执行 shell 命令，返回 stdout 字符串
// ============================================================
function runCommand(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: options.timeout ?? 15000,
      windowsHide: true,
    }).trim()
  } catch (e) {
    if (options.allowFail) return ''
    throw e
  }
}

// ============================================================
// resolveExePath — 自动探测构建产物 exe 路径
//
// 优先级：
//   1. 环境变量 SPIRITPAL_EXE（用户显式指定）
//   2. src-tauri/target/release/<exe>
//   3. src-tauri/target/debug/<exe>
//   4. 返回 null（调用方应回退到 dev 模式）
//
// 返回：{ mode: 'release'|'debug'|'dev', exePath: string|null }
// ============================================================
export function resolveExePath() {
  // 1. 环境变量显式指定
  if (process.env.SPIRITPAL_EXE) {
    return { mode: 'release', exePath: process.env.SPIRITPAL_EXE }
  }

  // 2 & 3. 在 release / debug 目录中查找
  // Windows 使用 .exe，Linux/macOS 无扩展名
  const candidates = isWindows()
    ? EXE_CANDIDATES
    : ['spiritpal-app', 'spiritpal_app', 'SpiritPal']

  for (const buildType of ['release', 'debug']) {
    for (const exeName of candidates) {
      const exePath = join(SRC_TAURI_DIR, 'target', buildType, exeName)
      if (existsSync(exePath)) {
        return { mode: buildType, exePath }
      }
    }
  }

  // 4. 回退到 dev 模式
  return { mode: 'dev', exePath: null }
}

// ============================================================
// isProcessRunning — 跨平台检查指定进程名是否在运行
//
// Windows: PowerShell Get-Process
// Linux/macOS: pgrep
// ============================================================
export function isProcessRunning(processName) {
  const baseName = processName.replace(/\.exe$/i, '')

  if (isWindows()) {
    const output = runPowerShell(
      `Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue | Select-Object -First 1 | Measure-Object | Select-Object -ExpandProperty Count`,
      { allowFail: true },
    )
    return parseInt(output || '0', 10) > 0
  }

  // Linux/macOS: use pgrep
  const output = runCommand(`pgrep -x "${baseName}" 2>/dev/null || true`, { allowFail: true })
  return output.length > 0
}

// ============================================================
// getProcessMemoryMB — 跨平台获取进程内存占用（MB）
//
// Windows: PowerShell Get-Process WorkingSet64
// Linux: /proc/<pid>/status VmRSS
// macOS: ps -o rss
//
// 若存在多个同名进程，返回总和。
// ============================================================
export function getProcessMemoryMB(processName) {
  const baseName = processName.replace(/\.exe$/i, '')

  if (isWindows()) {
    const output = runPowerShell(
      `Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty WorkingSet64`,
      { allowFail: true },
    )
    if (!output) return 0
    const bytes = output
      .split(/\r?\n/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .reduce((sum, n) => sum + n, 0)
    return bytes / (1024 * 1024) // 字节 → MB
  }

  if (isLinux()) {
    // 使用 ps 获取 RSS（Resident Set Size）内存
    const output = runCommand(`ps -C "${baseName}" -o rss= 2>/dev/null || true`, { allowFail: true })
    if (!output) return 0
    const kb = output
      .split(/\r?\n/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .reduce((sum, n) => sum + n, 0)
    return kb / 1024 // KB → MB
  }

  if (isMacOS()) {
    const output = runCommand(`ps -A -o comm,rss | grep "${baseName}" | awk '{print $2}'`, { allowFail: true })
    if (!output) return 0
    const kb = output
      .split(/\r?\n/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .reduce((sum, n) => sum + n, 0)
    return kb / 1024 // KB → MB
  }

  return 0
}

// ============================================================
// hasProcessWindow — 跨平台检查进程是否有可见窗口
//
// Windows: PowerShell Get-Process MainWindowTitle
// Linux: wmctrl -l (需要安装 wmctrl)
// macOS: ps + AppleScript (简化：仅检查进程存在)
// ============================================================
export function hasProcessWindow(processName) {
  const baseName = processName.replace(/\.exe$/i, '')

  if (isWindows()) {
    const output = runPowerShell(
      `Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1 | Measure-Object | Select-Object -ExpandProperty Count`,
      { allowFail: true },
    )
    return parseInt(output || '0', 10) > 0
  }

  if (isLinux()) {
    // 使用 wmctrl 检查窗口列表（需要安装 wmctrl）
    const output = runCommand(`wmctrl -l 2>/dev/null | grep -i "${baseName}" || true`, { allowFail: true })
    return output.length > 0
  }

  // macOS: 简化为检查进程是否运行
  if (isMacOS()) {
    return isProcessRunning(processName)
  }

  return false
}

// ============================================================
// killProcess — 跨平台强制终止指定进程名
//
// Windows: PowerShell Stop-Process
// Linux/macOS: pkill
// ============================================================
export function killProcess(processName) {
  const baseName = processName.replace(/\.exe$/i, '')

  if (isWindows()) {
    runPowerShell(
      `Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue | Stop-Process -Force`,
      { allowFail: true },
    )
  } else {
    runCommand(`pkill -f "${baseName}" 2>/dev/null || true`, { allowFail: true })
  }
}

// ============================================================
// killProcessTree — 终止进程及其子进程（通过 PID）
// ============================================================
export function killProcessTree(pid) {
  if (isWindows()) {
    runPowerShell(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`, {
      allowFail: true,
    })
  } else {
    runCommand(`kill -TERM -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true`, { allowFail: true })
  }
}

// ============================================================
// formatResult — 格式化单项测试结果
//
// 返回对象：{ name, value, unit, threshold, passed, detail }
// ============================================================
export function formatResult({ name, value, unit, threshold, compare, detail }) {
  // compare: 'lt' = 值应 < threshold；'gte' = 值应 ≥ threshold
  const passed =
    compare === 'gte' ? value >= threshold : value < threshold
  return {
    name,
    value: Math.round(value * 100) / 100,
    unit,
    threshold,
    compare,
    passed,
    detail: detail || '',
  }
}

// ============================================================
// saveResultJson — 测试结果 JSON 留存（审计 P3-12 S1：统一结果留存）
//
// 将单项测试结果写入 perf/results/<id>.json，供 baseline-trend.mjs
// 与趋势看板消费。
// ============================================================
export function saveResultJson(id, result) {
  try {
    const resultsDir = join(PROJECT_ROOT, 'perf', 'results')
    if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
    const payload = {
      timestamp: new Date().toISOString(),
      ...result,
    }
    writeFileSync(join(resultsDir, id + '.json'), JSON.stringify(payload, null, 2))
  } catch (err) {
    console.error('  ?? 结果 JSON 留存失败 (' + id + '):', err.message)
  }
}

// ============================================================
// printResult — 打印单项测试结果到控制台
// ============================================================
export function printResult(result) {
  const status = result.passed ? '✅ PASS' : '❌ FAIL'
  const compareStr =
    result.compare === 'gte'
      ? `≥ ${result.threshold}`
      : `< ${result.threshold}`
  const valueStr = result.value === Infinity ? 'N/A' : `${result.value} ${result.unit}`
  console.log(`\n  ${status}  ${result.name}`)
  console.log(`         实测值: ${valueStr}`)
  console.log(`         阈值:   ${compareStr} ${result.unit}`)
  if (result.detail) {
    console.log(`         详情:   ${result.detail}`)
  }
}

// ============================================================
// launchExe — 启动 exe（detached），返回 child_process
// ============================================================
export function launchExe(exePath, env = {}) {
  return spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env },
  })
}

// ============================================================
// waitForProcess — 轮询等待进程出现
//
// 参数：
//   processName — 进程名（如 spiritpal_app.exe）
//   timeoutMs   — 超时（默认 30000）
//   intervalMs  — 轮询间隔（默认 100）
//   checkWindow — 是否检查窗口可见（默认 false）
//
// 返回：{ found: boolean, elapsedMs: number }
// ============================================================
export async function waitForProcess({
  processName,
  timeoutMs = 30000,
  intervalMs = 100,
  checkWindow = false,
}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = checkWindow
      ? hasProcessWindow(processName)
      : isProcessRunning(processName)
    if (found) {
      return { found: true, elapsedMs: Date.now() - start }
    }
    await sleep(intervalMs)
  }
  return { found: false, elapsedMs: Date.now() - start }
}
