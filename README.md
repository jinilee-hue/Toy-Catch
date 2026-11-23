# Toy Catch (토이 캐치 · 파닉스 인형뽑기)

m · a · s · t 첫소리 동물 인형을 집게로 뽑는 파닉스 게임(FPR K Unit 1). three.js 3D 인형뽑기 기계 + 사용자가 준 인형 그림 10장.
`index.html`을 더블클릭(file://)해도 그대로 돈다 — 기계 텍스처는 캔버스로 그리고, 인형 그림·음성·배경음악은 base64 JS로 들어 있다.

## 흐름
1. **타이틀**: TOY CATCH 로고 · 기계 · START. 첫 터치에 배경음악 + "Hi, friends! Welcome to Toy Catch! … Press start to play!"
2. **START** → 카메라가 투입구로 다가가 동전이 들어가는 걸 보여 주고(`S.shotTo` + `slotShot`) 기계 화면에 `INSERTED! / READY TO PLAY!` → "Ready? Let's play!" → 카메라가 돌아와 기계 쪽으로 다가간다. 코인 8개가 위에서 쏟아져 왼쪽 위 코인 칸에 들어온다(`+8`).
3. **4라운드**(m/a/s/t 무작위 순서, 시간 제한 없음 — 코인이 있는 동안): 위 가운데 파란 알약에 목표 글자 `Mm`(젤리 글자) + 다시 듣기 스피커, 기계 화면 `LEVEL n / FIND M m`, 가운데에 `GO!`, "Catch a friend that starts with /m/ … /m/".
   - 집게 이동: 조이스틱 드래그 · 기계 안 드래그 · 인형 탭(그 위로 이동) · ← →.  내리기: 초록 DOWN 버튼 · Space/Enter/↓.
   - 집게는 조준한 자리에 **그대로** 내려간다(친구 쪽으로 저절로 붙지 않음). 머리 가운데와의 거리(`AIM` in game.js)로 결과가 갈린다:
     ≤0.2 확실히 잡음 · ≤0.4 헐겁게 잡혀 올라가다 기울어 **미끄러질 수 있음**(가운데서 멀수록 35→85%, "Oh no, it slipped! So close!")
     · ≤0.62 집게발이 머리 옆을 쳐서 친구가 밀려 흔들림, 빈손("Put the claw right over your friend!") · 그 밖은 빈손("Oops, nothing!").
     한 라운드에 연속 2번 놓치면 다음 헐거운 잡기는 안 미끄러진다. 조준 중엔 빛이 집게 위 트롤리의 노란 둥근 램프에서 나와 집게가 내려갈 자리로 퍼지고(`makeSpot`: 원뿔의 먼 쪽 반만 보여 인형을 흐리지 않음, 진짜 스포트라이트가 공 위에 빛 웅덩이, 인형은 위에서 비친 듯 밝아짐), 가운데일 때만 밝아지며
     친구가 통통 뛰고 DOWN 버튼이 반짝이며 두근거린다("DOWN!" 글자·화살표는 뺐다 — 사용자 요청). 친구를 탭하면 그 친구 가운데가 아니라 **탭한 자리**로 집게가 간다.
   - 잡히면 머리를 양옆에서 감싸 올린다(뒷줄 인형도 앞줄 위로 넘어 운반). 거북·물고기처럼 옆모습인 친구는 등껍질/몸통 위를 잡는다.
   - **정답**: 꽃가루·불꽃놀이(불꽃은 둥근 점만 — 꼬리 선 없음), 다른 인형들이 환호, "Yes! You did it!" → 앞줄 위로 운반해 왼쪽 앞 배출구에 떨어뜨림 → 인형이 크게 튀어나와 "/m/ /m/ monkey" → 왼쪽 위 트레이로. 코인 1개를 돌려받는다(`+1`, 친구에게서 금화가 튀어나와 코인 칸으로).
   - **오답**: 흔들리다 미끄러져 제자리로, "Uh-oh! cat. It starts with /k/" → "Try again! Listen." + 목표 음가.
   - 빈 데 내리면 "Oops, nothing! Try again." 놓치거나 오답이어도 코인을 더 빼지 않는다(내릴 때 낸 1개뿐, `−1`).
   - 한 번 한 뒤 코인이 0이면 `NO COINS!`(기계 화면 `NO COINS / GAME OVER`) → 결과. `?sec=N`일 때만 라운드 시계가 돌고, 다 되면 `TIME'S UP!` "Time's up!" 후 다음 라운드.
4. **결과**: 별(4개 모두 → 3, 2개 이상 → 2, 1개 → 1), 제목 PERFECT! · GREAT JOB! · NICE TRY!, 뽑은 친구들, 남은 코인(0이면 숨김), 홈 / PLAY AGAIN.
   별은 점수 동전·시계와 같은 입체(`index.html` SVG `#st3*`, 선 없음): 받은 별은 두께 띠·그림자·반사가 있는 통통한 금색 별이 하나씩
   돌며 들어가고, 못 받은 자리는 카드에 눌려 들어간 별 모양 홈(안쪽 위 그늘, 아래 밝은 턱).
   리본은 앞의 띠(글자) 뒤로 양끝에 더 진한 꼬리가 조금 아래로 늘어지고 제비꼬리로 끝나며, 띠 아래 모서리에 접힌 자리(진한 삼각형)가
   이어진다(`index.html` SVG `#rbTail`·`#rbFold`). 예전엔 띠 끝을 V자로 바로 잘라 '딱 잘린' 느낌이었다.

**시범 게임(방문 첫 판, phonics-kit 공통 규칙 1)**: START 뒤 라운드 1 전에 장갑 손이 실제 기계로 한 번 해 보인다(`teachDemo`) —
  라운드 1의 음가 안내 → 손이 조이스틱을 잡고 밀어 집게를 그 음가 친구 바로 위로("Move the claw, then press the button!") → DOWN을 누름 →
  진짜 한 판(코인 투입·내려가기·목 잡기·올라오기, 정확히 머리 위라 `AIM.hold` = 반드시 잡힘) → "Yes! You did it!" "/m/ /m/ monkey" →
  친구는 제자리로 떨어져 돌아가고 "Now you try!"(Phonics Puzzle의 `tryit` 음성) → 라운드 1. 시범은 주지도 빼지도 않는다(코인 수 그대로,
  돌려받는 코인·뽑은 친구·MY FRIENDS·기록 없음). 도는 동안엔 SKIP·소리·나가기만 받는다(`demoOnly`). SKIP = 음성·손·집게를 바로 멈추고
  친구·집게·코인을 되돌린 뒤 라운드 1(`skipDemo`, 그 판의 장갑 손 안내는 생략). 같은 방문의 다음 판(PLAY AGAIN, 홈 → START)은 바로 시작(`G.taught`). `?nohint`면 생략.
첫 라운드에 아무것도 안 만지면 장갑 손이 조이스틱 → DOWN 순서로 시범("Move the claw, then press the button!"). 새 판마다(PLAY AGAIN 포함) 다시 나온다.
  시범(안내 음성 + 장갑 손)이 도는 동안에만 오른쪽 아래에 흰 반투명 유리 **SKIP** 알약(phonics-kit 공통 규칙 1). 누르면 안내 음성만 바로 끊고
  (다시 듣기로 튼 목표 음가는 계속), 장갑·조이스틱 흔들기를 멈춘 뒤 그대로 진행 — 집게는 시범 중에도 움직일 수 있다(`skipGuide`, `#app.guide`).
한 번 만진 뒤에는 매 라운드 손을 놓고 8초 동안 아무 입력이 없으면 목표 음가 안내를 다시 들려주고 장갑 손 시범을 한 번 보여 준다.
  기다리는 동안 15초에 한 번까지 되풀이, 아무 입력이나 하면 멈춘다(`idleHelp`, `IDLE = { after: 8, every: 15 }`, `?nohint`면 끔).
음성 재생에는 안전 타이머가 있다: 클립 길이 + 0.8초(길이를 모르면 6초)가 지나면 끝난 것으로 본다 — 끝 신호가 안 와도 게임이 멈추지 않게(`js/audio.js`).
판이 끝나면(결과 화면) 공통 진도 `phonics.progress`에 기록을 남긴다(`js/phonics-progress.js` = phonics-kit 사본):
`PhonicsProgress.played('toy-catch', { stars, level(그 판의 레벨), words(맞힌 친구 = 깬 라운드), rounds, won, score(남은 코인), goes, wrong, misses, outOfCoins, time })`.
  중간에 나가기로 나간 판은 기록하지 않는다.
**레벨**(phonics-kit 공통 규칙: 레벨, 2026-11-22): 고르지 않는다 — START는 저장된 레벨로 이어 하고(`localStorage` `claw-level` `{level, poor}`,
  기계 화면 `LEVEL n`), 별 2개 이상이면 다음 판 +1(결과 카드 별 옆에 `LEVEL UP!` + 새 레벨), 못 하면 같은 레벨, 연속 2판 별 ≤1이면 −1.
  바뀌면 `PhonicsProgress.setLevel('toy-catch', n)`. 표는 `game.js`의 `LEVELS`(행 추가로 확장), 학습 범위(m·a·s·t)는 그대로:
  1 지금 그대로 · 2 집게 1.15배 + 오답 친구 1명 더(6번째 자리도 c/d/f) · 3 1.3배, 코인 7 · 4 공 속 앞줄 친구들이 천천히 좌우로 오감(±0.3, 9초)
  · 5 1.4배, 더 빨리(±0.4, 7초), 코인 6, 확실 구역 안이라도 가운데서 0.12 넘게 벗어나면 조금 미끄러질 수 있음(가장자리 15%)
  · 6 1.5배, ±0.5·5.5초, 코인 5, 0.10부터 25%. DOWN을 누르면 친구들이 멈춘다(조준한 그대로 잡힘), 가운데 잡기는 안 미끄러짐,
  DOWN 반짝임은 미끄러지지 않는 자리에서만. 시범 게임은 늘 레벨 1로 돈다(`LV()`).
EN/한 토글(2026-11-22 공통 규칙): 타이틀 오른쪽 위에만 있다(게임·결과 화면엔 없음). 처음 들어오면 한국어. 바뀌는 것은 안내 음성뿐 —
  화면 글은 두 언어 모두 영어, 음가·단어도 영어. 누르면 그 언어로 "Press start to play!". `localStorage` `claw-lang`, 음소거 `claw-muted`.

## 친구들 (seats 6)
- 정답 친구 `m: monkey, mouse · a: ant · s: seal · t: turkey, turtle`, 오답 친구 `c: cat, cow · d: dog, duck · f: fish`(목표 글자로는 안 나옴).
- 결과 화면: 로고와 같은 하늘색 유리판 카드(금색 테두리, 위쪽 흰 광택), 별 자리에 HUD와 같은 동전 별 3개(얻은 만큼 금화가
  튀어나와 한 번 뒤집힘), 그 아래 금색 숫자 = 남은 코인(카운트업, 박스 없음, 0이면 숨김), 잡은 친구는 HUD와 같은 흰 유리 트레이, PLAY AGAIN은 파란 알약, 홈은 흰 유리 버튼. 제목은 접힌 꼬리 리본(게임의 파랑) 위에 로고식 금색 젤리
  글자(`resultTitle`, 판 없음). 비교용 `?ribbon=pink`(예전 분홍 리본), `?title=rainbow`(무지개 글자).
- **2026-11-19 새 디자인 11종(사용자 360° GIF, `design/turntable/<이름>.gif`, git 제외)**: 친구는 GIF 장면 그대로
  보인다(`js/friends-spin.js`, `tools/spin_frames.py`) — 보는 각도에 맞는 24장 중 한 장을 카메라를 향한 카드로. 게임 그림 =
  GIF 정면 장면(`import_art.py --friends --spin`, 머리 보정 `SPIN_HEAD_FIX`). 집게·그림자·탭용 몸통은 안 보이는 3D
  (`tools/gif3d.py --body`: 24장 실루엣의 교집합). 원숭이 손 흔들기 = 정면 장면에서 SAM으로 자른 팔
  (`design/turntable/monkey/limb_arm_r.png`, `tools/turntable_limb.py`)을 어깨 축으로 돌리고 셔츠를 그 위에 덮음.
  GIF끼리 장면이 안 맞아(반대편 대칭 0.78~0.92) 진짜 3D 재구성은 뭉개져서 쓰지 않음. `?nospin`이면 예전 3D.
  포즈(2026-11-19, 사용자: "옷이랑 같이 … 깨져보이지 않는 모습으로 최대한 모션"): 정면 장면을 촘촘한 격자로 휘게 함
  (`spin_frames.py WARP`, 부위 마스크는 SAM 2 `tools/turntable_parts.py` → `design/turntable/<이름>/part_*.png`).
  부위는 관절을 축으로 돌고, 관절 둘레(소매·귀 뿌리)는 함께 휨(sewn = 가장자리 전체가 붙은 부위). 안 움직이는 곳은
  바닥 레이어(부위를 뺀 정면, 가려진 곳은 채움)라 깨지지 않음. 각 동물 움직임 크기 = `g`. 들어 올리면 그림자 즉시 사라짐.
  **현재 포즈 = 사용자가 그린 모션 6장**(`design/from-front/<이름>/motion/01~06.png`, git 제외): `spin_frames.py
  motion_frames`가 01을 정면 장면에 맞춰(IoU 탐색) 같은 크기·위치로 6장을 아틀라스에 담고, 포즈 중 정면에서만 장면 카드
  대신 끊어서(교차 페이드 없음) 재생. 모션 폴더가 있으면 WARP·팔 레이어는 안 씀. `SPIN_DBG=1`이면 맞춘 결과를
  `~/.cache/agent-scratch/tc/motion_<이름>.png`로.
- 3D 친구 11종(2026-11-18 다시 만듦, 사용자: "360도 회전에도 깔끔하게 뭉게지는 거 없이 매끈하게"):
  - 모양: TripoSG(MIT, 로컬)로 그림 한 장 → 팔·발·날개·부리·모자챙이 따로 나온 형상. 원본 표면의 갈라짐·구멍·등고선 계단은
    복셀로 채운 뒤 다시 뽑아 없앤다(`make_3d.py solidify`, 600칸·블러 1.6 — 400칸·3.2는 뭉툭했다). 꼬리는 시트 옆모습에서 덧붙임(고양이·개·소).
  - **턴어라운드(2026-11-18~, 최우선):** `design/turnaround/<이름>/{front,left,back,right}.png`(사용자가 게임 그림과 같은 포즈로
    만든 4방향, git 제외)이 있으면 옆·뒤 색은 이 그림을 메쉬 외곽선에 맞춰 그대로 입힌다(`bake_turn`). 옆모습 외곽선으로 두께도 맞춘다.
    잘라낸 배경이 팔·다리 사이 틈에 흰색으로 남은 곳, 거북이·물고기의 그려진 눈(새 눈 돔과 겹침)은 텍스처에서 뺀다.
    `left`는 캐릭터의 왼쪽(+x에서 본 모습). 옆모습 친구는 `left`가 게임 그림 쪽, `front`가 머리 쪽. `TC_NO_TURN=1`이면 아래 방식.
  - 색(턴어라운드가 없을 때): 정면은 게임 그림 그대로. 옆·뒤·위·아래는 MV-Adapter(Apache-2.0, SDXL, 로컬)가 **이 형상에 맞춰** 그린 6방향 그림으로
    "어디가 어떤 원단인지"만 정하고, 색은 그림의 원단 색 단색으로 칠한다(`TC_TEX=mvlabel`, 기본). MV 그림이 칙칙하거나 어두운
    곳(그늘·추측)은 버리고 주변 원단이 이어 칠한다. 경계는 매끈한 곡선, 작은 조각은 주변에 흡수. 원단마다 정확히 한 색
    (경계에서 섞지 않음, 사용자: "색이 뭉개지게 넣지말고 영역별 명확한 색"). 입체감은 셰이더의 부드러운 조명(카메라 기준 왼쪽 위,
    그림 부분엔 안 들어감, `?lit=base,gain`)으로만. MV 결과는 실행마다 달라서 깔끔했던 회차를 `MV_PICK`으로 고정(소·개·오리).
  - 다시 만들기: `~/dev/tools/TripoSR/.venv/bin/python tools/make_3d.py --only dog --sheets design/sheets`
    (MV 그림이 캐시에 없으면 `tools/mv_views.py`를 MV-Adapter venv로 불러 만든다, 한 마리 3~12분. 여러 마리는
    `TC_MV_EXPORT=1`로 목록만 만들고 `~/dev/tools/MV-Adapter/.venv/bin/python tools/mv_views.py <out>/jobs.txt --batch`).
  - 확인: `dev/friends3d.html?orbit&kind=duck`(드래그로 아무 방향, 휠 줌) · `?orbit&clay`(형상만) · `?row&held&spin`.
- 1x 모니터에서도 3D 화면을 2배 해상도로 그려(최대 약 950만 픽셀) 친구들·공 외곽선의 계단과 떨림을 없앤다. 시작 3초 뒤 한 번
  GPU를 재서 한 프레임이 14 ms를 넘으면 원래 배율로 돌아간다(`js/stage.js`, `?pr=1`로 배율 강제). 정면 가까이에서는 그림이
  외곽선 끝까지 칠해져 외곽을 따라 보이던 1px 시트색 선이 없다(`js/friends.js`).
- 오리 그림의 발·날개 사이 흰 틈은 주변 색을 조금 어둡게 칠한 틈으로 바꿨고(`tools/sheet_front.py` GAP_MIN), 개미 뒷모습
  시트의 팔·배 사이 흰 틈은 SHEET_DROP으로 뺐다(배 위 흰 줄 제거).
- 집게는 3D 인형의 목(머리 바로 아래 가장 가는 줄, 메쉬에서 자동으로 찾음 — game.js `gripOf`)을 잡는다. 집게 끝이 목을
  살짝 조이고 머리가 집게에 얹혀 매달린다. 옆모습인 거북이는 머리 뒤 등껍질 윗부분, 물고기는 등지느러미 아래 등을 잡는다
  (`GRIP_FIX`). 매달린 인형의 좌우 비틀림은 ±5°.
- 헛집기·튕김·미끄러짐 때 집게가 케이블(`cable` 그룹)에 매달려 1~2초 흔들리다 멈춘다(`claw.wobble`, 게임 진행 시간은 그대로).
- 동작 수정: 앉은 채 고개젓기는 엉덩이 기준 흔들림, 미끄러져 떨어질 때 기울기가 서서히 돌아옴, 배출구로 갈 때 유리벽을 뚫지
  않음, 상품→트레이 전환이 같은 크기·자리에서 이어짐.
- 게임 중 뜨는 GO!와 NO COINS!(`?sec=N`이면 TIME'S UP!도)는 로고식 젤리 글자(`showPrompt`, GO! 노랑 · NO COINS!·TIME'S UP! 분홍, 판 없음, 보이는 크기의
  1.25배로 그림).
- 시그니처 포즈: `js/poses.js` — 친구마다 귀·꼬리·팔·더듬이·지느러미 등 최대 4부위를 그림 비율 좌표로 정의해 셰이더에서
  움직임(그림자도 같이). 집게가 바로 위에 있으면 잔잔한 반복(내려가기 시작하면 멈춤), 상품으로 나올 때 크게 1번, 탭하면 1번,
  대기 중 5~8초마다 랜덤 1명. 확인: `dev/friends3d.html?pose` · `?pose=loop` · `&weights`(부위 색 표시) · `&ang=0,40&zoom=1.6`.
- 코인 = 기회(2026-11-20, 사용자: "코인주고 코인 횟수만큼 진행", 권장안): 시작 8개, 집게를 한 번 내릴 때마다 1개. 내리면 먼저
  큰 금화가 투입구 왼쪽 위로 튀어 올라 돌다가 정면으로 내려와 쏙 들어가고(짤랑, 투입구 테가 빛남, 반짝이, 기계 화면
  `INSERTED! / COINS n`) 그다음 집게가 움직인다(`insertCoin`). 3D 코인 면 = 상단 코인 SVG 그대로(`skinCoin`, 조명·톤매핑 없이 —
  예전 금속 재질은 어두웠다: 사용자 "지금 코인은 너무 어두워"). 상단 코인에서 투입구로 날아가는 방식은 유리·집게를 가로질러
  안 쓴다. 맞히면 1개를 돌려받고(친구에게서 금화가 튀어나와 코인 칸으로), 놓치거나 다른 친구면 더 빼지 않는다. 한 번 한 뒤
  코인이 0이면 `NO COINS!` → 결과(결과의 큰 숫자 = 남은 코인, 0이면 숨김). 라운드 시계는 없앴다(코인 칸은 예전처럼 왼쪽 위 —
  사용자 "코인 위치는 왼쪽이 맞는데"). `?sec=N`이면 예전 시계가 돌아온다(테스트용). 값은 `game.js`의 `COINS`.
- 경품 통(2026-11-20, 사용자: "기계아래로 떨어지고 통에서 주워 올리는 효과"): 기계 아래 몸체 앞면(밝은 판·분홍 띠·받침)에
  노란 테 경품 문(`machine.prizeDoor`: 보라 통, 받침, 위 경첩 투명 덮개, 통 조명). 맞힌 친구가 구멍에 들어가면 카메라가 문으로
  내려가고(`doorShot`), 친구가 통에 툭 떨어져 덮개가 흔들린 뒤 덮개가 열리고, 친구가 앞으로 나와(선반 밑으로) 위로 올라가
  상품 자리로 오는 동안 카메라가 돌아간다(`prize(p, tok, true)`, 착지점은 `S.baseCam()` 기준). 카메라는 장면이 바뀔 때만
  움직인다(시작 코인·경품 통·상품) — 조준 중엔 고정. 샷 동안 양옆 글자 코인·음표·로고는 숨김(`#app.shot`).
- 동전 모션(`game.js` coinsIn · insertCoin, 그림은 상단 코인 SVG 그대로): 들어올 때는 금화가 날아와 코인 칸 동전에 하나씩 들어가고
  들어갈 때마다 숫자가 올라간다(시작 +8은 화면 위에서 쏟아짐, 정답 +1은 잡힌 친구에게서 튀어나와 날아감, 꽃가루 위에 그림).
  한 번 할 때마다 숫자가 1 줄고 큰 3D 코인이 투입구로 들어간다(위 '코인 = 기회'). 숫자 밑에 +8 / +1 / −1 태그. 움직임 줄이기 설정이면 금화 없이 숫자만 바뀐다.
- 로딩 바(`css #loading`, `game.js setBar`): 로고 판과 같은 하늘색 유리 판(밑의 주황 두께 띠는 뺐다), 판에 파인 홈을 무지개 젤리(로고 글자색,
  위 광택·아래 그늘, 사탕 줄무늬가 흐름)가 채우고, 끝에 상단 점수 동전이 굴러가며 따라간다(별이 이동 거리만큼 회전). 선 없음.
- 3D 친구들은 기계 유리의 흰 막 때문에 뿌옇게 보여서 채도 ×1.22, 대비 ×1.04를 화면 색 단계에서 올린다(`friends.js` SAT).
  비교용 `?sat=1`(이전), `?sat=1.35`(더 진하게).
- 오리(duck)는 따로 그린 게임 그림이 없어서 오리 캐릭터 시트의 정면을 잘라 쓴다: `tools/sheet_front.py duck`(시트 정면 →
  로컬 Real-ESRGAN ×4 업스케일 → 흰 배경 제거 → `design/art/duck_front.png`, git 밖) → `tools/import_art.py --friends --only duck`
  → `make_3d.py --only duck`. 단어 음성은 FPR K `w_duck`(Phonics Match).
  p로 시작하는 그림이 없어 p 라운드는 뺐다(사용자 결정).
- 매 판 6마리: m·a·s·t 한 마리씩 + 2마리(그중 최소 1마리는 c/d/f, 나머지는 남은 아무나). 뒷줄 3(선반) + 앞줄 3(볼풀) 지그재그라 글자 6개가 모두 보인다.
- 그림은 `js/friends.js`가 카메라를 늘 바라보는 컷아웃으로 세운다(가장자리는 alpha-to-coverage — 유리와 정렬 문제 없음).
- **친구들은 진짜 3D 인형**(`js/friends-3d.js`, `tools/make_3d.py`): 이 맥에서 TripoSR(MIT, 그림 한 장 → 3D, 외부 전송 없음)이
  그림마다 앞·옆·뒤가 있는 모양과 뒤쪽 색을 추정하고, 앞에서 보이는 면에는 사용자 그림을 그대로 입힌다(정점마다 '앞면 가중치').
  그래서 얼굴·글자는 원래 그림 그대로이고 몸통에 실제 옆과 뒤가 있다. 모양은 그림 외곽에 정확히 맞추고(가로·세로), 두께는 추정값의 92 %,
  6000 삼각형으로 줄이고, 뒤쪽 색은 앞면에서 그림과 비교해 밝기·대비를 맞춘다(소의 흰 등이 회색으로 나왔었다).
  움직임(`plushDeform`, 정점 셰이더 — 그림자도 같이): 통통 뛸 때는 모양 그대로(선택됐을 때 뛸 때마다 위아래로 줄었다 늘었다 하는 건
  어색하다고 해서 뺐다), 집혀 올라갈 때 늘었다가 출렁,
  떨어져 앉을 때 납작, 밀리거나 들려 갈 때 윗부분(매달리면 다리)이 늦게 따라옴, 집게가 쥔 머리 둘레가 살짝 눌림. 상품으로 나올 때 한 바퀴 돈다.
  집게는 3D 몸의 실제 폭을 감싼다(`P.widthAt`): 머리보다 몸이 큰 물고기는 몸통 폭으로, 머리가 옆으로 튀어나온 거북이는 등딱지 윗부분을 잡고,
  집게보다 살짝 넓은 몸은 집게 자리만 눌린다(프롱이 몸 안으로 사라지지 않게).
  다시 만들기: `~/dev/tools/TripoSR/.venv/bin/python tools/make_3d.py [--only monkey]`(설치는 아래 '실행 · 도구').
  비교용 `?puff`(예전 부풀린 그림) · `?flat`(평면 그림), `dev/friends3d.html`(친구마다 앞·3/4·옆·뒤).
  집게가 감쌀 머리 타원은 `tools/import_art.py`가 알파에서 잰다(윗부분 가장 넓은 줄 → 그 아래 가장 좁은 줄 = 목).
  옆모습(거북·물고기)과 몸통·머리가 한 덩어리인 물개, 꼬리깃이 넓은 칠면조는 `HEAD_FIX`로 지정. `--check out.png`로 타원을 그려 확인.
- 탭은 그림의 투명한 모서리가 아니라 그림 자체를 눌렀을 때만 그 친구로 간다(64px 알파 격자).

## 소리
- 음가 7개(m a s t + 오답용 c d f) + 단어 11개: **공식 녹음**(Phonics Match에서 다듬어진 것 — monkey·mouse는 lesson pack FP.K.U1L1 녹음, turkey는 Phonics Island의 FPR K Unit 1 Lesson 4 파일).
- 안내 문장: phonics-api TTS의 `en-US-AvaMultilingualNeural`을 예전 `aiden`의 높이·빠르기로 맞춘 파닉스 공통 튜터 목소리(`js/voice.js`의 `engine`·`voice`·`shape`).
  공용 문장은 Magic Block·Croco Phonics 것을 재사용, 새 문장 9개 × (영/한)은 `tools/build_voice.py`가 생성 — 테이크마다 whisper로 다시 들어 보고 다르게 들리면 다시 만든다(phonics-kit `tutor_takes.py`). `--engine qwen`은 예전 사내 TTS `aiden`.
- 효과음(모터, 집게, 동전, 배출구, 팡파르)은 `js/audio.js`에서 합성. 배경음악은 `tools/make_bgm.py`의 8비트 오락실 루프(2026-11-22, E장조 150 BPM 16마디 = 25.6초:
  펄스파 멜로디 · 빠른 화음 아르페지오 · 삼각파 베이스 · 노이즈 드럼, 4·12마디 끝에 '집게 내려가는' 소리). 악기·믹스는 phonics-kit `bgm_engine.py`, 모두 합성(샘플 없음). 음성이 나오는 동안은 작게.

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
  흰 테두리는 단어 전체를 감싸는 한 덩어리(모든 글자를 굵게 그린 마스크를 흐리게 한 뒤 반에서 잘라 글자 사이 홈을 둥글게 메움 —
  글자별 테두리는 V자 홈으로 만나 조각나 보였다)이고 가만히 있다. 글자는 굵기가 차례로 굵어졌다 돌아오는 물결(미리 그린 6단계
  굵기를 바꿔 끼움: 첫 단계는 바로, 나머지는 타이틀이 뜬 뒤 프레임마다 조금씩).
  판 윗면과 글자는 CSS perspective 하나(`.tilt`, 판 앞 모서리를 축으로 rotateX 30° + scaleY 보정)로 함께 기울어 위가 좁다 —
  그래서 판 윗면은 기울기 전 직사각형으로 그린다. 흰 테두리 5개는 모든 글자 아래에 깔아 하나로 이어지고,
  글자는 차례로 부풀었다 줄어드는 물결(`startWave`)로 계속 돈다.
- 자리 맞춤(game.js `setupPlushes`): 왼쪽 앞자리는 배출구 옆, 양 끝 자리는 유리벽 옆 — 그림 폭(`P.span`)이 넘치는 친구(거북이·물고기 등)는
  맞는 자리의 친구와 자리를 바꾸고, 안 되면 넘친 만큼만 안쪽으로 옮긴다(자리 위치 자체는 그대로).
- 조이스틱 안내: ◀ ▶ 화살표 대신 안내 손이 끄는 대로 3D 조이스틱이 실제로 좌우로 기울고 손잡이가 은은하게 빛난다(기본 `wiggle`).
  비교용 `?joyhint=ring`(손잡이 둘레로 퍼지는 빛 고리)·`?joyhint=ghost`(손잡이 잔상이 양옆으로).
- 볼풀 공: 장면 조명을 받는 광택 캔디 공(MeshStandard, 클리어코트 없음 — 클리어코트는 가장자리에서 빈 환경을 비춰 어두운 테두리가 생겼다; 가장자리에 빛이 비치는 젤리 느낌과 옅은 자체 발광으로 그늘도 캔디색), 채도를 올린 캔디색, 44×30 분할. 움직임은 정점
  셰이더에서(`machine.balls.splash(x, z, s)` — 집게가 볼풀에 들어갈 때·인형을 들어 올릴 때·인형이 떨어져 앉을 때 주변 공이
  고리 모양으로 퍼지며 통통 튐, `machine.balls.friends(list, t)` — 볼풀에 앉은 친구가 통통 뛸 때마다 발밑 공이 같이 튐: 흥분한 뜀·환호 뜀 모두, 멀수록 조금 늦게). 그림자 패스도 같은 움직임.
- 패널의 작은 화면·조이스틱·동그란 버튼은 가운데(START / DOWN)에서 넉넉히 떨어뜨려 놓았다 — 지우지 말고 간격만(사용자 요청).
  동전 투입 중 #app 상태 클래스는 `inserting` — `coin`은 인트로 동전의 클래스라 앱 전체가 동전 크기로 줄어들었다.
- DOWN 버튼은 패널 위 3D 버튼(`machine.js` `setDown`/`pressDown`/`downRim`): 다른 버튼과 같은 각도, 크기는 크게.
- 패널의 버튼·조이스틱·DOWN은 `M.candy`(mats.js): 클리어코트 없이 가장자리에 은은한 빛 — 클리어코트가 가장자리에서 어두운 방을 비춰
  버튼마다 어두운 테두리가 생기고 1배 화면에서 우글거렸다(사용자 지적). 둥근 부품은 64~96분할, 조이스틱 받침은 시안처럼 회색 돔(검은 금속 아님).
  화살표 그림은 비스듬히(36°) 투영해 보이는 돔 가운데에 온다. 탭은 그 위 투명 `#drop`(game.js `layout()`이 화면 위치를 잰다).
- 배경 위 떠다니는 글자 방울·음표·반짝이는 HTML(기계 기준 좌표 `--x/--y`, 기계 단위 `--mu`).
- 상단 점수 아이콘은 별이 올라온 금색 동전(배출구에 넣는 동전과 같은 모양, `index.html`의 SVG): 선 없이 빛과 그늘로만 테두리·면을 나누고
  별 밑에 부드러운 그림자. 알약 끝과 같은 원 중심. 가끔 빛이 한 번 스치고, 점수가 오르면 두 바퀴 휙 돈다. 클래스는 `.score-coin`
  (`.coin`은 인트로 동전 클래스).
- 상단 목표 글자(Mm·Aa·Ss·Tt)는 로고와 같은 젤리 글자(`game.js jellyWord`, 캔버스): 금색 얇은 테두리, 같은 색 진한 옆면, 얇은 테두리 경사,
  위쪽 절반이 밝은 두 톤 면, 아래 안쪽 빛, 왼쪽 위 흰 반사와 점, 로고처럼 옅은 하늘색 유리판(금색 가장자리) 위. 색은 로고 글자색에서
  m 보라 · a 초록(로고의 A) · s 주황 · t 분홍(로고의 T). 획을 너무 굵히면 a·s 구멍이 막혀 '8'처럼 보여서 굵기는 그 직전까지만.
  상단 알약 안에서는 유리판 없이 글자가 파란 알약 위에 바로 서고(알약 안의 옅은 판이 따로 논다고 해서 뺌), 스피커 버튼도 같은 젤리
  (같은 색·금색 선·옆면·두 톤·흰 점, 누르면 쑥 들어감) — `jellyWord(text, pal, { plate: false })`, 버튼 색은 `--j*` 변수.
- 상단 상자 높이는 하나(`--hb` = 7.6u): 점수·잡은 친구 칸·시간·소리·나가기·EN/한이 모두 같은 높이이고 안의 동전·칸·글자·시계는 그 비율.
  가운데 목표 글자 알약과 스피커만 크게 둔다(사용자 요청). 바꿀 땐 `--hb` 하나만.
- 시간 아이콘 스톱워치(`?sec=N`일 때만 보임)도 점수 동전과 같은 입체(`index.html` SVG, id `sw*`): 선 없이 그라데이션 케이스 + 아래 두께 띠, 우물처럼 들어간 문자판,
  원통 같은 용두·옆 버튼, 바늘 그림자(그림자는 바늘을 감싼 그룹의 필터라 바늘이 돌아도 늘 오른쪽 아래), 유리 반사. `#watchHand`는 game.js가 (32, 36) 중심으로 돌린다.

## 실행 · 도구
```sh
python3 tools/serve.py 5231                    # http://127.0.0.1:5231/  (그냥 index.html 열어도 됨)
/Users/jini/.hermes/bin/uv run --with pillow --with numpy --with scipy python tools/import_art.py   # 배경·로고·친구 10
/Users/jini/.local/bin/uv run --with numpy python tools/build_voice.py
/Users/jini/.local/bin/uv run --with numpy --with scipy --with pyloudnorm python tools/make_bgm.py
```
URL 옵션: `?sec=10`(라운드 시계를 다시 켬, 테스트용) · `?order=m,a,s,t` · `?kinds=cat,seal,ant,turtle,monkey,dog`(뒷줄 3 → 앞줄 3, 자리 고정) · `?nohint`.

3D 인형 다시 만들기 — 형상 TripoSG(`~/dev/tools/TripoSG`, 자체 venv, `tools/tsg_mesh.py`), 색 배치 MV-Adapter
(`~/dev/tools/MV-Adapter`, 자체 venv: torch · diffusers 0.32.2 · transformers 4.48.3 · peft 0.14 · trimesh, 가중치 SDXL fp16 +
sdxl-vae-fp16-fix + mvadapter_ig2mv_sdxl 약 10 GB, CUDA 렌더러 대신 `mv_views.py`가 위치·법선 지도를 직접 그림).
예전 TripoSR 설치(약 3 GB: torch + TripoSR 가중치 1.7 GB, `--shape tsr`):
```sh
git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git ~/dev/tools/TripoSR && cd ~/dev/tools/TripoSR
uv venv -p 3.11 .venv && uv pip install --python .venv/bin/python torch "numpy<2" omegaconf==2.3.0 Pillow einops==0.7.0 \
  transformers==4.35.0 "huggingface-hub<0.26" trimesh PyMCubes fast-simplification scipy rtree
# 맥 패치 2개: tsr/models/isosurface.py — torchmcubes 대신 PyMCubes(정점 순서 v[:, [2, 1, 0]]),
#             tsr/utils.py — imageio·rembg import를 try/except(그림 → 메쉬에는 필요 없음)
.venv/bin/python ~/Documents/Jini/2026/Phonics/Toy-Catch/tools/make_3d.py    # 10마리 약 1분(MPS), 원본 메쉬는 out/<kind>.npz에 캐시
```

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
