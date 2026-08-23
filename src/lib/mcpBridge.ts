/**
 * MCP 工具桥接核心 — 集中 6 个 spiritpal_* 工具的真实执行逻辑
 *
 * 用途：作为"命令桥"的 TS 侧执行端。外部 Agent → `spiritpal-mcp`(Rust) →
 * bridge（本地 HTTP）→ 本模块执行真实工具逻辑（直接读写 petStore / enhancedMemory），
 * 并通过 `spiritpal-mcp-*` 自定义事件驱动宠物 UI 反应。
 *
 * 与 mcpServer.ts 的工具逻辑保持一致；这里暴露一个可单测的纯入口，
 * 供桥接层与测试复用。
 */
import { usePetStore } from '../stores/petStore'
import { getEnhancedMemoryManager } from './enhancedMemory'
import { ANIMATION_CATALOG } from './animationConfig'
import { OPENPETS_REACTION_MAP } from './types'
import { createBubbleMessageSchema, createValidatedIdSchema } from './mcpInputValidator'

/** MCP 工具调用返回结构（与 SDK 的 result.content 一致） */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function text(message: string, isError = false): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError }
}

function dispatch(event: string, detail?: unknown): void {
  try {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(event, { detail }))
  } catch {
    // 忽略
  }
}

/** 执行一个 spiritpal_* 工具（真实状态/动作），返回 MCP 格式结果 */
export async function executeMcpTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
  switch (name) {
    case 'spiritpal_status': {
      try {
        const store = usePetStore.getState()
        const stats = store.getCurrentStats()
        const moodLabel = stats.mood >= 80 ? '开心' : stats.mood >= 50 ? '一般' : stats.mood >= 20 ? '低落' : '难过'
        const hungerLabel = stats.hunger >= 80 ? '饱' : stats.hunger >= 50 ? '还行' : stats.hunger >= 20 ? '饿了' : '很饿'
        return text(JSON.stringify({
          level: stats.level,
          hunger: Math.round(stats.hunger),
          hungerLabel,
          mood: Math.round(stats.mood),
          moodLabel,
          health: Math.round(stats.health),
          affection: stats.affection,
          coins: store.sharedCoins,
          characterId: store.currentCharacterId,
          animation: 'idle',
          position: store.position ?? { x: 0, y: 0 },
        }))
      } catch (err) {
        return text(`Error: ${err}`, true)
      }
    }

    case 'spiritpal_react': {
      try {
        const schema = createValidatedIdSchema('反应名')
        const reaction = schema.parse(args.reaction)
        const animName = OPENPETS_REACTION_MAP[reaction]
        const validIds = new Set<string>(ANIMATION_CATALOG.map((a) => a.id))
        if (!animName || !validIds.has(animName)) {
          return text(`Unknown reaction: ${reaction}. Supported: ${Object.keys(OPENPETS_REACTION_MAP).join(', ')}`, true)
        }
        dispatch('spiritpal-mcp-react', animName)
        return text(`Pet reacted with: ${animName}`)
      } catch (err) {
        return text(`Error: ${err}`, true)
      }
    }

    case 'spiritpal_say': {
      try {
        const schema = createBubbleMessageSchema(200)
        const message = schema.parse(args.message)
        dispatch('spiritpal-mcp-say', message)
        return text(`Pet says: ${message}`)
      } catch (err) {
        return text(`Error: ${err}`, true)
      }
    }

    case 'spiritpal_memory': {
      try {
        const store = usePetStore.getState()
        const characterId = String(args.characterId ?? store.currentCharacterId)
        const mgr = getEnhancedMemoryManager(characterId)
        await mgr.ensureLoaded()
        const action = args.action as 'search' | 'list' | undefined
        if (action === 'search') {
          const query = String(args.query ?? '')
          if (!query) return text('Error: query required for search', true)
          const results = mgr.search(query)
          return text(JSON.stringify(results.slice(0, 10).map((m) => ({
            user: m.user,
            assistant: m.assistant,
            created_at: m.created_at,
            category: m.category,
          }))))
        }
        const all = mgr.getAllMemories()
        return text(JSON.stringify({
          total: all.length,
          working: mgr.getWorkingMemories().length,
          episodic: mgr.getEpisodicMemories().length,
          autobiographical: mgr.getAutobiographicalMemories().length,
        }))
      } catch (err) {
        return text(`Error: ${err}`, true)
      }
    }

    case 'spiritpal_feed': {
      try {
        const foodName = String(args.foodName ?? '')
        const store = usePetStore.getState()
        const food = store.inventory.find(
          (item) => item.name.toLowerCase() === foodName.toLowerCase() || item.id === foodName,
        )
        if (!food) {
          return text(`Food '${foodName}' not found in inventory. Available: ${store.inventory.map((i) => i.name).join(', ') || 'none'}`, true)
        }
        store.feed(food)
        dispatch('spiritpal-mcp-feed', foodName)
        const stats = store.getCurrentStats()
        return text(`Fed pet with ${food.name}. Hunger: ${Math.round(stats.hunger)}, Coins: ${store.sharedCoins}`)
      } catch (err) {
        return text(`Error: ${err}`, true)
      }
    }

    case 'spiritpal_pet': {
      try {
        const store = usePetStore.getState()
        store.pet()
        dispatch('spiritpal-mcp-pet')
        const stats = store.getCurrentStats()
        return text(`Pet the pet successfully. Affection: ${stats.affection}, Mood: ${Math.round(stats.mood)}`)
      } catch (err) {
        return text(`Error: ${err}`, true)
      }
    }

    default:
      return text(`Unknown tool: ${name}`, true)
  }
}

/** 支持的工具有效名（供校验/列表） */
export const MCP_TOOL_NAMES = [
  'spiritpal_status',
  'spiritpal_react',
  'spiritpal_say',
  'spiritpal_memory',
  'spiritpal_feed',
  'spiritpal_pet',
] as const