#!/usr/bin/env node
/**
 * fetch-qwen-image-model.mjs — 下载 Qwen-Image-2.1-MNN 端侧图像模型权重
 *
 * 为什么需要它：
 *   本仓既有的 `scripts/fetch-mnn-model.mjs` 面向 **ModelScope**（端侧 LLM 模型来源），
 *   而 Qwen-Image-2.1-MNN 只发布在 **Hugging Face**（`evankuo/Qwen-Image-2.1-MNN`）。
 *   国内直连 HF 原站常不可达（实测 406），故以 **hf-mirror.com 为主、HF 原站为备**。
 *
 * 校验机制（实测确认，两套并存）：
 *   - **LFS 大文件**（权重）：体积取 API 的 `lfs.size`，SHA-256 取 HEAD 响应的 `ETag`
 *     （HF 的 LFS ETag 即 sha256；hf-mirror 的 API 不回 `lfs.oid`，故必须走 HEAD）。
 *   - **非 LFS 小文件**（config / tokenizer / 图定义）：这类文件走 hf-mirror 的 resolve-cache，
 *     **HEAD 不返回 Content-Length、ETag 是弱 ETag**，无法用 sha256。改用 API 的
 *     顶层 `size` + `blobId`（**git blob sha1**，与 `git hash-object` 等价）校验。
 *
 * 断点续传：实测 hf-mirror 对 LFS 文件的 `Range: bytes=N-` 返回 206，中断后重跑自动续传。
 *
 * 用法：
 *   node scripts/fetch-qwen-image-model.mjs --list
 *   node scripts/fetch-qwen-image-model.mjs --out artifacts/qwen-image21
 *   node scripts/fetch-qwen-image-model.mjs --out <dir> --groups shared,text-encoder,dit,turbo,tiny-vae
 *   node scripts/fetch-qwen-image-model.mjs --out <dir> --verify-only
 *
 * 依赖：Node 18+（内置 fetch）。无第三方依赖。
 *
 * @see docs/agents/ADR-0006-ondevice-image.md
 */
import { mkdir, open, stat, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import path from 'node:path'

const DEFAULT_REPO = 'evankuo/Qwen-Image-2.1-MNN'
/** 国内镜像优先；原站仅作备选（实测本机网络对原站返回 406）。 */
const HOSTS = ['https://hf-mirror.com', 'https://huggingface.co']
const UA = 'SpiritPal-fetch-qwen-image/1.0'
/** 单文件最大尝试次数（每次续传） */
const MAX_ATTEMPTS = 8

/**
 * 下载**空闲**超时：连续该时长无数据到达才中断。
 * 刻意不用「总时长上限」—— GB 级权重（dit.mnn.weight 4.27GB）在 ~6MB/s 下需十几分钟，
 * 固定 10 分钟总上限会把正常下载误杀，表现为「体积反复回落、永不收敛」。
 */
const IDLE_MS = 60_000

/**
 * 文件分组。用「路径规则」而非硬编码清单，跟随上游仓库结构变化。
 * 默认组对齐官方 README 的 default download（tiny VAE + 不含 Turbo，≈9.9 GB 十进制）。
 */
const GROUPS = {
  shared: (p) => ['txt_in.mnn', 'txt_in.mnn.weight', 'img_in.mnn', 'img_in.mnn.weight'].includes(p),
  'text-encoder': (p) => p.startsWith('text_encoder/'),
  dit: (p) => p === 'dit.mnn' || p === 'dit.mnn.weight',
  turbo: (p) => p === 'dit_turbo.mnn' || p === 'dit_turbo.mnn.weight',
  '2bit': (p) => p.startsWith('dit_2bit'),
  'tiny-vae': (p) => p === 'vae_decoder_tiny.mnn' || p === 'vae_encoder_tiny.mnn',
  'real-vae': (p) => p === 'vae_decoder.mnn' || p === 'vae_encoder.mnn',
  samples: (p) => p.startsWith('samples/'),
  docs: (p) => p === 'LICENSE' || p === 'README.md',
}
const DEFAULT_GROUPS = ['shared', 'text-encoder', 'dit', 'tiny-vae']

// ============ CLI 参数 ============

function parseArgs(argv) {
  const out = {
    repo: DEFAULT_REPO,
    out: '',
    groups: [...DEFAULT_GROUPS],
    revision: 'main',
    host: '',
    list: false,
    verifyOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--repo') out.repo = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--revision') out.revision = argv[++i]
    else if (a === '--host') out.host = argv[++i]
    else if (a === '--groups')
      out.groups = argv[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    else if (a === '--list') out.list = true
    else if (a === '--verify-only') out.verifyOnly = true
    else if (a === '-h' || a === '--help') {
      console.log(
        [
          '用法: node scripts/fetch-qwen-image-model.mjs [选项]',
          '',
          '  --out <dir>        下载目录（--list 时可省略）',
          '  --groups <a,b>     分组，默认 shared,text-encoder,dit,tiny-vae（≈9.9GB 十进制）',
          `                     可选: ${Object.keys(GROUPS).join(', ')}`,
          '  --repo <ns/name>   默认 evankuo/Qwen-Image-2.1-MNN',
          '  --revision <rev>   默认 main',
          '  --host <url>       指定单一源（默认 hf-mirror 优先、HF 原站备选）',
          '  --list             只列文件与分组，不下载',
          '  --verify-only      只校验本地文件，不下载',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  const unknown = out.groups.filter((g) => !GROUPS[g])
  if (unknown.length) {
    console.error(`未知分组: ${unknown.join(', ')}（可选: ${Object.keys(GROUPS).join(', ')}）`)
    process.exit(2)
  }
  return out
}

// ============ 工具 ============

function fmtBytes(n) {
  if (!n) return '0 B'
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GiB`
  const mb = n / 1024 ** 2
  if (mb >= 1) return `${mb.toFixed(1)} MiB`
  return `${(n / 1024).toFixed(1)} KiB`
}

async function fileSize(p) {
  try {
    return (await stat(p)).size
  } catch {
    return 0
  }
}

async function sha256(p) {
  const buf = await readFile(p)
  return createHash('sha256').update(buf).digest('hex')
}

/** git blob 对象的 sha1（等价 `git hash-object <file>`），用于非 LFS 文件的完整性校验。 */
async function gitBlobSha1(p) {
  const buf = await readFile(p)
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

/** 选中该路径的分组列表（用于 --list 展示） */
function groupsOf(relPath) {
  return Object.entries(GROUPS)
    .filter(([, match]) => match(relPath))
    .map(([name]) => name)
}

/** 探测可用源：返回第一个能响应 API 的 host。 */
async function probeHost(explicit, repo) {
  const candidates = explicit ? [explicit.replace(/\/$/, '')] : HOSTS
  const errors = []
  for (const host of candidates) {
    try {
      const res = await fetch(`${host}/api/models/${repo}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) {
        console.log(`源: ${host}`)
        return host
      }
      errors.push(`${host} → HTTP ${res.status}`)
    } catch (e) {
      errors.push(`${host} → ${e.name}`)
    }
  }
  throw new Error(`无可用的模型源：\n  ${errors.join('\n  ')}`)
}

/**
 * 拉取仓库文件清单（用 **tree 端点**）。
 *
 * ⚠️ 为什么不用 `?blobs=true`，也不用下载 URL 的 `ETag`：
 *   - 两种 API 端点的字段名不同：`?blobs=true` 里 LFS 哈希叫 `lfs.sha256`，tree 端点里叫 `lfs.oid`。
 *   - **下载 URL 的 `ETag` 不是内容 sha256** —— 实测 hf-mirror 回的是 xethub 的 `xetHash`
 *     （`dit.mnn` 的 ETag=`bcfb5074…`，而其真实 sha256=`069f8d9f…`）。曾据此做校验，导致 100% 误报。
 *   - tree 端点一次给出全部权威值：LFS 文件 `lfs.oid` = **sha256**；所有文件 `oid` = **git blob sha1**。
 *
 * 因此本脚本**不发 HEAD 请求**，校验值全部来自这一次 API 调用。
 */
async function listFiles(host, repo, revision) {
  const url = `${host}/api/models/${repo}/tree/${revision}?recursive=true`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`列文件失败 HTTP ${res.status}: ${url}`)
  const json = await res.json()
  const items = Array.isArray(json) ? json : json.items || []
  const files = items.filter((x) => x.type === 'file')
  if (!files.length) throw new Error('仓库清单为空（检查 repo / revision）')
  return files
    .map((x) => {
      const lfs = x.lfs || {}
      const lfsOid = String(lfs.oid || '').toLowerCase()
      const blobOid = String(x.oid || '').toLowerCase()
      return {
        path: x.path,
        size: lfs.size || x.size || 0,
        sha256: /^[0-9a-f]{64}$/.test(lfsOid) ? lfsOid : null,
        blobSha1: /^[0-9a-f]{40}$/.test(blobOid) ? blobOid : null,
        isLfs: Boolean(lfs.size),
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * 校验本地文件。
 * 优先级：sha256（LFS）> git blob sha1（非 LFS）> 仅体积。
 */
async function verifyFile(dest, f) {
  const size = await fileSize(dest)
  if (f.size > 0 && size !== f.size) return { ok: false, why: `体积 ${size} / ${f.size}` }
  if (f.sha256) {
    const h = await sha256(dest)
    return h === f.sha256 ? { ok: true } : { ok: false, why: 'sha256 不符' }
  }
  if (f.blobSha1) {
    const h = await gitBlobSha1(dest)
    return h === f.blobSha1 ? { ok: true } : { ok: false, why: 'git blob sha1 不符' }
  }
  return { ok: true }
}

/** 下载单个文件（支持断点续传）。 */
async function downloadOne(host, repo, revision, relPath, dest, expectSize) {
  const url = `${host}/${repo}/resolve/${revision}/${relPath}`
  const have = await fileSize(dest)
  const headers = { 'User-Agent': UA }
  if (have > 0 && expectSize > 0 && have < expectSize) headers.Range = `bytes=${have}-`

  // 空闲超时（见 IDLE_MS 注释）：只要字节还在流动就不掐，仅「连续无数据」才放弃。
  const controller = new AbortController()
  const idleErr = () => new Error(`空闲超时（${IDLE_MS / 1000}s 无数据到达）`)
  let idleTimer = setTimeout(() => controller.abort(idleErr()), IDLE_MS)
  const kick = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(idleErr()), IDLE_MS)
  }

  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
    if (!res.body) throw new Error('响应体为空')

    const append = have > 0 && res.status === 206
    // ⚠️ 刻意不用 `createWriteStream({ flags: 'a' })`：Windows 上 Node 会取文件「当前大小」
    // 作为 append 位置并做 >2GiB 校验，对 GB 级权重直接报
    //   `File size (N) is greater than 2 GiB`
    // （实测 dit.mnn.weight 4.17GiB 续传必挂，且因为每次都失败 → 体积反复回落、永不收敛）。
    // 改用 FileHandle：append 模式下 `write(buf)` 不传 position，由 OS 负责追加，跨平台稳定。
    const fh = await open(dest, append ? 'a' : 'w')
    try {
      let parts = []
      let pending = 0
      const FLUSH = 4 << 20 // 4 MiB 攒批，避免每 64KiB 一次 syscall
      for await (const chunk of Readable.fromWeb(res.body)) {
        kick() // 有数据到达 → 重置空闲计时器
        parts.push(chunk)
        pending += chunk.length
        if (pending >= FLUSH) {
          await fh.write(Buffer.concat(parts, pending))
          parts = []
          pending = 0
        }
      }
      if (pending > 0) await fh.write(Buffer.concat(parts, pending))
    } finally {
      await fh.close()
    }
    return { resumedFrom: append ? have : 0 }
  } finally {
    clearTimeout(idleTimer)
  }
}

// ============ 主流程 ============

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const host = await probeHost(args.host, args.repo)
  const all = await listFiles(host, args.repo, args.revision)

  const wanted = all.filter((f) => args.groups.some((g) => GROUPS[g](f.path)))
  const total = wanted.reduce((s, f) => s + f.size, 0)

  console.log(
    `仓库 ${args.repo}@${args.revision}：共 ${all.length} 个文件，` +
      `选中分组 [${args.groups.join(', ')}] → ${wanted.length} 个文件，${fmtBytes(total)}\n`,
  )

  if (args.list) {
    for (const f of all) {
      const gs = groupsOf(f.path)
      const mark = wanted.includes(f) ? '●' : '○'
      console.log(`  ${mark} ${String(f.size).padStart(12)}  ${f.path.padEnd(42)} [${gs.join(',')}]`)
    }
    console.log(`\n  ● = 本次选中（默认组 ${DEFAULT_GROUPS.join(',')}）`)
    console.log('  校验：LFS 文件用体积 + sha256(ETag)；非 LFS 文件用体积 + git blob sha1(blobId)')
    return
  }

  if (!args.out) {
    console.error('缺少 --out（下载目录）')
    process.exit(2)
  }
  await mkdir(args.out, { recursive: true })

  let ok = 0
  let failed = 0

  for (const f of wanted) {
    const dest = path.join(args.out, f.path.replace(/\//g, path.sep))
    await mkdir(path.dirname(dest), { recursive: true })
    const label = `${f.path} (${fmtBytes(f.size)})`

    // 已存在且校验通过 → 跳过
    const cur = await fileSize(dest)
    if (cur > 0 && cur === f.size) {
      const v = await verifyFile(dest, f)
      if (v.ok) {
        console.log(`  ✓ 已完整  ${label}`)
        ok++
        continue
      }
      console.log(`  ! ${v.why}，重下  ${label}`)
      await rm(dest, { force: true })
    } else if (cur > 0) {
      console.log(`  ↓ 续传（已有 ${fmtBytes(cur)} / ${fmtBytes(f.size)}）  ${label}`)
    } else {
      console.log(`  ↓ 下载  ${label}`)
    }

    if (args.verifyOnly) {
      console.log('    ✗ 缺失或损坏（--verify-only 不下载）')
      failed++
      continue
    }

    let done = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
      try {
        const { resumedFrom } = await downloadOne(host, args.repo, args.revision, f.path, dest, f.size)
        const v = await verifyFile(dest, f)
        if (!v.ok) {
          console.log(`    尝试 ${attempt}：${v.why} → ${v.why.startsWith('体积') ? '续传' : '重下'}`)
          if (!v.why.startsWith('体积')) await rm(dest, { force: true })
          continue
        }
        console.log(`    ✓ 校验通过${resumedFrom ? `（续传自 ${fmtBytes(resumedFrom)}）` : ''}`)
        done = true
        ok++
      } catch (e) {
        console.log(`    尝试 ${attempt} 失败：${e.message}`)
      }
    }
    if (!done) {
      console.error(`    ✗ ${f.path} 在 ${MAX_ATTEMPTS} 次尝试后仍不完整`)
      failed++
    }
  }

  console.log(`\n=== 完成：通过 ${ok} / 失败 ${failed} / 共 ${wanted.length} ===`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('致命错误:', e.message)
  process.exit(1)
})
