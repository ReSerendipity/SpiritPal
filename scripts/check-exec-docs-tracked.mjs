#!/usr/bin/env node
/**
 * check-exec-docs-tracked.mjs — docs/execution 入库防护门禁（跟踪机制 §机制四）
 *
 * 背景：docs/execution/ 曾被家族 self-purify 机制移出 git 跟踪并加入 .gitignore
 *（commit e2a9699），经用户授权恢复（commit 3578975）。本门禁防止「静默丢失」：
 * 若再次被移出跟踪/被 ignore，CI 立即红，把治理冲突显式化，而不是靠人偶然发现。
 *
 * 检查项：
 *   1. 核心执行文档必须被 git 跟踪（EXEC_DOCS_REQUIRED 逐项）
 *   2. docs/execution/*.md 至少 1 份被跟踪（防目录整体消失）
 *   3. 这些文件均不得被 .gitignore 忽略（git check-ignore）
 *
 * 用法：node scripts/check-exec-docs-tracked.mjs   （structure-guard.yml 接入）
 * 退出码：0 = 通过；1 = 有文档脱离跟踪/被忽略（需要按应急预案处理）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 核心执行文档基线（2026-09-11 恢复入库时的清单；新增执行文档后在此登记）
const EXEC_DOCS_REQUIRED = [
  'docs/execution/RELEASE_VERIFICATION.md',
  'docs/execution/执行对照表-桌面分发与安全加固-20260910.md',
  'docs/execution/落地执行总结-桌面分发与安全加固-20260910.md',
  'docs/execution/依赖与安全跟踪机制-20260911.md',
]
// docs/project 白名单文档（.gitignore 显式 ! 例外 = 入库意图；曾被 self-purify
// e2a9699 一并移出跟踪，2026-09-11 恢复后纳入本门禁）
const PROJECT_DOCS_REQUIRED = [
  'docs/project/KNOWN_GOTCHAS.md',
  'docs/project/AI_DEV_SOPS.md',
]

function git(args) {
  try {
    // core.quotepath=false：避免中文文件名被八进制转义导致匹配失败
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: ROOT,
      encoding: 'utf-8',
    }).trim()
  } catch {
    return ''
  }
}

const problems = []

// 1) 核心文档被跟踪
const tracked = git(['ls-files', 'docs/execution', 'docs/project'])
const isTracked = (doc) =>
  tracked.split('\n').some((l) => {
    const line = l.replace(/^"|"$/g, '')
    return line === doc || line.includes(doc.split('/').pop())
  })
for (const doc of [...EXEC_DOCS_REQUIRED, ...PROJECT_DOCS_REQUIRED]) {
  if (!isTracked(doc)) problems.push(`核心文档未被 git 跟踪：${doc}`)
}

// 2) 目录至少 1 份 md 被跟踪
const trackedMd = tracked.split('\n').filter((l) => l.endsWith('.md'))
if (trackedMd.length === 0) {
  problems.push('docs/execution/ 下没有任何被 git 跟踪的 .md（目录可能被整体移出跟踪）')
}

// 3) 不被 .gitignore 忽略
const dirExists = existsSync(join(ROOT, 'docs', 'execution'))
if (!dirExists) {
  problems.push('docs/execution/ 目录在磁盘上不存在')
} else {
  for (const f of readdirSync(join(ROOT, 'docs', 'execution'))) {
    if (!f.endsWith('.md')) continue
    const rel = `docs/execution/${f}`
    // check-ignore -q：命中 ignore 时 exit 0（不抛异常），未命中时非零退出（抛异常）
    let isIgnored = false
    try {
      execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT })
      isIgnored = true
    } catch {
      isIgnored = false
    }
    if (isIgnored) problems.push(`执行文档被 .gitignore 忽略：${rel}`)
  }
}

// docs/project 白名单文件的 ignore 检查（ tracked 文件不受 ignore 影响，此处覆盖
// 「新文件/重加文件被 ignore 规则压制」的场景）
for (const rel of PROJECT_DOCS_REQUIRED) {
  const abs = join(ROOT, ...rel.split('/'))
  if (!existsSync(abs)) continue
  let isIgnored = false
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT })
    isIgnored = true
  } catch {
    isIgnored = false
  }
  if (isIgnored) problems.push(`白名单文档被 .gitignore 忽略：${rel}`)
}

if (problems.length > 0) {
  console.error('❌ 文档入库防护门禁未通过（docs/execution + docs/project 白名单）：')
  problems.forEach((p) => console.error(`  - ${p}`))
  console.error('')
  console.error('处置：按《docs/execution/依赖与安全跟踪机制》§机制四应急预案处理——')
  console.error('  ① 不要与 self-purify 机制反复对抗；② 本地磁盘留存副本（docs/execution/ 永远有本地一份）；')
  console.error('  ③ 提交家族治理层（ReSerendipity/.github）裁决「执行文档是否应入库」；')
  console.error('  ④ 用户已明确授权执行文档入库（2026-09-11，commit 3578975），可凭此恢复。')
  process.exit(1)
}

console.log(`✅ 文档入库防护通过：${trackedMd.length} 份执行文档被跟踪，核心清单齐全，无 .gitignore 排除`)
