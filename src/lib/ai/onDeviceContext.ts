/**
 * 端侧（on-device）上下文辅助 —— 「助手自己的历史输出」去锚定。
 *
 * ## 为什么需要这个（GOTCHAS #184）
 *
 * 真机实测（RMX5010 / Qwen3.5-4B-MNN）暴露了一个**不是模型能力问题**的答错来源：
 * 模型把**自己上一轮的错误回答**当成必须维持的「已建立设定」，于是陷入两难而空转。
 * 4B 开启思维链时的推理原文：
 *
 * > `Wait, checking math again. 9.9 vs 9.11. ... 9.9 is bigger.`
 * > `The conversation history established WRONG MATH (9.11 > 9.9).`
 * > `If I repeat it, I look dumb. If I correct it, I break the established fiction`
 * > `(since the previous turns accepted it as truth). Given this ...`
 *
 * 它**自己算对了**，却被历史绑住 —— 最终空转 3592 token / 254 秒仍未收敛。
 * 同一模型关掉思维链时反而 17 秒给出干净回复（只是答案仍受锚定影响）。
 *
 * ## 缓解手段
 *
 * 小模型对**自己的长输出**赋予的「权威感」远高于对用户输入的，因此对端侧把
 * **助手侧历史截断**到 `ON_DEVICE_ASSISTANT_HISTORY_CHARS`：
 * - 保留开场语气，维持对话连贯与角色口吻；
 * - 截掉长篇断言（正是会把模型锚死在错误结论上的部分）；
 * - **用户侧历史不动** —— 那是真正的上下文，截断会丢信息。
 *
 * 这是**降低锚定强度**，不是「删历史」；也不改角色设定，避免与「像一张白纸/情绪一致性」
 * 的产品口径冲突（改提示词属产品决策，未做）。
 */

/** 端侧助手侧历史保留的字符数（超出即截断并加省略号） */
export const ON_DEVICE_ASSISTANT_HISTORY_CHARS = 120

/** 截断标记（与界面无关，仅进 prompt） */
const ELLIPSIS = '…'

/**
 * 按需截断助手侧历史。
 *
 * @param messages 已按时间升序排列的历史消息（会被复制，不原地修改）
 * @param enabled  是否启用（`provider === 'ondevice'` 时传 true）
 * @param limit    助手侧保留字符数，默认 {@link ON_DEVICE_ASSISTANT_HISTORY_CHARS}
 * @returns 新的消息数组；`enabled=false` 时返回原数组的浅拷贝
 */
export function truncateAssistantHistory<T extends { role: 'system' | 'user' | 'assistant'; content: string }>(
  messages: readonly T[],
  enabled: boolean,
  limit = ON_DEVICE_ASSISTANT_HISTORY_CHARS,
): T[] {
  if (!enabled) return [...messages]
  return messages.map((m) => {
    if (m.role !== 'assistant') return m
    if (m.content.length <= limit) return m
    return { ...m, content: m.content.slice(0, limit) + ELLIPSIS }
  })
}
