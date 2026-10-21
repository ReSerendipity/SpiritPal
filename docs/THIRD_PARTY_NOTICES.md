# SpiritPal 第三方组件声明（Third-Party Notices）

> 更新日期：2026-09-16。本清单非穷尽：完整依赖以 `package.json` / `pnpm-lock.yaml`、
> `src-tauri/Cargo.toml` / `Cargo.lock` 为准；各组件许可以其官方仓库与包内 LICENSE 为准。

## 项目主许可

SpiritPal 项目代码采用 [Apache License 2.0](../LICENSE)。
Live2D Cubism Core 为专有软件、**不随包分发**（见 [COMPLIANCE_CHECKLIST.md](COMPLIANCE_CHECKLIST.md)）。

## 前端主要依赖（React / TypeScript，Vite + pnpm）

| 组件 | 常见许可 | 说明 |
|---|---|---|
| React / ReactDOM | MIT | UI 框架 |
| TypeScript | Apache-2.0 | 类型系统 |
| Vite | MIT | 构建工具 |
| i18next / react-i18next | MIT | 国际化 |
| zustand | MIT | 状态管理 |
| axios / fetch 生态 | MIT | HTTP |
| Vitest / Playwright | MIT / Apache-2.0 | 测试 |

## Rust / Tauri 主要依赖

| 组件 | 常见许可 | 说明 |
|---|---|---|
| tauri / tauri-plugin-* | MIT / Apache-2.0 | 桌面框架 |
| serde / serde_json | MIT / Apache-2.0 | 序列化 |
| rusqlite / sqlite | MIT / 公有领域 | 本地数据库 |
| keyring | MIT / Apache-2.0 | 密钥存储 |
| base64 / sha2 | MIT / Apache-2.0 | 加密工具 |

## 随包资源

| 资源 | 许可 | 说明 |
|---|---|---|
| Live2D Cubism Core | 专有（不随包分发） | 用户自装，见 COMPLIANCE_CHECKLIST §2 |
| 宠物动画素材（webm/svg/png） | 项目自有或按来源仓库 | `public/pets/` |
| Doro 角色素材（`public/pets/doro/`：`spritesheet.webp` / `idle.gif` / `idle.svg`） | GPL-3.0（随源仓库 MelanTech/Dororo） | 2026-09-16 接入：随包的是**精灵图集**（`src/lib/data/characters.ts` 的 doro 档案，`spriteAsset: /pets/doro/spritesheet.webp`，`spriteType: atlas`）。**Live2D 模型（`*.model3.json`）未随包分发**——仓内不存在该文件（从未入库），运行时探测不到即回退精灵图；用户可依作者回复（MelanTech/Dororo#10，2026-09-16：经爱发电链接免费提供、允许二创）自行获取。渲染需用户自装 Cubism Core。授权状态：**作者已回复**（issue 仍为 OPEN），细节见 `CHARACTER_ATTRIBUTIONS.md` |
| 中文字体/图标 | 以文件头与来源为准 | `public/`、`src/` 内资源 |

## 端侧图像（Qwen-Image-2.1，可选能力）

> 2026-10-13 新增。**默认不随包分发模型权重**：引擎库由构建期脚本获取，权重由用户自行获取。

| 组件 | 许可 | 说明 |
|---|---|---|
| Qwen-Image-2.1 模型权重 | **Qwen Research License Agreement（研究 / 非商用）** | ⚠️ **不随包分发**；由 `scripts/fetch-qwen-image-model.mjs` 或用户自行获取。非商用限制见 COMPLIANCE_CHECKLIST §8 |
| Viggle-turbo LoRA（`dit_turbo.mnn`） | Qwen Research License Agreement | 同上（同一基础模型的衍生物） |
| Qwen3-VL-8B-Instruct（text encoder 权重） | Apache-2.0 | 与 Qwen-Image-2.1 的 text_encoder 逐字节一致，复用其 MNN 导出 |
| TAEQI2.1（tiny VAE） | MIT | madebyollin/taeqi2_1 |
| libQwenImage21（Android 运行时，AAR） | Apache-2.0 | 代码；构建期由 `scripts/fetch_qwen_image_engine.py` 解包 `.so` 与 `classes.jar` |
| MNN | Apache-2.0 | 推理引擎（AAR 版 `libMNN.so` 为 scsonic/MNN `qwen-image-21` 分支编译） |

---

*疑问或遗漏请通过 Issues 反馈。*
