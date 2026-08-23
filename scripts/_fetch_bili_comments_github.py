# -*- coding: utf-8 -*-
"""
抓取指定 B 站视频的一级评论，扫描 GitHub/码云等开源仓库链接。
复刻 Multi-Tracker bilibili-comments 的 WBI 签名逻辑，用公开接口直接请求。
"""
import hashlib
import json
import re
import time
import urllib.request
import urllib.parse

TARGETS = [
    ("BV17wGP6rE2k", "大肥橘卡卡-全网最真实桌宠教程"),
    ("BV1M4jdzcE8A", "程序员老陆-Python桌宠附源码"),
    ("BV1MaSeBPEus", "彻喵-智能对话AI桌宠"),
    ("BV1tZf7BCE85", "mate engine 3D桌宠芙宁娜"),
    ("BV1113b6sEpp", "水脚脚-DoroPet"),
    ("BV1268H6JE55", "桃天帝不差-弗糯糯吃文件"),
    ("BV1mGjo6EE3R", "小柳技术日记-赛博伴侣"),
    ("BV1Y6V16SEc3", "路人甲频道-两分钟Codex桌宠"),
]

MIXIN_TABLE = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

REPO_RE = re.compile(
    r"(?:https?://)?(?:github\.com|gitee\.com|gitcode\.com|gitlab\.com)/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+(?:/releases|/tree/[^\s\"'\u4e00-\u9fff]+)?"
)
# 仅抓 github/gitee 等仓库，避免把 B 站个人空间误判
REPO_LINK_RE = re.compile(r"(?:https?://)?(?:github\.com|gitee\.com|gitcode\.com|gitlab\.com)\S*", re.I)


def http_get_json(url, headers=None, retries=3):
    req = urllib.request.Request(url, headers=headers or {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))


def file_key(url):
    name = (url or "").split("/")[-1] or ""
    return name.split(".")[0]


def get_mixin_key(img_key, sub_key):
    raw = f"{img_key}{sub_key}"
    return "".join(raw[n] for n in MIXIN_TABLE)[:32]


def sign_params(params, mixin_key):
    signed = dict(params)
    signed["wts"] = int(time.time())
    keys = sorted(signed.keys())
    query = "&".join(
        f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(str(signed[k]).replace(chr(39), '').replace('!', '').replace('(', '').replace(')', '').replace('*', ''), safe='')}"
        for k in keys
    )
    wrid = hashlib.md5((query + mixin_key).encode()).hexdigest()
    return f"{query}&w_rid={wrid}"


def fetch_wbi_mixin_key():
    nav = http_get_json("https://api.bilibili.com/x/web-interface/nav")
    wbi = nav["data"]["wbi_img"]
    return get_mixin_key(file_key(wbi["img_url"]), file_key(wbi["sub_url"]))


def fetch_aid(bvid):
    data = http_get_json(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}")
    d = data["data"]
    return d["aid"], d.get("title")


def fetch_comments(bvid, mixin_key, max_roots=60):
    aid, title = fetch_aid(bvid)
    roots = []
    next_cursor = 0
    while len(roots) < max_roots:
        params = {"oid": aid, "type": 1, "mode": 3, "ps": 20, "next": next_cursor}
        url = "https://api.bilibili.com/x/v2/reply/wbi/main?" + sign_params(params, mixin_key)
        data = http_get_json(url)
        if data.get("code") != 0:
            roots.append({"api_error": data.get("message"), "code": data.get("code")})
            break
        replies = data.get("data", {}).get("replies") or []
        for c in replies:
            content = (c.get("content") or {}).get("message", "")
            if REPO_LINK_RE.search(content):
                roots.append({"rpid": str(c.get("rpid")), "content": content,
                              "nickname": (c.get("member") or {}).get("uname")})
            if len(roots) >= max_roots:
                break
        cursor = data.get("data", {}).get("cursor") or {}
        if cursor.get("is_end") or (data.get("data", {}).get("replies") is None and not roots):
            break
        next_cursor = cursor.get("next")
        if not next_cursor:
            break
        time.sleep(0.5)
    return aid, title, roots


def main():
    results = []
    mixin_key = fetch_wbi_mixin_key()
    print(f"wbi mixin_key = {mixin_key}")
    for bvid, note in TARGETS:
        try:
            aid, title, hits = fetch_comments(bvid, mixin_key)
            unique = {}
            for h in hits:
                for m in REPO_LINK_RE.findall(h.get("content", "")):
                    unique[m.rstrip(".,，；;）)】】")] = h.get("nickname", "")
            results.append({
                "bvid": bvid, "aid": aid, "title": title, "note": note,
                "comment_repos": [{"url": u, "by": n} for u, n in unique.items()],
                "raw_hint_count": len(hits),
                "api_error": next((h.get("api_error") for h in hits if "api_error" in h), None),
            })
            tag = "OK " if results[-1]["comment_repos"] else ("ERR" if results[-1]["api_error"] else "   ")
            print(f"[{tag}] {bvid} {title[:26]:<28} -> {[u['url'] for u in results[-1]['comment_repos']] or results[-1]['api_error'] or '-'}")
        except Exception as e:
            results.append({"bvid": bvid, "note": note, "error": str(e)})
            print(f"[ERR] {bvid} -> {e}")
        time.sleep(0.8)

    out = "c:/Users/Doro/Multi-Tracker/_comments_github_results.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("\n===== 评论中含仓库链接的视频 =====")
    for r in results:
        if r.get("comment_repos"):
            print(f"{r['bvid']} | {r['title']} | {r['note']}")
            for u in r["comment_repos"]:
                print(f"    {u['url']}    (by {u['by']})")
    print(f"\n结果已保存: {out}")

if __name__ == "__main__":
    main()