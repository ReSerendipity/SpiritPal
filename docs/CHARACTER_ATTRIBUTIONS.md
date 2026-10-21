# 内置角色素材归属与授权记录（Attributions）

> 最后更新：2026-09-17（**去内置化落地**：仅 doro 保留内置；feibi 转外部包；gugugaga 删除）。内置角色变化时同步维护本表。

| 角色 | 显示名 | 来源（仓库/作者） | 当前形态 | 权属与授权状态 | 待办 |
|---|---|---|---|---|---|
| doro | 多罗（内置） | github.com/MelanTech/Dororo（Godot 桌宠，`models/Doro/`，commit `c2050bd`；GPL-3.0） | **唯一内置**（`src/lib/data/characters.ts`，`spriteAsset: /pets/doro/spritesheet.webp`，`spriteType: atlas`；**仓内无 Live2D 模型文件**，`*.model3.json` 不随包分发，探测不到即走精灵图） | **作者已回复（MelanTech/Dororo#10，2026-09-16）**：Live2D 模型经爱发电链接免费提供、允许二创（须遵原作者条款）；用项目代码须遵 GPL-3.0。`spritesheet.webp` 实为 OC-Claw 仿品（与 doro-codex SHA256 一致；原指向的 public/pets/doro/ATTRIBUTION.md 不在仓内，2026-10-21 订正时去除该死引用） | ⚠️ 按原作者条款核对爱发电模型授权细则；若日后改为随包分发其 Live2D 模型，须先完成授权核对 |
| feibi | 菲比 | github.com/llors-chen/Feibi_desktop | **已出包**（2026-09-17）：素材从安装包移除，人设与获取指引存于 `character-packs/feibi/pet.json` 模板，用户自备素材导入 | 授权请求 llors-chen/Feibi_desktop#2（2026-09-16）**无回复** → 不再随包分发 | ⏳ 若日后获授权可恢复内置；模板 persona 字段已就绪 |
| gugugaga | 咕咕嘎嘎 | **无可登记源头**（初始提交带入的本地 B 站梗视频剪辑；上游 IP 为《明日方舟：终末地》管理员企鹅化二创） | **已删除**（2026-09-17）：代码、素材、i18n 全部移除；同角色由**有来源**的 `xiang-qie` 社区包（rainnoon/oc-claw，MIT 声明）覆盖 | 待确认（无授权对象可询） | 若确认合法源头，可以社区包形式恢复 |

## 口径统一（2026-09-17 更新）

- USER_AGREEMENT.md §1.2「角色文件由用户自备」与内置的矛盾**已消解**：随包分发的第三方角色素材现仅剩
  doro（作者已提供免费获取渠道并允许二创）；feibi/gugugaga 均已移出分发。
- demo 页（demo/spiritpal_preview.html）仍热链第三方 GIF——热链不构成分发，但菲比卡片可在下次 demo 更新时移除（低优先级）。
- 注意：xiang-qie 包的 MIT 声明仅覆盖 OC-Claw 的剪辑产物；底层终末地企鹅二创 IP 仍属原作者，用户自备导入与随包分发的风险等级不同。

*本表为归属与授权台账，不构成法律意见。*
