/* Toy Catch — three.js stage: renderer, lights, camera framing (the machine where the mockup has it),
 * tweens driven by the frame loop (so tests can step them), screen projection, picking and plush snapshots.
 * The carnival background is CSS behind a transparent canvas; fitBg() lines it up with the machine.
 */
(function () {
  'use strict';
  const T = THREE;
  const S = { renderer: null, scene: null, camera: null, canvas: null, onTick: [], tweens: [], time: 0, fps: 0, ray: new T.Raycaster(), frame: { top: 0.125, span: 0.76, el: 6, push: 0 } };
  const V = (x, y, z) => new T.Vector3(x, y, z);

  S.init = function (canvas, o = {}) {
    S.canvas = canvas;
    const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!o.preserve });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.maxDpr || 2));
    r.outputColorSpace = T.SRGBColorSpace;
    r.toneMapping = T.NeutralToneMapping;
    r.toneMappingExposure = 1.02;
    r.shadowMap.enabled = true;
    r.shadowMap.type = T.VSMShadowMap;
    r.setClearColor(0x000000, 0);
    S.renderer = r;
    const scene = new T.Scene();
    const pm = new T.PMREMGenerator(r);
    scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    S.scene = scene;
    scene.add(new T.HemisphereLight('#ffffff', '#f1d9e4', 1.05));
    const key = new T.DirectionalLight('#fff3e3', 1.75);
    key.position.set(-4.5, 10, 9);
    key.target.position.set(0, 1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -4, near: 2, far: 30 });
    key.shadow.radius = 5; key.shadow.blurSamples = 12; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const fill = new T.DirectionalLight('#e6f0ff', 0.55); fill.position.set(6, 4, 7); scene.add(fill);
    const rim = new T.DirectionalLight('#ffffff', 0.5); rim.position.set(1, 6, -8); scene.add(rim);
    const inside = new T.PointLight('#fff4e0', 6, 9, 1.6); inside.position.set(0, 3.9, 0.4); scene.add(inside);
    S.lights = { key, fill, rim, inside };
    S.camera = new T.PerspectiveCamera(30, 1, 0.1, 200);
    window.addEventListener('resize', () => S.resize());
    return S;
  };

  /* frame the machine: its marquee top at `top` (fraction from the screen top), marquee top → glass floor = `span`
     of the height; never wider than 95 % of the screen. `push` (0…1) dollies in a little (the game view). */
  S.target = V(0, 2.45, 0);
  S.resize = function () {
    const c = S.canvas, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
    S.renderer.setSize(w, h, false);
    const cam = S.camera, f = S.frame, M = S.machine;
    cam.aspect = w / h;
    const el = f.el * Math.PI / 180;
    const top = V(0, M.H + 1.02, M.D / 2 + 0.1), bot = V(0, 0, M.D / 2 + 0.2);
    const wide = [V(-(M.W / 2 + 0.55), M.H / 2, M.D / 2 + 0.2), V(M.W / 2 + 0.55, M.H / 2, M.D / 2 + 0.2)];
    let d = 14;
    for (let i = 0; i < 6; i++) {
      cam.position.set(S.target.x, S.target.y + Math.sin(el) * d, S.target.z + Math.cos(el) * d);
      cam.lookAt(S.target); cam.clearViewOffset(); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      const a = top.clone().project(cam), b = bot.clone().project(cam);
      const span = (a.y - b.y) / 2;                               // fraction of the height
      const wl = wide[0].clone().project(cam), wr = wide[1].clone().project(cam);
      const wspan = (wr.x - wl.x) / 2;
      const want = f.span * (1 + 0.04 * f.push);          // (game view: a little less zoom, so the DOWN button fits)
      const kH = span / want, kW = wspan / 0.95;
      d *= Math.max(kH, kW);
    }
    cam.position.set(S.target.x, S.target.y + Math.sin(el) * d, S.target.z + Math.cos(el) * d);
    cam.lookAt(S.target); cam.updateMatrixWorld();
    const a = top.clone().project(cam);
    const yTop = (1 - a.y) / 2;                                  // where the marquee top lands now
    cam.setViewOffset(w, h, 0, (yTop - f.top * (1 - 0.22 * f.push)) * h, w, h);
    cam.updateProjectionMatrix();
    S.dist = d;
    if (S.onResize) S.onResize(w, h);
  };

  S.project = function (v) {
    const p = v.clone().project(S.camera), c = S.canvas;
    return { x: (p.x + 1) / 2 * c.clientWidth, y: (1 - p.y) / 2 * c.clientHeight, z: p.z };
  };
  /* client point → ray hits among objects */
  S.hits = function (x, y, objs) {
    const r = S.canvas.getBoundingClientRect();
    S.ray.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, S.camera);
    return S.ray.intersectObjects(objs, true);
  };
  /* client point → the point on a horizontal/vertical plane */
  S.onPlane = function (x, y, plane) {
    const r = S.canvas.getBoundingClientRect();
    S.ray.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, S.camera);
    const out = V(0, 0, 0);
    return S.ray.ray.intersectPlane(plane, out) ? out : null;
  };

  /* tweens on the frame clock: S.tween(ms, k => …, ease) → Promise */
  const EASE = {
    linear: k => k,
    out: k => 1 - Math.pow(1 - k, 3),
    in: k => k * k * k,
    inOut: k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
    sine: k => 0.5 - Math.cos(Math.PI * k) / 2,
    back: k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
    bounce: k => { const n = 7.5625, d = 2.75; if (k < 1 / d) return n * k * k; if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75; if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375; return n * (k -= 2.625 / d) * k + 0.984375; },
  };
  S.EASE = EASE;
  S.tween = function (ms, fn, ease = 'inOut', tok) {
    return new Promise(res => {
      const tw = { t: 0, ms: Math.max(1, ms), fn, ease: typeof ease === 'function' ? ease : EASE[ease] || EASE.linear, res, tok };
      S.tweens.push(tw);
      fn(0);
    });
  };
  S.wait = (ms) => S.tween(ms, () => {}, 'linear');
  S.killTweens = function (tok) { S.tweens = S.tweens.filter(tw => { if (tok == null || tw.tok === tok) { tw.res(false); return false; } return true; }); };

  function step(dt) {
    S.time += dt;
    const list = S.tweens.slice();
    for (const tw of list) {
      tw.t += dt * 1000;
      const k = Math.min(1, tw.t / tw.ms);
      tw.fn(tw.ease(k));
      if (k >= 1) { const i = S.tweens.indexOf(tw); if (i >= 0) S.tweens.splice(i, 1); tw.res(true); }
    }
    for (const fn of S.onTick) fn(dt, S.time);
  }
  let last = 0, acc = 0, frames = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (S.frozen) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    acc += dt; frames++;
    if (acc > 1) { S.fps = Math.round(frames / acc); acc = 0; frames = 0; }
    step(dt);
    S.renderer.render(S.scene, S.camera);
  }
  S.start = () => requestAnimationFrame(loop);
  /* deterministic stepping for tests */
  S.step = function (dt, n = 1) { for (let i = 0; i < n; i++) step(dt); S.renderer.render(S.scene, S.camera); };

  /* a transparent picture of a plush (for the HUD tray and the result card) */
  let snapR = null;
  S.snapshot = function (obj, size = 256) {
    if (!snapR) {
      snapR = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      snapR.setPixelRatio(1); snapR.outputColorSpace = T.SRGBColorSpace; snapR.toneMapping = T.NeutralToneMapping; snapR.setClearColor(0, 0);
    }
    const r = snapR;
    r.setSize(size, size, false);
    const sc = new T.Scene();
    sc.environment = S.scene.environment; sc.environmentIntensity = 0.5;
    sc.add(new T.HemisphereLight('#ffffff', '#f1d9e4', 1.15));
    const k = new T.DirectionalLight('#fff3e3', 1.7); k.position.set(-3, 6, 8); sc.add(k);
    const f = new T.DirectionalLight('#e6f0ff', 0.5); f.position.set(5, 3, 6); sc.add(f);
    const clone = obj.clone(true);
    clone.position.set(0, 0, 0); clone.rotation.set(0, 0, 0);
    sc.add(clone);
    const box = new T.Box3().setFromObject(clone), c = box.getCenter(V(0, 0, 0)), sz = box.getSize(V(0, 0, 0));
    const cam = new T.PerspectiveCamera(26, 1, 0.1, 50);
    const dd = Math.max(sz.x, sz.y) / 2 / Math.tan(13 * Math.PI / 180) * 1.08;
    cam.position.set(c.x, c.y + dd * 0.12, c.z + dd); cam.lookAt(c);
    r.render(sc, cam);
    const url = r.domElement.toDataURL('image/png');
    return url;
  };
  S.snapshotDone = () => { if (snapR) { snapR.dispose(); snapR.forceContextLoss(); snapR = null; } };

  window.Stage = S;
})();
