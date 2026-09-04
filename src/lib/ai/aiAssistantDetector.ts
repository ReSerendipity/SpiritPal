/**
 * AI 编程助手状态检测器 — 检测用户正在使用的 AI 编程助手，让宠物做出反应
 * 参考 clawd-on-desk 的助手检测设计
 *
 * @fileoverview
 * 主要模块：
 * - AIAssistant 接口：AI 助手信息定义
 * - AI_ASSISTANTS：20+ 种 AI 助手配置列表（Claude Code/Cursor/Copilot/Windsurf/Aider/Trae 等）
 * - DetectedAssistant 接口：检测结果结构
 * - REACTION_MESSAGES：不同反应类型的消息池（嫉妒/好奇/友好）
 * - AIAssistantDetector 类：检测器类（单例模式），支持进程检测、定时轮询、反应消息获取
 * - getAIAssistantDetector()：获取单例入口
 *
 * 核心功能：
 * 1. 检测 20+ AI 助手进程
 * 2. HTTP API 端点检测运行中的助手（预留）
 * 3. 宠物对 AI 助手活动的反应（嫉妒、好奇、友好等）
 * 4. 进程名到友好名称的映射
 *
 * @module aiAssistantDetector
 * @requires @tauri-apps/api/core - Tauri 后端调用（获取运行进程）
 */

import { invoke } from '@tauri-apps/api/core'

// ============ AI 助手定义 ============

/** AI 助手信息 */
export interface AIAssistant {
  /** 助手 ID */
  id: string
  /** 友好名称 */
  name: string
  /** 进程名列表（匹配用） */
  processNames: string[]
  /** HTTP API 端点（可选，用于在线检测） */
  apiEndpoints?: string[]
  /** 图标 emoji */
  icon: string
  /** 描述 */
  description: string
  /** 宠物对此助手的反应类型 */
  petReaction: 'jealousy' | 'curiosity' | 'friendly' | 'indifferent'
  /** 反应气泡消息（i18n key） */
  reactionBubbleKey: string
}

/** 检测到的助手 */
export interface DetectedAssistant {
  assistant: AIAssistant
  /** 检测方式 */
  detectedBy: 'process' | 'api' | 'both'
  /** 检测时间 */
  detectedAt: number
}

/** 完整的 AI 助手列表 */
export const AI_ASSISTANTS: AIAssistant[] = [
  // 主流 AI 编程助手
  {
    id: 'claude-code', name: 'Claude Code', processNames: ['claude', 'claude-code'],
    icon: '🤖', description: 'Anthropic Claude 编程助手',
    petReaction: 'jealousy', reactionBubbleKey: 'ai.detected.claude',
  },
  {
    id: 'cursor', name: 'Cursor', processNames: ['cursor', 'Cursor'],
    icon: '🔮', description: 'Cursor AI 编辑器',
    petReaction: 'jealousy', reactionBubbleKey: 'ai.detected.cursor',
  },
  {
    id: 'copilot', name: 'GitHub Copilot', processNames: ['copilot'],
    apiEndpoints: ['https://api.github.com/copilot_internal/v2/token'],
    icon: '🐙', description: 'GitHub Copilot',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.copilot',
  },
  {
    id: 'windsurf', name: 'Windsurf', processNames: ['windsurf', 'Windsurf'],
    icon: '🏄', description: 'Codeium Windsurf',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.windsurf',
  },
  {
    id: 'aider', name: 'Aider', processNames: ['aider'],
    icon: '🤝', description: 'Aider AI 配对编程',
    petReaction: 'friendly', reactionBubbleKey: 'ai.detected.aider',
  },
  {
    id: 'trae', name: 'Trae', processNames: ['trae', 'Trae', 'Trae CN'],
    icon: '⚡', description: 'Trae AI IDE',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.trae',
  },
  {
    id: 'cline', name: 'Cline', processNames: ['cline'],
    icon: '🔧', description: 'Cline VS Code 扩展',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.cline',
  },
  {
    id: 'roo-code', name: 'Roo Code', processNames: ['roo-code'],
    icon: '🦘', description: 'Roo Code AI 助手',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.rooCode',
  },
  // AI 对话工具
  {
    id: 'chatgpt', name: 'ChatGPT', processNames: ['chatgpt'],
    apiEndpoints: ['https://chat.openai.com'],
    icon: '💬', description: 'OpenAI ChatGPT',
    petReaction: 'indifferent', reactionBubbleKey: 'ai.detected.chatgpt',
  },
  {
    id: 'perplexity', name: 'Perplexity', processNames: ['perplexity'],
    icon: '🔍', description: 'Perplexity AI 搜索',
    petReaction: 'indifferent', reactionBubbleKey: 'ai.detected.perplexity',
  },
  // AI 编辑器
  {
    id: 'replit', name: 'Replit', processNames: ['replit'],
    icon: '👨‍💻', description: 'Replit AI',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.replit',
  },
  {
    id: 'codeium', name: 'Codeium', processNames: ['codeium'],
    icon: '🌀', description: 'Codeium AI',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.codeium',
  },
  {
    id: 'tabnine', name: 'Tabnine', processNames: ['tabnine'],
    icon: '⌨', description: 'Tabnine AI',
    petReaction: 'indifferent', reactionBubbleKey: 'ai.detected.tabnine',
  },
  {
    id: 'amazon-q', name: 'Amazon Q', processNames: ['amazon-q', 'codewhisperer'],
    icon: '🔷', description: 'Amazon Q Developer',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.amazonQ',
  },
  {
    id: 'sourcegraph-cody', name: 'Cody', processNames: ['cody', 'sourcegraph-cody'],
    icon: '🤠', description: 'Sourcegraph Cody',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.cody',
  },
  {
    id: 'supermaven', name: 'Supermaven', processNames: ['supermaven'],
    icon: '🦸', description: 'Supermaven AI',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.supermaven',
  },
  {
    id: 'augment', name: 'Augment', processNames: ['augment'],
    icon: '➕', description: 'Augment Code',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.augment',
  },
  {
    id: 'continue', name: 'Continue', processNames: ['continue-dev'],
    icon: '▶️', description: 'Continue AI',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.continue',
  },
  {
    id: 'pearai', name: 'PearAI', processNames: ['pearai'],
    icon: '🍐', description: 'PearAI',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.pearai',
  },
  {
    id: 'void', name: 'Void', processNames: ['void-editor'],
    icon: '⚫', description: 'Void Editor',
    petReaction: 'curiosity', reactionBubbleKey: 'ai.detected.void',
  },
]

// ============ 反应消息 ============

/** 嫉妒反应消息 */
const JEALOUSY_MESSAGES = [
  '哼，你居然在用别的 AI…',
  '我也很聪明的！',
  '你怎么不问我呢…',
  '我会努力的，别找别的 AI 嘛…',
  '是不是我不够好…',
]

/** 好奇反应消息 */
const CURIOSITY_MESSAGES = [
  '哦？那是什么 AI？',
  '让我看看…',
  '好像挺厉害的～',
  '可以教教我吗？',
]

/** 友好反应消息 */
const FRIENDLY_MESSAGES = [
  '好朋友来啦～',
  '一起编程吧！',
  '有新朋友了呢～',
]

/** 反应消息映射 */
const REACTION_MESSAGES: Record<string, string[]> = {
  jealousy: JEALOUSY_MESSAGES,
  curiosity: CURIOSITY_MESSAGES,
  friendly: FRIENDLY_MESSAGES,
  indifferent: [],
}

// ============ 检测器 ============

export class AIAssistantDetector {
  private detected = new Map<string, DetectedAssistant>()
  private listeners = new Set<(detected: DetectedAssistant[]) => void>()
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 执行一次检测
   * 通过后端获取运行中的进程列表进行匹配
   */
  async detect(): Promise<DetectedAssistant[]> {
    const results: DetectedAssistant[] = []

    try {
      // 调用后端获取运行中的进程名列表
      const processNames = await invoke<string[]>('get_running_processes')

      for (const assistant of AI_ASSISTANTS) {
        const matched = assistant.processNames.some((pn) =>
          processNames.some((running) =>
            running.toLowerCase().includes(pn.toLowerCase()),
          ),
        )

        if (matched) {
          results.push({
            assistant,
            detectedBy: 'process',
            detectedAt: Date.now(),
          })
        }
      }
    } catch (e) {
      console.warn('[aiAssistantDetector] 进程检测失败:', e)
    }

    // 更新检测结果
    this.detected.clear()
    for (const d of results) {
      this.detected.set(d.assistant.id, d)
    }

    // 通知变化
    this.notifyListeners()

    return results
  }

  /**
   * 启动定时检测
   * @param intervalMs 检测间隔（默认 30 秒）
   */
  startPolling(intervalMs = 30000): void {
    if (this.pollTimer) return
    // 首次立即检测
    void this.detect()
    this.pollTimer = setInterval(() => {
      void this.detect()
    }, intervalMs)
  }

  /**
   * 停止定时检测
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * 获取当前检测到的助手列表
   */
  getDetectedAssistants(): DetectedAssistant[] {
    return Array.from(this.detected.values())
  }

  /**
   * 根据反应类型获取宠物的反应消息
   */
  getReactionMessage(reaction: string): string | null {
    const messages = REACTION_MESSAGES[reaction]
    if (!messages || messages.length === 0) return null
    return messages[Math.floor(Math.random() * messages.length)]
  }

  /**
   * 获取最强的宠物反应（优先级：jealousy > curiosity > friendly）
   */
  getStrongestReaction(): { reaction: string; message: string } | null {
    const detected = this.getDetectedAssistants()
    if (detected.length === 0) return null

    // 按反应优先级排序
    const priority: Record<string, number> = { jealousy: 3, curiosity: 2, friendly: 1, indifferent: 0 }
    const sorted = detected.sort(
      (a, b) => (priority[b.assistant.petReaction] ?? 0) - (priority[a.assistant.petReaction] ?? 0),
    )

    const strongest = sorted[0]
    const message = this.getReactionMessage(strongest.assistant.petReaction)
    if (!message) return null

    return { reaction: strongest.assistant.petReaction, message }
  }

  /**
   * 订阅检测结果变化
   */
  subscribe(listener: (detected: DetectedAssistant[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    const detected = this.getDetectedAssistants()
    this.listeners.forEach((fn) => fn(detected))
  }

  /**
   * 销毁检测器
   */
  destroy(): void {
    this.stopPolling()
    this.listeners.clear()
    this.detected.clear()
  }
}

// ============ 单例 ============

let sharedDetector: AIAssistantDetector | null = null

export function getAIAssistantDetector(): AIAssistantDetector {
  if (!sharedDetector) {
    sharedDetector = new AIAssistantDetector()
  }
  return sharedDetector
}
