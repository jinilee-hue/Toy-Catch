"""Original background music for Toy Catch — an 8-bit ARCADE loop (2026-11-22).

Why a new one (user): the old carnival loop (G major, 128 BPM, calliope over G–Em–C–D) had the same chords as Croco and
Eye Catch bar for bar (I–vi–IV–V | IV–V–iii–vi) and the same backing template as Magic Block's — by ear one tune
("toy-catch도 비슷한거 같고"). Rule: "게임마다 게임에 맞게 음악이 좀 달라야해. 그리고 기본적으로 전체 음악은 신나야해."
→ "Toy-Catch → 8비트 오락실".

Fit: a claw machine in an arcade, so a chiptune: E major, 150 BPM, 16 bars = 25.6 s. Pulse-wave lead (25 % duty) with
vibrato, a thin 12.5 % pulse playing fast chord arpeggios, a stepped triangle bass bouncing in octaves, noise-channel
drums, and a "claw drop" — a pitch slide down plus a grab blip — at the ends of bars 4 and 12, a power-up run into
bar 1. Chords: A = I–♭VII–IV–I | I–♭VII–IV–V, B = ♭VI–♭VII–I–I | ♭VI–♭VII–V–V (the arcade "victory" cadence; no other
phonics game uses these). Instruments, mixer and mastering: phonics-kit tools/bgm_engine.py (only the score lives here).
→ assets/audio/bgm.mp3 + js/bgm-data.js (window.CLAW_BGM, base64 — file:// and the 3D textures never fetch assets/).

Run: /Users/jini/.local/bin/uv run --with numpy --with scipy --with pyloudnorm python tools/make_bgm.py
(The previous carnival loop is in git history: tools/make_bgm.py before 2026-11-22.)
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit/tools'))
import bgm_engine as E  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
mx = E.Mix(bpm=150, bars=16, seed_n=150)
CHORDS = ['E', 'D', 'A', 'E', 'E', 'D', 'A', 'B',
          'C', 'D', 'E', 'E', 'C', 'D', 'B', 'B']
TONES = {'E': ['E', 'G#', 'B'], 'D': ['D', 'F#', 'A'], 'A': ['A', 'C#', 'E'], 'B': ['B', 'D#', 'F#'], 'C': ['C', 'E', 'G']}
MEL = [
    [('B4', 0, .5), ('E5', .5, .5), ('G#5', 1, .5), ('B5', 1.5, .5), ('G#5', 2, .25), ('B5', 2.25, .25), ('E6', 2.5, 1)],
    [('F#5', 0, .5), ('A5', .5, .5), ('D6', 1, .75), ('C#6', 1.75, .25), ('A5', 2, .5), ('F#5', 2.5, .5), ('A5', 3, 1)],
    [('E5', 0, .25), ('E5', .25, .25), ('A5', .5, .5), ('C#6', 1, .5), ('E6', 1.5, .5), ('C#6', 2, .5), ('A5', 2.5, .5), ('B5', 3, .5), ('C#6', 3.5, .5)],
    [('B5', 0, 1.5), ('G#5', 1.5, .5), ('E5', 2, .5)],
    [('B4', 0, .5), ('E5', .5, .5), ('G#5', 1, .5), ('B5', 1.5, .5), ('E6', 2, .5), ('D#6', 2.5, .5), ('E6', 3, .5), ('F#6', 3.5, .5)],
    [('F#6', 0, .5), ('E6', .5, .5), ('D6', 1, .5), ('A5', 1.5, .5), ('F#5', 2, .5), ('A5', 2.5, .5), ('D6', 3, 1)],
    [('C#6', 0, .5), ('E6', .5, .5), ('A6', 1, 1), ('G#6', 2, .25), ('F#6', 2.25, .25), ('E6', 2.5, .5), ('C#6', 3, .5), ('A5', 3.5, .5)],
    [('B5', 0, .25), ('A5', .25, .25), ('G#5', .5, .25), ('F#5', .75, .25), ('D#5', 1, .5), ('F#5', 1.5, .5), ('B5', 2, 1), ('D#6', 3, .5), ('F#6', 3.5, .5)],
    [('E6', 0, .5), ('G6', .5, .5), ('C6', 1, .5), ('E6', 1.5, .5), ('G6', 2, 1.5)],
    [('F#6', 0, .5), ('A6', .5, .5), ('D6', 1, .5), ('F#6', 1.5, .5), ('A6', 2, 1.5)],
    [('G#6', 0, .5), ('F#6', .5, .5), ('E6', 1, .5), ('B5', 1.5, .5), ('G#5', 2, .5), ('B5', 2.5, .5), ('E6', 3, 1)],
    [('E6', 0, .25), ('E6', .25, .25), ('B5', 1, .5), ('G#5', 1.5, .5), ('E5', 2, .5)],
    [('G5', 0, .5), ('C6', .5, .5), ('E6', 1, .5), ('G6', 1.5, .5), ('E6', 2, .5), ('C6', 2.5, .5), ('E6', 3, .5), ('G6', 3.5, .5)],
    [('A5', 0, .5), ('D6', .5, .5), ('F#6', 1, .5), ('A6', 1.5, .5), ('F#6', 2, .5), ('D6', 2.5, .5), ('F#6', 3, .5), ('A6', 3.5, .5)],
    [('B6', 0, 1), ('A6', 1, .5), ('F#6', 1.5, .5), ('D#6', 2, .5), ('B5', 2.5, .5), ('F#5', 3, .5), ('A5', 3.5, .5)],
    [('B5', 0, .5), ('D#6', .5, .5), ('F#6', 1, .5), ('B6', 1.5, .5)],
]
CLAW = (3, 11)                           # bars whose last beats drop the claw (slide down + grab blip)
assert len(MEL) == len(CHORDS) == mx.bars

for bar in range(mx.bars):
    B = bar >= 8
    fill = bar in (7, 15)
    tones = TONES[CHORDS[bar]]
    for note, b, ln in MEL[bar]:                                       # lead: 25 % pulse, a slight echo copy
        f = E.hz(note)
        f = f / 2 if f > 1500 else f                                   # keep the very top notes kind to small ears
        mx.add(E.square(f, ln * mx.beat * .92, duty=.25, decay=.25), mx.at(bar, b), pan=.05, gain=.13, send=.15)
        mx.add(E.square(f, ln * mx.beat * .8, duty=.25, vib=False, decay=.2), mx.at(bar, b) + .75 * mx.beat, pan=-.4, gain=.03)
    for k in range(16):                                                # 12.5 % pulse arpeggio in 16ths
        n = E.midi(tones[k % 3] + '5') + (12 if k % 6 >= 3 else 0)
        if n > E.midi('B5'):
            n -= 12
        mx.add(E.square(E.hz(n), mx.beat / 4 * .7, duty=.125, vib=False), mx.at(bar, k / 4), pan=-.25, gain=.035 if B else .022)
    root = E.midi(tones[0] + '2')
    root = root - 12 if root > E.midi('F#2') else root
    for k in range(8):                                                 # triangle bass bouncing in octaves
        mx.add(E.tri_bass(E.hz(root + (12 if k % 2 else 0)), mx.beat / 2 * .85), mx.at(bar, k / 2), gain=.42)
    for b in ((0, 1, 2, 3) if B else (0, 2, 2.5)):
        mx.add(E.chip_kick(), mx.at(bar, b), gain=.6)
    for b in (1, 3):
        if not (fill and b == 3):
            mx.add(E.chip_noise(.12), mx.at(bar, b), gain=.2)
    for k in range(8):
        mx.add(E.chip_noise(.03, short=True), mx.at(bar, k / 2), pan=.3, gain=.05 if k % 2 else .03)
    if bar in CLAW:                                                    # the claw drops ... and grabs
        mx.add(E.slide(E.hz('E6'), E.hz('E4'), .75 * mx.beat, duty=.5), mx.at(bar, 2.75), pan=.2, gain=.07, send=.2)
        for i, n in enumerate(('B4', 'E5')):
            mx.add(E.square(E.hz(n), .12, duty=.5, vib=False), mx.at(bar, 3.5 + i * .25), pan=.2, gain=.08)
    if fill:                                                           # noise roll + power-up run into the next bar
        for k in range(4):
            mx.add(E.chip_noise(.06), mx.at(bar, 3 + k / 4), gain=.1 + .04 * k)
    if bar == 15:
        mx.add(E.slide(E.hz('B4'), E.hz('B6'), .9 * mx.beat, duty=.25), mx.at(bar, 3), pan=-.1, gain=.06, send=.2)

st = mx.render(lufs=-15.2, room=.15, wet=.35)
E.write(st, mx, ROOT / 'assets' / 'audio' / 'bgm.mp3', ROOT / 'js' / 'bgm-data.js', 'CLAW_BGM',
        'generated by tools/make_bgm.py — do not edit: the background music loop (mp3, base64)')
