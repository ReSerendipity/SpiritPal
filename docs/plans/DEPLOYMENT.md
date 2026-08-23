# SpiritPal 部署与发布指南

本文档记录 SpiritPal 桌面宠物的完整发布流程，包括版本管理、构建打包、签名、发布等步骤。

---

## 一、版本号管理

SpiritPal 的版本号需要在以下 **3 个文件** 中同步修改：

| 文件 | 字段 | 示例 |
|------|------|------|
| `package.json` | `"version"` | `"0.1.0"` |
| `src-tauri/Cargo.toml` | `version = ` | `version = "0.1.0"` |
| `src-tauri/tauri.conf.json` | `"version"` | `"0.1.0"` |

### 版本号规则

遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

```
MAJOR.MINOR.PATCH
  │     │     │
  │     │     └── 向后兼容的 bug 修复
  │     └──────── 向后兼容的新功能
  └────────────── 不兼容的 API 变更
```

### 更新版本号的步骤

1. 修改上述 3 个文件中的版本号
2. 在 `CHANGELOG.md` 中添加 `[x.y.z] - YYYY-MM-DD` 章节
3. 提交更改：`git commit -m "chore: bump version to x.y.z"`
4. 创建 Git 标签：`git tag vx.y.z`
5. 推送标签：`git push origin vx.y.z`（触发自动发布工作流）

---

## 二、构建打包

### 2.1 一键构建（推荐）

双击 `scripts/build-release.bat` 或执行：

```powershell
cd C:\Users\Doro\SpiritPal
.\scripts\build-release.bat
```

脚本会自动：
1. 检查构建环境（Node.js / pnpm / Rust）
2. 执行 `pnpm tauri build`（前端编译 + Rust 编译 + 打包）
3. 复制构建产物到 `artifacts/` 目录
4. 打开输出目录

### 2.2 手动构建

```powershell
cd C:\Users\Doro\SpiritPal

# 完整构建
npx tauri build

# 仅构建前端（不打包）
pnpm build

# 仅构建 Rust（不打包）
cd src-tauri && cargo build --release
```

### 2.3 构建产物

构建完成后，产物位于：

| 平台 | 路径 | 说明 |
|------|------|------|
| Windows | `src-tauri/target/release/bundle/nsis/SpiritPal_x.y.z_x64-setup.exe` | NSIS 安装包（推荐） |
| Windows | `src-tauri/target/release/spiritpal-app.exe` | 免安装可执行文件 |
| macOS | `src-tauri/target/release/bundle/dmg/SpiritPal_x.y.z_aarch64.dmg` | DMG 安装包 |
| Linux | `src-tauri/target/release/bundle/deb/spiritpal_x.y.z_amd64.deb` | DEB 安装包 |
| Linux | `src-tauri/target/release/bundle/appimage/spiritpal_x.y.z_amd64.AppImage` | AppImage |

### 2.4 构建配置

构建配置位于 `src-tauri/tauri.conf.json`：

- **打包目标**：`["nsis", "dmg", "appimage", "deb"]`
- **WebView2 安装模式**：`downloadBootstrapper`（运行时自动下载 WebView2）
- **NSIS 安装模式**：`both`（支持当前用户和管理员安装）
- **Release 优化**（`Cargo.toml` `[profile.release]`）：
  - `opt-level = "z"` — 体积优先
  - `lto = "fat"` — 跨 crate 内联优化
  - `codegen-units = 1` — 最积极优化
  - `panic = "abort"` — 移除 unwinding 符号表
  - `strip = true` — 剥离调试符号

### 2.5 移动端构建

```bash
# Android APK
pnpm tauri android build

# Android 开发
pnpm tauri android dev
```

需要 Android SDK（项目内置在 `android-sdk/` 目录）和 NDK。

---

## 三、代码签名

### 3.1 Windows 签名

在 `src-tauri/tauri.conf.json` 中配置：

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "你的证书指纹",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

或通过环境变量：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "你的签名密钥"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "密钥密码"
```

### 3.2 macOS 签名

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TeamID)"
    }
  }
}
```

需要 Apple Developer 账号和开发者证书。

### 3.3 更新签名密钥

项目已生成更新签名密钥对：

- 私钥：`src-tauri/keys/spiritpal-updater.key`（**不可泄露**）
- 公钥：`src-tauri/keys/spiritpal-updater.key.pub`（已嵌入 `tauri.conf.json`）

重新生成密钥对：

```bash
cd src-tauri
npx tauri signer generate -w keys/spiritpal-updater.key
```

生成后将公钥更新到 `tauri.conf.json` 的 `plugins.updater.pubkey` 字段。

---

## 四、自动更新

### 4.1 更新流程

SpiritPal 使用 Tauri Updater 插件实现自动更新：

1. 应用启动时检查更新端点
2. 对比当前版本与最新版本
3. 下载更新包并验证签名
4. 安装更新并重启

### 4.2 更新配置

更新端点配置在 `tauri.conf.json`：

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://raw.githubusercontent.com/spiritpal/spiritpal-app/main/updates.json"
      ],
      "dialog": true,
      "pubkey": "已嵌入的公钥"
    }
  }
}
```

### 4.3 发布更新

1. 构建新版本的安装包
2. 将安装包上传到 GitHub Release
3. 更新 `updates.json` 文件：

```json
{
  "version": "0.2.0",
  "notes": "更新说明",
  "pub_date": "2026-08-15T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/spiritpal/spiritpal-app/releases/download/v0.2.0/SpiritPal_0.2.0_x64-setup.exe",
      "signature": "签名内容"
    }
  }
}
```

4. 提交 `updates.json` 到仓库

### 4.4 生成签名

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "私钥内容"
npx tauri signer sign src-tauri/target/release/bundle/nsis/SpiritPal_0.2.0_x64-setup.exe
```

输出的签名填入 `updates.json` 的 `signature` 字段。

---

## 五、CI/CD 自动发布

### 5.1 触发条件

推送 `v*` 格式的 Git 标签时自动触发发布工作流：

```bash
git tag v0.2.0
git push origin v0.2.0
```

### 5.2 发布流程

`release.yml` 工作流执行：

1. **三平台并行构建**：Ubuntu / Windows / macOS
2. **生成安装包**：NSIS / DMG / AppImage / DEB
3. **创建 GitHub Release**（Draft 模式）
4. **上传构建产物**到 Release
5. **性能测试**（Ubuntu 平台）

### 5.3 发布后操作

1. 在 GitHub Release 页面审核产物
2. 编辑 Release Notes（可从 `CHANGELOG.md` 复制）
3. 将 Release 从 Draft 改为 Published
4. 更新 `updates.json` 文件用于自动更新

---

## 六、发布检查清单

发布新版本前，逐项确认：

- [ ] 版本号在 3 个文件中已同步修改
- [ ] `CHANGELOG.md` 已添加新版本记录
- [ ] 所有测试通过（`scripts/run-all-tests.bat`）
- [ ] 本地构建成功（`scripts/build-release.bat`）
- [ ] 安装包在干净环境测试通过
- [ ] 升级路径测试（从旧版本升级正常）
- [ ] Git 标签已创建并推送
- [ ] GitHub Release 审核并发布
- [ ] `updates.json` 已更新
- [ ] 更新签名已生成并填入

---

## 七、故障排查

### 构建失败

| 问题 | 解决方案 |
|------|----------|
| `pnpm: command not found` | 运行 `install.bat` 或 `npm install -g pnpm` |
| `cargo: command not found` | 安装 Rust: https://rustup.rs/ |
| WebView2 下载失败 | 手动安装 WebView2 Runtime |
| Rust 编译 OOM | 减小 `codegen-units` 或关闭 `lto = "fat"` |
| 前端类型错误 | 运行 `pnpm lint` 检查 |

### 签名失败

| 问题 | 解决方案 |
|------|----------|
| 证书未找到 | 检查 `certificateThumbprint` 或证书安装 |
| 时间戳服务超时 | 更换 `timestampUrl` 或重试 |
| 更新签名验证失败 | 确认私钥与 `pubkey` 匹配 |

---

*最后更新：2026-08-10*
