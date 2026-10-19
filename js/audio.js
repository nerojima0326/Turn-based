/* =========================================================
 *  사운드 — WebAudio로 실시간 합성하는 효과음과 배경음악 (외부 음원 없음)
 * ========================================================= */
(() => {
  'use strict';

  let ctx = null, master, buses, revIn, noiseBuf;
  const state = { sfx: 0.8, bgm: 0.5, bgmOn: true, mode: null };
  let seq = null;

  const mtof = n => 440 * Math.pow(2, (n - 69) / 12);
  const now = () => ctx.currentTime;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.22;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);

    const conv = ctx.createConvolver();
    conv.buffer = impulse(2.6, 2.4);
    revIn = ctx.createGain();
    const revOut = ctx.createGain();
    revOut.gain.value = 0.5;
    revIn.connect(conv).connect(revOut).connect(master);

    const bus = () => {
      const dry = ctx.createGain(), wet = ctx.createGain();
      dry.connect(master); wet.connect(revIn);
      return { dry, wet };
    };
    buses = { sfx: bus(), bgm: bus() };
    noiseBuf = makeNoise();
    applyVolumes();

    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
    if (state.mode) startBgm(state.mode);
  }

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function makeNoise() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function applyVolumes() {
    if (!ctx) return;
    const t = now();
    buses.sfx.dry.gain.setTargetAtTime(state.sfx, t, 0.02);
    buses.sfx.wet.gain.setTargetAtTime(state.sfx, t, 0.02);
    const b = state.bgmOn ? state.bgm * 0.55 : 0;
    buses.bgm.dry.gain.setTargetAtTime(b, t, 0.08);
    buses.bgm.wet.gain.setTargetAtTime(b, t, 0.08);
  }

  function route(node, cat, wet) {
    const b = buses[cat] || buses.sfx;
    node.connect(b.dry);
    if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      node.connect(w).connect(b.wet);
    }
  }

  function chainFilter(src, filter, t0, end) {
    if (!filter) return src;
    const bq = ctx.createBiquadFilter();
    bq.type = filter.type;
    bq.frequency.setValueAtTime(filter.f, t0);
    if (filter.f2) bq.frequency.exponentialRampToValueAtTime(filter.f2, end);
    bq.Q.value = filter.q || 0.8;
    src.connect(bq);
    return bq;
  }

  function tone(o) {
    const { f = 440, f2 = null, type = 'sine', t = 0, a = 0.004, d = 0.25, g = 0.2, wet = 0.12, cat = 'sfx', detune = 0, filter = null, when = null } = o;
    const t0 = (when != null ? when : now()) + t;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + a + d);
    osc.detune.value = detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + a);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    chainFilter(osc, filter, t0, t0 + a + d).connect(env);
    route(env, cat, wet);
    osc.start(t0);
    osc.stop(t0 + a + d + 0.05);
    osc.onended = () => env.disconnect();
  }

  function noise(o) {
    const { t = 0, a = 0.003, d = 0.2, g = 0.2, wet = 0.1, cat = 'sfx', filter = { type: 'lowpass', f: 2000 }, when = null } = o;
    const t0 = (when != null ? when : now()) + t;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + a);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    chainFilter(src, filter, t0, t0 + a + d).connect(env);
    route(env, cat, wet);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + a + d + 0.05);
    src.onended = () => env.disconnect();
  }

  // 지속음(패드): 천천히 올라왔다가 머물고 사라지는 화음
  function pad(notes, when, len, { g = 0.035, cutoff = 900, type = 'sawtooth' } = {}) {
    notes.forEach(n => {
      [-7, 7].forEach(det => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = mtof(n);
        osc.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = cutoff;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, when);
        env.gain.linearRampToValueAtTime(g, when + Math.min(0.9, len * 0.3));
        env.gain.setValueAtTime(g, when + len * 0.75);
        env.gain.linearRampToValueAtTime(0.0001, when + len + 0.6);
        osc.connect(lp).connect(env);
        route(env, 'bgm', 0.5);
        osc.start(when);
        osc.stop(when + len + 0.7);
        osc.onended = () => env.disconnect();
      });
    });
  }

  /* ---------- 효과음 ---------- */
  const SFX = {
    hover: () => tone({ f: 2400, d: 0.035, g: 0.025 }),
    click: () => tone({ f: 1400, type: 'triangle', d: 0.05, g: 0.06 }),
    select: () => { tone({ f: 880, f2: 1320, type: 'triangle', d: 0.09, g: 0.1 }); tone({ f: 1760, t: 0.03, d: 0.12, g: 0.045, wet: 0.3 }); },
    place: () => {
      noise({ d: 0.12, g: 0.16, filter: { type: 'bandpass', f: 1800, f2: 5000, q: 1.2 } });
      tone({ f: 520, f2: 780, type: 'triangle', d: 0.1, g: 0.11 });
      tone({ f: 1040, t: 0.05, d: 0.2, g: 0.05, wet: 0.4 });
    },
    merge: () => {
      [72, 76, 79, 84].forEach((n, i) => tone({ f: mtof(n), type: 'triangle', t: i * 0.045, d: 0.28, g: 0.11, wet: 0.45 }));
      tone({ f: mtof(96), t: 0.18, d: 0.5, g: 0.045, wet: 0.6 });
    },
    undo: () => tone({ f: 660, f2: 420, type: 'triangle', d: 0.12, g: 0.09 }),
    error: () => {
      tone({ f: 180, type: 'square', d: 0.09, g: 0.05, filter: { type: 'lowpass', f: 900 } });
      tone({ f: 140, type: 'square', t: 0.09, d: 0.12, g: 0.05, filter: { type: 'lowpass', f: 900 } });
    },
    target: () => { tone({ f: 1200, f2: 1600, d: 0.06, g: 0.06 }); tone({ f: 2400, t: 0.04, d: 0.08, g: 0.03 }); },
    execute: () => {
      tone({ f: 110, f2: 55, d: 0.35, g: 0.38 });
      noise({ d: 0.4, g: 0.1, filter: { type: 'lowpass', f: 400, f2: 3000 }, wet: 0.3 });
      tone({ f: mtof(62), type: 'sawtooth', d: 0.5, g: 0.045, filter: { type: 'lowpass', f: 600, f2: 2400 }, wet: 0.4 });
    },
    whoosh: () => noise({ d: 0.2, a: 0.03, g: 0.2, filter: { type: 'bandpass', f: 500, f2: 2600, q: 1.4 } }),
    slash: () => {
      noise({ d: 0.14, g: 0.28, filter: { type: 'highpass', f: 2500, f2: 7000 } });
      tone({ f: 2600, t: 0.02, d: 0.35, g: 0.045, wet: 0.5 });
      tone({ f: 3900, t: 0.02, d: 0.25, g: 0.025, wet: 0.5 });
    },
    hit: () => {
      tone({ f: 150, f2: 50, d: 0.16, g: 0.42 });
      noise({ d: 0.1, g: 0.22, filter: { type: 'lowpass', f: 2200, f2: 400 } });
    },
    crit: () => {
      SFX.hit();
      tone({ f: 1800, f2: 900, type: 'square', d: 0.08, g: 0.05, filter: { type: 'lowpass', f: 4000 } });
      noise({ t: 0.01, d: 0.3, g: 0.16, filter: { type: 'highpass', f: 4000 }, wet: 0.6 });
      tone({ f: 70, f2: 40, t: 0.02, d: 0.3, g: 0.38 });
    },
    shieldHit: () => {
      tone({ f: 900, f2: 600, type: 'triangle', d: 0.18, g: 0.09, wet: 0.4 });
      noise({ d: 0.08, g: 0.09, filter: { type: 'bandpass', f: 3000, q: 4 } });
    },
    fireball: () => noise({ d: 0.32, a: 0.08, g: 0.18, filter: { type: 'bandpass', f: 600, f2: 1400, q: 0.8 } }),
    flame: () => {
      noise({ d: 0.5, a: 0.05, g: 0.28, filter: { type: 'lowpass', f: 300, f2: 2200 }, wet: 0.25 });
      for (let i = 0; i < 6; i++) noise({ t: 0.05 + Math.random() * 0.4, d: 0.03, g: 0.1, filter: { type: 'highpass', f: 3000 } });
      tone({ f: 90, f2: 60, d: 0.4, g: 0.22 });
    },
    holy: () => {
      [60, 64, 67, 72, 76].forEach((n, i) => tone({ f: mtof(n + 12), t: i * 0.03, a: 0.05, d: 1.1, g: 0.06, wet: 0.7 }));
      noise({ d: 0.8, a: 0.2, g: 0.05, filter: { type: 'highpass', f: 6000 }, wet: 0.7 });
    },
    shield: () => {
      tone({ f: 320, f2: 640, d: 0.3, g: 0.12, wet: 0.4 });
      tone({ f: 1280, f2: 1600, type: 'triangle', t: 0.08, d: 0.4, g: 0.035, wet: 0.6 });
    },
    heal: () => [79, 83, 86, 91].forEach((n, i) => tone({ f: mtof(n), t: i * 0.07, d: 0.5, g: 0.065, wet: 0.6 })),
    debuff: () => {
      tone({ f: 340, f2: 140, type: 'sawtooth', d: 0.35, g: 0.07, filter: { type: 'lowpass', f: 1200, f2: 400 } });
      tone({ f: 346, f2: 146, type: 'sawtooth', d: 0.35, g: 0.05, filter: { type: 'lowpass', f: 1200, f2: 400 } });
    },
    buff: () => {
      tone({ f: 440, f2: 880, type: 'triangle', d: 0.25, g: 0.09, wet: 0.4 });
      tone({ f: 660, f2: 1320, type: 'triangle', t: 0.08, d: 0.25, g: 0.07, wet: 0.4 });
    },
    ink: () => {
      noise({ d: 0.3, g: 0.14, filter: { type: 'bandpass', f: 700, f2: 300, q: 2 } });
      tone({ f: 330, f2: 165, d: 0.4, g: 0.13, wet: 0.5 });
    },
    page: () => noise({ d: 0.15, a: 0.02, g: 0.09, filter: { type: 'bandpass', f: 3000, f2: 1500, q: 0.8 } }),
    zap: () => {
      for (let i = 0; i < 4; i++) noise({ t: i * 0.04, d: 0.04, g: 0.16, filter: { type: 'highpass', f: 2500 } });
      tone({ f: 90, type: 'sawtooth', d: 0.18, g: 0.08, filter: { type: 'lowpass', f: 1500 } });
    },
    splash: () => {
      noise({ d: 0.45, g: 0.28, filter: { type: 'lowpass', f: 1800, f2: 300 }, wet: 0.3 });
      tone({ f: 200, f2: 60, d: 0.3, g: 0.28 });
    },
    water: () => {
      noise({ d: 1.0, a: 0.25, g: 0.32, filter: { type: 'lowpass', f: 300, f2: 1600 }, wet: 0.4 });
      noise({ t: 0.5, d: 0.8, g: 0.22, filter: { type: 'lowpass', f: 1600, f2: 200 }, wet: 0.4 });
    },
    gaze: () => {
      tone({ f: 120, f2: 240, type: 'sawtooth', d: 0.6, g: 0.06, filter: { type: 'lowpass', f: 600, f2: 2000, q: 6 }, wet: 0.5 });
      tone({ f: 1800, f2: 2400, d: 0.5, g: 0.025, wet: 0.6 });
    },
    bubbles: () => { for (let i = 0; i < 7; i++) tone({ f: 300 + Math.random() * 600, f2: 900 + Math.random() * 600, t: i * 0.06, d: 0.06, g: 0.07 }); },
    summon: () => {
      SFX.bubbles();
      tone({ f: mtof(50), type: 'triangle', d: 0.8, g: 0.1, wet: 0.6 });
      tone({ f: mtof(57), type: 'triangle', t: 0.1, d: 0.8, g: 0.07, wet: 0.6 });
    },
    lunge: () => noise({ d: 0.2, g: 0.16, filter: { type: 'bandpass', f: 300, f2: 1200, q: 1 } }),
    death: () => {
      tone({ f: 420, f2: 60, type: 'triangle', d: 0.7, g: 0.14, wet: 0.5 });
      noise({ d: 0.6, g: 0.1, filter: { type: 'lowpass', f: 1200, f2: 200 }, wet: 0.5 });
    },
    allyDown: () => [64, 60, 57, 52].forEach((n, i) => tone({ f: mtof(n), type: 'triangle', t: i * 0.12, d: 0.4, g: 0.09, wet: 0.6 })),
    ultReady: () => [69, 73, 76, 81, 85].forEach((n, i) => tone({ f: mtof(n), type: 'triangle', t: i * 0.05, d: 0.35, g: 0.07, wet: 0.5 })),
    ultCharge: () => {
      tone({ f: 80, f2: 900, type: 'sawtooth', a: 0.05, d: 0.9, g: 0.07, filter: { type: 'lowpass', f: 300, f2: 5000, q: 4 }, wet: 0.5 });
      noise({ a: 0.6, d: 0.4, g: 0.16, filter: { type: 'highpass', f: 800, f2: 6000 }, wet: 0.6 });
    },
    ultCut: () => {
      noise({ d: 0.25, g: 0.36, filter: { type: 'highpass', f: 2000, f2: 9000 }, wet: 0.5 });
      tone({ f: 3000, d: 0.8, g: 0.04, wet: 0.8 });
      tone({ f: 60, f2: 30, d: 0.6, g: 0.45 });
    },
    boom: () => {
      tone({ f: 90, f2: 28, d: 1.0, g: 0.65 });
      noise({ d: 0.9, g: 0.4, filter: { type: 'lowpass', f: 3000, f2: 120 }, wet: 0.6 });
    },
    warning: () => [0, 0.28].forEach(t => {
      tone({ f: 880, type: 'square', t, d: 0.12, g: 0.045, filter: { type: 'lowpass', f: 2500 } });
      tone({ f: 660, type: 'square', t: t + 0.13, d: 0.12, g: 0.045, filter: { type: 'lowpass', f: 2500 } });
    }),
    turn: () => { tone({ f: mtof(81), d: 0.9, g: 0.06, wet: 0.7 }); tone({ f: mtof(88), t: 0.06, d: 0.9, g: 0.045, wet: 0.7 }); },
    enemyTurn: () => { tone({ f: mtof(45), type: 'triangle', d: 0.9, g: 0.13, wet: 0.6 }); tone({ f: mtof(51), type: 'triangle', t: 0.02, d: 0.9, g: 0.09, wet: 0.6 }); },
    gong: () => {
      [1, 2.76, 5.4, 8.93].forEach((m, i) => tone({ f: 82 * m, d: 2.4 - i * 0.4, g: 0.18 / (i + 1), wet: 0.7 }));
      noise({ d: 0.15, g: 0.13, filter: { type: 'lowpass', f: 2000 } });
    },
    roar: () => {
      [70, 73].forEach(f => tone({ f, f2: f * 0.64, type: 'sawtooth', a: 0.1, d: 1.3, g: 0.15, filter: { type: 'lowpass', f: 400, f2: 900, q: 3 }, wet: 0.5 }));
      noise({ a: 0.2, d: 1.0, g: 0.18, filter: { type: 'bandpass', f: 300, f2: 700, q: 1 }, wet: 0.5 });
    },
    star: o => tone({ f: mtof(84 + (o.i || 0) * 4), type: 'triangle', d: 0.4, g: 0.09, wet: 0.6 }),
    stamp: () => { tone({ f: 120, f2: 60, d: 0.25, g: 0.4 }); noise({ d: 0.2, g: 0.2, filter: { type: 'lowpass', f: 1600 } }); },
    victory: () => {
      const chords = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79, 84]];
      chords.forEach((c, i) => c.forEach(n => {
        tone({ f: mtof(n), type: 'triangle', t: i * 0.24, d: i === 3 ? 1.6 : 0.3, g: 0.07, wet: 0.5 });
        tone({ f: mtof(n - 12), type: 'sawtooth', t: i * 0.24, d: i === 3 ? 1.4 : 0.28, g: 0.025, filter: { type: 'lowpass', f: 1800 }, wet: 0.5 });
      }));
      [79, 84, 88, 91].forEach((n, i) => tone({ f: mtof(n), t: 0.72 + i * 0.08, d: 0.9, g: 0.05, wet: 0.7 }));
    },
    defeat: () => {
      [69, 67, 64, 60, 57].forEach((n, i) => tone({ f: mtof(n), type: 'triangle', t: i * 0.32, d: 0.7, g: 0.08, wet: 0.7 }));
      tone({ f: mtof(33), type: 'sawtooth', a: 0.3, d: 2.4, g: 0.05, filter: { type: 'lowpass', f: 500 }, wet: 0.6 });
    }
  };

  function play(name, opt) {
    if (!ctx || ctx.state !== 'running') return;
    const fn = SFX[name];
    if (fn) { try { fn(opt || {}); } catch (e) { /* 오디오 오류는 게임 진행에 영향을 주지 않습니다 */ } }
  }

  /* ---------- 배경음악: 오르골 아르페지오(평시) / 박동하는 전투곡(보스) ---------- */
  const MODES = {
    calm: {
      bpm: 76,
      prog: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]],
      arp: [0, 2, 3, 4, 3, 2, 1, 2], arpEvery: 2, arpOct: 24, arpType: 'box'
    },
    boss: {
      bpm: 118,
      prog: [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]],
      arp: [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 4, 3, 2, 1, 2], arpEvery: 1, arpOct: 12, arpType: 'pluck', drums: true
    }
  };

  function chordTone(chord, k) {
    const tones = [chord[0], chord[1], chord[2], chord[0] + 12, chord[1] + 12];
    return tones[k % tones.length];
  }

  function playStep(m, step, t, stepDur) {
    const bar = Math.floor(step / 16) % m.prog.length;
    const s = step % 16;
    const chord = m.prog[bar];
    if (s === 0) pad(chord, t, stepDur * 16, m.drums ? { g: 0.022, cutoff: 700 } : { g: 0.03, cutoff: 850 });
    if (s % m.arpEvery === 0) {
      const k = m.arp[(s / m.arpEvery) % m.arp.length];
      const n = chordTone(chord, k) + m.arpOct;
      if (m.arpType === 'box') {
        tone({ f: mtof(n), when: t, d: 0.9, g: 0.045, wet: 0.55, cat: 'bgm' });
        tone({ f: mtof(n + 12), type: 'triangle', when: t, d: 0.3, g: 0.012, wet: 0.55, cat: 'bgm' });
      } else {
        tone({ f: mtof(n), type: 'sawtooth', when: t, d: 0.16, g: 0.03, wet: 0.3, cat: 'bgm', filter: { type: 'lowpass', f: 2600, f2: 500 } });
      }
    }
    if (!m.drums) {
      if (s === 0 || s === 8) tone({ f: mtof(chord[0] - 12), type: 'triangle', when: t, d: stepDur * 7, g: 0.07, wet: 0.2, cat: 'bgm' });
      if (s === 12 && bar % 2 === 1) tone({ f: mtof(chord[2] + 24), when: t, a: 0.02, d: 1.4, g: 0.025, wet: 0.8, cat: 'bgm' });
      return;
    }
    if (s % 2 === 0) tone({ f: mtof(chord[0] - 12), type: 'sawtooth', when: t, d: stepDur * 1.6, g: 0.05, wet: 0.1, cat: 'bgm', filter: { type: 'lowpass', f: 420 } });
    if (s % 4 === 0) tone({ f: 140, f2: 42, when: t, d: 0.22, g: 0.34, wet: 0.05, cat: 'bgm' });
    if (s === 4 || s === 12) {
      noise({ when: t, d: 0.14, g: 0.09, filter: { type: 'bandpass', f: 1800, q: 0.8 }, wet: 0.3, cat: 'bgm' });
      tone({ f: 190, f2: 120, when: t, d: 0.1, g: 0.1, cat: 'bgm' });
    }
    if (s % 4 === 2) noise({ when: t, d: 0.035, g: 0.045, filter: { type: 'highpass', f: 7000 }, cat: 'bgm' });
  }

  function schedule() {
    if (!seq || !ctx) return;
    const m = MODES[seq.mode];
    const stepDur = 60 / m.bpm / 4;
    if (seq.next < now() - 0.25) seq.next = now() + 0.05;
    while (seq.next < now() + 0.15) {
      playStep(m, seq.step, seq.next, stepDur);
      seq.next += stepDur;
      seq.step += 1;
    }
  }

  function startBgm(mode) {
    state.mode = mode;
    if (!ctx || !state.bgmOn) return;
    if (seq && seq.mode === mode) return;
    stopBgm(true);
    seq = { mode, step: 0, next: now() + 0.12, timer: setInterval(schedule, 25) };
  }

  function stopBgm(keepMode) {
    if (seq) clearInterval(seq.timer);
    seq = null;
    if (!keepMode) state.mode = null;
  }

  function configure(o) {
    Object.assign(state, o);
    applyVolumes();
    // 배경음악이 꺼져 있으면(음소거 포함) 시퀀서를 멈추고, 다시 켜지면 이어서 재생합니다.
    if (!ctx) return;
    if (!state.bgmOn) stopBgm(true);
    else if (state.mode && !seq) startBgm(state.mode);
  }

  window.Sound = { init, play, bgm: startBgm, stopBgm, configure, get ready() { return !!ctx; } };
})();
