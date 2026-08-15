/**
 * 动画状态机配置 — ≥50 种动画状态 + 基于 HP/心情/交互/时间/环境的自动切换
 * PRD §3.2 每个角色内置 ≥50 种动画状态，动画状态机根据 HP/心情/交互/时间自动切换
 *
 * @fileoverview
 * 主要模块：
 * - AnimationId 类型：56 种动画 ID（基础10/情绪12/交互10/养成8/环境6/编码6/特殊4）
 * - AnimationCategory 类型：7 种动画分类
 * - AnimationDef 接口：动画定义结构（触发条件、优先级、时长、渲染映射）
 * - ANIMATION_CATALOG：56 种动画完整目录
 * - CODING_REACTION_TO_PETSTATE/MOTION：编码反应映射表
 * - selectAnimation()：按优先级选择当前应该播放的动画
 *
 * 设计：
 * - 50+ 种动画按 7 个类别组织（基础/情绪/交互/养成/环境/编码/特殊）
 * - 每种动画定义触发条件、优先级、时长、渲染映射（精灵图 PetState + Live2D motion group）
 * - 状态机按优先级选择动画，相同动画 30 秒冷却
 * - 渲染层复用现有 SpriteRenderer（9 行精灵图）与 Live2DRenderer（motion group）
 *
 * @module animationConfig
 * @requires ./types - PetState 类型定义
 * @requires ./weatherAwareness - WeatherAction 天气类型
 * @requires ./contextAwareness - WorkState 工作上下文类型
 */

import type { PetState } from './types'
import type { WeatherAction } from './weatherAwareness'
import type { WorkState } from './contextAwareness'

// ============ 动画 ID（50 种）============

// 基础状态（10 种）
type BasicAnim =
  | 'idle' | 'breathing' | 'blink' | 'sleep' | 'drowsy'
  | 'awake' | 'sit' | 'stand' | 'lie_down' | 'stretch'

// 情绪表现（12 种）
type EmotionAnim =
  | 'happy' | 'excited' | 'laugh' | 'giggle' | 'sad' | 'cry'
  | 'angry' | 'annoyed' | 'surprised' | 'confused' | 'shy' | 'embarrassed'

// 交互响应（10 种）
type InteractionAnim =
  | 'pet_head' | 'being_held' | 'feed' | 'eat' | 'drink'
  | 'play' | 'hug' | 'poke' | 'drag' | 'drop'

// 养成相关（8 种）
type NurtureAnim =
  | 'sick' | 'recovering' | 'level_up' | 'hungry_starving'
  | 'full_satisfied' | 'bath' | 'clean' | 'dirty'

// 环境感知（6 种）
type EnvironmentAnim =
  | 'rain_umbrella' | 'hot_fanning' | 'cold_shivering'
  | 'sunny_happy' | 'music_sway' | 'coding_companion'

// 编码反应（6 种）— 参考 OpenPets allowedReactions 扩展
// 编程陪伴模式专用，映射到精灵图扩展行
type CodingAnim =
  | 'thinking' | 'editing' | 'testing' | 'success' | 'error' | 'celebrating'

// 特殊/稀有（4 种）
type SpecialAnim = 'anniversary' | 'birthday' | 'dream' | 'daydream'

export type AnimationId =
  | BasicAnim | EmotionAnim | InteractionAnim | NurtureAnim
  | EnvironmentAnim | CodingAnim | SpecialAnim

export type AnimationCategory =
  | 'basic' | 'emotion' | 'interaction' | 'nurture' | 'environment' | 'coding' | 'special'

// ============ 编码反应 → 精灵图 PetState 映射 ============
// 参考 OpenPets packages/client/src/protocol.ts:allowedReactions
// 编码反应映射到现有 PetState 值 + ANIMATION_ROWS 中的扩展行
export const CODING_REACTION_TO_PETSTATE: Record<CodingAnim, PetState> = {
  thinking: 'sit',      // 思考中 → 坐着（等待行的变体）
  editing: 'walk',      // 编辑中 → 走动（运行行的变体）
  testing: 'idle',      // 测试中 → 待机（审查行的变体）
  success: 'happy',     // 成功 → 开心（跳跃行的变体）
  error: 'sad',         // 错误 → 伤心（失败行的变体）
  celebrating: 'happy', // 庆祝 → 开心（挥手行的变体）
}

// 编码反应 → Live2D motion group 映射
export const CODING_REACTION_TO_MOTION: Record<CodingAnim, string> = {
  thinking: 'Sit',
  editing: 'Walk',
  testing: 'Idle',
  success: 'TapBody',
  error: 'FlickHead',
  celebrating: 'TapBody',
}

// ============ 动画定义 ============

export interface AnimationDef {
  id: AnimationId
  name: string          // 中文名称
  category: AnimationCategory
  triggers: string[]    // 触发条件描述（人可读，如 "hp < 20" 或 "interaction: pet_head"）
  duration: number      // 单次播放时长（毫秒）
  priority: number      // 优先级（数字越大越优先）
  spriteState: PetState // 映射到精灵图 PetState（用于 SpriteRenderer）
  motionGroup: string   // 映射到 Live2D motion group
}

// ============ 50 种动画目录 ============

export const ANIMATION_CATALOG: AnimationDef[] = [
  // ===== 基础状态（10 种）=====
  { id: 'idle', name: '待机', category: 'basic', triggers: ['default', 'fallback'], duration: 5000, priority: 1, spriteState: 'idle', motionGroup: 'Idle' },
  { id: 'breathing', name: '呼吸', category: 'basic', triggers: ['idle for >10s'], duration: 4000, priority: 1, spriteState: 'idle', motionGroup: 'Idle' },
  { id: 'blink', name: '眨眼', category: 'basic', triggers: ['idle for >5s'], duration: 800, priority: 1, spriteState: 'idle', motionGroup: 'Idle' },
  { id: 'sleep', name: '睡眠', category: 'basic', triggers: ['time 0-8', 'idle >5min'], duration: 10000, priority: 2, spriteState: 'sleep', motionGroup: 'Sleep' },
  { id: 'drowsy', name: '困倦', category: 'basic', triggers: ['time 23-24 or 0-2'], duration: 6000, priority: 2, spriteState: 'sleep', motionGroup: 'Sleep' },
  { id: 'awake', name: '醒来', category: 'basic', triggers: ['after sleep'], duration: 2000, priority: 2, spriteState: 'idle', motionGroup: 'Idle' },
  { id: 'sit', name: '坐下', category: 'basic', triggers: ['random idle'], duration: 5000, priority: 1, spriteState: 'sit', motionGroup: 'Sit' },
  { id: 'stand', name: '站立', category: 'basic', triggers: ['random idle'], duration: 4000, priority: 1, spriteState: 'idle', motionGroup: 'Idle' },
  { id: 'lie_down', name: '趴下', category: 'basic', triggers: ['random idle', 'tired'], duration: 6000, priority: 1, spriteState: 'sit', motionGroup: 'Sit' },
  { id: 'stretch', name: '伸展', category: 'basic', triggers: ['after sleep', 'after sit'], duration: 2000, priority: 1, spriteState: 'walk', motionGroup: 'Walk' },

  // ===== 情绪表现（12 种）=====
  { id: 'happy', name: '开心', category: 'emotion', triggers: ['mood >= 70'], duration: 3000, priority: 3, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'excited', name: '兴奋', category: 'emotion', triggers: ['mood >= 90'], duration: 3000, priority: 4, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'laugh', name: '大笑', category: 'emotion', triggers: ['mood >= 85'], duration: 2500, priority: 4, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'giggle', name: '咯咯笑', category: 'emotion', triggers: ['mood >= 60'], duration: 2000, priority: 3, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'sad', name: '伤心', category: 'emotion', triggers: ['mood < 40'], duration: 4000, priority: 3, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'cry', name: '哭泣', category: 'emotion', triggers: ['mood < 15'], duration: 4000, priority: 4, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'angry', name: '生气', category: 'emotion', triggers: ['mood < 10', 'over-interaction'], duration: 3000, priority: 4, spriteState: 'sick', motionGroup: 'Sick' },
  { id: 'annoyed', name: '不耐烦', category: 'emotion', triggers: ['mood < 30', 'frequent poke'], duration: 2500, priority: 3, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'surprised', name: '惊讶', category: 'emotion', triggers: ['sudden event'], duration: 1500, priority: 3, spriteState: 'pet', motionGroup: 'FlickHead' },
  { id: 'confused', name: '困惑', category: 'emotion', triggers: ['network offline'], duration: 2500, priority: 3, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'shy', name: '害羞', category: 'emotion', triggers: ['praise', 'compliment'], duration: 2500, priority: 3, spriteState: 'pet', motionGroup: 'FlickHead' },
  { id: 'embarrassed', name: '尴尬', category: 'emotion', triggers: ['after stumble'], duration: 2500, priority: 3, spriteState: 'sad', motionGroup: 'FlickHead' },

  // ===== 交互响应（10 种）=====
  { id: 'pet_head', name: '被摸头', category: 'interaction', triggers: ['interaction: pet_head'], duration: 1500, priority: 10, spriteState: 'pet', motionGroup: 'FlickHead' },
  { id: 'being_held', name: '被抱起', category: 'interaction', triggers: ['interaction: being_held'], duration: 3000, priority: 10, spriteState: 'drag', motionGroup: 'TapBody' },
  { id: 'feed', name: '喂食', category: 'interaction', triggers: ['interaction: feed'], duration: 1500, priority: 10, spriteState: 'eat', motionGroup: 'Eat' },
  { id: 'eat', name: '进食', category: 'interaction', triggers: ['interaction: eat'], duration: 2000, priority: 10, spriteState: 'eat', motionGroup: 'Eat' },
  { id: 'drink', name: '饮水', category: 'interaction', triggers: ['interaction: drink'], duration: 1800, priority: 10, spriteState: 'eat', motionGroup: 'Eat' },
  { id: 'play', name: '玩耍', category: 'interaction', triggers: ['interaction: play'], duration: 2000, priority: 10, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'hug', name: '拥抱', category: 'interaction', triggers: ['interaction: hug'], duration: 2500, priority: 10, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'poke', name: '戳一下', category: 'interaction', triggers: ['interaction: poke'], duration: 1200, priority: 9, spriteState: 'pet', motionGroup: 'FlickHead' },
  { id: 'drag', name: '被拖拽', category: 'interaction', triggers: ['interaction: drag'], duration: 2000, priority: 10, spriteState: 'drag', motionGroup: 'TapBody' },
  { id: 'drop', name: '被放下', category: 'interaction', triggers: ['interaction: drop'], duration: 1500, priority: 10, spriteState: 'idle', motionGroup: 'Idle' },

  // ===== 养成相关（8 种）=====
  { id: 'sick', name: '生病', category: 'nurture', triggers: ['health <= 0'], duration: 5000, priority: 8, spriteState: 'sick', motionGroup: 'Sick' },
  { id: 'recovering', name: '恢复中', category: 'nurture', triggers: ['health 1-30 after sick'], duration: 4000, priority: 6, spriteState: 'sick', motionGroup: 'Sick' },
  { id: 'level_up', name: '升级', category: 'nurture', triggers: ['level increased'], duration: 3000, priority: 9, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'hungry_starving', name: '饥饿', category: 'nurture', triggers: ['hp < 20'], duration: 4000, priority: 7, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'full_satisfied', name: '吃饱满足', category: 'nurture', triggers: ['hp >= 95 and mood >= 70'], duration: 3000, priority: 5, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'bath', name: '洗澡', category: 'nurture', triggers: ['interaction: bath'], duration: 2500, priority: 10, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'clean', name: '干净', category: 'nurture', triggers: ['after bath'], duration: 3000, priority: 4, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'dirty', name: '脏兮兮', category: 'nurture', triggers: ['no bath for >3 days'], duration: 3000, priority: 4, spriteState: 'sad', motionGroup: 'FlickHead' },

  // ===== 环境感知（6 种）=====
  { id: 'rain_umbrella', name: '雨天打伞', category: 'environment', triggers: ['weather: rain'], duration: 4000, priority: 6, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'hot_fanning', name: '炎热扇风', category: 'environment', triggers: ['weather: hot', 'temp > 30'], duration: 4000, priority: 6, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'cold_shivering', name: '寒冷发抖', category: 'environment', triggers: ['weather: cold', 'temp < 5'], duration: 4000, priority: 6, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'sunny_happy', name: '晴天开心', category: 'environment', triggers: ['weather: sunny'], duration: 3000, priority: 5, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'music_sway', name: '音乐摇摆', category: 'environment', triggers: ['music: playing'], duration: 5000, priority: 5, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'coding_companion', name: '编程陪伴', category: 'environment', triggers: ['workState: coding'], duration: 6000, priority: 5, spriteState: 'sit', motionGroup: 'Sit' },

  // ===== 编码反应（6 种）— 参考 OpenPets allowedReactions =====
  { id: 'thinking', name: '思考中', category: 'coding', triggers: ['coding: thinking', 'workState: thinking'], duration: 5000, priority: 7, spriteState: 'sit', motionGroup: 'Sit' },
  { id: 'editing', name: '编辑中', category: 'coding', triggers: ['coding: editing', 'workState: editing'], duration: 4000, priority: 7, spriteState: 'walk', motionGroup: 'Walk' },
  { id: 'testing', name: '测试中', category: 'coding', triggers: ['coding: testing', 'workState: testing'], duration: 4000, priority: 7, spriteState: 'idle', motionGroup: 'Idle' },
  { id: 'success', name: '构建成功', category: 'coding', triggers: ['coding: success', 'build: passed'], duration: 3000, priority: 8, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'error', name: '构建失败', category: 'coding', triggers: ['coding: error', 'build: failed'], duration: 3000, priority: 8, spriteState: 'sad', motionGroup: 'FlickHead' },
  { id: 'celebrating', name: '里程碑达成', category: 'coding', triggers: ['coding: celebrating', 'milestone: achieved'], duration: 4000, priority: 9, spriteState: 'happy', motionGroup: 'TapBody' },

  // ===== 特殊/稀有（4 种）=====
  { id: 'anniversary', name: '纪念日', category: 'special', triggers: ['anniversary date'], duration: 4000, priority: 9, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'birthday', name: '生日', category: 'special', triggers: ['birthday date'], duration: 4000, priority: 9, spriteState: 'happy', motionGroup: 'TapBody' },
  { id: 'dream', name: '做梦', category: 'special', triggers: ['sleeping >5min'], duration: 5000, priority: 3, spriteState: 'sleep', motionGroup: 'Sleep' },
  { id: 'daydream', name: '发呆', category: 'special', triggers: ['idle >2min'], duration: 4000, priority: 2, spriteState: 'idle', motionGroup: 'Idle' },
]

// 动画总数（验证 ≥50）
export const ANIMATION_COUNT = ANIMATION_CATALOG.length

// ============ 查询辅助 ============

const ANIMATION_MAP: Record<AnimationId, AnimationDef> = ANIMATION_CATALOG.reduce(
  (acc, anim) => { acc[anim.id] = anim; return acc },
  {} as Record<AnimationId, AnimationDef>,
)

export function getAnimationById(id: AnimationId): AnimationDef {
  return ANIMATION_MAP[id] ?? ANIMATION_MAP.idle
}

/** 将动画 ID 映射到精灵图 PetState（供 SpriteRenderer 使用） */
export function animationIdToPetState(id: AnimationId): PetState {
  return getAnimationById(id).spriteState
}

/** 将动画 ID 映射到 Live2D motion group（供 Live2DRenderer 使用） */
export function animationIdToMotionGroup(id: AnimationId): string {
  return getAnimationById(id).motionGroup
}

// ============ 动画上下文 ============

export interface AnimationContext {
  petState: PetState          // 当前渲染状态
  hp: number                  // 饱食度 0-100（hunger）
  mood: number                // 心情 0-100
  health: number              // 健康 0-100
  affection: number           // 亲密度 0-9999
  level: number               // 等级 1-256
  weather: WeatherAction      // 天气行为动作
  workState: WorkState        // 工作状态
  time: number                // 当前小时 0-23
  lastInteraction: number     // 上次交互时间戳（ms）
  interactionType?: string    // 上次交互类型（pet_head/feed/play/drag/...）
  musicPlaying: boolean       // 是否正在播放音乐
  codingSubState?: 'thinking' | 'editing' | 'testing' | 'success' | 'error' | 'celebrating'
  // 编码子状态（仅 workState='coding' 时有效）
}

// ============ 动画状态机 ============

// 冷却时间：同一动画 30 秒内不重复触发
const COOLDOWN_MS = 30_000

// 交互响应窗口：交互后 3 秒内视为"刚交互"
const INTERACTION_WINDOW_MS = 3_000

export class AnimationStateMachine {
  /** 每个动画上次播放的时间戳 */
  private lastPlayedAt: Map<AnimationId, number> = new Map()
  /** 上一次选中的动画（用于连续性判断） */
  private lastSelected: AnimationId = 'idle'

  /** 检查动画是否在冷却中 */
  isOnCooldown(id: AnimationId, now: number = Date.now()): boolean {
    const last = this.lastPlayedAt.get(id)
    if (last === undefined) return false
    return now - last < COOLDOWN_MS
  }

  /** 标记动画已播放（更新冷却时间戳） */
  markPlayed(id: AnimationId, now: number = Date.now()): void {
    this.lastPlayedAt.set(id, now)
  }

  /** 重置所有冷却（角色切换时调用） */
  resetCooldowns(): void {
    this.lastPlayedAt.clear()
    this.lastSelected = 'idle'
  }

  /**
   * 根据上下文选择动画 — 按优先级从高到低评估：
   * 1. 交互响应（最高，用户刚执行操作）
   * 2. 环境感知（天气/音乐/工作状态）
   * 3. 养成相关（HP/心情极低/升级）
   * 4. 情绪表现（基于心情值）
   * 5. 基础状态（兜底）
   *
   * 相同动画有 30 秒冷却，冷却中的动画会被跳过（降级到下一优先级）。
   */
  select(ctx: AnimationContext): AnimationId {
    const now = Date.now()
    const selected = this.selectInternal(ctx, now)
    this.markPlayed(selected, now)
    this.lastSelected = selected
    return selected
  }

  private selectInternal(ctx: AnimationContext, now: number): AnimationId {
    // ---- 1. 交互响应（最高优先级）----
    const interactionPick = this.pickInteraction(ctx, now)
    if (interactionPick) return interactionPick

    // ---- 2. 编码反应（编程陪伴模式专用，优先级高于一般环境感知）----
    const codingPick = this.pickCoding(ctx, now)
    if (codingPick) return codingPick

    // ---- 3. 环境感知 ----
    const envPick = this.pickEnvironment(ctx, now)
    if (envPick) return envPick

    // ---- 4. 养成相关 ----
    const nurturePick = this.pickNurture(ctx, now)
    if (nurturePick) return nurturePick

    // ---- 5. 情绪表现 ----
    const emotionPick = this.pickEmotion(ctx, now)
    if (emotionPick) return emotionPick

    // ---- 6. 基础状态（兜底）----
    return this.pickBasic(ctx, now)
  }

  // 交互类型 → 动画 ID 映射
  private static INTERACTION_MAP: Record<string, AnimationId> = {
    pet_head: 'pet_head',
    being_held: 'being_held',
    feed: 'feed',
    eat: 'eat',
    drink: 'drink',
    play: 'play',
    hug: 'hug',
    poke: 'poke',
    drag: 'drag',
    drop: 'drop',
    bath: 'bath',
  }

  private pickInteraction(ctx: AnimationContext, now: number): AnimationId | null {
    const sinceInteraction = now - ctx.lastInteraction
    if (sinceInteraction > INTERACTION_WINDOW_MS) return null
    if (!ctx.interactionType) return null
    const id = AnimationStateMachine.INTERACTION_MAP[ctx.interactionType]
    if (!id) return null
    // 交互响应不受冷却限制（用户操作应立即反馈）
    return id
  }

  /** 编码反应选择 — 根据 codingSubState 选择编码动画 */
  private pickCoding(ctx: AnimationContext & { codingSubState?: string }, now: number): AnimationId | null {
    // 仅在 coding 工作状态下触发
    if (ctx.workState !== 'coding') return null

    // 编码子状态 → 动画映射（与 CodingAnim 类型一致）
    const codingStateMap: Record<string, AnimationId> = {
      thinking: 'thinking',
      editing: 'editing',
      testing: 'testing',
      success: 'success',
      error: 'error',
      celebrating: 'celebrating',
    }

    const subState = ctx.codingSubState
    if (subState) {
      const animId = codingStateMap[subState]
      if (animId && !this.isOnCooldown(animId, now)) return animId
    }

    return null
  }

  private pickEnvironment(ctx: AnimationContext, now: number): AnimationId | null {
    // 天气感知
    const weatherMap: Record<WeatherAction, AnimationId | null> = {
      umbrella: 'rain_umbrella',
      fan: 'hot_fanning',
      cold: 'cold_shivering',
      sunny: 'sunny_happy',
      normal: null,
    }
    const weatherAnim = weatherMap[ctx.weather]
    if (weatherAnim && !this.isOnCooldown(weatherAnim, now)) return weatherAnim

    // 音乐感知
    if (ctx.musicPlaying && !this.isOnCooldown('music_sway', now)) return 'music_sway'

    // 工作状态感知
    if (ctx.workState === 'coding' && !this.isOnCooldown('coding_companion', now)) {
      return 'coding_companion'
    }

    return null
  }

  private pickNurture(ctx: AnimationContext, now: number): AnimationId | null {
    // 健康为 0 → 生病
    if (ctx.health <= 0 && !this.isOnCooldown('sick', now)) return 'sick'
    // 健康极低 → 恢复中
    if (ctx.health > 0 && ctx.health < 30 && !this.isOnCooldown('recovering', now)) {
      return 'recovering'
    }
    // 饥饿（hp < 20）→ 饥饿
    if (ctx.hp < 20 && !this.isOnCooldown('hungry_starving', now)) return 'hungry_starving'
    // 吃饱满足
    if (ctx.hp >= 95 && ctx.mood >= 70 && !this.isOnCooldown('full_satisfied', now)) {
      return 'full_satisfied'
    }
    return null
  }

  private pickEmotion(ctx: AnimationContext, now: number): AnimationId | null {
    // 基于心情值选择情绪动画
    const candidates: AnimationId[] = []
    if (ctx.mood >= 90) {
      candidates.push('excited', 'laugh', 'happy')
    } else if (ctx.mood >= 70) {
      candidates.push('happy', 'laugh', 'giggle')
    } else if (ctx.mood >= 50) {
      candidates.push('giggle', 'happy')
    } else if (ctx.mood >= 30) {
      candidates.push('annoyed', 'sad')
    } else if (ctx.mood >= 15) {
      candidates.push('sad', 'annoyed')
    } else {
      candidates.push('cry', 'angry', 'sad')
    }
    // 过滤掉冷却中的动画
    const available = candidates.filter((id) => !this.isOnCooldown(id, now))
    if (available.length === 0) return null
    return available[Math.floor(Math.random() * available.length)]
  }

  private pickBasic(ctx: AnimationContext, now: number): AnimationId {
    // 夜间睡眠（0-8 点）
    if (ctx.time >= 0 && ctx.time < 8) {
      if (!this.isOnCooldown('sleep', now)) return 'sleep'
    }
    // 深夜/凌晨困倦
    if ((ctx.time >= 23 || ctx.time < 2) && !this.isOnCooldown('drowsy', now)) {
      return 'drowsy'
    }

    // 从基础状态中随机选择（排除冷却中的）
    const basics: AnimationId[] = ['idle', 'breathing', 'blink', 'sit', 'stand', 'lie_down', 'stretch', 'daydream']
    // 刚睡醒时优先伸展
    if (ctx.petState === 'sleep' && !this.isOnCooldown('stretch', now)) {
      return 'stretch'
    }
    const available = basics.filter((id) => !this.isOnCooldown(id, now))
    if (available.length === 0) return 'idle'
    // idle 权重更高（更常见）
    const weighted: AnimationId[] = ['idle', 'idle', 'idle', ...available]
    return weighted[Math.floor(Math.random() * weighted.length)]
  }
}

// ============ 单例 ============

let animStateMachine: AnimationStateMachine | null = null

export function getAnimationStateMachine(): AnimationStateMachine {
  if (!animStateMachine) {
    animStateMachine = new AnimationStateMachine()
  }
  return animStateMachine
}
