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
    a4 = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255
    a = a4[..., :3]
    if a4[..., 3].min() < 0.5:
        # (frames with alpha: the friend is what is opaque — the gaps between an arm, the body and the tail stay open;
        # filled, they showed as white patches)
        m = ndi.binary_opening(a4[..., 3] > 0.5, iterations=1)
        lab, n = ndi.label(m)
        if n > 1:
            sz = ndi.sum(m, lab, range(1, n + 1))
            m = np.isin(lab, 1 + np.nonzero(sz >= 0.002 * sz.max())[0])
        al_src = a4[..., 3]
    else:
        bg = (a.min(-1) > 0.94) & (a.max(-1) - a.min(-1) < 0.04)
        m = ndi.binary_opening(~bg, iterations=1)
        lab, n = ndi.label(m)
        if n > 1:
            m = lab == 1 + int(np.argmax(ndi.sum(m, lab, range(1, n + 1))))
        m = ndi.binary_fill_holes(m)
        al_src = None
    # colours bled past the edge (the anti-aliased rim is mixed with the white: replaced by the inside's colours)
    core = ndi.binary_erosion(m, iterations=2)
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    rgb = a[iy, ix]
    al = ndi.gaussian_filter(m.astype(np.float32), 0.8) if al_src is None else al_src * m
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


# the signature pose's moving limb (js/poses.js BONES), cut out of the front frame as a layer of its own: the game turns
# it about its joint while the friend does its pose (the monkey waves), the rest of the front frame with the limb
# taken off underneath
POSE_LIMB = {'monkey': 'arm_r'}
EYES_PAINT = ()                      # (kinds whose frames get the game's eyes)
LIMB_IN = 0.05                       # (how far past the limb's top, x box height, its joint sits under the shirt)


def limb_layers(kind, rgb, al, m, x0, y0, bw, bh, s, axis, bottom):
    """(body RGBA, limb RGBA, pivot (x, y) in box px) for the front frame, or None"""
    import cv2
    name = POSE_LIMB.get(kind)
    pj_path = os.path.join(ROOT, 'design', 'parts', 'parts.json')
    if not name or not os.path.exists(pj_path):
        return None
    pj = json.load(open(pj_path))[kind]
    part = [q for q in pj['parts'] if q['name'] == name][0]
    lab = np.asarray(Image.open(os.path.join(ROOT, 'design', 'parts', f'{kind}.png')))
    art = json.loads(re.search(r'=\s*(\{.*\});?\s*$', open(os.path.join(ROOT, 'js', 'friends-art.js')).read(), re.S).group(1))[kind]
    W, H, u = art['w'], art['h'], art['head'][0]
    w = W * PX
    rgb, al, m = rgb[y0:y0 + bh, x0:x0 + bw], al[y0:y0 + bh, x0:x0 + bw], m[y0:y0 + bh, x0:x0 + bw]
    mpath = os.path.join(SRC, kind, f'limb_{name}.png')         # (SAM 2 on the front frame: tools/turntable_limb.py)
    if not os.path.exists(mpath):
        return None
    limb = np.asarray(Image.open(mpath).convert('L'))[y0:y0 + bh, x0:x0 + bw] > 127
    limb &= m
    # the body: the frame without the limb (it hangs beside the body: what was behind it is background). The limb
    # layer is drawn just behind the body, so turning up it comes out of the sleeve
    gone = ndi.binary_dilation(limb, iterations=4)       # (its soft rim and the paw's last pixels too)
    brgb, bal = rgb, np.where(gone, 0.0, al)
    # what the limb hid (the tail passing behind the new monkey's paw, the body's edge): where the rest closes over the
    # gap, filled from round it — else raising the arm cut the tail in two
    rr0 = max(3, int(0.05 * bh))
    yd0, xd0 = np.mgrid[-rr0:rr0 + 1, -rr0:rr0 + 1]
    rest0 = m & ~gone
    # (only thin parts are bridged — the tail's two ends either side of the paw; the body is thick and stays out, else
    # the whole arm's place was filled with a smear)
    rt = max(3, int(0.025 * bh))
    ydt, xdt = np.mgrid[-rt:rt + 1, -rt:rt + 1]
    thin = rest0 & ~ndi.binary_opening(rest0, structure=(xdt * xdt + ydt * ydt) <= rt * rt)
    gy_ = np.nonzero(gone.any(1))[0]
    thin[:gy_.min() + int(0.55 * (gy_.max() - gy_.min()))] = False   # (the paw's end only: the sleeve's edge is up top)
    closed = ndi.binary_closing(thin, structure=(xd0 * xd0 + yd0 * yd0) <= rr0 * rr0, iterations=1)
    hole = closed & gone
    if hole.any():
        _, (iyt, ixt) = ndi.distance_transform_edt(~(thin & ~gone), return_indices=True)
        fillc = (np.clip(rgb[iyt, ixt], 0, 1) * 255).astype(np.uint8)          # (the tail's own nearest fur)
        fillc = np.stack([ndi.gaussian_filter(fillc[..., c_].astype(np.float32), 2.0) for c_ in range(3)], -1)
        brgb = np.where(hole[..., None], fillc.astype(np.float32) / 255, rgb)
        bal = np.where(hole, ndi.gaussian_filter(closed.astype(np.float32), 0.8), bal)
    # (stray slivers left round the cut: off)
    keep_b = ndi.binary_opening(bal > 0.5, iterations=2) | ~ndi.binary_dilation(gone, iterations=3)
    bal = np.where(keep_b, bal, 0.0)
    # its joint: the limb's top end (along its long axis, the end that is higher — the paw hangs low), then on in
    # under the shirt to the shoulder. The limb is carried on up to there as a rounded stump of its own fur (the cut
    # where SAM parted it from the sleeve was a straight edge: raised, it looked chopped off) and drawn BEHIND the
    # body, so the shirt hides the root and the arm comes out from under the sleeve
    ly, lx = np.nonzero(limb)
    c0 = np.array([lx.mean(), ly.mean()])
    ev, evec = np.linalg.eigh(np.cov(np.stack([lx - c0[0], ly - c0[1]])))
    ax_ = evec[:, 1]
    if ax_[1] > 0:
        ax_ = -ax_                                     # (pointing up the arm)
    t = (lx - c0[0]) * ax_[0] + (ly - c0[1]) * ax_[1]
    t_top, t_bot = np.percentile(t, 99), np.percentile(t, 1)
    half = limb.sum() / max(1.0, t_top - t_bot) / 2   # (half its width)
    top = c0 + ax_ * (t_top - half)
    pivot = c0 + ax_ * (t_top + LIMB_IN * bh)
    yy, xx = np.mgrid[0:bh, 0:bw]
    # the capsule from the limb's top to the joint, as wide as the limb
    P = np.stack([xx - top[0], yy - top[1]], -1)
    seg = pivot - top
    tt = np.clip((P @ seg) / max(1e-6, seg @ seg), 0, 1)
    d = np.hypot(P[..., 0] - tt * seg[0], P[..., 1] - tt * seg[1])
    stump = (d < half * 0.95) & ~limb
    ext = limb | stump
    # (rounded where the stump meets the limb: the cut's corners showed as a step under the raised arm)
    rr_ = max(3, int(half * 0.45))
    yd, xd = np.mgrid[-rr_:rr_ + 1, -rr_:rr_ + 1]
    disk = (xd * xd + yd * yd) <= rr_ * rr_
    ext = ndi.binary_opening(ndi.binary_closing(ext, structure=disk), structure=disk) | ndi.binary_erosion(limb, iterations=2)
    keep = ndi.binary_erosion(limb, iterations=3)
    # (the stump's colours: the limb's own fur, the nearest of it, softened — an inpaint pulled black in from outside)
    _, (iy, ix) = ndi.distance_transform_edt(~keep, return_indices=True)
    near_c = rgb[iy, ix]
    soft = np.stack([ndi.gaussian_filter(near_c[..., c], 2.0) for c in range(3)], -1)
    lrgb = np.where((ext & ~keep)[..., None], soft, rgb)
    lal = ndi.gaussian_filter(ext.astype(np.float32), 0.7)
    # the sleeve over the limb's root (the shirt round the shoulder: drawn in front of the raised limb, which is drawn
    # in front of the rest — so the limb comes out of the sleeve and passes in front of the tail)
    hsv = cv2.cvtColor((np.clip(rgb, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.int32)
    red = ((hsv[..., 0] <= 6) | (hsv[..., 0] >= 172)) & (hsv[..., 1] > 150) & (hsv[..., 2] > 120) & m & ~gone   # (the shirt's red, not the dark fur under the chin)
    # (the whole shirt — its own outline is the seam: a cut across it showed as a faint circle)
    lab_r, n_r = ndi.label(ndi.binary_opening(red, iterations=1))
    near_id = lab_r[int(np.clip(pivot[1], 0, bh - 1)), int(np.clip(pivot[0] - 0.03 * bh, 0, bw - 1))]
    sleeve = lab_r == near_id if near_id else ndi.binary_opening(red, iterations=1)
    sal = ndi.gaussian_filter(sleeve.astype(np.float32), 0.7) * (bal > 0.5)
    print(f'  pose layer {name}: {limb.sum()} px (+ stump {stump.sum()} px), sleeve {sleeve.sum()} px, pivot {pivot[0]:.0f},{pivot[1]:.0f}')
    return (np.concatenate([brgb, np.clip(bal, 0, 1)[..., None]], -1),
            np.concatenate([lrgb, np.clip(lal, 0, 1)[..., None]], -1), tuple(pivot),
            np.concatenate([brgb, np.clip(sal, 0, 1)[..., None]], -1))


def webp_url(rgba, size):
    im = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').resize(size, Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=88, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


# the signature poses as a WARP of the front frame (user: "원숭이처럼 옷이랑 같이 팔이 안움직이고 팔만 움직이는 형태로는
# 자연스럽지가 않아"): every part (SAM 2 masks, tools/turntable_parts.py -> design/turntable/<kind>/part_<n>.png) turns
# about its joint, and round the joint the friend's own surface (a sleeve, the neck, the base of an ear) bends with it
# over a short ramp — so a sleeve lifts with the arm instead of the arm sliding out of it. Where a part only lies against
# the body (an arm down the side), the two separate (the game drops the stretched triangles there). Keys: n part, di
# the js/poses.js DATA part that drives it (its angle a, move t, scale s), j joint (front-frame px), g gain on the angle,
# z +1 in front / -1 behind, parent (a child moves with its parent too), above (the part = everything above that row:
# a head with its ears), rigid (no ramp: a fan behind the body), f (mask file stem), bridge (thin parts behind it — a
# tail behind the paw — are joined up underneath)
WARP = {
    'monkey': [dict(n='arm_r', di=0, j=(898, 848), g=1.45, z=1, f='limb_arm_r', bridge=True),
               dict(n='ear_r', di=1, j=(948, 630), g=1.6, sewn=True)],
    'mouse': [dict(n='ear_l', di=0, j=(645, 545), g=1.5, sewn=True), dict(n='ear_r', di=1, j=(878, 545), g=1.5, sewn=True),
              dict(n='tail', di=2, j=(890, 1035), z=-1, g=1.3)],
    'ant': [dict(n='antenna_l', di=0, j=(688, 445), parent='hat', g=1.2, sewn=True),
            dict(n='antenna_r', di=1, j=(858, 445), parent='hat', g=1.2, sewn=True),
            dict(n='hat', di=2, j=(775, 605), g=1.4, sewn=True)],
    # (user: "seal도 팔 움직일때 옷이 잘려서 보였다 안보였다": the flippers turn BEHIND the sleeves, their roots carried on
    # under them — the shirt stays as it is)
    'seal': [dict(n='flipper_l', di=0, j=(548, 922), g=1.25, z=-1, noring=True, tuck=0.035),
             dict(n='flipper_r', di=1, j=(1022, 922), g=1.25, z=-1, noring=True, tuck=0.035)],
    'turkey': [dict(n='fan_l', di=0, j=(600, 800), box=(380, 598, 560, 1010), minus=('wing_l',), sewn=True, g=1.6),
               dict(n='fan_r', di=1, j=(936, 800), box=(938, 1160, 560, 1010), minus=('wing_r',), sewn=True, g=1.6),
               dict(n='wing_l', di=2, j=(628, 845), z=1, g=1.2, nohue=(118, 165), fillr=0.03),
               dict(n='wing_r', di=3, j=(888, 845), z=1, g=1.2, nohue=(118, 165), fillr=0.03)],
    # (user: "등껍질은 두고 팔만 흔들어야지": the arms alone, in front, the shell left as it is — filled in behind them)
    'turtle': [dict(n='arm_l', di=1, j=(655, 765), g=1.3, z=1, noring=True, fillr=0.07, tuck=0.03),
               dict(n='arm_r', di=2, j=(880, 765), g=1.3, z=1, noring=True, fillr=0.07, tuck=0.03)],
    'cat': [dict(n='arm_r', di=0, j=(932, 885), z=1), dict(n='ear_l', di=1, j=(612, 512), g=1.5, sewn=True),
            dict(n='ear_r', di=2, j=(898, 512), g=1.5, sewn=True)],
    'cow': [dict(n='ear_l', di=0, j=(603, 522), g=1.3, sewn=True), dict(n='ear_r', di=1, j=(902, 522), g=1.3, sewn=True),
            dict(n='head', di=2, j=(762, 772), above=772, g=1.6)],
    'dog': [dict(n='ear_l', di=0, j=(592, 455), g=1.3, sewn=True), dict(n='ear_r', di=1, j=(908, 455), g=1.3, sewn=True),
            dict(n='head', di=2, j=(768, 770), above=770, g=1.2)],
    'duck': [dict(n='wing_l', di=0, j=(640, 878), g=1.3), dict(n='wing_r', di=1, j=(895, 878), g=1.3)],
    'fish': [dict(n='tail_fin', di=0, j=(1015, 800), g=0.9, sewn=True), dict(n='top_fin', di=1, j=(770, 655), g=1.6, sewn=True)],
}


def warp_layers(kind, rgb, al, m, x0, y0, bw, bh, cw, ch):
    """{front, base, wt, parts} for the card's pose warp, or None"""
    cfg = WARP.get(kind)
    if not cfg:
        return None
    rgb, al, m = rgb[y0:y0 + bh, x0:x0 + bw], al[y0:y0 + bh, x0:x0 + bw], m[y0:y0 + bh, x0:x0 + bw]
    yy, xx = np.mgrid[0:bh, 0:bw].astype(np.float32)
    masks = {}
    for q in cfg:
        if q.get('above'):
            M = m & (yy < q['above'] - y0)
        elif q.get('box'):                              # (a region of the frame: the turkey's fan halves)
            bx0, bx1, by0, by1 = q['box']
            M = m & (xx >= bx0 - x0) & (xx < bx1 - x0) & (yy >= by0 - y0) & (yy < by1 - y0)
            for o_ in q.get('minus', ()):
                pth = os.path.join(SRC, kind, f'part_{o_}.png')
                if os.path.exists(pth):
                    M &= ~ndi.binary_dilation(np.asarray(Image.open(pth).convert('L'))[y0:y0 + bh, x0:x0 + bw] > 127, iterations=3)
            M = ndi.binary_opening(M, iterations=2)
            lbb, nlb = ndi.label(M)                     # (the fan itself, not a feather tip cut off below the wing)
            if nlb > 1:
                M = lbb == 1 + int(np.argmax(ndi.sum(M, lbb, range(1, nlb + 1))))
        else:
            path = os.path.join(SRC, kind, (q.get('f') or f'part_{q["n"]}') + '.png')
            if not os.path.exists(path):
                print(f'  warp: no mask for {q["n"]}'); continue
            M = np.asarray(Image.open(path).convert('L'))[y0:y0 + bh, x0:x0 + bw] > 127
            M = ndi.binary_fill_holes(ndi.binary_closing(M, iterations=6 if q.get('rigid') else 2)) & m
            if q.get('nohue'):                          # (the fan's purple feathers behind the turkey's wings: not the wing)
                import cv2
                hsv = cv2.cvtColor((np.clip(rgb, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
                h0, h1 = q['nohue']
                M &= ~((hsv[..., 0] >= h0) & (hsv[..., 0] <= h1) & (hsv[..., 1] > 50))
            M = ndi.binary_opening(M, iterations=2)
            lbm, nlm = ndi.label(M)
            if nlm > 1:
                M = lbm == 1 + int(np.argmax(ndi.sum(M, lbm, range(1, nlm + 1))))
            # (the part's own soft rim on the outline — SAM's mask stops a few px short of it: left behind, it was a
            # pale ghost crescent round a moving ear)
            M |= m & ndi.binary_dilation(M, iterations=5) & ndi.binary_dilation(~m, iterations=5)
            lb, nl = ndi.label(M)
            if nl > 1:
                sz = ndi.sum(M, lb, range(1, nl + 1)); M = np.isin(lb, 1 + np.nonzero(sz >= 0.15 * sz.max())[0])
        masks[q['n']] = M
    # (little bits of the frame left between a part and the outline — the fan's purple tips under the turkey's wings —
    # go with the part next to them: left still, they floated off as specks when it moved)
    allp = np.zeros_like(m)
    for M_ in masks.values():
        allp |= M_
    lb_, nl_ = ndi.label(m & ~allp)
    if nl_ > 1:
        sz_ = ndi.sum(m & ~allp, lb_, range(1, nl_ + 1))
        for j_ in np.nonzero(sz_ < 0.004 * m.sum())[0]:
            isl = lb_ == j_ + 1
            ring_ = ndi.binary_dilation(isl, iterations=3)
            best, bo = None, 0
            for nm_, M_ in masks.items():
                ov_ = (ring_ & M_).sum()
                if ov_ > bo:
                    best, bo = nm_, ov_
            if best is not None:
                masks[best] = masks[best] | isl
    for q in cfg:                                       # (a child's pixels belong to its parent too)
        if q.get('parent') and q['n'] in masks and q['parent'] in masks:
            masks[q['parent']] = masks[q['parent']] | masks[q['n']]
    W = np.zeros((bh, bw, 4), np.float32)
    parts, removed = [], np.zeros_like(m)
    mrgb = rgb.copy()                                   # (the warp mesh's texture: + the hidden bits of behind-parts)
    for q in cfg:
        if q.get('tuck') and q['n'] in masks:
            M0 = masks[q['n']]
            J = np.array([q['j'][0] - x0, q['j'][1] - y0], np.float32)
            rt_ = int(q['tuck'] * bh)
            ext = ndi.binary_dilation(M0, iterations=rt_) & ~M0 & (np.hypot(xx - J[0], yy - J[1]) < 2.2 * rt_ + 0.02 * bh)
            ext = ndi.binary_opening(ext | M0, iterations=max(2, rt_ // 3)) & ~M0
            if ext.any():
                _, (iy, ix) = ndi.distance_transform_edt(~ndi.binary_erosion(M0, iterations=2), return_indices=True)
                nc = rgb[iy, ix]
                nc = np.stack([ndi.gaussian_filter(nc[..., c_], 2.0) for c_ in range(3)], -1)
                mrgb = np.where(ext[..., None], nc, mrgb)
                masks[q['n'] + ':hid'] = masks.get(q['n'] + ':hid', np.zeros_like(m)) | ext
                masks[q['n']] = M0 | ext
    for q in cfg:
        if q.get('z', 0) < 0 and q['n'] in masks and not q.get('rigid') and not q.get('tuck'):
            M0 = masks[q['n']]
            rc = max(3, int(0.035 * bh))
            yd, xd = np.mgrid[-rc:rc + 1, -rc:rc + 1]
            add = ndi.binary_closing(M0, structure=(xd * xd + yd * yd) <= rc * rc) & ~M0 & m
            if add.any():
                _, (iy, ix) = ndi.distance_transform_edt(~M0, return_indices=True)
                mrgb = np.where(add[..., None], rgb[iy, ix], mrgb)
                masks[q['n'] + ':hid'] = add
                masks[q['n']] = M0 | add
    for i, q in enumerate([q for q in cfg if q['n'] in masks][:4]):
        M = masks[q['n']]
        J = np.array([q['j'][0] - x0, q['j'][1] - y0], np.float32)
        if q.get('above'):
            d = np.array([0.0, -1.0]); r = 0.03 * bh
            t = (xx - J[0]) * d[0] + (yy - J[1]) * d[1]
            lab = m & (t > -r)
            w = np.where(lab, np.clip((t + r) / (2 * r), 0, 1), 0)
        else:
            ys, xs = np.nonzero(M)
            c = np.array([xs.mean(), ys.mean()]); d = (c - J) / max(1e-6, np.linalg.norm(c - J))
            t = (xx - J[0]) * d[0] + (yy - J[1]) * d[1]
            L = max(1.0, np.percentile(t[M], 98))
            hw = M.sum() / L / 2
            if q.get('rigid'):
                lab, w = M, M.astype(np.float32)
            elif q.get('noring'):                       # (the part alone turns; nothing round it bends)
                r = max(6.0, min(0.6 * hw, 0.35 * L))
                ramp = np.clip((t + r) / (2 * r), 0, 1); ramp = ramp * ramp * (3 - 2 * ramp)
                lab, w = M, np.where(M, np.maximum(ramp, 0.85), 0)
            else:
                r = max(6.0, min(0.6 * hw, 0.35 * L))
                ramp = np.clip((t + r) / (2 * r), 0, 1); ramp = ramp * ramp * (3 - 2 * ramp)
                Rd = 1.4 * hw + r
                dist = np.hypot(xx - J[0], yy - J[1])
                fall = np.clip((Rd - dist) / (0.45 * Rd), 0, 1); fall = fall * fall * (3 - 2 * fall)
                ring = m & ~M & (dist < Rd) & (t > -r)
                w = np.where(M, ramp, np.where(ring, ramp * fall, 0))
                if q.get('sewn'):
                    # (sewn on along its whole edge — an ear on the head, a fin on the body: the surface next to it
                    # gives a little all along instead of tearing open there)
                    band = q.get('band', 0.045) * bh
                    dM = ndi.distance_transform_edt(~M)
                    f2 = np.clip(1 - dM / band, 0, 1); f2 = f2 * f2 * (3 - 2 * f2)
                    ring2 = m & ~M & (dM < band)
                    w = np.where(ring2 & ~M, np.maximum(w, np.clip((t + r) / (2 * r), 0, 1) * f2), w)
                    ring = ring | ring2
                lab = M | (ring & (w > 0.01))
        # (the see-through margin round the part moves with it: its outline stays whole instead of stretching out
        # into strands toward the still background)
        near_bg = ~m & (ndi.distance_transform_edt(~lab) < 0.015 * bh)
        if near_bg.any():
            _, (iy_, ix_) = ndi.distance_transform_edt(~lab, return_indices=True)
            w = np.where(near_bg, w[iy_, ix_], w)
            lab = lab | near_bg
        W[..., i] = np.where(lab, 0.1 + 0.9 * w, 0)
        removed |= M & ~masks.get(q['n'] + ':hid', np.zeros_like(M))
        if q.get('nohue'):
            # (the fan's purple tips peeking out under the wing: off the base while it flaps — left behind they were
            # loose purple specks beside the body)
            import cv2
            hsv_ = cv2.cvtColor((np.clip(rgb, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
            pur = (hsv_[..., 0] >= q['nohue'][0]) & (hsv_[..., 0] <= q['nohue'][1]) & (hsv_[..., 1] > 50) & m
            removed |= pur & ndi.binary_dilation(M, iterations=int(0.035 * bh)) & (yy > J[1])
        parts.append({'n': q['n'], 'di': q['di'], 'g': q.get('g', 1.0), 'z': q.get('z', 0), 'sewn': 1 if q.get('sewn') or q.get('above') else 0,
                      'j': [round(float(J[0]) / bw, 4), round(float(J[1]) / bh, 4)]})
        if q.get('bridge'):
            rt = max(3, int(0.025 * bh))
            yd, xd = np.mgrid[-rt:rt + 1, -rt:rt + 1]
            rest0 = m & ~M
            thin = rest0 & ~ndi.binary_opening(rest0, structure=(xd * xd + yd * yd) <= rt * rt)
            my = np.nonzero(M.any(1))[0]
            thin[:my.min() + int(0.55 * (my.max() - my.min()))] = False
            r0 = max(3, int(0.05 * bh)); yd, xd = np.mgrid[-r0:r0 + 1, -r0:r0 + 1]
            W[..., i] = W[..., i]                       # (bridge recorded below)
            q['_bridge'] = ndi.binary_closing(thin, structure=(xd * xd + yd * yd) <= r0 * r0) & ndi.binary_dilation(M, iterations=6)
    # the base underneath while posing: the frame without the moving parts; what they hid filled from round it
    removed = ndi.binary_dilation(removed, iterations=2) & m   # (no ghost outline left)
    rest = m & ~removed
    r1 = max(2, int(0.012 * bh))
    fill = ndi.binary_closing(rest, iterations=r1) & removed
    for q in cfg:
        if q.get('_bridge') is not None:
            fill |= q.pop('_bridge') & ~rest
        if q.get('fillr') and q['n'] in masks:          # (a part lying over the body: the body filled in behind it)
            rr2 = max(2, int(q['fillr'] * bh))
            ff = ndi.binary_closing(rest, iterations=rr2) & ndi.binary_dilation(masks[q['n']], iterations=3) & removed
            fill |= ff
            inp_ = inp_ | ff if 'inp_' in dir() else ff
    _, (iy, ix) = ndi.distance_transform_edt(~rest, return_indices=True)
    near = rgb[iy, ix]
    soft = np.stack([ndi.gaussian_filter(near[..., c], 2.0) for c in range(3)], -1)
    brgb = np.where(fill[..., None], soft, rgb)
    if 'inp_' in dir() and inp_.any():                 # (smooth fabric behind a part, not streaks)
        import cv2
        u8 = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
        pt = cv2.inpaint(u8, (ndi.binary_dilation(inp_, iterations=2) & ~rest | inp_).astype(np.uint8) * 255, 12, cv2.INPAINT_TELEA)
        brgb = np.where(inp_[..., None], pt.astype(np.float32) / 255, brgb)
    bal = np.where(rest, al, np.where(fill, 1.0, 0.0))
    hid = np.zeros_like(m)
    for k_, v_ in masks.items():
        if k_.endswith(':hid'):
            hid |= v_
    front = np.concatenate([mrgb, np.where(hid, 1.0, al)[..., None]], -1)
    base = np.concatenate([brgb, np.clip(bal, 0, 1)[..., None]], -1)
    wt = Image.fromarray((np.clip(W, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').resize((cw, ch), Image.NEAREST)
    buf = io.BytesIO(); wt.save(buf, 'PNG', optimize=True)
    print(f'  warp: {", ".join(p_["n"] for p_ in parts)}; base fill {int(fill.sum())} px')
    if os.environ.get('SPIN_DBG'):
        dbg = os.path.expanduser(f'~/.cache/agent-scratch/tc/warp_{kind}')
        Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8), 'RGBA').save(dbg + '_base.png')
        Image.fromarray((np.clip(W, 0, 1) * 255).astype(np.uint8), 'RGBA').save(dbg + '_w.png')
    return {'front': webp_url(front, (cw, ch)), 'base': webp_url(base, (cw, ch)),
            'wt': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode(), 'parts': parts}


MOTION = os.path.join(ROOT, 'design', 'from-front')


def motion_frames(kind, f13, x0, y0, bw, bh, s, axis, bottom):
    """the signature pose as drawn by the user (design/from-front/<kind>/motion/01..06.png, the front view acting,
    01 = at rest): the frames laid on the turntable's front frame — one scale and offset for all, found by fitting
    frame 01's outline onto the front frame's — so the pose starts exactly where the friend stands. Returns
    {n, cols, rows, w, h, ax, by, src} (its own card: raised arms and a popped hat reach past the turntable's box)"""
    d = os.path.join(MOTION, kind, 'motion')
    fs = sorted(f for f in os.listdir(d) if re.match(r'\d\d\.png$', f)) if os.path.isdir(d) else []
    if len(fs) < 2:
        return None
    mo = []
    for f in fs:
        rgb, al, m = cut(os.path.join(d, f))
        # (bits of the neighbouring drawing on the frame's edge — the strip was cut into frames: a tail tip from the
        # next pose stood beside the friend)
        lb, nl = ndi.label(m)
        if nl > 1:
            sz = ndi.sum(m, lb, range(1, nl + 1)); main = 1 + int(np.argmax(sz))
            edge = set(np.unique(np.r_[lb[:, :3].ravel(), lb[:, -3:].ravel(), lb[:3].ravel(), lb[-3:].ravel()])) - {0, main}
            # (and small pieces standing apart from the friend: the same stray bits, a little in from the edge)
            dmain = ndi.distance_transform_edt(lb != main)
            for j_ in range(1, nl + 1):
                if j_ != main and sz[j_ - 1] < 0.03 * sz[main - 1] and dmain[lb == j_].min() > 6:
                    edge.add(j_)
            for e_ in edge:
                m = m & (lb != e_)
            al = al * m
        mo.append((rgb, al, m))
    A = f13                                              # (the front frame's mask, frame px)
    B = mo[0][2]
    ay, ax_ = np.nonzero(A); by_, bx_ = np.nonzero(B)
    s0 = (ay.max() - ay.min()) / max(1, by_.max() - by_.min())
    # coarse-to-fine: scale and offset that lay 01's outline on the front frame's (quarter size)
    q = 4
    Aq = A[::q, ::q]
    best = None
    for sc in s0 * np.linspace(0.94, 1.06, 13):
        Bs = np.asarray(Image.fromarray(B.astype(np.uint8) * 255).resize((max(1, int(B.shape[1] * sc / q)), max(1, int(B.shape[0] * sc / q))), Image.BILINEAR)) > 127
        ys2, xs2 = np.nonzero(Bs)
        cx0 = (ax_.min() + ax_.max()) / 2 / q - (xs2.min() + xs2.max()) / 2
        cy0 = ay.max() / q - ys2.max()
        for dx in range(-6, 7):
            for dy in range(-6, 7):
                ox, oy = int(round(cx0 + dx)), int(round(cy0 + dy))
                C = np.zeros_like(Aq)
                ya, xa = max(0, oy), max(0, ox)
                yb, xb = min(Aq.shape[0], oy + Bs.shape[0]), min(Aq.shape[1], ox + Bs.shape[1])
                if yb <= ya or xb <= xa:
                    continue
                C[ya:yb, xa:xb] = Bs[ya - oy:yb - oy, xa - ox:xb - ox]
                iou_ = (C & Aq).sum() / max(1, (C | Aq).sum())
                if best is None or iou_ > best[0]:
                    best = (iou_, sc, ox * q, oy * q)
    iou_, sc, ox, oy = best
    # every frame into front-frame px; their union box
    placed = []
    for rgb, al, m in mo:
        Wd, Hd = int(round(m.shape[1] * sc)), int(round(m.shape[0] * sc))
        im = np.concatenate([rgb, al[..., None]], -1)
        im = np.asarray(Image.fromarray((np.clip(im, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').resize((Wd, Hd), Image.LANCZOS))
        placed.append(im)
    Wd, Hd = placed[0].shape[1], placed[0].shape[0]
    alls = np.any([p_[..., 3] > 128 for p_ in placed], 0)
    yy, xx = np.nonzero(alls)
    mx0, my0, mx1, my1 = ox + xx.min() - 6, oy + yy.min() - 6, ox + xx.max() + 7, oy + yy.max() + 7
    mbw, mbh = mx1 - mx0, my1 - my0
    ch_ = int(round(CELL * mbh / bh)); cw_ = int(round(ch_ * mbw / mbh))
    n = len(placed); cols = 3; rows = (n + cols - 1) // cols
    atlas = np.zeros((rows * ch_, cols * cw_, 4), np.uint8)
    for i, p_ in enumerate(placed):
        canvas = np.zeros((mbh, mbw, 4), np.uint8)       # (covers mx0..mx1 x my0..my1 of the front frame)
        X0, X1 = max(mx0, ox), min(mx1, ox + p_.shape[1])
        Y0, Y1 = max(my0, oy), min(my1, oy + p_.shape[0])
        canvas[Y0 - my0:Y1 - my0, X0 - mx0:X1 - mx0] = p_[Y0 - oy:Y1 - oy, X0 - ox:X1 - ox]
        im = Image.fromarray(canvas, 'RGBA').resize((cw_, ch_), Image.LANCZOS)
        r, c = divmod(i, cols)
        atlas[r * ch_:(r + 1) * ch_, c * cw_:(c + 1) * cw_] = np.asarray(im)
    buf = io.BytesIO()
    Image.fromarray(atlas, 'RGBA').save(buf, 'WEBP', quality=88, method=6)
    axis_f, bottom_f = x0 + axis, y0 + bottom          # (front-frame px)
    print(f'  motion: {n} frames, fit iou {iou_:.3f} (scale {sc:.3f}), cell {cw_}x{ch_}, {len(buf.getvalue()) // 1024} KB')
    if os.environ.get('SPIN_DBG'):
        Image.fromarray(atlas, 'RGBA').save(os.path.expanduser(f'~/.cache/agent-scratch/tc/motion_{kind}.png'))
    return {'n': n, 'cols': cols, 'rows': rows, 'w': round(mbw * s, 5), 'h': round(mbh * s, 5),
            'ax': round((axis_f - mx0) / mbw, 5), 'by': round((bottom_f - my0) / mbh, 5),
            'src': 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()}


def pack(kind):
    d = os.path.join(SRC, kind)
    fs = sorted(f for f in os.listdir(d) if re.match(r'f\d\d\.png$', f))
    frames = [cut(os.path.join(d, f)) for f in fs]
    raw = [np.asarray(Image.open(os.path.join(d, f)).convert('RGB')).astype(np.float32) / 255 for f in fs]
    # (the game's own eyes painted over the frames' — only for turntables whose eyes have no whites: the first monkey's;
    # the redrawn friends (2026-11-19) have their own)
    eyes = [find_eyes(raw[i], frames[i][2], int(fs[i][1:3])) if kind in EYES_PAINT else [] for i in range(len(fs))]
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
    pose = None
    rgbF, alF, mF = frames[FRONT - 1]
    motion = motion_frames(kind, mF, x0, y0, bw, bh, s, axis, bottom)
    warp = None if motion else warp_layers(kind, rgbF, alF, mF, x0, y0, bw, bh, cw, ch)
    L = None if (warp or motion) else limb_layers(kind, rgbF, alF, mF, x0, y0, bw, bh, s, axis, bottom)
    if L:
        body, limb, pv, sleeve = L
        pose = {'bone': POSE_LIMB[kind], 'body': webp_url(body, (cw, ch)), 'limb': webp_url(limb, (cw, ch)),
                'sleeve': webp_url(sleeve, (cw, ch)), 'part': 0,
                'pivot': [round(pv[0] / bw, 4), round(pv[1] / bh, 4)]}
        if os.environ.get('SPIN_DBG'):
            Image.fromarray((np.clip(body, 0, 1) * 255).astype(np.uint8), 'RGBA').save(os.path.expanduser(f'~/.cache/agent-scratch/tc/{kind}_body.png'))
            Image.fromarray((np.clip(limb, 0, 1) * 255).astype(np.uint8), 'RGBA').save(os.path.expanduser(f'~/.cache/agent-scratch/tc/{kind}_limb.png'))
    eyes_c = [[[round((e[0] - x0) / bw, 4), round((e[1] - y0) / bh, 4), round(e[2] / bw, 4), round(e[3] / bh, 4),
                round(e[4], 1), e[5]] for e in fe] for fe in eyes]
    print('  eyes per frame:', [len(fe) for fe in eyes])
    return {'n': n, 'cols': COLS, 'rows': rows, 'front': FRONT - 1, 'step': STEP, 'eyes': eyes_c, 'pose': pose, 'warp': warp,
            'motion': motion,
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
