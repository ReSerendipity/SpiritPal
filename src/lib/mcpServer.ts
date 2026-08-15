/**
 * MCP 服务器模块
 *
 * @fileoverview 实现SpiritPal MCP服务器，暴露工具供外部AI代理控制宠物
 *
 * 主要模块：
 * - createMcpServer(): 创建并配置MCP服务器实例
 * - startMcpServer/stopMcpServer: 服务器启停控制
 * - MCP工具集: spiritpal_status/spiritpal_react/spiritpal_say/spiritpal_memory/spiritpal_feed/spiritpal_pet
 *
 * 依赖关系：
 * - @modelcontextprotocol/sdk: MCP官方SDK
 * - zod: 参数Schema校验
 * - petStore: Zustand宠物状态管理
 * - animationConfig: 动画定义
 * - enhancedMemory: 增强记忆系统
 * - mcpLease: 租约管理
 * - mcpInputValidator: 输入安全校验
 *
 * 核心接口：
 * - createMcpServer(): 创建MCP服务器实例
 * - startMcpServer(): 启动服务器（stdio/HTTP）
 * - stopMcpServer(): 停止服务器
 *
 * MCP工具列表：
 * - spiritpal_status: 获取宠物当前完整状态
 * - spiritpal_react: 让宠物执行指定反应动画
 * - spiritpal_say: 让宠物说话（气泡显示，5层安全校验）
 * - spiritpal_memory: 存取宠物记忆
 * - spiritpal_feed: 喂食宠物
 * - spiritpal_pet: 抚摸宠物
 *
 * 参考：OpenPets packages/mcp/
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { usePetStore } from '../stores/petStore'
import type { AnimationId } from './animationConfig'
import { ANIMATION_CATALOG } from './animationConfig'
import { OPENPETS_REACTION_MAP } from './types'
import { getEnhancedMemoryManager } from './enhancedMemory'
import { LeaseManager } from './mcpLease'
import { createBubbleMessageSchema, createValidatedIdSchema } from './mcpInputValidator'

// ============ MCP Server 实例 ============

let mcpServer: McpServer | null = null
let mcpTransport: StdioServerTransport | null = null
let mcpHttpServer: { close: () => void } | null = null
let mcpLeaseManager: LeaseManager | null = null

/**
 * 创建 SpiritPal MCP Server
 * 参考 OpenPets packages/mcp/src/server.ts
 * 暴露 3 个工具：
 *   - spiritpal_status: 获取宠物当前状态
 *   - spiritpal_react: 让宠物执行指定反应
 *   - spiritpal_say: 让宠物说话（气泡显示文本）
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'spiritpal-mcp',
    version: '1.1.0',
  })

  // ---- 工具 1: spiritpal_status ----
  // 参考 OpenPets openpets_status — Chapter 7 增强：返回完整状态
  server.tool(
    'spiritpal_status',
    'Get the current status of the SpiritPal desktop pet (HP, mood, health, character, animation, position)',
    {},
    async () => {
      try {
        const store = usePetStore.getState()
        const stats = store.getCurrentStats()
        const moodLabel = stats.mood >= 80 ? '开心' : stats.mood >= 50 ? '一般' : stats.mood >= 20 ? '低落' : '难过'
        const hungerLabel = stats.hunger >= 80 ? '饱' : stats.hunger >= 50 ? '还行' : stats.hunger >= 20 ? '饿了' : '很饿'
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                level: stats.level,
                hunger: Math.round(stats.hunger),
                hungerLabel,
                mood: Math.round(stats.mood),
                moodLabel,
                health: Math.round(stats.health),
                affection: stats.affection,
                coins: store.sharedCoins,
                characterId: store.currentCharacterId,
                // Chapter 7 新增：动画和位置信息
                animation: 'idle',
                position: store.position ?? { x: 0, y: 0 },
              }),
            },
          ],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err}` }],
          isError: true,
        }
      }
    },
  )

  // ---- 工具 2: spiritpal_react ----
  // 参考 OpenPets openpets_react — Chapter 7 增强：JSON Schema 输入校验
  const reactionSchema = createValidatedIdSchema('反应名').describe(
    'The reaction name. Supported: ' + Object.keys(OPENPETS_REACTION_MAP).join(', '),
  )

  server.tool(
    'spiritpal_react',
    'Make the pet perform a specific reaction/animation',
    {
      reaction: reactionSchema,
    },
    async ({ reaction }) => {
      try {
        // 映射 OpenPets 反应名到 SpiritPal 动画 ID
        const spiritpalAnimName = OPENPETS_REACTION_MAP[reaction]
        const validIds = new Set(ANIMATION_CATALOG.map((a) => a.id))

        if (!spiritpalAnimName || !validIds.has(spiritpalAnimName as AnimationId)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Unknown reaction: ${reaction}. Supported: ${Object.keys(OPENPETS_REACTION_MAP).join(', ')}`,
              },
            ],
            isError: true,
          }
        }

        // 触发动画（通过事件通知前端）
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('spiritpal-mcp-react', { detail: spiritpalAnimName }),
          )
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Pet reacted with: ${spiritpalAnimName} (from reaction: ${reaction})`,
            },
          ],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err}` }],
          isError: true,
        }
      }
    },
  )

  // ---- 工具 3: spiritpal_say ----
  // 参考 OpenPets openpets_say — Chapter 7 增强：使用 mcpInputValidator 5 层校验
  const saySchema = createBubbleMessageSchema(200)

  server.tool(
    'spiritpal_say',
    'Make the pet say something (displayed in a speech bubble)',
    {
      message: saySchema.describe('The message for the pet to say (max 200 chars, no code/paths/secrets)'),
    },
    async ({ message }) => {
      try {
        // 触发气泡消息（通过事件通知前端）
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('spiritpal-mcp-say', { detail: message }),
          )
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Pet says: ${message}`,
            },
          ],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err}` }],
          isError: true,
        }
      }
    },
  )

  // ---- 工具 4: spiritpal_memory ----
  // 查询宠物记忆系统
  server.tool(
    'spiritpal_memory',
    'Query the pet memory system to search or list memories',
    {
      action: z.enum(['search', 'list']).describe('Action: search for memories or list all'),
      query: z.string().optional().describe('Search query (required for search action)'),
    },
    async ({ action, query }) => {
      try {
        const store = usePetStore.getState()
        const characterId = store.currentCharacterId
        const mgr = getEnhancedMemoryManager(characterId)
        await mgr.ensureLoaded()

        if (action === 'search') {
          if (!query) {
            return {
              content: [{ type: 'text' as const, text: 'Error: query parameter is required for search action' }],
              isError: true,
            }
          }
          const results = mgr.search(query)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(results.slice(0, 10).map(m => ({
                user: m.user,
                assistant: m.assistant,
                created_at: m.created_at,
                category: m.category,
              }))),
            }],
          }
        }

        // list action
        const all = mgr.getAllMemories()
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              total: all.length,
              working: mgr.getWorkingMemories().length,
              episodic: mgr.getEpisodicMemories().length,
              autobiographical: mgr.getAutobiographicalMemories().length,
            }),
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err}` }],
          isError: true,
        }
      }
    },
  )

  // ---- 工具 5: spiritpal_feed ----
  // 喂食宠物
  server.tool(
    'spiritpal_feed',
    'Feed the pet a specific food item',
    {
      foodName: z.string().describe('Name of the food to feed (e.g. apple, cake, fish)'),
    },
    async ({ foodName }) => {
      try {
        const store = usePetStore.getState()
        const inventory = store.inventory
        // 查找库存中的食物
        const food = inventory.find(
          (item) => item.name.toLowerCase() === foodName.toLowerCase() || item.id === foodName,
        )
        if (!food) {
          return {
            content: [{
              type: 'text' as const,
              text: `Food '${foodName}' not found in inventory. Available: ${inventory.map(i => i.name).join(', ') || 'none'}`,
            }],
            isError: true,
          }
        }
        store.feed(food)
        // 触发事件通知前端
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('spiritpal-mcp-feed', { detail: foodName }),
          )
        }
        const stats = store.getCurrentStats()
        return {
          content: [{
            type: 'text' as const,
            text: `Fed pet with ${food.name}. Hunger: ${Math.round(stats.hunger)}, Coins: ${store.sharedCoins}`,
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err}` }],
          isError: true,
        }
      }
    },
  )

  // ---- 工具 6: spiritpal_pet ----
  // 摸头宠物（增加好感度）
  server.tool(
    'spiritpal_pet',
    'Pet the pet (pet its head to increase affection)',
    {},
    async () => {
      try {
        const store = usePetStore.getState()
        store.pet()
        // 触发事件通知前端
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('spiritpal-mcp-pet'),
          )
        }
        const stats = store.getCurrentStats()
        return {
          content: [{
            type: 'text' as const,
            text: `Pet the pet successfully. Affection: ${stats.affection}, Mood: ${Math.round(stats.mood)}`,
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err}` }],
          isError: true,
        }
      }
    },
  )

  return server
}

/**
 * 启动 MCP Server（stdio 传输）
 * 外部 AI 代理通过 stdin/stdout 与 SpiritPal 通信
 */
export async function startMcpServer(): Promise<void> {
  if (mcpServer) return

  mcpServer = createMcpServer()
  mcpTransport = new StdioServerTransport()
  await mcpServer.connect(mcpTransport)
}

/**
 * 启动 MCP Server（HTTP 传输 — SSE 模式）
 * 外部 AI 代理通过 HTTP 与 SpiritPal 通信
 * @param port 监听端口，默认 3121
 */
export async function startMcpServerHttp(port = 3121): Promise<void> {
  if (mcpServer) return

  // 启动 Lease 管理器（Task 10）
  mcpLeaseManager = new LeaseManager()
  mcpLeaseManager.start()

  mcpServer = createMcpServer()

  try {
    // 动态导入 SSE 传输（浏览器环境可能不可用）
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js')
    const http = await import('http')
    const { URL } = await import('url')

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)

      if (url.pathname === '/sse') {
        const transport = new SSEServerTransport('/messages', res)
        await mcpServer!.connect(transport)
      } else if (url.pathname === '/messages' && req.method === 'POST') {
        // 消息端点由 SSE 传输内部处理
        res.writeHead(404)
        res.end()
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ name: 'spiritpal-mcp', version: '1.1.0', transport: 'sse' }))
      }
    })

    httpServer.listen(port, () => {
      console.log(`[MCP] HTTP transport listening on port ${port}`)
    })

    mcpHttpServer = { close: () => httpServer.close() }
  } catch (e) {
    console.warn('[MCP] HTTP transport unavailable, falling back to stdio:', e)
    await startMcpServer()
  }
}

/**
 * 停止 MCP Server
 */
export async function stopMcpServer(): Promise<void> {
  if (mcpServer) {
    await mcpServer.close()
    mcpServer = null
    mcpTransport = null
  }
  if (mcpHttpServer) {
    mcpHttpServer.close()
    mcpHttpServer = null
  }
  if (mcpLeaseManager) {
    mcpLeaseManager.stop()
    mcpLeaseManager = null
  }
}
