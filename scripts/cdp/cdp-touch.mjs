// CDP 复验工具：经 CDP 派发真实触摸事件（touchStart + touchEnd）到页面坐标，再回读状态。
// 用途：重放交接文档 §四 中 `adb shell input tap` 在该 WebView 点不到目标（如 textarea）的场景（P2-2 IME 等）。
// 用法：node scripts/cdp/cdp-touch.mjs <cssX> <cssY> "<读回表达式>"
// 可选环境变量：SERIAL（默认 emulator-5554）/ PKG（默认 com.spiritpal.desktop_pet）/ PORT（默认 9335）。
import { execSync } from 'node:child_process'

const SERIAL = process.env.SERIAL ?? 'emulator-5554'
const PKG = process.env.PKG ?? 'com.spiritpal.desktop_pet'
const PORT = Number(process.env.PORT ?? 9335)
const [, , xStr, yStr, readExpr] = process.argv
const x = Number(xStr)
const y = Number(yStr)

const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const pid = sh(`adb -s ${SERIAL} shell pidof ${PKG}`).trim().split(/\s+/).filter(Boolean).pop()
sh(`adb -s ${SERIAL} forward tcp:${PORT} localabstract:webview_devtools_remote_${pid}`)
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let id = 0
function send(method, params) {
  const myId = ++id
  return new Promise((resolve) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== myId) return
      ws.removeEventListener('message', onMsg)
      resolve(msg)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id: myId, method, params }))
    setTimeout(() => resolve({ timedout: true }), 15000)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
await sleep(80)
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(2500)

const res = await send('Runtime.evaluate', { expression: readExpr, returnByValue: true, awaitPromise: true })
if (res.result?.exceptionDetails) {
  console.log('EXCEPTION: ' + JSON.stringify(res.result.exceptionDetails.exception?.description ?? ''))
} else {
  console.log(JSON.stringify(res.result?.result?.value, null, 2))
}
ws.close()
