/**
 * 图集布局一致性校验（Shimeji profiles 的 atlasLayout vs 素材真实像素）
 *
 * 背景（2026-09-13）：51 份 `public/pets/shimeji/profiles/*.json` 的 `atlasLayout`
 * 曾统一套用模板 `{cellW:128, cellH:128, cols:8, rows:9}`，但 shimeji 素材的惯例布局是
 * 「每行一个动画、帧横向连续排开」，真实列数 = 该角色最大帧数（实测 4~57 不等）。
 * cols 声明偏小时 `SpriteRenderer` 会把整张图横向压缩（`background-size` 按声明算），
 * 一个视口格子里并排显示多帧 → 表现为「多个角色重叠排排站」；声明偏大则反向拉伸 + 取帧越界。
 *
 * 校验口径（全部可机器验证，不依赖运行时）：
 * 1. `cols × cellW === 图片真实宽`，`rows × cellH === 图片真实高`（且必须整除）
 * 2. `animationRows[*].row < rows`（行不越界）
 * 3. `animationRows[*].frames <= cols`（帧不越界）
 *
 * 覆盖范围：仅 shimeji profiles（PNG/WebP/GIF 素材）。内置角色（`characters.ts` + 全局
 * ATLAS 常量）与社区 pack（`pet.json` 结构）不在本脚本口径内。
 *
 * 用法：
 *   node scripts/check-atlas-layout.mjs            # 人类可读报告，有不一致时 exit 1
 *   node scripts/check-atlas-layout.mjs --json     # 机器可读输出
 */
import { readFileSync, readdirSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 默认 profile 目录 */
export const DEFAULT_PROFILES_DIR = join(ROOT, 'public', 'pets', 'shimeji', 'profiles')

/** 与 shimejiLoader.normalizeShimejiProfile 的缺省值保持一致 */
export const FALLBACK_ATLAS = { cellW: 128, cellH: 128, cols: 8, rows: 9 }

/** 只读文件头若干字节即可取到尺寸，避免把几十 MB 素材读进内存 */
const HEADER_BYTES = 48

/**
 * 读取图片真实像素尺寸（零依赖，直接解析文件头）
 * 支持 PNG（IHDR）/ WebP（VP8 | VP8L | VP8X）/ GIF（Logical Screen Descriptor）
 * @param {string} filePath 图片绝对路径
 * @returns {{width:number,height:number,format:string}|null} 无法识别时返回 null
 */
export function readImageSize(filePath) {
  const buf = Buffer.alloc(HEADER_BYTES)
  let fd
  try {
    fd = openSync(filePath, 'r')
    if (readSync(fd, buf, 0, HEADER_BYTES, 0) < HEADER_BYTES) return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }

  // PNG: 8 字节签名 + IHDR 长度(4) + 'IHDR'(4) + width(4 BE @16) + height(4 BE @20)
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' }
  }
  // WebP: 'RIFF'(0) size(4) 'WEBP'(8) 然后子块 fourcc(12)
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16)
    if (fourcc === 'VP8X') {
      // 扩展格式：canvas 宽高各 24bit LE（存的是 尺寸-1），位于 @24 / @27
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
      return { width: w, height: h, format: 'webp' }
    }
    if (fourcc === 'VP8L') {
      // 无损：@21 起 0x2F 签名 + 14bit width-1 + 14bit height-1
      const bits = buf.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' }
    }
    if (fourcc === 'VP8 ') {
      // 有损：帧头 @26/@28 各 16bit LE，低 14bit 为尺寸
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: 'webp' }
    }
    return null
  }
  // GIF: 'GIF8'(0) + 'a'/'7'(4) + 版本(5) + width(6 LE16) + height(8 LE16)
  if (buf.toString('ascii', 0, 4) === 'GIF8') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: 'gif' }
  }
  return null
}

/**
 * 纯计算：比对声明的图集布局与素材真实尺寸，返回问题列表
 * @param {{width:number,height:number,cellW:number,cellH:number,cols:number,rows:number,animationRows?:Record<string,{row:number,frames:number}>}} meta
 * @returns {{issues:string[],suggested:{cols:number,rows:number}|null}}
 */
export function diffAtlas(meta) {
  const { width, height, cellW, cellH, cols, rows, animationRows = {} } = meta
  /** @type {string[]} */
  const issues = []

  for (const [name, v] of Object.entries({ cellW, cellH, cols, rows })) {
    if (!Number.isInteger(v) || v <= 0) issues.push(`${name} 非正整数：${String(v)}`)
  }
  if (issues.length) return { issues, suggested: null }

  const realCols = width / cellW
  const realRows = height / cellH
  if (!Number.isInteger(realCols)) {
    issues.push(`图片宽 ${width} 不能被 cellW ${cellW} 整除（素材本身可能裁切异常）`)
  }
  if (!Number.isInteger(realRows)) {
    issues.push(`图片高 ${height} 不能被 cellH ${cellH} 整除（素材本身可能裁切异常）`)
  }
  if (Number.isInteger(realCols) && Number.isInteger(realRows)) {
    const declaredW = cols * cellW
    const declaredH = rows * cellH
    if (declaredW !== width) {
      const k = declaredW / width
      issues.push(
        `cols=${cols} 与素材不符：声明宽 ${declaredW}px，实际 ${width}px（真实列数 ${realCols}）` +
        (k < 1
          ? ` → 整图被横向压缩到 ${k.toFixed(3)}×，单个视口格内并排 ${(1 / k).toFixed(2)} 帧（表现为角色重叠排排站）`
          : ` → 整图被横向拉伸到 ${k.toFixed(3)}×，取帧越界（表现为只露半截/动作乱跳）`),
      )
    }
    if (declaredH !== height) {
      issues.push(
        `rows=${rows} 与素材不符：声明高 ${declaredH}px，实际 ${height}px（真实行数 ${realRows}）` +
        ' → 纵向缩放错位，动画行会串到相邻行',
      )
    }
  }

  for (const [state, def] of Object.entries(animationRows)) {
    if (!def || typeof def !== 'object') {
      issues.push(`animationRows.${state} 非法：${JSON.stringify(def)}`)
      continue
    }
    if (typeof def.row !== 'number' || def.row < 0 || def.row >= rows) {
      issues.push(`animationRows.${state}.row=${String(def.row)} 越界（rows=${rows}，合法 0..${rows - 1}）`)
    }
    if (typeof def.frames !== 'number' || def.frames <= 0) {
      issues.push(`animationRows.${state}.frames=${String(def.frames)} 非法（应为正整数）`)
    } else if (def.frames > cols) {
      issues.push(`animationRows.${state}.frames=${def.frames} 超过 cols=${cols}，取帧会越界到相邻列`)
    }
  }

  const suggested =
    Number.isInteger(realCols) && Number.isInteger(realRows) && (realCols !== cols || realRows !== rows)
      ? { cols: realCols, rows: realRows }
      : null

  return { issues, suggested }
}

/**
 * 校验单个 profile 对象
 * @param {object} profile 已解析的 profile JSON
 * @param {(spriteAsset:string)=>string} resolveAsset spriteAsset（URL 路径）→ 绝对文件路径
 * @returns {{id:string,asset:string,fileExists:boolean,size:{width:number,height:number,format:string}|null,issues:string[],suggested:{cols:number,rows:number}|null}}
 */
export function checkProfile(profile, resolveAsset) {
  const id = profile?.id ?? '(no-id)'
  const asset = typeof profile?.spriteAsset === 'string' ? profile.spriteAsset : ''
  if (!asset) {
    return { id, asset, fileExists: false, size: null, issues: ['spriteAsset 为空（渲染器会拿到 url() 非法值）'], suggested: null }
  }
  const filePath = resolveAsset(asset)
  if (!existsSync(filePath)) {
    return { id, asset, fileExists: false, size: null, issues: [`素材文件不存在：${asset}`], suggested: null }
  }
  const size = readImageSize(filePath)
  if (!size) {
    return { id, asset, fileExists: true, size: null, issues: [], suggested: null }
  }
  const layout = { ...FALLBACK_ATLAS, ...(profile.atlasLayout ?? {}) }
  const { issues, suggested } = diffAtlas({
    width: size.width,
    height: size.height,
    cellW: layout.cellW,
    cellH: layout.cellH,
    cols: layout.cols,
    rows: layout.rows,
    animationRows: profile.animationRows ?? {},
  })
  return { id, asset, fileExists: true, size, issues, suggested }
}

/**
 * 把 spriteAsset（形如 `/pets/shimeji/Hu Tao.png`）解析为仓库内绝对路径
 * @param {string} asset profile 中的 spriteAsset
 * @param {string} profilesDir profile 目录（用于回退相对解析）
 * @returns {string} 绝对文件路径
 */
export function assetToFilePath(asset, profilesDir = DEFAULT_PROFILES_DIR) {
  let decoded = String(asset)
  try { decoded = decodeURIComponent(decoded) } catch { /* 保留原样 */ }
  if (decoded.startsWith('/')) return join(ROOT, 'public', decoded.slice(1))
  return resolve(dirname(profilesDir), decoded)
}

/**
 * 全量校验 profile 目录
 *
 * ⚠️ 素材边界：`public/pets/` 整体在 `.gitignore` 内（仅 3 只内置角色的素材被跟踪），
 * shimeji profiles 与 PNG 均为本地私有资源。故干净 clone / CI 环境下本目录不存在，
 * 此时返回 `skipped: true` 且不算失败——校验口径只在素材在场时生效。
 * @param {{profilesDir?:string}} [options]
 * @returns {{checked:number,problems:ReturnType<typeof checkProfile>[],unknownFormat:string[],skipped:boolean,reason?:string}}
 */
export function checkAtlasLayouts(options = {}) {
  const profilesDir = options.profilesDir ?? DEFAULT_PROFILES_DIR
  if (!existsSync(profilesDir)) {
    return { checked: 0, problems: [], unknownFormat: [], skipped: true, reason: `profile 目录不存在：${profilesDir}` }
  }
  const files = readdirSync(profilesDir).filter((f) => f.endsWith('.json') && f !== 'manifest.json')
  /** @type {ReturnType<typeof checkProfile>[]} */
  const problems = []
  /** @type {string[]} */
  const unknownFormat = []
  let checked = 0

  for (const file of files) {
    let profile
    try {
      profile = JSON.parse(readFileSync(join(profilesDir, file), 'utf8'))
    } catch (e) {
      problems.push({ id: file, asset: '', fileExists: false, size: null, issues: [`JSON 解析失败：${e.message}`], suggested: null })
      checked += 1
      continue
    }
    checked += 1
    const result = checkProfile(profile, (a) => assetToFilePath(a, profilesDir))
    if (result.size === null && result.fileExists && result.issues.length === 0) {
      unknownFormat.push(result.id)
    }
    if (result.issues.length > 0) problems.push(result)
  }
  return { checked, problems, unknownFormat, skipped: false }
}

/** CLI 入口 */
function main() {
  const asJson = process.argv.includes('--json')
  const { checked, problems, unknownFormat, skipped, reason } = checkAtlasLayouts()
  if (asJson) {
    process.stdout.write(JSON.stringify({ checked, problems, unknownFormat, skipped, reason }, null, 2) + '\n')
    process.exitCode = problems.length > 0 ? 1 : 0
    return
  }
  for (const p of problems) {
    const size = p.size ? `${p.size.width}x${p.size.height}` : 'n/a'
    process.stdout.write(`✗ ${p.id} [素材 ${size}] ${p.asset}\n`)
    for (const i of p.issues) process.stdout.write(`    - ${i}\n`)
    if (p.suggested) process.stdout.write(`    → 建议 atlasLayout: cols=${p.suggested.cols} rows=${p.suggested.rows}\n`)
  }
  if (skipped) {
    process.stdout.write(`atlas-layout-check: SKIPPED（${reason ?? '素材缺失'}）\n`)
    process.exitCode = 0
    return
  }
  const summary = `atlas-layout-check: ${checked} profiles checked, ${problems.length} inconsistent` +
    (unknownFormat.length > 0 ? `, ${unknownFormat.length} unknown-format skipped` : '')
  process.stdout.write(summary + '\n')
  process.exitCode = problems.length > 0 ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
