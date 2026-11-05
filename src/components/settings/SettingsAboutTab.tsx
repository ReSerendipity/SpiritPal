/**
 * 设置窗口 · 关于标签页（自 SettingsWindow.tsx 拆出，2026-11-06 巨型组件整改）
 *
 * 自包含：版本号动态读取（与 package.json / Cargo.toml / tauri.conf.json 三处
 * 一致，见 verify-release-version.yml）、检查更新入口、诊断与日志（日志级别、
 * 导出诊断包）、社链与反馈入口、角色列表、Live2D 指引、法律文档弹窗。
 * 无 props——不依赖父组件任何状态。
 */
import { getVersion } from '@tauri-apps/api/app'
import { appDataDir } from '@tauri-apps/api/path'
import { useEffect, useState } from 'react'
import { LegalDocument } from '@/components/LegalDocument'
import { getAllCharacters } from '@/lib/data/characters'
import { LOGGING_LEVELS, getRuntimeLogLevel, setRuntimeLogLevel, exportDiagnostics } from '@/lib/system/diagnostics'
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '@/lib/system/legalDocuments'
import { tauriInvokeNoRetry } from '@/lib/system/tauriInvoker'

type LegalDocKey = 'privacy' | 'terms'

export default function SettingsAboutTab() {
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null)
  const [live2dCoreReady, setLive2dCoreReady] = useState(false)
  const [coreDir, setCoreDir] = useState('')
  const [logLevel, setLogLevel] = useState<string>('')
  const [logLevelTip, setLogLevelTip] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')

  // 检测 Live2D Cubism Core 是否已就绪（用户自装）
  useEffect(() => {
    const check = async () => {
      const win = window as unknown as { Live2DCubismCore?: unknown }
      setLive2dCoreReady(!!win.Live2DCubismCore)
      try {
        setCoreDir(await appDataDir())
      } catch {
        setCoreDir('')
      }
    }
    check()
    const t = setInterval(check, 5000)
    return () => clearInterval(t)
  }, [])

  // 初始化「关于」页日志级别下拉
  useEffect(() => {
    let cancelled = false
    getRuntimeLogLevel()
      .then((level) => {
        if (!cancelled) setLogLevel(level)
      })
      .catch(() => {
        // 读取失败保持空，由用户手动触发
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 关于页版本号：运行时动态读取（与 package.json / Cargo.toml / tauri.conf.json 三处一致，见 verify-release-version.yml）
  useEffect(() => {
    let cancelled = false
    getVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v)
      })
      .catch(() => {
        if (!cancelled) setAppVersion('未知')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 检查更新：通知全局 UpdateNotification 弹窗执行完整状态机（P0-1.5 / P2-2 每步可见）
  const handleCheckUpdate = () => {
    window.dispatchEvent(new CustomEvent('spiritpal:check-updates'))
  }

  // 运行时日志级别切换
  async function handleLogLevelChange(level: string) {
    setLogLevel(level)
    setLogLevelTip(null)
    try {
      const updated = await setRuntimeLogLevel(level)
      setLogLevel(updated)
      const label = LOGGING_LEVELS.find((l) => l.value === updated)?.label ?? updated
      setLogLevelTip(`已更新为 ${label}`)
    } catch (e) {
      // 失败静默，仅控制台提示
      console.warn('[Diagnostics] 更新日志级别失败:', e)
    }
  }

  // 导出诊断包
  async function handleExportDiagnostics() {
    setExportPath(null)
    setExportError(null)
    try {
      const result = await exportDiagnostics()
      if (result && result.path) {
        setExportPath(result.path)
      } else {
        setExportError('诊断功能当前不可用（非桌面环境）')
      }
    } catch (e) {
      setExportError(String(e))
    }
  }

  return (
    <>
      <div className="max-w-md space-y-4">
        <h2 className="text-lg font-semibold">关于</h2>
        <div className="rounded-xl bg-surface p-4">
          <div className="mb-2 text-2xl">🐾 SpiritPal 桌宠</div>
          <div className="text-sm text-ink-faint">版本：{appVersion || '读取中…'}</div>
          <div className="mt-2 text-sm text-ink-muted">
            一款基于 Tauri v2 的桌面宠物应用，支持多角色养成、AI 对话、记忆系统与番茄钟。
          </div>
          <div className="mt-3">
            <button
              onClick={handleCheckUpdate}
              className="rounded-lg bg-tangerine px-3 py-1.5 text-xs font-medium text-white hover:bg-tangerine-deep"
            >
              检查更新
            </button>
            <span className="ml-2 text-xs text-ink-faint">检查结果将弹窗提示，每步可见</span>
          </div>
        </div>
        {/* 诊断与日志 */}
        <div className="rounded-xl bg-surface p-4">
          <div className="mb-2 text-sm font-semibold text-tangerine-deep">诊断与日志</div>

          <div className="mb-3">
            <label className="mb-1 block text-xs text-ink-faint">日志级别</label>
            <select
              value={logLevel}
              onChange={(e) => handleLogLevelChange(e.target.value)}
              aria-label="日志级别"
              className="w-full rounded-lg bg-cream-deep px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-tangerine"
            >
              {LOGGING_LEVELS.map((lv) => (
                <option key={lv.value} value={lv.value}>
                  {lv.label}
                </option>
              ))}
            </select>
            {logLevelTip && <div className="mt-1 text-xs text-success-deep">{logLevelTip}</div>}
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-faint">导出诊断包</label>
            <button
              onClick={handleExportDiagnostics}
              className="rounded-lg bg-tangerine px-3 py-1.5 text-xs font-medium text-white hover:bg-tangerine-deep"
            >
              导出诊断包
            </button>
            {exportPath && (
              <div className="mt-2 break-all text-xs text-success-deep">
                诊断包已导出：{exportPath}
                <div className="mt-0.5 text-ink-faint">诊断包仅保存在本机，可自行分享给开发者排查</div>
              </div>
            )}
            {exportError && <div className="mt-2 text-xs text-error">导出失败：{exportError}</div>}
          </div>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <div className="mb-2 text-sm font-semibold text-tangerine-deep">关注我们</div>
          <div className="flex flex-wrap gap-2 text-sm">
            <a
              href="https://github.com/ReSerendipity"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="GitHub 主页"
            >
              GitHub
            </a>
            <a
              href="https://modelscope.cn/profile/ReSerendipity"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="魔搭 ModelScope"
            >
              魔搭
            </a>
            <a
              href="https://www.zhihu.com/people/6-50-73-59-83"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="知乎"
            >
              知乎
            </a>
            <a
              href="https://www.xiaohongshu.com/user/profile/6a606c140000000010000801"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="小红书"
            >
              小红书
            </a>
            <a
              href="https://www.douyin.com/user/MS4wLjABAAAAcEdOoxVlfk3Ulx_usqR-3PHW4xxp6wYzRmsuRI_-fHBigPETTKLsv4fknIpFq6sP"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="抖音"
            >
              抖音
            </a>
            <a
              href="https://www.kuaishou.com/profile/3x2sk6hj48i2mhs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="快手"
            >
              快手
            </a>
            <a
              href="https://space.bilibili.com/499527473"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="B站"
            >
              B站
            </a>
          </div>
        </div>
        {/* 用户反馈入口 */}
        <div className="rounded-xl bg-surface p-4">
          <div className="mb-2 text-sm font-semibold text-tangerine-deep">反馈与建议</div>
          <div className="mb-2 text-xs text-ink-muted">遇到 Bug 或有功能建议？欢迎通过以下渠道反馈：</div>
          <div className="flex flex-wrap gap-2 text-sm">
            <a
              href="https://github.com/ReSerendipity/SpiritPal/issues/new?template=bug_report.yml"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="提交 Bug"
            >
              🐛 提交 Bug
            </a>
            <a
              href="https://github.com/ReSerendipity/SpiritPal/issues/new?template=feature_request.yml"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="功能建议"
            >
              💡 功能建议
            </a>
            <a
              href="https://github.com/ReSerendipity/SpiritPal/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-cream-deep px-3 py-1.5 text-ink-muted hover:bg-ink/5"
              title="讨论区"
            >
              💬 讨论区
            </a>
          </div>
        </div>
        <div className="rounded-xl bg-surface p-4 text-sm text-ink-muted">
          <div className="mb-1 font-semibold text-tangerine-deep">角色列表</div>
          {getAllCharacters().map((c) => (
            <div key={c.id} className="mb-1">
              <span style={{ color: c.themeColor.primary }}>●</span> {c.displayName} — {c.source}
            </div>
          ))}
        </div>
        {/* Live2D 使用指引 */}
        <div className="rounded-xl bg-surface p-4">
          <div className="mb-2 text-sm font-semibold text-tangerine-deep">Live2D</div>
          <div className="mb-2 text-xs">
            {live2dCoreReady ? (
              <span className="text-success">● Cubism Core 已就绪，Live2D 可用</span>
            ) : (
              <span className="text-amber-600">● Cubism Core 未安装，当前使用精灵图模式</span>
            )}
          </div>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-muted">
            <li>打开 Live2D 官网，下载「Cubism SDK for Web」：</li>
          </ol>
          <a
            href="https://www.live2d.com/zh-CHS/sdk/download/"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs text-tangerine-deep underline decoration-dotted underline-offset-4"
          >
            https://www.live2d.com/zh-CHS/sdk/download/
          </a>
          <div className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            Live2D Cubism 为 Live2D Inc. 专有软件（本应用不分发 Core；许可状态见
            docs/LIVE2D_LICENSE_REMINDER.md）。 内置角色仅
            Doro（作者已提供免费获取渠道并允许二创）；其余角色以社区包/用户自备形式提供， 归属与授权状态见
            <a
              className="text-tangerine-deep underline decoration-dotted underline-offset-4"
              href="https://github.com/ReSerendipity/SpiritPal/blob/main/docs/CHARACTER_ATTRIBUTIONS.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              docs/CHARACTER_ATTRIBUTIONS.md
            </a>
            。
          </div>
          <ol className="list-decimal space-y-1 pl-4 pt-1 text-xs text-ink-muted" start={2}>
            <li>
              解压 SDK，找到 <code className="rounded bg-cream-deep px-1">Core/live2dcubismcore.js</code>；
            </li>
            <li>将其复制到应用数据目录（下方路径）后重启应用：</li>
          </ol>
          <div className="mt-1 break-all rounded bg-cream-deep p-2 font-mono text-[10px] text-ink-faint">
            {coreDir || '（获取路径中…）'}
          </div>
          <div className="mt-1 text-[10px] text-ink-faint">
            最终文件应为：{coreDir ? `${coreDir}live2dcubismcore.js` : '…/live2dcubismcore.js'}
          </div>
          <button
            onClick={async () => {
              try {
                await tauriInvokeNoRetry('open_path', { path: coreDir })
              } catch {
                /* 平台不支持时忽略 */
              }
            }}
            className="mt-2 rounded-lg bg-cream-deep px-3 py-1.5 text-xs text-ink-muted hover:bg-ink/5"
          >
            打开应用数据目录
          </button>
        </div>
        {/* 法律文档链接 */}
        <div className="rounded-xl bg-surface p-4">
          <div className="mb-2 text-sm font-semibold text-tangerine-deep">法律信息</div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setLegalDoc('privacy')}
              className="text-left text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-tangerine-deep"
            >
              隐私政策
            </button>
            <button
              onClick={() => setLegalDoc('terms')}
              className="text-left text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-tangerine-deep"
            >
              用户协议
            </button>
          </div>
        </div>
        <div className="text-xs text-ink-faint">
          技术栈：React 19 · TypeScript · Tailwind CSS v4 · Tauri v2 · Zustand
        </div>
      </div>

      {/* 法律文档弹窗（fixed 定位，DOM 位置不影响展示层级） */}
      {legalDoc && (
        <LegalDocument
          title={legalDoc === 'privacy' ? '隐私政策' : '用户协议'}
          content={legalDoc === 'privacy' ? PRIVACY_POLICY : TERMS_OF_SERVICE}
          onClose={() => setLegalDoc(null)}
        />
      )}
    </>
  )
}
