"""Toy Catch — a friend's game picture cut from its character sheet, for a friend that has no drawn game picture (the
duck). The sheet's front view is small (~220 x 330 px), so it is upscaled x4 locally (Real-ESRGAN x4plus through
spandrel, on the Mac's GPU) and cut out of the sheet's white background with a soft 2.5 px edge (edge pixels take the
nearest inner colour, so no white matte) -> design/art/<kind>_front.png, which tools/import_art.py --friends reads.

  ~/dev/tools/TripoSR/.venv/bin/python tools/sheet_front.py duck

Needs design/sheets/<kind>_sheet.png (the user's sheets; kept out of git) and the model file
~/dev/tools/realesrgan/RealESRGAN_x4plus.pth (github.com/xinntao/Real-ESRGAN releases, v0.1.0). Nothing leaves the Mac.
"""
import pathlib
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODEL = pathlib.Path.home() / 'dev' / 'tools' / 'realesrgan' / 'RealESRGAN_x4plus.pth'
# the front view's box (x0, y0, x1, y1) on the 1024 x 765 sheet
BOX = {'duck': (70, 46, 288, 370)}
MARGIN = 10
GAP_MIN = 300                                    # (px, upscaled: a white gap inside the figure bigger than an eye shine)


def upscale(im):
    import torch
    from spandrel import ModelLoader
    dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
    m = ModelLoader().load_from_file(str(MODEL)).to(dev).eval()
    t = torch.from_numpy(np.asarray(im, np.float32) / 255).permute(2, 0, 1)[None].to(dev)
    with torch.no_grad():
        o = m(t)[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy()
    return (o * 255).round().astype(np.uint8)


def cut(a):
    a = a.astype(np.float32)
    mn, mx = a.min(2), a.max(2)
    white = np.logical_and(mn >= 232, (mx - mn) <= 16)
    lab, _ = ndi.label(white)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = ndi.binary_fill_holes(~np.isin(lab, list(border)))
    lab2, n2 = ndi.label(fg)
    fg = lab2 == 1 + int(np.argmax(ndi.sum(fg, lab2, range(1, n2 + 1))))   # the figure, not stray bits
    fg = ndi.binary_opening(fg, iterations=2)
    # white gaps the figure closes round (between a wing tip, the body and a foot): the sheet's background seen through
    # them, kept white by the hole fill, showed as white specks by the feet — painted with the colours round them, a
    # little darker (a crevice). Small white bits (the eyes' shine) stay.
    lab3, n3 = ndi.label(white & fg)
    if n3:
        sizes = ndi.sum(white & fg, lab3, range(1, n3 + 1))
        gap = ndi.binary_dilation(np.isin(lab3, 1 + np.nonzero(sizes >= GAP_MIN)[0]), iterations=4) & fg
        if gap.any():
            good = fg & ~gap & (mn < 225)
            _, (iy, ix) = ndi.distance_transform_edt(~good, return_indices=True)
            a[gap] = a[iy[gap], ix[gap]] * 0.8
            soft = ndi.gaussian_filter(a, sigma=(2.5, 2.5, 0))
            a[gap] = soft[gap]
    sd = ndi.distance_transform_edt(fg) - ndi.distance_transform_edt(~fg)
    alpha = np.clip((sd + 1.25) / 2.5, 0, 1)
    inner = sd >= 2.5
    _, (iy, ix) = ndi.distance_transform_edt(~inner, return_indices=True)
    rgb = a.copy()
    rgb[~inner] = a[iy[~inner], ix[~inner]]
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    ys, xs = np.nonzero(out[..., 3] > 8)
    return Image.fromarray(out[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 'RGBA')


def main(kind):
    x0, y0, x1, y1 = BOX[kind]
    sheet = Image.open(ROOT / 'design' / 'sheets' / f'{kind}_sheet.png').convert('RGB')
    crop = sheet.crop((x0 - MARGIN, y0 - MARGIN, x1 + MARGIN, y1 + MARGIN))
    im = cut(upscale(crop))
    dst = ROOT / 'design' / 'art' / f'{kind}_front.png'
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst)
    print(kind, crop.size, '->', im.size, '->', dst.relative_to(ROOT))


if __name__ == '__main__':
    for k in sys.argv[1:] or ['duck']:
        main(k)
