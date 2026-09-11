#!/usr/bin/env node
/**
 * track-deps-ecosystem.mjs — 依赖生态跟踪（交接指导 2.1/2.2 的持续跟踪机制化）
 *
 * 跟踪两条「受阻待上游」链路，发现可行动变化时以 exit 1 提示（CI 中转为开 issue，不红主页）：
 *
 * 1. pixi 8 生态（dependabot PR #29 挂起依据）
 *    - 官方 pixi-live2d-display（latest + beta tag）与主流 fork 的最新版 peerDependencies
 *      是否允许 pixi 8
 *    - 可行动：官方包任一 tag 支持 pixi 8 → 重新评估 #29（fork 支持仅作信息，不改变决策）
 *
 * 2. glib 上游修复链（RUSTSEC-2024-0429 / dependabot alert #14，受上游锁死）
 *    - tauri 最新 stable 对 gtk 的版本 req 是否允许 gtk-rs 0.20+（glib 0.20 修复线）
 *    - crates.io 是否已发布 gtk >= 0.20
 *    - 可行动：两者同时满足 → 评估升级 tauri/gtk-rs 关闭 alert #14
 *
 * 用法：
 *   node scripts/track-deps-ecosystem.mjs             # 控制台表格
 *   node scripts/track-deps-ecosystem.mjs --markdown  # GitHub Step Summary 友好格式
 *
 * 退出码：
 *   0 = 无可行动变化（含仅信息性更新）
 *   1 = 发现可行动变化（需要人工评估的事项）
 *   2 = 网络查询失败（上游不可达，不代表结论变化）
 *
 * 说明：
 *   - 纯内置 fetch，无第三方依赖；crates.io 要求 User-Agent 头
 *   - 本脚本为「读端」，不做任何修复动作；修复决策走《依赖与安全跟踪机制》文档 SOP
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const MARKDOWN = process.argv.includes('--markdown')
const UA = 'spiritpal-deps-watch (github.com/ReSerendipity/SpiritPal)'

// ============ 依赖清单（2.1：pixi 8 生态） ============
// 判定以官方包为准；fork 仅信息参考。新增 fork 时在此登记即可。
const PIXI_ECOSYSTEM = [
  { name: 'pixi-live2d-display', role: 'official', tags: ['latest', 'beta'] },
  { name: 'pixi-live2d-display-mulmotion', role: 'fork', tags: ['latest'] },
  { name: '@sekai-world/pixi-live2d-display-mulmotion', role: 'fork', tags: ['latest'] },
  { name: 'pixi-live2d-display-lipsyncpatch', role: 'fork', tags: ['latest'] },
  { name: 'pixi-live2d-display-webgal', role: 'fork', tags: ['latest'] },
  { name: '@jannchie/pixi-live2d-display', role: 'fork-personal', tags: ['latest'] },
]

// 修复线：RUSTSEC-2024-0429 first_patched = glib 0.20.0；gtk-rs 同步版本线 gtk 0.20
const GLIB_FIXED_MINOR = 20
const GTK_FIXED_MINOR = 20

// ============ fetch 帮助函数 ============
async function getJson(url, timeoutMs = 15000, retries = 2) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return await resp.json()
    } catch (e) {
      lastErr = e
      if (i < retries) await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw new Error(`${url} → ${lastErr?.message ?? 'unknown'}`)
}

// ============ 简易 semver major 判定（覆盖 npm peer 常见 range 形态） ============
/** 单个 range（可含 ||）是否允许指定 major */
function rangeAllowsMajor(range, major) {
  if (range == null) return false
  return String(range)
    .split('||')
    .some((clause) => clauseAllowsMajor(clause.trim(), major))
}
function clauseAllowsMajor(clause, major) {
  if (!clause || clause === '*' || clause === 'x' || clause === 'latest') return true
  return clause.split(/\s+/).every((tok) => tokenAllowsMajor(tok, major))
}
function tokenAllowsMajor(tok, major) {
  if (!tok || tok === '*' || tok === 'x') return true
  if (tok.startsWith('^')) {
    const bm = parseInt(tok.slice(1), 10)
    if (Number.isNaN(bm)) return true
    return bm === 0 ? major === 0 : major === bm // 0.x caret 锁 minor → 不跨 major
  }
  if (tok.startsWith('~')) return parseInt(tok.slice(1), 10) === major
  if (tok.startsWith('>=')) return major >= parseInt(tok.slice(2), 10)
  if (tok.startsWith('>')) return major > parseInt(tok.slice(1), 10)
  const bare = tok.match(/^(\d+)(?:\.x)?$/)
  if (bare) return parseInt(bare[1], 10) === major
  const exact = tok.match(/^(\d+)\./)
  if (exact) return parseInt(exact[1], 10) === major
  return false
}

/** 从 npm 包的 peerDependencies 提取「约束 pixi 的那个字段」的 range */
function pixiPeerRange(peer) {
  if (!peer) return null
  return peer['pixi.js'] ?? peer['@pixi/core'] ?? null
}

// ============ crates.io 帮助函数 ============
/** 解析 cargo semver req（^0.18 / 0.18 / >=0.19 等）是否允许指定 0.x minor */
function cargoReqAllowsMinor(req, minor) {
  const m = String(req ?? '').match(/^\s*(\^|>=|>|=)?\s*(\d+)\.(\d+)/)
  if (!m) return false
  const op = m[1] ?? '^'
  const maj = parseInt(m[2], 10)
  const min = parseInt(m[3], 10)
  if (op === '>=' || op === '>') return maj > 0 || min >= minor
  // ^ / 精确（0.x 生态锁 minor）
  return maj >= 1 ? true : min >= minor
}

/** 从 Cargo.lock 提取指定包的当前版本 */
function lockedVersion(name) {
  try {
    const lock = readFileSync(join(ROOT, '..', 'src-tauri', 'Cargo.lock'), 'utf8')
    const re = new RegExp(`\\[\\[package\\]\\]\\s*\\nname = "${name}"\\s*\\nversion = "([^"]+)"`)
    const m = lock.match(re)
    return m ? m[1] : null
  } catch {
    return null
  }
}

// ============ 输出 ============
const rows = [] // { kind, item, detail, status: 'ok'|'info'|'actionable' }
const out = (...s) => console.log(...s)
const hr = () => out(MARKDOWN ? '\n---\n' : '─'.repeat(64))
function table(header, lines) {
  if (MARKDOWN) {
    out('')
    out(header)
    out('')
    lines.forEach((l) => out(l))
  } else {
    out('')
    out(header)
    lines.forEach((l) => out('  ' + l.replace(/^\| /, '').replace(/ \|$/, ' ').replace(/ \| /g, '  │ ')))
  }
}

// ============ 检查 1：pixi 8 生态 ============
async function checkPixi8() {
  let officialSupports8 = false
  for (const pkg of PIXI_ECOSYSTEM) {
    let doc
    try {
      doc = await getJson(`https://registry.npmjs.org/${pkg.name}`)
    } catch (e) {
      rows.push({ kind: 'pixi8', item: pkg.name, detail: `查询失败：${e.message}`, status: 'info' })
      continue
    }
    for (const tag of pkg.tags) {
      const ver = doc['dist-tags']?.[tag]
      if (!ver) continue
      const meta = doc.versions?.[ver]
      const range = pixiPeerRange(meta?.peerDependencies)
      const supports8 = rangeAllowsMajor(range, 8)
      if (pkg.role === 'official' && supports8) officialSupports8 = true
      rows.push({
        kind: 'pixi8',
        item: `${pkg.name}@${ver} (${tag})`,
        detail: `peer pixi: ${range ?? '（未声明）'} → pixi 8 ${supports8 ? '✅ 支持' : '❌ 不支持'}`,
        status: supports8 ? (pkg.role === 'official' ? 'actionable' : 'info') : 'ok',
      })
    }
  }
  return officialSupports8
}

// ============ 检查 2：glib 上游修复链 ============
async function checkGlib() {
  const localTauri = lockedVersion('tauri')
  const localGlib = lockedVersion('glib')
  rows.push({ kind: 'glib', item: '本地基线', detail: `Cargo.lock: tauri ${localTauri ?? '?'} / glib ${localGlib ?? '?'}（当前唯一打开漏洞 = glib RUSTSEC-2024-0429，alert #14）`, status: 'ok' })

  const tauri = await getJson('https://crates.io/api/v1/crates/tauri')
  const maxStable = tauri.crate?.max_stable_version
  const deps = await getJson(`https://crates.io/api/v1/crates/tauri/${maxStable}/dependencies`)
  const gtkReq = deps.dependencies?.find((d) => d.crate_id === 'gtk')?.req ?? '(未依赖 gtk)'
  rows.push({ kind: 'glib', item: `tauri 上游最新 stable`, detail: `${maxStable}，gtk req = "${gtkReq}"`, status: 'ok' })

  const gtk = await getJson('https://crates.io/api/v1/crates/gtk')
  const gtkNewest = gtk.crate?.newest_version
  rows.push({ kind: 'glib', item: 'gtk 上游最新', detail: gtkNewest, status: 'ok' })

  const glib = await getJson('https://crates.io/api/v1/crates/glib')
  const glibNewest = glib.crate?.newest_version
  const glibFixedAvailable = (() => {
    const m = String(glibNewest ?? '').match(/^0\.(\d+)\./)
    return m ? parseInt(m[1], 10) >= GLIB_FIXED_MINOR : false
  })()
  rows.push({ kind: 'glib', item: 'glib 上游最新', detail: `${glibNewest}（修复线 0.${GLIB_FIXED_MINOR}.0：${glibFixedAvailable ? '已发布' : '未发布'}）`, status: 'ok' })

  const chainAvailable =
    cargoReqAllowsMinor(gtkReq, GTK_FIXED_MINOR) &&
    (() => {
      const m = String(gtkNewest ?? '').match(/^0\.(\d+)\./)
      return m ? parseInt(m[1], 10) >= GTK_FIXED_MINOR : false
    })()
  rows.push({
    kind: 'glib',
    item: '修复链判定',
    detail: chainAvailable
      ? `tauri 已允许 gtk 0.${GTK_FIXED_MINOR}+ 且该版本线已发布 → 可评估升级关闭 alert #14`
      : `上游仍锁死（gtk req 不允许 0.${GTK_FIXED_MINOR} 或版本线未发布）→ 维持「受阻跟踪」，无项目内修复路径`,
    status: chainAvailable ? 'actionable' : 'ok',
  })
  return chainAvailable
}

// ============ 主流程 ============
const actionable = []
try {
  hr()
  out(MARKDOWN ? '## 依赖生态跟踪（pixi 8 / glib 上游链）' : '📦 依赖生态跟踪（pixi 8 / glib 上游链）')
  hr()

  out(MARKDOWN ? '\n### pixi 8 生态（PR #29 决策依据）\n' : '\n▶ pixi 8 生态（PR #29 决策依据）')
  const pixiActionable = await checkPixi8()

  out(MARKDOWN ? '\n### glib 上游修复链（alert #14 / RUSTSEC-2024-0429）\n' : '\n▶ glib 上游修复链（alert #14 / RUSTSEC-2024-0429）')
  const glibActionable = await checkGlib()

  if (pixiActionable) actionable.push('官方 pixi-live2d-display 已支持 pixi 8 → 重新评估 dependabot PR #29（升级 live2d 适配层 + N 卡真机验证 Live2D）')
  if (glibActionable) actionable.push('tauri/gtk-rs 0.20 修复链可用 → 评估升级以关闭 dependabot alert #14（RUSTSEC-2024-0429）')

  // 汇总表
  table(
    '| 类别 | 条目 | 状态/详情 |',
    rows.map((r) => `| ${r.kind} | ${r.item} | ${r.detail} |`),
  )

  hr()
  if (actionable.length > 0) {
    out(MARKDOWN ? '\n> ⚠️ **发现可行动变化**（exit 1）：' : '⚠️ 发现可行动变化：')
    actionable.forEach((a) => out(MARKDOWN ? `> - ${a}` : `  - ${a}`))
    out(MARKDOWN ? '' : '\n处置：按《docs/execution/依赖与安全跟踪机制》§漏洞与生态响应 SOP 评估；本脚本不做任何修复动作。')
    process.exit(1)
  }
  out(MARKDOWN ? '\n> ✅ 无可行动变化（官方生态与上游修复链均维持已知受阻状态）。' : '✅ 无可行动变化（官方生态与上游修复链均维持已知受阻状态）。')
  process.exit(0)
} catch (e) {
  console.error(`track-deps-ecosystem: 查询失败（上游不可达，不代表结论变化）：${e.message}`)
  process.exit(2)
}
