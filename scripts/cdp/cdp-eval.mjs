// CDP 复验工具：经 Chrome DevTools Protocol 在模拟器 WebView 里执行一段 JS 并回读结果。
// 用途：重放交接文档 docs/execution/agent-review-handoff-2026-10-05.md §四 的设备验证。
// 用法：node scripts/cdp/cdp-eval.mjs "<js 表达式>"
// 可选环境变量：SERIAL（默认 emulator-5554）/ PKG（默认 com.spiritpal.desktop_pet）/ PORT（默认 9333）。
// 注意：adb server 会随命令结束被回收，端口转发必须和本脚本在同一条命令里完成。
import { execSync } from 'node:child_process'

const SERIAL = process.env.SERIAL ?? 'emulator-5554'
// 设备上 applicationId 的连字符会被下划线化：tauri.conf.json 的 desktop-pet → 运行时 desktop_pet
const PKG = process.env.PKG ?? 'com.spiritpal.desktop_pet'
const PORT = Number(process.env.PORT ?? 9333)
const expr = process.argv[2]
if (!expr) {
  console.error('缺少 JS 表达式')
  process.exit(2)
}

const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const pidOut = sh(`adb -s ${SERIAL} shell pidof ${PKG}`).trim()
const pids = pidOut.split(/\s+/).filter(Boolean)
if (pids.length === 0) {
  console.error(`应用未运行: ${PKG}`)
  process.exit(3)
}
const pid = pids[pids.length - 1]
sh(`adb -s ${SERIAL} forward tcp:${PORT} localabstract:webview_devtools_remote_${pid}`)

const listUrl = `http://127.0.0.1:${PORT}/json/list`
const list = await (await fetch(listUrl)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('无可用 page target: ' + JSON.stringify(list))
  process.exit(4)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
const result = await new Promise((resolve) => {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id === 1) resolve(msg)
  }
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise: true, returnByValue: true },
    }),
  )
  setTimeout(() => resolve({ timedout: true }), 20000)
})
ws.close()
if (result.timedout) {
  console.error('CDP 超时')
  process.exit(5)
}
if (result.result?.exceptionDetails) {
  console.error('页面异常: ' + JSON.stringify(result.result.exceptionDetails))
  process.exit(6)
}
console.log(JSON.stringify(result.result?.result?.value ?? null, null, 2))
