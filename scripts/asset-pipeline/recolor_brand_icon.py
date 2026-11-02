"""品牌图标重着色：把青蓝徽章改成指定的蓝色（默认支付宝蓝 #1677ff）。

背景（2026-11-02，仓库所有者指定）：
    原图标是「青蓝色圆角徽章 + 白色爪印」，徽章主色实测 #206080 / #205060
    （hue 195–200、饱和 0.67–0.75、明度仅 0.38–0.50）——观感偏青且发闷。
    所有者要求参考支付宝图标的蓝色，故按设备上支付宝包内
    `res/drawable-xxxhdpi-v4/icon_back_zhi.png` 的实测主色标定默认目标：
        #0070f0  51.8%  hue=212.0  sat=1.00  val=0.94
        #1070f0  40.8%  hue=214.3  sat=0.93  val=0.94
    目标可用 --target 覆盖（用于候选色对比；最终值以 docs/CODING_STANDARDS.md §9.1 为准）。

变换（逐像素、只作用于「蓝青族」像素）：
    参考量自动测得：先统计图里蓝青族像素的**主色**（默认判定 alpha≥200、sat≥0.10、160°≤hue≤255°），
    记其饱和/明度为 ref_s / ref_v；随后
        hue  → 目标色的 hue
        sat  → sat × (target_s / ref_s)，上限 1.0
        val  → val × (target_v / ref_v)，上限 0.98
    这样「徽章主色」恰好落到目标色，而原有明暗层次按比例保留；
    白色/米色爪印（sat≈0、hue≈60）与透明区**不被触碰**。

用法：
    python scripts/asset-pipeline/recolor_brand_icon.py --check  <png...>          # 只报当前主色
    python scripts/asset-pipeline/recolor_brand_icon.py <png...>                   # 就地重着色（默认目标 #1677ff）
    python scripts/asset-pipeline/recolor_brand_icon.py --target 0077be --out D <png...>

注：仅处理 PNG；ico/icns 等容器由 `pnpm tauri icon` 从重着色后的源图重新生成。
"""

from __future__ import annotations

import argparse
import colorsys
from collections import Counter
from pathlib import Path

from PIL import Image

DEFAULT_TARGET = '1677ff'
HUE_LO, HUE_HI = 160.0, 255.0
SAT_MIN = 0.10
ALPHA_MIN = 8
ALPHA_STAT = 200
VAL_MAX = 0.98


def hex_to_rgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip('#')
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def is_blue_family(r: int, g: int, b: int, a: int) -> bool:
    if a < ALPHA_MIN:
        return False
    hh, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return HUE_LO <= hh * 360 <= HUE_HI and s >= SAT_MIN


def dominant_blue_ref(im: Image.Image, quant: int = 16) -> tuple[float, float]:
    """测得蓝青族像素的主色（按量化计数取众数），返回 (sat, val) 作参考量。"""
    cnt: Counter = Counter()
    for r, g, b, a in im.convert('RGBA').getdata():
        if a < ALPHA_STAT or not is_blue_family(r, g, b, a):
            continue
        cnt[(r // quant * quant, g // quant * quant, b // quant * quant)] += 1
    if not cnt:
        raise SystemExit('未找到蓝青族像素，无法测定参考色')
    r, g, b = cnt.most_common(1)[0][0]
    _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return s, v


def recolor_image(im: Image.Image, target_hex: str = DEFAULT_TARGET) -> tuple[Image.Image, int, dict]:
    tr, tg, tb = hex_to_rgb(target_hex)
    th, ts, tv = colorsys.rgb_to_hsv(tr / 255, tg / 255, tb / 255)
    ref_s, ref_v = dominant_blue_ref(im)
    k_s = ts / ref_s
    k_v = min(tv / ref_v, VAL_MAX / ref_v)

    im = im.convert('RGBA')
    out = im.copy()
    px = out.load()
    w, h = out.size
    touched = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not is_blue_family(r, g, b, a):
                continue
            _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            ns = min(1.0, s * k_s)
            nv = min(VAL_MAX, v * k_v)
            nr, ng, nb = colorsys.hsv_to_rgb(th, ns, nv)
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
            touched += 1
    return out, touched, {
        'target': f'#{tr:02x}{tg:02x}{tb:02x}',
        'ref_s': ref_s, 'ref_v': ref_v, 'k_s': k_s, 'k_v': k_v,
    }


def color_stats(im: Image.Image, quant: int = 16) -> list[tuple[str, float, float, float, float]]:
    from collections import Counter

    im = im.convert('RGBA')
    cnt: Counter = Counter()
    for r, g, b, a in im.getdata():
        if a < 200:
            continue
        cnt[(r // quant * quant, g // quant * quant, b // quant * quant)] += 1
    total = max(sum(cnt.values()), 1)
    rows = []
    for (r, g, b), n in cnt.most_common(3):
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        rows.append((f'#{r:02x}{g:02x}{b:02x}', n * 100 / total, hh * 360, s, v))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description='把品牌图标的蓝青徽章重着色为指定蓝色（默认支付宝蓝 #1677ff）')
    ap.add_argument('paths', nargs='+', type=Path)
    ap.add_argument('--check', action='store_true', help='只统计当前主色，不写回')
    ap.add_argument('--target', default=DEFAULT_TARGET, help=f'目标主色 RRGGBB（默认 {DEFAULT_TARGET}）')
    ap.add_argument('--out', type=Path, help='输出目录（不就地覆盖）')
    args = ap.parse_args()

    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)

    for path in args.paths:
        im = Image.open(path)
        before = color_stats(im)
        head = f'{path}  {im.size[0]}x{im.size[1]}'
        if args.check:
            print(f'{head}')
            for hexc, pct, hue, s, v in before:
                print(f'    现 {hexc}  {pct:5.1f}%  hue={hue:5.1f} sat={s:.2f} val={v:.2f}')
            continue

        new_im, touched, meta = recolor_image(im, args.target)
        after = color_stats(new_im)
        target = args.out / path.name if args.out else path
        new_im.save(target)
        print(f'{head}  → {target}')
        print(f'    目标 {meta["target"]}（参考 sat={meta["ref_s"]:.2f} val={meta["ref_v"]:.2f}）；'
              f'重着色像素 {touched}')
        print(f'    改前主色 {before[0][0]} → 改后主色 {after[0][0]}'
              f'（hue={after[0][2]:.1f} sat={after[0][3]:.2f} val={after[0][4]:.2f}）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
