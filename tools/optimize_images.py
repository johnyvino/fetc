#!/usr/bin/env python3
"""
Generate responsive WebP variants from source PNGs.

For every PNG in assets/items/, emits two WebP files at quality 95:
  <name>-800.webp   (long edge <= 800px)
  <name>-1600.webp  (long edge <= 1600px)

Quality 95 with method 6 is visually indistinguishable from lossless on
product photography, while typically 30-50% smaller than the source PNG.

Sources smaller than a target are not upscaled — the variant uses the
source's native size. Output files are skipped when up to date.

Usage:
    python3 tools/optimize_images.py
"""

import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.normpath(os.path.join(HERE, "..", "assets", "items"))

WIDTHS         = (800, 1600)
WEBP_QUALITY   = 95
WEBP_METHOD    = 6  # slowest encoder, smallest output, no quality cost


def needs_regen(src, out):
    return (not os.path.exists(out)) or os.path.getmtime(src) > os.path.getmtime(out)


def emit_variant(img, out_path, target_long):
    w, h = img.size
    long_edge = max(w, h)
    if target_long < long_edge:
        ratio = target_long / long_edge
        scaled = img.resize(
            (max(1, round(w * ratio)), max(1, round(h * ratio))),
            Image.LANCZOS,
        )
    else:
        scaled = img
    if scaled.mode == "P":
        scaled = scaled.convert("RGBA")
    kwargs = {"quality": WEBP_QUALITY, "method": WEBP_METHOD}
    if scaled.mode == "RGBA":
        scaled.save(out_path, "WEBP", **kwargs)
    else:
        scaled.convert("RGB").save(out_path, "WEBP", **kwargs)


def process_one(path):
    img = Image.open(path)
    base, _ = os.path.splitext(os.path.basename(path))
    written = []
    for w in WIDTHS:
        out = os.path.join(DEST, f"{base}-{w}.webp")
        if needs_regen(path, out):
            emit_variant(img, out, w)
            written.append(os.path.basename(out))
    return written


def main():
    if not os.path.isdir(DEST):
        print(f"missing folder: {DEST}", file=sys.stderr)
        sys.exit(1)
    scanned = changed = failed = 0
    for f in sorted(os.listdir(DEST)):
        if not f.lower().endswith(".png"):
            continue
        if f.startswith("_"):
            continue
        path = os.path.join(DEST, f)
        scanned += 1
        try:
            written = process_one(path)
            if written:
                changed += 1
                print(f"  ok    {f} -> {', '.join(written)}")
            else:
                print(f"  skip  {f}")
        except Exception as e:
            failed += 1
            print(f"  FAIL  {f}: {e}")
    print(f"\nDone. {scanned} scanned · {changed} regenerated · {failed} failed.")


if __name__ == "__main__":
    main()
