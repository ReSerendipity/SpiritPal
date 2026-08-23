# SpiritPal 上传 GitHub 与更新机制设置指南

> 面向发布者的操作清单。最后更新：2026-08-12
> 已完成的配置见文末"已就绪"；未完成的均需你本人在 GitHub 网页操作。

## 更新机制原理（无需服务器、无需开源）

- 更新包托管在 **GitHub Releases**（私有仓库即可，附件链接公开可下载）；
- 应用启动时访问 `updates.json`（记录版本、下载地址、签名）→ 发现新版本提示更新；
- 更新包用**签名私钥**签名，应用内嵌**公钥**验证（防篡改）；
- **私有仓库 = 源码不可见，更新照常工作**（与开源无关）。

## 操作步骤（按顺序）

### 第 1 步：创建 GitHub 仓库（你操作，约 1 分钟）

1. GitHub 新建仓库，名称 **`spiritpal-app`**（或自定，但需同步改第 4 步端点）；
2. **勾选 Private（私有）**——源码保持闭源；
3. 暂不初始化 README（或随意，本地会覆盖）。

### 第 2 步：签名密钥安全处置（你操作，重要）

当前私钥位置：`src-tauri/keys/spiritpal-updater.key`（已被 .gitignore 排除，**不会上传** ✅）。

1. 将 `spiritpal-updater.key` **复制**到项目外安全位置（密码管理器 / 离线加密存储 / U 盘），并从项目目录删除副本；
2. 确认你记得生成时设置的**密钥密码**（如果设过）；
3. **私钥泄露 = 攻击者可签发恶意更新推给全体用户；私钥丢失 = 永远无法发更新**——两者都不可接受。

### 第 3 步：配置 GitHub Secrets（你操作，约 2 分钟）

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret 名 | 值 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `spiritpal-updater.key` 文件的完整内容（含首尾空行） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时设置的密码（没设过则留空不配） |

### 第 4 步：上传代码（你操作）

```bash
cd C:\Users\Doro\SpiritPal
git remote add origin https://github.com/<你的账号>/spiritpal-app.git
git push -u origin main
```

> 已确认：私钥、local.properties、图标备份目录等均被 .gitignore 排除，不会上传。

### 第 5 步：发布第一个版本（你操作）

```bash
git tag v0.1.0
git push --tags
```

推送 tag 后 GitHub Actions 自动执行 `release.yml`：三平台构建 → 上传 Releases → 生成 `updates.json`（含签名）。

### 第 6 步：验证更新链路（你操作，约 5 分钟）

1. 打开 Releases 页确认安装包已上传；
2. 打开 `https://raw.githubusercontent.com/<账号>/spiritpal-app/main/updates.json` 确认内容（记录 v0.1.0 与下载链接）；
3. 安装旧版本 → 发布新版 → 确认应用提示更新并可安装。

## 已就绪的配置（无需再改）

| 配置项 | 状态 |
|---|---|
| `tauri.conf.json` updater.active / endpoints / pubkey | ✅ 已配置（端点为 `spiritpal/spiritpal-app`，若仓库名不同需改） |
| `createUpdaterArtifacts` | ✅ 已改为 true（发布时生成签名更新包） |
| `release.yml` tauri-action + 签名 env | ✅ 已配置（tag 触发、三平台、读 Secrets） |
| 本地构建说明 | 本地 `npx tauri build` 现在需要签名环境变量：`$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content 'src-tauri\keys\spiritpal-updater.key' -Raw`（及密码变量）；不想配就临时把 createUpdaterArtifacts 改回 false 再构建 |

## 相关文档

- 发布流程与私钥风险：`docs/RELEASE_NOTES.md`
- 合规备忘：`docs/COMPLIANCE_NOTES.md`

*本文档为操作指引，不构成法律意见。*
