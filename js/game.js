/* Toy Catch (phonics claw machine) — game flow.
 * Title (logo, START) → coin goes in ("INSERTED! READY TO PLAY!") → 4 rounds, one per sound m a s t in random order:
 * "Catch a friend that starts with /m/" → move the claw (joystick, drag, tap a plush, ← →) → DOWN → the claw drops,
 * grabs the plush under it and lifts it. Right sound: confetti, the others cheer, "/m/ /m/ monkey", it goes down the
 * chute and pops out as a prize. Wrong sound: "Uh-oh! turtle. It starts with /t/", it slips back. 45 s per round.
 * → result (stars, caught friends, score, Play again / Home).
 */
(function () {
  'use strict';
  const S = Stage, A = Sound, T = THREE;
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const qs = new URLSearchParams(location.search);
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const lerp = (a, b, k) => a + (b - a) * k;
  const LETTERS = ['m', 'a', 's', 't'];
  const POOL = { m: ['monkey', 'mouse'], a: ['ant'], s: ['seal'], t: ['turkey', 'turtle'] };
  const OTHERS = ['cat', 'cow', 'dog', 'fish'];          // c d f: never a target, always a wrong answer
  const ROUND_SEC = +(qs.get('sec') || 45);
  const PS = 1.3;                                       // plush scale in the machine
  const G = {
    screen: 'title', all: {}, inMachine: [], targets: [], round: -1, target: null, score: 0, caught: [], tries: 0,
    time: ROUND_SEC, timerOn: false, busy: true, tok: 0, aimX: 0, joy: 0, keys: { l: 0, r: 0 }, idle: 0, interacted: false,
    icons: {}, shownSec: -1,
  };
  let machine, claw, beam, burst;
  window.__claw = G;

  /* ── boot ───────────────────────────────────────────────────────────────────────────────────────── */
  async function boot() {
    const bar = $('#loading .bar i');
    try { await Promise.race([document.fonts.load('800 100px "Baloo 2"'), A.sleep(2500)]); } catch (e) { /* fallback font */ }
    bar.style.width = '30%';
    S.init($('#stage'), { preserve: qs.has('preserve') });
    machine = Machine.build(); claw = machine.claw;
    S.machine = machine; S.scene.add(machine.group);
    FX.init($('#fx'));
    bar.style.width = '55%';
    await A.sleep(20);
    await Friends.load();
    for (const k of Friends.KINDS) { G.all[k] = Friends.build(k); G.icons[k] = G.all[k].icon; }
    bar.style.width = '85%';
    beam = makeBeam(); machine.group.add(beam);
    burst = makeBurst(); S.scene.add(burst);
    S.onResize = layout;
    S.resize();
    setupPlushes();
    buildTray();
    S.onTick.push(tick);
    S.start();
    bindInput();
    await A.sleep(60);
    bar.style.width = '100%';
    await A.sleep(250);
    app.classList.remove('booting');
    G.busy = false;
    window.__ready = true;
  }

  /* the soft guide light from the claw down to the plush it would grab */
  function makeBeam() {
    const tex = Mats.tex(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,240,150,0.0)'); gr.addColorStop(0.15, 'rgba(255,240,150,0.55)'); gr.addColorStop(1, 'rgba(255,240,150,0.0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const m = new T.Mesh(new T.CylinderGeometry(0.1, 0.5, 1, 32, 1, true), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, opacity: 0 }));
    m.renderOrder = 5; m.visible = false;
    return m;
  }

  /* the prize's sun-burst: turning rays behind the friend — in 3D, so the friend stays in front of it */
  function makeBurst() {
    const tex = Mats.tex(512, 512, (g, w, h) => {
      g.save(); g.translate(w / 2, h / 2);
      const n = 18;
      g.fillStyle = 'rgba(255,244,176,0.95)';
      for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, w / 2, i * 2 * Math.PI / n, (i * 2 + 1) * Math.PI / n); g.closePath(); g.fill(); }
      g.globalCompositeOperation = 'destination-in';
      const m = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.35, 'rgba(0,0,0,0.85)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = m; g.fillRect(-w / 2, -h / 2, w, h);
      g.globalCompositeOperation = 'source-over';
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      glow.addColorStop(0, 'rgba(255,252,226,0.9)'); glow.addColorStop(0.32, 'rgba(255,240,170,0.38)'); glow.addColorStop(1, 'rgba(255,240,170,0)');
      g.fillStyle = glow; g.fillRect(-w / 2, -h / 2, w, h);
      g.restore();
    });
    const grp = new T.Group();
    const disc = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    disc.renderOrder = 3;
    grp.add(disc); grp.visible = false; grp.userData.disc = disc;
    return grp;
  }
  function burstTo(on) {
    const m = burst.userData.disc.material, o0 = m.opacity;
    if (on) burst.visible = true;
    return S.tween(on ? 350 : 300, k => (m.opacity = lerp(o0, on ? 0.95 : 0, k)), on ? 'out' : 'in').then(() => { if (!on) burst.visible = false; });
  }

  /* 6 friends on the 6 seats: one for every sound (m a s t) + 2 more — at least one c/d/f friend, the other any of
     the rest (the second m or t friend, or another c/d/f) */
  function setupPlushes() {
    for (const p of Object.values(G.all)) { if (p.root.parent) p.root.parent.remove(p.root); p.hold(false); p.st.cheer = 0; p.excite(0); }
    const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);
    const fixed = qs.get('kinds');
    let kinds;
    if (fixed) kinds = fixed.split(',');
    else {
      const m2 = shuffle(POOL.m), t2 = shuffle(POOL.t), o = shuffle(OTHERS);
      kinds = [m2[0], 'ant', 'seal', t2[0], o[0], shuffle([m2[1], t2[1], ...o.slice(1)])[0]];
      kinds = shuffle(kinds);
    }
    G.inMachine = [];
    machine.slots.forEach((s, i) => {
      const p = G.all[kinds[i]];
      if (!p) return;
      p.root.position.set(s.x, s.y, s.z);
      p.root.rotation.set(0, 0, 0);                    // the picture turns to the camera by itself
      p.root.scale.setScalar(PS);
      p.home = { x: s.x, y: s.y, z: s.z, ry: p.root.rotation.y };
      p.x = s.x; p.z = s.z;
      machine.group.add(p.root);
      G.inMachine.push(p);
    });
  }
  function buildTray() {
    $('#tray').innerHTML = LETTERS.map(() => '<div class="slot"></div>').join('');
  }

  /* ── layout: CSS variables from the 3D machine (HTML bits hang round it) ─────────────────────────── */
  function layout(w, h) {
    if (!machine) return;
    const M = machine, top = M.H + 1.02, zf = M.D / 2 + 0.1 + 0.39;
    const L = S.project(V(-(M.W + 0.95) / 2, top, zf)), R = S.project(V((M.W + 0.95) / 2, top, zf)), C = S.project(V(0, top, zf));
    const mw = R.x - L.x, mu = mw / 125.07;
    const st = app.style;
    st.setProperty('--mx', C.x + 'px'); st.setProperty('--mt', C.y + 'px'); st.setProperty('--mu', mu + 'px');
    const d = S.project(M.dropPoint()), j = S.project(M.joyPoint());
    st.setProperty('--dropX', d.x + 'px'); st.setProperty('--dropY', Math.min(h - 10 * mu, d.y) + 'px');
    st.setProperty('--joyX', j.x + 'px'); st.setProperty('--joyY', j.y + 'px');
  }

  /* ── per frame ──────────────────────────────────────────────────────────────────────────────────── */
  let trailT = 0;
  function tick(dt, t) {
    machine.tick(dt, t);
    for (const p of Object.values(G.all)) if (p.root.parent) p.update(dt, t);
    // the claw follows the aim (title: wanders)
    if (G.screen === 'title' && !G.busy) G.aimX = Math.sin(t * 0.45) * 2.4;
    if (!G.busy && (G.screen === 'title' || G.screen === 'game')) {
      const k = G.keys.r - G.keys.l + G.joy;
      if (k) { G.aimX += k * 2.6 * dt; G.idle = 0; }
      G.aimX = Math.max(machine.X_MIN, Math.min(machine.X_MAX, G.aimX));
      const dx = G.aimX - claw.x, maxV = 2.8 * dt;
      const nx = claw.x + Math.max(-maxV, Math.min(maxV, dx * Math.min(1, dt * 9)));
      const moving = Math.abs(nx - claw.x) > 0.0015;
      claw.set(nx, claw.y, lerp(claw.z, 0.15, Math.min(1, dt * 3)));
      if (G.screen === 'game') {
        A.motor(moving, 1);
        if (moving && (trailT -= dt) < 0) { trailT = 0.05; const p = S.project(claw.holdWorld()); FX.sparkle(p.x, p.y - 20, 1, 3); }
      }
    }
    // who's under the claw: it looks up and bounces; the guide light reaches down to it
    const cand = G.screen === 'game' && !G.busy ? candidate() : null;
    for (const p of G.inMachine) {
      const on = p === cand;
      p.excite(on ? 1 : 0);
      if (G.screen === 'game' && !G.busy) p.lookAt(on || Math.abs(p.x - claw.x) < 1.6 ? claw.holdWorld() : null);
      else if (!G.busy) p.lookAt(null);
    }
    if (cand) {
      const top = cand.root.position.y + cand.top * PS, tipY = claw.y - 0.8;
      const hgt = Math.max(0.2, tipY - top + 0.1);
      beam.visible = true; beam.position.set(cand.x, top - 0.1 + hgt / 2, cand.z); beam.scale.set(0.9, hgt, 0.9);
      beam.material.opacity = lerp(beam.material.opacity, 0.5, Math.min(1, dt * 6));
    } else if (beam.visible) {
      beam.material.opacity = lerp(beam.material.opacity, 0, Math.min(1, dt * 8));
      if (beam.material.opacity < 0.02) beam.visible = false;
    }
    // "DOWN!" when the claw rests over a friend
    if (G.screen === 'game' && !G.busy) {
      G.idle += dt;
      $('#downHint').classList.toggle('show', !!cand && G.idle > (G.round === 0 && G.tries === 0 ? 1.0 : 3.5) && Math.abs(G.aimX - claw.x) < 0.02);
      $('#drop').classList.toggle('ready', !!cand);
    } else $('#downHint').classList.remove('show');
    // the round's clock
    if (G.timerOn) {
      G.time = Math.max(0, G.time - dt);
      const sec = Math.ceil(G.time);
      if (sec !== G.shownSec) {
        G.shownSec = sec; $('#time').textContent = sec + 's';
        $('#timeBox').classList.toggle('low', sec <= 10);
        if (sec <= 10 && sec > 0) A.sfxPlay('tick');
        const hand = document.getElementById('watchHand');
        if (hand) hand.setAttribute('transform', `rotate(${(1 - G.time / ROUND_SEC) * 360} 32 36)`);
      }
      if (G.time <= 0) { G.timerOn = false; timeUp(); }
    }
    if (burst.visible) { burst.lookAt(S.camera.position); burst.userData.disc.rotation.z += dt * 0.45; }
    FX.tick(dt);
  }
  function candidate() {
    let best = null, bd = 0.56;
    for (const p of G.inMachine) { const d = Math.abs(p.x - claw.x); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  /* ── input ──────────────────────────────────────────────────────────────────────────────────────── */
  function bindInput() {
    // the first touch on the title: music + "Hi, friends! Welcome to Toy Catch! … Press start to play!"
    let greeted = false;
    const firstTouch = (e) => {
      A.unlock();
      if (greeted || G.screen !== 'title' || G.busy) return;
      greeted = true; A.startBgm();
      if (!(e.target.closest && e.target.closest('#start'))) A.seq(['t:hello', 200, 't:pressstart']);
    };
    window.addEventListener('pointerdown', firstTouch, { capture: true });
    const lt = $('#btnLang');
    const showLang = () => { lt.dataset.l = A.lang; lt.setAttribute('aria-pressed', A.lang === 'ko'); lt.querySelectorAll('.flag').forEach(f => f.classList.toggle('on', f.dataset.l === A.lang)); };
    showLang();
    lt.addEventListener('click', () => { A.setLang(A.lang === 'ko' ? 'en' : 'ko'); showLang(); A.sfxPlay('tap'); A.stopVoice(); A.say('t:pressstart'); });
    $('#start').addEventListener('click', () => { A.unlock(); startGame(); });
    $('#drop').addEventListener('click', () => drop());
    $('#tgSnd').addEventListener('click', () => { if (G.screen === 'game' && G.target) { $('#tgSnd').classList.remove('play'); void $('#tgSnd').offsetWidth; $('#tgSnd').classList.add('play'); announce(G.target, true); } });
    $('#btnSound').addEventListener('click', () => { A.setMuted(!A.muted); app.classList.toggle('muted', A.muted); });
    app.classList.toggle('muted', A.muted);
    $('#btnExit').addEventListener('click', () => {
      if (G.screen === 'title') { if (history.length > 1) history.back(); return; }
      goTitle();
    });
    $('#btnAgain').addEventListener('click', () => startGame(true));
    $('#btnHome').addEventListener('click', () => goTitle());
    // joystick: drag sideways
    const jh = $('#joyHit');
    let jp = null;
    jh.addEventListener('pointerdown', e => { if (G.screen !== 'game') return; jp = { id: e.pointerId, x: e.clientX }; try { jh.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ } interact(); e.preventDefault(); });
    jh.addEventListener('pointermove', e => { if (!jp || e.pointerId !== jp.id) return; const mu = parseFloat(app.style.getPropertyValue('--mu')) || 8; G.joy = Math.max(-1, Math.min(1, (e.clientX - jp.x) / (7 * mu))); machine.setJoy(G.joy); });
    const jend = e => { if (jp && e.pointerId === jp.id) { jp = null; G.joy = 0; machine.setJoy(0); } };
    jh.addEventListener('pointerup', jend); jh.addEventListener('pointercancel', jend);
    // drag / tap inside the machine: the claw follows the finger; a tap on a friend sends the claw over it
    const cv = $('#stage');
    let drag = null;
    const xAt = (cx, cy) => { const p = S.onPlane(cx, cy, new T.Plane(V(0, 0, 1), -0.15)); return p ? machine.group.worldToLocal(p).x : null; };
    cv.addEventListener('pointerdown', e => {
      if (G.screen !== 'game' || G.busy) return;
      // the first friend whose picture (not its see-through corner) is under the finger
      const hit = S.hits(e.clientX, e.clientY, G.inMachine.map(p => p.root)).find(h => { const q = h.object.userData.plush; return q && q.alphaAt(h.uv) > 80; });
      const p = hit ? hit.object.userData.plush : null;
      interact();
      if (p) { G.aimX = p.x; A.sfxPlay('tap'); drag = null; return; }
      const x = xAt(e.clientX, e.clientY);
      const glassTop = S.project(V(0, machine.H, 0)).y, floorY = S.project(V(0, 0, machine.D / 2)).y;
      if (x == null || e.clientY < glassTop || e.clientY > floorY + 20) return;
      drag = { id: e.pointerId }; G.aimX = x;
      try { cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
    });
    cv.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id || G.busy) return; const x = xAt(e.clientX, e.clientY); if (x != null) G.aimX = x; G.idle = 0; });
    const cend = e => { if (drag && e.pointerId === drag.id) drag = null; };
    cv.addEventListener('pointerup', cend); cv.addEventListener('pointercancel', cend);
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') { G.keys.l = 1; interact(); }
      else if (e.key === 'ArrowRight' || e.key === 'd') { G.keys.r = 1; interact(); }
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault(); A.unlock();
        if (G.screen === 'title') startGame(); else if (G.screen === 'game') drop(); else if (G.screen === 'result') startGame(true);
      }
    });
    window.addEventListener('keyup', e => { if (e.key === 'ArrowLeft' || e.key === 'a') G.keys.l = 0; if (e.key === 'ArrowRight' || e.key === 'd') G.keys.r = 0; });
  }
  function interact() { G.idle = 0; G.interacted = true; stopHint(); $('#downHint').classList.remove('show'); }

  /* ── flow ───────────────────────────────────────────────────────────────────────────────────────── */
  function setScreen(s) { G.screen = s; app.dataset.screen = s; }
  function setDrop(on) { $('#drop').classList.toggle('off', !on); }
  const sleep = ms => S.wait(ms);
  function dolly(to, ms) {
    const from = S.frame.push;
    return S.tween(ms, k => { S.frame.push = lerp(from, to, k); S.resize(); }, 'inOut');
  }

  async function startGame(again) {
    if (G.busy && G.screen !== 'result') return;
    if (G.screen === 'game') return;
    const tok = ++G.tok;
    G.busy = true;
    A.unlock(); A.startBgm();
    A.stopVoice();
    if (again) { setScreen('title'); await sleep(250); setupPlushes(); claw.set(claw.x, claw.HOME_Y, claw.z); }
    app.classList.add('coin');
    // the coin flips in and drops into the slot
    const slot = machine.slotPoint(), coin = machine.coin;
    const sp = slot.clone(), local = machine.group.worldToLocal(sp.clone());
    coin.visible = true;
    await S.tween(900, k => {
      const y = local.y + 1.4 * (1 - k) + 0.12, z = local.z + 0.35 * (1 - k);
      coin.position.set(local.x, y, z); coin.rotation.set(Math.PI / 2, 0, k * Math.PI * 5); coin.scale.setScalar(1.6 - 0.6 * k);
      if (Math.random() < 0.5) { const p = S.project(machine.group.localToWorld(coin.position.clone())); FX.sparkle(p.x, p.y, 1, 2); }
    }, 'in', tok);
    if (tok !== G.tok) return;
    A.sfxPlay('coin');
    const p = S.project(slot); FX.sparkle(p.x, p.y, 14, 4); FX.stars(p.x, p.y, 8);
    await S.tween(220, k => { coin.position.y = local.y + 0.12 - 0.2 * k; coin.scale.setScalar(1 - 0.4 * k); }, 'in', tok);
    coin.visible = false;
    machine.setScreen(['INSERTED!', 'READY TO PLAY!'], '#ffd23f');
    machine.chase(2.5); A.sfxPlay('insert');
    A.say('t:ready');
    await sleep(500);
    if (tok !== G.tok) return;
    app.classList.remove('coin');
    setScreen('game');
    G.score = 0; G.caught = []; G.round = -1; G.tries = 0;
    $('#score').textContent = '0';
    buildTray();
    const order = (qs.get('order') || '').split(',').filter(x => LETTERS.includes(x));
    G.targets = order.length ? order : LETTERS.slice().sort(() => Math.random() - 0.5);
    G.aimX = 0;
    await dolly(1, 1000);
    if (tok !== G.tok) return;
    nextRound(tok);
  }

  async function nextRound(tok) {
    G.round++;
    if (G.round >= G.targets.length) return finish(tok);
    G.target = G.targets[G.round]; G.tries = 0; G.time = ROUND_SEC; G.shownSec = -1;
    machine.setScreen(['FIND', G.target.toUpperCase() + ' ' + G.target], '#ff8fd0');
    setTarget(G.target);
    [...$('#tray').children].forEach((s, i) => s.classList.toggle('now', i === G.caught.length && i === G.round - (G.round - G.caught.length)));
    $('#timeBox').classList.remove('low');
    $('#time').textContent = ROUND_SEC + 's';
    const go = $('#go'); go.classList.remove('show'); void go.offsetWidth; go.classList.add('show');
    A.sfxPlay('pop');
    await announce(G.target);
    if (tok !== G.tok) return;
    G.busy = false; G.timerOn = true; G.idle = 0; setDrop(true);
    if (G.round === 0 && !G.interacted && !qs.has('nohint')) runHint(tok);
  }
  function setTarget(L) {
    const up = L.toUpperCase();
    $('#tgLetter').textContent = up + L;
    $('#tgSub').textContent = `CATCH THE ‘${up}’!`;
    const tg = $('#target'); tg.classList.remove('swap'); void tg.offsetWidth; tg.classList.add('swap');
    const le = $('#tgLetter'); le.classList.remove('pop'); void le.offsetWidth; le.classList.add('pop');
  }
  /* "Catch a friend that starts with /m/" (Korean: "/m/ 소리로 시작하는 친구를 뽑아 봐!") */
  async function announce(L, again) {
    A.stopVoice();
    if (A.lang === 'ko') return A.seq([`s:${L}`, 't:find']);
    return A.seq(['t:find', `s:${L}`, again ? null : 250, again ? null : `s:${L}`]);
  }

  async function drop() {
    if (G.screen !== 'game' || G.busy) return;
    const tok = G.tok;
    G.busy = true; G.timerOn = false; interact(); setDrop(false);
    $('#timeBox').classList.add('paused');
    const btn = $('#drop'); btn.classList.add('press'); setTimeout(() => btn.classList.remove('press'), 150);
    A.sfxPlay('tap');
    const cand = candidate();
    const x0 = claw.x, z0 = claw.z, g0 = claw.grip;
    const tx = cand ? cand.x : claw.x, tz = cand ? cand.z : claw.z;
    // the prongs will close until their knuckles touch the sides of the head; the hub stops where that puts the
    // knuckles level with the head's middle (and never lower than just over the head)
    const hy = cand ? cand.headR[1] * PS : 0, hx = cand ? cand.headR[0] * PS : 0;
    const shut = cand ? claw.gripAngle(hx * 1.02) : claw.SHUT;
    const yHead = cand ? cand.root.position.y + cand.gripY * PS : 0;
    const yBot = cand ? Math.max(yHead + claw.knuckleDrop(shut), yHead + hy + 0.03) : 1.45;
    if (cand) { cand.lookAt(claw.holdWorld()); cand.excite(1); }
    A.motor(true, 0.8);
    await S.tween(1300, k => {
      const kk = Math.min(1, k * 1.7);
      claw.set(lerp(x0, tx, kk), lerp(claw.HOME_Y, yBot, k), lerp(z0, tz, kk));
      claw.setGrip(lerp(g0, claw.OPEN, Math.min(1, k * 2.2)));
    }, 'inOut', tok);
    A.motor(false);
    if (tok !== G.tok) return;
    A.sfxPlay('grab');
    await S.tween(360, k => claw.setGrip(lerp(claw.OPEN, shut, k)), 'out', tok);
    if (cand) attach(cand);
    await sleep(120);
    A.motor(true, 1.2);
    await S.tween(1200, k => claw.set(tx, lerp(yBot, claw.HOME_Y, k), tz), 'inOut', tok);
    A.motor(false);
    if (tok !== G.tok) return;
    if (!cand) {
      A.sfxPlay('whiff');
      await A.say('t:miss');
      return resume(tok);
    }
    if (cand.sound === G.target) await correct(cand, tok);
    else await wrong(cand, tok);
  }
  function attach(p) {
    claw.swing.attach(p.root);                      // keeps where it is: the claw came down right over it
    const rq = p.root.quaternion.clone(), q0 = new T.Quaternion();
    S.tween(300, k => p.root.quaternion.slerpQuaternions(rq, q0, k), 'out');
    p.hold(true); p.lookAt(null); p.excite(0);
    G.inMachine = G.inMachine.filter(o => o !== p);
  }
  function detach(p) { machine.group.attach(p.root); p.hold(false); }
  function resume(tok) {
    if (tok !== G.tok) return;
    G.busy = false; G.timerOn = G.time > 0; G.idle = 0; setDrop(true);
    $('#timeBox').classList.remove('paused');
    G.aimX = claw.x;
  }
  function plushScreen(p, dy = 0) { return S.project(p.root.getWorldPosition(V(0, 0, 0)).add(V(0, p.gripY + dy, 0))); }

  async function correct(p, tok) {
    const sp = plushScreen(p);
    FX.confetti(sp.x, sp.y, 130); FX.stars(sp.x, sp.y, 16);
    A.sfxPlay('fanfare'); machine.chase(3.5);
    for (const o of G.inMachine) o.cheer(2.6);
    p.cheer(3);
    const gain = 100 + (G.tries === 0 ? 50 : 0);
    countScore(G.score, G.score + gain); G.score += gain;
    const fw = () => { const r = S.project(V(lerp(-3, 3, Math.random()), lerp(2.4, 3.8, Math.random()), 0)); FX.firework(r.x, r.y); A.sfxPlay('pop'); };
    fw(); setTimeout(fw, 350); setTimeout(fw, 700);
    await A.say('t:great3');
    if (tok !== G.tok) return;
    // to the chute: up and forward over the front row first, then along the front to the left corner
    A.motor(true, 1.1);
    const x0 = claw.x, z0 = claw.z, ch = machine.chute, lane = machine.FRONT_LANE;
    await S.tween(650, k => claw.set(x0, lerp(claw.HOME_Y, claw.CARRY_Y, k), lerp(z0, lane, k)), 'inOut', tok);
    await S.tween(1100, k => claw.set(lerp(x0, ch.x, k), claw.CARRY_Y, lerp(lane, ch.z, k)), 'inOut', tok);
    A.motor(false);
    if (tok !== G.tok) return;
    A.sfxPlay('open');
    const g0 = claw.grip;
    S.tween(300, k => claw.setGrip(lerp(g0, claw.OPEN * 0.7, k)), 'out');
    detach(p);
    const y0 = p.root.position.y, ry0 = p.root.rotation.y;
    await S.tween(650, k => { p.root.position.y = lerp(y0, ch.floor, k); p.root.rotation.y = ry0 + k * 2.5; p.root.scale.setScalar(PS * (1 - 0.35 * k)); }, 'in', tok);
    A.sfxPlay('chute');
    machine.group.remove(p.root);
    G.caught.push(p.kind);
    await prize(p, tok);
    if (tok !== G.tok) return;
    G.aimX = 0;
    A.motor(true, 1);
    const cx = claw.x, cz = claw.z;
    await S.tween(900, k => claw.set(lerp(cx, 0, k), lerp(claw.CARRY_Y, claw.HOME_Y, k), lerp(cz, 0.15, k)), 'inOut', tok);
    A.motor(false);
    claw.setGrip(claw.OPEN * 0.55);
    nextRound(tok);
  }
  /* the prize pops out in front of the machine, big, with its word; then it flies into the tray */
  async function prize(p, tok) {
    const cam = S.camera;
    const at = (fx, fy, dist) => { const v = V(fx * 2 - 1, -(fy * 2 - 1), 0.5).unproject(cam); return cam.position.clone().add(v.sub(cam.position).normalize().multiplyScalar(dist)); };
    S.scene.add(p.root);
    p.root.rotation.set(0, 0, 0); p.hold(false); p.cheer(3.5);
    const start = machine.group.localToWorld(V(machine.chute.x, -0.6, machine.D / 2 + 1.2));
    const end = at(0.5, 0.56, 7.5);
    end.y -= 0.75;
    A.sfxPlay('prize');
    await S.tween(700, k => {
      const pos = start.clone().lerp(end, k); pos.y += Math.sin(k * Math.PI) * 1.4;
      p.root.position.copy(pos); p.root.scale.setScalar(lerp(0.5, 1.4, k));   // its cap stays under the CATCH banner p.root.rotation.y = (1 - k) * Math.PI * 2;
    }, 'out', tok);
    p.root.lookAt(cam.position.x, p.root.position.y, cam.position.z);
    const mid = p.root.position.clone().add(V(0, p.top * p.root.scale.y * 0.5, 0));
    burst.position.copy(mid).addScaledVector(mid.clone().sub(cam.position).normalize(), 0.9);
    burst.scale.setScalar(p.top * p.root.scale.y * 2.3);
    burstTo(true);
    const box = $('#prize'), wordEl = $('#prizeWord');
    wordEl.innerHTML = `<b>${p.word[0]}</b>${p.word.slice(1)}`;
    box.classList.add('show');
    const sp = S.project(p.root.position.clone().add(V(0, 1, 0)));
    FX.stars(sp.x, sp.y, 12);
    const b = wordEl.querySelector('b');
    const bump = () => { b.classList.remove('say'); void b.offsetWidth; b.classList.add('say'); };
    bump(); await A.say(`s:${p.sound}`); await A.sleep(120);
    bump(); await A.say(`s:${p.sound}`); await A.sleep(150);
    wordEl.classList.add('all'); await A.say(`w:${p.word}`);
    await sleep(500);
    if (tok !== G.tok) { box.classList.remove('show'); burstTo(false); return; }
    box.classList.remove('show'); burstTo(false);
    // into the tray
    const slot = $('#tray').children[G.caught.length - 1];
    const sr = slot.getBoundingClientRect();
    const fly = document.createElement('img');
    fly.src = G.icons[p.kind];
    const p0 = S.project(p.root.position.clone().add(V(0, 0.9, 0)));
    const size = Math.max(120, sr.width * 2.6);
    Object.assign(fly.style, { position: 'absolute', zIndex: 25, left: p0.x - size / 2 + 'px', top: p0.y - size / 2 + 'px', width: size + 'px', height: size + 'px', pointerEvents: 'none' });
    app.appendChild(fly);
    S.scene.remove(p.root);
    const anim = fly.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${sr.left + sr.width / 2 - p0.x}px, ${sr.top + sr.height / 2 - p0.y}px) scale(${sr.width * 1.15 / size})` }], { duration: 650, easing: 'cubic-bezier(.5,0,.3,1)' });
    await anim.finished.catch(() => {});
    fly.remove();
    slot.innerHTML = `<img src="${G.icons[p.kind]}" alt="${p.word}">`; slot.classList.add('got'); slot.classList.remove('now');
    A.sfxPlay('sparkle');
  }

  async function wrong(p, tok) {
    A.sfxPlay('uhoh'); p.nope(1.4);
    const x0 = claw.x;
    S.tween(600, k => claw.set(x0 + Math.sin(k * Math.PI * 6) * 0.06 * (1 - k), claw.y, claw.z), 'linear');
    await A.say('t:uhoh');
    await A.say(`w:${p.word}`);
    if (tok !== G.tok) return;
    await A.seq(['t:startswith', `s:${p.sound}`]);   // ko: "첫소리는 /t/"
    if (tok !== G.tok) return;
    // it slips out of the claw and drops back onto its seat
    A.sfxPlay('open');
    const g0 = claw.grip;
    S.tween(250, k => claw.setGrip(lerp(g0, claw.OPEN * 0.6, k)), 'out');
    detach(p);
    const from = p.root.position.clone(), q0 = p.root.quaternion.clone(), qh = new T.Quaternion().setFromEuler(new T.Euler(0, p.home.ry, 0));
    await S.tween(800, k => {
      p.root.position.set(lerp(from.x, p.home.x, k), lerp(from.y, p.home.y, S.EASE.bounce(k)), lerp(from.z, p.home.z, k));
      p.root.quaternion.slerpQuaternions(q0, qh, Math.min(1, k * 1.5));
    }, 'linear', tok);
    A.sfxPlay('thud');
    p.root.position.set(p.home.x, p.home.y, p.home.z);
    G.inMachine.push(p);
    G.tries++;
    if (tok !== G.tok) return;
    await A.say('t:again');
    if (tok !== G.tok) return;
    await A.say(`s:${G.target}`);
    claw.setGrip(claw.OPEN * 0.55);
    resume(tok);
  }

  async function timeUp() {
    const tok = G.tok;
    G.busy = true; setDrop(false);
    A.sfxPlay('buzz');
    const big = $('#bigMsg'); big.textContent = 'TIME’S UP!'; big.classList.remove('show'); void big.offsetWidth; big.classList.add('show');
    await A.say('t:timeup');
    const right = G.inMachine.filter(p => p.sound === G.target);
    right.forEach(p => p.cheer(2.4));
    for (const p of right.slice(0, 1)) { await A.seq([`s:${p.sound}`, `w:${p.word}`]); }
    await sleep(600);
    if (tok !== G.tok) return;
    nextRound(tok);
  }

  async function finish(tok) {
    G.busy = true; G.timerOn = false; setDrop(false);
    await dolly(0, 900);
    if (tok !== G.tok) return;
    setScreen('result');
    const n = G.caught.length;
    const all = n >= LETTERS.length;
    const stars = all ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0;
    [...$('#stars').children].forEach((s, i) => s.classList.toggle('on', i < stars));
    $('#rbText').textContent = all ? 'PERFECT!' : n >= 2 ? 'GREAT JOB!' : 'NICE TRY!';
    $('#finalScore').textContent = G.score;
    $('#caught').innerHTML = G.targets.map((L, i) => {
      const k = G.caught.find(kind => G.all[kind].sound === L);
      return k ? `<div class="slot got"><img src="${G.icons[k]}" alt=""><em><b>${G.all[k].word[0]}</b>${G.all[k].word.slice(1)}</em></div>` : `<div class="slot">${L}</div>`;
    }).join('');
    machine.setScreen(['GREAT', 'JOB!'], '#ffd23f'); machine.chase(4);
    A.sfxPlay('win'); FX.rain(160);
    await A.say(all ? 't:allcaught' : 't:result');
    if (tok !== G.tok) return;
    await A.say('t:playagain');
    G.busy = false;
  }

  function goTitle() {
    G.tok++; S.killTweens(); A.stopVoice(); A.motor(false);
    G.busy = false; G.timerOn = false; stopHint();
    $('#prize').classList.remove('show'); burst.visible = false; burst.userData.disc.material.opacity = 0;
    for (const p of Object.values(G.all)) { if (p.root.parent) p.root.parent.remove(p.root); }
    setupPlushes();
    claw.set(claw.x, claw.HOME_Y, 0.15); claw.setGrip(claw.OPEN * 0.55);
    machine.setScreen(['LEVEL 1', 'M A S T']);
    machine.coin.visible = false;
    app.classList.remove('coin');
    setScreen('title');
    S.frame.push = 0; S.resize();
  }

  function countScore(a, b) {
    const el = $('#score'), box = el.parentElement;
    box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
    S.tween(700, k => (el.textContent = Math.round(lerp(a, b, k))), 'out');
  }

  /* ── the hint glove: drag the joystick, then press DOWN (first round, until the child touches) ─── */
  let hintAnim = null;
  async function runHint(tok) {
    const hand = $('#hand');
    await sleep(900);
    if (tok === G.tok && !G.interacted) A.say('t:howto');
    while (tok === G.tok && !G.interacted && G.screen === 'game') {
      const mu = parseFloat(app.style.getPropertyValue('--mu')) || 8;
      const jx = parseFloat(app.style.getPropertyValue('--joyX')), jy = parseFloat(app.style.getPropertyValue('--joyY'));
      const dx = parseFloat(app.style.getPropertyValue('--dropX')), dy = parseFloat(app.style.getPropertyValue('--dropY'));
      const W2 = hand.offsetWidth * 0.38;
      hand.classList.add('on');
      $('#joyHit').classList.add('hint');
      hintAnim = hand.animate([
        { transform: `translate(${jx - W2}px, ${jy}px)` },
        { transform: `translate(${jx - W2 - 6 * mu}px, ${jy}px)`, offset: 0.2 },
        { transform: `translate(${jx - W2 + 6 * mu}px, ${jy}px)`, offset: 0.4 },
        { transform: `translate(${jx - W2}px, ${jy}px)`, offset: 0.5 },
        { transform: `translate(${dx - W2}px, ${dy}px)`, offset: 0.72 },
        { transform: `translate(${dx - W2}px, ${dy + 1.6 * mu}px) scale(.94)`, offset: 0.8 },
        { transform: `translate(${dx - W2}px, ${dy}px)`, offset: 0.88 },
        { transform: `translate(${dx - W2}px, ${dy}px)` },
      ], { duration: 3600, easing: 'ease-in-out' });
      await hintAnim.finished.catch(() => {});
      if (tok !== G.tok || G.interacted) break;
      await sleep(1600);
    }
    stopHint();
  }
  function stopHint() {
    if (hintAnim) { try { hintAnim.cancel(); } catch (e) { /* done */ } hintAnim = null; }
    $('#hand').classList.remove('on'); $('#joyHit').classList.remove('hint');
  }

  window.__clawApi = { G, drop, startGame, goTitle, candidate, nextRound: () => nextRound(G.tok), get machine() { return machine; } };
  boot().catch(e => { console.error(e); const l = $('#loading'); if (l) l.innerHTML = '<p style="font:700 20px sans-serif;color:#234">Could not start: ' + e.message + '</p>'; });
})();
