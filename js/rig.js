/* Toy Catch — the friends' rigs at play time: arms, legs, wings, tails, ears, hats … turn round their own joints like a
 * plush toy's sewn-on limbs (user: "모션도 몸이랑 팔이 같이 붙어서 움직인다던지"). Data: tools/rig.py → js/friends-3d.js
 * (bones + sk per vertex: bone, share; parts from design/parts/, made from the FRONT pictures).
 * Every bone is a damped angular spring (a limb held in shape by its stuffing) pushed by what the friend itself does:
 *   - its acceleration (the selection hops, the claw lifting and carrying it, landings: limbs lag, flap and bounce),
 *   - its turning (the idle sway leaves the limbs trailing a little; the prize spin flings them out),
 *   - gravity as it tips, and hanging from the claw by the neck: unsupported legs dangle down, arms and ears droop, and
 *     everything swings while it's lifted and carried, then settles,
 *   - kicks on landings / grabs (P.bump), and the signature poses (js/poses.js writes bone angles: a wave from the
 *     shoulder, wing flaps from the root, a tail swish from its base).
 * Skinning in the vertex shader BEFORE plushDeform (squash, bend and the claw's pinch still work on top; the same code
 * in the depth material, so the shadow follows); normals turn with the bones; a part turned away from the front shows
 * the atlas instead of stretching the front picture (its view is taken in the part's rest frame). A vertex blends its
 * bone's turn with its parent's by its share (a narrow band at the joint). Friends without rig data (and ?puff / ?flat)
 * are left exactly as they were. Dev: dev/friends3d.html?parts (bones in colour) · &held · &hop.
 */
(function () {
  'use strict';
  const T = THREE;
  const NB = 12;                                         // bones per friend (tools/rig.py NB)
  const G = 40;                                          // gravity in friend units / s² (a 1.3-unit plush ≈ 25 cm)
  const GLSL = `
    attribute vec2 rsk;
    uniform vec4 uRq[${NB}], uRo[${NB}], uRt[${NB}], uRm[${NB}];
    vec3 rigRot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
    vec4 rigQ() {
      int b = int(rsk.x + 0.5);
      if (b == 0) return vec4(0.0, 0.0, 0.0, 1.0);
      return normalize(mix(uRq[int(uRo[b].w + 0.5)], uRq[b], rsk.y / 255.0));
    }
    vec3 rigDeform(vec3 p) {
      int b = int(rsk.x + 0.5);
      if (b == 0) return p;
      float s = rsk.y / 255.0;
      return uRt[b].xyz + uRm[b].xyz * s + mix(uRm[b].w, uRt[b].w, s) * rigRot(rigQ(), p - uRo[b].xyz);
    }
    vec3 rigNormal(vec3 n) { return rigRot(rigQ(), n); }
    vec3 rigView(vec3 o) { vec4 q = rigQ(); return rigRot(vec4(-q.xyz, q.w), o); }`;

  /* per part type: f natural frequency (Hz) · z damping ratio · max swing (rad) · droop (share of gravity when it hangs
     unsupported: held by the claw) · lin / rot drag (it trails behind when moved / turned) · inward: how far an arm may
     swing into the body (rad) · gain: how much it answers its friend's motion */
  const TYPES = {
    head: { f: 3.4, z: 0.5, max: 0.12, droop: 0, lin: 0.5, rot: 2, gain: 0.35 },
    hat: { f: 4.2, z: 0.32, max: 0.16, droop: 0.05, lin: 1, rot: 4, gain: 0.5 },
    ear: { f: 2.9, z: 0.17, max: 0.7, droop: 0.25, lin: 2.5, rot: 10, gain: 1 },
    antenna: { f: 3.6, z: 0.08, max: 0.8, droop: 0.05, lin: 2, rot: 10, gain: 1.1 },
    arm: { f: 2.5, z: 0.2, max: 0.95, droop: 0.45, lin: 3, rot: 14, gain: 1, inward: 0.1 },
    wing: { f: 2.7, z: 0.2, max: 0.9, droop: 0.35, lin: 3, rot: 14, gain: 1, inward: 0.1 },
    leg: { f: 2.2, z: 0.26, max: 0.9, droop: 0.65, lin: 2.5, rot: 10, gain: 0.9, inward: 0.12, feet: true },
    tail: { f: 1.9, z: 0.14, max: 0.9, droop: 0.5, lin: 3, rot: 16, gain: 1 },
    fin: { f: 3, z: 0.2, max: 0.5, droop: 0.15, lin: 2.5, rot: 10, gain: 0.8 },
    fan: { f: 3, z: 0.3, max: 0.35, droop: 0.05, lin: 1.5, rot: 6, gain: 0.5 },
    lips: { f: 5, z: 0.4, max: 0.2, droop: 0, lin: 0.5, rot: 2, gain: 0.3 },
  };

  const bin = (b64) => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };

  function wrap(mat, main) {
    const ob = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) {
      ob.call(this, sh, r);
      let vs = sh.vertexShader.replace('vec3 plushDeform(vec3 p) {', GLSL + '\n    vec3 plushDeform(vec3 p) {\n      p = rigDeform(p);');
      if (main) {
        vs = vs.replace('normalMatrix * normal)', 'normalMatrix * rigNormal(normal))')
          .replace('vTurn = smoothstep(0.95, 0.8, vo.z);', 'vTurn = smoothstep(0.95, 0.8, rigView(vo).z);');
        if (Rig.debug) {                                  // dev: each bone in its own colour (grey body), darker = its share
          vs = vs.replace('void main() {', 'varying vec2 vRsk;\nvoid main() {\n  vRsk = rsk;');
          sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec2 vRsk;\nvoid main() {')
            .replace('#include <opaque_fragment>', `{
              float b = floor(vRsk.x + 0.5), s = vRsk.y / 255.0;
              vec3 c = b < 0.5 ? vec3(0.72) : 0.55 + 0.45 * cos(6.2832 * (b * 0.29 + vec3(0.0, 0.33, 0.67)));
              outgoingLight = mix(vec3(dot(outgoingLight, vec3(0.3, 0.5, 0.2))) * 0.35 + 0.45 * c * (0.55 + 0.45 * s), outgoingLight, 0.25);
            }
            #include <opaque_fragment>`);
        }
      }
      sh.vertexShader = vs;
    };
  }

  /* P (friends.js build) gets P.rig: update(dt, t), bump(k), bone(name), and pose inputs (poses.js): rot / move / scale
     per bone and kick(b, x, y, z). c = { geo, mat, depth, U, d (its friends-3d entry) } */
  function attach(P, c) {
    const d = c && c.d;
    if (!d || !d.bones || !d.sk || !c.geo || !c.geo.attributes.position) return false;
    if (!c.geo.attributes.rsk) {
      const sk = bin(d.sk);
      if (sk.length !== c.geo.attributes.position.count * 2) { console.warn('rig: skin size mismatch', P.kind); return false; }
      c.geo.setAttribute('rsk', new T.BufferAttribute(sk, 2));
    }
    const B = d.bones.slice(0, NB).map((b, i) => {
      const t = TYPES[b.t] || TYPES.arm;
      const o = new T.Vector3(b.o[0], b.o[1], b.o[2]), dir = new T.Vector3(b.d[0], b.d[1], b.d[2]).normalize();
      const L = Math.max(0.04, b.l || 0.1);
      // (longer limbs swing slower; big ears flop more slowly)
      const f = t.f * Math.min(1.25, Math.max(0.75, Math.sqrt(0.18 / L)));
      return { i, name: b.n, type: b.t, par: i ? b.p : -1, t, o, dir, L, w0: 2 * Math.PI * f,
        side: Math.abs(b.o[0]) > 0.02 ? Math.sign(b.o[0]) : 0,
        a: new T.Vector3(), av: new T.Vector3(), rot: new T.Vector3(), move: new T.Vector3(), scale: 1,
        q: new T.Quaternion(), ql: new T.Quaternion(), tp: new T.Vector3(), mv: new T.Vector3(), sw: 1,
        tq: new T.Vector3(), pav: new T.Vector3(), aw: new T.Vector3() };
    });
    const n = B.length;
    const uq = new Float32Array(NB * 4), uo = new Float32Array(NB * 4), ut = new Float32Array(NB * 4), um = new Float32Array(NB * 4);
    for (let i = 0; i < NB; i++) { uq[i * 4 + 3] = 1; ut[i * 4 + 3] = 1; um[i * 4 + 3] = 1; }
    for (const b of B) {                               // (at rest: every pivot where it is)
      uo[b.i * 4] = b.o.x; uo[b.i * 4 + 1] = b.o.y; uo[b.i * 4 + 2] = b.o.z; uo[b.i * 4 + 3] = Math.max(0, b.par);
      ut[b.i * 4] = b.o.x; ut[b.i * 4 + 1] = b.o.y; ut[b.i * 4 + 2] = b.o.z; b.tp.copy(b.o);
    }
    c.U.uRq = { value: uq }; c.U.uRo = { value: uo }; c.U.uRt = { value: ut }; c.U.uRm = { value: um };
    wrap(c.mat, true); wrap(c.depth, false);

    // scratch (no allocations per frame)
    const wp = new T.Vector3(), wq = new T.Quaternion(), ws = new T.Vector3(), wqi = new T.Quaternion();
    const p0 = new T.Vector3(), v0 = new T.Vector3(), vel = new T.Vector3(), acc = new T.Vector3(), q0 = new T.Quaternion();
    const om = new T.Vector3(), om0 = new T.Vector3(), al = new T.Vector3(), gM = new T.Vector3(), dq = new T.Quaternion();
    const dcur = new T.Vector3(), rc = new T.Vector3(), F = new T.Vector3(), tmp = new T.Vector3(), tmp2 = new T.Vector3();
    const qa = new T.Quaternion(), qb = new T.Quaternion(), qpi = new T.Quaternion(), ax = new T.Vector3();
    const st = { init: false, hold: 0 };
    const rotvecToQuat = (v, q) => { const th = v.length(); if (th < 1e-7) return q.set(0, 0, 0, 1); ax.copy(v).divideScalar(th); return q.setFromAxisAngle(ax, th); };

    const R = {
      bones: B,
      bone(name) { for (const b of B) if (b.name === name) return b.i; return -1; },
      byType(type) { return B.filter(b => b.type === type); },
      /* a sudden squash (k > 0: a landing) or stretch (k < 0: a grab): the limbs carry on and bounce back */
      bump(k) {
        for (const b of B) {
          if (!b.i || b.type === 'head' || b.type === 'lips') continue;
          // as if the body stopped falling at 1.1·k units/s: the limb's middle keeps going down
          dcur.copy(b.dir).applyQuaternion(b.q);
          tmp.set(0, -1.1 * k * b.t.gain, 0);
          tmp2.crossVectors(dcur, tmp).multiplyScalar(1.5 / b.L);
          b.av.add(tmp2);
        }
      },
      kick(i, x, y, z) { const b = B[i]; if (b) { b.av.x += x; b.av.y += y; b.av.z += z; } },
      reset() { for (const b of B) { b.a.set(0, 0, 0); b.av.set(0, 0, 0); } st.init = false; },
      update(dt) {
        if (!(dt > 0)) return;
        dt = Math.min(dt, 1 / 20);
        const pic = P.pic;
        pic.updateWorldMatrix(true, false);
        pic.matrixWorld.decompose(wp, wq, ws);
        const sc = ws.x || 1;
        if (!st.init || wp.distanceTo(p0) > 0.8 * sc) {
          p0.copy(wp); v0.set(0, 0, 0); q0.copy(wq); om0.set(0, 0, 0); st.init = true;
        }
        // the friend's motion, in its mesh's frame (friend units)
        vel.copy(wp).sub(p0).divideScalar(dt);
        acc.copy(vel).sub(v0).divideScalar(dt);
        p0.copy(wp); v0.copy(vel);
        wqi.copy(wq).invert();
        acc.applyQuaternion(wqi).divideScalar(sc);
        if (acc.length() > 300) acc.setLength(300);
        vel.applyQuaternion(wqi).divideScalar(sc);
        dq.copy(wq).multiply(qa.copy(q0).invert());
        if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
        const sa = Math.sqrt(dq.x * dq.x + dq.y * dq.y + dq.z * dq.z), ang = 2 * Math.atan2(sa, dq.w);
        if (sa > 1e-9) om.set(dq.x, dq.y, dq.z).multiplyScalar(ang / sa / dt); else om.set(0, 0, 0);
        om.applyQuaternion(wqi);
        if (om.length() > 30) om.setLength(30);
        al.copy(om).sub(om0).divideScalar(dt);
        if (al.length() > 400) al.setLength(400);
        q0.copy(wq); om0.copy(om);
        gM.set(0, -G, 0).applyQuaternion(wqi);
        const hk = P.st ? P.st.hk : 0, sit = 1 - hk;
        const nsub = Math.max(1, Math.ceil(dt * 120)), h = dt / nsub;
        for (const b of B) {
          if (!b.i) continue;
          const t = b.t, par = B[b.par] || B[0];
          // where the limb's middle is now and which way it points (mesh frame)
          dcur.copy(b.dir).applyQuaternion(b.q);
          rc.copy(b.tp).add(b.mv).addScaledVector(dcur, b.L * 0.5);
          // the force on it per unit mass: the change of gravity from sitting upright, gravity pulling an unsupported
          // limb (held by the claw), its own frame's acceleration (incl. turning: centrifugal) and air drag
          F.set(gM.x, gM.y + G, gM.z);
          F.addScaledVector(gM, t.droop * hk);
          tmp.crossVectors(al, rc); F.sub(tmp);
          tmp.crossVectors(om, rc); tmp2.crossVectors(om, tmp); F.sub(tmp2);
          F.addScaledVector(tmp, -t.rot);
          F.sub(acc);
          F.addScaledVector(vel, -t.lin);
          if (t.feet) F.y *= 0.25 + 0.75 * hk;              // (sitting, the feet rest on the floor)
          if (t.type === 'head') F.multiplyScalar(1 - 0.85 * hk);
          b.tq.crossVectors(dcur, F).multiplyScalar(1.5 * t.gain / b.L);
          if (par.i) b.tq.applyQuaternion(qpi.copy(par.q).invert());
          // a parent's swing jolts its children (ears on the head, antennae on the hat)
          if (par.i) b.tq.addScaledVector(par.aw, -0.7);
        }
        const k2 = (b) => b.w0 * b.w0, c2 = (b) => 2 * b.t.z * b.w0;
        for (let s = 0; s < nsub; s++) {
          for (const b of B) {
            if (!b.i) continue;
            const k = k2(b), cc = c2(b);
            b.av.x += h * (b.tq.x - k * b.a.x - cc * b.av.x);
            b.av.y += h * (b.tq.y - k * b.a.y - cc * b.av.y);
            b.av.z += h * (b.tq.z - k * b.a.z - cc * b.av.z);
            b.a.addScaledVector(b.av, h);
          }
        }
        for (const b of B) {
          if (!b.i) continue;
          const t = b.t;
          // an arm / leg / wing doesn't swing into the body (in the picture's plane)
          if (t.inward != null && b.side) {
            const inz = -b.a.z * b.side;                    // (+z turns a downward limb toward +x)
            if (inz > t.inward) { b.a.z = -b.side * t.inward; if (-b.av.z * b.side > 0) b.av.z = 0; }
          }
          const m = b.a.length();
          if (m > t.max) { b.a.multiplyScalar(t.max / m); b.av.multiplyScalar(0.5); }
          b.aw.copy(b.av).sub(b.pav).divideScalar(dt); b.pav.copy(b.av);
          if (b.aw.length() > 200) b.aw.setLength(200);
        }
        // forward kinematics: pose turn · spring turn, parents first → the shader's uniforms
        for (const b of B) {
          if (!b.i) continue;
          const p = B[b.par] || B[0];
          rotvecToQuat(b.rot, qa); rotvecToQuat(b.a, qb);
          b.ql.multiplyQuaternions(qa, qb);
          b.q.multiplyQuaternions(p.i ? p.q : qa.set(0, 0, 0, 1), b.ql);
          const pq = p.i ? p.q : qa.set(0, 0, 0, 1);
          if (pq.x * b.q.x + pq.y * b.q.y + pq.z * b.q.z + pq.w * b.q.w < 0) { b.q.x = -b.q.x; b.q.y = -b.q.y; b.q.z = -b.q.z; b.q.w = -b.q.w; }
          b.sw = (p.i ? p.sw : 1) * b.scale;
          tmp.copy(b.o).sub(p.o).applyQuaternion(pq).multiplyScalar(p.i ? p.sw : 1);
          b.tp.copy(p.i ? p.tp : p.o).add(p.i ? p.mv : tmp2.set(0, 0, 0)).add(tmp);
          b.mv.copy(b.move);
          const j = b.i * 4;
          uq[j] = b.q.x; uq[j + 1] = b.q.y; uq[j + 2] = b.q.z; uq[j + 3] = b.q.w;
          ut[j] = b.tp.x; ut[j + 1] = b.tp.y; ut[j + 2] = b.tp.z; ut[j + 3] = b.sw;
          um[j] = b.mv.x; um[j + 1] = b.mv.y; um[j + 2] = b.mv.z; um[j + 3] = p.i ? p.sw : 1;
        }
      },
    };
    B[0].q.set(0, 0, 0, 1); B[0].tp.set(0, 0, 0);
    P.rig = R;
    return true;
  }

  window.Rig = { attach, TYPES, NB, debug: false };
})();
