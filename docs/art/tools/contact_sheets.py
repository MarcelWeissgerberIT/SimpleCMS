#!/usr/bin/env python3
"""Contact sheets for docs/art: icons on ink + paper, covers strip."""
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = str(Path(__file__).resolve().parents[3])
ICONS = f"{ROOT}/public/assets/icons"
COVERS = f"{ROOT}/public/assets/covers"
OUT = f"{ROOT}/docs/art"
FONT_DIR = os.environ.get("ART_FONT_DIR", "/mnt/skills/examples/canvas-design/canvas-fonts")  # IBM Plex Mono


def font(name, size):
    for p in (f"{FONT_DIR}/{name}", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


MONO = lambda s: font("IBMPlexMono-Regular.ttf", s)
MONO_B = lambda s: font("IBMPlexMono-Bold.ttf", s)


def icon_sheet(bg, ink, dim, rule, signal, out, cols=7, cell=260, icon=200):
    items = json.load(open(f"{ICONS}/manifest.json"))
    rows = (len(items) + cols - 1) // cols
    pad = 48
    head = 96
    W = pad * 2 + cols * cell
    H = head + pad + rows * (cell + 34) + 40
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    d.text((pad, 36), "SIMPLECMS ONE", fill=ink, font=MONO_B(22))
    d.text((pad + 210, 36), "ICON SET / INSTRUMENT", fill=dim, font=MONO(22))
    d.text((W - pad, 36), f"{len(items):02d} OBJECTS", fill=dim, font=MONO(22), anchor="ra")
    d.rectangle((pad, 76, pad + 14, 82), fill=signal)
    d.line((pad + 22, 79, W - pad, 79), fill=rule, width=1)
    for i, it in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * cell
        y = head + pad // 2 + r * (cell + 34)
        ic = Image.open(f"{ICONS}/{it['png']}").convert("RGBA").resize((icon, icon), Image.LANCZOS)
        im.paste(ic, (x + (cell - icon) // 2, y), ic)
        ty = y + icon + 10
        d.text((x + 18, ty), f"{i + 1:02d}", fill=signal, font=MONO_B(15))
        d.text((x + 48, ty), it["name"].upper(), fill=ink, font=MONO(15))
        d.text((x + 48, ty + 20), it["label_de"], fill=dim, font=MONO(13))
    im.save(out, optimize=True)
    return out


def cover_sheet(out):
    items = json.load(open(f"{COVERS}/manifest.json"))
    pad = 48
    w = 720
    h = 240
    head = 96
    cols = 2
    rows = (len(items) + 1) // 2
    W = pad * 2 + cols * w + (cols - 1) * 24
    H = head + rows * (h + 44) + pad
    bg, ink, dim, rule, signal = "#F2F0EA", "#121210", "#6B6A64", "#CFCCC2", "#FF4F00"
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    d.text((pad, 36), "SIMPLECMS ONE", fill=ink, font=MONO_B(22))
    d.text((pad + 210, 36), "PAGE COVERS / 1800 x 600", fill=dim, font=MONO(22))
    d.text((W - pad, 36), f"{len(items):02d} PLATES", fill=dim, font=MONO(22), anchor="ra")
    d.rectangle((pad, 76, pad + 14, 82), fill=signal)
    d.line((pad + 22, 79, W - pad, 79), fill=rule, width=1)
    for i, it in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * (w + 24)
        y = head + r * (h + 44)
        cv = Image.open(f"{COVERS}/{it['webp']}").convert("RGB").resize((w, h), Image.LANCZOS)
        im.paste(cv, (x, y))
        d.text((x, y + h + 10), f"{i + 1:02d}", fill=signal, font=MONO_B(15))
        d.text((x + 30, y + h + 10), it["name"].upper(), fill=ink, font=MONO(15))
        d.text((x + w, y + h + 10), it["label_de"], fill=dim, font=MONO(13), anchor="ra")
    im.save(out, quality=88) if out.endswith(".jpg") else im.save(out, optimize=True)
    return out


if __name__ == "__main__":
    import sys

    os.makedirs(OUT, exist_ok=True)
    what = sys.argv[1:] or ["icons", "covers"]
    if "icons" in what:
        print(icon_sheet("#121210", "#F2F0EA", "#8C8A82", "#34332F", "#FF4F00", f"{OUT}/icons-dark.png"))
        print(icon_sheet("#F2F0EA", "#121210", "#6B6A64", "#CFCCC2", "#FF4F00", f"{OUT}/icons-light.png"))
    if "covers" in what:
        print(cover_sheet(f"{OUT}/covers.png"))
