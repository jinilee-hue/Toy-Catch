"""Contact sheet of QA stills: sheet.py <dir> <out.png> [cols] — every png in the dir, sorted, half size"""
import os
import sys
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 3
names = sorted(f for f in os.listdir(d) if f.endswith('.png'))
ims = [Image.open(os.path.join(d, n)).convert('RGB') for n in names]
w, h = ims[0].size
s = 0.5 if w <= 1800 else 0.35
tw, th = int(w * s), int(h * s)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw + (cols + 1) * 6, rows * (th + 22) + 6), 'white')
dr = ImageDraw.Draw(sheet)
for k, (im, n) in enumerate(zip(ims, names)):
    x = 6 + (k % cols) * (tw + 6); y = 6 + (k // cols) * (th + 22)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 16))
    dr.text((x, y), n, fill='black')
sheet.save(out)
print(out, sheet.size)
