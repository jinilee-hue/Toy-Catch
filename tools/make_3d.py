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
TSG_DIR = os.path.expanduser('~/dev/tools/TripoSG')        # (TripoSG, MIT: its own venv; tools/tsg_mesh.py runs it)
OUT_TSG = os.path.join(TSG_DIR, 'out')
RESR_MODEL = os.path.expanduser('~/dev/tools/realesrgan/RealESRGAN_x4plus.pth')
RESR_OUT = os.path.expanduser('~/dev/tools/realesrgan/out')
PX = 1.3 / 600                                   # friends.js: a 600-px-tall picture is 1.3 units tall
DEPTH_K = 0.92                                   # a touch slimmer than TripoSR's guess (plush, not a ball)
GRIP_Z = -0.02                                   # the head's middle (depth) at the grip height: the claw's prongs' plane
# TripoSG's frame -> ours (rows: our x, y, z in TripoSG's axes): found once by rendering its turkey from the 6 axes
# friends whose sheet views agree with the picture's pose (the turkey's rainbow wing reads the same on both): no
# distrust of the sheet next to the picture (bake), which would flatten its feathers into one colour
CONSIST_SKIP = ('turkey',)
KIND_NOW = ''
TURN_NOW = False                                 # (this friend is built from the user's turnaround)
# two fabrics of one hue told apart by lightness: the turtle's light-green head and darker shell, the fish's pale
# head and blue body (merged, the head took the shell's green all round)
MERGE_LUM = {'turtle': 1.5, 'fish': 1.5}
# the dog's cream chest in shade (#b79680) is the cream fabric (else a grey-tan patch down its back)
MERGE_CH = {'dog': 8}
# per friend, which source places the fabrics round the back: the seal's MV views guessed a yellow jacket back (the
# sheet draws it blue) — the sheet's labels for it
TEX_KIND = {'seal': 'clean'}
MV_TRUST = float(os.environ.get('TC_MVT', 9))     # (Lab distance, L x 0.6: an MV region this far from every picture colour is left out)
SEAM_SMOOTH = int(os.environ.get('TC_SEAM', 40))      # (diffusion rounds for the fabric seams on the fine mesh)
ISLAND = 0.002                                   # (patches smaller than this share of the surface are absorbed)
# side-on friends: MV-Adapter draws a face on the head-on end (a smile band, eye whites) the picture never shows
ISLAND_K = {'turtle': 0.015, 'fish': 0.012}
ART_NOW = None
# friends whose fan (design/parts/ masks, from tools/parts_sam.py) takes its back from its own feather tips in the
# picture — along the surface, each lobe the colour of its tip — not from the sheet, whose fan isn't TripoSG's
FAN_PARTS = {'turkey': ('fan_l', 'fan_r')}
SHEET_FIG = {}
TEX_MODE = os.environ.get('TC_TEX', 'mvlabel')     # mvlabel: MV-Adapter views place the picture's fabrics; clean: the sheet does; mv: MV colours as painted; sheet: the old bake
TRIS = 18000                                     # triangles per friend (with a sheet)
TSG_R = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]], np.float32)

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
                         ('side', (0.64, 0.10, 1.0, 0.93), 'fan', True),
                         ('back', (0.36, 0.0, 0.64, 0.62), 'green', False)],
              'mouse': [('back', (0.38, 0.82, 1.0, 1.0), 'pink', True),
                        ('side', (0.45, 0.78, 1.0, 1.0), 'pink', True),
                        ('side', (0.10, 0.62, 0.21, 0.78), 'light', False),
                        # the sheet's side view hangs the arm down the flank (paw by the hip) where the picture holds
                        # the paws up at the chest: painted on, it was a second, ghost arm
                        ('side', (0.33, 0.50, 0.64, 0.90), 'notshirt', False),
                        # its ear turned to the viewer shows the pink inside, which landed on the ear's back
                        ('side', (0.30, 0.0, 0.70, 0.34), 'pinkear', False)],
              # the shirt's letter seen edge-on from the side: a white stripe that the warp laid along the arm
              'monkey': [('side', (0.18, 0.58, 0.36, 0.84), 'white', False)],
              # the cat's tail curled up its back (the back view): the mesh has no tail there, painted on it was a
              # yellow-and-brown stripe down the shirt
              'cat': [('back', (0.36, 0.45, 0.62, 0.95), 'cattail', False)],
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


def tsg_mesh(kind):
    """TripoSG: picture -> (vertices, faces) in its own frame, cached in ~/dev/tools/TripoSG/out (tools/tsg_mesh.py
    runs it in TripoSG's own venv: diffusers/transformers there would clash with TripoSR's)"""
    cache = os.path.join(OUT_TSG, f'{kind}.npz')
    if not os.path.exists(cache):
        import subprocess
        subprocess.run([os.path.join(TSG_DIR, '.venv', 'bin', 'python'), os.path.join(ROOT, 'tools', 'tsg_mesh.py'), kind],
                       check=True)
    z = np.load(cache)
    return z['v'].astype(np.float32), z['f'].astype(np.int32)


def solidify(v, f, res=int(os.environ.get("TC_VRES", 600)), sigma=float(os.environ.get("TC_VSIG", 1.6)), its=int(os.environ.get("TC_VITS", 20))):
    """the raw TripoSG mesh rebuilt as one clean, closed, smooth surface: its triangles sampled into a voxel grid
    (res cells along the longest side), the shell closed and filled, the solid blurred a little and its surface taken
    again (marching cubes at the half level). TripoSG's own surface had cracks and pits (dark slits on the duck's head
    and round its cap), the 'terrace' rings of marching cubes on a saturated field, and thousands of loose inner
    shells; seen turning (the prize spin) they all showed"""
    import trimesh
    from scipy import ndimage as ndi
    from skimage.measure import marching_cubes
    m = trimesh.Trimesh(v, f, process=False)
    lo, hi = v.min(0), v.max(0)
    cell = (hi - lo).max() / res
    pad = 6
    shape = np.ceil((hi - lo) / cell).astype(int) + 2 * pad + 1
    n = int(min(8e6, max(2e6, m.area / cell ** 2 * 6)))
    pts, _ = trimesh.sample.sample_surface(m, n, seed=0)
    pts = np.vstack([pts, v])
    ijk = np.floor((pts - lo) / cell).astype(int) + pad
    shell = np.zeros(shape, bool)
    shell[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    for d in (1, 2, 3):
        sh = ndi.binary_dilation(shell, iterations=d) if d > 1 else ndi.binary_dilation(shell)
        solid = ndi.binary_fill_holes(sh)
        filled = solid.sum() / max(1, sh.sum())
        if filled > 2.5:                               # (the inside got filled: the shell was closed at this size)
            break
    # (the dilation made it a little fatter: thinned back by as much)
    solid = ndi.binary_erosion(solid, iterations=d) | (solid & ~ndi.binary_erosion(solid, iterations=d) & False)
    occ = ndi.gaussian_filter(solid.astype(np.float32), sigma)
    vv, ff, _, _ = marching_cubes(occ, 0.5)
    vv = (vv - pad + 0.5) * cell + lo
    mm = trimesh.Trimesh(vv, ff[:, ::-1], process=True)
    parts = mm.split(only_watertight=False)
    if len(parts) > 1:
        big = max(len(p.faces) for p in parts)
        mm = trimesh.util.concatenate([p for p in parts if len(p.faces) >= 0.02 * big])
    trimesh.smoothing.filter_taubin(mm, lamb=0.5, nu=-0.53, iterations=its)
    print(f'  solidified: {res} cells, dilation {d} (fill x{filled:.1f}), {len(mm.faces)} tris')
    return np.asarray(mm.vertices, np.float32), np.asarray(mm.faces, np.int32)


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


TURN_DIR = os.path.join(ROOT, 'design', 'turnaround')
# which turnaround image is which view (the user's turnarounds, design/turnaround/<kind>/: front, left, back, right —
# 'left' is the character's left side, seen from +x). Side-on friends (picture = a side view, head toward -x): their
# 'left' is the picture's side, 'front' faces the head, 'back' the tail, 'right' the far flank
TURN_MAP = {'front': 'front', 'side': 'left', 'back': 'back', 'side2': 'right'}
TURN_NO_TAILS = ('mouse', 'duck')
TURN_MAP_SIDE = {'front': 'left', 'head': 'front', 'tail': 'back', 'flank': 'right'}


def turn_views(kind):
    """{view: (rgb bled past the outline, mask, texture mask)} from the user's turnaround (user: same pose as the game
    picture from every side, made to measure), or None"""
    from scipy import ndimage as ndi
    d = os.path.join(TURN_DIR, kind)
    mp = TURN_MAP_SIDE if kind in SIDE_ON else TURN_MAP
    if not all(os.path.exists(os.path.join(d, f'{f}.png')) for f in mp.values()):
        return None
    def flat_white(rgb, m):
        lum = rgb.mean(-1)
        sd = np.sqrt(np.maximum(ndi.uniform_filter(lum ** 2, 7) - ndi.uniform_filter(lum, 7) ** 2, 0))
        return m & (rgb.min(-1) > 0.93) & (rgb.max(-1) - rgb.min(-1) < 0.04) & (sd < 0.012)
    pa = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp')).convert('RGBA')).astype(np.float32) / 255
    pm = pa[..., 3] > 0.5
    white_fabric = flat_white(pa[..., :3], pm).sum() > 0.03 * pm.sum()     # (the cow: white is its fabric)
    out = {}
    for name, fname in mp.items():
        a = np.asarray(Image.open(os.path.join(d, f'{fname}.png')).convert('RGBA')).astype(np.float32) / 255
        al = a[..., 3]
        m = al > 0.5
        # the background left opaque in the gaps between an arm, the body and a leg (the cut-out kept them): flat pure
        # white blobs, unless white is the friend's own fabric — as texture they were white patches under the arms
        if not white_fabric:
            fw_ = flat_white(a[..., :3], m)
            lab_, n_ = ndi.label(fw_)
            if n_:
                sz = ndi.sum(fw_, lab_, range(1, n_ + 1))
                m = m & ~ndi.binary_dilation(np.isin(lab_, 1 + np.nonzero(sz > 150)[0]), iterations=3)
        # side-on friends (turtle, fish): the painted eyes in the turnaround sit beside the new eye domes, never on
        # them — a second eye. Near-black compact blobs (iris, pupil) and the white round them are left out
        eye_cut = np.zeros_like(m)
        if kind in SIDE_ON:
            rgb_ = a[..., :3]
            dark = m & (rgb_.mean(-1) < 0.45) & (rgb_.max(-1) - rgb_.min(-1) < 0.35)
            white = m & (rgb_.min(-1) > 0.80) & (rgb_.max(-1) - rgb_.min(-1) < 0.12)
            wl, wn = ndi.label(white)
            lab_, n_ = ndi.label(dark)
            for i, sl_ in enumerate(ndi.find_objects(lab_)):
                if sl_ is None:
                    continue
                pad = 8
                sl2 = (slice(max(0, sl_[0].start - pad), sl_[0].stop + pad), slice(max(0, sl_[1].start - pad), sl_[1].stop + pad))
                r_ = lab_[sl2] == i + 1
                if r_.sum() < 100:
                    continue
                ring = ndi.binary_dilation(r_, iterations=6) & ~r_
                wr = white[sl2] & ring
                if wr.sum() < 0.15 * ring.sum():        # (an eye: dark iris with its white round it)
                    continue
                eye = np.zeros_like(m); eye[sl2] = r_
                for L in np.unique(wl[sl2][wr]):
                    if L:
                        eye |= wl == L
                hh = sl_[0].stop - sl_[0].start; ww = sl_[1].stop - sl_[1].start
                eye_cut |= ndi.binary_dilation(eye, iterations=int(0.25 * max(hh, ww)) + 6)
            eye_cut &= m
        lab, n = ndi.label(m)
        if n > 1:                                      # (the figure, not stray specks)
            sizes = ndi.sum(m, lab, range(1, n + 1))
            m = lab == 1 + int(np.argmax(sizes))
        ys, xs = np.nonzero(m)
        sl = (slice(max(0, ys.min() - 2), ys.max() + 3), slice(max(0, xs.min() - 2), xs.max() + 3))
        m = m[sl]
        rgb = a[sl][..., :3]
        # (the anti-aliased rim and the white fringe round see-through gaps — between an arm and the body — are not for
        # the texture: white specks at the monkey's hips)
        holes = ndi.binary_fill_holes(m) & ~m
        mt = ndi.binary_erosion(m, iterations=5) & ~ndi.binary_dilation(holes, iterations=6) & ~eye_cut[sl]
        m = ndi.binary_fill_holes(m)                   # (the outline: whole, the gaps were the cut-out's)
        out[name] = (bleed(rgb, mt), m, mt)
    print(f'  turnaround: {", ".join(f"{k} {v[1].shape[1]}x{v[1].shape[0]}" for k, v in out.items())}')
    return out


def sheet_x4(path):
    """the character sheet upscaled x4 with Real-ESRGAN x4plus (BSD; spandrel, on the Mac's GPU), in overlapping tiles;
    cached next to the model. The sheet's figures are only ~300 px tall: straight from the sheet, the sides and the
    back came out soft next to the 600-px picture on the front"""
    os.makedirs(RESR_OUT, exist_ok=True)
    cache = os.path.join(RESR_OUT, os.path.basename(path).replace('.png', '_x4.png'))
    if os.path.exists(cache) and os.path.getmtime(cache) >= os.path.getmtime(path):
        return np.asarray(Image.open(cache).convert('RGB'))
    import torch
    from spandrel import ModelLoader
    dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
    net = ModelLoader().load_from_file(RESR_MODEL).to(dev).eval()
    a = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255
    H, W = a.shape[:2]
    out = np.zeros((H * 4, W * 4, 3), np.float32)
    T, P = 256, 16
    t0 = time.time()
    for y0 in range(0, H, T):
        for x0 in range(0, W, T):
            ya, xa = max(0, y0 - P), max(0, x0 - P)
            yb, xb = min(H, y0 + T + P), min(W, x0 + T + P)
            t = torch.from_numpy(a[ya:yb, xa:xb]).permute(2, 0, 1)[None].to(dev)
            with torch.no_grad():
                o = net(t)[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy()
            y1, x1 = min(H, y0 + T), min(W, x0 + T)
            out[y0 * 4:y1 * 4, x0 * 4:x1 * 4] = o[(y0 - ya) * 4:(y1 - ya) * 4, (x0 - xa) * 4:(x1 - xa) * 4]
    out = (out * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out).save(cache)
    print(f'  sheet x4 (Real-ESRGAN): {W}x{H} -> {W * 4}x{H * 4} in {time.time() - t0:.0f}s')
    return out


def sheet_views(kind, sheets, up=True):
    """{view: (rgb float 0..1 bled past the outline, mask, texture mask)} cut from the friend's character sheet, or None.
    Cut and cleaned at the sheet's own size; with up, the colours are then taken from the x4 Real-ESRGAN sheet and the
    masks scaled up to match (everything downstream finds its scale from the masks)"""
    from scipy import ndimage as ndi
    path = os.path.join(sheets or '', f'{kind}_sheet.png')
    if kind not in SHEET_VIEWS or not os.path.exists(path):
        return None
    a = np.asarray(Image.open(path).convert('RGB'))
    a4 = sheet_x4(path) if up else None
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
            elif what == 'notshirt':                   # grey fur and a pink paw over a red shirt
                drop = box & m & ~(((hh <= 12) | (hh >= 168)) & (ss > 140))
            elif what == 'pinkear':                    # the pink inside of an ear (not the grey fur round it)
                drop = box & m & ((hh <= 12) | (hh >= 150)) & (ss > 45) & (vv > 120)
            elif what == 'green':                      # (the turkey's middle tail feather)
                drop = box & m & (hh >= 35) & (hh <= 95) & (ss > 50)
            elif what == 'cattail':                    # yellow and brown stripes (not the red shirt, not the cream fur)
                drop = box & m & (ss > 80) & (hh >= 9) & (hh <= 40)
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
        if a4 is None:
            out[name] = (bleed(rgb, m0), m, mt)
            continue
        up4 = lambda x: np.asarray(Image.fromarray((x * 255).astype(np.uint8)).resize((x.shape[1] * 4, x.shape[0] * 4), Image.BILINEAR)) > 127
        rgb4 = a4[sl[0].start * 4:sl[0].stop * 4, sl[1].start * 4:sl[1].stop * 4].astype(np.float32) / 255
        out[name] = (bleed(rgb4, up4(m0), inset=6), up4(m), up4(mt))
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

def base_mesh(kind, art, res, shape='tsg'):
    """the raw mesh (TripoSG, or TripoSR with shape='tsr') turned to face +z, crumbs dropped, smoothed, its outline box
    fitted to the picture's (friend frame: x across with the head's middle at 0, y up from the bottom, z toward the
    camera)"""
    import trimesh
    from scipy.spatial import cKDTree
    a = art[kind]
    pic = Image.open(os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp')).convert('RGBA')
    if shape == 'tsg':
        # TripoSG's frame is fixed (y up, the picture's front toward +x): no search. It has no colours: the bake
        # paints everything from the picture and the sheet
        v, f = tsg_mesh(kind)
        R = TSG_R
        c = np.full((len(v), 3), 160, np.uint8)
        v = v @ R.T
        m = trimesh.Trimesh(v, f, process=True)
        parts = m.split(only_watertight=False)
        if len(parts) > 1:                            # crumbs off; separate real parts (a loose feather) stay
            big = max(len(p.faces) for p in parts)
            m = trimesh.util.concatenate([p for p in parts if len(p.faces) >= 0.01 * big])
        print(f'  TripoSG: {len(m.faces)} tris, {len(parts)} parts')
        v, f = np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32)
        if os.environ.get('TC_SOLID', '1') == '1':
            v, f = solidify(v, f)
        else:
            v = taubin(v, f, it=4)
        c = np.full((len(v), 3), 160, np.uint8)
    else:
        v, f, c = tsr_mesh(kind, res)
        score, R, q, err = orient(v, c, pic)
        v = v @ R.T
        if np.linalg.det(R) < 0:
            f = f[:, ::-1]
        mir = '  (mirrored)' if np.linalg.det(R) < 0 else ''
        print(f'  orient: iou {q:.2f}, colour err {err:.3f}{mir}')
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
    v[:, 2] = (v[:, 2] - (mn[2] + mx[2]) / 2) * (kx + ky) / 2 * (DEPTH_K if shape == 'tsr' else 1.0) - 0.02
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
                 band=None, down=None):
        self.name, self.d = name, np.asarray(d, np.float64)
        self.vp, self.ip, self.rgb, self.mask, self.warp = vis_plane, img_plane, rgb, mask, warp
        self.power, self.prio, self.valid, self.floor = power, prio, valid, floor
        self.band = band                               # (only where |n.z| < band: the middle of a side-on friend)
        self.down = down                               # (none where n.y < down[0], all above down[1]: undersides)
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
        if self.down:
            s = np.clip((n[:, 1] - self.down[0]) / (self.down[1] - self.down[0]), 0, 1)
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
    out = [BakeView('front', (0, 0, 1), fp, fp, rgbP, alP, power=4.0, prio=9.0, floor=0.2, down=(-0.8, -0.5))]

    def sheet_view(name, d, r, mirror_of=None):
        rgb, m, mt = views[name]
        rgb = apply_lut(rgb, lut)
        pl = Plane.around(v, d, r, margin=60)
        S = pl.mask(v, f)
        q, ox, oy, sx, sy = place(m, k, S)
        T = placed(m.astype(np.float32), S.shape, ox, oy, sx, sy, cval=0) > 0.5
        SHEET_FIG[name] = T                            # (the whole figure, with what SHEET_DROP left out: bake_clean)
        u = demons(S, T, its=(70, 50, 40), sig=(3.5, 3.0, 2.5))
        T2 = warp_mask(T, u)
        print(f'  {name}: placed iou {q:.3f} (scale {sx / k:.3f}) -> warped {iou(T2, S):.3f}')
        img = placed(rgb, S.shape, ox, oy, sx, sy)
        er = max(1, int(round(m.shape[0] / 330)))      # (1 px of the sheet's own size: more on the x4 sheet)
        mk = placed(ndi.binary_erosion(mt, iterations=er).astype(np.float32), S.shape, ox, oy, sx, sy, cval=0)
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
        if TURN_NOW or 'ends' not in SHEET_SKIP.get(kind, ()):
            pl, img, mk, u, ok = sheet_view('head', (-1, 0, 0), (0, 0, 1))
            out.append(BakeView('head', (-1, 0, 0), pl, pl, img, mk, u, power=4.0, valid=ok))
            pl, img, mk, u, ok = sheet_view('tail', (1, 0, 0), (0, 0, -1))
            out.append(BakeView('tail', (1, 0, 0), pl, pl, img, mk, u, power=4.0, valid=ok))
        if TURN_NOW and 'flank' in views:              # (the turnaround's own far flank)
            pl, img, mk, u, ok = sheet_view('flank', (0, 0, -1), (-1, 0, 0))
            out.append(BakeView('flank', (0, 0, -1), pl, pl, img, mk, u, power=4.0, valid=ok))
            for bv in out:
                bv.prepare(v, f)
            return out
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
        if TURN_NOW and 'side2' in views:              # (the turnaround's own other side, not the mirror)
            pl2, img2, mk2, u2, ok2 = sheet_view('side2', (-1, 0, 0), (0, 0, 1))
            out.append(BakeView('side2', (-1, 0, 0), pl2, pl2, img2, mk2, u2, power=4.0, valid=ok2))
        else:
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



def fabric_regions(rgb, mask):
    """the picture's fabric regions: (label image, -1 outside or on a region's edge; ok per label = big enough to seed
    the fill; rep per label = the fabric's colour). The pictures are 3D renders with real shading (the duck's yellow
    runs from L 88 to an olive L 57 at its sides, through the same hues as its orange feet in shade), so colours alone
    can't tell a fabric from its shade: the regions are grown over the picture (Felzenszwalb's graph segmentation) —
    smooth shading stays inside one, the sharp edges between two fabrics (and the outlines, eyes, letters) split them"""
    from scipy import ndimage as ndi
    from skimage.segmentation import felzenszwalb
    m = mask > 0.5
    x = np.clip(rgb, 0, 1).copy(); x[~m] = 1
    seg = felzenszwalb(x.astype(np.float64), scale=300, sigma=0.8, min_size=150).astype(np.int32)
    seg[~m] = -1
    labs = np.unique(seg[m])
    K = int(labs.max()) + 1
    edge = np.zeros(m.shape, bool)
    for L in labs:
        r = seg == L
        edge |= ndi.binary_dilation(r, iterations=2) & ~r
    core = seg.copy(); core[edge | (mask < 0.95)] = -1
    share = np.bincount(core[core >= 0], minlength=K) / max(1, m.sum())
    # the fabric's colour: toward the lit side (the median of the pixels between the 55th and 90th percentile of
    # brightness) — round the back the shader's own shade darkens it; a plain median came out a dull mustard next to
    # the duck's bright yellow front
    rep = np.zeros((K, 3), np.float32)
    lum_r = np.zeros(K, np.float32)
    for L in labs:
        px = rgb[core == L]
        if len(px) < 10:
            continue
        lum = px.mean(1)
        lo, hi = np.percentile(lum, [55, 90])
        sel = (lum >= lo) & (lum <= hi)
        rep[L] = np.median(px[sel] if sel.sum() > 10 else px, 0)
        lum_r[L] = rep[L].mean()
    # shades and highlights: a region that is a darker or lighter shade of a bigger neighbour (same chromaticity: the
    # shade under the duck's cap brim, the crevices between its legs, the shine on its head) is that neighbour's fabric — else it painted a dark patch
    # (with rings, following the mesh's terraces) round the back of the head
    lin = np.clip(rep, 1e-4, 1) ** 2.2
    chrom = lin[:, :2] / lin.sum(1, keepdims=True) * 100
    order = np.argsort(share)                          # (small ones first)
    for L in order:
        if share[L] == 0:
            continue
        ring = ndi.binary_dilation(seg == L, iterations=4) & (seg != L) & (seg >= 0)
        nb, cnt = np.unique(seg[ring], return_counts=True)
        best = None
        for N, c in zip(nb, cnt):
            if share[N] > share[L] and np.linalg.norm(chrom[N] - chrom[L]) < (5 if KIND_NOW in MERGE_LUM else 10) and max(lum_r[N], lum_r[L]) < 1.6 * min(lum_r[N], lum_r[L]):
                if best is None or share[N] > share[best]:
                    best = N
        if best is not None:
            rep[L] = rep[best]; lum_r[L] = lum_r[best]; chrom[L] = chrom[best]
            share[best] += share[L]
            core[core == L] = best; seg[seg == L] = best
            share[L] = 0
    # one fabric split into several pieces (the duck's yellow head and body; left and right): one colour — else the
    # back showed two yellows meeting in a seam down the middle
    import cv2
    labc = cv2.cvtColor((np.clip(rep, 0, 1)[None] * 255).astype(np.uint8), cv2.COLOR_RGB2LAB)[0].astype(np.float32)
    labc[:, 0] *= 100 / 255; labc[:, 1:] -= 128
    big = [L for L in np.argsort(-share) if share[L] >= 0.015]
    for a_ in range(len(big)):
        A_ = big[a_]
        if share[A_] == 0:
            continue
        for B_ in big[a_ + 1:]:
            if share[B_] and np.linalg.norm(labc[A_] - labc[B_]) < 9:
                rep[B_] = rep[A_]; labc[B_] = labc[A_]
    # one fabric in several pieces anywhere in the picture, lit and in shade (the monkey's fur: four browns; the seal's
    # jacket: two blues) — merged by chromaticity, lightness up to x3 apart; the biggest piece gives the colour
    lin2 = np.clip(rep, 1e-4, 1) ** 2.2
    ch2 = lin2[:, :2] / lin2.sum(1, keepdims=True) * 100
    lu2 = lin2.sum(1)
    order = [L for L in np.argsort(-share) if share[L] > 0]
    owner = {}
    for L in order:
        for O in list(dict.fromkeys(owner.values())):
            if np.linalg.norm(ch2[L] - ch2[O]) < MERGE_CH.get(KIND_NOW, 6) and max(lu2[L], lu2[O]) < MERGE_LUM.get(KIND_NOW, 3.0) * min(lu2[L], lu2[O]):
                owner[L] = O
                break
        else:
            owner[L] = L
    for L, O in owner.items():
        if O != L:
            rep[L] = rep[O]; share[O] += share[L]; share[L] = 0
            core[core == L] = O; seg[seg == L] = O
    ok = share >= 0.015
    print('  fabric regions: ' + ', '.join(f'{share[L]:.0%}#' + '%02x%02x%02x' % tuple((np.clip(rep[L], 0, 1) * 255).astype(int)) for L in np.argsort(-share) if ok[L]))
    # a bank of the picture's pixels with their fabric (lit and shaded) to match the sheet's colours against
    yy, xx = np.nonzero((core >= 0) & ok[np.maximum(core, 0)])
    pick = np.random.default_rng(1).choice(len(yy), size=min(len(yy), 30000), replace=False)
    fabric_regions.bank = (rgb[yy[pick], xx[pick]].astype(np.float32), core[yy[pick], xx[pick]])
    fabric_regions.share = share
    return core, ok, rep

PIC_VIEWS = ('front', 'flank', 'mid')
THIN = 0.12                                       # (thinner parts take no labels from the sheet)
# the sheet's labels only for a friend's biggest fabrics: the turkey's sheet fan, laid on TripoSG's fan, put other
# feathers' colours on each feather — its head (red) and body (brown) come from the sheet, the feathers from the picture
LABEL_TOP = {}
SHEET_OFF = {}
# friends whose sheet draws colours the picture doesn't have round the back (the turkey's fan from behind: blue,
# orange, yellow, green feathers): each of the sheet's regions keeps its own flat colour
SHEET_OWN = ('turkey',)
FAN = {}
# which sheet views place the fabrics: the mouse's side view hangs its arms down the flanks (the picture holds the
# paws up at the chest) — grey patches on the shirt's sides; its back view alone wraps the shirt round
LABEL_VIEWS = {'mouse': ('back',)}
# friends whose SHEET_DROP holes stay empty (the picture's fabrics reach in round the mesh instead): the turkey's
# brown head-back on the sheet, dropped, is the picture's red head
NO_HOLE_FILL = ('turkey',)                      # (how far behind the picture's seeds the sheet's start)               # the bake's views that are the user's picture (not the sheet)


def bake_clean(v, f, n, views, v0, f0, res=1024, pad=8, dbg=None):
    """the atlas without the character sheet's views (user: "360도 회전에도 깔끔하게 뭉게지는 거 없이 매끈하게"):
    laid on a mesh that is not the sheet's, the sheet's sides and back came out as smears and streaks. Here the picture
    paints what faces the front squarely (it fades out from ~55 deg, before it stretches), and every other part takes
    the colour of the nearest place the picture shows well, measured ALONG THE SURFACE (geodesic, on the fine mesh
    before simplification) — the back of an arm the arm's colour, the back of an ear its rim's grey (not the pink
    inside, which a straight-line nearest would reach through the ear), the shirt round the back the shirt's red —
    flat fabric colours like a sewn plush, no stretched print. The seeds' colours are local medians (an eye, a line or
    the outline's rim shading next to them doesn't run round the back)."""
    import xatlas
    import trimesh
    from scipy import ndimage as ndi
    from scipy.spatial import cKDTree
    import scipy.sparse as sp
    from scipy.sparse import csgraph
    pv = [bv for bv in views if bv.name in PIC_VIEWS]
    atlas = xatlas.Atlas()
    atlas.add_mesh(v.astype(np.float32), f.astype(np.uint32))
    co = xatlas.ChartOptions(); co.max_iterations = 4; co.max_cost = 6.0
    po = xatlas.PackOptions(); po.resolution = res; po.padding = pad; po.bilinear = True; po.rotate_charts = True
    atlas.generate(co, po)
    vmap, idx, uv = atlas[0]
    print(f'  atlas: {atlas.chart_count} charts, {len(vmap)} verts (was {len(v)}), utilisation {float(np.ravel(atlas.utilization)[0]):.2f}')

    # the fine mesh: the picture's colours where it faces a picture view squarely (the seeds)
    m0 = trimesh.Trimesh(np.asarray(v0, np.float64), np.asarray(f0, np.int64), process=False)
    f0 = np.asarray(m0.faces)
    n0 = smooth_normals(v0, f0, its=8)
    # (TripoSG's marching-cubes winding faces inward: turned to agree with the simplified mesh, whose normals are fixed)
    nf = smooth_normals(v, f, its=8)
    agree = (n0 * nf[cKDTree(v).query(v0)[1]]).sum(1)
    if np.median(agree) < 0:
        f0 = f0[:, ::-1]; n0 = -n0
    # the picture's fabric regions: colours clustered (Lab) and clusters of the same fabric under the painted light
    # merged (close in hue/chroma, not too far in lightness); small regions (eyes, mouths, letters, lines, the dark
    # crevices between limbs) never seed the fill. Without this, the painted shading and crevices ran round the back
    # as bands and brown patches
    fr = [bv for bv in pv if bv.name == 'front'][0]
    # (the painted eyes — iris, pupil, their white rings — are no fabric: js/eyes.js domes replace them; as a fabric the
    # whites came back as pale patches where MV-Adapter drew eyes on the fish's and the turtle's faces)
    emask = np.zeros(fr.mask.shape, bool)
    try:
        js = open(os.path.join(ROOT, 'js', 'eyes.js'), encoding='utf-8').read()
        tab = json.loads(js[js.index('/*@eyes*/') + 9:js.index('/*@end*/')]).get(KIND_NOW)
    except Exception:
        tab = None
    if tab and ART_NOW:
        Wp, Hp, mg = ART_NOW['w'], ART_NOW['h'], fr.ip.margin
        yy_, xx_ = np.mgrid[0:emask.shape[0], 0:emask.shape[1]]
        g_ = 2.3 if tab.get('ring') else 1.8
        for (eu, ev, erx, ery, _) in tab['eyes']:
            emask |= ((xx_ - (eu * Wp + mg)) / (g_ * erx * Wp)) ** 2 + ((yy_ - (ev * Hp + mg)) / (g_ * ery * Hp)) ** 2 < 1
    lab_img, okL, repL = fabric_regions(fr.rgb, fr.mask * ~emask)
    share_now = fabric_regions.share
    seed_w = np.zeros(len(v0), np.float32); seed_c = np.zeros((len(v0), 3), np.float32)
    seed_l = np.full(len(v0), -1, np.int32)
    for bv in pv:
        if bv.name == 'mid':
            continue
        w, c = bv.weights_colours(v0, n0)
        nd = n0 @ bv.d
        q = bv.ip.pix(v0)
        qi = np.clip(q[:, 0].astype(int), 0, lab_img.shape[1] - 1); qj = np.clip(q[:, 1].astype(int), 0, lab_img.shape[0] - 1)
        L = lab_img[qj, qi]
        s_ = (w > 0) & (nd > 0.5) & (L >= 0) & okL[np.maximum(L, 0)]
        better = s_ & (seed_w == 0)
        seed_c[better] = c[better]; seed_l[better] = L[better]; seed_w[better] = 1
    # the character sheet's side and back views say WHICH fabric is where round the back (a shirt that wraps round,
    # the turkey's red head in front of its fan, a jacket's back) — only that: each of their pixels is matched to the
    # nearest of the picture's fabrics (by chromaticity, lightness counting less: the sheet is shaded too), so the
    # colours stay the picture's own flat fabrics and nothing of the sheet's drawing is stretched over the mesh
    import cv2
    def to_lab(c):
        x = cv2.cvtColor((np.clip(c, 0, 1)[None] * 255).astype(np.uint8), cv2.COLOR_RGB2LAB)[0].astype(np.float32)
        x[:, 0] *= 100 / 255 * 0.6; x[:, 1:] -= 128                    # (lightness counts less: the sheet is shaded too)
        return x
    bank_c, bank_l = fabric_regions.bank
    tb = cKDTree(to_lab(bank_c))
    def classify(c):
        D, I = tb.query(to_lab(c), k=7)
        L = bank_l[I]
        out = np.empty(len(c), np.int32)
        for i in range(len(c)):
            u, n_ = np.unique(L[i], return_counts=True); out[i] = u[np.argmax(n_)]
        return out, D[:, 0]
    # thin parts (a feather, an ear, a brim, a tail): their back is the same fabric as their front — the sheet,
    # drawn a little differently, put other feathers' colours on them. Thickness along the inward normal, on the
    # simplified mesh
    mF = trimesh.Trimesh(v, f, process=False)
    nF = smooth_normals(v, f, its=8)
    org = v - nF * 2e-3
    loc, ri, _ = mF.ray.intersects_location(org, -nF, multiple_hits=False)
    thick = np.full(len(v), 9.0)
    thick[ri] = np.linalg.norm(loc - org[ri], axis=1)
    nearF = cKDTree(v).query(v0)[1]
    thin0 = thick[nearF] < THIN
    print(f'  thin parts: {thin0.mean():.0%} of the surface')
    sheet_w = np.zeros(len(v0), np.float32); sheet_l = np.full(len(v0), -1, np.int32)
    from skimage.segmentation import felzenszwalb
    own_ids = []
    if TEX_MODE == 'mvlabel':
        # MV-Adapter's six views, painted to fit THIS mesh (tools/mv_views.py): they say which fabric is where all round
        # — their own colours (shaded, a little grey) never reach the atlas, only the picture's fabrics
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import mv_views as MV
        imgs, centerM, scaleM = mv_views(KIND_NOW, v, f)
        # (round the eyes, on both sides of a side-on friend: MV's own drawing of an eye — its iris matched to the
        # nearest fabric (orange on the fish), its white to the palest — is no fabric; the domes sit there)
        eye0 = np.zeros(len(v0), bool)
        if tab and ART_NOW:
            wA, hA, uA = ART_NOW['w'] * PX, ART_NOW['h'] * PX, ART_NOW['head'][0]
            pu = v0[:, 0] / wA + uA; pv_ = 1 - v0[:, 1] / hA
            for (eu, ev, erx, ery, _) in tab['eyes']:
                inside = ((pu - eu) / (2.2 * erx)) ** 2 + ((pv_ - ev) / (2.2 * ery)) ** 2 < 1
                eye0 |= inside
        Hm, Wm = imgs.shape[1:3]
        vs0 = MV.to_std(v0, centerM, scaleM); ns0 = MV.nrm_std(n0); vsF = MV.to_std(v, centerM, scaleM)
        for i, cam in enumerate(MV.cameras()):
            if i == 0:
                continue                              # (the front: the picture itself)
            mk = np.ones((Hm, Wm), bool)
            Pv, zv = MV.project(vsF, cam, Hm, Wm)
            fd, bb = raster(Pv, f, Wm, Hm, -zv)
            mk = fd >= 0
            D = np.full((Hm, Wm), np.inf, np.float32)
            D[mk] = (bb[mk] * zv[f[fd[mk]]]).sum(1)
            D = ndi.minimum_filter(D, size=3)
            img = imgs[i].astype(np.float64).copy(); img[~mk] = 0.5
            sz = max(150, int(mk.sum() * 0.002))
            sg = felzenszwalb(img, scale=300 * Hm / 600, sigma=0.8, min_size=sz)
            sg[~mk] = -1
            limg = np.full(mk.shape, -1, np.int32)
            for Sg in np.unique(sg[sg >= 0]):
                r = sg == Sg
                px = imgs[i][r]
                if len(px) > 4000:
                    px = px[np.random.default_rng(3).choice(len(px), 4000, replace=False)]
                lab_, dd = classify(px)
                if np.median(dd) > MV_TRUST:              # (no fabric of the picture's is that colour: MV's shading
                    continue                              # or a guess — the fabrics round it fill it in)
                u_, n_ = np.unique(lab_, return_counts=True)
                Lb = u_[np.argmax(n_)]
                # (much duller or darker than the fabric it matched: MV's shade, or its guess at an unseen part
                # in grey — the duck's back of the head, its tail. Left to the fabrics round it)
                cs, cf = np.median(px, 0), repL[Lb]
                sat = lambda c: (c.max() - c.min()) / max(c.max(), 1e-3)
                if sat(cs) < 0.6 * sat(cf) - 0.02 or cs.max() < 0.6 * cf.max():
                    continue
                limg[r] = Lb
            Pp, zp = MV.project(vs0, cam, Hm, Wm)
            ix = np.clip(Pp[:, 0].astype(int), 0, Wm - 1); iy = np.clip(Pp[:, 1].astype(int), 0, Hm - 1)
            vis = zp <= D[iy, ix] + 0.012
            face = ns0 @ (-cam[3])
            w = np.where(vis & (face > 0.35), face, 0).astype(np.float32)
            sel = np.nonzero((w > 0) & (seed_w == 0) & (w > sheet_w) & ~eye0)[0]
            L = limg[iy[sel], ix[sel]]
            good = L >= 0
            sheet_l[sel[good]] = L[good]; sheet_w[sel[good]] = w[sel[good]]
    for bv in (views if TEX_MODE != 'mvlabel' else ()):
        if bv.name in PIC_VIEWS or (KIND_NOW in LABEL_VIEWS and bv.name not in LABEL_VIEWS[KIND_NOW]):
            continue
        # the view's own regions (graph segmentation, like the picture's), each matched as a whole: the most common
        # fabric among its pixels — one label per jacket back, per sleeve, per feather
        mk = bv.mask > 0.5
        fig = SHEET_FIG.get('side' if bv.name == 'side2' else bv.name)
        if fig is None or fig.shape != mk.shape:
            fig = ndi.binary_fill_holes(ndi.binary_closing(mk, iterations=3))
        fig = fig | mk                                 # (the figure, with what SHEET_DROP left out of it)
        img = np.clip(bv.rgb, 0, 1).astype(np.float64).copy(); img[~mk] = 1
        sz = max(150, int(mk.sum() * 0.002))
        sg = felzenszwalb(img, scale=300 * max(1.0, mk.shape[0] / 600), sigma=0.8, min_size=sz)
        sg[~mk] = -1
        limg = np.full(mk.shape, -1, np.int32)
        for Sg in np.unique(sg[sg >= 0]):
            r = sg == Sg
            px = bv.rgb[r]
            if len(px) > 4000:
                px = px[np.random.default_rng(3).choice(len(px), 4000, replace=False)]
            cS = np.median(px, 0)
            satS = (cS.max() - cS.min()) / max(cS.max(), 1e-3)
            if KIND_NOW in SHEET_OWN and satS <= 0.3:  # (a pale highlight: no fabric of its own, left to the fill)
                continue
            if KIND_NOW in SHEET_OWN:
                lum = px.mean(1); lo, hi = np.percentile(lum, [55, 90]); sel_ = (lum >= lo) & (lum <= hi)
                cS = np.median(px[sel_] if sel_.sum() > 10 else px, 0)
                if (cS.max() - cS.min()) / max(cS.max(), 1e-3) <= 0.3:
                    continue                           # (its lit side pale: a highlight after all)
                # (a highlight or a shade of a colour already met — the same fabric: no cream patches)
                linS = np.clip(cS, 1e-4, 1) ** 2.2; chS = linS[:2] / linS.sum() * 100
                hit = -1
                for j in own_ids:
                    lj = np.clip(repL[j], 1e-4, 1) ** 2.2; chj = lj[:2] / lj.sum() * 100
                    if np.linalg.norm(chS - chj) < 6 and max(lj.sum(), linS.sum()) < 3 * min(lj.sum(), linS.sum()):
                        hit = j; break
                if hit < 0:
                    repL = np.vstack([repL, cS[None]]); okL = np.r_[okL, True]
                    hit = len(repL) - 1; own_ids.append(hit)
                limg[r] = hit
                continue
            lab_, _ = classify(px)
            u, n_ = np.unique(lab_, return_counts=True)
            limg[r] = u[np.argmax(n_)]
        # (left out of the sheet — the cat's tail on its back, the mouse's hanging arm: the regions round them)
        # (each hole one fabric: the most common one round its edge — the shirt round the cat's tail, not the brown
        # patch its tip reaches down to)
        hole = fig & (limg < 0)
        if hole.any() and (limg >= 0).any() and KIND_NOW not in NO_HOLE_FILL:
            hl, nh = ndi.label(hole)
            for i in range(1, nh + 1):
                hi_ = hl == i
                ring = ndi.binary_dilation(hi_, iterations=4) & ~hi_ & (limg >= 0)
                if ring.any():
                    u, n_ = np.unique(limg[ring], return_counts=True)
                    limg[hi_] = u[np.argmax(n_)]
        nd = n0 @ bv.d
        xy = bv.vp.pix(v0)
        ixv = np.clip(xy[:, 0].astype(int), 0, bv.vp.W - 1); iyv = np.clip(xy[:, 1].astype(int), 0, bv.vp.H - 1)
        vis = (v0 @ bv.d) >= bv.zb[iyv, ixv] - 0.012
        w = np.where(vis & (nd > 0), nd, 0).astype(np.float32)
        notfan = np.ones(len(v0), bool)
        if KIND_NOW in FAN:
            z0, z1 = v0[:, 2].min(), v0[:, 2].max()
            notfan = v0[:, 2] >= z0 + FAN[KIND_NOW] * (z1 - z0)
        sel = np.nonzero((w > 0) & (nd > 0.45) & (seed_w == 0) & (w > sheet_w) & ~thin0 & notfan)[0]
        if not len(sel):
            continue
        q = bv.ip.pix(v0[sel])
        if bv.warp is not None:
            du = sample(np.moveaxis(bv.warp, 0, -1), q)
            q = q + du[:, ::-1]
        L = np.round(sample(limg.astype(np.float32), q, order=0)).astype(np.int32)
        good = L >= 0
        if KIND_NOW in LABEL_TOP:
            top = np.argsort(-share_now)[:LABEL_TOP[KIND_NOW]]
            good &= np.isin(L, top)
        sheet_l[sel[good]] = L[good]; sheet_w[sel[good]] = w[sel[good]]
    pic_seed = seed_w > 0
    # (speckles: a few rounds of majority vote among the neighbours over the mesh)
    E1 = np.unique(np.sort(m0.edges_unique, axis=1), axis=0)
    ii1, jj1 = np.r_[E1[:, 0], E1[:, 1]], np.r_[E1[:, 1], E1[:, 0]]
    on = sheet_l >= 0
    if on.any():
        nl = len(repL)
        for _ in range(6):
            cnt = np.zeros((len(v0), nl), np.float32)
            ok_e = on[jj1]
            np.add.at(cnt, (ii1[ok_e], sheet_l[jj1[ok_e]]), 1)
            cnt[np.nonzero(on)[0], sheet_l[on]] += 1
            sheet_l = np.where(on, np.argmax(cnt, 1), -1).astype(np.int32)
        seed_l[on] = sheet_l[on]; seed_w[on] = 1
        print(f'  sheet labels: {on.sum()} fine verts')
    sheet_from = np.zeros(len(v0), bool); sheet_from[on] = True
    seeds = np.nonzero(seed_w > 0)[0]
    ts = cKDTree(v0[seeds])
    sc = repL[seed_l[seeds]]                         # (each seed: its fabric's colour)
    # geodesic nearest seed over the fine mesh's edges: its region and colour
    E = np.unique(np.sort(m0.edges_unique, axis=1), axis=0)
    dv = v0[E[:, 1]] - v0[E[:, 0]]
    Ln = np.linalg.norm(dv, axis=1) + 1e-7
    # crossing a concave crease costs more (the brim's underside meeting the head, an arm against the body): the colours
    # meet along the creases, where two fabrics are sewn, not halfway across a smooth surface
    conc = np.maximum(0, -((n0[E[:, 1]] - n0[E[:, 0]]) * dv).sum(1) / Ln ** 2)
    # and going up or down costs more than going round: fabrics wrap round a plush (a shirt, a hat's band, the head
    # under a cap) — the back of the head takes the head's sides, not the cap from over the top
    Ln = Ln * (1 + 0.06 * conc) * (1 + 1.0 * np.abs(dv[:, 1]) / Ln)
    G = sp.coo_matrix((np.r_[Ln, Ln], (np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]])), shape=(len(v0),) * 2).tocsr()
    # the picture's seeds start ahead of the sheet's (a virtual source joined to every seed, the sheet's a little
    # further away): next to what the picture shows, its fabrics win over the sheet's guesses
    from_sheet = sheet_from[seeds]
    off = np.where(from_sheet, SHEET_OFF.get(KIND_NOW, 0.03), 0.0) + 1e-6
    N0 = len(v0)
    Gc = G.tocoo()
    G2 = sp.coo_matrix((np.r_[Gc.data, off], (np.r_[Gc.row, np.full(len(seeds), N0)], np.r_[Gc.col, seeds])),
                       shape=(N0 + 1, N0 + 1)).tocsr()
    dist, pred = csgraph.dijkstra(G2, directed=True, indices=N0, return_predecessors=True)
    dist = dist[:N0]
    r = pred[:N0].copy()
    r[r < 0] = -1
    r[seeds] = seeds
    for _ in range(int(np.ceil(np.log2(N0))) + 2):
        rr = np.where(r >= 0, r, 0)
        r = np.where(r >= 0, r[rr], -1)
    src = r
    ok = (src >= 0) & np.isin(src, seeds)
    near = np.zeros(len(v0), np.int64)
    near[ok] = np.searchsorted(seeds, src[ok])
    if (~ok).any():                                   # (a loose part with no seed: the nearest seed in space)
        near[~ok] = ts.query(v0[~ok])[1]
    reg = seed_l[seeds][near]
    reg[seeds] = seed_l[seeds]
    if KIND_NOW in FAN_PARTS and pic_seed.any():
        pj = json.load(open(os.path.join(ROOT, 'design', 'parts', 'parts.json')))[KIND_NOW]
        pm = np.asarray(Image.open(os.path.join(ROOT, 'design', 'parts', f'{KIND_NOW}.png')))
        ids = [q['id'] for q in pj['parts'] if q['name'] in FAN_PARTS[KIND_NOW]]
        a_ = ART_NOW
        wA, hA, uA = a_['w'] * PX, a_['h'] * PX, a_['head'][0]
        ps_ = np.nonzero(pic_seed)[0]
        px_ = np.clip(((v0[ps_, 0] / wA + uA) * pm.shape[1]).astype(int), 0, pm.shape[1] - 1)
        py_ = np.clip(((1 - v0[ps_, 1] / hA) * pm.shape[0]).astype(int), 0, pm.shape[0] - 1)
        is_fan = np.isin(pm[py_, px_], ids)
        _, _, srcP = csgraph.dijkstra(G, directed=False, indices=ps_, min_only=True, return_predecessors=True)
        okP = srcP >= 0
        jP = np.zeros(len(v0), np.int64); jP[okP] = np.searchsorted(ps_, srcP[okP])
        terr = okP & is_fan[jP] & ~pic_seed & (n0[:, 2] < 0.2)
        reg[terr] = seed_l[ps_][jP[terr]]
        print(f'  fan backs from their own tips: {terr.sum()} fine verts')
    if KIND_NOW in FAN:
        top = np.argsort(-share_now)[:LABEL_TOP.get(KIND_NOW, 2)]
        feath = (lab_img >= 0) & ~np.isin(lab_img, top) & okL[np.maximum(lab_img, 0)]
        z0, z1 = v0[:, 2].min(), v0[:, 2].max()
        fan = np.nonzero((v0[:, 2] < z0 + FAN[KIND_NOW] * (z1 - z0)) & (seed_w == 0) & (n0[:, 2] < 0.3))[0]
        if feath.any() and len(fan):
            _, (iy, ix) = ndi.distance_transform_edt(~feath, return_indices=True)
            fl = lab_img[iy, ix]
            q = fr.ip.pix(v0[fan])
            qi = np.clip(q[:, 0].astype(int), 0, fl.shape[1] - 1); qj = np.clip(q[:, 1].astype(int), 0, fl.shape[0] - 1)
            reg[fan] = fl[qj, qi]
            print(f'  fan from the picture: {len(fan)} fine verts')
    # clean seams (user: "영역별 색이 섞이지 않고 깔끔하게"): each fabric's region smoothed over the surface (its
    # indicator diffused, then the strongest fabric wins) — the seams become smooth curves, not the zig-zag of the
    # triangles and the sheet's pixels — and islands too small to be a real patch go to the fabric round them
    reg = np.maximum(reg, 0)
    labs_u = np.unique(reg)
    if len(labs_u) > 1:
        ii2, jj2 = np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]]
        A2 = sp.coo_matrix((np.ones(len(ii2)), (ii2, jj2)), shape=(len(v0),) * 2).tocsr()
        d2 = np.maximum(np.asarray(A2.sum(1)).ravel(), 1)[:, None]
        X = (reg[:, None] == labs_u[None]).astype(np.float32)
        for _ in range(SEAM_SMOOTH):
            X = 0.5 * X + 0.5 * (A2 @ X) / d2
        reg = labs_u[np.argmax(X, 1)]
        # islands
        same = reg[ii2] == reg[jj2]
        Ac = sp.coo_matrix((np.ones(same.sum()), (ii2[same], jj2[same])), shape=(len(v0),) * 2).tocsr()
        ncomp, comp = csgraph.connected_components(Ac, directed=False)
        csize = np.bincount(comp, minlength=ncomp)
        small = csize < ISLAND_K.get(KIND_NOW, ISLAND) * len(v0)
        for _ in range(3):
            bad = small[comp]
            if not bad.any():
                break
            # each small island takes the most common fabric on its border
            cross = bad[ii2] & ~bad[jj2]
            if not cross.any():
                break
            cc = comp[ii2[cross]]; ll = reg[jj2[cross]]
            key = cc.astype(np.int64) * (reg.max() + 1) + ll
            uk, cnt = np.unique(key, return_counts=True)
            best = {}
            for k_, n_ in zip(uk, cnt):
                c_, l_ = divmod(int(k_), int(reg.max() + 1))
                if n_ > best.get(c_, (0, -1))[0]:
                    best[c_] = (n_, l_)
            for c_, (_, l_) in best.items():
                reg[comp == c_] = l_
            same = reg[ii2] == reg[jj2]
            Ac = sp.coo_matrix((np.ones(same.sum()), (ii2[same], jj2[same])), shape=(len(v0),) * 2).tocsr()
            ncomp, comp = csgraph.connected_components(Ac, directed=False)
            csize = np.bincount(comp, minlength=ncomp)
            small = csize < ISLAND_K.get(KIND_NOW, ISLAND) * len(v0)
        print(f'  seams smoothed: {len(np.unique(reg))} fabrics, {ncomp} patches')
    fill = repL[np.maximum(reg, 0)].astype(np.float64)
    # within each region the colour is smoothed over the surface (no bands from the painted light along the edge the
    # colours came from); between regions the seam stays crisp, like two fabrics sewn together
    ii, jj = np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]]
    keep = reg[ii] == reg[jj]
    A0 = sp.coo_matrix((np.ones(keep.sum()), (ii[keep], jj[keep])), shape=(len(v0),) * 2).tocsr()
    dg = np.maximum(np.asarray(A0.sum(1)).ravel(), 1)[:, None]
    free = (seed_w == 0)[:, None]
    # and a light pass across the seams (a few edges), so they are clean lines, not stair-steps of triangles
    A1 = sp.coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(len(v0),) * 2).tocsr()
    d1 = np.maximum(np.asarray(A1.sum(1)).ravel(), 1)[:, None]
    # (no averaging across the seams: user "색이 뭉개지게 넣지말고 영역별 명확한 색" — each fabric one exact colour)
    if os.environ.get('TC_DBG'):
        np.savez(os.path.expanduser('~/.cache/agent-scratch/tc/clean_dbg.npz'), v0=v0, f0=f0, n0=n0, fill=fill, reg=reg,
                 seeds=seeds, sc=sc, seed_c=seed_c, seed_l=seed_l, lab_img=lab_img, okL=okL, dist=dist, repL=repL)
    print(f'  clean fill: {len(seeds)} seeds of {len(v0)} fine verts, furthest {np.nanmax(np.where(np.isfinite(dist), dist, 0)):.2f}')

    # texels
    ft = idx.astype(np.int64)
    P = np.stack([uv[:, 0] * res, (1 - uv[:, 1]) * res], 1)
    fid, bary = raster(P, ft, res, res)
    on = fid >= 0
    tri = ft[fid[on]]
    b = bary[on]
    nsm = smooth_normals(v, f)
    vv, nn = v[vmap], nsm[vmap]
    p = (b[:, :, None] * vv[tri]).sum(1)
    nrm = (b[:, :, None] * nn[tri]).sum(1)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1), 1e-9)[:, None]
    # the fill at each texel: the fine vertices around it on the same side of the surface
    t0 = cKDTree(v0)
    D, I = t0.query(p, k=8)
    wq = np.exp(-((D - D[:, :1]) / (0.5 * D[:, :1] + 0.002)) ** 2) * np.clip((nrm[:, None, :] * n0[I]).sum(-1), 0, 1) ** 2 + 1e-6
    fb = fill[I[np.arange(len(I)), np.argmax(wq, 1)]]           # (one fabric per texel: crisp seams)
    # volume round the sides and back: the flat fabric colours lit softly — ambient occlusion (creases under the arms,
    # the neck under the head, the seat) and a little more light from above; the picture has its own painted light
    rng = np.random.default_rng(2)
    dirs = rng.normal(size=(24, 3)); dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    occ = np.zeros(len(v), np.float32); tot = np.zeros(len(v), np.float32)
    for dvec in dirs:
        cosd = nF @ dvec
        use = np.nonzero(cosd > 0.05)[0]
        if not len(use):
            continue
        hit = mF.ray.intersects_any(v[use] + nF[use] * 2e-3, np.tile(dvec, (len(use), 1)))
        occ[use] += hit * cosd[use]; tot[use] += cosd[use]
    ao = 1 - occ / np.maximum(tot, 1e-6)
    A1f = sp.coo_matrix((np.ones(len(f) * 6), (f[:, [0, 1, 2, 1, 2, 0]].ravel(), f[:, [1, 2, 0, 0, 1, 2]].ravel())), shape=(len(v),) * 2).tocsr()
    dgf = np.maximum(np.asarray(A1f.sum(1)).ravel(), 1)
    for _ in range(4):
        ao = 0.5 * ao + 0.5 * (A1f @ ao) / dgf
    light_v = (0.62 + 0.38 * ao) * (0.93 + 0.07 * nF[:, 1])
    light_t = (b * light_v[vmap][tri]).sum(1)
    if os.environ.get('TC_AO'):
        fb = fb * light_t[:, None]
    # the picture where it faces squarely: full from ~55 deg in, none past ~70 deg
    acc = np.zeros((len(p), 3), np.float32); ws = np.zeros(len(p), np.float32)
    for bv in pv:
        if bv.name == 'mid':                          # (the profile stretched across the turtle's face: a second
            continue                                  # smile and eye ghosts seen face-on; its face is the fill + eyes)
        w, c = bv.weights_colours(p, nrm)
        nd = nrm @ bv.d
        s = np.clip((nd - 0.4) / 0.4, 0, 1) if KIND_NOW not in SIDE_ON else np.clip((nd - 0.6) / 0.3, 0, 1)
        w = (w > 0) * s * s * (3 - 2 * s) * (0.35 if bv.name == 'mid' else 1.0)
        acc += w[:, None] * c; ws += w
    a = np.clip(ws, 0, 1)[:, None]
    col = a * acc / np.maximum(ws, 1e-6)[:, None] + (1 - a) * fb
    img = np.zeros((res, res, 3), np.float32)
    img[on] = col
    _, (iy, ix) = ndi.distance_transform_edt(~on, return_indices=True)
    img = img[iy, ix]
    if dbg is not None:
        seen = np.zeros((res, res), np.float32); seen[on] = a[:, 0]
        dbg['atlas'] = (img, seen)
    return vmap, idx, uv, img


MV_DIR = os.path.expanduser('~/dev/tools/MV-Adapter')
# MV-Adapter's guesses vary run to run: per friend the run whose fabric layout was cleanest (picked by eye; the
# meshes they were made for share the frame with today's to well under a cell)
MV_PICK = {'cow': 'cow_ee6526abcb', 'dog': 'dog_2304a9db7e', 'duck': 'duck_5199191656'}


def mv_views(kind, v, f):
    """the six MV-Adapter views painted to fit this exact mesh (tools/mv_views.py in MV-Adapter's venv), cached by the
    mesh's own bytes"""
    import hashlib
    import subprocess
    out_dir = os.path.join(MV_DIR, 'out'); os.makedirs(out_dir, exist_ok=True)
    key = hashlib.md5(np.ascontiguousarray(v.astype(np.float32)).tobytes() + np.ascontiguousarray(f.astype(np.int32)).tobytes()).hexdigest()[:10]
    out = os.path.join(out_dir, f'{kind}_{key}.npz')
    if kind in MV_PICK and os.path.exists(os.path.join(out_dir, MV_PICK[kind] + '.npz')):
        out = os.path.join(out_dir, MV_PICK[kind] + '.npz')   # (a run whose fabrics came out cleaner; same frame)
    if not os.path.exists(out):
        mesh = os.path.join(out_dir, f'{kind}_{key}_mesh.npz')
        np.savez(mesh, v=v, f=f)
        if os.environ.get('TC_MV_EXPORT'):           # (only list the job: tools/mv_views.py --batch runs them all)
            with open(os.path.join(out_dir, 'jobs.txt'), 'a') as fh:
                fh.write(f"{mesh} {os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp')} {out}\n")
            raise RuntimeError('MV job listed')
        t0 = time.time()
        subprocess.run([os.path.join(MV_DIR, '.venv', 'bin', 'python'), os.path.join(ROOT, 'tools', 'mv_views.py'), mesh,
                        os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp'), out,
                        '--steps', os.environ.get('TC_MV_STEPS', '40')], check=True)
        print(f'  MV-Adapter views: {time.time() - t0:.0f}s -> {out}')
    z = np.load(out)
    return z['views'].astype(np.float32) / 255, z['center'], float(z['scale'])


def bake_mv(kind, v, f, n, views, res=1024, pad=8, dbg=None):
    """the atlas from the six views MV-Adapter painted onto this mesh (front, right, back, left, top, bottom), each
    seen only where it faces the surface squarely and nothing nearer hides it; the user's picture over them where the
    front faces the camera (it is the art itself, and sharper). The views are brought to the picture's colours first
    (tone curves from the front view against the picture, where both show the friend)"""
    import xatlas
    import trimesh
    from scipy import ndimage as ndi
    from scipy.spatial import cKDTree
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import mv_views as MV
    imgs, center, scale = mv_views(kind, v, f)
    H, W = imgs.shape[1:3]
    cams = MV.cameras()
    pv = [bv for bv in views if bv.name in ('front', 'flank')]
    atlas = xatlas.Atlas()
    atlas.add_mesh(v.astype(np.float32), f.astype(np.uint32))
    co = xatlas.ChartOptions(); co.max_iterations = 4; co.max_cost = 6.0
    po = xatlas.PackOptions(); po.resolution = res; po.padding = pad; po.bilinear = True; po.rotate_charts = True
    atlas.generate(co, po)
    vmap, idx, uv = atlas[0]
    print(f'  atlas: {atlas.chart_count} charts, {len(vmap)} verts (was {len(v)}), utilisation {float(np.ravel(atlas.utilization)[0]):.2f}')
    ft = idx.astype(np.int64)
    P = np.stack([uv[:, 0] * res, (1 - uv[:, 1]) * res], 1)
    fid, bary = raster(P, ft, res, res)
    on = fid >= 0
    tri = ft[fid[on]]
    b = bary[on]
    nsm = smooth_normals(v, f, its=6)
    vv, nn = v[vmap], nsm[vmap]
    p = (b[:, :, None] * vv[tri]).sum(1)
    nrm = (b[:, :, None] * nn[tri]).sum(1)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1), 1e-9)[:, None]
    ps, ns = MV.to_std(p, center, scale), MV.nrm_std(nrm)
    vs = MV.to_std(v, center, scale)
    # the picture vs the MV front view (where the picture is opaque and the mesh faces the front): tone curves
    fr = pv[0]
    wF, cF = fr.weights_colours(p, nrm)
    P0, z0 = MV.project(ps, cams[0], H, W)
    c0 = sample(imgs[0], P0)
    both = (wF > 2.0)
    lut = colour_lut(c0[both], cF[both]) if both.sum() > 500 else None
    if lut is not None:
        imgs = np.stack([apply_lut(im, lut) for im in imgs])
    acc = np.zeros((len(p), 3), np.float32); ws = np.zeros(len(p), np.float32)
    for i, cam in enumerate(cams):
        Pv, zv = MV.project(vs, cam, H, W)
        fd, bb = raster(Pv, f, W, H, -zv)
        D = np.full((H, W), np.inf, np.float32)
        okd = fd >= 0
        D[okd] = (bb[okd] * zv[f[fd[okd]]]).sum(1)
        D = ndi.minimum_filter(D, size=3)                 # (a texel right on the outline still counts as seen)
        Pp, zp = MV.project(ps, cam, H, W)
        ix = np.clip(Pp[:, 0].astype(int), 0, W - 1); iy = np.clip(Pp[:, 1].astype(int), 0, H - 1)
        vis = zp <= D[iy, ix] + 0.012
        face = np.clip(ns @ (-cam[3]), 0, 1)
        w = vis * np.clip((face - 0.15) / 0.85, 0, 1) ** 2.5
        if i >= 4:
            w = w * 0.6                                   # (top and bottom: less trusted than the four round views)
        c = sample(imgs[i], Pp)
        acc += w[:, None] * c; ws += w
    known = ws > 0.02
    col = acc / np.maximum(ws, 1e-6)[:, None]
    # what no view sees (deep in a crease): the nearest seen texels facing the same way
    if (~known).any() and known.sum() > 50:
        kt = cKDTree(p[known])
        d_, I_ = kt.query(p[~known], k=8)
        wq = np.exp(-((d_ - d_[:, :1]) / (0.5 * d_[:, :1] + 0.003)) ** 2) * np.clip((nrm[~known][:, None, :] * nrm[known][I_]).sum(-1) + 0.3, 0.02, 1)
        col[~known] = (col[known][I_] * wq[:, :, None]).sum(1) / wq.sum(1, keepdims=True)
    # the picture where it faces squarely: full from ~55 deg in
    pacc = np.zeros((len(p), 3), np.float32); pws = np.zeros(len(p), np.float32)
    for bv in pv:
        w, c = bv.weights_colours(p, nrm)
        nd = nrm @ bv.d
        s_ = np.clip((nd - 0.4) / 0.4, 0, 1)
        w = (w > 0) * s_ * s_ * (3 - 2 * s_)
        pacc += w[:, None] * c; pws += w
    a = np.clip(pws, 0, 1)[:, None]
    col = a * pacc / np.maximum(pws, 1e-6)[:, None] + (1 - a) * col
    img = np.zeros((res, res, 3), np.float32)
    img[on] = col
    _, (iy, ix) = ndi.distance_transform_edt(~on, return_indices=True)
    img = img[iy, ix]
    if dbg is not None:
        seen = np.zeros((res, res), np.float32); seen[on] = np.clip(ws, 0, 1)
        dbg['atlas'] = (img, seen)
    return vmap, idx, uv, img


def bake_turn(v, f, n, views, res=1024, pad=8, dbg=None):
    """the atlas from the user's turnaround: every texel takes the views that face it squarely and see it (the picture on
    the front, the turnaround's sides and back round it, each laid on the mesh's own outline in its direction); the
    views are one consistent set, so they are blended as they are — no fabric guessing. What no view sees well (deep in
    a crease, straight up or down) takes the nearest seen texels facing the same way"""
    import xatlas
    from scipy import ndimage as ndi
    from scipy.spatial import cKDTree
    atlas = xatlas.Atlas()
    atlas.add_mesh(v.astype(np.float32), f.astype(np.uint32))
    co = xatlas.ChartOptions(); co.max_iterations = 4; co.max_cost = 6.0
    po = xatlas.PackOptions(); po.resolution = res; po.padding = pad; po.bilinear = True; po.rotate_charts = True
    atlas.generate(co, po)
    vmap, idx, uv = atlas[0]
    print(f'  atlas: {atlas.chart_count} charts, {len(vmap)} verts (was {len(v)}), utilisation {float(np.ravel(atlas.utilization)[0]):.2f}')
    ft = idx.astype(np.int64)
    P = np.stack([uv[:, 0] * res, (1 - uv[:, 1]) * res], 1)
    fid, bary = raster(P, ft, res, res)
    on = fid >= 0
    tri = ft[fid[on]]
    b = bary[on]
    nsm = smooth_normals(v, f, its=10)
    p = (b[:, :, None] * v[vmap][tri]).sum(1)
    nrm = (b[:, :, None] * nsm[vmap][tri]).sum(1)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1), 1e-9)[:, None]
    acc = np.zeros((len(p), 3), np.float32); ws = np.zeros(len(p), np.float32)
    for bv in views:
        w, c = bv.weights_colours(p, nrm)
        if bv.name != 'front':
            w = w ** 1.5                                # (a little sharper hand-over between two views)
        acc += w[:, None] * c; ws += w
    known = ws > 0.05
    col = acc / np.maximum(ws, 1e-6)[:, None]
    if os.environ.get('TC_DBG'):
        wt = (col.min(1) > 0.85) & known & (nrm[:, 2] < -0.1)
        print('   dbg white texels', wt.sum())
        for bv in views:
            w, c = bv.weights_colours(p[wt], nrm[wt])
            print('   dbg', bv.name, 'w mean', float(w.mean()), 'white share', float(((c.min(1) > 0.85) * w).sum() / max(w.sum(), 1e-6)))
    if (~known).any() and known.sum() > 50:
        kt = cKDTree(p[known])
        d_, I_ = kt.query(p[~known], k=12)
        wq = np.exp(-((d_ - d_[:, :1]) / (0.5 * d_[:, :1] + 0.003)) ** 2) * np.clip((nrm[~known][:, None, :] * nrm[known][I_]).sum(-1) + 0.3, 0.02, 1)
        col[~known] = wmedian(col[known][I_], wq)
    img = np.zeros((res, res, 3), np.float32)
    img[on] = col
    _, (iy, ix) = ndi.distance_transform_edt(~on, return_indices=True)
    img = img[iy, ix]
    print(f'  turnaround bake: {known.mean():.0%} of the texels seen by a view')
    if dbg is not None:
        seen = np.zeros((res, res), np.float32); seen[on] = np.clip(ws, 0, 1)
        dbg['atlas'] = (img, seen)
    return vmap, idx, uv, img


def bake(v, f, n, views, res=1024, pad=8, dbg=None, kind_consist=True):
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
    co.max_cost = 6.0
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
        wf = np.zeros(len(p), np.float32)              # (the picture's share: the front and the mirrored flank)
        for bv in views:
            w, c = bv.weights_colours(p, nn)
            tv = getattr(bv, 'trust_v', None)
            if tv is not None:
                w = w * (tv if bary_tri is None else (bary_tri[0] * tv[vmap][bary_tri[1]]).sum(1))
            acc += w[:, None] * c; ws += w
            if bv.name in ('front', 'flank', 'mid'):
                wf += w
        pr = getattr(colours, 'prop', None)
        if pr is not None:                             # (the picture's part colours where a sheet view was distrusted)
            cpv, rw = pr
            if bary_tri is None:
                w, c = rw, cpv
            else:
                w = (bary_tri[0] * rw[vmap][bary_tri[1]]).sum(1)
                c = (bary_tri[0][:, :, None] * cpv[vmap][bary_tri[1]]).sum(1)
            acc += w[:, None] * c; ws += w
        colours.wf = wf
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

    # the sheet's views where they disagree with the picture next to it: the sheet's friend is posed differently
    # (the mouse's arms hang down on the sheet and are held up at the chest in the picture; the duck's feet sit
    # elsewhere) and its limbs came out as ghosts — an extra paw on the hip, yellow streaks on an orange foot. Near
    # what the picture shows, every vertex has the picture's colour of its part (a median of the nearest vertices the
    # picture sees well); a sheet view that paints a different colour there is distrusted, smoothly, and the picture's
    # part colour takes its place. Far round the back, the sheet is trusted as it is
    fv = [bv for bv in views if bv.name == 'front']
    if fv and kind_consist:
        wF, cF = fv[0].weights_colours(v, n)
        kF = np.nonzero(wF > 1.0)[0]
        if len(kF) > 50:
            tF = cKDTree(v[kF])
            d, I = tF.query(v, k=16)
            wg = np.exp(-((d - d[:, :1]) / (0.5 * d[:, :1] + 0.01)) ** 2) * np.clip((n[:, None, :] * n[kF][I]).sum(-1) + 0.3, 0.02, 1)
            cprop = wmedian(cF[kF][I].astype(np.float32), wg)
            band = np.exp(-(d[:, 0] / 0.14) ** 2)
            rep_w = np.zeros(len(v)); 
            for bv in views:
                if bv.name not in ('side', 'side2', 'back', 'head', 'tail'):
                    continue
                w, c = bv.weights_colours(v, n)
                seen = (w > 0.02).astype(np.float64)
                cp = c.astype(np.float64)
                for _ in range(3):                  # (patches, not texels: a little misregistration is fine)
                    cp = np.where(seen[:, None] > 0, ((Adj @ (cp * seen[:, None])) + cp) / (Adj @ seen + 1)[:, None], cp)
                dist = np.linalg.norm(cp - cprop, axis=1)
                t = np.clip((dist - 0.2) / 0.16, 0, 1)
                un = band * t * t * (3 - 2 * t) * (seen > 0)
                for _ in range(3):
                    un = 0.5 * un + 0.5 * (Adj @ un) / np.maximum(deg, 1)
                tr = np.clip(1 - 1.4 * un, 0, 1)
                old = getattr(bv, 'trust_v', None)
                bv.trust_v = tr if old is None else old * tr
                rep_w = np.maximum(rep_w, w * (1 - tr))
                print(f'  {bv.name}: distrusted next to the picture on {(tr < 0.5).mean():.0%} of the mesh')
            colours.prop = (cprop.astype(np.float32), rep_w.astype(np.float32))
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
    wf = colours.wf
    kn = ws > 0.12
    need = np.nonzero(ws < 0.8)[0]
    # undersides (the seat, the soles) are filled from the fabric the sheet's side and back views show — not from the
    # picture's bottom edge: its prints (a shirt's hem, a letter, a bandana) were dragged in under the seat as smears
    down = nrm[need, 1] < -0.35
    fabric = kn & (wf < 0.35 * ws)
    groups = [(need[~down], kn), (need[down], fabric if fabric.sum() > 200 else kn)]
    for qsel, known in groups:
        if known.sum() <= 50 or not len(qsel):
            continue
        kc = (acc[known] / ws[known, None]).astype(np.float32)
        kp, kq = p[known], nrm[known]
        t1 = cKDTree(kp)
        sub = np.random.default_rng(0).choice(len(kp), size=max(50, min(len(kp), len(kp) // 16)), replace=False)
        t2 = cKDTree(kp[sub])
        kd = np.zeros((len(qsel), 3), np.float32); dm = np.zeros(len(qsel), np.float32)
        for s0 in range(0, len(qsel), 60000):
            qi = qsel[s0:s0 + 60000]
            d1, i1 = t1.query(p[qi], k=12)
            d2, i2 = t2.query(p[qi], k=24)
            D = np.concatenate([d1, d2], 1); I = np.concatenate([i1, sub[i2]], 1)
            d0 = D.min(1, keepdims=True)
            wg = np.exp(-((D - d0) / (1.5 * d0 + 0.004)) ** 2) * np.clip((nrm[qi, None, :] * kq[I]).sum(-1) + 0.3, 0.02, 1)
            kd[s0:s0 + len(qi)] = wmedian(kc[I], wg)
            dm[s0:s0 + len(qi)] = d0[:, 0]
        cf = np.exp(-(dm / 0.12) ** 2)[:, None]
        fb[qsel] = cf * kd + (1 - cf) * fb[qsel]
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


def build(kind, art, res, target, sheets=None, dbg=None, shape='tsg', atlas=1024):
    import trimesh
    a = art[kind]
    w, h, u = a['w'] * PX, a['h'] * PX, a['head'][0]
    gy = (1 - a['head'][1]) * h
    v, f, c, pic = base_mesh(kind, art, res, shape)
    global TURN_NOW
    views = turn_views(kind) if not os.environ.get('TC_NO_TURN') else None
    TURN_NOW = views is not None
    if views is None:
        views = sheet_views(kind, sheets, up=not os.environ.get("TC_NO_X4"))
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
        skip = SHEET_SKIP.get(kind, ()) if not TURN_NOW else ()
        if shape == 'tsg' and TURN_NOW:
            skip = tuple(skip) + (() if os.environ.get('TC_TURN_DEPTH', '1') == '1' else ('depth',))
            if kind in TURN_NO_TAILS:                  # (TripoSG made its tail already: a second one was added)
                skip = tuple(skip) + ('tails',)
        elif shape == 'tsg':                         # (TripoSG's depth and parts are its own, from the picture: the
            skip = tuple(skip) + (('depth',) if os.environ.get('TC_TAILS', '1') == '1' else ('depth', 'tails'))   # sheet's side outline only dragged them about; tails: TripoSG has none behind)
        if 'depth' not in skip:
            v = fit_depth(v, f, views, k, kind, h, dbg)
        if kind in SIDE_ON:
            v = centre_flank(v, f, fp)
        if kind not in SIDE_ON and 'tails' not in skip:
            v, f = add_tails(v, f, views, k, h, gy, dbg)
        v = recentre(v, gy, h)
    else:
        print('  (no character sheet: guessed colours round the back)')
    v0, f0 = v, f
    v, f = decimate(v, f, target or (TRIS if views else 6000))   # (textured from a sheet: finer, for sharp outlines)
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
        global TEX_MODE
        tex_mode0 = TEX_MODE
        TEX_MODE = TEX_KIND.get(kind, TEX_MODE) if TEX_MODE == 'mvlabel' else TEX_MODE
        if TURN_NOW and not os.environ.get('TC_TURN_LABEL'):
            vmap, idx, uv, tex = bake_turn(v, f, n, bvs, res=atlas, pad=8 * atlas // 1024, dbg=dbg)
        elif TEX_MODE == 'mv':
            vmap, idx, uv, tex = bake_mv(kind, v, f, n, bvs, res=atlas, pad=8 * atlas // 1024, dbg=dbg)
        elif TEX_MODE in ('clean', 'mvlabel'):
            global KIND_NOW, ART_NOW
            KIND_NOW = kind; ART_NOW = art[kind]
            vmap, idx, uv, tex = bake_clean(v, f, n, bvs, v0, f0, res=atlas, pad=8 * atlas // 1024, dbg=dbg)
        else:
            vmap, idx, uv, tex = bake(v, f, n, bvs, res=atlas, pad=8 * atlas // 1024, dbg=dbg, kind_consist=kind not in CONSIST_SKIP)
        TEX_MODE = tex_mode0
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
    out.update(r.get('rig', {}))                  # (tools/rig.py: bones + sk, when the friend has part masks)
    return out


def main():
    import eyes as eyes_stage                       # tools/eyes.py (the friends' new eyes, build side)
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--res', type=int, default=256)
    ap.add_argument('--target', type=int, default=0, help='triangles (default 9000 with a sheet, else 6000)')
    ap.add_argument('--sheets', default=os.path.join(ROOT, 'design', 'sheets'))
    ap.add_argument('--debug', default='')
    ap.add_argument('--shape', default='tsg', choices=('tsg', 'tsr'), help='shape source: TripoSG (default) or TripoSR')
    ap.add_argument('--atlas', type=int, default=1024, help='atlas texture size')
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
        try:
            r = build(k, art, o.res, o.target, o.sheets, dbg, o.shape, o.atlas)
        except RuntimeError as e:
            if 'MV job listed' not in str(e):
                raise
            print('  (MV views to make first: listed in jobs.txt)')
            continue
        eyes_stage.post_bake(k, r, art)             # (tools/eyes.py: no painted eyes left on the atlas by js/eyes.js's domes)
        from rig import rig_hook                    # its limbs on joints: tools/rig.py (design/parts/ masks)
        r = rig_hook(k, r, art)
        assert len(r['v']) < 65536
        data[k] = pack(r)
        print(f'  packed {sum(len(x) for x in data[k].values() if isinstance(x, str)) // 1024} KB (' + ', '.join(f'{a} {len(x) // 1024}' for a, x in data[k].items() if isinstance(x, str)) + ')')
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
