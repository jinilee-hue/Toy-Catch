/* Toy Catch — 2D effects over everything (one canvas): the bursts of the user's own Word Mashup 3D (its card crash,
 * phonics-wordmashup-3D src/gl/mashup.ts — user: "지금은 너무 조잡하게 터져", "phonics-wordmashup-3D 참고해서"):
 *  · candy streaks — opaque glossy strokes, a thin tail to a fat round head, shot out from the middle, slowing down and
 *    thinning away (instead of glowing firework trails)
 *  · chunky 3D stars — extruded with a round bevel, glossy candy plastic, tumbling along a ballistic arc
 *  · candy dots (the confetti) — little glossy balls flung up and out with drag and gravity (instead of paper)
 *  · cloud puffs — toon cumulus clusters (white top, lavender underside): jetting out to a ring round a right answer
 *    (with smoke trails), or a heap at the heart of a pop
 * Everything pops in (ease-out-back) and shrinks away instead of fading. No outlines anywhere (user: "흰색 선은 삭제").
 * The 3D pieces are rendered ONCE with three.js into sprite sheets (a tumble cycle per star colour, a ball per colour,
 * three puff clusters), in small slices after load, under the reference's light budget; then they are only stamped
 * with drawImage — no per-frame WebGL, no ctx.filter, capped counts (old iPads). Plain 2D sprites stand in until the
 * sheets are ready (or if WebGL is missing). FX runs on the frame clock (FX.tick(dt) from the game loop), so
 * Stage.frozen + Stage.step(dt) captures are exact. */
(function () {
  'use strict';
  const FX = { parts: [], cv: null, g: null, dpr: 1, w: 0, h: 0, MAX: 520, baked: false, ready: null, dirty: true };
  // the reference's candy palette (yellow, pink, red, blue, orange, green, purple, cyan) and its stars (mostly gold)
  const PALETTE = ['#ffd23f', '#ff4fa3', '#ff5a5a', '#3fa7ff', '#ff9a2e', '#6bd66b', '#9b6bff', '#37d6ff'];
  const STAR_COLS = ['#ffd23f', '#ff7ac0', '#4db8ff'];
  const STAR_PICK = [0, 0, 0, 0, 1, 2];                 // 4 of 6 gold
  const NF = 40, FC = 8;                                 // star tumble frames, frames per sheet row
  // sprite px: star frame, candy ball, puff cluster (big enough for a Retina 1600×900 burst: 128 px stars and puffs
  // were upscaled ~1.9× / 2.7× there and looked soft)
  const SS = 160, DS = 64, PZ = 192, NPUFF = 3;
  const STAR_K = 2.5, BALL_K = 2.16, PUFF_K = 2.8;     // sprite width / the particle's radius
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lin = (a, b, x) => clamp01((x - a) / (b - a));
  const smooth = (a, b, x) => { const t = lin(a, b, x); return t * t * (3 - 2 * t); };
  const outBack = (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const outCubic = (x) => 1 - Math.pow(1 - x, 3);
  const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mixc = (a, b, k) => { const x = rgb(a), y = rgb(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',') + ')'; };
  const rgba = (a, al) => 'rgba(' + rgb(a).join(',') + ',' + al + ')';
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const hash = (n) => { const s = Math.sin(n * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s); };
  const SPR = {};
  let SHEET = null;                                      // the baked 3D sprites

  /* ── sprites drawn in 2D ─────────────────────────────────────────────────────────────────────────── */
  /* a candy streak (the reference's stroke): thin tail on the left, a fat round head on the right; lit from above —
     lighter along the top, deeper underneath — and a soft glossy stripe on the head, all in its own colour */
  function streakSprite(c) {
    if (SPR['k' + c]) return SPR['k' + c];
    const W = 320, H = 64, M = H / 2, hx = W - 34, hr = 24, cv = canvas(W, H), g = cv.getContext('2d');
    const body = () => {
      g.beginPath(); g.moveTo(4, M);
      g.quadraticCurveTo(W * 0.47, M - 10, hx, M - hr);
      g.arc(hx, M, hr, -Math.PI / 2, Math.PI / 2);
      g.quadraticCurveTo(W * 0.47, M + 10, 4, M);
      g.closePath();
    };
    const gr = g.createLinearGradient(0, M - hr, 0, M + hr);
    gr.addColorStop(0, mixc(c, '#ffffff', 0.34)); gr.addColorStop(0.42, c); gr.addColorStop(1, mixc(c, '#000000', 0.2));
    body(); g.fillStyle = gr; g.fill();
    g.save(); body(); g.clip();
    const gl = g.createLinearGradient(hx - 130, 0, hx + 10, 0);
    gl.addColorStop(0, rgba(c, 0)); gl.addColorStop(0.6, 'rgba(255,255,255,.42)'); gl.addColorStop(1, 'rgba(255,255,255,.62)');
    g.fillStyle = gl; g.beginPath(); g.ellipse(hx - 58, M - hr * 0.5, 76, 5.2, -0.05, 0, Math.PI * 2); g.fill();
    g.restore();
    return (SPR['k' + c] = cv);
  }
  /* the smoke a flying puff leaves behind (the reference's trail): a faint tail on the left, a thick soft head on the
     right — feathered by stacking the shape narrower toward the middle (no ctx.filter) */
  function trailSprite() {
    if (SPR.t) return SPR.t;
    const W = 256, H = 64, M = H / 2, cv = canvas(W, H), g = cv.getContext('2d');
    for (let k = 0; k < 6; k++) {
      const hr = 28 * (1 - k / 7), gr = g.createLinearGradient(0, 0, W, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(246,246,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,.2)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, M);
      g.quadraticCurveTo(140, M - hr * 0.43, 226, M - hr); g.arc(226, M, hr, -Math.PI / 2, Math.PI / 2);
      g.quadraticCurveTo(140, M + hr * 0.43, 0, M); g.closePath(); g.fill();
    }
    return (SPR.t = cv);
  }
  /* a soft warm glow (under the glints) */
  function glowSprite(c) {
    if (SPR['g' + c]) return SPR['g' + c];
    const S = 64, cv = canvas(S, S), g = cv.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,252,232,.95)'); gr.addColorStop(0.22, rgba(c, 0.6)); gr.addColorStop(0.55, rgba(c, 0.16)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return (SPR['g' + c] = cv);
  }
  /* stand-ins until the 3D sheets are baked: a shaded ball, a puffy star, a blob cloud (same scale as the sheets) */
  function ball2d(c) {
    if (SPR['b' + c]) return SPR['b' + c];
    const cv = canvas(DS, DS), g = cv.getContext('2d'), R = DS / BALL_K;
    const gr = g.createRadialGradient(DS / 2 - R * 0.35, DS / 2 - R * 0.4, R * 0.05, DS / 2, DS / 2, R);
    gr.addColorStop(0, mixc(c, '#ffffff', 0.6)); gr.addColorStop(0.5, c); gr.addColorStop(1, mixc(c, '#000000', 0.25));
    g.fillStyle = gr; g.beginPath(); g.arc(DS / 2, DS / 2, R, 0, Math.PI * 2); g.fill();
    return (SPR['b' + c] = cv);
  }
  function star2d(c) {
    if (SPR['s' + c]) return SPR['s' + c];
    const cv = canvas(SS, SS), g = cv.getContext('2d'), R = SS / STAR_K * 0.92;
    g.translate(SS / 2, SS / 2); g.lineJoin = 'round'; g.lineWidth = R * 0.24;
    const gr = g.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.05, 0, R * 0.1, R * 1.3);
    gr.addColorStop(0, mixc(c, '#ffffff', 0.55)); gr.addColorStop(0.45, c); gr.addColorStop(1, mixc(c, '#000000', 0.25));
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.5 : R; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fillStyle = g.strokeStyle = gr; g.fill(); g.stroke();
    return (SPR['s' + c] = cv);
  }
  function puff2d() {
    if (SPR.p) return SPR.p;
    const cv = canvas(PZ, PZ), g = cv.getContext('2d'), u = PZ / PUFF_K;
    for (const [x, y, , r] of LOBES) {
      const cx = PZ / 2 + x * u, cy = PZ / 2 - y * u, gr = g.createLinearGradient(0, cy - r * u, 0, cy + r * u);
      gr.addColorStop(0.35, '#fffefb'); gr.addColorStop(1, '#c9c9ec');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r * u, 0, Math.PI * 2); g.fill();
    }
    return (SPR.p = cv);
  }

  /* ── the 3D sprites, baked once with three.js ─────────────────────────────────────────────────────── */
  // a puff is a little cauliflower of lobes (unit radius 1): x, y, z, r — flatter underneath (the reference's)
  const LOBES = [[0, 0.06, 0, 0.62], [-0.5, -0.1, 0.08, 0.46], [0.52, -0.08, 0.06, 0.48], [-0.2, 0.44, 0.02, 0.42], [0.26, 0.38, 0.1, 0.4], [0.02, -0.32, 0.2, 0.44]];
  // soft toon cumulus: white top, lavender-blue underside, a bright rim (the reference's cloud shader)
  const CLOUD_VS = 'varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const CLOUD_FS = `varying vec3 vN;
    void main() {
      vec3 n = normalize(vN);
      float ndl = dot(n, normalize(vec3(-0.35, 0.8, 0.5)));
      vec3 c = mix(vec3(0.70, 0.70, 0.90), vec3(0.89, 0.89, 0.97), smoothstep(-0.6, -0.05, ndl));
      c = mix(c, vec3(1.0, 0.996, 0.985), smoothstep(0.0, 0.5, ndl));
      c = mix(c, vec3(1.0), pow(1.0 - max(n.z, 0.0), 3.0) * 0.3);
      gl_FragColor = vec4(c, 1.0);
    }`;
  /* a chunky star: rounded points, a round bevel all the way round (smooth normals = puffy), as thick as the
     reference's (depth .26 + bevel .17 a side) */
  function starGeometry(T) {
    const sh = new T.Shape(), V = [];
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.47 : 1; V.push([Math.cos(a) * r, Math.sin(a) * r]); }
    for (let i = 0; i < 10; i++) {
      const p = V[i];
      if (i % 2) { sh.lineTo(p[0], p[1]); continue; }                 // inner corners: the bevel rounds them
      const q = V[(i + 9) % 10], s = V[i + 1], k = 0.17;              // the points: rounded, no spikes
      const a = [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k], b = [p[0] + (s[0] - p[0]) * k, p[1] + (s[1] - p[1]) * k];
      if (i === 0) sh.moveTo(a[0], a[1]); else sh.lineTo(a[0], a[1]);
      sh.quadraticCurveTo(p[0], p[1], b[0], b[1]);
    }
    sh.closePath();
    const D = 0.26;
    let geo = new T.ExtrudeGeometry(sh, { depth: D, bevelEnabled: true, bevelThickness: 0.17, bevelSize: 0.1, bevelSegments: 5, curveSegments: 6 });
    geo.translate(0, 0, -D / 2);
    if (T.mergeVertices) { geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = T.mergeVertices(geo, 1e-4); geo.computeVertexNormals(); }
    return geo;
  }
  function bake() {
    const T = window.THREE, t0 = performance.now();
    let r = null;
    try { if (T) r = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); } catch (e) { r = null; }
    if (!r) return Promise.resolve(false);
    const B = 256;                                      // rendered bigger than the sprites (smoother edges)
    r.setPixelRatio(1); r.setSize(B, B, false);
    r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.NoToneMapping;
    r.setClearColor(0x000000, 0);
    /* the reference's light budget (its stage.ts: no tone mapping; a face turned to the camera shows its own colour,
       the sides fall off to about half — saturated faces, deep golden sides), with the key on Toy Catch's side (upper
       left, front). Neutral tone mapping + the game's brighter rig washed the gold out to butter. */
    const scene = new T.Scene(), pm = new T.PMREMGenerator(r), env = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    scene.environment = env; scene.environmentIntensity = 0.12;
    scene.add(new T.HemisphereLight('#ffffff', '#e6e3ee', Math.PI * 0.48));
    const key = new T.DirectionalLight('#fffcf8', Math.PI * 0.6); key.position.set(-1.6, 3.2, 6); scene.add(key);
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 30); cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0);
    const view = (h) => { cam.left = cam.bottom = -h; cam.right = cam.top = h; cam.updateProjectionMatrix(); };
    // glossy candy plastic, no clearcoat (the reference's stars: roughness .35, a warm emissive)
    const mat = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0 });
    const cloud = new T.ShaderMaterial({ vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS });
    const starGeo = starGeometry(T), ballGeo = new T.SphereGeometry(1, 40, 28), lobeGeo = new T.SphereGeometry(1, 32, 22);
    const star = new T.Mesh(starGeo, mat), ball = new T.Mesh(ballGeo, mat);
    const sh = { star: STAR_COLS.map(() => canvas(FC * SS, Math.ceil(NF / FC) * SS)), ball: {}, puff: canvas(NPUFF * PZ, PZ) };
    const shoot = (cv, x, y, w) => {
      r.render(scene, cam);
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(r.domElement, 0, 0, B, B, x, y, w, w);
    };
    const jobs = [];
    // the tumble: round an axis tipped ~25° off the line of sight (as the reference's stars spin), so the star turns
    // and rocks — its thick bevelled side shows — and each star plays it from its own frame, either way round
    const axis = new T.Vector3(0.36, 0.28, 1).normalize();
    STAR_COLS.forEach((c, ci) => {
      jobs.push(() => { scene.add(star); mat.color.set(c); mat.roughness = 0.35; mat.emissive.set(ci ? '#140a10' : '#2a1a00'); view(STAR_K / 2); });
      for (let f = 0; f < NF; f++) {
        jobs.push(() => { star.quaternion.setFromAxisAngle(axis, f / NF * Math.PI * 2); shoot(sh.star[ci], (f % FC) * SS, Math.floor(f / FC) * SS, SS); });
      }
      jobs.push(() => scene.remove(star));
    });
    PALETTE.forEach(c => jobs.push(() => {
      scene.add(ball); mat.color.set(c); mat.roughness = 0.32; mat.emissive.set('#111111'); view(BALL_K / 2);
      sh.ball[c] = canvas(DS, DS); shoot(sh.ball[c], 0, 0, DS); scene.remove(ball);
    }));
    for (let v = 0; v < NPUFF; v++) jobs.push(() => {
      const grp = new T.Group();
      LOBES.forEach(([x, y, z, lr], i) => {
        const m = new T.Mesh(lobeGeo, cloud); m.position.set(v === 1 ? -x : x, y, z); m.scale.setScalar(lr * (0.86 + 0.28 * hash(v * 7 + i))); grp.add(m);
      });
      grp.rotation.z = (v - 1) * 0.22; scene.add(grp); view(PUFF_K / 2); shoot(sh.puff, v * PZ, 0, PZ); scene.remove(grp);
    });
    const done = (ok) => {
      // (a context lost half way — a tab sent to the back on an iPad — leaves blank sheets: keep the 2D stand-ins then)
      if (ok) ok = sh.star[0].getContext('2d').getImageData(SS / 2, SS / 2, 1, 1).data[3] > 200;
      try { starGeo.dispose(); ballGeo.dispose(); lobeGeo.dispose(); mat.dispose(); cloud.dispose(); env.dispose(); pm.dispose(); r.dispose(); r.forceContextLoss(); } catch (e) { /* gone */ }
      if (ok) { SHEET = sh; FX.baked = true; }
      FX.bakeMs = Math.round(performance.now() - t0);                // (QA)
      return ok;
    };
    return new Promise(res => {
      let i = 0;
      const slice = () => {
        const ts = performance.now();
        try { while (i < jobs.length && performance.now() - ts < 10) jobs[i++](); } catch (e) { console.warn('[fx] 3D sprites', e); res(done(false)); return; }
        if (i < jobs.length) setTimeout(slice, 0); else res(done(true));
      };
      setTimeout(slice, 0);
    });
  }

  FX.init = function (cv) {
    FX.cv = cv; FX.g = cv.getContext('2d');
    const size = () => { FX.dpr = Math.min(2, devicePixelRatio || 1); FX.w = cv.clientWidth; FX.h = cv.clientHeight; cv.width = FX.w * FX.dpr; cv.height = FX.h * FX.dpr; FX.dirty = true; };
    size(); addEventListener('resize', size);
    FX.ready = bake();
  };
  const U = () => Math.min(FX.h / 100, FX.w / 177.78);     // 1 % of the height of a 16:9 screen
  const add = (p) => { if (FX.parts.length < FX.MAX) FX.parts.push(p); };

  /* ── emitters (sizes in B = the screen's 16:9 height, like the reference's min(W, H)) ─────────────── */
  /* candy streaks shooting out of (x, y) all round, decelerating, thinning out at the end. o.s scales the reach;
     the width shrinks less (o.sw) — thin streaks read as lines */
  function streaks(x, y, n, o = {}) {
    const B = 100 * U() * (o.s || 1), Bw = 100 * U() * (o.sw || Math.sqrt(o.s || 1)), cols = o.cols || PALETTE;
    const v = o.v || [1.8, 2.8], life = o.life || [0.55, 0.85], off = Math.random() * 6.283;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + rnd(-0.25, 0.25);
      add({ k: 'streak', x, y, t: -rnd(0, 0.06), life: rnd(life[0], life[1]), ang: a, ca: Math.cos(a), sa: Math.sin(a),
        r0: B * (o.r0 ?? 0.03), v: B * rnd(v[0], v[1]), len: B * rnd(0.18, 0.32), w: Bw * rnd(0.02, 0.034), c: cols[i % cols.length] });
    }
  }
  /* chunky 3D stars on a ballistic arc (a kick up), tumbling; o.ring: they start on a ring that far out (in B) —
     round a friend rather than on its face */
  function stars3(x, y, n, o = {}) {
    const B = 100 * U() * (o.s || 1), v = o.v || [0.6, 1.3], R = 100 * U() * (o.ring || 0);
    for (let i = 0; i < n; i++) {
      const a = o.ring ? (i / n) * Math.PI * 2 + rnd(-0.3, 0.3) : rnd(0, Math.PI * 2), sp = B * rnd(v[0], v[1]);
      add({ k: 'star', x: x + Math.cos(a) * R + rnd(-0.04, 0.04) * B, y: y - Math.sin(a) * R * 0.9 + rnd(-0.04, 0.04) * B, t: -rnd(0, 0.08),
        life: rnd(0.9, 1.3), vx: Math.cos(a) * sp, vy: -(Math.sin(a) * sp * 0.85 + B * (o.up ?? 0.35)), g: B * (o.g ?? 0.95),
        r: B * rnd(0.03, 0.055), ci: o.gold ? 0 : pick(STAR_PICK), f0: rnd(0, NF),
        fs: rnd(4, 9) / (Math.PI * 2) * NF * (Math.random() < 0.5 ? -1 : 1), rot: rnd(-0.35, 0.35) });
    }
  }
  /* candy dots flung up and out: linear drag + gravity (any colour snaps to the nearest baked candy colour) */
  const NEAR = {};
  const near = (c) => NEAR[c] || (NEAR[c] = PALETTE.reduce((best, p) => {
    const a = rgb(c), b = rgb(p), d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    return d < best[1] ? [p, d] : best;
  }, [PALETTE[0], Infinity])[0]);
  function dots(x, y, n, o = {}) {
    const B = 100 * U() * (o.s || 1), v = o.v || [0.5, 1.6], cols = o.cols || PALETTE;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = B * rnd(v[0], v[1]);
      add({ k: 'dot', x, y, t: 0, life: rnd(1.3, 2.1), vx: Math.cos(a) * sp, vy: -(Math.sin(a) * sp + B * (o.up ?? 0.45)),
        G: B * 1.1, r: B * rnd(0.006, 0.011) * rnd(0.95, 1.25), c: near(pick(cols)) });
    }
  }
  /* a heap of cloud puffs that pops and is blown outward, melting away (the heart of a pop) */
  function puffs(x, y, n, o = {}) {
    const B = 100 * U() * (o.s || 1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
      add({ k: 'puff', x, y, t: -rnd(0, 0.04), life: 0.62, ang: a, r0: B * rnd(0.07, 0.16), r1: B * rnd(0.5, 0.66),
        size: B * rnd(0.1, 0.13), spin: rnd(0.25, 0.55) * (Math.random() < 0.5 ? -1 : 1), rot: rnd(-0.3, 0.3), v: i % NPUFF });
    }
  }
  /* the reference's fight cloud: separate puff clusters shot out of (x, y) like jets to a ring round it — mostly to the
     sides and below, the lower ones sinking — each leaving a smoke trail back to the middle; they melt away by 1 s.
     (A closed ring reads as a wreath, so a few on top are skipped.) The middle stays clear: the friend shows. */
  function puffRing(x, y, n, o = {}) {
    const B = 100 * U() * (o.s || 1);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rnd(-0.18, 0.18) + 0.2, sn = Math.sin(ang);     // (y up: sn > 0 = above)
      if (sn > 0.6 && i % 2) continue;
      add({ k: 'puff', ring: true, x, y, t: -rnd(0, 0.06), life: 1.0, ang, r0: B * rnd(0.02, 0.07), r1: B * rnd(0.28, 0.4),
        ey: rnd(0.7, 0.8), size: B * rnd(0.07, 0.095), drop: B * (sn < -0.25 ? rnd(0.04, 0.08) : rnd(-0.03, 0.02)),
        spin: rnd(0.25, 0.55) * (Math.random() < 0.5 ? -1 : 1), rot: rnd(-0.3, 0.3), v: i % NPUFF });
    }
  }
  /* where a ring puff is `a` s after it started, relative to its centre (y down), and how big (the reference's puffAt) */
  function ringAt(p, a, out) {
    if (a < 0) { out.S = 0; return out; }
    const grow = outBack(lin(0, 0.14, a)), go = outCubic(lin(0.03, 0.42, a)), drift = lin(0.42, 1.0, a);
    const r = (p.r0 + (p.r1 - p.r0) * go) * (1 + 0.16 * drift), an = p.ang + p.spin * a * 0.35;
    out.x = Math.cos(an) * r; out.y = -Math.sin(an) * r * p.ey + p.drop * drift;
    out.S = p.size * grow * (1 - smooth(0.6, 0.98, a));
    return out;
  }
  const RA = {}, RB = {};

  /* ── the API (names kept: game.js calls these) ─────────────────────────────────────────────────────── */
  /* the big burst of a right answer — the reference's crash: candy streaks shooting out all round, the puff clusters
     jetting out to a ring round the friend, candy dots flung up and out (~40 streaks, ~13 puffs, ~80 dots) */
  FX.confetti = function (x, y, n = 110, power = 1) {
    streaks(x, y, Math.round(n * 0.3), { s: 0.85 * power });
    puffRing(x, y, Math.round(n * 0.1), { s: 0.72 * power });
    dots(x, y, Math.round(n * 0.65), { s: power });
  };
  /* candy dots raining over the whole screen (fluttering as they fall), a few stars tumbling down among them */
  FX.rain = function (n = 140) {
    const u = U(), B = 100 * u;
    for (let i = 0; i < n; i++) {
      add({ k: 'rain', x: rnd(0, FX.w), y: rnd(-0.1, 0.02) * FX.h, t: -rnd(0, 1.8), life: rnd(2.2, 3.2), vy: rnd(0.22, 0.4) * FX.h,
        fl: rnd(8, 22) * u / 7.2, ph: rnd(0, 6.28), r: B * rnd(0.006, 0.011), c: pick(PALETTE) });
    }
    for (let i = 0, m = Math.round(n / 14); i < m; i++) {
      add({ k: 'star', x: rnd(0.05, 0.95) * FX.w, y: rnd(-0.08, -0.03) * FX.h, t: -rnd(0, 1.6), life: rnd(2.6, 3.4), vx: rnd(-0.03, 0.03) * B,
        vy: rnd(0.16, 0.26) * FX.h, g: 0.04 * B, r: B * rnd(0.026, 0.04), ci: pick(STAR_PICK), f0: rnd(0, NF),
        fs: rnd(2.5, 5) / (Math.PI * 2) * NF * (Math.random() < 0.5 ? -1 : 1), rot: rnd(-0.35, 0.35) });
    }
  };
  /* a firework = a candy pop (the reference's second pop, smaller): a puff heap bursts and melts, candy streaks shoot
     out of it, dots and a couple of stars fly — its colour leads the streaks */
  FX.firework = function (x, y, c) {
    const col = c || pick(PALETTE), cols = [col, '#ffd23f', col, '#ff4fa3', col, '#37d6ff', col, '#9b6bff'];
    streaks(x, y, 18, { s: 0.5, r0: 0.07, v: [1.9, 2.9], life: [0.5, 0.8], cols });
    puffs(x, y, 7, { s: 0.36 });
    dots(x, y, 20, { s: 0.55, up: 0.2, cols: [col, ...PALETTE] });
    stars3(x, y, 2, { s: 0.75 });
  };
  /* glints: little gold stars that twinkle on a soft warm glow (the claw's trail, the coin); 6 or more = a sparkle
     burst flung out (the reference's landing sparkle: mostly glowing glitter, a few little stars — all stars read as a
     heap of stars) */
  FX.sparkle = function (x, y, n = 3, spread = 2) {
    const u = U(), burst = n >= 6;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = burst ? rnd(10, 26) * u * spread / 4 : rnd(0, 4) * u, gd = burst && i % 5 > 1;
      add({ k: 'glint', x: x + rnd(-spread, spread) * u * (burst ? 0.25 : 1), y: y + rnd(-spread, spread) * u * (burst ? 0.25 : 1),
        t: 0, life: burst ? rnd(0.45, 0.75) : rnd(0.5, 0.9), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (burst ? 5 : 3) * u,
        r: rnd(0.8, 1.5) * u * (burst ? 1.1 : 1), f0: rnd(0, NF), rot: rnd(-0.4, 0.4), gd,
        c: gd ? (Math.random() < 0.5 ? '#fff1a8' : '#ffd23f') : Math.random() < 0.7 ? '#ffd23f' : '#ffb347' });
    }
  };
  /* chunky 3D stars bursting out (a right answer, the prize, the coin); scale < 1 = a smaller burst; ring = start on a
     ring that far out (a share of the screen height) */
  FX.stars = function (x, y, n = 14, scale = 1, ring = 0) { stars3(x, y, n, { s: scale, ring }); };

  /* ── per frame ─────────────────────────────────────────────────────────────────────────────────────── */
  const LAY = { streak: [], trail: [], puff: [], dot: [], star: [], glint: [] };
  function put(img, sx, sy, sw, sh, x, y, w, h, rot) {
    const D = FX.dpr, g = FX.g;
    if (rot) { const c = Math.cos(rot) * D, s = Math.sin(rot) * D; g.setTransform(c, s, -s, c, x * D, y * D); }
    else g.setTransform(D, 0, 0, D, x * D, y * D);
    g.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  }
  function drawStar(ci, f, x, y, d, rot) {
    if (SHEET) put(SHEET.star[ci], (f % FC) * SS, Math.floor(f / FC) * SS, SS, SS, x, y, d, d, rot);
    else put(star2d(STAR_COLS[ci]), 0, 0, SS, SS, x, y, d, d, rot + f / NF * 6.283);
  }
  FX.tick = function (dt) {
    const g = FX.g;
    if (!g) return;
    if (!FX.parts.length) {
      if (FX.dirty) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, FX.cv.width, FX.cv.height); FX.dirty = false; }
      return;
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, FX.cv.width, FX.cv.height);
    for (const k in LAY) LAY[k].length = 0;
    const keep = [], H = FX.h + 60;
    for (const p of FX.parts) {
      const a = (p.t += dt);
      if (a >= p.life) continue;
      keep.push(p);
      if (a < 0) continue;
      const u = a / p.life;
      if (p.k === 'streak') {
        const head = p.r0 + p.v * a * (1 - 0.45 * u);
        p.L = p.len * Math.min(1, a / 0.07) * (1 - 0.35 * u);
        p.W = p.w * (1 - smooth(0.6, 1, u));
        const mid = head - p.L / 2;
        p.X = p.x + p.ca * mid; p.Y = p.y + p.sa * mid;
        if (p.W > 0.4) LAY.streak.push(p);
      } else if (p.k === 'star') {
        // (they grow over 0.2 s, while already flying out: a whole burst at full size on one spot was a heap of stars)
        p.S = p.r * outBack(lin(0, 0.2, a)) * (1 - smooth(0.72, 1, u));
        p.X = p.x + p.vx * a; p.Y = p.y + p.vy * a + 0.5 * p.g * a * a;
        p.F = ((Math.floor(p.f0 + p.fs * a) % NF) + NF) % NF;
        if (p.Y > H) { keep.pop(); continue; }
        if (p.S > 0.3) LAY.star.push(p);
      } else if (p.k === 'dot') {
        const e = (1 - Math.exp(-1.6 * a)) / 1.6, gd = p.G / 1.6;
        p.X = p.x + p.vx * e; p.Y = p.y + (p.vy - gd) * e + gd * a;
        p.S = p.r * outBack(lin(0, 0.12, a)) * (1 - smooth(0.8, 1, u));
        if (p.Y > H) { keep.pop(); continue; }
        if (p.S > 0.2) LAY.dot.push(p);
      } else if (p.k === 'rain') {
        p.X = p.x + Math.sin(p.ph + a * 3.2) * p.fl; p.Y = p.y + p.vy * a;
        p.S = p.r * outBack(lin(0, 0.12, a)) * (1 - smooth(0.8, 1, u));
        if (p.Y > H) { keep.pop(); continue; }
        if (p.S > 0.2) LAY.dot.push(p);
      } else if (p.k === 'puff') {
        if (p.ring) {
          ringAt(p, a, RA);
          p.S = RA.S; p.X = p.x + RA.x; p.Y = p.y + RA.y;
          // its jet's smoke, pointing back to where it was shot from, thinning out (the reference's trail)
          const k = 1 - smooth(0.3, 0.85, a), r = Math.hypot(RA.x, RA.y);
          if (k > 0.02 && r > p.S * 0.8) {
            ringAt(p, Math.max(0, a - 0.22), RB);
            const lag = Math.hypot(RA.x - RB.x, RA.y - RB.y), ux = RA.x / r, uy = RA.y / r;
            const len = Math.min(p.S * 3.6, Math.max(p.S * 1.3, lag * 1.3)) * (0.5 + 0.5 * k);
            p.TL = len; p.TW = p.S * 1.3 * Math.sqrt(k); p.TA = Math.atan2(uy, ux);
            p.TX = p.X - ux * (len / 2 - p.S * 0.35); p.TY = p.Y - uy * (len / 2 - p.S * 0.35);
            if (p.TW > 0.5) LAY.trail.push(p);
          }
        } else {
          const grow = outBack(lin(0, 0.12, a)), go = outCubic(lin(0.15, 0.6, a));
          const r = p.r0 + (p.r1 - p.r0) * go, an = p.ang + p.spin * a * 0.35;
          p.S = p.size * grow * (1 - smooth(0.28, 0.62, a));
          p.X = p.x + Math.cos(an) * r; p.Y = p.y + Math.sin(an) * r * 0.8;
        }
        if (p.S > 0.5) LAY.puff.push(p);
      } else if (p.k === 'glint') {
        const e = (1 - Math.exp(-3 * a)) / 3;
        p.X = p.x + p.vx * e; p.Y = p.y + p.vy * e;
        p.S = Math.sin(Math.PI * u);
        LAY.glint.push(p);
      }
    }
    FX.parts = keep;
    // back to front: streaks and candy dots, the puff heaps they burst out of (in front, as in the reference: the heap
    // swallows the middle of a pop — dots on top of it read as sprinkles on a cupcake), stars, glints
    for (const p of LAY.streak) put(streakSprite(p.c), 0, 0, 320, 64, p.X, p.Y, p.L, p.W, p.ang);
    for (const p of LAY.dot) { const d = p.S * BALL_K; put(SHEET ? SHEET.ball[p.c] : ball2d(p.c), 0, 0, DS, DS, p.X, p.Y, d, d, 0); }
    for (const p of LAY.trail) put(trailSprite(), 0, 0, 256, 64, p.TX, p.TY, p.TL, p.TW, p.TA);
    for (const p of LAY.puff) {
      const d = p.S * PUFF_K;
      if (SHEET) put(SHEET.puff, p.v * PZ, 0, PZ, PZ, p.X, p.Y, d, d, p.rot); else put(puff2d(), 0, 0, PZ, PZ, p.X, p.Y, d, d, p.rot);
    }
    for (const p of LAY.star) drawStar(p.ci, p.F, p.X, p.Y, p.S * STAR_K, p.rot);
    if (LAY.glint.length) {
      g.globalCompositeOperation = 'lighter';
      for (const p of LAY.glint) { g.globalAlpha = (p.gd ? 0.8 : 0.55) * p.S; const d = p.r * (p.gd ? 4 : 5) * p.S; put(glowSprite(p.c), 0, 0, 64, 64, p.X, p.Y, d, d, 0); }
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      for (const p of LAY.glint) if (!p.gd) drawStar(0, Math.floor(p.f0 + p.t * 12) % NF, p.X, p.Y, p.r * 1.25 * STAR_K * p.S, p.rot);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    FX.dirty = true;
  };
  /* (QA) the baked sheets */
  FX.sheets = () => SHEET;
  window.FX = FX;
})();
