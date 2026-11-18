/* Toy Catch — the friends' eyes (user: "인형들 눈을 흰자가 있는 첨부한 이미지로 바꿀수 있어?" · "360도 좌우 상하 회전했을때도
 * 정말 자연스럽게"): eyes with whites like a 3D-animated fox's — a big dark-brown iris (near-black rim, darker under the
 * lid, warm brown low down), a black pupil, round catchlights, white round it (mostly at the outer side and below) and a
 * dark upper lash line — as glossy domes on the 3D friends, so they hold up from every side, above and below.
 *  - TABLE: the eyes painted in each friend's picture: [u, v, rx, ry, tilt] — centre (u across, v down), radii (rx of the
 *    width, ry of the height, like friends-art.js `head`), tilt in degrees (+ = the top leans right). Dark-blob fits in
 *    the head (tools/eyes.py detect), checked on grid overlays. side: the picture is a side view (turtle, fish) facing
 *    that way (-1 = left): the eye on the far side gets a dome too. ring: the painted eye already has a light ring
 *    round it (measured with it): grown less. tools/eyes.py reads this block (JSON between the markers).
 *  - draw(): one procedural eye (canvas, +x toward the nose), crisp at any size; one texture shared by all friends.
 *  - add(kind, geo, frame): the domes, placed by casting rays at the friend's ACTUAL mesh (whatever make_3d.py made):
 *    over each painted eye an ellipsoidal cap on the plane through the face at its rim, lifted just clear of the face
 *    inside, its outer band coming down onto the face itself and sunk a little (flush from every side, never floating),
 *    turned between the face's normal and the picture's view, big enough that the painted eye is hidden under it. Appended to the friend's own geometry (one mesh, one draw)
 *    with eyeUv = (u, v, 1); every other per-vertex attribute is copied from the face vertex under the eye's middle,
 *    so plushDeform, the poses, the claw's pinch and dent, the shadow (and skinning) move the eyes with the head.
 *  - sync(geo): copies those attributes again (after Poses.attach / anything that adds per-vertex data later).
 *  - shader(sh, mat): the eye branch of the friends' shader (friends.js plush3dShader, #ifdef CLAW_EYES): the drawing,
 *    a soft dome shade and two catchlights from lights fixed to the camera (upper-left front — the pictures' own light
 *    comes from there), so the highlights stay where a real glossy eye has them while the friend turns; a soft
 *    contact shadow on the face round each eye. The white stays white after friends.js's saturation step.
 *  - icons(imgs) / icon(kind): the 2D pictures with the same eyes painted in (tray, result card, prize flying in).
 */
(function () {
  'use strict';
  const T = window.THREE;

  const TABLE = /*@eyes*/{
    "monkey": {"eyes": [[0.3616, 0.3225, 0.0327, 0.0319, -1.6], [0.5899, 0.3205, 0.0333, 0.0327, 0.2]]},
    "mouse": {"eyes": [[0.3563, 0.3527, 0.0306, 0.0326, 7.8], [0.6064, 0.3523, 0.031, 0.0331, -4.7]]},
    "ant": {"eyes": [[0.295, 0.298, 0.045, 0.031, 5.0], [0.6578, 0.3083, 0.0482, 0.0315, -3.1]]},
    "seal": {"eyes": [[0.3466, 0.2158, 0.0362, 0.0357, 9.7], [0.6645, 0.2147, 0.0356, 0.035, -9.7]]},
    "turkey": {"eyes": [[0.3481, 0.3169, 0.0251, 0.0332, 1.2], [0.5964, 0.316, 0.0278, 0.0327, -1.7]]},
    "turtle": {"eyes": [[0.234, 0.418, 0.0746, 0.1016, 0.0]], "side": -1, "ring": 1},
    "cat": {"eyes": [[0.3434, 0.2831, 0.0376, 0.0343, 4.1], [0.6488, 0.2839, 0.0388, 0.0339, -1.0]]},
    "cow": {"eyes": [[0.3634, 0.2298, 0.0349, 0.0362, 7.6], [0.6225, 0.2286, 0.036, 0.0347, -12.0]]},
    "dog": {"eyes": [[0.372, 0.249, 0.035, 0.030, 0.0], [0.602, 0.247, 0.033, 0.029, 0.0]], "ring": 1},
    "fish": {"eyes": [[0.254, 0.501, 0.0762, 0.0967, 0.0]], "side": -1, "ring": 1},
    "duck": {"eyes": [[0.3511, 0.2939, 0.0378, 0.0354, 4.6], [0.6416, 0.2938, 0.039, 0.0353, -8.5]]}
  }/*@end*/;

  /* the new eye from the painted one: a little bigger (covers it and its soft edge), not taller than MAXASP × its width */
  const GROW = 1.2, GROW_RING = 1.07, MAXASP = 1.28;
  const FWD = 0.6;                  // the dome's axis: between the face's normal (0) and the picture's view direction (1)
  const GAZE = 0.85;                // its shading (where the catchlights sit): looking nearly the picture's way
  const DOME = 0.42;                // dome height / the eye's smaller radius
  const SINK = 0.1;                 // rim sunk into the face by this × the dome height
  const CLEAR = 0.1;                // the face stays this × the dome height under the cap
  const RB = 0.96;                  // the cap's edge: outside it a steep band comes down onto the face (so the eye's
                                    // outline is the dome's own clean ellipse, not where it meets the coarse mesh)
  const RINGS = [0, 0.16, 0.31, 0.45, 0.58, 0.7, 0.8, 0.88, 0.93, 0.96, 0.985, 1];
  const SEG = 40;
  /* the drawing (unit eye, +x toward the nose, y down): iris centre / radius, pupil radius */
  const IRIS = { x: 0.13, y: -0.06, r: 0.8 }, PUPIL = 0.5;
  /* the lights the catchlights come from, in view space (x right, y up, z toward the viewer): upper-left like the
     pictures' own; a small second one lower-right. Angular radii (rad) of the round highlights */
  const L1 = [-0.22, 0.3, 1], L2 = [0.3, -0.26, 1], R1 = 0.068, R2 = 0.03;

  /* ── the drawing ─────────────────────────────────────────────────────────────────────────────────────────────── */
  function draw(g, S, o = {}) {
    g.save();
    g.setTransform(S / 2, 0, 0, S / 2, S / 2, S / 2);
    const fill = (st) => { g.fillStyle = st; g.fillRect(-1.3, -1.3, 2.6, 2.6); };
    const rad = (x0, y0, r0, x1, y1, r1, stops) => { const gr = g.createRadialGradient(x0, y0, r0, x1, y1, r1); for (const [t, c] of stops) gr.addColorStop(t, c); return gr; };
    const lin = (x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [t, c] of stops) gr.addColorStop(t, c); return gr; };
    // the upper lid's lash line under everything: dark brown-black, a little lighter low (it shows as a band above)
    fill(lin(0, -1, 0, -0.6, [[0, '#24130d'], [1, '#2e1a12']]));
    // the opening below the lid: an ellipse a little lower and toward the nose (the band is thickest at the top and the
    // outer corner), its top flattened
    g.save();
    g.beginPath(); g.ellipse(0.045, 0.09, 0.99, 0.93, 0, 0, Math.PI * 2); g.clip();
    g.beginPath(); g.moveTo(-1.3, 1.3); g.lineTo(-1.3, -0.62);
    for (let x = -1.3; x <= 1.3001; x += 0.05) g.lineTo(x, -0.8 + 0.17 * (x - 0.05) * (x - 0.05));
    g.lineTo(1.3, 1.3); g.closePath(); g.clip();
    // the white: brightest a little below the middle, a cool soft grey toward the rim
    fill(rad(0.1, 0.2, 0.05, 0.05, 0.12, 1.12, [[0, '#ffffff'], [0.5, '#fbfafb'], [0.8, '#ebeaee'], [1, '#d2d0d8']]));
    // the iris
    const I = IRIS;
    g.save();
    g.beginPath(); g.arc(I.x, I.y, I.r, 0, Math.PI * 2); g.clip();
    fill(rad(I.x, I.y, 0, I.x, I.y, I.r, [[0, '#4e2814'], [0.42, '#6b3a1c'], [0.74, '#4f2711'], [0.9, '#2b130a'], [1, '#170905']]));
    // warm lighter brown low in the iris
    fill(rad(I.x + 0.04, I.y + I.r * 0.62, 0, I.x + 0.04, I.y + I.r * 0.62, I.r * 0.78,
      [[0, 'rgba(204,118,56,0.8)'], [0.55, 'rgba(170,90,40,0.38)'], [1, 'rgba(170,90,40,0)']]));
    // fibres: fine radial streaks (only seen big)
    g.lineWidth = 0.011;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2 + (i % 3) * 0.011, r0 = I.r * PUPIL * 1.04, r1 = I.r * (0.84 + 0.1 * (((i * 37) % 7) / 7));
      g.strokeStyle = i % 2 ? 'rgba(222,150,90,0.12)' : 'rgba(18,7,3,0.14)';
      g.beginPath(); g.moveTo(I.x + Math.cos(a) * r0, I.y + Math.sin(a) * r0); g.lineTo(I.x + Math.cos(a) * r1, I.y + Math.sin(a) * r1); g.stroke();
    }
    // darker under the lid, and the near-black rim
    fill(lin(0, I.y - I.r, 0, I.y + 0.12, [[0, 'rgba(12,5,3,0.9)'], [1, 'rgba(12,5,3,0)']]));
    fill(rad(I.x, I.y, I.r * 0.78, I.x, I.y, I.r, [[0, 'rgba(14,6,3,0)'], [0.75, 'rgba(14,6,3,0.55)'], [1, 'rgba(14,6,3,0.95)']]));
    g.restore();
    // the pupil (soft-edged)
    g.fillStyle = rad(I.x, I.y, 0, I.x, I.y, I.r * PUPIL, [[0, '#070302'], [0.86, '#0a0403'], [1, 'rgba(10,4,3,0)']]);
    g.beginPath(); g.arc(I.x, I.y, I.r * PUPIL, 0, Math.PI * 2); g.fill();
    // the lid's soft shadow over the white and the iris; a soft fold low on the white
    fill(lin(0, -0.84, 0, -0.28, [[0, 'rgba(48,28,34,0.55)'], [1, 'rgba(48,28,34,0)']]));
    fill(lin(0, 1.02, 0, 0.62, [[0, 'rgba(110,92,104,0.32)'], [1, 'rgba(110,92,104,0)']]));
    g.restore();
    if (o.catchlights) {                                  // (2D only: the 3D eyes get them from the shader's lights)
      const c = o.catchlights;
      for (const [x, y, r, al] of c) {
        g.fillStyle = rad(x, y, 0, x, y, r, [[0, `rgba(255,255,255,${al})`], [0.8, `rgba(255,255,255,${al})`], [1, 'rgba(255,255,255,0)']]);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  let eyeCanvas = null, eyeTex = null;
  function canvas() {
    if (!eyeCanvas) {
      eyeCanvas = document.createElement('canvas'); eyeCanvas.width = eyeCanvas.height = 512;
      draw(eyeCanvas.getContext('2d'), 512);
    }
    return eyeCanvas;
  }
  function texture() {
    if (!eyeTex) {
      eyeTex = new T.CanvasTexture(canvas());
      eyeTex.colorSpace = T.SRGBColorSpace; eyeTex.anisotropy = 8;
    }
    return eyeTex;
  }

  /* where a catchlight lands on a dome seen straight on (for the 2D pictures): the point whose normal is halfway
     between the light and the eye, on the ellipsoid z = DOME·sqrt(1 - X² - Y²) (in units of the eye's radii) */
  function catchAt(L, R) {
    const l = Math.hypot(L[0], L[1], L[2]), hx = L[0] / l, hy = L[1] / l, hz = L[2] / l + 1, hl = Math.hypot(hx, hy, hz);
    const tanA = Math.hypot(hx, hy) / hz, k = tanA / DOME, rho = k / Math.sqrt(1 + k * k), d = Math.hypot(hx, hy) || 1;
    // radius: the normal turns by ~DOME·(1-ρ²)^-1.5 rad per unit of ρ there
    const dn = DOME / Math.pow(1 - rho * rho, 1.5);
    return [rho * hx / d, -rho * hy / d, R / dn];         // (x right, y down, r) in units of the eye's radii
  }

  /* ── the 3D domes ────────────────────────────────────────────────────────────────────────────────────────────── */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

  /* rays against the mesh (Möller–Trumbore); tris = triangle numbers to try */
  function caster(geo) {
    const P = geo.attributes.position.array, I = geo.index.array, nt = I.length / 3;
    const v = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    function hits(o, d, tris) {
      const out = [];
      for (let k = 0; k < tris.length; k++) {
        const t = tris[k], a = v(I[t * 3]), b = v(I[t * 3 + 1]), c = v(I[t * 3 + 2]);
        const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, s = sub(o, a), uu = dot(s, p) * inv;
        if (uu < -1e-6 || uu > 1 + 1e-6) continue;
        const q = cross(s, e1), vv = dot(d, q) * inv;
        if (vv < -1e-6 || uu + vv > 1 + 1e-6) continue;
        const tt = dot(e2, q) * inv;
        if (tt > 0) out.push({ t: tt, tri: t, u: uu, v: vv });
      }
      return out;
    }
    const all = () => { const a = new Uint32Array(nt); for (let i = 0; i < nt; i++) a[i] = i; return a; };
    /* triangles whose x/y box holds (x, y) (for rays along z) */
    function alongZ(x, y) {
      const out = [];
      for (let t = 0; t < nt; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        if (Math.min(P[a], P[b], P[c]) > x || Math.max(P[a], P[b], P[c]) < x) continue;
        if (Math.min(P[a + 1], P[b + 1], P[c + 1]) > y || Math.max(P[a + 1], P[b + 1], P[c + 1]) < y) continue;
        out.push(t);
      }
      return out;
    }
    /* triangles near a point (centroid within r) */
    function near(p, r) {
      const out = [], r2 = r * r;
      for (let t = 0; t < nt; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const x = (P[a] + P[b] + P[c]) / 3 - p[0], y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - p[1], z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - p[2];
        if (x * x + y * y + z * z < r2) out.push(t);
      }
      return out;
    }
    return { hits, alongZ, near, all, v, I, P };
  }

  /* the first surface a ray along z meets, from the camera side (dz = -1) or from behind (dz = 1) */
  function castZ(C, x, y, dz, z0) {
    const hs = C.hits([x, y, z0], [0, 0, dz], C.alongZ(x, y));
    if (!hs.length) return null;
    hs.sort((a, b) => a.t - b.t);
    const h = hs[0];
    return { p: [x, y, z0 + dz * h.t], tri: h.tri, u: h.u, v: h.v };
  }

  /* one eye: where it sits, its frame and size, the face under it */
  function place(C, geo, e, tab, fr, far, sizeFrom) {
    const { w, h, u } = fr, P = C.P;
    const x = (e[0] - u) * w, y = (1 - e[1]) * h, dz = far ? 1 : -1;
    const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
    const z0 = far ? bb.min.z - 1 : bb.max.z + 1;
    const hit = castZ(C, x, y, dz, z0);
    if (!hit) return null;
    const O = hit.p, I = C.I, nr = geo.attributes.normal.array;
    const ia = I[hit.tri * 3], ib = I[hit.tri * 3 + 1], ic = I[hit.tri * 3 + 2], wa = 1 - hit.u - hit.v;
    // the face's normal there: the vertex normals round the eye's middle (the mesh may have a bump where the painted
    // eye is: its own normal there would be noise)
    let a0 = (tab.ring ? GROW_RING : GROW) * e[2] * w, b0 = (tab.ring ? GROW_RING : GROW) * e[3] * h;
    const r0 = Math.max(a0, b0) * 1.2;
    let N = [0, 0, 0];
    for (let i = 0; i < geo.userData.eyes0; i++) {
      const d = Math.hypot(P[i * 3] - O[0], P[i * 3 + 1] - O[1], P[i * 3 + 2] - O[2]);
      if (d < r0) { const k = 1 - d / r0; N = madd(N, [nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]], k); }
    }
    if (Math.hypot(N[0], N[1], N[2]) < 1e-6) N = [0, 1, 2].map(k => nr[ia * 3 + k] * wa + nr[ib * 3 + k] * hit.u + nr[ic * 3 + k] * hit.v);
    N = nrm(N);
    const F = [0, 0, far ? -1 : 1];
    if (dot(N, F) < 0.05) N = nrm(madd(N, F, 0.3));        // (a back-facing normal there: lean it out)
    const mix3 = (k) => nrm([N[0] * (1 - k) + F[0] * k, N[1] * (1 - k) + F[1] * k, N[2] * (1 - k) + F[2] * k]);
    const A = mix3(FWD), G = mix3(GAZE);
    const tr = (e[4] || 0) * Math.PI / 180;
    const frame = (ax) => {
      let up = [Math.sin(tr), Math.cos(tr), 0];
      up = nrm(madd(up, ax, -dot(up, ax)));
      let t1 = nrm(cross(up, ax));
      if (dot(t1, nose) < 0) t1 = [-t1[0], -t1[1], -t1[2]];
      return [t1, up];
    };
    const nose = tab.side ? [tab.side, 0, 0] : [x < 0 ? 1 : -1, 0, 0];
    const [t1, up] = frame(A), [g1, gup] = frame(G);
    // the anchor: the hit triangle's vertex nearest the eye's middle (its first copy along atlas seams)
    let anchor = ia, bd = 1e9;
    for (const i of [ia, ib, ic]) { const d = Math.hypot(P[i * 3] - O[0], P[i * 3 + 1] - O[1], P[i * 3 + 2] - O[2]); if (d < bd) { bd = d; anchor = i; } }
    if (geo.userData.one) anchor = geo.userData.one[anchor];
    // size: the painted eye grown a little, not too tall (or wide) …
    let a, b;
    if (sizeFrom) { a = sizeFrom.a; b = sizeFrom.b; }
    else {
      a = a0; b = b0;
      if (b > a * MAXASP) a = b / MAXASP;
      if (a > b * MAXASP) b = a / MAXASP;
    }
    // … and big enough that the painted eye (on the face, seen along z) is all under it, with a margin
    const ex = [Math.cos(tr), -Math.sin(tr)], ey = [Math.sin(tr), Math.cos(tr)];
    let s = 0;
    for (let k = 0; k < 28; k++) {
      const th = (k / 28) * Math.PI * 2, px = Math.cos(th) * e[2] * w * 1.05, py = Math.sin(th) * e[3] * h * 1.05;
      const hp = castZ(C, x + ex[0] * px + ey[0] * py, y + ex[1] * px + ey[1] * py, dz, z0);
      if (!hp) continue;
      const d = sub(hp.p, O);
      s = Math.max(s, Math.hypot(dot(d, t1) / a, dot(d, up) / b));
    }
    if (s * 1.06 > 1) { a *= s * 1.06; b *= s * 1.06; }
    // the face under it: its height along the eye's axis at (X, Y) (in units of the radii), rays against the triangles
    // near the eye, binned on a grid in the eye's plane
    const R = Math.max(a, b), NG = 24, G0 = -1.6, GS = 3.2 / NG, cells = Array.from({ length: NG * NG }, () => []);
    const I3 = C.I;
    for (const t of C.near(O, R * 2.8)) {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let k = 0; k < 3; k++) {
        const vi = I3[t * 3 + k], d = [P[vi * 3] - O[0], P[vi * 3 + 1] - O[1], P[vi * 3 + 2] - O[2]];
        const X = dot(d, t1) / a, Y = dot(d, up) / b;
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
      const c0 = Math.max(0, Math.floor((x0 - G0) / GS)), c1 = Math.min(NG - 1, Math.floor((x1 - G0) / GS));
      const d0 = Math.max(0, Math.floor((y0 - G0) / GS)), d1 = Math.min(NG - 1, Math.floor((y1 - G0) / GS));
      for (let cy = d0; cy <= d1; cy++) for (let cx = c0; cx <= c1; cx++) cells[cy * NG + cx].push(t);
    }
    const down = [-A[0], -A[1], -A[2]];
    const surf = (X, Y) => {
      const cx = Math.floor((X - G0) / GS), cy = Math.floor((Y - G0) / GS);
      if (cx < 0 || cy < 0 || cx >= NG || cy >= NG) return null;
      const o = madd(madd(madd(O, t1, X * a), up, Y * b), A, R * 2);
      let best = null;
      for (const q of C.hits(o, down, cells[cy * NG + cx])) { const hh = R * 2 - q.t; if (hh > -1.2 * R && hh < 1.2 * R && (best == null || hh > best)) best = hh; }
      return best;
    };
    // the dome: a cap on the plane through the face at its rim, lifted just enough to clear the face inside (the mesh
    // often has a bump where the painted eye is), its outer band coming down onto the face itself (flush all round)
    const rim = [];
    for (let k = 0; k < 32; k++) { const th = (k / 32) * Math.PI * 2, X = Math.cos(th), Y = Math.sin(th), hh = surf(X, Y); if (hh != null) rim.push([X, Y, hh]); }
    let B = [0, 0, 0];
    if (rim.length >= 8) {
      const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      for (const [X, Y, hh] of rim) { const r = [1, X, Y]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; M[i][3] += r[i] * hh; } }
      for (let i = 0; i < 3; i++) {
        let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
        [M[i], M[p]] = [M[p], M[i]];
        const d = M[i][i] || 1e-12; for (let j = i; j < 4; j++) M[i][j] /= d;
        for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i]; for (let j = i; j < 4; j++) M[r][j] -= f * M[i][j]; }
      }
      B = [M[0][3], M[1][3], M[2][3]];
    }
    const c = DOME * Math.min(a, b), plane = (X, Y) => B[0] + B[1] * X + B[2] * Y;
    let lift = -1e9;
    for (const rho of [0, 0.2, 0.4, 0.55, 0.7, 0.8, 0.88, RB]) {
      const n = rho ? 24 : 1;
      for (let k = 0; k < n; k++) {
        const th = (k / n) * Math.PI * 2, X = rho * Math.cos(th), Y = rho * Math.sin(th), hh = surf(X, Y);
        if (hh != null) lift = Math.max(lift, hh - (plane(X, Y) + c * Math.sqrt(1 - rho * rho)) + CLEAR * c);
      }
    }
    lift = Math.max(0, lift);
    return { O, A, G, t1, up, g1, gup, a, b, c, plane, lift, surf, anchor, far };
  }

  /* the dome's vertices (positions, normals, eye uvs) and triangles; the normals are a smooth ellipsoid's round the
     eye's gaze (whatever bumps the face under it has), so the catchlights are round and sit where a real eye has them */
  function dome(E) {
    const { O, A, G, t1, up, g1, gup, a, b, c, plane, lift, surf } = E, nv = 1 + (RINGS.length - 1) * SEG;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), euv = new Float32Array(nv * 3);
    let k = 0, poke = 0;
    const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const put = (X, Y) => {
      const r2 = Math.min(1, X * X + Y * Y), rho = Math.sqrt(r2), sq = Math.sqrt(1 - r2), sqc = Math.sqrt(Math.max(1 - r2, 0.02));
      const cap = plane(X, Y) + lift + c * sq, sf = surf(X, Y), s0 = sf == null ? plane(X, Y) : sf;
      let hh;
      if (rho > 0.999) hh = s0 - SINK * c;
      else {
        const wgt = sm(RB, 1, rho);
        hh = cap + (s0 - SINK * c - cap) * wgt;
        const floor = s0 + CLEAR * c * (1 - wgt);
        if (hh < floor) { poke = Math.max(poke, floor - hh); hh = floor; }
      }
      const p = madd(madd(madd(O, t1, X * a), up, Y * b), A, hh);
      const kx = c * X / (a * sqc), ky = c * Y / (b * sqc);
      const n = nrm([G[0] + kx * g1[0] + ky * gup[0], G[1] + kx * g1[1] + ky * gup[1], G[2] + kx * g1[2] + ky * gup[2]]);
      pos.set(p, k * 3); nor.set(n, k * 3); euv.set([0.5 + 0.5 * X, 0.5 + 0.5 * Y, 1], k * 3); k++;
    };
    put(0, 0);
    for (let j = 1; j < RINGS.length; j++) for (let s = 0; s < SEG; s++) { const th = (s / SEG) * Math.PI * 2; put(RINGS[j] * Math.cos(th), RINGS[j] * Math.sin(th)); }
    const flip = dot(cross(t1, up), A) < 0, idx = [];
    const tri = (i, j, l) => { if (flip) idx.push(i, l, j); else idx.push(i, j, l); };
    const at = (j, s) => (j === 0 ? 0 : 1 + (j - 1) * SEG + (s % SEG));
    for (let s = 0; s < SEG; s++) tri(0, at(1, s), at(1, s + 1));
    for (let j = 1; j < RINGS.length - 1; j++) for (let s = 0; s < SEG; s++) {
      tri(at(j, s), at(j + 1, s), at(j + 1, s + 1)); tri(at(j, s), at(j + 1, s + 1), at(j, s + 1));
    }
    E.poke = poke;
    return { pos, nor, euv, idx, nv };
  }

  function add(kind, geo, fr) {
    const tab = TABLE[kind];
    if (!tab || geo.userData.eyes || !geo.index || !geo.attributes.normal) return;
    const t0 = performance.now(), C = caster(geo), list = [];
    geo.userData.eyes0 = geo.attributes.position.count;
    for (const e of tab.eyes) {
      const E = place(C, geo, e, tab, fr, false);
      if (!E) { console.warn('eyes: no face under', kind, e); continue; }
      list.push(E);
      if (tab.side) { const F = place(C, geo, e, tab, fr, true, E); if (F) list.push(F); }
    }
    if (!list.length) return;
    const parts = list.map(dome), n0 = geo.attributes.position.count, ne = parts.reduce((s, p) => s + p.nv, 0), n = n0 + ne;
    const anchor = new Uint32Array(ne);
    let o = 0;
    parts.forEach((p, i) => { anchor.fill(list[i].anchor, o, o + p.nv); o += p.nv; });
    // every attribute grows by the eye vertices: position / normal / eyeUv from the domes, the rest from the anchors
    for (const name of Object.keys(geo.attributes)) {
      const at = geo.attributes[name], is = at.itemSize, arr = new at.array.constructor(n * is);
      arr.set(at.array.subarray(0, n0 * is));
      let off = n0;
      parts.forEach((p) => {
        if (name === 'position') arr.set(p.pos, off * 3);
        else if (name === 'normal') arr.set(p.nor, off * 3);
        off += p.nv;
      });
      if (name !== 'position' && name !== 'normal') for (let i = 0; i < ne; i++) for (let c = 0; c < is; c++) arr[(n0 + i) * is + c] = at.array[anchor[i] * is + c];
      geo.setAttribute(name, new T.BufferAttribute(arr, is, at.normalized));
    }
    const ev = new Float32Array(n * 3);
    let off = n0;
    parts.forEach((p) => { ev.set(p.euv, off * 3); off += p.nv; });
    geo.setAttribute('eyeUv', new T.BufferAttribute(ev, 3));
    const old = geo.index.array, ni = old.length + parts.reduce((s, p) => s + p.idx.length, 0);
    const idx = n < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
    idx.set(old);
    let io = old.length; off = n0;
    parts.forEach((p) => { for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + off; io += p.idx.length; off += p.nv; });
    geo.setIndex(new T.BufferAttribute(idx, 1));
    if (geo.userData.one) {                                // (seam copies: the eye vertices are their own)
      const one = new Uint32Array(n); one.set(geo.userData.one.subarray(0, n0));
      for (let i = n0; i < n; i++) one[i] = i;
      geo.userData.one = one;
    }
    geo.userData.eyes = { n0, ne, t0: old.length / 3, anchor, list: list.map(E => ({ O: E.O, A: E.A, G: E.G, t1: E.t1, up: E.up, a: E.a, b: E.b, c: E.c, lift: E.lift, far: E.far, poke: E.poke })), ms: performance.now() - t0 };
    geo.computeBoundingBox(); geo.computeBoundingSphere();
  }

  /* copy the anchors' per-vertex data to the eye vertices again — for attributes added after add() (Poses' pw, …): at
     full length they are overwritten, at the face's length they are extended */
  function sync(geo) {
    const E = geo.userData.eyes;
    if (!E) return;
    const { n0, ne, anchor } = E, n = n0 + ne;
    for (const name of Object.keys(geo.attributes)) {
      if (name === 'position' || name === 'normal' || name === 'eyeUv') continue;
      const at = geo.attributes[name], is = at.itemSize;
      let arr = at.array;
      if (at.count === n0) { arr = new at.array.constructor(n * is); arr.set(at.array); }
      else if (at.count !== n) continue;
      for (let i = 0; i < ne; i++) for (let c = 0; c < is; c++) arr[(n0 + i) * is + c] = arr[anchor[i] * is + c];
      if (arr !== at.array) geo.setAttribute(name, new T.BufferAttribute(arr, is, at.normalized));
      else at.needsUpdate = true;
    }
  }

  /* the uniforms of one friend's eyes (its material's): the drawing; each eye's frame for the contact shadow (rows map a
     rest-pose position to the eye's (across / a, up / b, out / R)) */
  function uniforms(geo) {
    const E = geo.userData.eyes;
    if (!E) return null;
    const X = [], Y = [], Z = [];
    for (let i = 0; i < 2; i++) {
      const e = E.list[i];
      if (!e) { X.push(new T.Vector4(0, 0, 0, 99)); Y.push(new T.Vector4(0, 0, 0, 99)); Z.push(new T.Vector4(0, 0, 0, 99)); continue; }
      const R = Math.max(e.a, e.b), row = (v, s) => new T.Vector4(v[0] / s, v[1] / s, v[2] / s, -dot(v, e.O) / s);
      X.push(row(e.t1, e.a)); Y.push(row(e.up, e.b)); Z.push(row(e.A, R));
    }
    // (side-on friends have a near and a far eye: both shadowed; nobody has more than 2)
    return { uEyeTex: { value: texture() }, uEyeX: { value: X }, uEyeY: { value: Y }, uEyeZ: { value: Z } };
  }

  const g3 = (v) => `vec3(${v.map(x => (+x).toFixed(4)).join(', ')})`;
  const VS_PARS = `
#ifdef CLAW_EYES
attribute vec3 eyeUv;
varying vec3 vEyeUv, vEyeRest, vEyeV;
#endif
void main() {
#ifdef CLAW_EYES
  vEyeUv = eyeUv; vEyeRest = position;
#endif`;
  const FS_PARS = `
#ifdef CLAW_EYES
uniform sampler2D uEyeTex;
uniform vec4 uEyeX[2], uEyeY[2], uEyeZ[2];
varying vec3 vEyeUv, vEyeRest, vEyeV;
#endif
void main() {`;
  const FS_EYE = `
#ifdef CLAW_EYES
  if (vEyeUv.z > 0.5) {
    // the eye: its drawing on a glossy dome — a little darker where the dome turns away, a soft sheen and two round
    // catchlights from lights fixed to the camera
    vec3 n = normalize(vPuffN), v = normalize(vEyeV);
    vec3 e = texture2D(uEyeTex, vEyeUv.xy).rgb;
    float nv = clamp(dot(n, v), 0.0, 1.0);
    e *= mix(0.74, 1.0, smoothstep(0.04, 0.7, nv)) * (1.0 + 0.06 * uLit);
    vec3 h1 = normalize(normalize(${g3(L1)}) + v), h2 = normalize(normalize(${g3(L2)}) + v);
    float d1 = dot(n, h1), d2 = dot(n, h2);
    e += vec3(0.05) * pow(max(d1, 0.0), 60.0);
    float s1 = smoothstep(${Math.cos(R1 * 1.22).toFixed(6)}, ${Math.cos(R1).toFixed(6)}, d1);
    float s2 = smoothstep(${Math.cos(R2 * 1.35).toFixed(6)}, ${Math.cos(R2).toFixed(6)}, d2) * 0.8;
    outgoingLight = mix(e, vec3(1.0), max(s1, s2));
  } else {
    // the face round an eye: a soft contact shadow just outside its rim
    float ao = 0.0;
    for (int i = 0; i < 2; i++) {
      vec3 q = vec3(dot(uEyeX[i].xyz, vEyeRest) + uEyeX[i].w, dot(uEyeY[i].xyz, vEyeRest) + uEyeY[i].w, dot(uEyeZ[i].xyz, vEyeRest) + uEyeZ[i].w);
      ao = max(ao, smoothstep(1.3, 0.97, length(q.xy)) * (1.0 - smoothstep(0.35, 0.8, abs(q.z))));
    }
    outgoingLight *= 1.0 - 0.2 * ao;
  }
#endif
#include <opaque_fragment>`;

  /* called by friends.js plush3dShader (this = the friend's material) */
  function shader(sh, mat) {
    const U = mat && mat.userData.uEye;
    if (!U) return;
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('void main() {', VS_PARS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef CLAW_EYES\n  vEyeV = isOrthographic ? vec3(0.0, 0.0, 1.0) : -mvPosition.xyz;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', FS_PARS).replace('#include <opaque_fragment>', FS_EYE);
  }

  /* friends.js build(): the eye define + uniforms on a 3D friend's material */
  function setup(mat, geo) {
    const U = uniforms(geo);
    if (!U) return false;
    mat.defines = Object.assign(mat.defines || {}, { CLAW_EYES: '' });
    mat.userData.uEye = U;
    return true;
  }

  /* ── the 2D pictures with the new eyes ────────────────────────────────────────────────────────────────────────── */
  const iconURL = {};
  function paint(g, kind, W, H) {
    const tab = TABLE[kind];
    if (!tab) return;
    const c1 = catchAt(L1, R1), c2 = catchAt(L2, R2);
    for (const e of tab.eyes) {
      const gr = tab.ring ? GROW_RING : GROW;
      let a = gr * e[2] * W, b = gr * e[3] * H;
      if (b > a * MAXASP) a = b / MAXASP;
      if (a > b * MAXASP) b = a / MAXASP;
      const cx = e[0] * W, cy = e[1] * H, tr = (e[4] || 0) * Math.PI / 180;
      const sx = tab.side ? -tab.side : (e[0] < 0.5 ? 1 : -1);   // the drawing's +x toward the nose
      g.save();
      g.translate(cx, cy); g.rotate(tr);
      // a soft contact shadow round it
      g.save(); g.scale(a, b);
      const sh = g.createRadialGradient(0, 0, 0.9, 0, 0, 1.3);
      sh.addColorStop(0, 'rgba(40,20,20,0.26)'); sh.addColorStop(1, 'rgba(40,20,20,0)');
      g.fillStyle = sh; g.beginPath(); g.arc(0, 0, 1.3, 0, Math.PI * 2); g.fill();
      g.restore();
      g.beginPath(); g.ellipse(0, 0, a, b, 0, 0, Math.PI * 2); g.clip();
      g.save(); g.scale(sx * a / 256, b / 256); g.drawImage(canvas(), -256, -256); g.restore();
      // the dome's shade toward its rim
      g.save(); g.scale(a, b);
      const rg = g.createRadialGradient(-0.1, -0.15, 0.55, 0, 0, 1.02);
      rg.addColorStop(0, 'rgba(30,20,30,0)'); rg.addColorStop(1, 'rgba(30,20,30,0.22)');
      g.fillStyle = rg; g.fillRect(-1.1, -1.1, 2.2, 2.2);
      g.restore();
      g.restore();
      // catchlights in the picture's own frame (one light for both eyes)
      g.save();
      g.translate(cx, cy);
      for (const [c, al] of [[c1, 1], [c2, 0.8]]) {
        const x = c[0] * a, y = c[1] * b, r = c[2] * Math.min(a, b);
        const rg = g.createRadialGradient(x, y, 0, x, y, r * 1.12);
        rg.addColorStop(0, `rgba(255,255,255,${al})`); rg.addColorStop(0.82, `rgba(255,255,255,${al})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r * 1.12, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
  }
  function icons(imgs) {
    const jobs = Object.keys(imgs).filter(k => TABLE[k] && imgs[k]).map(k => new Promise((res) => {
      const im = imgs[k], c = document.createElement('canvas');
      c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      paint(g, k, c.width, c.height);
      const done = (url) => { if (url) iconURL[k] = url; res(); };
      try {
        if (c.toBlob) c.toBlob((bl) => done(bl ? URL.createObjectURL(bl) : c.toDataURL('image/png')), 'image/png');
        else done(c.toDataURL('image/png'));
      } catch (err) { console.warn('eyes: icon', k, err); res(); }
    }));
    return Promise.all(jobs);
  }

  /* QA: the face's height along an eye's axis on an n×n grid over [-span, span]² (in units of the eye's radii) */
  function relief(geo, i, n = 13, span = 1.5, face = false) {
    const E = geo.userData.eyes.list[i], C = caster(geo), R = Math.max(E.a, E.b), near = C.near(E.O, R * 3), out = [];
    for (let r = 0; r < n; r++) {
      const row = [], Y = span - (2 * span * r) / (n - 1);
      for (let k = 0; k < n; k++) {
        const X = -span + (2 * span * k) / (n - 1), o = madd(madd(madd(E.O, E.t1, X * E.a), E.up, Y * E.b), E.A, R * 2);
        const hs = C.hits(o, [-E.A[0], -E.A[1], -E.A[2]], near).filter(q => face || q.tri < geo.userData.eyes.t0);
        row.push(hs.length ? +((R * 2 - Math.min(...hs.map(q => q.t))) / E.c).toFixed(2) : null);
      }
      out.push(row);
    }
    return out;
  }

  window.Eyes = { relief, TABLE, draw, canvas, texture, add, sync, setup, shader, icons, icon: (k) => iconURL[k] || null, paint,
    catchAt, consts: { GROW, GROW_RING, MAXASP, FWD, GAZE, DOME, SINK, CLEAR, RB, IRIS, PUPIL, L1, L2, R1, R2 } };
})();
