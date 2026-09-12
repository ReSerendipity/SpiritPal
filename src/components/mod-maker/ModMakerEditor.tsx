/**
 * ModMakerEditor — Mod 可视化编辑器主组件
 *
 * @fileoverview 左侧表单编辑区（基础属性/动画/表情/物品/对话 5 个 tab），
 * 右侧实时预览面板，底部导出 .petmod 按钮。
 *
 * 数据流：
 * - EditorState（扁平表单状态）存于组件 useState
 * - 右侧预览直接从 state 派生渲染，字段变更实时更新
 * - 导出时 buildCharacterMod()/buildManifest() → 写入临时目录 →
 *   ModPackager.pack() 导出 .petmod
 *
 * 素材拖拽：拖入精灵图文件后，以相对路径 sprites/<文件名> 记录到
 *   petConf.spriteAsset（导入侧按相对/asset:// 解析）
 */

import { appDataDir, join } from '@tauri-apps/api/path'
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { ArrowDown, ArrowUp, Download, Image as ImageIcon, Plus, Trash2 } from 'lucide-react'
import { BrandButton, BrandInput, BrandSelect, BrandSwitch } from '@/components/ui'
import {
  BUBBLE_KEYS,
  PET_STATE_OPTIONS,
  SPRITE_TYPE_OPTIONS,
  buildCharacterMod,
  buildManifest,
  createEmptyEditorState,
  validateEditorState,
  type AnimationRowState,
  type BubbleKey,
  type EditorState,
  type ItemRowState,
  type PairRowState,
} from '@/lib/data/modMaker'
import { getModPackager } from '@/lib/data/modPackager'

// ============ 类型与常量 ============

export interface ModMakerEditorProps {
  /** 导出成功回调（可选） */
  onExported?: (result: { outputPath: string; sha256?: string }) => void
}

type TabKey = 'basic' | 'anim' | 'emote' | 'items' | 'dialogue'

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'basic', label: '基础属性' },
  { key: 'anim', label: '动画' },
  { key: 'emote', label: '表情' },
  { key: 'items', label: '物品' },
  { key: 'dialogue', label: '对话' },
]

const EMPTY_ANIMATION_ROW: Omit<AnimationRowState, 'state'> = {
  baseProb: 5,
  tier: 2,
  minAffectionLevel: 0,
  inPlaylist: true,
}

const EMPTY_ITEM_ROW: ItemRowState = { id: '', name: '', icon: '', type: 'food', price: 10 }

// ============ 通用小部件 ============

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <BrandInput
        type="number"
        value={String(value)}
        onChange={(v) => onChange(Number.isNaN(Number(v)) ? 0 : Number(v))}
      />
    </Field>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-muted">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-tangerine"
      />
    </label>
  )
}

/** 行级小操作按钮（上移/下移/删除） */
function RowActions({
  index,
  total,
  onMove,
  onRemove,
}: {
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <BrandButton
        variant="ghost"
        size="sm"
        aria-label="上移"
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp size={14} />
      </BrandButton>
      <BrandButton
        variant="ghost"
        size="sm"
        aria-label="下移"
        disabled={index === total - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown size={14} />
      </BrandButton>
      <BrandButton variant="ghost" size="sm" aria-label="删除" onClick={onRemove}>
        <Trash2 size={14} />
      </BrandButton>
    </div>
  )
}

/** 数组行排序工具：交换 i 与 i+dir */
function moveRow<T>(rows: readonly T[], index: number, dir: -1 | 1): T[] {
  const next = [...rows]
  const target = index + dir
  if (target < 0 || target >= next.length) return rows as T[]
  const tmp = next[index]
  if (!tmp) return rows as T[]
  next[index] = next[target] as T
  next[target] = tmp
  return next
}

// ============ 主组件 ============

export function ModMakerEditor({ onExported }: ModMakerEditorProps) {
  const [state, setState] = useState<EditorState>(createEmptyEditorState)
  const [tab, setTab] = useState<TabKey>('basic')
  const [exporting, setExporting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [exportMessage, setExportMessage] = useState('')
  const [dragOver, setDragOver] = useState(false)

  /** 浅合并更新顶层字段 */
  function patch(patchValue: Partial<EditorState>): void {
    setState((prev) => ({ ...prev, ...patchValue }))
  }

  // ---- 动画行操作 ----

  function updateAnimationRow(index: number, patchValue: Partial<AnimationRowState>): void {
    setState((prev) => ({
      ...prev,
      animations: prev.animations.map((row, i) => (i === index ? { ...row, ...patchValue } : row)),
    }))
  }

  // ---- 物品行操作 ----

  function updateItemRows(
    key: 'foods' | 'toys' | 'medicines',
    index: number,
    patchValue: Partial<ItemRowState>,
  ): void {
    setState((prev) => ({
      ...prev,
      [key]: prev[key].map((row, i) => (i === index ? { ...row, ...patchValue } : row)),
    }))
  }

  // ---- 表情映射行操作 ----

  function updateMotionMapRow(index: number, patchValue: Partial<PairRowState>): void {
    setState((prev) => ({
      ...prev,
      motionMap: prev.motionMap.map((row, i) => (i === index ? { ...row, ...patchValue } : row)),
    }))
  }

  // ---- 精灵图拖拽上传 ----

  function handleSpriteDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.name) {
      // 以包内相对路径记录（导入侧按 sprites/<name> 解析）
      patch({ spriteAsset: `sprites/${file.name}` })
    }
  }

  // ---- 导出 ----

  async function handleExport(): Promise<void> {
    const validationErrors = validateEditorState(state)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      setExportMessage('')
      return
    }

    setExporting(true)
    setErrors([])
    setExportMessage('')
    try {
      const mod = buildCharacterMod(state)
      const manifest = buildManifest(state)

      // 1. 将包文件写入临时源目录
      const tmpDir = await join(await appDataDir(), 'mod-maker-tmp', manifest.id)
      await mkdir(tmpDir, { recursive: true })
      await writeTextFile(await join(tmpDir, 'petmod.json'), JSON.stringify(manifest, null, 2))
      await writeTextFile(await join(tmpDir, 'pet_conf.json'), JSON.stringify(mod.petConf, null, 2))
      await writeTextFile(await join(tmpDir, 'act_conf.json'), JSON.stringify(mod.actConf, null, 2))
      await writeTextFile(await join(tmpDir, 'items_config.json'), JSON.stringify(mod.itemsConf, null, 2))
      await writeTextFile(await join(tmpDir, 'dialogue.json'), JSON.stringify(mod.dialogueConf, null, 2))

      // 2. 调用打包器导出 .petmod
      const result = await getModPackager().pack({ sourceDir: tmpDir })
      if (result.success && result.outputPath) {
        setExportMessage(`导出成功：${result.outputPath}`)
        onExported?.({ outputPath: result.outputPath, sha256: result.sha256 })
      } else {
        setErrors([result.error ?? '打包失败'])
      }
    } catch (e) {
      setErrors([`导出失败：${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setExporting(false)
    }
  }

  // ---- 渲染 ----

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* 标题栏 */}
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">ModMaker · Mod 可视化编辑器</h2>
        <span className="text-xs text-ink-faint">{state.id || '未命名'} v{state.version}</span>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* ============ 左侧：表单编辑区 ============ */}
        <div className="flex w-1/2 flex-col gap-3 overflow-y-auto pr-1">
          {/* Tab 切换 */}
          <div className="flex gap-1 rounded-lg bg-ink/5 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  tab === t.key
                    ? 'bg-tangerine text-white'
                    : 'text-ink-muted hover:bg-ink/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ---- 基础属性 ---- */}
          {tab === 'basic' && (
            <div className="flex flex-col gap-3">
              <Field label="角色显示名（displayName）">
                <BrandInput
                  value={state.displayName}
                  onChange={(v) => patch({ displayName: v })}
                  aria-label="角色显示名"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mod ID（kebab-case）">
                  <BrandInput value={state.id} onChange={(v) => patch({ id: v })} aria-label="Mod ID" />
                </Field>
                <Field label="内部名称（name）">
                  <BrandInput value={state.name} onChange={(v) => patch({ name: v })} aria-label="内部名称" />
                </Field>
                <Field label="版本（SemVer）">
                  <BrandInput
                    value={state.version}
                    onChange={(v) => patch({ version: v })}
                    aria-label="版本号"
                  />
                </Field>
                <Field label="作者">
                  <BrandInput value={state.author} onChange={(v) => patch({ author: v })} aria-label="作者" />
                </Field>
              </div>
              <TextAreaField
                label="描述"
                value={state.description}
                onChange={(v) => patch({ description: v })}
                rows={2}
              />
              <Field label="来源（source）">
                <BrandInput value={state.source} onChange={(v) => patch({ source: v })} />
              </Field>
              <TextAreaField
                label="出生背景（birthBackground）"
                value={state.birthBackground}
                onChange={(v) => patch({ birthBackground: v })}
                rows={2}
              />
              <TextAreaField
                label="情感内核（emotionalCore）"
                value={state.emotionalCore}
                onChange={(v) => patch({ emotionalCore: v })}
                rows={2}
              />
              <Field label="签名台词（signaturePhrase）">
                <BrandInput
                  value={state.signaturePhrase}
                  onChange={(v) => patch({ signaturePhrase: v })}
                />
              </Field>
              <TextAreaField
                label="经典台词（每行一条）"
                value={state.classicQuotesText}
                onChange={(v) => patch({ classicQuotesText: v })}
                rows={3}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label="主题色（primary）">
                  <BrandInput
                    value={state.themeColorPrimary}
                    onChange={(v) => patch({ themeColorPrimary: v })}
                  />
                </Field>
                <Field label="主题色（secondary）">
                  <BrandInput
                    value={state.themeColorSecondary}
                    onChange={(v) => patch({ themeColorSecondary: v })}
                  />
                </Field>
                <Field label="精灵图资源（spriteAsset）">
                  <BrandInput
                    value={state.spriteAsset}
                    onChange={(v) => patch({ spriteAsset: v })}
                  />
                </Field>
                <Field label="精灵图类型（spriteType）">
                  <BrandSelect
                    value={state.spriteType}
                    onChange={(v) => patch({ spriteType: v as EditorState['spriteType'] })}
                    options={SPRITE_TYPE_OPTIONS.map((t) => ({ value: t, label: t }))}
                  />
                </Field>
                <NumberField
                  label="活跃开始小时（0-23）"
                  value={state.activeStart}
                  onChange={(v) => patch({ activeStart: v })}
                />
                <NumberField
                  label="活跃结束小时（0-23）"
                  value={state.activeEnd}
                  onChange={(v) => patch({ activeEnd: v })}
                />
              </div>
              <div className="grid grid-cols-5 gap-2">
                <NumberField
                  label="温度"
                  value={state.personality.warmth}
                  onChange={(v) => patch({ personality: { ...state.personality, warmth: v } })}
                />
                <NumberField
                  label="活泼"
                  value={state.personality.liveliness}
                  onChange={(v) => patch({ personality: { ...state.personality, liveliness: v } })}
                />
                <NumberField
                  label="依赖"
                  value={state.personality.dependence}
                  onChange={(v) => patch({ personality: { ...state.personality, dependence: v } })}
                />
                <NumberField
                  label="直率"
                  value={state.personality.directness}
                  onChange={(v) => patch({ personality: { ...state.personality, directness: v } })}
                />
                <NumberField
                  label="理性"
                  value={state.personality.rationality}
                  onChange={(v) => patch({ personality: { ...state.personality, rationality: v } })}
                />
              </div>
              <TextAreaField
                label="喜欢的物品（每行一条）"
                value={state.favoriteItemsText}
                onChange={(v) => patch({ favoriteItemsText: v })}
                rows={2}
              />
              <TextAreaField
                label="讨厌的物品（每行一条）"
                value={state.dislikeItemsText}
                onChange={(v) => patch({ dislikeItemsText: v })}
                rows={2}
              />
            </div>
          )}

          {/* ---- 动画 ---- */}
          {tab === 'anim' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-ink-faint">
                每行一条动画配置（对应 act_conf.json 的 animations），共 {state.animations.length} 条
              </p>
              {state.animations.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-ink/10 bg-surface p-2"
                >
                  <BrandSelect
                    aria-label={`动画 ${i + 1} 状态`}
                    value={row.state}
                    onChange={(v) => updateAnimationRow(i, { state: v as AnimationRowState['state'] })}
                    options={PET_STATE_OPTIONS.map((s) => ({ value: s, label: s }))}
                  />
                  <BrandInput
                    aria-label={`动画 ${i + 1} 权重`}
                    type="number"
                    value={String(row.baseProb)}
                    onChange={(v) => updateAnimationRow(i, { baseProb: Number(v) || 0 })}
                  />
                  <BrandSelect
                    aria-label={`动画 ${i + 1} 档位`}
                    value={String(row.tier)}
                    onChange={(v) => updateAnimationRow(i, { tier: Number(v) })}
                    options={['0', '1', '2', '3'].map((t) => ({ value: t, label: `档${t}` }))}
                  />
                  <BrandInput
                    aria-label={`动画 ${i + 1} 解锁亲密度`}
                    type="number"
                    value={String(row.minAffectionLevel)}
                    onChange={(v) => updateAnimationRow(i, { minAffectionLevel: Number(v) || 0 })}
                  />
                  <BrandSwitch
                    aria-label={`动画 ${i + 1} 播放列表`}
                    checked={row.inPlaylist}
                    onChange={(checked) => updateAnimationRow(i, { inPlaylist: checked })}
                  />
                  <RowActions
                    index={i}
                    total={state.animations.length}
                    onMove={(dir) =>
                      setState((prev) => ({ ...prev, animations: moveRow(prev.animations, i, dir) }))
                    }
                    onRemove={() =>
                      setState((prev) => ({
                        ...prev,
                        animations: prev.animations.filter((_, j) => j !== i),
                      }))
                    }
                  />
                </div>
              ))}
              <BrandButton
                variant="secondary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    animations: [
                      ...prev.animations,
                      { state: 'idle', ...EMPTY_ANIMATION_ROW },
                    ],
                  }))
                }
              >
                添加动画
              </BrandButton>
            </div>
          )}

          {/* ---- 表情 ---- */}
          {tab === 'emote' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-ink-faint">表情 → 动画动作映射（motionMap）</p>
              {state.motionMap.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-ink/10 bg-surface p-2"
                >
                  <BrandInput
                    aria-label={`表情 ${i + 1} 名称`}
                    value={row.key}
                    placeholder="表情名"
                    onChange={(v) => updateMotionMapRow(i, { key: v })}
                  />
                  <span className="text-ink-faint">→</span>
                  <BrandInput
                    aria-label={`表情 ${i + 1} 动作`}
                    value={row.value}
                    placeholder="动作名"
                    onChange={(v) => updateMotionMapRow(i, { value: v })}
                  />
                  <RowActions
                    index={i}
                    total={state.motionMap.length}
                    onMove={(dir) =>
                      setState((prev) => ({ ...prev, motionMap: moveRow(prev.motionMap, i, dir) }))
                    }
                    onRemove={() =>
                      setState((prev) => ({
                        ...prev,
                        motionMap: prev.motionMap.filter((_, j) => j !== i),
                      }))
                    }
                  />
                </div>
              ))}
              <BrandButton
                variant="secondary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    motionMap: [...prev.motionMap, { key: '', value: '' }],
                  }))
                }
              >
                添加表情映射
              </BrandButton>
            </div>
          )}

          {/* ---- 物品 ---- */}
          {tab === 'items' && (
            <div className="flex flex-col gap-4">
              {(['foods', 'toys', 'medicines'] as const).map((section) => (
                <div key={section} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink">
                      {section === 'foods' ? '食物' : section === 'toys' ? '玩具' : '药品'}
                      （{state[section].length}）
                    </span>
                    <BrandButton
                      variant="ghost"
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          [section]: [...prev[section], { ...EMPTY_ITEM_ROW, type: section === 'foods' ? 'food' : section === 'toys' ? 'toy' : 'medicine' }],
                        }))
                      }
                    >
                      添加
                    </BrandButton>
                  </div>
                  {state[section].map((row, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-ink/10 bg-surface p-2"
                    >
                      <BrandInput
                        aria-label={`物品 ${i + 1} ID`}
                        value={row.id}
                        placeholder="id"
                        onChange={(v) => updateItemRows(section, i, { id: v })}
                      />
                      <BrandInput
                        aria-label={`物品 ${i + 1} 名称`}
                        value={row.name}
                        placeholder="名称"
                        onChange={(v) => updateItemRows(section, i, { name: v })}
                      />
                      <BrandInput
                        aria-label={`物品 ${i + 1} 图标`}
                        value={row.icon}
                        placeholder="icon"
                        onChange={(v) => updateItemRows(section, i, { icon: v })}
                      />
                      <BrandInput
                        aria-label={`物品 ${i + 1} 价格`}
                        type="number"
                        value={String(row.price)}
                        onChange={(v) => updateItemRows(section, i, { price: Number(v) || 0 })}
                      />
                      <RowActions
                        index={i}
                        total={state[section].length}
                        onMove={(dir) =>
                          setState((prev) => ({ ...prev, [section]: moveRow(prev[section], i, dir) }))
                        }
                        onRemove={() =>
                          setState((prev) => ({
                            ...prev,
                            [section]: prev[section].filter((_, j) => j !== i),
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* ---- 对话 ---- */}
          {tab === 'dialogue' && (
            <div className="flex flex-col gap-3">
              <TextAreaField
                label="System Prompt"
                value={state.systemPrompt}
                onChange={(v) => patch({ systemPrompt: v })}
                rows={4}
              />
              <p className="text-xs text-ink-faint">Few-shot 示例（{state.fewShotExamples.length} 条）</p>
              {state.fewShotExamples.map((turn, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-ink/10 bg-surface p-2"
                >
                  <BrandInput
                    aria-label={`示例 ${i + 1} 用户`}
                    value={turn.user}
                    placeholder="用户"
                    onChange={(v) =>
                      setState((prev) => ({
                        ...prev,
                        fewShotExamples: prev.fewShotExamples.map((t, j) =>
                          j === i ? { ...t, user: v } : t,
                        ),
                      }))
                    }
                  />
                  <BrandInput
                    aria-label={`示例 ${i + 1} 助手`}
                    value={turn.assistant}
                    placeholder="助手"
                    onChange={(v) =>
                      setState((prev) => ({
                        ...prev,
                        fewShotExamples: prev.fewShotExamples.map((t, j) =>
                          j === i ? { ...t, assistant: v } : t,
                        ),
                      }))
                    }
                  />
                  <BrandButton
                    variant="ghost"
                    size="sm"
                    aria-label="删除示例"
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        fewShotExamples: prev.fewShotExamples.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    <Trash2 size={14} />
                  </BrandButton>
                </div>
              ))}
              <BrandButton
                variant="secondary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    fewShotExamples: [...prev.fewShotExamples, { user: '', assistant: '' }],
                  }))
                }
              >
                添加示例
              </BrandButton>
              <p className="text-xs text-ink-faint">气泡消息（每行一条）</p>
              {BUBBLE_KEYS.map((key: BubbleKey) => (
                <TextAreaField
                  key={key}
                  label={key}
                  value={state.bubbleMessages[key].join('\n')}
                  rows={2}
                  onChange={(v) =>
                    setState((prev) => ({
                      ...prev,
                      bubbleMessages: {
                        ...prev.bubbleMessages,
                        [key]: v.split('\n').map((s) => s.trim()).filter((s) => s.length > 0),
                      },
                    }))
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* ============ 右侧：实时预览面板 ============ */}
        <div className="flex w-1/2 flex-col gap-3 overflow-y-auto">
          {/* 摘要卡片 */}
          <div className="rounded-xl border border-ink/10 bg-surface p-4">
            <div className="flex items-center gap-2">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ backgroundColor: state.themeColorPrimary }}
                aria-hidden="true"
              >
                <ImageIcon size={20} className="text-white" />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink">{state.displayName || '未命名角色'}</div>
                <div className="text-xs text-ink-faint">
                  {state.id || '—'} · v{state.version || '—'} · {state.author || '无作者'}
                </div>
              </div>
            </div>
            {state.description && (
              <p className="mt-2 text-xs text-ink-muted">{state.description}</p>
            )}
            <p className="mt-2 text-xs text-ink-faint">
              精灵图：{state.spriteAsset}（{state.spriteType}）· 活跃 {state.activeStart}:00-{state.activeEnd}:00
            </p>
          </div>

          {/* 精灵图拖拽区 */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleSpriteDrop}
            data-testid="sprite-dropzone"
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-colors ${
              dragOver ? 'border-tangerine bg-tangerine-soft' : 'border-ink/20'
            }`}
          >
            <ImageIcon size={24} className="mb-1 text-ink-faint" />
            <p className="text-xs text-ink-muted">拖拽精灵图文件到此处</p>
            <p className="text-xs text-ink-faint">
              将记录为 {state.spriteAsset.startsWith('sprites/') ? state.spriteAsset : 'sprites/<文件名>'}
            </p>
          </div>

          {/* 动画列表预览 */}
          <div className="rounded-xl border border-ink/10 bg-surface p-4">
            <h3 className="mb-2 text-xs font-semibold text-ink">
              动画列表（{state.animations.length}）
            </h3>
            <ul className="flex flex-col gap-1">
              {state.animations.map((row, i) => (
                <li key={i} className="flex justify-between text-xs text-ink-muted">
                  <span>{row.state}</span>
                  <span className="text-ink-faint">
                    权重 {row.baseProb} · 档{row.tier} · 亲密度≥{row.minAffectionLevel}
                    {row.inPlaylist ? '' : ' · 未入播放列表'}
                  </span>
                </li>
              ))}
              {state.animations.length === 0 && (
                <li className="text-xs text-ink-faint">暂无动画</li>
              )}
            </ul>
          </div>

          {/* 物品与对话摘要 */}
          <div className="rounded-xl border border-ink/10 bg-surface p-4">
            <h3 className="mb-2 text-xs font-semibold text-ink">摘要</h3>
            <ul className="flex flex-col gap-1 text-xs text-ink-muted">
              <li>表情映射：{state.motionMap.filter((m) => m.key).length} 条</li>
              <li>
                物品：食物 {state.foods.length} · 玩具 {state.toys.length} · 药品{' '}
                {state.medicines.length}
              </li>
              <li>
                气泡消息：
                {BUBBLE_KEYS.reduce((sum, key) => sum + state.bubbleMessages[key].length, 0)} 条
              </li>
              <li>Few-shot 示例：{state.fewShotExamples.length} 条</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ============ 底部：导出栏 ============ */}
      <footer className="flex items-center gap-3 border-t border-ink/10 pt-3">
        <BrandButton
          variant="primary"
          icon={<Download size={16} />}
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          {exporting ? '导出中…' : '导出 .petmod'}
        </BrandButton>
        {exportMessage && <span className="text-xs text-success-deep">{exportMessage}</span>}
        {errors.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-error" data-testid="export-errors">
            {errors.map((err) => (
              <li key={err}>• {err}</li>
            ))}
          </ul>
        )}
      </footer>
    </div>
  )
}
