# 内置角色素材归属与授权记录（Attributions）

> 最后更新：2026-09-17（补录 doro/feibi 授权请求进展 + 咕咕嘎嘎溯源调查结论）。内置角色变化时同步维护本表。

| 角色 | 显示名 | 来源（仓库/作者） | 引入方式 | 权属与授权状态 | 待办 |
|---|---|---|---|---|---|
| doro | Doro | github.com/MelanTech/Dororo（Godot 桌宠，`models/Doro/`，commit `c2050bd`；GPL-3.0） | 内置（Live2D 真身 2026-09-16 接入）+ 演示热链（demo/spiritpal_preview.html:502,684） | 权属归原作者；**授权请求已发送：MelanTech/Dororo#10（2026-09-16）**；精灵图回退 `spritesheet.webp` 实为 OC-Claw 仿品（与 doro-codex SHA256 一致，见 `public/pets/doro/ATTRIBUTION.md`） | ⏳ 等待权利人回复；未获授权前不改口径 |
| feibi | 菲比（飞币） | github.com/llors-chen/Feibi_desktop（热链证据：`…/main/assets/gifs/idle.gif`） | 内置 + 演示热链（demo/spiritpal_preview.html:685） | 权属归原作者；**授权请求已发送：llors-chen/Feibi_desktop#2（2026-09-16）** | ⏳ 等待权利人回复 |
| 咕咕嘎嘎 | 咕咕嘎嘎 | **具体引入仓库未登记**（初始提交 5625d93 批量带入）。上游 IP：《明日方舟：终末地》管理员企鹅化梗（二创动画据报道始于 B 站 2026-02-19）；实测与 rainnoon/oc-claw 香企鹅**非同字节**（SHA256 比对，系同题材不同剪辑），19 webm + 3 mp3 剪辑风格与 B 站「咕嘎桌宠」（DyberPet 角色包，网盘分发）场景高度吻合（奶茶/学习/打工/窥探等） | 内置 | 待确认（素材系本地 ffmpeg 剪辑生成，无上游 repo 出处记录） | ⚠️ 向素材制作人/社区确认剪辑源视频清单；授权口径同 doro/feibi |

## 已知口径矛盾（待统一）

- 仓库版 USER_AGREEMENT.md §1.2 称"模型/角色文件属创作者作品，由用户自备"，
  而应用**内置**了上述第三方角色（应用内旧版协议亦写"内置角色"）——需统一：
  要么取得授权转为正式内置，要么改为首次启动下载/用户自备。
- demo 页热链第三方 GitHub 资源；建议替换为自有素材，或保留热链但显著标注归属（已在本表登记）。

*本表为归属与授权台账，不构成法律意见。*
