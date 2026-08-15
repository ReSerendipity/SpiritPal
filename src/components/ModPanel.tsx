/**
 * 模组管理面板组件
 *
 * 功能概述：
 * - 角色模组安装/卸载/启用/禁用
 * - 多种导入方式：JSON粘贴、JSON文件、.petmod压缩包
 * - 模组导出（JSON和.petmod格式）、复制到剪贴板
 * - 模组创建：空白模板创建、基于内置角色导出
 * - 本地模组目录扫描
 * - SHA-256签名校验和完整性验证
 * - 成功/错误消息提示
 * - analytics埋点追踪模组安装
 *
 * 核心Hooks/状态：
 * - useState: 模组列表、选中模组、弹窗状态、输入内容、导入状态、扫描结果
 * - useRef: 文件输入引用
 * - useEffect: 初始化加载模组、订阅模组变化
 * - useCallback: 刷新模组列表函数
 *
 * 使用模块：
 * - modManager: 模组管理器（三层配置架构JSON驱动）
 * - analytics: 行为数据埋点
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { trackModInstall } from '../lib/analytics'
import {
  Package, Upload, Download, Trash2, Power, FileJson,
  Plus, Copy, Check, AlertCircle, Box, Archive, FolderSearch, Shield, Loader2,
} from 'lucide-react'
import {
  getModManager, createModTemplate,
  type ModInfo, type CharacterMod, type ScannedModInfo,
} from '../lib/modManager'
import { CHARACTERS } from '../lib/characters'
import type { CharacterProfile } from '../lib/types'

/**
 * 模组管理面板
 *
 * 提供角色模组的完整生命周期管理：安装、启用/禁用、导出、卸载、创建。
 * 支持JSON和.petmod两种格式，提供SHA-256签名校验功能。
 */
export function ModPanel() {
  const modMgr = getModManager()
  // 初始值来自管理器快照（惰性初始化），避免在 effect 中同步 setState
  const [mods, setMods] = useState<ModInfo[]>(() => modMgr.getMods())
  const [selectedMod, setSelectedMod] = useState<ModInfo | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [jsonInput, setJsonInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // .petmod 导入相关状态
  const [importing, setImporting] = useState(false)
  const [sha256Display, setSha256Display] = useState<string | null>(null)
  const [scannedMods, setScannedMods] = useState<ScannedModInfo[]>([])

  const refreshMods = useCallback(() => {
    setMods(modMgr.getMods())
  }, [modMgr])

  useEffect(() => {
    // 仅订阅变更，回调由管理器在变更时触发（非同步 setState）
    return modMgr.onChange(() => setMods(modMgr.getMods()))
  }, [modMgr])

  function flashSuccess(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 2500)
  }

  function flashError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 3500)
  }

  // 从 JSON 字符串安装
  function handleInstallFromJSON() {
    if (!jsonInput.trim()) {
      flashError('请输入有效的 JSON')
      return
    }
    const mod = modMgr.installFromJSON(jsonInput)
    if (mod) {
      trackModInstall(mod.id, mod.displayName)
      flashSuccess(`模组「${mod.displayName}」安装成功！`)
      setJsonInput('')
      setShowImport(false)
      refreshMods()
    } else {
      flashError('JSON 格式无效，请检查 petConf 和 dialogueConf 字段')
    }
  }

  // 文件导入
  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const mod = modMgr.installFromJSON(text)
      if (mod) {
        trackModInstall(mod.id, mod.displayName)
        flashSuccess(`模组「${mod.displayName}」安装成功！`)
        refreshMods()
      } else {
        flashError('文件解析失败，请检查 JSON 格式')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // 导出模组
  function handleExport(id: string) {
    const json = modMgr.exportMod(id)
    if (!json) {
      flashError('导出失败')
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${id}.petmod.json`
    a.click()
    URL.revokeObjectURL(url)
    flashSuccess('模组已导出')
  }

  // 复制 JSON 到剪贴板
  async function handleCopyJSON(id: string) {
    const json = modMgr.exportMod(id)
    if (!json) return
    try {
      await navigator.clipboard.writeText(json)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    } catch {
      flashError('复制失败')
    }
  }

  // 启用/禁用
  function handleToggle(id: string, enabled: boolean) {
    if (enabled) {
      modMgr.enableMod(id)
    } else {
      modMgr.disableMod(id)
    }
    refreshMods()
  }

  // 卸载
  function handleUninstall(id: string) {
    modMgr.uninstallMod(id)
    if (selectedMod?.id === id) setSelectedMod(null)
    refreshMods()
    flashSuccess('模组已卸载')
  }

  // 创建新模组（从模板）
  function handleCreateFromTemplate() {
    const template = createModTemplate()
    setJsonInput(JSON.stringify(template, null, 2))
    setShowCreate(false)
    setShowImport(true)
  }

  // 将内置角色转为模组格式
  function handleExportBuiltin(char: CharacterProfile) {
    const modData: CharacterMod = {
      petConf: {
        id: char.id,
        name: char.name,
        displayName: char.displayName,
        source: char.source,
        birthBackground: char.birthBackground,
        emotionalCore: char.emotionalCore,
        personality: char.personality,
        signaturePhrase: char.signaturePhrase,
        classicQuotes: char.classicQuotes,
        themeColor: char.themeColor,
        favoriteItems: char.favoriteItems ?? [],
        dislikeItems: char.dislikeItems ?? [],
        spriteAsset: char.spriteAsset,
        spriteType: char.spriteType,
        activeHours: { start: 8, end: 23 },
      },
      dialogueConf: {
        systemPrompt: char.systemPrompt,
        fewShotExamples: char.fewShotExamples,
        bubbleMessages: char.bubbleMessages,
      },
    }
    const json = JSON.stringify(modData, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${char.id}.petmod.json`
    a.click()
    URL.revokeObjectURL(url)
    flashSuccess(`已导出「${char.displayName}」为模组文件`)
  }

  // 导入 .petmod 压缩包
  async function handleImportPetmod() {
    setImporting(true)
    setSha256Display(null)
    setError(null)
    setSuccess(null)
    try {
      const result = await modMgr.importPetmodFile()
      if (result.success) {
        setSha256Display(result.sha256)
        if (result.warning) {
          flashError(`模组「${result.modId}」导入成功，但签名校验警告：${result.warning}`)
        } else {
          flashSuccess(`模组「${result.modId}」导入成功！SHA-256: ${result.sha256.slice(0, 16)}...`)
        }
        refreshMods()
      } else {
        flashError(result.error || '导入失败')
      }
    } catch (e) {
      flashError(`导入异常: ${e}`)
    } finally {
      setImporting(false)
    }
  }

  // 扫描本地模组目录
  async function handleScanLocalMods() {
    try {
      const found = await modMgr.scanLocalMods()
      setScannedMods(found)
      if (found.length > 0) {
        flashSuccess(`扫描完成，发现 ${found.length} 个本地模组`)
      } else {
        flashError('未在模组目录中发现任何模组')
      }
    } catch (e) {
      flashError(`扫描失败: ${e}`)
    }
  }

  // 校验模组签名
  async function handleVerifySignature(id: string) {
    try {
      const result = await modMgr.verifyModSignature(id)
      if (result.valid) {
        flashSuccess(result.message)
      } else {
        flashError(result.message)
      }
    } catch (e) {
      flashError(`校验失败: ${e}`)
    }
  }

  return (
    <div className="space-y-4">
      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setJsonInput(''); setShowImport(true) }}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-amber-400"
        >
          <Upload size={14} /> 导入模组
        </button>
        <button
          onClick={handleImportPetmod}
          disabled={importing}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
          {importing ? '导入中...' : '导入 .petmod 文件'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg bg-cream-deep px-3 py-1.5 text-xs text-white hover:bg-blush-soft"
        >
          <FileJson size={14} /> 从 JSON 导入
        </button>
        <button
          onClick={handleScanLocalMods}
          className="flex items-center gap-1.5 rounded-lg bg-cream-deep px-3 py-1.5 text-xs text-white hover:bg-blush-soft"
        >
          <FolderSearch size={14} /> 扫描本地模组
        </button>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-cream-deep px-3 py-1.5 text-xs text-white hover:bg-blush-soft"
        >
          <Plus size={14} /> 创建新模组
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileImport}
          className="hidden"
        />
      </div>

      {/* SHA-256 校验结果显示 */}
      {sha256Display && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-900/30 px-3 py-2 text-xs text-blue-300">
          <Shield size={14} />
          <span>SHA-256: {sha256Display}</span>
        </div>
      )}

      {/* 扫描结果 */}
      {scannedMods.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-ink-muted">本地扫描结果 ({scannedMods.length})</div>
          {scannedMods.map((sm) => (
            <div
              key={sm.id}
              className="flex items-center justify-between rounded-lg border border-ink/10 bg-surface/50 px-3 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <FolderSearch size={12} className="text-ink-muted" />
                <span className="text-ink">{sm.name}</span>
                <span className="text-ink-faint">· {sm.id}</span>
              </div>
              <span className="truncate text-[10px] text-ink-faint" title={sm.path}>{sm.path}</span>
            </div>
          ))}
        </div>
      )}

      {/* 错误/成功提示 */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-green-900/30 px-3 py-2 text-xs text-green-300">
          <Check size={14} /> {success}
        </div>
      )}

      {/* 已安装模组列表 */}
      <div className="space-y-2">
        <div className="text-xs text-ink-muted">已安装模组 ({mods.length})</div>
        {mods.length === 0 ? (
          <div className="rounded-lg border border-ink/15 p-6 text-center text-xs text-ink-muted">
            <Box size={32} className="mx-auto mb-2 opacity-40" />
            暂无自定义模组
            <div className="mt-1">导入 JSON 文件或创建新模组开始</div>
          </div>
        ) : (
          mods.map((mod) => (
            <div
              key={mod.id}
              className={`rounded-lg border p-3 transition-colors ${
                selectedMod?.id === mod.id
                  ? 'border-amber-400 bg-amber-400/5'
                  : 'border-ink/10 bg-surface/50'
              } ${mod.enabled ? '' : 'opacity-50'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Package size={14} className="text-amber-300" />
                    <span className="text-sm font-medium">{mod.displayName}</span>
                    {mod.isBuiltIn && (
                      <span className="rounded bg-blue-600/30 px-1.5 py-0.5 text-[10px] text-blue-300">内置</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-muted">
                    ID: {mod.id} · 来源: {mod.source} · v{mod.version}
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-muted">
                    安装于 {new Date(mod.installedAt).toLocaleString('zh-CN')}
                  </div>
                  {mod.sha256 && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-600">
                      <Shield size={10} />
                      <span className="truncate" title={mod.sha256}>
                        SHA-256: {mod.sha256.slice(0, 24)}...
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggle(mod.id, !mod.enabled)}
                    className={`rounded p-1.5 transition-colors ${
                      mod.enabled
                        ? 'text-green-400 hover:bg-green-600/20'
                        : 'text-ink-muted hover:bg-blush-soft/20'
                    }`}
                    title={mod.enabled ? '禁用' : '启用'}
                  >
                    <Power size={14} />
                  </button>
                  {mod.sha256 && (
                    <button
                      onClick={() => handleVerifySignature(mod.id)}
                      className="rounded p-1.5 text-emerald-500 hover:bg-emerald-600/20"
                      title="校验 SHA-256 签名"
                    >
                      <Shield size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => handleExport(mod.id)}
                    className="rounded p-1.5 text-ink-muted hover:bg-cream-deep/60 hover:text-blue-300"
                    title="导出"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={() => handleCopyJSON(mod.id)}
                    className="rounded p-1.5 text-ink-muted hover:bg-cream-deep/60 hover:text-amber-300"
                    title="复制 JSON"
                  >
                    {copiedId ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  {!mod.isBuiltIn && (
                    <button
                      onClick={() => handleUninstall(mod.id)}
                      className="rounded p-1.5 text-ink-muted hover:bg-red-600/20 hover:text-red-400"
                      title="卸载"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 导出内置角色为模组 */}
      <div className="space-y-2">
        <div className="text-xs text-ink-muted">导出内置角色为模组</div>
        <div className="flex flex-wrap gap-2">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              onClick={() => handleExportBuiltin(c)}
              className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-surface/50 px-3 py-1.5 text-xs text-ink hover:border-ink/30 hover:bg-cream-deep"
            >
              <Download size={12} /> {c.displayName}
            </button>
          ))}
        </div>
      </div>

      {/* 导入/创建模组弹窗 */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-cream-deep p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {jsonInput ? '导入/编辑模组 JSON' : '导入模组'}
              </h3>
              <button
                onClick={() => setShowImport(false)}
                className="text-ink-muted hover:text-white"
              >
                ✕
              </button>
            </div>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='粘贴模组 JSON，或点击「创建新模组」从模板开始...'
              rows={16}
              className="w-full resize-none rounded-lg bg-surface p-3 font-mono text-xs text-green-300 placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { setJsonInput(''); setShowImport(false) }}
                className="rounded-lg px-4 py-2 text-xs text-ink-muted hover:bg-cream-deep/50"
              >
                取消
              </button>
              <button
                onClick={handleInstallFromJSON}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-medium text-gray-900 hover:bg-amber-400"
              >
                安装模组
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建模组选项弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-cream-deep p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">创建新模组</h3>
              <button
                onClick={() => setShowCreate(false)}
                className="text-ink-muted hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              <button
                onClick={handleCreateFromTemplate}
                className="w-full rounded-lg border border-ink/10 bg-surface p-3 text-left hover:border-amber-400"
              >
                <div className="flex items-center gap-2 text-sm">
                  <Plus size={16} className="text-amber-300" />
                  从空白模板创建
                </div>
                <div className="mt-1 text-[11px] text-ink-muted">
                  创建一个基础模组模板，手动编辑所有字段
                </div>
              </button>
              <div className="rounded-lg border border-ink/10 bg-surface p-3 text-left">
                <div className="flex items-center gap-2 text-sm">
                  <Package size={16} className="text-blue-300" />
                  基于内置角色创建
                </div>
                <div className="mt-1 text-[11px] text-ink-muted">
                  选择一个内置角色导出为模组 JSON，修改后重新导入
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CHARACTERS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        handleExportBuiltin(c)
                        setShowCreate(false)
                      }}
                      className="rounded border border-ink/10 px-2 py-1 text-[11px] hover:border-amber-400"
                    >
                      {c.displayName}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
