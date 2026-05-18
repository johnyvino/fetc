#!/usr/bin/env python3
"""
Resize and recompress product PNGs for the grid.

Display max is ~800 CSS px (2-col large cards at 2x ≈ 1600 px). Images
fetched at 4000+ px are wasted bandwidth. This script downsizes in place.

Run from the project root:
    python3 tools/optimize_images.py
    python3 tools/optimize_images.py --max-side 1600 --dry-run
"""

import argparse
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.normpath(os.path.join(HERE, "..", "assets", "items"))
DEFAULT_MAX_SIDE = 1600


def webp_path_for(png_path):
    base, _ = os.path.splitext(png_path)
    return base + ".webp"


def optimize_one(path, max_side, webp_quality, dry_run):
    before = os.path.getsize(path)
    with Image.open(path) as img:
        img = img.convert("RGBA")
        w, h = img.size
        long_side = max(w, h)
        resized = False
        if long_side > max_side:
            scale = max_side / long_side
            new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
            if dry_run:
                print(f"  resize {os.path.basename(path)} {w}x{h} -> {new_size[0]}x{new_size[1]}")
            else:
                img = img.resize(new_size, Image.Resampling.LANCZOS)
            resized = True

        webp_out = webp_path_for(path)
        if dry_run:
            return before, int(before * 0.35) if resized else 0

        if resized or before > 400_000:
            img.save(path, "PNG", optimize=True)

        img.save(webp_out, "WEBP", quality=webp_quality, method=6)

    after = os.path.getsize(path)
    webp_size = os.path.getsize(webp_out)
    saved = max(0, before - min(after, webp_size))
    print(
        f"  ok    {os.path.basename(path)} "
        f"png {after // 1024}KB · webp {webp_size // 1024}KB"
    )
    return before, saved


def main():
    parser = argparse.ArgumentParser(description="Resize product PNGs for web delivery.")
    parser.add_argument("--max-side", type=int, default=DEFAULT_MAX_SIDE)
    parser.add_argument("--webp-quality", type=int, default=82)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.path.isdir(DEST):
        print(f"missing folder: {DEST}", file=sys.stderr)
        sys.exit(1)

    total_before = total_saved = touched = 0
    for name in sorted(os.listdir(DEST)):
        if name.startswith("_") or not name.lower().endswith(".png"):
            continue
        path = os.path.join(DEST, name)
        try:
            before, saved = optimize_one(
                path, args.max_side, args.webp_quality, args.dry_run
            )
            if saved or (args.dry_run and before):
                touched += 1
            total_before += before
            total_saved += saved
        except Exception as e:
            print(f"  FAIL  {name}: {e}")

    if args.dry_run:
        print(f"\nDry run: {touched} images would be resized (max side {args.max_side}px).")
    else:
        print(
            f"\nDone. {touched} resized · "
            f"{total_before // (1024 * 1024)}MB -> "
            f"{(total_before - total_saved) // (1024 * 1024)}MB saved "
            f"({total_saved // (1024 * 1024)}MB)."
        )


if __name__ == "__main__":
    main()
