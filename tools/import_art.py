"""Toy Catch — import the user's art from ~/Downloads (only the files named here; ~/Downloads also holds personal
photos, so never browse it).

  uv run --with pillow --with numpy --with scipy python tools/import_art.py    # everything, default names below
  uv run --with pillow --with numpy python tools/import_art.py --bg toycatch_bg.png
  uv run --with pillow --with numpy python tools/import_art.py --logo toycatch_logo.png
  uv run --with pillow --with numpy --with scipy python tools/import_art.py --friends   # toycatch_<kind>.png × 10
  ... --friends --check out.png                                                 # + the head boxes drawn on each friend

  --bg       → assets/img/bg.webp     the carnival behind the 3D machine (its middle is empty), kept at 2752×1536, q90
  --logo     → assets/img/logo.webp   trimmed to its alpha box, ≤ 1400 px wide, q92 (alpha kept)
  --notes    → assets/img/notes/<name>.webp  the logo's own music notes, cut out of toycatch_logo.png (each = the biggest
               piece of the logo lying inside the note's box, + 5 px), for the notes floating round the machine on the intro
  ... --friends --only duck                                                      # just these; the others are kept
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
FRIENDS = ['monkey', 'mouse', 'ant', 'seal', 'turkey', 'turtle', 'cat', 'cow', 'dog', 'fish', 'duck']
# friends with no drawn game picture: cut from their character sheet by tools/sheet_front.py (not from ~/Downloads)
SRC = {'duck': ROOT / 'design' / 'art' / 'duck_front.png'}
# --spin: the friends redrawn as 360° turntables (user, 2026-11-19: design/turntable/<kind>.gif, frames in
# design/turntable/<kind>/fNN.png, f13 = the front): their game picture is the turntable's front frame
SPIN_SRC = ROOT / 'design' / 'turntable'
# heads of the turntable friends where the measurement can't work (the fish is side-on; the turkey's fan is wider than
# its head; the seal's head and body are one shape)
SPIN_HEAD_FIX = {
    'seal': (0.5, 0.22, 0.3, 0.22),        # (the head above the shirt's collar)
    'turkey': (0.5, 0.2, 0.19, 0.13),      # (the head, not the fan behind it)
    'turtle': (0.5, 0.21, 0.36, 0.21),     # (the head above the shell)
    'fish': (0.42, 0.45, 0.33, 0.36),      # (side-on: held round its back)
}
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


# the box (x0, y0, x1, y1) round each note in toycatch_logo.png (2027 × 1212)
NOTES = {'beamed-blue': (1580, 325, 1785, 500), 'pink': (0, 675, 110, 865), 'red': (200, 115, 330, 310), 'blue': (365, 330, 465, 515)}


def notes(name='toycatch_logo.png'):
    from scipy import ndimage
    a = np.asarray(Image.open(DL / name).convert('RGBA'))
    lab, n = ndimage.label(a[..., 3] > 40)
    objs = ndimage.find_objects(lab)
    (OUT / 'notes').mkdir(parents=True, exist_ok=True)
    for key, (x0, y0, x1, y1) in NOTES.items():
        inside = [i + 1 for i, sl in enumerate(objs)
                  if sl[1].start >= x0 and sl[1].stop <= x1 and sl[0].start >= y0 and sl[0].stop <= y1]
        assert inside, f'no note inside the {key} box: the logo changed — re-measure NOTES'
        cid = max(inside, key=lambda i: (lab[objs[i - 1]] == i).sum())
        keep = ndimage.binary_dilation(lab == cid, iterations=5)
        c = a.copy()
        c[..., 3] = np.where(keep, c[..., 3], 0)
        im = Image.fromarray(c, 'RGBA')
        im = im.crop(im.getbbox())
        if im.height > 220:
            im = im.resize((round(im.width * 220 / im.height), 220), Image.LANCZOS)
        im.save(OUT / 'notes' / f'{key}.webp', 'WEBP', quality=90, method=6)
        print(f'note {key:12s} {im.size}  aspect {im.width / im.height:.3f}')


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


def friends(check=None, only=None, spin=False):
    (OUT / 'friends').mkdir(parents=True, exist_ok=True)
    art, tiles = {}, []
    if only:                                             # keep the friends not imported this time
        s = (ROOT / 'js' / 'friends-art.js').read_text(encoding='utf-8')
        art = json.loads(s[s.index('{'):s.rindex('}') + 1])
    for kind in FRIENDS:
        if only and kind not in only:
            continue
        sp = SPIN_SRC / kind / 'f13.png'
        im = Image.open(sp if spin and sp.exists() else SRC.get(kind) or DL / f'toycatch_{kind}.png').convert('RGBA')
        a = np.asarray(im)[..., 3]
        ys, xs = np.nonzero(a > 8)
        im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        if im.height > MAX_H:
            im = im.resize((round(im.width * MAX_H / im.height), MAX_H), Image.LANCZOS)
        if spin and sp.exists():
            head = SPIN_HEAD_FIX.get(kind) or head_of(np.asarray(im)[..., 3])
        else:
            head = HEAD_FIX.get(kind) or head_of(np.asarray(im)[..., 3])
        im = bleed(im)
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=88, method=6, exact=True)
        (OUT / 'friends' / f'{kind}.webp').write_bytes(buf.getvalue())
        art[kind] = {'w': im.width, 'h': im.height, 'head': head,
                     'src': 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()}
        fx = SPIN_HEAD_FIX if spin and sp.exists() else HEAD_FIX
        print(f'{kind:7s} {im.size}  {len(buf.getvalue()) // 1024:3d} KB  head {head}{"  (fixed)" if kind in fx else ""}')
        if check:
            t = Image.new('RGB', im.size, (120, 130, 150))
            t.paste(im, (0, 0), im)
            d = ImageDraw.Draw(t)
            u, v, rx, ry = head
            cx, cy, w2, h2 = u * im.width, v * im.height, rx * im.width, ry * im.height
            d.ellipse((cx - w2, cy - h2, cx + w2, cy + h2), outline=(255, 40, 40), width=4)
            d.line((0, cy + h2, im.width, cy + h2), fill=(255, 220, 0), width=2)
            tiles.append(t)
    art = {k: art[k] for k in FRIENDS if k in art}
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
    ap.add_argument('--notes', action='store_true')
    ap.add_argument('--check')
    ap.add_argument('--only', default='')
    ap.add_argument('--spin', action='store_true', help='turntable friends: the front frame is the picture')
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if not a.bg and not a.logo and not a.friends and not a.notes:
        a.bg, a.logo, a.friends, a.notes = 'toycatch_bg.png', 'toycatch_logo.png', True, True
    if a.bg:
        bg(a.bg)
    if a.logo:
        logo(a.logo)
    if a.notes:
        notes()
    if a.friends:
        friends(a.check, [k for k in a.only.split(',') if k], a.spin)
