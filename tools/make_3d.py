"""Toy Catch — the friends' 3D shapes, made on this Mac from the user's pictures (TripoSR, MIT licence; nothing leaves
the machine). For every picture in assets/img/friends/<kind>.webp:

  1. TripoSR guesses the whole 3D shape — and colours for the back — from the picture alone.
  2. The mesh is turned to face +z (found by matching its front view to the picture), scaled so its front outline sits
     exactly on the picture (the game maps the picture onto the front, so the art stays the user's own), smoothed and
     simplified to about TARGET triangles.
  3. Every vertex gets a 'front' weight: 1 where it is seen from the front (it shows the picture), 0 behind (it shows
     the guessed colours), soft in between.

Writes js/friends-3d.js (base64 — WebGL can't load files from file://).

usage (TripoSR checked out with its venv in ~/dev/tools/TripoSR, see README):
  ~/dev/tools/TripoSR/.venv/bin/python tools/make_3d.py [--only monkey,ant] [--res 256] [--target 6000]
Raw meshes are cached in ~/dev/tools/TripoSR/out/<kind>.npz (delete one to regenerate it).
"""
import argparse
import base64
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


def build(kind, art, res, target):
    a = art[kind]
    v, f, c = tsr_mesh(kind, res)
    pic = Image.open(os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp')).convert('RGBA')
    score, R, iou, err = orient(v, c, pic)
    v = v @ R.T
    if np.linalg.det(R) < 0:
        f = f[:, ::-1]
    print(f'  orient: iou {iou:.2f}, colour err {err:.3f}{"  (mirrored)" if np.linalg.det(R) < 0 else ""}')
    import trimesh
    m = trimesh.Trimesh(v, f, process=True)
    parts = m.split(only_watertight=False)
    if len(parts) > 1:                                # keep the body, drop floating crumbs
        m = max(parts, key=lambda p: len(p.faces))
    v, f = np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32)
    from scipy.spatial import cKDTree
    c = c[cKDTree(np.load(os.path.join(OUT_RAW, f'{kind}.npz'))['v'] @ R.T).query(v)[1]]
    v = taubin(v, f)
    # the picture's frame (friends.js): x from -u·w to (1-u)·w, y from 0 to h; fit the mesh's outline to the picture's
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
    # simplify
    import fast_simplification
    if len(f) > target:
        v2, f2 = fast_simplification.simplify(v, f, target_reduction=1 - target / len(f))
        c = c[cKDTree(v).query(v2)[1]]
        v, f = v2.astype(np.float32), f2.astype(np.int32)
    m = trimesh.Trimesh(v, f, process=False)
    m.fix_normals()
    v, f = np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32)
    n = np.asarray(m.vertex_normals, np.float32)
    # front weight: seen from the front (nothing of the friend in front of it along +z), smoothed, and not on the
    # steep sides (the picture would smear there)
    eps = 2e-3
    org = v + np.array([0, 0, eps], np.float32) + n * eps
    hit = m.ray.intersects_any(org, np.tile([[0, 0, 1]], (len(v), 1)))
    fw = (~hit).astype(np.float32)
    nb = m.vertex_neighbors
    for _ in range(3):
        fw = np.array([(fw[i] * 2 + fw[list(nb[i])].sum()) / (2 + len(nb[i])) if len(nb[i]) else fw[i] for i in range(len(v))], np.float32)
    s = np.clip((n[:, 2] + 0.12) / 0.42, 0, 1)
    fw *= s * s * (3 - 2 * s)
    # TripoSR's colours come out duller than the art (the cow's white back looked grey): fit them to the picture where
    # both are seen — per channel gain and offset over the front vertices — and apply that to every vertex
    pa = np.asarray(pic).astype(np.float32)
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
    return v, f, c, fw


def pack(v, f, c, fw):
    lo, hi = v.min(0), v.max(0)
    q = np.round((v - lo) / np.maximum(hi - lo, 1e-6) * 65535).astype('<u2')
    b = lambda arr: base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()
    return {'n': int(len(v)), 'm': int(f.size), 'lo': [round(float(x), 5) for x in lo], 'hi': [round(float(x), 5) for x in hi],
            'pos': b(q), 'col': b(c.astype(np.uint8)), 'fw': b(np.round(fw * 255).astype(np.uint8)),
            'idx': b(f.astype('<u2'))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--res', type=int, default=256)
    ap.add_argument('--target', type=int, default=6000)
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
        v, f, c, fw = build(k, art, o.res, o.target)
        assert len(v) < 65536
        data[k] = pack(v, f, c, fw)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('/* generated by tools/make_3d.py — do not edit: the friends\' 3D shapes (TripoSR, made locally from the\n'
                 '   pictures). Per friend: n vertices, m indices, lo/hi box, pos (uint16 in the box), col (rgb8, the guessed\n'
                 '   colours behind), fw (uint8 front weight: shows the picture), idx (uint16 triangles). */\n')
        fh.write('window.CLAW_FRIENDS_3D = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    main()
