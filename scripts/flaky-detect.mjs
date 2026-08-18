#!/usr/bin/env node
/**
 * flaky-detect.mjs — Flaky 测试监控（审计 P2-9）
 *
 * 重复运行指定测试 N 次，统计每次 pass/fail，识别不稳定（flaky）测试。
 * 用法:
 *   node scripts/flaky-detect.mjs [iterations] [testPattern...]
 *     默认 3 次迭代、全部测试；testPattern 传给 vitest run（如 src/lib/__tests__/aiAgent.test.ts）
 * 输出:
 *   - 控制台摘要（每个测试的 pass/fail 序列）
 *   - perf/results/flaky-report.json（历史可累积，含时间戳）
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const iterations = Number(process.argv[2] ?? 3)
const patterns = process.argv.slice(3)

const resultsDir = path.join(process.cwd(), 'perf', 'results')
fs.mkdirSync(resultsDir, { recursive: true })

/** 跑一轮 vitest，解析 JSON reporter 输出 */
function runOnce(round) {
  const cmd = ['pnpm', 'exec', 'vitest', 'run', '--reporter=json', '--outputFile',
    path.join(resultsDir, `flaky-round-${round}.json`)]
  if (patterns.length > 0) cmd.push(...patterns)
  try {
    execSync(cmd.join(' '), { cwd: process.cwd(), stdio: 'inherit' })
    return true
  } catch {
    // vitest 有失败用例时 exit code 非 0，但 JSON 报告已写出
    return false
  }
}

function readRound(round) {
  const p = path.join(resultsDir, `flaky-round-${round}.json`)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function main() {
  console.log(`[flaky-detect] 运行 ${iterations} 轮 vitest，模式: ${patterns.join(' ') || '(全部)'}`)
  const perTest = new Map() // name -> { pass: n, fail: n, rounds: [] }

  for (let round = 1; round <= iterations; round++) {
    const ok = runOnce(round)
    const report = readRound(round)
    const files = report?.testResults ?? []
    const seen = new Set()
    for (const file of files) {
      for (const t of file.assertionResults ?? []) {
        const name = `${path.basename(file.name)} > ${t.fullName ?? t.title}`
        const status = t.status // 'passed' | 'failed'
        if (!perTest.has(name)) perTest.set(name, { pass: 0, fail: 0, rounds: [] })
        const rec = perTest.get(name)
        if (status === 'passed') rec.pass++
        else rec.fail++
        rec.rounds.push(status === 'passed' ? 'P' : 'F')
        seen.add(name)
      }
    }
    // 本轮没出现的测试记为未运行（跳过）
    if (!ok && files.length === 0) {
      console.warn(`[flaky-detect] 第 ${round} 轮未生成有效报告，可能是收集错误`)
    }
  }

  const flaky = []
  const summary = []
  for (const [name, rec] of perTest) {
    if (rec.fail > 0 && rec.pass > 0) {
      flaky.push({ name, pass: rec.pass, fail: rec.fail, rounds: rec.rounds.join('') })
    }
    summary.push({ name, pass: rec.pass, fail: rec.fail, rounds: rec.rounds.join('') })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    iterations,
    patterns,
    totalTests: perTest.size,
    flakyCount: flaky.length,
    flaky,
    all: summary,
  }
  fs.writeFileSync(path.join(resultsDir, 'flaky-report.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('')
  console.log(`[flaky-detect] 共 ${perTest.size} 个测试，其中 flaky ${flaky.length} 个`)
  for (const f of flaky) {
    console.log(`  ⚠ ${f.name}  [${f.rounds}]  pass=${f.pass} fail=${f.fail}`)
  }
  console.log(`报告: perf/results/flaky-report.json`)
  process.exitCode = flaky.length > 0 ? 1 : 0
}

main()
