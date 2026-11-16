"""Read back the company-TTS lines with Whisper and compare with the text (catches mumbled / wrong takes).
Run with the video-vision venv (whisper + models cached):
  ~/.claude/skills/video-vision/.venv/bin/python tools/voice_check.py [model]
"""
import json
import pathlib
import re
import sys

import whisper

ROOT = pathlib.Path(__file__).resolve().parent.parent
V = json.loads((ROOT / 'js' / 'voice.js').read_text(encoding='utf-8').split('=', 1)[1].rstrip().rstrip(';'))
model = whisper.load_model(sys.argv[1] if len(sys.argv) > 1 else 'medium')
NEW = ['hello', 'find', 'howto', 'miss', 'timeup', 'allcaught', 'result', 'slip', 'center']
norm = lambda s: re.sub(r'[^0-9a-z가-힣 ]', '', s.lower()).split()
for pre, table, lang in (('t', V['lines'], 'en'), ('k', V['lines_ko'], 'ko')):
    for k in NEW:
        if f'{pre}:{k}' not in V['clips']:
            print(f'{pre}:{k:10s} MISSING'); continue
        f = ROOT / 'assets' / 'voice' / V['clips'][f'{pre}:{k}'][0]
        r = model.transcribe(str(f), language=lang, fp16=False)
        heard = r['text'].strip()
        a, b = norm(table[k]), norm(heard)
        common = len(set(a) & set(b)) / max(1, len(set(a)))
        print(f'{pre}:{k:10s} {common:4.2f} | {table[k]} | heard: {heard}')
