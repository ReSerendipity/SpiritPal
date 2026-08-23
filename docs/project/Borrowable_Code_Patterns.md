# SpiritPal 可借鉴的代码模式和架构设计

## 概述

本文档总结了从5个优质桌面宠物开源仓库中识别出的可直接借鉴到SpiritPal项目的代码模式和架构设计。这些模式涵盖了窗口管理、状态管理、系统集成、AI交互、养成系统和Mod生态等多个方面。

## 一、窗口管理模式（参考BongoCat）

### 1.1 组合式函数模式（Composables）
**来源**：BongoCat的 `src/composables/` 目录

**模式描述**：
- 使用Vue 3 Composition API的组合式函数
- 将相关逻辑封装到独立的可复用函数中
- 通过 `use` 前缀命名，如 `useTray`、`useWindowState`

**SpiritPal应用**：
- 将React Hooks重构为类似的组合式模式
- 创建 `useTray`、`useWindowState`、`useHotkey` 等Hook
- 提高代码复用性和可测试性

**示例代码**（BongoCat的useTray.ts）：
```typescript
// 伪代码，展示模式
export function useTray() {
  const tray = ref<Tray | null>(null)
  
  const createTray = async () => {
    // 创建托盘图标
  }
  
  const updateTrayMenu = (menu: MenuTemplate) => {
    // 更新托盘菜单
  }
  
  return { tray, createTray, updateTrayMenu }
}
```

### 1.2 窗口状态管理
**来源**：BongoCat的 `useWindowState.ts`

**模式描述**：
- 使用Pinia Store管理窗口状态
- 持久化窗口位置和大小到本地存储
- 支持多屏幕适配

**SpiritPal应用**：
- 扩展Zustand Store管理窗口状态
- 添加窗口位置记忆功能
- 实现多屏幕检测和适配

### 1.3 系统托盘集成
**来源**：BongoCat的 `useTray.ts`

**模式描述**：
- 使用Tauri的Tray API
- 动态更新托盘图标和菜单
- 处理托盘点击事件

**SpiritPal应用**：
- 优化现有托盘实现
- 添加托盘图标动画
- 实现托盘右键菜单快捷操作

## 二、状态管理模式（参考BongoCat和DyberPet）

### 2.1 Pinia Store模式
**来源**：BongoCat使用Pinia + @tauri-store/pinia

**模式描述**：
- 使用Pinia进行状态管理
- 集成@tauri-store/pinia实现状态持久化
- 支持状态的自动保存和恢复

**SpiritPal应用**：
- SpiritPal使用Zustand，可借鉴其持久化模式
- 实现状态的自动保存到本地存储
- 添加状态的版本管理

### 2.2 模块化状态管理
**来源**：DyberPet的settings.py

**模式描述**：
- 将状态按功能模块拆分
- 每个模块独立管理自己的状态
- 通过信号/事件进行模块间通信

**SpiritPal应用**：
- 优化Zustand Store的模块化设计
- 添加状态变更的事件系统
- 实现状态的细粒度订阅

## 三、系统集成模式（参考RunCat365）

### 3.1 Win32 API集成
**来源**：RunCat365的C#实现

**模式描述**：
- 使用P/Invoke调用Win32 API
- 实现鼠标点击穿透
- 检测系统空闲状态

**SpiritPal应用**：
- SpiritPal已有Rust实现，可借鉴其API调用模式
- 优化鼠标点击穿透的性能
- 改进系统空闲检测的准确性

### 3.2 任务栏集成
**来源**：RunCat365的任务栏动画

**模式描述**：
- 使用系统托盘图标
- 动态更新图标动画
- 响应托盘点击事件

**SpiritPal应用**：
- 实现托盘图标动画效果
- 根据宠物状态切换图标
- 添加托盘图标的交互功能

### 3.3 进程管理
**来源**：RunCat365的单实例管理

**模式描述**：
- 检测应用是否已运行
- 防止多实例运行
- 实现进程间通信

**SpiritPal应用**：
- 添加单实例检测
- 实现进程间消息传递
- 优化WebView2资源清理

## 四、AI交互模式（参考DyberPet和Mate-Engine）

### 4.1 对话气泡系统
**来源**：DyberPet的bubbleManager.py

**模式描述**：
- 根据不同事件触发对话气泡
- 支持多种气泡类型（问候、提醒、反馈）
- 实现气泡的排队和显示逻辑

**SpiritPal应用**：
- 扩展 `bubbleManager.ts` 的功能
- 添加基于时间、行为、情绪的触发条件
- 实现气泡的优先级和排队系统

### 4.2 本地LLM集成
**来源**：Mate-Engine的QWEN 2.5 1.5b集成

**模式描述**：
- 使用本地LLM进行对话
- 支持Markdown格式输出
- 实现流式响应

**SpiritPal应用**：
- 优化 `llmClient.ts` 的流式响应支持
- 添加本地LLM的集成选项
- 实现对话的上下文管理

### 4.3 记忆系统
**来源**：DyberPet的对话记忆

**模式描述**：
- 存储用户偏好和历史对话
- 支持记忆的检索和遗忘
- 实现记忆的优先级管理

**SpiritPal应用**：
- 优化 `enhancedMemory.ts` 的记忆分类
- 添加长期记忆和短期记忆的分离
- 实现记忆的自动整理和遗忘机制

## 五、养成系统模式（参考VPet和DyberPet）

### 5.1 数值体系
**来源**：VPet的饱食度和好感度系统

**模式描述**：
- 实现多维度数值（饱食度、好感度、健康值等）
- 数值随时间衰减
- 通过交互和喂食恢复数值

**SpiritPal应用**：
- 优化 `buffManager.ts` 的数值管理
- 添加数值衰减和恢复机制
- 实现数值变化的视觉反馈

### 5.2 物品系统
**来源**：DyberPet的物品系统

**模式描述**：
- 物品分类（消耗品、收藏品）
- 物品效果（恢复数值、解锁动作）
- 物品获取（掉落、商店购买）

**SpiritPal应用**：
- 优化 `items.ts` 的物品分类
- 添加物品的稀有度和获取概率
- 实现物品的组合效果

### 5.3 任务系统
**来源**：DyberPet的番茄钟和专注时间

**模式描述**：
- 实现计时任务（番茄钟、专注时间）
- 任务完成奖励
- 任务进度跟踪

**SpiritPal应用**：
- 优化 `taskManager.ts` 的任务调度
- 添加任务的奖励和惩罚机制
- 实现任务的自动调度

## 六、Mod系统模式（参考VPet和DyberPet）

### 6.1 Mod包格式
**来源**：VPet的创意工坊和DyberPet的MOD系统

**模式描述**：
- 使用标准化的包格式
- 支持元数据和依赖声明
- 实现版本管理

**SpiritPal应用**：
- 优化 `.petmod` 包格式
- 添加Mod的版本管理和依赖检查
- 实现Mod的沙箱安全机制

### 6.2 Mod加载器
**来源**：VPet的CoreMOD系统

**模式描述**：
- 动态加载Mod资源
- 支持热重载
- 实现Mod的隔离运行

**SpiritPal应用**：
- 优化 `modManager.ts` 的加载逻辑
- 添加Mod的热重载支持
- 实现Mod的沙箱隔离

### 6.3 Mod开发工具
**来源**：VPet的ModMaker

**模式描述**：
- 提供Mod打包工具
- 支持Mod的测试和调试
- 生成Mod文档

**SpiritPal应用**：
- 开发Mod打包和测试工具
- 添加Mod的文档生成器
- 实现Mod的在线预览

## 七、实现建议

### 7.1 优先级
1. **高优先级**：窗口管理、状态管理、AI交互
2. **中优先级**：系统集成、养成系统
3. **低优先级**：Mod系统、社区生态

### 7.2 实施步骤
1. 分析现有代码，识别可借鉴的模式
2. 创建设计文档，定义接口和数据结构
3. 实现核心功能，编写单元测试
4. 集成到现有系统，进行集成测试
5. 优化性能，修复bug
6. 编写文档，分享最佳实践

### 7.3 注意事项
- 保持与现有架构的兼容性
- 遵循SpiritPal的编码规范
- 充分测试，确保稳定性
- 编写清晰的文档
