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

## 3. Props Drilling / 过度封装线索

- `createContext = 0` + zustand store 并存： Props Drilling 的风险结构存在（无 Context 兜底），但是否构成实际 drilling 需组件树级数据流分析，静态扫描无法定论。
- 过度封装：未做组件粒度过细的判定（需 Profiler render 计数），登记待办。

## 4. 结论与后续建议（2026-10-16 复核后）

| 报告项 | 本次结论 | 建议后续动作 |
| --- | --- | --- |
| Props Drilling | 无法静态判定（结构风险存在：无 Context 层） | 用 React DevTools Profiler 抓一次真实会话的 render 树 |
| 过度封装 | 未判定 | 同上 |
| 无效重渲染 | 线索：memo 覆盖面 1/全量组件 | Profiler 统计后对热点组件补 `React.memo` |
| 无限循环 | **已核实无可修复对象**：3 处嫌疑全部证伪 + exhaustive-deps 全 src 0 告警 | 无需排期；新增 effect 由既有 lint 规则把守 |

**本次不实施任何重构**（交接单红线）；本复核为纯取证更新，无代码改动。
