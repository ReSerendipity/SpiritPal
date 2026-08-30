#!/usr/bin/env python
"""Fetch a GitHub repo page, extract stars/forks/license/description/topics + keyword hits."""
import re, html, sys, subprocess, os

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

def fetch(url, out):
    r = subprocess.run(["curl", "-sL", "--ssl-no-revoke", "--max-time", "50",
                        "-A", UA, url, "-o", out], capture_output=True)
    return r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 1000

def clean(s):
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()

def analyze(repo, kws):
    out = os.path.expanduser(f"~/gh-research/pages/{repo.replace('/', '_')}.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if not fetch(f"https://github.com/{repo}", out):
        print(f"### {repo}\n  FETCH FAILED / NOT FOUND")
        return
    raw = open(out, encoding='utf-8', errors='ignore').read()
    def g(pat):
        m = re.search(pat, raw)
        return m.group(1).strip() if m else '?'
    title = g(r'<title>([^<]+)</title>')
    stars = g(r'id="repo-stars-counter-star"[^>]*>([^<]+)<')
    forks = g(r'id="repo-network-counter"[^>]*>([^<]+)<')
    lic = g(r'aria-label="([^"]*license[^"]*)"' ) or '?'
    if lic == '?':
        m = re.search(r'href="/%s/blob/[^"]*"\s*[^>]*>\s*(MIT|Apache-2\.0|GPL[^ <]*|BSD[^ <]*|AGPL[^ <]*|CC-BY[^ <]*|MIT-0)[ <]' % re.escape(repo), raw)
        lic = m.group(1) if m else '?'
    # topics
    topics = re.findall(r'<a[^>]*href="/topics/([a-z0-9\-]+)"[^>]*>', raw)[:8]
    print(f"### {repo}")
    print(f"  title: {clean(title)[:150]}")
    print(f"  stars: {stars} | forks: {forks} | license: {lic}")
    print(f"  topics: {topics}")
    # keyword scan in page text (README is embedded)
    txt = clean(raw)
    txt_unesc = clean(raw.encode().decode('unicode_escape', errors='ignore'))
    for kw in kws:
        hits = 0
        snippet = ''
        for src in (txt, txt_unesc):
            i = src.lower().find(kw.lower())
            if i != -1:
                hits += 1
                if not snippet:
                    snippet = src[max(0, i-120):i+220]
                break
        if hits:
            print(f"  [{kw}] {snippet[:280]}")
    print()

if __name__ == "__main__":
    repo = sys.argv[1]
    kws = sys.argv[2].split(',') if len(sys.argv) > 2 else []
    analyze(repo, kws)
