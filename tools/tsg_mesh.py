"""Toy Catch — a friend's raw 3D shape from its game picture with TripoSG (VAST-AI-Research, MIT licence), run on this
Mac (MPS; nothing leaves the machine). make_3d.py calls this in TripoSG's own venv and takes the mesh from the cache.

TripoSG (a rectified-flow transformer over an SDF VAE) keeps far more of the picture's shape than TripoSR: arms, feet,
wings and tails come out as their own parts, not lumps on a blob. It makes geometry only (no colours: make_3d.py
textures it from the picture and the character sheet anyway).

Mac patches in the TripoSG checkout (triposg/inference_utils.py): no `diso` (CUDA-only DiffDMC) — the octree SDF grid
goes through skimage marching cubes instead, cubes with an unevaluated corner skipped. Attention is torch SDPA already.
The picture is given as TripoSG's own prep does it (alpha box, 10 % margin, square, white background) — no RMBG
(our pictures have alpha; BRIA's RMBG weights are not permissively licensed).

usage:
  ~/dev/tools/TripoSG/.venv/bin/python tools/tsg_mesh.py turkey,duck [--seed 42] [--steps 50] [--cfg 7] [--depth 9]
Writes ~/dev/tools/TripoSG/out/<kind>.npz (v float32, f int32 in TripoSG's frame; front = +z... see make_3d.py).
"""
import argparse
import os
import sys
import time

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TSG_DIR = os.path.expanduser('~/dev/tools/TripoSG')
OUT = os.path.join(TSG_DIR, 'out')


def prep(kind, pad=0.1):
    """the picture as TripoSG's prepare_image makes it: cropped to the alpha box, on white, padded square"""
    im = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'img', 'friends', f'{kind}.webp')).convert('RGBA')).astype(np.float32) / 255
    a = im[..., 3:4]
    rgb = im[..., :3] * a + (1 - a)
    ys, xs = np.nonzero(im[..., 3] > 0)
    rgb = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = rgb.shape[:2]
    if w > h:
        px = int(w * pad); py = int(px + (w - h) / 2)
    else:
        py = int(h * pad); px = int(py + (h - w) / 2)
    out = np.ones((h + 2 * py, w + 2 * px, 3), np.float32)
    out[py:py + h, px:px + w] = rgb
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('kinds')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--steps', type=int, default=50)
    ap.add_argument('--cfg', type=float, default=7.0)
    ap.add_argument('--depth', type=int, default=9, help='octree depth of the SDF grid (9 = 512 cells across)')
    ap.add_argument('--dtype', default='fp16', choices=('fp16', 'fp32'))
    ap.add_argument('--faces', type=int, default=400000, help='raw mesh pre-simplified to this many triangles')
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--tag', default='', help='suffix for the cache name (spike variants)')
    o = ap.parse_args()
    import torch
    sys.path.insert(0, TSG_DIR)
    from triposg.pipelines.pipeline_triposg import TripoSGPipeline
    dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
    dt = torch.float16 if o.dtype == 'fp16' else torch.float32
    t0 = time.time()
    pipe = TripoSGPipeline.from_pretrained(os.path.join(TSG_DIR, 'pretrained_weights', 'TripoSG')).to(dev, dt)
    print(f'loaded in {time.time() - t0:.1f}s on {dev} {o.dtype}', flush=True)
    os.makedirs(o.out, exist_ok=True)
    for kind in o.kinds.split(','):
        img = prep(kind)
        img.save(os.path.join(o.out, f'{kind}{o.tag}_in.png'))
        t0 = time.time()
        with torch.no_grad():
            r = pipe(image=img, generator=torch.Generator(device='cpu').manual_seed(o.seed),
                     num_inference_steps=o.steps, guidance_scale=o.cfg, flash_octree_depth=o.depth)
        v, f = r.samples[0]
        if v is None:
            print(kind, 'FAILED'); continue
        v = np.asarray(v, np.float32); f = np.ascontiguousarray(np.asarray(f, np.int64)).astype(np.int32)
        n0 = len(f)
        if len(f) > o.faces:
            import fast_simplification
            v, f = fast_simplification.simplify(v, f, target_reduction=1 - o.faces / len(f))
        np.savez_compressed(os.path.join(o.out, f'{kind}{o.tag}.npz'), v=v.astype(np.float32), f=f.astype(np.int32))
        print(f'{kind}: {time.time() - t0:.1f}s, {n0} tris -> {len(f)}, box {v.min(0).round(3)} {v.max(0).round(3)}', flush=True)


if __name__ == '__main__':
    main()
