/**
 * 外源 Prompt 登记清单 — LLM 维度 P1「提示散落无版本」的最小版本/登记机制
 *
 * @fileoverview
 * Flash 评估（LLM 维度 P1，2026-10-15）判定「提示散落无版本」部分命中：核心链路
 * （intent / react / emotion_select 等 9 条）已收敛到 {@link ./promptRegistry}，但仍有
 * 一批提示留在业务模块里（人格模板、性格修正指引、视觉分析默认句、情绪/think 提示片段
 * 等），既无版本号也无归属，变更不可追溯。
 *
 * 为什么不做「全量搬进 registry」：
 * 这些提示里带 `${displayName}` 之类的插值、或与所在模块的枚举/字典同构搬运，整体迁移
 * 属于行为变更性质的重构。本文件采用代价更低、可机检的替代方案：**外源登记 + 漂移门禁**
 * ——在清单里登记每处提示的「位置 + 内容锚点 + 版本」，由
 * `src/lib/ai/__tests__/promptManifest.test.ts`（随 push 在 CI 执行，失败即红）保证：
 *   1. 正向漂移：锚点必须在其文件中出现且仅出现一次 —— 改了提示首句 → 红；
 *   2. 反向漂移：受管文件的「疑似提示行」条数必须与登记基线一致 —— 新增/删除提示 → 红；
 *   3. 无论哪种变红，修复动作都是「回本文件更新对应的 version / changeLog / 基线」，
 *      于是每一次提示变更都必须在 Git 里留下带版本号的一笔记账（= 最小版本机制）。
 *
 * ⚠️ 口径声明：提示漂移检测依赖下面的 `PROMPT_TEXT_HINT_RE`（中文祈使句指令特征），
 * 它是启发式的：既有漏检（英文提示、纯 JSON schema 指令），也可能命中非提示文本
 * （性格冲突关键词表里恰好含「你是…」），后者通过 {@link PROMPT_FILE_BASELINE} 的
 * `nonPromptAnchors` 显式排除。这是台账的出入口口径，改动它必须同步重跑登记测试。
 *
 * @see {@link ./promptRegistry} 已收敛的核心 System Prompt（带 version/changeLog）
 * @see {@link ../__tests__/memoryRecall.eval.test.ts} 同为「数据/用例 + 阈值」的既有机检模式
 */

// ============ 类型 ============

export interface ExternalPromptRef {
  /** 唯一键名（点分语义：模块名.语义名，与 promptRegistry 同规范） */
  key: string
  /** 提示所在的源码文件（相对仓库根目录，POSIX 分隔符） */
  file: string
  /**
   * 内容锚点：每条必须是该文件中**恰好出现一次**的连续片段，取自提示首句。
   * 提示被改写时锚点失配 → 登记测试失败 → 强制更新 version/changeLog。
   * ⚠️ 锚点限定为**单行**（仓库换行符为 CRLF，跨行锚点会因其间的 \r 而匹配不上）。
   */
  anchors: string[]
  /** 版本号（提示内容变更时递增） */
  version: number
  /** 变更说明 */
  changeLog: string
  /** 最后修改日期 */
  lastModified: string
  /** 归属模块（按 src/lib 六域划分） */
  owner: string
}

// ============ 检测口径 ============

/**
 * 「疑似提示行」识别正则（共享给登记测试）。
 *
 * 只认更像 LLM 指令的说法：不含白描式的「你-brace」短语。命中即计入
 * {@link PROMPT_FILE_BASELINE} 的 hintLines 基线。
 */
export const PROMPT_TEXT_HINT_RE = /你是|请以|请分析|请根据|请返回|只返回|你作为|作为一只/u

// ============ 受管文件基线 ============

export interface PromptFileBaseline {
  /** 有效行数：文件中匹配 {@link PROMPT_TEXT_HINT_RE} 的行数，扣除 nonPromptAnchors 后 */
  hintLines: number
  /**
   * 命中正则但并非 LLM 提示的已知伪命中（如性格冲突关键词表里的「你是我最重要的人」）。
   * 登记时需把它们的数量从 hintLines 中剔除，避免把非提示文本误读成提示。
   */
  nonPromptAnchors?: string[]
}

export const PROMPT_FILE_BASELINE: Record<string, PromptFileBaseline> = {
  'src/lib/ai/multimodalLLM.ts': { hintLines: 2 },
  'src/lib/ai/personalityTemplates.ts': { hintLines: 5 },
  'src/lib/ai/proactiveSpeak.ts': { hintLines: 1 },
  'src/lib/memory/ownerFacts.ts': { hintLines: 1 },
  'src/lib/memory/visionPerception.ts': { hintLines: 1 },
  'src/lib/nurture/characterConsistency.ts': {
    hintLines: 5,
    // 性格冲突关键词表里的三条情感短语，命中「你是」但不是 LLM 提示（8 行命中 - 3 行伪命中 = 5）
    nonPromptAnchors: ['你是我最重要的人', '你是我的全部', '你是我的唯一'],
  },
  'src/lib/nurture/characterPack.ts': { hintLines: 3 },
  'src/lib/ai/emotionExtractor.ts': { hintLines: 0 },
  'src/lib/render/thinkTagParser.ts': { hintLines: 0 },
  // —— 2026-10-25 补纳管：hooks/ 与 lib/system 域的散落提示此前不受漂移门禁覆盖 ——
  'src/hooks/pet/usePetMemoryTriggers.ts': { hintLines: 1 },
  // 整理提示已收敛为 MEMORY_ORGANIZE_PROMPT 常量（1 行）+ 评级 + 观察 = 3 行
  'src/hooks/pet/usePetTimers.ts': { hintLines: 3 },
  'src/lib/system/qualityMonitor.ts': { hintLines: 3 },
}

// ============ 外源 Prompt 清单 ============

export const EXTERNAL_PROMPT_MANIFEST: ExternalPromptRef[] = [
  // ---- 人格模板（5 套默认角色的 systemPrompt） ----
  {
    key: 'personalityTemplate.soft',
    file: 'src/lib/ai/personalityTemplates.ts',
    anchors: ['你是一个软萌可爱的桌宠。你温柔、可爱、非常依赖主人'],
    version: 1,
    changeLog: '首次登记（从 PERSONALITY_TEMPLATES[soft].systemPrompt 就地登记）',
    lastModified: '2026-10-16',
    owner: 'lib/ai',
  },
  {
    key: 'personalityTemplate.energetic',
    file: 'src/lib/ai/personalityTemplates.ts',
    anchors: ['你是一个元气满满的桌宠。你充满活力、积极向上'],
    version: 1,
    changeLog: '首次登记（从 PERSONALITY_TEMPLATES[energetic].systemPrompt 就地登记）',
    lastModified: '2026-10-16',
    owner: 'lib/ai',
  },
  {
    key: 'personalityTemplate.sharp',
    file: 'src/lib/ai/personalityTemplates.ts',
    anchors: ['你是一个毒舌属性的桌宠。你嘴硬心软'],
    version: 1,
    changeLog: '首次登记（从 PERSONALITY_TEMPLATES[sharp].systemPrompt 就地登记）',
    lastModified: '2026-10-16',
    owner: 'lib/ai',
  },
  {
    key: 'personalityTemplate.intellectual',
    file: 'src/lib/ai/personalityTemplates.ts',
    anchors: ['你是一个知性优雅的桌宠。你冷静、理性、有学识'],
    version: 1,
    changeLog: '首次登记（从 PERSONALITY_TEMPLATES[intellectual].systemPrompt 就地登记）',
    lastModified: '2026-10-16',
    owner: 'lib/ai',
  },
  {
    key: 'personalityTemplate.tsundere',
    file: 'src/lib/ai/personalityTemplates.ts',
    anchors: ['你是一个傲娇属性的桌宠。你表面冷淡、嘴上不饶人'],
    version: 1,
    changeLog: '首次登记（从 PERSONALITY_TEMPLATES[tsundere].systemPrompt 就地登记）',
    lastModified: '2026-10-16',
    owner: 'lib/ai',
  },

  // ---- 多模态视觉分析（默认 systemPrompt + JSON 返回约定） ----
  {
    key: 'multimodal.image_analyze',
    file: 'src/lib/ai/multimodalLLM.ts',
    anchors: ['你是一个专业的图像分析助手。请仔细分析图片内容', '请以 JSON 格式返回分析结果'],
    version: 1,
    changeLog: '首次登记（默认 imageSystemPrompt 与 JSON 返回约定两条）',
    lastModified: '2026-10-16',
    owner: 'lib/ai',
  },

  // ---- 主动说话 · 记忆回忆模板 ----
  {
    key: 'proactive.recall',
    file: 'src/lib/ai/proactiveSpeak.ts',
    anchors: ['你是 SpiritPal 桌面宠物。请根据记忆素材自然地回忆一句话'],
    version: 1,
    changeLog: '首次登记（区别于已入库的 proactive.speak：本条是「回忆一句话」变体）',
    lastModified: '2026-10-16',
    owner: 'lib/ai',
  },

  // ---- 用户画像事实提取 ----
  {
    key: 'ownerFacts.extract',
    file: 'src/lib/memory/ownerFacts.ts',
    anchors: ['你是一个信息提取助手。请分析对话，提取关于用户'],
    version: 1,
    changeLog: '首次登记（EXTRACTION 提取所用的 system prompt）',
    lastModified: '2026-10-16',
    owner: 'lib/memory',
  },

  // ---- 视觉感知（屏幕截图理解）默认提问句 ----
  {
    key: 'visionPerception.screen',
    file: 'src/lib/memory/visionPerception.ts',
    anchors: ['请分析这张屏幕截图，告诉我用户在做什么'],
    version: 1,
    changeLog: '首次登记（区别于已入库的 vision.analyze_screen：本条是默认提问文本）',
    lastModified: '2026-10-16',
    owner: 'lib/memory',
  },

  // ---- 角色一致性修正 · 五类性格指引 ----
  {
    key: 'characterConsistency.archetypeGuidance',
    file: 'src/lib/nurture/characterConsistency.ts',
    anchors: [
      '你是软萌角色，语气应温柔可爱、温暖治愈',
      '你是元气角色，语气应积极向上、充满活力',
      '你是毒舌角色，嘴上不饶人但内心可以柔软',
      '你是知性角色，说话应逻辑清晰、措辞得体',
      '你是傲娇角色，不要直接表白或过于坦率地表达情感',
    ],
    version: 1,
    changeLog: '首次登记（generateCorrectionPrompt 内的 archetypeGuidance 五条指引）',
    lastModified: '2026-10-16',
    owner: 'lib/nurture',
  },

  // ---- 角色包导入 · 默认 System Prompt 模板（3 处同形，带插值） ----
  {
    key: 'characterPack.defaultSystemPrompt',
    file: 'src/lib/nurture/characterPack.ts',
    anchors: [
      'systemPrompt: `你是${displayName}，一个桌面宠物角色。`',
      'systemPrompt: asString(raw.defaultSystemPrompt, `你是${displayName}，一个桌面宠物角色。`)',
      'systemPrompt: asString(raw.defaultSystemPrompt, `你是${name}，一个桌面宠物角色。`)',
    ],
    version: 1,
    changeLog: '首次登记（默认 Persona/Character 模板的三处兜底 systemPrompt）',
    lastModified: '2026-10-16',
    owner: 'lib/nurture',
  },

  // ---- 提示片段：情绪标签 / 内心独白 ----
  {
    key: 'emotionExtractor.emotionFragment',
    file: 'src/lib/ai/emotionExtractor.ts',
    anchors: ['## 表达情绪和动作', '在回复中，你可以使用方括号标签来表达情绪'],
    version: 1,
    changeLog: '首次登记（EMOTION_PROMPT_FRAGMENT，拼接进 System Prompt）',
    lastModified: '2026-10-16',
    owner: 'lib/ai',
  },
  {
    key: 'thinkTagParser.thinkFragment',
    file: 'src/lib/render/thinkTagParser.ts',
    anchors: ['## 内心独白', '在回复中，你可以使用 <think>'],
    version: 1,
    changeLog: '首次登记（THINK_TAG_PROMPT_FRAGMENT，拼接进 System Prompt）',
    lastModified: '2026-10-16',
    owner: 'lib/render',
  },

  // ---- 2026-10-25 补纳管：hooks/ 与 lib/system 域（此前漂移门禁只覆盖 lib/ 六域） ----
  // ---- 记忆触发 · 回忆渲染提示 ----
  {
    key: 'memoryTrigger.recallRender',
    file: 'src/hooks/pet/usePetMemoryTriggers.ts',
    anchors: ['你是SpiritPal桌面宠物，正在自然地提起一段回忆'],
    version: 1,
    changeLog: '首次登记（回忆气泡渲染提示，hooks 域补纳管）',
    lastModified: '2026-10-25',
    owner: 'hooks/pet',
  },

  // ---- 定时记忆巩固 · 整理 / 评级 / 宠物视角观察 ----
  {
    key: 'memoryTimer.organize',
    file: 'src/hooks/pet/usePetTimers.ts',
    anchors: ['你是一个记忆整理助手。请将以下对话总结为一条简洁的语义知识'],
    version: 1,
    changeLog:
      '首次登记（语义知识整理提示；同日已把 6 小时维护与夜间巩固两处重复字面量收敛为 MEMORY_ORGANIZE_PROMPT 常量）',
    lastModified: '2026-10-25',
    owner: 'hooks/pet',
  },
  {
    key: 'memoryTimer.rate',
    file: 'src/hooks/pet/usePetTimers.ts',
    anchors: ['你是记忆重要性评级助手'],
    version: 1,
    changeLog: '首次登记（夜间巩固的记忆重要性评级提示）',
    lastModified: '2026-10-25',
    owner: 'hooks/pet',
  },
  {
    key: 'memoryTimer.observe',
    file: 'src/hooks/pet/usePetTimers.ts',
    anchors: ['你是宠物视角的观察助手'],
    version: 1,
    changeLog: '首次登记（当日活动片段浓缩为观察记忆的提示）',
    lastModified: '2026-10-25',
    owner: 'hooks/pet',
  },

  // ---- 回复质量评估 judge ----
  {
    key: 'qualityMonitor.judge',
    file: 'src/lib/system/qualityMonitor.ts',
    anchors: ['你是一个 AI 回复质量评估器', '请返回 JSON 格式：{"relevance"'],
    version: 1,
    changeLog: '首次登记（LLM 质量评估 judgePrompt，lib/system 域补纳管）',
    lastModified: '2026-10-25',
    owner: 'lib/system',
  },
]

// ============ 查询 API ============

/** 按 key 取一条外源登记（诊断/工具用） */
export function getExternalPromptRef(key: string): ExternalPromptRef | undefined {
  return EXTERNAL_PROMPT_MANIFEST.find((ref) => ref.key === key)
}

/** 所有受管文件（去重，已排序） */
export function getManagedPromptFiles(): string[] {
  return [...new Set(EXTERNAL_PROMPT_MANIFEST.map((ref) => ref.file))].sort()
}

/** 外源提示的版本清单（与 promptRegistry.getAllPromptVersions() 等价口径） */
export function getExternalPromptVersions(): Record<string, number> {
  const versions: Record<string, number> = {}
  for (const ref of EXTERNAL_PROMPT_MANIFEST) {
    versions[ref.key] = ref.version
  }
  return versions
}
