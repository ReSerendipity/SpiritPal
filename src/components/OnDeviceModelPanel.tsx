/**
 * 端侧模型管理面板（设置页）
 *
 * 用途：让用户把自取的 MNN 格式模型（Qwen3.5-2B 等）加载进进程内 MNN 引擎。
 * 与「框架-only、用户自取模型权重」的分发策略一致 —— 权重绝不进安装包。
 *
 * 数据来源（Tauri 命令，**仅移动端注册**，见 `src-tauri/src/ondevice/engine.rs`）：
 * - `ondevice_models_dir`   → 模型根目录（提示用户往哪放）
 * - `ondevice_list_models`  → 扫盘得到的可用模型 + 加载状态
 * - `ondevice_load_model`   → 加载（modelId / configPath）
 * - `ondevice_unload_model` → 卸载
 *
 * 模型格式要求：**MNN 格式目录**（含 `llm.mnn` / `llm.mnn.weight` / `tokenizer.mtok` / `config.json`）。
 * GGUF 不能直接加载，需先在 PC 侧经 MNN 的 `gguf2mnn.py` / `llmexport.py` 转换
 * （见 docs/execution/ondevice-custom-model-pipeline.md）。
 *
 * @module components/OnDeviceModelPanel
 */
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { HardDrive, RefreshCw, Cpu, AlertTriangle, CheckCircle2, Download } from 'lucide-react'
import { BrandButton, BrandSwitch } from '@/components/ui'
import { isMobileRuntime } from '@/lib/system/platform'

/** 端侧偏好存于与 AI 服务商相同的 localStorage key，字段独立，互不干扰 */
const AI_CONFIG_KEY = 'spiritpal-ai-config'

/** 读取思维链开关（默认关：聊天更跟手，TTFT 从 >2min 降到 ~4s） */
function readThinking(): boolean {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (!raw) return false
    return !!JSON.parse(raw).ondeviceThinking
  } catch {
    return false
  }
}

/** 写入思维链开关（合并进已有的 AI 配置对象，不覆盖 provider / apiKey 等） */
function writeThinking(v: boolean): void {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    const j = raw ? JSON.parse(raw) : {}
    j.ondeviceThinking = v
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(j))
  } catch {
    /* 存储不可用时静默降级，开关仅在本次会话内有效 */
  }
}

/** 与 Rust `ondevice::engine::ModelInfo` 对应（Tauri 将 snake_case 字段透传为同名 JSON 键） */
interface ModelInfo {
  id: string
  available: boolean
  loaded: boolean
  path: string
  config_path: string
  size_bytes: number
  resident_bytes: number
}

/** 人类可读体积 */
function fmtBytes(n: number): string {
  if (!n) return '—'
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(n / 1024 ** 2).toFixed(0)} MB`
}

/**
 * 端侧模型管理面板。
 * 非移动端直接返回 null —— `ondevice_*` 命令只在移动端注册，桌面调用会失败。
 */
export function OnDeviceModelPanel() {
  const [dir, setDir] = useState<string>('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState<string>('')
  // 思维链（Thinking）开关：默认关，持久化到 localStorage；加载时透传给引擎覆写 config.json
  const [thinking, setThinking] = useState<boolean>(() => readThinking())

  const setThinkingPersist = useCallback((v: boolean) => {
    writeThinking(v)
    setThinking(v)
  }, [])

  const mobile = isMobileRuntime()

  /** 拉取模型目录 + 可用模型列表 */
  const refresh = useCallback(async () => {
    if (!mobile) return
    setError('')
    try {
      const d = await invoke<{ dir: string }>('ondevice_models_dir')
      setDir(d.dir)
      const list = await invoke<ModelInfo[]>('ondevice_list_models')
      setModels(list)
    } catch (e) {
      setError(String(e))
    }
  }, [mobile])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 加载指定模型 */
  const load = useCallback(
    async (m: ModelInfo) => {
      setBusy(m.id)
      setError('')
      try {
        await invoke('ondevice_load_model', {
          modelId: m.id,
          configPath: m.config_path,
          enableThinking: thinking,
        })
        await refresh()
      } catch (e) {
        setError(`加载失败：${String(e)}`)
      } finally {
        setBusy('')
      }
    },
    [refresh, thinking],
  )

  /** 卸载当前模型 */
  const unload = useCallback(
    async (m: ModelInfo) => {
      setBusy(m.id)
      setError('')
      try {
        await invoke('ondevice_unload_model', { modelId: m.id })
        await refresh()
      } catch (e) {
        setError(`卸载失败：${String(e)}`)
      } finally {
        setBusy('')
      }
    },
    [refresh],
  )

  if (!mobile) {
    return (
      <section className="rounded-xl bg-cream-deep/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Cpu size={16} className="text-tangerine-deep" />
          <h3 className="text-sm font-medium text-ink">端侧模型（MNN 内嵌）</h3>
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">
          端侧 MNN 引擎内嵌<strong>仅在 Android 构建中可用</strong>（桌面端不编译该模块）。桌面端本地推理由
          Ollama 承担；若仍想用端侧，可把服务商切到「端侧」走本机 loopback（companion 模式）。
          设计依据见 ADR-0005。
        </p>
      </section>
    )
  }

  const resident = models[0]?.resident_bytes ?? 0

  return (
    <section className="rounded-xl bg-cream-deep/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-tangerine-deep" />
          <h3 className="text-sm font-medium text-ink">端侧模型（MNN 内嵌）</h3>
        </div>
        <BrandButton variant="ghost" onClick={() => void refresh()} disabled={!!busy}>
          <RefreshCw size={14} className="mr-1" />
          刷新
        </BrandButton>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-ink-muted">
        进程内推理，敏感对话不出网。模型权重需自取 —— <strong>必须是 MNN 格式目录</strong>
        （含 <code className="rounded bg-cream-deep px-1">config.json</code> /{' '}
        <code className="rounded bg-cream-deep px-1">llm.mnn</code>）；GGUF 需先在 PC 侧转换。
      </p>

      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-cream-deep/70 p-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink">思维链（Thinking）</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-ink-faint">
            关闭可把首字延迟从 &gt;2 分钟降到约 4 秒，聊天更跟手；开启用于复杂推理。改动需重新加载模型生效。
          </div>
        </div>
        <BrandSwitch
          checked={thinking}
          onChange={setThinkingPersist}
          aria-label="思维链（Thinking）"
        />
      </div>

      {dir && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-cream-deep/70 p-3">
          <HardDrive size={14} className="mt-0.5 shrink-0 text-ink-muted" />
          <div className="min-w-0">
            <div className="text-[11px] text-ink-muted">模型目录（把模型文件夹放到这里）</div>
            <code className="block break-all text-[11px] text-ink">{dir}</code>
            <div className="mt-1 text-[10px] text-ink-faint">
              adb push &lt;本地模型目录&gt; {dir}/ &nbsp;→&nbsp; 刷新后即可加载
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {models.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-xs text-ink-muted">
          <Download size={14} />
          <span>未发现模型。请按上面的目录提示放入 MNN 格式模型后点「刷新」。</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {models.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-cream-deep/60 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium text-ink">{m.id}</span>
                  {m.loaded && (
                    <span className="flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-800">
                      <CheckCircle2 size={10} />
                      已加载
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-ink-faint">{fmtBytes(m.size_bytes)}</div>
              </div>
              {m.loaded ? (
                <BrandButton variant="ghost" onClick={() => void unload(m)} disabled={!!busy}>
                  {busy === m.id ? '卸载中…' : '卸载'}
                </BrandButton>
              ) : (
                <BrandButton onClick={() => void load(m)} disabled={!!busy}>
                  {busy === m.id ? '加载中…' : '加载'}
                </BrandButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {resident > 0 && (
        <div className="mt-3 text-[10px] text-ink-faint">
          已加载模型常驻内存合计：{fmtBytes(resident)}
        </div>
      )}
    </section>
  )
}

export default OnDeviceModelPanel
