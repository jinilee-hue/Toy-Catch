"""Toy Catch — the friends' 3D shapes, made on this Mac from the user's pictures (TripoSR, MIT licence; nothing leaves
the machine). For every picture in assets/img/friends/<kind>.webp:

  1. TripoSR guesses the whole 3D shape — and colours for the back — from the picture alone.
  2. The mesh is turned to face +z (found by matching its front view to the picture), scaled so its front outline sits
     exactly on the picture (the game maps the picture onto the front, so the art stays the user's own), smoothed and
     simplified to about TARGET triangles.
  3. Every vertex gets a 'front' weight: 1 where it is seen from the front (it shows the picture), 0 behind (it shows
     the guessed colours), soft in between.

With a CHARACTER SHEET (design/sheets/<kind>_sheet.png: the same plush rendered from the front, side and back) the
friend is rebuilt sharper:

  4. Front outline: the mesh is warped across (x, y) until its outline from the front is the picture's own outline
     (a smooth 2D warp found on signed-distance maps, then any vertex still outside pulled just inside), so no
     guessed colour or ghost edge shows round hats, hands, ears and tails.
  5. Side outline: the sheet's side view (scaled like the sheet's front view is to the picture) is laid over the mesh's
     side outline and the mesh is warped in depth (z only, so the front stays exact) until the two match. Parts the
     side view has and the mesh lacks (tails, mostly: the front picture never shows them) are added as soft tubes.
  6. A texture atlas (xatlas) is baked from the views: the picture from the front, the sheet's side view from both
     sides (mirrored for the other one), the back view from behind — each warped onto the mesh's outline in its
     direction, colour-matched to the picture, blended by how squarely the surface faces each view and only where
     that view really sees it; what no view sees (the top, under the chin) is filled from around it. The game still
     shows the full-size picture on the front (front weight) and this atlas everywhere else.
  The turtle's and the fish's pictures are side views: their sheet's face-on view is seen from -x (the head's side),
  the tail end from +x, and the other side (-z) is the picture itself, mirrored. Where a sheet disagrees with the
  picture, parts of it are left out (SHEET_SKIP, SHEET_DROP: the turtle's sheet has a much bigger head).

Writes js/friends-3d.js (base64 + webp data URLs — WebGL can't load files from file://).

usage (TripoSR checked out with its venv in ~/dev/tools/TripoSR, see README; xatlas + scipy in that venv):
  ~/dev/tools/TripoSR/.venv/bin/python tools/make_3d.py [--only monkey,ant] [--sheets DIR] [--debug DIR] [--target N]
(--sheets defaults to design/sheets, which is not in git: from a worktree, point it at the main checkout's.)
Raw meshes are cached in ~/dev/tools/TripoSR/out/<kind>.npz (delete one to regenerate it).
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import time

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TSR_DIR = os.path.expanduser('~/dev/tools/TripoSR')
OUT_RAW = os.path.join(TSR_DIR, 'out')
PX = 1.3 / 600                                   # friends.js: a 600-px-tall picture is 1.3 units tall
DEPTH_K = 0.92                                   # a touch slimmer than TripoSR's guess (plush, not a ball)
GRIP_Z = -0.02                                   # the head's middle (depth) at the grip height: the claw's prongs' plane

# Which figure on each character sheet is which view: a point inside it (sheet pixels; the sheets are 1024 x 765).
# The sheets' own labels are sometimes wrong (the dog's second side view says 후면, the cat's back 응용 포즈).
#   front — like the game picture; side — the friend seen from its left (+x: it faces the viewer's left); back.
#   turtle, fish: the game picture IS a side view (facing left), so 'front' is the sheet's side view (used only to scale
#   and colour-match the sheet), 'head' the face-on view (seen from -x), 'tail' the tail end (seen from +x).
SHEET_VIEWS = {
    'dog':    {'front': (178, 198), 'side': (522, 200), 'back': (178, 562)},
    'monkey': {'front': (516, 197), 'side': (195, 565), 'back': (513, 563)},
    'mouse':  {'front': (178, 230), 'side': (551, 229), 'back': (184, 568)},
    'turkey': {'front': (182, 191), 'side': (540, 205), 'back': (179, 553)},
    'ant':    {'front': (180, 214), 'side': (521, 211), 'back': (177, 561)},
    'cat':    {'front': (183, 213), 'side': (556, 208), 'back': (181, 569)},
    'cow':    {'front': (176, 200), 'side': (529, 198), 'back': (176, 574)},
    'seal':   {'front': (179, 219), 'side': (537, 219), 'back': (179, 574)},
    'turtle': {'front': (508, 226), 'head': (179, 224), 'tail': (181, 562)},
    'fish':   {'front': (523, 220), 'head': (185, 218), 'tail': (185, 553)},
    'duck':   {'front': (179, 260), 'side': (515, 250), 'back': (178, 560)},
}
SIDE_ON = ('turtle', 'fish')                     # game picture = a side view
# a letter on a side-on friend's flank (picture pixels x0, y0, x1, y1): mirrored onto the other side it would read
# backwards, so there it is flipped back in place (the turtle's T reads the same either way)
FLANK_LETTER = {'fish': (338, 194, 424, 372)}
# where a sheet disagrees with the game picture, parts of it are left out:
#   turtle — the sheet's turtle has a much bigger head on a smaller shell than the game's: its face-on and tail-end
#            views would paint the face onto the shell, and its depth would squeeze the shell. Picture + mirror only.
#   turkey — the sheet fans the tail out backwards (side view) where the picture's turkey holds it up behind its
#            head: fitting the depth to it tore the fan into a blade; no depth fit, no added parts
#   mouse  — the sheet lays the tail on the floor where the picture's mouse holds it up: no second (floor) tail
#   ant    — has no tail: bits of its hat brim and abdomen the side fit doesn't reach came out as stray tubes
SHEET_SKIP = {'turtle': ('depth', 'ends'), 'turkey': ('depth', 'tails'), 'mouse': ('tails',), 'ant': ('tails',)}
# bits of a sheet view to leave out (view, box as fractions of the figure x0, y0, x1, y1, what, cut from the outline
# too): the turkey's back view paints the back of its head brown where its side view (and the picture) have it pink
# all round; its side view draws the fan upright behind the body, far bigger than the picture's fan behind the head —
# warped onto the mesh it smeared feathers over the head and the body; the mouse's sheet lays the tail on the floor
# (side and back views), which painted a pink stub on its bottom and dragged the side view's warp
SHEET_DROP = {'turkey': [('back', (0.0, 0.0, 1.0, 0.36), 'brown', False),
                         ('side', (0.64, 0.10, 1.0, 0.93), 'fan', True)],
              'mouse': [('back', (0.38, 0.82, 1.0, 1.0), 'pink', True),
                        ('side', (0.45, 0.78, 1.0, 1.0), 'pink', True),
                        ('side', (0.10, 0.62, 0.21, 0.78), 'light', False)],
              # the shirt's letter seen edge-on from the side: a white stripe that the warp laid along the arm
              'monkey': [('side', (0.18, 0.58, 0.36, 0.84), 'white', False)],
              # the ant's antenna in front of its hat's crown (side view): it landed on the crown as brown smears; the
              # back view's thin white gaps between the arms and the abdomen: a white streak on top of the abdomen
              'ant': [('side', (0.22, 0.0, 0.62, 0.145), 'antenna', False),
                      ('back', (0.17, 0.67, 0.30, 0.81), 'light', False),
                      ('back', (0.72, 0.67, 0.87, 0.85), 'light', False)]}


def load_art():
    s = open(os.path.join(ROOT, 'js', 'friends-art.js'), encoding='utf-8').read()
    return json.loads(s[s.index('{'):s.rindex('}') + 1])


def tsr_mesh(kind, res):
    """TripoSR: picture -> (vertices, faces, colours) in its own frame; cached"""
    os.makedirs(OUT_RAW, exist_ok=True)
    cache = os.path.join(OUT_RAW, f'{kind}.npz')
    if os.path.exists(cache):
        z = np.load(cache)
        return z['v'], z['f'], z['c']
    sys.path.insert(0, TSR_DIR)
    import torch
    from tsr.system import TSR
    from tsr.utils import resize_foreground
    global _MODEL
    if '_MODEL' not in globals():
        dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
        m = TSR.from_pretrained('stabilityai/TripoSR', config_name='config.yaml', weight_name='model.ckpt')
        m.renderer.set_chunk_size(8192)
        _MODEL = (m.to(dev), dev)
    model, dev = _MODEL
    im = Image.open(os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp')).convert('RGBA')
    im = resize_foreground(im, 0.85)
    a = np.asarray(im).astype(np.float32) / 255.0
    a = a[..., :3] * a[..., 3:4] + (1 - a[..., 3:4]) * 0.5
    im = Image.fromarray((a * 255).astype(np.uint8))
    t0 = time.time()
    with torch.no_grad():
        try:
            codes = model([im], device=dev)
            mesh = model.extract_mesh(codes, True, resolution=res)[0]
        except Exception as e:                     # an op MPS can't do: run that friend on the CPU
            print('  (mps failed, cpu:', str(e)[:80], ')')
            model.to('cpu'); _MODEL = (model, 'cpu')
            codes = model([im], device='cpu')
            mesh = model.extract_mesh(codes, True, resolution=res)[0]
    print(f'  tripoSR {time.time() - t0:.1f}s  {len(mesh.vertices)} verts')
    v = np.asarray(mesh.vertices, np.float32)
    f = np.asarray(mesh.faces, np.int32)
    c = np.asarray(mesh.visual.vertex_colors[:, :3], np.uint8)
    np.savez_compressed(cache, v=v, f=f, c=c)
    return v, f, c


def rotations():
    """the 48 axis-aligned orientations (24 turns × mirrored or not)"""
    import itertools
    out = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            R = np.zeros((3, 3), np.float32)
            for i in range(3):
                R[i, perm[i]] = signs[i]
            out.append(R)
    return out


def front_view(v, c, n=72):
    """orthographic view from +z of a point cloud: colour image and coverage (nearest point per cell)"""
    x0, y0 = v[:, 0].min(), v[:, 1].min()
    sx = (v[:, 0].max() - x0) or 1
    sy = (v[:, 1].max() - y0) or 1
    W, H = n, max(8, int(round(n * sy / sx)))
    ix = np.clip(((v[:, 0] - x0) / sx * (W - 1)).astype(int), 0, W - 1)
    iy = np.clip(((1 - (v[:, 1] - y0) / sy) * (H - 1)).astype(int), 0, H - 1)
    order = np.argsort(v[:, 2])                       # far to near: the nearest written last
    img = np.zeros((H, W, 3), np.float32)
    cov = np.zeros((H, W), bool)
    img[iy[order], ix[order]] = c[order]
    cov[iy[order], ix[order]] = True
    return img, cov


def orient(v, c, pic):
    """the turn (maybe mirrored) whose front view looks most like the picture"""
    best = None
    pa = np.asarray(pic).astype(np.float32)
    for R in rotations():
        w = v @ R.T
        img, cov = front_view(w, c.astype(np.float32))
        H, W = cov.shape
        ref = np.asarray(Image.fromarray(pa.astype(np.uint8)).resize((W, H), Image.BILINEAR)).astype(np.float32)
        rc, ra = ref[..., :3], ref[..., 3] > 128
        both = cov & ra
        if both.sum() < 20:
            continue
        iou = both.sum() / max(1, (cov | ra).sum())
        err = np.abs(img[both] - rc[both]).mean() / 255
        aspect = abs(np.log((H / W) / (pa.shape[0] / pa.shape[1])))
        score = err + (1 - iou) * 0.8 + aspect * 0.5
        if best is None or score < best[0]:
            best = (score, R, iou, err)
    return best


def taubin(v, f, it=8, lam=0.5, mu=-0.53):
    import trimesh
    m = trimesh.Trimesh(v, f, process=False)
    trimesh.smoothing.filter_taubin(m, lamb=lam, nu=mu, iterations=it)
    return np.asarray(m.vertices, np.float32)


# ------------------------------------------------------------------------------------------------ rasterising, views

def raster(P, F, W, H, depth=None):
    """triangles P[F] (P: pixel coords, x right, y down, pixel centres at +0.5) onto a W x H grid: the triangle id per
    pixel (-1 = none) and its barycentric weights; with depth (bigger = nearer) the nearest triangle wins"""
    A, B, C = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    lo = np.floor(np.minimum(np.minimum(A, B), C) - 0.5).astype(np.int64) + 1
    hi = np.floor(np.maximum(np.maximum(A, B), C) - 0.5).astype(np.int64)
    lo = np.maximum(lo, 0); hi[:, 0] = np.minimum(hi[:, 0], W - 1); hi[:, 1] = np.minimum(hi[:, 1], H - 1)
    size = np.maximum(hi - lo + 1, 0).max(1)
    den = (B[:, 1] - C[:, 1]) * (A[:, 0] - C[:, 0]) + (C[:, 0] - B[:, 0]) * (A[:, 1] - C[:, 1])
    ok = (size > 0) & (np.abs(den) > 1e-12)
    pix, tri, l0s, l1s = [], [], [], []
    for s0, s1 in ((1, 2), (3, 4), (5, 8), (9, 16), (17, 32), (33, 64), (65, 128), (129, 4096)):
        sel = np.nonzero(ok & (size >= s0) & (size <= s1))[0]
        if not len(sel):
            continue
        for ch in range(0, len(sel), max(1, 4_000_000 // (s1 * s1))):
            t = sel[ch:ch + max(1, 4_000_000 // (s1 * s1))]
            n = min(s1, int(size[t].max()))
            oy, ox = np.mgrid[0:n, 0:n]
            qx = lo[t, 0, None] + ox.ravel()[None]
            qy = lo[t, 1, None] + oy.ravel()[None]
            cx, cy = qx + 0.5, qy + 0.5
            a, b, c, d = A[t], B[t], C[t], den[t, None]
            l0 = ((b[:, 1, None] - c[:, 1, None]) * (cx - c[:, 0, None]) + (c[:, 0, None] - b[:, 0, None]) * (cy - c[:, 1, None])) / d
            l1 = ((c[:, 1, None] - a[:, 1, None]) * (cx - c[:, 0, None]) + (a[:, 0, None] - c[:, 0, None]) * (cy - c[:, 1, None])) / d
            l2 = 1 - l0 - l1
            ins = (l0 >= -1e-7) & (l1 >= -1e-7) & (l2 >= -1e-7) & (qx <= hi[t, 0, None]) & (qy <= hi[t, 1, None])
            r, k = np.nonzero(ins)
            pix.append(qy[r, k] * W + qx[r, k]); tri.append(t[r]); l0s.append(l0[r, k]); l1s.append(l1[r, k])
    fid = np.full(H * W, -1, np.int32)
    bary = np.zeros((H * W, 3), np.float32)
    if pix:
        pix, tri, l0, l1 = (np.concatenate(x) for x in (pix, tri, l0s, l1s))
        if depth is not None:
            z = l0 * depth[F[tri, 0]] + l1 * depth[F[tri, 1]] + (1 - l0 - l1) * depth[F[tri, 2]]
            o = np.lexsort((z, pix))
            pix, tri, l0, l1 = pix[o], tri[o], l0[o], l1[o]
            last = np.r_[pix[1:] != pix[:-1], True]
            pix, tri, l0, l1 = pix[last], tri[last], l0[last], l1[last]
        fid[pix] = tri
        bary[pix, 0], bary[pix, 1] = l0, l1
        bary[pix, 2] = 1 - l0 - l1
    return fid.reshape(H, W), bary.reshape(H, W, 3)


class Plane:
    """an orthographic view of the friend: d points at the camera, image x runs along r, image y down (-y); one pixel is
    one picture pixel (PX); continuous coords with pixel centres at +0.5"""

    def __init__(self, d, r, lo, hi, margin=24):
        self.d, self.r = np.asarray(d, np.float64), np.asarray(r, np.float64)
        self.margin = margin
        self.a0, self.b1 = lo[0] - margin * PX, hi[1] + margin * PX
        self.W = int(np.ceil((hi[0] - lo[0]) / PX)) + 2 * margin
        self.H = int(np.ceil((hi[1] - lo[1]) / PX)) + 2 * margin

    @classmethod
    def around(cls, v, d, r, margin=24):
        a, b = v @ np.asarray(r, np.float64), v[:, 1]
        return cls(d, r, (a.min(), b.min()), (a.max(), b.max()), margin)

    def pix(self, v):
        return np.stack([(v @ self.r - self.a0) / PX, (self.b1 - v[:, 1]) / PX], 1)

    def move(self, u_col, u_row):
        """a displacement in this plane's pixels -> 3D"""
        return PX * (u_col[:, None] * self.r[None] - u_row[:, None] * np.array([0, 1, 0])[None])

    def render(self, v, f):
        fid, bary = raster(self.pix(v), f, self.W, self.H, v @ self.d)
        return fid

    def mask(self, v, f):
        from scipy import ndimage as ndi
        return ndi.binary_closing(self.render(v, f) >= 0, iterations=1)


def sample(img, xy, order=1, cval=None):
    """img (H x W [x C]) at continuous coords xy (N x 2, x right / y down, pixel centres at +0.5)"""
    from scipy import ndimage as ndi
    c = [xy[:, 1] - 0.5, xy[:, 0] - 0.5]
    mode = 'nearest' if cval is None else 'constant'
    if img.ndim == 2:
        return ndi.map_coordinates(img, c, order=order, mode=mode, cval=cval or 0)
    return np.stack([ndi.map_coordinates(img[..., k], c, order=order, mode=mode, cval=cval or 0)
                     for k in range(img.shape[2])], 1)


def sdf(m, clip):
    from scipy import ndimage as ndi
    return np.clip(ndi.distance_transform_edt(~m) - ndi.distance_transform_edt(m), -clip, clip).astype(np.float32)


def demons(F, M, its=(70, 50, 40), sig=(3.0, 2.5, 2.0), clip=24.0, lock=None):
    """a smooth dense 2D warp u (2 x H x W: rows, cols) with M(x + u(x)) ≈ F(x) for the masks F, M (one shape):
    demons forces on their signed distances (long reach), the field Gaussian-smoothed each step (smooth, no folds),
    coarse to fine. lock=0 keeps rows fixed (only columns move)"""
    from scipy import ndimage as ndi
    H, W = F.shape
    H2, W2 = -(-H // 8) * 8, -(-W // 8) * 8
    Fp = np.zeros((H2, W2), bool); Fp[:H, :W] = F
    Mp = np.zeros((H2, W2), bool); Mp[:H, :W] = M
    u = None
    for li, lv in enumerate((4, 2, 1)):
        f = Fp.reshape(H2 // lv, lv, W2 // lv, lv).mean((1, 3)) > 0.5
        m = Mp.reshape(H2 // lv, lv, W2 // lv, lv).mean((1, 3)) > 0.5
        u = np.zeros((2,) + f.shape, np.float32) if u is None else np.stack([ndi.zoom(c, 2, order=1) for c in u]) * 2
        fs, ms = sdf(f, clip), sdf(m, clip)
        yy, xx = np.mgrid[0:f.shape[0], 0:f.shape[1]].astype(np.float32)
        for _ in range(its[li]):
            mw = ndi.map_coordinates(ms, [yy + u[0], xx + u[1]], order=1, mode='nearest')
            gy, gx = np.gradient(mw)
            df = np.clip(mw - fs, -1.5, 1.5)
            den = gy * gy + gx * gx + 0.05
            if lock != 0:
                u[0] -= df * gy / den
            if lock != 1:
                u[1] -= df * gx / den
            u[0] = ndi.gaussian_filter(u[0], sig[li]); u[1] = ndi.gaussian_filter(u[1], sig[li])
    return u[:, :H, :W]


def warp_mask(M, u):
    from scipy import ndimage as ndi
    yy, xx = np.mgrid[0:M.shape[0], 0:M.shape[1]].astype(np.float32)
    return ndi.map_coordinates(M.astype(np.float32), [yy + u[0], xx + u[1]], order=1, mode='constant') > 0.5


def warp_trust(u, squeeze=(2.3, 1.6), stretch=(0.32, 0.5)):
    """how far a warp's colours can be trusted, per pixel: 1 where it moves the image about rigidly, 0 where it squeezes
    it (one pixel here takes more than `squeeze` image pixels in some direction) or stretches it (less than `stretch`)
    — the singular values of the warp's Jacobian"""
    from scipy import ndimage as ndi
    a = 1 + np.gradient(u[0], axis=0); b = np.gradient(u[0], axis=1)
    c = np.gradient(u[1], axis=0); d = 1 + np.gradient(u[1], axis=1)
    s2 = a * a + b * b + c * c + d * d
    det = a * d - b * c
    r = np.sqrt(np.maximum(s2 * s2 - 4 * det * det, 0))
    smax, smin = np.sqrt((s2 + r) / 2), np.sqrt(np.maximum(s2 - r, 0) / 2)
    ss = lambda x, e0, e1: (lambda t: t * t * (3 - 2 * t))(np.clip((x - e0) / (e1 - e0), 0, 1))
    t = ss(smax, squeeze[0], squeeze[1]) * ss(smin, stretch[0], stretch[1])
    return ndi.gaussian_filter(t.astype(np.float32), 1.5)


def wmedian(C, W):
    """per-channel weighted medians: C (N x k x 3) colours, W (N x k) weights"""
    out = np.empty((C.shape[0], C.shape[2]), np.float32)
    half = 0.5 * W.sum(1)
    for ch in range(C.shape[2]):
        o = np.argsort(C[..., ch], axis=1)
        cs = np.take_along_axis(C[..., ch], o, 1)
        cw = np.cumsum(np.take_along_axis(W, o, 1), 1)
        j = np.minimum((cw < half[:, None]).sum(1), C.shape[1] - 1)
        out[:, ch] = cs[np.arange(len(cs)), j]
    return out


def smooth_normals(v, f, its=24):
    """vertex normals of a smoothed copy of the mesh: the way each part faces, without TripoSR's lumps and the warps'
    ripples"""
    import trimesh
    m = trimesh.Trimesh(np.asarray(v, np.float64).copy(), f, process=False)
    trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=its)
    n = np.asarray(m.vertex_normals, np.float64)
    return n / np.maximum(np.linalg.norm(n, axis=1), 1e-9)[:, None]


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


# ------------------------------------------------------------------------------------------------ character sheets

def segment(a):
    """a character sheet's figures: everything but the white background — the near-white touching the border, and
    pockets of it shut in by a figure (the gap inside the monkey's curled tail): pure, flat white (the cow's white
    fur is never that flat or that bright)"""
    from scipy import ndimage as ndi
    dark = 255 - a.min(2).astype(np.int16)
    lab, n = ndi.label(dark < 14)
    edge = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])
    bg = np.isin(lab, edge[edge > 0])
    g = a.astype(np.float32).mean(2)
    for i, sl in enumerate(ndi.find_objects(lab)):
        if i + 1 in edge or sl is None:
            continue
        m = lab[sl] == i + 1
        if m.sum() < 40:
            continue
        mi = ndi.binary_erosion(m, iterations=2)
        v = g[sl][mi if mi.sum() >= 5 else m]
        if v.mean() >= 253.5 and v.std() <= 1.4:
            bg[sl] |= m
    return ndi.binary_opening(~bg)


def bleed(rgb, m, inset=2):
    """the colours just inside the outline copied outward (the sheet's edge pixels are mixed with its white)"""
    from scipy import ndimage as ndi
    inner = ndi.binary_erosion(m, iterations=inset) if inset else m
    if inner.sum() < 50:
        inner = m
    _, (iy, ix) = ndi.distance_transform_edt(~inner, return_indices=True)
    return rgb[iy, ix]


def sheet_views(kind, sheets):
    """{view: (rgb float 0..1 bled past the outline, mask)} cut from the friend's character sheet, or None"""
    from scipy import ndimage as ndi
    path = os.path.join(sheets or '', f'{kind}_sheet.png')
    if kind not in SHEET_VIEWS or not os.path.exists(path):
        return None
    a = np.asarray(Image.open(path).convert('RGB'))
    fg = segment(a)
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    objs = ndi.find_objects(lab)
    out = {}
    for name, (sx, sy) in SHEET_VIEWS[kind].items():
        cand = [i for i, sl in enumerate(objs) if sl[0].start <= sy < sl[0].stop and sl[1].start <= sx < sl[1].stop]
        i = max(cand, key=lambda i: sizes[i])
        sl = objs[i]
        m = lab[sl] == i + 1
        m0 = m.copy()                                  # (the figure's own pixels: the specks filled in are background)
        m = m | (ndi.binary_fill_holes(m) & ~ndi.binary_opening(ndi.binary_fill_holes(m) & ~m, iterations=2))   # specks only
        rgb = a[sl].astype(np.float32) / 255
        mt = m.copy()                                  # (what the texture may use; the outline stays whole)
        for vname, (bx0, by0, bx1, by1), what, cut in SHEET_DROP.get(kind, ()):
            if vname != name:
                continue
            import cv2
            hsv = cv2.cvtColor(a[sl], cv2.COLOR_RGB2HSV).astype(np.int32)
            hh, ss, vv = hsv[..., 0], hsv[..., 1], hsv[..., 2]
            H_, W_ = m.shape
            box = np.zeros_like(m); box[int(by0 * H_):int(by1 * H_), int(bx0 * W_):int(bx1 * W_)] = True
            cutm = None                                # (what leaves the outline, when cut: the default, all of it)
            if what == 'brown':
                drop = box & (hh <= 25) & (vv < 150) & (ss > 60)
            elif what == 'pink':                       # the mouse's floor tail: thin, and pinker than its fur
                thin = box & m & ~opened(m, 7)         # (only its thin part leaves the outline: cutting where it
                drop = thin | (box & m & ((hh >= 150) | (hh <= 5)) & (ss > 60) & (vv > 150))   # lies on the body
                cutm = ndi.binary_dilation(ndi.binary_opening(thin, iterations=2), iterations=2)  # notched the hem)
            elif what == 'fan':                        # everything there but the body's brown
                drop = box & m & ~((hh <= 30) & (vv < 150) & (ss > 70))
            elif what == 'white':                      # a letter seen edge-on
                drop = box & m & (vv > 185) & (ss < 50)
            elif what == 'light':                      # (a greyer one, in a tight box)
                drop = box & m & (vv > 150) & (ss < 60)
            elif what == 'antenna':                    # brown, darker than the hat's beige
                drop = box & m & (hh <= 16) & (vv < 185) & (ss > 125)
            else:
                raise ValueError(what)
            if what not in ('white', 'light'):         # (specks off; a letter's edge is itself thin)
                drop = ndi.binary_opening(drop, iterations=2)
            drop = ndi.binary_dilation(drop, iterations=2)
            mt = mt & ~drop
            if cut:
                cutm = drop if cutm is None else cutm
                m = m & ~cutm
                m0 = m0 & ~cutm
                lab2, n2 = ndi.label(m)                # (what's left of the figure: its biggest piece)
                if n2 > 1:
                    m = lab2 == 1 + np.argmax(ndi.sum(m, lab2, range(1, n2 + 1)))
                    m0 &= m
                mt &= m
        # colours: the figure's own pixels bled outward — the specks filled into the mask (thin gaps between an arm and
        # the body: the sheet's white) take their neighbours' colours, else they painted thin white lines
        out[name] = (bleed(rgb, m0), m, mt)
    return out


def place(mask, k, F, spread=(0.94, 1.06), steps=13):
    """the scale (about k: sheet px -> plane px) and offset laying a sheet figure's mask best over the plane mask F
    (most overlap, FFT cross-correlation). Returns (iou, ox, oy, sx, sy): the figure's top-left in F and its scale"""
    from scipy.signal import fftconvolve
    best = None
    Hm, Wm = mask.shape
    Ff = F.astype(np.float32)
    for s in np.linspace(spread[0], spread[1], steps):
        mh, mw = max(2, round(Hm * k * s)), max(2, round(Wm * k * s))
        M = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((mw, mh), Image.BILINEAR)) > 127
        cor = fftconvolve(Ff, M[::-1, ::-1].astype(np.float32), mode='full')
        iy, ix = np.unravel_index(np.argmax(cor), cor.shape)
        inter = cor[iy, ix]
        q = inter / (F.sum() + M.sum() - inter)
        if best is None or q > best[0]:
            best = (q, ix - (mw - 1), iy - (mh - 1), mw / Wm, mh / Hm)
    return best


def placed(img, shape, ox, oy, sx, sy, cval=None):
    """a sheet figure (image or mask) resampled into a plane grid at offset (ox, oy) and scale (sx, sy)"""
    H, W = shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    xy = np.stack([((xx + 0.5 - ox) / sx).ravel(), ((yy + 0.5 - oy) / sy).ravel()], 1)
    out = sample(img.astype(np.float32), xy, order=1, cval=cval)
    return out.reshape((H, W) + img.shape[2:])


def colour_lut(src, dst, by_quantile=False):
    """per-channel tone curves (3 x 256) taking the sheet's colours (src, N x 3, 0..1) to the picture's (dst): medians
    of dst in bins of src — or, when the two aren't the same pixels (a different render), matching quantiles"""
    lut = np.zeros((3, 256), np.float32)
    t = np.arange(256) / 255
    for ch in range(3):
        x, y = src[:, ch], dst[:, ch]
        if by_quantile:
            q = np.linspace(0.01, 0.99, 33)
            xs, ys = np.quantile(x, q), np.quantile(y, q)
        else:
            e = np.quantile(x, np.linspace(0, 1, 33))
            xs, ys = [], []
            for a, b in zip(e[:-1], e[1:]):
                s = (x >= a) & (x <= b)
                if s.sum() > 20:
                    xs.append(np.median(x[s])); ys.append(np.median(y[s]))
            xs, ys = np.array(xs), np.array(ys)
        ys = np.maximum.accumulate(ys)
        xs, keep = np.unique(xs, return_index=True)
        ys = ys[keep]
        g0 = (ys[min(3, len(ys) - 1)] - ys[0]) / max(1e-3, xs[min(3, len(xs) - 1)] - xs[0])
        g1 = (ys[-1] - ys[max(0, len(ys) - 4)]) / max(1e-3, xs[-1] - xs[max(0, len(xs) - 4)])
        out = np.interp(t, xs, ys)
        out = np.where(t < xs[0], ys[0] + (t - xs[0]) * np.clip(g0, 0.5, 2), out)
        out = np.where(t > xs[-1], ys[-1] + (t - xs[-1]) * np.clip(g1, 0.5, 2), out)
        lut[ch] = np.clip(out, 0, 1)
    return lut


def apply_lut(rgb, lut):
    i = np.clip(np.round(rgb * 255), 0, 255).astype(np.int32)
    return np.stack([lut[k][i[..., k]] for k in range(3)], -1)


# ------------------------------------------------------------------------------------------------ the build

def base_mesh(kind, art, res):
    """TripoSR's mesh turned to face +z, crumbs dropped, smoothed, its outline box fitted to the picture's (friend
    frame: x across with the head's middle at 0, y up from the bottom, z toward the camera)"""
    import trimesh
    from scipy.spatial import cKDTree
    a = art[kind]
    v, f, c = tsr_mesh(kind, res)
    pic = Image.open(os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp')).convert('RGBA')
    score, R, q, err = orient(v, c, pic)
    v = v @ R.T
    if np.linalg.det(R) < 0:
        f = f[:, ::-1]
    print(f'  orient: iou {q:.2f}, colour err {err:.3f}{"  (mirrored)" if np.linalg.det(R) < 0 else ""}')
    m = trimesh.Trimesh(v, f, process=True)
    parts = m.split(only_watertight=False)
    if len(parts) > 1:                                # keep the body, drop floating crumbs
        m = max(parts, key=lambda p: len(p.faces))
    v, f = np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32)
    c = c[cKDTree(np.load(os.path.join(OUT_RAW, f'{kind}.npz'))['v'] @ R.T).query(v)[1]]
    v = taubin(v, f)
    w, h, u = a['w'] * PX, a['h'] * PX, a['head'][0]
    al = np.asarray(pic)[..., 3] > 128
    ys, xs = np.nonzero(al)
    W, H = al.shape[1], al.shape[0]
    X0, X1 = (-u + xs.min() / W) * w, (-u + (xs.max() + 1) / W) * w
    Y0, Y1 = (1 - (ys.max() + 1) / H) * h, (1 - ys.min() / H) * h
    mn, mx = v.min(0), v.max(0)
    kx, ky = (X1 - X0) / (mx[0] - mn[0]), (Y1 - Y0) / (mx[1] - mn[1])
    v[:, 0] = X0 + (v[:, 0] - mn[0]) * kx
    v[:, 1] = Y0 + (v[:, 1] - mn[1]) * ky
    v[:, 2] = (v[:, 2] - (mn[2] + mx[2]) / 2) * (kx + ky) / 2 * DEPTH_K - 0.02
    return v.astype(np.float64), f, c, pic


def front_plane(art, kind, margin=24):
    """the front view's plane: its grid is the picture's own pixels (+ a margin all round)"""
    a = art[kind]
    w, h, u = a['w'] * PX, a['h'] * PX, a['head'][0]
    return Plane((0, 0, 1), (1, 0, 0), (-u * w, 0), ((1 - u) * w, h), margin)


def pic_in_plane(pic, fp):
    """the picture (rgb bled past the outline, alpha) on the front plane's grid"""
    pa = np.asarray(pic).astype(np.float32) / 255
    H, W = fp.H, fp.W
    m = fp.margin
    rgb = np.zeros((H, W, 3), np.float32); al = np.zeros((H, W), np.float32)
    rgb[m:m + pa.shape[0], m:m + pa.shape[1]] = pa[..., :3]
    al[m:m + pa.shape[0], m:m + pa.shape[1]] = pa[..., 3]
    return bleed(rgb, al > 0.9, 0), al


def fit_front(v, f, A, fp, dbg=None):
    """warp the mesh across (x, y) until its outline from the front is the picture's alpha A (front-plane grid)"""
    M0 = fp.mask(v, f)
    u = demons(M0, A, its=(80, 60, 50), sig=(3.0, 2.5, 1.8))
    d = sample(np.moveaxis(u, 0, -1), fp.pix(v))
    v = v + fp.move(d[:, 1], d[:, 0])
    M1 = fp.mask(v, f)
    print(f'  front outline: iou {iou(M0, A):.3f} -> {iou(M1, A):.3f}  (outside {(M1 & ~A).sum()} px, missing {(A & ~M1).sum()} px)')
    if dbg is not None:
        dbg['front'] = (A, M0, M1)
    return v


def push_inside(v, A, fp, inset=0.8, its=4):
    """any vertex whose front projection is outside the alpha (or within `inset` px of its edge) pulled just inside"""
    from scipy import ndimage as ndi
    s = (ndi.distance_transform_edt(~A) - ndi.distance_transform_edt(A)).astype(np.float32)
    s = ndi.gaussian_filter(s, 0.7)
    gy, gx = np.gradient(s)
    moved = 0
    for _ in range(its):
        p = fp.pix(v)
        sv = sample(s, p)
        out = sv > -inset
        if not out.any():
            break
        moved = max(moved, out.sum())
        g = sample(np.stack([gy, gx], -1), p[out])
        gn = np.maximum(np.linalg.norm(g, axis=1), 1e-3)
        step = (sv[out] + inset + 0.15)
        v[out] += fp.move(-step * g[:, 1] / gn, -step * g[:, 0] / gn)
    return v, moved


def opened(m, r):
    """thin bits (tails, ears seen edge-on) taken off a mask: they mustn't drag the body around"""
    from scipy import ndimage as ndi
    if r < 1:
        return m
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return ndi.binary_opening(m, structure=(x * x + y * y) <= r * r)


def fit_depth(v, f, views, k, kind, h, dbg=None):
    """the sheet's side view (turtle, fish: the face-on view) laid over the mesh's side outline, the mesh warped in
    depth only until they match — the bodies' outlines only (thin bits opened away), smoothly and by a limited amount,
    so a part the sheet draws differently (the turkey's fan, a tail the mesh lacks) isn't dragged into a blade"""
    if 'side' in views:
        rgb, m = views['side'][:2]; d, r = (1, 0, 0), (0, 0, -1)
    else:
        rgb, m = views['head'][:2]; d, r = (-1, 0, 0), (0, 0, 1)
    from scipy import ndimage as ndi
    import scipy.sparse as sp
    pl = Plane.around(v, d, r, margin=60)
    S0 = pl.mask(v, f)
    q, ox, oy, sx, sy = place(m, k, S0)
    T = placed(m.astype(np.float32), S0.shape, ox, oy, sx, sy, cval=0) > 0.5
    ro = int(round(0.035 * h / PX))
    u = demons(opened(S0, ro), opened(T, ro), its=(70, 50, 20), sig=(6.0, 6.0, 6.0), lock=0)
    lim = 0.1 * h / PX
    du = np.clip(sample(u[1], pl.pix(v)), -lim, lim)
    # the shift smoothed over the mesh's surface: a thin part's two faces (an ear, an antenna, a brim seen edge-on) are
    # close along the surface and move together, all of a piece, while the body's front and back stay far apart and
    # keep their own shifts. Straight from the side field, the field varying across the mouse's edge-on ear squeezed it
    # into a pointed spike (a rabbit's ear) and the ant's antennae into a bunch of stubs
    E = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    Adj = sp.coo_matrix((np.ones(len(E) * 2), (np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]])), shape=(len(v),) * 2).tocsr()
    Adj.data[:] = 1
    deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)
    for _ in range(400):
        du = 0.5 * du + 0.5 * (Adj @ du) / deg
    v = v + pl.move(du, np.zeros_like(du))
    S1 = pl.mask(v, f)
    print(f'  side outline: placed iou {q:.3f} (scale {sx / k:.3f}) -> {iou(S1, T):.3f}  (max shift {np.abs(du).max() * PX:.3f})')
    if dbg is not None:
        dbg['side'] = (T, S0, S1)
    return v


def add_tails(v, f, views, k, h, gy, dbg=None):
    """parts the sheet's side view has but the mesh doesn't — tails, mostly (the front picture never shows them) — added
    as round soft tubes: the missing piece of the side outline, as thick across (x) as it is wide, down the body's
    middle, reaching a little into the body (no gap). Wide missing pieces (not a tail) are left alone, and so are pieces
    in front of the body's middle or above the head's middle (a cap's visor, a hat brim's back edge)"""
    from scipy import ndimage as ndi
    if 'side' in views:
        m = views['side'][1]; d, r = (1, 0, 0), (0, 0, -1)
    else:
        m = views['head'][1]; d, r = (-1, 0, 0), (0, 0, 1)
    pl = Plane.around(v, d, r, margin=160)
    S = pl.mask(v, f)
    q, ox, oy, sx, sy = place(m, k, S)
    T = placed(m.astype(np.float32), S.shape, ox, oy, sx, sy, cval=0) > 0.5
    R = ndi.binary_opening(T & ~ndi.binary_dilation(S, iterations=2), iterations=2)
    lab, n = ndi.label(R)
    vs, fs = [v], [f]
    base = len(v)
    hp = h / PX
    added = []
    cols = np.nonzero(S)[1]
    mid = (cols.min() + cols.max()) / 2                  # (image x runs backwards: r = -z)
    for i in range(1, n + 1):
        C = lab == i
        area = C.sum()
        if area < max(300, 0.004 * T.sum()):
            continue
        dC = ndi.distance_transform_edt(C)
        if dC.max() > 0.045 * hp:                       # too wide for a tail: a part the sheet just draws differently
            continue
        if np.nonzero(C)[1].mean() < mid:               # in front: not a tail (the monkey's cap visor, drawn longer
            continue                                    # on the sheet, came out as a spike over its brow)
        if pl.b1 - (np.nonzero(C)[0].mean() + 0.5) * PX > gy:   # above the head's middle: a hat's brim, not a tail
            continue
        # the tube reaches from the tail well into the body, across the gap between the sheet's outline and the mesh's
        # (else a sliver of background showed between them: a white line down the monkey's back)
        C2 = C | (ndi.binary_dilation(C, iterations=12) & (S | T | ndi.binary_dilation(S, iterations=3)))
        dt = ndi.distance_transform_edt(C2) - 0.8          # (~0 on the outline: the two halves meet there)
        rad = ndi.maximum_filter(dt, size=int(2 * dC.max() + 3))
        t = np.sqrt(np.maximum(0, 2 * rad * dt - dt * dt))
        # the body's middle (across) where the tail joins
        join = ndi.binary_dilation(C, iterations=8) & S
        pv = pl.pix(v)
        ix = np.clip(pv[:, 0].astype(int), 0, pl.W - 1); iy = np.clip(pv[:, 1].astype(int), 0, pl.H - 1)
        near = join[iy, ix]
        xc = float(np.median(v[near, 0])) if near.sum() > 5 else 0.0
        ys, xs = np.nonzero(C2)
        idx = -np.ones(C2.shape, np.int64)
        idx[ys, xs] = np.arange(len(ys))
        a = pl.a0 + (xs + 0.5) * PX                      # plane coords -> 3D: along r, and y
        b = pl.b1 - (ys + 0.5) * PX
        th = t[ys, xs] * PX * 0.92
        P0 = np.zeros((len(ys), 3)); P0[:, 1] = b
        P0 += a[:, None] * np.asarray(r, np.float64)[None]
        P0[:, 0] = xc
        top, bot = P0.copy(), P0.copy()
        top[:, 0] += th; bot[:, 0] -= th
        # cells with all four corners inside, two triangles each, on both layers (opposite winding)
        c00 = idx[:-1, :-1]; c10 = idx[:-1, 1:]; c01 = idx[1:, :-1]; c11 = idx[1:, 1:]
        ok = (c00 >= 0) & (c10 >= 0) & (c01 >= 0) & (c11 >= 0)
        A, B, Cc, D = c00[ok], c10[ok], c01[ok], c11[ok]
        tri = np.concatenate([np.stack([A, Cc, B], 1), np.stack([B, Cc, D], 1)])
        # boundary edges (used by one triangle) stitched between the layers
        e = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
        key = np.sort(e, 1)
        uq, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
        bnd = e[cnt[inv.ravel()] == 1]
        nv = len(ys)
        top_f = tri
        bot_f = tri[:, ::-1] + nv
        side_f = np.concatenate([np.stack([bnd[:, 1], bnd[:, 0], bnd[:, 0] + nv], 1),
                                 np.stack([bnd[:, 1], bnd[:, 0] + nv, bnd[:, 1] + nv], 1)])
        tv = np.concatenate([top, bot])
        tf = np.concatenate([top_f, bot_f, side_f])
        import trimesh
        tm = trimesh.Trimesh(tv, tf, process=True)        # (merges the outline's doubled corners)
        trimesh.smoothing.filter_taubin(tm, lamb=0.5, nu=-0.53, iterations=12)   # no pixel steps on its outline
        tv, tf = np.asarray(tm.vertices), np.asarray(tm.faces) + base
        vs.append(tv); fs.append(tf.astype(np.int32)); base += len(tv)
        added.append((int(area), round(float(dC.max() * 2 * PX), 3)))
    if added:
        print(f'  tails added (area px, thickness): {added}')
        import trimesh
        mm = trimesh.Trimesh(np.concatenate(vs), np.concatenate(fs), process=False)
        mm.fix_normals(multibody=True)
        return np.asarray(mm.vertices, np.float64), np.asarray(mm.faces, np.int32)
    return v, f


def centre_flank(v, f, fp, sig=6.0):
    """a side-on friend (turtle, fish) is the same on both flanks, so its middle plane must be flat: TripoSR put the
    turtle's head off to the picture's side, and the mirrored picture's eye landed on the shell. Each part's middle
    (depth) is moved onto the body's middle plane — z only, so the front stays exact"""
    from scipy import ndimage as ndi
    p = fp.pix(v)
    s = 4
    ix = np.clip((p[:, 0] / s).astype(int), 0, fp.W // s); iy = np.clip((p[:, 1] / s).astype(int), 0, fp.H // s)
    G = (fp.H // s + 1, fp.W // s + 1)
    zmin = np.full(G, np.inf); zmax = np.full(G, -np.inf)
    np.minimum.at(zmin, (iy, ix), v[:, 2]); np.maximum.at(zmax, (iy, ix), v[:, 2])
    has = np.isfinite(zmin)
    mid = np.where(has, (zmin + zmax) / 2, 0)
    target = np.median(mid[has])
    d = np.where(has, target - mid, 0)
    w = ndi.gaussian_filter(has.astype(np.float64), sig)
    d = ndi.gaussian_filter(d, sig) / np.maximum(w, 1e-6)
    v = v.copy()
    v[:, 2] += ndi.map_coordinates(d, [p[:, 1] / s - 0.5, p[:, 0] / s - 0.5], order=1, mode='nearest')
    print(f'  flanks centred: parts moved by up to {np.abs(d[has]).max():.3f}')
    return v


def recentre(v, gy, h):
    """the head's middle (depth) at the grip height on the claw's prongs' plane"""
    band = np.abs(v[:, 1] - gy) < 0.05 * h
    if band.sum() > 10:
        zc = (v[band, 2].min() + v[band, 2].max()) / 2
        v[:, 2] += GRIP_Z - zc
    return v


def decimate(v, f, target):
    import fast_simplification
    if len(f) > target:
        v2, f2 = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int32), target_reduction=1 - target / len(f))
        return v2.astype(np.float64), f2.astype(np.int32)
    return v, f


def front_weight(m, lo=-0.12, hi=0.3, sharp=False):
    """1 where the picture shows (seen from the front), 0 round the back, soft in between and on the steep sides
    (n.z from lo to hi). sharp (with an atlas): only what the front really sees, softened only toward what another
    part hides (behind an arm) — not across the outline, so the picture reaches the very edge — and the facing is left
    to the shader"""
    v = np.asarray(m.vertices); n = np.asarray(m.vertex_normals)
    eps = 2e-3
    org = v + np.array([0, 0, eps]) + n * eps
    hit = m.ray.intersects_any(org, np.tile([[0, 0, 1]], (len(v), 1)))
    vis = (~hit).astype(np.float32)
    fw = vis.copy()
    nb = m.vertex_neighbors
    if sharp:
        front = n[:, 2] > 0.05
        for _ in range(3):
            fw = np.array([(fw[i] * 2 + fw[[j for j in nb[i] if front[j]]].sum()) / (2 + sum(1 for j in nb[i] if front[j]))
                           for i in range(len(v))], np.float32)
        return fw * vis
    for _ in range(3):
        fw = np.array([(fw[i] * 2 + fw[list(nb[i])].sum()) / (2 + len(nb[i])) if len(nb[i]) else fw[i] for i in range(len(v))], np.float32)
    s = np.clip((n[:, 2] - lo) / (hi - lo), 0, 1)
    return fw * s * s * (3 - 2 * s)


class BakeView:
    """one picture of the friend for the texture: seen along d (z-buffer in its own plane), sampled in an image plane
    (maybe another one: the mirrored side shares the side's image), warped onto the mesh's outline there"""

    def __init__(self, name, d, vis_plane, img_plane, rgb, mask, warp=None, power=3.0, prio=1.0, valid=None, floor=0.0,
                 band=None):
        self.name, self.d = name, np.asarray(d, np.float64)
        self.vp, self.ip, self.rgb, self.mask, self.warp = vis_plane, img_plane, rgb, mask, warp
        self.power, self.prio, self.valid, self.floor = power, prio, valid, floor
        self.band = band                               # (only where |n.z| < band: the middle of a side-on friend)
        self.zb = None

    def prepare(self, v, f):
        fid, bary = raster(self.vp.pix(v), f, self.vp.W, self.vp.H, v @ self.d)
        dep = v @ self.d
        z = (bary * dep[f[np.maximum(fid, 0)]]).sum(-1)
        z[fid < 0] = -np.inf
        from scipy import ndimage as ndi
        self.zb = ndi.maximum_filter(z, size=3)        # (a texel just inside the outline still counts as seen)

    def weights_colours(self, p, n, tol=0.012):
        nd = n @ self.d
        w = np.clip(nd, 0, 1) ** self.power * self.prio
        if self.floor:
            s = np.clip((nd - self.floor) / 0.2, 0, 1)
            w *= s * s * (3 - 2 * s)                  # (a picture smeared along the steep sides: none of it there)
        if self.band:
            s = np.clip(1 - np.abs(n[:, 2]) / self.band, 0, 1)
            w *= s * s * (3 - 2 * s)
        sel = np.nonzero(w > 1e-4)[0]
        col = np.zeros((len(p), 3), np.float32)
        if not len(sel):
            return np.zeros(len(p), np.float32), col
        ps = p[sel]
        xy = self.vp.pix(ps)
        ix = np.clip(xy[:, 0].astype(int), 0, self.vp.W - 1); iy = np.clip(xy[:, 1].astype(int), 0, self.vp.H - 1)
        vis = (ps @ self.d) >= self.zb[iy, ix] - tol
        q = self.ip.pix(ps)
        ok = sample(self.valid, q) if self.valid is not None else 1.0
        if self.warp is not None:
            du = sample(np.moveaxis(self.warp, 0, -1), q)
            q = q + du[:, ::-1]
        col[sel] = sample(self.rgb, q)
        mk = np.clip((sample(self.mask, q) - 0.5) * 2.2, 0, 1)
        out = np.zeros(len(p), np.float32)
        out[sel] = w[sel] * vis * mk * ok
        return out, col


def make_views(kind, v, f, art, views, pic, fp, k, lut, dbg=None):
    """the bake's views: the picture on the front, the sheet's views round the sides and the back. Weights: how squarely
    the surface faces each view (cos^4), the picture x9 — it is the user's own art, so it holds up to ~60 deg off the
    front (where the shader's full-size picture hands over to the atlas), the sheet's views beyond"""
    from scipy import ndimage as ndi
    rgbP, alP = pic_in_plane(pic, fp)
    out = [BakeView('front', (0, 0, 1), fp, fp, rgbP, alP, power=4.0, prio=9.0, floor=0.2)]

    def sheet_view(name, d, r, mirror_of=None):
        rgb, m, mt = views[name]
        rgb = apply_lut(rgb, lut)
        pl = Plane.around(v, d, r, margin=60)
        S = pl.mask(v, f)
        q, ox, oy, sx, sy = place(m, k, S)
        T = placed(m.astype(np.float32), S.shape, ox, oy, sx, sy, cval=0) > 0.5
        u = demons(S, T, its=(70, 50, 40), sig=(3.5, 3.0, 2.5))
        T2 = warp_mask(T, u)
        print(f'  {name}: placed iou {q:.3f} (scale {sx / k:.3f}) -> warped {iou(T2, S):.3f}')
        img = placed(rgb, S.shape, ox, oy, sx, sy)
        mk = placed(ndi.binary_erosion(mt, iterations=1).astype(np.float32), S.shape, ox, oy, sx, sy, cval=0)
        # a part of the mesh well outside what the sheet shows there (the mouse's raised tail: the sheet draws it on the
        # floor) gets no colours stretched over from its neighbours — the picture and the fill colour it
        tol = 0.03 * S.shape[0]
        far = ndi.distance_transform_edt(~T)
        valid = np.clip(1 - (far - tol) / 8.0, 0, 1).astype(np.float32)
        # nor where the warp squeezes or stretches the sheet a lot: there the sheet draws that part differently (the
        # mouse's ear turned toward the viewer, a hat's brim wider than the mesh's) and its colours came out as streaks
        valid *= warp_trust(u)
        if dbg is not None:
            dbg['view_' + name] = (T, S, T2, img, u)
        return pl, img, mk, u, valid

    if kind in SIDE_ON:
        if 'ends' not in SHEET_SKIP.get(kind, ()):
            pl, img, mk, u, ok = sheet_view('head', (-1, 0, 0), (0, 0, 1))
            out.append(BakeView('head', (-1, 0, 0), pl, pl, img, mk, u, power=4.0, valid=ok))
            pl, img, mk, u, ok = sheet_view('tail', (1, 0, 0), (0, 0, -1))
            out.append(BakeView('tail', (1, 0, 0), pl, pl, img, mk, u, power=4.0, valid=ok))
        # the other flank: the picture itself, seen from behind (mirrored); a letter there flipped back to read right
        rgbB = rgbP.copy()
        box = FLANK_LETTER.get(kind)
        if box:
            rgbB = flip_letter(rgbB, alP, box, fp.margin)
        back = Plane.around(v, (0, 0, -1), (-1, 0, 0), margin=24)
        out.append(BakeView('flank', (0, 0, -1), back, fp, rgbB, alP, power=4.0, prio=9.0, floor=0.2))
        if 'ends' in SHEET_SKIP.get(kind, ()):
            # no face-on view (the turtle's): the narrow band down the middle of the face, which neither flank sees
            # squarely, takes the picture straight across — both halves meet there on the same pixels (the profile's
            # edge), so the smile runs on through the middle instead of a seam or a smudge where they met
            mid = Plane.around(v, (-1, 0, 0), (0, 0, 1), margin=24)
            amid = ndi.binary_dilation(alP > 0.5, iterations=4).astype(np.float32)   # (it lands on the very edge)
            # (from a few pixels inside the profile, softened along it: the outline's own fuzz and rim shading,
            # stretched across, came out as stripes. And without the nostril: it sits right on the profile's edge, and
            # stretched across the middle it made a dark bar over the snout — small dark blots near the edge are
            # painted over with the skin round them; the smile, long, stays)
            rgbN = rgbP.copy()
            import cv2
            A5 = alP > 0.5
            lum = rgbP.mean(-1)
            dark = A5 & (ndi.distance_transform_edt(A5) < 26) & (lum < ndi.median_filter(lum, 25) - 0.07)
            lab, nb = ndi.label(ndi.binary_dilation(dark, iterations=1))
            blot = np.zeros_like(dark)
            for i, sl in enumerate(ndi.find_objects(lab)):
                if sl is not None and sl[0].stop - sl[0].start <= 24 and sl[1].stop - sl[1].start <= 16:
                    blot[sl] |= lab[sl] == i + 1
            if blot.any():
                u8 = (np.clip(rgbP, 0, 1) * 255).astype(np.uint8)
                rgbN = cv2.inpaint(u8, ndi.binary_dilation(blot, iterations=2).astype(np.uint8) * 255, 6, cv2.INPAINT_TELEA).astype(np.float32) / 255
            rgbM = np.empty_like(rgbN); rgbM[:, :-6] = rgbN[:, 6:]; rgbM[:, -6:] = rgbN[:, -6:]
            rgbM = np.stack([ndi.gaussian_filter(rgbM[..., c], (3.0, 1.0)) for c in range(3)], -1)
            out.append(BakeView('mid', (-1, 0, 0), mid, fp, rgbM, amid, power=1.0, prio=1.0, band=0.32))
    else:
        pl, img, mk, u, ok = sheet_view('side', (1, 0, 0), (0, 0, -1))
        out.append(BakeView('side', (1, 0, 0), pl, pl, img, mk, u, power=4.0, valid=ok))
        pl2 = Plane.around(v, (-1, 0, 0), (0, 0, 1), margin=24)
        out.append(BakeView('side2', (-1, 0, 0), pl2, pl, img, mk, u, power=4.0, prio=0.8, valid=ok))
        pl, img, mk, u, ok = sheet_view('back', (0, 0, -1), (-1, 0, 0))
        out.append(BakeView('back', (0, 0, -1), pl, pl, img, mk, u, power=4.0, valid=ok))
    for bv in out:
        bv.prepare(v, f)
    return out


def flip_letter(rgb, al, box, margin):
    """the letter inside box (picture px) mirrored about its own middle, the original spot filled with the body"""
    import cv2
    from scipy import ndimage as ndi
    x0, y0, x1, y1 = (int(t) + margin for t in box)
    patch = rgb[y0:y1, x0:x1].copy()
    hsv = cv2.cvtColor((np.clip(patch, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    letter = (hsv[..., 0] > 5) & (hsv[..., 0] < 35) & (hsv[..., 1] > 90)
    lab, n = ndi.label(letter)
    if n:
        letter = lab == 1 + np.argmax(ndi.sum(letter, lab, range(1, n + 1)))
    letter = ndi.binary_dilation(letter, iterations=2)
    filled = cv2.inpaint((np.clip(patch, 0, 1) * 255).astype(np.uint8), letter.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA).astype(np.float32) / 255
    fl = letter[:, ::-1]
    filled[fl] = patch[:, ::-1][fl]
    out = rgb.copy()
    out[y0:y1, x0:x1] = filled
    return out


def bake(v, f, n, views, res=1024, pad=8, dbg=None):
    """UV atlas (xatlas) + the texture: every texel's colour from the views that see it squarely, what none sees filled
    from around it (over the mesh), the empty atlas around the charts filled with the nearest chart colour.
    pad: texels between the charts — 8, not 4: the game draws the atlas mip-mapped, and at a quarter size two charts
    4 texels apart already ran into each other (thin lines of a neighbouring part's colour along the seams)"""
    import xatlas
    from scipy import ndimage as ndi
    from scipy.spatial import cKDTree
    import scipy.sparse as sp
    atlas = xatlas.Atlas()
    atlas.add_mesh(v.astype(np.float32), f.astype(np.uint32))
    co = xatlas.ChartOptions()
    co.max_iterations = 4
    po = xatlas.PackOptions()
    po.resolution = res; po.padding = pad; po.bilinear = True; po.rotate_charts = True
    atlas.generate(co, po)
    vmap, idx, uv = atlas[0]
    print(f'  atlas: {atlas.chart_count} charts, {len(vmap)} verts (was {len(v)}), utilisation {float(np.ravel(atlas.utilization)[0]):.2f}')
    # which way each part faces, for the views' weights: from a smoothed copy — with the mesh's own lumpy normals the
    # hand-over from one view to the next followed every bump, a jagged, torn-looking edge wherever the two views
    # disagree a little (the mouse's and the monkey's shirt hems at the side)
    n = smooth_normals(v, f)

    def colours(p, nn, bary_tri):
        """bary_tri: (barycentrics, triangle corners in vmap'd vertices) to interpolate per-vertex trust, or None (p are
        the vertices themselves)"""
        acc = np.zeros((len(p), 3), np.float32); ws = np.zeros(len(p), np.float32)
        for bv in views:
            w, c = bv.weights_colours(p, nn)
            tv = getattr(bv, 'trust_v', None)
            if tv is not None:
                w = w * (tv if bary_tri is None else (bary_tri[0] * tv[vmap][bary_tri[1]]).sum(1))
            acc += w[:, None] * c; ws += w
        return acc, ws

    E = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    Adj = sp.coo_matrix((np.ones(len(E) * 2), (np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]])), shape=(len(v),) * 2).tocsr()
    Adj.data[:] = 1
    deg = np.asarray(Adj.sum(1)).ravel()

    def diffuse(val, a, its=200):
        """val kept where a = 1, spread from there over the mesh where a = 0 (soft in between)"""
        out = val.copy()
        for _ in range(its):
            nb = (Adj @ out) / np.maximum(deg, 1)[:, None]
            out = a * val + (1 - a) * nb
        return out

    # the mirrored side view is the other side only if the friend is the same on both sides: where it disagrees with
    # what the picture and the back view show there (the calico cat's patches: brown on one side, yellow on the other),
    # it is trusted less — over the whole patch, spread from where they meet — and the picture/back/fill take over
    mir = [bv for bv in views if bv.name == 'side2']
    if mir:
        bm = mir[0]
        w2, c2 = bm.weights_colours(v, n)
        acc_r = np.zeros((len(v), 3), np.float32); w_r = np.zeros(len(v), np.float32)
        for bv in views:
            if bv.name in ('front', 'back'):
                w, c = bv.weights_colours(v, n)
                acc_r += w[:, None] * c; w_r += w
        both = (w2 > 0.01) & (w_r > 0.01)
        cr = acc_r / np.maximum(w_r, 1e-6)[:, None]
        for _ in range(4):                          # compare patches, not pixels (a little misregistration is fine)
            c2 = np.where(both[:, None], ((Adj @ (c2 * both[:, None])) + c2) / (Adj @ both.astype(np.float64) + 1)[:, None], c2)
            cr = np.where(both[:, None], ((Adj @ (cr * both[:, None])) + cr) / (Adj @ both.astype(np.float64) + 1)[:, None], cr)
        dist = np.linalg.norm(c2 - cr, axis=1)
        tr = np.clip(1 - (dist - 0.16) / 0.14, 0, 1)
        known = both.astype(np.float64)[:, None]
        trust = diffuse(np.where(both, tr, 1.0)[:, None], known, 300)[:, 0]
        bm.trust_v = trust
        print(f'  mirrored side: distrusted on {(trust < 0.5).mean():.0%} of the mesh')

    # what no view sees well: filled over the mesh from the vertices around it — from their patch colours (a median over
    # the neighbourhood), so an eye or a line next to an unseen bit doesn't run into it as a smudge
    acc, ws = colours(v, n, None)
    vc = acc / np.maximum(ws, 1e-6)[:, None]
    known = ws > 0.15
    med = vc.copy()
    ip, ix_ = Adj.indptr, Adj.indices
    for _ in range(2):
        nxt = med.copy()
        for i in range(len(v)):
            nb_ = ix_[ip[i]:ip[i + 1]]
            nb_ = nb_[known[nb_]]
            if known[i] and len(nb_) >= 2:
                nxt[i] = np.median(np.vstack([med[nb_], med[i:i + 1]]), 0)
        med = nxt
    fill = np.where(known[:, None], med, med[known].mean(0) if known.any() else vc.mean(0))
    fill = diffuse(fill, np.clip(ws / 0.15, 0, 1)[:, None])
    # texels
    ft = idx.astype(np.int64)
    P = np.stack([uv[:, 0] * res, (1 - uv[:, 1]) * res], 1)
    fid, bary = raster(P, ft, res, res)
    on = fid >= 0
    tri = ft[fid[on]]
    b = bary[on]
    vv, nn, ff = v[vmap], n[vmap], fill[vmap]
    p = (b[:, :, None] * vv[tri]).sum(1)
    nrm = (b[:, :, None] * nn[tri]).sum(1)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1), 1e-9)[:, None]
    fb = (b[:, :, None] * ff[tri]).sum(1)
    acc, ws = colours(p, nrm, (b, tri))
    W0 = 0.04
    # what no view sees well, texel by texel (the vertex fill alone is coarse: a smudge down the middle of the turtle's
    # face, between the picture and its mirror): the colours of the nearest texels that are seen and face about the
    # same way — a median, so an eye or a line beside it doesn't run in; deeper in, from a wider ring of them, so it
    # stays smooth instead of streaking out from the nearest one
    kn = ws > 0.12
    need = np.nonzero(ws < 0.8)[0]
    if kn.sum() > 50 and len(need):
        kc = (acc[kn] / ws[kn, None]).astype(np.float32)
        kp, kq = p[kn], nrm[kn]
        t1 = cKDTree(kp)
        sub = np.random.default_rng(0).choice(len(kp), size=max(50, min(len(kp), len(kp) // 16)), replace=False)
        t2 = cKDTree(kp[sub])
        kd = np.zeros((len(need), 3), np.float32); dm = np.zeros(len(need), np.float32)
        for s0 in range(0, len(need), 60000):
            qi = need[s0:s0 + 60000]
            d1, i1 = t1.query(p[qi], k=12)
            d2, i2 = t2.query(p[qi], k=24)
            D = np.concatenate([d1, d2], 1); I = np.concatenate([i1, sub[i2]], 1)
            d0 = D.min(1, keepdims=True)
            wg = np.exp(-((D - d0) / (1.5 * d0 + 0.004)) ** 2) * np.clip((nrm[qi, None, :] * kq[I]).sum(-1) + 0.3, 0.02, 1)
            kd[s0:s0 + len(qi)] = wmedian(kc[I], wg)
            dm[s0:s0 + len(qi)] = d0[:, 0]
        cf = np.exp(-(dm / 0.12) ** 2)[:, None]
        fb[need] = cf * kd + (1 - cf) * fb[need]
    col = (acc + W0 * fb) / (ws + W0)[:, None]
    img = np.zeros((res, res, 3), np.float32)
    img[on] = col
    _, (iy, ix) = ndi.distance_transform_edt(~on, return_indices=True)
    img = img[iy, ix]
    if dbg is not None:
        seen = np.zeros((res, res), np.float32); seen[on] = np.clip(ws, 0, 1)
        dbg['atlas'] = (img, seen)
        # which view gave each texel its colour (grey: the fill)
        VC = {'front': (1, .3, .3), 'side': (.25, .8, .25), 'side2': (.1, .45, .1), 'back': (.25, .35, 1),
              'head': (1, .8, 0), 'tail': (.8, 0, .8), 'flank': (1, .6, .6), 'mid': (0, 1, 1)}
        vm = np.zeros((len(p), 3), np.float32); wsum = np.zeros(len(p), np.float32)
        for bv in views:
            w_, _ = bv.weights_colours(p, nrm)
            tv = getattr(bv, 'trust_v', None)
            if tv is not None:
                w_ = w_ * (b * tv[vmap][tri]).sum(1)
            vm += w_[:, None] * np.array(VC.get(bv.name, (1, 1, 1)), np.float32); wsum += w_
        vm = (vm + W0 * 0.5) / (wsum + W0)[:, None]
        vimg = np.zeros((res, res, 3), np.float32); vimg[on] = vm
        dbg['viewmap'] = vimg[iy, ix]
    return vmap, idx, uv, img


def build(kind, art, res, target, sheets=None, dbg=None):
    import trimesh
    a = art[kind]
    w, h, u = a['w'] * PX, a['h'] * PX, a['head'][0]
    gy = (1 - a['head'][1]) * h
    v, f, c, pic = base_mesh(kind, art, res)
    views = sheet_views(kind, sheets)
    pa = np.asarray(pic).astype(np.float32)
    W, H = pa.shape[1], pa.shape[0]
    if views:
        fp = front_plane(art, kind)
        _, al = pic_in_plane(pic, fp)
        A = al > 0.5
        v = fit_front(v, f, A, fp, dbg)
        # the sheet's scale: its front view laid on the picture (the same render for the friends seen from the front)
        fm = views['front'][1]
        k0 = (np.nonzero(A.any(1))[0].ptp() + 1) / (np.nonzero(fm.any(1))[0].ptp() + 1)
        q, ox, oy, sx, sy = place(fm, k0, A, (0.92, 1.08), 33)
        k = (sx + sy) / 2 if kind not in SIDE_ON else k0     # (side-on: a different render — trust the height)
        print(f'  sheet front on the picture: iou {q:.3f}, scale {(sx + sy) / 2:.3f} (height ratio {k0:.3f})')
        # its colours brought to the picture's: the same pixels where the two are the same render, else quantiles
        Sf = placed(views['front'][0], A.shape, ox, oy, sx, sy)
        Sm = placed(fm.astype(np.float32), A.shape, ox, oy, sx, sy, cval=0) > 0.5
        rgbP, _ = pic_in_plane(pic, fp)
        from scipy import ndimage as ndi
        both = ndi.binary_erosion(A & Sm, iterations=4)
        if kind in SIDE_ON:
            lut = colour_lut(views['front'][0][views['front'][1]], rgbP[ndi.binary_erosion(A, iterations=3)], by_quantile=True)
        else:
            g = ndi.gaussian_gradient_magnitude(rgbP.mean(-1), 1.5)
            both &= g < np.quantile(g[both], 0.7)
            lut = colour_lut(Sf[both], rgbP[both])
        skip = SHEET_SKIP.get(kind, ())
        if 'depth' not in skip:
            v = fit_depth(v, f, views, k, kind, h, dbg)
        if kind in SIDE_ON:
            v = centre_flank(v, f, fp)
        if kind not in SIDE_ON and 'tails' not in skip:
            v, f = add_tails(v, f, views, k, h, gy, dbg)
        v = recentre(v, gy, h)
    else:
        print('  (no character sheet: guessed colours round the back)')
    v0 = v
    v, f = decimate(v, f, target or (9000 if views else 6000))   # (textured from a sheet: finer, for sharp outlines)
    if not views:
        from scipy.spatial import cKDTree
        c = c[cKDTree(v0).query(v)[1]]
    if views:
        v, moved = push_inside(v, A, fp)
        print(f'  pulled inside the outline: {moved} verts')
    m = trimesh.Trimesh(v, f, process=False)
    m.fix_normals()
    v, f = np.asarray(m.vertices, np.float64), np.asarray(m.faces, np.int32)
    n = np.asarray(m.vertex_normals, np.float64)
    fw = front_weight(m, sharp=True) if views else front_weight(m)     # (atlas: the shader adds the facing, by the view)
    if views:
        bvs = make_views(kind, v, f, art, views, pic, fp, k, lut, dbg)
        # added parts (tails) take their colours from the side views and around them, not from the back view: seen from
        # behind they sit in front of the body, and the back view would paint the body's colour (the shirt) on them
        comp = trimesh.graph.connected_component_labels(trimesh.Trimesh(v, f, process=False).face_adjacency, len(f))
        main = np.bincount(comp).argmax()
        extra = np.zeros(len(v), bool)
        extra[f[comp != main].ravel()] = True
        for bv in bvs:
            if bv.name == 'back' and extra.any():
                bv.trust_v = (~extra).astype(np.float64)
        vmap, idx, uv, tex = bake(v, f, n, bvs, dbg=dbg)
        print(f'  {len(v)} verts, {len(f)} tris, front {fw.mean():.2f}, depth {v[:, 2].max() - v[:, 2].min():.2f} '
              f'(w {w:.2f} h {h:.2f})')
        return {'v': v[vmap], 'f': idx.astype(np.int64), 'fw': fw[vmap], 'uv': uv, 'tex': tex}
    # TripoSR's colours come out duller than the art (the cow's white back looked grey): fit them to the picture where
    # both are seen — per channel gain and offset over the front vertices — and apply that to every vertex
    uu = np.clip(((v[:, 0] / w + u) * W).astype(int), 0, W - 1)
    vv = np.clip(((1 - v[:, 1] / h) * H).astype(int), 0, H - 1)
    sel = (fw > 0.8) & (pa[vv, uu, 3] > 200)
    cf = c.astype(np.float32)
    if sel.sum() > 50:
        for ch in range(3):
            x, y = cf[sel, ch], pa[vv[sel], uu[sel], ch]
            g = np.clip(np.std(y) / max(np.std(x), 1e-3), 0.85, 1.45)
            o = np.mean(y) - g * np.mean(x)
            cf[:, ch] = cf[:, ch] * g + o
        c = np.clip(cf, 0, 255).astype(np.uint8)
    print(f'  {len(v)} verts, {len(f)} tris, front {fw.mean():.2f}, depth {v[:, 2].max() - v[:, 2].min():.2f} '
          f'(w {w:.2f} h {h:.2f})')
    return {'v': v, 'f': f, 'fw': fw, 'c': c}


def pack(r, quality=86):
    v, f, fw = r['v'], r['f'], r['fw']
    lo, hi = v.min(0), v.max(0)
    q = np.round((v - lo) / np.maximum(hi - lo, 1e-6) * 65535).astype('<u2')
    b = lambda arr: base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()
    out = {'n': int(len(v)), 'm': int(f.size), 'lo': [round(float(x), 5) for x in lo], 'hi': [round(float(x), 5) for x in hi],
           'pos': b(q), 'fw': b(np.round(np.clip(fw, 0, 1) * 255).astype(np.uint8)), 'idx': b(f.astype('<u2'))}
    if 'c' in r:
        out['col'] = b(r['c'].astype(np.uint8))
    if 'uv' in r:
        out['uv'] = b(np.round(np.clip(r['uv'], 0, 1) * 65535).astype('<u2'))
        buf = io.BytesIO()
        Image.fromarray(np.clip(r['tex'] * 255 + 0.5, 0, 255).astype(np.uint8)).save(buf, 'WEBP', quality=quality, method=6)
        out['tex'] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
    return out


def main():
    import eyes as eyes_stage                       # tools/eyes.py (the friends' new eyes, build side)
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--res', type=int, default=256)
    ap.add_argument('--target', type=int, default=0, help='triangles (default 9000 with a sheet, else 6000)')
    ap.add_argument('--sheets', default=os.path.join(ROOT, 'design', 'sheets'))
    ap.add_argument('--debug', default='')
    o = ap.parse_args()
    art = load_art()
    kinds = [k for k in art if not o.only or k in o.only.split(',')]
    path = os.path.join(ROOT, 'js', 'friends-3d.js')
    data = {}
    if os.path.exists(path):                        # keep the friends not rebuilt this time
        s = open(path, encoding='utf-8').read()
        mt = re.search(r'=\s*(\{.*\});?\s*$', s, re.S)
        if mt:
            data = json.loads(mt.group(1))
    for k in kinds:
        print(k)
        dbg = {} if o.debug else None
        r = build(k, art, o.res, o.target, o.sheets, dbg)
        eyes_stage.post_bake(k, r, art)             # (tools/eyes.py: no painted eyes left on the atlas by js/eyes.js's domes)
        assert len(r['v']) < 65536
        data[k] = pack(r)
        print(f'  packed {sum(len(x) for x in data[k].values() if isinstance(x, str)) // 1024} KB')
        if dbg:
            save_debug(o.debug, k, dbg)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('/* generated by tools/make_3d.py — do not edit: the friends\' 3D shapes (TripoSR, made locally from the\n'
                 '   pictures; with a character sheet, fitted to its outlines and textured from its views). Per friend:\n'
                 '   n vertices, m indices, lo/hi box, pos (uint16 in the box), fw (uint8 front weight: shows the picture),\n'
                 '   idx (uint16 triangles); then either col (rgb8, the guessed colours behind) or uv (uint16 atlas coords)\n'
                 '   + tex (the atlas, a webp data URL). */\n')
        fh.write('window.CLAW_FRIENDS_3D = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')


def save_debug(d, kind, dbg):
    os.makedirs(d, exist_ok=True)

    def ov(T, A, B):
        """target T grey; A only red, B only blue... as 3 panels: before (A vs T), after (B vs T)"""
        def one(X):
            im = np.full(T.shape + (3,), 255, np.uint8)
            im[T & X] = (160, 160, 160); im[X & ~T] = (230, 40, 40); im[T & ~X] = (40, 90, 230)
            return im
        return np.concatenate([one(A), np.full((T.shape[0], 6, 3), 0, np.uint8), one(B)], 1)

    for key in ('front', 'side'):
        if key in dbg:
            Image.fromarray(ov(*dbg[key])).save(os.path.join(d, f'{kind}_{key}.png'))
    for key, val in dbg.items():
        if key.startswith('view_'):
            T, S, T2, img, u = val
            a = ov(S, T, T2)
            im = (np.clip(img, 0, 1) * 255).astype(np.uint8)
            Image.fromarray(np.concatenate([a, np.full((S.shape[0], 6, 3), 0, np.uint8), im], 1)).save(os.path.join(d, f'{kind}_{key}.png'))
    if 'atlas' in dbg:
        img, seen = dbg['atlas']
        Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(os.path.join(d, f'{kind}_atlas.png'))
        Image.fromarray((seen * 255).astype(np.uint8)).save(os.path.join(d, f'{kind}_seen.png'))
    if 'viewmap' in dbg:
        Image.fromarray((np.clip(dbg['viewmap'], 0, 1) * 255).astype(np.uint8)).save(os.path.join(d, f'{kind}_viewmap.png'))


if __name__ == '__main__':
    main()
