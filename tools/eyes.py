"""Toy Catch — the build-side half of the friends' new eyes (js/eyes.js puts glossy eyes with whites on the 3D friends
at load: domes over the eyes painted in the pictures, placed by casting rays at whatever mesh make_3d.py made).

  detect  fit the eyes painted in each picture — a dark blob in a window round a seed (the centres in js/eyes.js's
          TABLE, or --seed kind:u,v[;u,v]) — print [u, v, rx, ry, tilt] rows for the TABLE and write a grid overlay
          (red: the table's painted eye, green: the new eye's outline) to check them by eye:
            python3 tools/eyes.py detect [--only cat,dog] [--out DIR]
  atlas   no painted eyes left on the 3D friends' atlases: the character sheets' side / back / face-on views and the
          mirrored picture carry their own eyes, which showed beside the new domes when a friend turns (the fish's
          face-on view had a dark crescent next to each eye). Every atlas texel near an eye is mapped to its 3D point;
          eye-sized dark blobs there (and the white shine on them) are filled from the fabric round them, in 3D (the
          atlas charts are cut up), and the gutters next to them follow. Independent of how the atlas was made:
            ~/dev/tools/TripoSR/.venv/bin/python tools/eyes.py atlas [--only fish] [--debug DIR] [--force]
          rewrites js/friends-3d.js (marks each friend done: "eyes": 1). make_3d.py runs the same step (post_bake) at
          the end of every friend's build, so a rebuilt friend comes out clean.
numpy + scipy + PIL (the TripoSR venv has them; detect needs only numpy/PIL/scipy too).
"""
import argparse
import base64
import io
import json
import os
import re

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PX = 1.3 / 600                        # friends.js: a 600-px-tall picture is 1.3 units tall


def load_js_json(name, marker=None):
    s = open(os.path.join(ROOT, 'js', name), encoding='utf-8').read()
    if marker:
        m = re.search(r'/\*@' + marker + r'\*/(.*?)/\*@end\*/', s, re.S)
        return json.loads(m.group(1)), s
    m = re.search(r'=\s*(\{.*\});?\s*$', s, re.S)
    return json.loads(m.group(1)), s


def eye_consts():
    """the TABLE and the sizing constants, from js/eyes.js (one source of truth)"""
    table, s = load_js_json('eyes.js', 'eyes')
    k = {}
    for name in ('GROW', 'GROW_RING', 'MAXASP', 'FWD'):
        m = re.search(r'\b' + name + r'\s*=\s*([0-9.]+)', s)
        k[name] = float(m.group(1))
    return table, k


def picture(a):
    return Image.open(io.BytesIO(base64.b64decode(a['src'].split(',', 1)[1]))).convert('RGBA')


# ── detect ────────────────────────────────────────────────────────────────────────────────────────────────────────
def otsu(x):
    h, e = np.histogram(x, 64)
    c = (e[:-1] + e[1:]) / 2
    w0 = np.cumsum(h); w1 = w0[-1] - w0
    m0 = np.cumsum(h * c) / np.maximum(w0, 1); m1 = (np.sum(h * c) - np.cumsum(h * c)) / np.maximum(w1, 1)
    return c[np.argmax(w0 * w1 * (m0 - m1) ** 2)]


def fit_blob(m):
    """centre, radii along x/y (or the axes when it is clearly oval) and tilt (deg, + = top leans right) by moments"""
    ys, xs = np.nonzero(m)
    cx, cy = xs.mean(), ys.mean()
    cov = np.cov(np.stack([xs - cx, ys - cy]))
    ev, evec = np.linalg.eigh(cov)
    r0, r1 = 2 * np.sqrt(np.maximum(ev, 1e-6))
    if r1 / r0 < 1.12:
        return cx, cy, 2 * np.sqrt(cov[0, 0]), 2 * np.sqrt(cov[1, 1]), 0.0
    mx, my = evec[0, 1], evec[1, 1]
    if my > 0:
        mx, my = -mx, -my
    tilt = np.degrees(np.arctan2(mx, -my))
    if abs(tilt) > 45:
        tilt -= 90 * np.sign(tilt)
        return cx, cy, r1, r0, tilt
    return cx, cy, r0, r1, tilt


def detect(o):
    from scipy import ndimage as ndi
    art, _ = load_js_json('friends-art.js')
    table, K = eye_consts()
    seeds = {}
    for s in o.seed or []:
        k, rest = s.split(':')
        seeds[k] = [tuple(map(float, p.split(','))) for p in rest.split(';')]
    os.makedirs(o.out, exist_ok=True)
    tiles = []
    for kind, a in art.items():
        if o.only and kind not in o.only.split(','):
            continue
        im = np.asarray(picture(a)).astype(np.float32) / 255
        H, W = im.shape[:2]
        L = im[..., :3] @ np.array([0.299, 0.587, 0.114])
        al = im[..., 3] > 0.5
        tab = table.get(kind, {})
        pts = seeds.get(kind) or [(e[0], e[1]) for e in tab.get('eyes', [])]
        rows = []
        for (su, sv) in pts:
            R, sx, sy = int(0.075 * H), int(su * W), int(sv * H)
            x0, y0, x1, y1 = max(0, sx - R), max(0, sy - R), min(W, sx + R), min(H, sy + R)
            Lw = L[y0:y1, x0:x1]
            t = min(otsu(Lw[al[y0:y1, x0:x1]]), 0.5 * (np.percentile(Lw, 2) + np.median(Lw)))
            lab, n = ndi.label(ndi.binary_closing((Lw < t) & al[y0:y1, x0:x1], iterations=2))
            yy, xx = np.mgrid[y0:y1, x0:x1]
            best = min(range(1, n + 1), key=lambda i: np.min((xx[lab == i] - sx) ** 2 + (yy[lab == i] - sy) ** 2), default=0)
            if not best:
                continue
            m = np.zeros((H, W), bool); m[y0:y1, x0:x1] = ndi.binary_fill_holes(lab == best)
            cx, cy, rx, ry, tl = fit_blob(m)
            rows.append([round(cx / W, 4), round(cy / H, 4), round(rx / W, 4), round(ry / H, 4), round(float(tl), 1)])
        print(f'{kind:7s} fit  ', json.dumps(rows))
        print(f'{kind:7s} table', json.dumps(tab.get('eyes')))
        # overlay: the table's painted eye (red) and the new eye's outline (green), on a 0.01 grid
        rgb = Image.new('RGB', (W, H), (200, 225, 245)); pic = picture(a); rgb.paste(pic, (0, 0), pic)
        for e in tab.get('eyes', []):
            g = K['GROW_RING'] if tab.get('ring') else K['GROW']
            na, nb = g * e[2] * W, g * e[3] * H
            if nb > na * K['MAXASP']: na = nb / K['MAXASP']
            if na > nb * K['MAXASP']: nb = na / K['MAXASP']
            sc = 6
            R = max(na, nb) * 1.6
            box = (int(e[0] * W - R), int(e[1] * H - R), int(e[0] * W + R), int(e[1] * H + R))
            c = rgb.crop(box).resize(((box[2] - box[0]) * sc, (box[3] - box[1]) * sc), Image.LANCZOS)
            d = ImageDraw.Draw(c)
            for gv in np.arange(0, 1.0001, 0.01):
                gx, gy = (gv * W - box[0]) * sc, (gv * H - box[1]) * sc
                if 0 <= gx < c.width:
                    d.line([(gx, 0), (gx, c.height)], fill=(120, 180, 255)); d.text((gx + 2, 2), f'{gv:.2f}', fill=(0, 60, 200))
                if 0 <= gy < c.height:
                    d.line([(0, gy), (c.width, gy)], fill=(120, 180, 255)); d.text((2, gy + 2), f'{gv:.2f}', fill=(0, 60, 200))
            th = np.radians(e[4]); t = np.linspace(0, 2 * np.pi, 80)
            for (ra, rb, col) in ((e[2] * W, e[3] * H, (255, 0, 0)), (na, nb, (0, 170, 0))):
                ex, ey = ra * np.cos(t), rb * np.sin(t)
                px = (e[0] * W + ex * np.cos(th) + ey * np.sin(th) - box[0]) * sc
                py = (e[1] * H - ex * np.sin(th) + ey * np.cos(th) - box[1]) * sc
                d.line(list(zip(px, py)) + [(px[0], py[0])], fill=col, width=2)
            d.text((4, c.height - 14), kind, fill=(0, 0, 0))
            tiles.append(c.resize((260, 260), Image.LANCZOS))
    if tiles:
        n = 6
        sh = Image.new('RGB', (n * 260, ((len(tiles) + n - 1) // n) * 260), 'white')
        for i, t in enumerate(tiles):
            sh.paste(t, ((i % n) * 260, (i // n) * 260))
        sh.save(os.path.join(o.out, 'eyes_detect.png'))
        print('wrote', os.path.join(o.out, 'eyes_detect.png'))


# ── atlas ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def unit(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


def vertex_normals(v, f):
    """area-weighted, shared by the copies of a vertex along atlas seams (like friends.js)"""
    key = np.unique(np.round(v, 6), axis=0, return_inverse=True)[1].ravel()
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    acc = np.zeros((key.max() + 1, 3))
    for k in range(3):
        np.add.at(acc, key[f[:, k]], fn)
    return unit(acc)[key]


def ray_z(v, f, x, y, dz, z0):
    """first hit of the ray (x, y, z0) + t (0, 0, dz) on the mesh: point, triangle, barycentrics"""
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    o = np.array([x, y, z0]); d = np.array([0, 0, dz], float)
    e1, e2 = b - a, c - a
    p = np.cross(d, e2); det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = o - a; u = (s * p).sum(1) * inv
    q = np.cross(s, e1); w = (d * q).sum(1) * inv; t = (e2 * q).sum(1) * inv
    hit = ok & (u >= -1e-6) & (w >= -1e-6) & (u + w <= 1 + 1e-6) & (t > 0)
    if not hit.any():
        return None
    i = np.where(hit)[0][np.argmin(t[hit])]
    return o + d * t[i], i


def place_eyes(kind, v, f, n, art, table, K):
    """the eyes' frames as js/eyes.js places them (centre on the face, axis, across / up, radii) — zones for the atlas"""
    a = art[kind]
    w, h, u = a['w'] * PX, a['h'] * PX, a['head'][0]
    tab = table.get(kind)
    if not tab:
        return []
    out = []
    for e in tab['eyes']:
        for far in ([False, True] if tab.get('side') else [False]):
            x, y, dz = (e[0] - u) * w, (1 - e[1]) * h, (1 if far else -1)
            z0 = v[:, 2].min() - 1 if far else v[:, 2].max() + 1
            hit = ray_z(v, f, x, y, dz, z0)
            if hit is None:
                continue
            O = hit[0]
            g = K['GROW_RING'] if tab.get('ring') else K['GROW']
            ea, eb = g * e[2] * w, g * e[3] * h
            r0 = max(ea, eb) * 1.2
            dd = np.linalg.norm(v - O, axis=1)
            sel = dd < r0
            N = unit((n[sel] * (1 - dd[sel] / r0)[:, None]).sum(0)) if sel.any() else np.array([0, 0, -dz], float)
            F = np.array([0, 0, -dz], float)
            if N @ F < 0.05:
                N = unit(N + 0.3 * F)
            A = unit(N * (1 - K['FWD']) + F * K['FWD'])
            tr = np.radians(e[4])
            up = np.array([np.sin(tr), np.cos(tr), 0]); up = unit(up - A * (up @ A))
            t1 = unit(np.cross(up, A))
            if eb > ea * K['MAXASP']: ea = eb / K['MAXASP']
            if ea > eb * K['MAXASP']: eb = ea / K['MAXASP']
            out.append(dict(O=O, A=A, t1=t1, up=up, a=ea, b=eb, R=max(ea, eb), far=far))
    return out


def raster(v, f, uv, res, tris):
    """atlas texels of the given triangles: pixel rows/cols, 3D points, triangle ids (image row = (1 - v)·res)"""
    P = np.stack([uv[:, 0] * res - 0.5, (1 - uv[:, 1]) * res - 0.5], 1)
    rr, cc, pts, tid = [], [], [], []
    for t in tris:
        ia, ib, ic = f[t]
        A2, B2, C2 = P[ia], P[ib], P[ic]
        x0, x1 = int(np.floor(min(A2[0], B2[0], C2[0]))), int(np.ceil(max(A2[0], B2[0], C2[0])))
        y0, y1 = int(np.floor(min(A2[1], B2[1], C2[1]))), int(np.ceil(max(A2[1], B2[1], C2[1])))
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, res - 1), min(y1, res - 1)
        if x1 < x0 or y1 < y0:
            continue
        gy, gx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        gx = gx.ravel().astype(float); gy = gy.ravel().astype(float)
        d = (B2[1] - C2[1]) * (A2[0] - C2[0]) + (C2[0] - B2[0]) * (A2[1] - C2[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((B2[1] - C2[1]) * (gx - C2[0]) + (C2[0] - B2[0]) * (gy - C2[1])) / d
        l2 = ((C2[1] - A2[1]) * (gx - C2[0]) + (A2[0] - C2[0]) * (gy - C2[1])) / d
        l3 = 1 - l1 - l2
        ins = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        if not ins.any():
            continue
        p3 = l1[ins, None] * v[ia] + l2[ins, None] * v[ib] + l3[ins, None] * v[ic]
        rr.append(gy[ins].astype(int)); cc.append(gx[ins].astype(int)); pts.append(p3); tid.append(np.full(ins.sum(), t))
    if not rr:
        return None
    return np.concatenate(rr), np.concatenate(cc), np.concatenate(pts), np.concatenate(tid)


def post_bake(kind, r, art, table=None, K=None, dbg=None, quiet=False):
    """make_3d.py's last step for a friend (r: v, f, uv, tex as floats 0..1): erase the painted eyes its atlas carries
    near the new eye domes. Returns r (tex changed in place); r['eyes'] = texels changed"""
    from scipy.spatial import cKDTree
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    if 'tex' not in r or 'uv' not in r:
        return r
    if table is None or K is None:
        table, K = eye_consts()
    v, f, uv = np.asarray(r['v'], float), np.asarray(r['f']).reshape(-1, 3), np.asarray(r['uv'], float)
    tex = r['tex']
    res = tex.shape[0]
    n = vertex_normals(v, f)
    eyes = place_eyes(kind, v, f, n, art, table, K)
    if not eyes:
        return r
    ZR, ZD = 2.7, 2.2                  # the zone round an eye: within ZR radii across, ZD radii along its axis
    cen = v[f].mean(1)
    near = np.zeros(len(f), bool)
    for E in eyes:
        near |= np.linalg.norm(cen - E['O'], axis=1) < E['R'] * (ZR + 0.6)
    ras = raster(v, f, uv, res, np.where(near)[0])
    if ras is None:
        return r
    rr, cc, p3, tid = ras
    # one sample per texel (texels on two triangles' edges: keep the first)
    key = rr * res + cc
    _, first = np.unique(key, return_index=True)
    rr, cc, p3, tid = rr[first], cc[first], p3[first], tid[first]
    tn = unit(np.cross(v[f[tid, 1]] - v[f[tid, 0]], v[f[tid, 2]] - v[f[tid, 0]]))
    col = tex[rr, cc, :3].astype(np.float64)
    L = col @ np.array([0.299, 0.587, 0.114])
    mx, mn = col.max(1), col.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    zone = np.zeros(len(rr), bool); erase = np.zeros(len(rr), bool); src_ok = np.ones(len(rr), bool)
    report = []
    for E in eyes:
        d = p3 - E['O']
        X, Y, Z = d @ E['t1'] / E['a'], d @ E['up'] / E['b'], d @ E['A'] / E['R']
        rho = np.hypot(X, Y)
        z = (rho < ZR) & (Z > -ZD) & (Z < ZD)
        zone |= z
        src_ok &= ~(z & (rho < 1.0))                    # (under the dome: never a source)
        ring = z & (rho > 1.4)
        if ring.sum() < 20:
            continue
        Lm = np.median(L[ring])
        skin = np.median(col[ring], 0)
        F = np.array([0, 0, -1.0 if E['far'] else 1.0])
        dark = z & (L < min(0.5, 0.58 * Lm))
        # the white of a painted eye: near-neutral, bright, and not the fabric's own colour
        white = z & (L > 0.72) & (sat < 0.16) & (np.linalg.norm(col - skin, axis=1) > 0.22)
        cand = np.where(dark)[0]
        if len(cand) == 0:
            continue
        tree = cKDTree(p3[cand])
        pairs = tree.query_pairs(E['R'] * 0.09, output_type='ndarray')
        g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(cand), len(cand)))
        nc, lab = connected_components(g, directed=False)
        hit = np.zeros(len(rr), bool)
        for c in range(nc):
            idx = cand[lab == c]
            if len(idx) < 6:
                continue
            pc = p3[idx] - p3[idx].mean(0)
            ext = np.linalg.norm(pc, axis=1).max()
            ev = np.sort(np.linalg.eigvalsh(np.cov(pc.T)))[::-1]
            ratio = float(np.sqrt(max(ev[1], 0) / max(ev[0], 1e-12)))
            rm = float(np.median(rho[idx]))
            facing = float(unit(tn[idx].mean(0)) @ F)
            if rm < 1.0:
                ok = ext < E['R'] * 1.35                  # the painted eye under the dome (hidden anyway)
            else:
                # beside the dome: an eye another view painted there — eye-sized, roundish, on a side the picture
                # doesn't show (whiskers, nostrils, mouths, patches stay)
                ok = (E['R'] * 0.3 < ext < E['R'] * 1.35) and ratio > 0.35 and facing < 0.6
            if not ok:
                continue
            hit[idx] = True
            report.append((round(rm, 2), round(float(ext / E['R']), 2), round(ratio, 2), round(facing, 2), len(idx)))
        # and the white shine / ring on those blobs
        wi = np.where(white)[0]
        if hit.any() and len(wi):
            dw, _ = cKDTree(p3[hit]).query(p3[wi])
            hit[wi[dw < E['R'] * 0.45]] = True
        erase |= hit
    if not erase.any():
        if not quiet:
            print(f'  eyes: atlas clean round {len(eyes)} eye(s)')
        r['eyes'] = 0
        return r
    # grow the blobs a little (their soft edges), over the zone, in 3D
    zi = np.where(zone)[0]
    zt = cKDTree(p3[zi])
    Rm = min(E['R'] for E in eyes)
    grown = np.zeros(len(rr), bool)
    for lst in zt.query_ball_point(p3[erase], Rm * 0.16):
        grown[zi[lst]] = True
    grown &= zone
    erase |= grown
    # fill from the fabric round them: the nearest kept texels in 3D facing the same way, then smoothed
    src = np.where(zone & ~erase & src_ok)[0]
    st = cKDTree(p3[src])
    ei = np.where(erase)[0]
    dist, nb = st.query(p3[ei], k=16)
    wgt = 1 / np.maximum(dist, 1e-5) ** 2 * np.clip((tn[src][nb] * tn[ei][:, None]).sum(-1) + 0.2, 0.05, None)
    new = (col[src][nb] * wgt[..., None]).sum(1) / wgt.sum(1)[:, None]
    et = cKDTree(p3[ei])
    for _ in range(2):
        lst = et.query_ball_point(p3[ei], Rm * 0.08)
        new = np.stack([new[l].mean(0) for l in lst])
    out = tex.copy()
    out[rr[ei], cc[ei], :3] = new
    # gutters next to changed texels take the nearest covered texel's colour (mip-maps blend them in)
    from scipy import ndimage as ndi
    cov = np.zeros((res, res), bool)
    allr = raster(v, f, uv, res, np.arange(len(f)))
    cov[allr[0], allr[1]] = True
    changed = np.zeros((res, res), bool); changed[rr[ei], cc[ei]] = True
    near_ch = ndi.binary_dilation(changed, iterations=10) & ~cov
    if near_ch.any():
        _, (iy, ix) = ndi.distance_transform_edt(~cov, return_indices=True)
        out[near_ch] = out[iy[near_ch], ix[near_ch]]
    if dbg is not None:
        dbg['eyes_mask'] = changed
        dbg['eyes_before'] = tex.copy()
    r['tex'] = out
    r['eyes'] = int(len(ei))
    if not quiet:
        print(f'  eyes: atlas {len(ei)} texels refilled round {len(eyes)} eye(s); blobs (rho, extent/R, roundness, facing, texels): {report}')
    return r


def atlas_cmd(o):
    art, _ = load_js_json('friends-art.js')
    path = os.path.join(ROOT, 'js', 'friends-3d.js')
    data, src = load_js_json('friends-3d.js')
    table, K = eye_consts()
    head = src[:src.index('window.CLAW_FRIENDS_3D')]
    changed = False
    for kind, d in data.items():
        if o.only and kind not in o.only.split(','):
            continue
        if d.get('eyes') and not o.force:
            print(kind, '(done before: --force to redo)')
            continue
        if 'tex' not in d:
            continue
        print(kind)
        bin_ = lambda s: np.frombuffer(base64.b64decode(s), np.uint8)
        q = np.frombuffer(base64.b64decode(d['pos']), '<u2').reshape(-1, 3).astype(np.float64)
        lo, hi = np.array(d['lo']), np.array(d['hi'])
        v = lo + q / 65535 * (hi - lo)
        f = np.frombuffer(base64.b64decode(d['idx']), '<u2').reshape(-1, 3).astype(np.int64)
        uv = np.frombuffer(base64.b64decode(d['uv']), '<u2').reshape(-1, 2).astype(np.float64) / 65535
        im = Image.open(io.BytesIO(base64.b64decode(d['tex'].split(',', 1)[1]))).convert('RGB')
        tex = np.asarray(im).astype(np.float32) / 255
        dbg = {} if o.debug else None
        r = post_bake(kind, {'v': v, 'f': f, 'uv': uv, 'tex': tex}, art, table, K, dbg)
        d['eyes'] = 1
        changed = True
        if r.get('eyes'):
            buf = io.BytesIO()
            Image.fromarray(np.clip(r['tex'] * 255 + 0.5, 0, 255).astype(np.uint8)).save(buf, 'WEBP', quality=86, method=6)
            d['tex'] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
        if dbg:
            os.makedirs(o.debug, exist_ok=True)
            m = dbg['eyes_mask']
            ys, xs = np.nonzero(m)
            pad = 24
            y0, y1, x0, x1 = max(0, ys.min() - pad), ys.max() + pad, max(0, xs.min() - pad), xs.max() + pad
            b = (dbg['eyes_before'][y0:y1, x0:x1] * 255).astype(np.uint8)
            a = (np.clip(r['tex'][y0:y1, x0:x1], 0, 1) * 255).astype(np.uint8)
            mm = np.repeat(m[y0:y1, x0:x1, None], 3, 2).astype(np.uint8) * 255
            Image.fromarray(np.concatenate([b, a, mm], 1)).save(os.path.join(o.debug, f'{kind}_atlas_eyes.png'))
    if changed:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(head)
            fh.write('window.CLAW_FRIENDS_3D = ' + json.dumps(data, separators=(',', ':')) + ';\n')
        print('wrote', path, os.path.getsize(path) // 1024, 'KB')


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    d = sp.add_parser('detect'); d.add_argument('--only', default=''); d.add_argument('--seed', action='append')
    d.add_argument('--out', default=os.path.join(ROOT, 'dev', 'out'))
    a = sp.add_parser('atlas'); a.add_argument('--only', default=''); a.add_argument('--debug', default='')
    a.add_argument('--force', action='store_true')
    o = ap.parse_args()
    (detect if o.cmd == 'detect' else atlas_cmd)(o)


if __name__ == '__main__':
    main()
