// 图集布局校验门禁（scripts/check-atlas-layout.mjs）
// 回归背景：20/50 份 shimeji profile 的 atlasLayout 套了模板值 cols=8/rows=9，
// 与素材真实列数（= 该角色最大帧数，实测 4~57）不符 → SpriteRenderer 的 background-size
// 按声明算 → 整图横向压缩 → 单个视口格内并排多帧，表现为「角色重叠排排站」。
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  diffAtlas,
  readImageSize,
  checkProfile,
  checkAtlasLayouts,
  assetToFilePath,
  DEFAULT_PROFILES_DIR,
} from '../check-atlas-layout.mjs'

const TMP = mkdtempSync(join(tmpdir(), 'atlas-check-'))

/** 构造一张最小可识别的 PNG 头（IHDR 宽高为 BE uint32） */
function fakePng(width, height) {
  const b = Buffer.alloc(48)
  b.writeUInt32BE(0x89504e47, 0)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

/** 构造 GIF 头（宽高 LE uint16） */
function fakeGif(width, height) {
  const b = Buffer.alloc(48)
  b.write('GIF8', 0, 'ascii')
  b.write('9a', 4, 'ascii')
  b.writeUInt16LE(width, 6)
  b.writeUInt16LE(height, 8)
  return b
}

/** 构造 WebP VP8X（24bit LE，存的是尺寸-1） */
function fakeWebpExtended(width, height) {
  const b = Buffer.alloc(48)
  b.write('RIFF', 0, 'ascii')
  b.write('WEBP', 8, 'ascii')
  b.write('VP8X', 12, 'ascii')
  b[24] = (width - 1) & 0xff
  b[25] = (width - 1) >> 8
  b[26] = (width - 1) >> 16
  b[27] = (height - 1) & 0xff
  b[28] = (height - 1) >> 8
  b[29] = (height - 1) >> 16
  return b
}

/** 构造 WebP VP8L（无损：14bit width-1 + 14bit height-1 打包在 @21） */
function fakeWebpLossless(width, height) {
  const b = Buffer.alloc(48)
  b.write('RIFF', 0, 'ascii')
  b.write('WEBP', 8, 'ascii')
  b.write('VP8L', 12, 'ascii')
  b[20] = 0x2f
  b.writeUInt32LE((width - 1) & 0x3fff | (((height - 1) & 0x3fff) << 14), 21)
  return b
}

/** 构造 WebP VP8 （有损：@26/@28 各 16bit LE，低 14bit 为尺寸） */
function fakeWebpLossy(width, height) {
  const b = Buffer.alloc(48)
  b.write('RIFF', 0, 'ascii')
  b.write('WEBP', 8, 'ascii')
  b.write('VP8 ', 12, 'ascii')
  b.writeUInt16LE(width, 26)
  b.writeUInt16LE(height, 28)
  return b
}

function writeTmp(name, buf) {
  const p = join(TMP, name)
  writeFileSync(p, buf)
  return p
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('diffAtlas（声明布局 vs 素材真实像素）', () => {
  it('完全匹配时无问题且不给建议', () => {
    const r = diffAtlas({ width: 1024, height: 1152, cellW: 128, cellH: 128, cols: 8, rows: 9 })
    expect(r.issues).toEqual([])
    expect(r.suggested).toBeNull()
  })

  it('cols 偏小时报压缩并给出真实列数建议（Nahida 场景）', () => {
    const r = diffAtlas({ width: 7296, height: 1152, cellW: 128, cellH: 128, cols: 8, rows: 9 })
    expect(r.issues.some((i) => i.includes('真实列数 57'))).toBe(true)
    expect(r.issues.some((i) => i.includes('并排 7.13 帧'))).toBe(true)
    expect(r.suggested).toEqual({ cols: 57, rows: 9 })
  })

  it('cols 偏大时报拉伸越界（Puro 场景）', () => {
    const r = diffAtlas({ width: 512, height: 896, cellW: 128, cellH: 128, cols: 8, rows: 9 })
    expect(r.issues.some((i) => i.includes('拉伸'))).toBe(true)
    expect(r.issues.some((i) => i.includes('rows=9 与素材不符'))).toBe(true)
    expect(r.suggested).toEqual({ cols: 4, rows: 7 })
  })

  it('animationRows.row 越界被捕获', () => {
    const r = diffAtlas({
      width: 1024, height: 1024, cellW: 128, cellH: 128, cols: 8, rows: 8,
      animationRows: { idle: { row: 9, frames: 4 } },
    })
    expect(r.issues.some((i) => i.includes('animationRows.idle.row=9 越界'))).toBe(true)
  })

  it('animationRows.frames 超过 cols 被捕获', () => {
    const r = diffAtlas({
      width: 1024, height: 1152, cellW: 128, cellH: 128, cols: 8, rows: 9,
      animationRows: { waving: { row: 3, frames: 57 } },
    })
    expect(r.issues.some((i) => i.includes('frames=57 超过 cols=8'))).toBe(true)
  })

  it('素材尺寸不能被 cellW 整除时单独报错', () => {
    const r = diffAtlas({ width: 1000, height: 1152, cellW: 128, cellH: 128, cols: 8, rows: 9 })
    expect(r.issues.some((i) => i.includes('不能被 cellW 128 整除'))).toBe(true)
    expect(r.suggested).toBeNull()
  })

  it('非法 cols/rows（0 或小数）被拒绝', () => {
    const r = diffAtlas({ width: 1024, height: 1152, cellW: 128, cellH: 128, cols: 0, rows: 8.5 })
    expect(r.issues.some((i) => i.includes('cols 非正整数'))).toBe(true)
    expect(r.issues.some((i) => i.includes('rows 非正整数'))).toBe(true)
  })
})

describe('readImageSize（零依赖文件头解析）', () => {
  it('PNG', () => {
    expect(readImageSize(writeTmp('a.png', fakePng(7296, 1152)))).toEqual({ width: 7296, height: 1152, format: 'png' })
  })
  it('GIF', () => {
    expect(readImageSize(writeTmp('a.gif', fakeGif(1024, 1152)))).toEqual({ width: 1024, height: 1152, format: 'gif' })
  })
  it('WebP VP8X', () => {
    expect(readImageSize(writeTmp('x.webp', fakeWebpExtended(192, 208)))).toEqual({ width: 192, height: 208, format: 'webp' })
  })
  it('WebP VP8L', () => {
    expect(readImageSize(writeTmp('l.webp', fakeWebpLossless(512, 896)))).toEqual({ width: 512, height: 896, format: 'webp' })
  })
  it('WebP VP8 ', () => {
    expect(readImageSize(writeTmp('y.webp', fakeWebpLossy(1024, 1152)))).toEqual({ width: 1024, height: 1152, format: 'webp' })
  })
  it('未知格式返回 null', () => {
    expect(readImageSize(writeTmp('z.bin', Buffer.alloc(48, 0x41)))).toBeNull()
  })
  it('文件不存在返回 null', () => {
    expect(readImageSize(join(TMP, 'nope.png'))).toBeNull()
  })
})

describe('checkProfile（单份 profile 校验）', () => {
  it('spriteAsset 为空时报错（对应 url() 非法值静默失败）', () => {
    const r = checkProfile({ id: 'x', spriteAsset: '' }, () => 'unused')
    expect(r.issues.some((i) => i.includes('spriteAsset 为空'))).toBe(true)
  })
  it('素材文件不存在时报错', () => {
    const r = checkProfile({ id: 'x', spriteAsset: '/pets/shimeji/Nope.png' }, () => join(TMP, 'missing.png'))
    expect(r.issues.some((i) => i.includes('素材文件不存在'))).toBe(true)
  })
  it('布局与素材一致时无问题', () => {
    const p = writeTmp('ok.png', fakePng(1024, 1152))
    const r = checkProfile(
      { id: 'ok', spriteAsset: '/x.png', atlasLayout: { cellW: 128, cellH: 128, cols: 8, rows: 9 }, animationRows: { idle: { row: 0, frames: 8 } } },
      () => p,
    )
    expect(r.issues).toEqual([])
  })
})

describe('assetToFilePath（URL 路径 → 文件系统路径）', () => {
  it('带 %20 的路径可解码解析', () => {
    const abs = assetToFilePath('/pets/shimeji/Hu%20Tao.png')
    expect(abs.endsWith(join('pets', 'shimeji', 'Hu Tao.png'))).toBe(true)
  })
  it('含空格的原始路径直接拼接', () => {
    const abs = assetToFilePath('/pets/shimeji/Hu Tao.png')
    expect(abs.endsWith(join('pets', 'shimeji', 'Hu Tao.png'))).toBe(true)
  })
})

// 真正的门禁：素材在场时必须 0 不一致。
// public/pets/ 整体被 .gitignore 忽略（仅 3 只内置角色素材被跟踪），
// 干净 clone / CI 下目录不存在 → 本用例跳过，由 checkAtlasLayouts 的 skipped 语义保证不误报。
describe('真实 shimeji 素材全量校验（门禁）', () => {
  const hasAssets = existsSync(DEFAULT_PROFILES_DIR)

  it.skipIf(!hasAssets)('所有 profile 的 atlasLayout 与素材像素/动画行完全一致', () => {
    const res = checkAtlasLayouts()
    const detail = res.problems.map((p) => `${p.id}: ${p.issues.join(' / ')}`).join('\n')
    expect(res.checked).toBeGreaterThan(40)
    expect(detail).toBe('')
  })

  it('目录不存在时返回 skipped 而非抛错', () => {
    const res = checkAtlasLayouts({ profilesDir: join(TMP, 'not-here') })
    expect(res.skipped).toBe(true)
    expect(res.problems).toEqual([])
    expect(res.checked).toBe(0)
  })
})
