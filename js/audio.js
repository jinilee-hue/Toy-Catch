/* Toy Catch — sound: voice clips (official FPR K letter sounds and words + the company-TTS boy voice for
 * the game lines), synthesized machine effects (motor whirr, clunks, coin, chute, fanfare) and the music loop.
 * Clips play from base64 (js/voice-data.js, js/bgm-data.js) so the game also works from file://.
 */
(function () {
  'use strict';
  const V = window.CLAW_VOICE || { clips: {} }, VD = window.CLAW_VOICE_DATA || {};
  const A = { ctx: null, master: null, sfx: null, voice: null, bgm: null, muted: false, buffers: {}, playing: new Set(), talking: 0, bgmOn: false, bgmLevel: 0.11, lang: 'en' };
  try { A.muted = localStorage.getItem('claw-muted') === '1'; A.lang = localStorage.getItem('claw-lang') === 'ko' ? 'ko' : 'en'; } catch (e) { /* private mode */ }
  A.setLang = function (l) { A.lang = l === 'ko' ? 'ko' : 'en'; try { localStorage.setItem('claw-lang', A.lang); } catch (e) { /* ignore */ } };
  A.has = key => !!V.clips[A.voiceKey(key)];
  /* 't:x' plays the Korean take 'k:x' in Korean when there is one */
  A.voiceKey = key => (A.lang === 'ko' && key.startsWith('t:') && V.clips['k:' + key.slice(2)]) ? 'k:' + key.slice(2) : key;
  A.unlock = function () {
    if (!A.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      A.ctx = new C();
      A.master = A.ctx.createGain(); A.master.gain.value = A.muted ? 0 : 1; A.master.connect(A.ctx.destination);
      A.sfx = A.ctx.createGain(); A.sfx.gain.value = 0.5; A.sfx.connect(A.master);
      A.voice = A.ctx.createGain(); A.voice.gain.value = 1; A.voice.connect(A.master);
      A.bgm = A.ctx.createGain(); A.bgm.gain.value = 0; A.bgm.connect(A.master);
      Object.keys(V.clips).forEach(decode);
    }
    if (A.ctx.state === 'suspended') A.ctx.resume();
  };
  function b64(b) { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  function decode(key) {
    if (A.buffers[key]) return A.buffers[key];
    const d = VD[key];
    const p = d ? A.ctx.decodeAudioData(b64(d)) : fetch('assets/voice/' + V.clips[key][0]).then(r => r.arrayBuffer()).then(x => A.ctx.decodeAudioData(x));
    A.buffers[key] = p.catch(e => { console.warn('voice', key, e); return null; });
    return A.buffers[key];
  }
  /* one clip → resolves true when it ends (false: stopped / missing) */
  A.say = async function (key, opts = {}) {
    key = A.voiceKey(key);
    if (!A.ctx || !V.clips[key]) return false;
    const buf = await decode(key);
    if (!buf) return false;
    const [, start, gain, dur] = V.clips[key];
    return new Promise(res => {
      const src = A.ctx.createBufferSource(); src.buffer = buf;
      const g = A.ctx.createGain(); g.gain.value = gain * (opts.gain || 1);
      src.connect(g); g.connect(A.voice);
      const item = { src, res, key };
      A.playing.add(item); talk(+1);
      src.onended = () => { if (A.playing.delete(item)) { talk(-1); res(true); } };
      src.start(0, start, Math.max(0.05, dur));
    });
  };
  /* several clips in a row (a gap between) */
  A.seq = async function (keys, gap = 90) {
    for (const k of keys) {
      if (k == null) continue;
      if (typeof k === 'number') { await sleep(k); continue; }
      const ok = await A.say(k);
      if (ok === false && A.stopped) return false;
      await sleep(gap);
    }
    return true;
  };
  /* stop every voice clip — or only one line (key, e.g. 't:howto' when SKIP cuts the guide: the target sound the child
     may have asked for again keeps playing) */
  A.stopVoice = function (only) {
    const k = only ? A.voiceKey(only) : null;
    if (!k) { A.stopped = true; setTimeout(() => (A.stopped = false), 0); }
    for (const it of A.playing) {
      if (k && it.key !== k) continue;
      try { it.src.onended = null; it.src.stop(); } catch (e) { /* stopped */ }
      A.playing.delete(it); talk(-1); it.res(false);
    }
  };
  function talk(d) { A.talking = Math.max(0, A.talking + d); duck(); }
  function duck() {
    if (!A.bgm) return;
    const t = A.ctx.currentTime, v = A.bgmOn ? (A.talking ? 0.35 : 1) * A.bgmLevel : 0;
    A.bgm.gain.cancelScheduledValues(t); A.bgm.gain.setTargetAtTime(v, t, 0.12);
  }
  A.setMuted = function (m) {
    A.muted = m;
    try { localStorage.setItem('claw-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (A.master) A.master.gain.setTargetAtTime(m ? 0 : 1, A.ctx.currentTime, 0.03);
  };

  // ── synthesized effects ─────────────────────────────────────────────────────────────────────────────
  function env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function osc(type, f0, f1, t, dur, peak, dest) {
    const o = A.ctx.createOscillator(), g = A.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.006, dur, peak); o.connect(g); g.connect(dest || A.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function noise(t, dur, peak, freq, q, type) {
    if (!noiseBuf) { noiseBuf = A.ctx.createBuffer(1, A.ctx.sampleRate, A.ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = A.ctx.createBufferSource(), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
    s.buffer = noiseBuf; f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    env(g, t, 0.004, dur, peak); s.connect(f); f.connect(g); g.connect(A.sfx); s.start(t, Math.random() * 0.5, dur + 0.05);
  }
  A.sfxPlay = function (name) {
    if (!A.ctx) return;
    const t = A.ctx.currentTime + 0.01;
    switch (name) {
      case 'tap': osc('triangle', 620, 300, t, 0.08, 0.45); break;
      case 'tick': osc('square', 1500, 0, t, 0.035, 0.08); break;
      case 'pop': osc('sine', 320, 980, t, 0.13, 0.5); break;
      case 'sparkle': [0, 0.06, 0.12, 0.2].forEach((d, i) => osc('sine', 1300 + i * 280, 2500 + i * 300, t + d, 0.2, 0.14)); break;
      case 'coin':                                   // ding-ding + a little clink into the slot
        osc('square', 988, 0, t, 0.09, 0.12); osc('square', 1319, 0, t + 0.09, 0.42, 0.12);
        osc('sine', 1976, 0, t + 0.09, 0.4, 0.08); noise(t + 0.5, 0.06, 0.25, 5200, 2); osc('triangle', 2400, 1800, t + 0.52, 0.08, 0.12);
        break;
      case 'insert': [523, 659, 784, 1047, 1319].forEach((f, i) => osc('square', f, 0, t + i * 0.07, 0.12, 0.07)); break;
      case 'chink': {                                // a coin landing in the score: a short bright blip, a little higher or lower each time
        const r = 0.93 + Math.random() * 0.16;
        osc('sine', 2349 * r, 0, t, 0.12, 0.09); osc('square', 3520 * r, 0, t, 0.025, 0.02);
        break;
      }
      case 'grab':                                   // the prongs snap shut: clack + thunk
        noise(t, 0.05, 0.6, 3400, 1.4); osc('square', 180, 90, t, 0.1, 0.22); osc('triangle', 520, 260, t + 0.01, 0.12, 0.2); break;
      case 'open': noise(t, 0.04, 0.4, 2800, 1.4); osc('triangle', 300, 600, t, 0.1, 0.14); break;
      case 'whiff': noise(t, 0.3, 0.25, 900, 0.7); osc('sine', 420, 180, t, 0.35, 0.18); break;
      case 'thud': osc('sine', 150, 55, t, 0.22, 0.6); noise(t, 0.08, 0.3, 600, 0.8); break;
      case 'boing': osc('sine', 220, 560, t, 0.22, 0.4); osc('sine', 560, 280, t + 0.12, 0.3, 0.22); break;
      case 'slip':                                   // slide whistle down: it slips out of the claw
        osc('sine', 1250, 300, t, 0.5, 0.2); osc('triangle', 625, 150, t, 0.5, 0.08); noise(t, 0.12, 0.12, 2400, 1.2); break;
      case 'chute': noise(t, 0.5, 0.3, 700, 0.6); osc('sine', 600, 160, t, 0.5, 0.2); osc('sine', 140, 60, t + 0.45, 0.25, 0.5); break;
      case 'prize': [784, 988, 1175, 1568].forEach((f, i) => osc('triangle', f, 0, t + i * 0.07, 0.3, 0.2)); noise(t, 0.4, 0.12, 7000, 0.6, 'highpass'); break;
      case 'buzz': osc('sawtooth', 160, 150, t, 0.5, 0.18); osc('sawtooth', 163, 150, t, 0.5, 0.14); break;
      case 'uhoh': osc('triangle', 440, 0, t, 0.18, 0.3); osc('triangle', 330, 0, t + 0.2, 0.32, 0.3); break;
      case 'lose': [988, 784, 587].forEach((f, i) => osc('triangle', f, f * 0.94, t + i * 0.1, 0.15, 0.14)); break;   // coins going: three falling blips
      case 'fanfare':
        osc('sine', 120, 45, t, 0.3, 0.6); noise(t, 0.6, 0.14, 6500, 0.6, 'highpass');
        [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]].forEach(([f, d]) => { osc('square', f, 0, t + d, 0.16, 0.06); osc('triangle', f, 0, t + d, 0.3, 0.2); });
        [523, 659, 784, 1047].forEach(f => osc('triangle', f, 0, t + 0.48, 0.9, 0.1));
        [0.6, 0.7, 0.8, 0.9].forEach((d, i) => osc('sine', 1568 + i * 220, 0, t + d, 0.26, 0.06));
        break;
      case 'win':
        [0, 0.14, 0.28, 0.42, 0.62].forEach((d, i) => { const f = [523, 659, 784, 1047, 1319][i]; osc('square', f, 0, t + d, 0.2, 0.07); osc('triangle', f, 0, t + d, 0.4, 0.2); });
        [523, 659, 784, 1047].forEach(f => osc('triangle', f, 0, t + 0.8, 1.2, 0.1)); noise(t + 0.8, 1.0, 0.16, 7000, 0.6, 'highpass');
        break;
      default: break;
    }
  };
  /* the claw motor: a whirr that runs while the claw moves (pitch up = lifting) */
  let motor = null;
  A.motor = function (on, pitch = 1) {
    if (!A.ctx) return;
    const t = A.ctx.currentTime;
    if (on) {
      if (!motor) {
        const o = A.ctx.createOscillator(), o2 = A.ctx.createOscillator(), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain(), lfo = A.ctx.createOscillator(), lg = A.ctx.createGain();
        o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = 92; o2.frequency.value = 184;
        f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 2;
        lfo.frequency.value = 22; lg.gain.value = 6; lfo.connect(lg); lg.connect(o.frequency);
        g.gain.value = 0; o.connect(f); o2.connect(f); f.connect(g); g.connect(A.sfx);
        o.start(); o2.start(); lfo.start();
        motor = { o, o2, f, g, lfo };
      }
      motor.o.frequency.setTargetAtTime(92 * pitch, t, 0.08); motor.o2.frequency.setTargetAtTime(184 * pitch, t, 0.08);
      motor.g.gain.setTargetAtTime(0.07, t, 0.05);
    } else if (motor) {
      const m = motor; motor = null;
      m.g.gain.setTargetAtTime(0, t, 0.05);
      setTimeout(() => { try { m.o.stop(); m.o2.stop(); m.lfo.stop(); } catch (e) { /* done */ } }, 400);
    }
  };

  // ── music: one original loop (tools/make_bgm.py), ducked under the voice ─────────────────────────────
  const MUSIC = window.CLAW_BGM || null, MUSIC_GAIN = 0.56;
  let bgmBuf = null, bgmSrc = null;
  A.startBgm = function (level) {
    if (!A.ctx || !MUSIC) return;
    if (level != null) A.bgmLevel = level;
    A.bgmOn = true; duck();
    if (bgmSrc) return;
    if (!bgmBuf) bgmBuf = A.ctx.decodeAudioData(b64(MUSIC.data)).catch(e => { console.warn('music', e); return null; });
    bgmBuf.then(buf => {
      if (!buf || bgmSrc) return;
      const s = A.ctx.createBufferSource(), g = A.ctx.createGain(), t = A.ctx.currentTime;
      s.buffer = buf; s.loop = true; s.loopStart = 0; s.loopEnd = Math.min(buf.duration, MUSIC.loop);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(MUSIC_GAIN, t + 0.4);
      s.connect(g); g.connect(A.bgm); s.start(t); bgmSrc = s;
    });
  };
  A.stopBgm = function () { A.bgmOn = false; duck(); };
  A.bgmPlaying = () => !!bgmSrc && A.bgmOn;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  A.sleep = sleep;
  window.Sound = A;
})();
