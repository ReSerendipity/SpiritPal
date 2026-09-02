# SpiritPal 合规说明（Compliance Notes）

> 面向开发者/发行者的内部合规备忘。最后更新：2026-08-12

## 1. 数据出境（已处理）

- 服务商分级：Ollama（本地）/ DeepSeek·Qwen·GLM·Kimi·Doubao（境内）/ OpenAI·Claude·Gemini（境外）；
- 用户选择境外服务商前需确认（提示机制随设置界面实现，见 `PRIVACY_POLICY.md` §2）；
- IP 定位（ipapi.co）与天气（open-meteo.com）为境外服务，已在隐私政策披露；
- 建议：设置页默认推荐 Ollama；后续可提供"仅本地模式"开关。

## 2. Live2D（社区方案：默认禁用 + 用户自装 Cubism Core）

- 渲染实现（`Live2DRenderer.tsx` / `renderAdapter.ts`）保留，`sample.model3.json` 空壳已移除；
- **应用不随包分发 Cubism Core**（Live2D 专有软件，官方不在 GitHub 发布，仅随官网 SDK 包分发）：Core 缺失时渲染器自动 fallback 精灵图，并提示用户从 Live2D 官网下载 SDK 后将 `live2dcubismcore.js` 放入应用数据目录——参考社区做法（astrbot-live2d-desktop：首次启动提示用户自装；AITuberKit：默认禁用）；
- 模型文件由用户自备（模型属创作者作品，与 SDK 许可无关）；
- **许可门槛**：个人/小规模非商业发行，Live2D 发行许可与费用可免除；将应用作为业务主要元素且**年销售额超过 2000 万日元**（约 100 万人民币）时，需与 Live2D 签订许可协议——见 https://www.live2d.com/zh-CHS/sdk/license；
- 发行时在"关于/开源许可"页标注 Live2D 版权声明。

## 3. 社区功能（当前占位，未提供服务）

- `communityApi` 当前指向占位 URL，请求失败自动回退 mock，**未提供真实社区服务**，因此不承担 UGC 平台义务；
- 未来若上线真实社区（上传/评论/评分）：需补内容审核、侵权投诉（通知-删除）、用户协议、账号管理，并评估备案义务；
- 仅使用 GitHub Releases 静态分发（无用户上传）则无 UGC 义务。

## 4. 更新机制（发布前待办）

- 采用 Tauri updater + GitHub Releases 静态托管，**无需自建服务器**；
- 发布前：① 创建真实仓库并将 `tauri.conf.json` 的 updater 端点从占位域名改为真实地址；② 生成并离线保管签名私钥（私钥丢失=无法发更新，泄露=可注入恶意更新）；③ 发布时构建安装包 → 上传 Releases → 更新 `updates.json`（版本、URL、签名）；
- 详见 `RELEASE_NOTES.md`。

## 5. MCP 安全（现状已达标）

- `mcpClient.ts`：默认权限规则为"需要确认"（保守策略），外部工具调用前需用户确认；
- `agentTools.ts`：4 级权限（Chat 无工具 / Agent 安全工具 / Developer 只读 / Worker 完全系统访问），Worker 需用户确认；
- 建议保持：不将 Worker 设为默认；首次连接陌生 MCP 服务器时提示来源风险。

## 6. 开源合规（已处理）

- 曾标注"移植自 DyberPet"（GPL-3.0）的核心模块已重写或中性化处理；
- 内置角色为第三方游戏 IP 角色（doro/feibi/gugugaga），已 mod 化，配置存放于仓库外，由用户自装；
- Open-LLM-VTuber（MIT）移植标注依法保留。

*本说明为初稿参考，不构成正式法律意见。*
