/* Toy Catch (phonics claw machine) — game flow.
 * Title (logo, START) → coin goes in ("INSERTED! READY TO PLAY!") → (the first game of a visit: the glove plays one go
 * first — teachDemo) → 4 rounds, one per sound m a s t in random order:
 * "Catch a friend that starts with /m/" → move the claw (joystick, drag, tap a plush, ← →) → DOWN → the claw drops,
 * grabs the plush under it and lifts it. Right sound: confetti, the others cheer, "/m/ /m/ monkey", it goes down the
 * chute and pops out as a prize. Wrong sound: "Uh-oh! turtle. It starts with /t/", it slips back. No round clock:
 * coins are the goes (COINS — 8 to start, one per go, one back for the right friend; none left → NO COINS!).
 * → result (stars, caught friends, coins left, Play again / Home).
 */
(function () {
  'use strict';
  const S = Stage, A = Sound, T = THREE;
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const qs = new URLSearchParams(location.search);
  // how the joystick hint looks (being chosen with the user): 'wiggle' the stick moves with the hint glove's drag and its
  // knob glows · 'ring' soft rings ripple out round the knob · 'ghost' see-through knobs slide off to both sides
  const JOY_HINT = ['wiggle', 'ring', 'ghost'].includes(qs.get('joyhint')) ? qs.get('joyhint') : 'wiggle';
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const lerp = (a, b, k) => a + (b - a) * k;
  const LETTERS = ['m', 'a', 's', 't'];
  const POOL = { m: ['monkey', 'mouse'], a: ['ant'], s: ['seal'], t: ['turkey', 'turtle'] };
  const OTHERS = ['cat', 'cow', 'dog', 'duck', 'fish'];  // c d f: never a target, always a wrong answer
  const ROUND_SEC = +(qs.get('sec') || 45);
  const PS = 1.3;                                       // plush scale in the machine
  /* aiming: how far (machine units, along x) the claw is from the middle of the friend's head when it comes down.
     ≤ hold: a sure catch · ≤ weak: a loose grip that may slip out on the way up · ≤ reach: a prong knocks the friend,
     nothing caught · further: nothing under the claw. Two misses in a row in a round and a loose grip holds. */
  const AIM = { hold: 0.2, weak: 0.4, reach: 0.62 };
  /* coins = goes (user: "코인주고 코인 횟수만큼 진행", the recommended rules): you get COINS.start coins, every go of the claw
     takes one — it goes into the machine's slot by the DOWN button, big, before the claw moves — the right friend gives
     COINS.win back (it flies out of the friend into your coins), a miss or the wrong friend costs nothing more. No coins
     left after a go: the game ends (NO COINS! → results). No round clock any more (?sec=N brings it back, for tests). */
  const COINS = { start: 8, win: 1 };
  const TIMER = qs.has('sec');
  const IDLE = { after: 8, every: 15 }, NOHINT = qs.has('nohint');   // the idle help (idleHelp): s of nothing, s between
  const G = {
    screen: 'title', all: {}, inMachine: [], targets: [], round: -1, target: null, score: 0, caught: [], tries: 0,
    time: ROUND_SEC, timerOn: false, busy: true, tok: 0, aimX: 0, joy: 0, keys: { l: 0, r: 0 }, idle: 0, interacted: false,
    icons: {}, shownSec: -1, miss: 0, rand: Math.random,
    stats: null,                                        // this game's counts for the shared progress record (saveProgress)
    taught: false, demo: null,                          // the how-to demo: shown this visit · running ({ seats }) (teachDemo)
  };
  let machine, claw, spot, burst;
  window.__claw = G;

  /* ── boot ───────────────────────────────────────────────────────────────────────────────────────── */
  async function boot() {
    // the loading bar (css #loading): the jelly grows and the coin on its end rolls the distance it moves
    const bar = $('#loading .bar i'), coin = bar.querySelector('.load-coin'), rolls = bar.querySelectorAll('.roll');
    const setBar = pct => {
      bar.style.width = pct + '%';
      const run = bar.parentElement.clientWidth * pct / 100, d = coin ? coin.getBoundingClientRect().width : 0;
      if (d) rolls.forEach(r => (r.style.transform = `rotate(${(run / (Math.PI * d) * 360).toFixed(1)}deg)`));
    };
    window.__loadBar = setBar;                          // (QA: the loading screen's bar at any point)
    try { await Promise.race([document.fonts.load('800 100px "Baloo 2"'), A.sleep(2500)]); } catch (e) { /* fallback font */ }
    setBar(30);
    buildStart();
    S.init($('#stage'), { preserve: qs.has('preserve') });
    app.classList.toggle('timer', TIMER);               // (the round clock only with ?sec=N)
    machine = Machine.build(); claw = machine.claw;
    S.machine = machine; S.scene.add(machine.group);
    FX.init($('#fx'));
    setBar(55);
    await A.sleep(20);
    await Friends.load();
    for (const k of Friends.KINDS) { G.all[k] = Friends.build(k); G.icons[k] = G.all[k].icon; }
    setBar(85);
    spot = makeSpot(); machine.group.add(spot.group);
    skinCoin();
    burst = makeBurst(); S.scene.add(burst);
    S.onResize = layout;
    S.resize();
    setupPlushes();
    buildTray();
    S.onTick.push(tick);
    S.start();
    bindInput();
    await A.sleep(60);
    setBar(100);
    await A.sleep(250);
    app.classList.remove('booting');
    G.busy = false;
    window.__ready = true;
  }

  /* the 3D coin (START and every go) = the HUD coin (user: "코인은 이 코인으로 만들어 넣어줘", "지금 코인은 너무 어두워"):
     its faces are the HUD coin's SVG (rim, recessed face, raised star, gloss — without its painted edge band, the 3D coin
     has a real one), drawn unlit and not tone-mapped so it's as bright as the HUD's; the edge in the SVG's edge gold. */
  function skinCoin() {
    const svg = $('.score .score-coin svg').cloneNode(true);
    svg.querySelector('circle').remove();                // (the first circle = the painted edge band under the coin)
    svg.setAttribute('viewBox', '5 5 90 90'); svg.setAttribute('width', 256); svg.setAttribute('height', 256);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      c.getContext('2d').drawImage(img, 0, 0, 256, 256);
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
      tex.center.set(0.5, 0.5); tex.rotation = COIN_ROT;   // (a cylinder cap's uv runs round the axis: turn it upright)
      const face = new T.MeshBasicMaterial({ map: tex, toneMapped: false });
      const edge = new T.MeshBasicMaterial({ color: '#f0a51a', toneMapped: false });
      machine.coin.material = [edge, face, face];
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  }
  const COIN_ROT = +(qs.get('coinrot') || -Math.PI / 2);
  /* the soft guide light from the claw down to the plush it would grab */
  /* the selection light: it comes out of the round lamp on the claw's trolley (the yellow circle on the purple box above
     the claw) and spreads down onto the friend under the claw (user: "집게 위에 가운데 원 거기서부터 나오게 해서 퍼지게") —
     a soft cone (only its far half shows, so it never fogs the claw or the friend; its sides fade), the lamp glowing, a
     real spotlight making a pool on the balls, and the friend lit from above (friends.js lit()). It falls where the
     claw would go down: right over the friend it's bright, a little off it's dim. */
  function makeSpot() {
    const group = new T.Group();
    const light = new T.SpotLight('#fff1d8', 0, 10, 0.3, 0.9, 1.2);
    group.add(light, light.target);
    const tex = Mats.tex(8, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.8)');
      gr.addColorStop(0.85, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    // (normal blending: a coloured light has to show on the machine's pale back wall, where additive light vanished)
    const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: T.BackSide, opacity: 0, toneMapped: false });
    const U = { uTime: { value: 0 }, uCol: { value: new T.Color('#ff4fa3') } };
    mat.onBeforeCompile = (sh) => {           // fades as the wall turns side-on to the camera: soft sides, no outline
      sh.uniforms.uTime = U.uTime; sh.uniforms.uCol = U.uCol;
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vFace;\nvarying vec2 vRing;\nvoid main() {\n  vRing = position.xz;\n  { vec4 mvp = modelViewMatrix * vec4(position, 1.0); vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mvp.xyz))); }');
      // a stage light (user: "선택됐을때 좀더 화려한 조명", "무대 조명처럼 여러색이 번갈아서 번쩍번쩍"): the whole beam in one
      // candy colour at a time (no white inside — "빛이 안에가 흰색이면 안될거 같은데"), flashing as it changes (uCol
      // carries the flash); soft shafts sweep round it for texture (the angle from the interpolated ring position, not
      // a per-vertex angle — that would jump across the ±π seam)
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vFace;\nvarying vec2 vRing;\nuniform float uTime;\nuniform vec3 uCol;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
  float ang = atan(vRing.y, vRing.x);
  float s1 = pow(0.5 + 0.5 * sin(ang * 6.0 + uTime * 1.3), 3.0);
  float s2 = pow(0.5 + 0.5 * sin(ang * 12.0 - uTime * 2.1 + 1.7), 6.0);
  diffuseColor.rgb = uCol * (0.92 + 0.2 * s1);
  diffuseColor.a = min(1.0, diffuseColor.a * vFace * (0.8 + 0.55 * s1 + 0.35 * s2));`);
    };
    const geo = new T.CylinderGeometry(0.08, 1, 1, 48, 1, true); geo.translate(0, -0.5, 0);   // top at 0, 1 long, downward
    const cone = new T.Mesh(geo, mat); cone.renderOrder = 5; cone.raycast = () => {};
    group.add(cone);
    // its near half shows only up top, so the light is seen coming OUT of the lamp, in front of the cord and the hub;
    // it fades out before the prongs and the friend
    const texN = Mats.tex(8, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,244,214,0.62)'); gr.addColorStop(0.14, 'rgba(255,244,214,0.26)'); gr.addColorStop(0.32, 'rgba(255,244,214,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const matN = mat.clone(); matN.map = texN; matN.side = T.FrontSide; matN.onBeforeCompile = mat.onBeforeCompile;
    const coneN = new T.Mesh(geo, matN); coneN.renderOrder = 6; coneN.raycast = () => {};
    cone.add(coneN);
    // the lamp lights up: brighter, with a soft flare on it
    const flareTex = Mats.tex(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.3, 'rgba(255,236,170,0.55)'); gr.addColorStop(1, 'rgba(255,230,160,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const flare = new T.Sprite(new T.SpriteMaterial({ map: flareTex, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, opacity: 0, toneMapped: false }));
    flare.renderOrder = 12; group.add(flare);
    // glitter: sparkles in the light's colour drifting down the beam and circling the friend's feet (never over a friend).
    // The star is filled with its own colour, a little lighter than the glow round it — no white in it (user: "하얀색 별에
    // 테두리를 같은 테두리 컬러로 채우면 안돼? 테두리보다 조금 밝은 컬러로 … 흰색이 어색해!"; an additive white core
    // made it a white star with a coloured edge). The texture is grey-scale: the vertex colour paints it.
    const sparkTex = Mats.tex(64, 64, (g, w, h) => {
      const c = w / 2, glow = g.createRadialGradient(c, c, 0, c, c, c);
      glow.addColorStop(0, 'rgba(205,205,205,0.75)'); glow.addColorStop(0.3, 'rgba(205,205,205,0.3)'); glow.addColorStop(1, 'rgba(205,205,205,0)');
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff'; g.beginPath();                            // a plump four-point sparkle, filled
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, b = a + Math.PI / 4;
        g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * c * 0.82, c + Math.sin(a) * c * 0.82);
        g.quadraticCurveTo(c + Math.cos(b) * c * 0.1, c + Math.sin(b) * c * 0.1, c + Math.cos(a + Math.PI / 2) * c * 0.82, c + Math.sin(a + Math.PI / 2) * c * 0.82);
      }
      g.fill();
    });
    const PAL = ['#ffd23f', '#ff6fb5', '#4fc3ff', '#b07cff', '#5ee0a0', '#ff9a3c'].map(h => new T.Color(h));
    const NB = 30, NR = 10, NS = NB + NR;
    const spPos = new T.BufferAttribute(new Float32Array(NS * 3), 3), spCol = new Float32Array(NS * 4);
    const spGeo = new T.BufferGeometry();
    spGeo.setAttribute('position', spPos); spGeo.setAttribute('color', new T.BufferAttribute(spCol, 4));
    const spMat = new T.PointsMaterial({ map: sparkTex, size: 1.0, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
    const sparks = new T.Points(spGeo, spMat);
    sparks.frustumCulled = false; sparks.raycast = () => {}; group.add(sparks); sparks.renderOrder = 7;
    const light2 = new T.Color();                         // (the star's fill: the light's colour, a little lighter)
    const SP = Array.from({ length: NS }, (_, i) => ({ a: Math.random() * 6.283, rf: 0.15 + 0.85 * Math.sqrt(Math.random()),
      ph: Math.random(), sp: 0.16 + 0.14 * Math.random(), tw: Math.random() * 6.283, c: PAL[i % PAL.length] }));
    // a soft pool of light round the friend's feet
    const poolTex = Mats.tex(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,240,200,0.9)'); gr.addColorStop(0.5, 'rgba(255,232,180,0.4)'); gr.addColorStop(1, 'rgba(255,230,170,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const pool = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.renderOrder = 4; pool.raycast = () => {}; group.add(pool);
    const lampMat = machine.lamp.material, lampE = lampMat.emissiveIntensity, lampC = lampMat.emissive.clone();
    // the stage colours, in turn: each change is a flash that settles (STEP s each)
    const STAGE = ['#ff4fa3', '#ffd21f', '#3fb8ff', '#a86bff', '#3fe0a0', '#ff8a2a'].map(h => new T.Color(h)), STEP = 0.42;
    const col = new T.Color(), white = new T.Color('#ffffff'), rects = [], wq = V(0, 0, 0);
    const src = V(0, 0, 0), dst = V(0, 0, 0), dir = V(0, 0, 0), DOWN = V(0, -1, 0), eu = V(0, 0, 0), ew = V(0, 0, 0), q = V(0, 0, 0);
    let k = 0, lit = null, time = 0, len = 1, rr = 1;
    return {
      group,
      /* at = { x, z, floorY, r, level 0..1, friend } or null */
      update(dt, at) {
        k = lerp(k, at ? at.level : 0, Math.min(1, dt * (at ? 6 : 9)));
        time += dt; U.uTime.value = time;
        const step = Math.floor(time / STEP), f = (time % STEP) / STEP, flash = 0.5 + 0.5 * Math.exp(-f * 6);
        col.copy(STAGE[step % STAGE.length]); U.uCol.value.copy(col);
        machine.lamp.getWorldPosition(src); group.worldToLocal(src);
        flare.position.copy(src);
        if (at) {
          dst.set(at.x, at.floorY, at.z); rr = at.r;
          dir.subVectors(dst, src); len = dir.length(); dir.divideScalar(len);
          cone.position.copy(src); cone.quaternion.setFromUnitVectors(DOWN, dir); cone.scale.set(at.r, len, at.r);
          light.position.copy(src); light.target.position.copy(dst); light.angle = Math.atan(at.r / len);
          if (lit !== at.friend) { if (lit) lit.lit(0); lit = at.friend; }
          pool.position.set(dst.x, dst.y + 0.04, dst.z); pool.scale.setScalar(at.r * 0.95);
        }
        const tune = G.spotTune || {};                       // (QA: __claw.spotTune = { I, cone, lit, flare, glit })
        if (lit) lit.lit(at ? Math.min(1.5, k * (tune.lit ?? 1.2)) : 0);
        if (!at && k < 0.02 && lit) { lit.lit(0); lit = null; }
        light.intensity = (tune.I ?? 30) * k * flash; light.color.copy(col).lerp(white, 0.35);
        mat.opacity = matN.opacity = (tune.cone ?? 0.85) * k * flash;
        cone.visible = mat.opacity > 0.003;
        // the lamp pulses a little while it shines
        flare.material.opacity = (tune.flare ?? 0.6) * k; flare.scale.setScalar(0.2 + 0.035 * k * (0.5 + 0.5 * Math.sin(time * 5)));
        flare.visible = flare.material.opacity > 0.003;
        lampMat.emissiveIntensity = lampE + 2.4 * k * flash;
        lampMat.emissive.copy(lampC).lerp(col, Math.min(1, k * 1.5));     // the lamp shines in the light's colour too
        pool.material.opacity = 0.6 * k * flash; pool.material.color.copy(col).lerp(white, 0.3);
        pool.visible = pool.material.opacity > 0.003;
        // glitter: the full show only right over the friend (k ≈ 1); a little off, only a few faint ones
        const gk = Math.max(0, (k - 0.25) / 0.75) * (tune.glit ?? 1);
        spMat.opacity = Math.min(1, gk * 1.2); sparks.visible = spMat.opacity > 0.01;
        light2.copy(col).lerp(white, 0.32);
        if (sparks.visible) {
          eu.crossVectors(dir, V(0, 0, 1)).normalize(); ew.crossVectors(eu, dir).normalize();
          // every friend's box on screen: no glitter over any friend (the beam to a front-row friend passes the back row)
          rects.length = 0;
          for (const p of G.inMachine) {
            const r0 = p.root.position, hw = p.width * p.root.scale.x / 2, top = r0.y + p.top * p.root.scale.y;
            const A = S.project(group.localToWorld(wq.set(r0.x - hw, top, r0.z))), B = S.project(group.localToWorld(wq.set(r0.x + hw, r0.y, r0.z)));
            rects.push([(A.x + B.x) / 2, (B.x - A.x) / 2, A.y, B.y]);
          }
          for (let i = 0; i < NS; i++) {
            const s = SP[i], tw = Math.pow(0.5 + 0.5 * Math.sin(time * 6.5 + s.tw), 2.5);
            let fade;
            if (i < NB) {                                    // down the beam's sides and back
              const t = (s.ph + time * s.sp) % 1, along = 0.1 + 0.78 * t;
              const a = s.a + 0.5 * time * (i % 2 ? 1 : -1), rad = lerp(0.08, 1, along) * rr * s.rf;
              q.copy(src).addScaledVector(dir, len * along).addScaledVector(eu, Math.cos(a) * rad).addScaledVector(ew, Math.sin(a) * rad);
              fade = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.25);

            } else {                                         // circling the feet
              const a = (i - NB) / NR * 6.283 + time * 0.9, rad = rr * 0.78;
              q.set(dst.x + Math.cos(a) * rad, dst.y + 0.12 + 0.05 * Math.sin(time * 3 + i), dst.z + Math.sin(a) * rad * 0.8);
              fade = 1;
            }
            spPos.setXYZ(i, q.x, q.y, q.z);
            const sp = S.project(group.localToWorld(wq.copy(q)));
            for (const r of rects) {                         // fades out over a friend (a little margin round its box)
              const dx = Math.abs(sp.x - r[0]) / r[1];
              if (sp.y > r[2] - 0.15 * r[1] && sp.y < r[3]) fade *= Math.min(1, Math.max(0, (dx - 0.9) / 0.3));
            }
            const b = (0.25 + 0.75 * tw) * fade;
            spCol[i * 4] = light2.r; spCol[i * 4 + 1] = light2.g; spCol[i * 4 + 2] = light2.b; spCol[i * 4 + 3] = b;
          }
          spPos.needsUpdate = true; spGeo.attributes.color.needsUpdate = true;
        }
      },
    };
  }

  /* letters in the LOGO's jelly style (user: "상단에 스펠링 부분은 로고와 같은형태로"; assets/img/logo.webp): each letter a
     glossy candy jelly — a thin gold line round the whole letter, a deep same-colour side under it, a darker bevel round
     the face, the face lighter in its top half (a soft curved edge, like the logo's), a light glow inside the bottom edge,
     a crisp white shine along the top-left edges and a white spot — all on the logo's pale-cyan glass plate with its own
     gold edge. Drawn once per word into a canvas (soft edges with shadowBlur, not ctx.filter: older iPad Safari). */
  const JELLY = {                                        // the logo's letter colours: face top / mid / low, bevel, side, side dark, glow
    pink:   ['#ff7aa6', '#fb4479', '#f2265b', '#e41f56', '#c9134a', '#9c0b35', '#ffb0c8'],
    green:  ['#c4ef74', '#9fe158', '#74cc40', '#52b532', '#3f9e26', '#2a7d1b', '#dff86a'],
    orange: ['#ffcf72', '#ffaa3c', '#ff9320', '#f47f12', '#d9650a', '#ad4c05', '#ffe07a'],
    purple: ['#dc96fc', '#c35ff7', '#ad47ef', '#9a3be0', '#7c27c6', '#5c169f', '#ecb8ff'],
    yellow: ['#fff28a', '#ffdf2e', '#ffcd14', '#f4b30a', '#df9804', '#a96f02', '#fffbae'],   // (the logo's Y)
    blue:   ['#97e4ff', '#66cbf9', '#45b2f3', '#2f98e4', '#2383d1', '#13589e', '#94ecff'],   // (the logo's first C)
  };
  const LETTER_JELLY = { m: 'purple', a: 'green', s: 'orange', t: 'pink' };
  const RAINBOW = ['pink', 'orange', 'yellow', 'green', 'blue', 'purple'];   // the logo's / START's order, letter by letter
  /* opts: plate (false: no plate — the letters stand straight on their pill, HUD) · F (font px, default 220: the
     canvas resolution) or H (the canvas height in px: F to fit it). pal: one palette, or a list of palettes the letters
     take in turn (spaces take none). Draw it at about the size it shows (× 1.25): a canvas drawn much bigger and shrunk
     by the browser (no mipmaps) broke its thin gold line and bevel into dashes. */
  function jellyWord(text, pal, opts = {}) {
    const PLATE = opts.plate !== false;                  // (no plate: the letters stand straight on their pill — HUD)
    let F = opts.F || 220;
    if (opts.H) {                                        // H = F · (ascent + descent + E + 2 (PL + G + B)) / F + 2 · 6
      const g1 = document.createElement('canvas').getContext('2d'); g1.font = "800 100px 'Baloo 2', 'Arial Rounded MT Bold', sans-serif";
      const m1 = [...text].map(ch => g1.measureText(ch));
      const k = (Math.max(...m1.map(m => m.actualBoundingBoxAscent)) + Math.max(0, ...m1.map(m => m.actualBoundingBoxDescent))) / 100;
      F = Math.max(40, (opts.H - 12) / (k + 0.09 + 2 * ((PLATE ? 0.095 : 0) + 0.022 + 0.075)));
    }
    // (B: fatter than Baloo 800, like the logo's letters — but the small holes of a / s / e must stay open: kids read
    //  the shape (B .13 closed them: "a" and "s" looked like "8"); R: a thin bevel, so the face is most of the letter)
    const B = F * 0.075, E = F * 0.09, G = F * 0.022, R = F * 0.03, PL = PLATE ? F * 0.095 : 0, TRACK = -F * 0.02;
    const font = `800 ${F}px 'Baloo 2', 'Arial Rounded MT Bold', sans-serif`;
    const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const mix = (a, b, k) => 'rgb(' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * k)).join(',') + ')';
    const rgba = (a, al) => 'rgba(' + hex(a).join(',') + ',' + al + ')';
    const g0 = document.createElement('canvas').getContext('2d'); g0.font = font;
    const chars = [...text], ms = chars.map(ch => g0.measureText(ch));
    const pals = []; { let j = 0; for (const ch of chars) pals.push(ch === ' ' ? null : Array.isArray(pal[0]) ? pal[j++ % pal.length] : pal); }
    const asc = Math.max(...ms.map(m => m.actualBoundingBoxAscent)), desc = Math.max(0, ...ms.map(m => m.actualBoundingBoxDescent));
    const pad = PL + G + B + 6;
    const xs = []; let x = 0;
    const SP = F * (opts.space || 0.13);                 // (a narrow space by default: a plate stays one piece)
    ms.forEach((m, i) => { xs.push(x + m.actualBoundingBoxLeft); x += chars[i] === ' ' ? SP : m.actualBoundingBoxLeft + m.actualBoundingBoxRight + (i < ms.length - 1 ? TRACK + B : 0); });
    const W = Math.ceil(x + 2 * pad), H = Math.ceil(asc + desc + E + 2 * pad), base = pad + asc;
    // (scratch canvases are emptied as soon as they're drawn: iPad Safari caps the memory all canvases may hold)
    const scratch = [], free = () => { for (const c of scratch.splice(0)) c.width = c.height = 0; };
    // (scratch canvases are read back: kept in memory, not on the GPU — getImageData from a GPU canvas is a slow round trip)
    const mk = (keep) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', keep ? undefined : { willReadFrequently: true }); g.font = font; g.lineJoin = 'round'; g.textBaseline = 'alphabetic'; if (!keep) scratch.push(c); return [c, g]; };
    const glyph = (g, i, dy, lw) => { const gx = pad + xs[i]; g.fillText(chars[i], gx, base + dy); g.lineWidth = lw; g.strokeText(chars[i], gx, base + dy); };
    const [out, o] = mk(true);
    // the plate: every letter (with its side) grown by PL, merged into one rounded cloud (blur + cut at half)
    const gooey = (c, r) => {
      const g = c.getContext('2d'), img = g.getImageData(0, 0, W, H), d = img.data, a = new Float32Array(W * H), b = new Float32Array(W * H), n = 2 * r + 1;
      for (let k = 0; k < W * H; k++) a[k] = d[k * 4 + 3] / 255;
      const hb = (s, t) => { for (let y = 0; y < H; y++) { const q = y * W; let sum = 0; for (let k = -r; k <= r; k++) sum += s[q + Math.min(W - 1, Math.max(0, k))];
        for (let k = 0; k < W; k++) { t[q + k] = sum / n; sum += s[q + Math.min(W - 1, k + r + 1)] - s[q + Math.max(0, k - r)]; } } };
      const vb = (s, t) => { for (let k = 0; k < W; k++) { let sum = 0; for (let y = -r; y <= r; y++) sum += s[Math.min(H - 1, Math.max(0, y)) * W + k];
        for (let y = 0; y < H; y++) { t[y * W + k] = sum / n; sum += s[Math.min(H - 1, y + r + 1) * W + k] - s[Math.max(0, y - r) * W + k]; } } };
      for (let k = 0; k < 2; k++) { hb(a, b); vb(b, a); }
      for (let k = 0; k < W * H; k++) { d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 255; d[k * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (a[k] - 0.5) * 7 + 0.5))); }
      g.putImageData(img, 0, 0); return c;
    };
    const plateMask = (grow) => { const [c, g] = mk(); g.fillStyle = g.strokeStyle = '#fff';
      chars.forEach((_, i) => { for (let dy = 0; dy <= E; dy += 2) glyph(g, i, dy, B + 2 * grow); });
      // (and a band through the letters' middles, first to last: one plate, no pinholes or gaps between letters / words)
      const vis = pals.map((p, i) => p ? i : -1).filter(i => i >= 0), mid = (i) => pad + xs[i] + (ms[i].actualBoundingBoxRight - ms[i].actualBoundingBoxLeft) / 2;
      if (vis.length > 1) g.fillRect(mid(vis[0]), base - asc * 0.72 - grow, mid(vis[vis.length - 1]) - mid(vis[0]), asc * 0.72 + E + 2 * grow);
      return gooey(c, Math.round(PL * 0.45)); };
    const tint = (mask, fill) => { const [c, g] = mk(); g.drawImage(mask, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = fill; g.fillRect(0, 0, W, H); return c; };
    if (PLATE) {
    const outer = plateMask(PL), inner = plateMask(PL - G);
    o.save(); o.shadowColor = 'rgba(12,50,130,.38)'; o.shadowBlur = F * 0.05; o.shadowOffsetY = F * 0.03;
    o.drawImage(tint(outer, '#f2c766'), 0, 0); o.restore();
    { const gr = o.createLinearGradient(0, pad - PL, 0, H - pad + PL); gr.addColorStop(0, 'rgba(222,248,255,.97)'); gr.addColorStop(0.55, 'rgba(160,228,254,.95)'); gr.addColorStop(1, 'rgba(126,203,240,.95)');
      const [pc, pg] = mk(); pg.drawImage(tint(inner, gr), 0, 0);
      // (the glass: a white shine inside its top edge, a little shade inside its bottom)
      const [ic, ig] = mk(); ig.fillStyle = '#000'; ig.fillRect(0, 0, W, H); ig.globalCompositeOperation = 'destination-out'; ig.drawImage(inner, 0, 0);
      pg.globalCompositeOperation = 'source-atop';
      pg.shadowColor = 'rgba(255,255,255,.9)'; pg.shadowBlur = F * 0.02; pg.shadowOffsetY = F * 0.022; pg.drawImage(ic, 0, 0);
      pg.shadowColor = 'rgba(40,120,190,.35)'; pg.shadowBlur = F * 0.04; pg.shadowOffsetY = -F * 0.03; pg.drawImage(ic, 0, 0);
      o.drawImage(pc, 0, 0); }
    free();
    }
    // the letters, left to right (each a little over the one before, like the logo's)
    chars.forEach((_, i) => {
      if (!pals[i]) return;                              // (a space)
      const [fTop, fMid, fLow, bevel, side, sideDk, glow] = pals[i];
      const top = base - ms[i].actualBoundingBoxAscent - B / 2, bot = base + ms[i].actualBoundingBoxDescent + B / 2, gh = bot - top;
      // the gold line round the letter and its side, the side, and the bevel on top — ONE shape each: the gold and the
      // side are the letter swept down E (sweepDown: stacked anti-aliased copies piled their edges up into hard, dark,
      // stair-stepped rims — user: "상단에 음가 스펠링도 테두리 어두운색이 깨져보이는 현상"), the bevel laid over the side
      // coverage-correct (overMax: a plain "over" mixed the dark side into the bevel's edge). Only the letter's own
      // columns are worked on (rx .. rx + rw).
      const gx = pad + xs[i], ext = B / 2 + G + 3;
      const rx = Math.max(0, Math.floor(gx - ms[i].actualBoundingBoxLeft - ext)), rw = Math.min(W, Math.ceil(gx + ms[i].actualBoundingBoxRight + ext)) - rx;
      const sub = (c) => c.getContext('2d').getImageData(rx, 0, rw, H);
      const shapeA = (lw) => { const [c, g] = mk(); g.fillStyle = g.strokeStyle = '#fff'; glyph(g, i, 0, lw);
        const d = sub(c).data, a = new Float32Array(rw * H); for (let k = 0; k < a.length; k++) a[k] = d[k * 4 + 3] / 255; return a; };
      const gold = sweepDown(shapeA(B + 2 * G), rw, H, 0, Math.round(E)).cov, sd = sweepDown(shapeA(B), rw, H, 1, Math.round(E));
      {
        const [bc, bg] = mk();
        const gr = bg.createLinearGradient(0, top, 0, bot); gr.addColorStop(0, mix(bevel, '#ffffff', 0.18)); gr.addColorStop(1, bevel);
        bg.fillStyle = bg.strokeStyle = gr; glyph(bg, i, 0, B);
        const body = bg.createImageData(rw, H), BD = body.data, S0 = hex(side), S1 = hex(sideDk), GL = hex('#f5c45c');
        overMax(sub(bc).data, sd.cov, (j, k) => S0[k] + (S1[k] - S0[k]) * Math.min(1, sd.dist[j] / E), BD);
        for (let j = 0, n = rw * H; j < n; j++) {        // and the gold under it all
          const af = BD[j * 4 + 3] / 255, ag = gold[j] * (1 - af), a = af + ag;
          if (a <= 0.002) { BD[j * 4 + 3] = 0; continue; }
          for (let k = 0; k < 3; k++) BD[j * 4 + k] = (BD[j * 4 + k] * af + GL[k] * ag) / a;
          BD[j * 4 + 3] = a * 255;
        }
        bg.clearRect(0, 0, W, H); bg.putImageData(body, rx, 0); o.drawImage(bc, 0, 0);
      }
      // the face: the letter shrunk by R, with the jelly lights on it
      const [fc, fg] = mk();
      { const gr = fg.createLinearGradient(0, top, 0, bot); gr.addColorStop(0, fTop); gr.addColorStop(0.5, fMid); gr.addColorStop(0.56, fLow); gr.addColorStop(1, fLow);
        fg.fillStyle = fg.strokeStyle = gr; glyph(fg, i, 0, B - 2 * R); }     // (the fat letter shrunk by R = a stroke 2R thinner)
      const [ic, ig] = mk(); ig.fillStyle = '#000'; ig.fillRect(0, 0, W, H); ig.globalCompositeOperation = 'destination-out'; ig.drawImage(fc, 0, 0);
      fg.globalCompositeOperation = 'source-atop';
      // the top half lighter, with a soft curved lower edge (the logo's two-tone jelly)
      { const yS = top + gh * 0.5, gr = fg.createLinearGradient(0, top, 0, yS + gh * 0.04);
        gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(0.85, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        fg.fillStyle = gr; fg.beginPath(); const x0 = pad + xs[i] - F * 0.2, x1 = x0 + ms[i].actualBoundingBoxRight + ms[i].actualBoundingBoxLeft + F * 0.4;
        fg.moveTo(x0, top - F); fg.lineTo(x1, top - F); fg.lineTo(x1, yS - gh * 0.03); fg.quadraticCurveTo((x0 + x1) / 2, yS + gh * 0.09, x0, yS - gh * 0.03); fg.closePath(); fg.fill(); }
      // the inner lights: the SHADOW of the outside (ic), never ic itself — drawn source-atop, its black edge darkened the
      // face's anti-aliased rim into a thin dark broken line. So ic goes off the canvas and its shadow is offset back.
      const OFF = W + 64;
      const inner = (col, blur, dx, dy) => { fg.shadowColor = col; fg.shadowBlur = blur; fg.shadowOffsetX = OFF + dx; fg.shadowOffsetY = dy; fg.drawImage(ic, -OFF, 0); };
      inner(rgba(bevel, 0.6), F * 0.025, 0, 0);                         // soft bevel into the face
      inner(rgba(glow, 0.95), F * 0.05, 0, -F * 0.05);                  // glow inside the bottom
      inner('rgba(255,255,255,.8)', F * 0.01, F * 0.008, F * 0.013);   // shine on the top-left edges
      o.drawImage(fc, 0, 0);
      // the white spot: just inside the face's top-left, where the face starts
      { const d = sub(fc).data; let best = null;
        for (let y = Math.floor(top); y < top + gh * 0.45 && !best; y += 2) for (let xx = 0; xx < rw; xx += 2) if (d[(y * rw + xx) * 4 + 3] > 200) {
          let run = 0; while (xx + run < rw && d[(y * rw + xx + run) * 4 + 3] > 200) run += 2;
          if (run > F * 0.12) { best = [rx + xx + F * 0.07, y + F * 0.06]; } break; }
        if (best) { o.save(); o.translate(best[0], best[1]); o.rotate(-0.5); o.fillStyle = 'rgba(255,255,255,.92)'; o.beginPath(); o.ellipse(0, 0, F * 0.034, F * 0.02, 0, 0, Math.PI * 2); o.fill(); o.restore(); } }
      free();
    });
    out.className = 'jelly';
    return out;
  }
  /* the HUD's target letters, drawn at the size they show (css .tg-letter .jelly: TG_U · u tall) × 1.25 for this
     screen's pixel ratio — drawn at 220 px and shrunk ~2x by the browser, their thin gold line and bevel broke into dark
     dashes (user: "상단에 음가 스펠링도 테두리 어두운색이 깨져보이는 현상이 있어"); layout swaps them when that size changes */
  const TG_U = 10.6, jellyCache = {};
  /* the game's pop-up words — GO! at each round, TIME'S UP! — in the same jelly letters (user: "게임에 들어가는 go
     텍스트들도 스타일 다 맞춰줘"; they were plain text with a white stroke): GO! the logo's yellow (the result title's),
     TIME'S UP! its pink. size = the letters' font size in --mu; drawn at ~1.25x the size they show here, once per size */
  let curMu = 0;
  const promptCache = {};
  function showPrompt(el, text, pal, size) {
    const mu = curMu || 8, F = Math.max(60, Math.min(520, Math.round(size * mu * (window.devicePixelRatio || 1) * 1.25 / 10) * 10));
    const key = text + '|' + pal + '|' + F;
    let cv = promptCache[key];
    if (!cv) {
      cv = promptCache[key] = jellyWord(text, JELLY[pal], { F, plate: false, space: 0.3 });   // (a full word space: TIME'S UP!)
      cv.style.height = `calc(${(cv.height / F * size).toFixed(3)} * var(--mu))`;
    }
    el.replaceChildren(cv); el.setAttribute('aria-label', text);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  function targetJelly(L) {
    const u = Math.min(innerHeight / 100, innerWidth / 177.78), h = Math.round(TG_U * u * (window.devicePixelRatio || 1) * 1.25);
    const key = L + ':' + Math.round(h / 6);
    return jellyCache[key] || (jellyCache[key] = jellyWord(L.toUpperCase() + L, JELLY[LETTER_JELLY[L] || 'pink'], { plate: false, H: h }));
  }
  /* the result's title: the logo's jelly letters, one gold-yellow jelly (the logo's Y — with the stars and the card's
     gold rim, fewer colours than the rainbow), straight on a blue ribbon (the plate is off: user "퍼펙트 같은건 리본형태가
     나았던거 같은데.." — css .ribbon); ?title=rainbow (the logo's / START's colours letter by letter) or ?title=<JELLY
     name> for comparing, ?ribbon=pink for the earlier pink ribbon. The same letter size for every title (css height from
     the canvas, in --u: TITLE_U = the font size); drawn at the size it shows on this screen (F = font px: sharp on 2x and
     big screens, quicker on small ones), once. */
  const TITLE_U = 9.3, TITLE_Q = qs.get('title'), titleCache = {};
  if (qs.get('ribbon') === 'pink') {
    $('#ribbon').classList.add('pink');
    $('#ribbon').querySelectorAll('path').forEach(p => ['fill', 'stroke'].forEach(a => {
      const v = p.getAttribute(a); if (v && v.startsWith('url(#rb')) p.setAttribute(a, v.replace(/\)$/, 'P)'));
    }));
  }
  const TITLE_PAL = TITLE_Q === 'rainbow' ? RAINBOW.map(k => JELLY[k]) : JELLY[Object.prototype.hasOwnProperty.call(JELLY, TITLE_Q) ? TITLE_Q : 'yellow'];
  function resultTitle(text) {
    const u = Math.min(innerHeight / 100, innerWidth / 177.78);
    const F = Math.max(80, Math.min(480, Math.round(TITLE_U * u * (window.devicePixelRatio || 1) * 1.25 / 10) * 10));
    let t = titleCache[text];
    if (!t || t.F !== F) {
      t = titleCache[text] = { F, cv: jellyWord(text, TITLE_PAL, { F, plate: false }) };
      t.cv.style.height = `calc(${(t.cv.height / F * TITLE_U).toFixed(3)} * var(--u))`;
    }
    return t.cv;
  }

  /* the START button, after the intro mockup (design/intro_ref.png, the button at x 1050–1720, y 1300–1530): chunky
     block letters — a front face, a deep darker side under it, a thick round white outline with its own lavender side —
     on a royal-blue slab with a darker front edge. The slab's top face and the letters lie on the panel together: one
     perspective tilt (CSS .tilt) narrows both toward the top (user: "start 텍스트도 각도는 맞춰야지"). Coordinates are
     the mockup's pixels in that crop (1 mu = 15.36 px). One still white outline round the whole word, and the letters'
     weight waving inside it, one letter after another (below). */
  /* The whole word (its white outline and the outline's side included) sits INSIDE the slab's top face, centred, with a
     margin (user: "start 글씨가 밑에 파란색 판 보다 작게 넣어줘. 영역 벗어나지 않게"): it's drawn in its own units as
     before (so it looks the same) and placed scaled by WS round the face's middle.
     Clean edges (user: "start 글씨 테두리에 어두운색 라인이 깨져보이는거 같은데..좀더 부드럽게 안돼?") — the dark line had three
     causes: the face's inner shadows painted their black mask (the outside of the letter) onto the face's anti-aliased
     rim (the mask is in the face's own colours now); the side was 57 stacked anti-aliased
     copies, a bit wider than the face, whose edges piled up into a hard rim of the dark side colour (now one sweep of
     the shape downward: a running max per column, sweepDown), laid under the face coverage-correct (overMax: no dark
     seam where face and side share an edge); and the canvases were drawn at 2.2 px per mockup px and shrunk ~3x
     through the CSS tilt, which samples without mipmaps, so thin edges broke into dashes (fitStart draws them at the
     size they show, ~1.3 canvas px per screen px, and again when that size changes). */
  let startGen = 0, startK = 0;
  function fitStart(mu) {
    if (!(mu > 0)) return;
    const K = Math.min(3, Math.max(1, 1.3 * (39.7 * mu / 610) * (window.devicePixelRatio || 1)));
    if (startK && Math.abs(K - startK) / startK < 0.2) return;
    buildStart(K);
  }
  /* a shape (alpha 0..1, w × h) pushed down by d0..d1 px, as ONE shape: per column, the max over that window (a deque)
     — stacked copies would add up their anti-aliased edges into a hard rim. dist: how far below the nearest solid
     pixel of the shape each pixel is (the side's shading) */
  function sweepDown(al, w, h, d0, d1) {
    const cov = new Float32Array(w * h), dist = new Float32Array(w * h), q = new Int32Array(h);
    for (let x = 0; x < w; x++) {
      let qh = 0, qt = 0, last = -1e9, any = -1e9;
      for (let y = 0; y < h; y++) {
        const r = y - d0;
        if (r >= 0) {
          const v = al[r * w + x];
          while (qt > qh && al[q[qt - 1] * w + x] <= v) qt--;
          q[qt++] = r;
          if (v >= 0.5) last = r;
          if (v > 0.02) any = r;
        }
        while (qt > qh && q[qh] < y - d1) qh++;
        const i = y * w + x;
        cov[i] = qt > qh ? al[q[qh] * w + x] : 0;
        dist[i] = y - (last >= y - d1 ? last : any >= y - d1 ? any : y);
      }
    }
    return { cov, dist };
  }
  const alphaOf = (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, a = new Float32Array(c.width * c.height);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    return a;
  };
  /* a front layer (RGBA bytes, straight alpha) over a back one given as coverage + colour per pixel, coverage-correct:
     alpha = max of the two, the front's colour where it covers — plain "over" mixed the back colour into the front's
     anti-aliased edge where both share it (a dark seam) */
  function overMax(front, backA, backRGB, out) {
    for (let i = 0, n = backA.length; i < n; i++) {
      const af = front[i * 4 + 3] / 255, ab = backA[i], a = Math.max(af, ab);
      if (a <= 0.002) { out[i * 4 + 3] = 0; continue; }
      const wb = Math.max(0, ab - af);
      for (let k = 0; k < 3; k++) out[i * 4 + k] = (front[i * 4 + k] * af + backRGB(i, k) * wb) / a;
      out[i * 4 + 3] = a * 255;
    }
  }
  function buildStart(K = 2.2) {
    const gen = ++startGen; startK = K;
    const btn = $('#start');
    const BOX = [20, 6, 610, 216];                       // the button's box in crop px: x, y, w, h
    const FS = 161, SX = 1.2, TRACK = -1, BASE = 118;    // font size, widening (the mockup font is wider), baseline
    const B = 7;                                         // extra weight: every layer gets a B-wide stroke (heavier than Baloo 800)
    const E = 28, O = 8, OS = 7;                         // letter side depth, white outline, the outline's own side
    const LET = [                                        // letter, face top, face bottom, side top, side bottom
      ['S', '#ff5a70', '#f2465f', '#d32a49', '#86172f'],
      ['T', '#ffbe50', '#ffa53c', '#e7652b', '#a33811'],
      ['A', '#fde24c', '#f9da36', '#d6900e', '#bb7c16'],
      ['R', '#86d97a', '#72ce66', '#6aa866', '#3b7343'],
      ['T', '#68cfe5', '#52c1df', '#57b9e1', '#2378b4'],
    ];
    const font = `800 ${FS}px 'Baloo 2', 'Arial Rounded MT Bold', sans-serif`;
    const g0 = document.createElement('canvas').getContext('2d'); g0.font = font; g0.textAlign = 'center';
    const ms = LET.map(([ch]) => g0.measureText(ch));
    const adv = ms.map(m => m.width * SX);
    let x = 327 - (adv.reduce((a, b) => a + b, 0) + TRACK * (LET.length - 1)) / 2;
    const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const mix = (a, b, k) => 'rgb(' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * k)).join(',') + ')';
    const place = (cv, x0, y0, w, h) => Object.assign(cv.style, {
      left: (x0 - BOX[0]) / BOX[2] * 100 + '%', top: (y0 - BOX[1]) / BOX[3] * 100 + '%',
      width: w / BOX[2] * 100 + '%', height: h / BOX[3] * 100 + '%' });
    // (rf: a scratch canvas read back with getImageData — kept in memory, not on the GPU: a GPU readback is slow)
    const canvas = (w, h, k = K, rf = false) => { const c = document.createElement('canvas'); c.width = Math.ceil(w * k); c.height = Math.ceil(h * k); const g = c.getContext('2d', rf ? { willReadFrequently: true } : undefined); g.scale(k, k); return [c, g]; };
    const rr = (g, x0, y0, w, h, r) => { g.beginPath(); g.roundRect(x0, y0, w, h, r); };
    btn.innerHTML = '';
    // the slab. Its front edge is an upright face: drawn flat, outside the tilt. Its top face and the letters lie on the
    // panel under one perspective tilt (CSS .tilt, hinged at the top face's front edge, y 165), which turns the top face
    // into the mockup's trapezoid (back edge x 45–610 at y 40, front edge x 27–626 at y 165). So the top face is drawn
    // as the rectangle that tilts into it: 599 wide from y 32.5 (the tilt brings that edge down to 40, 565 wide).
    const tilt = document.createElement('span'); tilt.className = 'tilt';
    {
      const [c, g] = canvas(BOX[2], BOX[3]);
      g.translate(-BOX[0], -BOX[1]);
      // (soft edges with shadowBlur, not ctx.filter: older iPad Safari has no canvas filter)
      const gr = g.createLinearGradient(0, 160, 0, 212); gr.addColorStop(0, '#3a6fd2'); gr.addColorStop(0.45, '#2b58b6'); gr.addColorStop(1, '#1b4594');
      g.save(); g.shadowColor = 'rgba(16,32,90,.42)'; g.shadowBlur = 14 * K; g.shadowOffsetY = 7 * K;
      g.fillStyle = gr; rr(g, 27, 130, 599, 82, 28); g.fill(); g.restore();
      c.className = 'plate'; place(c, BOX[0], BOX[1], BOX[2], BOX[3]); btn.appendChild(c);
    }
    const FACE = [27, 32.5, 626, 165];                   // the slab's top face (before the tilt)
    {
      const [c, g] = canvas(BOX[2], BOX[3]);
      g.translate(-BOX[0], -BOX[1]);
      const gr = g.createLinearGradient(0, 32.5, 0, 165); gr.addColorStop(0, '#4479f0'); gr.addColorStop(0.25, '#5a82ee'); gr.addColorStop(1, '#6386e4');
      g.fillStyle = gr; rr(g, 27, 32.5, 599, 132.5, 26); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2; rr(g, 29, 34.5, 595, 128.5, 24); g.stroke();
      c.className = 'plate-top'; place(c, BOX[0], BOX[1], BOX[2], BOX[3]); tilt.appendChild(c);
    }
    btn.appendChild(tilt);
    const DMAX = 7;                                      // the wave: up to DMAX px bolder than the resting weight
    const pos = []; { let xx = x; LET.forEach((_, i) => { pos.push(xx + adv[i] / 2); xx += adv[i] + TRACK; }); }
    // the word's box in its own units — the letters' ink, the outline round it (R) and the sides under it — fitted
    // into the top face with a margin
    const R = O + (B + DMAX) / 2;
    const wx0 = Math.min(...pos.map((p, i) => p - ms[i].actualBoundingBoxLeft * SX)) - R;
    const wx1 = Math.max(...pos.map((p, i) => p + ms[i].actualBoundingBoxRight * SX)) + R;
    const wy0 = BASE - Math.max(...ms.map(m => m.actualBoundingBoxAscent)) - R;
    const wy1 = BASE + Math.max(0, ...ms.map(m => m.actualBoundingBoxDescent)) + R + E + OS;
    const MX = 22, MY = 12;
    const WS = Math.min((FACE[2] - FACE[0] - 2 * MX) / (wx1 - wx0), (FACE[3] - FACE[1] - 2 * MY) / (wy1 - wy0));
    const acx = (FACE[0] + FACE[2]) / 2, acy = (FACE[1] + FACE[3]) / 2, wcx = (wx0 + wx1) / 2, wcy = (wy0 + wy1) / 2;
    const KW = K * WS;                                   // canvas px per word unit
    const placeW = (cv, x0, y0, w, h) => place(cv, acx + (x0 - wcx) * WS, acy + (y0 - wcy) * WS, w * WS, h * WS);
    /* the white outline: ONE shape round the whole word (user: "흰색 라인은 같이 하나로 묶여있고"; per-letter outlines met
       in V-notches and looked "조각조각") — every letter stroked thick into one mask, blurred and cut at half (a gooey
       merge: the notches between letters fill with round fillets, like a sticker's outline); then the white swept down
       E under it and its lavender side below that, like the letters. Drawn once: it stays still while the letters'
       weight waves. */
    const gooey = (c, r, slope) => {
      const g = c.getContext('2d'), w = c.width, h = c.height, img = g.getImageData(0, 0, w, h), d = img.data;
      const a = new Float32Array(w * h), b = new Float32Array(w * h), n = 2 * r + 1;
      for (let k = 0; k < w * h; k++) a[k] = d[k * 4 + 3] / 255;
      const blurH = (src, dst) => { for (let y = 0; y < h; y++) { const o = y * w; let sum = 0;
        for (let xx = -r; xx <= r; xx++) sum += src[o + Math.min(w - 1, Math.max(0, xx))];
        for (let xx = 0; xx < w; xx++) { dst[o + xx] = sum / n; sum += src[o + Math.min(w - 1, xx + r + 1)] - src[o + Math.max(0, xx - r)]; } } };
      const blurV = (src, dst) => { for (let xx = 0; xx < w; xx++) { let sum = 0;
        for (let y = -r; y <= r; y++) sum += src[Math.min(h - 1, Math.max(0, y)) * w + xx];
        for (let y = 0; y < h; y++) { dst[y * w + xx] = sum / n; sum += src[Math.min(h - 1, y + r + 1) * w + xx] - src[Math.max(0, y - r) * w + xx]; } } };
      for (let k = 0; k < 2; k++) { blurH(a, b); blurV(b, a); }
      for (let k = 0; k < w * h; k++) { d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 255; d[k * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (a[k] - 0.5) * slope + 0.5))); }
      g.putImageData(img, 0, 0);
    };
    {
      const OB = [wx0 - 8, wy0 - 8, wx1 - wx0 + 16, wy1 - wy0 + 16];   // the outline's box (word units)
      const [mc, mg] = canvas(OB[2], OB[3], KW, true);
      mg.translate(-OB[0], -OB[1]);
      mg.font = font; mg.textAlign = 'center'; mg.textBaseline = 'alphabetic'; mg.lineJoin = 'round';
      mg.fillStyle = mg.strokeStyle = '#fff'; mg.lineWidth = O * 2 + B + DMAX;
      LET.forEach(([ch], i) => { mg.save(); mg.translate(pos[i], 0); mg.scale(SX, 1); mg.fillText(ch, 0, BASE); mg.strokeText(ch, 0, BASE); mg.restore(); });
      gooey(mc, Math.max(1, Math.round(4.5 * KW)), 8);
      const W = mc.width, H = mc.height;
      // slits and pockets between letters (under a T's arm, R–T) are closed: specks and a thin crack of the blue showed
      // through there — a closing (max then min over a small square: only gaps narrower than it fill) and then a flood
      // from the edges through everything not solid (whatever it can't reach is inside)
      const morph = (src, r, dil) => {
        const t = new Float32Array(W * H), o = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
          let v = src[y * W + xx];
          for (let k = Math.max(0, xx - r); k <= Math.min(W - 1, xx + r); k++) { const u = src[y * W + k]; if (dil ? u > v : u < v) v = u; }
          t[y * W + xx] = v;
        }
        for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
          let v = t[y * W + xx];
          for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) { const u = t[k * W + xx]; if (dil ? u > v : u < v) v = u; }
          o[y * W + xx] = v;
        }
        return o;
      };
      const rc = Math.max(1, Math.round(3 * KW));
      const al = morph(morph(alphaOf(mc), rc, true), rc, false);
      {
        const seen = new Uint8Array(W * H), st = [];
        for (let xx = 0; xx < W; xx++) st.push(xx, (H - 1) * W + xx);
        for (let yy = 0; yy < H; yy++) st.push(yy * W, yy * W + W - 1);
        while (st.length) {
          const k = st.pop();
          if (seen[k] || al[k] >= 0.98) continue;
          seen[k] = 1;
          const xx = k % W;
          if (xx > 0) st.push(k - 1); if (xx < W - 1) st.push(k + 1); if (k >= W) st.push(k - W); if (k < W * (H - 1)) st.push(k + W);
        }
        for (let k = 0; k < W * H; k++) if (!seen[k]) al[k] = 1;
      }
      const white = sweepDown(al, W, H, 0, Math.round(E * KW)).cov;
      const lav = sweepDown(al, W, H, Math.round(E * KW), Math.round((E + OS) * KW)).cov;
      const WH = hex('#fbf4f6'), LV = hex('#a9a1c2');
      const [oc, og] = canvas(OB[2], OB[3], KW);
      const img = og.createImageData(W, H), wd = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) { wd[i * 4] = WH[0]; wd[i * 4 + 1] = WH[1]; wd[i * 4 + 2] = WH[2]; wd[i * 4 + 3] = white[i] * 255; }
      overMax(wd, lav, (i, k) => LV[k], img.data);
      og.putImageData(img, 0, 0);
      mc.width = 0;
      oc.className = 'outline'; placeW(oc, OB[0], OB[1], OB[2], OB[3]); tilt.appendChild(oc);
    }
    /* the letters, each in its own canvas. The wave (user: "글자의 두께가 물결처럼 작아졌다 커졌다 순차적으로 계속
       롤링"): each letter gets bolder and back, one after another, round and round, inside the still outline. Every
       weight is drawn once (the resting one now, the rest a few per frame after the title shows); the wave only swaps
       pictures. */
    const NW = 6, FR = LET.map(() => []);
    const hw = (i) => adv[i] / 2 + O + B + DMAX + 10, top = BASE - FS * 0.86, lh = FS * 0.86 + E + B + DMAX + 12;
    const drawLetter = (i, extra) => {
      const [ch, f0, f1, s0, s1] = LET[i], half = hw(i), BW = B + extra;
      const [c, g] = canvas(half * 2, lh, KW, true), [fc, fg] = canvas(half * 2, lh, KW, true), [ic, ig] = canvas(half * 2, lh, KW);
      const W = c.width, H = c.height;
      for (const q of [g, fg, ig]) { q.translate(half, -top); q.scale(SX, 1); q.font = font; q.textAlign = 'center'; q.textBaseline = 'alphabetic'; q.lineJoin = 'round'; q.lineWidth = BW; }
      // the side: the letter's shape swept down E, shaded from the side's top colour to its bottom colour by depth
      g.fillStyle = g.strokeStyle = '#fff'; g.fillText(ch, 0, BASE); g.strokeText(ch, 0, BASE);
      const sw = sweepDown(alphaOf(c), W, H, Math.max(1, Math.round(0.5 * KW)), Math.round(E * KW));
      const S0 = hex(s0), S1 = hex(s1), kd = 1 / (E * 0.35 * KW);
      const sideRGB = (j, k) => { const t = Math.min(1, sw.dist[j] * kd); return S0[k] + (S1[k] - S0[k]) * t; };
      // the face, puffed: its gradient, then a soft dark rim along the bottom edge and a light one along the top-left
      // (inner shadows: the shadow of everything OUTSIDE the letter, drawn only onto the letter). That outside is painted
      // in the face's own colours: its edge is drawn over the face's anti-aliased rim too, and in black it darkened the
      // rim into a thin dark broken line
      const STOPS = [[0, mix(f0, '#ffffff', 0.08)], [0.35, f0], [1, f1]];
      const grad = (q, y0, y1) => { const gr = q.createLinearGradient(0, y0, 0, y1); STOPS.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
      fg.fillStyle = fg.strokeStyle = grad(fg, BASE - FS * 0.64, BASE); fg.fillText(ch, 0, BASE); fg.strokeText(ch, 0, BASE);
      ig.save(); ig.setTransform(1, 0, 0, 1, 0, 0); ig.fillStyle = grad(ig, KW * (BASE - FS * 0.64 - top), KW * (BASE - top)); ig.fillRect(0, 0, W, H); ig.restore();
      ig.globalCompositeOperation = 'destination-out'; ig.fillText(ch, 0, BASE); ig.strokeText(ch, 0, BASE);
      fg.setTransform(1, 0, 0, 1, 0, 0); fg.globalCompositeOperation = 'source-atop';
      fg.shadowColor = mix(s1, '#000000', 0.1).replace('rgb', 'rgba').replace(')', ',.26)'); fg.shadowBlur = 9 * KW; fg.shadowOffsetY = -5 * KW;
      fg.drawImage(ic, 0, 0);
      fg.shadowColor = 'rgba(255,255,255,.42)'; fg.shadowBlur = 2.5 * KW; fg.shadowOffsetX = 1.2 * KW; fg.shadowOffsetY = 2.6 * KW;
      fg.drawImage(ic, 0, 0);
      const img = g.createImageData(W, H);
      overMax(fg.getImageData(0, 0, W, H).data, sw.cov, sideRGB, img.data);
      g.putImageData(img, 0, 0);
      fc.width = ic.width = 0;
      return c;
    };
    const vis = LET.map((_, i) => {
      const [c] = canvas(hw(i) * 2, lh, KW); c.className = 'L';
      placeW(c, pos[i] - hw(i), top, hw(i) * 2, lh); tilt.appendChild(c);
      return c;
    });
    const show = (i, k) => { const c = vis[i], g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.drawImage(FR[i][k], 0, 0); };
    LET.forEach((_, i) => { FR[i][0] = drawLetter(i, 0); show(i, 0); });
    const todo = []; for (let k = 1; k < NW; k++) LET.forEach((_, i) => todo.push([i, k]));
    let waveOn = false;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, cur = LET.map(() => 0);
    const more = () => {
      if (gen !== startGen) return;                      // (rebuilt at another size meanwhile)
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 8) { const [i, k] = todo.shift(); FR[i][k] = drawLetter(i, DMAX * k / (NW - 1)); }
      if (todo.length) setTimeout(more, 16); else waveOn = true;
    };
    setTimeout(more, 300);
    const wave = (now) => {
      if (gen !== startGen) return;
      requestAnimationFrame(wave);
      if (!waveOn || still || app.dataset.screen !== 'title') return;
      const t = now / 1000;
      LET.forEach((_, i) => {
        const ph = ((((t - i * 0.14) % 1.7) + 1.7) % 1.7) / 1.7;
        const pk = ph < 0.26 ? ph / 0.26 : ph < 0.56 ? 1 - (ph - 0.26) / 0.3 : 0;
        const k = Math.round((0.5 - 0.5 * Math.cos(Math.PI * pk)) * (NW - 1));
        if (k !== cur[i]) { cur[i] = k; show(i, k); }
      });
    };
    requestAnimationFrame(wave);
    G.startWave = { ready: () => waveOn, frames: () => cur.slice(), K, WS, gen };   // (QA)
  }

  /* the prize's sun-burst: turning rays behind the friend — in 3D, so the friend stays in front of it */
  function makeBurst() {
    const tex = Mats.tex(512, 512, (g, w, h) => {
      g.save(); g.translate(w / 2, h / 2);
      const n = 18;
      g.fillStyle = 'rgba(255,244,176,0.95)';
      for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, w / 2, i * 2 * Math.PI / n, (i * 2 + 1) * Math.PI / n); g.closePath(); g.fill(); }
      g.globalCompositeOperation = 'destination-in';
      const m = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.35, 'rgba(0,0,0,0.85)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = m; g.fillRect(-w / 2, -h / 2, w, h);
      g.globalCompositeOperation = 'source-over';
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      glow.addColorStop(0, 'rgba(255,252,226,0.9)'); glow.addColorStop(0.32, 'rgba(255,240,170,0.38)'); glow.addColorStop(1, 'rgba(255,240,170,0)');
      g.fillStyle = glow; g.fillRect(-w / 2, -h / 2, w, h);
      g.restore();
    });
    const grp = new T.Group();
    const disc = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    disc.renderOrder = 3;
    grp.add(disc); grp.visible = false; grp.userData.disc = disc;
    return grp;
  }
  function burstTo(on) {
    const m = burst.userData.disc.material, o0 = m.opacity;
    if (on) burst.visible = true;
    return S.tween(on ? 350 : 300, k => (m.opacity = lerp(o0, on ? 0.95 : 0, k)), on ? 'out' : 'in').then(() => { if (!on) burst.visible = false; });
  }

  /* 6 friends on the 6 seats: one for every sound (m a s t) + 2 more — at least one c/d/f friend, the other any of
     the rest (the second m or t friend, or another c/d/f) */
  function setupPlushes() {
    for (const p of Object.values(G.all)) { if (p.root.parent) p.root.parent.remove(p.root); p.hold(false); p.st.cheer = 0; p.excite(0); }
    claw.setHolding(false);
    const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);
    const fixed = qs.get('kinds');
    let kinds;
    if (fixed) kinds = fixed.split(',');
    else {
      const m2 = shuffle(POOL.m), t2 = shuffle(POOL.t), o = shuffle(OTHERS);
      kinds = [m2[0], 'ant', 'seal', t2[0], o[0], shuffle([m2[1], t2[1], ...o.slice(1)])[0]];
      kinds = shuffle(kinds);
    }
    /* every friend must fit its seat: the left front seat is next to the prize chute and the outer seats are next to
       the glass — the wide turtle (and fish) reached into the chute (user: "거북이 일때는 인형빠지는 영역을 침범해").
       A friend that doesn't fit swaps seats with one that fits there (the seats themselves stay where they are);
       failing that, it moves in just enough. */
    const CH = machine.chute.box, WALL = machine.W / 2 - 0.02;
    const lim = (s) => ({ lo: s.row === 'front' && s.x < CH.x1 + 1.5 ? CH.x1 + 0.03 : -WALL, hi: WALL });
    const over = (k, s) => { const p = G.all[k]; if (!p || !s) return 0; const L = lim(s);
      return Math.max(0, L.lo - (s.x + p.span[0] * PS)) + Math.max(0, s.x + p.span[1] * PS - L.hi); };
    const seats = machine.slots;
    for (let i = 0; i < seats.length; i++) {
      if (!over(kinds[i], seats[i])) continue;
      let best = -1;
      for (let j = 0; j < seats.length; j++) if (j !== i && !over(kinds[i], seats[j]) && !over(kinds[j], seats[i])) { best = j; break; }
      if (best >= 0) [kinds[i], kinds[best]] = [kinds[best], kinds[i]];
    }
    G.inMachine = [];
    machine.slots.forEach((s0, i) => {
      const p = G.all[kinds[i]];
      if (!p) return;
      const L = lim(s0), x = Math.min(L.hi - p.span[1] * PS, Math.max(L.lo - p.span[0] * PS, s0.x));
      const s = { ...s0, x };
      p.root.position.set(s.x, s.y, s.z);
      p.root.rotation.set(0, 0, 0);                    // the picture turns to the camera by itself
      p.root.scale.setScalar(PS);
      p.home = { x: s.x, y: s.y, z: s.z, ry: p.root.rotation.y };
      p.x = s.x; p.z = s.z;
      machine.group.add(p.root);
      G.inMachine.push(p);
    });
  }
  function buildTray() {
    $('#tray').innerHTML = LETTERS.map(() => '<div class="slot"></div>').join('');
  }

  /* ── layout: CSS variables from the 3D machine (HTML bits hang round it) ─────────────────────────── */
  function layout(w, h) {
    if (!machine) return;
    const M = machine, top = M.H + 1.02, zf = M.D / 2 + 0.1 + 0.39;
    const L = S.project(V(-(M.W + 0.95) / 2, top, zf)), R = S.project(V((M.W + 0.95) / 2, top, zf)), C = S.project(V(0, top, zf));
    const mw = R.x - L.x, mu = mw / 125.07;
    curMu = mu;
    const st = app.style;
    st.setProperty('--mx', C.x + 'px'); st.setProperty('--mt', C.y + 'px'); st.setProperty('--mu', mu + 'px');
    // the START canvases at the size they show — on the title only: the camera's push-in into the game changes mu, and
    // a rebuild of the (hidden) START mid-move was a hitch
    if (G.screen === 'title') fitStart(mu);
    if (G.target && G.screen === 'game') { const cv = targetJelly(G.target); if ($('#tgLetter').firstChild !== cv) $('#tgLetter').replaceChildren(cv); }
    const d = S.project(M.dropPoint()), j = S.project(M.joyPoint());
    st.setProperty('--dropX', d.x + 'px'); st.setProperty('--dropY', Math.min(h - 10 * mu, d.y) + 'px');
    st.setProperty('--joyX', j.x + 'px'); st.setProperty('--joyY', j.y + 'px');
    // the 3D DOWN button's box on screen (for the invisible HTML button over it and the hint glove)
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const v of M.downRim()) { const q = S.project(v); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    st.setProperty('--downX', (x0 + x1) / 2 + 'px'); st.setProperty('--downY', (y0 + y1) / 2 + 'px');
    st.setProperty('--downW', x1 - x0 + 'px'); st.setProperty('--downH', y1 - y0 + 'px');
  }

  /* ── per frame ──────────────────────────────────────────────────────────────────────────────────── */
  let trailT = 0;
  function tick(dt, t) {
    machine.tick(dt, t);
    for (const p of Object.values(G.all)) if (p.root.parent) p.update(dt, t);
    if (window.Poses && !G.busy && (G.screen === 'title' || G.screen === 'game')) Poses.idle(dt, G.inMachine);   // now and then a friend poses
    // 'wiggle' hint: the 3D stick tilts with the glove's drag (left at 20 %, right at 40 %, back at 50 % of its run)
    if (JOY_HINT === 'wiggle' && hintAnim && hintAnim.playState === 'running' && !G.joy) {
      const q = Math.min(1, (hintAnim.currentTime || 0) / 3600), e = q * q * (3 - 2 * q);
      const tilt = e < 0.2 ? -e / 0.2 : e < 0.4 ? -1 + (e - 0.2) / 0.1 : e < 0.5 ? 1 - (e - 0.4) / 0.1 : 0;
      machine.setJoy(tilt * 0.85);
    }
    // the balls round the friends in the pit bounce with their hops (balls.friends)
    machine.balls.friends(G.inMachine.filter(p => p.home && p.home.y < 0.6 && p.root.parent === machine.group).map(p => ({
      x: p.root.position.x, z: p.root.position.z, ek: p.st.ek * (1 - p.st.hk), ck: p.st.ck * (1 - p.st.hk), ph: p.phase, r: p.width * PS * 0.36 })), t);
    // the claw follows the aim (title: wanders)
    if (G.screen === 'title' && !G.busy) G.aimX = Math.sin(t * 0.45) * 2.4;
    if (!G.busy && (G.screen === 'title' || G.screen === 'game')) {
      const k = G.keys.r - G.keys.l + G.joy;
      if (k) { G.aimX += k * 2.2 * dt; G.idle = 0; }
      G.aimX = Math.max(machine.X_MIN, Math.min(machine.X_MAX, G.aimX));
      const dx = G.aimX - claw.x, maxV = 2.8 * dt;
      const nx = claw.x + Math.max(-maxV, Math.min(maxV, dx * Math.min(1, dt * 9)));
      const moving = Math.abs(nx - claw.x) > 0.0015;
      claw.set(nx, claw.y, lerp(claw.z, 0.15, Math.min(1, dt * 3)));
      if (G.screen === 'game') {
        A.motor(moving, 1);
        if (moving && (trailT -= dt) < 0) { trailT = 0.05; const p = S.project(claw.holdWorld()); FX.sparkle(p.x, p.y - 20, 1, 3); }
      }
    }
    // who's under the claw: it looks up and bounces; the spotlight falls on it
    const cand = G.screen === 'game' && !G.busy ? candidate() : null;
    const zone = cand ? aimZone(cand) : 'none';
    for (const p of G.inMachine) {
      const on = p === cand;
      p.excite(on ? (zone === 'hold' ? 1 : 0.3) : 0);  // it bounces only when the claw is right over it
      if (G.screen === 'game' && !G.busy) p.lookAt(on || Math.abs(p.x - claw.x) < 1.6 ? claw.holdWorld() : null);
      else if (!G.busy) p.lookAt(null);
    }
    // (where the claw would go down, not the friend's middle: bright right over it, dim a little off)
    // (r: the light's width on the floor — a little wider than the friend, user: "선택 빛이 좀더 넓은게")
    spot.update(dt, cand ? { x: claw.x, z: cand.z, floorY: cand.root.position.y, r: cand.width * PS * 1.3,
      level: zone === 'hold' ? 1 : zone === 'weak' ? 0.45 : 0.2, friend: cand } : null);
    // the DOWN button glows and throbs while the claw is right over a friend (no "DOWN!" words over the pit any more —
    // user: "이것도 빼줘")
    if (G.screen === 'game' && !G.busy) {
      G.idle += dt;
      if (G.interacted && G.target && G.idle >= IDLE.after && t - idleT >= IDLE.every && !NOHINT) { idleT = t; idleHelp(); }
      $('#drop').classList.toggle('ready', zone === 'hold'); machine.setDown({ ready: zone === 'hold' });
    }
    // the round's clock
    if (G.timerOn) {
      G.time = Math.max(0, G.time - dt);
      const sec = Math.ceil(G.time);
      if (sec !== G.shownSec) {
        G.shownSec = sec; $('#time').textContent = sec + 's';
        $('#timeBox').classList.toggle('low', sec <= 10);
        if (sec <= 10 && sec > 0) A.sfxPlay('tick');
        const hand = document.getElementById('watchHand');
        if (hand) hand.setAttribute('transform', `rotate(${(1 - G.time / ROUND_SEC) * 360} 32 36)`);
      }
      if (G.time <= 0) { G.timerOn = false; timeUp(); }
    }
    if (burst.visible) { burst.lookAt(S.camera.position); burst.userData.disc.rotation.z += dt * 0.45; }
    FX.tick(dt);
  }
  function candidate() {
    let best = null, bd = AIM.reach;
    for (const p of G.inMachine) { const d = Math.abs(p.x - claw.x); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function aimZone(p) {
    const d = Math.abs(claw.x - p.x);
    return d <= AIM.hold ? 'hold' : d <= AIM.weak ? 'weak' : d <= AIM.reach ? 'knock' : 'none';
  }
  /* where the claw holds a 3D friend: round its NECK, just under its head (user: "인형잡을때 집게가 목을 제대로 잡힌게
     보여야해") — the tips close in at the narrowest row under the head (friends.js neckY), pressing it in a little (the
     pinch in plushDeform), so the head rests on them; the hub stops over the crown (never into it — a head taller than
     the prongs reach is held a little higher, at the jaw). `loose` (world): the friend sits that far off the claw's
     middle (a loose grip): the prongs close that much less, so the far tip doesn't touch. Side-view friends have no neck
     the side prongs could reach (GRIP_FIX: height as a fraction of the friend, `squeeze` = press the body in front of
     the prongs where it's wider than they close). Returns y (scale 1, the grip height), r (the tips' radius, world),
     a (the prongs' angle), hub (the hub top over the friend's root, world). */
  const PINCH = 0.12;                                   // (friends.js plushDeform: the neck pinched by 12 % under the tips)
  const SINK = 0.09;                                    // how far the hub may press into a soft crown (friends.js uDent)
  /* side-view friends have no neck the side prongs could reach from the left and right (they'd close on the turtle's
     head and the back of its shell, on the fish's lips and tail): they're held round the top, where the body is narrow
     enough — the turtle round the top of its shell, just behind its head (picked up by the shell); the fish round its
     back, at the root of its top fin — the tips pressing in (squeeze). The turkey's fan stands round its neck in the
     prongs' plane: its neck's width is taken in front of the fan (r: the neck's half-width, scale 1). */
  const GRIP_FIX = { fish: { y: 0.7, squeeze: true }, turkey: { r: 0.19 } };   // (the redrawn turtle stands up: it has a neck)
  function gripOf(p, loose = 0) {
    const fix = GRIP_FIX[p.kind] || {};
    let y = fix.y ? fix.y * p.top : p.neckY, r = 0, a = claw.SHUT, hub = 0;
    const half = (yy) => (fix.r || Math.max(p.widthMid(yy), p.widthAt(yy))) * PS;
    const crown = Math.max(p.topAt(-claw.HUB_R / PS), p.topAt(0), p.topAt(claw.HUB_R / PS)) * PS;
    for (let it = 0; it < 4; it++) {
      r = Math.min(claw.tipR(claw.OPEN) - 0.04, half(y) * (1 - (fix.squeeze ? 0.15 : PINCH)) + claw.TIP_R * 0.92 + loose);
      a = claw.angleForTip(r);
      hub = Math.max(y * PS + claw.tipDrop(a), crown + claw.HUB_DROP - SINK);
      const yt = (hub - claw.tipDrop(a)) / PS;            // (raised over the crown: the tips sit that much higher)
      if (yt - y < 0.004) break;
      y = yt;
    }
    return { y, r, a, hub, squeeze: !!fix.squeeze };
  }
  /* a knock (the claw comes down beside the head): the hub stops where the open prong on the friend's side rests on the
     top of its head (world, over the root) */
  function knockHub(p, off) {
    const s = Math.sign(off) || 1, tip = off - s * claw.tipR(claw.OPEN);
    let top = 0;
    for (let k = -1; k <= 1; k++) top = Math.max(top, p.topAt((tip + k * claw.TIP_R) / PS));
    let hub = top * PS + claw.tipDrop(claw.OPEN) + claw.TIP_R;
    for (let x = off - claw.HUB_R; x <= off + claw.HUB_R; x += 0.04) hub = Math.max(hub, p.topAt(x / PS) * PS + claw.HUB_DROP + 0.015);
    return hub;
  }

  /* ── input ──────────────────────────────────────────────────────────────────────────────────────── */
  function bindInput() {
    // the how-to demo plays by itself: meanwhile only SKIP (and sound / exit) answer — a touch would steer its claw
    const demoOnly = e => { if (G.demo && !(e.target.closest && e.target.closest('#btnSkip, #btnSound, #btnExit'))) e.stopPropagation(); };
    for (const t of ['pointerdown', 'click', 'keydown']) window.addEventListener(t, demoOnly, true);
    // the first touch on the title: music + "Hi, friends! Welcome to Toy Catch! … Press start to play!"
    let greeted = false;
    const firstTouch = (e) => {
      A.unlock();
      if (greeted || G.screen !== 'title' || G.busy) return;
      A.startBgm();
      if (e.target.closest && e.target.closest('#btnFriends, #myFriends')) return;   // (MY FRIENDS has its own sounds: the hello waits)
      greeted = true;
      if (!(e.target.closest && e.target.closest('#start'))) A.seq(['t:hello', 200, 't:pressstart']);
    };
    window.addEventListener('pointerdown', firstTouch, { capture: true });
    const lt = $('#btnLang');
    const showLang = () => { lt.dataset.l = A.lang; lt.setAttribute('aria-pressed', A.lang === 'ko'); lt.querySelectorAll('.flag').forEach(f => f.classList.toggle('on', f.dataset.l === A.lang)); };
    showLang();
    lt.addEventListener('click', () => { A.setLang(A.lang === 'ko' ? 'en' : 'ko'); showLang(); A.sfxPlay('tap'); A.stopVoice(); A.say('t:pressstart'); });
    $('#start').addEventListener('click', () => { A.unlock(); startGame(); });
    $('#drop').addEventListener('click', () => drop());
    $('#btnSkip').addEventListener('click', () => skipGuide());
    $('#tgSnd').addEventListener('click', () => { if (G.screen === 'game' && G.target) { G.idle = 0; sayTarget(); } });
    $('#btnSound').addEventListener('click', () => { A.setMuted(!A.muted); app.classList.toggle('muted', A.muted); });
    app.classList.toggle('muted', A.muted);
    $('#btnExit').addEventListener('click', () => {
      if (G.screen === 'title') { if (history.length > 1) history.back(); return; }
      goTitle();
    });
    $('#btnAgain').addEventListener('click', () => startGame(true));
    $('#btnHome').addEventListener('click', () => goTitle());
    $('#btnFriends').addEventListener('click', openFriends);
    $('#btnFriendsClose').addEventListener('click', closeFriends);
    // joystick: drag sideways
    const jh = $('#joyHit');
    jh.dataset.hint = JOY_HINT;
    let jp = null;
    jh.addEventListener('pointerdown', e => { if (G.screen !== 'game') return; jp = { id: e.pointerId, x: e.clientX }; try { jh.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ } interact(); e.preventDefault(); });
    jh.addEventListener('pointermove', e => { if (!jp || e.pointerId !== jp.id) return; const mu = parseFloat(app.style.getPropertyValue('--mu')) || 8; G.joy = Math.max(-1, Math.min(1, (e.clientX - jp.x) / (7 * mu))); machine.setJoy(G.joy); });
    const jend = e => { if (jp && e.pointerId === jp.id) { jp = null; G.joy = 0; machine.setJoy(0); } };
    jh.addEventListener('pointerup', jend); jh.addEventListener('pointercancel', jend);
    // drag / tap inside the machine: the claw follows the finger; a tap on a friend sends the claw over it
    const cv = $('#stage');
    let drag = null;
    const xAt = (cx, cy) => { const p = S.onPlane(cx, cy, new T.Plane(V(0, 0, 1), -0.15)); return p ? machine.group.worldToLocal(p).x : null; };
    cv.addEventListener('pointerdown', e => {
      if (G.screen !== 'game' || G.busy) return;
      // the first friend whose picture (not its see-through corner) is under the finger
      const hit = S.hits(e.clientX, e.clientY, G.inMachine.map(p => p.root)).find(h => { const q = h.object.userData.plush; return q && q.alphaAt(h.uv) > 80; });
      const p = hit ? hit.object.userData.plush : null;
      interact();
      if (p && p.pose) p.pose(0.85);                                                // (it answers the tap with its pose)
      if (p) { G.aimX = machine.group.worldToLocal(hit.point.clone()).x; A.sfxPlay('tap'); drag = null; return; }   // where it was tapped: aiming counts
      const x = xAt(e.clientX, e.clientY);
      const glassTop = S.project(V(0, machine.H, 0)).y, floorY = S.project(V(0, 0, machine.D / 2)).y;
      if (x == null || e.clientY < glassTop || e.clientY > floorY + 20) return;
      drag = { id: e.pointerId }; G.aimX = x;
      try { cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
    });
    cv.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id || G.busy) return; const x = xAt(e.clientX, e.clientY); if (x != null) G.aimX = x; G.idle = 0; });
    const cend = e => { if (drag && e.pointerId === drag.id) drag = null; };
    cv.addEventListener('pointerup', cend); cv.addEventListener('pointercancel', cend);
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      if ($('#myFriends').classList.contains('show')) { if (e.key === 'Escape') closeFriends(); return; }   // (START is under it)
      if (e.key === 'ArrowLeft' || e.key === 'a') { G.keys.l = 1; interact(); }
      else if (e.key === 'ArrowRight' || e.key === 'd') { G.keys.r = 1; interact(); }
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault(); A.unlock();
        if (G.screen === 'title') startGame(); else if (G.screen === 'game') drop(); else if (G.screen === 'result') startGame(true);
      }
    });
    window.addEventListener('keyup', e => { if (e.key === 'ArrowLeft' || e.key === 'a') G.keys.l = 0; if (e.key === 'ArrowRight' || e.key === 'd') G.keys.r = 0; });
  }
  function interact() { G.idle = 0; G.interacted = true; stopHint(); }

  /* ── flow ───────────────────────────────────────────────────────────────────────────────────────── */
  function setScreen(s) { G.screen = s; app.dataset.screen = s; machine.setDown({ show: s === 'game' }); }
  function setDrop(on) { $('#drop').classList.toggle('off', !on); machine.setDown({ on }); }
  const sleep = ms => S.wait(ms);
  function dolly(to, ms) {
    const from = S.frame.push;
    return S.tween(ms, k => { S.frame.push = lerp(from, to, k); S.resize(); }, 'inOut');
  }

  async function startGame(again) {
    if (G.busy && G.screen !== 'result') return;
    if (G.screen === 'game') return;
    const tok = ++G.tok;
    G.busy = true;
    S.shotReset(); machine.prizeDoor.flap = 0; machine.prizeDoor.lit = false; app.classList.remove('shot');
    A.unlock(); A.startBgm();
    A.stopVoice();
    app.classList.add('inserting');                     // (not 'coin': that's the intro coins' class — it shrank the whole app into a coin)
    if (again) { setScreen('title'); await sleep(250); setupPlushes(); claw.set(claw.x, claw.HOME_Y, claw.z); }   // (already 'inserting': no START / EN-한 toggle blink)
    // the camera comes in to the coin slot while the coin flips in and drops into it, then goes back (user: the camera
    // moves only between scenes — this, the prize door, the prize; never while aiming)
    app.classList.add('shot');
    S.shotTo(slotShot(), 750, tok);
    const slot = machine.slotPoint(), coin = machine.coin;
    const sp = slot.clone(), local = machine.group.worldToLocal(sp.clone());
    coin.visible = true;
    await S.tween(900, k => {
      const y = local.y + 1.4 * (1 - k) + 0.12, z = local.z + 0.35 * (1 - k);
      coin.position.set(local.x, y, z); coin.rotation.set(Math.PI / 2, 0, k * Math.PI * 6); coin.scale.setScalar(1.6 - 0.6 * k);
      if (Math.random() < 0.5) { const p = S.project(machine.group.localToWorld(coin.position.clone())); FX.sparkle(p.x, p.y, 1, 2); }
    }, 'in', tok);
    if (tok !== G.tok) return;
    A.sfxPlay('coin');
    const p = S.project(slot); FX.sparkle(p.x, p.y, 14, 4); FX.stars(p.x, p.y, 8, 0.55);   // (a coin-sized pop)
    await S.tween(220, k => { coin.position.y = local.y + 0.12 - 0.2 * k; coin.scale.setScalar(1 - 0.4 * k); }, 'in', tok);
    coin.visible = false;
    machine.setScreen(['INSERTED!', 'READY TO PLAY!'], '#ffd23f');
    machine.chase(2.5); A.sfxPlay('insert');
    A.say('t:ready');
    await sleep(500);
    if (tok !== G.tok) return;
    S.shotTo(null, 800, tok); setTimeout(() => app.classList.remove('shot'), 450);
    app.classList.remove('inserting');
    setScreen('game');
    G.score = 0; G.caught = []; G.round = -1; G.tries = 0; G.miss = 0; G.interacted = false; G.demoRan = false;   // (the round-1 guide again)
    G.stats = { goes: 0, wrong: 0, misses: 0, t0: performance.now(), saved: false };
    resetScore();
    setTimeout(() => { if (tok === G.tok) addScore(COINS.start); }, 500);   // this game's coins come in as the HUD shows
    buildTray();
    const order = (qs.get('order') || '').split(',').filter(x => LETTERS.includes(x));
    G.targets = order.length ? order : LETTERS.slice().sort(() => Math.random() - 0.5);
    G.aimX = 0;
    await dolly(1, 1000);
    if (tok !== G.tok) return;
    if (!G.taught && !NOHINT) return teachDemo(tok);     // the first game of a visit: the glove plays one go first, then round 1
    nextRound(tok);
  }

  async function nextRound(tok) {
    G.round++;
    if (G.round >= G.targets.length) return finish(tok);
    G.target = G.targets[G.round]; G.tries = 0; G.miss = 0; G.time = ROUND_SEC; G.shownSec = -1;
    machine.setScreen(['FIND', G.target.toUpperCase() + ' ' + G.target], '#ff8fd0');
    setTarget(G.target);
    [...$('#tray').children].forEach((s, i) => s.classList.toggle('now', i === G.caught.length && i === G.round - (G.round - G.caught.length)));
    $('#timeBox').classList.remove('low');
    $('#time').textContent = ROUND_SEC + 's';
    showPrompt($('#go'), 'GO!', 'yellow', 19);
    A.sfxPlay('pop');
    await announce(G.target);
    if (tok !== G.tok) return;
    G.busy = false; G.timerOn = TIMER; G.idle = 0; setDrop(true);
    if (G.round === 0 && !G.interacted && !NOHINT && !G.demoRan) runHint(tok);   // (not right after the how-to demo: it just showed this)
  }
  function setTarget(L) {
    const up = L.toUpperCase();
    // the letters and the speaker button as one set: jelly letters straight on the blue pill (no plate of their own —
    // a pale plate inside the pill looked pasted on) and the button in the same jelly, the letters' colour (user:
    // "전체적인 박스와 글자와 버튼이 이질감이 없게")
    const pal = JELLY[LETTER_JELLY[L] || 'pink'];
    const cv = targetJelly(L);
    $('#tgLetter').replaceChildren(cv); $('#tgLetter').setAttribute('aria-label', up + L);
    ['--jt', '--jm', '--jl', '--jb', '--js', '--jd', '--jg'].forEach((k, i) => $('#target').style.setProperty(k, pal[i]));
    const tg = $('#target'); tg.classList.remove('swap'); void tg.offsetWidth; tg.classList.add('swap');
    const le = $('#tgLetter'); le.classList.remove('pop'); void le.offsetWidth; le.classList.add('pop');
  }
  /* the speaker button: it bounces and the round's sound plays again */
  function sayTarget() {
    const b = $('#tgSnd'); b.classList.remove('play'); void b.offsetWidth; b.classList.add('play');
    return announce(G.target, true);
  }
  /* "Catch a friend that starts with /m/" (Korean: "/m/ 소리로 시작하는 친구를 뽑아 봐!") */
  async function announce(L, again) {
    A.stopVoice();
    if (A.lang === 'ko') return A.seq([`s:${L}`, 't:find']);
    return A.seq(['t:find', `s:${L}`, again ? null : 250, again ? null : `s:${L}`]);
  }

  async function drop() {
    if (G.screen !== 'game' || G.busy) return;
    const tok = G.tok;
    G.busy = true; G.timerOn = false; if (!G.demo) interact(); setDrop(false);   // (the demo's go isn't the child's touch)
    if (G.stats) G.stats.goes++;
    $('#timeBox').classList.add('paused');
    const btn = $('#drop'); btn.classList.add('press'); setTimeout(() => btn.classList.remove('press'), 150); machine.pressDown();
    A.sfxPlay('tap');
    await insertCoin(tok);                               // a go costs a coin: it goes into the slot, then the claw moves
    if (tok !== G.tok) return;
    const cand = candidate();
    const zone = cand ? aimZone(cand) : 'none';
    const off = cand ? claw.x - cand.x : 0;              // the claw's offset from the head's middle
    const x0 = claw.x, z0 = claw.z, g0 = claw.grip;
    const tx = claw.x, tz = cand ? cand.z : claw.z;      // straight down where it was aimed (into the friend's row)
    /* the claw closes round the friend's neck (gripOf): the tips at the narrowest row under its head, the hub stopping
       over its crown. A knock: the prong on its side comes down onto its head — the hub stops where that open tip meets
       the top of the head (never into it) */
    let shut = claw.SHUT, yBot = 1.45;
    if (cand && cand.neckY != null) {
      const g = gripOf(cand, zone === 'weak' ? Math.abs(off) * 0.5 : 0);
      cand.setGrip3d(g.y, g.squeeze ? g.r / PS : 0);
      shut = g.a; yBot = cand.root.position.y + g.hub;
      if (zone === 'knock') yBot = cand.root.position.y + knockHub(cand, off);
    } else if (cand) {
      // (a flat / puffed picture: the knuckles round the head's middle, as before)
      const hx = cand.headR[0] * PS, hy = cand.headR[1] * PS;
      shut = claw.gripAngle(hx * 1.02);
      const yHead = cand.root.position.y + cand.gripY * PS;
      yBot = Math.max(yHead + claw.knuckleDrop(shut), yHead + hy + 0.03);
    }
    if (cand) { cand.lookAt(claw.holdWorld()); cand.excite(zone === 'hold' ? 1 : 0.4); }
    if (cand && cand.poseStop) cand.poseStop();                                       // (no pose under the prongs)
    A.motor(true, 0.8);
    await S.tween(1300, k => {
      const kk = Math.min(1, k * 1.7);
      claw.set(lerp(x0, tx, kk), lerp(claw.HOME_Y, yBot, k), lerp(z0, tz, kk));
      claw.setGrip(lerp(g0, claw.OPEN, Math.min(1, k * 2.2)));
    }, 'inOut', tok);
    A.motor(false);
    if (tok !== G.tok) return;
    A.sfxPlay('grab');
    // the prongs dive into the balls (a friend in the front row, or nothing): they splash; on the shelf just a little
    machine.balls.splash(tx, tz, cand && cand.home.y > 0.6 ? 0.45 : 1);
    if (zone === 'knock') {
      // a prong comes down on the side of its head: it gets shoved away and rocks on its bottom; the claw recoils up off
      // it as it snaps shut on nothing, its prongs rattling (and swings on its cable on the way up — not down here,
      // where a swing would carry the prongs back through the friend's head)
      A.sfxPlay('boing');
      const x1 = cand.x, dir = Math.sign(cand.x - claw.x) || 1, yK = claw.y;
      cand.nope(0.9, dir, 1.5); claw.wobble(0, -dir, 1);
      S.tween(700, k => { cand.root.position.x = x1 + dir * 0.16 * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - 0.5 * k); }, 'out', tok)
        .then(() => { cand.root.position.x = x1; });
      await S.tween(360, k => { claw.setGrip(lerp(claw.OPEN, claw.SHUT, k)); claw.set(claw.x, yK + 0.3 * k, claw.z); }, 'out', tok);
    } else {
      // closing prongs push the head toward the middle: all the way when it was right over it, half way on a loose grip
      const x1 = cand ? cand.x : 0, x2 = cand ? (zone === 'hold' ? claw.x : cand.x + off * 0.5) : 0;
      if (cand) cand.excite(0);                                                          // (held now: no more hops)
      await S.tween(360, k => { claw.setGrip(lerp(claw.OPEN, shut, k)); if (cand) cand.root.position.x = lerp(x1, x2, k); }, 'out', tok);
      if (!cand) claw.wobble(0.3, claw.x > 0 ? -1 : 1, 1);                               // shut on nothing: a rattle
    }
    if (tok !== G.tok) return;
    const held = cand && zone !== 'knock' ? cand : null;
    if (held) attach(held);
    await sleep(120);
    if (tok !== G.tok) return;
    // a loose grip: it tips toward the open side on the way up and, unless the luck (or two misses in a row) holds it,
    // slips out part way
    const loose = zone === 'weak';
    const slips = loose && G.miss < 2 && G.rand() < 0.35 + 0.5 * (Math.abs(off) - AIM.hold) / (AIM.weak - AIM.hold);
    const kSlip = 0.3 + G.rand() * 0.35, side = -Math.sign(off) || 1;
    let slipping = null, swung = !!held;
    const yUp = claw.y;                                  // (a knock recoiled a little higher already)
    A.motor(true, 1.2);
    if (held && held.home.y < 0.6) setTimeout(() => machine.balls.splash(tx, tz, 0.6), 160);   // lifted out of the balls
    await S.tween(1200, k => {
      claw.set(tx, lerp(yUp, claw.HOME_Y, k), tz);
      if (loose && held && !slipping) held.tilt = side * (slips ? 0.4 * Math.min(1, k / kSlip) : 0.14 * Math.sin(k * Math.PI * 3));
      if (slips && !slipping && k >= kSlip) slipping = slip(held, side, tok);
      // empty, it swings on its cable on the way up (user: "놓쳤을때는 집게도 흔들흔들 해야해"), once it's clear of the friends
      if (!swung && k > (zone === 'knock' ? 0.3 : 0.18)) { swung = true; claw.wobble(zone === 'knock' ? 0.75 : 0.8, cand ? Math.sign(claw.x - cand.x) || 1 : claw.x > 0 ? -1 : 1, 0); }
    }, 'inOut', tok);
    A.motor(false);
    if (held && !slips) held.tilt = 0;
    if (slipping) await slipping;
    if (tok !== G.tok) return;
    if (G.demo) return slips ? null : held;              // the how-to demo takes it from here (teachDemo): no reward, no record
    if (!held || slips) {
      G.miss++; if (G.stats) G.stats.misses++;
      if (!cand) { A.sfxPlay('whiff'); await A.say('t:miss'); }
      else if (zone === 'knock') { A.sfxPlay('whiff'); await A.say('t:center'); }
      else await A.say('t:slip');
      if (tok !== G.tok) return;
      claw.setGrip(claw.OPEN * 0.55);
      return resume(tok);
    }
    G.miss = 0;                                       // a good grab: the next loose grip takes its chances again
    if (cand.sound === G.target) await correct(cand, tok);
    else { if (G.stats) G.stats.wrong++; await wrong(cand, tok); }
  }
  /* it slips out of a loose grip: tips over, drops back onto its seat with a bounce, and wobbles */
  async function slip(p, side, tok) {
    A.sfxPlay('slip');
    const g0 = claw.grip;
    S.tween(220, k => claw.setGrip(lerp(g0, claw.OPEN * 0.45, k)), 'out');
    claw.wobble(1.0, -side, 0.7);                       // the weight's gone: the claw swings back the other way
    detach(p);
    const from = p.root.position.clone(), t0 = p.tilt;
    await S.tween(650, k => {
      p.root.position.set(lerp(from.x, p.home.x, k), lerp(from.y, p.home.y, S.EASE.bounce(k)), lerp(from.z, p.home.z, k));
      // (the loose grip's lean eases out on the way down: it used to stay till the landing and snap upright there)
      p.tilt = t0 * (1 - k) + side * 0.9 * Math.sin(Math.PI * Math.min(1, k * 1.25));
    }, 'linear', tok);
    p.tilt = 0;
    A.sfxPlay('thud'); p.nope(0.8, side); machine.balls.splash(p.home.x, p.home.z, 0.9); if (p.bump) p.bump(0.7);   // lands: squash
    p.root.position.set(p.home.x, p.home.y, p.home.z); p.x = p.home.x;
    if (!G.inMachine.includes(p)) G.inMachine.push(p);
  }
  function attach(p) {
    claw.swing.attach(p.root);                      // keeps where it is: the claw came down right over it
    const rq = p.root.quaternion.clone(), q0 = new T.Quaternion();
    S.tween(300, k => p.root.quaternion.slerpQuaternions(rq, q0, k), 'out');
    p.hold(true); p.lookAt(null); p.excite(0); claw.setHolding(true);
    if (p.bump) p.bump(-0.4);                       // pulled up by its head: a little stretch, then it settles
    G.inMachine = G.inMachine.filter(o => o !== p);
  }
  function detach(p) { machine.group.attach(p.root); p.hold(false); claw.setHolding(false); }
  function resume(tok) {
    if (tok !== G.tok) return;
    if (G.score <= 0) return outOfCoins(tok);          // that was the last coin
    G.busy = false; G.timerOn = TIMER && G.time > 0; G.idle = 0; setDrop(true);
    $('#timeBox').classList.remove('paused');
    G.aimX = claw.x;
  }
  function plushScreen(p, dy = 0) { return S.project(p.root.getWorldPosition(V(0, 0, 0)).add(V(0, p.gripY + dy, 0))); }

  async function correct(p, tok) {
    const sp = plushScreen(p);
    FX.confetti(sp.x, sp.y, 130); FX.stars(sp.x, sp.y, 16);
    A.sfxPlay('fanfare'); machine.chase(3.5);
    for (const o of G.inMachine) o.cheer(2.6);
    p.cheer(3);
    addScore(COINS.win, sp);                             // a coin back: it pops out of the friend and flies into your coins
    const fw = () => { const r = S.project(V(lerp(-3, 3, Math.random()), lerp(2.4, 3.8, Math.random()), 0)); FX.firework(r.x, r.y); A.sfxPlay('pop'); };
    fw(); setTimeout(fw, 350); setTimeout(fw, 700);
    await A.say('t:great3');
    if (tok !== G.tok) return;
    // to the chute: up and forward over the front row first, then along the front to the left corner — only as far left
    // as keeps the whole friend inside the glass (the turtle's head and the fish's lips went through the left wall)
    A.motor(true, 1.1);
    const x0 = claw.x, z0 = claw.z, ch = machine.chute, lane = machine.FRONT_LANE;
    const dxr = p.root.getWorldPosition(V(0, 0, 0)).x - claw.head.getWorldPosition(V(0, 0, 0)).x;
    const inGlass = (s) => -machine.W / 2 + 0.04 - p.span[0] * s;              // (the root's leftmost x at scale s)
    const chx = Math.max(ch.x, inGlass(PS) - dxr);
    await S.tween(650, k => claw.set(x0, lerp(claw.HOME_Y, claw.CARRY_Y, k), lerp(z0, lane, k)), 'inOut', tok);
    await S.tween(1100, k => claw.set(lerp(x0, chx, k), claw.CARRY_Y, lerp(lane, ch.z, k)), 'inOut', tok);
    A.motor(false);
    if (tok !== G.tok) return;
    A.sfxPlay('open');
    const g0 = claw.grip;
    S.tween(300, k => claw.setGrip(lerp(g0, claw.OPEN * 0.7, k)), 'out');
    detach(p);
    const y0 = p.root.position.y, ry0 = p.root.rotation.y, xr0 = p.root.position.x;
    await S.tween(650, k => {
      const s = PS * (1 - 0.35 * k);
      p.root.position.y = lerp(y0, ch.floor, k); p.root.rotation.y = ry0 + k * 2.5; p.root.scale.setScalar(s);
      p.root.position.x = Math.max(lerp(xr0, ch.x, k), inGlass(s));                 // (into the middle of the chute as it shrinks)
    }, 'in', tok);
    A.sfxPlay('chute');
    // down to the prize door (user: "인형 뽑았을때 기계아래로 떨어지고 통에서 주워 올리는 효과"): the camera goes down to it
    // while the friend falls through the cabinet (inside it, out of sight), lands in the bin behind the flap and the flap
    // rattles; then the flap swings open and the friend comes up out of the bin to the player (prize). The camera moves
    // only here, between scenes — never while aiming.
    const pd = machine.prizeDoor;
    pd.lit = true; app.classList.add('shot');
    await S.shotTo(doorShot(), 650, tok);
    if (tok !== G.tok) return;
    const sIn = Math.min(PS * 0.62, pd.H * 0.82 / p.top, 1.15 / p.width);
    p.root.rotation.y = 0; p.root.scale.setScalar(sIn);
    p.root.position.set(pd.top.x, pd.top.y + 0.2, pd.z);                        // (behind the frame's top bar)
    await S.tween(360, k => { p.root.position.y = lerp(pd.top.y + 0.2, pd.floor, k); }, 'in', tok);
    if (tok !== G.tok) return;
    p.bump(0.7); pd.knock = 1; A.sfxPlay('thud');
    { const q = S.project(p.root.getWorldPosition(V(0, 0, 0))); FX.sparkle(q.x, q.y, 10, 3); }
    await S.wait(520);
    if (tok !== G.tok) return;
    pd.flap = 1; A.sfxPlay('open');                                             // taken out: the flap swings up
    await S.wait(220);
    if (tok !== G.tok) return;
    G.caught.push(p.kind); keepFriend(p.kind);          // (MY FRIENDS: one more of this friend)
    await prize(p, tok, true);
    pd.flap = 0; pd.lit = false;
    if (tok !== G.tok) return;
    G.aimX = 0;
    A.motor(true, 1);
    const cx = claw.x, cz = claw.z;
    await S.tween(900, k => claw.set(lerp(cx, 0, k), lerp(claw.CARRY_Y, claw.HOME_Y, k), lerp(cz, 0.15, k)), 'inOut', tok);
    A.motor(false);
    claw.setGrip(claw.OPEN * 0.55);
    nextRound(tok);
  }
  /* the prize pops out in front of the machine, big, with its word; then it flies into the tray */
  /* the camera's pose for the coin slot (bottom right of the panel): a little above it and from the left, close */
  function slotShot() {
    const look = machine.slotPoint().add(V(-0.35, 0.5, 0));
    const el = 16 * Math.PI / 180, yaw = -12 * Math.PI / 180, dist = 2.6 / (2 * Math.tan(S.camera.fov * Math.PI / 360));
    const pos = look.clone().add(V(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).multiplyScalar(dist));
    return { pos, look };
  }
  /* the camera's pose for the prize door: a little above and to the right of it, close enough that the door, the panel's
     edge over it and the chute's corner fill the screen */
  function doorShot() {
    const look = machine.group.localToWorld(machine.prizeDoor.look.clone());
    const el = 10 * Math.PI / 180, yaw = 9 * Math.PI / 180, dist = 3.5 / (2 * Math.tan(S.camera.fov * Math.PI / 360));
    const pos = look.clone().add(V(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).multiplyScalar(dist));
    return { pos, look };
  }
  /* fromDoor: it comes up out of the prize door's bin while the camera goes back up to the machine (S.shotTo(null)) —
     where it lands is worked out from the framed view (S.baseCam), not from the moving camera */
  async function prize(p, tok, fromDoor) {
    const cam = fromDoor ? S.baseCam() : S.camera;
    const at = (fx, fy, dist) => { const v = V(fx * 2 - 1, -(fy * 2 - 1), 0.5).unproject(cam); return cam.position.clone().add(v.sub(cam.position).normalize().multiplyScalar(dist)); };
    const s0 = fromDoor ? p.root.scale.x : 0.5;
    if (fromDoor) S.scene.attach(p.root); else S.scene.add(p.root);
    p.root.rotation.set(0, 0, 0); p.hold(false); p.cheer(3.5);
    const start = fromDoor ? p.root.position.clone() : machine.group.localToWorld(V(machine.chute.x, -0.6, machine.D / 2 + 1.2));
    const end = at(0.5, 0.56, 7.5);
    end.y -= 0.75;
    A.sfxPlay('prize');
    if (fromDoor) { S.shotTo(null, 850, tok); setTimeout(() => app.classList.remove('shot'), 450); }
    // a 3D friend spins once on the way out (its cap stays under the TARGET banner); a flat picture doesn't (its edge)
    const spin = p.is3d; if (spin) { p.faceCam = false; p.face.rotation.y = 0; }
    const face0 = Math.atan2(cam.position.x - end.x, cam.position.z - end.z);
    // (from the door: out toward the player first, under the panel's ledge, then up — a straight line went up through it)
    const ctrl = fromDoor ? machine.group.localToWorld(machine.group.worldToLocal(start.clone()).add(V(0, -0.3, 3.0))) : null;
    await S.tween(fromDoor ? 950 : 800, k => {
      let pos;
      if (fromDoor) { const u = 1 - k; pos = start.clone().multiplyScalar(u * u).addScaledVector(ctrl, 2 * u * k).addScaledVector(end, k * k); }
      else { pos = start.clone().lerp(end, k); pos.y += Math.sin(k * Math.PI) * 1.4; }
      p.root.position.copy(pos); p.root.scale.setScalar(lerp(s0, 1.4, fromDoor ? k * k : k));
      if (spin) p.root.rotation.y = face0 - (1 - k) * Math.PI * 2;
    }, fromDoor ? 'sine' : 'out', tok);
    p.root.lookAt(cam.position.x, p.root.position.y, cam.position.z);
    if (spin) { p.faceCam = true; p.bump(0.55); }    // lands in front of you: a squash
    if (p.pose) p.pose(1);                           // and does its signature pose, big (js/poses.js)
    const mid = p.root.position.clone().add(V(0, p.top * p.root.scale.y * 0.5, 0));
    burst.position.copy(mid).addScaledVector(mid.clone().sub(cam.position).normalize(), 0.9);
    burst.scale.setScalar(p.top * p.root.scale.y * 2.3);
    burstTo(true);
    const box = $('#prize'), wordEl = $('#prizeWord');
    wordEl.innerHTML = `<b>${p.word[0]}</b>${p.word.slice(1)}`;
    box.classList.add('show');
    const sp = S.project(p.root.position.clone().add(V(0, 1, 0)));
    FX.stars(sp.x, sp.y, 12, 1, 0.16); FX.rain(70);    // stars from round the friend (not on its face), candy dots raining
    const b = wordEl.querySelector('b');
    const bump = () => { b.classList.remove('say'); void b.offsetWidth; b.classList.add('say'); };
    bump(); await A.say(`s:${p.sound}`); await A.sleep(120);
    bump(); await A.say(`s:${p.sound}`); await A.sleep(150);
    wordEl.classList.add('all'); await A.say(`w:${p.word}`);
    await sleep(500);
    if (tok !== G.tok) { box.classList.remove('show'); burstTo(false); return; }
    box.classList.remove('show'); burstTo(false);
    // into the tray
    const slot = $('#tray').children[G.caught.length - 1];
    const sr = slot.getBoundingClientRect();
    const fly = document.createElement('img');
    fly.src = G.icons[p.kind];
    // the picture takes over at the friend's own size and place, in its own proportions, and shrinks to the slot's
    // picture (it used to start as a small square: the big friend popped into a little stretched sticker)
    const art = window.CLAW_FRIENDS && window.CLAW_FRIENDS[p.kind], ar = art && art.h ? art.w / art.h : 1;
    const pb = S.project(p.root.position.clone()), pt = S.project(p.root.position.clone().add(V(0, p.top * p.root.scale.y, 0)));
    const hh = Math.max(60, Math.hypot(pt.x - pb.x, pt.y - pb.y)), ww = hh * ar;
    const p0 = { x: (pb.x + pt.x) / 2, y: (pb.y + pt.y) / 2 };
    const endH = Math.min(sr.height, sr.width / ar) * 0.86;          // (css .tray .slot img: 86 %, contain)
    Object.assign(fly.style, { position: 'absolute', zIndex: 25, left: p0.x - ww / 2 + 'px', top: p0.y - hh / 2 + 'px', width: ww + 'px', height: hh + 'px', objectFit: 'contain', pointerEvents: 'none' });
    app.appendChild(fly);
    S.scene.remove(p.root);
    const anim = fly.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${sr.left + sr.width / 2 - p0.x}px, ${sr.top + sr.height / 2 - p0.y}px) scale(${endH / hh})` }], { duration: 650, easing: 'cubic-bezier(.5,0,.3,1)' });
    await anim.finished.catch(() => {});
    fly.remove();
    slot.innerHTML = `<img src="${G.icons[p.kind]}" alt="${p.word}">`; slot.classList.add('got'); slot.classList.remove('now');
    A.sfxPlay('sparkle');
  }

  async function wrong(p, tok) {
    A.sfxPlay('uhoh'); p.nope(1.4);
    const x0 = claw.x;
    S.tween(600, k => claw.set(x0 + Math.sin(k * Math.PI * 6) * 0.06 * (1 - k), claw.y, claw.z), 'linear');
    await A.say('t:uhoh');
    await A.say(`w:${p.word}`);
    if (tok !== G.tok) return;
    await A.seq(['t:startswith', `s:${p.sound}`]);   // ko: "첫소리는 /t/"
    if (tok !== G.tok) return;
    await putBack(p, tok);                               // it slips out of the claw and drops back onto its seat
    G.tries++;
    if (tok !== G.tok) return;
    await A.say('t:again');
    if (tok !== G.tok) return;
    await A.say(`s:${G.target}`);
    claw.setGrip(claw.OPEN * 0.55);
    resume(tok);
  }
  /* the friend in the claw slips out and drops back onto its seat (a wrong friend; the how-to demo's friend) */
  async function putBack(p, tok) {
    A.sfxPlay('open');
    const g0 = claw.grip;
    S.tween(250, k => claw.setGrip(lerp(g0, claw.OPEN * 0.6, k)), 'out');
    detach(p);
    const from = p.root.position.clone(), q0 = p.root.quaternion.clone(), qh = new T.Quaternion().setFromEuler(new T.Euler(0, p.home.ry, 0));
    await S.tween(800, k => {
      p.root.position.set(lerp(from.x, p.home.x, k), lerp(from.y, p.home.y, S.EASE.bounce(k)), lerp(from.z, p.home.z, k));
      p.root.quaternion.slerpQuaternions(q0, qh, Math.min(1, k * 1.5));
    }, 'linear', tok);
    if (tok !== G.tok) return;                           // (SKIP / Exit has put everyone back already)
    A.sfxPlay('thud'); machine.balls.splash(p.home.x, p.home.z, 0.9); if (p.bump) p.bump(0.7);   // lands: squash
    p.root.position.set(p.home.x, p.home.y, p.home.z);
    G.inMachine.push(p);
  }

  async function timeUp() {
    const tok = G.tok;
    G.busy = true; setDrop(false);
    A.sfxPlay('buzz');
    showPrompt($('#bigMsg'), 'TIME’S UP!', 'pink', 10.5);
    await A.say('t:timeup');
    const right = G.inMachine.filter(p => p.sound === G.target);
    right.forEach(p => p.cheer(2.4));
    for (const p of right.slice(0, 1)) { await A.seq([`s:${p.sound}`, `w:${p.word}`]); }
    await sleep(600);
    if (tok !== G.tok) return;
    nextRound(tok);
  }

  async function finish(tok) {
    G.busy = true; G.timerOn = false; setDrop(false);
    const n = G.caught.length;
    const all = n >= LETTERS.length;
    const stars = all ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0;
    saveProgress(tok, n, all, stars);                    // (the game is over now, even if Exit comes during the dolly)
    keepStars(tok, stars);
    const title = all ? 'PERFECT!' : n >= 2 ? 'GREAT JOB!' : 'NICE TRY!';
    const titleCv = resultTitle(title);                  // (drawn now, the first time, while nothing moves yet)
    await dolly(0, 900);
    if (tok !== G.tok) return;
    setScreen('result');
    [...$('#stars').children].forEach((s, i) => s.classList.toggle('on', i < stars));
    $('#resTitle').replaceChildren(titleCv); $('#resTitle').setAttribute('aria-label', title);
    // the score under the coins counts up once they've popped in
    const fs = $('#finalScore'), total = G.score;
    fs.textContent = '0'; fs.hidden = total <= 0;        // (the coins left: none after NO COINS — no big 0)
    setTimeout(() => { if (tok === G.tok) S.tween(900, k => { if (tok === G.tok) fs.textContent = Math.round(total * k); }, 'out'); }, 700);
    // (the word under each friend in navy, its first letter in that letter's jelly colour — the HUD target's)
    $('#caught').innerHTML = G.targets.map((L, i) => {
      const k = G.caught.find(kind => G.all[kind].sound === L);
      return k ? `<div class="slot got"><img src="${G.icons[k]}" alt=""><em style="--lc:${JELLY[LETTER_JELLY[L] || 'pink'][3]}"><b>${G.all[k].word[0]}</b>${G.all[k].word.slice(1)}</em></div>` : `<div class="slot">${L}</div>`;
    }).join('');
    machine.setScreen(['GREAT', 'JOB!'], '#ffd23f'); machine.chase(4);
    A.sfxPlay('win'); FX.rain(160);
    await A.say(all ? 't:allcaught' : 't:result');
    if (tok !== G.tok) return;
    await A.say('t:playagain');
    if (tok === G.tok) G.busy = false;                  // (PLAY AGAIN pressed during that line: the new game owns busy)
  }

  /* the shared progress record (phonics-kit phonics-progress.js, localStorage 'phonics.progress'): one entry per finished
     game — records only, Toy Catch has no levels to pick (user: "기록 저장만"). A game left with Exit isn't recorded. */
  function saveProgress(tok, n, all, stars) {
    const s = G.stats;
    if (!s || s.saved || tok !== G.tok || !window.PhonicsProgress) return;
    s.saved = true;
    try {
      PhonicsProgress.played('toy-catch', {
        stars,                                           // 0–3, as on the result card
        words: n,                                        // friends caught with the right sound = rounds cleared
        rounds: G.targets.length,
        won: all,
        score: G.score,                                  // coins left (the result card's number)
        goes: s.goes,                                    // claw goes = coins spent
        wrong: s.wrong,                                  // a friend with another first sound caught
        misses: s.misses,                                // goes that came up empty (nothing, a knock, a slip)
        outOfCoins: G.score <= 0,
        time: Math.round((performance.now() - s.t0) / 100) / 10,   // seconds, from the coins coming in to the end
      });
    } catch (e) { console.warn('progress', e); }
  }

  /* MY FRIENDS (user 2026-11-22: every game needs a place where the things you collect go): this device keeps how many
     times each target friend was caught and the stars — the best result and all of them together (localStorage
     'claw-friends': { got: { monkey: 2, … }, best: 0–3, stars }). The title's friends button (top left) opens it: the 6
     target friends, a caught one in colour with ×N (tap: "/m/ /m/ monkey", the prize's clips), not yet a silhouette with
     '?', and the best stars under them. A friend counts as it comes out of the prize door; the stars when a game ends. */
  const FRIENDS_KEY = 'claw-friends', TARGET_FRIENDS = LETTERS.flatMap(L => POOL[L]);
  const album = (() => {
    let a = null;
    try { a = JSON.parse(localStorage.getItem(FRIENDS_KEY) || 'null'); } catch (e) { /* storage off */ }
    a = a && typeof a === 'object' ? a : {};
    return { got: a.got && typeof a.got === 'object' ? a.got : {}, best: +a.best || 0, stars: +a.stars || 0 };
  })();
  function saveAlbum() { try { localStorage.setItem(FRIENDS_KEY, JSON.stringify(album)); } catch (e) { /* storage off */ } }
  function keepFriend(kind) { album.got[kind] = (album.got[kind] || 0) + 1; saveAlbum(); }
  function keepStars(tok, stars) {
    const s = G.stats;
    if (!s || s.starsKept || tok !== G.tok) return;
    s.starsKept = true;
    album.best = Math.max(album.best, stars); album.stars += stars; saveAlbum();
  }
  let mfRun = 0;
  function openFriends() {
    if (G.screen !== 'title' || app.classList.contains('inserting')) return;
    A.unlock(); A.sfxPlay('tap');
    $('#mfTitle').replaceChildren(resultTitle('MY FRIENDS'));
    $('#mfGrid').innerHTML = TARGET_FRIENDS.map(k => {
      const n = album.got[k] || 0, f = G.all[k];
      if (!n) return `<div class="mf-fr"><span class="slot"><img src="${G.icons[k]}" alt="" draggable="false"><b>?</b></span><em></em></div>`;
      return `<button class="mf-fr got" data-k="${k}" aria-label="${f.word} \u00d7${n}"><span class="slot"><img src="${G.icons[k]}" alt="" draggable="false">`
        + `<i class="mf-n">\u00d7${n}</i></span><em style="--lc:${JELLY[LETTER_JELLY[f.sound] || 'pink'][3]}"><b>${f.word[0]}</b>${f.word.slice(1)}</em></button>`;
    }).join('');
    $('#mfGrid').querySelectorAll('button.mf-fr').forEach(b => b.addEventListener('click', () => sayFriend(b)));
    $('#mfStars').innerHTML = $('#stars').innerHTML;    // (the result's coin-stars; the earned ones pop in)
    [...$('#mfStars').children].forEach((s, i) => s.classList.toggle('on', i < album.best));
    $('#myFriends').classList.add('show');
  }
  function closeFriends() { mfRun++; A.stopVoice(); A.sfxPlay('tap'); $('#myFriends').classList.remove('show'); }
  /* a caught friend, tapped: its sound twice and its word, as when it came out as a prize (it bumps with each) */
  async function sayFriend(b) {
    const f = G.all[b.dataset.k], run = ++mfRun;
    A.unlock(); A.stopVoice();
    for (const k of [`s:${f.sound}`, 120, `s:${f.sound}`, 150, `w:${f.word}`]) {
      if (run !== mfRun) return;
      if (typeof k === 'number') { await A.sleep(k); continue; }
      b.classList.remove('say'); void b.offsetWidth; b.classList.add('say');
      await A.say(k);
    }
  }

  function goTitle() {
    G.tok++; S.killTweens(); A.stopVoice(); A.motor(false);
    S.shotReset(); machine.prizeDoor.flap = 0; machine.prizeDoor.lit = false; app.classList.remove('shot');
    G.busy = false; G.timerOn = false; stopHint(); demoOff();
    $('#prize').classList.remove('show'); burst.visible = false; burst.userData.disc.material.opacity = 0;
    for (const p of Object.values(G.all)) { if (p.root.parent) p.root.parent.remove(p.root); }
    setupPlushes();
    claw.set(claw.x, claw.HOME_Y, 0.15); claw.setGrip(claw.OPEN * 0.55);
    machine.setScreen(['LEVEL 1', 'M A S T']);
    machine.coin.visible = false;
    resetScore();
    app.classList.remove('inserting');
    setScreen('title');
    S.frame.push = 0; S.resize();
  }

  /* the score (coins) goes up or down, with coins you can see move (user: "코인 차감되거나 코인 추가되는거 모션 구현은?"):
     points coming in = gold coins (the HUD coin's own picture) pop out of where they come from — the caught friend; at
     the start they pour in from the top — and fly into the HUD coin, the number going up as each one lands (a chink, the
     coin gulps; the pill bumps when the last is in); coins going (a go, a miss) = coins pop out of the HUD coin and fall
     away down the left edge (clear of the glass and the claw) while the number counts down and the pill shakes. The
     "+150" / "−20" tag still drops out under the pill. G.score changes at once (the game logic never waits for the
     show). from: a screen point, or nothing (= from the top). Returns the change (0 when there was nothing to take). */
  const shown = { v: 0, pend: 0, run: 0 };              // the HUD number = G.score less the coins still on their way in
  function showScore(v) { shown.v = v; $('#score').textContent = Math.round(v); }
  function countTo(ms) {
    const run = ++shown.run, a = shown.v;
    let t0 = -1;
    const step = now => {                                // (a frame's timestamp can be earlier than the event that started
      if (run !== shown.run) return;                     // the count: the clock starts at the first frame)
      if (t0 < 0) t0 = now;
      const k = Math.max(0, Math.min(1, (now - t0) / ms));
      showScore(lerp(a, G.score - shown.pend, 1 - (1 - k) * (1 - k)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function resetScore() {
    document.querySelectorAll('.fly-coin').forEach(e => e.remove());
    shown.pend = 0; shown.run++; showScore(G.score);
  }
  function scoreTag(d) {
    const box = $('#score').parentElement;
    box.querySelectorAll('.score-delta').forEach(t => t.remove());
    const tag = document.createElement('i');
    tag.className = 'score-delta' + (d > 0 ? '' : ' minus'); tag.textContent = (d > 0 ? '+' : '\u2212') + Math.abs(d);
    tag.setAttribute('aria-hidden', 'true');
    box.appendChild(tag); setTimeout(() => tag.remove(), 1500);
  }
  function scoreBox(cls) { const box = $('#score').parentElement; box.classList.remove('bump', 'minus'); void box.offsetWidth; box.classList.add(cls); }
  function addScore(n, from) {
    const a = G.score, b = Math.max(0, a + n);
    if (b === a) return 0;
    G.score = b;
    const d = b - a, still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (d > 0 && !still) { coinsIn(d, from); return d; }
    if (d < 0 && !still) coinsOut(-d);
    scoreBox(d > 0 ? 'bump' : 'minus'); scoreTag(d); countTo(d > 0 ? 700 : 450);
    return d;
  }
  /* the flying coin = the HUD coin's SVG as a picture (made once) */
  let coinSrc = '';
  function flyCoin(sz) {
    if (!coinSrc) coinSrc = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString($('.score .score-coin svg')));
    const el = document.createElement('img');
    el.className = 'fly-coin'; el.src = coinSrc; el.alt = ''; el.setAttribute('aria-hidden', 'true');
    el.style.width = el.style.height = sz + 'px';
    app.appendChild(el);
    return el;
  }
  function hudCoin() { const r = $('.score .score-coin').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.width }; }
  /* keyframes along fn(k) -> [x, y, scale, spin (0..1 = edge-on..face-on), opacity] for a coin of size sz */
  function coinKeys(fn, sz, N = 32) {
    const keys = [];
    for (let j = 0; j <= N; j++) {
      const k = j / N, [x, y, s, w = 1, o = 1] = fn(k);
      keys.push({ offset: k, opacity: o, transform: `translate(${(x - sz / 2).toFixed(1)}px, ${(y - sz / 2).toFixed(1)}px) scale(${(s * w).toFixed(3)}, ${s.toFixed(3)})` });
    }
    return keys;
  }
  const spin = (k, turns, ph = 0) => 0.18 + 0.82 * Math.abs(Math.cos((1 - k) * Math.PI * turns + ph));   // face-on at k = 1
  function coinsIn(d, from) {
    const tok = G.tok, H = hudCoin(), sz = H.s, n = Math.max(1, Math.min(12, d));
    shown.pend += d;
    let left = d, landed = 0;
    for (let i = 0; i < n; i++) {
      const share = i === n - 1 ? left : Math.round(d / n), turns = 2 + (i % 2);
      left -= share;
      const el = flyCoin(sz);
      let keys, T, delay;
      if (!from) {                                       // pouring in from the top, straight down into the HUD coin
        const sx = H.x + (Math.random() - 0.5) * sz * 1.8, sy = -sz * (0.7 + Math.random() * 0.5);
        T = 460 + Math.random() * 120; delay = i * 80;
        keys = coinKeys(k => { const e = k * k; return [lerp(sx, H.x, k * (2 - k)), lerp(sy, H.y, e), lerp(0.9, 0.85, k), spin(k, turns)]; }, sz);
      } else {                                           // a pop up out of the friend, then a swoop over into the HUD coin
        const sx = from.x + (Math.random() - 0.5) * sz * 0.9, sy = from.y + (Math.random() - 0.5) * sz * 0.5;
        const ax = sx + (Math.random() - 0.5) * sz * 3.4, ay = sy - sz * (1.1 + Math.random() * 1.3);
        const cx = lerp(ax, H.x, 0.45), cy = Math.min(ay, H.y) - sz * (0.8 + Math.random() * 0.9);
        T = 950 + Math.random() * 260; delay = 180 + i * 65;   // (a beat after the confetti: they'd drown in it)
        keys = coinKeys(k => {
          if (k < 0.26) { const e = 1 - (1 - k / 0.26) ** 2; return [lerp(sx, ax, e), lerp(sy, ay, e), lerp(0.5, 1.3, e), spin(k, turns)]; }
          const u = (k - 0.26) / 0.74, e = Math.pow(u, 1.7), m = 1 - e;
          return [m * m * ax + 2 * m * e * cx + e * e * H.x, m * m * ay + 2 * m * e * cy + e * e * H.y, lerp(1.3, 0.85, u), spin(k, turns)];
        }, sz);
      }
      el.animate(keys, { duration: T, delay, easing: 'linear', fill: 'forwards' }).onfinish = () => {
        el.remove();
        if (tok !== G.tok) return;                       // (a new game: resetScore() has squared the number)
        shown.pend -= share; landed++;
        if (landed === 1) scoreTag(d);
        if (landed === n) scoreBox('bump');
        countTo(220);
        const c = $('.score .score-coin');
        c.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.24)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
        A.sfxPlay('chink'); FX.sparkle(H.x, H.y, 3, 2);
      };
    }
  }
  function coinsOut(d) {
    const H = hudCoin(), sz = H.s, n = Math.max(1, Math.min(4, Math.round(d / 10)));
    for (let i = 0; i < n; i++) {
      const el = flyCoin(sz);
      // up out of the HUD coin, then down the left edge (sizes in coin widths per second), fading as it goes
      const vx = (Math.random() * 1.9 - 0.5 + i * 0.35) * sz, vy = -(5.4 + Math.random() * 1.8) * sz, g = 25 * sz, T = 1000;
      const keys = coinKeys(k => {
        const t = k * T / 1000;
        return [H.x + vx * t, H.y + vy * t + g * t * t / 2, lerp(1, 0.8, k), spin(k, 3, i), k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45];
      }, sz);
      el.animate(keys, { duration: T, delay: i * 120, easing: 'linear', fill: 'forwards' }).onfinish = () => el.remove();
    }
  }
  /* a go of the claw costs a coin (user: "코인넣은 효과"): your coins go down by one, and a big gold coin pops up over the
     machine's slot by the DOWN button, spins, comes down face-on and drops in — clink, the slot's rim lights up, sparkles,
     INSERTED! on the panel's screen — then the claw moves. Kept at the slot: a coin flying over from your coins crossed
     the glass and the claw. */
  async function insertCoin(tok) {
    if (G.score > 0 && !G.demo) { G.score--; scoreBox('minus'); scoreTag(-1); countTo(300); }   // (the demo's coin is free)
    const coin = machine.coin, local = machine.group.worldToLocal(machine.slotPoint());
    const e = new T.Euler(0, 0, 0, 'YXZ');
    // (it pops up and to the LEFT of the slot: straight up it hid behind the letter coins down the right side)
    const put = (y, z, s, turn, dx = 0) => {             // face-on to the player at turn = 0, 1, 2 …
      coin.position.set(local.x + dx, y, z); coin.scale.setScalar(s);
      e.set(Math.PI / 2, turn * Math.PI, 0); coin.quaternion.setFromEuler(e);
    };
    coin.visible = true;
    A.sfxPlay('coin');
    // up it pops, spinning
    await S.tween(380, k => put(local.y + 0.25 + 0.95 * k, local.z + 0.3, 0.2 + 1.9 * S.EASE.back(k), 2.5 * k, -0.9 * Math.sin(k * Math.PI / 2)), 'linear', tok);
    if (tok !== G.tok) { coin.visible = false; return; }
    // down, slowing its spin to face-on, smaller as it lines up with the slot
    await S.tween(330, k => put(local.y + 1.2 - 1.02 * k * k, local.z + 0.3 - 0.3 * k, 2.1 - 1.0 * k, 2.5 + 1.5 * (1 - (1 - k) * (1 - k)), -0.9 * (1 - k * k)), 'linear', tok);
    if (tok !== G.tok) { coin.visible = false; return; }
    // in it goes
    A.sfxPlay('chink');
    const q = S.project(machine.slotPoint()); FX.sparkle(q.x, q.y, 14, 4); FX.stars(q.x, q.y, 6, 0.5);
    machine.setScreen(['INSERTED!', `COINS ${G.score}`], '#ffd23f'); machine.chase(0.8);
    S.tween(700, k => machine.slotFlash(Math.sin(Math.PI * k)), 'linear');
    await S.tween(170, k => put(local.y + 0.18 - 0.26 * k, local.z, 1.1 - 0.5 * k, 4), 'in', tok);
    coin.visible = false;
    setTimeout(() => { if (tok === G.tok && G.target) machine.setScreen(['FIND', G.target.toUpperCase() + ' ' + G.target], '#ff8fd0'); }, 900);
  }
  /* no coins left after a go: the game ends */
  async function outOfCoins(tok) {
    G.busy = true; G.timerOn = false; setDrop(false);
    A.sfxPlay('buzz');
    showPrompt($('#bigMsg'), 'NO COINS!', 'pink', 10.5);
    machine.setScreen(['NO COINS', 'GAME OVER'], '#ff8fd0');
    await sleep(1700);
    if (tok !== G.tok) return;
    finish(tok);
  }
  function countScore(a, b) {
    const el = $('#score'), box = el.parentElement;
    box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
    S.tween(700, k => (el.textContent = Math.round(lerp(a, b, k))), 'out');
  }

  /* ── the how-to demo (phonics-kit common rule 1: every game's first game shows how, played for real; user 2026-11-22:
     "toy catch는 게임진행 설명이 제대로 된게 맞아? 아직 바로 게임 시작하는거 같은데"). The first game of a visit: round 1's
     sound is asked for as in a round, the glove takes the stick and moves the claw right over a friend with that sound
     ("Move the claw, then press the button!"), presses DOWN, and the real go runs — a coin in, the claw down, round the
     friend's neck, up (right over its head = AIM.hold: a sure catch) — "Yes! You did it! /m/ /m/ monkey", the friend
     drops back onto its seat, "Now you try!", and round 1 starts. It gives and costs nothing: the coin isn't taken off
     the count, none comes back, no caught friend, no MY FRIENDS count, no record. While it runs only SKIP (bottom right,
     #app.guide), sound and exit answer; SKIP stops it all at once and starts round 1. Later games of the visit go
     straight in (G.taught); ?nohint leaves it out (QA). */
  let demoAnim = null;
  async function teachDemo(tok) {
    G.taught = true; G.demoRan = true;
    const L = G.targets[0], mine = G.inMachine.filter(p => p.sound === L);
    if (!mine.length) return nextRound(tok);
    // (of two friends with the sound, the one further from the claw: the stick has a way to go)
    const p = mine.reduce((a, b) => (Math.abs(b.x - claw.x) > Math.abs(a.x - claw.x) ? b : a));
    G.demo = { seats: G.inMachine.slice() };
    G.target = L; setTarget(L);
    machine.setScreen(['FIND', L.toUpperCase() + ' ' + L], '#ff8fd0');
    app.classList.add('guide');                          // (SKIP shows)
    const pause = ms => S.tween(ms, () => {}, 'linear', tok);
    // the claw answers the stick and DOWN lights up over a friend, as in a round (input is held off: demoOnly). Right next
    // to the friend already, the claw first slides a little way off, so the stick has something to do.
    const X = x => Math.max(machine.X_MIN, Math.min(machine.X_MAX, x));
    G.aimX = Math.abs(p.x - claw.x) < 1.5 ? X(p.x + (p.x > 0 ? -2.4 : 2.4)) : claw.x;
    G.busy = false; setDrop(true);
    await announce(L);                                   // "/m/ 소리로 시작하는 친구를 뽑아 봐!" — as round 1 will ask
    if (tok !== G.tok) return;
    const hand = $('#hand'), css = k => parseFloat(app.style.getPropertyValue(k));
    const mu = css('--mu') || 8, jx = css('--joyX'), jy = css('--joyY'), dx = css('--downX'), dy = css('--downY'), W2 = hand.offsetWidth * 0.38;
    const at = (x, y, sc = 1) => ({ transform: `translate(${x - W2}px, ${y}px)` + (sc !== 1 ? ` scale(${sc})` : '') });
    const glove = (frames, ms) => {
      const a = hand.animate(frames, { duration: ms, easing: 'ease-in-out', fill: 'forwards' }), o = demoAnim;
      demoAnim = a; if (o) o.cancel();
      return a.finished.catch(() => {});
    };
    const show = (async () => {
      // the glove comes onto the knob and takes it (the knob glows)
      glove([at(jx, jy), at(jx, jy)], 1); hand.classList.add('on'); machine.joyHint(true);
      await pause(450);
      if (tok !== G.tok) return;
      await glove([at(jx, jy), at(jx, jy, 0.94)], 180);
      // it pushes the stick toward the friend (the real stick: G.joy, 2.2 u/s at full lean) and lets it back as the aim
      // gets there; then the aim is set right over the friend's head (the claw glides the last bit)
      const s = Math.sign(p.x - G.aimX) || 1, J = 0.9, lean = s * J * 7 * mu;     // (7 mu = a full drag, bindInput)
      const tilt = k => { G.joy = s * J * k; machine.setJoy(G.joy); };
      glove([at(jx, jy, 0.94), at(jx + lean, jy, 0.94)], 250);
      await S.tween(250, tilt, 'linear', tok);
      if (tok !== G.tok) return;
      await pause(Math.max(0, Math.abs(p.x - G.aimX) / (2.2 * J) - 0.25) * 1000);
      if (tok !== G.tok) return;
      glove([at(jx + lean, jy, 0.94), at(jx, jy)], 250);
      await S.tween(250, k => tilt(1 - k), 'linear', tok);
      if (tok !== G.tok) return;
      G.joy = 0; machine.setJoy(0); machine.joyHint(false);
      G.aimX = p.x;
      await glove([at(jx, jy), at(dx, dy)], 650);        // over to DOWN
      for (let i = 0; i < 40 && Math.abs(claw.x - p.x) > 0.01 && tok === G.tok; i++) await pause(50);
    })();
    await Promise.all([A.say('t:howto'), show]);         // "Move the claw, then press the button!"
    if (tok !== G.tok) return;
    await glove([at(dx, dy), at(dx, dy + 1.6 * mu, 0.94)], 160);
    if (tok !== G.tok) return;
    const go = drop();                                   // the real go (pressed by the glove): coin, down, grab, up
    glove([at(dx, dy + 1.6 * mu, 0.94), at(dx, dy)], 180).then(() => { if (G.demo) hand.classList.remove('on'); });
    const held = await go;
    if (tok !== G.tok) return;
    if (held) {
      const sp = plushScreen(held);
      FX.stars(sp.x, sp.y, 12); A.sfxPlay('sparkle'); held.cheer(2.4);
      await A.say('t:great3');                           // "Yes! You did it!"
      if (tok !== G.tok) return;
      await A.seq([`s:${held.sound}`, 120, `s:${held.sound}`, 150, `w:${held.word}`]);   // "/m/ /m/ monkey", as a prize
      if (tok !== G.tok) return;
      await putBack(held, tok);                          // back onto its seat: the demo keeps nothing
      if (tok !== G.tok) return;
      claw.setGrip(claw.OPEN * 0.55);
    }
    await A.say('t:tryit');                              // "Now you try!"
    if (tok !== G.tok) return;
    endDemo(tok);
  }
  /* SKIP during the demo: voice, glove and claw stop at once; whatever it had moved goes back (every friend on its seat,
     the claw up and open, the coin away, the coin count squared) and round 1 starts */
  function skipDemo() {
    const seats = G.demo.seats, old = G.tok, tok = ++G.tok;
    S.killTweens(old); A.stopVoice(); A.motor(false); A.sfxPlay('tap');
    for (const p of seats) {
      if (p.root.parent !== machine.group) detach(p);
      p.root.position.set(p.home.x, p.home.y, p.home.z); p.root.rotation.set(0, p.home.ry, 0); p.root.scale.setScalar(PS);
      p.x = p.home.x; p.tilt = 0; p.excite(0);
    }
    G.inMachine = seats.slice();
    claw.setHolding(false); machine.coin.visible = false;
    const y0 = claw.y, g0 = claw.grip;
    S.tween(400, k => { claw.set(claw.x, lerp(y0, claw.HOME_Y, k), claw.z); claw.setGrip(lerp(g0, claw.OPEN * 0.55, k)); }, 'out', tok);
    resetScore();                                        // (coins still pouring in from the start would be lost to the new token)
    G.interacted = true;                                 // (skipped: no round-1 glove after it)
    endDemo(tok);
  }
  function endDemo(tok) {
    demoOff();
    G.busy = true; setDrop(false);
    G.caught = []; G.miss = 0; G.tries = 0;
    if (G.score !== COINS.start) { G.score = COINS.start; resetScore(); }
    G.stats = { goes: 0, wrong: 0, misses: 0, t0: performance.now(), saved: false };   // (the record starts at round 1)
    G.aimX = claw.x;
    nextRound(tok);
  }
  function demoOff() {
    G.demo = null; app.classList.remove('guide');
    const h = $('#hand'), a = demoAnim; demoAnim = null;
    h.classList.remove('on');
    if (a) setTimeout(() => { try { a.cancel(); } catch (e) { /* done */ } }, 350);   // after the fade: no jump to the corner
    G.joy = 0; machine.setJoy(0); machine.joyHint(false);
  }

  /* ── the hint glove: drag the joystick, then press DOWN (first round, until the child touches) ─── */
  let hintAnim = null;
  async function runHint(tok) {
    const hand = $('#hand');
    await sleep(900);
    if (tok === G.tok && !G.interacted) { app.classList.add('guide'); A.say('t:howto'); }   // (SKIP shows while it runs)
    while (tok === G.tok && !G.interacted && G.screen === 'game') {
      await showGlove();
      if (tok !== G.tok || G.interacted) break;
      // between two showings it fades out where it ended (on DOWN). Without the fill it jumped back to its resting place
      // — the screen's top-left corner, over the score — and waited there (user: "상단에 화살표 왜 가있는거야?")
      hand.classList.remove('on');
      await sleep(1600);
    }
    stopHint();
  }
  /* every round after the first touch (user 2026-11-22): IDLE.after s with nothing done → the round's sound again (as the
     speaker button) and one showing of the glove; again every IDLE.every s at the most while the child waits. Any touch
     stops it (interact → stopHint; the stick, a drag, the keys zero G.idle). No new lines: the round's own prompt. */
  let idleT = -1e9;
  function idleHelp() {
    sayTarget();                                         // (voice and glove together, like the round-1 guide)
    const shown = showGlove(), mine = hintAnim;
    shown.then(() => { if (hintAnim === mine) stopHint(); });   // (a touch already hid it / a new game's guide owns it)
  }
  /* one showing of the glove: the stick left and right, then DOWN pressed */
  function showGlove() {
    const hand = $('#hand');
    const mu = parseFloat(app.style.getPropertyValue('--mu')) || 8;
    const jx = parseFloat(app.style.getPropertyValue('--joyX')), jy = parseFloat(app.style.getPropertyValue('--joyY'));
    const dx = parseFloat(app.style.getPropertyValue('--downX')), dy = parseFloat(app.style.getPropertyValue('--downY'));
    const W2 = hand.offsetWidth * 0.38;
    if (hintAnim) hintAnim.cancel();
    $('#joyHit').classList.add('hint');
    if (JOY_HINT === 'wiggle') machine.joyHint(true);
    hintAnim = hand.animate([
      { transform: `translate(${jx - W2}px, ${jy}px)` },
      { transform: `translate(${jx - W2 - 6 * mu}px, ${jy}px)`, offset: 0.2 },
      { transform: `translate(${jx - W2 + 6 * mu}px, ${jy}px)`, offset: 0.4 },
      { transform: `translate(${jx - W2}px, ${jy}px)`, offset: 0.5 },
      { transform: `translate(${dx - W2}px, ${dy}px)`, offset: 0.72 },
      { transform: `translate(${dx - W2}px, ${dy + 1.6 * mu}px) scale(.94)`, offset: 0.8 },
      { transform: `translate(${dx - W2}px, ${dy}px)`, offset: 0.88 },
      { transform: `translate(${dx - W2}px, ${dy}px)` },
    ], { duration: 3600, easing: 'ease-in-out', fill: 'forwards' });
    hand.classList.add('on');
    return hintAnim.finished.catch(() => {});
  }
  /* SKIP (phonics-kit common rule 1): the guide line stops at once, the glove fades and the stick settles, and the round
     goes on as if the showing had ended — the claw was free all along (G.busy is false while the guide runs) */
  function skipGuide() {
    if (!app.classList.contains('guide')) return;
    if (G.demo) return skipDemo();                       // (the first game's demo: it all stops, round 1 starts)
    A.stopVoice('t:howto');                              // (only the guide: a target sound asked for again plays on)
    A.sfxPlay('tap');
    interact();                                          // interacted: the guide loop ends; stopHint() hides glove + SKIP
  }
  function stopHint() {
    const h = $('#hand'), a = hintAnim; hintAnim = null;
    app.classList.remove('guide');
    h.classList.remove('on'); $('#joyHit').classList.remove('hint');
    machine.joyHint(false); if (!G.joy) machine.setJoy(0);
    if (a) setTimeout(() => { try { a.cancel(); } catch (e) { /* done */ } }, 350);   // after the fade: no jump to the corner
  }

  window.__clawApi = { G, drop, startGame, goTitle, candidate, setTarget, finish, gripOf, knockHub, skipGuide, skipDemo, openFriends, closeFriends, album, nextRound: () => nextRound(G.tok), get machine() { return machine; } };
  boot().catch(e => { console.error(e); const l = $('#loading'); if (l) l.innerHTML = '<p style="font:700 20px sans-serif;color:#234">Could not start: ' + e.message + '</p>'; });
})();
