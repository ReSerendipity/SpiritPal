# 真机冒烟 Checklist（2026-08-28）

> 背景：本会话 Rust 侧新增/修复了大量命令（system_tools / crypto ENC3 / petmod 打包链路 / 迷你模式），
> 它们通过了编译与单元测试，但 **Win32 FFI 与 COM 的运行时路径只能真机验证**。
> AI 无法替代人工执行，发版前请逐项勾选。
>
> 产物：`artifacts/SpiritPal_0.1.0_x64-setup.exe`（或直接 `pnpm dev` 冒烟）。

## A. 新 Rust 命令（本会话 C 类补齐）

> **2026-08-29 更新**：新增自动化运行时集成测试 `src-tauri/tests/test_system_runtime.rs`，
> 在真实中文 Windows 上直接调用命令（`tauri::async_runtime::block_on`）。当场暴露并修复三个
> 纯逻辑单测永远测不到的 bug（详见 KNOWN_GOTCHAS #48）：get_running_processes 进程名 NUL 尾巴、
> execute_command 在 GBK 控制台返回空、execute_command 白名单可被 `&` 链式绕过。
> 已勾选项 = 该测试已覆盖并通过；未勾选项 = 需窗口/有副作用/需人眼，仍属人工验收。

- [ ] **take_screenshot（区域）**：让宠物「看看」或触发视觉感知 → 气泡出现对屏幕内容的描述
      （需 WebviewWindow/AppHandle，无法在纯集成测试里跑；人工验收）
- [ ] **take_screenshot（全屏 + maxWidth）**：`visualPerception.captureScreen` 路径 → 返回 512 宽 PNG
      （同上，人工验收）
- [x] **get_running_processes**：✅ 运行时测试覆盖（真 Toolhelp32 枚举，修复 NUL 尾巴后进程名干净、含 svchost/explorer）
      人工仍建议：打开/关闭某个 AI 助手窗口，观察前端检测结果变化
- [ ] **set_system_volume**：快速控制面板拖音量滑条 → 系统音量随之变化（0~100%）
      （会真的改用户机器音量 + 变没变须人耳/肉眼，人工验收）
- [ ] **set_system_brightness**：调亮度滑条 → 笔记本内屏亮度变化
      （有副作用 + 需人眼；台式机外接屏应得明确错误提示属预期，人工验收）
- [ ] **search_files**：Agent 工具搜索（如有入口）→ 返回相对路径列表，node_modules/target 不出现
      （内部 search_recursive 已有单测覆盖跳过逻辑；端到端入口人工验收）
- [x] **execute_command（白名单内）**：✅ 运行时测试覆盖（真起 cmd 执行 tasklist/ipconfig，修复 GBK 空输出后有真实内容）
- [x] **execute_command（白名单外）**：✅ 运行时测试覆盖（`del ...` 返回"不在只读白名单内"；新增 `&` 链式注入也被拒）
- [ ] **sync/read_widget_state**：小组件状态保存 → 重启后恢复
      （需 AppHandle；deep-link 链路已在模拟器实测，但状态文件跨重启持久化仍建议人工确认）

## B. 本会话功能接线

- [ ] **迷你模式（A-14）**：宠物面板「迷你模式」→ 窗口缩至 80×80 吸附边缘；悬停预览展开；再点退出恢复
- [ ] **装饰伪物理（A-13）**：导入含 `physics3.json` 的社区角色 → 走动时饰品/发丝摆动且回正；
      默认 Doro 角色无回归（无 physicsPath 时不启用物理）
- [ ] **抚摸粒子（A-7）**：抚摸宠物 → 心形粒子 60fps 不掉帧（devtools Performance 粗查）
- [ ] **Mod 打包（A-15）**：角色管理 → 导出 Mod → 产出 `.petmod` → 重新导入成功、manifest 校验通过
- [ ] **数据治理（B-3）**：设置 → 数据 → 「数据治理」显示遗留副本统计 → 清理 → 二次确认后行数归零
- [ ] **ENC3 大 blob（B-3）**：构造 >5MB 记忆数据（长对话积累或导入）→ 写入后重启能解密加载；
      用文本编辑器打开 DB 中该值应为 `ENC3:` 前缀的 base64
- [ ] **记忆导出（A-12）**：MemoryPanel 导出 JSON/CSV/Markdown → 字段齐全、PII 已打码

## C. 批次一（2026-08-28 已完成接线，以下为真机验收项）

- [ ] **静默模式（A-5）**：面板「静默5分钟」→ 主动发言停止；到期自动恢复（30s 爬墙同理）；会议中自动静音
- [ ] **看看（A-1）**：面板「看看」→ 气泡显示屏幕描述；无 LLM 配置时显示引导文案不报错
- [ ] **记忆可视化（A-4）**：设置 → 记忆 → 切「可视化」→ 时间线/情绪分布非空；切回「精简」无回归
- [ ] **贴边互动（A-2/A-3）**：拖宠物到屏幕左/右边缘松手 → 贴边攀爬/探头姿态 + 旋转表情过渡；
      拖回中央恢复；爬墙 30s 后自动回流正常
- [ ] **主动说话链路（A-5 连带修复）**：空闲 > 5 分钟 → 宠物随机主动开口（此前定时器从未启动，
      整个主动说话功能实际是断的）

## D. 批次二（2026-08-29 已完成接线，以下为真机验收项）

- [ ] **插值文案（A-9）**：任意带参数文案（如「获得 {amount} 金币」）→ 显示实际数字而非 `{amount}`；
      切到 en/ja/ko 同样生效
- [ ] **情绪分布（A-10）**：设置 → 记忆 → 可视化 → 情绪分布 Tab → 无数据时显示空态引导；
      对话若干轮后再看，出现**与对话情绪相符**的真实分布（不再是随机值）
- [ ] **文化表情（A-9/A-10）**：宠物主动开口时气泡带一个表情；切换应用语言（中/日/英/韩）
      后表情风格随之变化
- [ ] **日记（A-8）**：设置 → 日记 → 「生成今日日记」→ 显示摘要/心情/关键词；
      「导出 Markdown」→ 下载到 .md 文件且内容完整
- [ ] **外部日历（A-8）**：从 Google/Outlook/Apple 日历导出一个 .ics → 日程页「导入 .ics」→
      事件出现在「外部日历」区并标注来源文件名

## E. 已知预期内降级（不是 bug）

| 现象 | 原因 |
|---|---|
| 「看看」显示启发式描述而非 LLM 分析 | `analyze_screen_content` 计划中（需 llmClient 多模态），走 fallbackAnalysis |
| 亮度调节失败提示 WMI 不支持 | 台式机外接屏无 WMI 亮度通道，属明确错误提示 |
| `set_system_volume/brightness` 在 macOS/Linux 报错 | Windows-only 命令，非 Windows 返回明确 Err |
