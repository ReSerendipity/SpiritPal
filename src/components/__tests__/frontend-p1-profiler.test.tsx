/**
 * @file frontend-p1-profiler.test.tsx
 * @description 前端 P1「无效重渲染」React Profiler 实测（取证批次十二）
 *
 * 对应前端工程体系 Flash 报告 P1「无效重渲染：未能判断」——静态取证（取证登记文档
 * §1/§3）只能给出订阅面结构，本文件用 React `<Profiler>` 在 jsdom 里对**真实 store**
 * 做可编程实测，把判定从「结构推测」升级为「运行时计数」：
 *
 * 实测标本（逐字镜像仓内两种真实订阅写法）：
 * - 标本 A（选择器模式）：镜像 `AchievementPanel.tsx:24/36` 的
 *   `usePetStore((s) => s.stats[s.currentCharacterId])`；
 * - 标本 B（整店模式）：镜像 `SettingsWindow.tsx:214` / `MobileSettingsView.tsx:140`
 *   的 `useSettingsStore()`（全 src 仅有的 2 处无选择器订阅）。
 *
 * 判定问题（每个都对应一个断言，防退化）：
 * 1. 选择器订阅在**无关字段**变化时是否 0 重渲染？（无效重渲染的核心防线）
 * 2. 选择器订阅在**所选字段**变化时是否恰好 1 次重渲染？（不欠渲染）
 * 3. 整店订阅是否对任意 settingsStore 变化都重渲染？（已知代价，量化它）
 * 4. 整店订阅是否被其它 store 的变化波及？（诚实边界：跨 store 不波及）
 *
 * 口径说明（诚实边界）：本实测在 jsdom 中运行，测量的是**提交次数**（提交计数
 * 精确可靠）；actualDuration 在 jsdom 里只有相对参考价值，不作为判定依据。
 * 真机 Profiler 帧耗时仍需开发版 React DevTools，超出本仓测试设施能力范围。
 *
 * @see docs/execution/frontend-p1-forensics-20261016.md §3/§4 判定结论消费方
 */

import { Profiler } from 'react'
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NurturingStats } from '@/lib/data/types'
import { usePetStore } from '@/stores/petStore'
import { useSettingsStore } from '@/stores/settingsStore'

// 与既有组件测试一致的 Tauri mock（store 模块链路可能触及）
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => p),
}))
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

interface Commit {
  phase: 'mount' | 'update' | 'nested-update'
  actualDuration: number
}

/** 挂载被测元素并用 Profiler 统计每次真实提交 */
function mountWithProfiler(node: React.ReactNode, id: string) {
  const commits: Commit[] = []
  render(
    <Profiler
      id={id}
      onRender={(_id, phase, actualDuration) => {
        commits.push({ phase, actualDuration })
      }}
    >
      {node}
    </Profiler>,
  )
  return commits
}

/** 镜像 AchievementPanel.tsx:24 的真实选择器 */
const selectStats = (s: ReturnType<typeof usePetStore.getState>) => s.stats[s.currentCharacterId]

/** 镜像 SettingsWindow.tsx:214 的真实整店订阅 */
function WholeStoreSpecimen() {
  useSettingsStore()
  return <div data-testid="whole-store-specimen" />
}

function makeStats(hunger = 80): NurturingStats {
  return { hunger, mood: 70, health: 90, affection: 50, level: 3 } as NurturingStats
}

describe('前端 P1 · 无效重渲染 React Profiler 实测', () => {
  beforeEach(() => {
    usePetStore.setState({ stats: { 'test-char': makeStats() }, currentCharacterId: 'test-char' })
    useSettingsStore.setState({ currentCharacterId: 'test-char' })
  })

  it('判定 1：选择器订阅在无关字段变化时 0 重渲染（无效重渲染防线成立）', () => {
    const commits = mountWithProfiler(<SelectorSpecimen />, 'selector-specimen')
    const mountCount = commits.length
    expect(mountCount).toBe(1)

    // 无关变化：sharedCoins 不在选择器结果里
    act(() => {
      usePetStore.setState({ sharedCoins: 999 })
    })
    // 无关变化 2：其它角色的 stats 变化 —— 真实更新器语义：仅替换其它角色的条目，
    // 所选角色条目保持同一对象身份（注意：不能用新建对象整体替换 stats 记录，
    // 否则所选条目身份改变、重渲染合法，实验就测错了对象）
    act(() => {
      usePetStore.setState({
        stats: { ...usePetStore.getState().stats, 'other-char': makeStats(10) },
      })
    })

    expect(commits.length, `无关字段变化触发了重渲染：${JSON.stringify(commits)}`).toBe(mountCount)
  })

  it('判定 2：选择器订阅在所选字段变化时恰好 1 次重渲染（不欠渲染）', () => {
    const commits = mountWithProfiler(<SelectorSpecimen />, 'selector-specimen')
    act(() => {
      usePetStore.setState({ stats: { 'test-char': makeStats(60) } })
    })
    const updates = commits.slice(1)
    expect(updates.length).toBe(1)
    expect(updates[0].phase).toBe('update')
  })

  it('判定 3：整店订阅对任意 settingsStore 变化都重渲染（已知代价，量化）', () => {
    const commits = mountWithProfiler(<WholeStoreSpecimen />, 'whole-store-specimen')
    expect(commits.length).toBe(1)

    // 两次「与宠物窗口无关」的设置变化（语言、静音开关）
    act(() => {
      useSettingsStore.getState().updateSettings({ language: 'ja' })
    })
    act(() => {
      useSettingsStore.getState().updateSettings({ silentModeEnabled: true })
    })

    expect(commits.length, '整店订阅应每次变化都重渲染').toBe(3)
  })

  it('判定 4：整店订阅不被其它 store 波及（跨 store 不串扰的诚实边界）', () => {
    const commits = mountWithProfiler(<WholeStoreSpecimen />, 'whole-store-specimen')
    act(() => {
      usePetStore.setState({ sharedCoins: 12345 })
    })
    expect(commits.length).toBe(1)
  })
})

/** 镜像 AchievementPanel.tsx:36 的真实选择器订阅写法 */
function SelectorSpecimen() {
  usePetStore(selectStats)
  return <div data-testid="selector-specimen" />
}
