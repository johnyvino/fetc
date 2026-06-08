#!/usr/bin/env python3
"""
Erase award-badge corners from specific product images, then re-crop and
re-square so the product re-centers in the frame.

Run from the curated/ project root:
    python3 tools/remove_badges.py

To handle a new badged image, add an entry to BADGE_RECTS below. Coordinates
are fractions of the current image size: (left, top, right, bottom).
"""

import os
import sys
from PIL import Image
import numpy as np

# Make process_images importable so we reuse its crop_and_square()
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from process_images import crop_and_square  # noqa: E402

DEST = os.path.normpath(os.path.join(HERE, "..", "assets", "items"))

# Per-image rectangles to erase. Tuned wide enough to catch every glyph in
# the badge cluster (year text, sub-labels) — process_images recrops empty
# space afterward.
BADGE_RECTS = {
    # slug:           (left, top, right, bottom) as fractions 0..1
    "hoto-camplight": (0.00, 0.00, 1.00, 0.25),
    "hoto-12v-drill": (0.00, 0.00, 0.45, 0.25),
    "sharge-pixel":   (0.55, 0.00, 1.00, 0.32),
}


def sample_background(arr, mask_box):
    """Sample image corners *outside* the masked rect to figure out the bg
    fill. Returns (rgb tuple, alpha) so we can match dark-bg shots correctly."""
    h, w = arr.shape[:2]
    l, t, r, b = mask_box
    patch = max(8, min(w, h) // 40)
    candidates = [
        (0, 0, patch, patch),
        (0, w - patch, patch, w),
        (h - patch, 0, h, patch),
        (h - patch, w - patch, h, w),
    ]
    rgb_samples = []
    alpha_samples = []
    for y0, x0, y1, x1 in candidates:
        # skip the corner if it overlaps the masked region
        if not (x1 <= l or x0 >= r or y1 <= t or y0 >= b):
            continue
        patch_pix = arr[y0:y1, x0:x1]
        a_mean = float(patch_pix[:, :, 3].mean())
        alpha_samples.append(a_mean)
        if a_mean < 50:
            continue  # corner is transparent, can't trust its RGB
        rgb_samples.append(patch_pix[:, :, :3].mean(axis=(0, 1)))

    if rgb_samples:
        fill_rgb = np.mean(rgb_samples, axis=0).astype(int)
        return tuple(int(c) for c in fill_rgb), 255
    # No opaque corner found → original was a white-bg-keyed image; make
    # the masked rect transparent so it disappears into the card backdrop.
    return (255, 255, 255), 0


def erase_rect(img, l_pct, t_pct, r_pct, b_pct):
    img = img.convert("RGBA")
    w, h = img.size
    l = int(round(l_pct * w))
    t = int(round(t_pct * h))
    r = int(round(r_pct * w))
    b = int(round(b_pct * h))
    arr = np.array(img)

    fill_rgb, fill_alpha = sample_background(arr, (l, t, r, b))
    arr[t:b, l:r, 0] = fill_rgb[0]
    arr[t:b, l:r, 1] = fill_rgb[1]
    arr[t:b, l:r, 2] = fill_rgb[2]
    arr[t:b, l:r, 3] = fill_alpha
    return Image.fromarray(arr, "RGBA")


def main():
    if not os.path.isdir(DEST):
        print(f"missing folder: {DEST}", file=sys.stderr)
        sys.exit(1)

    ok = miss = 0
    for slug, rect in BADGE_RECTS.items():
        path = os.path.join(DEST, slug + ".png")
        if not os.path.exists(path):
            print(f"  skip  {slug}.png not found")
            miss += 1
            continue
        img = Image.open(path)
        img = erase_rect(img, *rect)
        img = crop_and_square(img)
        img.save(path, "PNG", optimize=True)
        print(f"  ok    {slug}.png")
        ok += 1

    print(f"\nDone. {ok} cleaned · {miss} missing.")


if __name__ == "__main__":
    main()
