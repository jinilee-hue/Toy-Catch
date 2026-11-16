"""Toy Catch — import the user's art from ~/Downloads (only the files named here; ~/Downloads also holds personal
photos, so never browse it).

  uv run --with pillow --with numpy --with scipy python tools/import_art.py    # everything, default names below
  uv run --with pillow --with numpy python tools/import_art.py --bg toycatch_bg.png
  uv run --with pillow --with numpy python tools/import_art.py --logo toycatch_logo.png
  uv run --with pillow --with numpy --with scipy python tools/import_art.py --friends   # toycatch_<kind>.png × 10
  ... --friends --check out.png                                                 # + the head boxes drawn on each friend

  --bg       → assets/img/bg.webp     the carnival behind the 3D machine (its middle is empty), kept at 2752×1536, q90
  --logo     → assets/img/logo.webp   trimmed to its alpha box, ≤ 1400 px wide, q92 (alpha kept)
  --friends  → assets/img/friends/<kind>.webp (trimmed, ≤ 600 px tall, alpha) + js/friends-art.js: the same webp as data
               URLs (WebGL can't use image files from file://) with each picture's size and its head — the ellipse the
               claw closes round, measured from the alpha (widest row of the top half → narrowest row under it = neck),
               or HEAD_FIX for the friends drawn side-on.
"""
import argparse
import base64
import io
import json
import pathlib

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
DL = pathlib.Path.home() / 'Downloads'
OUT = ROOT / 'assets' / 'img'
FRIENDS = ['monkey', 'mouse', 'ant', 'seal', 'turkey', 'turtle', 'cat', 'cow', 'dog', 'fish']
MAX_H = 600
# (u, v, rx, ry) as fractions of the picture (u, rx of its width; v, ry of its height) where the measurement can't
# work: side-on friends (no head on top) are held round the top of the shell / body
HEAD_FIX = {
    'turtle': (0.56, 0.36, 0.30, 0.30),
    'fish': (0.52, 0.42, 0.30, 0.34),
    'seal': (0.5, 0.265, 0.39, 0.24),      # head and body are one shape: the chin is where the sweater starts
    'turkey': (0.5, 0.235, 0.25, 0.215),   # the head, not the tail fan behind it
}


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


def head_of(alpha):
    """the head: rows from the top of the head to the neck, as (u, v, rx, ry)"""
    m = alpha > 128
    H, W = m.shape
    ext = np.zeros(H)
    left = np.zeros(H)
    for y in range(H):
        xs = np.nonzero(m[y])[0]
        if len(xs):
            ext[y] = xs[-1] - xs[0] + 1
            left[y] = xs[0]
    k = max(3, H // 50)
    es = np.convolve(ext, np.ones(k) / k, mode='same')
    top = int(np.argmax(es > 0.3 * es.max()))                  # skips antennae / a single tuft
    yw = top + int(np.argmax(es[top:int(H * 0.55)]))           # the widest row of the head
    yn = yw + int(np.argmin(es[yw:int(H * 0.72)]))             # the neck under it
    yn = max(yn, yw + int(H * 0.08))
    cols = np.nonzero(m[top:yn].any(0))[0]
    u = (cols[0] + cols[-1]) / 2 / W
    return tuple(round(float(x), 3) for x in (u, (top + yn) / 2 / H, es[yw] / 2 / W, (yn - top) / 2 / H))


def bleed(im):
    """the colour of the nearest solid pixel under every see-through pixel (the source has white there, which a
    scaled-down texture smears into a white halo); kept by saving with exact=True"""
    from scipy import ndimage
    arr = np.asarray(im).copy()
    a = arr[..., 3]
    _, (iy, ix) = ndimage.distance_transform_edt(a < 160, return_indices=True)
    under = a < 160
    arr[..., :3][under] = arr[..., :3][iy[under], ix[under]]
    return Image.fromarray(arr, 'RGBA')


def friends(check=None):
    (OUT / 'friends').mkdir(parents=True, exist_ok=True)
    art, tiles = {}, []
    for kind in FRIENDS:
        im = Image.open(DL / f'toycatch_{kind}.png').convert('RGBA')
        a = np.asarray(im)[..., 3]
        ys, xs = np.nonzero(a > 8)
        im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        if im.height > MAX_H:
            im = im.resize((round(im.width * MAX_H / im.height), MAX_H), Image.LANCZOS)
        head = HEAD_FIX.get(kind) or head_of(np.asarray(im)[..., 3])
        im = bleed(im)
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=88, method=6, exact=True)
        (OUT / 'friends' / f'{kind}.webp').write_bytes(buf.getvalue())
        art[kind] = {'w': im.width, 'h': im.height, 'head': head,
                     'src': 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()}
        print(f'{kind:7s} {im.size}  {len(buf.getvalue()) // 1024:3d} KB  head {head}{"  (fixed)" if kind in HEAD_FIX else ""}')
        if check:
            t = Image.new('RGB', im.size, (120, 130, 150))
            t.paste(im, (0, 0), im)
            d = ImageDraw.Draw(t)
            u, v, rx, ry = head
            cx, cy, w2, h2 = u * im.width, v * im.height, rx * im.width, ry * im.height
            d.ellipse((cx - w2, cy - h2, cx + w2, cy + h2), outline=(255, 40, 40), width=4)
            d.line((0, cy + h2, im.width, cy + h2), fill=(255, 220, 0), width=2)
            tiles.append(t)
    js = ('/* generated by tools/import_art.py --friends — do not edit: the friends\' pictures (webp data URLs, so WebGL\n'
          '   can use them from file://), their size and the head the claw closes round: [u, v, rx, ry] as fractions of\n'
          '   the picture (u, rx of its width; v, ry of its height from the top) */\nwindow.CLAW_FRIENDS = '
          + json.dumps(art) + ';\n')
    (ROOT / 'js' / 'friends-art.js').write_text(js, encoding='utf-8')
    print('→ js/friends-art.js', len(js) // 1024, 'KB')
    if check:
        cw = 300
        sheet = Image.new('RGB', (cw * 5, cw * 2), 'white')
        for i, t in enumerate(tiles):
            t.thumbnail((cw - 8, cw - 8))
            sheet.paste(t, ((i % 5) * cw + (cw - t.width) // 2, (i // 5) * cw + (cw - t.height) // 2))
        sheet.save(check)
        print('check →', check)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--bg')
    ap.add_argument('--logo')
    ap.add_argument('--friends', action='store_true')
    ap.add_argument('--check')
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if not a.bg and not a.logo and not a.friends:
        a.bg, a.logo, a.friends = 'toycatch_bg.png', 'toycatch_logo.png', True
    if a.bg:
        bg(a.bg)
    if a.logo:
        logo(a.logo)
    if a.friends:
        friends(a.check)
