#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
素材归一化工具 — 统一视频尺寸 / 帧率 / 居中，输出透明 WebM 或 PNG 帧序列

背景（参考 dsh-pet normalize_step03）：
- 不同来源的动作素材尺寸、帧率、画面位置各异；
- 桌面宠物播放时按 contain 适配，但统一规格能保证切换动画时不跳动。
- 推荐规格：SpiritPal 精灵图为 192x208；视频宠物建议 512x512 或 512x576。

用法：
  # 统一为 512x512 / 30fps / 透明居中，输出 webm
  python normalize.py input.mp4 -o idle.webm --width 512 --height 512 --fps 30

  # 输出 PNG 帧序列（供精灵图工具/PSD 管线使用）
  python normalize.py input.webm -o frames/ --format png --width 192 --height 208

依赖：ffmpeg（PATH 中可用）。
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def check_ffmpeg() -> None:
    if not (shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")):
        print(
            "[错误] 未找到 ffmpeg。请先安装：\n"
            "  winget install ffmpeg\n"
            "  或从 https://ffmpeg.org/download.html 下载并加入 PATH。",
            file=sys.stderr,
        )
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="素材归一化：统一尺寸/帧率/居中")
    parser.add_argument("input", help="输入视频")
    parser.add_argument("-o", "--output", required=True, help="输出 webm 或帧序列目录")
    parser.add_argument("--width", type=int, default=512, help="目标宽度（默认 512）")
    parser.add_argument("--height", type=int, default=512, help="目标高度（默认 512）")
    parser.add_argument("--fps", type=int, default=30, help="目标帧率（默认 30）")
    parser.add_argument("--format", choices=["webm", "png"], default="webm",
                        help="输出格式（默认 webm；png 输出帧序列到目录）")
    parser.add_argument("--background", default="black@0",
                        help="pad 背景色（默认 black@0 全透明；黑幕素材用 black）")
    args = parser.parse_args()

    check_ffmpeg()
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[错误] 输入不存在：{input_path}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # scale 等比缩小 + pad 透明画布居中（@0 表示 alpha 0 的透明黑）
    vf = (
        f"scale={args.width}:{args.height}:force_original_aspect_ratio=decrease,"
        f"pad={args.width}:{args.height}:(ow-iw)/2:(oh-ih)/2:color={args.background},"
        f"fps={args.fps}"
    )

    if args.format == "png":
        output_path.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg", "-i", str(input_path), "-vf", vf,
            "-compression_level", "6",
            str(output_path / "frame_%04d.png"),
        ]
    else:
        cmd = [
            "ffmpeg", "-i", str(input_path), "-vf", vf,
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
            "-b:v", "0", "-crf", "20", "-row-mt", "1", "-an", "-y",
            str(output_path),
        ]

    print(f"[ffmpeg] {' '.join(cmd)}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr[-2000:], file=sys.stderr)
        sys.exit(f"[失败] 归一化处理出错")
    print(f"[完成] {output_path}")


if __name__ == "__main__":
    main()
