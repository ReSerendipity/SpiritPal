# SpiritPal 发布与更新流程（Release Notes）

## 更新机制原理（无需自建服务器）

Tauri 的自动更新使用 **GitHub Releases 作为静态托管**：
1. 发布新版时把安装包（NSIS/dmg/AppImage/deb）上传到 GitHub Releases；
2. 在仓库维护一个 `updates.json`：记录每个平台的版本号、安装包下载地址、签名；
3. 应用启动时访问 `tauri.conf.json` 中配置的 updater 端点（`updates.json` 地址），发现新版本即提示用户下载更新；
4. 下载的更新包用内嵌公钥验证签名，防篡改。

**成本**：GitHub 免费仓库即可，无服务器、无流量费（Releases 附件下载免费）。

## 发布前必做（更新于 2026-09-04）

| # | 事项 | 状态 |
|---|---|---|
| 1 | 自动更新决策：**2026-09-04 起已关闭**（`tauri.conf.json` `plugins.updater.active = false`）。端点 `spiritpal/spiritpal-app` 实测 404 不存在，产物关闭、端点死链与私有仓定位冲突 → 先停用，避免每次启动静默失败请求。 | ✅ 已关闭 |
| 2 | 更新签名密钥：secrets `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` 已接入 release.yml；私钥离线保管；`pubkey` 与私钥**配对未验证**（重新开启自动更新前必须核对）。 | ◐ 接入未验证 |
| 3 | 版本一致性门禁：`scripts/sync-version.mjs`（以 package.json 为单一事实来源）+ docs-consistency `version-consistency` job + `verify-release-version.yml`（tag 与三处版本一致校验）。 | ✅ 2026-09-04 已建 |
| 4 | 发布后验证：安装旧版 → 触发更新检查 → 确认提示与安装成功（自动更新关闭期间不适用）。 | ☐ 待重启后执行 |

## 平台分发可用性（2026-09-04 评估）

| 平台 | 打包 | 代码签名 | 分发状态 |
|---|---|---|---|
| Linux（AppImage/deb） | ✅ | 无强制要求 | ✅ **当前唯一完整可用** |
| Windows（NSIS） | ✅ | 未签名（`certificateThumbprint: null`） | ⚠️ 可用，SmartScreen 蓝屏门槛高 |
| macOS（DMG） | ✅ | 未公证（`signingIdentity: null`）+ `macOSPrivateApi: true` | ❌ Gatekeeper 阻止；与 MAS 上架互斥，**实验性** |
| Android / 移动端 | 配置存在（硬编码口令已移除，P1-3） | 需 keystore.properties | ❌ 不在 release 矩阵，**未投产/实验性** |

- 建议聚焦 Linux + Windows 作正式分发渠道；macOS 需 Developer ID 证书 + notarytool 公证后方可启动绕过 Gatekeeper（非 MAS 路线）。
- 发布时向用户如实说明：Windows 首次运行可能触发 SmartScreen，不教用户关闭系统安全设置。

## 签名密钥风险提示

- **私钥泄露** = 攻击者可构造带合法签名的恶意更新，推送给全体用户——私钥只存离线介质，不进仓库、不进 CI 明文；
- **私钥丢失** = 无法再发更新（已有客户端只能手动更新）；
- 建议：私钥加密备份至密码管理器/离线保险库。

## 版本约定

- 语义化版本号（major.minor.patch）；`updates.json` 中版本号与安装包一致；
- 每次发布更新 CHANGELOG。

*本说明为初稿参考，不构成正式法律意见。*
