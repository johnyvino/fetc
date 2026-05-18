#!/usr/bin/env python3
"""
Clean product images for the curated grid:
  1. Detect white background → make transparent (with soft alpha falloff)
  2. Auto-crop to the product's bounding box
  3. Square the canvas with consistent padding so every product is framed the same
  4. Save as PNG, replace the original

Run from the curated/ project root:
    python3 tools/process_images.py
"""

import os
import sys
from PIL import Image
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.normpath(os.path.join(HERE, "..", "assets", "items"))

# Saturation cutoff: a pixel below this much chroma is considered "neutral".
# Anything that has real color sails through untouched.
SAT_T          = 28
# Brightness floor: pixels darker than this are definitely product (kept).
BRIGHT_FLOOR   = 140
# Brightness ceiling: pixels above this are definitely background (gone).
BRIGHT_HIGH    = 248
# Cropping uses this alpha threshold so faint shadow remnants don't bloat the
# bounding box. Higher = tighter crop around the opaque product silhouette.
ALPHA_BBOX     = 50
# Breathing room around the product after cropping (% of the long side).
PAD_PCT        = 0.08
# Max long edge for web delivery (2x retina on ~800px large cards).
MAX_SIDE       = 1600


def has_neutral_background(img):
    """Sample 4 corner patches; all must be bright AND desaturated."""
    arr = np.array(img.convert("RGB"))
    h, w = arr.shape[:2]
    patch = max(6, min(h, w) // 30)
    corners = [
        arr[:patch, :patch],
        arr[:patch, -patch:],
        arr[-patch:, :patch],
        arr[-patch:, -patch:],
    ]
    for c in corners:
        m = c.mean(axis=(0, 1))
        if not (m > BRIGHT_FLOOR + 60).all():        # not bright enough
            return False
        if (m.max() - m.min()) > SAT_T + 5:          # too saturated to be a neutral bg
            return False
    return True


def background_to_alpha(img):
    """Soft-key out neutral, bright pixels (white bg + drop shadows)."""
    img = img.convert("RGBA")
    arr = np.array(img).astype(np.float32)
    rgb = arr[:, :, :3]

    saturation = rgb.max(axis=2) - rgb.min(axis=2)
    brightness = rgb.mean(axis=2)

    sat_factor    = np.clip(1.0 - saturation / SAT_T, 0.0, 1.0)
    bright_factor = np.clip(
        (brightness - BRIGHT_FLOOR) / (BRIGHT_HIGH - BRIGHT_FLOOR),
        0.0, 1.0,
    )
    bg_likelihood = sat_factor * bright_factor

    new_alpha = (1.0 - bg_likelihood) * 255.0
    arr[:, :, 3] = np.minimum(arr[:, :, 3], new_alpha)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def crop_and_square(img):
    img = img.convert("RGBA")
    arr = np.array(img)
    a = arr[:, :, 3]
    rows = np.any(a > ALPHA_BBOX, axis=1)
    cols = np.any(a > ALPHA_BBOX, axis=0)
    if not rows.any() or not cols.any():
        return img
    top, bot   = np.where(rows)[0][[0, -1]]
    left, right = np.where(cols)[0][[0, -1]]
    cropped = img.crop((left, top, right + 1, bot + 1))
    cw, ch = cropped.size
    side = max(cw, ch)
    pad  = max(8, int(side * PAD_PCT))
    out_side = side + 2 * pad
    canvas = Image.new("RGBA", (out_side, out_side), (0, 0, 0, 0))
    canvas.paste(cropped, ((out_side - cw) // 2, (out_side - ch) // 2))
    return canvas


def cap_dimensions(img, max_side=MAX_SIDE):
    w, h = img.size
    long_side = max(w, h)
    if long_side <= max_side:
        return img
    scale = max_side / long_side
    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
    return img.resize(new_size, Image.Resampling.LANCZOS)


def process_one(path):
    img = Image.open(path)
    if img.mode == "P":
        img = img.convert("RGBA")
    if has_neutral_background(img):
        img = background_to_alpha(img)
    img = crop_and_square(img)
    img = cap_dimensions(img)
    base, _ = os.path.splitext(os.path.basename(path))
    out_path = os.path.join(DEST, base + ".png")
    img.save(out_path, "PNG", optimize=True)
    if path != out_path and os.path.exists(path):
        os.remove(path)
    return out_path


def main():
    if not os.path.isdir(DEST):
        print(f"missing folder: {DEST}", file=sys.stderr)
        sys.exit(1)
    ok = fail = 0
    for f in sorted(os.listdir(DEST)):
        if f.startswith("_"):
            continue
        if not f.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".avif")):
            continue
        path = os.path.join(DEST, f)
        try:
            out = process_one(path)
            print(f"  ok    {f} -> {os.path.basename(out)}")
            ok += 1
        except Exception as e:
            print(f"  FAIL  {f}: {e}")
            fail += 1
    print(f"\nDone. {ok} processed · {fail} failed.")


if __name__ == "__main__":
    main()
