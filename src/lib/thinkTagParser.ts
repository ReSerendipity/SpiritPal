/**
 * @file thinkTagParser.ts
 * @description Think 标签解析模块 — 从 LLM 流式输出中解析思考内容
 *
 * 核心功能：
 * - 逐 chunk 累积文本，实时识别 <think> 和 </think> 标签边界
 * - 将 think 内容（内心戏）与正式回复内容分离
 * - think 内容以半透明/折叠方式展示为"内心戏字幕"，不送 TTS
 * - 支持流式处理：边接收边解析，不等待完整响应
 * - 流结束时 flush() 处理残留 buffer
 *
 * 设计来源：
 * 移植自 Open-LLM-VTuber（MIT 许可）：
 * - transformers.py:134-141 — TagState 枚举管理标签栈状态
 * - sentence_divider.py:318,342-403 — 流式处理中识别标签边界
 * - think_tag_prompt.txt — 提示词模板指导 LLM 输出思考过程
 *
 * Phase 1.4: 内心戏字幕功能
 *
 * 主要模块：
 * - ThinkTagState: Think 标签状态枚举
 * - ThinkParseResult: 解析结果接口
 * - ThinkTagParser: Think 标签流式解析器类
 * - THINK_TAG_PROMPT_FRAGMENT: 提示词片段（追加到 System Prompt）
 *
 * 依赖关系：无外部依赖
 *
 * 核心接口：
 * - ThinkTagParser.push(): 处理一个流式 chunk
 * - ThinkTagParser.flush(): 流结束时刷新剩余内容
 * - ThinkTagParser.reset(): 重置解析器状态
 */

// ============ Think 标签状态 ============

/**
 * Think 标签状态枚举
 */
export enum ThinkTagState {
  /** 不在 think 标签内 — 正式回复内容 */
  Outside = 'outside',
  /** 在 <think> 内部 — 正在接收思考内容 */
  Inside = 'inside',
}

// ============ 解析结果 ============

/**
 * Think 标签解析结果接口
 */
export interface ThinkParseResult {
  /** 思考内容（将显示为半透明/折叠字幕） */
  thinkContent: string
  /** 正式回复内容（正常显示，送 TTS） */
  replyContent: string
  /** 当前标签状态 */
  state: ThinkTagState
}

// ============ Think 标签流式解析器 ============

/**
 * Think 标签流式解析器
 *
 * 逐 chunk 累积文本，实时识别 <think> 和 </think> 边界
 *
 * 状态机逻辑：
 * - Outside 状态：遇到 <think> 时切换到 Inside，之前的文本归入 replyContent
 * - Inside 状态：遇到 </think> 时切换到 Outside，之前的文本归入 thinkContent
 * - 残留文本按当前状态归类
 *
 * 参考实现：Open-LLM-VTuber transformers.py:134-141
 */
export class ThinkTagParser {
  /** 累积缓冲区 — 保存可能跨越 chunk 边界的标签片段 */
  private buffer = ''
  /** 当前状态 */
  private state: ThinkTagState = ThinkTagState.Outside
  /** 思考内容片段累积 */
  private thinkParts: string[] = []
  /** 回复内容片段累积 */
  private replyParts: string[] = []

  /**
   * 处理一个流式 chunk
   *
   * 流程：
   * 1. 将 chunk 追加到 buffer
   * 2. 循环查找标签边界（可能一个 chunk 包含多对标签）
   * 3. 根据当前状态将标签外/内的文本归入对应 parts
   * 4. 返回当前累积的解析结果
   *
   * @param chunk 流式文本片段
   * @returns 当前解析结果
   */
  push(chunk: string): ThinkParseResult {
    this.buffer += chunk

    // 循环查找标签边界（处理同一 chunk 内多对标签的情况）
    while (true) {
      if (this.state === ThinkTagState.Outside) {
        // 查找 <think> 开始标签
        const startIdx = this.buffer.indexOf('<think>')
        if (startIdx === -1) break // 未找到开始标签，等待更多数据

        // <think> 之前的文本属于正式回复
        if (startIdx > 0) {
          this.replyParts.push(this.buffer.substring(0, startIdx))
        }
        // 跳过 <think> 标签（长度 7）
        this.buffer = this.buffer.substring(startIdx + 7)
        this.state = ThinkTagState.Inside
      } else {
        // 查找 </think> 结束标签
        const endIdx = this.buffer.indexOf('</think>')
        if (endIdx === -1) break // 未找到结束标签，等待更多数据

        // </think> 之前的文本属于思考内容
        if (endIdx > 0) {
          this.thinkParts.push(this.buffer.substring(0, endIdx))
        }
        // 跳过 </think> 标签（长度 8）
        this.buffer = this.buffer.substring(endIdx + 8)
        this.state = ThinkTagState.Outside
      }
    }

    return this.getResult()
  }

  /**
   * 获取当前解析结果（不修改状态）
   * @returns 累积的 thinkContent、replyContent 和当前 state
   */
  private getResult(): ThinkParseResult {
    return {
      thinkContent: this.thinkParts.join(''),
      replyContent: this.replyParts.join(''),
      state: this.state,
    }
  }

  /**
   * 刷新剩余 buffer（流结束时调用）
   *
   * 流结束时 buffer 中可能还有残留文本，按当前状态归类：
   * - Inside 状态：剩余文本归入 thinkContent（未闭合的 think 标签）
   * - Outside 状态：剩余文本归入 replyContent
   *
   * @returns 最终解析结果
   */
  flush(): ThinkParseResult {
    // 流结束时 buffer 中剩余的文本按当前状态归类
    if (this.buffer.length > 0) {
      if (this.state === ThinkTagState.Inside) {
        this.thinkParts.push(this.buffer)
      } else {
        this.replyParts.push(this.buffer)
      }
      this.buffer = ''
    }

    // 清理残留的未闭合标签
    const thinkContent = this.thinkParts.join('')
    const replyContent = this.replyParts.join('')

    return {
      thinkContent,
      replyContent,
      state: ThinkTagState.Outside,
    }
  }

  /**
   * 重置解析器状态
   * 清空 buffer 和累积内容，回到 Outside 初始状态
   */
  reset(): void {
    this.buffer = ''
    this.state = ThinkTagState.Outside
    this.thinkParts = []
    this.replyParts = []
  }
}

// ============ Think 标签提示词片段 ============

/**
 * Think 标签提示词片段
 *
 * 参考 Open-LLM-VTuber prompts/utils/think_tag_prompt.txt
 * 追加到 System Prompt 中，指导 LLM 输出思考过程
 *
 * 使用方式：将此字符串拼接到 System Prompt 末尾
 */
export const THINK_TAG_PROMPT_FRAGMENT = `
## 内心独白
在回复中，你可以使用 <think>...</think> 标签来表达你的内心想法、心理活动和动作。
内心独白会以半透明方式展示，与你正式的回复区分开。

示例：
*低下头，脸颊微微泛红* <think>那个……其实挺不好意思的……</think>
*心里暗暗得意* <think>哼哼，这么难的问题都被我解决了！</think>哎呀，只是一个小 bug 而已啦，没什么大不了的～
`
