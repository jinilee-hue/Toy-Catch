"""Toy Catch — the friends' rigs: arms, legs, wings, tails, ears, hats … that move on their own round their joints, like
a plush toy's sewn-on limbs (user: "모션도 몸이랑 팔이 같이 붙어서 움직인다던지").

Called by tools/make_3d.py at the end of every friend's build (whatever mesh comes out: TripoSR's, a newer one …), or on
its own over a js/friends-3d.js (--base). From the friend's part masks (design/parts/<kind>.png + parts.json, made from
the FRONT picture by tools/parts_sam.py — picture fractions, never vertex ids):

  1. labels: the vertices seen from the front take the label under them in the mask; the rest (sides, back) take the
     label of the nearest seed over the mesh, where crossing a crease (a concave fold) costs a lot — so an arm's back
     follows the arm and the body behind it stays body. Islands without seeds go to their neighbours. Pieces of the mesh
     apart from the body (tails added from the sheets' side views) are the 'tail' when parts.json says so.
  2. joints: each part's pivot is at its joint hint (u, v: where it meets its parent in the picture), as deep as the
     part's border with its neighbours there; its rest direction and length point from there to the part's middle/end.
  3. a sewn limb: where a limb lies fused along the body (an arm down the side, a leg on the tummy, a dog's ear on its
     cheek) the mesh is CUT along that crease — only the joint itself (within the joint radius of the pivot) stays one
     surface — and both sides get their own inner surface across the cut (two membranes, offset a hair apart, hidden
     inside at rest, flat colour from the side they close), so a limb swinging out shows a gap like a real plush, not a
     web of stretched skin dragging the body along. The head, hats and lips are never cut.
  4. skin: one bone per vertex + how much of it (s, 0..1: 0 = its parent's motion, 1 = the bone's): s ramps up over a
     narrow band from the joint (geodesic, along the part), so the limb turns as one piece and the joint bends softly.
     Atlas-seam copies of one vertex get the same weights (the two sides of a cut, on purpose, don't).

Adds to the friend's entry: bones [{n name, t type, p parent, o pivot, d rest direction, l length, r joint radius}]
(bone 0 = the body) and sk (uint8 per vertex: bone, s·255); the mesh itself grows by the cut copies + membranes.
js/rig.js reads them (springs, gravity, poses; skinning before plushDeform).

usage:  python tools/rig.py --base <un-rigged friends-3d.js> [--only monkey,ant] [--nocut]   (writes js/friends-3d.js)
        (make_3d.py: rig_hook(kind, r, art) after build())
"""
import argparse
import base64
import json
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = os.path.join(ROOT, 'design', 'parts')
PX = 1.3 / 600
NB = 12                                    # bones per friend at most (js/rig.js)
EPS = 4e-4                                 # membranes: this far inside the side they close
# per part type: cut = the crease along its neighbours is cut (a sewn limb) beyond the joint radius; jr = joint radius
# (share of the part's thickness at the joint); band = the soft band at the joint (share of the joint radius)
TYPE = {
    'head': dict(cut=False, band=0.08),        # (band in friend units for the uncut ones: the neck, a hat's rim)
    'hat': dict(cut=False, band=0.035),
    'lips': dict(cut=False, band=0.03),
    'ear': dict(cut=True, jr=0.75, band=0.9),
    'antenna': dict(cut=True, jr=0.9, band=0.8),
    'arm': dict(cut=True, jr=0.6, band=0.8),
    'wing': dict(cut=True, jr=0.6, band=0.8),
    'leg': dict(cut=True, jr=0.55, band=0.8),
    'tail': dict(cut=True, jr=0.8, band=1.0),
    'fin': dict(cut=True, jr=0.7, band=0.8),
    'fan': dict(cut=True, jr=0.45, band=0.8),
}


def load_parts(kind):
    jp = os.path.join(PARTS, 'parts.json')
    mp = os.path.join(PARTS, kind + '.png')
    if not os.path.exists(jp) or not os.path.exists(mp):
        return None
    meta = json.load(open(jp)).get(kind)
    if not meta:
        return None
    return meta, np.asarray(Image.open(mp))


def weld(v):
    key = np.round(v * 1e5).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return inv.ravel(), v[first]


def vnormals(P, F):
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def graph(P, F, N=None, crease=0.0, mask=None, climb=0.0):
    """edges of the mesh as a sparse graph; crease > 0: a concave fold costs (1 + crease·curvature) times its length;
    climb: going up or down costs that much more per unit of height (so labels spread round the body at their own
    height: the back of the head is reached from the face round the sides, not from the tummy up the back)"""
    from scipy.sparse import csr_matrix
    E = np.unique(np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1), axis=0)
    if mask is not None:
        E = E[mask[E[:, 0]] & mask[E[:, 1]]]
    d = P[E[:, 1]] - P[E[:, 0]]
    ln = np.linalg.norm(d, axis=1) + 1e-9
    c = ln
    if crease and N is not None:
        kap = np.einsum('ij,ij->i', N[E[:, 1]] - N[E[:, 0]], d) / ln ** 2      # + convex, - concave (1/radius)
        c = ln * (1 + crease * np.maximum(0, -kap))
    if climb:
        c = c + climb * np.abs(d[:, 1])
    n = len(P)
    return csr_matrix((np.r_[c, c], (np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]])), shape=(n, n)), E


def smooth01(a, b, x):
    k = np.clip((x - a) / max(b - a, 1e-9), 0, 1)
    return k * k * (3 - 2 * k)


def loops_of(edges):
    """closed loops from a set of directed boundary edges (a -> b)"""
    nxt = {}
    for a, b in edges:
        nxt.setdefault(a, []).append(b)
    out, used = [], set()
    for a0, b0 in edges:
        if (a0, b0) in used:
            continue
        loop, a, b = [a0], a0, b0
        used.add((a, b))
        while b != a0 and len(loop) < 5000:
            loop.append(b)
            cand = [c for c in nxt.get(b, []) if (b, c) not in used]
            if not cand:
                break
            a, b = b, cand[0]
            used.add((a, b))
        if b == a0 and len(loop) >= 3:
            out.append(loop)
    return out


def ear_clip(xy):
    """triangulate a simple polygon (counter-clockwise, n x 2); None if it can't"""
    idx = list(range(len(xy)))
    tris = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    guard = 0
    while len(idx) > 3 and guard < 20000:
        guard += 1
        n = len(idx)
        done = False
        for k in range(n):
            i0, i1, i2 = idx[(k - 1) % n], idx[k], idx[(k + 1) % n]
            a, b, c = xy[i0], xy[i1], xy[i2]
            if cross(a, b, c) <= 1e-12:
                continue
            ok = True
            for j in idx:
                if j in (i0, i1, i2):
                    continue
                p = xy[j]
                if cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0:
                    ok = False
                    break
            if ok:
                tris.append((i0, i1, i2))
                idx.pop(k)
                done = True
                break
        if not done:
            return None
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


def split_tris(v, f, attrs, uid, labw, Phi, depth):
    """cut the triangles whose corners have different labels along the smooth boundary (where the two labels' smoothed
    fields are equal), so a cut is a clean seam, not a zig-zag of whole triangles: new vertices on those edges (and one
    in the middle where three labels meet), attributes interpolated. -> v, f, attrs, face labels, vertex labels"""
    nv = len(v)
    newv, edge_new, out_f, out_l = [], {}, [], []

    def cross(oa, ob):
        key = (oa, ob) if oa < ob else (ob, oa)
        if key in edge_new:
            return edge_new[key]
        xa, xb = uid[key[0]], uid[key[1]]
        la, lb = labw[xa], labw[xb]
        da, db = Phi[xa, la] - Phi[xa, lb], Phi[xb, la] - Phi[xb, lb]
        t = da / (da - db) if da - db > 1e-9 else 0.5
        t = min(0.8, max(0.2, t))
        i = nv + len(newv)
        newv.append(((key[0], 1 - t), (key[1], t), la if depth[la] >= depth[lb] else lb))
        edge_new[key] = i
        return i
    for tri in f:
        o = [int(x) for x in tri]
        ls = [labw[uid[x]] for x in o]
        if ls[0] == ls[1] == ls[2]:
            out_f.append(o); out_l.append(ls[0])
            continue
        if len(set(ls)) == 2:
            k = [i for i in range(3) if ls.count(ls[i]) == 1][0]
            a_, b_, c_ = o[k], o[(k + 1) % 3], o[(k + 2) % 3]
            la_, lb_ = ls[k], ls[(k + 1) % 3]
            cab, cac = cross(a_, b_), cross(a_, c_)
            out_f += [[a_, cab, cac], [cab, b_, c_], [cab, c_, cac]]
            out_l += [la_, lb_, lb_]
            continue
        a_, b_, c_ = o
        cab, cbc, cca = cross(a_, b_), cross(b_, c_), cross(c_, a_)
        g = nv + len(newv)
        newv.append(((a_, 1 / 3), (b_, 1 / 3), (c_, 1 / 3), max(ls, key=lambda l: depth[l])))
        out_f += [[a_, cab, g], [a_, g, cca], [b_, cbc, g], [b_, g, cab], [c_, cca, g], [c_, g, cbc]]
        out_l += [ls[0], ls[0], ls[1], ls[1], ls[2], ls[2]]
    vl = [labw[uid[i]] for i in range(nv)]
    if newv:
        add = {k: [] for k in attrs}
        vs = []
        for nvx in newv:
            ws = nvx[:-1]
            vs.append(sum(v[i] * w for i, w in ws))
            for k in attrs:
                add[k].append(sum(np.asarray(attrs[k][i], np.float64) * w for i, w in ws))
            vl.append(nvx[-1])
        v = np.concatenate([v, np.array(vs)])
        for k in attrs:
            attrs[k] = np.concatenate([np.asarray(attrs[k], np.float64), np.array(add[k])])
    return v, np.array(out_f, np.int64), attrs, np.array(out_l, np.int64), np.array(vl, np.int64)


def atlas_of(r):
    """the atlas as an array (rows from the top), to pick membrane colours"""
    if 'tex' in r and not isinstance(r['tex'], str):
        return np.asarray(r['tex'], np.float32)
    url = r.get('tex_url')
    if url:
        import io
        return np.asarray(Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGB'), np.float32) / 255
    return None


def rig_mesh(kind, r, art, cut=True, log=print):
    """r: {'v','f','fw', 'uv' (atlas) or 'c' (colours)} -> the same, cut and grown, + r['rig'] (packed fields)"""
    pk = load_parts(kind)
    if not pk:
        return r
    meta, L = pk
    from scipy.sparse.csgraph import dijkstra, connected_components
    from scipy.sparse import csr_matrix
    from scipy.spatial import cKDTree
    a = art[kind]
    w, h, u = a['w'] * PX, a['h'] * PX, a['head'][0]
    v, f, fw = np.asarray(r['v'], np.float64), np.asarray(r['f'], np.int64), np.asarray(r['fw'], np.float64)
    uid, P = weld(v)
    nu = len(P)
    F = uid[f]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    N = vnormals(P, F)
    fwu = np.zeros(nu)
    np.maximum.at(fwu, uid, fw)
    # bones: 0 = the body, then the parts (parents first)
    parts = [dict(p) for p in meta['parts']]
    names = ['body'] + [p['name'] for p in parts]
    order, placed = [], {'body'}
    while len(order) < len(parts):
        moved = False
        for p in parts:
            if p['name'] not in placed and (p['parent'] in placed or p['parent'] not in names):
                order.append(p); placed.add(p['name']); moved = True
        if not moved:
            order += [p for p in parts if p['name'] not in placed]
            break
    parts = order[:NB - 1]
    bi = {'body': 0}
    for i, p in enumerate(parts):
        bi[p['name']] = i + 1
    par = [0] + [bi.get(p['parent'], 0) for p in parts]
    lab_of_id = {1: 0}
    for p in parts:
        if 'id' in p:
            lab_of_id[p['id']] = bi[p['name']]
    # 1. seeds from the mask (front-seen vertices, not on a mask edge), then over the mesh
    from scipy import ndimage as ndi
    Hh, W = L.shape
    px = np.clip(((P[:, 0] / w + u) * W).astype(int), 0, W - 1)
    py = np.clip(((1 - P[:, 1] / h) * Hh).astype(int), 0, Hh - 1)
    agree = ndi.maximum_filter(L, 3) == ndi.minimum_filter(L, 3)
    lid = L[py, px].astype(int)
    seed = np.full(nu, -1)
    ok = (fwu > 0.35) & agree[py, px]
    for k, b in lab_of_id.items():
        seed[ok & (lid == k)] = b
    # behind the front: a vertex further back in the same column is still that part while it's within the part's own
    # thickness of the front surface (the back of the head, of an ear, of an arm out at the side); deeper than that
    # it's what the part sits in front of (the body behind a paw, a foot, a front leg) — left to step 2
    cell = 0.01
    gx = np.floor(P[:, 0] / cell).astype(int); gy = np.floor(P[:, 1] / cell).astype(int)
    gx -= gx.min(); gy -= gy.min()
    zhi = np.full((gx.max() + 3, gy.max() + 3), -9.0)
    np.maximum.at(zhi, (gx + 1, gy + 1), P[:, 2])
    zf = ndi.maximum_filter(zhi, 3)[gx + 1, gy + 1]
    upp = h / Hh                                    # friend units per mask pixel
    inner = ndi.minimum_filter(L, 3) == ndi.maximum_filter(L, 3)
    # (how deep, as a share of the part's width in the picture: a head or an ear is about as deep as it is wide; an arm a
    # bit less; legs mostly lie in front of the body — only their front half)
    DEEP = {'head': 1.2, 'ear': 1.1, 'antenna': 1.1, 'hat': 1.0, 'fan': 1.1, 'fin': 0.7, 'tail': 1.1, 'lips': 0.8,
            'arm': 0.75, 'wing': 0.75, 'leg': 0.45}
    for p in parts:
        if 'id' not in p:
            continue
        m = L == p['id']
        if not m.any():
            continue
        th = 2 * ndi.distance_transform_edt(m).max() * upp
        col = (seed < 0) & (lid == p['id']) & inner[py, px] & (zf - P[:, 2] < DEEP.get(p['type'], 0.8) * th + 0.015)
        seed[col] = bi[p['name']]
    # the body's own columns are the body all the way to its back (the back of the torso behind the shirt)
    seed[(seed < 0) & (lid == 1) & inner[py, px]] = 0
    Ns = N.copy()
    _, E0 = graph(P, F)
    for _ in range(4):
        acc = Ns.copy()
        np.add.at(acc, E0[:, 0], Ns[E0[:, 1]]); np.add.at(acc, E0[:, 1], Ns[E0[:, 0]])
        Ns = acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12)
    G, E = graph(P, F, Ns, crease=0.3, climb=1.5)
    ncomp, comp = connected_components(G, directed=False)
    main = np.bincount(comp).argmax()
    extra = comp != main
    tail_extra = [p for p in parts if p.get('mesh') == 'extra']
    seed[extra] = -1
    tail_comp = -1
    if tail_extra and extra.any():
        cs = [c for c in range(ncomp) if c != main and (comp == c).sum() >= 30 and fwu[comp == c].mean() < 0.25
              and P[comp == c, 2].mean() < P[~extra, 2].mean()]
        if cs:
            tail_comp = max(cs, key=lambda c: (comp == c).sum())
            seed[comp == tail_comp] = bi[tail_extra[0]['name']]
    loose = extra & (comp != tail_comp)            # (other loose bits: an eye dome, a button — their nearest neighbour's)
    S = np.nonzero(seed >= 0)[0]
    log('  rig seeds: ' + ', '.join(f'{names[i]} {(seed == i).sum()}' for i in range(len(names)) if i < NB))
    dist, _, src = dijkstra(G, indices=S, min_only=True, return_predecessors=True)
    lab = np.where(src >= 0, seed[np.maximum(src, 0)], 0)
    if loose.any():
        on = np.nonzero(~loose)[0]
        _, ii = cKDTree(P[on]).query(P[loose])
        lab[loose] = lab[on[ii]]
    # islands of a label without a seed of it -> the neighbours' label
    for it in range(4):
        same = lab[E[:, 0]] == lab[E[:, 1]]
        from scipy.sparse import csr_matrix
        Es = E[same]
        Gs = csr_matrix((np.ones(len(Es)), (Es[:, 0], Es[:, 1])), shape=(nu, nu))
        nc, cc = connected_components(Gs, directed=False)
        has = np.zeros(nc, bool)
        has[cc[seed == lab]] = True
        bad = ~has[cc]
        if not bad.any():
            break
        for _ in range(30):
            if not bad.any():
                break
            votes = {}
            for x, y in E:
                if bad[x] and not bad[y]:
                    votes.setdefault(x, []).append(lab[y])
                if bad[y] and not bad[x]:
                    votes.setdefault(y, []).append(lab[x])
            for x, vs in votes.items():
                lab[x] = np.bincount(vs).argmax(); bad[x] = False
    # every label is one piece: smaller pieces of it (specks on the back of the body, a limb's stray patch) go to
    # what surrounds them
    for it in range(3):
        same = lab[E[:, 0]] == lab[E[:, 1]]
        Es = E[same]
        Gs = csr_matrix((np.ones(len(Es)), (Es[:, 0], Es[:, 1])), shape=(nu, nu))
        nc, cc = connected_components(Gs, directed=False)
        size = np.bincount(cc)
        best = {}
        lab_c = np.zeros(nc, np.int64)
        lab_c[cc] = lab
        for c in np.argsort(-size):
            best.setdefault(lab_c[c], c)
        bad = np.array([best.get(lab_c[c]) != c for c in range(nc)])[cc]
        bad &= ~extra
        if not bad.any():
            break
        for _ in range(60):
            if not bad.any():
                break
            votes = {}
            for x, y in E:
                if bad[x] and not bad[y]:
                    votes.setdefault(x, []).append(lab[y])
                if bad[y] and not bad[x]:
                    votes.setdefault(y, []).append(lab[x])
            if not votes:
                break
            for x, vs in votes.items():
                lab[x] = np.bincount(vs).argmax(); bad[x] = False
    nb = len(names) if len(names) <= NB else NB
    depth = [0] * nb
    for b in range(1, nb):
        q, k = b, 0
        while q and k < 8:
            q, k = par[q], k + 1
        depth[b] = k
    # smooth boundaries: each label's indicator smoothed over the mesh, the strongest wins; then the triangles on a
    # boundary are cut along it (clean seams)
    Phi = np.zeros((nu, nb))
    Phi[np.arange(nu), np.minimum(lab, nb - 1)] = 1
    deg = np.bincount(E.ravel(), minlength=nu).astype(np.float64)
    for _ in range(5):
        acc = np.zeros_like(Phi)
        np.add.at(acc, E[:, 0], Phi[E[:, 1]]); np.add.at(acc, E[:, 1], Phi[E[:, 0]])
        Phi = 0.5 * Phi + 0.5 * acc / np.maximum(deg, 1)[:, None]
    lab = np.where(extra, lab, Phi.argmax(1))
    attrs = {'fw': fw}
    if 'uv' in r:
        attrs['uv'] = r['uv']
    if 'c' in r:
        attrs['c'] = np.asarray(r['c'], np.float64)
    v, f, attrs, fl_o, vl = split_tris(v, f, attrs, uid, lab, Phi, depth)
    fw = attrs['fw']
    r = dict(r)
    if 'uv' in attrs:
        r['uv'] = attrs['uv']
    if 'c' in attrs:
        r['c'] = np.clip(np.round(attrs['c']), 0, 255).astype(np.uint8)
    uid, P = weld(v)
    nu = len(P)
    lab = np.zeros(nu, np.int64)
    lab[uid] = vl
    F = uid[f]
    fl = fl_o
    N = vnormals(P, F)
    G, E = graph(P, F)
    ncomp, comp = connected_components(G, directed=False)
    extra = comp != np.bincount(comp).argmax()
    fwu = np.zeros(nu)
    np.maximum.at(fwu, uid, fw)
    # vertex -> faces
    vf = [[] for _ in range(nu)]
    for fi, tri in enumerate(F):
        for x in set(tri.tolist()):
            vf[x].append(fi)

    # 2. joints
    bones = [dict(n='body', t='body', p=0, o=[0.0, 0.0, 0.0], d=[0.0, -1.0, 0.0], l=0.0, r=0.0)]
    piv = np.zeros((nb, 3)); jr = np.zeros(nb); band = np.zeros(nb)
    border = np.zeros(nu, bool)
    for x in range(nu):
        if len(set(fl[vf[x]])) > 1:
            border[x] = True
    main_pts = P[~extra]
    kd_main = cKDTree(main_pts) if extra.any() else None
    for p in parts:
        b = bi[p['name']]
        t = TYPE.get(p['type'], TYPE['arm'])
        mine = np.nonzero(lab == b)[0]
        if len(mine) < 4:
            log(f'  rig: {p["name"]} has no vertices — left out')
            bones.append(dict(n=p['name'], t=p['type'], p=par[b], o=[0.0, 0.0, 0.0], d=[0.0, -1.0, 0.0], l=0.0, r=0.0, off=1))
            continue
        if p.get('mesh') == 'extra':
            ex = mine[extra[mine]]
            dd, ii = kd_main.query(P[ex])
            k = int(np.argmin(dd))
            o = (P[ex[k]] + main_pts[ii[k]]) / 2
        else:
            jx, jy = (p['j'][0] - u) * w, (1 - p['j'][1]) * h
            ring = np.nonzero(border & (lab == b))[0]
            near = ring[np.hypot(P[ring, 0] - jx, P[ring, 1] - jy) < 0.05 * h] if len(ring) else ring
            if len(near) >= 3:
                z = float(np.median(P[near, 2]))
            else:
                col = np.nonzero(np.hypot(P[:, 0] - jx, P[:, 1] - jy) < 0.03 * h)[0]
                z = float((P[col, 2].max() + P[col, 2].min()) / 2) if len(col) else 0.0
            o = np.array([jx, jy, z])
        rel = P[mine] - o
        dl = np.linalg.norm(rel, axis=1)
        far = dl >= np.quantile(dl, 0.6)
        dvec = rel[far].mean(0)
        dvec /= max(np.linalg.norm(dvec), 1e-9)
        ln = float(np.quantile(dl, 0.95))
        radial = np.linalg.norm(rel - np.outer(rel @ dvec, dvec), axis=1)
        thick = 2 * float(np.median(radial))
        piv[b] = o
        if t['cut']:
            jr[b] = float(np.clip(t['jr'] * thick, 0.02, 0.12))
            band[b] = max(0.015, t['band'] * jr[b])
        else:
            jr[b] = 1e9
            band[b] = t['band']
        bones.append(dict(n=p['name'], t=p['type'], p=par[b], o=[round(float(x), 5) for x in o],
                          d=[round(float(x), 4) for x in dvec], l=round(ln, 4), r=round(float(min(jr[b], 1.0)), 4)))
    # 3. which faces round each vertex stay joined: a part and its parent within the part's joint radius (or never cut)

    def joined(x, a, b):
        if a == b:
            return True
        for c, q in ((a, b), (b, a)):
            if c > 0 and par[c] == q:
                if not cut or not TYPE.get(bones[c]['t'], TYPE['arm'])['cut']:
                    return True
                if np.linalg.norm(P[x] - piv[c]) < jr[c]:
                    return True
        return False
    group, members = {}, {}                      # (welded vertex, face label) -> group root; (vertex, root) -> labels
    split = np.zeros(nu, bool)
    for x in np.nonzero(border)[0]:
        ls = sorted(set(fl[vf[x]]))
        root = {l: l for l in ls}

        def find(l):
            while root[l] != l:
                l = root[l]
            return l
        for i1 in range(len(ls)):
            for i2 in range(i1 + 1, len(ls)):
                if joined(x, ls[i1], ls[i2]):
                    root[find(ls[i2])] = find(ls[i1])
        for l in ls:
            g = find(l)
            group[(x, l)] = g
            members.setdefault((x, g), set()).add(l)
        if len(set(find(l) for l in ls)) > 1:
            split[x] = True
    # skin ramps: per part, from its joint arc (border vertices joined with its parent) along the part
    s_of = np.ones(nu)
    arc_of = {}
    nbr = [[] for _ in range(nu)]
    for x, y in E:
        nbr[x].append(y); nbr[y].append(x)
    for b in range(1, nb):
        if b >= len(bones) or bones[b].get('off'):
            continue
        mine = lab == b
        if not mine.any():
            continue
        arc = [x for x in np.nonzero(border)[0] if (x, b) in group and (x, par[b]) in group
               and group[(x, b)] == group[(x, par[b])]]
        if bones[b]['t'] == 'tail' and not arc:
            dd = np.linalg.norm(P - piv[b], axis=1)
            arc = list(np.nonzero(mine & (dd < max(jr[b], 0.02)))[0])
        arc_of[b] = set(arc)
        if not arc:
            continue
        sub = mine.copy()
        sub[arc] = True
        Gp, _ = graph(P, F, mask=sub)
        d = dijkstra(Gp, indices=np.array(arc), min_only=True)
        s_of[mine] = smooth01(0.0, band[b], d[mine])
        s_of[list(arc)] = 0.0

    def s_bone(b, x):
        if lab[x] == b:
            return float(s_of[x])
        if x in arc_of.get(b, ()):
            return 0.0
        ss = [s_of[y] for y in nbr[x] if lab[y] == b]
        return float(max(ss)) if ss else 1.0

    def skin(x, g):
        """(bone, s) of welded vertex x on the side of group g: the group's top bone (a joint arc moves with the parent)"""
        mem = members.get((x, g), {g})
        t = min(mem, key=lambda l: depth[l])
        return (0, 1.0) if t == 0 else (t, s_bone(t, x))
    # 4. the cut: a vertex copy used by faces of more than one group splits into one copy per group
    nv0 = len(v)
    fidx = np.arange(len(f))
    f2 = f.copy()
    key_new, newsrc, newgrp, first_group = {}, [], [], {}
    for k, fi in enumerate(fidx):
        lf = fl[k]
        for c in range(3):
            o = f[fi, c]
            x = uid[o]
            if not split[x]:
                continue
            g = group[(x, lf)]
            if o not in first_group:
                first_group[o] = g
            if first_group[o] == g:
                continue
            if (o, g) not in key_new:
                key_new[(o, g)] = nv0 + len(newsrc)
                newsrc.append(o); newgrp.append(g)
            f2[fi, c] = key_new[(o, g)]
    any_face = {}
    for k, fi in enumerate(fidx):
        for c in range(3):
            any_face.setdefault(uid[f[fi, c]], fl[k])
    vb, vs = [], []
    for o in range(nv0):
        x = uid[o]
        if split[x]:
            g = first_group.get(o, group[(x, any_face[x])])
        elif border[x]:
            g = group[(x, any_face[x])]
        else:
            g = lab[x]
        b2, s2 = skin(x, g)
        vb.append(b2); vs.append(s2)
    for o, g in zip(newsrc, newgrp):
        b2, s2 = skin(uid[o], g)
        vb.append(b2); vs.append(s2)
    nb_bone, nb_s = np.array(vb, np.int64), np.array(vs)
    v2 = np.concatenate([v, v[newsrc]]) if newsrc else v.copy()
    fw2 = np.concatenate([fw, fw[newsrc]]) if newsrc else fw.copy()
    uv2 = (np.concatenate([r['uv'], r['uv'][newsrc]]) if newsrc else r['uv'].copy()) if 'uv' in r else None
    c2 = (np.concatenate([r['c'], r['c'][newsrc]]) if newsrc else np.asarray(r['c']).copy()) if 'c' in r else None
    # 5. membranes across each cut: the loop round the part's faces, triangulated, twice (one for each side)
    mem_v, mem_f, mem_b, mem_s, mem_uv, mem_c = [], [], [], [], [], []
    nmem = 0
    first_copy = {}
    for o in range(nv0):
        first_copy.setdefault(uid[o], o)

    atl = atlas_of(r) if 'uv' in r else None

    def texel(side, c0, rad, lips=None):
        """a vertex of that side on the cut (its lip) whose colour is the median there: the membrane's flat colour"""
        cand = np.array(lips if lips is not None and len(lips) >= 3 else [], np.int64)
        if len(cand) < 3:
            cand = np.nonzero((lab == side) & (np.linalg.norm(P - c0, axis=1) < rad))[0]
        if len(cand) < 3:
            cand = np.nonzero(lab == side)[0]
        if not len(cand):
            cand = np.arange(nu)
        oo = np.array([first_copy[x] for x in cand])
        if atl is not None:
            Hh_, Ww_ = atl.shape[:2]
            uvv = r['uv'][oo]
            col = atl[np.clip(((1 - uvv[:, 1]) * Hh_).astype(int), 0, Hh_ - 1), np.clip((uvv[:, 0] * Ww_).astype(int), 0, Ww_ - 1)]
        elif 'c' in r:
            col = np.asarray(r['c'], np.float64)[oo]
        else:
            return oo[np.argmin(np.linalg.norm(P[cand] - c0, axis=1))]
        med = np.median(col, 0)
        return oo[np.argmin(np.linalg.norm(col - med, axis=1))]
    if cut:
        for b in range(1, nb):
            if b >= len(bones) or bones[b].get('off') or not TYPE.get(bones[b]['t'], TYPE['arm'])['cut']:
                continue
            fb = np.nonzero(fl == b)[0]
            if not len(fb):
                continue
            efa = set()
            for fi in fb:
                tri = F[fi]
                for c in range(3):
                    efa.add((tri[c], tri[(c + 1) % 3]))
            bd = [(x, y) for (x, y) in efa if (y, x) not in efa]
            if not bd or not any(split[x] or split[y] for x, y in bd):
                continue
            for loop in loops_of(bd):
                if not any(split[x] for x in loop):
                    continue
                Q = P[loop]
                c0 = Q.mean(0)
                _, _, Vt = np.linalg.svd(Q - c0)
                n0 = Vt[2]
                if n0 @ (P[lab == b].mean(0) - c0) > 0:
                    n0 = -n0                       # (points away from the part)
                e1 = Vt[0]; e2 = np.cross(n0, e1)
                xy = np.stack([(Q - c0) @ e1, (Q - c0) @ e2], 1)
                area = 0.5 * np.sum(xy[:, 0] * np.roll(xy[:, 1], -1) - np.roll(xy[:, 0], -1) * xy[:, 1])
                lp = list(range(len(loop)))
                if area < 0:
                    lp = lp[::-1]
                tris = ear_clip(xy[lp])
                fan = tris is None
                if fan:
                    tris = [(len(lp), i, (i + 1) % len(lp)) for i in range(len(lp))]
                # the other side: per loop vertex the group of the faces that aren't the part's
                others = []
                for x in loop:
                    gs = [group.get((x, l), l) for l in fl[vf[x]] if group.get((x, l), l) != group.get((x, b), b)]
                    others.append(max(set(gs), key=gs.count) if gs else group.get((x, b), b))
                labs_o = [min(members.get((x, g), {g}), key=lambda l: depth[l]) for x, g in zip(loop, others)]
                oth = max(set(labs_o), key=labs_o.count)
                rad = 1.3 * float(np.max(np.linalg.norm(Q - c0, axis=1)))
                ring1 = set(x2 for x in loop for x2 in nbr[x])
                lips_p = [x for x in ring1 if lab[x] == b] or None
                lips_o = [x for x in ring1 if lab[x] == oth] or None
                for side in ('part', 'other'):
                    o_t = texel(b if side == 'part' else oth, c0, rad, lips_p if side == 'part' else lips_o)
                    base = len(v2) + nmem
                    sign = -1.0 if side == 'part' else 1.0
                    for i in lp:
                        x = loop[i]
                        g = group.get((x, b), b) if side == 'part' else others[i]
                        b2, s2 = skin(x, g)
                        mem_v.append(P[x] + sign * EPS * n0); mem_b.append(b2); mem_s.append(s2)
                        mem_uv.append(r['uv'][o_t] if 'uv' in r else None)
                        mem_c.append(r['c'][o_t] if 'c' in r else None)
                    if fan:
                        mem_v.append(c0 + sign * EPS * n0)
                        mem_b.append(b if side == 'part' else oth); mem_s.append(1.0)
                        mem_uv.append(r['uv'][o_t] if 'uv' in r else None)
                        mem_c.append(r['c'][o_t] if 'c' in r else None)
                    for (i0, i1, i2) in tris:
                        # the part's side faces out of the part (+n0), the other side's back toward it
                        mem_f.append((base + i0, base + i1, base + i2) if side == 'part' else (base + i0, base + i2, base + i1))
                    nmem += len(lp) + (1 if fan else 0)
    if nmem:
        v2 = np.concatenate([v2, np.array(mem_v)])
        fw2 = np.concatenate([fw2, np.zeros(nmem)])
        if uv2 is not None:
            uv2 = np.concatenate([uv2, np.array(mem_uv)])
        if c2 is not None:
            c2 = np.concatenate([c2, np.array(mem_c)])
        nb_bone = np.r_[nb_bone, np.array(mem_b)]
        nb_s = np.r_[nb_s, np.array(mem_s)]
        f2 = np.concatenate([f2, np.array(mem_f)])
    # bones that rotate nothing (no vertices) stay in the list, still
    sk = np.stack([np.clip(nb_bone, 0, 255), np.clip(np.round(nb_s * 255), 0, 255)], 1).astype(np.uint8)
    out = dict(r)
    out['v'], out['f'], out['fw'] = v2, f2, fw2
    if uv2 is not None:
        out['uv'] = uv2
    if c2 is not None:
        out['c'] = c2
    for bn in bones:
        bn.pop('off', None)
    out['rig'] = {'bones': bones, 'sk': base64.b64encode(np.ascontiguousarray(sk).tobytes()).decode()}
    cnt = np.bincount(lab, minlength=nb)
    log(f'  rig: {len(bones) - 1} parts ' + ', '.join(f'{bn["n"]} {cnt[i]}' for i, bn in enumerate(bones) if i) +
        f' · cut {int(split.sum())} verts (+{len(newsrc)} copies), membranes +{nmem} verts')
    out['_debug'] = dict(lab=lab, uid=uid, piv=piv, jr=jr)
    return out


def rig_hook(kind, r, art):
    """tools/make_3d.py, at the end of a friend's build"""
    try:
        return rig_mesh(kind, r, art)
    except Exception as e:                        # (a rig that fails leaves the friend as it was: no rig data)
        import traceback
        traceback.print_exc()
        print(f'  rig: FAILED for {kind} ({e}) — no rig')
        return r


# ── on its own: rig the friends of an existing friends-3d.js ─────────────────────────────────────────────────────────
def decode(e):
    b = lambda s: np.frombuffer(base64.b64decode(s), np.uint8)
    q = np.frombuffer(base64.b64decode(e['pos']), '<u2').reshape(-1, 3).astype(np.float64)
    lo, hi = np.array(e['lo']), np.array(e['hi'])
    r = {'v': lo + q / 65535 * (hi - lo), 'f': np.frombuffer(base64.b64decode(e['idx']), '<u2').reshape(-1, 3).astype(np.int64),
         'fw': b(e['fw']).astype(np.float64) / 255}
    if 'uv' in e:
        r['uv'] = np.frombuffer(base64.b64decode(e['uv']), '<u2').reshape(-1, 2).astype(np.float64) / 65535
        r['tex_url'] = e['tex']
    if 'col' in e:
        r['c'] = b(e['col']).reshape(-1, 3)
    return r


def encode(r):
    v, f, fw = r['v'], r['f'], r['fw']
    lo, hi = v.min(0), v.max(0)
    q = np.round((v - lo) / np.maximum(hi - lo, 1e-6) * 65535).astype('<u2')
    b = lambda arr: base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()
    out = {'n': int(len(v)), 'm': int(f.size), 'lo': [round(float(x), 5) for x in lo], 'hi': [round(float(x), 5) for x in hi],
           'pos': b(q), 'fw': b(np.round(np.clip(fw, 0, 1) * 255).astype(np.uint8)), 'idx': b(f.astype('<u2'))}
    if 'c' in r:
        out['col'] = b(np.asarray(r['c']).astype(np.uint8))
    if 'uv' in r:
        out['uv'] = b(np.round(np.clip(r['uv'], 0, 1) * 65535).astype('<u2'))
        out['tex'] = r['tex_url']
    out.update(r.get('rig', {}))
    return out


HEAD = ('/* generated by tools/make_3d.py — do not edit: the friends\' 3D shapes (TripoSR, made locally from the\n'
        '   pictures; with a character sheet, fitted to its outlines and textured from its views). Per friend:\n'
        '   n vertices, m indices, lo/hi box, pos (uint16 in the box), fw (uint8 front weight: shows the picture),\n'
        '   idx (uint16 triangles); then either col (rgb8, the guessed colours behind) or uv (uint16 atlas coords)\n'
        '   + tex (the atlas, a webp data URL); rig (tools/rig.py): bones + sk (uint8 bone, share per vertex). */\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True, help='un-rigged friends-3d.js to start from')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=os.path.join(ROOT, 'js', 'friends-3d.js'))
    ap.add_argument('--nocut', action='store_true')
    ap.add_argument('--dump', default='', help='write labels per welded vertex (npz) here')
    o = ap.parse_args()
    s = open(o.base, encoding='utf-8').read()
    data = json.loads(re.search(r'=\s*(\{.*\});?\s*$', s, re.S).group(1))
    if os.path.exists(o.out) and os.path.abspath(o.out) != os.path.abspath(o.base):
        s2 = open(o.out, encoding='utf-8').read()
        cur = json.loads(re.search(r'=\s*(\{.*\});?\s*$', s2, re.S).group(1))
    else:
        cur = dict(data)
    a = json.loads(open(os.path.join(ROOT, 'js', 'friends-art.js'), encoding='utf-8').read().split('=', 1)[1].strip().rstrip(';'))
    for k in data:
        if o.only and k not in o.only.split(','):
            continue
        print(k)
        r = rig_mesh(k, decode(data[k]), a, cut=not o.nocut)
        if o.dump and '_debug' in r:
            os.makedirs(o.dump, exist_ok=True)
            np.savez(os.path.join(o.dump, k + '.npz'), **r['_debug'])
        assert len(r['v']) < 65536
        cur[k] = encode(r)
    with open(o.out, 'w', encoding='utf-8') as fh:
        fh.write(HEAD)
        fh.write('window.CLAW_FRIENDS_3D = ' + json.dumps(cur, separators=(',', ':')) + ';\n')
    print('wrote', o.out, os.path.getsize(o.out) // 1024, 'KB')


if __name__ == '__main__':
    main()
