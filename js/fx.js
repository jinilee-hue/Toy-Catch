/* Toy Catch — 2D effects over everything: confetti, fireworks, sparkles, star bursts (one canvas).
 * No outlines anywhere (user: "흰색 선은 삭제", "테두리 선을 넣지말고 면으로 채워서"): stars are puffy and lit (light
 * top-left, deeper bottom-right, a soft gloss, a soft shadow under them), firework sparks are filled comets — a hot round
 * head and a tapering tail along their flight, long while fast, short as they slow — like a real chrysanthemum burst.
 * Both are drawn once per colour into small sprites, then only stamped (cheap on old iPads). */
(function () {
  'use strict';
  const FX = { parts: [], cv: null, g: null, dpr: 1, w: 0, h: 0 };
  const COLS = ['#ff4d6d', '#ffd23f', '#3ccf6b', '#3d9df2', '#b46cff', '#ff9a1f', '#5ff2ff', '#ff8fd0'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mixc = (a, b, k) => { const x = rgb(a), y = rgb(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',') + ')'; };
  const rgba = (a, al) => 'rgba(' + rgb(a).join(',') + ',' + al + ')';
  const SPR = {};
  /* a puffy star: rounded points, lit from the top left, a soft gloss, a soft coloured shadow under it */
  function starSprite(c) {
    if (SPR['s' + c]) return SPR['s' + c];
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), R = S * 0.34;
    g.translate(S / 2, S / 2 - S * 0.02); g.lineJoin = 'round'; g.lineWidth = S * 0.1;
    g.save(); g.shadowColor = rgba('#3a1e50', 0.3); g.shadowBlur = S * 0.05; g.shadowOffsetY = S * 0.04;
    star(g, R, 0.5); g.fillStyle = g.strokeStyle = mixc(c, '#000000', 0.2); g.fill(); g.stroke(); g.restore();
    const gr = g.createRadialGradient(-R * 0.38, -R * 0.5, R * 0.05, 0, R * 0.1, R * 1.3);
    gr.addColorStop(0, mixc(c, '#ffffff', 0.58)); gr.addColorStop(0.42, c); gr.addColorStop(1, mixc(c, '#000000', 0.26));
    star(g, R, 0.5); g.fillStyle = g.strokeStyle = gr; g.fill(); g.stroke();
    g.save(); star(g, R * 1.05, 0.52); g.clip();
    const sh = g.createLinearGradient(0, R * 0.05, 0, R * 1.1); sh.addColorStop(0, rgba('#000000', 0)); sh.addColorStop(1, rgba('#2a0f3a', 0.2));
    g.fillStyle = sh; g.fillRect(-S, -S, 2 * S, 2 * S);
    g.translate(-R * 0.3, -R * 0.36); g.scale(1, 0.62);
    const gl = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.5); gl.addColorStop(0, 'rgba(255,255,255,.75)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, R * 0.5, 0, Math.PI * 2); g.fill();
    g.restore();
    return (SPR['s' + c] = { cv, R: R * 1.15 });
  }
  /* a firework spark, in two filled pieces (no strokes): a soft feathered tail (stretched along the flight) and a round
     glowing head drawn on top (never stretched — a squashed head read as an arrowhead) */
  function sparkSprite(c) {
    if (SPR['k' + c]) return SPR['k' + c];
    const TW = 192, TH = 48, tail = document.createElement('canvas'); tail.width = TW; tail.height = TH;
    let g = tail.getContext('2d');
    for (let k = 0; k < 7; k++) {                        // stacked, narrower and denser to the middle: feathered edges
      const hw = TH * 0.5 * (1 - k / 7.5), tg = g.createLinearGradient(0, 0, TW, 0);
      tg.addColorStop(0, rgba(c, 0)); tg.addColorStop(0.7, rgba(c, 0.07)); tg.addColorStop(1, rgba(c, 0.16));
      g.fillStyle = tg; g.beginPath(); g.moveTo(0, TH / 2);
      g.quadraticCurveTo(TW * 0.7, TH / 2 - hw * 0.5, TW, TH / 2 - hw); g.lineTo(TW, TH / 2 + hw);
      g.quadraticCurveTo(TW * 0.7, TH / 2 + hw * 0.5, 0, TH / 2); g.closePath(); g.fill();
    }
    const HS = 64, head = document.createElement('canvas'); head.width = head.height = HS;
    g = head.getContext('2d');
    const glow = g.createRadialGradient(HS / 2, HS / 2, 0, HS / 2, HS / 2, HS / 2);
    glow.addColorStop(0, rgba(c, 0.9)); glow.addColorStop(0.35, rgba(c, 0.55)); glow.addColorStop(1, rgba(c, 0));
    g.fillStyle = glow; g.fillRect(0, 0, HS, HS);
    const hot = g.createRadialGradient(HS / 2, HS / 2, 0, HS / 2, HS / 2, HS * 0.2);
    hot.addColorStop(0, '#fff8e2'); hot.addColorStop(0.6, mixc(c, '#ffffff', 0.6)); hot.addColorStop(1, rgba(c, 0));
    g.fillStyle = hot; g.beginPath(); g.arc(HS / 2, HS / 2, HS * 0.2, 0, Math.PI * 2); g.fill();
    return (SPR['k' + c] = { tail, head });
  }
  FX.init = function (cv) {
    FX.cv = cv; FX.g = cv.getContext('2d');
    const size = () => { FX.dpr = Math.min(2, devicePixelRatio || 1); FX.w = cv.clientWidth; FX.h = cv.clientHeight; cv.width = FX.w * FX.dpr; cv.height = FX.h * FX.dpr; };
    size(); addEventListener('resize', size);
  };
  const U = () => Math.min(FX.h / 100, FX.w / 177.78);

  /* a burst of paper confetti from a point (up and out) */
  FX.confetti = function (x, y, n = 110, power = 1) {
    const u = U();
    for (let i = 0; i < n; i++) {
      const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05), sp = rnd(0.5, 1.25) * 95 * u * power;
      FX.parts.push({ k: 'paper', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: rnd(0, 6), vr: rnd(-12, 12), w: rnd(1, 1.8) * u, h: rnd(0.5, 0.9) * u, c: COLS[i % COLS.length], life: rnd(2.2, 3.4), t: 0, flip: rnd(0, 6) });
    }
  };
  /* confetti raining over the whole screen */
  FX.rain = function (n = 140) {
    const u = U();
    for (let i = 0; i < n; i++) FX.parts.push({ k: 'paper', x: rnd(0, FX.w), y: rnd(-FX.h * 0.4, -10), vx: rnd(-10, 10) * u, vy: rnd(10, 30) * u, rot: rnd(0, 6), vr: rnd(-8, 8), w: rnd(1, 1.8) * u, h: rnd(0.5, 0.9) * u, c: COLS[i % COLS.length], life: rnd(3, 4.5), t: 0, flip: rnd(0, 6) });
  };
  /* a firework: a chrysanthemum — an outer ring of comets in one colour, an inner ring in a lighter second colour */
  FX.firework = function (x, y, c) {
    const u = U(), col = c || COLS[Math.floor(Math.random() * COLS.length)];
    const col2 = col === '#ffd23f' ? '#ff8fd0' : '#ffe680';     // the inner ring: gold (pink inside a gold burst)
    const ring = (n, speed, cc, life, r) => {
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + rnd(-0.06, 0.06), sp = rnd(0.86, 1) * speed * u;
        FX.parts.push({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: cc, life: rnd(life * 0.85, life * 1.15), t: 0, r: r * u, fl: rnd(0, 6) });
      }
    };
    ring(30, 46, col, 1.25, 0.62);
    ring(14, 24, col2, 1.0, 0.5);
    FX.parts.push({ k: 'flash', x, y, c: col, life: 0.35, t: 0, r: 9 * u });
  };
  /* little twinkling stars (the claw's trail, the coin) */
  FX.sparkle = function (x, y, n = 3, spread = 2) {
    const u = U();
    for (let i = 0; i < n; i++) FX.parts.push({ k: 'twinkle', x: x + rnd(-spread, spread) * u, y: y + rnd(-spread, spread) * u, vx: rnd(-3, 3) * u, vy: rnd(-6, 2) * u, c: Math.random() < 0.65 ? '#ffd23f' : '#ffb347', life: rnd(0.5, 0.9), t: 0, r: rnd(0.8, 1.5) * u, rot: rnd(0, 3) });
  };
  /* puffy stars bursting out (a right answer) */
  FX.stars = function (x, y, n = 14) {
    const u = U();
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd(-0.2, 0.2), sp = rnd(30, 55) * u;
      FX.parts.push({ k: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10 * u, c: COLS[i % COLS.length], life: rnd(0.9, 1.3), t: 0, r: rnd(1.6, 2.6) * u, rot: rnd(0, 6), vr: rnd(-6, 6) });
    }
  };
  function star(g, r, k = 0.45) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * k : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); }

  FX.tick = function (dt) {
    const g = FX.g;
    if (!g) return;
    g.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0);
    g.clearRect(0, 0, FX.w, FX.h);
    if (!FX.parts.length) return;
    const u = U(), keep = [];
    for (const p of FX.parts) {
      p.t += dt;
      if (p.t >= p.life) continue;
      keep.push(p);
      const fade = Math.min(1, (p.life - p.t) / 0.4);
      g.save(); g.globalAlpha = fade;
      if (p.k === 'paper') {
        p.vy += 60 * u * dt; p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.2 * dt;
        p.x += (p.vx + Math.sin(p.t * 6 + p.flip) * 8 * u) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.cos(p.t * 9 + p.flip));
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.k === 'spark') {
        p.vy += 22 * u * dt; p.vx *= 1 - 1.8 * dt; p.vy *= 1 - 1.8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        // a soft tail along its flight (long while it's fast, short as it slows and droops) and a round glowing head;
        // it glitters at the end
        const sp = Math.hypot(p.vx, p.vy), spr = sparkSprite(p.c), hr = p.r * 1.25, len = Math.min(18 * u, sp * 0.2);
        if (p.t / p.life > 0.62) g.globalAlpha = fade * (0.5 + 0.5 * Math.sin(p.t * 38 + p.fl));
        g.translate(p.x, p.y); g.rotate(Math.atan2(p.vy, p.vx));
        if (len > hr) g.drawImage(spr.tail, -len, -hr * 1.1, len, hr * 2.2);
        g.drawImage(spr.head, -hr * 2.2, -hr * 2.2, hr * 4.4, hr * 4.4);
      } else if (p.k === 'flash') {
        const k = p.t / p.life, r = p.r * (0.5 + k);
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
      } else if (p.k === 'twinkle') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 3;
        const s = Math.sin(p.t / p.life * Math.PI);
        g.translate(p.x, p.y); g.rotate(p.rot); g.scale(s, s);
        const st = starSprite(p.c), d = p.r * 1.25 / st.R * st.cv.width;      // a small puffy golden star
        g.drawImage(st.cv, -d / 2, -d / 2, d, d);
      } else if (p.k === 'star') {
        p.vy += 40 * u * dt; p.vx *= 1 - 2 * dt; p.vy *= 1 - 1.4 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const s = Math.min(1, p.t * 6);
        g.translate(p.x, p.y); g.rotate(p.rot); g.scale(s, s);
        const st = starSprite(p.c), d = p.r * 1.15 / st.R * st.cv.width;      // puffy, lit — no white outline
        g.drawImage(st.cv, -d / 2, -d / 2, d, d);
      }
      g.restore();
    }
    FX.parts = keep;
  };
  window.FX = FX;
})();
