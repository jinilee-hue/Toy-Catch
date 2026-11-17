/* Toy Catch — the machine: light-blue cabinet with a glass case, red marquee with chasing bulbs, ball pit,
 * a two-colour shelf for the back row, the chute in the front-left corner, the claw (gantry, trolley, coiled cord,
 * three chrome prongs) and the control panel (screen, joystick, buttons, coin slot) — after the user's mockups.
 * Units: the glass case is W × H × D; its floor is y 0, its middle x 0 z 0; the player stands toward +z.
 */
(function () {
  'use strict';
  const T = THREE, M = Mats;
  const W = 7.0, D = 3.4, H = 4.3;
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const rb = {};
  const rbox = (w, h, d, r) => { const k = [w, h, d, r].join('_'); return rb[k] || (rb[k] = new T.RoundedBoxGeometry(w, h, d, 4, r)); };
  const SPH = new T.SphereGeometry(1, 32, 20);
  const SPH_HI = new T.SphereGeometry(1, 64, 40);           // (the buttons' caps and the joystick knob: smooth outlines)
  function mesh(geo, mat, parent, pos, o = {}) {
    const m = new T.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
    if (o.scale != null) { if (typeof o.scale === 'number') m.scale.setScalar(o.scale); else m.scale.set(...o.scale); }
    m.castShadow = o.cast ?? true; m.receiveShadow = o.recv ?? true;
    if (parent) parent.add(m);
    return m;
  }
  const grp = (parent, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); parent && parent.add(g); return g; };

  function backTex() {
    return M.tex(1024, 640, (g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#a9dcfb'); sky.addColorStop(0.62, '#dff3ff'); sky.addColorStop(1, '#fbe9f1');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.filter = 'blur(18px)';
      for (const [x, y, r, c] of [[0.12, 0.22, 90, 'rgba(255,255,255,0.85)'], [0.24, 0.2, 70, 'rgba(255,255,255,0.8)'], [0.7, 0.16, 110, 'rgba(255,255,255,0.85)'], [0.84, 0.24, 80, 'rgba(255,255,255,0.75)'],
        [0.08, 0.86, 120, 'rgba(126,200,120,0.55)'], [0.3, 0.9, 140, 'rgba(255,176,120,0.45)'], [0.55, 0.88, 130, 'rgba(120,190,255,0.4)'], [0.82, 0.9, 150, 'rgba(255,140,180,0.45)']]) {
        g.fillStyle = c; g.beginPath(); g.arc(x * w, y * h, r, 0, Math.PI * 2); g.fill();
      }
      g.filter = 'blur(6px)';
      const cols = ['#ffd84a', '#ff8fb8', '#8fe0ff', '#b6f28b', '#ffffff'];
      for (let i = 0; i < 26; i++) {
        g.fillStyle = cols[i % 5]; g.globalAlpha = 0.5;
        g.beginPath(); g.arc((i * 97 % 1000) / 1000 * w, h * (0.42 + ((i * 53) % 30) / 100), 6 + (i % 4) * 4, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1; g.filter = 'none';
    });
  }
  function screenCanvas() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 224;
    return c;
  }
  function drawScreen(c, lines, accent) {
    const g = c.getContext('2d'), w = c.width, h = c.height;
    g.fillStyle = '#101a3a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,140,255,0.18)'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = accent || '#5ff2ff'; g.shadowBlur = 18; g.fillStyle = '#d6fbff';
    const n = lines.length;
    lines.forEach((ln, i) => { g.font = `800 ${n > 1 ? 66 : 84}px ${M.FONT}`; g.fillText(ln, w / 2, h / 2 + (i - (n - 1) / 2) * 74); });
    g.shadowBlur = 0;
    g.strokeStyle = accent || '#ff6fd8'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
  }
  function coinTex() {
    return M.tex(256, 256, (g, w, h) => {
      const r = g.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, w / 2);
      r.addColorStop(0, '#fff3a6'); r.addColorStop(0.55, '#ffcf3a'); r.addColorStop(1, '#e09a10');
      g.fillStyle = r; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#c98408'; g.lineWidth = 12; g.beginPath(); g.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffe680'; g.strokeStyle = '#c98408'; g.lineWidth = 6; g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? w * 0.13 : w * 0.3; g.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr); }
      g.closePath(); g.fill(); g.stroke();
    });
  }

  function build() {
    const group = new T.Group();
    const blue = M.plastic('#8fd2f3', { rough: 0.38, clear: 0.55 });
    const blueDeep = M.plastic('#66b9e6', { rough: 0.38, clear: 0.55 });
    const red = M.plastic('#f45d55', { rough: 0.32, clear: 0.7 });
    const white = M.plastic('#ffffff', { rough: 0.4, clear: 0.5 });
    const lav = M.plastic('#d4b4f2', { rough: 0.35, clear: 0.6 });

    // cabinet under the prize floor, posts, rails round the glass, the band and roof on top
    mesh(rbox(W + 0.72, 2.4, D + 0.72, 0.2), blue, group, [0, -1.2, 0]);
    mesh(rbox(W + 0.5, 0.06, D + 0.5, 0.02), M.plastic('#f2e9ff', { rough: 0.7, clear: 0 }), group, [0, -0.02, 0], { cast: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(rbox(0.34, H + 0.3, 0.34, 0.12), blue, group, [sx * (W / 2 + 0.17), H / 2, sz * (D / 2 + 0.17)], { cast: false });
    mesh(rbox(W + 0.62, 0.26, 0.32, 0.1), blue, group, [0, 0.06, D / 2 + 0.17]);
    for (const sx of [-1, 1]) mesh(rbox(0.32, 0.26, D + 0.4, 0.1), blue, group, [sx * (W / 2 + 0.17), 0.06, 0]);
    mesh(rbox(W + 0.74, 0.5, D + 0.74, 0.16), blue, group, [0, H + 0.2, 0], { cast: false });
    mesh(rbox(W + 0.4, 0.14, D + 0.3, 0.06), blueDeep, group, [0, H + 0.5, -0.12], { cast: false });
    // the marquee: a red band over the front with bulbs (two sets chase each other)
    const marq = grp(group, 0, H + 0.66, D / 2 + 0.1);
    mesh(rbox(W + 0.95, 0.7, 0.78, 0.24), red, marq, [0, 0, 0], { cast: false });
    mesh(rbox(W + 0.75, 0.14, 0.82, 0.07), M.plastic('#ff8a80', { rough: 0.3, clear: 0.8 }), marq, [0, 0.3, 0], { cast: false });
    const bulbCols = ['#ffd43b', '#7fe6ff', '#ffffff', '#ff9ecb', '#a6f28b'];
    const bulbs = [];
    const nB = 15;
    for (let i = 0; i < nB; i++) {
      const c = bulbCols[i % bulbCols.length];
      const m = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.25 });
      const b = mesh(SPH, m, marq, [-W / 2 - 0.1 + i * (W + 0.2) / (nB - 1), 0.02, 0.41], { scale: [0.13, 0.13, 0.08], cast: false });
      bulbs.push(b);
    }
    // inside: back wall (soft blurred carnival), ceiling light box, glass panes with glints
    const back = mesh(new T.PlaneGeometry(W, H), new T.MeshStandardMaterial({ map: backTex(), roughness: 0.95 }), group, [0, H / 2, -D / 2], { cast: false });
    const ceil = mesh(new T.PlaneGeometry(W, D), M.plastic('#f6f0ff', { rough: 0.8, clear: 0 }), group, [0, H, 0], { rot: [Math.PI / 2, 0, 0], cast: false });
    mesh(rbox(W * 0.7, 0.04, 0.5, 0.02), new T.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff8e8', emissiveIntensity: 0.9 }), group, [0, H - 0.03, -0.2], { cast: false });
    const glassF = mesh(new T.PlaneGeometry(W, H - 0.2), M.glass(0.07), group, [0, H / 2 + 0.1, D / 2 + 0.02], { cast: false, recv: false });
    glassF.renderOrder = 10; glassF.userData.glass = true;
    for (const sx of [-1, 1]) {
      const sg = mesh(new T.PlaneGeometry(D, H), M.glass(0.12), group, [sx * W / 2, H / 2, 0], { rot: [0, Math.PI / 2, 0], cast: false, recv: false });
      sg.renderOrder = 9; sg.userData.glass = true;
    }
    const glintM = new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false });
    for (const [x, w, o] of [[-2.2, 0.36, 0.2], [-1.75, 0.12, 0.16], [2.6, 0.28, 0.14]]) {
      const gl = mesh(new T.PlaneGeometry(w, H * 1.1), glintM.clone(), group, [x, H / 2 + 0.1, D / 2 + 0.03], { rot: [0, 0, -0.42], cast: false, recv: false });
      gl.material.opacity = o; gl.renderOrder = 11; gl.userData.glass = true;
    }

    // the back row's shelf (pink / teal blocks, like the mockup) and the floor under the balls
    const SHELF_Y = 0.95, SHELF_Z0 = -D / 2, SHELF_Z1 = -0.42;
    ['#f7a9bd', '#76d4c9', '#f7a9bd', '#76d4c9'].forEach((c, i) => {
      mesh(rbox(W / 4 - 0.02, SHELF_Y, SHELF_Z1 - SHELF_Z0, 0.08), M.plastic(c, { rough: 0.55, clear: 0.3 }), group, [-W / 2 + W / 8 + i * W / 4, SHELF_Y / 2, (SHELF_Z0 + SHELF_Z1) / 2]);
    });
    mesh(new T.PlaneGeometry(W, D), M.plastic('#e9dcff', { rough: 0.8, clear: 0 }), group, [0, 0.005, 0], { rot: [-Math.PI / 2, 0, 0], cast: false });

    // the chute: front-left corner, two low acrylic walls with a yellow rim, a dark hole
    const CH = { x0: -W / 2, x1: -W / 2 + 1.3, z0: D / 2 - 1.4, z1: D / 2, h: 0.95 };
    const chute = { x: (CH.x0 + CH.x1) / 2, z: (CH.z0 + CH.z1) / 2 + 0.05, floor: -0.9, box: CH };
    mesh(new T.PlaneGeometry(CH.x1 - CH.x0, CH.z1 - CH.z0), new T.MeshStandardMaterial({ color: '#3a2f62', roughness: 0.9 }), group, [chute.x, 0.012, (CH.z0 + CH.z1) / 2], { rot: [-Math.PI / 2, 0, 0], cast: false });
    const acr = new T.MeshPhysicalMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.28, roughness: 0.1, clearcoat: 1, depthWrite: false, side: T.DoubleSide });
    const wR = mesh(new T.PlaneGeometry(CH.z1 - CH.z0, CH.h), acr, group, [CH.x1, CH.h / 2, (CH.z0 + CH.z1) / 2], { rot: [0, Math.PI / 2, 0], cast: false, recv: false }); wR.renderOrder = 8;
    const wB = mesh(new T.PlaneGeometry(CH.x1 - CH.x0, CH.h), acr, group, [chute.x, CH.h / 2, CH.z0], { cast: false, recv: false }); wB.renderOrder = 8;
    const rim = M.plastic('#ffd23f', { rough: 0.3, clear: 0.8 });
    mesh(rbox(0.09, 0.09, CH.z1 - CH.z0 + 0.04, 0.04), rim, group, [CH.x1, CH.h, (CH.z0 + CH.z1) / 2]);
    mesh(rbox(CH.x1 - CH.x0 + 0.04, 0.09, 0.09, 0.04), rim, group, [chute.x, CH.h, CH.z0]);

    // ball pit: glossy candy balls (one instanced mesh) — more saturated than the first pastels (user: "공들도 컬러를 좀더
    // 채도가 높게")
    const ballCols = ['#ff86b6', '#ffd645', '#4fdaa9', '#57b5f7', '#ab8af7', '#ffa65c', '#ff6b6b'];
    const spots = [];
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const R = 0.155;
    for (let layer = 0; layer < 2; layer++) {
      for (let z = SHELF_Z1 + 0.1; z < D / 2 - 0.1; z += R * 1.75) for (let x = -W / 2 + 0.14; x < W / 2 - 0.12; x += R * 1.8) {
        const px = x + (layer ? R * 0.9 : 0) + (rnd() - 0.5) * 0.08, pz = z + (layer ? R * 0.85 : 0) + (rnd() - 0.5) * 0.08;
        if (px < CH.x1 + 0.12 && pz > CH.z0 - 0.12) continue;
        if (layer === 1 && rnd() < 0.18) continue;
        spots.push([px, R * (1 + layer * 1.45) + (rnd() - 0.5) * 0.04, pz, Math.floor(rnd() * ballCols.length)]);
      }
    }
    for (let i = 0; i < 26; i++) {                       // a few on the shelf, along its front edge
      const px = -W / 2 + 0.3 + i * (W - 0.6) / 25;
      spots.push([px, SHELF_Y + R * 0.8, SHELF_Z1 - 0.12 - rnd() * 0.12, Math.floor(rnd() * ballCols.length)]);
    }
    /* 44 × 30 segments: with 22 × 16 the outlines were polygons and where two balls overlap the seam zig-zagged (user:
       "테두리가 우글거려"). They move with what happens in the pit (user: "인형들의 움직임에 따라 공이 자연스럽게"):
       splash(x, z, s) — the balls round a point hop up in a ring that runs outward and settles (the claw diving in, a
       friend lifted out or landing back); friends(list, t) — the balls round each friend sitting in the pit pop up a
       little every time it lands from a hop (the excited hops under the claw, the cheering), the ones further out a
       moment later. Done in the vertex shader (the instances never move on the CPU), the same in the shadow pass. */
    const V4 = (n) => Array.from({ length: n }, () => new T.Vector4(0, 0, 0, 0));
    const ballU = { uTime: { value: 0 }, uFT: { value: 0 }, uImp: { value: [0, 1, 2, 3].map(() => new T.Vector4(0, 0, -99, 0)) }, uFr: { value: V4(6) }, uFrP: { value: V4(6) } };
    const BALL_GLSL = `
      uniform float uTime, uFT; uniform vec4 uImp[4], uFr[6], uFrP[6];
      vec3 ballMove(vec3 p) {
        vec2 c = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float h = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
        float lift = 0.0; vec2 push = vec2(0.0);
        for (int i = 0; i < 4; i++) {
          vec4 q = uImp[i]; float age = uTime - q.z;
          if (age < 0.0 || age > 2.4 || q.w <= 0.0) continue;
          vec2 dv = c - q.xy; float d = length(dv);
          float a = age - d / 2.8 - h * 0.05;            // the ring reaches this ball at d / 2.8 s
          float hop = a > 0.0 && a < 0.42 ? sin(a / 0.42 * 3.14159) : 0.0;
          float s = q.w * exp(-d * 1.35) * exp(-age * 0.9) * hop * (0.75 + 0.5 * h);
          lift += s * 0.2; push += (d > 0.001 ? dv / d : vec2(0.0)) * s * 0.05;
        }
        // friends' hops: every landing (friends.js: hops are |sin(t * 8.5 + ph)| excited, |sin(t * 7 + ph * 0.3)| cheering)
        // pops the balls round it up for a short hop, the ones further out a moment later
        for (int i = 0; i < 6; i++) {
          vec4 f = uFr[i]; vec4 fp = uFrP[i];
          if (f.z + f.w < 0.01) continue;
          vec2 dv = c - f.xy; float d = length(dv);
          float rim = max(0.0, d - fp.y);
          float fall = exp(-rim * 4.2) * smoothstep(0.0, fp.y * 0.5, d);
          if (fall < 0.01) continue;
          float tt = uFT - rim / 2.6 - h * 0.03;
          float le = sin(clamp(mod(tt * 8.5 + fp.x, 3.14159) / 8.5 / 0.21, 0.0, 1.0) * 3.14159);
          float lc = sin(clamp(mod(tt * 7.0 + fp.x * 0.3, 3.14159) / 7.0 / 0.27, 0.0, 1.0) * 3.14159);
          float s = (f.z * le * 0.85 + f.w * lc) * fall * (0.7 + 0.6 * h);
          lift += s * 0.1; push += (d > 0.001 ? dv / d : vec2(0.0)) * s * 0.026;
        }
        return p + vec3(push.x, lift, push.y);
      }`;
    /* glossy candy balls, lit like everything else in the machine (user: "공들 빛 너무 어색한데" — the self-lit jelly
       shading ignored the scene's light: the same sticker highlight on every ball, glowing rims). The earlier dark
       wobbly outline came from the clearcoat: at the silhouette it reflects an empty (black) environment and dims the
       ball under it — so no clearcoat. A soft light through the edge (jelly) and a little glow keep the shady sides
       candy-coloured instead of grey. */
    const ballMat = new T.MeshStandardMaterial({ roughness: 0.26, metalness: 0 });
    const ballDepth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    for (const m of [ballMat, ballDepth]) m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, ballU);
      sh.vertexShader = sh.vertexShader.replace('void main() {', BALL_GLSL + '\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = ballMove(transformed);');
      if (m !== ballMat) return;
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * (0.08 + 0.3 * pow(1.0 - ndv, 2.2)); }`);
    };
    const im = new T.InstancedMesh(new T.SphereGeometry(R, 44, 30), ballMat, spots.length);
    im.customDepthMaterial = ballDepth;
    const mtx = new T.Matrix4(), col = new T.Color();
    spots.forEach((s, i) => { mtx.makeTranslation(s[0], s[1], s[2]); im.setMatrixAt(i, mtx); im.setColorAt(i, col.set(ballCols[s[3]])); });
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; group.add(im);
    let ballClock = 0, impN = 0;

    // chunky 3D letters lying in the pit (like the reference video's letters)
    const letters = grp(group);
    try {
      const font = new T.FontLoader().parse(window.CLAW_FONT3D);
      [['m', '#ff8fb0', -0.36, 1.42, 0.3], ['a', '#ffcf4a', 1.82, 1.44, -0.28], ['s', '#9b8cff', 3.12, 1.48, 0.2]]
        .forEach(([ch, c, x, z, ry]) => {
          const g = new T.TextGeometry(ch, { font, size: 0.42, depth: 0.14, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3 });
          g.center();
          const m = mesh(g, M.plastic(c, { rough: 0.3, clear: 0.9 }), letters, [x, 0.56, z], { rot: [-0.32, ry, 0] });
          m.userData.deco = true;
        });
    } catch (e) { console.warn('3d letters', e); }

    // ── the claw ─────────────────────────────────────────────────────────────────────────────────
    const RAIL_Y = H - 0.14;
    for (const sz of [-1, 1]) mesh(rbox(W - 0.1, 0.07, 0.07, 0.03), M.chrome(), group, [0, RAIL_Y, sz * (D / 2 - 0.28)], { cast: false });
    const gantry = grp(group, 0, RAIL_Y - 0.08, 0);
    mesh(rbox(0.2, 0.13, D - 0.4, 0.05), lav, gantry, [0, 0, 0], { cast: false });
    const trolley = grp(gantry, 0, 0, 0);
    mesh(rbox(0.56, 0.3, 0.56, 0.1), lav, trolley, [0, -0.16, 0]);
    // the round lamp on the trolley's front: the selection light comes out of it (game.js makeSpot)
    const lamp = mesh(SPH, new T.MeshStandardMaterial({ color: '#fff4a8', emissive: '#ffd84a', emissiveIntensity: 0.8 }), trolley, [0, -0.16, 0.29], { scale: [0.06, 0.06, 0.02], cast: false });
    // the coiled cord: a unit-long helix, stretched to the claw. The cord and the claw hang from `cable` (where the cord
    // leaves the trolley): a go that misses sets them swinging on it (claw.wobble)
    const helix = [];
    for (let i = 0; i <= 600; i++) { const t = i / 600, a = t * Math.PI * 2 * 22; helix.push(V(Math.cos(a) * 0.045, -t, Math.sin(a) * 0.045)); }
    const cable = grp(trolley, 0, -0.31, 0);
    const coil = mesh(new T.TubeGeometry(new T.CatmullRomCurve3(helix), 900, 0.012, 6, false), new T.MeshStandardMaterial({ color: '#2b2b33', roughness: 0.45 }), cable, [0, 0, 0], { cast: false });
    const head = grp(cable, 0, -0.89, 0);               // hub top
    const CLAW_S = 1.3;
    const swing = grp(head); swing.scale.setScalar(CLAW_S);
    mesh(new T.CylinderGeometry(0.1, 0.12, 0.2, 28), M.chrome(), swing, [0, -0.1, 0]);
    mesh(SPH, lav, swing, [0, 0.01, 0], { scale: [0.13, 0.08, 0.13] });
    mesh(new T.CylinderGeometry(0.135, 0.135, 0.05, 28), M.chrome(), swing, [0, -0.2, 0]);
    const prongs = [];
    // a "C" prong (in its own frame: down = -y, out = +z): out to the knuckle, then down and back in under the load
    const PIV_R = 0.1, PIV_Y = -0.21;
    const PA = [[0, 0, 0], [0, -0.12, 0.17], [0, -0.3, 0.28]], PB = [[0, -0.3, 0.28], [0, -0.5, 0.25], [0, -0.64, 0.1]];
    const curveA = new T.CatmullRomCurve3(PA.map(p => V(...p))), curveB = new T.CatmullRomCurve3(PB.map(p => V(...p)));
    const segA = new T.TubeGeometry(curveA, 20, 0.032, 10, false), segB = new T.TubeGeometry(curveB, 20, 0.032, 10, false);
    const SAMPLE = [...curveA.getPoints(8), ...curveB.getPoints(10)];       // prong points for the grip test
    // left, right and back: nothing in front of the face of the friend it carries
    /* the lavender tips. Holding a friend, the left and right ones curl in under its chin from the sides (partly behind
       the jaw — fine); the back one curls in BEHIND the friend, so it could only ever show through the body (user:
       "가운데 보라색 점이 인형몸을 관통하잖아") — it's hidden while the claw holds a friend (setHolding). (Drawing the
       side tips nearer the camera was tried: on big heads like the turkey they then sat on the face.) */
    const tips = [];
    for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const piv = grp(swing, Math.sin(yaw) * PIV_R, PIV_Y, Math.cos(yaw) * PIV_R);
      piv.rotation.y = yaw;
      const arm = grp(piv);
      mesh(segA, M.chrome(), arm, null, { cast: true });
      mesh(segB, M.chrome(), arm, null, { cast: true });
      mesh(SPH, M.chrome(), arm, [0, -0.3, 0.28], { scale: 0.046 });
      const tipMat = M.plastic('#c9a2f0', { rough: 0.5 });
      tips.push(mesh(SPH, tipMat, arm, [0, -0.64, 0.1], { scale: 0.045 }));
      prongs.push(arm);
    }
    const hold = grp(swing, 0, -0.52, 0);               // ~ where a carried head sits (look-at / sparkle point)
    const bottom = grp(swing, 0, -0.225, 0);            // the hub's bottom (it presses a soft head in: friends.js)
    // prong angle: open (negative = tips out) ... closed (positive = tips cross)
    const OPEN = -0.8, SHUT = 0.16;
    let grip = OPEN, cordLen = 0.9;
    const setGrip = (a) => { grip = a; prongs.forEach(p => (p.rotation.x = a)); };
    /* the most-closed angle at which no prong point is inside an ellipsoid head (world radii rx, ry) whose centre is
       `depth` below the hub top — the prongs close round the head and stop at its surface */
    /* gripping a friend (a flat picture behind the claw's axis): the prongs close until their knuckles are at the
       sides of the head (`hx` = its half-width), so the tips come in under the cheeks; knuckleDrop(a) = how far under
       the hub top the knuckles are at that angle — the hub stops that far over the head's middle */
    const KN = [-0.3, 0.28];                                                    // knuckle (y, out) in the prong frame
    const knuckle = (a) => ({ r: (PIV_R + KN[0] * Math.sin(a) + KN[1] * Math.cos(a)) * CLAW_S, y: (PIV_Y + KN[0] * Math.cos(a) - KN[1] * Math.sin(a)) * CLAW_S });
    const gripAngle = (hx) => {
      const want = Math.max(0.36, Math.min(0.78, hx));
      let best = OPEN, err = 1e9;
      for (let a = OPEN; a <= SHUT; a += 0.005) { const e = Math.abs(knuckle(a).r - want); if (e < err) { err = e; best = a; } }
      return best;
    };
    const knuckleDrop = (a) => -knuckle(a).y;
    const angleFor = (r) => { r /= CLAW_S; let best = OPEN, err = 1e9; for (let a = OPEN; a <= SHUT; a += 0.01) { const z = PIV_R + (-0.64 * Math.sin(a) + 0.1 * Math.cos(a)); if (Math.abs(z - r) < err) { err = Math.abs(z - r); best = a; } } return best; };
    /* the tip balls (their centres) at angle a: how far out from the claw's axis, how far under the hub top (world) —
       for the neck grip (game.js): the tips close in round the friend's neck */
    const TIP = [-0.64, 0.1], TIP_R = 0.045 * CLAW_S;
    const tipR = (a) => (PIV_R + TIP[0] * Math.sin(a) + TIP[1] * Math.cos(a)) * CLAW_S;
    const tipDrop = (a) => -(PIV_Y + TIP[0] * Math.cos(a) - TIP[1] * Math.sin(a)) * CLAW_S;
    const angleForTip = (r) => { let best = OPEN, err = 1e9; for (let a = OPEN; a <= SHUT; a += 0.002) { const e = Math.abs(tipR(a) - r); if (e < err) { err = e; best = a; } } return best; };
    /* a miss (nothing caught, a prong knocked the friend, it slipped out): the claw swings on its cable — a damped
       pendulum (~1 Hz, mostly settled in ~2 s) — and its prongs rattle a little. wobble(strength, dir ±1: which way it
       swings first, along x, rattle: the prongs' jiggle, 0 = none) */
    const wob = { z: 0, vz: 0, x: 0, vx: 0, jig: 0, jt: 9, n: 0 };
    const WOB_W = 2 * Math.PI * 1.05, WOB_Z = 0.17;
    const HOME_Y = H - 0.72, CARRY_Y = H - 0.42;         // hub top: claw up (clears the back row) / carrying
    const claw = {
      x: 0, z: 0.3, y: HOME_Y, vx: 0, vz: 0, swingX: 0, swingZ: 0, svx: 0, svz: 0,
      head, swing, hold, bottom, prongs, OPEN, SHUT, HOME_Y, CARRY_Y, CLAW_S, HOLD: 0.52 * CLAW_S, setGrip, angleFor, gripAngle, knuckleDrop,
      tipR, tipDrop, angleForTip, TIP_R, HUB_DROP: 0.225 * CLAW_S, HUB_R: 0.135 * CLAW_S,
      setHolding(on) { tips[2].visible = !on; },
      get grip() { return grip; },
      wobble(s = 1, dir = 1, j = 1) {
        wob.vz += dir * s * 1.5; wob.vx += s * 0.4 * (wob.n++ % 2 ? -1 : 1);
        if (j > 0) { wob.jig = Math.max(wob.jig * Math.exp(-wob.jt / 0.22), 0.08 * Math.min(1.2, j)); wob.jt = 0; }
      },
      set(x, y, z) {
        claw.x = x; claw.y = y; claw.z = z;
        gantry.position.x = x; trolley.position.z = z;
        cordLen = Math.max(0.06, (RAIL_Y - 0.08 - 0.31) - y);
        head.position.y = -cordLen;
        coil.scale.y = cordLen;
      },
      /* world position of the hold point (a carried head's centre) */
      holdWorld(out) { return hold.getWorldPosition(out || V(0, 0, 0)); },
    };
    claw.set(0, HOME_Y, 0.3); setGrip(OPEN * 0.55);

    // ── the control panel: a ledge in front of the cabinet ─────────────────────────────────────────
    const panel = grp(group, 0, -0.05, D / 2 + 0.92);
    panel.rotation.x = 0.16;
    // (1.45 deep: room for the big DOWN button in the middle)
    mesh(rbox(W + 0.9, 0.34, 1.45, 0.16), blue, panel, [0, -0.17, 0]);
    mesh(rbox(W + 0.7, 0.05, 1.3, 0.03), M.plastic('#a8def7', { rough: 0.45, clear: 0.5 }), panel, [0, 0.005, -0.02], { cast: false });
    mesh(rbox(W + 0.95, 0.07, 0.07, 0.035), M.plastic('#ff8fd0', { rough: 0.2, clear: 0.9, emissive: '#ff5fc0', ei: 0.5 }), panel, [0, -0.27, 0.73], { cast: false });
    // (buttons, the joystick and DOWN in M.candy — no clearcoat, no dark crawling outline; round parts in 64+ segments)
    const btn = (x, z, c, r = 0.2) => {
      const g = grp(panel, x, 0.02, z);
      mesh(new T.CylinderGeometry(r * 1.25, r * 1.32, 0.08, 72), M.candy('#e8eef5', { rough: 0.3 }), g, [0, 0.03, 0]);
      const cap = mesh(SPH_HI, M.candy(c, { rough: 0.25 }), g, [0, 0.08, 0], { scale: [r, r * 0.45, r] });
      g.userData.cap = cap; return g;
    };
    // (spaced out from the middle, where START / the DOWN button sit — user: "간격을 벌려달라는거지")
    const btnRed = btn(-3.42, 0.12, '#f0423c'), btnYel = btn(2.6, 0.2, '#ffcf2e', 0.17), btnRed2 = btn(3.04, -0.05, '#f0423c', 0.17);
    // the big DOWN button: lies on the panel like the other buttons (user: "각도는 맞추고 크기를 지금처럼 크게"), with the
    // look the flat HTML one had: a glossy green dome with a white arrow, a white bezel, a grey outer ring. The dome's
    // texture is mapped straight down from above, so the arrow points at the player (= down on the screen). Hidden on
    // the title (START sits there), pops up for the game. The game puts an invisible HTML button over it for taps.
    const DOWN_R = 0.68, DOWN_CAP = 0.55, DOWN_H = 0.27, DOWN_Z = -0.06, CAP_Y = 0.17;
    const DOWN_SX = 1.4;                                         // wider than deep: an oval (user: "가로 사이즈를 더 늘려줘")
    const down = grp(panel, 0, 0.02, DOWN_Z);
    down.scale.x = DOWN_SX;
    const downIn = grp(down);                                    // scaled in/out
    mesh(new T.CylinderGeometry(DOWN_R, DOWN_R * 1.03, 0.1, 96), M.candy('#c3cfdc', { rough: 0.35 }), downIn, [0, 0.04, 0]);
    mesh(new T.CylinderGeometry(DOWN_R - 0.06, DOWN_R - 0.045, 0.16, 96), M.candy('#f2f6fa', { rough: 0.3 }), downIn, [0, 0.1, 0]);
    /* the dome's picture is projected onto it along a slant (36° up from the panel, from the player's side), not
       straight down: the game camera sees the panel at only ~26°, and a top-down arrow came out squashed onto the far
       half of the dome. Along the slant it sits in the middle of the dome as seen, still a little foreshortened (it
       lies on the button). The canvas covers the dome's outline seen along that slant. */
    const capGeo = new T.SphereGeometry(1, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const SL = 36 * Math.PI / 180, ev = [Math.cos(SL), -Math.sin(SL)];   // "up" in the slanted picture: (y, z) weights
    const vLo = -DOWN_CAP * Math.sin(SL), vHi = Math.hypot(DOWN_H * Math.cos(SL), DOWN_CAP * Math.sin(SL));
    { const p = capGeo.attributes.position, uv = capGeo.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) * DOWN_CAP, y = p.getY(i) * DOWN_H, z = p.getZ(i) * DOWN_CAP;
        uv.setXY(i, 0.5 + x / (2 * DOWN_CAP), (y * ev[0] + z * ev[1] - vLo) / (vHi - vLo));
      } }
    const capTex = M.tex(512, 512, (g, w, h) => {
      const sy = (2 * DOWN_CAP) / (vHi - vLo);          // canvas y → the same world size as canvas x
      g.save(); g.scale(1, sy);
      const gr = g.createRadialGradient(w * 0.38, h * 0.36 / sy, 0, w * 0.5, h * 0.5 / sy, w * 0.62);
      gr.addColorStop(0, '#b6ff9a'); gr.addColorStop(0.12, '#8ff27c'); gr.addColorStop(0.42, '#4fdc5a'); gr.addColorStop(0.78, '#22a83a'); gr.addColorStop(1, '#178a2c');
      g.fillStyle = gr; g.fillRect(0, 0, w, h / sy);
      g.restore();
      // the arrow (the old button's SVG: a 48-grid, round ends), bolder, with its dark-green shadow under it — drawn
      // narrower by DOWN_SX, so it isn't stretched on the oval
      const ky = w * 0.56 / 48 * sy * 1.12, k = w * 0.56 / 48 / DOWN_SX * 1.12, ox = w * 0.5 - 24 * k, oy = h * 0.5 - 22.5 * ky;
      const arrow = (dy, col) => {
        g.save(); g.translate(ox, oy + dy); g.scale(k, ky);
        g.strokeStyle = col; g.lineWidth = 8.5; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(24, 8); g.lineTo(24, 32); g.stroke();
        g.beginPath(); g.moveTo(12, 24); g.lineTo(24, 37); g.lineTo(36, 24); g.stroke();
        g.restore();
      };
      arrow(h * 0.03, 'rgba(0,90,20,.5)');
      arrow(0, '#ffffff');
    });
    capTex.anisotropy = 8;
    const capMat = M.candy('#ffffff', { map: capTex, rough: 0.28 });
    const downCap = mesh(capGeo, capMat, downIn, [0, CAP_Y, 0], { scale: [DOWN_CAP, DOWN_H, DOWN_CAP] });
    const downSt = { show: 0, k: 0, on: true, ready: false, press: 0, dim: 0 };
    // joystick: base, stick, red ball (tilts while driven)
    const joy = grp(panel, 1.97, 0.02, 0.05);
    // (a soft grey dome base like the mockup's — the dark metal one read as a black outline under the stick)
    mesh(new T.CylinderGeometry(0.24, 0.27, 0.07, 72), M.candy('#8f99a7', { rough: 0.35 }), joy, [0, 0.03, 0]);
    mesh(SPH_HI, M.candy('#a9b2be', { rough: 0.3 }), joy, [0, 0.065, 0], { scale: [0.225, 0.06, 0.225] });
    const stick = grp(joy, 0, 0.06, 0);
    mesh(new T.CylinderGeometry(0.035, 0.04, 0.42, 24), M.chrome(), stick, [0, 0.21, 0]);
    const knob = mesh(SPH_HI, M.candy('#f0423c', { rough: 0.2, emissive: '#ff5a3c', ei: 0 }), stick, [0, 0.46, 0], { scale: 0.15 });
    let knobGlow = 0, knobGlowOn = false;
    // the little screen
    const scr = screenCanvas(); drawScreen(scr, ['LEVEL 1', 'M A S T']);
    const scrTex = new T.CanvasTexture(scr); scrTex.colorSpace = T.SRGBColorSpace;
    const sg = grp(panel, -2.22, 0.02, -0.08);
    sg.rotation.x = -0.55;
    mesh(rbox(1.15, 0.56, 0.12, 0.06), M.plastic('#c49af0', { rough: 0.35 }), sg, [0, 0.28, 0]);
    mesh(new T.PlaneGeometry(1.0, 0.44), new T.MeshBasicMaterial({ map: scrTex, toneMapped: false }), sg, [0, 0.28, 0.063], { cast: false });
    // coin slot
    const coinPlate = grp(panel, 3.55, 0.02, 0.1);
    mesh(rbox(0.42, 0.06, 0.62, 0.05), M.chrome(), coinPlate, [0, 0.03, 0]);
    mesh(rbox(0.06, 0.02, 0.32, 0.01), new T.MeshBasicMaterial({ color: '#111111' }), coinPlate, [0, 0.065, 0], { cast: false });
    const coin = mesh(new T.CylinderGeometry(0.17, 0.17, 0.04, 40), [M.plastic('#e8a816', { rough: 0.25, clear: 1 }), new T.MeshStandardMaterial({ map: coinTex(), roughness: 0.3, metalness: 0.4 }), new T.MeshStandardMaterial({ map: coinTex(), roughness: 0.3, metalness: 0.4 })], group, [0, 0, 0], { cast: false });
    coin.visible = false;

    // ── per-frame: bulbs chase, the claw sways after moves, the stick eases back ────────────────────
    let chaseFast = 0, joyTarget = 0, joyK = 0, lastX = 0, lastZ = 0;
    function tick(dt, t) {
      ballClock += dt; ballU.uTime.value = ballClock;
      const speed = chaseFast > 0 ? 14 : 4;
      chaseFast = Math.max(0, chaseFast - dt);
      bulbs.forEach((b, i) => {
        const on = Math.sin(t * speed - i * 0.9) > (chaseFast > 0 ? 0 : 0.2);
        b.material.emissiveIntensity += ((on ? 1.25 : 0.18) - b.material.emissiveIntensity) * Math.min(1, dt * 14);
      });
      // pendulum: driven by the trolley's acceleration
      const vx = (claw.x - lastX) / Math.max(dt, 1e-3), vz = (claw.z - lastZ) / Math.max(dt, 1e-3);
      const ax = (vx - claw.vx) / Math.max(dt, 1e-3), az = (vz - claw.vz) / Math.max(dt, 1e-3);
      claw.vx = vx; claw.vz = vz; lastX = claw.x; lastZ = claw.z;
      const L = cordLen + 0.5, k = 9.8 / L, c = 2.4;
      claw.svz += (-k * claw.swingZ - c * claw.svz + Math.max(-30, Math.min(30, ax)) * 0.05) * dt; claw.swingZ += claw.svz * dt;
      claw.svx += (-k * claw.swingX - c * claw.svx - Math.max(-30, Math.min(30, az)) * 0.05) * dt; claw.swingX += claw.svx * dt;
      swing.rotation.z = claw.swingZ; swing.rotation.x = claw.swingX;
      // a miss: the claw swings on its cable (a damped spring-pendulum) and the prongs rattle
      for (let left = dt; left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        wob.vz += (-WOB_W * WOB_W * wob.z - 2 * WOB_Z * WOB_W * wob.vz) * h; wob.z += wob.vz * h;
        wob.vx += (-WOB_W * WOB_W * wob.x - 2 * WOB_Z * WOB_W * wob.vx) * h; wob.x += wob.vx * h;
      }
      cable.rotation.z = wob.z; cable.rotation.x = wob.x;
      wob.jt += dt;
      const jig = wob.jig * Math.exp(-wob.jt / 0.22) * Math.sin(wob.jt * Math.PI * 2 * 6.5);
      prongs.forEach((p, i) => (p.rotation.x = grip + jig * (i === 1 ? -1 : i === 2 ? 0.6 : 1)));
      joyK += (joyTarget - joyK) * Math.min(1, dt * 12);
      stick.rotation.z = -joyK * 0.45;
      // the knob glows softly while the game shows how to move the stick (joyHint)
      knobGlow += ((knobGlowOn ? 1 : 0) - knobGlow) * Math.min(1, dt * 5);
      knob.material.emissiveIntensity = knobGlow * (0.3 + 0.28 * Math.sin(t * 6));
      // the DOWN button: pops in/out (springy), pulses while the claw is right over a friend, sinks when pressed,
      // goes dull while the claw is busy
      const ds = downSt;
      ds.k += (ds.show - ds.k) * Math.min(1, dt * 7);
      const pop = ds.show ? 1 + Math.sin(Math.min(1, ds.k) * Math.PI) * 0.12 * (1 - ds.k) : ds.k;
      downIn.scale.setScalar(Math.max(0.001, ds.show ? Math.min(1.12, pop * ds.k + (1 - ds.k) * 0.001) : ds.k));
      down.visible = ds.k > 0.01;
      ds.press = Math.max(0, ds.press - dt);
      const pulse = ds.ready && ds.on ? 1 + 0.045 * Math.sin(t * 5.7) : 1;
      downCap.scale.set(DOWN_CAP * pulse, DOWN_H * (ds.press > 0 ? 0.55 : 1), DOWN_CAP * pulse);
      downCap.position.y = ds.press > 0 ? CAP_Y - 0.03 : CAP_Y;
      ds.dim += ((ds.on ? 0 : 1) - ds.dim) * Math.min(1, dt * 8);
      capMat.color.setRGB(1 - 0.42 * ds.dim, 1 - 0.36 * ds.dim, 1 - 0.42 * ds.dim);
    }

    const api = {
      group, W, D, H, SHELF_Y, claw, chute, bulbs, coin, coinPlate, joy, stick, panel, btnRed, btnYel, btnRed2, glassF, back, ceil, lamp,
      /* six seats in a zig-zag (back row on the shelf, front row in the balls): every back seat sits in the gap between
         two front ones, so all six letters show; neighbours are ~1.1 apart along x */
      slots: [
        { x: -2.55, y: SHELF_Y, z: -1.02, row: 'back' }, { x: -0.36, y: SHELF_Y, z: -1.02, row: 'back' }, { x: 1.84, y: SHELF_Y, z: -1.02, row: 'back' },
        { x: -1.45, y: 0.2, z: 0.74, row: 'front' }, { x: 0.74, y: 0.2, z: 0.74, row: 'front' }, { x: 2.86, y: 0.2, z: 0.74, row: 'front' },
      ],
      FRONT_LANE: 1.2,
      tick,
      chase(sec = 1.5) { chaseFast = sec; },
      setJoy(v) { joyTarget = Math.max(-1, Math.min(1, v)); },
      joyHint(on) { knobGlowOn = !!on; },
      setScreen(lines, accent) { drawScreen(scr, lines, accent); scrTex.needsUpdate = true; },
      /* the balls' motion (machine-group x, z) */
      balls: {
        splash(x, z, s = 1) { ballU.uImp.value[impN++ % 4].set(x, z, ballClock, s); },
        /* the friends sitting in the pit: [{ x, z, ek, ck, ph, r }] (excited / cheering amounts, hop phase, footprint) */
        friends(list, t) {
          ballU.uFT.value = t;
          for (let i = 0; i < 6; i++) {
            const f = list[i];
            if (f) { ballU.uFr.value[i].set(f.x, f.z, f.ek, f.ck); ballU.uFrP.value[i].set(f.ph, f.r, 0, 0); }
            else { ballU.uFr.value[i].set(0, 0, 0, 0); ballU.uFrP.value[i].set(0, 0, 0, 0); }
          }
        },
      },
      press(b) { const c = b.userData.cap; c.position.y = 0.04; setTimeout(() => (c.position.y = 0.08), 160); },
      /* the DOWN button: setDown({ show, on, ready }), pressDown(); downRim() = its rim's points in world space */
      setDown(o) { if ('show' in o) downSt.show = o.show ? 1 : 0; if ('on' in o) downSt.on = !!o.on; if ('ready' in o) downSt.ready = !!o.ready; },
      pressDown() { downSt.press = 0.16; },
      downRim: (n = 24) => { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push(down.localToWorld(V(Math.cos(a) * DOWN_R * 1.03, 0, Math.sin(a) * DOWN_R * 1.03)), down.localToWorld(V(Math.cos(a) * DOWN_CAP * 0.7, CAP_Y + DOWN_H * 0.7, Math.sin(a) * DOWN_CAP * 0.7))); } return out; },
      /* local points of the panel (for the HTML buttons over it) */
      dropPoint: () => panel.localToWorld(V(0, 0.05, 0.1)),
      joyPoint: () => joy.localToWorld(V(0, 0.45, 0)),
      slotPoint: () => coinPlate.localToWorld(V(0, 0.1, 0)),
      /* the claw's x range and the depth it rides at */
      X_MIN: -W / 2 + 0.55, X_MAX: W / 2 - 0.55,
    };
    return api;
  }

  window.Machine = { build };
})();
