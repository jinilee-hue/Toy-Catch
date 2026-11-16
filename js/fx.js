/* Toy Catch — 2D effects over everything: confetti, fireworks, sparkles, star bursts (one canvas). */
(function () {
  'use strict';
  const FX = { parts: [], cv: null, g: null, dpr: 1, w: 0, h: 0 };
  const COLS = ['#ff4d6d', '#ffd23f', '#3ccf6b', '#3d9df2', '#b46cff', '#ff9a1f', '#5ff2ff', '#ff8fd0'];
  const rnd = (a, b) => a + Math.random() * (b - a);
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
  /* a firework: a ring of round sparks */
  FX.firework = function (x, y, c) {
    const u = U(), n = 34, col = c || COLS[Math.floor(Math.random() * COLS.length)];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd(-0.05, 0.05), sp = rnd(0.8, 1) * 42 * u;
      FX.parts.push({ k: 'spark', x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: col, life: rnd(0.9, 1.3), t: 0, r: 0.42 * u });
    }
    FX.parts.push({ k: 'flash', x, y, c: col, life: 0.35, t: 0, r: 9 * u });
  };
  /* little twinkling stars (the claw's trail, the coin) */
  FX.sparkle = function (x, y, n = 3, spread = 2) {
    const u = U();
    for (let i = 0; i < n; i++) FX.parts.push({ k: 'twinkle', x: x + rnd(-spread, spread) * u, y: y + rnd(-spread, spread) * u, vx: rnd(-3, 3) * u, vy: rnd(-6, 2) * u, c: Math.random() < 0.7 ? '#ffe680' : '#ffffff', life: rnd(0.5, 0.9), t: 0, r: rnd(0.8, 1.6) * u, rot: rnd(0, 3) });
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
  function four(g, r) { g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.28 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); }

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
        p.px = p.x; p.py = p.y; p.vy += 22 * u * dt; p.vx *= 1 - 1.8 * dt; p.vy *= 1 - 1.8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        // round sparks only: a coloured dot with a white core — no trail lines (user: "파티클에 라인들 들어간거 빼줘")
        g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r * 1.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x, p.y, p.r * 0.75, 0, Math.PI * 2); g.fill();
      } else if (p.k === 'flash') {
        const k = p.t / p.life, r = p.r * (0.5 + k);
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
      } else if (p.k === 'twinkle') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 3;
        const s = Math.sin(p.t / p.life * Math.PI);
        g.translate(p.x, p.y); g.rotate(p.rot); g.scale(s, s);
        g.fillStyle = p.c; four(g, p.r * 1.6); g.fill();
      } else if (p.k === 'star') {
        p.vy += 40 * u * dt; p.vx *= 1 - 2 * dt; p.vy *= 1 - 1.4 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const s = Math.min(1, p.t * 6);
        g.translate(p.x, p.y); g.rotate(p.rot); g.scale(s, s);
        g.fillStyle = p.c; g.strokeStyle = '#fff'; g.lineWidth = 0.35 * u; star(g, p.r); g.fill(); g.stroke();
      }
      g.restore();
    }
    FX.parts = keep;
  };
  window.FX = FX;
})();
