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

> **2026-10-21 订正（2026-09-15 状态补记的重申）**：本节「发布前」①② 实际已完成——① commit `f9e0f43`（2026-09-10）已将 endpoints 修正为 `ReSerendipity/SpiritPal`（`src-tauri/tauri.conf.json` 实测为真）；② 签名密钥已随 v0.1.0 发布链接入（`TAURI_SIGNING_PRIVATE_KEY`，配对验证状态以 `docs/RELEASE_NOTES.md` 表行 2 的「接入未验证」为准）；③ 已由 v0.1.0（2026-09-10 发布）走完。当前状态以 §7 与 `docs/RELEASE_NOTES.md` 为准，本节保留作机制说明。

- 采用 Tauri updater + GitHub Releases 静态托管，**无需自建服务器**；
- 发布前：① 创建真实仓库并将 `tauri.conf.json` 的 updater 端点从占位域名改为真实地址；② 生成并离线保管签名私钥（私钥丢失=无法发更新，泄露=可注入恶意更新）；③ 发布时构建安装包 → 上传 Releases → 更新 `updates.json`（版本、URL、签名）；
- 详见 `RELEASE_NOTES.md`。

## 5. MCP 安全（现状已达标）

- `mcpClient.ts`：默认权限规则为"需要确认"（保守策略），外部工具调用前需用户确认；
- `agentTools.ts`：4 级权限（Chat 无工具 / Agent 安全工具 / Developer 只读 / Worker 完全系统访问），Worker 需用户确认；
- 建议保持：不将 Worker 设为默认；首次连接陌生 MCP 服务器时提示来源风险。

## 6. 开源合规（已处理）

- 曾标注"移植自 DyberPet"（GPL-3.0）的核心模块已重写或中性化处理；
- 内置角色仅 doro（作者已回复提供免费获取渠道并允许二创，见 MelanTech/Dororo#10）；feibi 已转外部包（character-packs/feibi/ 模板 + 用户自备素材）、gugugaga 因无源头已删除（同角色由有来源的 xiang-qie 社区包覆盖）；
- Open-LLM-VTuber（MIT）移植标注依法保留。

*本说明为初稿参考，不构成正式法律意见。*

---

## 7. 状态补记（2026-09-15）

- **仓库模式**：2026-09-08 起为单仓公开模式（origin = ReSerendipity/SpiritPal，Apache-2.0 全量开源，含完整 main 历史）；§3 社区功能结论不变（GitHub Releases 静态分发，无 UGC 义务）。
- **更新机制**：§4 所述「updater 关闭」已于 2026-09-10 解除（commit `f9e0f43`：`plugins.updater.active=true` + `createUpdaterArtifacts=true`，endpoints 修正为 ReSerendipity/SpiritPal）；当前状态以 `docs/RELEASE_NOTES.md` 为准，`updates.json` 随 v0.1.0 发布链维护。
- **发布前 TODO**：Live2D 发行许可申请仍为发布前必办项（见 `docs/LIVE2D_LICENSE_REMINDER.md`）；更新签名密钥配对验证仍为「接入未验证」状态。

---

## 8. 端侧图像（Qwen-Image-2.1）许可提示（2026-10-13）

**结论：该能力的模型权重为「研究 / 非商用」许可，与本仓 Apache-2.0 公开开源存在冲突，启用前必须处置。**

| 组件 | 许可 | 与本仓（Apache-2.0）的关系 |
|---|---|---|
| Qwen-Image-2.1 模型权重 | **Qwen Research License Agreement** | ⚠️ 研究 / 非商用 |
| Viggle-turbo LoRA（Turbo DiT） | Qwen Research License Agreement | ⚠️ 同上 |
| text encoder（Qwen3-VL-8B-Instruct） | Apache-2.0 | ✅ 兼容 |
| TAEQI2.1（tiny VAE） | MIT | ✅ 兼容 |
| libQwenImage21 代码 / MNN | Apache-2.0 | ✅ 兼容 |

**处置建议（三选一，需所有者拍板）**：

1. **不随包分发权重**（推荐，与现有「发框架、用户自取权重」惯例一致）：本仓只提供脚本与能力，权重由用户自行获取；在「关于 / 开源许可」页显式标注非商用限制与来源链接；
2. **降级为可选实验特性**：默认不启用，用户显式确认许可条款后才解锁；
3. **放弃该模型**：若本仓有商用计划，改用可商用的 MNN 图像模型。

**当前实现状态**：已按建议 1 落地 —— `scripts/fetch-qwen-image-model.mjs` 由**用户自行运行**，权重不入库、不随包分发；`THIRD_PARTY_NOTICES.md` 已标注。

**遗留**：若日后把该能力作为**默认产品特性**对外分发，则须先完成上述 1/2/3 之一的正式决策。
