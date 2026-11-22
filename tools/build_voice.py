"""Voice clips for Toy Catch → assets/voice/*.mp3 + js/voice.js + js/voice-data.js (base64, so file:// plays them)

- (2026-11-19, phonics-kit rule) monkey / mouse: Phonics Match's clips are now the lesson pack FP.K.U1L1's recordings.
- LETTER SOUNDS + WORDS: the official recordings (FPR K letter sounds, FPR K / Constella word recordings), taken
  already trimmed and levelled from Phonics Match (public/voice, src/data/voice.json); turkey (not in Phonics Match)
  from Phonics Island's copy of the FPR K Unit 1 Lesson 4 file, trimmed and levelled here the same way.
- SHARED LINES: Magic Block's (Phonics-Jenga) takes of the company-TTS boy voice ('aiden', cheerful 7-year-old boy),
  English t:* and Korean k:*; "Ready? Let's play!" is Croco Phonics' tut8; "Now you try!" (the end of the first game's
  how-to demo) is Phonics Puzzle's tryit — the same tutor voice, read back there.
- NEW lines (NEW / NEW_KO below) from the company TTS (company network / VPN; TTS_BASE_URL + LLM_API_KEY come from
  ~/.zshrc and are never printed). Takes are cached in ~/.cache/toy-catch/voice_qwen; without the server the new lines
  are skipped and the game plays without them (it checks CLAW_VOICE.clips before playing).

Clip entry: {key: [file, start s, gain, dur s]} — applied at playback.
Run: /Users/jini/.local/bin/uv run --with numpy python tools/build_voice.py   (old voice: zsh -ic '… --engine qwen')
Rebuild Magic Block and Croco first: the shared lines are copied from them.
"""
import base64
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'voice'
JS = ROOT / 'js' / 'voice.js'
PH = pathlib.Path.home() / 'Documents/Jini/2026/Phonics'
MATCH, JENGA, CROCO = PH / 'Phonics-Match', PH / 'Phonics-Jenga', PH / 'Croco-Phonics'
PUZZLE = PH / 'Phonics-Puzzle'
ISLAND = PH / 'Phonics_island/phonics-island-3d/public'
CACHE = pathlib.Path.home() / '.cache' / 'toy-catch' / 'voice_qwen'
SR = 24000
QWEN_URL, QWEN_KEY = os.environ.get('TTS_BASE_URL', '').rstrip('/'), os.environ.get('LLM_API_KEY', '')
QWEN_VOICE = 'aiden'
# 2026-11-20 (user: "Ava Multilingual · aiden 높이·빠르기 이걸로 통일"): default engine phonics-api — this game's own lines in the one
# tutor voice (phonics-kit tts_voice.tutor + tutor_takes); the shared lines come from Magic Block / Croco, rebuilt in it too.
# `--engine qwen` = the old company TTS.
ENGINE = sys.argv[sys.argv.index('--engine') + 1] if '--engine' in sys.argv else 'phonics-api'
T_INS = ['Speak like a cheerful, energetic 7-year-old boy: bright and excited.',
         'Speak like a cheerful, energetic 7-year-old boy, bright and excited, clearly.',
         'Like a cheerful, energetic 7-year-old boy: bright, excited and clear.']
TAKE_OF = {}                      # key → instruction variant, when a take reads back wrong

WORDS = ['monkey', 'mouse', 'ant', 'seal', 'turkey', 'turtle', 'cat', 'cow', 'dog', 'fish', 'duck']
SOUNDS = ['m', 'a', 's', 't', 'c', 'd', 'f']      # c d f: the wrong-answer friends ("It starts with /k/")
REUSE_JENGA = ['pressstart', 'great3', 'uhoh', 'startswith', 'again', 'playagain']
NEW = {
    'hello': 'Hi, friends! Welcome to Toy Catch!',
    'find': 'Catch a friend that starts with',
    'howto': 'Move the claw, then press the button!',
    'miss': 'Oops, nothing! Try again.',
    'timeup': "Time's up!",
    'allcaught': 'Wow! You caught them all!',
    'result': "Great job! Let's catch more friends!",
    'slip': 'Oh no, it slipped! So close!',
    'center': 'Put the claw right over your friend!',
}
NEW_KO = {
    'hello': '안녕, 친구들! 토이 캐치에 온 걸 환영해!',
    'find': '소리로 시작하는 친구를 뽑아 봐!',
    'howto': '집게를 움직이고, 버튼을 눌러 봐!',
    'miss': '앗, 아무것도 못 잡았어! 다시 해 보자.',
    'timeup': '시간이 다 됐어!',
    'allcaught': '와! 친구들을 모두 뽑았어!',
    'result': '잘했어! 친구들을 더 뽑아 보자!',
    'slip': '아이코, 미끄러졌어! 아깝다!',
    'center': '집게를 친구 바로 위에 맞춰 봐!',
}
assert set(NEW) == set(NEW_KO)

OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('*.mp3'):
    f.unlink()
clips, lines, lines_ko = {}, {}, {}
mv = json.loads((MATCH / 'src/data/voice.json').read_text(encoding='utf-8'))
jv = json.loads((JENGA / 'src/data/voice.json').read_text(encoding='utf-8'))
cv = json.loads((CROCO / 'js/voice.js').read_text(encoding='utf-8').split('=', 1)[1].rstrip().rstrip(';'))
pv = json.loads((PUZZLE / 'js/voice.js').read_text(encoding='utf-8').split('=', 1)[1].rstrip().rstrip(';'))


def take(src_dir, table, key, as_key=None):
    e = table['clips'][key]
    name = (as_key or key).replace(':', '_') + '.mp3'
    shutil.copy2(src_dir / e[0], OUT / name)
    clips[as_key or key] = [name, *e[1:]]


# official words + letter sounds (Phonics Match)
for w in WORDS:
    if f'w:{w}' in mv['clips']:
        take(MATCH / 'public/voice', mv, f'w:{w}')
for L in SOUNDS:
    take(MATCH / 'public/voice', mv, f's:{L}')
# shared lines (Magic Block), + Croco's "Ready? Let's play!"
for k in REUSE_JENGA:
    take(JENGA / 'public/voice', jv, f't:{k}'); lines[k] = jv['lines'][k]
    if f'k:{k}' in jv['clips']:
        take(JENGA / 'public/voice', jv, f'k:{k}'); lines_ko[k] = jv['lines_ko'][k]
take(CROCO / 'assets/voice', cv, 't:tut8', 't:ready'); lines['ready'] = "Ready? Let's play!"
take(CROCO / 'assets/voice', cv, 'k:tut8', 'k:ready'); lines_ko['ready'] = '준비됐니? 시작하자!'
for pre, out, table in (('t', lines, 'lines'), ('k', lines_ko, 'lines_ko')):     # Phonics Puzzle's "Now you try!"
    take(PUZZLE / 'assets/voice', pv, f'{pre}:tryit'); out['tryit'] = pv[table]['tryit']

# ── trimming / levelling (as Croco Phonics' build_voice) ────────────────────────────────────────────────
LEAD, TAIL = .10, .25
FR = int(SR * .01)


def decode(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(p), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def speech(x, floor_db=-50):
    n = len(x) // FR
    rms = np.sqrt((x[:n * FR].reshape(n, FR) ** 2).mean(1) + 1e-12)
    return rms, np.nonzero(rms > rms.max() * 10 ** (floor_db / 20))[0]


def trim(raw, dst, target_db=-17, floor_db=-50):
    _, act = speech(decode(raw), floor_db)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-t', f'{(act[-1] + 1) * FR / SR + TAIL:.3f}',
                    '-c:a', 'copy', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '0', str(dst)], check=True)
    y = decode(dst)
    rms, act = speech(y, floor_db)
    voiced = rms[act[0]:act[-1] + 1]
    loud = np.sqrt((voiced[voiced > voiced.max() * .1] ** 2).mean())
    g = min(10 ** (target_db / 20) / loud, 10 ** (-1 / 20) / np.abs(y).max())
    start = max(0., act[0] * FR / SR - LEAD)
    return round(start, 3), round(float(g), 3), round(len(y) / SR - start, 3)


fpr = json.loads((ISLAND / 'fpr' / 'manifest.json').read_text())['clips']
for w in WORDS:
    if f'w:{w}' not in clips:
        dst = OUT / f'w_{w}.mp3'
        clips[f'w:{w}'] = [dst.name, *trim(ISLAND / fpr[f'word:{w}'], dst, target_db=-18, floor_db=-40)]
        print('official word from Phonics Island:', w)

# ── new lines: company TTS ─────────────────────────────────────────────────────────────────────────────
SERVER = {'down': False, 'fetched': 0}


def qwen(text, ins, dst, lang='en'):
    if SERVER['down']:
        return False
    body = json.dumps({'model': 'qwen-tts', 'input': text, 'voice': QWEN_VOICE, 'language': lang, 'response_format': 'wav', 'instructions': ins}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(QWEN_URL + '/audio/speech', data=body, method='POST', headers={'Authorization': 'Bearer ' + QWEN_KEY, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as r:
                wav = r.read()
            with tempfile.NamedTemporaryFile(suffix='.wav') as f:
                f.write(wav); f.flush()
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f.name, '-ac', '1', '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', '64k', str(dst)], check=True)
            SERVER['fetched'] += 1
            return True
        except Exception as e:  # 503 = GPU busy: wait, retry; no answer = off the company network
            busy = getattr(e, 'code', None) in (429, 502, 503, 504)
            if attempt == 3 or not busy:
                print(f'  TTS failed for "{text}": {type(e).__name__} {getattr(e, "code", "")}')
                if not busy:
                    SERVER['down'] = True
                return False
            time.sleep(4 + 3 * attempt)


CACHE.mkdir(parents=True, exist_ok=True)
missing = []
if ENGINE == 'phonics-api':
    sys.path.insert(0, str(PH / 'phonics-kit' / 'tools'))
    import tts_voice  # noqa: E402
    import tutor_takes  # noqa: E402
    got, never = tutor_takes.best([(f't:{k}', t, 'en') for k, t in NEW.items()] + [(f'k:{k}', t, 'ko') for k, t in NEW_KO.items()])
    if never:
        print('never heard right (kept take 1 — check by ear):', never)
    for pre, table, out in (('t', NEW, lines), ('k', NEW_KO, lines_ko)):
        for k, text in table.items():
            dst = OUT / f'{pre}_{k}.mp3'
            clips[f'{pre}:{k}'] = [dst.name, *trim(got[f'{pre}:{k}'], dst)]
            out[k] = text
for pre, table, lang, out in ((('t', NEW, 'en', lines), ('k', NEW_KO, 'ko', lines_ko)) if ENGINE != 'phonics-api' else ()):
    for k, text in table.items():
        ins = T_INS[TAKE_OF.get(f'{pre}:{k}', 0) % len(T_INS)]
        raw = CACHE / f'{pre}_{k}_{hashlib.md5((QWEN_VOICE + ins + text + lang).encode()).hexdigest()[:8]}.mp3'
        if not raw.exists() and (not (QWEN_URL and QWEN_KEY) or not qwen(text, ins, raw, lang)):
            missing.append(f'{pre}:{k}')
            continue
        dst = OUT / f'{pre}_{k}.mp3'
        clips[f'{pre}:{k}'] = [dst.name, *trim(raw, dst)]
        out[k] = text

JS.write_text('/* generated by tools/build_voice.py — do not edit */\nwindow.CLAW_VOICE = '
              + json.dumps({**({'engine': 'phonics-api + official FPR K', 'voice': tts_voice.TUTOR_VOICE, 'shape': tts_voice.TUTOR_SHAPE}
                               if ENGINE == 'phonics-api' else {'engine': 'company-tts + official FPR K', 'voice': QWEN_VOICE}), 'clips': clips, 'lines': lines, 'lines_ko': lines_ko}, ensure_ascii=False, indent=0) + ';\n', encoding='utf-8')
data = {k: base64.b64encode((OUT / v[0]).read_bytes()).decode() for k, v in clips.items()}
(ROOT / 'js' / 'voice-data.js').write_text('/* generated by tools/build_voice.py — do not edit */\nwindow.CLAW_VOICE_DATA = ' + json.dumps(data) + ';\n', encoding='utf-8')
size = sum((OUT / v[0]).stat().st_size for v in clips.values())
print(f'{len(clips)} clips · {size / 1024:.0f} KB · company TTS reads this run: {SERVER["fetched"]}')
if missing:
    print('NOT generated (no company TTS):', missing)
