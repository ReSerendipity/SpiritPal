# SpiritPal 素材管线（Asset Pipeline）

参考 dsh-pet（91 动作素材 + ffmpeg+numpy 半自动管线）与 Petra（PSD 自动建模）落地，
目标是**把「做新宠物」的成本从美术门槛降到「拖入即用」**。

## 工具一览

| 脚本 | 用途 | 依赖 |
|---|---|---|
| `chroma_key.py` | 黑幕/绿幕素材 → 透明 WebM（VP9 alpha） | ffmpeg；numpy 可选（--fast） |
| `normalize.py` | 统一尺寸/帧率/居中 → 透明 WebM 或 PNG 帧序列 | ffmpeg |
| `psd_to_pet.py` | 分层 PSD → 透明 PNG 帧 + pet.json 骨架 | psd-tools（可选 Pillow） |

## 快速开始

```bash
# 1. 安装 ffmpeg（Windows）
winget install ffmpeg

# 2. 黑幕素材 → 透明 webm（阈值 12 与运行时色度键一致）
python chroma_key.py raw.mp4 -o idle.webm --background black

# 3. 归一化到统一规格（视频宠物建议 512x512 / 30fps）
python normalize.py idle.webm -o idle.webm --width 512 --height 512 --fps 30

# 4. PSD 帧动画导入
pip install psd-tools
python psd_to_pet.py character.psd -o ./my-pet --mode layers
```

## 与运行时兜底的关系

| 层 | 位置 | 作用 |
|---|---|---|
| 素材生产端 | `chroma_key.py` | 产出自带 alpha 的透明 webm（VP9 alpha） |
| 运行时兜底 | `src/lib/chromaKey.ts` + `SpriteRenderer.tsx` | Windows WebView2 丢 VP9 alpha 时自动检测并 canvas 色度键抠像 |
| 角色配置 | `CharacterProfile.chromaKey` | `true` 强制 / `false` 禁用 / `auto` 自动检测（默认） |

两条链路叠加：素材带 alpha 时浏览器直接播放；alpha 丢失时运行时兜底，保证任何平台都不黑底。

## 命名约定（视频宠物）

宠物目录 `public/pets/<id>/` 下按 `stateToVideoFile()` 约定放置：

```
idle.webm  walk.webm  rest.webm  eat.webm  spin.webm
dance.webm  angry.webm  headpat.webm
```

对应状态：idle / walk / sleep+sit+sad(rest) / eat / drag(spin) / happy(dance) / sick(angry) / pet(headpat)。

## 后续方向（不在本次范围）

- **PSD 自动 rig**：Petra Anime2.5DRig 是独立引擎（分层 PSD → 2.5D 骨骼/摆动），
  需引入 2D 骨骼渲染器，建议作为独立里程碑评估。
- **精灵图自动合成**：`psd_to_pet.py` 输出的帧序列可用 `spriteSheetTool.ts`
  或 ffmpeg montage 合并为单张 atlas + pet.json 布局。
