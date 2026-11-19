"""Toy Catch — a friend's 3D model from its 360° turntable GIF alone (user: "toy_turntable 폴더에 동물별 360도 gif …
이걸로 3d 모델링 다시 한번해봐"). The 24 frames (design/turntable/<kind>/fNN.png, one rendered model turning 15° a
frame, f13 = the front, transparent background) are one consistent model seen all round, so:

  1. the turn's axis: the column where each frame matches the frame half a turn away, mirrored;
  2. the visual hull: a voxel stays only where all 24 silhouettes cover it (its turn direction found by which way
     keeps the most);
  3. the shape inside it: TripoSG (local, MIT) on the front frame gives the hollows the silhouettes can't see (under
     the arms, round the beak), scaled onto the hull's box; the solid = the hull ∩ TripoSG grown a little — smoothed
     and surfaced (marching cubes), simplified;
  4. the colours: each texel from the frames that face it most squarely and see it (z-buffer), weighted by
     (n·d)^P — the turntable's own pixels, no guessed colours.

The model is written into js/friends-3d.js (front weight 0: no game picture laid over it; noeyes: the frames have the
eyes already). Its size and seat follow the friend's game picture (friends-art.js h); x = 0 on the turn axis.

usage:  ~/dev/tools/TripoSR/.venv/bin/python tools/gif3d.py turkey [turtle …]
needs:  ~/dev/tools/TripoSG/out/<kind>_spin13.npz  (tools/tsg_mesh.py <kind> --view design/turntable/<kind>/f13.png
        --tag _spin13, in TripoSG's venv)
"""
import json
import os
import re
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import make_3d as M  # noqa: E402

SRC = os.path.join(ROOT, 'design', 'turntable')
TSG = os.path.expanduser('~/dev/tools/TripoSG/out')
N, FRONT, STEP = 24, 13, 15.0
SH = int(os.environ.get('GIF3D_SH', 512))   # (frames' size for the hull)
TOL = 2                      # (frames a thin part may miss)
P_W = 16.0                   # (how sharply the most squarely facing frames win)
REACH = 0.012                # (x height: the TripoSG shape grown by this much before the hull cuts it)
TRIS = 30000
ATLAS = 2048


def frames(kind, size):
    out = []
    for i in range(1, N + 1):
        a = np.asarray(Image.open(os.path.join(SRC, kind, f'f{i:02d}.png')).convert('RGBA').resize((size, size), Image.LANCZOS)).astype(np.float32) / 255
        out.append(a)
    return out


def find_axis(masks):
    W = masks[0].shape[1]
    xs = np.arange(W)
    best = None
    for x0 in np.arange(W * 0.4, W * 0.6, 0.5):
        src = np.clip(np.round(2 * x0 - xs).astype(int), 0, W - 1)
        s = np.mean([(masks[i] & masks[i + 12][:, src]).sum() / max(1, (masks[i] | masks[i + 12][:, src]).sum()) for i in range(12)])
        if best is None or s > best[0]:
            best = (s, x0)
    return best[1], best[0]


def proj(xp, zp, Y, axis, D, SHs, E=0.0):
    """turntable camera: xp across, zp toward the camera (object px at the axis' depth), Y the image row there.
    Looking down by E degrees, in perspective about the image centre from D px (D = 0: orthographic)"""
    c = SHs / 2
    e = np.radians(E)
    row0 = c + (Y - c) * np.cos(e) + zp * np.sin(e)
    dep = zp * np.cos(e) - (Y - c) * np.sin(e)         # (toward the camera)
    s = D / (D - dep) if D else np.ones_like(dep)
    return c + (axis - c + xp) * s, c + (row0 - c) * s


def hull(masks, axis, sign, D=0.0, E=0.0, votes=False):
    """the visual hull (all frames cover it), or with votes the number of frames that cover each voxel"""
    H, W = masks[0].shape
    rows = np.nonzero(np.any(masks, (0, 2)))[0]
    y0, y1 = rows.min() - 2, rows.max() + 3
    cols = np.nonzero(np.any(masks, (0, 1)))[0]
    R = int(np.ceil(max(abs(cols.min() - axis), abs(cols.max() - axis)))) + 3
    g = np.arange(-R, R + 1, dtype=np.float32)
    X, Z = np.meshgrid(g, g, indexing='ij')
    out = np.zeros((y1 - y0, len(g), len(g)), np.uint8 if votes else bool)
    if not votes:
        out[:] = True
    CH = 64
    for i, m in enumerate(masks):
        a = np.radians(sign * (i + 1 - FRONT) * STEP)
        xp, zp = X * np.cos(a) + Z * np.sin(a), -X * np.sin(a) + Z * np.cos(a)
        for r0 in range(y0, y1, CH):
            r1 = min(y1, r0 + CH)
            Y = np.arange(r0, r1, dtype=np.float32)[:, None, None]
            col, row = proj(xp[None], zp[None], Y, axis, D, W, E)
            shp = (r1 - r0,) + X.shape
            col = np.round(np.broadcast_to(col, shp)).astype(np.int32); row = np.round(np.broadcast_to(row, shp)).astype(np.int32)
            ok = (col >= 0) & (col < W) & (row >= 0) & (row < H)
            hit = m[np.clip(row, 0, H - 1), np.clip(col, 0, W - 1)] & ok
            if votes:
                out[r0 - y0:r1 - y0] += hit
            else:
                out[r0 - y0:r1 - y0] &= hit
    return out, y0, R


def voxelise(v, f, shape, origin):
    """the closed mesh (in grid units, origin = the grid index of 0) as solid occupancy"""
    import trimesh
    m = trimesh.Trimesh(v, f, process=False)
    pts, _ = trimesh.sample.sample_surface(m, int(min(8e6, max(2e6, m.area * 6))), seed=0)
    ijk = np.clip(np.round(pts + origin).astype(int), 0, np.array(shape) - 1)
    sh = np.zeros(shape, bool)
    sh[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    for d in (1, 2, 3):
        s2 = ndi.binary_dilation(sh, iterations=d)
        solid = ndi.binary_fill_holes(s2)
        if solid.sum() > 2.5 * s2.sum():
            return ndi.binary_erosion(solid, iterations=d)
    return solid


def build(kind):
    import trimesh
    from skimage.measure import marching_cubes
    t0 = time.time()
    fr = frames(kind, SH)
    masks = [ndi.binary_fill_holes(a[..., 3] > 0.5) for a in fr]
    axis, q = find_axis(masks)
    md = [ndi.binary_dilation(m, iterations=1) for m in masks]     # (a pixel of slack)
    sign = 1                                           # (the other way is the hull mirrored in z: TripoSG agrees with +1)
    # the camera: level (a downward look kept less), in perspective — the distance that keeps the most of the friend —
    # searched on quarter-size masks (distances in full-size px)
    f4 = 4
    mq = [m[::f4, ::f4] for m in md]
    f4 = 2; mq = [m[::f4, ::f4] for m in md]
    vols = {D: hull(mq, axis / f4, sign, D / f4, 0.0)[0].sum() for D in (0, 4000, 2500, 1800, 1400)}
    D, E = max(vols, key=vols.get), 0.0
    Hv, y0, R = hull(md, axis, sign, D, E)
    # (votes: a thin part — a leg, a tail — that one or two frames miss by a pixel is still a part)
    V = hull(md, axis, sign, D, E, votes=True)[0]
    soft = V >= N - TOL
    print(f'{kind}: axis {axis:.1f} (mirror iou {q:.3f}), camera {D} px (hull {Hv.sum()}, with {TOL} misses {soft.sum()})')
    # grid (y row-from-y0 down, x, z) -> working coords: x right, y up, z toward the front camera
    ny = Hv.shape[0]
    occ_rows = np.nonzero(Hv.any((1, 2)))[0]
    ybot = occ_rows.max() + 1                           # (the ground: the hull's lowest row)
    # TripoSG on the front frame, its box laid on the hull's
    tsg_path = os.path.join(TSG, f'{kind}_spin13.npz')
    if not os.path.exists(tsg_path):                  # (no TripoSG run: the hull alone — enough for an invisible body)
        return finish(kind, Hv, Hv, y0, R, masks, axis, D, E, sign, t0)
    z_ = np.load(tsg_path)
    tv, tf = z_['v'].astype(np.float64), z_['f'].astype(np.int64)
    parts = trimesh.Trimesh(tv, tf, process=True).split(only_watertight=False)
    big = max(len(p.faces) for p in parts)
    tm = trimesh.util.concatenate([p for p in parts if len(p.faces) >= 0.01 * big])
    tv, tf = np.asarray(tm.vertices), np.asarray(tm.faces)
    hy, hx, hz = [np.nonzero(Hv.any(ax))[0] for ax in ((1, 2), (0, 2), (0, 1))]
    # hull box in grid index space: rows hy (down), x hx, z hz
    lo_t, hi_t = tv.min(0), tv.max(0)
    gi = np.empty_like(tv)
    gi[:, 1] = hx.min() + (tv[:, 0] - lo_t[0]) / (hi_t[0] - lo_t[0]) * (hx.max() - hx.min())          # x
    gi[:, 0] = hy.max() - (tv[:, 1] - lo_t[1]) / (hi_t[1] - lo_t[1]) * (hy.max() - hy.min())          # row (down)
    gi[:, 2] = hz.min() + (tv[:, 2] - lo_t[2]) / (hi_t[2] - lo_t[2]) * (hz.max() - hz.min())          # z
    O = voxelise(gi, tf, Hv.shape, 0)
    ext = lambda X: (lambda r: (r.min(), r.max()))(np.nonzero(X.any((1, 2)))[0])
    print(f'  rows: hull {ext(Hv)}, TripoSG {ext(O)}')
    # TripoSG's depth is a guess: its box laid on the hull's put the legs and the fan a little off in z — the scale and
    # shift in z and x that overlap the hull best (on a half-size grid)
    Hd, Od = Hv[::2, ::2, ::2], O[::2, ::2, ::2].astype(np.float32)
    best = (-1, 1.0, 0.0, 0.0)
    cz, cx = Hd.shape[2] / 2, Hd.shape[1] / 2
    for sz in (0.85, 0.92, 1.0, 1.08, 1.16, 1.24):
        for dz in range(-12, 13, 2):
            for dx in (-2, 0, 2):
                mat = np.diag([1.0, 1.0, 1.0 / sz])
                off = np.array([0.0, -dx, cz - (cz + dz) / sz])
                Ot = ndi.affine_transform(Od, mat, offset=off, order=0) > 0.5
                q = (Ot & Hd).sum() / max(1, (Ot | Hd).sum())
                if q > best[0]:
                    best = (q, sz, dz, dx)
    q, sz, dz, dx = best
    mat = np.diag([1.0, 1.0, 1.0 / sz]); off = np.array([0.0, -2 * dx, (Hv.shape[2] / 2) - (Hv.shape[2] / 2 + 2 * dz) / sz])
    O = ndi.affine_transform(O.astype(np.float32), mat, offset=off, order=0) > 0.5
    print(f'  TripoSG fitted to the hull: iou {q:.3f} (z x{sz}, dz {2 * dz}, dx {2 * dx})')
    r = max(1, int(round(REACH * (hy.max() - hy.min()))))
    # the hull's thin parts (legs, feet, a crest, feathers) are their own true shape: kept as the silhouettes say
    rr = max(3, int(round(4 * SH / 512)))
    gz_, gy_, gx_ = np.mgrid[-rr:rr + 1, -rr:rr + 1, -rr:rr + 1]
    ball = gz_ ** 2 + gy_ ** 2 + gx_ ** 2 <= rr * rr
    thin = Hv & ~ndi.binary_opening(Hv, structure=ball)   # (the soft hull's thin bits were fins all round)
    F = (Hv & ndi.binary_dilation(O, iterations=r)) | thin
    print(f'  TripoSG {O.sum()} voxels, hull {Hv.sum()}, kept {F.sum()} ({F.sum() / max(1, Hv.sum()):.0%} of the hull), reach {r}')
    return finish(kind, F, Hv, y0, R, masks, axis, D, E, sign, t0)


def finish(kind, F, Hv, y0, R, masks, axis, D, E, sign, t0):
    import trimesh
    from skimage.measure import marching_cubes
    occ = ndi.gaussian_filter(F.astype(np.float32), 1.3)
    vv, ff, _, _ = marching_cubes(np.pad(occ, 2), 0.5)
    vv -= 2
    mm = trimesh.Trimesh(vv, ff, process=True)
    parts = mm.split(only_watertight=False)
    big = max(len(p.faces) for p in parts)
    mm = trimesh.util.concatenate([p for p in parts if len(p.faces) >= 0.002 * big])
    trimesh.smoothing.filter_taubin(mm, lamb=0.5, nu=-0.53, iterations=20)
    v, f = M.decimate(np.asarray(mm.vertices), np.asarray(mm.faces, np.int32), TRIS)
    mm = trimesh.Trimesh(v, f, process=True); mm.fix_normals()
    v, f = np.asarray(mm.vertices, np.float64), np.asarray(mm.faces, np.int32)

    # grid -> game units (the friend's picture height; x = 0 on the axis, y = 0 on the ground, z toward the camera)
    art = M.load_art()[kind]
    h, w, u = art['h'] * M.PX, art['w'] * M.PX, art['head'][0]
    # (the game picture is the front frame cropped to its box: the same height, ground and x as the picture)
    fy, fx = np.nonzero(masks[FRONT - 1])
    top, bot, left, right = fy.min(), fy.max() + 1, fx.min(), fx.max() + 1
    k = h / (bot - top)                                 # (game units per hull px)
    ax_x = ((axis - left) / (right - left) - u) * w      # (the turn axis in the friend's frame)
    ybot = bot - y0
    P = np.stack([(v[:, 1] - R) * k + ax_x, (ybot - v[:, 0]) * k, (v[:, 2] - R) * k], 1)
    nP = np.asarray(trimesh.Trimesh(P, f, process=False).vertex_normals)
    if ((P - P.mean(0)) * nP).sum(1).mean() < 0:
        f = f[:, ::-1].copy()                          # (outward)
    # z: the grid's z runs toward the front camera if sign·(the projection) says so — checked by the front frame:
    # the side seen in frame FRONT is +z
    print(f'  mesh {len(v)} verts {len(f)} tris, {time.time() - t0:.0f}s')
    return P, f, dict(axis=axis, sign=sign, y0=y0, ybot=ybot, k=k, R=R, D=D, E=E, ax_x=ax_x)


def bake(kind, P, f, cam):
    import xatlas
    from scipy.spatial import cKDTree
    ST = 1536
    fr = frames(kind, ST)
    sc = ST / SH
    axis_t, k_t, ybot_t = cam['axis'] * sc, cam['k'] / sc, (cam['y0'] + cam['ybot']) * sc
    n = M.smooth_normals(P, f, its=6)
    atlas = xatlas.Atlas()
    atlas.add_mesh(P.astype(np.float32), f.astype(np.uint32))
    co = xatlas.ChartOptions(); co.max_iterations = 4; co.max_cost = 4.0
    po = xatlas.PackOptions(); po.resolution = ATLAS; po.padding = 16; po.bilinear = True; po.rotate_charts = True
    atlas.generate(co, po)
    vmap, idx, uv = atlas[0]
    ft = idx.astype(np.int64)
    Pa = np.stack([uv[:, 0] * ATLAS, (1 - uv[:, 1]) * ATLAS], 1)
    fid, bary = M.raster(Pa, ft, ATLAS, ATLAS)
    on = fid >= 0
    tri = ft[fid[on]]; b = bary[on]
    p = (b[:, :, None] * P[vmap][tri]).sum(1)
    nr = (b[:, :, None] * n[vmap][tri]).sum(1); nr /= np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-9)
    acc = np.zeros((len(p), 3), np.float64); ws = np.zeros(len(p), np.float64); seen = np.zeros(len(p), bool)
    ZS = 768; zs = ZS / ST
    for i, a4 in enumerate(fr):
        al = a4[..., 3] > 0.5
        core = ndi.binary_erosion(al, iterations=3)
        _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
        rgb = a4[..., :3][iy, ix]                       # (bled past the edge: no background at the rim)
        a = np.radians(cam['sign'] * (i + 1 - FRONT) * STEP)
        d = np.array([-np.sin(a), 0.0, np.cos(a)])
        def proj(X, a=a):
            xp = (X[:, 0] * np.cos(a) + X[:, 2] * np.sin(a)) / k_t
            zp = (-X[:, 0] * np.sin(a) + X[:, 2] * np.cos(a)) / k_t
            c, r = globals()['proj'](xp, zp, ybot_t - X[:, 1] / k_t, axis_t, cam['D'] * sc, ST, cam['E'])
            return np.stack([c, r], 1)
        dep = P @ d
        zb_fid, zb_b = M.raster(proj(P) * zs, f, ZS, ZS, dep)
        Z = np.full((ZS, ZS), -np.inf, np.float32)
        okz = zb_fid >= 0
        Z[okz] = (zb_b[okz] * dep[f[zb_fid[okz]]]).sum(1)
        Z = ndi.maximum_filter(Z, size=3)
        nd = nr @ d
        sel = np.nonzero(nd > 0.05)[0]
        q = proj(p[sel])
        zi = np.clip((q * zs).astype(int), 0, ZS - 1)
        vis = (p[sel] @ d) >= Z[zi[:, 1], zi[:, 0]] - 0.01
        inside = M.sample(core.astype(np.float32), q, order=0, cval=0) > 0.5
        w = (nd[sel].astype(np.float64) ** P_W) * vis * inside
        c = M.sample(rgb, q)
        acc[sel] += w[:, None] * c; ws[sel] += w
        seen[sel] |= (vis & inside)
    known = seen & (ws > 0)
    col = acc / np.maximum(ws, 1e-6)[:, None]
    if (~known).any():
        kt = cKDTree(p[known])
        d_, I_ = kt.query(p[~known], k=8)
        wq = np.exp(-((d_ - d_[:, :1]) / (0.5 * d_[:, :1] + 0.003)) ** 2)
        col[~known] = (col[known][I_] * wq[:, :, None]).sum(1) / wq.sum(1, keepdims=True)
    img = np.zeros((ATLAS, ATLAS, 3), np.float32); img[on] = col
    _, (iy, ix) = ndi.distance_transform_edt(~on, return_indices=True)
    img = img[iy, ix]
    print(f'  bake: {known.mean():.1%} of the texels seen by a frame')
    return vmap, idx, uv, img


def main():
    path = os.path.join(ROOT, 'js', 'friends-3d.js')
    s = open(path, encoding='utf-8').read()
    head = s[:s.index('window.CLAW_FRIENDS_3D')]
    data = json.loads(re.search(r'=\s*(\{.*\});?\s*$', s, re.S).group(1))
    body = '--body' in sys.argv                         # (the shape only: shown as its turntable card, js/friends-spin.js)
    global TRIS
    if body:
        TRIS = 12000
    for kind in [a for a in sys.argv[1:] if not a.startswith('--')]:
        P, f, cam = build(kind)
        if body:
            r = {'v': P, 'f': f.astype(np.int64), 'fw': np.zeros(len(P)), 'c': np.full((len(P), 3), 150, np.uint8)}
        else:
            vmap, idx, uv, img = bake(kind, P - np.array([cam['ax_x'], 0, 0]), f, cam)
            r = {'v': P[vmap], 'f': idx.astype(np.int64), 'fw': np.zeros(len(vmap)), 'uv': uv, 'tex': img}
        e = M.pack(r)
        e['noeyes'] = 1
        data[kind] = e
        print(f'  packed {sum(len(x) for x in e.values() if isinstance(x, str)) // 1024} KB')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(head)
        fh.write('window.CLAW_FRIENDS_3D = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    main()
