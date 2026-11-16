"""Toy Catch — import the user's art from ~/Downloads (only the files named here; ~/Downloads also holds personal
photos, so never browse it).

  uv run --with pillow --with numpy python tools/import_art.py                 # both, default names below
  uv run --with pillow --with numpy python tools/import_art.py --bg toycatch_bg.png
  uv run --with pillow --with numpy python tools/import_art.py --logo toycatch_logo.png

  --bg    → assets/img/bg.webp    the carnival behind the 3D machine (its middle is empty), kept at 2752×1536, q90
  --logo  → assets/img/logo.webp  trimmed to its alpha box, ≤ 1400 px wide, q92 (alpha kept)
"""
import argparse
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
DL = pathlib.Path.home() / 'Downloads'
OUT = ROOT / 'assets' / 'img'


def bg(name):
    im = Image.open(DL / name).convert('RGB')
    if im.width > 2752:
        im = im.resize((2752, round(im.height * 2752 / im.width)), Image.LANCZOS)
    im.save(OUT / 'bg.webp', 'WEBP', quality=90, method=6)
    print('bg  ', name, '→', OUT / 'bg.webp', im.size)


def logo(name):
    im = Image.open(DL / name).convert('RGBA')
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 6)
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    if im.width > 1400:
        im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
    im.save(OUT / 'logo.webp', 'WEBP', quality=92, method=6)
    print('logo', name, '→', OUT / 'logo.webp', im.size)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--bg')
    ap.add_argument('--logo')
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if not a.bg and not a.logo:
        a.bg, a.logo = 'toycatch_bg.png', 'toycatch_logo.png'
    if a.bg:
        bg(a.bg)
    if a.logo:
        logo(a.logo)
