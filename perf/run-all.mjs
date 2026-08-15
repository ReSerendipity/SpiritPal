// perf/run-all.mjs — 性能测试主脚本（汇总运行四项指标）
//
// 依次执行：
//   1. 冷启动时间测试  (cold-start.mjs)  — 阈值 < 2000ms
//   2. 内存占用测试    (memory-usage.mjs) — 阈值 < 80MB
//   3. Live2D 帧率测试 (fps-test.mjs)     — 阈值 ≥ 30fps
//   4. 安装包大小验证  (package-size.mjs) — 阈值 < 30MB
//
// 汇总输出报告，退出码：
//   0 — 全部通过
//   1 — 任一失败
//   2 — 执行异常
//
// 环境变量（透传给子脚本）：
//   SPIRITPAL_EXE, SPIRITPAL_DEV, SPIRITPAL_PERF_TIMEOUT,
//   SPIRITPAL_STABILIZE_MS, SPIRITPAL_SAMPLE_COUNT,
//   SPIRITPAL_FPS_DURATION, SPIRITPAL_FPS_MODEL, SPIRITPAL_FPS_HEADLESS
//
// 运行方式：
//   node perf/run-all.mjs
//   pnpm perf

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THRESHOLDS } from './_helpers.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')

// ============================================================
// 测试配置
// ============================================================
const TESTS = [
  {
    id: 'cold-start',
    name: '冷启动时间',
    script: 'cold-start.mjs',
    unit: 'ms',
    threshold: THRESHOLDS.coldStartMs,
    compare: 'lt',
  },
  {
    id: 'memory',
    name: '内存占用',
    script: 'memory-usage.mjs',
    unit: 'MB',
    threshold: THRESHOLDS.memoryMB,
    compare: 'lt',
  },
  {
    id: 'fps',
    name: 'Live2D 帧率',
    script: 'fps-test.mjs',
    unit: 'fps',
    threshold: THRESHOLDS.fps,
    compare: 'gte',
  },
  {
    id: 'package-size',
    name: '安装包大小',
    script: 'package-size.mjs',
    unit: 'MB',
    threshold: THRESHOLDS.packageSizeMB ?? 30,
    compare: 'lt',
  },
]

// ============================================================
// runTest — 执行单个测试脚本，返回结果
// ============================================================
function runTest(test) {
  return new Promise((resolvePromise) => {
    const scriptPath = resolve(__dirname, test.script)
    const child = spawn('node', [scriptPath], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: false,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('close', (code) => {
      resolvePromise({
        ...test,
        exitCode: code,
        passed: code === 0,
        stdout,
        stderr,
      })
    })

    child.on('error', (err) => {
      resolvePromise({
        ...test,
        exitCode: -1,
        passed: false,
        stdout,
        stderr: stderr + '\n' + err.message,
        error: err.message,
      })
    })
  })
}

// ============================================================
// extractValue — 从测试输出中提取实测值
// ============================================================
function extractValue(stdout, unit) {
  // 匹配 "实测值: <数字> <unit>" 格式
  const regex = new RegExp(`实测值:\\s*([\\d.]+)\\s*${unit}`, 'i')
  const match = stdout.match(regex)
  if (match) {
    return parseFloat(match[1])
  }
  return null
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  console.log('')
  console.log('╔' + '═'.repeat(58) + '╗')
  console.log('║' + '  SpiritPal 性能验收测试 (Performance Acceptance Test)'.padEnd(58) + '║')
  console.log('║' + `  PRD v0.2 指标 | ${new Date().toLocaleString('zh-CN')}`.padEnd(58) + '║')
  console.log('╚' + '═'.repeat(58) + '╝')

  const results = []

  for (const test of TESTS) {
    console.log(`\n${'▶'.repeat(1)} 运行测试: ${test.name} (${test.script})`)
    const result = await runTest(test)
    result.value = extractValue(result.stdout, test.unit)
    results.push(result)
  }

  // ============================================================
  // 汇总报告
  // ============================================================
  console.log('')
  console.log('╔' + '═'.repeat(58) + '╗')
  console.log('║' + '  📊 性能测试汇总报告'.padEnd(58) + '║')
  console.log('╠' + '═'.repeat(58) + '╣')

  const allPassed = results.every((r) => r.passed)

  for (const r of results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL'
    const valueStr = r.value !== null ? `${r.value} ${r.unit}` : 'N/A'
    const thresholdStr =
      r.compare === 'gte' ? `≥ ${r.threshold}` : `< ${r.threshold}`
    const line1 = `  ${status}  ${r.name}`.padEnd(40)
    const line2 = `       实测: ${valueStr}`.padEnd(35) + `阈值: ${thresholdStr}`
    console.log('║' + line1.padEnd(58) + '║')
    console.log('║' + line2.padEnd(58) + '║')
    console.log('║' + ''.padEnd(58) + '║')
  }

  const summary = allPassed
    ? '  🎉 全部测试通过！性能指标达标。'
    : '  ⚠️  部分测试未通过，请检查上方详情。'
  console.log('║' + summary.padEnd(58) + '║')
  console.log('╚' + '═'.repeat(58) + '╝')

  // 退出码
  process.exit(allPassed ? 0 : 1)
}

// ============================================================
// 入口
// ============================================================
main().catch((err) => {
  console.error('\n  💥 运行性能测试时发生异常:', err.message)
  console.error(err.stack)
  process.exit(2)
})
