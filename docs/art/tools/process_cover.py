#!/usr/bin/env python3
"""Crop a wide render to a 3:1 banner (1800x600), WebP q82.
usage: process_cover.py <src> <name> [anchor_y 0..1 =0.5] [anchor_x 0..1 =0.5] [grain_sigma =0] [webp_quality =82]
Use quality 90 for very dark plates (night): q82 smears their shadow grain into blocks."""
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]

src, name = sys.argv[1], sys.argv[2]
ay = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
ax = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
grain = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0  # sigma of added mono film grain (0-255 scale)
quality = int(sys.argv[6]) if len(sys.argv) > 6 else 82
im = Image.open(src).convert("RGB")
W, H = im.size
tw, th = W, round(W / 3)
if th > H:
    th, tw = H, H * 3
x0 = round((W - tw) * ax)
y0 = round((H - th) * ay)
out = im.crop((x0, y0, x0 + tw, y0 + th)).resize((1800, 600), Image.LANCZOS)
if grain > 0:
    import numpy as np
    rng = np.random.default_rng(7)
    a = np.asarray(out).astype(np.float32)
    n = rng.normal(0, grain, a.shape[:2]).astype(np.float32)
    # slightly clumped grain (risograph feel): mix fine + 2px noise
    n2 = np.asarray(Image.fromarray(rng.normal(128, grain * 3, (300, 900)).clip(0, 255).astype(np.uint8)).resize((1800, 600), Image.BICUBIC)).astype(np.float32) - 128
    lum = a.mean(axis=2, keepdims=True) / 255.0
    w = 0.55 + 0.45 * (1 - np.abs(lum - 0.5) * 2)  # strongest in mid-tones
    a = a + (0.7 * n + 0.3 * n2)[..., None] * w
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
dst = str(REPO / f"public/assets/covers/{name}.webp")
out.save(dst, quality=quality, method=6)
print(dst, (x0, y0, tw, th))
