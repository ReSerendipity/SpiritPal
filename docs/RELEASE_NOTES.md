# SpiritPal 发布与更新流程（Release Notes）

## 更新机制原理（无需自建服务器）

Tauri 的自动更新使用 **GitHub Releases 作为静态托管**：
1. 发布新版时把安装包（NSIS/dmg/AppImage/deb）上传到 GitHub Releases；
2. 在仓库维护一个 `updates.json`：记录每个平台的版本号、安装包下载地址、签名；
3. 应用启动时访问 `tauri.conf.json` 中配置的 updater 端点（`updates.json` 地址），发现新版本即提示用户下载更新；
4. 下载的更新包用内嵌公钥验证签名，防篡改。

**成本**：GitHub 免费仓库即可，无服务器、无流量费（Releases 附件下载免费）。

## 发布前必做（当前状态：未完成）

| # | 事项 | 状态 |
|---|---|---|
| 1 | 创建真实 GitHub 仓库（如 `spiritpal/spiritpal-app`），将 `tauri.conf.json` updater 端点从占位域名改为真实地址 | ☐ |
| 2 | 生成 Tauri 更新签名密钥对：`npx tauri signer generate`；**私钥离线保管**（丢失=永远无法发更新），公钥填入 `tauri.conf.json`（已填占位公钥则替换） | ☐ |
| 3 | 配置 GitHub Actions 发布流水线：打 tag → 构建三平台安装包 → 上传 Releases → 生成并上传 `updates.json` | ☐（release.yml 骨架已存在） |
| 4 | 发布后验证：安装旧版 → 触发更新检查 → 确认提示与安装成功 | ☐ |

## 签名密钥风险提示

- **私钥泄露** = 攻击者可构造带合法签名的恶意更新，推送给全体用户——私钥只存离线介质，不进仓库、不进 CI 明文；
- **私钥丢失** = 无法再发更新（已有客户端只能手动更新）；
- 建议：私钥加密备份至密码管理器/离线保险库。

## 版本约定

- 语义化版本号（major.minor.patch）；`updates.json` 中版本号与安装包一致；
- 每次发布更新 CHANGELOG。

*本说明为初稿参考，不构成正式法律意见。*
