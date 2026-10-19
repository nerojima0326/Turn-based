/* =========================================================
 *  시각 효과 — 캔버스 파티클 · 블룸 · 섬광 · 집중선 · 해일 · 불꽃놀이
 *            주변 연출(거꾸로 내리는 비, 먼 번개) · 흔들림 · 히트스톱 · 떠오르는 글자
 * ========================================================= */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pickOf = v => (Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v);
  const range = v => (Array.isArray(v) ? rand(v[0], v[1]) : v);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const qbez = (a, c, b, k) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * c + k * k * b;

  let opts = { speed: () => 1, shake: () => true, lite: false };
  let canvas, ctx, ambCanvas, amb, stageEl, shakeEl, camEl, flashEl, floatEl, domEl, skyEl;
  let bloomCanvas = null, bctx = null;
  let dpr = 1, W = 0, H = 0;
  let last = performance.now();
  let frozenUntil = 0;
  let nextStorm = performance.now() + 7000;
  const parts = [];
  const glowCache = new Map();
  const rain = [];
  const motes = [];
  const storm = [];
  const timers = {};

  function init(refs, options) {
    Object.assign(opts, options);
    ({ canvas, ambCanvas, stageEl, shakeEl, camEl, flashEl, floatEl, domEl, skyEl } = refs);
    ctx = canvas.getContext('2d');
    amb = ambCanvas.getContext('2d');
    // 블룸(빛 번짐) 후처리: 캔버스 필터를 지원하고 저사양 모드가 아닐 때만
    const probe = document.createElement('canvas').getContext('2d');
    if (!opts.lite && typeof probe.filter === 'string') {
      bloomCanvas = document.createElement('canvas');
      bctx = bloomCanvas.getContext('2d');
    }
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
    if (bloomCanvas) {
      bloomCanvas.width = Math.max(1, Math.round(W / 3));
      bloomCanvas.height = Math.max(1, Math.round(H / 3));
    }
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
    drawAmbient(raw, now);
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
    if (!parts.length) return;
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
          const sx = p.sway ? Math.sin(p.age / 260 + p.seed) * p.sway : 0;
          ctx.drawImage(img, p.x + sx - s / 2, p.y - s / 2, s, s);
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
          const sq = p.squash || 1;
          if (p.fill && p.color.length === 7) {
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(0.7, p.color + '33');
            g.addColorStop(1, p.color + '88');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, r, r * sq, 0, 0, TAU);
            ctx.fill();
          }
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(0.5, p.width * (1 - e));
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * sq, 0, 0, TAU);
          ctx.stroke();
          ctx.lineWidth = Math.max(0.5, p.width * (1 - e) * 0.3);
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          break;
        }
        case 'slash': drawSlash(p, t); break;
        case 'bolt': drawBolt(p); break;
        case 'beam': {
          const w = p.width * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8 * 0.7) * (1 + Math.sin(p.age / 30) * 0.15);
          ctx.lineCap = 'round';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = w * 3;
          ctx.globalAlpha = a * 0.3;
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
          const e = t < 0.2 ? easeOut(t / 0.2) : 1;
          const w = p.width * e * (1 - Math.max(0, t - 0.6) / 0.4 * 0.6);
          const top = p.y - p.height;
          const g = ctx.createLinearGradient(0, top, 0, p.y);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(0.5, p.color);
          g.addColorStop(0.92, '#ffffff');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.globalAlpha = a * 0.3;
          ctx.fillRect(p.x - w * 1.6, top, w * 3.2, p.height + 10);
          ctx.globalAlpha = a;
          ctx.fillRect(p.x - w / 2, top, w, p.height + 10);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(p.x - w * 0.12, top, w * 0.24, p.height + 6);
          ctx.globalAlpha = a * 0.8;
          const img = glowSprite(p.color);
          ctx.drawImage(img, p.x - w * 1.6, p.y - w * 0.5, w * 3.2, w);
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
        case 'rays': drawRays(p, t); break;
        case 'streak': drawStreak(p, t, a); break;
        case 'speedlines': drawSpeedLines(p, t); break;
        case 'brush': drawBrush(p, t, a); break;
        case 'crack': drawCrack(p, t, a); break;
        case 'wave': drawWave(p, t, a); break;
        default: break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // 블룸: 그린 빛을 흐리게 축소해 다시 더해, 빛이 번지는 느낌을 줍니다.
    if (bctx) {
      bctx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
      bctx.filter = 'blur(5px)';
      bctx.drawImage(canvas, 0, 0, bloomCanvas.width, bloomCanvas.height);
      bctx.filter = 'none';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85;
      ctx.drawImage(bloomCanvas, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
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
    for (const [lw, col, al] of [[w * 3.4, p.color, 0.25], [w * 1.8, p.color, 0.5], [w, p.color, 1], [w * 0.35, '#ffffff', 1]]) {
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

  function jaggedPath(x1, y1, x2, y2, n, jitter) {
    const pts = [];
    const nx = -(y2 - y1), ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const j = i === 0 || i === n ? 0 : (Math.random() - 0.5) * jitter;
      pts.push([x1 + (x2 - x1) * k + nx / len * j, y1 + (y2 - y1) * k + ny / len * j]);
    }
    return pts;
  }

  // 갈라지는 번개: 본 줄기 + 가지 2~3개, 45ms마다 모양이 바뀝니다.
  function drawBolt(p) {
    if (!p.paths || p.age - (p.regen || 0) > 45) {
      p.regen = p.age;
      const main = jaggedPath(p.x, p.y, p.x2, p.y2, p.segments || 10, p.jitter);
      p.paths = [main];
      const forks = p.forks != null ? p.forks : 2;
      for (let f = 0; f < forks; f++) {
        const from = main[2 + Math.floor(Math.random() * (main.length - 4))];
        const ang = Math.atan2(p.y2 - p.y, p.x2 - p.x) + rand(-1, 1);
        const len = Math.hypot(p.x2 - p.x, p.y2 - p.y) * rand(0.2, 0.4);
        p.paths.push(jaggedPath(from[0], from[1], from[0] + Math.cos(ang) * len, from[1] + Math.sin(ang) * len, 5, p.jitter * 0.6));
      }
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    p.paths.forEach((pts, i) => {
      const scale = i ? 0.55 : 1;
      for (const [lw, col] of [[p.width * 4 * scale, p.color], [p.width * scale, '#ffffff']]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    });
  }

  // 별 모양 섬광의 방사형 광선
  function drawRays(p, t) {
    const e = t < 0.2 ? easeOut(t / 0.2) : 1;
    const len = p.size * e * (1 + t * 0.35);
    const bw = Math.max(1.5, p.size * 0.05);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    for (let i = 0; i < p.rays; i++) {
      const L = len * (i % 2 ? 0.5 : 1);
      ctx.save();
      ctx.rotate((i / p.rays) * TAU);
      const g = ctx.createLinearGradient(0, 0, L, 0);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, p.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -bw);
      ctx.lineTo(L, 0);
      ctx.lineTo(0, bw);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // 가로로 길게 뻗는 렌즈 섬광 줄기
  function drawStreak(p, t, a) {
    const L = p.size * (0.5 + easeOut(t) * 0.7);
    const hh = Math.max(0.5, p.width * (1 - t));
    const g = ctx.createLinearGradient(p.x - L, 0, p.x + L, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.42, p.color);
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(0.58, p.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.globalAlpha = a * 0.35;
    ctx.fillRect(p.x - L, p.y - hh * 3, L * 2, hh * 6);
    ctx.globalAlpha = a;
    ctx.fillRect(p.x - L, p.y - hh / 2, L * 2, hh);
  }

  // 화면 가장자리에서 한 점으로 모이는 집중선
  function drawSpeedLines(p, t) {
    if (!p.lines || p.age - (p.regen || 0) > 55) {
      p.regen = p.age;
      p.lines = Array.from({ length: p.count }, () => ({ a: Math.random() * TAU, w: rand(1, 4.5), r: rand(0.32, 0.62) }));
    }
    const R0 = Math.hypot(W, H) * 0.75;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = p.color;
    for (const l of p.lines) {
      const rIn = R0 * l.r * (1 - 0.12 * easeOut(t));
      const ca = Math.cos(l.a), sa = Math.sin(l.a);
      ctx.beginPath();
      ctx.moveTo(p.x + ca * R0 - sa * l.w * 3, p.y + sa * R0 + ca * l.w * 3);
      ctx.lineTo(p.x + ca * rIn, p.y + sa * rIn);
      ctx.lineTo(p.x + ca * R0 + sa * l.w * 3, p.y + sa * R0 - ca * l.w * 3);
      ctx.fill();
    }
  }

  // 붓 획: 굵기가 변하는 먹선이 빠르게 그어집니다.
  function drawBrush(p, t, a) {
    const prog = easeOut(Math.min(1, t / 0.3));
    const N = 30;
    for (const [pass, col, scale, al] of [['lighter', p.glow, 2.6, 0.45], ['lighter', p.glow, 1.5, 0.7], ['lighter', p.color, 1, 1]]) {
      ctx.globalCompositeOperation = pass;
      ctx.globalAlpha = a * al;
      ctx.fillStyle = col;
      for (let i = 0; i <= N * prog; i++) {
        const k = i / N;
        const x = qbez(p.x, p.cx, p.x2, k), y = qbez(p.y, p.cy, p.y2, k);
        const w = p.width * scale * Math.sin(Math.PI * Math.min(1, k * 1.1 + 0.05)) * (0.7 + 0.3 * Math.sin(k * 11 + p.seed));
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, w / 2), 0, TAU);
        ctx.fill();
      }
    }
  }

  // 바닥 균열
  function drawCrack(p, t, a) {
    const grow = easeOut(Math.min(1, t / 0.15));
    ctx.lineJoin = 'round';
    for (const [lw, col, al] of [[5, p.color, 0.45], [1.6, '#ffffff', 1]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.globalAlpha = a * al;
      for (const pts of p.paths) {
        const n = Math.max(1, Math.ceil(pts.length * grow));
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const [dx, dy] = pts[i];
          if (i) ctx.lineTo(p.x + dx, p.y + dy); else ctx.moveTo(p.x + dx, p.y + dy);
        }
        ctx.stroke();
      }
    }
  }

  // 해일: 말려 올라가는 물마루가 화면을 가로지릅니다. (뒤쪽 물결 + 앞 물마루 + 안쪽 물살 + 거품선)
  function waveShape(cx, base, hh, len) {
    ctx.beginPath();
    ctx.moveTo(cx - len, base + 24);
    ctx.bezierCurveTo(cx - len * 0.55, base - hh * 0.25, cx - len * 0.25, base - hh * 0.95, cx - hh * 0.1, base - hh);
    ctx.bezierCurveTo(cx + hh * 0.3, base - hh * 1.03, cx + hh * 0.42, base - hh * 0.72, cx + hh * 0.16, base - hh * 0.55);
    ctx.bezierCurveTo(cx + hh * 0.34, base - hh * 0.3, cx + hh * 0.22, base - hh * 0.05, cx + hh * 0.08, base + 24);
    ctx.closePath();
  }
  function drawWave(p, t, a) {
    const cx = p.cx, base = p.y, hh = p.hh;
    if (cx == null || hh <= 1) return;
    ctx.globalCompositeOperation = 'source-over';
    // 뒤쪽 물결
    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = 'rgba(12,74,110,0.9)';
    waveShape(cx - hh * 0.55, base, hh * 0.78, p.length * 0.9);
    ctx.fill();
    // 앞 물마루
    const g = ctx.createLinearGradient(0, base - hh, 0, base + 24);
    g.addColorStop(0, 'rgba(240,249,255,0.95)');
    g.addColorStop(0.14, 'rgba(186,230,253,0.9)');
    g.addColorStop(0.4, p.color);
    g.addColorStop(1, 'rgba(8,47,73,0.5)');
    ctx.fillStyle = g;
    ctx.globalAlpha = a * 0.82;
    waveShape(cx, base, hh, p.length);
    ctx.fill();
    // 안쪽 물살 줄기
    ctx.save();
    waveShape(cx, base, hh, p.length);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(224,242,254,0.35)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 4; i++) {
      const k = i / 5;
      const off = Math.sin(p.age / 140 + i) * 10;
      ctx.beginPath();
      ctx.moveTo(cx - p.length * (0.9 - k * 0.3), base - hh * k * 0.5 + off);
      ctx.bezierCurveTo(cx - p.length * 0.4, base - hh * (0.2 + k * 0.6) + off, cx - hh * 0.4, base - hh * (0.35 + k * 0.5), cx + hh * 0.05, base - hh * (0.25 + k * 0.5));
      ctx.stroke();
    }
    ctx.restore();
    // 물마루 거품선
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    for (const [lw, col] of [[9, 'rgba(186,230,253,0.35)'], [3, 'rgba(255,255,255,0.95)']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(cx - p.length * 0.35, base - hh * 0.86);
      ctx.bezierCurveTo(cx - p.length * 0.15, base - hh * 0.99, cx, base - hh * 1.02, cx + hh * 0.3, base - hh * 0.85);
      ctx.bezierCurveTo(cx + hh * 0.4, base - hh * 0.72, cx + hh * 0.25, base - hh * 0.6, cx + hh * 0.16, base - hh * 0.55);
      ctx.stroke();
    }
  }

  function add(p) {
    const q = Object.assign({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 600, size: 3, alpha: 1, rot: 0, vr: 0, color: '#fff', kind: 'glow', seed: Math.random() * 10 }, p);
    // 저사양 모드의 개수 제한은 장식용 파티클에만 적용합니다. (발사체처럼 끝나기를 기다리는 파티클은 제외)
    if (opts.lite && parts.length > 260 && !q.done && !q.update && (q.kind === 'glow' || q.kind === 'spark')) return q;
    parts.push(q);
    return q;
  }
  const lite = n => Math.max(1, Math.round(n * (opts.lite ? 0.5 : 1)));

  /* ---------- 공개 효과 ---------- */
  function burst(x, y, o = {}) {
    const n = lite(o.count || 20);
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
        rot: rand(0, TAU), len: o.len, alpha: o.alpha != null ? o.alpha : 1, blend: o.blend, fadeIn: o.fadeIn, sway: o.sway
      });
    }
  }

  const ring = (x, y, o = {}) => add({ kind: 'ring', x, y, r0: o.r0 || 6, r1: o.r1 || 80, width: o.width || 6, color: o.color || '#ffffff', life: o.life || 500, squash: o.squash, fill: o.fill, alpha: o.alpha != null ? o.alpha : 1 });

  const slash = (x, y, o = {}) => add({ kind: 'slash', x, y, angle: o.angle != null ? o.angle : -30, arc: o.arc || 150, radius: o.radius || 70, width: o.width || 6, color: o.color || '#bae6fd', life: o.life || 380, dir: o.dir || 1 });

  // 화려한 검기: 본 검기 + 잔향 검기 2겹 + 궤적을 따라 튀는 불꽃 + 섬광
  function bigSlash(x, y, o = {}) {
    const radius = o.radius || 70;
    slash(x, y, o);
    slash(x, y, Object.assign({}, o, { radius: radius * 1.12, width: (o.width || 6) * 0.45, life: (o.life || 380) * 1.2 }));
    slash(x, y, Object.assign({}, o, { radius: radius * 0.86, width: (o.width || 6) * 0.35, life: (o.life || 380) * 0.9 }));
    const arc = (o.arc || 150) * Math.PI / 180;
    const mid = (o.angle != null ? o.angle : -30) * Math.PI / 180;
    for (let i = 0; i < lite(18); i++) {
      const a = mid + (Math.random() - 0.5) * arc;
      const tx = Math.cos(a + Math.PI / 2 * (o.dir || 1)), ty = Math.sin(a + Math.PI / 2 * (o.dir || 1));
      const sp = rand(3, 9);
      add({ kind: 'spark', x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius, vx: tx * sp, vy: ty * sp, size: rand(1.2, 2.4), len: 2.5, color: pickOf([o.color || '#bae6fd', '#ffffff']), life: rand(220, 480), drag: 0.06 });
    }
    flare(x + Math.cos(mid) * radius, y + Math.sin(mid) * radius, { color: o.color || '#bae6fd', size: radius * 0.9, rays: 8, life: 320 });
  }

  // 별 모양 섬광: 중심 광원 + 방사형 광선 + 가로 렌즈 줄기
  function flare(x, y, o = {}) {
    const color = o.color || '#fff7d6';
    const size = o.size || 80;
    const life = o.life || 420;
    add({ kind: 'glow', x, y, size: size * 0.32, size1: size * 0.55, color, life: life * 0.8 });
    add({ kind: 'rays', x, y, size, color, rays: o.rays || 12, rot: rand(0, TAU), vr: 0.025, life });
    if (o.streak !== false) add({ kind: 'streak', x, y, size: size * (o.streakScale || 3.2), width: o.width || 3.5, color: o.streakColor || color, life: life * 1.15 });
  }

  function streak(x, y, o = {}) {
    add({ kind: 'streak', x, y, size: o.size || 300, width: o.width || 4, color: o.color || '#fde68a', life: o.life || 500 });
  }

  // 화면 전체 집중선
  function speedLines(o = {}) {
    add({ kind: 'speedlines', x: o.x != null ? o.x : W / 2, y: o.y != null ? o.y : H / 2, count: lite(o.count || 46), color: o.color || '#ffffff', alpha: o.alpha != null ? o.alpha : 0.55, life: o.life || 700, fadeIn: 0.15, blend: 'source-over' });
  }

  // 중심을 돌며 모이거나 퍼지는 소용돌이
  function swirl(x, y, o = {}) {
    const n = lite(o.count || 24);
    const dir = o.dir || 1;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU + rand(-0.2, 0.2);
      const r0 = range(o.radius || [30, 60]);
      const turns = o.turns || 1.4;
      add({
        kind: o.kind || 'glow', x, y, size: range(o.size || [2, 4]), color: pickOf(o.colors || '#fff'), life: range(o.life || [700, 1100]),
        fadeIn: 0.12, rot: rand(0, TAU), vr: 0.1, blend: o.blend,
        update(p) {
          const k = p.age / p.life;
          const r = r0 * (o.inward ? 1 - k * 0.9 : 1 + k * (o.expand != null ? o.expand : 0.6));
          const a = a0 + dir * k * turns * TAU;
          p.x = x + Math.cos(a) * r;
          p.y = y + Math.sin(a) * r * (o.squash || 1) - k * (o.rise || 0);
        }
      });
    }
  }

  function brush(x1, y1, x2, y2, o = {}) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const bend = o.bend != null ? o.bend : 0.3;
    add({ kind: 'brush', x: x1, y: y1, x2, y2, cx: mx - (y2 - y1) * bend, cy: my + (x2 - x1) * bend, width: o.width || 14, color: o.color || '#1e1b4b', glow: o.glow || '#a78bfa', life: o.life || 650, blend: 'source-over' });
  }

  function crack(x, y, o = {}) {
    const paths = [];
    const n = o.branches || 7;
    const sq = o.squash != null ? o.squash : 0.35;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rand(-0.3, 0.3);
      const len = range(o.length || [40, 110]);
      const pts = [[0, 0]];
      let px = 0, py = 0;
      for (let s = 1; s <= 5; s++) {
        const r = (len * s) / 5;
        const a = ang + rand(-0.35, 0.35);
        px = Math.cos(a) * r; py = Math.sin(a) * r * sq;
        pts.push([px, py]);
      }
      paths.push(pts);
    }
    add({ kind: 'crack', x, y, paths, color: o.color || '#93c5fd', life: o.life || 900 });
  }

  // 해일: from → to 로 물마루가 밀려가며 물보라를 흩뿌립니다.
  function wave(o = {}) {
    const from = o.from != null ? o.from : -200;
    const to = o.to != null ? o.to : W + 200;
    const hgt = o.height || 160;
    const len = o.length || hgt * 3;
    const colors = o.foam || ['#ffffff', '#e0f2fe', '#7dd3fc'];
    add({
      kind: 'wave', x: from, x2: to, y: o.y != null ? o.y : H * 0.75, height: hgt, length: len, color: o.color || 'rgba(56,189,248,0.85)',
      life: o.life || 1000, fadeIn: 0.05, blend: 'source-over',
      update(p) {
        const t = p.age / p.life;
        const e = easeInOut(Math.min(1, t / 0.85));
        p.cx = from + (to - from) * e;
        p.hh = hgt * (t < 0.15 ? easeOut(t / 0.15) : 1) * (1 - Math.max(0, t - 0.8) * 2);
        const n = opts.lite ? 1 : 3;
        for (let i = 0; i < n; i++) {
          add({ kind: 'glow', x: p.cx + rand(-10, 30), y: p.y - p.hh * rand(0.55, 1.02), vx: rand(2, 8), vy: rand(-6, -1), gravity: 0.25, drag: 0.02, size: rand(2, 6), color: pickOf(colors), life: rand(400, 850) });
        }
      }
    });
  }

  function bolt(x1, y1, x2, y2, o = {}) {
    return add({ kind: 'bolt', x: x1, y: y1, x2, y2, width: o.width || 2.2, color: o.color || '#7dd3fc', jitter: o.jitter || 26, segments: o.segments, forks: o.forks, life: o.life || 260 });
  }

  const beam = (x1, y1, x2, y2, o = {}) => add({ kind: 'beam', x: x1, y: y1, x2, y2, width: o.width || 8, color: o.color || '#fde68a', life: o.life || 420 });

  // 빛기둥: 하늘에서 내리꽂히며 기둥 안으로 빛 알갱이가 솟아오릅니다.
  function pillar(x, y, o = {}) {
    const width = o.width || 60;
    const color = o.color || '#fde68a';
    add({ kind: 'pillar', x, y, width, height: o.height || y + 40, color, life: o.life || 700 });
    for (let i = 0; i < lite(18); i++) {
      add({ kind: 'glow', x: x + rand(-width * 0.4, width * 0.4), y: y - rand(0, 40), vx: 0, vy: -rand(2, 6), size: rand(2, 4), color: pickOf([color, '#ffffff']), life: rand(500, 900), drag: 0.01 });
    }
    ring(x, y, { color, r0: width * 0.3, r1: width * 1.6, width: 6, squash: 0.3, life: o.life ? o.life * 0.8 : 600, fill: true });
  }

  function glyphs(x, y, o = {}) {
    const chars = o.chars || ['書'];
    for (let i = 0; i < lite(o.count || 6); i++) {
      const ang = rand(0, TAU), sp = range(o.speed || [0.6, 2]);
      add({ kind: 'glyph', text: pickOf(chars), x: x + rand(-20, 20), y: y + rand(-20, 20), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (o.rise || 0.6), size: range(o.size || [12, 22]), color: o.color || '#fde68a', life: range(o.life || [700, 1100]), vr: rand(-0.04, 0.04), drag: 0.02, blend: 'source-over', fadeIn: 0.15 });
    }
  }

  function bubbles(x, y, o = {}) {
    for (let i = 0; i < lite(o.count || 10); i++) {
      add({ kind: 'bubble', x: x + rand(-1, 1) * (o.spread || 40), y: y + rand(-10, 10), vx: 0, vy: -rand(0.6, 1.8), size: rand(2, 6), color: o.color || 'rgba(186,230,253,.7)', life: rand(700, 1300), blend: 'source-over' });
    }
  }

  // 오래 떠다니는 불티
  function embers(x, y, o = {}) {
    for (let i = 0; i < lite(o.count || 14); i++) {
      add({ kind: 'glow', x: x + rand(-1, 1) * (o.spread || 50), y: y + rand(-1, 1) * (o.spreadY || 20), vx: rand(-0.4, 0.4), vy: -rand(0.4, 1.4), size: rand(1.5, 3.2), color: pickOf(o.colors || ['#ffb347', '#ffd27a']), life: rand(1200, 2200), drag: 0.01, sway: 10, fadeIn: 0.1 });
    }
  }

  // 불꽃놀이 한 발
  function firework(x, y, colors) {
    const c = pickOf(colors || ['#fde68a', '#f472b6', '#7dd3fc', '#86efac']);
    const n = lite(64);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.05, 0.05);
      const sp = rand(3.2, 6);
      add({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, gravity: 0.06, drag: 0.035, size: 2, len: 3, color: c, life: rand(900, 1300) });
    }
    for (let i = 0; i < lite(20); i++) {
      add({ kind: 'glow', x: x + rand(-60, 60), y: y + rand(-60, 60), size: rand(1.5, 3), color: '#ffffff', life: rand(600, 1200), fadeIn: 0.5 });
    }
    flare(x, y, { color: c, size: 70, rays: 10, life: 360, streak: false });
  }

  // 발사체: 목표에 닿으면 resolve 됩니다. spiral 옵션이면 나선 꼬리가 붙습니다.
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
          const trail = pickOf(o.trail || o.color || '#ffb347');
          add({ kind: 'glow', x: p.x + rand(-3, 3), y: p.y + rand(-3, 3), vx: rand(-0.6, 0.6), vy: rand(-0.6, 0.6), size: rand(2, (o.size || 9) * 0.65), color: trail, life: rand(220, 460), drag: 0.05 });
          add({ kind: 'glow', x: p.x, y: p.y, size: (o.size || 9) * 0.45, color: '#ffffff', life: 90 });
          if (o.spiral) {
            const s = (o.size || 9) * 1.4;
            const ang = p.age / 30;
            for (const k of [0, Math.PI]) add({ kind: 'glow', x: p.x + Math.cos(ang + k) * s, y: p.y + Math.sin(ang + k) * s, size: rand(1.5, 3), color: trail, life: rand(260, 420) });
          }
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

  // 잠깐 상태 클래스를 붙였다 떼는 화면 효과 (흔들림 설정을 끄면 함께 꺼집니다)
  function pulseClass(name, ms) {
    if (!opts.shake()) return;
    clearTimeout(timers[name]);
    stageEl.classList.remove(name);
    void stageEl.offsetWidth;
    stageEl.classList.add(name);
    timers[name] = setTimeout(() => stageEl.classList.remove(name), ms / opts.speed());
  }
  // 임팩트 프레임: 아주 짧게 고대비 흑백으로 바뀌는 강타 연출
  const impact = (ms = 70) => pulseClass('impact', ms);
  // 색수차: 빨강·파랑 테두리가 어긋나 보이는 충격 연출
  const chroma = (ms = 180) => pulseClass('chroma', ms);

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
    Object.entries(style).forEach(([k, v]) => el.style.setProperty(k, v));
    domEl.appendChild(el);
    setTimeout(() => el.remove(), ms / opts.speed() + 50);
    return el;
  }

  /* ---------- 주변 연출: 거꾸로 내리는 비, 부유하는 빛, 먼 하늘의 번개 ---------- */
  function seedAmbient() {
    const nRain = opts.lite ? 40 : 90;
    for (let i = 0; i < nRain; i++) rain.push(newDrop(true));
    for (let i = 0; i < (opts.lite ? 14 : 30); i++) motes.push(newMote(true));
  }
  function newDrop(initial) {
    return { x: Math.random() * (W || 1200), y: initial ? Math.random() * (H || 700) : (H || 700) + rand(0, 40), len: rand(8, 24), sp: rand(3, 8), a: rand(0.06, 0.24), drift: rand(0.3, 0.9) };
  }
  function newMote(initial) {
    return { x: Math.random() * (W || 1200), y: initial ? Math.random() * (H || 700) : (H || 700) + 10, r: rand(1, 2.6), sp: rand(0.15, 0.5), ph: rand(0, TAU), a: rand(0.25, 0.7) };
  }
  // 수평선 너머로 번개가 칩니다. (흔들림·섬광 설정을 끄면 치지 않습니다)
  function strikeStorm(now) {
    nextStorm = now + rand(9000, 18000);
    if (!opts.shake() || document.hidden) return;
    const x = rand(W * 0.08, W * 0.92);
    const pts = jaggedPath(x, -10, x + rand(-60, 60), H * rand(0.3, 0.42), 9, 40);
    storm.push({ pts, born: now, life: 260 });
    if (skyEl) skyEl.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.9)', offset: 0.1 }, { filter: 'brightness(1.1)', offset: 0.35 }, { filter: 'brightness(1.6)', offset: 0.5 }, { filter: 'brightness(1)' }], { duration: 650 });
  }
  function drawAmbient(dt, now) {
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
    if (now > nextStorm) strikeStorm(now);
    for (let i = storm.length - 1; i >= 0; i--) {
      const s = storm[i];
      const t = (now - s.born) / s.life;
      if (t >= 1) { storm.splice(i, 1); continue; }
      amb.globalAlpha = (1 - t) * (t < 0.15 || (t > 0.35 && t < 0.5) ? 0.9 : 0.4);
      for (const [lw, col] of [[5, '#a5f3fc'], [1.4, '#ffffff']]) {
        amb.strokeStyle = col;
        amb.lineWidth = lw;
        amb.beginPath();
        s.pts.forEach(([x, y], j) => (j ? amb.lineTo(x, y) : amb.moveTo(x, y)));
        amb.stroke();
      }
    }
    amb.globalAlpha = 1;
    amb.globalCompositeOperation = 'source-over';
  }

  window.FX = {
    init, resize, burst, ring, slash, bigSlash, flare, streak, speedLines, swirl, brush, crack, wave, bolt, beam, pillar,
    glyphs, bubbles, embers, firework, projectile, flash, shake, punch, impact, chroma, hitstop, text, dom, rand,
    get size() { return { w: W, h: H }; }
  };
})();
