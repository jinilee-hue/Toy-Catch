"""Original background music for Toy Catch: a bouncy carnival-arcade loop.

G major, 128 BPM, 16 bars (30 s). A calliope (carnival organ) lead over G–Em–C–D (A) and C–D–Bm–Em | C–D–G–D (B),
an oom-pah tuba bass with organ "pah" stabs on 2 and 4, a soft chiptune arpeggio and a xylophone double in the B
half, glockenspiel sparkles, a light kick/clap/hat groove and snare fills back into bar 1. Everything is synthesised
here (no samples, no licences); the tune and chords are its own. The reverb tail is folded onto the start (seamless).
→ assets/audio/bgm.mp3 + js/bgm-data.js (base64 of the same mp3, so index.html opened from disk plays it)

Run: /Users/jini/.hermes/bin/uv run --with numpy --with scipy python tools/make_bgm.py
"""
import base64
import json
import pathlib
import subprocess
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_MP3 = ROOT / 'assets' / 'audio' / 'bgm.mp3'
OUT_JS = ROOT / 'js' / 'bgm-data.js'
SR = 44100
BPM = 128
BEAT = 60 / BPM
BARS = 16
LOOP = BARS * 4 * BEAT
N = int(LOOP * SR) + SR * 3
rng = np.random.default_rng(7)
NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
hz = lambda midi: 440 * 2 ** ((midi - 69) / 12)
m = lambda s: NOTE[s[:-1]] + 12 * (int(s[-1]) + 1)

CHORDS = ['G', 'Em', 'C', 'D', 'G', 'Em', ('C', 'D'), 'G',
          'C', 'D', 'Bm', 'Em', 'C', 'D', 'G', 'D']
TONES = {'G': ['G', 'B', 'D'], 'Em': ['E', 'G', 'B'], 'C': ['C', 'E', 'G'], 'D': ['D', 'F#', 'A'], 'Bm': ['B', 'D', 'F#']}
HOOK = [('D5', 0, .5), ('G5', .5, .5), ('B5', 1, .5), ('A5', 1.5, .5), ('G5', 2, .5), ('D5', 2.5, .5), ('B4', 3, 1)]
MEL = [
    HOOK,
    [('E5', 0, .5), ('G5', .5, .5), ('B5', 1, .75), ('A5', 1.75, .25), ('G5', 2, .5), ('F#5', 2.5, .5), ('E5', 3, 1)],
    [('E5', 0, .5), ('G5', .5, .5), ('C6', 1, .5), ('B5', 1.5, .5), ('A5', 2, .5), ('G5', 2.5, .5), ('E5', 3, .5), ('G5', 3.5, .5)],
    [('F#5', 0, .5), ('A5', .5, .5), ('D6', 1, 1), ('C6', 2, .5), ('A5', 2.5, .5), ('F#5', 3, 1)],
    HOOK,
    [('G5', 0, .5), ('B5', .5, .5), ('E6', 1, .5), ('D6', 1.5, .5), ('B5', 2, 1), ('G5', 3, .5), ('B5', 3.5, .5)],
    [('C6', 0, .5), ('B5', .5, .5), ('A5', 1, .5), ('G5', 1.5, .5), ('A5', 2, .5), ('B5', 2.5, .5), ('C6', 3, .5), ('D6', 3.5, .5)],
    [('B5', 0, 1), ('G5', 1.5, .5), ('D5', 2, .5), ('G5', 2.5, .5)],
    [('E6', 0, .5), ('D6', .5, .5), ('C6', 1, .5), ('G5', 1.5, .5), ('E5', 2, .5), ('G5', 2.5, .5), ('C6', 3, 1)],
    [('F#6', 0, .5), ('E6', .5, .5), ('D6', 1, .5), ('A5', 1.5, .5), ('F#5', 2, .5), ('A5', 2.5, .5), ('D6', 3, 1)],
    [('D6', 0, .5), ('B5', .5, .5), ('F#5', 1, .5), ('B5', 1.5, .5), ('D6', 2, .75), ('C#6', 2.75, .25), ('B5', 3, 1)],
    [('E6', 0, .5), ('B5', .5, .5), ('G5', 1, .5), ('B5', 1.5, .5), ('E6', 2, .5), ('F#6', 2.5, .5), ('G6', 3, 1)],
    [('G6', 0, .5), ('E6', .5, .5), ('C6', 1, .5), ('E6', 1.5, .5), ('G6', 2, .5), ('E6', 2.5, .5), ('C6', 3, 1)],
    [('F#6', 0, .5), ('D6', .5, .5), ('A5', 1, .5), ('D6', 1.5, .5), ('F#6', 2, .5), ('A6', 2.5, .5), ('F#6', 3, 1)],
    [('G6', 0, .5), ('D6', .5, .5), ('B5', 1, .5), ('G5', 1.5, .5), ('B5', 2, .5), ('D6', 2.5, .5), ('G6', 3, 1)],
    [('F#6', 0, .5), ('E6', .5, .5), ('D6', 1, .5), ('C6', 1.5, .5), ('B5', 2, .5), ('A5', 2.5, .5)],
]
assert len(MEL) == BARS == len(CHORDS)
L = np.zeros(N); R = np.zeros(N)


def add(sig, t, pan=0.0, gain=1.0):
    i = int(round(t * SR))
    if i >= N:
        return
    j = min(N, i + len(sig))
    s = sig[:j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan)); R[i:j] += s * np.sqrt(0.5 * (1 + pan))


tt = lambda dur: np.arange(int(dur * SR)) / SR


def calliope(f, dur):
    """carnival organ pipe: flute partials, a breathy chiff on the attack, a quick vibrato"""
    t = tt(dur + .09)
    vib = 1 + .0045 * np.sin(2 * np.pi * 6.2 * t) * np.minimum(1, t / .12)
    ph = 2 * np.pi * f * np.cumsum(vib) / SR
    s = np.sin(ph) + .5 * np.sin(2 * ph + .3) + .26 * np.sin(3 * ph) + .12 * np.sin(4 * ph + .8)
    chiff = rng.standard_normal(len(t)) * np.exp(-t / .018) * .25
    env = np.minimum(1, t / .012) * np.where(t < dur, 1, np.exp(-(t - dur) / .03))
    return (s + chiff) * env / 1.9


def xylo(f, dur):
    t = tt(max(dur, .2) + .5)
    env = np.minimum(1, t / .001) * np.exp(-t / (.18 * (523 / f) ** .3))
    return (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * 3.9 * f * t) * np.exp(-t / .03)) * env


def glock(f):
    t = tt(1.3)
    env = np.minimum(1, t / .001) * np.exp(-t / .45)
    return (np.sin(2 * np.pi * f * t) + .35 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / .1) + .2 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t / .04)) * env


def square(f, dur):
    """soft chiptune square (odd harmonics up to 9)"""
    t = tt(dur + .03)
    s = sum(np.sin(2 * np.pi * k * f * t) / k for k in (1, 3, 5, 7, 9))
    return s * np.minimum(1, t / .003) * np.exp(-t / .12)


def tuba(f, dur):
    t = tt(dur + .06)
    s = np.sin(2 * np.pi * f * t) + .45 * np.sin(4 * np.pi * f * t) * np.exp(-t / .1) + .2 * np.sin(6 * np.pi * f * t) * np.exp(-t / .05)
    env = np.minimum(1, t / .015) * np.where(t < dur, np.exp(-t / .5), np.exp(-dur / .5) * np.exp(-(t - dur) / .03))
    return s * env


def stab(freqs, dur=.16):
    t = tt(dur + .06)
    s = sum(np.sin(2 * np.pi * f * t) + .35 * np.sin(4 * np.pi * f * t) for f in freqs)
    return s * np.minimum(1, t / .006) * np.where(t < dur, 1, np.exp(-(t - dur) / .025)) / len(freqs)


def kick():
    t = tt(.28)
    f = 50 + 110 * np.exp(-t / .028)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .13) * np.minimum(1, t / .001)


BP_CLAP = butter(2, [900, 2600], btype='band', fs=SR, output='sos')
HP_HAT = butter(2, 7000, btype='high', fs=SR, output='sos')
BP_SN = butter(2, [1500, 6000], btype='band', fs=SR, output='sos')
HP_CR = butter(2, 4500, btype='high', fs=SR, output='sos')


def clap():
    t = tt(.24); n = rng.standard_normal(len(t)); env = np.zeros_like(t)
    for d in (0, .01, .02):
        env += (t >= d) * np.exp(-np.clip(t - d, 0, None) / .008)
    env += (t >= .028) * np.exp(-np.clip(t - .028, 0, None) / .09) * .6
    return sosfilt(BP_CLAP, n * env) * 2.2


def hat(open_=False):
    t = tt(.26 if open_ else .05)
    return sosfilt(HP_HAT, rng.standard_normal(len(t))) * np.exp(-t / (.08 if open_ else .018))


def snare():
    t = tt(.2)
    return sosfilt(BP_SN, rng.standard_normal(len(t))) * np.exp(-t / .07) * 1.6 + .5 * np.sin(2 * np.pi * 200 * t) * np.exp(-t / .05)


def crash():
    t = tt(1.5)
    return sosfilt(HP_CR, rng.standard_normal(len(t))) * np.exp(-t / .5) * np.minimum(1, t / .002)


def chord_at(bar, beat):
    c = CHORDS[bar]
    return (c[0] if beat < 2 else c[1]) if isinstance(c, tuple) else c


for bar in range(BARS):
    t0 = bar * 4 * BEAT
    B = bar >= 8
    fill = bar in (7, 15)
    for note, b, ln in MEL[bar]:
        f = hz(m(note))
        add(calliope(f, ln * BEAT * .92), t0 + b * BEAT, pan=.08, gain=.24)
        if B:
            add(xylo(f / 2, ln * BEAT), t0 + b * BEAT + .004, pan=-.35, gain=.13)
    # oom-pah: tuba root / fifth on 1 and 3, organ chord stabs on 2 and 4
    for b, iv in ((0, 0), (2, 7)):
        root = m(TONES[chord_at(bar, b)][0] + '2')
        if root > m('A2'):
            root -= 12
        add(tuba(hz(root + iv), .8 * BEAT), t0 + b * BEAT, gain=.34)
    for b in (1, 3):
        tones = [hz(m(n + '4')) for n in TONES[chord_at(bar, b)]]
        add(stab(tones), t0 + b * BEAT, pan=-.25, gain=.13)
        add(stab(tones, .08), t0 + (b + .5) * BEAT, pan=-.25, gain=.06)
    # B half: a soft arcade arpeggio in 16ths
    if B:
        tones = TONES[chord_at(bar, 0)]
        for k in range(16):
            n = tones[k % 3] + ('5' if k % 6 < 3 else '6')
            add(square(hz(m(n)), BEAT / 4), t0 + k * BEAT / 4, pan=.4, gain=.022)
    # drums
    for b in ((0, 2) if not fill else (0,)):
        add(kick(), t0 + b * BEAT, gain=.55)
    if B and not fill:
        add(kick(), t0 + 2.5 * BEAT, gain=.32)
    for b in (1, 3):
        if fill and b == 3:
            continue
        add(clap(), t0 + b * BEAT, pan=.05, gain=.2)
    for k in range(8):
        add(hat(k % 2 == 1 and B), t0 + k * BEAT / 2 + .002, pan=-.3, gain=.03 if k % 2 else .018)
    if bar in (0, 8):
        add(crash(), t0, pan=-.2, gain=.06)
    if fill:
        for k in range(8):
            add(snare(), t0 + 2 * BEAT + k * BEAT / 4, pan=-.05, gain=.07 + .03 * k)
        for k, n in enumerate(['D6', 'G6', 'B6', 'D7'] if bar == 15 else ['G5', 'B5', 'D6', 'G6']):
            add(glock(hz(m(n))), t0 + (2 + k * .5) * BEAT, pan=.4, gain=.08)
    if bar in (3, 11):
        for k, n in enumerate(['D6', 'F#6', 'A6', 'D7']):
            add(glock(hz(m(n))), t0 + (3 + k * .25) * BEAT, pan=.4, gain=.06)

ir_t = np.arange(int(1.0 * SR)) / SR
irL = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / .22); irR = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / .22)
irL[:int(.01 * SR)] = 0; irR[:int(.014 * SR)] = 0
irL /= np.sqrt((irL ** 2).sum()); irR /= np.sqrt((irR ** 2).sum())
L2 = L + .16 * fftconvolve(L, irL)[:N]; R2 = R + .16 * fftconvolve(R, irR)[:N]
n = int(round(LOOP * SR))
outL = L2[:n].copy(); outR = R2[:n].copy()
tail = len(L2) - n
outL[:tail] += L2[n:]; outR[:tail] += R2[n:]
st = np.stack([outL, outR], 1)
st /= np.abs(st).max()
st = np.tanh(st * 1.6) / np.tanh(1.6)
st *= 10 ** (-17 / 20) / np.sqrt((st ** 2).mean())
st *= min(1, 10 ** (-1 / 20) / np.abs(st).max())
rms = 20 * np.log10(np.sqrt((st ** 2).mean())); peak = 20 * np.log10(np.abs(st).max())
print(f'loop {LOOP:.3f}s · {BPM} BPM · peak {peak:.1f} dBFS · rms {rms:.1f} dBFS · seam jump {float(np.abs(st[0] - st[-1]).max()):.4f}')
OUT_MP3.parent.mkdir(parents=True, exist_ok=True)
wav = ROOT / 'tools' / 'bgm_loop.wav'
with wave.open(str(wav), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(st, -1, 1) * 32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-c:a', 'libmp3lame', '-b:a', '128k', str(OUT_MP3)], check=True)
wav.unlink()
OUT_JS.write_text('/* generated by tools/make_bgm.py — do not edit: the background music loop (mp3, base64) */\n'
                  'window.CLAW_BGM = ' + json.dumps({'loop': round(LOOP, 5), 'bpm': BPM, 'data': base64.b64encode(OUT_MP3.read_bytes()).decode()}) + ';\n', encoding='utf-8')
print('→', OUT_MP3.relative_to(ROOT), OUT_MP3.stat().st_size // 1024, 'KB ·', OUT_JS.relative_to(ROOT), OUT_JS.stat().st_size // 1024, 'KB')
