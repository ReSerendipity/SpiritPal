// modDocGenerator 测试 — 输入 CharacterMod → 输出 README 章节与保存
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { describe, it, expect, vi } from 'vitest'
import { generateReadme, saveReadme, type ReadmeMeta } from '@/lib/data/modDocGenerator'
import { createModTemplate, type CharacterMod } from '@/lib/data/modManager'

vi.mock('@/lib/data/db', () => ({
  saveMod: vi.fn(() => Promise.resolve()),
  getMods: vi.fn(() => Promise.resolve([])),
  deleteMod: vi.fn(() => Promise.resolve()),
  updateModEnabled: vi.fn(() => Promise.resolve()),
}))

/** 构造一个内容完整的测试模组 */
function buildTestMod(): CharacterMod {
  const mod = createModTemplate()
  mod.petConf.id = 'demo-pet'
  mod.petConf.displayName = '测试小宠'
  mod.petConf.name = 'demopet'
  mod.petConf.source = '社区'
  mod.petConf.birthBackground = '来自云端的小精灵'
  mod.petConf.emotionalCore = '温柔且好奇'
  mod.petConf.signaturePhrase = '今天也要元气满满！'
  mod.actConf = {
    ...mod.actConf!,
    animations: [
      { state: 'idle', baseProb: 10, tier: 3, minAffectionLevel: 0, inPlaylist: true },
      { state: 'sleep', baseProb: 3, tier: 1, minAffectionLevel: 1, inPlaylist: false },
    ],
  }
  mod.itemsConf = {
    foods: [{ id: 'apple', name: '苹果', icon: 'a.png', type: 'food', price: 5 }],
    toys: [{ id: 'ball', name: '皮球', icon: 'b.png', type: 'toy', price: 12 }],
    medicines: [],
  }
  mod.dialogueConf.fewShotExamples = [
    { user: '你好', assistant: '你好呀！' },
    { user: '你是谁', assistant: '我是测试小宠～' },
    { user: '开心吗', assistant: '超开心！' },
    { user: '隐藏示例', assistant: '不应出现在 README 里' },
  ]
  return mod
}

const meta: ReadmeMeta = {
  version: '1.2.0',
  author: 'tester',
  description: '一个用于验证文档生成的模组',
  homepage: 'https://example.com/demo-pet',
  dependencies: [{ id: 'base-lib', version: '^1.0.0' }],
}

describe('generateReadme 章节完整性', () => {
  it('应包含全部规定章节', () => {
    const readme = generateReadme(buildTestMod(), meta)
    expect(readme).toContain('# 测试小宠')
    expect(readme).toContain('> 今天也要元气满满！')
    expect(readme).toContain('## 角色介绍')
    expect(readme).toContain('## 动画列表')
    expect(readme).toContain('## 物品列表')
    expect(readme).toContain('## 对话示例')
    expect(readme).toContain('## 安装说明')
    expect(readme).toContain('## 依赖信息')
  })

  it('角色介绍应包含名称/作者/版本/描述', () => {
    const readme = generateReadme(buildTestMod(), meta)
    expect(readme).toContain('**名称**：测试小宠')
    expect(readme).toContain('**作者**：tester')
    expect(readme).toContain('**版本**：1.2.0')
    expect(readme).toContain('**描述**：一个用于验证文档生成的模组')
    expect(readme).toContain('**模组 ID**：demo-pet')
  })

  it('动画列表应来自 act_conf 并渲染表格', () => {
    const readme = generateReadme(buildTestMod())
    expect(readme).toContain('| 状态 | 概率权重 | 活力档位 | 亲密度门槛 | 纳入播放列表 |')
    expect(readme).toContain('| idle | 10 | 活跃 | 0 | 是 |')
    expect(readme).toContain('| sleep | 3 | 低迷 | 1 | 否 |')
  })

  it('物品列表应按食物/玩具分类渲染', () => {
    const readme = generateReadme(buildTestMod())
    expect(readme).toContain('食物（1）')
    expect(readme).toContain('玩具（1）')
    expect(readme).toContain('苹果')
    expect(readme).toContain('皮球')
  })

  it('对话示例只取前 3 条', () => {
    const readme = generateReadme(buildTestMod())
    expect(readme).toContain('**示例 1**')
    expect(readme).toContain('**示例 3**')
    expect(readme).not.toContain('**示例 4**')
    expect(readme).toContain('你好呀！')
    expect(readme).not.toContain('不应出现在 README 里')
  })

  it('依赖信息应渲染依赖表格', () => {
    const readme = generateReadme(buildTestMod(), meta)
    expect(readme).toContain('| 依赖 ID | 版本约束 | 可选 |')
    expect(readme).toContain('| base-lib | ^1.0.0 | 否 |')
  })

  it('缺少可选元信息时应给出降级文案而非崩溃', () => {
    const readme = generateReadme(buildTestMod())
    expect(readme).toContain('**版本**：未指定')
    expect(readme).toContain('本模组无外部依赖。')
  })

  it('空物品/空对话时降级为占位说明', () => {
    const mod = buildTestMod()
    mod.itemsConf = { foods: [], toys: [], medicines: [] }
    mod.dialogueConf.fewShotExamples = []
    const readme = generateReadme(mod)
    expect(readme).toContain('本模组未配置专属物品。')
    expect(readme).toContain('本模组未提供对话示例。')
  })
})

describe('saveReadme', () => {
  it('应把生成内容写入指定路径', async () => {
    const mockWrite = vi.mocked(writeTextFile)
    mockWrite.mockClear()
    const mod = buildTestMod()
    await saveReadme(mod, '/mods/demo-pet/README.md', meta)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    const [path, content] = mockWrite.mock.calls[0] as [string, string]
    expect(path).toBe('/mods/demo-pet/README.md')
    expect(content).toContain('# 测试小宠')
    expect(content).toContain('## 安装说明')
  })
})
