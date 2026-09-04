/**
 * Live2D参数自动映射模块
 *
 * @fileoverview Live2D模型参数名的模糊匹配与标准参数ID自动映射（参考Live2DPet）
 *
 * 主要模块：
 * - StandardParamId: 标准参数ID枚举（brow_up/eye_open/mouth_open/head_tilt等）
 * - ParamMappingEntry: 参数映射条目类型
 * - PARAM_FUZZY_MAP: 模糊匹配映射表
 * - ParamAutoMapper: 参数自动映射器主类
 *
 * 依赖关系：
 * - 无外部依赖（纯字符串匹配与映射逻辑）
 *
 * 核心接口：
 * - autoMapParams(): 根据模型原始参数列表自动生成映射
 * - matchParam(): 单个参数名模糊匹配
 * - getParamAutoMapper(): 获取单例映射器实例
 *
 * 核心功能：
 * 1. 模糊匹配：支持多种命名风格（Cubism标准/VPet/自定义/日文）
 * 2. 大小写不敏感：ParamBrowLY/parambrowly/BROW_L_Y均能匹配
 * 3. 别名解析：支持同义参数名映射（如mouth_open/smile/open_mouth）
 * 4. 自动发现：模型加载时自动扫描参数并创建映射
 * 5. 配置覆盖：支持用户手动调整映射关系
 *
 * 映射示例：
 * - ParamBrowLY → brow_up（左眉上抬）
 * - ParamMouthOpenY → mouth_open（嘴巴张开）
 * - ParamAngleX → head_tilt_y（头部水平旋转）
 */

// ============ 参数映射定义 ============

/** 标准参数 ID */
export type StandardParamId =
  | 'brow_up' | 'brow_down' | 'brow_angry'
  | 'eye_open' | 'eye_close' | 'eye_happy' | 'eye_wide'
  | 'mouth_open' | 'mouth_smile' | 'mouth_angry' | 'mouth_surprised'
  | 'head_tilt_x' | 'head_tilt_y' | 'head_tilt_z'
  | 'body_breath' | 'body_bounce'
  | 'arm_left' | 'arm_right'
  | 'hair_swing' | 'ear_wiggle'
  | 'tail_wag' | 'wing_flap'

/** 参数映射条目 */
export interface ParamMappingEntry {
  /** 标准参数 ID */
  standardId: StandardParamId
  /** 模型中的原始参数名 */
  originalName: string
  /** 参数值范围 */
  valueRange: { min: number; max: number }
  /** 默认值 */
  defaultValue: number
  /** 是否反向（模型参数值方向与标准方向相反） */
  inverted: boolean
}

// ============ 模糊匹配映射表 ============

/**
 * PARAM_FUZZY_MAP — 模型参数名 → 标准参数 ID 的模糊匹配
 *
 * 支持多种命名风格：
 * - Live2D Cubism 标准: ParamBrowLY, ParamMouthOpenY, ParamAngleX, ...
 * - VPet 风格: brow_L_Y, mouth_open_Y, angle_X, ...
 * - 自定义风格: browLeftY, mouthOpen, headTilt, ...
 * - 日式风格: 眉毛, 口, 角度, ...
 */
export const PARAM_FUZZY_MAP: Record<string, StandardParamId> = {
  // ===== 眉毛 =====
  'parambrowly': 'brow_up',
  'parambrowry': 'brow_up',
  'parambrowl_y': 'brow_up',
  'parambrowr_y': 'brow_up',
  'brow_ly': 'brow_up',
  'brow_ry': 'brow_up',
  'browlefty': 'brow_up',
  'browrighty': 'brow_up',
  'browup': 'brow_up',
  'brow_raise': 'brow_up',
  '眉毛上': 'brow_up',

  'parambrowl_y_down': 'brow_down',
  'parambrowr_y_down': 'brow_down',
  'brow_down': 'brow_down',
  'browlower': 'brow_down',
  'brow_frown': 'brow_down',
  '眉毛下': 'brow_down',

  'parambrowangry': 'brow_angry',
  'brow_angry': 'brow_angry',
  'browangry': 'brow_angry',
  '眉毛怒': 'brow_angry',

  // ===== 眼睛 =====
  'parameyely': 'eye_open',
  'parameyery': 'eye_open',
  'parameyel_y': 'eye_open',
  'parameyer_y': 'eye_open',
  'eye_ly': 'eye_open',
  'eye_ry': 'eye_open',
  'eyelefty': 'eye_open',
  'eyerighty': 'eye_open',
  'eyeopen': 'eye_open',
  'eye_open': 'eye_open',
  'eye_blink': 'eye_close',
  'eyeblink': 'eye_close',
  'parameyeblink': 'eye_close',
  'eyeclose': 'eye_close',
  'eye_close': 'eye_close',
  '眨眼': 'eye_close',

  'parameyehappy': 'eye_happy',
  'eyehappy': 'eye_happy',
  'eye_happy': 'eye_happy',
  'eye_smile': 'eye_happy',

  'parameyewide': 'eye_wide',
  'eyewide': 'eye_wide',
  'eye_wide': 'eye_wide',

  // ===== 嘴巴 =====
  'parammouthopeny': 'mouth_open',
  'mouthopeny': 'mouth_open',
  'mouth_open_y': 'mouth_open',
  'mouthopen': 'mouth_open',
  'mouth_open': 'mouth_open',
  '口开': 'mouth_open',

  'parammouthsmile': 'mouth_smile',
  'mouthsmile': 'mouth_smile',
  'mouth_smile': 'mouth_smile',
  'mouthhappy': 'mouth_smile',
  '口笑': 'mouth_smile',

  'parammouthangry': 'mouth_angry',
  'mouthangry': 'mouth_angry',
  'mouth_angry': 'mouth_angry',
  '口怒': 'mouth_angry',

  'parammouthsurprised': 'mouth_surprised',
  'mouthsurprised': 'mouth_surprised',
  'mouth_surprised': 'mouth_surprised',
  'mouthwow': 'mouth_surprised',
  '口惊': 'mouth_surprised',

  // ===== 头部 =====
  'paramanglex': 'head_tilt_x',
  'paramangley': 'head_tilt_y',
  'paramanglez': 'head_tilt_z',
  'angle_x': 'head_tilt_x',
  'angle_y': 'head_tilt_y',
  'angle_z': 'head_tilt_z',
  'anglex': 'head_tilt_x',
  'angley': 'head_tilt_y',
  'anglez': 'head_tilt_z',
  'headtiltx': 'head_tilt_x',
  'headtilty': 'head_tilt_y',
  'headtiltz': 'head_tilt_z',
  '头x': 'head_tilt_x',
  '头y': 'head_tilt_y',
  '头z': 'head_tilt_z',

  // ===== 身体 =====
  'parambreath': 'body_breath',
  'breath': 'body_breath',
  'body_breath': 'body_breath',
  'breathing': 'body_breath',
  '呼吸': 'body_breath',

  'parambodyanglez': 'body_bounce',
  'bodyanglez': 'body_bounce',
  'body_bounce': 'body_bounce',
  'bodyangle': 'body_bounce',

  // ===== 手臂 =====
  'paramarmly': 'arm_left',
  'paramarmry': 'arm_right',
  'arm_ly': 'arm_left',
  'arm_ry': 'arm_right',
  'armlefty': 'arm_left',
  'armrighty': 'arm_right',

  // ===== 头发/装饰 =====
  'paramhairswing': 'hair_swing',
  'hairswing': 'hair_swing',
  'hair_swing': 'hair_swing',
  '头发': 'hair_swing',

  'paramearwiggle': 'ear_wiggle',
  'earwiggle': 'ear_wiggle',
  'ear_wiggle': 'ear_wiggle',

  'paramtailwag': 'tail_wag',
  'tailwag': 'tail_wag',
  'tail_wag': 'tail_wag',
  '尾巴': 'tail_wag',

  'paramwingflap': 'wing_flap',
  'wingflap': 'wing_flap',
  'wing_flap': 'wing_flap',
}

// ============ 参数自动映射器 ============

/** 映射结果 */
export interface MappingResult {
  /** 标准参数 ID */
  standardId: StandardParamId
  /** 原始参数名 */
  originalName: string
  /** 匹配置信度 (0-1) */
  confidence: number
  /** 匹配方式 */
  matchMethod: 'exact' | 'fuzzy' | 'pattern' | 'none'
}

/**
 * 参数自动映射器
 * 自动发现模型参数并建立映射关系
 */
export class ParamAutoMapper {
  /** 已发现的模型参数列表 */
  private discoveredParams: string[] = []

  /** 已建立的映射 */
  private mappings = new Map<string, ParamMappingEntry>()

  /** 自定义覆盖映射 */
  private overrides = new Map<string, StandardParamId>()

  /** 未映射的参数 */
  private unmapped: string[] = []

  // ============ 参数发现 ============

  /**
   * 自动发现模型参数
   * @param paramNames 模型参数名列表
   */
  autoDiscover(paramNames: string[]): void {
    this.discoveredParams = [...paramNames]
    this.mappings.clear()
    this.unmapped = []

    for (const name of paramNames) {
      const result = this.mapParam(name)
      if (result.matchMethod !== 'none') {
        this.mappings.set(name, {
          standardId: result.standardId,
          originalName: name,
          valueRange: this.inferValueRange(name),
          defaultValue: 0,
          inverted: this.isInverted(name),
        })
      } else {
        this.unmapped.push(name)
      }
    }
  }

  // ============ 参数映射 ============

  /**
   * 映射单个参数名到标准 ID
   *
   * 匹配优先级：
   * 1. 自定义覆盖
   * 2. 精确匹配（FUZZY_MAP 中直接找到）
   * 3. 模糊匹配（大小写不敏感 + 去除下划线）
   * 4. 模式匹配（正则表达式提取关键字）
   *
   * @param paramName 模型参数名
   * @returns 映射结果
   */
  mapParam(paramName: string): MappingResult {
    // 1. 自定义覆盖
    const override = this.overrides.get(paramName)
    if (override) {
      return {
        standardId: override,
        originalName: paramName,
        confidence: 1.0,
        matchMethod: 'exact',
      }
    }

    // 2. 精确匹配
    const normalized = paramName.toLowerCase().replace(/[_\s-]/g, '')
    const exactMatch = PARAM_FUZZY_MAP[normalized]
    if (exactMatch) {
      return {
        standardId: exactMatch,
        originalName: paramName,
        confidence: 1.0,
        matchMethod: 'exact',
      }
    }

    // 3. 模糊匹配 — 尝试各种归一化形式
    const fuzzyResults = this.fuzzyMatch(normalized)
    if (fuzzyResults) {
      return fuzzyResults
    }

    // 4. 模式匹配 — 基于关键字提取
    const patternResult = this.patternMatch(paramName)
    if (patternResult) {
      return patternResult
    }

    return {
      standardId: 'brow_up' as StandardParamId, // 不应使用，仅类型安全
      originalName: paramName,
      confidence: 0,
      matchMethod: 'none',
    }
  }

  // ============ 模糊匹配 ============

  private fuzzyMatch(normalized: string): MappingResult | null {
    // 遍历 FUZZY_MAP 查找最接近的匹配
    let bestMatch: { standardId: StandardParamId; score: number } | null = null

    for (const [pattern, standardId] of Object.entries(PARAM_FUZZY_MAP)) {
      const score = this.similarityScore(normalized, pattern)
      if (score > 0.6 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { standardId, score }
      }
    }

    if (bestMatch) {
      return {
        standardId: bestMatch.standardId,
        originalName: normalized,
        confidence: bestMatch.score,
        matchMethod: 'fuzzy',
      }
    }

    return null
  }

  /** 计算字符串相似度（简单的 n-gram 匹配） */
  private similarityScore(a: string, b: string): number {
    if (a === b) return 1.0
    if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0

    // 检查包含关系
    if (a.includes(b) || b.includes(a)) {
      return Math.min(a.length, b.length) / Math.max(a.length, b.length)
    }

    // 2-gram Jaccard 相似度
    const bigramsA = new Set<string>()
    const bigramsB = new Set<string>()
    for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2))
    for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2))

    let intersection = 0
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++
    }

    return intersection / (bigramsA.size + bigramsB.size - intersection)
  }

  // ============ 模式匹配 ============

  private patternMatch(paramName: string): MappingResult | null {
    const lower = paramName.toLowerCase()

    // 关键字模式匹配
    const patterns: Array<{ regex: RegExp; standardId: StandardParamId; confidence: number }> = [
      { regex: /brow|眉/, standardId: 'brow_up', confidence: 0.5 },
      { regex: /eye|眼|blink|眨/, standardId: 'eye_open', confidence: 0.5 },
      { regex: /mouth|口|lip/, standardId: 'mouth_open', confidence: 0.5 },
      { regex: /angle|tilt|旋转|头/, standardId: 'head_tilt_x', confidence: 0.4 },
      { regex: /breath|呼吸/, standardId: 'body_breath', confidence: 0.5 },
      { regex: /arm|手|腕/, standardId: 'arm_left', confidence: 0.4 },
      { regex: /hair|发/, standardId: 'hair_swing', confidence: 0.5 },
    ]

    for (const { regex, standardId, confidence } of patterns) {
      if (regex.test(lower)) {
        return {
          standardId,
          originalName: paramName,
          confidence,
          matchMethod: 'pattern',
        }
      }
    }

    return null
  }

  // ============ 辅助方法 ============

  /** 推断参数值范围 */
  private inferValueRange(paramName: string): { min: number; max: number } {
    const lower = paramName.toLowerCase()
    // 角度类参数通常 -30 到 30
    if (lower.includes('angle')) return { min: -30, max: 30 }
    // 百分比类参数通常 0 到 1
    if (lower.includes('y') || lower.includes('open')) return { min: 0, max: 1 }
    // 默认 -1 到 1
    return { min: -1, max: 1 }
  }

  /** 判断参数是否需要反转 */
  private isInverted(paramName: string): boolean {
    const lower = paramName.toLowerCase()
    // 向下的参数需要反转
    return lower.includes('down') || lower.includes('close') || lower.includes('lower')
  }

  // ============ 配置覆盖 ============

  /** 设置自定义参数映射 */
  setOverride(paramName: string, standardId: StandardParamId): void {
    this.overrides.set(paramName, standardId)
    // 如果已有映射，更新它
    if (this.mappings.has(paramName)) {
      const existing = this.mappings.get(paramName)!
      this.mappings.set(paramName, { ...existing, standardId })
    }
    // 从未映射列表中移除
    this.unmapped = this.unmapped.filter((p) => p !== paramName)
  }

  /** 移除自定义参数映射 */
  removeOverride(paramName: string): void {
    this.overrides.delete(paramName)
  }

  // ============ 查询 ============

  /** 获取映射条目 */
  getMapping(paramName: string): ParamMappingEntry | undefined {
    return this.mappings.get(paramName)
  }

  /** 获取所有映射 */
  getAllMappings(): Map<string, ParamMappingEntry> {
    return new Map(this.mappings)
  }

  /** 获取未映射的参数列表 */
  getUnmappedParams(): string[] {
    return [...this.unmapped]
  }

  /** 获取已发现的参数数量 */
  get discoveredCount(): number {
    return this.discoveredParams.length
  }

  /** 获取已映射的参数数量 */
  get mappedCount(): number {
    return this.mappings.size
  }

  /** 获取映射覆盖率 */
  get coverage(): number {
    if (this.discoveredParams.length === 0) return 0
    return this.mappings.size / this.discoveredParams.length
  }

  /** 获取映射统计信息 */
  getStats(): {
    total: number
    mapped: number
    unmapped: number
    coverage: number
    byMethod: Record<string, number>
  } {
    const byMethod: Record<string, number> = { exact: 0, fuzzy: 0, pattern: 0 }
    for (const [, entry] of this.mappings) {
      const result = this.mapParam(entry.originalName)
      byMethod[result.matchMethod] = (byMethod[result.matchMethod] ?? 0) + 1
    }

    return {
      total: this.discoveredParams.length,
      mapped: this.mappings.size,
      unmapped: this.unmapped.length,
      coverage: this.coverage,
      byMethod,
    }
  }

  /** 重置映射器 */
  reset(): void {
    this.discoveredParams = []
    this.mappings.clear()
    this.overrides.clear()
    this.unmapped = []
  }
}

// ============ 单例 ============

let paramAutoMapper: ParamAutoMapper | null = null

/** 获取参数自动映射器单例 */
export function getParamAutoMapper(): ParamAutoMapper {
  if (!paramAutoMapper) {
    paramAutoMapper = new ParamAutoMapper()
  }
  return paramAutoMapper
}

/** 重置参数自动映射器 */
export function resetParamAutoMapper(): void {
  if (paramAutoMapper) {
    paramAutoMapper.reset()
    paramAutoMapper = null
  }
}
