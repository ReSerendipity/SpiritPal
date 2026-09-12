#!/usr/bin/env node
/**
 * 社区宠物包批量导入脚本
 *
 * 从外部宠物仓库拉取素材并转换为 SpiritPal 的 CharacterPackConfig 格式，
 * 输出到 public/pets/<id>/（由 communityLoader 的 manifest 自动发现加载）。
 *
 * 用法:
 *   node scripts/import-community-pets.mjs                  # 全部源
 *   node scripts/import-community-pets.mjs --source occlaw  # 仅 OC-Claw
 *   node scripts/import-community-pets.mjs --force          # 覆盖已存在
 *
 * 源:
 *   occlaw    - OC-Claw 11 只精灵图（MIT，rainnoon/oc-claw，原生 spritesheet.webp）
 *   windowpet - WindowPet 50 只 shimeji（MIT，本地 vendor 目录 → convert-windowpet.ts）
 *   openpets  - OpenPets 开学季 24 只（MIT，zip.openpets.dev 下载）
 */
import { mkdir, writeFile, readFile, copyFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  BUILTIN_IDS,
  normalizeId,
  XQ_STATE_MAP,
  DSHPET_STATE_MAP,
} from './community-pet-maps.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const PETS = path.join(ROOT, 'public', 'pets')

// ffmpeg 便携版路径（scripts/tools/ffmpeg/bin/ffmpeg.exe，见 README asset-pipeline）
const FFMPEG =
  process.env.FFMPEG_BIN ||
  (process.platform === 'win32'
    ? path.join(ROOT, 'scripts', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe')
    : 'ffmpeg')
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1')

/** 转 VP9 alpha webm（带或不带 colorkey 抠像） */
function toWebmAlpha(input, output, { blackKey = false } = {}) {
  const args = ['-y', '-i', input]
  if (blackKey) args.push('-vf', 'colorkey=0x000000:0.06:0.06')
  args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '32', output)
  execFileSync(FFMPEG, args, { stdio: 'ignore' })
}

/** 探测视频是否有 alpha 平面（yuva / rgba 等） */
function hasAlpha(input) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', input], { encoding: 'utf8' })
  const fmt = String(r.stdout).trim()
  return /a/.test(fmt) && /yuva|rgba|argb/.test(fmt)
}

/** GitHub raw/blob 下载辅助 */
async function ghTree(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`, { headers: GH_HEADERS })
  return (await r.json()).tree
}
async function ghBlob(repo, sha) {
  const r = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${sha}`, { headers: GH_HEADERS })
  const j = await r.json()
  return Buffer.from(j.content, 'base64')
}

// ─── A. OC-Claw（GitHub API：tree → blobs/contents） ──────
const OC_CLAW_BASE = 'https://api.github.com/repos/rainnoon/oc-claw'
const GH_HEADERS = { 'User-Agent': 'spiritpal-import', Accept: 'application/vnd.github+json' }
const OC_CLAW_PACKS = [
  'doro.codex-pet', 'elaina-2', 'homie', 'linnea-2', 'mambo',
  'naruto', 'nezuko', 'phoebe.codex-pet', 'skirk-2', 'taffy', 'wukong',
]

async function importOcClaw({ force }) {
  const tree = await (await fetch(`${OC_CLAW_BASE}/git/trees/main?recursive=1`, { headers: GH_HEADERS })).json()
  for (const src of OC_CLAW_PACKS) {
    const id = normalizeId(src, 'occlaw')
    const outDir = path.join(PETS, id)
    if (!force && existsSync(path.join(outDir, 'pet.json'))) { console.log(`skip occlaw ${id}`); continue }
    const spriteEntry =
      tree.tree.find((e) => e.path === `frontend/public/assets/builtin/${src}/spritesheet.webp`) ??
      tree.tree.find((e) => e.path === `frontend/public/assets/builtin/${src}/spritesheet.png`)
    if (!spriteEntry) { console.warn(`!! occlaw ${src}: spritesheet 缺失，跳过`); continue }
    const spriteExt = path.extname(spriteEntry.path)
    const [metaRes, blobRes] = await Promise.all([
      fetch(`${OC_CLAW_BASE}/contents/frontend/public/assets/builtin/${src}/pet.json`, { headers: GH_HEADERS }),
      fetch(`${OC_CLAW_BASE}/git/blobs/${spriteEntry.sha}`, { headers: GH_HEADERS }),
    ])
    const metaJson = await metaRes.json()
    const blob = await blobRes.json()
    const meta = JSON.parse(Buffer.from(metaJson.content, 'base64').toString('utf8'))
    await mkdir(outDir, { recursive: true })
    await writeFile(path.join(outDir, `spritesheet${spriteExt}`), Buffer.from(blob.content, 'base64'))
    await writeFile(
      path.join(outDir, 'pet.json'),
      JSON.stringify(
        {
          id,
          name: meta.displayName ?? meta.name ?? id,
          version: '1.0.0',
          author: 'OC-Claw',
          license: 'MIT',
          description: meta.description ?? '',
          spritePath: `spritesheet${spriteExt}`,
          spriteType: 'atlas',
          tags: ['OC-Claw'],
        },
        null,
        2,
      ),
    )
    console.log(`✓ occlaw ${src} → ${id}`)
  }
}

// ─── C. WindowPet（本地 vendor → convert-windowpet.ts） ─────
async function importWindowPet() {
  const vendorConfigs = path.join(ROOT, 'scripts', 'vendor', 'windowpet', 'src', 'config')
  const vendorMedia = path.join(ROOT, 'scripts', 'vendor', 'windowpet', 'public', 'media')
  const shimejiDir = path.join(PETS, 'shimeji')
  const configsDir = path.join(shimejiDir, 'configs')
  const profilesDir = path.join(shimejiDir, 'profiles')
  if (!existsSync(vendorConfigs)) {
    console.warn('!! windowpet: 未找到 scripts/vendor/windowpet（先 git clone --depth 1 https://github.com/SeakMengs/WindowPet scripts/vendor/windowpet）')
    return
  }
  await mkdir(configsDir, { recursive: true })
  await mkdir(shimejiDir, { recursive: true })
  for (const f of await readdir(vendorConfigs)) {
    if (f.endsWith('.json')) await copyFile(path.join(vendorConfigs, f), path.join(configsDir, f))
  }
  for (const f of await readdir(vendorMedia)) {
    if (f.endsWith('.png')) await copyFile(path.join(vendorMedia, f), path.join(shimejiDir, f))
  }
  const r = spawnSync('npx', ['tsx', 'scripts/convert-windowpet.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) throw new Error('convert-windowpet.ts 执行失败')
  // 生成 profiles manifest（精确 id 列表，绕开 KNOWN_SHIMEJI_IDS 的命名漂移）
  const ids = (await readdir(profilesDir))
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .map((f) => f.replace(/\.json$/, ''))
  await writeFile(path.join(profilesDir, 'manifest.json'), JSON.stringify({ ids: [...ids].sort() }, null, 2))
  console.log(`✓ windowpet ${ids.length} 个 profile 已生成`)
}

// ─── D. OpenPets 开学季 24 只（zip.openpets.dev） ───────────
const OPENPETS_PACKS = [
  'notebook-buddy', 'backpack-buddy', 'pixel-terminal', 'globe-buddy',
  'desk-lamp-buddy', 'paper-ball-buddy', 'pencil-pal', 'calculator-buddy',
  'apple-scholar', 'reminder-note', 'pencil-case-pal', 'hoodie-cat',
  'brain-trainer', 'bubble-flask', 'book-stack-buddy', 'study-fuel',
  'eraser-buddy', 'glue-bottle-buddy', 'music-player-buddy', 'scissors-buddy',
  'chalkboard-buddy', 'banana-skater', 'bookworm-reader', 'paper-plane-pal',
]

async function importOpenPets({ force }) {
  const tmpRoot = path.join(ROOT, '.tmp-openpets')
  await mkdir(tmpRoot, { recursive: true })
  for (const id of OPENPETS_PACKS) {
    const outDir = path.join(PETS, id)
    if (!force && existsSync(path.join(outDir, 'pet.json'))) { console.log(`skip openpets ${id}`); continue }
    const tmp = path.join(tmpRoot, id)
    await mkdir(tmp, { recursive: true })
    const zipUrl = `https://zip.openpets.dev/pets/${id}-openpets/${id}.zip`
    execFileSync('curl.exe', ['-s', '-o', path.join(tmp, 'p.zip'), zipUrl])
    spawnSync('tar.exe', ['-xf', path.join(tmp, 'p.zip'), '-C', tmp], { stdio: 'ignore' })
    if (!existsSync(path.join(tmp, 'pet.json')) || !existsSync(path.join(tmp, 'spritesheet.webp'))) {
      console.warn(`!! openpets ${id}: zip 内容不完整，跳过`)
      continue
    }
    const meta = JSON.parse(await readFile(path.join(tmp, 'pet.json'), 'utf8'))
    await mkdir(outDir, { recursive: true })
    await copyFile(path.join(tmp, 'spritesheet.webp'), path.join(outDir, 'spritesheet.webp'))
    await writeFile(
      path.join(outDir, 'pet.json'),
      JSON.stringify(
        {
          id,
          name: meta.displayName ?? meta.name ?? id,
          version: '1.0.0',
          author: 'OpenPets',
          license: 'MIT',
          description: meta.description ?? '',
          spritePath: 'spritesheet.webp',
          spriteType: 'atlas',
          tags: ['OpenPets'],
        },
        null,
        2,
      ),
    )
    console.log(`✓ openpets ${id}`)
  }
  await rm(tmpRoot, { recursive: true, force: true })
}

// ─── B. OC-Claw 香企鹅（视频：.mov → VP9 alpha webm） ──────
async function importXiangQie({ force }) {
  const outDir = path.join(PETS, 'xiang-qie')
  if (!force && existsSync(path.join(outDir, 'pet.json'))) { console.log('skip xiang-qie'); return }
  const tree = await ghTree('rainnoon/oc-claw')
  await mkdir(outDir, { recursive: true })
  for (const [state, file] of Object.entries(XQ_STATE_MAP)) {
    const srcPath = `frontend/public/assets/builtin/香企鹅/large/mov/${file}.mov`
    const entry = tree.find((e) => e.path === srcPath)
    if (!entry) { console.warn(`!! 香企鹅 缺 ${file}.mov`); continue }
    const buf = await ghBlob('rainnoon/oc-claw', entry.sha)
    const tmp = path.join(outDir, `${file}.mov`)
    await writeFile(tmp, buf)
    toWebmAlpha(tmp, path.join(outDir, `${file}.webm`))
    await rm(tmp, { force: true })
  }
  await writeFile(
    path.join(outDir, 'pet.json'),
    JSON.stringify(
      {
        id: 'xiang-qie',
        name: '香企鹅',
        version: '1.0.0',
        author: 'OC-Claw',
        license: 'MIT',
        description: 'OC-Claw 默认角色香企鹅，透明视频动画。',
        spritePath: 'idle.webm',
        spriteType: 'video',
        tags: ['OC-Claw'],
      },
      null,
      2,
    ),
  )
  console.log('✓ 香企鹅（视频 8 状态）')
}

// ─── E. dsh-pet 大肥鱼（视频：8 状态子集映射） ──────────────
async function importDshPet({ force }) {
  const outDir = path.join(PETS, 'dashayu')
  if (!force && existsSync(path.join(outDir, 'pet.json'))) { console.log('skip dashayu'); return }
  const tree = await ghTree('PC2005-cloud/dsh-pet')
  await mkdir(outDir, { recursive: true })
  for (const [state, name] of Object.entries(DSHPET_STATE_MAP)) {
    const srcPath = `dsh-pet/assets/webm/${name}.webm`
    const entry = tree.find((e) => e.path === srcPath)
    if (!entry) { console.warn(`!! dsh-pet 缺 ${name}.webm`); continue }
    const buf = await ghBlob('PC2005-cloud/dsh-pet', entry.sha)
    const tmp = path.join(outDir, `${state}.src.webm`)
    await writeFile(tmp, buf)
    toWebmAlpha(tmp, path.join(outDir, `${state}.webm`), { blackKey: !hasAlpha(tmp) })
    await rm(tmp, { force: true })
  }
  await writeFile(
    path.join(outDir, 'pet.json'),
    JSON.stringify(
      {
        id: 'dashayu',
        name: '大肥鱼',
        version: '1.0.0',
        author: 'dsh-pet',
        license: 'MIT',
        description: 'DSH 大肥鱼桌宠，91 动作库中的 8 个状态子集。',
        spritePath: 'idle.webm',
        spriteType: 'video',
        tags: ['dsh-pet'],
      },
      null,
      2,
    ),
  )
  console.log('✓ 大肥鱼（视频 8 状态）')
}

// ─── F. DyberPet ChrisKitty / Kitty（帧 PNG → 8×2 spritesheet） ─
const DYBERPET_ROLES = ['ChrisKitty', 'Kitty']

async function importDyberPet({ force }) {
  const tree = await ghTree('ChaozhongLiu/DyberPet')
  for (const role of DYBERPET_ROLES) {
    const id = normalizeId(role, 'dyberpet')
    const outDir = path.join(PETS, id)
    if (!force && existsSync(path.join(outDir, 'pet.json'))) { console.log(`skip ${id}`); continue }
    const prefix = `res/role/${role}/`
    const frames = tree
      .filter((e) => e.path.startsWith(prefix + 'action/') && e.path.endsWith('.png'))
      .map((e) => e.path)
    const stands = frames.filter((p) => /stand_\d+\.png$/.test(p)).sort()
    const rightwalks = frames.filter((p) => /rightwalk_\d+\.png$/.test(p)).sort()
    const leftwalks = frames.filter((p) => /leftwalk_\d+\.png$/.test(p)).sort()
    const onfloors = frames.filter((p) => /onfloor_\d+\.png$/.test(p)).sort()
    const idleFrames = stands.length ? stands : onfloors
    const walkFrames = rightwalks.length + leftwalks.length ? [...rightwalks, ...leftwalks] : onfloors
    if (idleFrames.length === 0 || walkFrames.length === 0) { console.warn(`!! ${role}: 缺少 idle/walk 帧，跳过`); continue }
    const tmpDir = path.join(ROOT, '.tmp-dyberpet', role)
    await mkdir(tmpDir, { recursive: true })
    // 下载所有帧
    for (const p of [...idleFrames, ...walkFrames]) {
      const entry = tree.find((e) => e.path === p)
      await writeFile(path.join(tmpDir, path.basename(p)), await ghBlob('ChaozhongLiu/DyberPet', entry.sha))
    }
    // row0 = stand（5 帧）→ 8 列；row1 = onfloor（8 帧）→ 8 列
    const tileRow = async (files, out) => {
      const inputs = files.map((f) => path.join(tmpDir, path.basename(f)))
      const args = ['-y']
      for (const i of inputs) args.push('-i', i)
      const concatIn = inputs.map((_, i) => `[${i}:v]`).join('')
      args.push('-filter_complex', `${concatIn}concat=n=${inputs.length}:v=1:a=0,tile=8x1`, out)
      execFileSync(FFMPEG, args, { stdio: 'ignore' })
    }
    const row0 = path.join(tmpDir, 'row0.png')
    const row1 = path.join(tmpDir, 'row1.png')
    const sheet = path.join(tmpDir, 'spritesheet.png')
    await tileRow(idleFrames, row0)
    await tileRow(walkFrames, row1)
    execFileSync(FFMPEG, ['-y', '-i', row0, '-i', row1, '-filter_complex', '[0:v][1:v]vstack', sheet], { stdio: 'ignore' })
    await mkdir(outDir, { recursive: true })
    await copyFile(sheet, path.join(outDir, 'spritesheet.png'))
    await writeFile(
      path.join(outDir, 'pet.json'),
      JSON.stringify(
        {
          id,
          name: role,
          version: '1.0.0',
          author: 'DyberPet',
          license: 'GPL-3.0',
          licenseMeta: { type: 'GPL-3.0', audited: true, assetSource: 'DyberPet res/role/' + role },
          description: 'DyberPet 角色模组素材（GPL-3.0，风险素材可整目录删除）。',
          spritePath: 'spritesheet.png',
          spriteType: 'atlas',
          atlasLayout: { cellW: 72, cellH: 64, cols: 8, rows: 2 },
          tags: ['DyberPet'],
        },
        null,
        2,
      ),
    )
    await rm(path.join(ROOT, '.tmp-dyberpet'), { recursive: true, force: true })
    console.log(`✓ ${role} → ${id}（idle ${idleFrames.length} 帧 + walk ${walkFrames.length} 帧）`)
  }
}

// ─── manifest.json 汇总（社区宠物 id，排除内置与 shimeji） ──
async function writeManifest() {
  const entries = (await readdir(PETS, { withFileTypes: true })).filter(
    (d) => d.isDirectory() && d.name !== 'shimeji',
  )
  const ids = []
  for (const d of entries) {
    const pj = path.join(PETS, d.name, 'pet.json')
    if (!existsSync(pj)) continue
    const meta = JSON.parse(await readFile(pj, 'utf8'))
    if (BUILTIN_IDS.has(meta.id)) continue
    ids.push(meta.id)
  }
  await writeFile(path.join(PETS, 'manifest.json'), JSON.stringify({ packs: [...new Set(ids)].sort() }, null, 2))
  console.log(`✓ manifest.json: ${new Set(ids).size} 个社区宠物`)
}

// ─── main ─────────────────────────────────────────────────
const args = process.argv.slice(2)
const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1] ?? 'all'
const force = args.includes('--force')

const sources =
  sourceArg === 'all'
    ? ['occlaw', 'windowpet', 'openpets', 'xiangqie', 'dashayu', 'dyberpet']
    : [sourceArg]
for (const s of sources) {
  if (s === 'occlaw') await importOcClaw({ force })
  else if (s === 'windowpet') await importWindowPet()
  else if (s === 'openpets') await importOpenPets({ force })
  else if (s === 'xiangqie') await importXiangQie({ force })
  else if (s === 'dashayu') await importDshPet({ force })
  else if (s === 'dyberpet') await importDyberPet({ force })
  else console.warn(`!! 未知源: ${s}（可选 occlaw|windowpet|openpets|xiangqie|dashayu|dyberpet）`)
}
if (sources.includes('occlaw') || sources.includes('openpets') || sources.includes('xiangqie') || sources.includes('dashayu') || sources.includes('dyberpet')) {
  await writeManifest()
}
console.log('完成。')
