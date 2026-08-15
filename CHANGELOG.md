# Changelog

本项目所有重要变更记录均在此文件中追踪。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### Added
- `install.bat` — Windows 一键安装脚本（自动检查 Node.js / pnpm / Rust）
- `start.bat` — Windows 一键启动开发环境脚本
- `scripts/build-release.bat` — 一键构建安装包脚本
- `scripts/run-all-tests.bat` — 一键运行全部测试脚本（lint + vitest + e2e + cargo test）
- `scripts/generate-icons.bat` — 应用图标重新生成脚本
- `.env.example` — 环境变量模板
- `docs/DEPLOYMENT.md` — 部署与发布文档
- `src-tauri/tests/` — Rust 集成测试目录
  - `crypto.rs` — AES-256-GCM 加密/解密、密钥派生、SHA-256 哈希测试
  - `validation.rs` — 输入校验（命令注入防护、路径遍历防护）测试
  - `encrypted_db.rs` — 数据库加密 Base64 往返测试

### Changed
- `crypto.rs` 新增内联单元测试模块（加密解密往返、数据损坏检测、密钥派生一致性）

---

## [0.1.0] - 2026-08-10

### Added — 项目初始发布

#### 核心功能
- 跨平台 AI 桌面宠物应用（Tauri v2 + React 19 + TypeScript + Rust）
 核心理念："简单却温暖" — 情感陪伴、轻量交互、温和生产力辅助
- 三窗口架构：宠物窗口（300×400）、设置窗口（720×540）、聊天窗口（420×600）
- 全部窗口无边框、透明、可拖拽、可缩放，关闭时隐藏到系统托盘

#### 宠物系统
- Live2D 模型渲染（Pixi.js 7 + pixi-live2d-display）
- 多角色支持（角色配置、动画系统、对话管理）
- 宠物行为状态机（行为引擎、定时器、传感器上下文感知）
- 宠物行走动画、拖拽交互、光标注视效果
- 气泡对话系统与主动交互

#### AI 与记忆系统
- 多 Provider LLM 集成（OpenAI / Anthropic / Google / 本地模型）
- MCP 协议服务器（@modelcontextprotocol/sdk）
- 增强记忆系统 — AES-256-GCM 加密存储 + 语义向量搜索
- 本地嵌入模型（@xenova/transformers）
- 记忆触发器（纪念日、节日）

#### 游戏化系统
- 养成系统（商店管理、Buff 管理、任务管理）
- Mod 系统（.petmod 包导入、Shimeji 加载器）

#### 安全加固
- AES-256-GCM + PBKDF2 密钥派生（100,000 次迭代）
- SQLite 数据库文件级加密（运行时明文、关闭后加密）
- API Key 系统钥匙链存储（Windows Credential Manager / macOS Keychain）
- 代码混淆 + SRI 完整性校验
- 输入校验（命令注入防护、路径遍历防护）
- 反调试检测

#### 系统集成
- 系统托盘管理（菜单、图标切换）
- Win32 API：鼠标穿透、系统空闲检测、前台窗口信息
- 全局热键（Ctrl+Shift+P）
- 单实例插件（防止多开）
- 全局键鼠监听（宠物注视光标效果）
- 系统空闲检测

#### 移动端
- 移动端适配视图（MobilePetView / MobileChatView / MobileNurturingView / MobileSettingsView）

#### 测试体系
- Vitest 单元测试（组件 + 库函数 + 状态管理三层全覆盖）
- Playwright E2E 测试（12 个 spec 文件，涵盖多窗口、聊天、设置、养成等场景）
- 性能测试脚本（冷启动、内存、FPS、泄漏、压力、渗透、基线趋势、包体积）
- Rust 单元测试（32 个核心逻辑测试）

#### 国际化
- i18next + react-i18next 集成

#### CI/CD
- CI 工作流：TypeScript 类型检查 + Vitest 覆盖率 + Rust 测试 + Clippy + Fmt + 三平台构建
- CodeQL 安全扫描工作流
- 自动发布工作流（tag 触发，三平台构建 → GitHub Release）

#### 开发工具
- AGENTS.md — AI 辅助开发规范
- 辅助脚本：WindowPet 资源转换器、代码混淆 + SRI 生成
- ESLint + Prettier + TypeScript 严格模式
