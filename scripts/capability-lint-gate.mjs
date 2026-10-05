#!/usr/bin/env node
/**
 * @file capability-lint-gate.mjs
 * @description capability-lint 的「单项降级」包装器 —— .pre-commit-config.yaml 中
 *              capability-lint 条目的真实入口（原条目直调 scripts/lint-capabilities.mjs）。
 *
 * 为什么需要这一层（2026-10-06）：
 *   scripts/lint-capabilities.mjs 本身是纯 fs 扫描，健康时 ~0.2s 跑完（rc=0）。但在受限执行
 *   沙箱里它的子进程会被外部 SIGTERM 击杀/超时（历史处置见 docs/agent-review-handoff-2026-10-05.md
 *   §5.1：三笔提交因此走 `git commit --no-verify` **整链**绕过，连带把合并冲突守卫与其余 9 个
 *   hook 一起关掉）。本包装器把「环境性失败」降级为**只跳过 capability-lint 这一项**并机械留痕，
 *   让其余钩子照常执行；「真实违规」仍然硬失败，绝不因为方便而放行越权 capability。
 *
 * 判定规则（fail-closed 优先，判据是「子进程自己有没有说出结论」）：
 *   1. 输出含通过判据 + 退出码 0            → 通过（exit 0）
 *   2. 输出含违规判据（或退出码 1 带违规正文）→ 硬失败（exit 1），永不降级
 *   3. 无任何判据输出却非正常结束            → 环境性受限（被击杀 / 超过 deadline 自杀 /
 *      spawn 失败 / 崩溃）→ 记录 `capability-lint skipped: <原因>` 后 exit 0
 *   为什么不能只看退出码：Windows 下被 TerminateProcess 杀掉的子进程退出码同样是 1，
 *   与「lint 判出违规」同号；只有子进程自己的判据文本能区分二者。
 *
 * 用法：
 *   node scripts/capability-lint-gate.mjs [透传给 lint 脚本的参数...]
 * 环境开关：
 *   SPIRITPAL_CAPLINT_TIMEOUT_MS  deadline（毫秒，默认 10000；健康耗时 ~0.2s，留 50 倍余量）
 *   SPIRITPAL_CAPLINT_STRICT=1   禁止降级：环境性失败同样判失败（留痕仍会写）
 *   SPIRITPAL_CAPLINT_FAKE_KILL=1 自测注入点：不跑子进程，直接走「被 SIGTERM 击杀」分支
 *
 * 退出码：0 = 通过或已降级跳过（留痕可查）；1 = lint 判出的真实违规，或 STRICT 下的环境性失败
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const LINT_SCRIPT = join(HERE, 'lint-capabilities.mjs')

/** lint 脚本自己打印的结论标记 —— 只有见到这些文本才算「拿到了判据」 */
const VERDICT_PASS = /capability lint 通过/
const VERDICT_FAIL = /capability lint 失败|capabilities 目录不存在|capabilities 目录为空/

/** 留痕文件名（都落在 `git rev-parse --git-path` 下，即本地 .git/，不进版本库） */
const GATE_SKIP_LOG = 'spiritpal-gate-skips.log'
const GATE_SKIP_MARKER = 'spiritpal-gate-skip-pending'

const HookId = 'capability-lint'
const STRICT = process.env.SPIRITPAL_CAPLINT_STRICT === '1'

function positiveInt(raw, fallback) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}
const DEADLINE_MS = positiveInt(process.env.SPIRITPAL_CAPLINT_TIMEOUT_MS, 10000)
/** 自杀后的二次强杀宽限，避免子进程吞掉 SIGTERM 把钩子挂死 */
const KILL_GRACE_MS = 2000

// ============ 留痕（尽力而为：写不进去也必须让 stderr 看见） ============

/** 解析 .git 下的相对路径（linked worktree 也能拿到各自真实的 git-dir） */
function gitPath(name) {
  try {
    const r = spawnSync('git', ['rev-parse', '--git-path', name], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    })
    if (r.status !== 0) return null
    const p = (r.stdout || '').trim()
    return p ? resolve(REPO_ROOT, p) : null
  } catch {
    return null
  }
}

/** 单行化：留痕与提交说明都要保持「一行一条」，机械可 grep */
function oneLine(text, max = 200) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * 机械记录一行 `capability-lint skipped: <原因>`：
 *   1. 追加到 <git-dir>/spiritpal-gate-skips.log（详单，供事后审计）
 *   2. 写下 <git-dir>/spiritpal-gate-skip-pending 便签（由 prepare-commit-msg 消费进提交说明）
 *   3. 无论前两步成败，都在 stderr 复述一遍（pre-commit 框架对通过的 hook 会吞输出，
 *      直调时仍要看得见）
 * @param {string} reason 简短原因，如 `timeout after 30000ms`
 * @param {object} [detail] 附加上下文，拼进日志行
 */
function recordSkip(reason, detail = {}) {
  const note = `capability-lint skipped: ${reason}`
  const parts = [
    `id=${HookId}`,
    `deadline=${DEADLINE_MS}ms`,
    `elapsed=${detail.elapsed ?? '?'}ms`,
    `exit=${String(detail.exit)}`,
    `signal=${detail.signal || 'none'}`,
    `strict=${STRICT ? 1 : 0}`,
  ]
  if (detail.output) parts.push(`output=${oneLine(detail.output)}`)
  const line = `${new Date().toISOString()} ${note} | ${parts.join(' ')}`

  let logPath = null
  try {
    const p = gitPath(GATE_SKIP_LOG)
    if (p) {
      appendFileSync(p, `${line}\n`, 'utf-8')
      logPath = p
    }
  } catch {
    logPath = null
  }

  let markerPath = null
  try {
    const p = gitPath(GATE_SKIP_MARKER)
    if (p) {
      mkdirSync(dirname(p), { recursive: true })
      // 便签会被 prepare-commit-msg 写进提交说明，所以只给**不含反斜杠**的相对描述——
      // Windows 绝对路径里的 \t \g \s 在交给 awk/sed 时会被当转义序列吃掉（实测拼出乱码路径）。
      writeFileSync(
        p,
        `${note}（单项降级，其余钩子照常执行；详单见本仓 .git 下的 ${GATE_SKIP_LOG}）\n`,
        'utf-8',
      )
      markerPath = p
    }
  } catch {
    markerPath = null
  }

  process.stderr.write(`[capability-lint] ⚠ ${note}\n`)
  process.stderr.write(
    `[capability-lint]    留痕：${logPath || '（日志写入失败）'}${markerPath ? ' + 提交说明便签' : ''}\n`,
  )
  if (detail.output) process.stderr.write(`[capability-lint]    子进程末段输出：${oneLine(detail.output)}\n`)
  return { note, logPath, markerPath }
}

// ============ 跑真正的 lint 子进程 ============

/**
 * @returns {Promise<{out: string, errOut: string, exit: number|null, signal: string|null,
 *                      elapsed: number, timedOut: boolean, spawnError?: string}>}
 */
function runLint(passThrough) {
  return new Promise((res) => {
    let child
    try {
      child = spawn(process.execPath, [LINT_SCRIPT, ...passThrough], { cwd: REPO_ROOT })
    } catch (e) {
      res({
        out: '',
        errOut: '',
        exit: null,
        signal: null,
        elapsed: 0,
        timedOut: false,
        spawnError: `${e.code || e.name || 'Error'}: ${e.message}`,
      })
      return
    }

    let out = ''
    let errOut = ''
    let timedOut = false
    let settled = false
    const startedAt = Date.now()

    const settle = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (grace) clearTimeout(grace)
      res({ out, errOut, exit: null, signal: null, elapsed: Date.now() - startedAt, timedOut, ...payload })
    }

    let grace = null
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {
        /* 已被杀 */
      }
      grace = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* 已经没了 */
        }
      }, KILL_GRACE_MS)
    }, DEADLINE_MS)

    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      errOut += d
    })
    child.on('error', (e) => {
      settle({ spawnError: `${e.code || e.name || 'Error'}: ${e.message}` })
    })
    child.on('close', (code, signal) => {
      settle({ exit: code, signal })
    })
  })
}

// ============ 判定 ============

/**
 * 把子进程结果分成 pass / fail / degrade 三类。纯函数，便于自测与复核。
 * @param {{out: string, errOut: string, exit: number|null, signal: string|null,
 *           elapsed: number, timedOut: boolean, spawnError?: string}} r
 */
function classify(r) {
  const combined = `${r.out}${r.errOut}`
  const passedVerdict = VERDICT_PASS.test(combined)
  const failedVerdict = VERDICT_FAIL.test(combined)

  if (r.spawnError) {
    return { kind: 'degrade', reason: `spawn failed: ${oneLine(r.spawnError, 80)}`, detail: r }
  }
  if (failedVerdict) {
    return { kind: 'fail', reason: 'lint 判出真实违规', detail: r }
  }
  if (passedVerdict) {
    return r.exit === 0
      ? { kind: 'pass', detail: r }
      : { kind: 'fail', reason: `判据为通过但退出码为 ${r.exit}（异常，按硬失败处理）`, detail: r }
  }
  // 没有判据 —— 只有环境性解释
  if (r.timedOut) {
    return { kind: 'degrade', reason: `timeout after ${DEADLINE_MS}ms（本包装器自杀，子进程未给出判据）`, detail: r }
  }
  if (r.signal) {
    return { kind: 'degrade', reason: `terminated by signal ${r.signal}（外部击杀，子进程未给出判据）`, detail: r }
  }
  if (r.exit !== 0) {
    return {
      kind: 'degrade',
      reason: `killed without verdict (exit ${r.exit})（Windows 下外部 TerminateProcess 也报此码，故按环境性处理）`,
      detail: r,
    }
  }
  return { kind: 'degrade', reason: 'no verdict on empty output (exit 0)', detail: r }
}

async function main() {
  const passThrough = process.argv.slice(2)

  // 自测注入点：直接模拟「受限沙箱里被 SIGTERM 击杀」，不依赖真实时序
  if (process.env.SPIRITPAL_CAPLINT_FAKE_KILL === '1') {
    const fake = {
      out: '',
      errOut: '',
      exit: null,
      signal: 'SIGTERM',
      elapsed: 0,
      timedOut: false,
    }
    process.stderr.write(`[capability-lint] 注入模式 SPIRITPAL_CAPLINT_FAKE_KILL=1（未执行真实 lint）\n`)
    finish(classify(fake), fake)
    return
  }

  const result = await runLint(passThrough)
  process.stdout.write(result.out)
  process.stderr.write(result.errOut)
  finish(classify(result), result)
}

/** @param {ReturnType<typeof classify>} verdict @param {object} r 子进程结果 */
function finish(verdict, r) {
  if (verdict.kind === 'pass') {
    process.exitCode = 0
    return
  }
  if (verdict.kind === 'fail') {
    process.stderr.write(`[capability-lint] ❌ 未通过：${verdict.reason}（真实违规不降级）\n`)
    process.exitCode = 1
    return
  }
  const { note } = recordSkip(verdict.reason, {
    elapsed: r.elapsed,
    exit: r.exit,
    signal: r.signal,
    output: `${r.out}${r.errOut}`,
  })
  if (STRICT) {
    process.stderr.write(`[capability-lint] ❌ SPIRITPAL_CAPLINT_STRICT=1：环境性失败不降级，提交阻断（${note}）\n`)
    process.exitCode = 1
    return
  }
  process.stderr.write(`[capability-lint] 已跳过本项，其余钩子照常执行（${note}）\n`)
  process.exitCode = 0
}

main()
