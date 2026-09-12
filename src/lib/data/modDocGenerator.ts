/**
 * Mod 文档生成器模块
 *
 * @fileoverview 从 CharacterMod 数据结构生成规范的 README.md 文档
 *
 * 主要模块：
 * - ReadmeMeta: 清单级元信息（版本/作者/依赖等，CharacterMod 本身不含）
 * - generateReadme(): 生成 README.md 字符串
 * - saveReadme(): 将 README 写入磁盘
 *
 * 依赖关系：
 * - modManager.ts: CharacterMod / PetConfJSON / ModDependency 类型
 * - @tauri-apps/plugin-fs: writeTextFile 保存文件
 *
 * 生成的 README 章节：
 * 1. 标题与一句话简介（signaturePhrase）
 * 2. 角色介绍（名称/作者/版本/描述/来源）
 * 3. 性格概览（五维性格）
 * 4. 动画列表（act_conf.animations）
 * 5. 物品列表（items_conf 食物/玩具/药品）
 * 6. 对话示例（dialogue_conf.fewShotExamples 前 3 条）
 * 7. 安装说明（如何导入 .petmod）
 * 8. 依赖信息
 */

import { writeTextFile } from '@tauri-apps/plugin-fs'
import type { CharacterMod, ModDependency } from './modManager'

// ============ 类型定义 ============

/** README 补充元信息（CharacterMod 本身不含版本/作者/依赖，由 manifest 侧提供） */
export interface ReadmeMeta {
  /** 模组版本号（SemVer） */
  version?: string
  /** 作者 */
  author?: string
  /** 描述（缺省时使用 petConf.emotionalCore） */
  description?: string
  /** 主页/仓库 URL */
  homepage?: string
  /** 依赖声明 */
  dependencies?: ModDependency[]
}

/** 对话示例最大条数 */
const DIALOGUE_EXAMPLE_LIMIT = 3

// ============ 内部格式化工具 ============

/** 性格五维 → 中文标签 */
const PERSONALITY_LABELS: Record<string, string> = {
  warmth: '热情度',
  liveliness: '活泼度',
  dependence: '依赖度',
  directness: '直率度',
  rationality: '理性度',
}

/** 活力档位 → 中文标签 */
const TIER_LABELS: Record<number, string> = {
  3: '活跃',
  2: '平稳',
  1: '低迷',
  0: '濒危',
}

/** 物品分类 → 中文标签 */
const ITEM_CATEGORY_LABELS: Array<{ key: 'foods' | 'toys' | 'medicines'; label: string }> = [
  { key: 'foods', label: '食物' },
  { key: 'toys', label: '玩具' },
  { key: 'medicines', label: '药品' },
]

/** 转义 Markdown 表格单元格中的竖线 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/** 生成动画列表明文 */
function formatAnimations(mod: CharacterMod): string {
  const animations = mod.actConf?.animations ?? []
  if (animations.length === 0) {
    return '_本模组未自定义动画，将使用默认动画配置。_\n'
  }
  const lines: string[] = [
    '| 状态 | 概率权重 | 活力档位 | 亲密度门槛 | 纳入播放列表 |',
    '| ---- | -------- | -------- | ---------- | ------------ |',
  ]
  for (const anim of animations) {
    lines.push(
      `| ${escapeCell(String(anim.state))} | ${anim.baseProb} | ${TIER_LABELS[anim.tier] ?? anim.tier} | ${anim.minAffectionLevel} | ${anim.inPlaylist ? '是' : '否'} |`,
    )
  }
  return lines.join('\n') + '\n'
}

/** 生成物品列表明文 */
function formatItems(mod: CharacterMod): string {
  const itemsConf = mod.itemsConf
  if (!itemsConf) {
    return '_本模组未配置专属物品。_\n'
  }
  const sections: string[] = []
  let total = 0
  for (const { key, label } of ITEM_CATEGORY_LABELS) {
    const list = itemsConf[key] ?? []
    total += list.length
    if (list.length === 0) continue
    const lines: string[] = [`**${label}（${list.length}）**`, '', '| 名称 | 类型 | 价格 |', '| ---- | ---- | ---- |']
    for (const item of list) {
      lines.push(`| ${escapeCell(item.name)} | ${escapeCell(item.type)} | ${item.price} |`)
    }
    sections.push(lines.join('\n'))
  }
  if (total === 0) {
    return '_本模组未配置专属物品。_\n'
  }
  return sections.join('\n\n') + '\n'
}

/** 生成对话示例（取前 3 条） */
function formatDialogueExamples(mod: CharacterMod): string {
  const examples = mod.dialogueConf.fewShotExamples ?? []
  const picked = examples.slice(0, DIALOGUE_EXAMPLE_LIMIT)
  if (picked.length === 0) {
    return '_本模组未提供对话示例。_\n'
  }
  const blocks: string[] = []
  picked.forEach((ex, i) => {
    blocks.push(`**示例 ${i + 1}**\n\n- 主人：${ex.user}\n- ${mod.petConf.displayName}：${ex.assistant}`)
  })
  return blocks.join('\n\n') + '\n'
}

/** 生成依赖信息段 */
function formatDependencies(dependencies: ModDependency[] | undefined): string {
  if (!dependencies || dependencies.length === 0) {
    return '本模组无外部依赖。\n'
  }
  const lines: string[] = ['| 依赖 ID | 版本约束 | 可选 |', '| ------- | -------- | ---- |']
  for (const dep of dependencies) {
    lines.push(`| ${escapeCell(dep.id)} | ${escapeCell(dep.version)} | ${dep.optional ? '是' : '否'} |`)
  }
  return lines.join('\n') + '\n'
}

/** 性格五维概览 */
function formatPersonality(mod: CharacterMod): string {
  const p = mod.petConf.personality
  const entries = Object.entries(PERSONALITY_LABELS)
    .filter(([key]) => typeof (p as unknown as Record<string, unknown>)[key] === 'number')
    .map(([key, label]) => `- ${label}：${String((p as unknown as Record<string, number>)[key])}`)
  if (entries.length === 0) return ''
  return entries.join('\n') + '\n'
}

// ============ 主接口 ============

/**
 * 从 CharacterMod 生成 README.md 内容
 * @param mod 模组数据（三层配置）
 * @param meta 清单级元信息（版本/作者/依赖等），可选
 */
export function generateReadme(mod: CharacterMod, meta?: ReadmeMeta): string {
  const { petConf } = mod
  const displayName = petConf.displayName || petConf.name || petConf.id
  const lines: string[] = []

  // 1. 标题与一句话简介
  lines.push(`# ${displayName}`, '')
  if (petConf.signaturePhrase) {
    lines.push(`> ${petConf.signaturePhrase}`, '')
  }

  // 2. 角色介绍
  lines.push('## 角色介绍', '')
  lines.push(`- **名称**：${displayName}`)
  lines.push(`- **模组 ID**：${petConf.id}`)
  if (meta?.author) lines.push(`- **作者**：${meta.author}`)
  lines.push(`- **版本**：${meta?.version ?? '未指定'}`)
  lines.push(`- **来源**：${petConf.source || '自定义'}`)
  const description = meta?.description || petConf.emotionalCore || '（暂无描述）'
  lines.push(`- **描述**：${description}`)
  if (meta?.homepage) lines.push(`- **主页**：${meta.homepage}`)
  lines.push('')
  if (petConf.birthBackground) {
    lines.push(`**背景故事**：${petConf.birthBackground}`, '')
  }

  // 3. 性格概览
  const personality = formatPersonality(mod)
  if (personality) {
    lines.push('## 性格概览', '', personality)
  }

  // 4. 动画列表
  lines.push('## 动画列表', '', formatAnimations(mod))

  // 5. 物品列表
  lines.push('## 物品列表', '', formatItems(mod))

  // 6. 对话示例（前 3 条）
  lines.push('## 对话示例', '', formatDialogueExamples(mod))

  // 7. 安装说明
  lines.push(
    '## 安装说明',
    '',
    '1. 打开 SpiritPal 设置中的「模组管理」面板。',
    '2. 点击「导入 .petmod 文件」，选择下载好的 `' + `${petConf.id}-*.petmod` + '` 文件。',
    '3. 等待导入完成，模组将自动启用并出现在已安装列表中。',
    '4. 如需卸载，在模组管理面板点击对应模组的卸载按钮即可。',
    '',
  )

  // 8. 依赖信息
  lines.push('## 依赖信息', '', formatDependencies(meta?.dependencies))

  return lines.join('\n')
}

/**
 * 生成 README 并保存到指定路径
 * @param mod 模组数据
 * @param outputPath 目标文件路径（建议 xxx/README.md）
 * @param meta 清单级元信息，可选
 */
export async function saveReadme(
  mod: CharacterMod,
  outputPath: string,
  meta?: ReadmeMeta,
): Promise<void> {
  const content = generateReadme(mod, meta)
  await writeTextFile(outputPath, content)
}
