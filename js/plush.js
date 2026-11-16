/* Toy Catch — the plush animals (FPR K Unit 1 words that start with m, a, s, t, p).
 * Each plush is built from soft ellipsoids/capsules in a velvety fabric (Mats.fabric), glossy bead eyes, an
 * embroidered mouth decal and its letter stitched on its shirt / belly patch, like the mockup's plushies.
 * Origin: the bottom (sits on y 0), facing +z. Height ≈ 1.3 units.
 * Rig: root (placed in the machine, the claw carries it) > body (breathes, hops) > head / arms / legs / tail.
 */
(function () {
  'use strict';
  const T = THREE, M = Mats, D = Math.PI / 180;
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const SPH = new T.SphereGeometry(1, 40, 28);
  const caps = {};
  const cap = (r, len) => caps[r + '_' + len] || (caps[r + '_' + len] = new T.CapsuleGeometry(r, len, 8, 18));
  const cones = {};
  const cone = (r, h) => cones[r + '_' + h] || (cones[r + '_' + h] = new T.ConeGeometry(r, h, 24, 1));

  function mesh(geo, mat, parent, o = {}) {
    const m = new T.Mesh(geo, mat);
    m.castShadow = o.cast !== false; m.receiveShadow = o.recv !== false;
    if (o.pos) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
    if (o.scale != null) { if (typeof o.scale === 'number') m.scale.setScalar(o.scale); else m.scale.set(o.scale[0], o.scale[1], o.scale[2]); }
    if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
    if (parent) parent.add(m);
    return m;
  }
  const ball = (mat, parent, pos, s, o = {}) => mesh(SPH, mat, parent, Object.assign({ pos, scale: s }, o));
  const grp = (parent, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); if (parent) parent.add(g); return g; };

  /* an ellipsoid {c, r}; points on it by yaw (+ = toward +x) / pitch (+ = up), degrees */
  const E = (cx, cy, cz, rx, ry, rz) => ({ c: V(cx, cy, cz), r: V(rx, ry, rz) });
  function surf(e, yaw, pitch) {
    const a = yaw * D, b = pitch * D;
    const d = V(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b));
    return { p: V(e.c.x + d.x * e.r.x, e.c.y + d.y * e.r.y, e.c.z + d.z * e.r.z), n: V(d.x / e.r.x, d.y / e.r.y, d.z / e.r.z).normalize() };
  }
  /* a group sitting on the surface, its +z along the outward normal */
  function onSurf(parent, e, yaw, pitch, sink = 0) {
    const { p, n } = surf(e, yaw, pitch), g = grp(parent);
    g.position.copy(p).addScaledVector(n, -sink);
    g.quaternion.setFromUnitVectors(V(0, 0, 1), n);
    return g;
  }
  /* a decal patch hugging the ellipsoid: centre (yaw, pitch), physical size w × h */
  function patch(parent, e, yaw, pitch, w, h, mat, lift = 1.012) {
    const b = pitch * D, a = yaw * D;
    const dw = w / (e.r.x * Math.max(0.3, Math.cos(b))), dh = h / e.r.y;
    const g = new T.SphereGeometry(1, 32, 24, Math.PI / 2 + a - dw / 2, dw, Math.PI / 2 - b - dh / 2, dh);
    const m = mesh(g, mat, parent, { cast: false });
    m.position.copy(e.c); m.scale.copy(e.r).multiplyScalar(lift);
    m.renderOrder = 2;
    return m;
  }
  /* glossy safety-bead eyes with catch-lights; `rim`: a white felt ring behind (turkey) */
  function eyes(parent, e, yaw, pitch, r, o = {}) {
    const out = [];
    for (const s of [-1, 1]) {
      const g = onSurf(parent, e, s * yaw, pitch, r * 0.3);
      if (o.rim) ball(M.felt(o.rim), g, [0, 0, -r * 0.25], [r * 1.55, r * 1.55, r * 0.5]);
      ball(M.bead(), g, [0, 0, 0], [r, r * 1.08, r * 0.78]);
      ball(M.white(), g, [-r * 0.32, r * 0.4, r * 0.6], r * 0.27, { cast: false });
      ball(M.white(), g, [r * 0.33, -r * 0.3, r * 0.64], r * 0.11, { cast: false });
      out.push(g);
    }
    return out;
  }

  /* embroidered mouths drawn on a transparent canvas (thread colour), put on as decals */
  const mouthCache = {};
  function mouthTex(kind, ink = '#4b2a20') {
    const key = kind + ink;
    if (mouthCache[key]) return mouthCache[key];
    return (mouthCache[key] = M.tex(256, 256, (g, w, h) => {
      g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = ink; g.lineWidth = 15;
      if (kind === 'smile') {
        g.beginPath(); g.moveTo(w * 0.24, h * 0.36); g.quadraticCurveTo(w * 0.5, h * 0.78, w * 0.76, h * 0.36); g.stroke();
      } else if (kind === 'open') {
        g.beginPath(); g.moveTo(w * 0.22, h * 0.3); g.quadraticCurveTo(w * 0.5, h * 0.32, w * 0.78, h * 0.3);
        g.quadraticCurveTo(w * 0.72, h * 0.86, w * 0.5, h * 0.86); g.quadraticCurveTo(w * 0.28, h * 0.86, w * 0.22, h * 0.3); g.closePath();
        g.fillStyle = '#6b2a2e'; g.fill();
        g.save(); g.clip(); g.fillStyle = '#ff7f96'; g.beginPath(); g.ellipse(w * 0.5, h * 0.84, w * 0.2, h * 0.17, 0, 0, Math.PI * 2); g.fill(); g.restore();
        g.lineWidth = 10; g.stroke();
      } else if (kind === 'w' || kind === 'teeth') {
        g.beginPath(); g.moveTo(w * 0.5, h * 0.12); g.lineTo(w * 0.5, h * 0.42); g.stroke();
        g.beginPath(); g.moveTo(w * 0.22, h * 0.36); g.quadraticCurveTo(w * 0.34, h * 0.62, w * 0.5, h * 0.42);
        g.quadraticCurveTo(w * 0.66, h * 0.62, w * 0.78, h * 0.36); g.stroke();
        if (kind === 'teeth') {
          g.fillStyle = '#ffffff'; g.strokeStyle = '#c9b8b0'; g.lineWidth = 5;
          for (const x of [0.42, 0.5]) { g.beginPath(); g.roundRect(w * x, h * 0.47, w * 0.08, h * 0.15, 6); g.fill(); g.stroke(); }
        }
      }
    }));
  }
  const mouth = (parent, e, pitch, w, kind, ink) => patch(parent, e, 0, pitch, w, w, M.decal(mouthTex(kind, ink)), 1.01);
  const blush = (parent, e, yaw, pitch, s) => { for (const k of [-1, 1]) patch(parent, e, k * yaw, pitch, s, s * 0.75, M.decal(M.blushTex()), 1.008); };

  /* ── the common rig ─────────────────────────────────────────────────────────────────────────────── */
  function rig(kind, info) {
    const root = new T.Group(), body = grp(root), head = grp(body);
    root.name = 'plush-' + kind;
    return Object.assign({ kind, root, body, head, arms: [], legs: [], ears: [], tail: null, extras: [] }, info);
  }
  /* sitting torso + legs + arms (+ sleeves and the shirt with the letter) */
  function torso(P, o) {
    const fur = M.fabric(o.fur), B = o.body || [0.3, 0.33, 0.27], by = o.by ?? 0.36;
    const be = E(0, by, 0, B[0], B[1], B[2]);
    ball(fur, P.body, [0, by, 0], B);
    if (o.belly) ball(M.fabric(o.belly), P.body, [0, by - 0.03, B[2] * 0.42], [B[0] * 0.72, B[1] * 0.78, B[2] * 0.62]);
    // legs: sitting, pointing forward
    const legR = o.legR ?? 0.1;
    for (const s of [-1, 1]) {
      const leg = grp(P.body, s * B[0] * 0.55, 0.13, 0.04);
      mesh(cap(legR, 0.14), fur, leg, { pos: [s * 0.015, 0, 0.1], rot: [Math.PI / 2 - 0.12, 0, 0] });
      ball(M.fabric(o.paw || o.fur), leg, [s * 0.02, -0.01, 0.25], [legR * 1.05, legR * 0.9, legR * 1.12]);
      if (o.pad) ball(M.felt(o.pad), leg, [s * 0.02, 0, 0.32], [legR * 0.62, legR * 0.62, 0.02], { cast: false });
      leg.userData.s = s; P.legs.push(leg);
    }
    // arms: hang from the shoulders
    const armR = o.armR ?? 0.075, armL = o.armL ?? 0.18;
    for (const s of [-1, 1]) {
      const arm = grp(P.body, s * B[0] * 0.86, by + B[1] * 0.42, 0.02);
      mesh(cap(armR, armL), fur, arm, { pos: [0, -armL / 2 - armR * 0.3, 0] });
      ball(M.fabric(o.paw || o.fur), arm, [0, -armL - armR * 0.6, 0.01], [armR * 1.18, armR * 1.12, armR * 1.18]);
      if (o.shirt && o.sleeves !== false) mesh(cap(armR * 1.28, armL * 0.25), M.fabric(o.shirt), arm, { pos: [0, -armR * 0.4, 0] });
      arm.userData.s = s;
      arm.userData.rest = [o.armX ?? -0.18, 0, s * (o.armZ ?? 0.32)];
      arm.rotation.set(...arm.userData.rest);
      P.arms.push(arm);
    }
    let se = be;
    if (o.shirt) {
      se = E(0, by, 0, B[0] * 1.045, B[1] * 1.04, B[2] * 1.06);
      const g = new T.SphereGeometry(1, 40, 22, 0, Math.PI * 2, o.shirtTop ?? 0.17 * Math.PI, (o.shirtBot ?? 0.7 * Math.PI) - (o.shirtTop ?? 0.17 * Math.PI));
      const m = mesh(g, M.fabric(o.shirt), P.body, {});
      m.material = m.material.clone(); m.material.side = T.DoubleSide;
      m.position.copy(se.c); m.scale.copy(se.r);
    }
    if (o.letter) {
      const L = o.letter;
      patch(P.body, se, 0, L.pitch ?? 6, L.size ?? 0.3, L.size ?? 0.3, M.decal(M.letterTex(L.ch, L.tex)), 1.015);
    }
    return be;
  }
  function headBall(P, o) {
    const hr = o.hr || [0.42, 0.38, 0.38];
    P.head.position.set(0, o.hy ?? 0.86, o.hz ?? 0.02);
    const he = E(0, 0, 0, hr[0], hr[1], hr[2]);
    const m = ball(o.headMat || M.fabric(o.fur), P.head, [0, 0, 0], hr);
    P.headMesh = m;
    return he;
  }
  function earDisc(P, he, yaw, pitch, r, outer, inner, o = {}) {
    for (const s of [-1, 1]) {
      const g = grp(P.head), { p, n } = surf(he, s * yaw, pitch);
      g.position.copy(p).addScaledVector(n, -r * (o.sink ?? 0.25));
      const face = V(s * (o.out ?? 0.35), o.up ?? 0.1, 1).normalize();
      g.quaternion.setFromUnitVectors(V(0, 0, 1), face);
      ball(M.fabric(outer), g, [0, 0, 0], [r, r * (o.tall ?? 1), r * 0.36]);
      if (inner) ball(M.felt(inner), g, [0, -r * 0.04, r * 0.2], [r * 0.66, r * 0.66 * (o.tall ?? 1), r * 0.2], { cast: false });
      g.userData.s = s; P.ears.push(g);
    }
  }
  function tube(P, parent, pts, r, mat) {
    const curve = new T.CatmullRomCurve3(pts.map(p => V(p[0], p[1], p[2])));
    return mesh(new T.TubeGeometry(curve, 48, r, 10, false), mat, parent);
  }

  /* ── the animals ───────────────────────────────────────────────────────────────────────────────── */
  const RED = '#e9453c', BUILD = {};

  BUILD.monkey = () => {
    const P = rig('monkey', { word: 'monkey', sound: 'm', ch: 'M' });
    const fur = '#8b5a3a', tan = '#f3c9a0';
    torso(P, { fur, paw: tan, shirt: RED, letter: { ch: 'M', tex: { fg: '#ffd43b', rim: '#ffffff' }, size: 0.35 } });
    const he = headBall(P, { fur });
    // heart-shaped face: two pads round the eyes + the muzzle
    for (const s of [-1, 1]) { const g = onSurf(P.head, he, s * 15, 9, 0.05); ball(M.fabric(tan), g, [0, 0, 0], [0.155, 0.17, 0.07]); }
    const mz = E(0, -0.1, 0.27, 0.22, 0.15, 0.13);
    ball(M.fabric(tan), P.head, [mz.c.x, mz.c.y, mz.c.z], [mz.r.x, mz.r.y, mz.r.z]);
    eyes(P.head, E(0, 0, 0, 0.44, 0.4, 0.43), 15, 9, 0.052);
    for (const s of [-1, 1]) { const g = onSurf(P.head, mz, s * 11, 26, 0.004); ball(M.bead(), g, [0, 0, 0], [0.016, 0.012, 0.008], { cast: false }); }
    mouth(P.head, mz, -6, 0.17, 'smile');
    blush(P.head, he, 36, -12, 0.12);
    earDisc(P, he, 84, 8, 0.165, fur, tan, { out: 0.75, up: 0.05, sink: 0.12 });
    P.tail = grp(P.body, 0, 0.2, -0.24);
    tube(P, P.tail, [[0, 0, 0], [0.1, -0.04, -0.14], [0.26, 0.08, -0.2], [0.3, 0.28, -0.12], [0.2, 0.36, -0.04], [0.13, 0.27, -0.06]], 0.035, M.fabric(fur));
    return P;
  };

  BUILD.mouse = () => {
    const P = rig('mouse', { word: 'mouse', sound: 'm', ch: 'm' });
    const fur = '#a9a6b6', pink = '#f7b3c6';
    torso(P, { fur, paw: pink, shirt: RED, letter: { ch: 'm', tex: { fg: '#ffffff', rim: '#ffd0d0' }, size: 0.35 } });
    const he = headBall(P, { fur, hr: [0.41, 0.36, 0.37], hy: 0.84 });
    ball(M.fabric('#c9c6d4'), P.head, [0, -0.12, 0.25], [0.2, 0.14, 0.14]);
    const mz = E(0, -0.12, 0.25, 0.2, 0.14, 0.14);
    const nose = onSurf(P.head, mz, 0, 20, 0.02); ball(M.plastic('#ff8fb0', { rough: 0.3 }), nose, [0, 0, 0], [0.05, 0.04, 0.04]);
    eyes(P.head, he, 19, 6, 0.05);
    mouth(P.head, mz, -12, 0.15, 'teeth');
    blush(P.head, he, 38, -12, 0.11);
    earDisc(P, he, 50, 46, 0.25, fur, pink, { out: 0.42, up: 0.2, sink: 0.1 });
    // whiskers
    const wm = M.thread('#5d5560');
    for (const s of [-1, 1]) for (const [dy, a] of [[0.02, 0.12], [-0.02, -0.08]]) {
      const w = mesh(new T.CylinderGeometry(0.004, 0.004, 0.24, 6), wm, P.head, { cast: false });
      w.position.set(s * 0.2, -0.12 + dy, 0.33); w.rotation.set(0, 0, Math.PI / 2 + s * a);
    }
    P.tail = grp(P.body, 0, 0.12, -0.24);
    tube(P, P.tail, [[0, 0, 0], [-0.12, -0.08, -0.12], [-0.3, -0.06, -0.08], [-0.42, 0.06, 0.02], [-0.46, 0.16, 0.12]], 0.018, M.fabric(pink));
    return P;
  };

  BUILD.ant = () => {
    const P = rig('ant', { word: 'ant', sound: 'a', ch: 'a' });
    const fur = '#7b4630';
    torso(P, { fur, shirt: '#2fa8a0', letter: { ch: 'a', tex: { fg: '#ffd43b', rim: '#ffffff' }, size: 0.35 }, armR: 0.06, armL: 0.17 });
    // a second, smaller pair of arms (six legs in all)
    for (const s of [-1, 1]) {
      const arm = grp(P.body, s * 0.24, 0.3, 0.1);
      mesh(cap(0.05, 0.1), M.fabric(fur), arm, { pos: [0, -0.08, 0] });
      ball(M.fabric(fur), arm, [0, -0.16, 0.01], [0.06, 0.055, 0.06]);
      arm.rotation.set(-0.6, 0, s * 0.9);
    }
    ball(M.fabric(fur), P.body, [0, 0.3, -0.32], [0.3, 0.27, 0.32]);       // abdomen behind
    const he = headBall(P, { fur, hr: [0.41, 0.38, 0.37] });
    ball(M.fabric('#9a6047'), P.head, [0, -0.13, 0.25], [0.19, 0.13, 0.12]);
    const mz = E(0, -0.13, 0.25, 0.19, 0.13, 0.12);
    eyes(P.head, he, 20, 7, 0.058);
    mouth(P.head, mz, -4, 0.16, 'open');
    blush(P.head, he, 38, -10, 0.12);
    // antennae
    const am = M.fabric('#4a2a1e');
    for (const s of [-1, 1]) {
      const g = grp(P.head, s * 0.14, 0.3, 0.06);
      tube(P, g, [[0, 0, 0], [s * 0.04, 0.12, 0.02], [s * 0.12, 0.24, 0.04], [s * 0.2, 0.3, 0.06]], 0.018, am);
      ball(M.fabric('#ff8a6b'), g, [s * 0.21, 0.31, 0.06], 0.05);
      g.userData.s = s; P.ears.push(g);
    }
    return P;
  };

  BUILD.seal = () => {
    const P = rig('seal', { word: 'seal', sound: 's', ch: 'S' });
    const fur = '#9db4cb', fur2 = '#b9cbdc';
    const bodyE = E(0, 0.46, 0, 0.36, 0.47, 0.33);
    ball(M.fabric(fur), P.body, [0, 0.46, 0], [0.36, 0.47, 0.33]);
    // sweater band with the letter patch
    const se = E(0, 0.46, 0, 0.375, 0.49, 0.35);
    const sg = new T.SphereGeometry(1, 40, 22, 0, Math.PI * 2, 0.2 * Math.PI, 0.38 * Math.PI);
    const sw = mesh(sg, M.fabric('#3f8fd8'), P.body, {}); sw.material = sw.material.clone(); sw.material.side = T.DoubleSide;
    sw.position.copy(se.c); sw.scale.copy(se.r);
    patch(P.body, se, 0, 4, 0.3, 0.3, M.decal(M.letterTex('S', { fg: '#2f6fc0', rim: '#ffffff', patch: '#fff4d6', stitch: 'rgba(63,143,216,0.6)', size: 0.68 })), 1.015);
    // flippers
    for (const s of [-1, 1]) {
      const arm = grp(P.body, s * 0.33, 0.6, 0.04);
      ball(M.fabric(fur), arm, [0, -0.16, 0.02], [0.075, 0.19, 0.13]);
      arm.userData.s = s; arm.userData.rest = [-0.25, 0, s * 0.5]; arm.rotation.set(-0.25, 0, s * 0.5);
      P.arms.push(arm);
    }
    for (const s of [-1, 1]) {
      const leg = grp(P.body, s * 0.12, 0.05, -0.2);
      ball(M.fabric(fur), leg, [s * 0.1, 0, -0.06], [0.17, 0.05, 0.11]);
      leg.userData.s = s; P.legs.push(leg);
    }
    const he = headBall(P, { fur, hr: [0.38, 0.34, 0.34], hy: 0.98, hz: 0.03 });
    for (const s of [-1, 1]) ball(M.fabric('#f4f7fb'), P.head, [s * 0.075, -0.1, 0.27], [0.1, 0.085, 0.085]);
    ball(M.fabric('#f4f7fb'), P.head, [0, -0.17, 0.25], [0.06, 0.05, 0.05]);
    const nose = grp(P.head, 0, -0.03, 0.34); ball(M.plastic('#2a2326', { rough: 0.25 }), nose, [0, 0, 0], [0.058, 0.038, 0.035]);
    eyes(P.head, he, 23, 10, 0.055);
    blush(P.head, he, 40, -10, 0.11);
    const wm = M.thread('#556070');
    for (const s of [-1, 1]) for (const a of [0.15, -0.05]) {
      const w = mesh(new T.CylinderGeometry(0.004, 0.004, 0.22, 6), wm, P.head, { cast: false });
      w.position.set(s * 0.2, -0.1 + a * 0.3, 0.3); w.rotation.set(0, 0, Math.PI / 2 + s * a);
    }
    P.ext = { bodyE };
    return P;
  };

  BUILD.turkey = () => {
    const P = rig('turkey', { word: 'turkey', sound: 't', ch: 'T' });
    const fur = '#8e5a3a';
    const be = E(0, 0.42, 0, 0.4, 0.41, 0.36);
    ball(M.fabric(fur), P.body, [0, 0.42, 0], [0.4, 0.41, 0.36]);
    patch(P.body, be, 0, -4, 0.34, 0.34, M.decal(M.letterTex('T', { fg: '#8a4a2a', rim: '#ffffff', patch: '#f8e3b8', shape: 'circle', stitch: 'rgba(140,90,50,0.5)', size: 0.66 })), 1.012);
    // tail fan
    const fanCols = ['#ff6fa8', '#9b6bd8', '#3d9be9', '#38c172', '#ffd43b', '#ff9f1c', '#ef4b4b'];
    P.tail = grp(P.body, 0, 0.5, -0.24);
    fanCols.forEach((c, i) => {
      const a = (-63 + i * 21) * D, f = grp(P.tail);
      f.rotation.z = a;
      ball(M.fabric(c), f, [0, 0.44, 0], [0.13, 0.4, 0.05]);
      ball(M.fabric('#fff2c8'), f, [0, 0.7, 0.03], [0.065, 0.075, 0.03], { cast: false });
    });
    for (const s of [-1, 1]) {
      const arm = grp(P.body, s * 0.36, 0.52, 0.02);
      ball(M.fabric('#6f4329'), arm, [0, -0.12, 0], [0.09, 0.2, 0.15]);
      arm.userData.s = s; arm.userData.rest = [-0.1, 0, s * 0.3]; arm.rotation.set(-0.1, 0, s * 0.3);
      P.arms.push(arm);
    }
    for (const s of [-1, 1]) {                                   // orange feet with three toes
      const leg = grp(P.body, s * 0.15, 0.06, 0.24);
      for (const a of [-0.45, 0, 0.45]) mesh(cap(0.028, 0.1), M.fabric('#ffa62b'), leg, { pos: [Math.sin(a) * 0.06, 0, Math.cos(a) * 0.06], rot: [Math.PI / 2, 0, -a] }).rotation.order = 'YXZ';
      leg.userData.s = s; P.legs.push(leg);
    }
    ball(M.fabric('#e35d5d'), P.body, [0, 0.8, 0.06], [0.16, 0.18, 0.15]);   // neck
    const red = M.fabric('#e86060');
    const he = headBall(P, { fur, headMat: red, hr: [0.27, 0.26, 0.25], hy: 1.0, hz: 0.06 });
    eyes(P.head, he, 28, 12, 0.05, { rim: '#ffffff' });
    const bk = grp(P.head, 0, -0.03, 0.24); mesh(cone(0.065, 0.15), M.plastic('#ffb31f', { rough: 0.4 }), bk, { rot: [Math.PI / 2 + 0.25, 0, 0], pos: [0, 0, 0.05] });
    ball(M.fabric('#d93b3b'), P.head, [0.05, -0.13, 0.22], [0.045, 0.09, 0.045]);   // wattle
    ball(M.fabric('#d93b3b'), P.head, [0, 0.25, 0.02], [0.05, 0.07, 0.05]);          // little comb
    blush(P.head, he, 45, -8, 0.09);
    return P;
  };

  BUILD.turtle = () => {
    const P = rig('turtle', { word: 'turtle', sound: 't', ch: 't' });
    const skin = '#8fd27a';
    const be = E(0, 0.38, 0.02, 0.33, 0.36, 0.26);
    ball(M.fabric(skin), P.body, [0, 0.38, 0.02], [0.33, 0.36, 0.26]);
    // shell on its back (+ rim) and the cream plastron in front with the letter
    const shell = ball(new T.MeshPhysicalMaterial({ map: M.shellTex(), roughness: 0.85, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new T.Color('#c8f0b0'), normalMap: M.fabricNormal(), normalScale: new T.Vector2(0.5, 0.5) }), P.body, [0, 0.44, -0.14], [0.42, 0.44, 0.3]);
    shell.rotation.y = Math.PI;
    const pe = E(0, 0.38, 0.05, 0.3, 0.33, 0.25);
    const pl = patch(P.body, pe, 0, -2, 0.42, 0.52, new T.MeshStandardMaterial({ map: M.plastronTex(), roughness: 0.9 }), 1.0);
    pl.renderOrder = 1;
    patch(P.body, pe, 0, 0, 0.27, 0.27, M.decal(M.letterTex('t', { fg: '#2f8a3f', rim: '#ffffff', size: 0.8 })), 1.03);
    for (const s of [-1, 1]) {
      const leg = grp(P.body, s * 0.18, 0.12, 0.06);
      mesh(cap(0.1, 0.1), M.fabric(skin), leg, { pos: [s * 0.02, 0, 0.1], rot: [Math.PI / 2 - 0.15, 0, 0] });
      leg.userData.s = s; P.legs.push(leg);
      const arm = grp(P.body, s * 0.3, 0.54, 0.04);
      mesh(cap(0.075, 0.12), M.fabric(skin), arm, { pos: [0, -0.1, 0] });
      arm.userData.s = s; arm.userData.rest = [-0.3, 0, s * 0.45]; arm.rotation.set(-0.3, 0, s * 0.45);
      P.arms.push(arm);
    }
    const he = headBall(P, { fur: skin, hr: [0.37, 0.33, 0.33], hy: 0.9, hz: 0.05 });
    eyes(P.head, he, 24, 10, 0.065);
    mouth(P.head, he, -18, 0.18, 'open');
    blush(P.head, he, 42, -10, 0.11);
    P.tail = grp(P.body, 0, 0.1, -0.3);
    mesh(cone(0.05, 0.12), M.fabric(skin), P.tail, { rot: [-Math.PI / 2, 0, 0] });
    return P;
  };

  BUILD.tiger = () => {
    const P = rig('tiger', { word: 'tiger', sound: 't', ch: 'T' });
    const fur = '#f59a3c', white = '#fff6ea';
    const bodyMat = new T.MeshPhysicalMaterial({ map: M.stripeTex(fur, '#3b2418', 'body'), roughness: 0.9, sheen: 0.9, sheenRoughness: 0.45, sheenColor: new T.Color('#ffd8a8'), normalMap: M.fabricNormal(), normalScale: new T.Vector2(0.55, 0.55) });
    const be = torso(P, { fur, belly: white, paw: white, letter: null });
    P.body.children[0].material = bodyMat;
    patch(P.body, E(0, 0.33, 0.12, 0.22, 0.26, 0.17), 0, 0, 0.27, 0.27, M.decal(M.letterTex('T', { fg: '#f07b16', rim: '#ffffff', size: 0.8 })), 1.03);
    const headMat = new T.MeshPhysicalMaterial({ map: M.stripeTex(fur, '#3b2418', 'head'), roughness: 0.9, sheen: 0.9, sheenRoughness: 0.45, sheenColor: new T.Color('#ffd8a8'), normalMap: M.fabricNormal(), normalScale: new T.Vector2(0.55, 0.55) });
    const he = headBall(P, { fur, headMat, hr: [0.43, 0.38, 0.38] });
    for (const s of [-1, 1]) ball(M.fabric(white), P.head, [s * 0.085, -0.13, 0.28], [0.12, 0.1, 0.1]);
    ball(M.fabric(white), P.head, [0, -0.21, 0.24], [0.08, 0.06, 0.07]);
    const nose = grp(P.head, 0, -0.06, 0.37); ball(M.plastic('#ff8fa3', { rough: 0.35 }), nose, [0, 0, 0], [0.06, 0.04, 0.035]);
    mouth(P.head, E(0, -0.13, 0.27, 0.2, 0.14, 0.11), -10, 0.17, 'w');
    eyes(P.head, he, 21, 9, 0.055);
    earDisc(P, he, 46, 44, 0.12, fur, white, { out: 0.2, up: 0.2, sink: 0.3 });
    P.tail = grp(P.body, 0, 0.16, -0.24);
    tube(P, P.tail, [[0, 0, 0], [0.12, -0.04, -0.14], [0.3, 0.02, -0.16], [0.4, 0.18, -0.1], [0.42, 0.3, -0.02]], 0.04, bodyMat);
    ball(M.fabric('#3b2418'), P.tail, [0.42, 0.32, -0.01], 0.05);
    return P;
  };

  BUILD.pig = () => {
    const P = rig('pig', { word: 'pig', sound: 'p', ch: 'p' });
    const fur = '#f6a9bb', deep = '#ee8aa3';
    torso(P, { fur, paw: deep, shirt: '#4fb0ea', letter: { ch: 'p', tex: { fg: '#ffffff', rim: '#2a7fc0' }, size: 0.35 } });
    const he = headBall(P, { fur, hr: [0.43, 0.38, 0.38] });
    const sn = grp(P.head, 0, -0.07, 0.34);
    mesh(new T.CylinderGeometry(0.135, 0.14, 0.1, 32), M.fabric(deep), sn, { rot: [Math.PI / 2, 0, 0], pos: [0, 0, 0.02] });
    ball(M.fabric(deep), sn, [0, 0, 0.07], [0.135, 0.105, 0.03]);
    for (const s of [-1, 1]) ball(M.felt('#b85a73'), sn, [s * 0.045, 0, 0.095], [0.022, 0.032, 0.01], { cast: false });
    eyes(P.head, he, 25, 12, 0.052);
    mouth(P.head, E(0, -0.07, 0.3, 0.2, 0.18, 0.12), -38, 0.13, 'smile');
    blush(P.head, he, 42, -12, 0.12);
    for (const s of [-1, 1]) {                                     // floppy triangle ears
      const g = grp(P.head), { p, n } = surf(he, s * 46, 46);
      g.position.copy(p).addScaledVector(n, -0.03);
      g.rotation.set(0.75, 0, s * -0.55);
      mesh(cone(0.11, 0.2), M.fabric(fur), g, { scale: [1, 1, 0.42], pos: [0, 0.06, 0] });
      mesh(cone(0.07, 0.13), M.felt(deep), g, { scale: [1, 1, 0.3], pos: [0, 0.045, 0.03], cast: false });
      g.userData.s = s; P.ears.push(g);
    }
    P.tail = grp(P.body, 0, 0.24, -0.26);
    const pts = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 3.2; pts.push([Math.cos(a) * 0.06 - 0.06, Math.sin(a) * 0.06, -i * 0.006]); }
    tube(P, P.tail, pts, 0.02, M.fabric(fur));
    return P;
  };

  /* ── behaviour ─────────────────────────────────────────────────────────────────────────────────── */
  const tmpV = V(0, 0, 0), tmpQ = new T.Quaternion();
  function finish(P) {
    const box = new T.Box3().setFromObject(P.root);
    P.top = box.max.y; P.width = box.max.x - box.min.x;
    P.gripY = P.head.position.y;
    P.headR = P.headMesh ? [P.headMesh.scale.x, P.headMesh.scale.y, P.headMesh.scale.z] : [0.4, 0.37, 0.37];
    P.gripR = P.headR[0];
    P.phase = Math.random() * 10;
    P.st = { excite: 0, ek: 0, cheer: 0, ck: 0, held: 0, hk: 0, nope: 0, look: null, yaw: 0, pitch: 0, wander: 0, wy: 0, wp: 0, hop: 0 };
    P.root.traverse(o => { if (o.isMesh) Object.defineProperty(o.userData, 'plush', { value: P, enumerable: false, configurable: true }); });
    P.excite = (v) => { P.st.excite = v; };
    P.cheer = (sec = 1.6) => { P.st.cheer = sec; };
    P.hold = (on) => { P.st.held = on ? 1 : 0; };
    P.nope = (sec = 1.0) => { P.st.nope = sec; };
    P.lookAt = (w) => { P.st.look = w ? w.clone() : null; };
    P.update = function (dt, t) {
      const s = P.st, ph = P.phase;
      const ease = (cur, to, k) => cur + (to - cur) * Math.min(1, dt * k);
      s.ek = ease(s.ek, s.excite, 6);
      s.cheer = Math.max(0, s.cheer - dt); s.ck = ease(s.ck, s.cheer > 0 ? 1 : 0, 7);
      s.hk = ease(s.hk, s.held, 5);
      s.nope = Math.max(0, s.nope - dt);
      const br = Math.sin(t * 2.3 + ph);
      P.body.scale.set(1 - 0.007 * br, 1 + 0.014 * br, 1 - 0.007 * br);
      const hop = Math.abs(Math.sin(t * 8.5 + ph)) * 0.04 * s.ek + Math.abs(Math.sin(t * 7)) * 0.12 * s.ck;
      P.body.position.y = hop * (1 - s.hk);
      // arms: rest → cheer (up) / held (out)
      for (const a of P.arms) {
        const r = a.userData.rest || [-0.18, 0, a.userData.s * 0.32], k = a.userData.s;
        const wave = Math.sin(t * 9 + ph + k) * 0.25 * s.ck;
        a.rotation.x = r[0] * (1 - s.ck) - 0.2 * s.ck;
        a.rotation.z = r[2] + (k * 2.3 - r[2]) * Math.max(s.ck, s.hk * 0.55) + wave * k + Math.sin(t * 6 + k) * 0.12 * s.hk;
      }
      for (const l of P.legs) l.rotation.x = s.hk * (0.9 + Math.sin(t * 5 + l.userData.s) * 0.22);
      for (const e of P.ears) e.rotation.z = (e.userData.rz0 ?? (e.userData.rz0 = e.rotation.z)) + Math.sin(t * 3 + ph + e.userData.s) * 0.06 * (1 + 2 * s.ek);
      if (P.tail) P.tail.rotation.y = Math.sin(t * 2.2 + ph) * 0.18 * (1 + 2 * (s.ek + s.ck));
      // head: look at a point (the claw over it), else wander; shake on "nope"
      s.wander -= dt;
      if (s.wander <= 0) { s.wander = 1.8 + Math.random() * 2.6; s.wy = (Math.random() - 0.5) * 0.7; s.wp = (Math.random() - 0.3) * 0.25; }
      let ty = s.wy, tp = s.wp;
      if (s.look) {
        P.head.getWorldPosition(tmpV);
        const d = s.look.clone().sub(tmpV);
        P.root.getWorldQuaternion(tmpQ); d.applyQuaternion(tmpQ.invert());
        ty = Math.max(-0.7, Math.min(0.7, Math.atan2(d.x, d.z)));
        tp = Math.max(-0.35, Math.min(0.75, Math.atan2(d.y, Math.hypot(d.x, d.z))));
      }
      s.yaw = ease(s.yaw, ty, 4); s.pitch = ease(s.pitch, tp, 4);
      const shake = s.nope > 0 ? Math.sin(s.nope * 26) * 0.45 * Math.min(1, s.nope * 2) : 0;
      P.head.rotation.set(-s.pitch * 0.8, s.yaw + shake, Math.sin(t * 1.1 + ph) * 0.06 + Math.sin(t * 9) * 0.1 * s.ck);
    };
    return P;
  }

  const Plush = {
    KINDS: Object.keys(BUILD),
    build(kind) { return finish(BUILD[kind]()); },
  };
  window.Plush = Plush;
})();
