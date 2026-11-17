/* Toy Catch — the friends in the machine: the user's plush pictures (js/friends-art.js) as cut-outs that always
 * turn to face the camera. Same interface the game used with the old procedural plushies:
 *   root (origin at the bottom middle, under the head), kind, word, sound ('cat' → c), icon (the picture),
 *   top, gripY / headR (the head the claw closes round, at scale 1), alphaAt(uv) (taps on see-through bits miss),
 *   cheer(sec), nope(sec), hold(on), lookAt(worldPoint | null), excite(0..1), update(dt, t),
 *   tilt (radians, set by the game: a loose grip tips the body round the head before it slips out).
 * Rig: root > hang (pivot at the head: the body swings under the claw) > seat (pivot at the bottom: sitting wobble,
 * hops) > face (turns to the camera) > picture (a little behind the claw's axis, so the prongs stay in front of it).
 * A 600-px-tall picture is 1.3 units tall; the game scales friends by 1.3 in the machine.
 * The pictures are PUFFED into soft reliefs (user: "동물이미지들 디자인 같게해서 3d 모델링"): the silhouette inflated like a
 * cushion — Poisson inflation, so wide parts (head, body) get thick and arms/ears/tails stay thin, all round at the
 * edges — with the picture mapped straight on from the front. The pictures already have their own painted light, so
 * no light of ours from a side (user: "빛이 너무 어색한데" — a light from the upper left fought the painted one, washed
 * one side out and darkened the other): only a soft shade where the cushion turns away, all round, and under it.
 * The cut-out edge is still the picture's own alpha, so the silhouette and the art stay exactly the user's.
 * 3D (js/friends-3d.js, made on this Mac by tools/make_3d.py): each friend is a full 3D plush — TripoSR's shape from
 * the picture — with the picture itself on the front (the 'front weight' of every vertex) and TripoSR's guessed colours
 * round the back, so the face is exactly the user's art and the body has a real back and sides. It moves like a soft
 * toy (plushDeform): a springy squash when it lands or is grabbed (NOT on every hop while selected or cheering — that
 * pumping up and down looked wrong, user: "선택됐을때 인형이 위아래로 줄었다 늘렸다 하는 모션이 이상해"), the top lagging
 * behind when it's pushed or carried (the
 * legs dangling while it hangs), the claw pinching its head a little. Friends without 3D data fall back to the puffed
 * picture. ?puff / ?flat show the earlier versions (for comparison).
 */
(function () {
  'use strict';
  const T = THREE, ART = window.CLAW_FRIENDS || {};
  const PX = 1.3 / 600;
  const BACK = 0.07;                                    // picture plane behind the root (claw) axis
  const KINDS = Object.keys(ART);
  const imgs = {}, alpha = {}, atlasImgs = {};
  const AW = 64;                                         // alpha grid for taps: 64 px wide
  const tmp = new T.Vector3(), tmpQ = new T.Quaternion(), tmpE = new T.Euler(0, 0, 0, 'YXZ');
  const ease = (cur, to, k) => cur + (to - cur) * k;
  const FLAT = /[?&]flat\b/.test(location.search);
  const PUFF = { cells: 72, depth: 1.6, sway: 0.13 };     // grid cells across a picture; depth (2 = a full hemisphere);
                                                         // idle turn (rad) either way, so the volume shows
  const geoCache = {};
  const D3 = window.CLAW_FRIENDS_3D || {};
  const PUFFED = /[?&]puff\b/.test(location.search);
  const has3d = (k) => !FLAT && !PUFFED && !!D3[k];
  const srgb = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  /* the 3D shape of one friend, in the same frame as the picture: x across (head middle at 0), y up from the bottom,
     z toward the camera (the claw's axis at z 0). uv = the picture straight from the front; fw = how much of the
     picture shows (1 seen from the front, 0 round the back); then either color = the guessed colours (linear) or
     auv = where the vertex sits in the friend's texture atlas (baked from its character sheet) */
  function geo3d(kind, w, h, u) {
    if (geoCache['3d' + kind]) return geoCache['3d' + kind];
    const d = D3[kind];
    const bin = (b64) => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
    const q = new Uint16Array(bin(d.pos).buffer), fw = bin(d.fw), idx = new Uint16Array(bin(d.idx).buffer);
    const c8 = d.col ? bin(d.col) : null, t16 = d.uv ? new Uint16Array(bin(d.uv).buffer) : null;
    const pos = new Float32Array(d.n * 3), uv = new Float32Array(d.n * 2), col = c8 ? new Float32Array(d.n * 3) : null;
    for (let i = 0; i < d.n; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = d.lo[k] + q[i * 3 + k] / 65535 * (d.hi[k] - d.lo[k]);
      uv[i * 2] = pos[i * 3] / w + u; uv[i * 2 + 1] = pos[i * 3 + 1] / h;
      if (c8) for (let k = 0; k < 3; k++) col[i * 3 + k] = srgb(c8[i * 3 + k] / 255);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (col) geo.setAttribute('color', new T.BufferAttribute(col, 3));
    if (t16) geo.setAttribute('auv', new T.BufferAttribute(t16, 2, true));
    geo.setAttribute('fw', new T.BufferAttribute(fw, 1, true));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    if (t16) {
      // the atlas splits vertices along its seams: copies at one spot share one normal, else the shade shows the seams
      const nr = geo.attributes.normal.array, sum = new Map();
      for (let i = 0; i < d.n; i++) {
        const key = q[i * 3] + ',' + q[i * 3 + 1] + ',' + q[i * 3 + 2], s = sum.get(key);
        if (s) { s[0] += nr[i * 3]; s[1] += nr[i * 3 + 1]; s[2] += nr[i * 3 + 2]; } else sum.set(key, [nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]]);
      }
      for (let i = 0; i < d.n; i++) {
        const s = sum.get(q[i * 3] + ',' + q[i * 3 + 1] + ',' + q[i * 3 + 2]), l = Math.hypot(s[0], s[1], s[2]) || 1;
        nr[i * 3] = s[0] / l; nr[i * 3 + 1] = s[1] / l; nr[i * 3 + 2] = s[2] / l;
      }
    }
    geo.computeBoundingSphere();
    return (geoCache['3d' + kind] = geo);
  }

  /* soft-toy motion in the vertex shader (also in the shadow): squash & stretch about the bottom (sitting) or the head
     (hanging), the top lagging (sitting) / the legs dangling (hanging) by uBend, the claw's pinch round the head */
  const DEFORM = `
    uniform float uSq, uH, uPiv, uGy, uGrip, uHang, uR; uniform vec2 uBend;
    vec3 plushDeform(vec3 p) {
      float base = uGy * uHang;
      p.y = base + (p.y - base) * uSq;
      float k = inversesqrt(max(uSq, 0.3)); p.x *= k; p.z *= k;
      float tUp = clamp((p.y - uPiv) / max(uH - uPiv, 0.01), 0.0, 1.0), tDn = clamp((uGy - p.y) / max(uGy, 0.01), 0.0, 1.0);
      p.xz += uBend * mix(tUp * tUp, tDn * tDn, uHang);
      float g = exp(-pow((p.y - uGy) / (uH * 0.16), 2.0));
      p.x *= 1.0 - 0.08 * uGrip * g; p.z *= 1.0 - 0.05 * uGrip * g;
      // a body wider than the closed prongs (the fish, the turtle's shell) is pressed in where they hold it — only in
      // front of the prongs' plane (what would hide them) and only in a narrow band (the turtle's face stays as it is)
      if (uR > 0.0) {
        float r0 = uR * 0.96, ax = abs(p.x);
        float w = uGrip * exp(-pow((p.y - uGy) / (uH * 0.1), 2.0)) * smoothstep(-0.25, -0.05, p.z);
        if (ax > r0) p.x = sign(p.x) * mix(ax, r0 + (ax - r0) * 0.3, w);
      }
      return p;
    }`;
  function deformVS(vs) {
    return vs.replace('void main() {', DEFORM + '\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = plushDeform(transformed);');
  }
  /* the 3D friend's colour: the picture where it's seen from the front, the guessed colours (or the atlas baked from its
     character sheet: CLAW_ATLAS) behind; then the same soft shade as the puffed pictures (darker only where it turns
     away from the camera and underneath — the art's painted light stays the light) and the claw's spotlight.
     With an atlas, fw only says "seen from the front"; how much of the picture shows also depends on the view: seen
     (nearly) straight on, every surface the picture covers shows it — so from the front the friend is exactly its
     picture, steep sides and outline too; turned further (the prize spin), only the surfaces facing the front keep it
     (it would smear on the steep sides) and the atlas — the sheet's sides and back — shows round them */
  function plush3dShader(sh) {
    Object.assign(sh.uniforms, this.userData.u);
    sh.uniforms.uLit = this.userData.uLit;
    if (this.userData.uAtlas) sh.uniforms.uAtlas = this.userData.uAtlas;
    sh.vertexShader = deformVS(sh.vertexShader)
      .replace('void main() {', `attribute float fw;
varying float vFw;
varying vec3 vPuffN;
#ifdef CLAW_ATLAS
attribute vec2 auv;
varying vec2 vAuv;
varying float vNz, vTurn;
#endif
void main() {
  vFw = fw;
  vPuffN = normalize(normalMatrix * normal);
#ifdef CLAW_ATLAS
  vAuv = auv;
  vNz = normal.z;
  vec3 vo = normalize(transpose(mat3(modelMatrix)) * (cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz));
  vTurn = smoothstep(0.95, 0.8, vo.z);                       // 0 seen straight on, 1 turned by ~37 deg or more
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying float vFw;\nvarying vec3 vPuffN;\nuniform float uLit;\n#ifdef CLAW_ATLAS\nuniform sampler2D uAtlas;\nvarying vec2 vAuv;\nvarying float vNz, vTurn;\n#endif\nvoid main() {')
      .replace('#include <map_fragment>', `
      vec4 texel = texture2D(map, vMapUv);
      #ifdef CLAW_ATLAS
        vec3 behind = texture2D(uAtlas, vAuv).rgb;
        vec2 th = mix(vec2(-0.08, 0.1), vec2(0.42, 0.62), vTurn);
        float pw = vFw * smoothstep(th.x, th.y, vNz);
      #else
        vec3 behind = vColor.rgb;                                       // (vColor is a vec4 in this three)
        float pw = vFw;
      #endif
      diffuseColor.rgb = mix(behind, texel.rgb, pw * smoothstep(0.3, 0.7, texel.a));`)
      .replace('#include <color_fragment>', `
      {
        vec3 n = normalize(vPuffN);
        if (!gl_FrontFacing) n = -n;
        float away = pow(1.0 - clamp(n.z, 0.0, 1.0), 1.5);
        float shade = 1.0 - 0.16 * away - 0.1 * clamp(-n.y, 0.0, 1.0) * away;
        diffuseColor.rgb *= clamp(shade, 0.72, 1.0);
        diffuseColor.rgb *= 1.0 + uLit * (0.07 + 0.24 * smoothstep(-0.25, 0.85, n.y));
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), uLit);
      }`);
  }

  /* the puffed relief of one picture, in the same frame as the old plane: x across (head middle at 0), y up from the
     bottom, z toward the camera from the picture plane (-BACK) */
  function puffGeo(kind, w, h, u) {
    if (geoCache[kind]) return geoCache[kind];
    const im = imgs[kind];
    const nx = PUFF.cells, ny = Math.round(nx * im.height / im.width);
    const c = document.createElement('canvas'); c.width = nx; c.height = ny;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, nx, ny);
    const d = g.getImageData(0, 0, nx, ny).data;
    const ins = new Uint8Array(nx * ny);
    for (let i = 0; i < ins.length; i++) ins[i] = d[i * 4 + 3] > 96 ? 1 : 0;
    // inflation: solve Δf = -1 inside the shape, f = 0 outside (SOR); sqrt(f) is round like a cushion
    const f = new Float32Array(nx * ny);
    for (let it = 0; it < 260; it++) {
      for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
        const i = y * nx + x; if (!ins[i]) continue;
        f[i] += 1.9 * ((f[i - 1] + f[i + 1] + f[i - nx] + f[i + nx] + 1) * 0.25 - f[i]);
      }
    }
    // vertices on the cell corners; a corner's height is from the cells around it
    const cell = w / nx, cx = nx + 1, cy = ny + 1;
    const pos = new Float32Array(cx * cy * 3), uv = new Float32Array(cx * cy * 2);
    for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
      let sum = 0;
      for (const [ax, ay] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) if (ax >= 0 && ay >= 0 && ax < nx && ay < ny) sum += f[ay * nx + ax];
      const k = y * cx + x, ht = PUFF.depth * Math.sqrt(sum / 4) * cell;
      pos[k * 3] = (x / nx - u) * w; pos[k * 3 + 1] = (1 - y / ny) * h; pos[k * 3 + 2] = -BACK + ht;
      uv[k * 2] = x / nx; uv[k * 2 + 1] = 1 - y / ny;
    }
    // triangles on the cells in and around the shape (one cell wider: the alpha test trims the exact edge)
    const idx = [];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let near = 0;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < nx && yy < ny && ins[yy * nx + xx]) { near = 1; break; }
      }
      if (!near) continue;
      const a = y * cx + x, b = a + 1, e = a + cx, q = e + 1;
      idx.push(a, e, b, b, e, q);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return (geoCache[kind] = geo);
  }

  /* the shade on the puffed relief: never brighter than the picture and the same on the left and the right (the art's
     own painted light stays the only light) — a little darker only where the cushion turns away near its outline, a
     touch more on its underside; facing the camera it is exactly the picture */
  function puffShade(sh) {
    sh.uniforms.uLit = this.userData.uLit;               // (called as the material's method: this = that friend's material)
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vPuffN;\nvoid main() {\n  vPuffN = normalize(normalMatrix * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying vec3 vPuffN;\nuniform float uLit;\nvoid main() {')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 n = normalize(vPuffN);
        if (!gl_FrontFacing) n = -n;
        float away = pow(1.0 - clamp(n.z, 0.0, 1.0), 1.5);
        float shade = 1.0 - 0.14 * away - 0.08 * clamp(-n.y, 0.0, 1.0) * away;
        diffuseColor.rgb *= clamp(shade, 0.78, 1.0);
        // under the claw's spotlight: lit from above — a little brighter all over, more on the top of the head and the
        // shoulders, slightly warm (game.js makeSpot)
        diffuseColor.rgb *= 1.0 + uLit * (0.07 + 0.24 * smoothstep(-0.25, 0.85, n.y));
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), uLit);
      }`);
  }

  function load() {
    // the atlases baked from the character sheets (webp data URLs, like the pictures)
    const atl = KINDS.filter(k => D3[k] && D3[k].tex && !FLAT && !PUFFED).map(k => new Promise((res) => {
      const im = new Image();
      im.onload = () => { atlasImgs[k] = im; res(); };
      im.onerror = () => { console.warn('friend atlas failed:', k); res(); };
      im.src = D3[k].tex;
    }));
    return Promise.all(atl.concat(KINDS.map(k => new Promise((res) => {
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
    }))));
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
    let geo, mat, depth;
    const is3d = has3d(kind);
    const U = { uSq: { value: 1 }, uH: { value: h }, uPiv: { value: h * 0.22 }, uGy: { value: (1 - v) * h }, uGrip: { value: 0 }, uHang: { value: 0 }, uR: { value: 0 }, uBend: { value: new T.Vector2() } };
    if (is3d) {
      geo = geo3d(kind, w, h, u);
      const atl = geo.attributes.auv && atlasImgs[kind];
      mat = new T.MeshBasicMaterial({ map: tex, vertexColors: !atl, toneMapped: false });
      mat.userData.u = U; mat.onBeforeCompile = plush3dShader;
      if (atl) {
        const at = new T.Texture(atlasImgs[kind]);
        at.colorSpace = T.SRGBColorSpace; at.anisotropy = 8; at.needsUpdate = true;
        mat.userData.uAtlas = { value: at }; mat.defines = { CLAW_ATLAS: '' };
      }
      depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      depth.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, U); sh.vertexShader = deformVS(sh.vertexShader); };
    } else {
      if (FLAT) { geo = new T.PlaneGeometry(w, h); geo.translate((0.5 - u) * w, h / 2, -BACK); }   // the head's middle over the root
      else geo = puffGeo(kind, w, h, u);
      mat = new T.MeshBasicMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, toneMapped: false });
      if (!FLAT) { mat.onBeforeCompile = puffShade; mat.side = T.DoubleSide; }   // (turned a little, the far edge shows its inside)
      depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: tex, alphaTest: 0.5 });
    }
    mat.userData.uLit = { value: 0 };
    const pic = new T.Mesh(geo, mat);
    pic.castShadow = true;
    pic.customDepthMaterial = depth;
    P.face.add(pic); P.pic = pic;
    Object.defineProperty(pic.userData, 'plush', { value: P, enumerable: false, configurable: true });
    // soft contact shadow on the shelf / balls (fades while it's held)
    const sh = new T.Mesh(new T.PlaneGeometry(1, 1), blob());
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.015; sh.scale.set(w * 0.95, Math.min(0.75, w * 0.6), 1);
    sh.renderOrder = 2; sh.raycast = () => {};
    P.root.add(sh); P.blob = sh;

    P.top = h; P.width = w;
    P.span = [-u * w, (1 - u) * w];                       // the picture's left / right edge from the root (scale 1)
    P.gripY = gy;
    P.headR = [rx * w, ry * h, rx * w * 0.8];
    P.gripR = rx * w;
    P.alphaAt = (uv) => {
      const g = alpha[kind]; if (!g || !uv) return 255;
      const x = Math.min(g.w - 1, Math.max(0, Math.floor(uv.x * g.w))), y = Math.min(g.h - 1, Math.max(0, Math.floor((1 - uv.y) * g.h)));
      return g.a[y * g.w + x];
    };
    P.phase = Math.random() * 10;
    P.st = { excite: 0, ek: 0, cheer: 0, ck: 0, held: 0, hk: 0, nope: 0, look: null, lean: 0,
      sq: 1, sqv: 0, b: new T.Vector2(), bv: new T.Vector2(), wp: null, wv: new T.Vector3() };
    P.is3d = is3d;
    P.faceCam = true;                                     // (the dev viewer turns them by hand)
    if (is3d) {
      /* how wide the body is at each height (scale 1, either side of the claw's axis), counting only what's in front of
         the prongs' plane — the claw closes round that, not round the picture's head (a fish or a turtle is far wider
         than its head) */
      const pos = geo.attributes.position, STEP = 0.02, N = Math.ceil(h / STEP) + 1, hw = new Float32Array(N);
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) < -0.02) continue;
        const y = pos.getY(i), x = Math.abs(pos.getX(i)), j = Math.round(y / STEP);
        for (let k = Math.max(0, j - 1); k <= Math.min(N - 1, j + 1); k++) hw[k] = Math.max(hw[k], x);
      }
      P.widthAt = (y) => { const f = Math.max(0, Math.min(N - 1.001, y / STEP)), j = Math.floor(f); return hw[j] + (hw[j + 1] - hw[j]) * (f - j); };
      /* where the claw holds it this time (height and the prongs' radius, scale 1): the soft squeeze and the hanging */
      P.setGrip3d = (y, r) => { U.uGy.value = y; U.uR.value = r; };
    }
    if (window.Poses) Poses.attach(P, is3d ? { geo, mat, depth, U, w, h, u } : null);   // signature pose (js/poses.js)
    /* a squash (k > 0) or stretch (k < 0) kick — landing, being grabbed */
    P.bump = (k) => { P.st.sqv -= k * 3.5; };
    P.tilt = 0;
    P.excite = (val) => { P.st.excite = val; };
    P.cheer = (sec = 1.6) => { P.st.cheer = sec; };
    P.hold = (on) => { P.st.held = on ? 1 : 0; };
    P.nope = (sec = 1.0) => { P.st.nope = sec; };
    P.lookAt = (p) => { P.st.look = p ? p.clone() : null; };
    P.lit = (v) => { mat.userData.uLit.value = v; };       // the claw's spotlight on it (0..1, eased by the game)
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
      if (cam && P.faceCam) {
        P.face.getWorldPosition(tmp);
        const want = Math.atan2(cam.position.x - tmp.x, cam.position.z - tmp.z);
        P.seat.getWorldQuaternion(tmpQ); tmpE.setFromQuaternion(tmpQ, 'YXZ');
        // (a slow idle turn either way, a livelier one while it hangs from the claw — so the volume shows; wider for
        // the 3D friends, which have real sides)
        const amp = FLAT ? 0 : is3d ? 0.24 : PUFF.sway;
        const sway = amp * (Math.sin(t * 0.8 + ph) * sit + Math.sin(t * 2.1 + ph) * 1.1 * s.hk);
        P.face.rotation.y = want - tmpE.y + sway;
      }
      if (P.poser) P.poser.update(dt, t);
      if (is3d) softBody(dt, t, hop, sit);
    };
    /* the soft-toy feel: a squash & stretch spring kicked only by bump() (a landing, being grabbed — the hops keep their
       shape: squashing on every hop looked rubbery), the bend (the top lags behind the friend's own acceleration; while
       it hangs, the legs), the claw's pinch */
    const acc = new T.Vector3(), qi = new T.Quaternion();
    function softBody(dt, t, hop, sit) {
      const s = P.st;
      if (dt <= 0) return;
      const h1 = Math.min(dt, 1 / 30);
      s.sqv += (-(s.sq - 1) * 260 - s.sqv * 11) * h1; s.sq += s.sqv * h1;
      s.sq = Math.max(0.7, Math.min(1.3, s.sq));
      P.root.getWorldPosition(tmp);
      if (!s.wp) s.wp = tmp.clone();
      const vel = tmp.clone().sub(s.wp).divideScalar(dt);
      acc.copy(vel).sub(s.wv).divideScalar(dt);
      if (acc.length() > 400) acc.setLength(400);
      s.wp.copy(tmp); s.wv.copy(vel);
      P.face.getWorldQuaternion(qi); qi.invert(); acc.applyQuaternion(qi);
      const G = 1 / (P.root.scale.x || 1);
      s.bv.x += (-s.b.x * 120 - s.bv.x * 8 - acc.x * G) * h1; s.bv.y += (-s.b.y * 120 - s.bv.y * 8 - acc.z * G) * h1;
      s.b.x = Math.max(-0.13, Math.min(0.13, s.b.x + s.bv.x * h1)); s.b.y = Math.max(-0.1, Math.min(0.1, s.b.y + s.bv.y * h1));
      const up = Math.max(-0.05, Math.min(0.05, vel.y * 0.02)) * s.hk;     // pulled up fast: a little longer
      U.uSq.value = s.sq * (1 + up);
      U.uBend.value.copy(s.b);
      U.uHang.value = s.hk; U.uGrip.value = s.hk;
    }
    return P;
  }

  window.Friends = { KINDS, load, build };
})();
