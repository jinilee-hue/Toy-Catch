/* Toy Catch — materials and canvas textures.
 * Everything WebGL draws is built here from code (canvas textures, no image files), so the game also runs when
 * index.html is opened straight from disk (file:// pictures can't be uploaded to WebGL).
 */
(function () {
  'use strict';
  const M = {}, cache = {};

  M.canvas = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  };
  M.tex = (w, h, draw, o = {}) => {
    const t = new THREE.CanvasTexture(M.canvas(w, h, draw));
    t.colorSpace = o.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
    return t;
  };

  /* tileable value noise in [0, 1] (wraps at the edges, so the normal map tiles) */
  function noiseField(n, cells, seed) {
    let s = seed || 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const g = [];
    for (let i = 0; i < cells * cells; i++) g.push(rnd());
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x / n * cells, fy = y / n * cells, x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j % cells) * cells) + (i % cells)];
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      out[y * n + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
    return out;
  }
  /* plush fabric: soft lumps + fine fibre grain as a normal map */
  M.fabricNormal = function () {
    if (cache.fabricN) return cache.fabricN;
    const n = 256, h = new Float32Array(n * n);
    const layers = [[8, 0.55, 3], [32, 0.3, 11], [128, 0.15, 29]];
    for (const [cells, w, seed] of layers) { const f = noiseField(n, cells, seed); for (let i = 0; i < h.length; i++) h[i] += f[i] * w; }
    let s = 99;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 2600; i++) {            // little fibre tufts
      const x = Math.floor(rnd() * n), y = Math.floor(rnd() * n), a = rnd() * Math.PI, L = 2 + rnd() * 4;
      for (let k = 0; k < L; k++) { const xx = (x + Math.round(Math.cos(a) * k) + n) % n, yy = (y + Math.round(Math.sin(a) * k) + n) % n; h[yy * n + xx] += 0.12; }
    }
    const t = M.tex(n, n, (g) => {
      const img = g.createImageData(n, n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const hx = h[y * n + (x + 1) % n] - h[y * n + (x - 1 + n) % n];
        const hy = h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x];
        let nx = -hx * 2.2, ny = -hy * 2.2, nz = 1;
        const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
        const i = (y * n + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }, { data: true, repeat: [5, 4] });
    return (cache.fabricN = t);
  };

  const C = (c) => new THREE.Color(c);
  /* soft plush fabric: matte, with a velvety sheen at the edges */
  M.fabric = function (color, o = {}) {
    const key = 'f' + color + (o.sheen ?? '') + (o.rough ?? '') + (o.flat ? 1 : 0);
    if (cache[key]) return cache[key];
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: o.rough ?? 0.9, metalness: 0,
      sheen: o.sheen ?? 0.9, sheenRoughness: 0.45, sheenColor: C(color).lerp(C('#ffffff'), 0.45),
      normalMap: o.flat ? null : M.fabricNormal(), normalScale: new THREE.Vector2(0.55, 0.55),
    });
    return (cache[key] = m);
  };
  M.felt = (color) => M.fabric(color, { sheen: 0.5, rough: 0.95 });
  M.plastic = function (color, o = {}) {
    const key = 'p' + color + (o.rough ?? '') + (o.clear ?? '') + (o.emissive || '');
    if (cache[key]) return cache[key];
    return (cache[key] = new THREE.MeshPhysicalMaterial({
      color, roughness: o.rough ?? 0.32, metalness: 0, clearcoat: o.clear ?? 0.6, clearcoatRoughness: 0.2,
      emissive: o.emissive ? C(o.emissive) : C('#000000'), emissiveIntensity: o.ei ?? 0,
    }));
  };
  M.chrome = () => cache.chrome || (cache.chrome = new THREE.MeshStandardMaterial({ color: '#eef2f6', metalness: 1, roughness: 0.2 }));
  M.darkMetal = () => cache.dmetal || (cache.dmetal = new THREE.MeshStandardMaterial({ color: '#3d4350', metalness: 0.7, roughness: 0.35 }));
  M.bead = () => cache.bead || (cache.bead = new THREE.MeshPhysicalMaterial({ color: '#17110e', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }));
  M.white = () => cache.white || (cache.white = new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  M.thread = (color) => cache['t' + color] || (cache['t' + color] = new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  M.glass = (opacity = 0.1) => new THREE.MeshPhysicalMaterial({
    color: '#ffffff', transparent: true, opacity, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
    depthWrite: false, side: THREE.DoubleSide,
  });

  /* a decal material (a letter, blush, spots…) on a patch that sits just over a surface */
  M.decal = (map, o = {}) => new THREE.MeshStandardMaterial({
    map, transparent: true, roughness: o.rough ?? 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  const FONT = '"Baloo 2", "Arial Rounded MT Bold", system-ui, sans-serif';
  M.FONT = FONT;
  /* an embroidered letter: thick rounded glyph, a darker rim, a stitched line inside the rim and a soft shadow;
     optional patch behind it (round / rounded square) with a stitched border */
  M.letterTex = function (ch, o = {}) {
    const key = 'L' + ch + JSON.stringify(o);
    if (cache[key]) return cache[key];
    const S = 512, t = M.tex(S, S, (g) => {
      g.clearRect(0, 0, S, S);
      const cx = S / 2, cy = S / 2;
      if (o.patch) {
        g.fillStyle = o.patch;
        g.beginPath();
        if (o.shape === 'circle') g.arc(cx, cy, S * 0.46, 0, Math.PI * 2);
        else g.roundRect(S * 0.06, S * 0.06, S * 0.88, S * 0.88, S * 0.22);
        g.fill();
        g.setLineDash([22, 16]); g.lineWidth = 9; g.strokeStyle = o.stitch || 'rgba(255,255,255,0.75)';
        g.beginPath();
        if (o.shape === 'circle') g.arc(cx, cy, S * 0.40, 0, Math.PI * 2);
        else g.roundRect(S * 0.12, S * 0.12, S * 0.76, S * 0.76, S * 0.17);
        g.stroke(); g.setLineDash([]);
      }
      const size = S * (o.size || 0.78);
      g.font = `800 ${size}px ${FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      const m = g.measureText(ch), asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
      const y = cy + (asc - desc) / 2;
      g.lineJoin = 'round';
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillText(ch, cx + 6, y + 9);                 // soft drop shadow
      g.lineWidth = S * 0.075; g.strokeStyle = o.rim || '#ffffff'; g.strokeText(ch, cx, y);
      g.fillStyle = o.fg || '#ffd43b'; g.fillText(ch, cx, y);
      if (o.stitch !== false) {                                                         // stitches on the glyph
        g.save(); g.setLineDash([14, 12]); g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.globalCompositeOperation = 'source-atop'; g.lineWidth = 6; g.strokeText(ch, cx, y); g.restore();
      }
    });
    return (cache[key] = t);
  };
  /* a soft round blush */
  M.blushTex = (col = '255,120,150') => cache['b' + col] || (cache['b' + col] = M.tex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, `rgba(${col},0.75)`); r.addColorStop(0.6, `rgba(${col},0.35)`); r.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  }));
  /* tiger stripes for a sphere's uv (u = round, v = top → bottom); `spots`: cow-style patches */
  M.stripeTex = function (base, ink, kind) {
    const key = 'st' + base + ink + kind;
    if (cache[key]) return cache[key];
    return (cache[key] = M.tex(1024, 512, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      g.fillStyle = ink;
      if (kind === 'head') {
        // forehead stripes over the front (u ≈ .25 is +z) + cheek stripes on both sides
        const fx = w * 0.25;
        for (const [dx, y0, len, wd] of [[0, 0.08, 0.16, 0.022], [-0.035, 0.12, 0.12, 0.016], [0.035, 0.12, 0.12, 0.016]]) {
          g.beginPath(); g.ellipse(fx + dx * w, (y0 + len / 2) * h, wd * w, len / 2 * h, 0, 0, Math.PI * 2); g.fill();
        }
        for (const s of [-1, 1]) for (const [du, v] of [[0.12, 0.5], [0.135, 0.6], [0.11, 0.42]]) {
          g.beginPath(); g.ellipse(fx + s * du * w, v * h, 0.03 * w, 0.012 * h, s * 0.15, 0, Math.PI * 2); g.fill();
        }
        for (let i = 0; i < 6; i++) {             // the back of the head
          const u = 0.55 + i * 0.07;
          g.beginPath(); g.ellipse(u * w, 0.3 * h, 0.012 * w, 0.2 * h, 0.2, 0, Math.PI * 2); g.fill();
        }
      } else {
        for (let i = 0; i < 14; i++) {
          const u = i / 14 + 0.02;
          if (Math.abs(u - 0.25) < 0.09) continue;  // keep the belly (front) clear
          g.beginPath(); g.ellipse(u * w, 0.42 * h, 0.011 * w, 0.17 * h, 0.25, 0, Math.PI * 2); g.fill();
        }
      }
    }));
  };
  /* turtle shell: hexagon plates */
  M.shellTex = () => cache.shell || (cache.shell = M.tex(1024, 512, (g, w, h) => {
    g.fillStyle = '#4f9a45'; g.fillRect(0, 0, w, h);
    const hex = (x, y, r) => { g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9); } g.closePath(); };
    for (let row = 0; row < 4; row++) for (let i = 0; i < 9; i++) {
      const x = (i + (row % 2) * 0.5) * w / 9, y = h * (0.12 + row * 0.2);
      hex(x, y, w / 22);
      g.fillStyle = '#7cc56a'; g.fill();
      g.lineWidth = 6; g.strokeStyle = '#3f7f37'; g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, w, h * 0.15);
  }));
  /* cream plastron (turtle belly): rounded segments */
  M.plastronTex = () => cache.plast || (cache.plast = M.tex(512, 512, (g, w, h) => {
    g.fillStyle = '#f6e7a6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,130,60,0.45)'; g.lineWidth = 8;
    for (const y of [0.2, 0.8]) { g.beginPath(); g.moveTo(w * 0.1, y * h); g.lineTo(w * 0.9, y * h); g.stroke(); }
  }));

  window.Mats = M;
})();
