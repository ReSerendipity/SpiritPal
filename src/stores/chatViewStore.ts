import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ChatViewOption = 'showMetrics' | 'showThinking' | 'showMemory' | 'showTimestamps' | 'compact'
type DisplayOptions = Record<ChatViewOption, boolean>

interface ChatViewState extends DisplayOptions {
  setOption: (key: ChatViewOption, value: boolean) => void
  setMode: (mode: 'full' | 'simple') => void
}

const defaults: DisplayOptions = {
  showMetrics: true,
  showThinking: true,
  showMemory: true,
  showTimestamps: true,
  compact: false,
}

/** Only display preferences belong here; request settings and message data never do. */
export const useChatViewStore = create<ChatViewState>()(
  persist(
    (set) => ({
      ...defaults,
      setOption: (key, value) => set({ [key]: value }),
      setMode: (mode) =>
        set({
          showMetrics: mode === 'full',
          showThinking: mode === 'full',
          showMemory: mode === 'full',
          showTimestamps: mode === 'full',
        }),
    }),
    {
      name: 'spiritpal-chat-view',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ showMetrics, showThinking, showMemory, showTimestamps, compact }) => ({
        showMetrics,
        showThinking,
        showMemory,
        showTimestamps,
        compact,
      }),
      merge: (persisted, current) => {
        const options = { ...current }
        if (persisted && typeof persisted === 'object') {
          for (const key of Object.keys(defaults) as ChatViewOption[]) {
            const value = (persisted as Record<string, unknown>)[key]
            if (typeof value === 'boolean') options[key] = value
          }
        }
        return options
      },
    },
  ),
)
