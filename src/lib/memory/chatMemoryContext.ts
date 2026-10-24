import type { ChatMemoryTrace, ChatMessage } from '@/lib/data/types'
import { getCommitmentTracker } from '@/lib/nurture/commitmentTracker'
import { getPetExperienceManager } from '@/lib/nurture/petExperience'
import { estimateTokens } from '@/lib/system/stringSimilarity'
import { ContextManager } from './contextManager'
import { getEnhancedMemoryManager } from './enhancedMemory'
import { getOwnerFactsManager } from './ownerFacts'
import { getVisualMemoryManager } from './visualMemoryManager'

interface ChatMemoryOptions {
  characterId: string
  query: string
  enabled: boolean
  temporary: boolean
  contextBudget: number
  totalBudget: number
}

export async function prepareChatMemory(
  options: ChatMemoryOptions,
): Promise<{ messages: ChatMessage[]; trace: ChatMemoryTrace }> {
  const mode = options.temporary ? 'temporary' : options.enabled ? 'enabled' : 'disabled'
  const trace: ChatMemoryTrace = { mode, sections: [], capturedAt: Date.now() }
  if (mode !== 'enabled') return { messages: [], trace }
  const { characterId } = options
  const budget = new ContextManager({
    defaultMaxTokens: options.totalBudget,
    preserveSystem: false,
    preserveRecentRounds: 0,
  })
  const labels = new Map<string, string>()
  const unavailable: string[] = []
  const readers: [string, () => Promise<string>][] = [
    [
      '主人画像',
      async () => {
        const manager = getOwnerFactsManager(characterId)
        await manager.ensureLoaded()
        return manager.buildContext(500)
      },
    ],
    [
      '共同经历',
      async () => {
        const manager = getPetExperienceManager(characterId)
        await manager.ensureLoaded()
        return manager.buildContext(300)
      },
    ],
    ['约定与计划', async () => getCommitmentTracker(characterId).buildContext()],
    [
      '视觉记忆',
      async () => {
        const manager = getVisualMemoryManager(characterId)
        await manager.ensureLoaded()
        return manager.buildContext(200)
      },
    ],
    [
      '历史记忆',
      async () => {
        const manager = getEnhancedMemoryManager(characterId)
        await manager.ensureLoaded()
        return manager.getContextForChat(options.contextBudget, options.query)
      },
    ],
  ]
  for (const [label, read] of readers) {
    try {
      const content = await read()
      if (content.trim()) {
        const message = budget.addMessage('system', content)
        labels.set(message.id, label)
      }
    } catch {
      unavailable.push(label)
    }
  }
  const messages = budget.getContextWindow(options.totalBudget)
  trace.sections = messages.map((message) => ({
    id: message.id,
    label: labels.get(message.id) ?? '记忆上下文',
    content: message.content,
    estimatedTokens: estimateTokens(message.content),
  }))
  if (unavailable.length) trace.error = `${unavailable.join('、')}暂不可用，本轮已跳过。`
  return { messages, trace }
}
