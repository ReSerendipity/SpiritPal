/**
 * @file index.ts
 * @description Pet-specific React Hooks 统一导出
 *
 * 从 PetWindow.tsx 拆分出来的自定义 Hooks，按职责单一原则组织
 */

export { usePetDragging } from './usePetDragging'
export type { UsePetDraggingOptions, UsePetDraggingReturn } from './usePetDragging'

export { usePetWalk } from './usePetWalk'
export type { UsePetWalkOptions, UsePetWalkReturn, WalkState } from './usePetWalk'

export { usePetLive2D } from './usePetLive2D'
export type { UsePetLive2DOptions, UsePetLive2DReturn } from './usePetLive2D'

export { usePetBehavior } from './usePetBehavior'
export type { UsePetBehaviorOptions, UsePetBehaviorReturn } from './usePetBehavior'

export { usePetSensors } from './usePetSensors'
export type { UsePetSensorsOptions, UsePetSensorsReturn } from './usePetSensors'

export { usePetWindows } from './usePetWindows'
export type { UsePetWindowsOptions, UsePetWindowsReturn } from './usePetWindows'

export { usePetTimers } from './usePetTimers'
export type { UsePetTimersOptions, UsePetTimersReturn } from './usePetTimers'

export { usePetMemoryTriggers } from './usePetMemoryTriggers'
export type { UsePetMemoryTriggersOptions } from './usePetMemoryTriggers'
