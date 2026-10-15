# 前端工程体系 P1 四项取证登记（2026-10-16）

> 对应前端工程体系 Flash 报告 P1：Props Drilling / 过度封装 / 无效重渲染 / 无限循环，报告原文均为「未能判断」。
> 按交接单要求：**只做低成本取证与登记，不顺手重构**。完整判定需 React DevTools Profiler 实测，超出本次整改窗口。

## 1. 取证快照（2026-10-16，静态扫描 src/）

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| `useEffect(` 调用 | 151 | tsx/ts 合计 |
| `React.memo` 使用文件 | 1 | 记忆化覆盖面极低 |
| `useMemo(` / `useCallback(` | 174 | 存在优化意识但分布待查 |
| `createContext` | 0 | **无 Context 层**，跨组件状态只能走 props 或 zustand store |
| 嫌疑：缺依赖数组的 effect | 3 处 | 见 §2 线索清单 |
| `setInterval/setTimeout`（tsx） | 62 | 定时器清理需逐处核对 |

## 2. 无限循环 / 无效重渲染线索清单（嫌疑，未判定）

1. `src/components/AchievementPanel.tsx:47` — `useEffect(() => { const unsub = mgr.onChange(...) })` 未见依赖数组：订阅型 effect 缺 deps 会每次渲染重订阅（有 cleanup 则功能正确但浪费；无 cleanup 则泄漏）。
2. `src/mobile/MobileAchievementView.tsx:50` — 同上模式。
3. `src/mobile/MobilePetView.tsx:251` — resize 监听模式，需核对 cleanup 与 deps。

> 已排除误报：`PetWindow.tsx:482/547`、`PomodoroOverlay.tsx:42` 为 ref 同步型 effect（deps 在后续行），非缺陷。

## 3. Props Drilling / 过度封装线索

- `createContext = 0` + zustand store 并存： Props Drilling 的风险结构存在（无 Context 兜底），但是否构成实际 drilling 需组件树级数据流分析，静态扫描无法定论。
- 过度封装：未做组件粒度过细的判定（需 Profiler render 计数），登记待办。

## 4. 结论与后续建议

| 报告项 | 本次结论 | 建议后续动作 |
| --- | --- | --- |
| Props Drilling | 无法静态判定（结构风险存在：无 Context 层） | 用 React DevTools Profiler 抓一次真实会话的 render 树 |
| 过度封装 | 未判定 | 同上 |
| 无效重渲染 | 线索：memo 覆盖面 1/全量组件 | Profiler 统计后对热点组件补 `React.memo` |
| 无限循环 | 3 处订阅/resize 型 effect 缺 deps 嫌疑（§2） | 逐处核对 cleanup 后补依赖数组；属小修，可独立排期 |

**本次不实施任何重构**（交接单红线）；上述线索已可作为后续工单输入。
