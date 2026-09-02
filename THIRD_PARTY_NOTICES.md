# SpiritPal 第三方组件声明（Third-Party Notices）

> 更新日期：2026-09-02。本清单非穷尽：完整依赖以 `package.json` / `pnpm-lock.yaml`、
> `src-tauri/Cargo.toml` / `Cargo.lock` 为准；各组件许可以其官方仓库与包内 LICENSE 为准。

## 项目主许可

SpiritPal 项目代码采用 [Apache License 2.0](LICENSE)。
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
| 宠物动画素材（webm/svg/png） | 项目自有或按来源仓库 | `public/pets/`、`public/characters/` |
| 中文字体/图标 | 以文件头与来源为准 | `public/`、`src/` 内资源 |

---

*疑问或遗漏请通过 Issues 反馈。*