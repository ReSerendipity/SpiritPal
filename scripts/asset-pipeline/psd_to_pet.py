#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PSD → 宠物资源包转换工具 — 分层 PSD 导出为透明 PNG 帧序列 + pet.json 骨架

背景：
- Petra 的 Anime2.5DRig 支持「拖入分层 PSD 自动生成 2.5D 角色」，
  完整 rig（自动骨骼/摆动）是独立引擎，不在本脚本范围。
- 本工具实现帧动画型 PSD 的导入：PSD 每个图层（或图层组）视为一帧，
  导出为透明 PNG 帧 + 生成 pet.json 元数据骨架，供后续接入
  SpiritPal 精灵图管线（spriteSheetTool）或直接作为 PNG 序列素材。

用法：
  # 模式 1：每个图层一帧（图层从上到下 = 帧顺序）
  python psd_to_pet.py character.psd -o ./out --mode layers

  # 模式 2：每个图层组一帧（组内图层合并）
  python psd_to_pet.py character.psd -o ./out --mode groups

依赖：pip install psd-tools （可选用 Pillow 提升输出质量）
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from psd_tools import PSDImage
except ImportError:
    print(
        "[错误] 缺少 psd-tools：\n"
        "  pip install psd-tools\n"
        "（如需高质量输出可一并安装：pip install Pillow）",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def export_layer_frame(layer, index: int, out_dir: Path, prefix: str) -> tuple[str, int, int] | None:
    """导出单层为透明 PNG，返回 (文件名, 宽, 高)。"""
    if not layer.visible or layer.is_group():
        return None
    try:
        img = layer.composite()
    except Exception:
        return None
    if img is None or img.width <= 0 or img.height <= 0:
        return None
    if HAS_PIL:
        img = img.convert("RGBA")
    name = f"{prefix}_frame_{index:04d}.png"
    img.save(out_dir / name)
    return name, img.width, img.height


def main() -> None:
    parser = argparse.ArgumentParser(description="PSD 帧动画 → 透明 PNG 帧 + pet.json")
    parser.add_argument("input", help="输入 PSD 文件")
    parser.add_argument("-o", "--output", required=True, help="输出目录")
    parser.add_argument("--mode", choices=["layers", "groups"], default="layers",
                        help="帧来源：layers=每图层一帧（默认）/ groups=每图层组一帧")
    parser.add_argument("--id", default=None, help="宠物 ID（默认取 PSD 文件名）")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[错误] 输入不存在：{input_path}", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    psd = PSDImage.open(input_path)
    pet_id = args.id or input_path.stem.lower().replace(" ", "-")

    frames: list[dict] = []
    if args.mode == "groups":
        groups = [g for g in psd.descendants() if g.is_group() and g.visible]
        if not groups:
            print("[提示] 未找到可见图层组，回退为 layers 模式")
            groups = []
            args.mode = "layers"
        for idx, group in enumerate(groups):
            try:
                img = group.composite()
            except Exception as e:
                print(f"[跳过] 图层组 {group.name} 合成失败：{e}")
                continue
            if img is None or img.width <= 0:
                continue
            if HAS_PIL:
                img = img.convert("RGBA")
            name = f"frame_{idx:04d}.png"
            img.save(out_dir / name)
            frames.append({"file": name, "width": img.width, "height": img.height})
    else:
        idx = 0
        for layer in psd.descendants():
            result = export_layer_frame(layer, idx, out_dir, "frame")
            if result:
                name, w, h = result
                frames.append({"file": name, "width": w, "height": h})
                idx += 1

    if not frames:
        print("[错误] 没有导出任何帧，请检查 PSD 图层可见性", file=sys.stderr)
        sys.exit(1)

    # 帧动画元数据：按 spriteLayout 风格生成（每帧一"行"，单列）
    animations = {}
    for i, f in enumerate(frames):
        animations[f"frame_{i}"] = {
            "row": i,
            "frames": 1,
            "fps": 10,
            "loop": True,
            "next": None,
        }

    pet_json = {
        "formatVersion": "1.0",
        "id": pet_id,
        "name": input_path.stem,
        "version": "1.0.0",
        "author": "Unknown",
        "license": "MIT",
        "description": f"由 PSD 导入：{input_path.name}（{args.mode} 模式，{len(frames)} 帧）",
        "tags": ["psd-imported"],
        "sprite": f"frames/{frames[0]['file']}",
        "spriteType": "gif",
        "atlas": {"cellW": frames[0]["width"], "cellH": frames[0]["height"], "cols": 1, "rows": len(frames)},
        "themeColor": {"primary": "#4ECDC4", "secondary": "#FF6B6B"},
        "animations": animations,
        "reactions": {},
        "sounds": {},
        "personality": {"warmth": 0.5, "liveliness": 0.5, "dependence": 0.5, "directness": 0, "rationality": 0},
        "speakingStyle": {"tone": "gentle", "wordPreference": "colloquial", "catchphrases": []},
        "defaultSystemPrompt": "",
        "compatibility": {"spiritpal": ">=0.1.0"},
    }
    (out_dir / "pet.json").write_text(json.dumps(pet_json, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[完成] 导出 {len(frames)} 帧 → {out_dir}")
    print(f"       pet.json 已生成（id={pet_id}，spriteType=gif，可手动改为 atlas 并合并精灵图）")
    print("提示：如需合成单张精灵图，可用 SpiritPal 的 spriteSheetTool 或 ffmpeg montage 合并 frames/。")


if __name__ == "__main__":
    main()
