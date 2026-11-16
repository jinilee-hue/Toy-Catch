/* Toy Catch (phonics claw machine) — game flow.
 * Title (logo, START) → coin goes in ("INSERTED! READY TO PLAY!") → 4 rounds, one per sound m a s t in random order:
 * "Catch a friend that starts with /m/" → move the claw (joystick, drag, tap a plush, ← →) → DOWN → the claw drops,
 * grabs the plush under it and lifts it. Right sound: confetti, the others cheer, "/m/ /m/ monkey", it goes down the
 * chute and pops out as a prize. Wrong sound: "Uh-oh! turtle. It starts with /t/", it slips back. 45 s per round.
 * → result (stars, caught friends, score, Play again / Home).
 */
(function () {
  'use strict';
  const S = Stage, A = Sound, T = THREE;
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const qs = new URLSearchParams(location.search);
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const lerp = (a, b, k) => a + (b - a) * k;
  const LETTERS = ['m', 'a', 's', 't'];
  const POOL = { m: ['monkey', 'mouse'], a: ['ant'], s: ['seal'], t: ['turkey', 'turtle'] };
  const OTHERS = ['cat', 'cow', 'dog', 'fish'];          // c d f: never a target, always a wrong answer
  const ROUND_SEC = +(qs.get('sec') || 45);
  const PS = 1.3;                                       // plush scale in the machine
  /* aiming: how far (machine units, along x) the claw is from the middle of the friend's head when it comes down.
     ≤ hold: a sure catch · ≤ weak: a loose grip that may slip out on the way up · ≤ reach: a prong knocks the friend,
     nothing caught · further: nothing under the claw. Two misses in a row in a round and a loose grip holds. */
  const AIM = { hold: 0.2, weak: 0.4, reach: 0.62 };
  const G = {
    screen: 'title', all: {}, inMachine: [], targets: [], round: -1, target: null, score: 0, caught: [], tries: 0,
    time: ROUND_SEC, timerOn: false, busy: true, tok: 0, aimX: 0, joy: 0, keys: { l: 0, r: 0 }, idle: 0, interacted: false,
    icons: {}, shownSec: -1, miss: 0, rand: Math.random,
  };
  let machine, claw, spot, burst;
  window.__claw = G;

  /* ── boot ───────────────────────────────────────────────────────────────────────────────────────── */
  async function boot() {
    const bar = $('#loading .bar i');
    try { await Promise.race([document.fonts.load('800 100px "Baloo 2"'), A.sleep(2500)]); } catch (e) { /* fallback font */ }
    bar.style.width = '30%';
    buildStart();
    S.init($('#stage'), { preserve: qs.has('preserve') });
    machine = Machine.build(); claw = machine.claw;
    S.machine = machine; S.scene.add(machine.group);
    FX.init($('#fx'));
    bar.style.width = '55%';
    await A.sleep(20);
    await Friends.load();
    for (const k of Friends.KINDS) { G.all[k] = Friends.build(k); G.icons[k] = G.all[k].icon; }
    bar.style.width = '85%';
    spot = makeSpot(); machine.group.add(spot.group);
    burst = makeBurst(); S.scene.add(burst);
    S.onResize = layout;
    S.resize();
    setupPlushes();
    buildTray();
    S.onTick.push(tick);
    S.start();
    bindInput();
    await A.sleep(60);
    bar.style.width = '100%';
    await A.sleep(250);
    app.classList.remove('booting');
    G.busy = false;
    window.__ready = true;
  }

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
      gr.addColorStop(0, 'rgba(255,244,214,1)'); gr.addColorStop(0.3, 'rgba(255,244,214,0.6)');
      gr.addColorStop(0.85, 'rgba(255,244,214,0.24)'); gr.addColorStop(1, 'rgba(255,244,214,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.BackSide, opacity: 0, toneMapped: false });
    mat.onBeforeCompile = (sh) => {           // fades as the wall turns side-on to the camera: soft sides, no outline
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vFace;\nvoid main() {\n  { vec4 mvp = modelViewMatrix * vec4(position, 1.0); vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mvp.xyz))); }');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vFace;\nvoid main() {')
        .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.a *= vFace;');
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
    const lampMat = machine.lamp.material, lampE = lampMat.emissiveIntensity;
    const src = V(0, 0, 0), dst = V(0, 0, 0), dir = V(0, 0, 0), DOWN = V(0, -1, 0);
    let k = 0, lit = null;
    return {
      group,
      /* at = { x, z, floorY, r, level 0..1, friend } or null */
      update(dt, at) {
        k = lerp(k, at ? at.level : 0, Math.min(1, dt * (at ? 6 : 9)));
        machine.lamp.getWorldPosition(src); group.worldToLocal(src);
        flare.position.copy(src);
        if (at) {
          dst.set(at.x, at.floorY, at.z);
          dir.subVectors(dst, src); const len = dir.length(); dir.divideScalar(len);
          cone.position.copy(src); cone.quaternion.setFromUnitVectors(DOWN, dir); cone.scale.set(at.r, len, at.r);
          light.position.copy(src); light.target.position.copy(dst); light.angle = Math.atan(at.r / len);
          if (lit !== at.friend) { if (lit) lit.lit(0); lit = at.friend; }
        }
        const tune = G.spotTune || {};                       // (QA: __claw.spotTune = { I, cone, lit, flare })
        if (lit) lit.lit(at ? Math.min(1.5, k * (tune.lit ?? 1.2)) : 0);
        if (!at && k < 0.02 && lit) { lit.lit(0); lit = null; }
        light.intensity = (tune.I ?? 24) * k;
        mat.opacity = matN.opacity = (tune.cone ?? 0.36) * k;
        cone.visible = mat.opacity > 0.003;
        flare.material.opacity = (tune.flare ?? 0.55) * k; flare.scale.setScalar(0.2);
        flare.visible = flare.material.opacity > 0.003;
        lampMat.emissiveIntensity = lampE + 2.4 * k;
      },
    };
  }

  /* the START button, after the intro mockup (design/intro_ref.png, the button at x 1050–1720, y 1300–1530): chunky
     block letters — a front face, a deep darker side under it, a thick round white outline with its own lavender side —
     on a royal-blue slab with a darker front edge. The slab's top face and the letters lie on the panel together: one
     perspective tilt (CSS .tilt) narrows both toward the top (user: "start 텍스트도 각도는 맞춰야지"). Coordinates are
     the mockup's pixels in that crop (1 mu = 15.36 px). Every letter has two canvases: its white outline (all five under
     all the letters, so the outlines merge into one — user: "흰색 라인은 같이 하나로 묶여있고") and the letter itself;
     both swell and shrink together in a wave that keeps rolling along the word (CSS). */
  function buildStart() {
    const btn = $('#start');
    const BOX = [20, 6, 610, 216];                       // the button's box in crop px: x, y, w, h
    const K = 2.2;                                       // canvas pixels per crop px (sharp on big Retina screens)
    const FS = 161, SX = 1.2, TRACK = -1, BASE = 118;    // font size, widening (the mockup font is wider), baseline
    // (FS 161: the word nearly as wide as the slab, standing well above its back edge like the mockup's — user:
    //  "start 텍스트가 파란색 판보다 크잖아")
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
    const g0 = document.createElement('canvas').getContext('2d'); g0.font = font;
    const adv = LET.map(([ch]) => g0.measureText(ch).width * SX);
    let x = 327 - (adv.reduce((a, b) => a + b, 0) + TRACK * (LET.length - 1)) / 2;
    const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const mix = (a, b, k) => 'rgb(' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * k)).join(',') + ')';
    const place = (cv, x0, y0, w, h) => Object.assign(cv.style, {
      left: (x0 - BOX[0]) / BOX[2] * 100 + '%', top: (y0 - BOX[1]) / BOX[3] * 100 + '%',
      width: w / BOX[2] * 100 + '%', height: h / BOX[3] * 100 + '%' });
    const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.ceil(w * K); c.height = Math.ceil(h * K); const g = c.getContext('2d'); g.scale(K, K); return [c, g]; };
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
    {
      const [c, g] = canvas(BOX[2], BOX[3]);
      g.translate(-BOX[0], -BOX[1]);
      const gr = g.createLinearGradient(0, 32.5, 0, 165); gr.addColorStop(0, '#4479f0'); gr.addColorStop(0.25, '#5a82ee'); gr.addColorStop(1, '#6386e4');
      g.fillStyle = gr; rr(g, 27, 32.5, 599, 132.5, 26); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2; rr(g, 29, 34.5, 595, 128.5, 24); g.stroke();
      c.className = 'plate-top'; place(c, BOX[0], BOX[1], BOX[2], BOX[3]); tilt.appendChild(c);
    }
    btn.appendChild(tilt);
    // the letters: outlines (appended first) and letters (appended after) — same box per letter, same wave
    const outlines = [], letters = [];
    LET.forEach(([ch, f0, f1, s0, s1], i) => {
      const cx = x + adv[i] / 2, half = adv[i] / 2 + O + B + 10, top = BASE - FS * 0.82, h = FS * 0.82 + E + OS + O + B + 10;
      const [oc, og] = canvas(half * 2, h);
      og.translate(half, -top); og.scale(SX, 1);
      og.font = font; og.textAlign = 'center'; og.textBaseline = 'alphabetic'; og.lineJoin = 'round';
      const oLayer = (col, dy, lw) => { og.fillStyle = col; og.fillText(ch, 0, BASE + dy); og.strokeStyle = col; og.lineWidth = lw + B; og.strokeText(ch, 0, BASE + dy); };
      // every stack in 0.5 px steps: coarser steps left ridges along the curves (user: "테두리가 깨져보이지 않게")
      for (let dy = E + OS; dy >= E; dy -= 0.5) oLayer('#a9a1c2', dy, O * 2);                // the outline's own side
      for (let dy = E; dy >= 0; dy -= 0.5) oLayer('#fbf4f6', dy, O * 2);                     // the white outline
      oLayer('#fbf4f6', 0, O * 2);
      oc.className = 'O'; oc.style.animationDelay = (i * 0.14) + 's';
      place(oc, cx - half, top, half * 2, h); outlines.push(oc);
      const [c, g] = canvas(half * 2, h);
      g.translate(half, -top); g.scale(SX, 1);
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      const layer = (col, dy, lw) => { g.fillStyle = col; g.fillText(ch, 0, BASE + dy); g.strokeStyle = col; g.lineWidth = lw + B; g.strokeText(ch, 0, BASE + dy); };
      for (let dy = E; dy >= 0.5; dy -= 0.5) layer(mix(s0, s1, Math.min(1, dy / (E * 0.35))), dy, 1.2);   // the letter's side
      // the face, puffed: its own canvas, then a soft dark rim along the bottom edge and a light one along the top-left
      // (inner shadows: the shadow of everything OUTSIDE the letter, drawn only onto the letter)
      const [fc, fg] = canvas(half * 2, h), [ic, ig] = canvas(half * 2, h);
      for (const q of [fg, ig]) { q.setTransform(g.getTransform()); q.font = font; q.textAlign = 'center'; q.textBaseline = 'alphabetic'; q.lineJoin = 'round'; q.lineWidth = B; }
      const gr = fg.createLinearGradient(0, BASE - FS * 0.64, 0, BASE);
      gr.addColorStop(0, mix(f0, '#ffffff', 0.08)); gr.addColorStop(0.35, f0); gr.addColorStop(1, f1);
      fg.fillStyle = gr; fg.strokeStyle = gr; fg.fillText(ch, 0, BASE); fg.strokeText(ch, 0, BASE);
      ig.save(); ig.setTransform(1, 0, 0, 1, 0, 0); ig.fillStyle = '#000'; ig.fillRect(0, 0, ic.width, ic.height); ig.restore();
      ig.globalCompositeOperation = 'destination-out'; ig.fillText(ch, 0, BASE); ig.strokeText(ch, 0, BASE);
      fg.setTransform(1, 0, 0, 1, 0, 0); fg.globalCompositeOperation = 'source-atop';
      // (soft and wide: a tight dark rim read as a seam between the face and the side)
      fg.shadowColor = mix(s1, '#000000', 0.1).replace('rgb', 'rgba').replace(')', ',.26)'); fg.shadowBlur = 9 * K; fg.shadowOffsetY = -5 * K;
      fg.drawImage(ic, 0, 0);
      fg.shadowColor = 'rgba(255,255,255,.42)'; fg.shadowBlur = 2.5 * K; fg.shadowOffsetX = 1.2 * K; fg.shadowOffsetY = 2.6 * K;
      fg.drawImage(ic, 0, 0);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(fc, 0, 0); g.restore();
      c.className = 'L'; c.style.animationDelay = (i * 0.14) + 's';
      place(c, cx - half, top, half * 2, h); letters.push(c);
      x += adv[i] + TRACK;
    });
    for (const c of [...outlines, ...letters]) tilt.appendChild(c);
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
    const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);
    const fixed = qs.get('kinds');
    let kinds;
    if (fixed) kinds = fixed.split(',');
    else {
      const m2 = shuffle(POOL.m), t2 = shuffle(POOL.t), o = shuffle(OTHERS);
      kinds = [m2[0], 'ant', 'seal', t2[0], o[0], shuffle([m2[1], t2[1], ...o.slice(1)])[0]];
      kinds = shuffle(kinds);
    }
    G.inMachine = [];
    machine.slots.forEach((s, i) => {
      const p = G.all[kinds[i]];
      if (!p) return;
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
    const st = app.style;
    st.setProperty('--mx', C.x + 'px'); st.setProperty('--mt', C.y + 'px'); st.setProperty('--mu', mu + 'px');
    const d = S.project(M.dropPoint()), j = S.project(M.joyPoint());
    st.setProperty('--dropX', d.x + 'px'); st.setProperty('--dropY', Math.min(h - 10 * mu, d.y) + 'px');
    st.setProperty('--joyX', j.x + 'px'); st.setProperty('--joyY', j.y + 'px');
    // the 3D DOWN button's box on screen (for the invisible HTML button over it, the DOWN! hint and the hint glove)
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
    // "DOWN!" when the claw rests over a friend
    if (G.screen === 'game' && !G.busy) {
      G.idle += dt;
      $('#downHint').classList.toggle('show', zone === 'hold' && G.idle > (G.round === 0 && G.tries === 0 ? 1.0 : 3.5) && Math.abs(G.aimX - claw.x) < 0.02);
      $('#drop').classList.toggle('ready', zone === 'hold'); machine.setDown({ ready: zone === 'hold' });
    } else $('#downHint').classList.remove('show');
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

  /* ── input ──────────────────────────────────────────────────────────────────────────────────────── */
  function bindInput() {
    // the first touch on the title: music + "Hi, friends! Welcome to Toy Catch! … Press start to play!"
    let greeted = false;
    const firstTouch = (e) => {
      A.unlock();
      if (greeted || G.screen !== 'title' || G.busy) return;
      greeted = true; A.startBgm();
      if (!(e.target.closest && e.target.closest('#start'))) A.seq(['t:hello', 200, 't:pressstart']);
    };
    window.addEventListener('pointerdown', firstTouch, { capture: true });
    const lt = $('#btnLang');
    const showLang = () => { lt.dataset.l = A.lang; lt.setAttribute('aria-pressed', A.lang === 'ko'); lt.querySelectorAll('.flag').forEach(f => f.classList.toggle('on', f.dataset.l === A.lang)); };
    showLang();
    lt.addEventListener('click', () => { A.setLang(A.lang === 'ko' ? 'en' : 'ko'); showLang(); A.sfxPlay('tap'); A.stopVoice(); A.say('t:pressstart'); });
    $('#start').addEventListener('click', () => { A.unlock(); startGame(); });
    $('#drop').addEventListener('click', () => drop());
    $('#tgSnd').addEventListener('click', () => { if (G.screen === 'game' && G.target) { $('#tgSnd').classList.remove('play'); void $('#tgSnd').offsetWidth; $('#tgSnd').classList.add('play'); announce(G.target, true); } });
    $('#btnSound').addEventListener('click', () => { A.setMuted(!A.muted); app.classList.toggle('muted', A.muted); });
    app.classList.toggle('muted', A.muted);
    $('#btnExit').addEventListener('click', () => {
      if (G.screen === 'title') { if (history.length > 1) history.back(); return; }
      goTitle();
    });
    $('#btnAgain').addEventListener('click', () => startGame(true));
    $('#btnHome').addEventListener('click', () => goTitle());
    // joystick: drag sideways
    const jh = $('#joyHit');
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
      if (e.key === 'ArrowLeft' || e.key === 'a') { G.keys.l = 1; interact(); }
      else if (e.key === 'ArrowRight' || e.key === 'd') { G.keys.r = 1; interact(); }
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault(); A.unlock();
        if (G.screen === 'title') startGame(); else if (G.screen === 'game') drop(); else if (G.screen === 'result') startGame(true);
      }
    });
    window.addEventListener('keyup', e => { if (e.key === 'ArrowLeft' || e.key === 'a') G.keys.l = 0; if (e.key === 'ArrowRight' || e.key === 'd') G.keys.r = 0; });
  }
  function interact() { G.idle = 0; G.interacted = true; stopHint(); $('#downHint').classList.remove('show'); }

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
    A.unlock(); A.startBgm();
    A.stopVoice();
    if (again) { setScreen('title'); await sleep(250); setupPlushes(); claw.set(claw.x, claw.HOME_Y, claw.z); }
    app.classList.add('inserting');                     // (not 'coin': that's the intro coins' class — it shrank the whole app into a coin)
    // the coin flips in and drops into the slot
    const slot = machine.slotPoint(), coin = machine.coin;
    const sp = slot.clone(), local = machine.group.worldToLocal(sp.clone());
    coin.visible = true;
    await S.tween(900, k => {
      const y = local.y + 1.4 * (1 - k) + 0.12, z = local.z + 0.35 * (1 - k);
      coin.position.set(local.x, y, z); coin.rotation.set(Math.PI / 2, 0, k * Math.PI * 5); coin.scale.setScalar(1.6 - 0.6 * k);
      if (Math.random() < 0.5) { const p = S.project(machine.group.localToWorld(coin.position.clone())); FX.sparkle(p.x, p.y, 1, 2); }
    }, 'in', tok);
    if (tok !== G.tok) return;
    A.sfxPlay('coin');
    const p = S.project(slot); FX.sparkle(p.x, p.y, 14, 4); FX.stars(p.x, p.y, 8);
    await S.tween(220, k => { coin.position.y = local.y + 0.12 - 0.2 * k; coin.scale.setScalar(1 - 0.4 * k); }, 'in', tok);
    coin.visible = false;
    machine.setScreen(['INSERTED!', 'READY TO PLAY!'], '#ffd23f');
    machine.chase(2.5); A.sfxPlay('insert');
    A.say('t:ready');
    await sleep(500);
    if (tok !== G.tok) return;
    app.classList.remove('inserting');
    setScreen('game');
    G.score = 0; G.caught = []; G.round = -1; G.tries = 0; G.miss = 0;
    $('#score').textContent = '0';
    buildTray();
    const order = (qs.get('order') || '').split(',').filter(x => LETTERS.includes(x));
    G.targets = order.length ? order : LETTERS.slice().sort(() => Math.random() - 0.5);
    G.aimX = 0;
    await dolly(1, 1000);
    if (tok !== G.tok) return;
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
    const go = $('#go'); go.classList.remove('show'); void go.offsetWidth; go.classList.add('show');
    A.sfxPlay('pop');
    await announce(G.target);
    if (tok !== G.tok) return;
    G.busy = false; G.timerOn = true; G.idle = 0; setDrop(true);
    if (G.round === 0 && !G.interacted && !qs.has('nohint')) runHint(tok);
  }
  function setTarget(L) {
    const up = L.toUpperCase();
    $('#tgLetter').textContent = up + L;
    const tg = $('#target'); tg.classList.remove('swap'); void tg.offsetWidth; tg.classList.add('swap');
    const le = $('#tgLetter'); le.classList.remove('pop'); void le.offsetWidth; le.classList.add('pop');
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
    G.busy = true; G.timerOn = false; interact(); setDrop(false);
    $('#timeBox').classList.add('paused');
    const btn = $('#drop'); btn.classList.add('press'); setTimeout(() => btn.classList.remove('press'), 150); machine.pressDown();
    A.sfxPlay('tap');
    const cand = candidate();
    const zone = cand ? aimZone(cand) : 'none';
    const off = cand ? claw.x - cand.x : 0;              // the claw's offset from the head's middle
    const x0 = claw.x, z0 = claw.z, g0 = claw.grip;
    const tx = claw.x, tz = cand ? cand.z : claw.z;      // straight down where it was aimed (into the friend's row)
    // the prongs will close until their knuckles touch the sides of the head; the hub stops where that puts the
    // knuckles level with the head's middle (and never lower than just over the head)
    const hy = cand ? cand.headR[1] * PS : 0, hx = cand ? cand.headR[0] * PS : 0;
    const shut = cand ? claw.gripAngle(hx * 1.02) : claw.SHUT;
    const yHead = cand ? cand.root.position.y + cand.gripY * PS : 0;
    const yBot = cand ? Math.max(yHead + claw.knuckleDrop(shut), yHead + hy + 0.03) : 1.45;
    if (cand) { cand.lookAt(claw.holdWorld()); cand.excite(zone === 'hold' ? 1 : 0.4); }
    A.motor(true, 0.8);
    await S.tween(1300, k => {
      const kk = Math.min(1, k * 1.7);
      claw.set(lerp(x0, tx, kk), lerp(claw.HOME_Y, yBot, k), lerp(z0, tz, kk));
      claw.setGrip(lerp(g0, claw.OPEN, Math.min(1, k * 2.2)));
    }, 'inOut', tok);
    A.motor(false);
    if (tok !== G.tok) return;
    A.sfxPlay('grab');
    if (zone === 'knock') {
      // a prong comes down on the side of its head: it gets shoved away and wobbles; the claw shuts on nothing
      A.sfxPlay('boing'); cand.nope(0.9);
      const x1 = cand.x, dir = Math.sign(cand.x - claw.x) || 1;
      S.tween(700, k => { cand.root.position.x = x1 + dir * 0.16 * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - 0.5 * k); }, 'out', tok)
        .then(() => { cand.root.position.x = x1; });
      await S.tween(360, k => claw.setGrip(lerp(claw.OPEN, claw.SHUT, k)), 'out', tok);
    } else {
      // closing prongs push the head toward the middle: all the way when it was right over it, half way on a loose grip
      const x1 = cand ? cand.x : 0, x2 = cand ? (zone === 'hold' ? claw.x : cand.x + off * 0.5) : 0;
      await S.tween(360, k => { claw.setGrip(lerp(claw.OPEN, shut, k)); if (cand) cand.root.position.x = lerp(x1, x2, k); }, 'out', tok);
    }
    const held = cand && zone !== 'knock' ? cand : null;
    if (held) attach(held);
    await sleep(120);
    // a loose grip: it tips toward the open side on the way up and, unless the luck (or two misses in a row) holds it,
    // slips out part way
    const loose = zone === 'weak';
    const slips = loose && G.miss < 2 && G.rand() < 0.35 + 0.5 * (Math.abs(off) - AIM.hold) / (AIM.weak - AIM.hold);
    const kSlip = 0.3 + G.rand() * 0.35, side = -Math.sign(off) || 1;
    let slipping = null;
    A.motor(true, 1.2);
    await S.tween(1200, k => {
      claw.set(tx, lerp(yBot, claw.HOME_Y, k), tz);
      if (loose && held && !slipping) held.tilt = side * (slips ? 0.4 * Math.min(1, k / kSlip) : 0.14 * Math.sin(k * Math.PI * 3));
      if (slips && !slipping && k >= kSlip) slipping = slip(held, side, tok);
    }, 'inOut', tok);
    A.motor(false);
    if (held && !slips) held.tilt = 0;
    if (slipping) await slipping;
    if (tok !== G.tok) return;
    if (!held || slips) {
      G.miss++;
      if (!cand) { A.sfxPlay('whiff'); await A.say('t:miss'); }
      else if (zone === 'knock') { A.sfxPlay('whiff'); await A.say('t:center'); }
      else await A.say('t:slip');
      if (tok !== G.tok) return;
      claw.setGrip(claw.OPEN * 0.55);
      return resume(tok);
    }
    G.miss = 0;                                       // a good grab: the next loose grip takes its chances again
    if (cand.sound === G.target) await correct(cand, tok);
    else await wrong(cand, tok);
  }
  /* it slips out of a loose grip: tips over, drops back onto its seat with a bounce, and wobbles */
  async function slip(p, side, tok) {
    A.sfxPlay('slip');
    const g0 = claw.grip;
    S.tween(220, k => claw.setGrip(lerp(g0, claw.OPEN * 0.45, k)), 'out');
    detach(p);
    const from = p.root.position.clone(), t0 = p.tilt;
    await S.tween(650, k => {
      p.root.position.set(lerp(from.x, p.home.x, k), lerp(from.y, p.home.y, S.EASE.bounce(k)), lerp(from.z, p.home.z, k));
      p.tilt = t0 + side * 0.9 * Math.sin(Math.PI * Math.min(1, k * 1.25));
    }, 'linear', tok);
    p.tilt = 0;
    A.sfxPlay('thud'); p.nope(0.8);
    p.root.position.set(p.home.x, p.home.y, p.home.z); p.x = p.home.x;
    if (!G.inMachine.includes(p)) G.inMachine.push(p);
  }
  function attach(p) {
    claw.swing.attach(p.root);                      // keeps where it is: the claw came down right over it
    const rq = p.root.quaternion.clone(), q0 = new T.Quaternion();
    S.tween(300, k => p.root.quaternion.slerpQuaternions(rq, q0, k), 'out');
    p.hold(true); p.lookAt(null); p.excite(0);
    G.inMachine = G.inMachine.filter(o => o !== p);
  }
  function detach(p) { machine.group.attach(p.root); p.hold(false); }
  function resume(tok) {
    if (tok !== G.tok) return;
    G.busy = false; G.timerOn = G.time > 0; G.idle = 0; setDrop(true);
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
    const gain = 100 + (G.tries === 0 ? 50 : 0);
    countScore(G.score, G.score + gain); G.score += gain;
    const fw = () => { const r = S.project(V(lerp(-3, 3, Math.random()), lerp(2.4, 3.8, Math.random()), 0)); FX.firework(r.x, r.y); A.sfxPlay('pop'); };
    fw(); setTimeout(fw, 350); setTimeout(fw, 700);
    await A.say('t:great3');
    if (tok !== G.tok) return;
    // to the chute: up and forward over the front row first, then along the front to the left corner
    A.motor(true, 1.1);
    const x0 = claw.x, z0 = claw.z, ch = machine.chute, lane = machine.FRONT_LANE;
    await S.tween(650, k => claw.set(x0, lerp(claw.HOME_Y, claw.CARRY_Y, k), lerp(z0, lane, k)), 'inOut', tok);
    await S.tween(1100, k => claw.set(lerp(x0, ch.x, k), claw.CARRY_Y, lerp(lane, ch.z, k)), 'inOut', tok);
    A.motor(false);
    if (tok !== G.tok) return;
    A.sfxPlay('open');
    const g0 = claw.grip;
    S.tween(300, k => claw.setGrip(lerp(g0, claw.OPEN * 0.7, k)), 'out');
    detach(p);
    const y0 = p.root.position.y, ry0 = p.root.rotation.y;
    await S.tween(650, k => { p.root.position.y = lerp(y0, ch.floor, k); p.root.rotation.y = ry0 + k * 2.5; p.root.scale.setScalar(PS * (1 - 0.35 * k)); }, 'in', tok);
    A.sfxPlay('chute');
    machine.group.remove(p.root);
    G.caught.push(p.kind);
    await prize(p, tok);
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
  async function prize(p, tok) {
    const cam = S.camera;
    const at = (fx, fy, dist) => { const v = V(fx * 2 - 1, -(fy * 2 - 1), 0.5).unproject(cam); return cam.position.clone().add(v.sub(cam.position).normalize().multiplyScalar(dist)); };
    S.scene.add(p.root);
    p.root.rotation.set(0, 0, 0); p.hold(false); p.cheer(3.5);
    const start = machine.group.localToWorld(V(machine.chute.x, -0.6, machine.D / 2 + 1.2));
    const end = at(0.5, 0.56, 7.5);
    end.y -= 0.75;
    A.sfxPlay('prize');
    await S.tween(700, k => {
      const pos = start.clone().lerp(end, k); pos.y += Math.sin(k * Math.PI) * 1.4;
      p.root.position.copy(pos); p.root.scale.setScalar(lerp(0.5, 1.4, k));   // its cap stays under the TARGET banner (no spin: a flat picture would show its edge)
    }, 'out', tok);
    p.root.lookAt(cam.position.x, p.root.position.y, cam.position.z);
    const mid = p.root.position.clone().add(V(0, p.top * p.root.scale.y * 0.5, 0));
    burst.position.copy(mid).addScaledVector(mid.clone().sub(cam.position).normalize(), 0.9);
    burst.scale.setScalar(p.top * p.root.scale.y * 2.3);
    burstTo(true);
    const box = $('#prize'), wordEl = $('#prizeWord');
    wordEl.innerHTML = `<b>${p.word[0]}</b>${p.word.slice(1)}`;
    box.classList.add('show');
    const sp = S.project(p.root.position.clone().add(V(0, 1, 0)));
    FX.stars(sp.x, sp.y, 12);
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
    const p0 = S.project(p.root.position.clone().add(V(0, 0.9, 0)));
    const size = Math.max(120, sr.width * 2.6);
    Object.assign(fly.style, { position: 'absolute', zIndex: 25, left: p0.x - size / 2 + 'px', top: p0.y - size / 2 + 'px', width: size + 'px', height: size + 'px', pointerEvents: 'none' });
    app.appendChild(fly);
    S.scene.remove(p.root);
    const anim = fly.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${sr.left + sr.width / 2 - p0.x}px, ${sr.top + sr.height / 2 - p0.y}px) scale(${sr.width * 1.15 / size})` }], { duration: 650, easing: 'cubic-bezier(.5,0,.3,1)' });
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
    // it slips out of the claw and drops back onto its seat
    A.sfxPlay('open');
    const g0 = claw.grip;
    S.tween(250, k => claw.setGrip(lerp(g0, claw.OPEN * 0.6, k)), 'out');
    detach(p);
    const from = p.root.position.clone(), q0 = p.root.quaternion.clone(), qh = new T.Quaternion().setFromEuler(new T.Euler(0, p.home.ry, 0));
    await S.tween(800, k => {
      p.root.position.set(lerp(from.x, p.home.x, k), lerp(from.y, p.home.y, S.EASE.bounce(k)), lerp(from.z, p.home.z, k));
      p.root.quaternion.slerpQuaternions(q0, qh, Math.min(1, k * 1.5));
    }, 'linear', tok);
    A.sfxPlay('thud');
    p.root.position.set(p.home.x, p.home.y, p.home.z);
    G.inMachine.push(p);
    G.tries++;
    if (tok !== G.tok) return;
    await A.say('t:again');
    if (tok !== G.tok) return;
    await A.say(`s:${G.target}`);
    claw.setGrip(claw.OPEN * 0.55);
    resume(tok);
  }

  async function timeUp() {
    const tok = G.tok;
    G.busy = true; setDrop(false);
    A.sfxPlay('buzz');
    const big = $('#bigMsg'); big.textContent = 'TIME’S UP!'; big.classList.remove('show'); void big.offsetWidth; big.classList.add('show');
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
    await dolly(0, 900);
    if (tok !== G.tok) return;
    setScreen('result');
    const n = G.caught.length;
    const all = n >= LETTERS.length;
    const stars = all ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0;
    [...$('#stars').children].forEach((s, i) => s.classList.toggle('on', i < stars));
    $('#rbText').textContent = all ? 'PERFECT!' : n >= 2 ? 'GREAT JOB!' : 'NICE TRY!';
    $('#finalScore').textContent = G.score;
    $('#caught').innerHTML = G.targets.map((L, i) => {
      const k = G.caught.find(kind => G.all[kind].sound === L);
      return k ? `<div class="slot got"><img src="${G.icons[k]}" alt=""><em><b>${G.all[k].word[0]}</b>${G.all[k].word.slice(1)}</em></div>` : `<div class="slot">${L}</div>`;
    }).join('');
    machine.setScreen(['GREAT', 'JOB!'], '#ffd23f'); machine.chase(4);
    A.sfxPlay('win'); FX.rain(160);
    await A.say(all ? 't:allcaught' : 't:result');
    if (tok !== G.tok) return;
    await A.say('t:playagain');
    G.busy = false;
  }

  function goTitle() {
    G.tok++; S.killTweens(); A.stopVoice(); A.motor(false);
    G.busy = false; G.timerOn = false; stopHint();
    $('#prize').classList.remove('show'); burst.visible = false; burst.userData.disc.material.opacity = 0;
    for (const p of Object.values(G.all)) { if (p.root.parent) p.root.parent.remove(p.root); }
    setupPlushes();
    claw.set(claw.x, claw.HOME_Y, 0.15); claw.setGrip(claw.OPEN * 0.55);
    machine.setScreen(['LEVEL 1', 'M A S T']);
    machine.coin.visible = false;
    app.classList.remove('inserting');
    setScreen('title');
    S.frame.push = 0; S.resize();
  }

  function countScore(a, b) {
    const el = $('#score'), box = el.parentElement;
    box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
    S.tween(700, k => (el.textContent = Math.round(lerp(a, b, k))), 'out');
  }

  /* ── the hint glove: drag the joystick, then press DOWN (first round, until the child touches) ─── */
  let hintAnim = null;
  async function runHint(tok) {
    const hand = $('#hand');
    await sleep(900);
    if (tok === G.tok && !G.interacted) A.say('t:howto');
    while (tok === G.tok && !G.interacted && G.screen === 'game') {
      const mu = parseFloat(app.style.getPropertyValue('--mu')) || 8;
      const jx = parseFloat(app.style.getPropertyValue('--joyX')), jy = parseFloat(app.style.getPropertyValue('--joyY'));
      const dx = parseFloat(app.style.getPropertyValue('--downX')), dy = parseFloat(app.style.getPropertyValue('--downY'));
      const W2 = hand.offsetWidth * 0.38;
      hand.classList.add('on');
      $('#joyHit').classList.add('hint');
      hintAnim = hand.animate([
        { transform: `translate(${jx - W2}px, ${jy}px)` },
        { transform: `translate(${jx - W2 - 6 * mu}px, ${jy}px)`, offset: 0.2 },
        { transform: `translate(${jx - W2 + 6 * mu}px, ${jy}px)`, offset: 0.4 },
        { transform: `translate(${jx - W2}px, ${jy}px)`, offset: 0.5 },
        { transform: `translate(${dx - W2}px, ${dy}px)`, offset: 0.72 },
        { transform: `translate(${dx - W2}px, ${dy + 1.6 * mu}px) scale(.94)`, offset: 0.8 },
        { transform: `translate(${dx - W2}px, ${dy}px)`, offset: 0.88 },
        { transform: `translate(${dx - W2}px, ${dy}px)` },
      ], { duration: 3600, easing: 'ease-in-out' });
      await hintAnim.finished.catch(() => {});
      if (tok !== G.tok || G.interacted) break;
      await sleep(1600);
    }
    stopHint();
  }
  function stopHint() {
    if (hintAnim) { try { hintAnim.cancel(); } catch (e) { /* done */ } hintAnim = null; }
    $('#hand').classList.remove('on'); $('#joyHit').classList.remove('hint');
  }

  window.__clawApi = { G, drop, startGame, goTitle, candidate, nextRound: () => nextRound(G.tok), get machine() { return machine; } };
  boot().catch(e => { console.error(e); const l = $('#loading'); if (l) l.innerHTML = '<p style="font:700 20px sans-serif;color:#234">Could not start: ' + e.message + '</p>'; });
})();
