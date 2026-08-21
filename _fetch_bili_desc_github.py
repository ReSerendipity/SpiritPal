# -*- coding: utf-8 -*-
"""
批量抓取 B 站视频简介(desc)，提取作者提供的开源 GitHub/码云等仓库链接。
使用 B 站公开 view 接口，无需登录/CDP。
"""
import json
import re
import time
import urllib.request
import urllib.parse

# 候选视频（桌面宠物相关，BV号 -> 备注）
CANDIDATES = [
    ("BV17wGP6rE2k", "全网最真实桌面宠物制作教程-大肥橘卡卡"),
    ("BV1Yt8g6fEuB", "Petra一张图AI桌宠-无谬Wumiu"),
    ("BV1113b6sEpp", "DoroPet史诗级重构-水脚脚"),
    ("BV1268H6JE55", "弗糯糯吃文件桌宠-桃天帝不差"),
    ("BV1mGjo6EE3R", "赛博伴侣B站AI赛-小柳技术日记"),
    ("BV1M4jdzcE8A", "Python桌宠附源码-程序员老陆"),
    ("BV1MXKi6NEbR", "Soullink Emotion SDK-骥南凌音"),
    ("BV1MaSeBPEus", "智能对话AI多功能桌宠-彻喵"),
    ("BV1oNLVznENk", "开源自制桌宠Cursor教学-剑陽颂"),
    ("BV1uA3y6uE9u", "室友codex桌宠-维天说"),
    ("BV1Y6V16SEc3", "两分钟Codex桌宠-路人甲频道"),
    ("BV1WY4y1A7JV", "果核剥壳10款桌面宠物软件"),
    ("BV1tZf7BCE85", "mate engine 3D桌宠芙宁娜"),
    ("BV1C6ba6TEB4", "DS Harness大肥鱼桌宠插件-浩瀚星空2005"),
    ("BV1Wx8u6GEtM", "基于dsh-pet桌宠移植-張墨林"),
    ("BV1jo5e6AEmL", "桌面宠物制作教程"),
    ("BV1RCgk6uEBQ", "手把手WorkBuddy制作桌面宠物"),
    ("BV1TwAPz7Ehw", "里芙-恒约 vrm桌宠"),
    ("BV1yjby63EFg", "呆啵宠物昼夜v0.10.3"),
    ("BV13RNF6PEuN", "原神圣桑多涅免费桌宠"),
    ("BV1HZ4y1v7uR", "8款神级桌宠清单盘点"),
    ("BV1PP7ez8EY1", "小Doro桌宠"),
    ("BV1qb4y157x6", "Q宠企鹅解析"),
    ("BV1iN8p6AEV5", "DS Harness养牛任务桌宠"),
    ("BV1UJoEBrE9J", "咕嘎桌宠v0.2小企鹅"),
    ("BV1GmMD6QEyH", "codex蕾米埃尔桌宠"),
    ("BV1TUNEzcEwN", "BongoCat开源小猫桌宠"),
    ("BV1HqPuz9E35", "BongoCat皮肤整合包"),
    ("BV1HCgT6pEDF", "ds开源桌宠蓝色大肥鱼-栩栩如枫"),
    ("BV1Kj8u6EEtY", "DS Harness大肥鱼余额挂件-月匠"),
]

REPO_RE = re.compile(
    r"(?:https?://)?(?:github\.com|gitee\.com|gitcode\.com|gitlab\.com)/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+(?:/releases)?"
)

def fetch(bvid, retries=3):
    url = "https://api.bilibili.com/x/web-interface/view?" + urllib.parse.urlencode({"bvid": bvid})
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": f"https://www.bilibili.com/video/{bvid}",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read().decode("utf-8"))
            if data.get("code") != 0:
                return {"bvid": bvid, "error": f"code={data.get('code')} {data.get('message')}"}
            d = data["data"]
            desc = d.get("desc") or ""
            return {
                "bvid": bvid,
                "title": d.get("title"),
                "author": (d.get("owner") or {}).get("name"),
                "url": f"https://www.bilibili.com/video/{bvid}",
                "desc": desc,
                "repos": sorted(set(REPO_RE.findall(desc))),
            }
        except Exception as e:
            if attempt == retries - 1:
                return {"bvid": bvid, "error": str(e)}
            time.sleep(1.5 * (attempt + 1))

def main():
    results = []
    for bvid, note in CANDIDATES:
        info = fetch(bvid)
        info["note"] = note
        results.append(info)
        status = sorted(info.get("repos") or []) or info.get("error") or "-"
        print(f"[{('OK' if info.get('repos') else ('ERR' if info.get('error') else '   '))}] {bvid} {info.get('title','')[:28]:<30} -> {status}")
        time.sleep(0.6)

    out = "c:/Users/Doro/Multi-Tracker/_desc_github_results.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("\n===== 含 GitHub/码云等链接的视频 =====")
    for r in results:
        if r.get("repos"):
            print(f"{r['bvid']} | {r['title']} | {r['author']}")
            for repo in r["repos"]:
                print(f"    {repo}")
    print(f"\n结果已保存: {out}")

if __name__ == "__main__":
    main()