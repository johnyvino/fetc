#!/usr/bin/env python3
"""
Install user-saved product images into assets/items/ WITHOUT keying or cropping.

Use this when the raw photo (lifestyle, dark studio, non-white background, or
already-clean press image) should be preserved as-is — bypassing the white-bg
removal and bounding-box crop that process_images.py applies.

Save your source image to either ~/Documents/ or ~/Downloads/ with the slug
as the filename (any common extension). Example:
    ~/Documents/apple-macbook-pro.png
    ~/Downloads/nikon-zf.jpg

Then run from the curated/ project root:
    python3 tools/install_raw.py
"""

import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.normpath(os.path.join(HERE, "..", "assets", "items"))

# Slugs to install raw. Add more as needed.
SLUGS = [
    "nikon-zf",
    "ferrari-luce",
    "bugatti-voiture-noire",
    "roli-seaboard-m",
    "roli-seaboard-2",
    "sharge-pixel",
]

# Filename aliases — sometimes saved files don't exactly match the slug.
ALIASES = {
    "herman-miller-aeron": ["aeronChair", "aeron-chair", "aeron"],
}

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".heic", ".gif"}


def find_source(slug):
    """Find a file matching the slug (or alias) in ~/Documents or ~/Downloads."""
    names = {slug, *ALIASES.get(slug, [])}
    for folder in (os.path.expanduser("~/Documents"),
                   os.path.expanduser("~/Downloads")):
        if not os.path.isdir(folder):
            continue
        for f in os.listdir(folder):
            stripped = f.strip()
            base, ext = os.path.splitext(stripped)
            if ext.lower() not in VALID_EXTS and ext != "":
                continue
            if base.strip() in names:
                return os.path.join(folder, f)
    return None


def main():
    if not os.path.isdir(DEST):
        print(f"missing folder: {DEST}", file=sys.stderr)
        sys.exit(1)

    installed, missing = 0, []
    for slug in SLUGS:
        src = find_source(slug)
        if not src:
            missing.append(slug)
            print(f"  MISSING  {slug}")
            continue
        try:
            img = Image.open(src).convert("RGBA")
        except Exception as e:
            print(f"  FAIL     {slug}: {e}")
            continue

        # Remove any existing version under a different extension
        for ext in VALID_EXTS:
            stale = os.path.join(DEST, slug + ext)
            if os.path.exists(stale):
                os.remove(stale)

        out = os.path.join(DEST, slug + ".png")
        img.save(out, "PNG", optimize=True)
        installed += 1
        print(f"  ok       {os.path.basename(src)!r} -> {slug}.png")

    print(f"\nInstalled raw: {installed}")
    if missing:
        print("\nStill needed — save each as ~/Documents/<slug>.<ext>:")
        for s in missing:
            print(f"  - {s}")


if __name__ == "__main__":
    main()
