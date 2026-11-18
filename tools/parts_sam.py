"""Toy Catch — the friends' movable parts, cut out of their FRONT pictures with SAM 2 (Segment Anything 2.1, Apache-2.0,
run locally — nothing leaves the Mac). For every friend a few point prompts per part (picture fractions u across, v
down — picked by eye on a grid over the picture), the best SAM mask that keeps the positive points and leaves the
negative ones out, then one label map:

  design/parts/<kind>.png   paletted PNG at the picture's size: 0 = outside, 1 = body, 2.. = the parts below
  design/parts/parts.json   per friend: the picture's size and its parts in order — name, label, type, parent, a hint
                            for the joint (u, v: where it meets its parent; tools/rig.py snaps it onto the masks and the
                            mesh), and mesh-only parts (tails the front picture doesn't show: the mesh's added pieces)

l / r = the picture's left / right. tools/rig.py turns these into bones and skin weights for whatever mesh
tools/make_3d.py makes (picture fractions, never vertex ids).

usage (SAM 2 checked out somewhere with its checkpoint; torch from the TripoSR venv is fine):
  python tools/parts_sam.py --sam2 DIR --ckpt sam2.1_hiera_large.pt [--only monkey,ant] [--sheet out.png]
"""
import argparse
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design', 'parts')

# part: pos / neg points (u, v), box (u0, v0, u1, v1) round it, max = largest share of the friend's area, j = joint hint (u, v), parent, type
# (default: the name before '_'; parent: head for ears, hats, crests, antennae — else body)
H = dict  # (just shorter)
PROMPTS = {
    'monkey': [
        ('head', H(pos=[(0.48, 0.38), (0.30, 0.24), (0.68, 0.45), (0.48, 0.22)], neg=[(0.48, 0.66), (0.30, 0.62), (0.70, 0.62)], box=(0.0, 0.0, 1.0, 0.57), max=0.55, j=(0.48, 0.55))),
        ('cap', H(pos=[(0.48, 0.09), (0.38, 0.12), (0.60, 0.13)], neg=[(0.48, 0.25)], max=0.08, j=(0.48, 0.16), type='hat')),
        ('ear_l', H(pos=[(0.06, 0.32)], neg=[(0.25, 0.33)], max=0.06, j=(0.15, 0.33))),
        ('ear_r', H(pos=[(0.94, 0.32)], neg=[(0.75, 0.33)], max=0.06, j=(0.85, 0.33))),
        ('arm_l', H(pos=[(0.07, 0.73), (0.14, 0.66)], neg=[(0.30, 0.64), (0.22, 0.91)], max=0.08, j=(0.21, 0.61))),
        ('arm_r', H(pos=[(0.93, 0.73), (0.86, 0.66)], neg=[(0.70, 0.64), (0.75, 0.91)], max=0.08, j=(0.79, 0.61))),
        ('leg_l', H(pos=[(0.22, 0.92), (0.14, 0.90)], neg=[(0.48, 0.86), (0.07, 0.73)], max=0.1, j=(0.32, 0.84))),
        ('leg_r', H(pos=[(0.75, 0.92), (0.83, 0.90)], neg=[(0.48, 0.86), (0.93, 0.73)], max=0.1, j=(0.66, 0.84))),
        ('tail', H(mesh='extra')),
    ],
    'mouse': [
        ('head', H(pos=[(0.50, 0.42), (0.50, 0.30), (0.35, 0.45), (0.66, 0.45)], neg=[(0.50, 0.74), (0.28, 0.64), (0.64, 0.64)], box=(0.0, 0.0, 1.0, 0.58), max=0.6, j=(0.50, 0.55))),
        ('ear_l', H(pos=[(0.15, 0.13), (0.08, 0.22), (0.24, 0.05), (0.04, 0.16), (0.12, 0.03)], neg=[(0.42, 0.35)], box=(0.0, 0.0, 0.37, 0.34), max=0.15, j=(0.29, 0.25))),
        ('ear_r', H(pos=[(0.85, 0.13), (0.92, 0.22), (0.76, 0.05), (0.96, 0.16), (0.88, 0.03)], neg=[(0.58, 0.35)], box=(0.63, 0.0, 1.0, 0.34), max=0.15, j=(0.71, 0.25))),
        ('arm_l', H(pos=[(0.28, 0.64), (0.25, 0.60), (0.22, 0.66)], neg=[(0.45, 0.75), (0.50, 0.45), (0.13, 0.72)], box=(0.17, 0.55, 0.43, 0.75), max=0.05, j=(0.20, 0.60))),
        ('arm_r', H(pos=[(0.64, 0.64), (0.68, 0.60), (0.73, 0.66)], neg=[(0.52, 0.75), (0.50, 0.45), (0.86, 0.72)], box=(0.56, 0.55, 0.82, 0.75), max=0.05, j=(0.78, 0.60))),
        ('leg_l', H(pos=[(0.30, 0.93)], neg=[(0.50, 0.85), (0.30, 0.80)], max=0.05, j=(0.33, 0.87))),
        ('leg_r', H(pos=[(0.68, 0.93)], neg=[(0.50, 0.85), (0.68, 0.80)], max=0.05, j=(0.65, 0.87))),
        ('tail', H(pos=[(0.912, 0.505), (0.848, 0.54), (0.808, 0.655)], neg=[(0.70, 0.73), (0.66, 0.62)], box=(0.76, 0.47, 0.97, 0.75), max=0.03, j=(0.785, 0.72))),
    ],
    'ant': [
        ('head', H(pos=[(0.50, 0.38), (0.28, 0.38), (0.72, 0.38)], neg=[(0.50, 0.72)], box=(0.08, 0.0, 0.92, 0.53), max=0.5, j=(0.50, 0.52))),
        ('hat', H(pos=[(0.30, 0.17), (0.70, 0.17), (0.50, 0.10), (0.15, 0.21)], neg=[(0.50, 0.38), (0.17, 0.04), (0.85, 0.04)], max=0.15, j=(0.50, 0.23))),
        ('antenna_l', H(pos=[(0.16, 0.035), (0.24, 0.08)], neg=[(0.42, 0.15)], max=0.03, j=(0.30, 0.10), parent='hat')),
        ('antenna_r', H(pos=[(0.85, 0.035), (0.76, 0.08)], neg=[(0.58, 0.15)], max=0.03, j=(0.70, 0.10), parent='hat')),
        ('arm_l', H(pos=[(0.07, 0.68)], neg=[(0.30, 0.66), (0.20, 0.92)], max=0.08, j=(0.16, 0.60))),
        ('arm_r', H(pos=[(0.93, 0.68)], neg=[(0.70, 0.66), (0.80, 0.92)], max=0.08, j=(0.84, 0.60))),
        ('leg_l', H(pos=[(0.20, 0.92)], neg=[(0.50, 0.85), (0.07, 0.68)], max=0.1, j=(0.32, 0.84))),
        ('leg_r', H(pos=[(0.80, 0.92)], neg=[(0.50, 0.85), (0.93, 0.68)], max=0.1, j=(0.68, 0.84))),
    ],
    'seal': [
        ('head', H(pos=[(0.50, 0.22), (0.30, 0.15), (0.50, 0.33), (0.70, 0.30)], neg=[(0.50, 0.62), (0.20, 0.55)], box=(0.04, 0.0, 0.96, 0.47), max=0.5, j=(0.50, 0.46))),
        ('arm_l', H(pos=[(0.05, 0.70), (0.08, 0.64)], neg=[(0.22, 0.66), (0.22, 0.92)], max=0.06, j=(0.14, 0.60))),
        ('arm_r', H(pos=[(0.95, 0.70), (0.92, 0.64)], neg=[(0.78, 0.66), (0.78, 0.92)], max=0.06, j=(0.86, 0.60))),
        ('leg_l', H(pos=[(0.22, 0.92)], neg=[(0.50, 0.86), (0.05, 0.70)], max=0.1, j=(0.32, 0.86))),
        ('leg_r', H(pos=[(0.78, 0.92)], neg=[(0.50, 0.86), (0.95, 0.70)], max=0.1, j=(0.68, 0.86))),
        ('tail', H(mesh='extra')),
    ],
    'turkey': [
        ('head', H(pos=[(0.50, 0.27), (0.42, 0.21), (0.57, 0.14), (0.60, 0.25), (0.40, 0.58), (0.60, 0.58), (0.50, 0.50)], neg=[(0.50, 0.76), (0.12, 0.45), (0.88, 0.45), (0.25, 0.30), (0.75, 0.30), (0.27, 0.64), (0.73, 0.64)], box=(0.24, 0.0, 0.76, 0.64), max=0.35, j=(0.50, 0.58))),
        ('crest', H(pos=[(0.49, 0.035), (0.46, 0.06)], neg=[(0.49, 0.15)], max=0.02, j=(0.49, 0.085), type='hat')),
        ('_belly', H(pos=[(0.50, 0.80), (0.38, 0.70), (0.62, 0.72), (0.50, 0.95)], neg=[(0.50, 0.40), (0.15, 0.45)], box=(0.2, 0.58, 0.8, 1.0), max=0.35)),
        ('fan_l', H(rest=True, box=(0.0, 0.12, 0.40, 0.70), j=(0.40, 0.50))),
        ('fan_r', H(rest=True, box=(0.60, 0.12, 1.0, 0.70), j=(0.60, 0.50))),
        ('wing_l', H(pos=[(0.27, 0.62), (0.22, 0.69), (0.17, 0.79)], neg=[(0.38, 0.72), (0.08, 0.50)], box=(0.12, 0.57, 0.34, 0.85), max=0.07, j=(0.29, 0.60))),
        ('wing_r', H(pos=[(0.73, 0.62), (0.78, 0.69), (0.82, 0.79)], neg=[(0.62, 0.72), (0.92, 0.50)], box=(0.66, 0.57, 0.88, 0.85), max=0.07, j=(0.71, 0.60))),
        ('leg_l', H(pos=[(0.38, 0.90), (0.36, 0.82)], neg=[(0.50, 0.70), (0.50, 0.93)], max=0.06, j=(0.40, 0.78))),
        ('leg_r', H(pos=[(0.62, 0.90), (0.64, 0.82)], neg=[(0.50, 0.70), (0.50, 0.93)], max=0.06, j=(0.60, 0.78))),
    ],
    'cat': [
        ('head', H(pos=[(0.50, 0.32), (0.30, 0.25), (0.70, 0.30), (0.50, 0.15), (0.25, 0.42)], neg=[(0.50, 0.66)], box=(0.0, 0.0, 1.0, 0.53), max=0.55, j=(0.50, 0.52))),
        ('ear_l', H(pos=[(0.17, 0.08)], neg=[(0.32, 0.25)], max=0.05, j=(0.25, 0.16))),
        ('ear_r', H(pos=[(0.82, 0.08)], neg=[(0.68, 0.25)], max=0.05, j=(0.76, 0.16))),
        ('arm_l', H(pos=[(0.06, 0.68)], neg=[(0.24, 0.63), (0.18, 0.91)], max=0.07, j=(0.15, 0.60))),
        ('arm_r', H(pos=[(0.94, 0.68)], neg=[(0.76, 0.63), (0.83, 0.91)], max=0.07, j=(0.85, 0.60))),
        ('leg_l', H(pos=[(0.18, 0.91)], neg=[(0.45, 0.86), (0.06, 0.68)], max=0.08, j=(0.28, 0.85))),
        ('leg_r', H(pos=[(0.83, 0.91)], neg=[(0.55, 0.86), (0.94, 0.68)], max=0.08, j=(0.72, 0.85))),
        ('tail', H(mesh='extra')),
    ],
    'cow': [
        ('head', H(pos=[(0.50, 0.28), (0.50, 0.40), (0.35, 0.20), (0.65, 0.22), (0.30, 0.36)], neg=[(0.50, 0.72), (0.50, 0.55)], box=(0.0, 0.0, 1.0, 0.49), max=0.5, j=(0.50, 0.48))),
        ('ear_l', H(pos=[(0.10, 0.19), (0.16, 0.17)], neg=[(0.30, 0.22)], max=0.05, j=(0.23, 0.19))),
        ('ear_r', H(pos=[(0.90, 0.19), (0.84, 0.17)], neg=[(0.70, 0.22)], max=0.05, j=(0.77, 0.19))),
        ('arm_l', H(pos=[(0.07, 0.66), (0.05, 0.72)], neg=[(0.25, 0.66), (0.20, 0.90)], max=0.07, j=(0.18, 0.58))),
        ('arm_r', H(pos=[(0.93, 0.68), (0.95, 0.72)], neg=[(0.75, 0.66), (0.80, 0.90)], max=0.07, j=(0.82, 0.58))),
        ('leg_l', H(pos=[(0.20, 0.90), (0.15, 0.86)], neg=[(0.45, 0.80), (0.05, 0.70)], max=0.1, j=(0.30, 0.82))),
        ('leg_r', H(pos=[(0.80, 0.90), (0.85, 0.86)], neg=[(0.55, 0.80), (0.95, 0.70)], max=0.1, j=(0.70, 0.82))),
        ('tail', H(mesh='extra')),
    ],
    'dog': [
        ('head', H(pos=[(0.50, 0.30), (0.50, 0.40), (0.35, 0.22), (0.65, 0.22)], neg=[(0.50, 0.62), (0.36, 0.86), (0.64, 0.86)], box=(0.0, 0.0, 1.0, 0.56), max=0.55, j=(0.50, 0.50))),
        ('ear_l', H(pos=[(0.08, 0.28), (0.12, 0.18)], neg=[(0.28, 0.28)], max=0.07, j=(0.20, 0.12))),
        ('ear_r', H(pos=[(0.92, 0.28), (0.88, 0.18)], neg=[(0.72, 0.28)], max=0.07, j=(0.80, 0.12))),
        ('arm_l', H(pos=[(0.36, 0.86), (0.37, 0.93), (0.37, 0.74)], neg=[(0.50, 0.86), (0.17, 0.86)], box=(0.28, 0.60, 0.47, 0.995), max=0.08, j=(0.38, 0.68))),
        ('arm_r', H(pos=[(0.64, 0.86), (0.63, 0.93), (0.63, 0.74)], neg=[(0.50, 0.86), (0.83, 0.86)], box=(0.53, 0.60, 0.72, 0.995), max=0.08, j=(0.62, 0.68))),
        ('leg_l', H(pos=[(0.15, 0.85), (0.20, 0.80)], neg=[(0.36, 0.86), (0.30, 0.65)], max=0.08, j=(0.27, 0.78))),
        ('leg_r', H(pos=[(0.85, 0.85), (0.80, 0.80)], neg=[(0.64, 0.86), (0.70, 0.65)], max=0.08, j=(0.73, 0.78))),
        ('tail', H(mesh='extra')),
    ],
    'duck': [
        ('head', H(pos=[(0.50, 0.28), (0.30, 0.25), (0.50, 0.37), (0.70, 0.27)], neg=[(0.50, 0.70)], box=(0.06, 0.0, 0.94, 0.53), max=0.5, j=(0.50, 0.50))),
        ('cap', H(pos=[(0.52, 0.07), (0.40, 0.12), (0.64, 0.12)], neg=[(0.50, 0.25)], max=0.08, j=(0.52, 0.15), type='hat')),
        ('wing_l', H(pos=[(0.10, 0.66), (0.12, 0.60)], neg=[(0.30, 0.66), (0.15, 0.88)], max=0.06, j=(0.17, 0.56))),
        ('wing_r', H(pos=[(0.90, 0.66), (0.88, 0.60)], neg=[(0.70, 0.66), (0.86, 0.88)], max=0.06, j=(0.83, 0.56))),
        ('leg_l', H(pos=[(0.15, 0.88), (0.10, 0.85)], neg=[(0.32, 0.82), (0.10, 0.66)], max=0.08, j=(0.25, 0.82))),
        ('leg_r', H(pos=[(0.86, 0.88), (0.90, 0.85)], neg=[(0.68, 0.82), (0.90, 0.66)], max=0.08, j=(0.75, 0.82))),
        ('tail', H(mesh='extra')),
    ],
    # side views (head to the left): the near legs, the far legs peeking out, the tail
    'turtle': [
        ('head', H(pos=[(0.18, 0.45), (0.10, 0.55), (0.25, 0.30), (0.30, 0.55)], neg=[(0.60, 0.35), (0.50, 0.80), (0.31, 0.82)], box=(0.0, 0.15, 0.42, 0.76), max=0.3, j=(0.36, 0.55))),
        ('leg_l', H(pos=[(0.50, 0.80), (0.48, 0.92)], neg=[(0.50, 0.56), (0.31, 0.82), (0.20, 0.55)], max=0.06, j=(0.50, 0.64))),
        ('leg_b', H(pos=[(0.31, 0.82)], neg=[(0.20, 0.55), (0.48, 0.82)], max=0.04, j=(0.33, 0.66))),
        ('leg_r', H(pos=[(0.90, 0.80), (0.89, 0.91)], neg=[(0.75, 0.55), (0.97, 0.58)], max=0.06, j=(0.88, 0.64))),
        ('tail', H(pos=[(0.978, 0.55)], neg=[(0.90, 0.50), (0.90, 0.80)], box=(0.93, 0.49, 1.0, 0.62), max=0.012, j=(0.945, 0.56))),
    ],
    'fish': [
        ('fin_top', H(pos=[(0.48, 0.10), (0.42, 0.14), (0.55, 0.12)], neg=[(0.48, 0.32)], max=0.08, j=(0.48, 0.21), type='fin')),
        ('tail', H(pos=[(0.92, 0.50), (0.88, 0.35), (0.88, 0.68)], neg=[(0.72, 0.50)], max=0.15, j=(0.80, 0.52))),
        ('fin_side', H(pos=[(0.50, 0.73), (0.53, 0.78)], neg=[(0.40, 0.60), (0.62, 0.93), (0.60, 0.65)], max=0.05, j=(0.44, 0.67), type='fin')),
        ('fin_bottom', H(pos=[(0.63, 0.92), (0.58, 0.90)], neg=[(0.53, 0.78), (0.62, 0.80)], max=0.04, j=(0.58, 0.86), type='fin')),
        ('lips', H(pos=[(0.03, 0.60)], neg=[(0.12, 0.60)], max=0.02, j=(0.07, 0.60))),
    ],
}
# label-map priority: later parts are drawn over earlier ones (ears over the head, antennae over the hat …)
ORDER = ('head', 'fan', 'hat', 'crest', 'ear', 'antenna', 'arm', 'wing', 'leg', 'tail', 'fin', 'lips')
PAL = [(0, 0, 0), (170, 170, 170), (230, 60, 60), (60, 160, 230), (240, 200, 40), (120, 200, 80), (200, 90, 220),
       (250, 140, 40), (40, 200, 190), (240, 110, 170), (110, 110, 240), (150, 100, 50), (90, 220, 120), (250, 230, 150),
       (20, 120, 90), (180, 40, 120)]


def ptype(name, o):
    return o.get('type') or name.split('_')[0]


def parent_of(name, o, names):
    if 'parent' in o:
        return o['parent']
    if ptype(name, o) in ('ear', 'hat', 'crest', 'antenna') and 'head' in names:
        return 'head'
    return 'body'


def pick(masks, scores, pos, neg, area, mx):
    """the best of SAM's masks: keeps every positive point, no negative one, not too big"""
    best, bs = None, -1
    for m, s in zip(masks, scores):
        a = m.sum() / area
        ok = all(m[y, x] for x, y in pos) and not any(m[y, x] for x, y in neg) and a <= mx and a > 0
        if ok and s > bs:
            best, bs = m, s
    if best is None:            # (fallback: the smallest one with the positive points)
        c = [m for m in masks if all(m[y, x] for x, y in pos)] or list(masks)
        best = min(c, key=lambda m: m.sum())
    return best


def clean(m, alpha):
    from scipy import ndimage as ndi
    m = m & alpha
    lab, n = ndi.label(m)
    if n > 1:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        m = lab == (1 + int(np.argmax(sizes)))
    return ndi.binary_fill_holes(m)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sam2', required=True, help='SAM 2 checkout (for its configs)')
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--sheet', default='', help='write an overlay contact sheet here (review by eye)')
    o = ap.parse_args()
    import torch
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    model = build_sam2('configs/sam2.1/sam2.1_hiera_l.yaml', o.ckpt, device='cpu')
    pred = SAM2ImagePredictor(model)
    os.makedirs(OUT, exist_ok=True)
    jp = os.path.join(OUT, 'parts.json')
    meta = json.load(open(jp)) if os.path.exists(jp) else {}
    kinds = [k for k in PROMPTS if not o.only or k in o.only.split(',')]
    tiles = []
    for kind in kinds:
        im = Image.open(os.path.join(ROOT, 'assets', 'img', 'friends', kind + '.webp')).convert('RGBA')
        a = np.asarray(im).astype(np.float32) / 255
        W, Hh = im.size
        rgb = (a[..., :3] * a[..., 3:] + 0.92 * (1 - a[..., 3:])) * 255
        alpha = a[..., 3] > 0.5
        with torch.inference_mode():
            pred.set_image(rgb.astype(np.uint8))
        names = [n for n, _ in PROMPTS[kind]]
        masks = {}
        for name, p in PROMPTS[kind]:
            if p.get('mesh') or p.get('rest'):
                continue
            px = lambda q: (min(W - 1, int(q[0] * W)), min(Hh - 1, int(q[1] * Hh)))
            pos, neg = [px(q) for q in p['pos']], [px(q) for q in p.get('neg', [])]
            pts = np.array(pos + neg, np.float32)
            lab = np.array([1] * len(pos) + [0] * len(neg), np.int32)
            with torch.inference_mode():
                box = np.array([p['box'][0] * W, p['box'][1] * Hh, p['box'][2] * W, p['box'][3] * Hh], np.float32) if 'box' in p else None
                ms, sc, _ = pred.predict(point_coords=pts, point_labels=lab, box=box, multimask_output=True)
            m = pick(ms > 0, sc, pos, neg, alpha.sum(), p.get('max', 0.2))
            masks[name] = clean(m, alpha)
            print(f'{kind:7s} {name:10s} area {masks[name].sum() / alpha.sum():.3f}  scores {np.round(sc, 3).tolist()}')
        for name, p in PROMPTS[kind]:           # what is left inside a box once the other parts are taken out
            if p.get('rest'):
                m = alpha.copy()
                if 'box' in p:
                    bx = np.zeros_like(m); bx[int(p['box'][1] * Hh):int(p['box'][3] * Hh), int(p['box'][0] * W):int(p['box'][2] * W)] = True
                    m &= bx
                from scipy import ndimage as ndi
                for m2 in list(masks.values()):
                    m &= ~ndi.binary_dilation(m2, iterations=2)
                masks[name] = clean(ndi.binary_opening(m, iterations=3), alpha)     # (no slivers along the others)
                print(f'{kind:7s} {name:10s} area {masks[name].sum() / alpha.sum():.3f}  (rest)')
        masks = {n: m for n, m in masks.items() if not n.startswith('_')}     # (helper masks: not parts)
        names = [n for n in names if not n.startswith('_')]
        # one label map, small parts over big ones
        L = np.where(alpha, 1, 0).astype(np.uint8)
        listed = []
        for t in ORDER:
            for name, p in PROMPTS[kind]:
                if name in masks and ptype(name, p) == t:
                    listed.append(name)
        ids = {}
        for i, name in enumerate(listed):
            ids[name] = i + 2
            L[masks[name]] = i + 2
        pim = Image.fromarray(L, 'P')
        pal = sum(PAL, ()) + (0, 0, 0) * (256 - len(PAL))
        pim.putpalette(pal)
        pim.save(os.path.join(OUT, kind + '.png'), optimize=True)
        parts = []
        for name, p in PROMPTS[kind]:
            if name.startswith('_'):
                continue
            e = {'name': name, 'type': ptype(name, p), 'parent': parent_of(name, p, names)}
            if p.get('mesh'):
                e['mesh'] = p['mesh']
            else:
                e['id'] = ids[name]
                e['j'] = [round(p['j'][0], 3), round(p['j'][1], 3)]
            parts.append(e)
        meta[kind] = {'w': W, 'h': Hh, 'parts': parts}
        if o.sheet:
            col = np.array(PAL, np.float32)[np.minimum(L, len(PAL) - 1)]
            ov = rgb * 0.45 + col * 0.55
            ov[~alpha] = 255
            t = Image.fromarray(ov.astype(np.uint8)).resize((round(W * 560 / Hh), 560))
            tiles.append((kind, t))
    with open(jp, 'w') as fh:
        json.dump(meta, fh, indent=1)
    print('wrote', jp)
    if o.sheet and tiles:
        from PIL import ImageDraw
        rows, row, x = [], [], 0
        for k, t in tiles:
            if row and x + t.width > 2400:
                rows.append(row); row, x = [], 0
            row.append((k, t)); x += t.width + 8
        rows.append(row)
        S = Image.new('RGB', (max(sum(t.width + 8 for _, t in r) for r in rows), len(rows) * 590), (255, 255, 255))
        d = ImageDraw.Draw(S)
        for j, r in enumerate(rows):
            x = 0
            for k, t in r:
                S.paste(t, (x, j * 590 + 28)); d.text((x + 4, j * 590 + 6), k, fill=(0, 0, 0)); x += t.width + 8
        S.save(o.sheet)
        print('sheet', o.sheet)


if __name__ == '__main__':
    main()
