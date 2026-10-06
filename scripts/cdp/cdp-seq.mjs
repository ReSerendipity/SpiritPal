// CDP 复验工具：在一条 CDP 连接上按序执行多步 JS（每步后等待指定毫秒）。
// 用途：重放交接文档 §四 中需要「多步交互 + 逐步回读」的场景（如番茄钟开始→暂停→继续→结束）。
// 用法：node scripts/cdp/cdp-seq.mjs scripts/cdp/pomodoro-steps.json
//   或：node scripts/cdp/cdp-seq.mjs 'expr1' [waitMs] 'expr2' [waitMs] ...
// 可选环境变量：SERIAL（默认 emulator-5554）/ PKG（默认 com.spiritpal.desktop_pet）/ PORT（默认 9334）。
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const SERIAL = process.env.SERIAL ?? 'emulator-5554'
const PKG = process.env.PKG ?? 'com.spiritpal.desktop_pet'
const PORT = Number(process.env.PORT ?? 9334)

// 参数：要么是 json 文件路径，要么是交替的 "表达式" "等待毫秒"
let steps = []
if (process.argv[2]?.endsWith('.json')) {
  steps = JSON.parse(readFileSync(process.argv[2], 'utf8'))
} else {
  for (let i = 2; i < process.argv.length; i += 2) {
    steps.push({ expr: process.argv[i], wait: Number(process.argv[i + 1] ?? 800) })
  }
}

const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const pid = sh(`adb -s ${SERIAL} shell pidof ${PKG}`).trim().split(/\s+/).filter(Boolean).pop()
if (!pid) {
  console.error('应用未运行')
  process.exit(3)
}
sh(`adb -s ${SERIAL} forward tcp:${PORT} localabstract:webview_devtools_remote_${pid}`)

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('无 page target')
  process.exit(4)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let id = 0
function evalExpr(expr) {
  const myId = ++id
  return new Promise((resolve) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== myId) return
      ws.removeEventListener('message', onMsg)
      resolve(msg)
    }
    ws.addEventListener('message', onMsg)
    ws.send(
      JSON.stringify({
        id: myId,
        method: 'Runtime.evaluate',
        params: { expression: expr, awaitPromise: true, returnByValue: true },
      }),
    )
    setTimeout(() => resolve({ timedout: true }), 15000)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const step of steps) {
  const res = await evalExpr(step.expr)
  const label = step.label ?? step.expr.slice(0, 40).replace(/\s+/g, ' ')
  if (res.timedout) {
    console.log(`[${label}] ⏱ 超时`)
  } else if (res.result?.exceptionDetails) {
    console.log(`[${label}] ✗ ${JSON.stringify(res.result.exceptionDetails.exception?.description ?? '')}`)
  } else {
    const v = res.result?.result?.value
    console.log(`[${label}] ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  await sleep(step.wait ?? 800)
}
ws.close()
