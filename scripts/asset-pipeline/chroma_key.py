#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
色度键抠像工具 — 把黑底/绿底素材视频转成带 alpha 的透明 WebM

背景（参考 dsh-pet / OC-Claw）：
- 桌面宠物的视频素材常见两种来源：黑幕抠像（近黑像素置透明）或绿幕拍摄。
- SpiritPal 的 webm 视频宠物（如 gugugaga）依赖 VP9 alpha 通道；
  在 Windows WebView2 上 alpha 会丢失，运行时由 SpriteRenderer 色度键兜底。
- 本脚本在「素材生产端」就完成抠像，产出自带 alpha 的透明 webm，
  与运行时兜底形成双保险。

用法：
  # 黑幕素材（默认阈值 12，与 OC-Claw / chromaKey.ts 一致）
  python chroma_key.py input.mp4 -o idle.webm --background black --threshold 12

  # 绿幕素材（ffmpeg chromakey 滤镜）
  python chroma_key.py input.mp4 -o idle.webm --background green --similarity 0.1

  # 黑幕 + numpy 加速（pip install numpy 后自动使用）
  python chroma_key.py input.mp4 -o idle.webm --background black --fast

依赖：ffmpeg（PATH 中可用）；numpy 可选（仅加速黑幕抠像）。
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VP9_ALPHA_ARGS = [
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
    "-b:v", "0", "-crf", "20", "-row-mt", "1",
    "-an", "-y",
]


def check_ffmpeg() -> str:
    """检查 ffmpeg 可用性，返回可执行名。"""
    for name in ("ffmpeg", "ffmpeg.exe"):
        path = shutil.which(name)
        if path:
            return path
    print(
        "[错误] 未找到 ffmpeg。请先安装：\n"
        "  winget install ffmpeg\n"
        "  或从 https://ffmpeg.org/download.html 下载并加入 PATH。",
        file=sys.stderr,
    )
    sys.exit(1)


def run(cmd: list[str], desc: str) -> None:
    print(f"[ffmpeg] {desc}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr[-2000:], file=sys.stderr)
        sys.exit(f"[失败] {desc}")


def chroma_key_green(input_path: Path, output_path: Path, similarity: float) -> None:
    """绿幕抠像：ffmpeg chromakey 滤镜。"""
    run(
        [
            "ffmpeg", "-i", str(input_path),
            "-vf", f"chromakey=0x00FF00:{similarity}:0.1",
            *VP9_ALPHA_ARGS, str(output_path),
        ],
        f"绿幕抠像 → {output_path.name}",
    )


def chroma_key_black(input_path: Path, output_path: Path, threshold: int, use_numpy: bool) -> None:
    """
    黑幕抠像：逐帧处理。
    1. ffmpeg 解码为 rawvideo（RGBA，临时文件）
    2. Python 逐像素把 RGB 均 <= threshold 的像素 alpha 置 0
    3. ffmpeg 编码为 VP9 alpha webm
    """
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "frames.rgba"
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,nb_frames", "-of", "csv=p=0",
             str(input_path)],
            capture_output=True, text=True,
        )
        parts = probe.stdout.strip().split(",")
        if len(parts) < 3:
            print("[错误] 无法探测视频尺寸/帧数", file=sys.stderr)
            sys.exit(1)
        width, height = int(parts[0]), int(parts[1])
        frames = int(parts[2]) if parts[2].isdigit() else 0

        # 1. 解码为原始 RGBA 帧
        run(
            ["ffmpeg", "-i", str(input_path), "-f", "rawvideo", "-pix_fmt", "rgba", str(raw)],
            "解码为原始帧",
        )

        # 2. 抠像
        data = raw.read_bytes()
        print(f"[抠像] {width}x{height} x {frames or '?'} 帧，阈值 {threshold}")
        if use_numpy:
            try:
                import numpy as np
            except ImportError:
                print("[提示] numpy 不可用，回退纯 Python（小尺寸素材无感知）")
                use_numpy = False
        if use_numpy:
            arr = np.frombuffer(data, dtype=np.uint8).reshape(-1, height, width, 4)
            mask = (arr[:, :, :, 0] <= threshold) & (arr[:, :, :, 1] <= threshold) & (arr[:, :, :, 2] <= threshold)
            arr[:, :, :, 3][mask] = 0
            keyed = raw.with_suffix(".keyed.rgba")
            keyed.write_bytes(arr.tobytes())
        else:
            keyed = raw.with_suffix(".keyed.rgba")
            out = bytearray(data)
            stride = width * 4
            keyed_count = 0
            for off in range(0, len(out), stride):
                row_end = off + stride
                for i in range(off, row_end, 4):
                    if out[i] <= threshold and out[i + 1] <= threshold and out[i + 2] <= threshold:
                        out[i + 3] = 0
                        keyed_count += 1
            keyed.write_bytes(bytes(out))
            print(f"[抠像] 透明化 {keyed_count} 像素")

        # 3. 编码回 VP9 alpha webm
        run(
            ["ffmpeg", "-f", "rawvideo", "-pix_fmt", "rgba",
             "-s", f"{width}x{height}", "-r", "30",
             "-i", str(keyed), *VP9_ALPHA_ARGS, str(output_path)],
            f"编码透明 WebM → {output_path.name}",
        )
    print(f"[完成] {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="色度键抠像：黑底/绿底素材 → 透明 WebM")
    parser.add_argument("input", help="输入视频（mp4/webm/...）")
    parser.add_argument("-o", "--output", required=True, help="输出 webm 路径")
    parser.add_argument("--background", choices=["black", "green"], default="black",
                        help="背景类型（默认 black）")
    parser.add_argument("--threshold", type=int, default=12,
                        help="黑幕阈值：RGB 均 <= 该值置透明（默认 12，与 OC-Claw 一致）")
    parser.add_argument("--similarity", type=float, default=0.1,
                        help="绿幕相似度（仅 green 模式，默认 0.1）")
    parser.add_argument("--fast", action="store_true", help="使用 numpy 加速（需 pip install numpy）")
    args = parser.parse_args()

    check_ffmpeg()
    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        print(f"[错误] 输入不存在：{input_path}", file=sys.stderr)
        sys.exit(1)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if args.background == "green":
        chroma_key_green(input_path, output_path, args.similarity)
    else:
        chroma_key_black(input_path, output_path, args.threshold, args.fast)


if __name__ == "__main__":
    main()
