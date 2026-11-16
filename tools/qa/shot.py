"""Screenshot a page of the local server headless (real Chrome + Metal), print console errors.

usage: shot.py <url> <out.png> [WxH] [--wait ms] [--js "expr"] [--dpr 1|2]
"""
import sys
from playwright.sync_api import sync_playwright

args = sys.argv[1:]
url, out = args[0], args[1]
size = args[2] if len(args) > 2 and 'x' in args[2] and not args[2].startswith('--') else '1600x900'
W, H = map(int, size.split('x'))
wait = int(args[args.index('--wait') + 1]) if '--wait' in args else 1500
js = args[args.index('--js') + 1] if '--js' in args else None
dpr = float(args[args.index('--dpr') + 1]) if '--dpr' in args else 1
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=dpr)
    errs = []
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    pg.goto(url)
    try:
        pg.wait_for_function('window.__ready === true', timeout=20000)
    except Exception as e:
        errs.append(f'not ready: {e}')
    if js:
        pg.evaluate(js)
    pg.wait_for_timeout(wait)
    pg.screenshot(path=out)
    b.close()
print(out)
for e in errs[:20]:
    print(e)
