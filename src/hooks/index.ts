/**
 * @file index.ts
 * @description React Hooks 统一导出
 *
 * 自定义 React Hooks，从大组件中提取的可复用逻辑
 */

// 通用 Hooks
export { useSafeTimeout, useTimeout } from './useSafeTimeout'
export { useDisposable, useEventListener } from './useDisposable'
export type { UsePetGazeOptions, UsePetGazeReturn } from './usePetGaze'
export { usePetGaze } from './usePetGaze'

// Pet 相关 Hooks（从 PetWindow.tsx 拆分，共 8 个）
export {
  usePetDragging,
  usePetWalk,
  usePetLive2D,
  usePetBehavior,
  usePetSensors,
  usePetWindows,
  usePetTimers,
  usePetMemoryTriggers,
} from './pet'
export type {
  UsePetDraggingOptions,
  UsePetDraggingReturn,
  UsePetWalkOptions,
  UsePetWalkReturn,
  WalkState,
  UsePetLive2DOptions,
  UsePetLive2DReturn,
  UsePetBehaviorOptions,
  UsePetBehaviorReturn,
  UsePetSensorsOptions,
  UsePetSensorsReturn,
  UsePetWindowsOptions,
  UsePetWindowsReturn,
  UsePetTimersOptions,
  UsePetTimersReturn,
  UsePetMemoryTriggersOptions,
} from './pet'
