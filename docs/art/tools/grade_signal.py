#!/usr/bin/env python3
"""Pull the orange of a cover render onto the signal hue (#FF4F00, 18.6 deg) before cropping.

Nano Banana Pro tends to render "orange ink" as peach/salmon (hue ~24 deg, low saturation).
This shifts the hue of every clearly-coloured pixel by (18.6 - median orange hue) and lifts its
saturation; near-neutral pixels (paper, background) stay untouched.

usage: grade_signal.py <in.png> <out.png> [sat_lift =0.35]
then:  process_cover.py <out.png> <name> <anchor_y> ...
"""
import sys

import cv2
import numpy as np
from PIL import Image

TARGET = 18.6  # hue of #FF4F00 in degrees

src, dst = sys.argv[1], sys.argv[2]
lift = float(sys.argv[3]) if len(sys.argv) > 3 else 0.35
a = np.asarray(Image.open(src).convert("RGB"))
hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
h = hsv[..., 0] / 255 * 360
s = hsv[..., 1] / 255
w = np.clip((s - 0.12) / 0.25, 0, 1)  # 0 on neutrals, 1 on clearly coloured pixels
med = float(np.median(h[s > 0.3]))
hsv[..., 0] = np.mod(h + (TARGET - med) * w, 360) / 360 * 255
hsv[..., 1] = np.clip(s + lift * w * (1 - s), 0, 1) * 255
out = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2RGB_FULL)
Image.fromarray(out).save(dst)
print(dst, f"median hue {med:.1f} -> {TARGET}")
