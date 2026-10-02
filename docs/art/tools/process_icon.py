#!/usr/bin/env python3
"""Cut a generated icon render (object on pure white) into a transparent 512px icon.

Pipeline
  1. object mask: rembg isnet-general-use (soft mask), lightly refined
  2. background plate: inpaint the object region -> what the white sweep + shadow looks like
  3. contact shadow: alpha = (bg - plate) / (bg - shadow_ink) -> semi-transparent warm-black
  4. foreground decontamination: pymatting estimate_foreground_ml (removes white fringe)
  5. signal-orange normalisation: hue of the orange accent nudged to #FF4F00 (18.6 deg)
  6. trim, square pad (8% margin around the object), 512x512, PNG + WebP q90

  (--keywhite) see-through bores the matte filled in (background white visible through a gear hub or
  reel hub) are keyed back to transparent

usage: process_icon.py <in.png> <name> [--holes 0.72] [--keywhite] [--shadow 1.0] [--outdir DIR] [--compdir DIR]
requires: pip install pillow numpy opencv-python-headless rembg onnxruntime (pymatting comes with rembg)
"""
import argparse
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from pymatting import estimate_foreground_ml
from rembg import new_session, remove

TARGET_HUE = 18.6 / 360.0  # #FF4F00
SHADOW_INK = np.array([18, 18, 16], dtype=np.float32) / 255.0  # #121210
SIZE = 512
MARGIN = 0.08
REPO = Path(__file__).resolve().parents[3]

_session = None


def session():
    global _session
    if _session is None:
        _session = new_session("isnet-general-use")
    return _session


def object_mask(img: Image.Image) -> np.ndarray:
    m = remove(img, session=session(), only_mask=True, post_process_mask=False)
    m = np.asarray(m).astype(np.float32) / 255.0
    # tighten slightly: kill faint haze, keep soft edge
    m = np.clip((m - 0.04) / 0.92, 0, 1)
    # drop tiny islands (specks in the background)
    hard = (m > 0.5).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = np.zeros(n, bool)
        big = areas.max()
        keep[1:] = areas >= max(400, big * 0.02)
        keepmask = keep[lab]
        grown = cv2.dilate(keepmask.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        m = m * grown
    # solidify the interior: the matting net sometimes leaves translucent patches on flat
    # light faces (kanban cards, app tile). Everything clearly inside the silhouette is opaque;
    # only the outermost ~3px keep their soft matte. True holes (m ~ 0) are untouched.
    core = cv2.erode((m > 0.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    core = cv2.GaussianBlur(core.astype(np.float32), (0, 0), 1.0)
    m = np.maximum(m, core)
    # close tiny enclosed pin-holes / slits (real holes like gear hubs are far larger)
    hard = (m > 0.5).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(1 - hard, 4)
    bl = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist())
    small = np.zeros_like(hard, dtype=bool)
    for k in range(1, n):
        if k not in bl and stats[k, cv2.CC_STAT_AREA] < 900:
            small |= lab == k
    small_core = cv2.dilate(small.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    if small.any():
        filled = (hard > 0) | small
        inner = cv2.erode(filled.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
        small = (cv2.dilate(small.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))) > 0) & inner
        m = np.where(small, 1.0, m)
    return m, small_core


def hue_normalise(rgb: np.ndarray, m: np.ndarray) -> np.ndarray:
    """Shift hue of orange pixels toward TARGET_HUE. rgb float 0..1."""
    hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
    h = hsv[..., 0] / 255.0
    s = hsv[..., 1] / 255.0
    v = hsv[..., 2] / 255.0
    hh = np.where(h > 0.5, h - 1.0, h)
    orange = (hh > -0.02) & (hh < 0.13) & (s > 0.35) & (v > 0.15) & (m > 0.5)
    if orange.sum() < 50:
        return rgb
    med = float(np.median(hh[orange]))
    shift = TARGET_HUE - med
    # weight: smooth in saturation so neutral pixels stay neutral
    w = np.clip((s - 0.25) / 0.25, 0, 1) * ((hh > -0.04) & (hh < 0.16))
    hh2 = hh + shift * w
    # also lift saturation a touch toward the pure signal colour
    s2 = np.clip(s + 0.06 * w * (1 - s), 0, 1)
    hsv[..., 0] = (np.mod(hh2, 1.0) * 255.0)
    hsv[..., 1] = s2 * 255.0
    out = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2RGB_FULL).astype(np.float32) / 255.0
    # keep original where weight is zero (avoid 8-bit roundtrip loss on neutrals)
    w3 = (w > 0)[..., None]
    return np.where(w3, out, rgb)


def fill_holes(m: np.ndarray, alpha: float) -> np.ndarray:
    """Enclosed background regions (e.g. a lens) become translucent object."""
    hard = (m > 0.5).astype(np.uint8)
    inv = 1 - hard
    n, lab = cv2.connectedComponents(inv, connectivity=4)
    border_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist())
    holes = np.zeros_like(m, dtype=bool)
    for k in range(1, n):
        if k not in border_labels:
            holes |= lab == k
    holes_soft = cv2.GaussianBlur(holes.astype(np.float32), (0, 0), 1.2)
    return np.maximum(m, holes_soft * alpha), holes_soft


def key_white(rgb: np.ndarray, m: np.ndarray, bg: np.ndarray, tol: float = 7.0, min_area: int = 150):
    """Regions inside the silhouette that are pure background white (seen through a bore) -> transparent."""
    near = np.abs(rgb * 255.0 - bg[None, None, :] * 255.0).max(axis=2) <= tol
    cand = (near & (m > 0.5)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(cand, 8)
    holes = np.zeros(m.shape, bool)
    for k in range(1, n):
        if st[k, cv2.CC_STAT_AREA] >= min_area:
            holes |= lab == k
    if not holes.any():
        return m, None
    grown = cv2.dilate(holes.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    soft = cv2.GaussianBlur(grown.astype(np.float32), (0, 0), 0.8)
    return m * (1 - soft), soft


def process(path: str, name: str, outdir: str, compdir: str | None, shadow_gain: float = 1.0, holes: float = 0.0, keywhite: bool = False) -> dict:
    src = Image.open(path).convert("RGB")
    rgb = np.asarray(src).astype(np.float32) / 255.0
    H, W = rgb.shape[:2]

    m, patch = object_mask(src)
    hole_mask = None
    if holes > 0:
        m, hole_mask = fill_holes(m, holes)

    # background level from the border
    border = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3), rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    bores = None
    if keywhite:
        m, bores = key_white(rgb, m, bg)

    # background plate via inpainting the (dilated) object
    hole = (cv2.dilate((m > 0.02).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0).astype(np.uint8)
    plate = cv2.inpaint((rgb * 255).astype(np.uint8), hole * 255, 9, cv2.INPAINT_TELEA).astype(np.float32) / 255.0
    plate = cv2.GaussianBlur(plate, (0, 0), 2.0)

    # shadow alpha (luminance based), only outside the object
    lum = lambda x: x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722
    bgL = float(lum(bg[None, None, :])[0, 0])
    inkL = float(lum(SHADOW_INK[None, None, :])[0, 0])
    sa = (bgL - lum(plate)) / max(bgL - inkL, 1e-3)
    sa = np.clip(sa * shadow_gain, 0, 0.75)
    sa = np.where(sa < 0.012, 0, sa)  # kill paper noise
    sa = cv2.GaussianBlur(sa, (0, 0), 1.5)
    # fade the shadow out near the canvas border so nothing gets hard-clipped
    yy, xx = np.mgrid[0:H, 0:W]
    edge = np.minimum.reduce([xx, yy, W - 1 - xx, H - 1 - yy]).astype(np.float32)
    sa = sa * np.clip(edge / 40.0, 0, 1)
    if hole_mask is not None:
        sa = sa * (1 - np.clip(hole_mask * 1.5, 0, 1))
    if bores is not None:
        sa = sa * (1 - np.clip(bores * 1.5, 0, 1))

    # foreground colour without white fringe
    fg = estimate_foreground_ml(rgb.astype(np.float64), m.astype(np.float64)).astype(np.float32)
    fg = np.clip(fg, 0, 1)
    if patch.any():  # repaint closed pin-holes with the surrounding surface
        fg8 = (fg * 255).astype(np.uint8)
        fg = cv2.inpaint(fg8, patch.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA).astype(np.float32) / 255.0
    fg = hue_normalise(fg, m)

    A = m + (1 - m) * sa
    premul = m[..., None] * fg + ((1 - m) * sa)[..., None] * SHADOW_INK[None, None, :]

    # ---- framing: scale by object bbox, make sure the visible shadow fits too
    ys, xs = np.where(m > 0.5)
    oy0, oy1, ox0, ox1 = ys.min(), ys.max(), xs.min(), xs.max()
    ys2, xs2 = np.where(A > 0.03)
    ay0, ay1, ax0, ax1 = ys2.min(), ys2.max(), xs2.min(), xs2.max()
    obj_ext = max(oy1 - oy0, ox1 - ox0) + 1
    scale = SIZE * (1 - 2 * MARGIN) / obj_ext
    # centre: object box horizontally, object+core-shadow vertically
    ys3, xs3 = np.where(A > 0.12)
    cy = (min(oy0, ys3.min()) + max(oy1, ys3.max())) / 2.0
    cx = (ox0 + ox1) / 2.0
    # ensure the full visible extent fits in the canvas with a 2% safety margin
    half = SIZE * (0.5 - 0.02) / scale
    need = max(cx - ax0, ax1 - cx, cy - ay0, ay1 - cy)
    if need > half:
        scale *= half / need
    # affine: src -> dst
    M = np.array([[scale, 0, SIZE / 2 - cx * scale], [0, scale, SIZE / 2 - cy * scale]], dtype=np.float32)
    rgba_p = np.dstack([premul, A]).astype(np.float32)
    # area interpolation for good downsampling quality on premultiplied data
    big = cv2.warpAffine(rgba_p, M * 2, (SIZE * 2, SIZE * 2), flags=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    out = cv2.resize(big, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    out = np.clip(out, 0, 1)
    a = out[..., 3:4]
    col = np.where(a > 1e-4, out[..., :3] / np.maximum(a, 1e-4), 0)
    col = np.clip(col, 0, 1)
    a8 = np.round(a[..., 0] * 255).astype(np.uint8)
    c8 = np.round(col * 255).astype(np.uint8)
    c8[a8 == 0] = 0
    im = Image.fromarray(np.dstack([c8, a8]), "RGBA")

    os.makedirs(outdir, exist_ok=True)
    png = os.path.join(outdir, f"{name}.png")
    webp = os.path.join(outdir, f"{name}.webp")
    im.save(png, optimize=True)
    im.save(webp, quality=90, method=6, exact=False)

    if compdir:
        os.makedirs(compdir, exist_ok=True)
        tiles = []
        for hexbg in ("#0B0B0E", "#F2F0EA", "#FFFFFF"):
            bgim = Image.new("RGBA", (SIZE, SIZE), hexbg)
            bgim.alpha_composite(im)
            tiles.append(bgim.convert("RGB"))
        sheet = Image.new("RGB", (SIZE * 3, SIZE))
        for i, t in enumerate(tiles):
            sheet.paste(t, (i * SIZE, 0))
        sheet.save(os.path.join(compdir, f"{name}.png"))
    return {"png": png, "webp": webp, "scale": scale}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("name")
    ap.add_argument("--outdir", default=str(REPO / "public/assets/icons"))
    ap.add_argument("--compdir", default=str(REPO / ".art-work/comp"), help="edge-check composites on #0B0B0E / #F2F0EA / #FFF")
    ap.add_argument("--shadow", type=float, default=1.0)
    ap.add_argument("--holes", type=float, default=0.0, help="alpha for enclosed holes (0 = keep transparent)")
    ap.add_argument("--keywhite", action="store_true", help="key background white seen through bores back to transparent")
    a = ap.parse_args()
    r = process(a.src, a.name, a.outdir, a.compdir, a.shadow, a.holes, a.keywhite)
    print(a.name, r)
