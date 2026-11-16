"""Play the claw game headless and grab stills at the key moments.

usage: flow.py <base_url> <out_dir> [WxH]
  - title → START (coin) → game HUD
  - aim at a WRONG plush, drop: descent / grab / lifted / slip back
  - aim at the RIGHT plush, drop: lifted + confetti / carried / prize word / tray
Fixed seats and order through the URL (?kinds=…&order=…&nohint) so every run is the same.
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
W, H = map(int, (sys.argv[3] if len(sys.argv) > 3 else '1600x900').split('x'))
os.makedirs(out, exist_ok=True)
URL = base.rstrip('/') + '/?nohint&order=m,a,s,t,p&kinds=pig,seal,ant,turtle,monkey,turkey'
errs = []


def shot(pg, name):
    pg.screenshot(path=f'{out}/{name}.png')
    print('shot', name)


def wait(pg, cond, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate(cond):
            return True
        pg.wait_for_timeout(100)
    print('TIMEOUT', cond)
    return False


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    pg.goto(URL)
    wait(pg, 'window.__ready === true')
    pg.wait_for_timeout(800)
    shot(pg, '01_title')
    pg.click('#start', force=True)
    pg.wait_for_timeout(700)
    shot(pg, '02_coin')
    wait(pg, "__claw.screen === 'game' && !__claw.busy")
    pg.wait_for_timeout(300)
    shot(pg, '03_game')
    # wrong pick first: the pig (target m)
    pg.evaluate("(() => { const p = __claw.inMachine.find(p => p.kind === 'pig'); __claw.aimX = p.x; })()")
    pg.wait_for_timeout(2600)
    shot(pg, '04_aim_wrong')
    pg.evaluate("() => { __clawApi.drop(); }")
    pg.wait_for_timeout(1100)
    shot(pg, '05_descend')
    pg.wait_for_timeout(450)
    shot(pg, '06_grab')
    pg.wait_for_timeout(1500)
    shot(pg, '07_lifted_wrong')
    wait(pg, "!__claw.busy")
    pg.wait_for_timeout(200)
    shot(pg, '08_after_wrong')
    # the right one: the monkey
    pg.evaluate("(() => { const p = __claw.inMachine.find(p => p.kind === 'monkey'); __claw.aimX = p.x; })()")
    pg.wait_for_timeout(2400)
    shot(pg, '09_aim_right')
    pg.evaluate("() => { __clawApi.drop(); }")
    pg.wait_for_timeout(3000)
    shot(pg, '10_lifted_right')
    pg.wait_for_timeout(1300)
    shot(pg, '11_carry')
    wait(pg, "document.querySelector('#prize').classList.contains('show')", 15)
    pg.wait_for_timeout(500)
    shot(pg, '12_prize')
    wait(pg, "__claw.round === 1 && !__claw.busy", 20)
    pg.wait_for_timeout(300)
    shot(pg, '13_round2')
    print('state', pg.evaluate("({round: __claw.round, score: __claw.score, caught: __claw.caught, target: __claw.target})"))
    b.close()
for e in errs[:30]:
    print(e)
