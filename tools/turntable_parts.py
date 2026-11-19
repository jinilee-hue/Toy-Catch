"""Toy Catch — the redrawn friends' moving parts on their turntable's FRONT frame (design/turntable/<kind>/f13.png),
cut with SAM 2.1 (local, Apache-2.0; the checkout and checkpoint of tools/parts_sam.py's setup — nothing leaves the
Mac). Point prompts in frame px (1536 x 1536), picked on a grid over each frame. Writes design/turntable/<kind>/
part_<name>.png (0/255) and an overlay sheet to look at. tools/spin_frames.py turns them into the card's pose warp.

usage: <samvenv>/bin/python tools/turntable_parts.py [--only monkey,cat] [--sheet out.png]
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'design', 'turntable')
SAM_SRC = os.path.expanduser('~/.hermes/cache/scratch/rig/sam2src')
SAM_CKPT = os.path.expanduser('~/.hermes/cache/scratch/rig/ckpt/sam2.1_hiera_large.pt')

# kind: [(part, positive points, negative points)] — l / r = the picture's left / right
PROMPTS = {
    'monkey': [('ear_r', [(990, 615), (1012, 650)], [(930, 640), (960, 540), (880, 620)])],
    'mouse': [('ear_l', [(560, 470), (600, 430)], [(700, 560), (640, 600)]),
              ('ear_r', [(965, 470), (925, 430)], [(830, 560), (890, 600)]),
              ('tail', [(940, 1025), (1003, 875), (1045, 822)], [(805, 975), (850, 1100), (900, 900)])],
    'ant': [('antenna_l', [(640, 380), (662, 412)], [(700, 470), (770, 470)]),
            ('antenna_r', [(895, 385), (872, 418)], [(850, 470), (770, 470)]),
            ('hat', [(765, 467), (634, 600), (952, 594), (770, 520)], [(765, 700), (700, 650), (850, 650), (770, 630), (650, 390), (680, 690), (860, 690)])],
    'seal': [('flipper_l', [(480, 965), (500, 990)], [(580, 900), (640, 960), (560, 1040)]),
             ('flipper_r', [(1078, 965), (1058, 990)], [(980, 900), (920, 960), (1050, 1120)])],
    # (the turkey's fan: everything but its body — SAM on the fan itself came out speckled)
    'turkey': [('body', [(768, 520), (768, 700), (760, 950), (720, 1100), (820, 1100), (605, 905), (905, 905), (760, 420)],
                [(450, 720), (1090, 720), (520, 640), (1020, 640), (440, 860), (1100, 860)]),
               ('wing_l', [(600, 900), (610, 950)], [(680, 900), (540, 860), (560, 980)]),
               ('wing_r', [(915, 900), (925, 950)], [(850, 900), (980, 860), (970, 980)])],
    'turtle': [('head', [(767, 500), (680, 600), (860, 600), (767, 420)], [(767, 800), (600, 760), (930, 760), (660, 900)]),
               ('arm_l', [(540, 800), (600, 775)], [(700, 820), (620, 900), (680, 700)]),
               ('arm_r', [(1000, 800), (940, 775)], [(840, 820), (920, 900), (860, 700)])],
    'cat': [('arm_r', [(985, 960), (1000, 1000), (968, 925)], [(900, 930), (1080, 1000), (920, 1050)]),
            ('ear_l', [(570, 430), (590, 470)], [(660, 520), (620, 600), (700, 470)]),
            ('ear_r', [(940, 430), (920, 470)], [(860, 520), (900, 600), (820, 470)])],
    'cow': [('ear_l', [(530, 510), (560, 500)], [(620, 530), (640, 430), (600, 600)]),
            ('ear_r', [(975, 510), (945, 500)], [(900, 530), (880, 430), (920, 600)]),
            ('head', [(760, 560), (640, 600), (880, 600), (760, 700), (760, 420)], [(760, 850), (640, 900), (880, 900), (530, 510), (975, 510)])],
    'dog': [('ear_l', [(520, 560), (550, 480)], [(640, 560), (620, 680), (700, 450)]),
            ('ear_r', [(1010, 560), (980, 480)], [(890, 560), (910, 680), (830, 450)]),
            ('head', [(768, 560), (660, 600), (870, 600), (768, 700), (768, 420)], [(768, 850), (640, 900), (900, 900), (520, 560), (1010, 560)])],
    'duck': [('wing_l', [(595, 940), (605, 980)], [(660, 930), (640, 860), (620, 1040)]),
             ('wing_r', [(940, 940), (930, 980)], [(880, 930), (900, 860), (910, 1040)])],
    'fish': [('tail_fin', [(1120, 800), (1150, 700), (1150, 900)], [(1000, 800), (900, 720)]),
             ('top_fin', [(760, 520), (680, 560), (860, 560)], [(760, 680), (600, 700)])],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--sheet', default='')
    o = ap.parse_args()
    import torch
    sys.path.insert(0, SAM_SRC)
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    pr = SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_l.yaml', SAM_CKPT, device='cpu'))
    tiles = []
    for kind, parts in PROMPTS.items():
        if o.only and kind not in o.only.split(','):
            continue
        img = np.asarray(Image.open(os.path.join(SRC, kind, 'f13.png')).convert('RGBA'))
        rgb = img[..., :3].copy(); al = img[..., 3] > 128
        rgb[~al] = 255
        with torch.inference_mode():
            pr.set_image(rgb)
            ov = rgb.copy()
            for name, pos, neg in parts:
                pts = np.array(pos + neg, np.float32); lab = np.array([1] * len(pos) + [0] * len(neg))
                masks, scores, _ = pr.predict(point_coords=pts, point_labels=lab, multimask_output=True)
                # the best-scoring mask that keeps every positive point and leaves the negative ones out
                ok = [i for i in range(len(masks)) if all(masks[i][int(y), int(x)] for x, y in pos) and not any(masks[i][int(y), int(x)] for x, y in neg)]
                i = max(ok or range(len(masks)), key=lambda j: scores[j])
                m = (masks[i] > 0) & al
                Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(SRC, kind, f'part_{name}.png'))
                print(f'{kind:7s} {name:10s} score {scores[i]:.3f} {int(m.sum()):7d} px{"" if ok else "  (no mask kept all points)"}')
                col = np.array([(255, 60, 60), (60, 200, 60), (60, 90, 255), (240, 160, 0)][parts.index((name, pos, neg)) % 4])
                ov[m] = (ov[m] * 0.45 + col * 0.55).astype(np.uint8)
        if kind == 'turkey':                           # the fan halves = the friend minus its body
            from scipy import ndimage as ndi
            body = np.asarray(Image.open(os.path.join(SRC, kind, 'part_body.png'))) > 127
            fan = al & ~ndi.binary_dilation(body, iterations=3)
            fan = ndi.binary_opening(fan, iterations=3)
            ys_, xs_ = np.nonzero(body); cx = xs_.mean()
            xx = np.arange(fan.shape[1])[None, :]
            for name, side in (('fan_l', xx < cx), ('fan_r', xx >= cx)):
                f = fan & side
                lb, nl = ndi.label(f)
                if nl > 1:
                    sz = ndi.sum(f, lb, range(1, nl + 1)); f = np.isin(lb, 1 + np.nonzero(sz >= 0.05 * sz.max())[0])
                Image.fromarray((f * 255).astype(np.uint8)).save(os.path.join(SRC, kind, f'part_{name}.png'))
                ov[f] = (ov[f] * 0.45 + np.array([255, 160, 0]) * 0.55).astype(np.uint8)
                print(f'{kind:7s} {name:10s} (derived) {int(f.sum()):7d} px')
        ys, xs = np.nonzero(al)
        t = Image.fromarray(ov).crop((xs.min() - 10, ys.min() - 10, xs.max() + 10, ys.max() + 10))
        t.thumbnail((360, 360)); d = ImageDraw.Draw(t); d.text((4, 4), kind, fill='black')
        tiles.append(t)
    if o.sheet and tiles:
        sh = Image.new('RGB', (360 * 6, 360 * ((len(tiles) + 5) // 6)), 'white')
        for i, t in enumerate(tiles):
            sh.paste(t, ((i % 6) * 360, (i // 6) * 360))
        sh.save(o.sheet)


if __name__ == '__main__':
    main()
