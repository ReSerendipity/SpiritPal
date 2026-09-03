# SpiritPal 桌宠动画类型选型报告

| 项目 | 内容 |
|---|---|
| 日期 | 2026-08-26 |
| 场景 | SpiritPal 桌面宠物动画/渲染技术选型 |
| 结论 | 没有唯一正确答案，按「角色风格 × 产能 × 体积」三轴分档选择；默认 MVP 走精灵图，二次元角色追求鲜活感上 Live2D，手绘动画量大走 WebM，体积敏感用 Lottie，远期 3D / VTuber 联动选 VRM |

---

## 一、选型总览

| 你的诉求 | 推荐方案 | 理由 | 生态参照 |
|---|---|---|---|
| 像素风 / 多角色 / 低资源占用 | 精灵图 | OpenPets、WindowPet 生态验证充分，体积性能最优 | OpenPets、WindowPet、desktop-pet |
| 手绘流畅动画、动作数量大 | WebM | dsh-pet 91 动作证明可行，但需色度键兜底 Windows 透明 | dsh-pet |
| 二次元角色、要呼吸/眨眼/表情 | Live2D | 市面 AI 桌宠主流答案，实时形变无需逐帧资产 | dsh-live2d-pets 等 AI 桌宠 |
| 体积敏感、要矢量缩放清晰 | Lottie | ai-bubu 验证，SVG 动画 JSON 驱动，几 KB~几十 KB | ai-bubu |
| 2D 角色要骨骼形变又不想 3D | Spine | DyberPet 计划中的升级方向，运行时小 | DyberPet |
| 3D 角色 / VTuber 联动 | VRM / 3D | SuperAgentParty 已验证路线，也可接 VTube Studio | Super Agent Party |
| 没有美术、只有分层 PSD | PSD 自动建模 | Petra 的 Anime2.5DRig：拖入 PSD 自动生成 2.5D 角色 | Anime2.5DRig |

---

## 二、逐方案分析

### 1. 精灵图（Sprite Sheet）

- **适用**：像素风、Q 版多角色、低配机器、安装包/内存敏感。
- **优势**：生态最成熟（OpenPets 宠物包 = 精灵图 + 动画映射 + 元数据；WindowPet 为 Tauri + React 桌宠叠加应用）；加载即播放、无解码开销；体积性能最优。
- **代价**：逐帧资产成本高——动作数量 × 帧数线性膨胀；放大后模糊；多角色要维护多套精灵表。
- **落地建议**：沿用 desktop-pet 生态的 8×9 精灵表行映射约定；AI 生图 → 绿幕抠图 → 拼精灵表的自动化管线已被社区验证。

### 2. WebM（透明视频）

- **适用**：手绘流畅动画、动作数量大（几十上百个动作）。
- **优势**：dsh-pet 以 91 个动作证明可行；手绘逐帧动画转视频后资产成本远低于精灵图；动作衔接顺滑。
- **风险**：Windows 上透明通道不保证，需色度键（绿幕/紫幕）抠像兜底；首帧解码有内存尖峰，需预解码/缓冲；循环衔接需掐帧。
- **落地建议**：素材统一绿幕录制 → 运行时抠像；动作切换前预加载下一段视频。

### 3. Live2D

- **适用**：二次元立绘角色，要求呼吸、眨眼、表情、口型。
- **优势**：市面 AI 桌宠的主流答案（大量 AI 陪伴/桌宠项目采用）；实时网格形变，一套模型驱动全部表情，无需逐帧资产。
- **代价**：模型制作门槛高（.model3.json 需 Cubism 编辑器制作，成本大——dsh-live2d-pets 即因此被社区用 Anime2.5DRig 替代）；SDK 有授权条款。
- **落地建议**：如果角色是现成 Live2D 模型（或团队能产），这是二次元体验上限最高的 2D 方案。

### 4. Lottie

- **适用**：体积敏感、需要矢量无限缩放的简洁吉祥物 / UI 角色。
- **优势**：JSON 驱动、单文件几 KB~几十 KB；矢量渲染任意缩放清晰；程序可控性强（进度、颜色、播放状态随手改）；ai-bubu（Tauri + Vue 3）已验证。
- **局限**：复杂角色、骨骼形变、细腻表情表达弱；适合「轻量吉祥物」而非「高表现力角色」。

### 5. Spine（2D 骨骼）

- **适用**：2D 角色要骨骼形变、网格动画，又不想上 3D。
- **优势**：游戏行业 2D 骨骼动画标准；运行时小；骨骼/网格形变比 Live2D 更自由，动作库可复用换皮；DyberPet 已将其列为计划中的升级方向。
- **代价**：Spine 编辑器（Pro）授权费用；需要会摆骨骼、K 动画的美术。
- **与 Live2D 的区别**：Spine 偏「游戏角色动画」（跑跳攻击），Live2D 偏「立绘形变表现」（呼吸眨眼口型）。

### 6. VRM / 3D

- **适用**：3D 角色、VTuber 联动、多视角展示。
- **优势**：Super Agent Party（Electron + Python/FastAPI，支持 VRM 桌宠自定义、3D/2D 虚拟角色）已验证完整路线；模型资产丰富（VRoid Hub 等）；可接 VTube Studio 联动直播。
- **代价**：3D 渲染开销（GPU 占用、内存）；模型面数/穿模/捏脸调优成本；桌面常驻场景下资源占用显著高于 2D 方案。
- **落地建议**：作为远期路线；落地用 three.js / PixiJS + VRM Loader。

### 7. PSD 自动建模（Anime2.5DRig）

- **适用**：没有美术产能、只有分图层 PSD 的团队/个人。
- **优势**：852wa/Anime2.5DRig 将分图层 PSD 拖入浏览器即自动 rigging 生成 2.5D 动画，门槛最低；dsh-anime25d-pets 插件已将其接入 DSH 桌宠（官方说明：原 Live2D 方案模型制作门槛高、成本大，本方案只需一张分图层 PSD）。
- **代价**：动画质量与可控性受自动 rigging 限制，复杂动作需手动调；图层命名/拆分规范决定成品质量。

---

## 三、组合策略建议（按阶段）

| 阶段 | 推荐 | 理由 |
|---|---|---|
| MVP（先跑通） | 精灵图 | 生态验证最充分、接入最快；无动画产能时用 PSD 自动建模或社区现成素材 |
| 一期（有角色资产） | Live2D 或 Spine | 二次元立绘 → Live2D；游戏动作型 → Spine；手绘素材量大 → WebM |
| 远期（扩展） | VRM / 3D | VTuber 联动、多视角、直播场景；SuperAgentParty 路线可参考 |
| 兜底（无美术） | PSD 自动建模 | Anime2.5DRig 一条命令级别的接入成本 |

### 方案横向评分（主观权重，供决策参考）

| 评估维度 | 精灵图 | WebM | Live2D | Lottie | Spine | VRM/3D | PSD 自动 |
|---|---|---|---|---|---|---|---|
| 上手成本 | ★★★★★ | ★★★★ | ★★ | ★★★★ | ★★★ | ★★ | ★★★★★ |
| 动画表现力 | ★★ | ★★★★ | ★★★★★ | ★★ | ★★★★ | ★★★★★ | ★★★ |
| 体积 / 性能 | ★★★★★ | ★★★ | ★★★★ | ★★★★★ | ★★★★ | ★★ | ★★★★ |
| 生态成熟度 | ★★★★★ | ★★★ | ★★★★ | ★★★★ | ★★★★ | ★★★ | ★★★ |
| 多角色扩展 | ★★★★★ | ★★★ | ★★★★ | ★★★★ | ★★★ | ★★★ | ★★★★ |

---

## 四、决策检查清单

1. 有没有美术/动画产能？
   - 没有 → PSD 自动建模（Anime2.5DRig）或精灵图生态现成素材
2. 角色是像素风/简洁吉祥物？
   - 是 → 精灵图；体积敏感且要矢量缩放 → Lottie
3. 二次元立绘、要呼吸/眨眼/表情？
   - 是 → Live2D
4. 手绘动画素材量大（几十个动作）？
   - 是 → WebM（配绿幕抠像兜底）
5. 要骨骼形变但不上 3D？
   - 是 → Spine
6. 要 3D / VTuber 联动？
   - 是 → VRM（SuperAgentParty 路线，可接 VTube Studio）

---

## 五、参考项目与链接（均已核实）

| 项目 | 链接 | 说明 |
|---|---|---|
| OpenPets | <https://github.com/OpenPetsHQ/openpets> / <https://openpets.dev/zh> | 宠物包 = 精灵图 + 动画映射 + 元数据，生态验证充分 |
| WindowPet | <https://juejin.cn/post/7600326291552583686> | Tauri + React 跨平台桌宠叠加应用（原文为掘金介绍，GitHub 仓库未直接核实） |
| desktop-pet | <https://github.com/duzexu/desktop-pet> | Electron 跨平台桌宠，精灵图行映射约定来源 |
| dsh-pet | <https://github.com/PC2005-cloud/dsh-pet> | DSH 桌宠，91 动作 WebM 方案验证 |
| ai-bubu | <https://github.com/funAgent/ai-bubu> | Tauri + Vue 3 桌宠，Lottie 方案参照 |
| DyberPet | <https://github.com/ChaozhongLiu/DyberPet> | PySide6 桌宠框架，Spine 为计划升级方向 |
| Super Agent Party | <https://github.com/heshengtao/super-agent-party> | Electron + Python/FastAPI，VRM 桌宠 + 3D/2D 虚拟角色 |
| Anime2.5DRig | <https://github.com/852wa/Anime2.5DRig> | 分图层 PSD 自动 rigging 生成 2.5D 角色 |
| dsh-anime25d-pets | <https://www.dsh.so/artifact/dsh-anime25d-pets> | Anime2.5DRig × DSH 桌宠接入先例 |
