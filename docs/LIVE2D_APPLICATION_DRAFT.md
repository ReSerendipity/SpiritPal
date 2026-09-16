# Live2D 发行许可申请草稿（Draft — 发送前替换方括号内容）

> 生成：2026-09-15（P1-4 整改配套）。申请入口：<https://www.live2d.com/zh-CHS/sdk/license>
> 建议以英文提交（官方受理语言）；如用中文入口提交，可直接用下方中文段。
> 发送后：把确认邮件/编号回填到 `LIVE2D_LICENSE_REMINDER.md` 状态记录。

## 英文版（推荐）

Subject: Live2D Cubism SDK Publication License Application — SpiritPal (free, small-scale desktop app)

Dear Live2D Inc. licensing team,

I am the developer of **SpiritPal**, a free, open-source AI desktop pet application
(GitHub: https://github.com/ReSerendipity/SpiritPal, Apache-2.0 code license), built with
Tauri v2 + React. The app integrates the Live2D Cubism SDK for Web as an **optional**
rendering backend:

- Cubism Core (`live2dcubismcore.js`) is **NOT bundled** with the app or repository.
  Users download it from the official Live2D website and install it locally
  (0-byte placeholder in the app; renderer falls back to sprite mode when absent).
- The application code itself (Live2DRenderer / render adapters) uses the Cubism SDK
  and is publicly distributed as builds for Windows (NSIS), macOS (DMG) and Linux
  (AppImage/deb) — hence this Publication License application.
- The application is free of charge, has no revenue, and is maintained by an individual
  developer as a non-commercial hobby project.

Application details:
- Application name: SpiritPal (桌边友)
- Developer: [你的名字/团队名] (contact: [你的邮箱])
- Distribution form: free public downloads via GitHub Releases (v0.1.0 published 2026-09-10)
- Commercial status: none (no sales, ads, or paid features)
- Expected scale: hobby / small-scale distribution

Please confirm whether a Publication License is required for this form of distribution,
and if so, issue the license (we understand individual/small-scale licenses are free of
charge) or advise on the correct procedure.

Thank you very much.

[你的名字]
[date]

## 中文版（备用）

主题：Live2D Cubism SDK 发行许可申请 — SpiritPal（免费、个人小规模桌面应用）

您好，我是 SpiritPal（一款免费开源的 AI 桌面宠物应用，代码以 Apache-2.0 开源，
GitHub: https://github.com/ReSerendipity/SpiritPal）的开发者。应用以 Tauri v2 + React
构建，集成 Live2D Cubism SDK for Web 作为**可选**渲染后端：

- Cubism Core（live2dcubismcore.js）**不随应用或仓库分发**，由用户从官网自行下载安装
  （应用内为 0 字节占位文件，缺失时渲染器降级为精灵图模式）；
- 应用自身代码（Live2DRenderer / 渲染适配层）使用 Cubism SDK，并以 Windows（NSIS）、
  macOS（DMG）、Linux（AppImage/deb）构建包公开发布——因此提交本发行许可申请；
- 应用完全免费，无任何收入，由个人开发者以非营利性质维护。

申请信息：
- 应用名称：SpiritPal（桌边友）
- 开发者：[你的名字/团队名]（联系方式：[你的邮箱]）
- 分发形态：GitHub Releases 免费公开下载（v0.1.0 已于 2026-09-10 发布）
- 商业状态：无（无销售、无广告、无付费功能）
- 预期规模：个人/小规模

请确认上述分发形态是否需要发行许可；如需要，恳请发放（我们了解个人/小规模许可可
免除费用）或告知正确的申请流程。

谢谢！
[你的名字] [日期]

## 提交后动作

- [ ] 确认邮件/编号回填 `LIVE2D_LICENSE_REMINDER.md`「状态记录」
- [ ] 许可获批后在 设置 → 关于 标注 Live2D 版权与许可编号
