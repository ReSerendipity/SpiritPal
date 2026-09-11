#!/usr/bin/env node
/**
 * pre-release-check.mjs — 发版前一键预检（跟踪机制 §机制三；交接指导 2.3）
 *
 * 把《RELEASE_VERIFICATION.md》中「打 tag 前必须在本地完成」的检查串成一条命令，
 * 全部通过才允许推 tag（发布门禁 T-08 的本地等价物前置部分）。
 *
 * 检查项：
 *   1. 版本三处一致（package.json / Cargo.toml / tauri.conf.json；复用 sync-version --check）
 *   2. 工作区干净 + 当前在 main（防带脏改动发版）
 *   3. 安装包大小 < 30MB（复用 perf/package-size.mjs；要求本地已有 release 构建产物）
 *   4. updates.json 远程可达且结构有效（仅可达性——发布后版本比对由 release.yml
 *      publish-updates job 负责；本地 GitHub 加速器 MITM 导致失败时用 --skip-remote 跳过并留痕）
 *   5. （可选 --local-artifacts）本地 bundle 存在 setup.exe + .sig 且 .sig 非空
 *
 * 用法：
 *   node scripts/pre-release-check.mjs
 *   node scripts/pre-release-check.mjs --local-artifacts
 *   node scripts/pre-release-check.mjs --skip-remote   # 加速器 MITM 环境下跳过远程检查
 *
 * 退出码：0 = 全部通过；1 = 有失败项（打 tag 前必须修复）
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_REMOTE = process.argv.includes('--skip-remote')
const LOCAL_ARTIFACTS = process.argv.includes('--local-artifacts')

const results = []
function record(name, passed, detail) {
  results.push({ name, passed, detail })
  console.log(`  ${passed ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function sh(cmd, args) {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8' }).trim() }
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

// ---- 1. 版本三处一致 ----
{
  const v = sh('node', ['scripts/sync-version.mjs', '--check'])
  record('版本三处一致', v.code === 0, v.code === 0 ? v.out.split('\n').pop() : v.out)
}

// ---- 2. 工作区干净 + main 分支 ----
{
  const branch = sh('git', ['-c', 'core.quotepath=false', 'branch', '--show-current'])
  const status = sh('git', ['-c', 'core.quotepath=false', 'status', '--porcelain'])
  const onMain = branch.out === 'main'
  const dirty = status.out.length > 0
  record(
    '工作区干净且在 main',
    onMain && !dirty,
    `${branch.out}${dirty ? '，存在未提交改动' : '，无未提交改动'}`,
  )
}

// ---- 3. 安装包大小门禁 ----
{
  const setup = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
  const hasBundle = existsSync(setup) && readdirSafe(setup).some((f) => f.endsWith('-setup.exe'))
  if (!hasBundle) {
    record('安装包大小门禁', false, '本地无 release 构建产物（先跑 pnpm tauri build）')
  } else {
    const r = spawnSync('node', ['perf/package-size.mjs'], { cwd: ROOT, encoding: 'utf-8' })
    const ok = r.status === 0
    const line = (r.stdout ?? '').split('\n').find((l) => l.includes('MB'))?.trim() ?? ''
    record('安装包大小门禁（<30MB）', ok, ok ? line : (r.stdout ?? r.stderr ?? '').slice(-200))
  }
}

// ---- 4. updates.json 远程可达 ----
if (SKIP_REMOTE) {
  record('updates.json 远程可达', true, '已按 --skip-remote 跳过（本机加速器 MITM 环境）；发布后以 publish-updates 回读为准')
} else {
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/ReSerendipity/SpiritPal/main/updates.json',
      { signal: AbortSignal.timeout(15000) },
    )
    if (resp.ok) {
      const body = await resp.json()
      const platforms = Object.keys(body.platforms ?? {})
      const valid = Boolean(body.version) && platforms.length > 0 && platforms.every((p) => body.platforms[p].signature)
      record('updates.json 远程可达且结构有效', valid, `version=${body.version}，platforms=${platforms.join(',')}`)
    } else {
      record('updates.json 远程可达', false, `HTTP ${resp.status}`)
    }
  } catch (e) {
    record('updates.json 远程可达', false, `${e.message}（若本机启用 GitHub 加速器 MITM，请用 --skip-remote 重跑并留痕）`)
  }
}

// ---- 5. 本地产物 + 签名（可选） ----
if (LOCAL_ARTIFACTS) {
  const nsis = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
  const exe = readdirSafe(nsis).find((f) => f.endsWith('-setup.exe'))
  const sig = exe ? `${exe}.sig` : null
  const sigOk = sig && existsSync(join(nsis, sig)) && statSync(join(nsis, sig)).size > 0
  record('本地产物含签名', Boolean(exe && sigOk), exe ? `${exe} + ${sig}${sigOk ? '（非空）' : ' 缺失/为空'}` : '未找到 setup.exe')
}

function readdirSafe(p) {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

// ---- 汇总 ----
const failed = results.filter((r) => !r.passed)
console.log('\n' + '─'.repeat(56))
if (failed.length > 0) {
  console.log(`❌ 预检通过 ${results.length - failed.length}/${results.length}，以下失败项修复后再打 tag：`)
  failed.forEach((f) => console.log(`   - ${f.name}`))
  process.exit(1)
}
console.log(`✅ 发版预检全部通过（${results.length}/${results.length}）——可打 tag v* 触发 release.yml`)
console.log('   提醒：tag 触发后按 RELEASE_VERIFICATION.md §1 观察三 job 产物与 updates.json 提交')
