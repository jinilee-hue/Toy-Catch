# Toy Catch (토이 캐치 · 파닉스 인형뽑기)

m · a · s · t 첫소리 동물 인형을 집게로 뽑는 파닉스 게임(FPR K Unit 1). three.js 3D 인형뽑기 기계 + 사용자가 준 인형 그림 10장.
`index.html`을 더블클릭(file://)해도 그대로 돈다 — 기계 텍스처는 캔버스로 그리고, 인형 그림·음성·배경음악은 base64 JS로 들어 있다.

## 흐름
1. **타이틀**: TOY CATCH 로고 · 기계 · START. 첫 터치에 배경음악 + "Hi, friends! Welcome to Toy Catch! … Press start to play!"
2. **START** → 동전이 투입구로 들어가고 기계 화면에 `INSERTED! / READY TO PLAY!` → "Ready? Let's play!" → 카메라가 기계 쪽으로 다가간다.
3. **4라운드**(m/a/s/t 무작위 순서, 라운드당 45초): 위 배너 `TARGET: Mm` + `CATCH THE 'M'!`, "Catch a friend that starts with /m/ … /m/".
   - 집게 이동: 조이스틱 드래그 · 기계 안 드래그 · 인형 탭(그 위로 이동) · ← →.  내리기: 초록 DOWN 버튼 · Space/Enter/↓.
   - 집게는 조준한 자리에 **그대로** 내려간다(친구 쪽으로 저절로 붙지 않음). 머리 가운데와의 거리(`AIM` in game.js)로 결과가 갈린다:
     ≤0.2 확실히 잡음 · ≤0.4 헐겁게 잡혀 올라가다 기울어 **미끄러질 수 있음**(가운데서 멀수록 35→85%, "Oh no, it slipped! So close!")
     · ≤0.62 집게발이 머리 옆을 쳐서 친구가 밀려 흔들림, 빈손("Put the claw right over your friend!") · 그 밖은 빈손("Oops, nothing!").
     한 라운드에 연속 2번 놓치면 다음 헐거운 잡기는 안 미끄러진다. 조준 중엔 빛이 집게 위 트롤리의 노란 둥근 램프에서 나와 집게가 내려갈 자리로 퍼지고(`makeSpot`: 원뿔의 먼 쪽 반만 보여 인형을 흐리지 않음, 진짜 스포트라이트가 공 위에 빛 웅덩이, 인형은 위에서 비친 듯 밝아짐), 가운데일 때만 밝아지며
     친구가 통통 뛰고 DOWN 버튼이 반짝이고 "DOWN!" 힌트가 뜬다. 친구를 탭하면 그 친구 가운데가 아니라 **탭한 자리**로 집게가 간다.
   - 잡히면 머리를 양옆에서 감싸 올린다(뒷줄 인형도 앞줄 위로 넘어 운반). 거북·물고기처럼 옆모습인 친구는 등껍질/몸통 위를 잡는다.
   - **정답**: 꽃가루·불꽃놀이(불꽃은 둥근 점만 — 꼬리 선 없음), 다른 인형들이 환호, "Yes! You did it!" → 앞줄 위로 운반해 왼쪽 앞 배출구에 떨어뜨림 → 인형이 크게 튀어나와 "/m/ /m/ monkey" → 왼쪽 위 트레이로. 100점(첫 시도면 +50).
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
  그림은 입체로 부풀린다(`puffGeo`): 실루엣 안에서 포아송 방정식을 풀어(넓은 머리·몸은 두껍게, 팔·귀·꼬리는 얇게)
  쿠션처럼 둥근 부조를 만들고, 그림은 정면에서 그대로 입힌다. 그림에 이미 그려진 빛을 그대로 두고(옆에서 비추는 빛은 그림의 빛과 싸워
  어색했다) `puffShade`는 윤곽 쪽과 아랫면만 살짝 어둡게 한다(그림보다 밝아지지 않음). 천천히
  좌우로 살짝 돌며(`PUFF.sway`) 부피가 보인다. 외곽은 여전히 그림의 알파라 디자인이 그대로다. `?flat`은 예전 평면 그림.
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
- 기계 양옆에 떠다니는 **글자 동전** 8개(m a a m / s t s t): Magic Block 블럭 파스텔(`p-pink/butter/mint/sky/lavender/peach`, 값은 Phonics-Jenga
  `tower.ts` PASTELS)로 무광 면 + 테두리 홈 + 동전 두께, 글자는 블럭처럼 진한 잉크색에 밑에 밝은 립(찍힌 느낌). 4.2초마다 두 바퀴 휙 —
  거울 글자가 보이지 않게 scale은 1 → 0.07 → 1만 오간다.
- 떠다니는 음표 4개는 로고에 있는 젤리 음표를 그대로 오려 쓴다(`tools/import_art.py --notes` → `assets/img/notes/`: 파란 ♫, 분홍·빨강·하늘 ♪).
  로고가 바뀌면 `NOTES`의 상자 좌표를 다시 잴 것.
- START 버튼은 인트로 시안(`design/intro_ref.png` x 1050–1720, y 1300–1530)을 따라 `game.js buildStart()`가 캔버스로 그린다:
  두꺼운 블럭 글자(앞면 + 진한 옆면 28px + 둥근 흰 테두리와 그 라벤더 옆면) on 파란 판(진한 앞 모서리, 둥근 모서리).
  좌표·크기는 시안 픽셀(1 mu = 15.36 px). Baloo 800보다 굵고 넓은 시안 글꼴에 맞춰 모든 층에 7px 획을 더하고 가로 1.2배.
  글자마다 캔버스 하나라 통통 뛰는 애니메이션은 transform만 바뀐다(매 프레임 다시 그리지 않음). 부드러운 그림자는
  `shadowBlur`(구형 iPad Safari엔 캔버스 `filter`가 없음).
  판 윗면과 글자는 CSS perspective 하나(`.tilt`, 판 앞 모서리를 축으로 rotateX 30° + scaleY 보정)로 함께 기울어 위가 좁다 —
  그래서 판 윗면은 기울기 전 직사각형으로 그린다. 흰 테두리 5개는 모든 글자 아래에 깔아 하나로 이어지고,
  글자는 차례로 부풀었다 줄어드는 물결(`startWave`)로 계속 돈다.
- 자리 맞춤(game.js `setupPlushes`): 왼쪽 앞자리는 배출구 옆, 양 끝 자리는 유리벽 옆 — 그림 폭(`P.span`)이 넘치는 친구(거북이·물고기 등)는
  맞는 자리의 친구와 자리를 바꾸고, 안 되면 넘친 만큼만 안쪽으로 옮긴다(자리 위치 자체는 그대로).
- 볼풀 공: 로고 같은 젤리 공(조명 대신 자체 셰이딩: 밝은 윗면, 채도 유지한 진한 아랫면, 빛이 비치는 밝은 가장자리, 왼쪽 위 큰 하이라이트 — 어두운 테두리 없음; 선택 빛 웅덩이 `balls.spot`, 친구 주변 옅은 그늘도 셰이더에서), 채도를 올린 캔디색, 44×30 분할. 움직임은 정점
  셰이더에서(`machine.balls.splash(x, z, s)` — 집게가 볼풀에 들어갈 때·인형을 들어 올릴 때·인형이 떨어져 앉을 때 주변 공이
  고리 모양으로 퍼지며 통통 튐, `machine.balls.friends(list, t)` — 볼풀에 앉은 친구가 통통 뛸 때마다 발밑 공이 같이 튐: 흥분한 뜀·환호 뜀 모두, 멀수록 조금 늦게). 그림자 패스도 같은 움직임.
- 패널의 작은 화면·조이스틱·동그란 버튼은 가운데(START / DOWN)에서 넉넉히 떨어뜨려 놓았다 — 지우지 말고 간격만(사용자 요청).
  동전 투입 중 #app 상태 클래스는 `inserting` — `coin`은 인트로 동전의 클래스라 앱 전체가 동전 크기로 줄어들었다.
- DOWN 버튼은 패널 위 3D 버튼(`machine.js` `setDown`/`pressDown`/`downRim`): 다른 버튼과 같은 각도, 크기는 크게.
  화살표 그림은 비스듬히(36°) 투영해 보이는 돔 가운데에 온다. 탭은 그 위 투명 `#drop`(game.js `layout()`이 화면 위치를 잰다).
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
