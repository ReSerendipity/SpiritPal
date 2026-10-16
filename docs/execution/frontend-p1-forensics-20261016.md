# 前端工程体系 P1 四项取证登记（2026-10-16）

> 对应前端工程体系 Flash 报告 P1：Props Drilling / 过度封装 / 无效重渲染 / 无限循环，报告原文均为「未能判断」。
> 按交接单要求：**只做低成本取证与登记，不顺手重构**。完整判定需 React DevTools Profiler 实测，超出本次整改窗口。
>
> **2026-10-16 复核更新（同日追加）**：§2 的 3 处 effect 嫌疑经逐处人工核对**全部证伪**
> （启发式 grep 的 2 行窗口漏看了第 3/4 行上的依赖数组）；改用权威信号
> `react-hooks/exhaustive-deps` 全量 lint（reactHooks recommended 规则集启用状态下）
> 复扫全 src，**0 告警**。详见 §2 更新与 §4 结论表。

## 1. 取证快照（2026-10-16，静态扫描 src/）

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| `useEffect(` 调用 | 151 | tsx/ts 合计 |
| `React.memo` 使用文件 | 1 | 记忆化覆盖面极低 |
| `useMemo(` / `useCallback(` | 174 | 存在优化意识但分布待查 |
| `createContext` | 0 | **无 Context 层**，跨组件状态只能走 props 或 zustand store |
| `react-hooks/exhaustive-deps` 告警 | **0**（全 src） | 权威信号：依赖数组完整性由 lint 规则集全程把守 |
| `setInterval/setTimeout`（tsx） | 62 | 定时器清理需逐处核对 |

## 2. 无限循环线索清单 —— 已全部证伪（2026-10-16 复核）

初版（本日早些时候）用 grep 启发式（`useEffect(() => {` 后 2 行窗口内找 `})`）报出 3 处
「疑似缺依赖数组」。逐处人工核对结论：

1. `src/components/AchievementPanel.tsx:47-50` — **误报**：deps `[mgr]` 在第 50 行（窗口外），cleanup `return unsub` 完整。
2. `src/mobile/MobileAchievementView.tsx:50-53` — **误报**：同上，deps `[mgr]`、cleanup 完整。
3. `src/mobile/MobilePetView.tsx:250-257` — **误报**：deps `[]` 显式存在、cleanup `removeEventListener` 完整（教科书式 resize 监听）。

> 教训（GOTCHAS 性质）：「2 行窗口 grep」对 React effect 结构的判读不可靠 ——
> deps 数组与 cleanup 常落在 3~4 行之外，报出的「嫌疑」必须逐处人工核对后才能入台账；
> 依赖数组完整性的权威信号是 `react-hooks/exhaustive-deps`（本仓 reactHooks recommended
> 规则集已启用），直接跑 lint 即可全量判定，无需启发式。

> 已排除误报：`PetWindow.tsx:482/547`、`PomodoroOverlay.tsx:42` 为 ref 同步型 effect（deps 在后续行），非缺陷。

## 3. Props Drilling / 过度封装 / 无效重渲染 —— 终版判定（2026-10-16 补实测）

### 3.1 无效重渲染 —— React Profiler 实测（`src/components/__tests__/frontend-p1-profiler.test.tsx`）

订阅面结构（静态）：带选择器订阅 **182 处**（petStore 110 / chatStore 45 / settingsStore 27）；
无选择器整店订阅**仅 2 处**（`SettingsWindow.tsx:214`、`MobileSettingsView.tsx:140`，均在低频、
用户驱动的 settingsStore 上）；另有 35 处 `useChatStore.getState()` 非响应式读取（不构成重渲染面）。

Profiler 实测（jsdom，提交计数为判定口径；镜像仓内两种真实订阅写法）：

| 判定 | 结果 |
| --- | --- |
| 选择器订阅（镜像 AchievementPanel:24/36 写法）在无关字段（sharedCoins / 其它角色 stats）变化时 | **0 次重渲染**（防线成立） |
| 选择器订阅在所选字段变化时 | **恰好 1 次**重渲染（不欠渲染） |
| 整店订阅（镜像 SettingsWindow:214 写法）对任意 settingsStore 变化 | **每次都重渲染**（2 次无关变化 → 2 次 update 提交） |
| 整店订阅被 petStore 变化波及 | **0 次**（跨 store 不串扰） |

**结论：无效重渲染在现有订阅面下不构成实际问题。** 选择器订阅占绝对主导（182:2）；
仅有的 2 处整店订阅挂在低频 store 上，实测代价存在但触发频率低（用户打开设置页操作时才发生）。
若未来出现 petStore（高频）整店订阅，本测试的镜像断言是现成的回归防线。

### 3.2 Props Drilling —— 结构风险未兑现

- 身份/状态数据（`currentCharacterId` 等）由组件**直接从 store 读取**（ChatWindow / MemoryPanel /
  AlbumPanel / CoinDisplay 等），不走 props 链——`createContext = 0` 的结构风险被 store 直读消解。
- 全 src 唯一的 JSX 层 `characterId` 接力是到 **SpriteRenderer 叶子组件**的**一级传递**
  （`PetWindow.tsx:1724`、`MobilePetView.tsx:739`），深度 1，属正常叶子传参而非 drilling。

**结论：未发现实际 Props Drilling。** Profiler 全树接力深度测量无必要（无候选链）。

### 3.3 过度封装 —— 未发现实例

- 全 components/ + mobile/ 无「仅渲染 children / 裸转发 {...props}」的透传组件（0 处）。
- `src/components/ui/` 的 BrandButton/BrandInput/BrandSelect/BrandSwitch 为真样式原语
  （variant/size 映射表 + 受控 props），属设计系统层而非无意义封装。

**结论：未发现过度封装。** 该项与 Profiler 帧耗时测量一并撤销排期（无可测对象）。

## 4. 终版结论（2026-10-16 三轮取证后）

| 报告项 | 终版结论 | 证据 |
| --- | --- | --- |
| Props Drilling | **未发现**（结构风险被 store 直读消解；唯一接力深度 1 到叶子） | §3.2 静态证据 |
| 过度封装 | **未发现**（0 透传件；BrandUI 为真设计系统层） | §3.3 静态证据 |
| 无效重渲染 | **不构成实际问题**（选择器订阅 182:2 绝对主导；2 处整店订阅挂在低频 store；实测 0/1/1/0 提交计数） | §3.1 Profiler 实测 |
| 无限循环 | **已核实无可修复对象**：3 处嫌疑全部证伪 + exhaustive-deps 全 src 0 告警 | §2 复核记录 |

四项全部收口。后续防线：本 Profiler 测试作为订阅面回归门禁；新增 effect 由
`react-hooks/exhaustive-deps` lint 把守。React DevTools Profiler 真机帧耗时测量
（性能调优场景）不再属于「未能判断」的取证欠账，如需调优另行立项。
