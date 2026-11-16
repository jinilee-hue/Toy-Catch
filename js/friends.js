/* Toy Catch — the friends in the machine: the user's plush pictures (js/friends-art.js) as cut-outs that always
 * turn to face the camera. Same interface the game used with the old procedural plushies:
 *   root (origin at the bottom middle, under the head), kind, word, sound ('cat' → c), icon (the picture),
 *   top, gripY / headR (the head the claw closes round, at scale 1), alphaAt(uv) (taps on see-through bits miss),
 *   cheer(sec), nope(sec), hold(on), lookAt(worldPoint | null), excite(0..1), update(dt, t),
 *   tilt (radians, set by the game: a loose grip tips the body round the head before it slips out).
 * Rig: root > hang (pivot at the head: the body swings under the claw) > seat (pivot at the bottom: sitting wobble,
 * hops) > face (turns to the camera) > picture (a little behind the claw's axis, so the prongs stay in front of it).
 * A 600-px-tall picture is 1.3 units tall; the game scales friends by 1.3 in the machine.
 */
(function () {
  'use strict';
  const T = THREE, ART = window.CLAW_FRIENDS || {};
  const PX = 1.3 / 600;
  const BACK = 0.07;                                    // picture plane behind the root (claw) axis
  const KINDS = Object.keys(ART);
  const imgs = {}, alpha = {};
  const AW = 64;                                         // alpha grid for taps: 64 px wide
  const tmp = new T.Vector3(), tmpQ = new T.Quaternion(), tmpE = new T.Euler(0, 0, 0, 'YXZ');
  const ease = (cur, to, k) => cur + (to - cur) * k;

  function load() {
    return Promise.all(KINDS.map(k => new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        imgs[k] = im;
        const h = Math.round(AW * im.height / im.width), c = document.createElement('canvas');
        c.width = AW; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, AW, h);
        const d = g.getImageData(0, 0, AW, h).data, a = new Uint8Array(AW * h);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
        alpha[k] = { a, w: AW, h };
        res();
      };
      im.onerror = () => { console.warn('friend picture failed:', k); res(); };
      im.src = ART[k].src;
    })));
  }

  let blobTex = null;
  function blob() {
    if (!blobTex) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, 'rgba(40,30,60,0.55)'); gr.addColorStop(0.55, 'rgba(40,30,60,0.22)'); gr.addColorStop(1, 'rgba(40,30,60,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      blobTex = new T.CanvasTexture(c); blobTex.colorSpace = T.SRGBColorSpace;
    }
    return new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 1 });
  }

  function build(kind) {
    const a = ART[kind], im = imgs[kind];
    const w = a.w * PX, h = a.h * PX;
    const [u, v, rx, ry] = a.head;
    const gy = (1 - v) * h;                              // head centre above the bottom
    const P = { kind, word: kind, sound: kind[0], icon: a.src };
    P.root = new T.Group(); P.root.name = kind;
    P.hang = new T.Group(); P.hang.position.y = gy; P.root.add(P.hang);
    P.seat = new T.Group(); P.seat.position.y = -gy; P.hang.add(P.seat);
    P.face = new T.Group(); P.seat.add(P.face);
    const tex = new T.Texture(im);
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
    const geo = new T.PlaneGeometry(w, h);
    geo.translate((0.5 - u) * w, h / 2, -BACK);         // the head's middle over the root
    const mat = new T.MeshBasicMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, toneMapped: false });
    const pic = new T.Mesh(geo, mat);
    pic.castShadow = true;
    pic.customDepthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: tex, alphaTest: 0.5 });
    P.face.add(pic); P.pic = pic;
    Object.defineProperty(pic.userData, 'plush', { value: P, enumerable: false, configurable: true });
    // soft contact shadow on the shelf / balls (fades while it's held)
    const sh = new T.Mesh(new T.PlaneGeometry(1, 1), blob());
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.015; sh.scale.set(w * 0.95, Math.min(0.75, w * 0.6), 1);
    sh.renderOrder = 2; sh.raycast = () => {};
    P.root.add(sh); P.blob = sh;

    P.top = h; P.width = w;
    P.gripY = gy;
    P.headR = [rx * w, ry * h, rx * w * 0.8];
    P.gripR = rx * w;
    P.alphaAt = (uv) => {
      const g = alpha[kind]; if (!g || !uv) return 255;
      const x = Math.min(g.w - 1, Math.max(0, Math.floor(uv.x * g.w))), y = Math.min(g.h - 1, Math.max(0, Math.floor((1 - uv.y) * g.h)));
      return g.a[y * g.w + x];
    };
    P.phase = Math.random() * 10;
    P.st = { excite: 0, ek: 0, cheer: 0, ck: 0, held: 0, hk: 0, nope: 0, look: null, lean: 0 };
    P.tilt = 0;
    P.excite = (val) => { P.st.excite = val; };
    P.cheer = (sec = 1.6) => { P.st.cheer = sec; };
    P.hold = (on) => { P.st.held = on ? 1 : 0; };
    P.nope = (sec = 1.0) => { P.st.nope = sec; };
    P.lookAt = (p) => { P.st.look = p ? p.clone() : null; };
    P.update = function (dt, t) {
      const s = P.st, ph = P.phase;
      s.ek = ease(s.ek, s.excite, Math.min(1, dt * 6));
      s.cheer = Math.max(0, s.cheer - dt); s.ck = ease(s.ck, s.cheer > 0 ? 1 : 0, Math.min(1, dt * 7));
      s.hk = ease(s.hk, s.held, Math.min(1, dt * 5));
      s.nope = Math.max(0, s.nope - dt);
      const sit = 1 - s.hk;
      // sitting: breathing, a slow sway; under the claw: little hops and a lean up toward it; cheering: big hops
      const br = Math.sin(t * 2.3 + ph);
      P.seat.scale.set(1 - 0.012 * br * sit, (1 + 0.02 * br + 0.03 * s.ek) * sit + s.hk, 1);
      const hop = Math.abs(Math.sin(t * 8.5 + ph)) * 0.05 * s.ek + Math.abs(Math.sin(t * 7 + ph * 0.3)) * 0.17 * s.ck;
      P.seat.position.y = -gy + hop * sit;
      let lean = 0;
      if (s.look) { P.root.getWorldPosition(tmp); lean = Math.max(-0.13, Math.min(0.13, -(s.look.x - tmp.x) * 0.1)); }
      s.lean = ease(s.lean, lean, Math.min(1, dt * 4));
      P.seat.rotation.z = (Math.sin(t * 1.1 + ph) * 0.03 + Math.sin(t * 9 + ph) * 0.09 * s.ck + s.lean) * sit;
      // held: the body swings under the head; "no-no" wiggle when it's the wrong friend
      const shake = s.nope > 0 ? Math.sin(s.nope * 24) * 0.17 * Math.min(1, s.nope * 2) : 0;
      P.hang.rotation.z = Math.sin(t * 2.6 + ph) * 0.07 * s.hk + shake + P.tilt;
      P.blob.material.opacity = Math.max(0, 1 - s.hk * 1.6);
      P.blob.visible = P.blob.material.opacity > 0.01;
      // always face the camera (turn about the vertical; whatever the parents' yaw)
      const cam = window.Stage && Stage.camera;
      if (cam) {
        P.face.getWorldPosition(tmp);
        const want = Math.atan2(cam.position.x - tmp.x, cam.position.z - tmp.z);
        P.seat.getWorldQuaternion(tmpQ); tmpE.setFromQuaternion(tmpQ, 'YXZ');
        P.face.rotation.y = want - tmpE.y;
      }
    };
    return P;
  }

  window.Friends = { KINDS, load, build };
})();
