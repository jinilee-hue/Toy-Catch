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
  /* coins (user: "못 잡으면 동전 점수가 깍이고 한번 게임을 할때마다 점수가 차감되게해줘. 물론 맞추면 … 지금처럼 늘어나는거"):
     the score is your coins. You start with COINS.start; every go of the claw costs COINS.play (a coin drops into the
     machine's slot); a go that doesn't bring up the target friend (nothing caught, it slipped out, the
     wrong friend) costs COINS.miss more; the right friend pays 100 (+50 at the first try), as before. Never below 0 —
     with no coins left the claw still plays (it's a learning game). */
  const COINS = { start: 100, play: 10, miss: 20 };
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
     canvas resolution). pal: one palette, or a list of palettes the letters take in turn (spaces take none) */
  function jellyWord(text, pal, opts = {}) {
    const PLATE = opts.plate !== false;                  // (no plate: the letters stand straight on their pill — HUD)
    // (B: fatter than Baloo 800, like the logo's letters — but the small holes of a / s / e must stay open: kids read
    //  the shape (B .13 closed them: "a" and "s" looked like "8"); R: a thin bevel, so the face is most of the letter)
    const F = opts.F || 220, B = F * 0.075, E = F * 0.09, G = F * 0.022, R = F * 0.03, PL = PLATE ? F * 0.095 : 0, TRACK = -F * 0.02;
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
    ms.forEach((m, i) => { xs.push(x + m.actualBoundingBoxLeft); x += chars[i] === ' ' ? F * 0.13 : m.actualBoundingBoxLeft + m.actualBoundingBoxRight + (i < ms.length - 1 ? TRACK + B : 0); });   // (a narrow space: the plate stays one piece)
    const W = Math.ceil(x + 2 * pad), H = Math.ceil(asc + desc + E + 2 * pad), base = pad + asc;
    // (scratch canvases are emptied as soon as they're drawn: iPad Safari caps the memory all canvases may hold)
    const scratch = [], free = () => { for (const c of scratch.splice(0)) c.width = c.height = 0; };
    const mk = (keep) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.font = font; g.lineJoin = 'round'; g.textBaseline = 'alphabetic'; if (!keep) scratch.push(c); return [c, g]; };
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
      // gold line round the letter and its side, then the side
      o.fillStyle = o.strokeStyle = '#f5c45c'; for (let dy = E; dy >= 0; dy -= 1) glyph(o, i, dy, B + 2 * G);
      for (let dy = E; dy >= 0.5; dy -= 0.5) { o.fillStyle = o.strokeStyle = mix(side, sideDk, Math.min(1, dy / E)); glyph(o, i, dy, B); }
      { const gr = o.createLinearGradient(0, top, 0, bot); gr.addColorStop(0, mix(bevel, '#ffffff', 0.18)); gr.addColorStop(1, bevel); o.fillStyle = o.strokeStyle = gr; glyph(o, i, 0, B); }
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
      fg.shadowColor = rgba(bevel, 0.6); fg.shadowBlur = F * 0.025; fg.shadowOffsetY = 0; fg.drawImage(ic, 0, 0);                  // soft bevel into the face
      fg.shadowColor = rgba(glow, 0.95); fg.shadowBlur = F * 0.05; fg.shadowOffsetY = -F * 0.05; fg.drawImage(ic, 0, 0);           // glow inside the bottom
      fg.shadowColor = 'rgba(255,255,255,.8)'; fg.shadowBlur = F * 0.01; fg.shadowOffsetX = F * 0.008; fg.shadowOffsetY = F * 0.013; fg.drawImage(ic, 0, 0);   // shine on the top-left edges
      o.drawImage(fc, 0, 0);
      // the white spot: just inside the face's top-left, where the face starts
      { const d = fg.getImageData(0, 0, W, H).data; let best = null;
        for (let y = Math.floor(top); y < top + gh * 0.45 && !best; y += 2) for (let xx = 0; xx < W; xx += 2) if (d[(y * W + xx) * 4 + 3] > 200) {
          let run = 0; while (xx + run < W && d[(y * W + xx + run) * 4 + 3] > 200) run += 2;
          if (run > F * 0.12) { best = [xx + F * 0.07, y + F * 0.06]; } break; }
        if (best) { o.save(); o.translate(best[0], best[1]); o.rotate(-0.5); o.fillStyle = 'rgba(255,255,255,.92)'; o.beginPath(); o.ellipse(0, 0, F * 0.034, F * 0.02, 0, 0, Math.PI * 2); o.fill(); o.restore(); } }
      free();
    });
    out.className = 'jelly';
    return out;
  }
  const jellyCache = {};
  /* the result's title in the logo's jelly letters on the logo's glass plate (was a pink ribbon — user: "전체적으로 디자인이
     게임화면과 인트로 화면과 다른 느낌이고 컬러가 너무 많아"): one gold-yellow jelly (the logo's Y), with the stars and the
     card's gold rim — fewer colours than the rainbow; ?title=rainbow (the logo's / START's colours letter by letter) or
     ?title=<JELLY name> for comparing. The same letter size for every title (css height from the canvas, in --u); drawn
     at the size it shows on this screen (F = font px: sharp on 2x and big screens, quicker on small ones), once. */
  const TITLE_U = 15.4, TITLE_Q = qs.get('title'), titleCache = {};
  const TITLE_PAL = TITLE_Q === 'rainbow' ? RAINBOW.map(k => JELLY[k]) : JELLY[Object.prototype.hasOwnProperty.call(JELLY, TITLE_Q) ? TITLE_Q : 'yellow'];
  function resultTitle(text) {
    const u = Math.min(innerHeight / 100, innerWidth / 177.78);
    const F = Math.max(160, Math.min(440, Math.round(TITLE_U * u * (window.devicePixelRatio || 1) / 20) * 20));
    let t = titleCache[text];
    if (!t || t.F !== F) {
      t = titleCache[text] = { F, cv: jellyWord(text, TITLE_PAL, { F }) };
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
    const DMAX = 7;                                      // the wave: up to DMAX px bolder than the resting weight
    const pos = []; { let xx = x; LET.forEach((_, i) => { pos.push(xx + adv[i] / 2); xx += adv[i] + TRACK; }); }
    /* the white outline: ONE shape round the whole word (user: "흰색 라인은 같이 하나로 묶여있고"; per-letter outlines met
       in V-notches and looked "조각조각") — every letter stroked thick into one mask, blurred and cut at half (a gooey
       merge: the notches between letters fill with round fillets, like a sticker's outline); then its lavender side
       and the white extruded under it like the letters. Drawn once: it stays still while the letters' weight waves. */
    const OB = [BOX[0], -40, BOX[2], 262];               // the outline's box (the letters stand above the button's)
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
      const [mc, mg] = canvas(OB[2], OB[3]);
      mg.translate(-OB[0], -OB[1]);
      mg.font = font; mg.textAlign = 'center'; mg.textBaseline = 'alphabetic'; mg.lineJoin = 'round';
      mg.fillStyle = mg.strokeStyle = '#fff'; mg.lineWidth = O * 2 + B + DMAX;
      LET.forEach(([ch], i) => { mg.save(); mg.translate(pos[i], 0); mg.scale(SX, 1); mg.fillText(ch, 0, BASE); mg.strokeText(ch, 0, BASE); mg.restore(); });
      gooey(mc, Math.round(4.5 * K), 8);
      const tint = (col) => { const [c, g] = canvas(OB[2], OB[3]); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(mc, 0, 0);
        g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); return c; };
      const wh = tint('#fbf4f6'), lv = tint('#a9a1c2');
      const [oc, og] = canvas(OB[2], OB[3]); og.setTransform(1, 0, 0, 1, 0, 0);
      for (let dy = E + OS; dy >= E; dy -= 0.5) og.drawImage(lv, 0, dy * K);
      for (let dy = E; dy >= 0; dy -= 0.5) og.drawImage(wh, 0, dy * K);
      oc.className = 'outline'; place(oc, OB[0], OB[1], OB[2], OB[3]); tilt.appendChild(oc);
    }
    /* the letters, each in its own canvas. The wave (user: "글자의 두께가 물결처럼 작아졌다 커졌다 순차적으로 계속
       롤링"): each letter gets bolder and back, one after another, round and round, inside the still outline. Every
       weight is drawn once (the resting one now, the rest a few per frame after the title shows); the wave only swaps
       pictures. */
    const NW = 6, FR = LET.map(() => []);
    const hw = (i) => adv[i] / 2 + O + B + DMAX + 10, top = BASE - FS * 0.86, lh = FS * 0.86 + E + B + DMAX + 12;
    const drawLetter = (i, extra) => {
      const [ch, f0, f1, s0, s1] = LET[i], half = hw(i), BW = B + extra;
      const [c, g] = canvas(half * 2, lh);
      g.translate(half, -top); g.scale(SX, 1);
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      const layer = (col, dy, lw) => { g.fillStyle = col; g.fillText(ch, 0, BASE + dy); g.strokeStyle = col; g.lineWidth = lw + BW; g.strokeText(ch, 0, BASE + dy); };
      for (let dy = E; dy >= 0.5; dy -= 0.5) layer(mix(s0, s1, Math.min(1, dy / (E * 0.35))), dy, 1.2);   // the letter's side
      // the face, puffed: its own canvas, then a soft dark rim along the bottom edge and a light one along the top-left
      // (inner shadows: the shadow of everything OUTSIDE the letter, drawn only onto the letter)
      const [fc, fg] = canvas(half * 2, lh), [ic, ig] = canvas(half * 2, lh);
      for (const q of [fg, ig]) { q.setTransform(g.getTransform()); q.font = font; q.textAlign = 'center'; q.textBaseline = 'alphabetic'; q.lineJoin = 'round'; q.lineWidth = BW; }
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
      return c;
    };
    const vis = LET.map((_, i) => {
      const [c] = canvas(hw(i) * 2, lh); c.className = 'L';
      place(c, pos[i] - hw(i), top, hw(i) * 2, lh); tilt.appendChild(c);
      return c;
    });
    const show = (i, k) => { const c = vis[i], g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.drawImage(FR[i][k], 0, 0); };
    LET.forEach((_, i) => { FR[i][0] = drawLetter(i, 0); show(i, 0); });
    const todo = []; for (let k = 1; k < NW; k++) LET.forEach((_, i) => todo.push([i, k]));
    let waveOn = false;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, cur = LET.map(() => 0);
    const more = () => {
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 8) { const [i, k] = todo.shift(); FR[i][k] = drawLetter(i, DMAX * k / (NW - 1)); }
      if (todo.length) setTimeout(more, 16); else waveOn = true;
    };
    setTimeout(more, 300);
    const wave = (now) => {
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
    G.startWave = { ready: () => waveOn, frames: () => cur.slice() };   // (QA)
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
    const st = app.style;
    st.setProperty('--mx', C.x + 'px'); st.setProperty('--mt', C.y + 'px'); st.setProperty('--mu', mu + 'px');
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
    const p = S.project(slot); FX.sparkle(p.x, p.y, 14, 4); FX.stars(p.x, p.y, 8, 0.55);   // (a coin-sized pop)
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
    setTimeout(() => { if (tok === G.tok) addScore(COINS.start); }, 500);   // this game's coins come in as the HUD shows
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
    // the letters and the speaker button as one set: jelly letters straight on the blue pill (no plate of their own —
    // a pale plate inside the pill looked pasted on) and the button in the same jelly, the letters' colour (user:
    // "전체적인 박스와 글자와 버튼이 이질감이 없게")
    const pal = JELLY[LETTER_JELLY[L] || 'pink'];
    const cv = jellyCache[L] || (jellyCache[L] = jellyWord(up + L, pal, { plate: false }));
    $('#tgLetter').replaceChildren(cv); $('#tgLetter').setAttribute('aria-label', up + L);
    ['--jt', '--jm', '--jl', '--jb', '--js', '--jd', '--jg'].forEach((k, i) => $('#target').style.setProperty(k, pal[i]));
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
    payCoin(tok);                                        // a go costs a coin
    const cand = candidate();
    const zone = cand ? aimZone(cand) : 'none';
    const off = cand ? claw.x - cand.x : 0;              // the claw's offset from the head's middle
    const x0 = claw.x, z0 = claw.z, g0 = claw.grip;
    const tx = claw.x, tz = cand ? cand.z : claw.z;      // straight down where it was aimed (into the friend's row)
    // the prongs will close until their knuckles touch the sides of the head; the hub stops where that puts the
    // knuckles level with the head's middle (and never lower than just over the head)
    let hy = cand ? cand.headR[1] * PS : 0, hx = cand ? cand.headR[0] * PS : 0, gy = cand ? cand.gripY : 0;
    if (cand && cand.widthAt) {
      /* a 3D friend: close round its real width there (a fish's round body is wider than its head; a little too wide
         and it gets squeezed). Far too wide (the turtle: its head sticks out beside the shell) — hold it higher up,
         round the top of the shell, where it fits */
      const REACH = 0.78, w0 = cand.widthAt(gy) * PS;
      if (w0 <= REACH * 1.12) hx = Math.max(hx, Math.min(REACH, w0));
      else {
        let y = gy; while (y < cand.top - 0.1 && cand.widthAt(y) * PS > REACH * 0.98) y += 0.02;
        hx = Math.max(0.36, Math.min(REACH, cand.widthAt(y) * PS)); hy = Math.max(0.08, (cand.top - y) * PS * 0.9); gy = y;
      }
      cand.setGrip3d(gy, hx * 1.02 / PS);
    }
    const shut = cand ? claw.gripAngle(hx * 1.02) : claw.SHUT;
    const yHead = cand ? cand.root.position.y + gy * PS : 0;
    const yBot = cand ? Math.max(yHead + claw.knuckleDrop(shut), yHead + hy + 0.03) : 1.45;
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
    if (held && held.home.y < 0.6) setTimeout(() => machine.balls.splash(tx, tz, 0.6), 160);   // lifted out of the balls
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
      loseCoins(tok, 250);                              // nothing brought up: coins off
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
    A.sfxPlay('thud'); p.nope(0.8); machine.balls.splash(p.home.x, p.home.z, 0.9); if (p.bump) p.bump(0.7);   // lands: squash
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
    addScore(gain);
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
    // a 3D friend spins once on the way out (its cap stays under the TARGET banner); a flat picture doesn't (its edge)
    const spin = p.is3d; if (spin) { p.faceCam = false; p.face.rotation.y = 0; }
    const face0 = Math.atan2(cam.position.x - end.x, cam.position.z - end.z);
    await S.tween(800, k => {
      const pos = start.clone().lerp(end, k); pos.y += Math.sin(k * Math.PI) * 1.4;
      p.root.position.copy(pos); p.root.scale.setScalar(lerp(0.5, 1.4, k));
      if (spin) p.root.rotation.y = face0 - (1 - k) * Math.PI * 2;
    }, 'out', tok);
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
    loseCoins(tok, 450);                                // the wrong friend: coins off
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
    A.sfxPlay('thud'); machine.balls.splash(p.home.x, p.home.z, 0.9); if (p.bump) p.bump(0.7);   // lands: squash
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
    const n = G.caught.length;
    const all = n >= LETTERS.length;
    const title = all ? 'PERFECT!' : n >= 2 ? 'GREAT JOB!' : 'NICE TRY!';
    const titleCv = resultTitle(title);                  // (drawn now, the first time, while nothing moves yet)
    await dolly(0, 900);
    if (tok !== G.tok) return;
    setScreen('result');
    const stars = all ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0;
    [...$('#stars').children].forEach((s, i) => s.classList.toggle('on', i < stars));
    $('#resTitle').replaceChildren(titleCv); $('#resTitle').setAttribute('aria-label', title);
    $('#finalScore').textContent = G.score;
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

  /* the score (coins) goes up or down: it counts to the new value — up: the coin flips and the pill bumps; down: the pill
     shakes — and a little "+150" / "−20" tag drops out under it. Returns the change (0 when there was nothing to take). */
  function addScore(n) {
    const a = G.score, b = Math.max(0, a + n);
    if (b === a) return 0;
    G.score = b;
    const el = $('#score'), box = el.parentElement, up = b > a;
    box.classList.remove('bump', 'minus'); void box.offsetWidth; box.classList.add(up ? 'bump' : 'minus');
    S.tween(700, k => (el.textContent = Math.round(lerp(a, b, k))), 'out');
    box.querySelectorAll('.score-delta').forEach(t => t.remove());
    const tag = document.createElement('i');
    tag.className = 'score-delta' + (up ? '' : ' minus'); tag.textContent = (up ? '+' : '\u2212') + Math.abs(b - a);
    tag.setAttribute('aria-hidden', 'true');
    box.appendChild(tag); setTimeout(() => tag.remove(), 1500);
    return b - a;
  }
  /* a go of the claw costs a coin: the score shows −10 and a coin drops into the machine's slot by the DOWN button (the
     START coin, shorter) — right where the child is looking (a coin flying over from the score cut across the glass and
     the claw on its way down) */
  function payCoin(tok) {
    if (!addScore(-COINS.play)) return;                 // no coins left: the go is free
    A.sfxPlay('coin');                                  // (its clink, half a second in, is the coin going in)
    const coin = machine.coin, local = machine.group.worldToLocal(machine.slotPoint());
    coin.visible = true;
    S.tween(420, k => {
      coin.position.set(local.x, local.y + 0.12 + 0.8 * (1 - k), local.z + 0.22 * (1 - k));
      coin.rotation.set(Math.PI / 2, 0, k * Math.PI * 3); coin.scale.setScalar(1.35 - 0.35 * k);
    }, 'in', tok)
      .then(() => S.tween(170, k => { coin.position.y = local.y + 0.12 - 0.2 * k; coin.scale.setScalar(1 - 0.4 * k); }, 'in', tok))
      .then(() => {
        coin.visible = false;
        if (tok !== G.tok) return;
        const q = S.project(machine.slotPoint()); FX.sparkle(q.x, q.y, 8, 3);
      });
  }
  /* a go that didn't bring up the target friend: coins off (after a beat, so it lands with the "oh no") */
  function loseCoins(tok, delay = 0) {
    setTimeout(() => { if (tok === G.tok && addScore(-COINS.miss)) A.sfxPlay('lose'); }, delay);
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
      await hintAnim.finished.catch(() => {});
      if (tok !== G.tok || G.interacted) break;
      // between two showings it fades out where it ended (on DOWN). Without the fill it jumped back to its resting place
      // — the screen's top-left corner, over the score — and waited there (user: "상단에 화살표 왜 가있는거야?")
      hand.classList.remove('on');
      await sleep(1600);
    }
    stopHint();
  }
  function stopHint() {
    const h = $('#hand'), a = hintAnim; hintAnim = null;
    h.classList.remove('on'); $('#joyHit').classList.remove('hint');
    machine.joyHint(false); if (!G.joy) machine.setJoy(0);
    if (a) setTimeout(() => { try { a.cancel(); } catch (e) { /* done */ } }, 350);   // after the fade: no jump to the corner
  }

  window.__clawApi = { G, drop, startGame, goTitle, candidate, setTarget, finish, nextRound: () => nextRound(G.tok), get machine() { return machine; } };
  boot().catch(e => { console.error(e); const l = $('#loading'); if (l) l.innerHTML = '<p style="font:700 20px sans-serif;color:#234">Could not start: ' + e.message + '</p>'; });
})();
