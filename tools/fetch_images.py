#!/usr/bin/env python3
"""
Fetch og:image from each product URL and save to ../assets/items/<slug>.<ext>.

Usage (from the curated/ project root):
    python3 tools/fetch_images.py

Re-runs are idempotent — already-downloaded files are skipped unless --force.
"""

import os
import re
import ssl
import sys
import urllib.parse
import urllib.request
from html import unescape

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.0 Safari/605.1.15"
)

# Source of truth: items.js. We extract (id, link) pairs.
HERE     = os.path.dirname(os.path.abspath(__file__))
ITEMS_JS = os.path.normpath(os.path.join(HERE, "..", "items.js"))
DEST     = os.path.normpath(os.path.join(HERE, "..", "assets", "items"))
os.makedirs(DEST, exist_ok=True)


def load_products():
    """Parse `{ id: 'slug', ... link: 'https://...', ... }` entries out of items.js."""
    if not os.path.exists(ITEMS_JS):
        return []
    with open(ITEMS_JS, encoding="utf-8") as f:
        text = f.read()
    # Each entry sits on one line in items.js. id and link both appear in the same {} block.
    pat = re.compile(
        r"\{[^}]*?id:\s*'([^']+)'[^}]*?link:\s*'([^']+)'[^}]*?\}",
        re.DOTALL,
    )
    return pat.findall(text)


PRODUCTS = load_products()

FORCE = "--force" in sys.argv

ctx = ssl.create_default_context()


def fetch_html(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
        raw = r.read()
    # Best-effort decode
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def meta(html, prop):
    pat1 = r'<meta[^>]+(?:property|name)=["\']' + re.escape(prop) + r'["\'][^>]*content=["\']([^"\']+)["\']'
    pat2 = r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + re.escape(prop) + r'["\']'
    m = re.search(pat1, html, re.I) or re.search(pat2, html, re.I)
    return unescape(m.group(1)) if m else None


def absolutize(img, base):
    if not img:
        return None
    if img.startswith("//"):
        return "https:" + img
    if img.startswith("/"):
        p = urllib.parse.urlparse(base)
        return f"{p.scheme}://{p.netloc}{img}"
    return img


def guess_ext(img_url, content_type):
    ct = (content_type or "").lower()
    if "jpeg" in ct or "jpg" in ct: return "jpg"
    if "png"  in ct: return "png"
    if "webp" in ct: return "webp"
    if "avif" in ct: return "avif"
    path = urllib.parse.urlparse(img_url).path.lower()
    for ext in ("jpg", "jpeg", "png", "webp", "avif"):
        if path.endswith("." + ext):
            return "jpeg" if ext == "jpeg" else ext.replace("jpeg", "jpg")
    return "jpg"


def download(img_url, dest_no_ext):
    req = urllib.request.Request(img_url, headers={"User-Agent": UA, "Referer": "https://www.google.com/"})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        ct = r.headers.get("Content-Type", "")
        data = r.read()
    ext = guess_ext(img_url, ct)
    path = dest_no_ext + "." + ext
    with open(path, "wb") as f:
        f.write(data)
    return path


def already_have(slug):
    if FORCE:
        return None
    for ext in ("jpg", "jpeg", "png", "webp", "avif"):
        p = os.path.join(DEST, f"{slug}.{ext}")
        if os.path.exists(p):
            return p
    return None


ok = fail = skip = 0
for slug, url in PRODUCTS:
    have = already_have(slug)
    if have:
        print(f"  skip   {slug}  ({os.path.basename(have)})")
        skip += 1
        continue
    try:
        html = fetch_html(url)
    except Exception as e:
        print(f"  FAIL   {slug}  page: {e}")
        fail += 1
        continue
    img = (meta(html, "og:image:secure_url")
           or meta(html, "og:image")
           or meta(html, "twitter:image"))
    img = absolutize(img, url)
    if not img:
        print(f"  FAIL   {slug}  no og:image found")
        fail += 1
        continue
    try:
        path = download(img, os.path.join(DEST, slug))
        print(f"  ok     {slug}  -> {os.path.basename(path)}")
        ok += 1
    except Exception as e:
        print(f"  FAIL   {slug}  download: {e}")
        fail += 1

print(f"\nDone. {ok} downloaded · {skip} already had · {fail} failed.")
print(f"Saved into: {DEST}")
if fail:
    print("Re-run with --force to retry, or save the missing images by hand into the folder above.")
