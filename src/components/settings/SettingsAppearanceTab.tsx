/**
 * 设置窗口 · 外观标签页（自 SettingsWindow.tsx 拆出，2026-11-06 巨型组件整改）
 *
 * 自包含：主题模式（浅色/深色/跟随系统）、宠物大小/透明度、角色切换、
 * 主题色预览、背景自定义（纯色/渐变/图片）、装饰品管理入口。
 * 角色创建/导入的三个入口按钮通过回调打开父级弹窗（弹窗仍挂载在窗口层，
 * 保持与拆分前相同的 DOM 位置）。
 */
import { useEffect, useState } from 'react'
import { Bot, Sparkles, Upload } from 'lucide-react'
import { DecorationEditor } from '@/components/DecorationEditor'
import { getCharacter, getAllCharacters } from '@/lib/data/characters'
import type { BackgroundConfig, BackgroundType } from '@/lib/data/types'
import { trackImageSwitch } from '@/lib/system/analytics'
import { themeManager, type ThemeMode } from '@/lib/system/themeManager'
import { validateUploadMagic } from '@/lib/system/uploadMagic'
import { usePetStore } from '@/stores/petStore'
import { useSettingsStore } from '@/stores/settingsStore'

const selectUpdateSettings = (s: ReturnType<typeof useSettingsStore.getState>) => s.updateSettings
const selectSwitchSettingsChar = (s: ReturnType<typeof useSettingsStore.getState>) => s.switchCharacter
const selectSwitchPetChar = (s: ReturnType<typeof usePetStore.getState>) => s.switchCharacter
const selectInitCharacter = (s: ReturnType<typeof usePetStore.getState>) => s.initCharacter
const selectBackground = (s: ReturnType<typeof usePetStore.getState>) => s.background
const selectSetBackground = (s: ReturnType<typeof usePetStore.getState>) => s.setBackground

interface SettingsAppearanceTabProps {
  onOpenCreator: () => void
  onOpenWizard: () => void
  onOpenImporter: () => void
}

export default function SettingsAppearanceTab({
  onOpenCreator,
  onOpenWizard,
  onOpenImporter,
}: SettingsAppearanceTabProps) {
  const settings = useSettingsStore()
  const updateSettings = useSettingsStore(selectUpdateSettings)
  const switchSettingsChar = useSettingsStore(selectSwitchSettingsChar)
  const switchPetChar = usePetStore(selectSwitchPetChar)
  const initCharacter = usePetStore(selectInitCharacter)
  const background = usePetStore(selectBackground)
  const setBackground = usePetStore(selectSetBackground)

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => themeManager.getMode())
  useEffect(() => {
    // 权威状态由 themeManager.subscribe 回填（含 setMode 对相同值的 early-return 场景）
    setThemeMode(themeManager.getMode())
    return themeManager.subscribe((_effective, mode) => setThemeMode(mode))
  }, [])

  function handleSwitchCharacter(id: string) {
    trackImageSwitch(settings.currentCharacterId, id)
    initCharacter(id)
    switchPetChar(id)
    switchSettingsChar(id)
  }

  // 背景图片选择——读取为 data URL 以持久化
  async function handleBackgroundImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // [SECURITY] 魔数校验：叠加 Rust 端纵深防御，阻断伪装图片（未知扩展名如 svg/avif 跳过）
    const magicError = await validateUploadMagic(file)
    if (magicError) {
      alert(magicError)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setBackground({ type: 'image', imagePath: reader.result as string })
    }
    reader.readAsDataURL(file)
  }

  function handleBackgroundTypeChange(type: BackgroundType) {
    const defaults: Record<BackgroundType, BackgroundConfig> = {
      none: { type: 'none' },
      solid: { type: 'solid', color: '#1a1a2e' },
      gradient: { type: 'gradient', color: '#667eea', color2: '#764ba2', direction: 'to bottom' },
      image: { type: 'image' },
    }
    setBackground({ ...defaults[type], imagePath: type === 'image' ? background.imagePath : undefined })
  }

  const character = getCharacter(settings.currentCharacterId)

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-lg font-semibold">外观</h2>

      {/* 主题模式（浅色/深色/跟随系统）——桌面端此前无任何入口 */}
      <div>
        <label className="mb-1 block text-xs text-ink-faint">主题</label>
        <div className="flex gap-1 rounded-lg bg-cream-deep p-1">
          {(
            [
              { mode: 'light', label: '浅色' },
              { mode: 'dark', label: '深色' },
              { mode: 'system', label: '跟随系统' },
            ] as { mode: ThemeMode; label: string }[]
          ).map((opt) => (
            <button
              key={opt.mode}
              onClick={() => themeManager.setMode(opt.mode)}
              aria-pressed={themeMode === opt.mode}
              className={`flex-1 rounded-md px-2 py-1 text-xs transition-colors ${
                themeMode === opt.mode ? 'bg-tangerine text-white' : 'text-ink-muted hover:bg-ink/20'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-faint">宠物大小：{settings.petSize.toFixed(1)}×</label>
        <input
          type="range"
          min={0.5}
          max={3.0}
          step={0.1}
          value={settings.petSize}
          onChange={(e) => updateSettings({ petSize: parseFloat(e.target.value) })}
          className="w-full accent-tangerine"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-faint">
          宠物透明度：{Math.round(settings.petOpacity * 100)}%
        </label>
        <input
          type="range"
          min={0.3}
          max={1.0}
          step={0.05}
          value={settings.petOpacity}
          onChange={(e) => updateSettings({ petOpacity: parseFloat(e.target.value) })}
          className="w-full accent-tangerine"
        />
      </div>

      <div>
        <label className="mb-2 block text-xs text-ink-faint">当前角色</label>
        <div className="flex gap-2 flex-wrap max-h-40 overflow-y-auto">
          {getAllCharacters().map((c) => {
            const active = c.id === settings.currentCharacterId
            return (
              <button
                key={c.id}
                onClick={() => handleSwitchCharacter(c.id)}
                className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm transition-all ${
                  active ? 'border-tangerine bg-tangerine/10' : 'border-ink/10 hover:border-ink/30'
                }`}
              >
                <div
                  className="mx-auto mb-1 h-6 w-6 rounded-full"
                  style={{
                    background: `linear-gradient(135deg, ${c.themeColor.primary}, ${c.themeColor.secondary})`,
                  }}
                />
                {c.displayName}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={onOpenCreator}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-tangerine/40 px-3 py-2 text-sm text-tangerine-deep hover:bg-tangerine/10"
          >
            <Bot size={14} /> 创建新角色
          </button>
          <button
            onClick={onOpenWizard}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-tangerine/40 px-3 py-2 text-sm text-tangerine-deep hover:bg-tangerine/10"
          >
            <Sparkles size={14} /> AI 创建角色
          </button>
          <button
            onClick={onOpenImporter}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-tangerine/40 px-3 py-2 text-sm text-tangerine-deep hover:bg-tangerine/10"
          >
            <Upload size={14} /> 导入角色
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-faint">主题色预览</label>
        <div className="flex gap-2">
          <div className="h-10 flex-1 rounded-lg" style={{ background: character?.themeColor.primary }} />
          <div className="h-10 flex-1 rounded-lg" style={{ background: character?.themeColor.secondary }} />
        </div>
      </div>

      {/* 背景自定义 */}
      <div>
        <label className="mb-2 block text-xs text-ink-faint">背景</label>
        <div className="space-y-3 rounded-lg bg-cream-deep/50 p-3">
          {/* 背景类型选择 */}
          <div className="flex gap-1 rounded-lg bg-cream-deep p-1">
            {(
              [
                { type: 'none', label: '无' },
                { type: 'solid', label: '纯色' },
                { type: 'gradient', label: '渐变' },
                { type: 'image', label: '图片' },
              ] as { type: BackgroundType; label: string }[]
            ).map((opt) => (
              <button
                key={opt.type}
                onClick={() => handleBackgroundTypeChange(opt.type)}
                className={`flex-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  background.type === opt.type ? 'bg-tangerine text-white' : 'text-ink-muted hover:bg-ink/20'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 纯色背景 */}
          {background.type === 'solid' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-faint">颜色</span>
              <input
                type="color"
                value={background.color ?? '#1a1a2e'}
                onChange={(e) => setBackground({ ...background, color: e.target.value })}
                className="h-8 w-12 cursor-pointer rounded border border-ink/10 bg-transparent"
              />
              <span className="text-xs text-ink-faint">{background.color}</span>
            </div>
          )}

          {/* 渐变背景 */}
          {background.type === 'gradient' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-faint">颜色1</span>
                <input
                  type="color"
                  value={background.color ?? '#667eea'}
                  onChange={(e) => setBackground({ ...background, color: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border border-ink/10 bg-transparent"
                />
                <span className="text-xs text-ink-faint">颜色2</span>
                <input
                  type="color"
                  value={background.color2 ?? '#764ba2'}
                  onChange={(e) => setBackground({ ...background, color2: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border border-ink/10 bg-transparent"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-faint">方向</span>
                <select
                  value={background.direction ?? 'to bottom'}
                  onChange={(e) => setBackground({ ...background, direction: e.target.value })}
                  className="flex-1 rounded-lg bg-surface px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tangerine"
                >
                  <option value="to top">向上</option>
                  <option value="to bottom">向下</option>
                  <option value="to left">向左</option>
                  <option value="to right">向右</option>
                  <option value="to top right">右上</option>
                  <option value="to bottom right">右下</option>
                  <option value="to top left">左上</option>
                  <option value="to bottom left">左下</option>
                  <option value="45deg">45°</option>
                  <option value="135deg">135°</option>
                </select>
              </div>
              {/* 渐变预览 */}
              <div
                className="h-8 w-full rounded-lg"
                style={{
                  background: `linear-gradient(${background.direction ?? 'to bottom'}, ${background.color ?? '#667eea'}, ${background.color2 ?? '#764ba2'})`,
                }}
              />
            </div>
          )}

          {/* 图片背景 */}
          {background.type === 'image' && (
            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                onChange={handleBackgroundImageSelect}
                className="w-full text-xs text-ink-muted file:mr-2 file:rounded file:border-0 file:bg-tangerine file:px-2 file:py-1 file:text-xs file:text-white hover:file:bg-tangerine"
              />
              {background.imagePath && (
                <div className="relative">
                  <img
                    src={background.imagePath}
                    alt="背景预览"
                    className="h-20 w-full rounded-lg object-cover"
                  />
                  <button
                    onClick={() => setBackground({ type: 'image' })}
                    className="absolute right-1 top-1 rounded bg-ink/60 px-1.5 py-0.5 text-xs text-white hover:bg-ink/80"
                  >
                    清除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {/* 装饰品管理 */}
      <DecorationEditor />
    </div>
  )
}
