/**
 * 对话配置 — SpiritPal 内置对话图（有向图遍历）
 *
 * @fileoverview
 * 主要模块：
 * - WELCOME_DIALOGUE：欢迎对话（新角色首次见面的互动对话，有向图+选项分支）
 * - DAILY_CHAT：日常闲聊对话
 * - 其他预定义对话图
 *
 * 通过 DialogueManager.loadFromConfig 加载
 *
 * 对话图结构：
 * - graphs：对话图数组，每个图有 ID、起始节点、节点列表
 * - nodes：对话节点，包含文本、说话者、选项分支、奖励、效果
 * - options：对话选项，包含文本、下一节点ID、条件、效果
 *
 * @module dialogueConfig
 * @requires ./dialogueManager - DialogueConfigFile 类型定义
 */

// 对话配置 — SpiritPal 内置对话图（有向图遍历）
// 通过 DialogueManager.loadFromConfig 加载
import type { DialogueConfigFile } from './dialogueManager'

// ============ 欢迎对话 ============
// 新角色首次见面的互动对话（有向图，支持选项分支）
export const WELCOME_DIALOGUE: DialogueConfigFile = {
  graphs: [
    {
      id: 'welcome',
      startNodeId: 'start',
      nodes: [
        {
          id: 'start',
          text: '嗨～我是你的新伙伴！很高兴见到你呀！',
          speaker: '新伙伴',
          options: [
            { text: '欢迎你！', nextNodeId: 'welcome_back' },
            { text: '你叫什么名字？', nextNodeId: 'ask_name' },
            { text: '我先去忙了', nextNodeId: 'bye' },
          ],
        },
        {
          id: 'ask_name',
          text: '名字嘛……你可以叫我伙伴，也可以给我起个专属昵称哦！',
          speaker: '新伙伴',
          options: [
            { text: '那我叫你小伙伴吧', nextNodeId: 'welcome_back' },
            { text: '先这样吧', nextNodeId: 'welcome_back' },
          ],
        },
        {
          id: 'welcome_back',
          text: '以后就请多关照啦！我会一直陪着你的～要不要摸摸我的头？',
          speaker: '新伙伴',
          reward: ['toy-plush'],
        },
        {
          id: 'bye',
          text: '好哒，你去忙吧！我在这儿等你回来～',
          speaker: '新伙伴',
        },
      ],
    },
    // ============ 日常闲聊 ============
    {
      id: 'daily_chat',
      startNodeId: 'greet',
      nodes: [
        {
          id: 'greet',
          text: '今天过得怎么样呀？',
          speaker: '伙伴',
          options: [
            { text: '还不错！', nextNodeId: 'good' },
            { text: '有点累', nextNodeId: 'tired' },
            { text: '说点好玩的', nextNodeId: 'fun' },
          ],
        },
        {
          id: 'good',
          text: '那就好！看到你开心我也开心～',
          speaker: '伙伴',
        },
        {
          id: 'tired',
          text: '辛苦啦……要不要休息一下？我陪你发会儿呆。',
          speaker: '伙伴',
        },
        {
          id: 'fun',
          text: '你知道吗？据说摸宠物会降低血压哦！要不要试试？',
          speaker: '伙伴',
          reward: ['toy-ball'],
        },
      ],
    },
  ],
}
