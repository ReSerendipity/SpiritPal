# SpiritPal 上传 GitHub 创建资料

> 面向"新建 GitHub 私有仓库并上传"的操作资料。最后更新：2026-08-12
> 更新机制与发布流程详见 `docs/GH_UPLOAD_GUIDE.md` 与 `docs/RELEASE_NOTES.md`。

## 1. 仓库创建信息（创建页面逐项填）

| 字段 | 值 |
|---|---|
| **产品中文名** | **桌边友**（SpiritPal 的中文名——桌边的伙伴） |
| **Repository name** | **`spiritpal-app`**（⚠️ 建议用这个名字——`tauri.conf.json` 的更新端点预设为 `spiritpal/spiritpal-app`；若换名需同步改端点） |
| **Description**（英文，建议 ≤350 字符） | `Cross-platform AI desktop pet built with Tauri v2 (Rust + React 19 + TypeScript). Local-first memory, optional LLM integration (Ollama / OpenAI / Claude / Gemini / DeepSeek), Live2D support, MCP tools. "Useless but healing."` |
| **Description**（中文备选） | `桌边友（SpiritPal）——跨平台 AI 桌面伙伴（Tauri v2 + Rust + React）：本地优先记忆、可选接入多款 LLM、Live2D 支持、MCP 工具。` |
| **Visibility** | **Private（私有）** |
| **Add a README** | ❌ 不勾选（仓库已有 README.md） |
| **Add .gitignore** | ❌ 不勾选（仓库已有） |
| **Choose a license** | ❌ 不勾选（私有阶段可不设；转公开前再补） |

## 2. Topics（可选）

`tauri` `desktop-pet` `react` `rust` `typescript` `ai` `llm` `desktop-app` `live2d` `mcp` `companion-app`

## 3. 上传命令（创建后在本地执行）

```bash
cd C:\Users\Doro\SpiritPal
git remote add origin https://github.com/<你的账号>/spiritpal-app.git
git push -u origin main
```

## 4. 推送前安全核查（已确认 ✅，工作区干净）

| 文件 | 状态 |
|---|---|
| `.env` / `.env.*` | ✅ 已 gitignore |
| 签名私钥 `src-tauri/keys/spiritpal-updater.key` | ✅ 已 gitignore（含 `*.key` 规则），从未提交过 |
| `artifacts/`（构建产物） | ✅ 已 gitignore |
| `src-tauri/gen/android/keystore.properties` | ✅ 已 gitignore |
| 当前未提交改动 | ✅ 0 条，可直接 push |

## 5. 私有仓库与更新机制（重要）

- **私有仓库不影响自动更新**：Releases 附件可生成公开下载链接，应用照常检查 `updates.json`（见 `GH_UPLOAD_GUIDE.md`）；
- 但注意：**Releases 下载链接是公开可访问的**——知道链接的人可下载安装包（对更新机制这是必要的；安装包不含源码）；
- 发布第一个版本前：在 GitHub Secrets 配置 `TAURI_SIGNING_PRIVATE_KEY`（私钥内容）与密码（见 `GH_UPLOAD_GUIDE.md` 第 3 步）。

## 6. 注意

- 项目当前**无 LICENSE**（私有仓库可接受）；将来转公开前必须补（若内置角色涉及第三方 IP 设定，转公开前需另行评估）；
- 合规备忘：`docs/COMPLIANCE_NOTES.md`；Live2D 发行许可提醒：`docs/LIVE2D_LICENSE_REMINDER.md`。
