"""验证修复后所有 Tab 截图使用语义 token（cream/tangerine/surface）。"""
from PIL import Image
from collections import Counter

FILES = {
    "pet": "fix_tab1_pet.png",
    "chat": "fix_tab2_chat.png",
    "nurture": "fix_tab3_nurture.png",
    "settings": "fix_tab4_settings.png",
}

# 语义 token 期望值
TOKENS = {
    "cream": "#fdf6ec",
    "cream-deep": "#f5e8d5",
    "surface": "#fffdf9",
    "ink": "#4a3626",
    "ink-muted": "#8a7461",
    "ink-faint": "#b3a18c",
    "tangerine": "#e8874a",
    "tangerine-deep": "#d06a2f",
    "tangerine-soft": "#fbe9dc",
    "success": "#9ccb8e",
}

def hx(c):
    return "#{:02x}{:02x}{:02x}".format(*c)

def near(c, hex_str, tol=40):
    t = tuple(int(hex_str[i:i+2], 16) for i in (1, 3, 5))
    return all(abs(a-b) <= tol for a, b in zip(c, t))

def sample(path):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    print(f"\n=== {path} ===")

    # 背景采样（内容区，避开 UI 元素）
    bg_points = [(60, 400), (60, 1000), (1020, 500)]
    bg_colors = [img.getpixel(p) for p in bg_points]
    print("背景:", [hx(c) for c in bg_colors],
          "→ cream/surface 匹配:", any(near(c, TOKENS["cream"]) or near(c, TOKENS["surface"]) for c in bg_colors))

    # Tab 栏主色
    tr = [img.getpixel((x, y)) for y in range(2260, 2380) for x in range(0, w, 20)]
    c = Counter(tr).most_common(4)
    print("Tab栏Top4:", [(hx(col), n) for col, n in c])

    # 每个 Tab 图标中心颜色
    tw = w // 4
    for i, label in enumerate(["宠物", "聊天", "养成", "设置"]):
        px = img.getpixel((int(tw*(i+0.5)), 2300))
        print(f"  Tab[{label}]: {hx(px)}", "←tangerine" if near(px, TOKENS["tangerine"]) else ("←ink-faint" if near(px, TOKENS["ink-faint"]) else ""))

    # 头部背景
    hdr = img.getpixel((540, 180))
    print("头部背景:", hx(hdr), "←cream/surface" if near(hdr, TOKENS["cream"]) or near(hdr, TOKENS["surface"]) else "")

if __name__ == "__main__":
    import os
    base = os.path.dirname(os.path.abspath(__file__))
    for name, fn in FILES.items():
        p = os.path.join(base, fn)
        if os.path.exists(p):
            sample(p)
        else:
            print(f"MISSING: {p}")
