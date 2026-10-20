/* Kingdoms – Klang. Alles wird live mit der Web-Audio-API erzeugt: keine Dateien, kein Download.
   Musik: ruhige mittelalterliche Weise in D-Dorisch (Bordun + Laute + gelegentliche Harfe).
   Effekte: Klick, Ausbilden, Bauen, Marsch, Schlacht, Sieg, Niederlage, Zugbeginn, Forschung. */
(function (global) {
  'use strict';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
  };
  let ctx = null, master, sfxBus, musicBus, reverb;
  let musicOn = store.get('kingdoms-music') !== '0';
  let sfxOn = store.get('kingdoms-sfx') !== '0';
  let musicTimer = null, nextBar = 0, bar = 0;

  const midi = n => 440 * 2 ** ((n - 69) / 12);

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      // Hall aus abklingendem Rauschen – lässt alles wie in einer Halle klingen
      reverb = ctx.createConvolver();
      const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
      }
      reverb.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = 0.32;
      reverb.connect(wet); wet.connect(master);
      sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.7 : 0; sfxBus.connect(master); sfxBus.connect(reverb);
      musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master); musicBus.connect(reverb);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  // ---------- Instrumente ----------

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  // Laute / Zupfinstrument: zwei leicht verstimmte Dreiecke durch einen sich schließenden Tiefpass
  function pluck(bus, freq, t, dur = 1.2, vol = 0.18) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(freq * 6, t); f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + dur);
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = freq; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq;
    const g2 = ctx.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(f); o2.start(t); o2.stop(t + dur + 0.05);
    f.connect(g); g.connect(bus);
    env(g, t, 0.006, vol, dur);
  }

  // Harfe: reiner Sinus mit Oberton, lang ausklingend
  function harp(bus, freq, t, vol = 0.09) {
    const g = ctx.createGain();
    for (const [mul, v] of [[1, 1], [2, 0.3], [3, 0.1]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq * mul; og.gain.value = v;
      o.connect(og); og.connect(g); o.start(t); o.stop(t + 2.2);
    }
    g.connect(bus);
    env(g, t, 0.004, vol, 2);
  }

  // Horn / Fanfare: Sägezahn mit weichem Einschwingen durch Tiefpass
  function horn(bus, freq, t, dur = 0.5, vol = 0.12) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(freq * 1.5, t); f.frequency.linearRampToValueAtTime(freq * 5, t + 0.08);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = freq;
    o2.type = 'square'; o2.frequency.value = freq / 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.2;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(bus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.2); o2.stop(t + dur + 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
  }

  let noiseBuf = null;
  function noise(bus, t, dur, type, freq, vol, q = 1) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    env(g, t, 0.003, vol, dur);
  }

  // Trommel: Sinus-Schlag mit fallender Tonhöhe plus Fell-Rauschen
  function drum(bus, t, vol = 0.5, pitch = 90) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(pitch * 1.8, t); o.frequency.exponentialRampToValueAtTime(pitch * 0.6, t + 0.25);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.4);
    env(g, t, 0.004, vol, 0.32);
    noise(bus, t, 0.08, 'bandpass', 900, vol * 0.25, 0.8);
  }

  function clang(bus, t, vol = 0.12) {
    for (const f of [1870, 2630, 3450]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = f * (0.97 + Math.random() * 0.06);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.5);
      env(g, t, 0.002, vol / 3, 0.35);
    }
  }

  // ---------- Effekte ----------

  const D = 62; // D4
  const SFX = {
    click: t => pluck(sfxBus, midi(D + 12), t, 0.25, 0.08),
    select: t => { pluck(sfxBus, midi(D + 7), t, 0.3, 0.09); pluck(sfxBus, midi(D + 12), t + 0.05, 0.3, 0.07); },
    recruit: t => { drum(sfxBus, t, 0.35, 110); clang(sfxBus, t + 0.08, 0.06); },
    build: t => { noise(sfxBus, t, 0.06, 'bandpass', 600, 0.4, 3); noise(sfxBus, t + 0.16, 0.06, 'bandpass', 520, 0.35, 3); noise(sfxBus, t + 0.32, 0.07, 'bandpass', 700, 0.3, 3); },
    march: t => { for (let k = 0; k < 4; k++) drum(sfxBus, t + k * 0.14, 0.22 + (k === 3 ? 0.1 : 0), 120); },
    battle: t => {
      drum(sfxBus, t, 0.6, 70);
      noise(sfxBus, t + 0.02, 0.5, 'highpass', 1800, 0.25);
      clang(sfxBus, t + 0.05, 0.14); clang(sfxBus, t + 0.22, 0.1); clang(sfxBus, t + 0.4, 0.08);
      noise(sfxBus, t, 0.9, 'lowpass', 300, 0.3);
    },
    win: t => { horn(sfxBus, midi(D - 12), t, 0.18); horn(sfxBus, midi(D - 5), t + 0.18, 0.18); horn(sfxBus, midi(D), t + 0.36, 0.55, 0.14); },
    lose: t => { horn(sfxBus, midi(D - 10), t, 0.35, 0.1); horn(sfxBus, midi(D - 14), t + 0.35, 0.7, 0.1); },
    turn: t => { horn(sfxBus, midi(D - 12), t, 0.9, 0.09); [0, 3, 7, 12].forEach((n, k) => harp(sfxBus, midi(D + n), t + 0.25 + k * 0.08, 0.06)); },
    research: t => { [0, 5, 9, 12, 17].forEach((n, k) => harp(sfxBus, midi(D + 7 + n), t + k * 0.07, 0.07)); },
    error: t => pluck(sfxBus, midi(D - 6), t, 0.2, 0.08),
    volley: t => { for (let k = 0; k < 6; k++) noise(sfxBus, t + k * 0.05, 0.18, 'bandpass', 2400 + k * 300, 0.12, 4); noise(sfxBus, t + 0.6, 0.25, 'lowpass', 500, 0.25); },
    victory: t => {
      [[0, 0.2], [7, 0.2], [12, 0.2], [7, 0.15], [12, 0.9]].reduce((acc, [n, d]) => { horn(sfxBus, midi(D - 12 + n), t + acc, d, 0.13); return acc + d; }, 0);
      for (let k = 0; k < 6; k++) drum(sfxBus, t + k * 0.2, 0.25, 100);
    },
    defeat: t => { [0, -2, -5, -9].forEach((n, k) => horn(sfxBus, midi(D - 12 + n), t + k * 0.45, 0.6, 0.08)); },
  };

  function play(name) {
    if (!sfxOn || !SFX[name] || !ensure()) return;
    SFX[name](ctx.currentTime + 0.01);
  }

  // ---------- Musik ----------

  // D-Dorisch: D E F G A H C. Akkordfolge im Stil alter Tanzweisen.
  const SCALE = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19];
  const PROG = [0, 0, -2, -2, 3, 3, -5, 0];   // Dm Dm C C F F Am Dm (als Grundton-Versatz)
  const BEAT = 0.42;
  let melodyIdx = 4;

  function scheduleBar(t) {
    const root = D - 12 + PROG[bar % PROG.length];
    // Bordun: Grundton + Quinte, sehr leise, über den ganzen Takt
    for (const n of [root - 12, root - 5]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = midi(n);
      f.type = 'lowpass'; f.frequency.value = 420;
      o.connect(f); f.connect(g); g.connect(musicBus);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.6);
      g.gain.linearRampToValueAtTime(0.0001, t + BEAT * 8 + 0.3);
      o.start(t); o.stop(t + BEAT * 8 + 0.4);
    }
    // Laute: Bassnote auf Schlag 1 und 5
    pluck(musicBus, midi(root - 12), t, 1.6, 0.13);
    pluck(musicBus, midi(root - 5), t + BEAT * 4, 1.6, 0.1);
    // Melodie: Zufallsweg durch die Tonleiter, mit Pausen und punktierten Noten
    let beat = 0;
    while (beat < 8) {
      const len = Math.random() < 0.25 ? 2 : Math.random() < 0.2 ? 1.5 : 1;
      if (Math.random() > 0.3) {
        melodyIdx = Math.max(0, Math.min(SCALE.length - 1, melodyIdx + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
        pluck(musicBus, midi(D + SCALE[melodyIdx] + PROG[bar % PROG.length] * 0), t + beat * BEAT, 0.9 + len * 0.3, 0.075);
      }
      beat += len;
    }
    // Harfe: gelegentlich ein aufsteigendes Arpeggio am Taktende
    if (bar % 4 === 3) [0, 7, 12, 15].forEach((n, k) => harp(musicBus, midi(root + 12 + n), t + BEAT * 6 + k * 0.12, 0.035));
    bar++;
  }

  function musicLoop() {
    if (!ctx) return;
    while (nextBar < ctx.currentTime + 1.2) { scheduleBar(nextBar); nextBar += BEAT * 8; }
  }

  function startMusic() {
    if (!musicOn || !ensure()) return;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.55, ctx.currentTime, 1.2);
    if (!musicTimer) { nextBar = ctx.currentTime + 0.3; musicTimer = setInterval(musicLoop, 300); musicLoop(); }
  }
  function stopMusic() {
    if (!ctx) return;
    musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    clearInterval(musicTimer); musicTimer = null;
  }

  // Browser erlauben Ton erst nach der ersten Berührung
  const unlock = () => { if (ensure() && musicOn) startMusic(); };
  global.addEventListener('pointerdown', unlock, { once: true });
  global.addEventListener('keydown', unlock, { once: true });

  global.Sound = {
    play,
    get music() { return musicOn; },
    get sfx() { return sfxOn; },
    toggleMusic() { musicOn = !musicOn; store.set('kingdoms-music', musicOn ? '1' : '0'); if (musicOn) startMusic(); else stopMusic(); return musicOn; },
    toggleSfx() { sfxOn = !sfxOn; store.set('kingdoms-sfx', sfxOn ? '1' : '0'); if (ensure()) sfxBus.gain.value = sfxOn ? 0.7 : 0; return sfxOn; },
  };
})(window);
