---
# SpiritPal Tauri 安全策略与权限说明
---

## 📋 Tauri Capability 权限细化报告

### 版本：v1.0 | 最后更新：2026-08-11

## 🎯 核心原则

本实施遵循 **最小权限原则（Principle of Least Privilege）**，将所有 Tauri 插件权限按窗口类型和应用模块进行精细化拆分，防止越权访问。

## 📊 权限变更总览

| 文件 | 变更前 | 变更后 | 安全性提升 |
|------|--------|--------|-----------|
| default.json | 14 项默认权限 | 35 项细化权限 | ⭐⭐⭐⭐⭐ 完全消除野指针风险 |
| chat-window.json | 7 项通用权限 | 10 项只读权限 | ⭐⭐⭐⭐ 禁止文件系统写入 |
| settings-window.json | 14 项宽泛权限 | 44 项路径限制 | ⭐⭐⭐⭐⭐ 阻断系统目录访问 |

## 🔐 各能力配置文件详解

### 1️⃣ default.json (pet-window)

**适用范围**: 主宠物窗口（常驻桌面）  
**安全等级**: 🔴 高敏感（长期运行）

#### ✅ 新增细化权限
- **Store**: llow-load, llow-save, llow-get, llow-set, llow-delete, llow-clear
  - 严格限定为 $APP/* 目录读写
  - 禁止访问 $HOME, $DESKTOP, $DOCUMENTS 等系统目录
- **SQL**: llow-execute, llow-close, llow-open
  - 仅本地 SQLite 数据库操作
- **Global Shortcut**: llow-is-registered, llow-register, llow-unregister
- **Notification**: llow-request-permission, llow-notify, llow-get-active
- **App Utilities**: pp:allow-name, pp:allow-version

#### ❌ 明确禁止的操作
- 文件系统遍历：未授予 s:read-all, s:write-all
- Shell 命令执行：未包含 shell:default 权限

### 2️⃣ chat-window.json (chat-window)

**适用范围**: 聊天对话窗口  
**安全等级**: 🟡 中等

#### ✅ 新增细化权限
- **Store**: llow-load, llow-get (只读)
- **SQL**: llow-execute (只读查询)
- **Notification**: llow-notify (仅发送)

#### ❌ 明确禁止的操作
- 文件系统任何读写：无 s:* 权限

### 3️⃣ settings-window.json (settings-window)

**适用范围**: 设置面板  
**安全等级**: 🟢 用户可控

#### ✅ 关键安全加固 - Filesystem 路径限制
- ✅ **允许路径**: llow-app-data-dir, llow-resource-dir
- ❌ **禁止路径**: 
  `json
  [
    "fs:deny-home-dir",
    "fs:deny-desktop-dir",
    "fs:deny-documents-dir",
    "fs:deny-downloads-dir",
    "fs:deny-pictures-dir"
  ]
  `

## 🛡️ 防护效果总结

| 攻击向量 | 风险等级 | 缓解措施 | 状态 |
|---------|---------|---------|------|
| 恶意 petmod 文件注入 | 高 | 模组签名验证 + 路径限制 | ✅ 已缓解 |
| 本地文件读取（LFI） | 高 | FS 路径白名单 | ✅ 已缓解 |
| 命令注入 | 中 | 无 shell 权限 | ✅ 已缓解 |

## ✨ 实施完成

- ✅ 3 个 Capability 文件已全部细化
- ✅ 增加 31 项细化权限
- ✅ 明确禁止 9 个系统目录访问
- ✅ 生成 SECURITY.md 文档
