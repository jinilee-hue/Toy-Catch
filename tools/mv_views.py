"""Toy Catch — six views of a friend painted to fit ITS OWN 3D shape, made on this Mac with MV-Adapter (VAST-AI / Zehuan
Huang, Apache-2.0; SDXL base; nothing leaves the machine). The game picture is the reference; the shape's position and
normal maps (rendered here, MV-Adapter's own renderer is CUDA-only) steer every view onto the mesh, so the sides, back,
top and bottom line up with the geometry — no sheet laid over a mesh it wasn't drawn for (user: "360도 회전에도
깔끔하게 뭉게지는 거 없이 매끈하게").

Run in MV-Adapter's venv (make_3d.py calls it):
  ~/dev/tools/MV-Adapter/.venv/bin/python tools/mv_views.py <mesh.npz> <picture.webp> <out.npz> [--steps 40] [--seed 7]
mesh.npz: v (friend frame: x across, y up, z toward the camera), f. out.npz: views (6 x H x W x 3 uint8: front, right
(+x), back, left (-x), top, bottom), center, scale (friend -> MV frame), and a <out>.png contact sheet to look at.

MV frame (MV-Adapter's): the mesh centred on its box and scaled so its largest |coordinate| is 0.5, then
std = (x, -z, y) (z up); orthographic cameras 1.8 away, the box -0.55..0.55 seen at H x W.
"""
import argparse
import os
import sys
import time

import numpy as np
from PIL import Image

MV_DIR = os.path.expanduser('~/dev/tools/MV-Adapter')
VIEWS = [(0, -90), (0, 0), (0, 90), (0, 180), (89.99, 90), (-89.99, 90)]   # (elevation, azimuth) as MV-Adapter's
HALF = 0.55


def cameras():
    """per view: position, right, up, lookat in the MV (std, z-up) frame — MV-Adapter's get_c2w"""
    out = []
    for el, az in VIEWS:
        e, a = np.radians(el), np.radians(az)
        pos = 1.8 * np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
        look = -pos / np.linalg.norm(pos)
        right = np.cross(look, [0, 0, 1.0]); right /= np.linalg.norm(right)
        up = np.cross(right, look); up /= np.linalg.norm(up)
        out.append((pos, right, up, look))
    return out


def to_std(v, center, scale):
    p = (np.asarray(v, np.float64) - center) * scale
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], 1)


def nrm_std(n):
    return np.stack([n[:, 0], -n[:, 2], n[:, 1]], 1)


def project(ps, cam, H, W):
    """std points -> pixel coords (x right, y down, centres at +.5) and distance along the view"""
    pos, right, up, look = cam
    d = ps - pos
    x, y, z = d @ right, d @ up, d @ look
    return np.stack([(x + HALF) / (2 * HALF) * W, (HALF - y) / (2 * HALF) * H], 1), z


def frame(v):
    lo, hi = v.min(0), v.max(0)
    center = (lo + hi) / 2
    scale = 0.5 / np.abs(v - center).max()
    return center, scale


def render_maps(v, f, n, H=768, W=768):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from make_3d import raster
    center, scale = frame(v)
    ps, ns = to_std(v, center, scale), nrm_std(n)
    pos_maps, nrm_maps = [], []
    for cam in cameras():
        P, z = project(ps, cam, H, W)
        fid, bary = raster(P, f, W, H, -z)
        on = fid >= 0
        tri = f[fid[on]]
        b = bary[on]
        pm = np.zeros((H, W, 3), np.float32); nm = np.zeros((H, W, 3), np.float32)
        pm[on] = (b[:, :, None] * ps[tri]).sum(1)
        nn = (b[:, :, None] * ns[tri]).sum(1)
        nm[on] = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
        pos_maps.append(np.clip(pm + 0.5, 0, 1) * on[..., None] + 0.5 * ~on[..., None])
        nrm_maps.append(np.clip(nm / 2 + 0.5, 0, 1))
    return np.stack(pos_maps), np.stack(nrm_maps), center, scale


def reference(path, H, W):
    """MV-Adapter's preprocess_image: the alpha box scaled to 90 % of the frame, on grey"""
    im = np.asarray(Image.open(path).convert('RGBA'))
    al = im[..., 3] > 0
    ys, xs = np.nonzero(al)
    c = im[max(ys.min() - 1, 0):ys.max() + 2, max(xs.min() - 1, 0):xs.max() + 2]
    h, w = c.shape[:2]
    if h > w:
        w, h = int(w * H * 0.9 / h), int(H * 0.9)
    else:
        h, w = int(h * W * 0.9 / w), int(W * 0.9)
    c = np.asarray(Image.fromarray(c).resize((w, h), Image.LANCZOS))
    out = np.zeros((H, W, 4), np.uint8)
    out[(H - h) // 2:(H - h) // 2 + h, (W - w) // 2:(W - w) // 2 + w] = c
    o = out.astype(np.float32) / 255
    rgb = o[..., :3] * o[..., 3:] + (1 - o[..., 3:]) * 0.5
    return Image.fromarray((rgb * 255).clip(0, 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mesh'); ap.add_argument('picture', nargs='?'); ap.add_argument('out', nargs='?')
    ap.add_argument('--batch', action='store_true', help='mesh = a jobs file: "mesh picture out" per line')
    ap.add_argument('--steps', type=int, default=40)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--guidance', type=float, default=3.0)
    ap.add_argument('--size', type=int, default=768)
    ap.add_argument('--text', default='a cute soft plush toy, felt fabric, bright even studio lighting, no shadows, clean flat colours, high quality')
    o = ap.parse_args()
    jobs = [l.split() for l in open(o.mesh) if l.strip()] if o.batch else [(o.mesh, o.picture, o.out)]
    H = W = o.size
    t0 = time.time()
    import torch
    sys.path.insert(0, MV_DIR)
    from diffusers import AutoencoderKL
    from mvadapter.models.attention_processor import DecoupledMVRowColSelfAttnProcessor2_0
    from mvadapter.pipelines.pipeline_mvadapter_i2mv_sdxl import MVAdapterI2MVSDXLPipeline
    from mvadapter.schedulers.scheduling_shift_snr import ShiftSNRScheduler
    dev, dt = 'mps', torch.float16
    vae = AutoencoderKL.from_pretrained('madebyollin/sdxl-vae-fp16-fix', torch_dtype=dt)
    pipe = MVAdapterI2MVSDXLPipeline.from_pretrained('stabilityai/stable-diffusion-xl-base-1.0', vae=vae,
                                                     variant='fp16', torch_dtype=dt)
    pipe.scheduler = ShiftSNRScheduler.from_scheduler(pipe.scheduler, shift_mode='interpolated', shift_scale=8.0,
                                                      scheduler_class=None)
    pipe.init_custom_adapter(num_views=6, self_attn_processor=DecoupledMVRowColSelfAttnProcessor2_0)
    pipe.load_custom_adapter('huanngzh/mv-adapter', weight_name='mvadapter_ig2mv_sdxl.safetensors')
    pipe.to(device=dev, dtype=dt)
    pipe.cond_encoder.to(device=dev, dtype=dt)
    pipe.enable_vae_slicing()
    # the prompt once, then the text encoders out of memory (24 GB shared: SDXL swapped, 7 -> 28 s a step)
    NEG = 'watermark, ugly, deformed, noisy, blurry, low contrast, stripes, smudges, shadow, dark, grey, gray, dirty, stains, gradient'
    with torch.no_grad():
        pe, npe, ppe, nppe = pipe.encode_prompt(o.text, device=dev, num_images_per_prompt=1,
                                                do_classifier_free_guidance=True, negative_prompt=NEG)
    o.emb = (pe, npe, ppe, nppe)
    pipe.text_encoder = None; pipe.text_encoder_2 = None
    import gc; gc.collect(); torch.mps.empty_cache()
    print(f'  loaded {time.time() - t0:.1f}s')
    import trimesh
    for mesh, picture, out in jobs:
        if os.path.exists(out):
            continue
        t1 = time.time()
        z = np.load(mesh)
        v, f = z['v'].astype(np.float64), z['f'].astype(np.int64)
        n = np.asarray(trimesh.Trimesh(v, f, process=False).vertex_normals, np.float64)
        pos, nrm, center, scale = render_maps(v, f, n, H, W)
        one(pipe, o, pos, nrm, center, scale, picture, out, H, W)
        print(f'  {os.path.basename(out)}: {time.time() - t1:.0f}s', flush=True)


def one(pipe, o, pos, nrm, center, scale, picture, out, H, W):
    import torch
    dev, dt = 'mps', torch.float16
    ctrl = torch.from_numpy(np.concatenate([pos, nrm], -1)).permute(0, 3, 1, 2).to(dev, dt)
    ref = reference(picture, H, W)
    g = torch.Generator(device='cpu').manual_seed(o.seed)
    pe, npe, ppe, nppe = o.emb
    imgs = pipe(height=H, width=W, num_inference_steps=o.steps, guidance_scale=o.guidance,
                num_images_per_prompt=6, control_image=ctrl, control_conditioning_scale=1.0, reference_image=ref,
                reference_conditioning_scale=1.0, prompt_embeds=pe, negative_prompt_embeds=npe,
                pooled_prompt_embeds=ppe, negative_pooled_prompt_embeds=nppe, generator=g).images
    del ctrl
    torch.mps.empty_cache()
    views = np.stack([np.asarray(im.convert('RGB')) for im in imgs])
    np.savez_compressed(out, views=views, center=center, scale=scale, size=H)
    sheet = np.concatenate([np.concatenate(list(views), 1),
                            np.concatenate(list((nrm * 255).astype(np.uint8)), 1)], 0)
    Image.fromarray(sheet).resize((sheet.shape[1] // 2, sheet.shape[0] // 2)).save(out.replace('.npz', '.png'))
    ref.save(out.replace('.npz', '_ref.png'))


if __name__ == '__main__':
    main()
