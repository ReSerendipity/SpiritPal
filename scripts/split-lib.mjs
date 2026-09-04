// 一次性重构工具：src/lib 平铺文件 → 六群子目录 + import 重写为 @/lib/<group>/<file>
// 用法：node scripts/split-lib.mjs --apply （不带 --apply 为 dry-run）
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const LIB = path.join(ROOT, 'src', 'lib')
const APPLY = process.argv.includes('--apply')

// ---- 分组映射（顶层平铺文件名 → 群）----
const G = {}
const add = (g) => (names) => { for (const n of names) G[n] = g }
add('ai')(['aiAgent','aiAssistantDetector','aiConfig','agentSandbox','agentScheduler','agentStateLayer','agentTools','behaviorEngine','dualBrain','llmClient','llmProviders','multimodalLLM','promptRegistry','streamPipeline','sseUtils','generatorPipeline','toxicityFilter','contextAwareness','emotionEngine','emotionExtractor','emotionManager','codingReactionRows','dialogueConfig','dialogueManager','dialogueSystem','chatStages','personalityEngine','personalityTemplates','proactiveSpeak'])
add('memory')(['contextManager','contextEpisodeManager','memoryBackground','memoryConfig','memoryEditor','memoryExporter','memoryMigrator','memoryQualityCheck','memoryRecommendation','memorySummarizer','memoryTrace','memoryTypes','enhancedMemory','embeddingCache','dreamingConsolidation','entityGraph','entityLinking','keyframeMemory','multimodalMemory','ownerFacts','recallEngine','ragRetrieval','visionPerception','visualMemory','visualMemoryManager','visualPerception','localEmbedding'])
add('nurture')(['achievementSystem','affectionNumeric','affectionQuantifier','buffManager','commitmentTracker','dailyJournal','diarySystem','foodContract','foodEffectContract','interactionCounter','items','itemSchema','petForm','petMetadata','scheduleManager','shopManager','taskManager','characterConsistency','petExperience','characterPack','characterCardImporter','characterCardSystem','characterImportService'])
add('render')(['declarativeTheme','animationConfig','animationFallback','batchRenderer','chromaKey','dragInteraction','frameCache','gpuParticleSystem','live2dPhysicsParser','renderAdapter','spriteAtlasBuilder','spriteLayout','spriteLayoutConfig','spriteMemoryManager','spriteSheetTool','svgAnimationAnalyzer','thinkBubble','thinkTagParser','trayIconRenderer','bubbleManager','bubbleConfig','hiddenStateManager','movementEngine','shimejiLoader','characterResourceImporter','characterResourceLoader'])
add('data')(['db','blobCrypto','dataManager','dirtyDataTracker','saveRecovery','saveRestore','zombieDataCleanup','characters','collectionManager','collectionSystem','encryptedExport','encryptedStorage','secureStorage','securityUtils','piiMasking','jsonUtils','commonUtils','constants','types','modCreatorIncentive','modDistribution','modLoader','modManager','modPackager','modTestFramework','batchOperationManager'])
add('system')(['appWindows','windowManager','windowEventBus','windowPositionMemory','windowTitleExtractor','petWindowSizing','multiMonitor','macosPanel','miniMode','pixelClickThrough','deviceInput','systemControls','clipboardManager','analytics','auditLogger','logger','runtimeMonitor','healthCheck','qualityMonitor','latencySLO','i18n','i18nManager','i18nTranslations','syncManager','widgetState','calendarIntegration','timezoneSync','icsParser','weatherAwareness','musicAwareness','screenshotManager','updater','pushNotificationManager','silentModeManager','eventSystem','typedEventEmitter','antiRepetition','sentenceDivider','emojiCultureData','cultureEmoji','stringSimilarity','paramAutoMapper','toolParamValidator','ipcErrorCode','ipcSecurity','tauriInvoker','mcpAppBridge','mcpBridge','mcpClient','mcpHooks','mcpInputValidator','mcpLease','mcpPermissions','mcpServer','permissionBubble','pluginManager','pluginPermissions','pluginSdk','themeManager','gradualRollout','swallowedCatch','uploadMagic','ssrfProtection','pathConvention','pathSecurity','pathTraversalGuard','ttsEngine','ttsTaskManager','sentry','externalLinks','legalDocuments','webdavClient','vectorSearch','vectorWorker','webgl.worker','webglWorker','useInputReactions'])

const norm = (p) => p.replace(/\\/g, '/')
const stripExt = (p) => p.replace(/\.(ts|tsx|d\.ts)$/, '')
const isSrcFile = (n) => /\.(ts|tsx)$/.test(n) && !n.endsWith('.d.ts') && !/\.(test|spec)\./.test(n)

// ---- 收集 src/lib 顶层文件（排除测试）----
const topFiles = fs.readdirSync(LIB).filter((n) => {
  const f = path.join(LIB, n)
  return fs.statSync(f).isFile() && isSrcFile(n)
}).map((n) => stripExt(n))

const toMove = topFiles.filter((f) => G[f])
const stays = topFiles.filter((f) => !G[f])
console.log(`顶层文件 ${topFiles.length} | 迁移 ${toMove.length} | 原位 ${stays.length}`)
if (stays.length) console.log('原位保留:', stays.join(', '))

// ---- 收集全部源文件中的引用 ----
const ALL_FILES = []
;(function walk(dir) {
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    if (it.name === 'node_modules' || it.name === 'dist' || it.name === 'target') continue
    const full = path.join(dir, it.name)
    if (it.isDirectory()) walk(full)
    else if (/\.(ts|tsx)$/.test(it.name) && !it.name.endsWith('.d.ts')) ALL_FILES.push(full) // 含测试文件
  }
})(path.join(ROOT, 'src'))

const IMPORT_RE = /(?:from[\s(]*|vi\.mock\(\s*|vi\.importActual\(\s*|vi\.importMock\(\s*|jest\.mock\(\s*|jest\.requireActual\(\s*)(['"])([^'"]+)\1|import\s*\(\s*(['"])([^'"]+)\3\s*\)/g
const SRC_ABS = norm(path.join(ROOT, 'src'))
const existsAny = (p) => fs.existsSync(p + '.ts') || fs.existsSync(p + '.tsx')
// src 的顶层业务目录：lib 子目录内相对引用错位解析时会误落到 src/lib/<dir>/ 下
const SRC_TOP_DIRS = ['stores', 'components', 'hooks', 'mobile', 'test']

/** 把 spec 解析为绝对路径并归一语义目标（kind: 'lib'（src/lib 下）| 'src'（src 其余部分）） */
function resolveTarget(dir, spec) {
  let abs
  if (spec.startsWith('@/')) abs = norm(path.join(ROOT, 'src', spec.slice(2)))
  else abs = norm(path.resolve(dir, spec))
  let stripped = norm(stripExt(abs))
  if (!stripped.startsWith(SRC_ABS + '/')) return null
  if (stripped.startsWith(norm(LIB) + '/')) {
    const relSegs = stripped.slice(norm(LIB).length + 1).split('/')
    // 相对深度错位：如 src/lib/ai 内 '../stores/x' 会被解析成 src/lib/stores/x
    if (relSegs.length >= 2 && SRC_TOP_DIRS.includes(relSegs[0])) {
      return { stripped: norm(path.join(SRC_ABS, relSegs.join('/'))), kind: 'src' }
    }
    return { stripped, kind: 'lib', base: relSegs[relSegs.length - 1] }
  }
  return { stripped, kind: 'src' }
}

const refs = [] // {file, abs, kind: 'lib'|'src'}
const refSet = new Set()
for (const file of ALL_FILES) {
  const content = fs.readFileSync(file, 'utf8')
  const dir = path.dirname(file)
  const fileInLibSub = norm(dir).startsWith(norm(LIB) + '/')
  let m
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const spec = m[2] || m[4]
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue
    const t = resolveTarget(dir, spec)
    if (process.argv.includes('--trace') && /enhancedMemory-triggers/.test(file)) {
      console.log('PROBE:', spec, '->', t ? `${t.kind}/${t.base || t.stripped}` : 'null')
    }
    if (!t) continue
    const key = `${file}|${m.index}`
    if (refSet.has(key)) continue
    if (t.kind === 'lib') {
      // 仅当目标文件不存在（说明是已移走的顶层平铺文件）才重写
      if (G[t.base] && !existsAny(t.stripped)) {
        refSet.add(key)
        refs.push({ file, abs: t.stripped, kind: 'lib' })
      }
    } else if (fileInLibSub) {
      // lib 子目录内的文件指向 src 其余部分（stores/components/...）→ 绝对别名，深度不再失效
      refSet.add(key)
      refs.push({ file, abs: t.stripped, kind: 'src' })
    }
  }
}
console.log(`引用扫描: ${refs.length} 处将重写（涉及 ${new Set(refs.map(r => norm(r.file))).size} 个文件）`)
if (process.argv.includes('--trace')) {
  for (const r of refs.filter((x) => /enhancedMemory-triggers/.test(x.file) || /zombieDataCleanup|streamPipeline/.test(x.file))) {
    console.log('TRACE:', norm(r.file), '->', r.abs, r.kind)
  }
}

if (!APPLY) { console.log('\ndry-run 完成。确认后执行：node scripts/split-lib.mjs --apply'); process.exit(0) }

// ---- apply: 移动 + 重写 ----
const movedMap = new Map() // 旧stripExt-abs -> 新stripExt-abs
for (const mv of [...new Set(toMove)]) {
  const srcTs = path.join(LIB, mv)
  const dstDir = path.join(LIB, G[mv])
  fs.mkdirSync(dstDir, { recursive: true })
  const dstTs = path.join(dstDir, mv)
  if (fs.existsSync(srcTs + '.ts')) { fs.renameSync(srcTs + '.ts', dstTs + '.ts'); movedMap.set(stripExt(norm(srcTs)), stripExt(norm(dstTs))) }
  else if (fs.existsSync(srcTs + '.tsx')) { fs.renameSync(srcTs + '.tsx', dstTs + '.tsx'); movedMap.set(stripExt(norm(srcTs)), stripExt(norm(dstTs))) }
  else { console.warn('找不到源文件:', mv) }
}

const contents = new Map() // key(旧stripExt-abs) -> lines[]
for (const r of refs) {
  const key = stripExt(norm(r.file))
  if (contents.has(key)) continue
  const readPath = movedMap.get(key) ?? r.file
  if (!fs.existsSync(readPath)) { console.warn('跳过不存在的文件:', readPath); continue }
  contents.set(key, fs.readFileSync(readPath, 'utf8').split('\n'))
}

const REWRITE_RE = /((?:from[\s(]*|import\s*\(\s*|vi\.mock\(\s*|vi\.importActual\(\s*|vi\.importMock\(\s*|jest\.mock\(\s*|jest\.requireActual\(\s*)(['"])((?:\.[^'"]+|@\/[^'"]+))\2)/g
for (const [key, lines] of contents) {
  const actualPath = movedMap.get(key) ?? key
  const srcIsMoved = norm(path.dirname(actualPath)) !== norm(LIB)
  const dir = path.dirname(actualPath)
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(REWRITE_RE, (_m, _pre, _q, spec) => {
      if (!spec.startsWith('.') && !spec.startsWith('@/')) return _m
      const t = resolveTarget(dir, spec)
      if (!t) return _m
      if (t.kind === 'lib') {
        if (G[t.base] && !existsAny(t.stripped)) return _m.replace(spec, `@/lib/${G[t.base]}/${t.base}`)
        return _m
      }
      if (srcIsMoved) return _m.replace(spec, `@/${t.stripped.slice(SRC_ABS.length + 1)}`)
      return _m
    })
  }
}

const extOf = (p) => (fs.existsSync(p + '.ts') ? '.ts' : fs.existsSync(p + '.tsx') ? '.tsx' : null)
for (const [key, lines] of contents) {
  const target = movedMap.get(key) ?? key
  const ext = extOf(target)
  if (!ext) { console.warn('写回跳过（无扩展名可判定）:', target); continue }
  const next = lines.join('\n')
  fs.writeFileSync(target + ext, next, 'utf8')
  console.log('rewrote:', target + ext)
}
console.log('\n完成。请运行 tsc --noEmit / madge / vitest 验证。')