# CDP 设备复验脚本（最小可重放版本）

本目录是交接文档 [`docs/execution/agent-review-handoff-2026-10-05.md`](../../docs/execution/agent-review-handoff-2026-10-05.md) **§四「设备验证记录」**所用工具的最小可重放版本，供设计审核方独立重放设备侧验收。原始临时脚本曾位于某未纳入版本控制的执行期工作目录，此处收编为仓库内被跟踪的复验载体。

> 这些是**运维/复验工具**，不参与构建、不被 `eslint src/` 或 `tsc` 覆盖，也不含任何 Tauri `invoke`（不改变能力面）。用户红线：**只用模拟器，禁止真机**。

## 前置条件

1. Android 模拟器在线并运行 arm64 debug 包，例如 AVD `LawnchairApi35`（API 35 / x86_64）。
2. `adb` 在 PATH 上；设备序列号默认 `emulator-5554`（多设备时用 `SERIAL` 指定，且必须显式 `-s`，禁止误连真机）。
3. WebView 远程调试可用（debug 包默认可）。设备上应用包名为 `com.spiritpal.desktop_pet`（**下划线**，`tauri.conf.json` 的 `desktop-pet` 会被下划线化）。
4. Node ≥ 18（脚本用全局 `fetch` / `WebSocket`）。

可用环境变量：`SERIAL` / `PKG` / `PORT`（各脚本默认端口：eval 9333、seq 9334、touch 9335）。
adb server 会随命令结束被回收，**端口转发与调用须在同一条命令里**，脚本已内置该处理。

## 脚本

| 脚本 | 作用 | 用法 |
|---|---|---|
| `cdp-eval.mjs` | 单段 JS 经 `Runtime.evaluate` 求值并回读 | `node scripts/cdp/cdp-eval.mjs "<expr>"` |
| `cdp-seq.mjs` | 一条连接内按序执行多步（每步后等待毫秒） | `node scripts/cdp/cdp-seq.mjs scripts/cdp/pomodoro-steps.json` 或交替传 `'expr' [waitMs]` |
| `cdp-touch.mjs` | 经 `Input.dispatchTouchEvent` 派发真实触摸（`adb shell input tap` 点不到 textarea 时用），再回读 | `node scripts/cdp/cdp-touch.mjs <cssX> <cssY> "<readExpr>"` |

`Runtime.evaluate` 里不能用裸 `async () => {...}`（SyntaxError），须写成 `(async () => {...})()`。

## §四 各验证项 → 重放方式

- **P1-5 衰减**：`cdp-eval.mjs` 读 `饱食/心情` → `adb -s $SERIAL shell date -u @<epoch>` 前跳 2h → 约 80s 后再读，预期恰 2 次 tick（-4/-3）。用完恢复时钟并 `pm clear`。跳时钟可能令 adbd 不稳，必要时冷重启模拟器。
- **P1-6 番茄钟**：`cdp-seq.mjs scripts/cdp/pomodoro-steps.json`（同意协议 → 养成 → 专注 → 选 15 分钟 → 开始 → 暂停/继续/结束）。完成路径同样可前跳 16min 验证发奖。
- **P2-2 IME**：`cdp-touch.mjs` 点 textarea 唤起键盘，回读 `visualViewport` 高度与输入栏底边坐标确认未被遮挡。
- **P1-3-fe 图谱**：`cdp-eval.mjs` 注入 2 实体（共享一条 memory）触发共现派生 1 边，进子页回读节点/连线数量。
- **P1-7-fe 提示条**：`cdp-eval.mjs` 插入 1 到期 + 1 逾期（`sp_commitments_overdue` 需 `now` + `before`），在聊天/记忆两页回读提示文案。
- **P2-12 分级**：`cdp-eval.mjs` 打开设备分级面板回读 T0/T1+ 卡片。

执行期截图（`graph*.png` 等）属临时留证、未入库；复核以「脚本可重放 + 回读输出」为准。
