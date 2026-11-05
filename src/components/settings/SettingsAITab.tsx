/**
 * 设置窗口 · AI 配置标签页（自 SettingsWindow.tsx 拆出，2026-11-06 巨型组件整改）
 *
 * 自包含：AI 服务商/Key/模型/温度/Token 配置、localStorage 持久化、
 * secureStorage 加载与保存（含旧数据迁移）、Ollama 本地服务检测、
 * AI 用量成本卡片、境外服务商数据出境确认弹窗、保存提示。
 * 无 props——不依赖父组件任何状态。
 */
import { useEffect, useRef, useState } from 'react'
import { BrandButton, BrandInput, BrandSelect, BrandSlider } from '@/components/ui'
import { getDualBrainRoutingSummary } from '@/lib/ai/dualBrain'
import { DEFAULT_AI_CONFIG } from '@/lib/ai/llmClient'
import { LLM_PROVIDERS, getProvider, detectOllama, listOllamaModels, costTracker } from '@/lib/ai/llmProviders'
import { setApiKey, getApiKey, deleteApiKey } from '@/lib/data/secureStorage'
import type { AIConfig } from '@/lib/data/types'
import { trackSettingChange } from '@/lib/system/analytics'

const AI_CONFIG_KEY = 'spiritpal-ai-config'

/**
 * 从localStorage加载AI配置
 * @returns 合并默认值后的AI配置
 */
function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (raw) return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) }
  } catch {
    // 忽略解析错误
  }
  return DEFAULT_AI_CONFIG
}

export default function SettingsAITab() {
  const [ai, setAI] = useState<AIConfig>(loadAIConfig)
  const [savedTip, setSavedTip] = useState(false)
  // Ollama 本地服务检测状态与运行时模型列表
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle')
  // 数据出境确认：待确认的境外服务商 / 记住选择
  const [pendingOverseasProvider, setPendingOverseasProvider] = useState<string | null>(null)
  const [rememberOverseas, setRememberOverseas] = useState(false)

  // 跳过首次 localStorage 持久化，避免覆盖旧 apiKey（待 secureStorage 迁移读取）
  const skipFirstPersistRef = useRef(true)
  // 跳过 secureStorage 自动保存（加载时设为 true，避免回写覆盖）
  const skipNextSaveRef = useRef(true)

  // AI 配置变更时持久化（不含 API Key — API Key 由 secureStorage 管理）
  useEffect(() => {
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false
      return
    }
    try {
      const { apiKey: _k, ...rest } = ai
      void _k // 避免未使用变量告警
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(rest))
    } catch {
      // 忽略存储错误
    }
  }, [ai])

  // 加载 API Key：从 secureStorage 读取；首次升级时从 localStorage 迁移
  useEffect(() => {
    const currentProvider = ai.provider
    let cancelled = false

    async function loadApiKeyForProvider() {
      try {
        let key = await getApiKey(currentProvider)

        // 兼容旧数据：secureStorage 中没有时，尝试从 localStorage 读取并迁移
        if (key === null) {
          try {
            const raw = localStorage.getItem(AI_CONFIG_KEY)
            if (raw) {
              const config = JSON.parse(raw)
              if (config.apiKey) {
                await setApiKey(currentProvider, config.apiKey)
                key = config.apiKey as string
                console.log(`[SpiritPal] Migrated API key for ${currentProvider} to secureStorage`)
              }
            }
          } catch {
            // 忽略迁移错误
          }
        }

        if (!cancelled) {
          skipNextSaveRef.current = true
          setAI((prev) => ({ ...prev, apiKey: key ?? '' }))
        }
      } catch {
        // 加载失败，保持空 apiKey
      }
    }

    loadApiKeyForProvider()
    return () => {
      cancelled = true
    }
  }, [ai.provider])

  // API Key 变更时保存到 secureStorage（加载时跳过，避免回写覆盖）
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    const provider = ai.provider
    const key = ai.apiKey
    if (key) {
      setApiKey(provider, key).catch(() => {
        // 忽略存储错误
      })
    } else {
      deleteApiKey(provider).catch(() => {
        // 忽略删除错误
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 apiKey 变化时保存；若加入 ai.provider，切换 provider 时会把旧 provider 的 key 误写到新 provider
  }, [ai.apiKey])

  function flashSaved() {
    setSavedTip(true)
    setTimeout(() => setSavedTip(false), 1200)
  }

  const OVERSEAS_PROVIDERS = new Set(['openai', 'claude', 'gemini'])

  function handleProviderChange(providerId: string) {
    // 数据出境确认：境外服务商（OpenAI / Claude / Gemini）切换前需用户确认
    // 已"记住选择"的服务商直接通过
    if (OVERSEAS_PROVIDERS.has(providerId) && providerId !== ai.provider) {
      try {
        if (localStorage.getItem(`spiritpal:overseas-consent:${providerId}`)) {
          applyProvider(providerId)
          return
        }
      } catch {
        /* localStorage 不可用时走确认流程 */
      }
      setPendingOverseasProvider(providerId)
      return
    }
    applyProvider(providerId)
  }

  function applyProvider(providerId: string) {
    const p = getProvider(providerId)
    trackSettingChange('provider', ai.provider, providerId)
    setAI((prev) => ({
      ...prev,
      provider: providerId,
      baseUrl: p?.baseUrl ?? prev.baseUrl,
      model: p?.defaultModel ?? prev.model,
    }))
    // 切换到 Ollama 时重置检测状态
    if (providerId !== 'ollama') {
      setOllamaStatus('idle')
      setOllamaModels([])
    }
  }

  // 检测本地 Ollama 服务并拉取可用模型列表
  async function handleDetectOllama() {
    setOllamaStatus('checking')
    const online = await detectOllama()
    if (online) {
      const models = await listOllamaModels()
      setOllamaModels(models)
      setOllamaStatus('online')
      // 若当前未选模型且拉取到了模型，默认选第一个
      if (models.length > 0 && !ai.model) {
        setAI((prev) => ({ ...prev, model: models[0] }))
      }
    } else {
      setOllamaModels([])
      setOllamaStatus('offline')
    }
  }

  return (
    <>
      <div className="max-w-md space-y-4">
        <h2 className="text-lg font-semibold">AI 配置</h2>

        <div>
          <label className="mb-1 block text-xs text-ink-faint">服务商</label>
          <BrandSelect
            value={ai.provider}
            onChange={(v) => handleProviderChange(v)}
            aria-label="AI 服务商"
            options={LLM_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>

        {/* API Key：Ollama 不需要，其余服务商显示 */}
        {getProvider(ai.provider)?.apiKeyRequired !== false && (
          <div>
            <label className="mb-1 block text-xs text-ink-faint">API Key</label>
            {/* M-3: 使用 BrandInput 支持密码可见性切换 */}
            <BrandInput
              type="password"
              value={ai.apiKey}
              onChange={(v) => setAI({ ...ai, apiKey: v })}
              placeholder="sk-..."
              aria-label="API Key"
            />
          </div>
        )}

        {/* Ollama 本地服务检测 */}
        {ai.provider === 'ollama' && (
          <div className="space-y-2 rounded-lg bg-cream-deep/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-faint">Ollama 本地服务</span>
              <button
                onClick={handleDetectOllama}
                disabled={ollamaStatus === 'checking'}
                className="rounded-lg bg-tangerine px-3 py-1 text-xs font-medium text-white hover:bg-tangerine-deep disabled:opacity-50"
              >
                {ollamaStatus === 'checking' ? '检测中…' : '检测服务'}
              </button>
            </div>
            {ollamaStatus === 'online' && (
              <div className="text-xs text-success-deep">● 已连接 — 共 {ollamaModels.length} 个可用模型</div>
            )}
            {ollamaStatus === 'offline' && (
              <div className="text-xs text-error">
                ● 未检测到 Ollama 服务，请确认已启动 ollama serve（默认端口 11434）
              </div>
            )}
            {ollamaStatus === 'idle' && (
              <div className="text-xs text-ink-faint">点击「检测服务」从本地 Ollama 拉取已安装的模型列表</div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-ink-faint">接口地址</label>
          <BrandInput value={ai.baseUrl} onChange={(v) => setAI({ ...ai, baseUrl: v })} aria-label="接口地址" />
        </div>

        <div>
          <label className="mb-1 block text-xs text-ink-faint">模型</label>
          {/* M-3: 模型选择统一为 BrandSelect */}
          {ai.provider === 'ollama' && ollamaModels.length > 0 ? (
            <BrandSelect
              value={ai.model}
              onChange={(v) => setAI({ ...ai, model: v })}
              aria-label="Ollama 模型"
              options={ollamaModels.map((m) => ({ value: m, label: m }))}
            />
          ) : getProvider(ai.provider)?.models.length ? (
            <BrandSelect
              value={ai.model}
              onChange={(v) => setAI({ ...ai, model: v })}
              aria-label="预设模型"
              options={getProvider(ai.provider)!.models.map((m) => ({ value: m, label: m }))}
            />
          ) : (
            <BrandInput
              value={ai.model}
              onChange={(v) => setAI({ ...ai, model: v })}
              placeholder="model-name"
              aria-label="模型名称"
            />
          )}
        </div>

        <div>
          {/* M-3: 温度滑块加刻度标注和实时值显示 */}
          <label className="mb-1 block text-xs text-ink-faint">温度</label>
          <BrandSlider
            value={ai.temperature}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => setAI({ ...ai, temperature: v })}
            formatValue={(v) => v.toFixed(1)}
            showTicks
            ticks={[
              { value: 0, label: '精确' },
              { value: 1, label: '平衡' },
              { value: 2, label: '创意' },
            ]}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-ink-faint">最大 Token</label>
          <BrandInput
            type="number"
            value={String(ai.maxTokens)}
            onChange={(v) => setAI({ ...ai, maxTokens: parseInt(v) || 1024 })}
            aria-label="最大 Token"
          />
        </div>

        {/* M-3: 使用 BrandButton 替代原生按钮 */}
        <BrandButton onClick={flashSaved} aria-label="保存 AI 配置">
          保存
        </BrandButton>

        {/* P1-3: AI 用量与成本估算（BYOK 可观测；数据来自 llmClient → costTracker） */}
        <div className="rounded-xl border border-ink-faint/20 bg-egg/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">本次运行 AI 用量</h3>
            <span className="text-[10px] text-ink-faint">会话内统计</span>
          </div>
          {(() => {
            const costs = costTracker.getAllCosts()
            const totalTokens = costs.reduce((s, c) => s + c.totalTokens, 0)
            const totalCost = costTracker.getTotalCost()
            const routing = getDualBrainRoutingSummary()
            if (costs.length === 0) {
              return (
                <p className="mt-2 text-xs text-ink-faint">
                  暂无对话记录——开始聊天后这里会显示 Token 消耗与预估成本。
                </p>
              )
            }
            return (
              <>
                <ul className="mt-2 space-y-1">
                  {costs.map((c) => (
                    <li key={c.providerId} className="flex items-center justify-between text-xs">
                      <span className="text-ink-soft">{getProvider(c.providerId)?.name ?? c.providerId}</span>
                      <span className="text-ink-faint">
                        {c.totalTokens.toLocaleString()} tokens = ${c.totalCostUsd.toFixed(4)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t border-ink-faint/10 pt-2 text-xs">
                  <span className="text-ink-soft">合计（本次运行）</span>
                  <span className="font-medium">
                    {totalTokens.toLocaleString()} tokens · ${totalCost.toFixed(4)}
                  </span>
                </div>
                {routing.total > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                    <span>双脑路由（Fast→Slow 升级率）</span>
                    <span>
                      {Math.round(routing.slowRatio * 100)}% 慢脑 · {Math.round(routing.escalationRatio * 100)}%
                      升级
                    </span>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </div>

      {pendingOverseasProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 max-w-sm rounded-2xl bg-surface p-5 shadow-xl">
            <div className="mb-2 text-base font-semibold">数据出境确认</div>
            <p className="mb-3 text-sm text-ink-muted">
              你选择的 {getProvider(pendingOverseasProvider)?.name ?? '服务商'} 位于境外，
              使用后对话内容将传输至境外服务器。请勿输入敏感个人信息。 是否继续？
            </p>
            {/* M-2: 复选框移到按钮上方，避免布局混乱误触 */}
            <label className="mb-3 flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={rememberOverseas}
                onChange={(e) => setRememberOverseas(e.target.checked)}
                className="accent-tangerine"
              />
              记住我的选择（下次不再询问）
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingOverseasProvider(null)}
                className="rounded-lg bg-cream-deep px-4 py-2 text-sm text-ink-muted hover:bg-ink/5"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (rememberOverseas) {
                    try {
                      localStorage.setItem(`spiritpal:overseas-consent:${pendingOverseasProvider}`, '1')
                    } catch (e) {
                      console.warn('[overseas-consent] failed to save:', e)
                    }
                  }
                  applyProvider(pendingOverseasProvider)
                  setPendingOverseasProvider(null)
                }}
                className="rounded-lg bg-tangerine px-4 py-2 text-sm text-white hover:bg-tangerine-deep"
              >
                同意并继续
              </button>
            </div>
          </div>
        </div>
      )}

      {savedTip && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-green-600 px-4 py-1.5 text-sm">
          已保存 ✓
        </div>
      )}
    </>
  )
}
