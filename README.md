# Toy Catch (토이 캐치 · 파닉스 인형뽑기)

m · a · s · t 첫소리 동물 인형을 집게로 뽑는 파닉스 게임(FPR K Unit 1). three.js 3D 인형뽑기 기계 + 사용자가 준 인형 그림 10장.
`index.html`을 더블클릭(file://)해도 그대로 돈다 — 기계 텍스처는 캔버스로 그리고, 인형 그림·음성·배경음악은 base64 JS로 들어 있다.

## 흐름
1. **타이틀**: TOY CATCH 로고 · 기계 · START. 첫 터치에 배경음악 + "Hi, friends! Welcome to Toy Catch! … Press start to play!"
2. **START** → 동전이 투입구로 들어가고 기계 화면에 `INSERTED! / READY TO PLAY!` → "Ready? Let's play!" → 카메라가 기계 쪽으로 다가간다.
3. **4라운드**(m/a/s/t 무작위 순서, 라운드당 45초): 위 배너 `TARGET: Mm` + `CATCH THE 'M'!`, "Catch a friend that starts with /m/ … /m/".
   - 집게 이동: 조이스틱 드래그 · 기계 안 드래그 · 인형 탭(그 위로 이동) · ← →.  내리기: 초록 DOWN 버튼 · Space/Enter/↓.
   - 집게가 내려가 머리를 양옆에서 감싸 잡고 올린다(뒷줄 인형도 앞줄 위로 넘어 운반). 거북·물고기처럼 옆모습인 친구는 등껍질/몸통 위를 잡는다.
   - **정답**: 꽃가루·불꽃놀이, 다른 인형들이 환호, "Yes! You did it!" → 앞줄 위로 운반해 왼쪽 앞 배출구에 떨어뜨림 → 인형이 크게 튀어나와 "/m/ /m/ monkey" → 왼쪽 위 트레이로. 100점(첫 시도면 +50).
   - **오답**: 흔들리다 미끄러져 제자리로, "Uh-oh! cat. It starts with /k/" → "Try again! Listen." + 목표 음가.
   - 빈 데 내리면 "Oops, nothing! Try again." 시간이 다 되면 "Time's up!" 후 다음 라운드.
4. **결과**: 별(4개 모두 → 3, 2개 이상 → 2, 1개 → 1), 뽑은 친구들, 점수, 홈 / PLAY AGAIN.

첫 라운드에 아무것도 안 만지면 장갑 손이 조이스틱 → DOWN 순서로 시범("Move the claw, then press the button!").
오른쪽 위 EN/한 토글: 안내 음성만 한국어로 바뀐다(음가·단어는 영어 그대로). `localStorage` `claw-lang`, 음소거 `claw-muted`.

## 친구들 (seats 6)
- 정답 친구 `m: monkey, mouse · a: ant · s: seal · t: turkey, turtle`, 오답 친구 `c: cat, cow · d: dog · f: fish`(목표 글자로는 안 나옴).
  p로 시작하는 그림이 없어 p 라운드는 뺐다(사용자 결정).
- 매 판 6마리: m·a·s·t 한 마리씩 + 2마리(그중 최소 1마리는 c/d/f, 나머지는 남은 아무나). 뒷줄 3(선반) + 앞줄 3(볼풀) 지그재그라 글자 6개가 모두 보인다.
- 그림은 `js/friends.js`가 카메라를 늘 바라보는 컷아웃으로 세운다(가장자리는 alpha-to-coverage — 유리와 정렬 문제 없음).
  집게가 감쌀 머리 타원은 `tools/import_art.py`가 알파에서 잰다(윗부분 가장 넓은 줄 → 그 아래 가장 좁은 줄 = 목).
  옆모습(거북·물고기)과 몸통·머리가 한 덩어리인 물개, 꼬리깃이 넓은 칠면조는 `HEAD_FIX`로 지정. `--check out.png`로 타원을 그려 확인.
- 탭은 그림의 투명한 모서리가 아니라 그림 자체를 눌렀을 때만 그 친구로 간다(64px 알파 격자).

## 소리
- 음가 7개(m a s t + 오답용 c d f) + 단어 10개: **공식 FPR K 녹음**(Phonics Match에서 다듬어진 것, turkey는 Phonics Island의 FPR K Unit 1 Lesson 4 파일).
- 안내 문장: 사내 TTS 남자아이 목소리(aiden). 공용 문장은 Magic Block·Croco Phonics 것을 재사용, 새 문장 7개 × (영/한)은 `tools/build_voice.py`가 생성(사내망 필요, `~/.cache/toy-catch/voice_qwen`에 캐시).
  `tools/voice_check.py`(Whisper)로 14개 모두 받아쓰기 확인.
- 효과음(모터, 집게, 동전, 배출구, 팡파르)은 `js/audio.js`에서 합성. 배경음악은 `tools/make_bgm.py`가 합성한 30초 카니발 루프(칼리오페 + 움파 베이스, 샘플 없음).

## 그림
- `assets/img/bg.webp`, `assets/img/logo.webp`, `assets/img/friends/<kind>.webp`(+ `js/friends-art.js`): 사용자 제공
  `~/Downloads/toycatch_bg.png`, `toycatch_logo.png`, `toycatch_<kind>.png` × 10 → `tools/import_art.py`
  (**다운로드 폴더에는 개인 사진이 섞여 있으니 파일명으로만 가져온다**). 투명한 픽셀 밑의 흰색은 가장 가까운 테두리 색으로 채운다(축소 시 흰 테두리 방지).
- 상품 연출의 회전하는 햇살은 3D(친구 뒤) — HTML로 얹으면 친구를 덮어 흐려 보였다.
- 배경 위 떠다니는 글자 방울·음표·반짝이는 HTML(기계 기준 좌표 `--x/--y`, 기계 단위 `--mu`).

## 실행 · 도구
```sh
python3 tools/serve.py 5231                    # http://127.0.0.1:5231/  (그냥 index.html 열어도 됨)
/Users/jini/.hermes/bin/uv run --with pillow --with numpy --with scipy python tools/import_art.py   # 배경·로고·친구 10
zsh -ic '/Users/jini/.hermes/bin/uv run --with numpy python tools/build_voice.py'
/Users/jini/.hermes/bin/uv run --with numpy --with scipy python tools/make_bgm.py
```
URL 옵션: `?sec=10`(라운드 시간) · `?order=m,a,s,t` · `?kinds=cat,seal,ant,turtle,monkey,dog`(뒷줄 3 → 앞줄 3, 자리 고정) · `?nohint`.

## QA
```sh
U=/Users/jini/.hermes/bin/uv
$U run --with playwright python tools/qa/shot.py http://127.0.0.1:5231/ out.png 1600x900 --wait 2500
$U run --with playwright python tools/qa/flow.py http://127.0.0.1:5231 out_dir     # 타이틀 → 오답 → 정답 → 2라운드 (13장)
$U run --with playwright python tools/qa/grab.py http://127.0.0.1:5231 out_dir cat # 프레임 고정 스텝으로 집기 순간 정지 컷
$U run --with pillow python tools/qa/sheet.py out_dir sheet.png 4
```
`window.__claw`(상태) · `window.__clawApi`(startGame/drop) · `Stage.frozen=true` + `Stage.step(dt)`로 프레임 고정.

`vendor/three.iife.js`: three r186 + RoomEnvironment · RoundedBoxGeometry · TextGeometry · FontLoader · BufferGeometryUtils (`tools/three-entry.js`를 rolldown으로 묶음, MIT `vendor/three.LICENSE`).
