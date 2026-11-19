"""Toy Catch — the signature pose's limb on a turntable's front frame, cut with SAM 2.1 (local; the checkout and
checkpoint from tools/parts_sam.py's setup): point prompts in frame px, the best-scoring mask saved as
design/turntable/<kind>/limb_<bone>.png (tools/spin_frames.py makes the moving layer from it).

usage: <samvenv>/bin/python tools/turntable_limb.py <frame.png> <out.png> "x,y;x,y" "neg x,y;..."
  monkey arm_r (f13): "710,625;750,660;680,600"  "600,630;670,780;570,720;650,480"
"""
import sys, numpy as np, torch
from PIL import Image
sys.path.insert(0, '/Users/jini/.hermes/cache/scratch/rig/sam2src')
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
img = np.asarray(Image.open(sys.argv[1]).convert('RGB'))
pos = [tuple(map(float, p.split(','))) for p in sys.argv[3].split(';')]
neg = [tuple(map(float, p.split(','))) for p in sys.argv[4].split(';')] if len(sys.argv) > 4 and sys.argv[4] else []
model = build_sam2('configs/sam2.1/sam2.1_hiera_l.yaml', '/Users/jini/.hermes/cache/scratch/rig/ckpt/sam2.1_hiera_large.pt', device='cpu')
pr = SAM2ImagePredictor(model)
with torch.inference_mode():
    pr.set_image(img)
    pts = np.array(pos + neg, np.float32); lab = np.array([1] * len(pos) + [0] * len(neg))
    masks, scores, _ = pr.predict(point_coords=pts, point_labels=lab, multimask_output=True)
for i, (m, sc) in enumerate(zip(masks, scores)):
    print(i, round(float(sc), 3), int(m.sum()))
best = masks[int(np.argmax(scores))]
Image.fromarray((best * 255).astype(np.uint8)).save(sys.argv[2])
ov = img.copy(); ov[best > 0] = (ov[best > 0] * 0.4 + np.array([0, 255, 0]) * 0.6).astype(np.uint8)
for x, y in pos: ov[int(y) - 4:int(y) + 4, int(x) - 4:int(x) + 4] = (0, 0, 255)
for x, y in neg: ov[int(y) - 4:int(y) + 4, int(x) - 4:int(x) + 4] = (255, 0, 0)
Image.fromarray(ov).save(sys.argv[2].replace('.png', '_ov.png'))
