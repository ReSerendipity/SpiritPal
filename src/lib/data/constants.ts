/**
 * @file constants.ts
 * @description 全局常量集中管理 — 消除散落在各模块中的魔法数字
 *
 * 评估报告 P2-1：窗口尺寸、超时时间、缓存大小等硬编码常量散布在代码中，
 * 修改时需要全局搜索。本文件集中管理，一处修改全局生效。
 *
 * 命名规范：UPPER_SNAKE_CASE（对齐 AGENTS.md §2.2）
 *
 * @module constants
 */

// ============ 窗口尺寸 ============

/** 宠物窗口最小宽度（逻辑像素，对齐 Rust min_inner_size） */
export const WIN_MIN_W = 160

/** 宠物窗口最小高度（逻辑像素） */
export const WIN_MIN_H = 200

/** 宠物窗口默认宽度（1.0× 基准适配） */
export const WIN_DEFAULT_W = 224

/** 宠物窗口默认高度（1.0× 基准适配） */
export const WIN_DEFAULT_H = 304

/** 宠物窗口最大宽度（对齐 Rust max_inner_size） */
export const WIN_MAX_W = 720

/** 宠物窗口最大高度（对齐 Rust max_inner_size） */
export const WIN_MAX_H = 900

/** 气泡顶部预留空间（防止气泡被窗口顶部裁剪） */
export const BUBBLE_TOP_SPACE = 64

/** 宠物精灵与窗口边缘的最小间距 */
export const SPRITE_MARGIN = 32

// ============ 数据库 ============

/** SQLite 数据库路径 */
export const DB_PATH = 'sqlite:spiritpal.db'

/** settings 缓存最大条目数 */
export const SETTINGS_CACHE_MAX = 50

// ============ IPC 超时 ============

/** Tauri invoke 默认超时（毫秒） */
export const IPC_DEFAULT_TIMEOUT_MS = 30_000

/** Tauri invoke 默认重试次数 */
export const IPC_DEFAULT_RETRY_COUNT = 1

/** IPC 重试延迟（毫秒） */
export const IPC_RETRY_DELAY_MS = 500

// ============ MCP 桥 ============

/** MCP 工具调用超时（秒，Rust 端 recv_timeout 对齐） */
export const MCP_TIMEOUT_SECS = 10

// ============ IPC 安全 ============

/** IPC 消息大小上限（字节） */
export const IPC_MAX_MESSAGE_SIZE = 16 * 1024 // 16KB

/** IPC Token 轮换周期（分钟） */
export const IPC_TOKEN_ROTATION_MINUTES = 30

// ============ 动画 ============

/** 默认 Live2D FPS */
export const DEFAULT_LIVE2D_FPS = 30

/** 宠物好感度衰减间隔（分钟） */
export const PET_MOOD_DECAY_INTERVAL_MIN = 5

// ============ 记忆系统 ============

/** 聊天历史 LRU 缓存上限 */
export const CHAT_HISTORY_LRU_MAX = 1000

/** 主动回忆注入冷却时间（小时） */
export const MEMORY_INJECTION_COOLDOWN_HOURS = 24

/** 记忆向量相似度阈值 */
export const MEMORY_VECTOR_THRESHOLD = 0.45

// ============ 喂食渐进恢复 ============

/** 喂食即时生效比例 */
export const FEED_IMMEDIATE_RATIO = 0.3

/** 喂食渐进恢复间隔（毫秒） */
export const FEED_RECOVERY_INTERVAL_MS = 1000

/** 喂食渐进恢复每次比例 */
export const FEED_RECOVERY_RATIO = 0.1

// ============ 边缘吸附 ============

/** 边缘吸附阈值比例 */
export const DOCK_THRESHOLD_RATIO = 0.08

/** 边缘吸附最小阈值（像素） */
export const DOCK_MIN_PX = 16
