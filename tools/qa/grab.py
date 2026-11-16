"""Deterministic stills of one grab: the frame loop is frozen and stepped (1/60 s per frame, yielding between frames
so the game's awaits run), so each still shows an exact moment.

usage: grab.py <base_url> <out_dir> <kind> [WxH]      e.g. grab.py http://127.0.0.1:5231 /tmp/g monkey
Stills (ms after DOWN): 600 (going down), 1300 (at the bottom), 1700 (shut), 2600 (lifting), 3400 (up), then the
judging beat every 700 ms.
"""
import os
import sys
from playwright.sync_api import sync_playwright

base, out, kind = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = map(int, (sys.argv[4] if len(sys.argv) > 4 else '1600x900').split('x'))
os.makedirs(out, exist_ok=True)
URL = base.rstrip('/') + '/?nohint&order=m,a,s,t,p&kinds=pig,seal,ant,turtle,monkey,turkey'
STEP = """async (n) => { for (let i = 0; i < n; i++) { Stage.step(1 / 60); await new Promise(r => setTimeout(r, 0)); } }"""
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
    pg.goto(URL)
    pg.wait_for_function('window.__ready === true', timeout=20000)
    pg.evaluate("Stage.frozen = true")
    pg.evaluate("() => { __clawApi.startGame(); }")
    for _ in range(80):
        pg.evaluate(STEP, 30)
        if pg.evaluate("__claw.screen === 'game' && !__claw.busy"):
            break
    pg.evaluate(f"(() => {{ const p = __claw.inMachine.find(p => p.kind === '{kind}'); __claw.aimX = p.x; }})()")
    pg.evaluate(STEP, 150)
    pg.screenshot(path=f'{out}/00_aim.png')
    pg.evaluate("() => { __clawApi.drop(); }")
    t = 0
    for ms in [600, 1300, 1700, 2600, 3400, 4100, 4800, 5500, 6200, 6900]:
        pg.evaluate(STEP, round((ms - t) / 1000 * 60))
        t = ms
        pg.screenshot(path=f'{out}/{ms:05d}.png')
    print(pg.evaluate("({busy: __claw.busy, round: __claw.round, caught: __claw.caught, score: __claw.score})"))
    b.close()
for e in errs[:20]:
    print(e)
