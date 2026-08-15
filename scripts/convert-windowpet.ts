/**
 * WindowPet JSON → SpiritPal CharacterProfile 转换脚本
 *
 * 用法: npx tsx scripts/convert-windowpet.ts
 *   或: node --experimental-strip-types scripts/convert-windowpet.ts
 *
 * 从 WindowPet 的 config JSON 读取精灵配置，
 * 转换为 SpiritPal 的 CharacterProfile 格式并输出。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ─── 路径配置 ───────────────────────────────────────────
const CONFIG_DIR = path.resolve(
  __dirname,
  '../public/pets/shimeji/configs',
)
const OUTPUT_DIR = path.resolve(
  __dirname,
  '../public/pets/shimeji/profiles',
)

// ─── WindowPet 类型（简化） ──────────────────────────────
interface WindowPetState {
  spriteLine?: number
  frameMax?: number
  start?: number
  end?: number
}

interface WindowPetConfig {
  name: string
  credit?: { resource?: string; link?: string; socialMedia?: string }
  id?: string
  width?: number
  height?: number
  frameSize?: number
  highestFrameMax?: number
  totalSpriteLine?: number
  imageSrc: string
  states: Record<string, WindowPetState>
}

// ─── SpiritPal 类型（仅转换所需部分） ──────────────────────
interface AnimationRow {
  row: number
  frames: number
}

interface Personality {
  warmth: number
  liveliness: number
  dependence: number
  directness: number
  rationality: number
}

interface CharacterProfile {
  id: string
  name: string
  displayName: string
  source: string
  birthBackground: string
  emotionalCore: string
  personality: Personality
  signaturePhrase: string
  classicQuotes: string[]
  systemPrompt: string
  fewShotExamples: { user: string; assistant: string }[]
  spriteAsset: string
  spriteType: 'atlas'
  themeColor: { primary: string; secondary: string }
  bubbleMessages: {
    idle: string[]
    hungry: string[]
    sad: string[]
    pet: string[]
    feed: string[]
    pomodoroDone: string[]
  }
  atlasLayout: { cellW: number; cellH: number; cols: number; rows: number }
  animationRows: Record<string, AnimationRow>
}

// ─── WindowPet 状态名 → SpiritPal 动画行名映射 ──────────────
const STATE_MAP: Record<string, string> = {
  stand: 'idle',
  idle: 'idle',
  walk: 'walk',
  sit: 'sit',
  greet: 'waving',
  jump: 'jumping',
  fall: 'failed',
  drag: 'waiting',
  crawl: 'running',
  climb: 'review',
  run: 'running',
  sleep: 'review', // 兜底
}

// ─── 工具函数 ────────────────────────────────────────────

/** 生成 [min, max] 范围内的随机浮点数（保留2位小数） */
function randRange(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100
}

/** 从 name 中提取可用的 ID（小写 + 短横线） */
function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** 根据性格五维猜测说话语调 */
function inferTone(p: Personality): 'gentle' | 'lively' | 'cold' | 'enthusiastic' {
  if (p.warmth > 0.4 && p.liveliness > 0.4) return 'enthusiastic'
  if (p.liveliness > 0.3) return 'lively'
  if (p.warmth > 0.3) return 'gentle'
  return 'cold'
}

/** 根据性格生成 systemPrompt */
function buildSystemPrompt(name: string, personality: Personality): string {
  const tone = inferTone(personality)
  const toneDesc: Record<string, string> = {
    gentle: '温柔细腻',
    lively: '活泼开朗',
    cold: '冷淡寡言',
    enthusiastic: '热情洋溢',
  }
  return [
    `你是${name}，一只生活在用户桌面上的小精灵。`,
    `你的性格：${toneDesc[tone]}，`,
    personality.warmth > 0.3 ? '喜欢亲近人，' : '有点独立，',
    personality.liveliness > 0.3 ? '精力充沛，' : '安静悠闲，',
    personality.dependence > 0.3 ? '依赖主人的陪伴。' : '自得其乐。',
    '用简短的句子和可爱的语气与主人交流。',
  ].join('')
}

/** 生成可爱的主题色 */
function randomThemeColor(): { primary: string; secondary: string } {
  const palettes = [
    { primary: '#FF6B9D', secondary: '#FFE66D' },
    { primary: '#4ECDC4', secondary: '#FF6B6B' },
    { primary: '#A8E6CF', secondary: '#FFD3B6' },
    { primary: '#6C5CE7', secondary: '#FDCB6E' },
    { primary: '#FD79A8', secondary: '#74B9FF' },
    { primary: '#00B894', secondary: '#FAB1A0' },
    { primary: '#E17055', secondary: '#81ECEC' },
    { primary: '#0984E3', secondary: '#FFEAA7' },
    { primary: '#D63031', secondary: '#DFE6E9' },
    { primary: '#6D5C7E', secondary: '#FFC0D3' },
  ]
  return palettes[Math.floor(Math.random() * palettes.length)]
}

/** 根据状态名生成气泡消息 */
function buildBubbleMessages(name: string): CharacterProfile['bubbleMessages'] {
  return {
    idle: [
      `${name}在发呆…`,
      '今天天气不错呢~',
      '有什么好玩的事吗？',
      '嗯…想休息一下…',
    ],
    hungry: [
      '肚子好饿…',
      '想吃东西…',
      '有没有零食呀？',
    ],
    sad: [
      '呜呜…',
      '有点难过…',
      '抱抱我…',
    ],
    pet: [
      '好舒服~',
      '嘿嘿，再摸摸~',
      '最喜欢被摸头了！',
    ],
    feed: [
      '好好吃！',
      '谢谢主人！',
      '吃饱了~',
    ],
    pomodoroDone: [
      '休息一下！',
      '辛苦啦~',
      '要不要休息一会儿？',
    ],
  }
}

// ─── 核心转换 ────────────────────────────────────────────

function convertConfig(config: WindowPetConfig): CharacterProfile {
  const id = nameToId(config.name)
  const personality: Personality = {
    warmth: randRange(-0.5, 0.8),
    liveliness: randRange(-0.5, 0.8),
    dependence: randRange(-0.5, 0.8),
    directness: randRange(-0.5, 0.8),
    rationality: randRange(-0.5, 0.8),
  }

  // 计算 atlas layout
  // WindowPet 的 frameSize 就是每格像素宽高
  const cellSize = config.frameSize ?? 128
  // 尝试从图片路径推断整图尺寸，否则用默认 8 列 × totalSpriteLine(或9) 行
  let cols = 8
  let rows = config.totalSpriteLine ?? 9
  if (config.width && config.height) {
    cols = Math.floor(config.width / cellSize)
    rows = Math.floor(config.height / cellSize)
  }

  // 构建 animationRows：映射 WindowPet states → SpiritPal 动画行
  const animationRows: Record<string, AnimationRow> = {}
  for (const [wpState, stateInfo] of Object.entries(config.states)) {
    const palName = STATE_MAP[wpState] ?? wpState
    // spriteLine 是 1-based → SpiritPal row 是 0-based
    const row = (stateInfo.spriteLine ?? 1) - 1
    const frames = stateInfo.frameMax ?? 1
    // 如果该 SpiritPal 动画行名尚未有映射，或当前映射帧数更多，则使用此映射
    if (!animationRows[palName] || animationRows[palName].frames < frames) {
      animationRows[palName] = { row, frames }
    }
  }

  // 确保至少有 idle 行
  if (!animationRows.idle) {
    animationRows.idle = { row: 0, frames: 1 }
  }

  // spriteAsset 路径：将 WindowPet 的相对路径转换到 SpiritPal 的资源路径
  // imageSrc 如 "media/Klee.png" → 保留文件名，放在 /pets/shimeji/ 下
  const spriteFileName = path.basename(config.imageSrc)

  const profile: CharacterProfile = {
    id,
    name: config.name,
    displayName: config.name,
    source: config.credit?.link ?? 'WindowPet',
    birthBackground: `${config.name}是从窗口边缘溜进你桌面的神秘小生物。`,
    emotionalCore: `作为${config.name}，渴望陪伴与冒险`,
    personality,
    signaturePhrase: `嘿！我是${config.name}~`,
    classicQuotes: [`${config.name}来啦！`, '今天也要元气满满！'],
    systemPrompt: buildSystemPrompt(config.name, personality),
    fewShotExamples: [
      { user: '你好呀！', assistant: `你好~我是${config.name}！` },
      { user: '你在干嘛？', assistant: '在桌面上溜达呢~' },
    ],
    spriteAsset: `/pets/shimeji/${spriteFileName}`,
    spriteType: 'atlas',
    themeColor: randomThemeColor(),
    bubbleMessages: buildBubbleMessages(config.name),
    atlasLayout: { cellW: cellSize, cellH: cellSize, cols, rows },
    animationRows,
  }

  return profile
}

// ─── 主流程 ──────────────────────────────────────────────

function main(): void {
  // 确保目录存在
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    console.log(`⚠ 配置目录不存在，已创建空目录: ${CONFIG_DIR}`)
    console.log('  请将 WindowPet 的 config JSON 文件放入该目录后重新运行。')
    return
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // 读取所有 JSON 配置
  const files = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.json'))

  if (files.length === 0) {
    console.log(`⚠ 配置目录中未找到 JSON 文件: ${CONFIG_DIR}`)
    console.log('  请将 WindowPet 的 config JSON 文件放入该目录后重新运行。')
    return
  }

  console.log(`找到 ${files.length} 个配置文件，开始转换…\n`)

  let success = 0
  let failed = 0

  for (const file of files) {
    const filePath = path.join(CONFIG_DIR, file)
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const config: WindowPetConfig = JSON.parse(raw)

      if (!config.name || !config.imageSrc || !config.states) {
        console.log(`⏭ 跳过 ${file}：缺少必要字段 (name/imageSrc/states)`)
        continue
      }

      const profile = convertConfig(config)
      const outName = `${profile.id}.json`
      const outPath = path.join(OUTPUT_DIR, outName)

      fs.writeFileSync(outPath, JSON.stringify(profile, null, 2), 'utf-8')
      console.log(`✅ ${file} → ${outName}  (${Object.keys(profile.animationRows).length} 个动画行)`)
      success++
    } catch (err) {
      console.error(`❌ 转换失败 ${file}:`, err instanceof Error ? err.message : err)
      failed++
    }
  }

  console.log(`\n转换完成：成功 ${success}，失败 ${failed}`)
}

main()
