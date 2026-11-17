/* Toy Catch — the friends' signature poses (user: "3d 동물 인형들 시그니처 포즈나 인터렉션 있었으면 좋곘어").
 * Every 3D friend has its own short move (about 1-1.6 s) made of up to 4 soft PARTS of its mesh (ears, arms, tail,
 * antennae, hat, fins, wings, the head…) plus a little whole-body acting (hop, lean, turn, nod):
 *   monkey waves · mouse wiggles its ears and swishes its tail · ant's hat pops up and its antennae boing · seal claps
 *   its flippers · turkey fans its tail and flaps its wings · turtle ducks into its shell and pops out · cat beckons
 *   (maneki-neko) · cow nods and flaps its ears · dog tilts its head with its ears flopping · fish swishes its tail and
 *   fins and puckers · duck flaps its wings and hops.
 * A part is a soft region of the mesh — a capsule from its joint to its tip (or an ellipse), ramping from 0 to 1 across
 * the joint and smoothed over the mesh — given in PICTURE FRACTIONS (u across the picture's width, v down its height,
 * like friends-art.js's head), so the parts still fit when the meshes are rebuilt. It turns about a hinge (pivot at
 * the joint, mid-depth of the mesh there; axis), moves and scales; the vertex shader does it before plushDeform (the
 * squash, bend and the claw's pinch still work on top), the normals turn with it, the shadow follows (the depth
 * material gets the same code). The front picture sticks to the vertices (its uv is from the rest positions).
 * When: P.pose(k) plays it once (k = strength: the prize 1, a tap .85, now and then .7); while the claw is right over
 * a friend (excite 1) it loops gently on top of the selection hops, fading out as the claw goes down (game.js drop()
 * calls P.poseStop()) and staying off while the friend is held; Poses.idle(dt, friends) has one random friend pose every
 * 5-8 s (game.js: on the title and in the game, while not busy).
 * Friends without 3D (?puff / ?flat) get no-op P.pose / P.poseLoop.
 * Dev: dev/friends3d.html?pose (each friend's pose on a loop) · &weights (the parts' weights in colour).
 */
(function () {
  'use strict';
  const T = THREE;
  const NP = 4;                                          // parts per friend (vec4 weights)
  const PI2 = Math.PI * 2;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const sm = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  /* time curves (t in seconds) */
  const env = (t, D, a, r) => sm(0, a, t) * (1 - sm(D - r, D, t));            // fade in over a, out over the last r
  const bell = (t, c, w) => { const x = (t - c) / w; return x <= -1 || x >= 1 ? 0 : (1 - x * x) * (1 - x * x); };
  const ring = (t, t0, f, d) => (t < t0 ? 0 : Math.exp(-(t - t0) * d) * Math.sin((t - t0) * f * PI2));   // a damped boing
  const wave = (t, f, ph = 0) => Math.sin((t * f + ph) * PI2);

  /* the vertex shader: per part i, axis (xyz) + angle (w) in uPA[i], pivot (xyz) + scale (w) in uPP[i], move in uPT[i];
     pw = the vertex's weight in each part. Parts apply in order (a part inside another — antennae on the hat, ears on
     the head — comes first). */
  const GLSL = `
    attribute vec4 pw;
    uniform vec4 uPA[4], uPP[4], uPT[4];
    vec3 poseRot(vec3 v, vec4 a, float k) {
      float th = a.w * k, c = cos(th), s = sin(th);
      return v * c + cross(a.xyz, v) * s + a.xyz * dot(a.xyz, v) * (1.0 - c);
    }
    vec3 poseDeform(vec3 p) {
      for (int i = 0; i < 4; i++) {
        float k = pw[i];
        if (k <= 0.0) continue;
        vec3 q = (p - uPP[i].xyz) * mix(1.0, uPP[i].w, k);
        p = uPP[i].xyz + poseRot(q, uPA[i], k) + uPT[i].xyz * k;
      }
      return p;
    }
    vec3 poseNormal(vec3 n) {
      for (int i = 0; i < 4; i++) { float k = pw[i]; if (k > 0.0) n = poseRot(n, uPA[i], k); }
      return n;
    }`;

  /* ── the parts and moves ─────────────────────────────────────────────────────────────────────────────────────────
     part: at [u, v] the joint (hinge) · to [u, v] the tip: the region is the capsule at→to, r its radius (a fraction of
     the picture's height) — or ell [u, v, ru, rv], an ellipse (fractions of width / height) · j [a, b] the ramp across
     the joint along at→to, from -a to +b of its length (0 → 1) · z [z0, z1] only that depth (friend units, soft) ·
     not: an ellipse (or a list of them) left out (the head beside the turkey's fan, the shell over the turtle's neck) ·
     pv [u, v] a pivot apart from the joint · ax the hinge axis (default [0, 0, 1]: turns in the picture's plane;
     + = counter-clockwise from the front).
     act(t, o): o.a[i] angle, o.t[i*3..] move, o.s[i] scale (1 = none; written as an offset from 1), o.hop / o.lean /
     o.turn / o.nod the whole body. Every move starts and ends at rest. */
  const DATA = {
    monkey: {
      dur: 1.6,
      parts: [
        { at: [0.79, 0.625], to: [0.99, 0.765], r: 0.075, j: [0.1, 0.4] },          // right arm (the picture's right)
        { at: [0.86, 0.33], to: [0.99, 0.33], r: 0.085, j: [0.05, 0.45] },          // right ear
      ],
      act(t, o) {
        const e = env(t, 1.6, 0.3, 0.4);
        o.a[0] = e * (1.35 + 0.3 * wave(t - 0.3, 2.4) * sm(0.2, 0.45, t));         // up, then waves: hi-hi!
        o.a[1] = 0.25 * e * wave(t, 2.4, 0.25);
        o.hop = 0.045 * bell(t, 0.2, 0.2);
        o.lean = -0.05 * e;
      },
    },
    mouse: {
      dur: 1.5,
      parts: [
        { at: [0.29, 0.27], to: [0.12, 0.09], r: 0.13, j: [0.05, 0.45] },           // left ear
        { at: [0.71, 0.27], to: [0.88, 0.09], r: 0.13, j: [0.05, 0.45] },           // right ear
        { at: [0.82, 0.69], to: [0.97, 0.5], r: 0.045, j: [0.0, 0.35] },            // tail
      ],
      act(t, o) {
        const e = env(t, 1.5, 0.2, 0.35), w = wave(t, 3.2);
        o.a[0] = -e * (0.12 + 0.2 * w);
        o.a[1] = e * (0.12 + 0.2 * w);
        o.a[2] = e * 0.45 * wave(t, 1.9);
        o.lean = 0.04 * e * wave(t, 0.7);
      },
    },
    ant: {
      dur: 1.4,
      parts: [
        { at: [0.32, 0.12], to: [0.12, 0.035], r: 0.04, j: [0.05, 0.3] },           // left antenna
        { at: [0.68, 0.12], to: [0.88, 0.045], r: 0.04, j: [0.05, 0.3] },           // right antenna
        { at: [0.5, 0.29], to: [0.5, 0.0], ell: [0.5, 0.13, 0.52, 0.17], j: [0.0, 0.18] },   // the hat (with the antennae)
      ],
      act(t, o) {
        const up = bell(t, 0.22, 0.2);                                          // hat pops up …
        o.t[2 * 3 + 1] = 0.04 * up - 0.006 * bell(t, 0.48, 0.1);                // … and lands with a little squash
        const b = ring(t, 0.3, 3.4, 3.2) * sm(1.4, 1.1, t);                     // the antennae boing
        o.a[0] = -0.5 * b - 0.12 * up;
        o.a[1] = -0.5 * b + 0.12 * up;
        o.hop = 0.02 * bell(t, 0.18, 0.15);
      },
    },
    seal: {
      dur: 1.5,
      parts: [
        { at: [0.21, 0.6], to: [0.04, 0.76], r: 0.075, j: [0.05, 0.4] },            // left flipper
        { at: [0.79, 0.6], to: [0.96, 0.76], r: 0.075, j: [0.05, 0.4] },            // right flipper
        { at: [0.5, 0.47], to: [0.5, 0.05], ell: [0.5, 0.24, 0.45, 0.27], j: [0.0, 0.2], ax: [1, 0, 0] },   // head
      ],
      act(t, o) {
        // applause: the flippers swing out and slap back against the tummy, three times, chin up (arf arf)
        const e = env(t, 1.5, 0.15, 0.3), c = Math.abs(Math.sin((t - 0.1) * Math.PI * 2.4)) * sm(0.05, 0.2, t);
        o.a[0] = -0.6 * c * e; o.a[1] = 0.6 * c * e;
        o.a[2] = -(0.1 + 0.08 * (1 - c)) * e;
        o.hop = 0.025 * e * (1 - c);
      },
    },
    turkey: {
      dur: 1.6,
      parts: [
        // the tail fan's two sides (round the head and body), turning about the middle of the body so they open out
        { at: [0.3, 0.47], to: [0.03, 0.42], pv: [0.5, 0.56], r: 0.24, j: [0.0, 0.3], z: [-1, 0.02], not: [0.5, 0.3, 0.25, 0.26] },
        { at: [0.7, 0.47], to: [0.97, 0.42], pv: [0.5, 0.56], r: 0.24, j: [0.0, 0.3], z: [-1, 0.02], not: [0.5, 0.3, 0.25, 0.26] },
        { at: [0.24, 0.66], to: [0.11, 0.84], r: 0.065, j: [0.05, 0.4] },           // left wing
        { at: [0.76, 0.66], to: [0.89, 0.84], r: 0.065, j: [0.05, 0.4] },           // right wing
      ],
      act(t, o) {
        const e = env(t, 1.6, 0.3, 0.45), r = 0.035 * e * wave(t, 7.5);
        o.a[0] = 0.12 * e + r; o.a[1] = -0.12 * e - r;                          // the fan opens out and rattles
        o.s[0] = o.s[1] = 0.08 * e;
        const f = e * (0.25 + 0.3 * (0.5 - 0.5 * Math.cos((t - 0.3) * 3 * PI2)) * sm(0.25, 0.4, t));
        o.a[2] = -f; o.a[3] = f;                                                // wings flap
        o.nod = 0.06 * e * wave(t, 1.5);
      },
    },
    turtle: {
      dur: 1.5,
      parts: [
        // the head (the picture is the turtle's side), not the shell's rim over its neck
        { at: [0.4, 0.47], to: [0.0, 0.44], ell: [0.2, 0.44, 0.27, 0.35], j: [0.0, 0.22], not: [[0.67, 0.36, 0.31, 0.37], [0.36, 0.82, 0.1, 0.13]] },
      ],
      act(t, o) {
        const inn = sm(0.05, 0.3, t) * (1 - sm(0.62, 0.78, t));                 // ducks in …
        const out = ring(t, 0.72, 1.6, 4.5) * sm(0.64, 0.74, t);                // … pops out with a wobble
        o.t[0] = 0.15 * inn - 0.04 * out; o.t[2] = -0.12 * inn;
        o.s[0] = -0.24 * inn;
        o.a[0] = -0.12 * out;
        o.hop = 0.03 * bell(t, 0.84, 0.14);
      },
    },
    cat: {
      dur: 1.6,
      parts: [
        { at: [0.82, 0.6], to: [0.98, 0.74], r: 0.07, j: [0.1, 0.4] },              // right arm: the beckoning paw
        { at: [0.25, 0.2], to: [0.17, 0.03], r: 0.08, j: [0.0, 0.4] },              // left ear
        { at: [0.75, 0.2], to: [0.83, 0.03], r: 0.08, j: [0.0, 0.4] },              // right ear
      ],
      act(t, o) {
        const e = env(t, 1.6, 0.35, 0.4);
        o.a[0] = e * (1.0 + 0.32 * wave(t - 0.35, 2.0) * sm(0.3, 0.5, t));       // paw up, beckoning: come here!
        o.a[1] = 0.22 * bell(t, 0.75, 0.1) + 0.22 * bell(t, 1.05, 0.1);          // ear twitches
        o.a[2] = -0.22 * bell(t, 0.6, 0.1) - 0.22 * bell(t, 0.9, 0.1);
        o.lean = 0.04 * e;
      },
    },
    cow: {
      dur: 1.5,
      parts: [
        { at: [0.21, 0.2], to: [0.03, 0.21], r: 0.07, j: [0.0, 0.35] },             // left ear
        { at: [0.79, 0.2], to: [0.97, 0.21], r: 0.07, j: [0.0, 0.35] },             // right ear
        { at: [0.5, 0.5], to: [0.5, 0.0], ell: [0.5, 0.25, 0.55, 0.3], j: [0.0, 0.2] },   // head
      ],
      act(t, o) {
        const e = env(t, 1.5, 0.25, 0.35);
        o.a[0] = e * (0.2 + 0.35 * wave(t, 3.2));                               // the ears flap (in turn)
        o.a[1] = -e * (0.2 + 0.35 * wave(t, 3.2, 0.5));
        o.a[2] = 0.1 * e * wave(t, 1.2);                                         // and the head sways: moo
      },
    },
    dog: {
      dur: 1.6,
      parts: [
        { at: [0.24, 0.12], to: [0.08, 0.44], r: 0.085, j: [0.0, 0.3] },            // left ear
        { at: [0.76, 0.12], to: [0.92, 0.44], r: 0.085, j: [0.0, 0.3] },            // right ear
        { at: [0.5, 0.5], to: [0.5, 0.0], ell: [0.5, 0.25, 0.55, 0.3], j: [0.0, 0.2] },   // head
      ],
      act(t, o) {
        const e = env(t, 1.6, 0.3, 0.45);
        o.a[2] = 0.22 * e;                                                       // head tilt: hm?
        const fl = 0.3 * ring(t, 0.1, 2.6, 2.4) + 0.12 * e;
        o.a[0] = -fl; o.a[1] = fl;
      },
    },
    fish: {
      dur: 1.5,
      parts: [
        // (not the side fin: it lies on the body, and the body under it has the fin's picture)
        { at: [0.79, 0.5], to: [1.0, 0.5], r: 0.3, j: [0.0, 0.25], ax: [0, 0.55, 0.83] },  // tail fin
        { at: [0.5, 0.18], to: [0.55, 0.0], r: 0.12, j: [0.0, 0.35] },             // top fin
        { at: [0.05, 0.6], to: [-0.02, 0.6], r: 0.09, j: [1, 1] },                  // lips
      ],
      act(t, o) {
        const e = env(t, 1.5, 0.2, 0.35);
        o.a[0] = 0.42 * e * wave(t, 2.4);                                        // swish swish
        o.a[1] = 0.16 * e * wave(t, 2.4, 0.3);
        o.s[2] = 0.3 * (bell(t, 0.95, 0.15) + bell(t, 1.25, 0.15));              // blub blub
        o.turn = 0.14 * e * wave(t, 1.2);
        o.hop = 0.03 * e * (0.5 - 0.5 * Math.cos(t * 1.2 * PI2));               // (it swims up a little)
      },
    },
    duck: {
      dur: 1.5,
      parts: [
        { at: [0.19, 0.55], to: [0.07, 0.72], r: 0.07, j: [0.05, 0.4] },            // left wing
        { at: [0.81, 0.55], to: [0.93, 0.72], r: 0.07, j: [0.05, 0.4] },            // right wing
      ],
      act(t, o) {
        const e = env(t, 1.5, 0.2, 0.35);
        const f = e * (0.15 + 0.4 * (0.5 - 0.5 * Math.cos(t * 4 * PI2)));
        o.a[0] = -f; o.a[1] = f;                                                // flap flap
        o.hop = 0.04 * e * Math.abs(wave(t, 2));
        o.lean = 0.05 * e * wave(t, 1);                                          // and a waddle
      },
    },
  };

  /* ── weights ─────────────────────────────────────────────────────────────────────────────────────────────────── */
  const prepCache = {};
  function prep(kind, c) {
    if (prepCache[kind]) return prepCache[kind];
    const D = DATA[kind], { geo, w, h, u } = c;
    const pos = geo.attributes.position, n = pos.count;
    const X = (pu) => (pu - u) * w, Y = (pv) => (1 - pv) * h;
    const parts = D.parts.slice(0, NP).map((sp) => {
      const ax = X(sp.at[0]), ay = Y(sp.at[1]), bx = X(sp.to[0]), by = Y(sp.to[1]);
      const L = Math.max(1e-4, Math.hypot(bx - ax, by - ay)), dx = (bx - ax) / L, dy = (by - ay) / L;
      const r = (sp.r || 0.1) * h, j = sp.j || [0.15, 0.35];
      // the hinge sits mid-depth in the mesh at the joint (pv: a pivot apart from the joint)
      const hx = sp.pv ? X(sp.pv[0]) : ax, hy = sp.pv ? Y(sp.pv[1]) : ay;
      let z0 = 1e9, z1 = -1e9;
      const rr = Math.max(r * 0.6, 0.035);
      for (let i = 0; i < n; i++) if (Math.hypot(pos.getX(i) - hx, pos.getY(i) - hy) < rr) { const z = pos.getZ(i); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const pz = sp.pz != null ? sp.pz : z0 < z1 ? (z0 + z1) / 2 : 0;
      const a = sp.ax || [0, 0, 1], al = Math.hypot(a[0], a[1], a[2]) || 1;
      const ell = sp.ell && [X(sp.ell[0]), Y(sp.ell[1]), sp.ell[2] * w, sp.ell[3] * h];
      const not = sp.not && (Array.isArray(sp.not[0]) ? sp.not : [sp.not]).map(e => [X(e[0]), Y(e[1]), e[2] * w, e[3] * h]);
      const weight = (x, y, z) => {
        const s = (x - ax) * dx + (y - ay) * dy;
        let k = sm(-j[0] * L, j[1] * L, s);
        if (k <= 0) return 0;
        if (ell) {
          const ex = (x - ell[0]) / ell[2], ey = (y - ell[1]) / ell[3];
          k *= 1 - sm(0.85, 1.05, Math.sqrt(ex * ex + ey * ey));
        } else {
          const q = Math.max(0, Math.min(L, s)), d = Math.hypot(x - (ax + dx * q), y - (ay + dy * q));
          k *= 1 - sm(r * 0.8, r * 1.1, d);
        }
        if (sp.z) k *= sm(sp.z[0] - 0.03, sp.z[0] + 0.03, z) * (1 - sm(sp.z[1] - 0.03, sp.z[1] + 0.03, z));
        if (not) for (const e of not) { const ex = (x - e[0]) / e[2], ey = (y - e[1]) / e[3]; k *= sm(1, 1.25, Math.sqrt(ex * ex + ey * ey)); }
        return k;
      };
      return { pivot: [hx, hy, pz], axis: [a[0] / al, a[1] / al, a[2] / al], weight };
    });
    // weights per vertex, smoothed over the mesh's neighbours (no steps between rings of vertices)
    const W = new Float32Array(n * NP);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      for (let p = 0; p < parts.length; p++) W[i * NP + p] = parts[p].weight(x, y, z);
    }
    const idx = geo.index ? geo.index.array : null;
    if (idx) {
      const deg = new Uint32Array(n + 1);
      for (let i = 0; i < idx.length; i++) deg[idx[i] + 1] += 2;
      for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
      const nb = new Uint32Array(deg[n]), fill = deg.slice(0, n);
      for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f], b = idx[f + 1], cc = idx[f + 2];
        nb[fill[a]++] = b; nb[fill[a]++] = cc; nb[fill[b]++] = a; nb[fill[b]++] = cc; nb[fill[cc]++] = a; nb[fill[cc]++] = b;
      }
      const tmpW = new Float32Array(n * NP);
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < n; i++) {
          for (let p = 0; p < NP; p++) {
            let s = 0;
            for (let e = deg[i]; e < deg[i + 1]; e++) s += W[nb[e] * NP + p];
            const m = deg[i + 1] > deg[i] ? s / (deg[i + 1] - deg[i]) : W[i * NP + p];
            tmpW[i * NP + p] = 0.5 * W[i * NP + p] + 0.5 * m;
          }
        }
        W.set(tmpW);
      }
    }
    return (prepCache[kind] = { parts, W, D });
  }

  /* the GLSL goes into the friend's own shaders (friends.js plush3dShader / its depth material): before plushDeform,
     and the normals turn with the parts. (Same code for every friend: they share one program, data are uniforms.) */
  function wrap(mat, main) {
    const ob = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) {
      ob.call(this, sh, r);
      let vs = sh.vertexShader.replace('vec3 plushDeform(vec3 p) {', GLSL + '\n    vec3 plushDeform(vec3 p) {\n      p = poseDeform(p);');
      if (main) {
        vs = vs.replace('normalMatrix * normal)', 'normalMatrix * poseNormal(normal))');
        if (Poses.debug) {                                // dev: the parts' weights in colour (red, green, blue, yellow)
          vs = vs.replace('void main() {', 'varying vec4 vPw;\nvoid main() {\n  vPw = pw;');
          sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec4 vPw;\nvoid main() {')
            .replace('#include <opaque_fragment>', `{
              vec3 dc = vec3(1.0, 0.1, 0.1) * vPw.x + vec3(0.1, 0.9, 0.2) * vPw.y + vec3(0.15, 0.3, 1.0) * vPw.z + vec3(1.0, 0.85, 0.0) * vPw.w;
              float da = clamp(vPw.x + vPw.y + vPw.z + vPw.w, 0.0, 1.0);
              outgoingLight = mix(vec3(dot(outgoingLight, vec3(0.3, 0.5, 0.2)) * 0.5 + 0.4), dc / max(da, 0.001), da);
            }
            #include <opaque_fragment>`);
        }
      }
      sh.vertexShader = vs;
    };
  }

  const noop = () => {};
  const LOOP_K = 0.5, LOOP_GAP = 0.35, XFADE = 0.2;

  /* P gets pose(k), poseLoop(on), poser.update(dt, t) (friends.js calls it every frame) and poser.busy */
  function attach(P, c) {
    const D = c && DATA[P.kind];
    if (!D || !c.geo || !c.geo.attributes.position) { P.pose = noop; P.poseLoop = noop; P.poseStop = noop; return; }
    const { parts, W } = prep(P.kind, c);
    if (!c.geo.attributes.pw) c.geo.setAttribute('pw', new T.BufferAttribute(W, NP));
    const pa = new Float32Array(16), pp = new Float32Array(16), pt = new Float32Array(16);
    for (let i = 0; i < NP; i++) {
      const q = parts[i];
      pa[i * 4] = q ? q.axis[0] : 0; pa[i * 4 + 1] = q ? q.axis[1] : 0; pa[i * 4 + 2] = q ? q.axis[2] : 1;
      if (q) { pp[i * 4] = q.pivot[0]; pp[i * 4 + 1] = q.pivot[1]; pp[i * 4 + 2] = q.pivot[2]; }
      pp[i * 4 + 3] = 1;
    }
    c.U.uPA = { value: pa }; c.U.uPP = { value: pp }; c.U.uPT = { value: pt };
    wrap(c.mat, true); wrap(c.depth, false);
    // out: [a0..a3, s0..s3, t0..t11, hop, lean, turn, nod]
    const NO = 24, tgt = new Float32Array(NO), cur = new Float32Array(NO), from = new Float32Array(NO);
    const o = { a: tgt.subarray(0, 4), s: tgt.subarray(4, 8), t: tgt.subarray(8, 20), hop: 0, lean: 0, turn: 0, nod: 0 };
    const st = { one: false, t: 0, k: 1, loop: false, lt: 0, lk: 0, xf: XFADE };
    const restart = () => { from.set(cur); st.xf = 0; };
    P.pose = (k = 1) => { if (P.st.hk > 0.5) return; restart(); st.one = true; st.t = 0; st.k = k; st.lt = 0; };
    P.poseLoop = (on) => { st.loop = !!on; };
    P.poseStop = () => { restart(); st.one = false; st.lk = 0; st.lt = 0; };   // (eases back to rest)
    P.poser = {
      get busy() { return st.one; },
      update(dt) {
        const s = P.st;
        if (st.one && (st.t += dt) >= D.dur) { st.one = false; st.lt = 0; }
        const loopOn = (st.loop || s.excite >= 0.99) && s.hk < 0.05;
        st.lk += ((loopOn ? 1 : 0) - st.lk) * Math.min(1, dt * (loopOn ? 4 : 9));
        tgt.fill(0); o.hop = o.lean = o.turn = o.nod = 0;
        let k = 0, body = 1;
        if (st.one) { D.act(st.t, o); k = st.k; }
        else if (st.lk > 0.002) {
          st.lt += dt; if (st.lt >= D.dur + LOOP_GAP) st.lt = 0;
          if (st.lt < D.dur) D.act(st.lt, o);
          k = LOOP_K * st.lk; body = 0.3;                // (the selection already hops: only a hint of the body acting)
        } else st.lt = 0;
        tgt[20] = o.hop * body; tgt[21] = o.lean * body; tgt[22] = o.turn * body; tgt[23] = o.nod * body;
        const g = k * Math.max(0, 1 - s.hk * 2);        // off while it's held
        for (let i = 0; i < NO; i++) tgt[i] *= g;
        st.xf += dt;
        const x = st.xf >= XFADE ? 1 : sm(0, XFADE, st.xf);
        for (let i = 0; i < NO; i++) cur[i] = from[i] + (tgt[i] - from[i]) * x;
        for (let i = 0; i < NP; i++) {
          pa[i * 4 + 3] = cur[i];
          pp[i * 4 + 3] = 1 + cur[4 + i];
          pt[i * 4] = cur[8 + i * 3]; pt[i * 4 + 1] = cur[9 + i * 3]; pt[i * 4 + 2] = cur[10 + i * 3];
        }
        P.pic.position.y = cur[20];
        P.pic.rotation.set(cur[23], cur[22], cur[21]);
      },
    };
  }

  /* now and then (every 5-8 s) one friend that isn't under the claw, held, cheering or busy does its pose */
  let idleT = 3 + Math.random() * 3, last = null;
  function idle(dt, list) {
    if ((idleT -= dt) > 0) return;
    idleT = 5 + Math.random() * 3;
    let n = 0, pick = null;
    for (const p of list) {
      if (!p.poser || p.poser.busy || p === last || p.st.excite > 0.5 || p.st.hk > 0.05 || p.st.ck > 0.1 || p.st.nope > 0) continue;
      if (Math.random() * ++n < 1) pick = p;            // (reservoir: a fair random pick, no array)
    }
    if (pick) { last = pick; pick.pose(0.7); }
  }

  window.Poses = { GLSL, DATA, attach, idle, idleIn: (sec) => { idleT = sec; }, debug: false };   // (idleIn: QA)
})();
