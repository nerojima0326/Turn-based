/* =========================================================
 *  시각 효과 — 캔버스 파티클 · 주변 연출(거꾸로 내리는 비) · 흔들림 · 히트스톱 · 떠오르는 글자
 * ========================================================= */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pickOf = v => (Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v);
  const range = v => (Array.isArray(v) ? rand(v[0], v[1]) : v);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let opts = { speed: () => 1, shake: () => true, lite: false };
  let canvas, ctx, ambCanvas, amb, shakeEl, camEl, flashEl, floatEl, domEl;
  let dpr = 1, W = 0, H = 0;
  let last = performance.now();
  let frozenUntil = 0;
  const parts = [];
  const glowCache = new Map();
  const rain = [];
  const motes = [];

  function init(refs, options) {
    Object.assign(opts, options);
    ({ canvas, ambCanvas, shakeEl, camEl, flashEl, floatEl, domEl } = refs);
    ctx = canvas.getContext('2d');
    amb = ambCanvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    seedAmbient();
    requestAnimationFrame(loop);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    [canvas, ambCanvas].forEach(c => {
      c.width = Math.max(1, Math.round(W * dpr));
      c.height = Math.max(1, Math.round(H * dpr));
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  function glowSprite(color) {
    let c = glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, color);
    gr.addColorStop(0.5, color.length === 7 ? color + '55' : color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
    return c;
  }

  /* ---------- 루프 ---------- */
  function loop(now) {
    const raw = Math.min(50, now - last);
    last = now;
    const dt = now < frozenUntil ? 0 : raw * opts.speed();
    step(dt);
    draw();
    drawAmbient(raw);
    requestAnimationFrame(loop);
  }

  function step(dt) {
    const k = dt / 16.67;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        parts.splice(i, 1);
        if (p.done) p.done();
        continue;
      }
      if (p.update) p.update(p, dt);
      if (p.drag) { p.vx *= Math.pow(1 - p.drag, k); p.vy *= Math.pow(1 - p.drag, k); }
      p.vy += (p.gravity || 0) * k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += (p.vr || 0) * k;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      const t = p.age / p.life;
      const fade = p.fadeIn ? Math.min(1, t / p.fadeIn) * (1 - Math.max(0, (t - p.fadeIn) / (1 - p.fadeIn))) : 1 - t;
      const a = Math.min(1, Math.max(0, p.alpha * fade));
      if (a <= 0.003) continue;
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = p.blend || 'lighter';
      const size = p.size + (p.size1 != null ? (p.size1 - p.size) * t : 0);
      switch (p.kind) {
        case 'glow': {
          const img = glowSprite(p.color);
          const s = size * 4;
          ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
          break;
        }
        case 'spark': {
          const len = p.len || 3;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * len, p.y - p.vy * len);
          ctx.stroke();
          break;
        }
        case 'shard': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.lineTo(size * 0.55, size * 0.7);
          ctx.lineTo(-size * 0.5, size * 0.4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'leaf': {
          ctx.save();
          ctx.translate(p.x + Math.sin(p.age / 120 + p.seed) * 6, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(0, 0, size, size * 0.45, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'ring': {
          const e = easeOut(t);
          const r = p.r0 + (p.r1 - p.r0) * e;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(0.5, p.width * (1 - e));
          ctx.beginPath();
          if (p.squash) ctx.ellipse(p.x, p.y, r, r * p.squash, 0, 0, TAU);
          else ctx.arc(p.x, p.y, r, 0, TAU);
          ctx.stroke();
          break;
        }
        case 'slash': drawSlash(p, t); break;
        case 'bolt': drawBolt(p); break;
        case 'beam': {
          const w = p.width * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8 * 0.7);
          ctx.lineCap = 'round';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = w * 2.6;
          ctx.globalAlpha = a * 0.35;
          line(p.x, p.y, p.x2, p.y2);
          ctx.globalAlpha = a;
          ctx.lineWidth = w;
          line(p.x, p.y, p.x2, p.y2);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = w * 0.35;
          line(p.x, p.y, p.x2, p.y2);
          break;
        }
        case 'pillar': {
          const e = t < 0.25 ? easeOut(t / 0.25) : 1;
          const w = p.width * e * (1 - Math.max(0, t - 0.6) / 0.4 * 0.6);
          const g = ctx.createLinearGradient(0, p.y - p.height, 0, p.y);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(0.55, p.color);
          g.addColorStop(0.92, '#ffffff');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(p.x - w / 2, p.y - p.height, w, p.height + 10);
          ctx.globalAlpha = a * 0.35;
          ctx.fillRect(p.x - w * 1.4, p.y - p.height, w * 2.8, p.height + 10);
          break;
        }
        case 'glyph': {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = p.color;
          ctx.font = `700 ${size}px "Noto Serif KR", serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = p.shadow || p.color;
          ctx.shadowBlur = 12;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillText(p.text, 0, 0);
          ctx.restore();
          ctx.shadowBlur = 0;
          break;
        }
        case 'bubble': {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p.x + Math.sin(p.age / 160 + p.seed) * 3, p.y, size, 0, TAU);
          ctx.stroke();
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // 초승달 모양의 검기: 처음 30% 동안 휘둘러지고 나머지 동안 사라집니다.
  function drawSlash(p, t) {
    const sweep = easeOut(Math.min(1, t / 0.3));
    const arc = p.arc * Math.PI / 180;
    const start = p.angle * Math.PI / 180 - arc / 2 * p.dir;
    const end = start + arc * sweep * p.dir;
    const r = p.radius * (1 + t * 0.12);
    const w = p.width * (1 - t * 0.6);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.lineCap = 'round';
    for (const [lw, col, al] of [[w * 2.8, p.color, 0.35], [w, p.color, 1], [w * 0.35, '#ffffff', 1]]) {
      ctx.globalAlpha *= al;
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.min(start, end), Math.max(start, end));
      ctx.stroke();
      ctx.globalAlpha /= al;
    }
    ctx.restore();
  }

  function drawBolt(p) {
    if (!p.pts || p.age - (p.regen || 0) > 45) {
      p.regen = p.age;
      const n = p.segments || 9;
      p.pts = [];
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const j = i === 0 || i === n ? 0 : (Math.random() - 0.5) * p.jitter;
        const nx = -(p.y2 - p.y), ny = p.x2 - p.x;
        const len = Math.hypot(nx, ny) || 1;
        p.pts.push([p.x + (p.x2 - p.x) * k + nx / len * j, p.y + (p.y2 - p.y) * k + ny / len * j]);
      }
    }
    ctx.lineJoin = 'round';
    for (const [lw, col] of [[p.width * 3, p.color], [p.width, '#ffffff']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }

  function add(p) {
    const q = Object.assign({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 600, size: 3, alpha: 1, rot: 0, vr: 0, color: '#fff', kind: 'glow', seed: Math.random() * 10 }, p);
    if (opts.lite && parts.length > 260 && (q.kind === 'glow' || q.kind === 'spark')) return q;
    parts.push(q);
    return q;
  }

  /* ---------- 공개 효과 ---------- */
  function burst(x, y, o = {}) {
    const n = Math.round((o.count || 20) * (opts.lite ? 0.5 : 1));
    const base = (o.angle != null ? o.angle : 0) * Math.PI / 180;
    const spread = (o.spread != null ? o.spread : 360) * Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const ang = base + (Math.random() - 0.5) * spread;
      const sp = range(o.speed || [2, 6]);
      add({
        kind: o.kind || 'glow', x: x + rand(-1, 1) * (o.jitter || 0), y: y + rand(-1, 1) * (o.jitterY != null ? o.jitterY : o.jitter || 0),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: range(o.life || [400, 800]),
        size: range(o.size || [2, 5]), size1: o.shrink ? 0 : undefined, color: pickOf(o.colors || '#fff'),
        gravity: o.gravity || 0, drag: o.drag != null ? o.drag : 0.04, vr: rand(-0.2, 0.2) * (o.spin || 1),
        rot: rand(0, TAU), len: o.len, alpha: o.alpha != null ? o.alpha : 1, blend: o.blend, fadeIn: o.fadeIn
      });
    }
  }

  const ring = (x, y, o = {}) => add({ kind: 'ring', x, y, r0: o.r0 || 6, r1: o.r1 || 80, width: o.width || 6, color: o.color || '#fff', life: o.life || 500, squash: o.squash, alpha: o.alpha != null ? o.alpha : 1 });

  const slash = (x, y, o = {}) => add({ kind: 'slash', x, y, angle: o.angle != null ? o.angle : -30, arc: o.arc || 150, radius: o.radius || 70, width: o.width || 6, color: o.color || '#bae6fd', life: o.life || 380, dir: o.dir || 1 });

  const bolt = (x1, y1, x2, y2, o = {}) => add({ kind: 'bolt', x: x1, y: y1, x2, y2, width: o.width || 2.2, color: o.color || '#7dd3fc', jitter: o.jitter || 26, segments: o.segments, life: o.life || 260 });

  const beam = (x1, y1, x2, y2, o = {}) => add({ kind: 'beam', x: x1, y: y1, x2, y2, width: o.width || 8, color: o.color || '#fde68a', life: o.life || 420 });

  const pillar = (x, y, o = {}) => add({ kind: 'pillar', x, y, width: o.width || 60, height: o.height || y + 40, color: o.color || '#fde68a', life: o.life || 700 });

  function glyphs(x, y, o = {}) {
    const chars = o.chars || ['書'];
    for (let i = 0; i < (o.count || 6); i++) {
      const ang = rand(0, TAU), sp = range(o.speed || [0.6, 2]);
      add({ kind: 'glyph', text: pickOf(chars), x: x + rand(-20, 20), y: y + rand(-20, 20), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (o.rise || 0.6), size: range(o.size || [12, 22]), color: o.color || '#fde68a', life: range(o.life || [700, 1100]), vr: rand(-0.04, 0.04), drag: 0.02, blend: 'source-over', fadeIn: 0.15 });
    }
  }

  function bubbles(x, y, o = {}) {
    for (let i = 0; i < (o.count || 10); i++) {
      add({ kind: 'bubble', x: x + rand(-1, 1) * (o.spread || 40), y: y + rand(-10, 10), vx: 0, vy: -rand(0.6, 1.8), size: rand(2, 6), color: o.color || 'rgba(186,230,253,.7)', life: rand(700, 1300), blend: 'source-over' });
    }
  }

  // 발사체: 목표에 닿으면 resolve 됩니다.
  function projectile(from, to, o = {}) {
    return new Promise(resolve => {
      const life = o.duration || 320;
      const arcH = o.arc || 0;
      add({
        kind: 'glow', x: from.x, y: from.y, size: o.size || 9, color: o.color || '#ffb347', life, alpha: 1,
        fadeIn: 0.01,
        update(p) {
          const t = Math.min(1, p.age / life);
          const e = easeInOut(t);
          p.x = from.x + (to.x - from.x) * e;
          p.y = from.y + (to.y - from.y) * e - Math.sin(t * Math.PI) * arcH;
          p.alpha = 1 / Math.max(0.001, 1 - t);
          add({ kind: 'glow', x: p.x + rand(-3, 3), y: p.y + rand(-3, 3), vx: rand(-0.6, 0.6), vy: rand(-0.6, 0.6), size: rand(2, (o.size || 9) * 0.6), color: pickOf(o.trail || o.color || '#ffb347'), life: rand(200, 420), drag: 0.05 });
        },
        done: resolve
      });
    });
  }

  /* ---------- 화면 효과 ---------- */
  function flash(color = '#fff', ms = 260, peak = 0.7) {
    flashEl.style.background = color;
    flashEl.animate([{ opacity: peak }, { opacity: 0 }], { duration: ms / opts.speed(), easing: 'ease-out' });
  }

  function shake(mag = 6, ms = 320) {
    if (!opts.shake() || mag <= 0) return;
    const frames = [];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const k = 1 - i / n;
      frames.push({ transform: i === n ? 'none' : `translate(${rand(-1, 1) * mag * k}px, ${rand(-1, 1) * mag * k}px) rotate(${rand(-1, 1) * mag * k * 0.04}deg)` });
    }
    shakeEl.animate(frames, { duration: ms / opts.speed(), easing: 'linear' });
  }

  function punch(x, y, scale = 1.08, ms = 420) {
    if (!opts.shake()) return;
    camEl.style.transformOrigin = `${x}px ${y}px`;
    camEl.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})`, offset: 0.25 }, { transform: 'scale(1)' }], { duration: ms / opts.speed(), easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  // 히트스톱: 화면의 모든 움직임을 아주 잠깐 멈춥니다.
  function hitstop(ms = 60) {
    const anims = document.getAnimations().filter(a => {
      const t = a.effect && a.effect.target;
      return a.playState === 'running' && !(t && t.closest && t.closest('#deck, .overlay, #hud'));
    });
    anims.forEach(a => a.pause());
    frozenUntil = performance.now() + ms;
    return new Promise(r => setTimeout(() => {
      anims.forEach(a => { try { if (a.playState === 'paused') a.play(); } catch (e) { /* 이미 끝난 애니메이션 */ } });
      r();
    }, ms));
  }

  function text(x, y, html, cls, ms = 1000) {
    const el = document.createElement('div');
    el.className = 'ftext ' + (cls || '');
    el.innerHTML = html;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.animationDuration = ms / opts.speed() + 'ms';
    floatEl.appendChild(el);
    setTimeout(() => el.remove(), ms / opts.speed() + 50);
    return el;
  }

  // CSS 애니메이션으로 그리는 DOM 효과(보호막 구체, 마법진 등)
  function dom(cls, x, y, ms = 800, html = '', style = {}) {
    const el = document.createElement('div');
    el.className = 'fxd ' + cls;
    el.innerHTML = html;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.animationDuration = ms / opts.speed() + 'ms';
    Object.assign(el.style, style);
    domEl.appendChild(el);
    setTimeout(() => el.remove(), ms / opts.speed() + 50);
    return el;
  }

  /* ---------- 주변 연출: 거꾸로 내리는 비와 부유하는 빛 ---------- */
  function seedAmbient() {
    const nRain = opts.lite ? 40 : 80;
    for (let i = 0; i < nRain; i++) rain.push(newDrop(true));
    for (let i = 0; i < (opts.lite ? 14 : 26); i++) motes.push(newMote(true));
  }
  function newDrop(initial) {
    return { x: Math.random() * (W || 1200), y: initial ? Math.random() * (H || 700) : (H || 700) + rand(0, 40), len: rand(8, 24), sp: rand(3, 8), a: rand(0.06, 0.24), drift: rand(0.3, 0.9) };
  }
  function newMote(initial) {
    return { x: Math.random() * (W || 1200), y: initial ? Math.random() * (H || 700) : (H || 700) + 10, r: rand(1, 2.6), sp: rand(0.15, 0.5), ph: rand(0, TAU), a: rand(0.25, 0.7) };
  }
  function drawAmbient(dt) {
    const k = dt / 16.67;
    amb.clearRect(0, 0, W, H);
    amb.lineCap = 'round';
    amb.strokeStyle = '#cdeee9';
    amb.lineWidth = 1;
    for (const d of rain) {
      d.y -= d.sp * k;
      d.x += d.drift * k * 0.4;
      if (d.y < -d.len) Object.assign(d, newDrop(false));
      amb.globalAlpha = d.a;
      amb.beginPath();
      amb.moveTo(d.x, d.y);
      amb.lineTo(d.x - d.drift * 2, d.y + d.len);
      amb.stroke();
    }
    amb.globalCompositeOperation = 'lighter';
    const img = glowSprite('#f6e7b8');
    for (const m of motes) {
      m.y -= m.sp * k;
      m.ph += 0.02 * k;
      if (m.y < -10) Object.assign(m, newMote(false));
      amb.globalAlpha = m.a * (0.55 + 0.45 * Math.sin(m.ph * 2));
      const s = m.r * 6;
      amb.drawImage(img, m.x + Math.sin(m.ph) * 12 - s / 2, m.y - s / 2, s, s);
    }
    amb.globalAlpha = 1;
    amb.globalCompositeOperation = 'source-over';
  }

  window.FX = { init, resize, burst, ring, slash, bolt, beam, pillar, glyphs, bubbles, projectile, flash, shake, punch, hitstop, text, dom, rand };
})();
