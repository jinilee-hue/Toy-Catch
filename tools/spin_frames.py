"""Toy Catch — a friend's 360° turntable (user: "gif가 가장 깔끔한데") packed for the game: the frames of one rendered
model turning (design/turntable/<kind>/fNN.png, 15° apart, f13 = the front, f01 = the back, on white) cut out (white
background -> alpha, the edge colours bled outward so no white rim), cropped to one box shared by every frame (the
turn's axis stays put), scaled to CELL px tall and laid out 6 x 4 in one webp atlas. The game (js/friends.js) shows,
for the angle the friend is seen from, the two nearest frames cross-faded on a card turned to the camera — exactly
the turntable's own pictures, from every side.

Frame placement against the game picture (assets/img/friends/<kind>.webp, which the claw, the head ellipse and the
invisible 3D body still follow): the front frame's outline box is fitted to the picture's — same height, same bottom,
same middle — which fixes the scale and the turn's axis for every frame.

usage:  python3 tools/spin_frames.py monkey [more kinds]       (writes js/friends-spin.js, keeps the other friends)
"""
import base64
import io
import json
import os
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'design', 'turntable')
OUT = os.path.join(ROOT, 'js', 'friends-spin.js')
PX = 1.3 / 600                       # friends.js: a 600-px-tall picture is 1.3 units tall
FRONT, STEP, COLS, CELL = 13, 15.0, 6, 440


def cut(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    bg = (a.min(-1) > 0.94) & (a.max(-1) - a.min(-1) < 0.04)
    m = ndi.binary_opening(~bg, iterations=1)
    lab, n = ndi.label(m)
    if n > 1:
        m = lab == 1 + int(np.argmax(ndi.sum(m, lab, range(1, n + 1))))
    m = ndi.binary_fill_holes(m)
    # colours bled past the edge (the anti-aliased rim is mixed with the white: replaced by the inside's colours)
    core = ndi.binary_erosion(m, iterations=2)
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    rgb = a[iy, ix]
    al = ndi.gaussian_filter(m.astype(np.float32), 0.8)
    return rgb, np.clip(al, 0, 1), m


def find_eyes(rgb, m, i):
    """the painted eyes in a frame (the game paints its own eyes with whites over them, js/eyes.js paintAt): grey-dark
    compact upright ovals on a light face — a ring round them mostly light (the dark inside of an ear is on brown fur).
    Returns [cx, cy, rx, ry, tilt deg, sx] in frame px; sx: the drawing's +x toward the nose"""
    ys, xs = np.nonzero(m)
    top, H = ys.min(), ys.max() - ys.min()
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    dark = m & (lum < 0.36) & (rgb.max(-1) - rgb.min(-1) < 0.16)
    dark = ndi.binary_fill_holes(ndi.binary_closing(dark, iterations=2))
    lab, n = ndi.label(dark)
    eyes = []
    for j, sl in enumerate(ndi.find_objects(lab)):
        if sl is None:
            continue
        r = lab[sl] == j + 1
        area, (hh, ww) = r.sum(), r.shape
        cy = sl[0].start + hh / 2
        if not (0.0004 * H * H < area < 0.006 * H * H) or not (top + 0.12 * H < cy < top + 0.5 * H):
            continue
        if area < 0.55 * hh * ww or hh < 0.9 * ww:
            continue
        blob = np.zeros_like(m); blob[sl] = r
        ring = ndi.binary_dilation(blob, iterations=max(3, int(0.4 * hh))) & ~ndi.binary_dilation(blob, iterations=2) & m
        if ring.sum() < 20 or np.median(lum[ring]) < 0.55:
            continue
        yy, xx = np.nonzero(blob)
        mx, my = xx.mean(), yy.mean()
        # (upright, axis-aligned: the painted eyes are near-round ovals, the covariance's axis direction flipped
        # between them — one came out a wide tilted ellipse, a smaller eye)
        rx, ry, tilt = 2 * xx.std(), 2 * yy.std(), 0.0
        eyes.append([float(mx), float(my), float(rx), float(ry), float(tilt)])
    eyes.sort(key=lambda e: e[0])
    for k, e in enumerate(eyes):
        if len(eyes) == 2:
            e.append(1 if k == 0 else -1)
        else:
            e.append(-1 if i < FRONT else 1)
    return eyes


def pack(kind):
    d = os.path.join(SRC, kind)
    fs = sorted(f for f in os.listdir(d) if re.match(r'f\d\d\.png$', f))
    frames = [cut(os.path.join(d, f)) for f in fs]
    raw = [np.asarray(Image.open(os.path.join(d, f)).convert('RGB')).astype(np.float32) / 255 for f in fs]
    eyes = [find_eyes(raw[i], frames[i][2], int(fs[i][1:3])) for i in range(len(fs))]
    # one pair of eyes all round: the same height in every frame (turning doesn't change it), and seen from the
    # front (within one step) the same size both — a slightly lighter painted eye came out smaller
    fr = [fe for i, fe in enumerate(eyes) if abs(int(fs[i][1:3]) - FRONT) <= 1 and len(fe) == 2]
    if fr:
        RY = max(e[3] for fe in fr for e in fe); RX = max(e[2] for fe in fr for e in fe)
        for i, fe in enumerate(eyes):
            for e in fe:
                e[3] = RY
                e[2] = RX if abs(int(fs[i][1:3]) - FRONT) <= 1 else min(RX, e[2] * 1.06)
    n = len(frames)
    # one box round every frame (+ margin): the axis keeps its column in all of them
    ys, xs = np.nonzero(np.any([m for _, _, m in frames], 0))
    y0, y1, x0, x1 = ys.min() - 6, ys.max() + 7, xs.min() - 6, xs.max() + 7
    bh, bw = y1 - y0, x1 - x0
    k = CELL / bh
    cw, ch = int(round(bw * k)), CELL
    rows = (n + COLS - 1) // COLS
    atlas = np.zeros((rows * ch, COLS * cw, 4), np.uint8)
    for i, (rgb, al, _) in enumerate(frames):
        im = np.concatenate([rgb, al[..., None]], -1)[y0:y1, x0:x1]
        im = Image.fromarray((im * 255 + 0.5).astype(np.uint8), 'RGBA').resize((cw, ch), Image.LANCZOS)
        r, c = divmod(i, COLS)
        atlas[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] = np.asarray(im)
    # the front frame on the game picture: same height, bottom and middle
    fm = frames[FRONT - 1][2][y0:y1, x0:x1]
    fy, fx = np.nonzero(fm)
    pic = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp')).convert('RGBA'))[..., 3] > 128
    py, pxs = np.nonzero(pic)
    art = json.loads(re.search(r'=\s*(\{.*\});?\s*$', open(os.path.join(ROOT, 'js', 'friends-art.js')).read(), re.S).group(1))[kind]
    W, H = art['w'], art['h']
    w, h, u = W * PX, H * PX, art['head'][0]
    s = (py.max() - py.min() + 1) * PX / (fy.max() - fy.min() + 1)        # world units per box px
    pic_mid = ((pxs.min() + pxs.max() + 1) / 2 / W - u) * w                  # (friends.js: x = (uv.x - u) * w)
    pic_bot = (H - (py.max() + 1)) * PX                                       # (y up from the picture's bottom)
    box_mid = (fx.min() + fx.max() + 1) / 2
    axis = box_mid - pic_mid / s                                              # the axis' column in the box
    bottom = (fy.max() + 1) + pic_bot / s                                     # the row of y = 0 in the box
    buf = io.BytesIO()
    Image.fromarray(atlas, 'RGBA').save(buf, 'WEBP', quality=88, method=6)
    url = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
    print(f'{kind}: {n} frames, cell {cw}x{ch}, atlas {COLS * cw}x{rows * ch}, {len(buf.getvalue()) // 1024} KB, '
          f'scale {s:.5f}/px, axis {axis:.1f}, bottom {bottom:.1f} (box {bw}x{bh})')
    eyes_c = [[[round((e[0] - x0) / bw, 4), round((e[1] - y0) / bh, 4), round(e[2] / bw, 4), round(e[3] / bh, 4),
                round(e[4], 1), e[5]] for e in fe] for fe in eyes]
    print('  eyes per frame:', [len(fe) for fe in eyes])
    return {'n': n, 'cols': COLS, 'rows': rows, 'front': FRONT - 1, 'step': STEP, 'eyes': eyes_c,
            'w': round(bw * s, 5), 'h': round(bh * s, 5),                  # the card, world units
            'ax': round(axis / bw, 5), 'by': round(bottom / bh, 5),         # axis / ground in card fractions
            'src': url}


def main():
    data = {}
    if os.path.exists(OUT):
        mt = re.search(r'=\s*(\{.*\});?\s*$', open(OUT, encoding='utf-8').read(), re.S)
        if mt:
            data = json.loads(mt.group(1))
    for kind in sys.argv[1:]:
        data[kind] = pack(kind)
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('/* generated by tools/spin_frames.py — do not edit: the friends\' 360° turntables (design/turntable,\n'
                 '   one rendered model turning, 15° a frame) as webp atlases; js/friends.js shows the frame for the angle\n'
                 '   the friend is seen from. Per friend: n frames, cols x rows cells, front (index of the face-on frame),\n'
                 '   step (deg), w/h (the card, world units), ax/by (the turn axis / the ground in card fractions), eyes (per frame:\n'
                 '   the painted eyes [cx, cy, rx, ry, tilt, nose side] in cell fractions — the game paints new ones there), src. */\n')
        fh.write('window.CLAW_FRIENDS_SPIN = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
