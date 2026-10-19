/* =========================================================
 *  SVG 스프라이트 — 캐릭터 · 적 · 아이콘 · 배경 스카이라인
 *  모든 그래픽은 코드로 그려 외부 이미지 없이 동작합니다.
 * ========================================================= */
(() => {
  'use strict';

  let idSeq = 0;
  const nextId = () => 'sp' + (++idSeq) + '_';
  const f1 = n => n.toFixed(1);

  /* ---------- 아군: 촛불 ---------- */
  function candle(p) {
    return `<svg class="spr spr-candle" viewBox="0 0 120 170" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <radialGradient id="${p}g"><stop offset="0" stop-color="#ffd27a" stop-opacity=".85"/><stop offset=".4" stop-color="#ff9a2e" stop-opacity=".28"/><stop offset="1" stop-color="#ff7a00" stop-opacity="0"/></radialGradient>
        <linearGradient id="${p}w" x1="0" x2="1"><stop offset="0" stop-color="#c2ae88"/><stop offset=".3" stop-color="#fff9ec"/><stop offset=".65" stop-color="#f1e4c9"/><stop offset="1" stop-color="#9c8963"/></linearGradient>
        <linearGradient id="${p}b" x1="0" x2="1"><stop offset="0" stop-color="#4f340f"/><stop offset=".35" stop-color="#f0cd76"/><stop offset=".6" stop-color="#b8863a"/><stop offset="1" stop-color="#3a260a"/></linearGradient>
        <radialGradient id="${p}f" cx=".5" cy=".8" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".22" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffb347"/><stop offset=".8" stop-color="#ff5e00"/><stop offset="1" stop-color="#ff3d00" stop-opacity="0"/></radialGradient>
      </defs>
      <circle class="c-glow" cx="60" cy="40" r="48" fill="url(#${p}g)"/>
      <path d="M100 150 C 117 148 118 127 104 126" fill="none" stroke="url(#${p}b)" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="60" cy="157" rx="42" ry="9" fill="#24180a"/>
      <path d="M19 152 C 25 139 95 139 101 152 C 97 161 23 161 19 152 Z" fill="url(#${p}b)"/>
      <ellipse cx="60" cy="146" rx="25" ry="5" fill="#6b4a18"/>
      <rect x="38" y="133" width="44" height="13" rx="3" fill="url(#${p}b)"/>
      <path d="M41 74 Q60 66 79 74 L79 136 L41 136 Z" fill="url(#${p}w)"/>
      <path d="M41 74 Q60 66 79 74 Q78 80 74 79 Q73 93 69.5 93 Q66 93 66 81 Q60 83 54 81 Q53 100 48.5 100 Q45 100 45 81 Q42 80 41 74 Z" fill="#fffaf0"/>
      <path d="M44 132 L44 90" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
      <path class="c-lid" d="M49 109 q3.5 3.5 7 0 M64 109 q3.5 3.5 7 0" stroke="#6b4a2f" stroke-width="1.7" fill="none" stroke-linecap="round"/>
      <ellipse cx="48" cy="116" rx="4" ry="2.2" fill="#f49a9a" opacity=".45"/>
      <ellipse cx="72" cy="116" rx="4" ry="2.2" fill="#f49a9a" opacity=".45"/>
      <path d="M57.5 118 q2.5 2 5 0" stroke="#6b4a2f" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M60 71 q1.6 -5 0 -10" stroke="#2b1d10" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <g class="c-sway"><g class="c-flame">
        <path d="M60 12 C 75 31 75 50 60 64 C 45 50 45 31 60 12 Z" fill="url(#${p}f)"/>
        <path d="M60 35 C 66.5 43 66.5 54 60 60 C 53.5 54 53.5 43 60 35 Z" fill="#fffbe8" opacity=".95"/>
      </g></g>
    </svg>`;
  }

  /* ---------- 아군: 칼 ---------- */
  function sword(p) {
    return `<svg class="spr spr-sword" viewBox="0 0 100 170" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <linearGradient id="${p}bl" x1="0" x2="1"><stop offset="0" stop-color="#7d92b0"/><stop offset=".45" stop-color="#f4f8ff"/><stop offset=".55" stop-color="#c3d2e8"/><stop offset="1" stop-color="#5c7090"/></linearGradient>
        <linearGradient id="${p}go" x1="0" x2="1"><stop offset="0" stop-color="#5b3e0e"/><stop offset=".45" stop-color="#f6d77c"/><stop offset=".7" stop-color="#b98a2e"/><stop offset="1" stop-color="#3f2a0a"/></linearGradient>
        <radialGradient id="${p}gm" cx=".4" cy=".35"><stop offset="0" stop-color="#e0f2fe"/><stop offset=".5" stop-color="#38bdf8"/><stop offset="1" stop-color="#0c4a6e"/></radialGradient>
        <radialGradient id="${p}au"><stop offset="0" stop-color="#7cb4ff" stop-opacity=".4"/><stop offset="1" stop-color="#7cb4ff" stop-opacity="0"/></radialGradient>
        <linearGradient id="${p}gl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <clipPath id="${p}cl"><path d="M42 60 L58 60 L56 140 L50 166 L44 140 Z"/></clipPath>
      </defs>
      <ellipse class="s-aura" cx="50" cy="92" rx="42" ry="78" fill="url(#${p}au)"/>
      <path class="s-tassel" d="M53 26 C 68 38 61 57 71 69 C 77 77 73 88 79 97" stroke="#dc2626" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="79" cy="98" r="3" fill="#f6d77c"/>
      <circle cx="50" cy="13" r="7" fill="url(#${p}go)"/>
      <circle cx="50" cy="13" r="3" fill="url(#${p}gm)"/>
      <rect x="45" y="19" width="10" height="31" rx="3" fill="#1e2a44"/>
      <path d="M45 24 L55 28 M45 30 L55 34 M45 36 L55 40 M45 42 L55 46" stroke="#4a5d8c" stroke-width="2"/>
      <path d="M17 52 Q30 45 50 50 Q70 45 83 52 Q87 58 81 60 Q66 55 50 58 Q34 55 19 60 Q13 58 17 52 Z" fill="url(#${p}go)"/>
      <circle cx="15" cy="56" r="3.2" fill="url(#${p}go)"/>
      <circle cx="85" cy="56" r="3.2" fill="url(#${p}go)"/>
      <path d="M50 48.5 L56.5 55 L50 61.5 L43.5 55 Z" fill="url(#${p}gm)" stroke="#f6d77c" stroke-width="1"/>
      <path d="M42 60 L58 60 L56 140 L50 166 L44 140 Z" fill="url(#${p}bl)"/>
      <path d="M50 64 L50 136" stroke="#eef4ff" stroke-width="2" opacity=".7"/>
      <path d="M43 62 L45 140 L50 164" stroke="#fff" stroke-width=".8" opacity=".6" fill="none"/>
      <text x="50" y="104" font-size="9" fill="#9ec5ff" text-anchor="middle" opacity=".75" font-family="serif">星</text>
      <g clip-path="url(#${p}cl)"><rect class="s-glint" x="36" y="40" width="28" height="22" fill="url(#${p}gl)"/></g>
    </svg>`;
  }

  /* ---------- 아군: 책갈피 ---------- */
  function book(p) {
    const lines = (x1, x2, flip) => Array.from({ length: 6 }, (_, i) => {
      const y = 83 + i * 6.5;
      return flip
        ? `<path d="M${x1} ${y - 3} Q${(x1 + x2) / 2} ${y - 9} ${x2} ${y - 1}" />`
        : `<path d="M${x1} ${y - 1} Q${(x1 + x2) / 2} ${y - 9} ${x2} ${y - 3}" />`;
    }).join('');
    return `<svg class="spr spr-book" viewBox="0 0 140 170" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <linearGradient id="${p}cv" x1="0" x2="1"><stop offset="0" stop-color="#0a3324"/><stop offset=".5" stop-color="#1d7a52"/><stop offset="1" stop-color="#0a3324"/></linearGradient>
        <linearGradient id="${p}pg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fffbf2"/><stop offset="1" stop-color="#e5d8bb"/></linearGradient>
        <radialGradient id="${p}au"><stop offset="0" stop-color="#6ee7b7" stop-opacity=".45"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/></radialGradient>
      </defs>
      <ellipse class="b-aura" cx="70" cy="96" rx="64" ry="62" fill="url(#${p}au)"/>
      <g class="b-book">
        <path d="M9 80 Q70 63 131 80 L127 131 Q70 116 13 131 Z" fill="url(#${p}cv)" stroke="#d4af37" stroke-width="1.6"/>
        <path d="M15 76 Q42 63 70 74 L70 125 Q42 114 17 125 Z" fill="url(#${p}pg)"/>
        <path d="M70 74 Q98 63 125 76 L123 125 Q98 114 70 125 Z" fill="url(#${p}pg)"/>
        <path d="M17 125 Q42 114 70 125 Q98 114 123 125" stroke="#bfae88" stroke-width="1.2" fill="none"/>
        <g stroke="#8f826a" stroke-width="1" fill="none" opacity=".55">${lines(23, 63, false)}${lines(77, 117, true)}</g>
        <path d="M70 74 L70 125" stroke="#b09f7b" stroke-width="1.8"/>
        <path class="b-flip" d="M70 74 Q97 61 121 72 L119 120 Q97 110 70 125 Z" fill="#fffdf7" opacity=".93"/>
        <path class="b-ribbon" d="M90 115 L90 160 L85 154 L80 160 L80 117" fill="#d63a3a"/>
        <path d="M9 80 L17 78 M131 80 L123 78 M13 131 L20 128 M127 131 L120 128" stroke="#f6d77c" stroke-width="2"/>
      </g>
      <g class="b-runes" fill="#a7f3d0" font-size="13" font-family="serif" text-anchor="middle">
        <text class="rn r1" x="20" y="52">智</text><text class="rn r2" x="118" y="44">書</text><text class="rn r3" x="70" y="30">文</text>
      </g>
    </svg>`;
  }

  /* ---------- 적: 해파리 (변형 3종) ---------- */
  const JELLY = {
    minijelly: { c1: '#fff1c7', c2: '#f5b544', c3: '#8f4a0a', glow: '#ffd27a', n: 5, eyes: 'cute', tw: 2.6, len: 66 },
    jelly:     { c1: '#fae8ff', c2: '#c084fc', c3: '#4c1d95', glow: '#f0abfc', n: 6, eyes: 'calm', tw: 2.8, len: 80 },
    queen:     { c1: '#ffe4e6', c2: '#fb7185', c3: '#4c0519', glow: '#fda4af', n: 9, eyes: 'evil', tw: 3.2, len: 92, crown: true, frills: true }
  };

  function tentaclePath(x0, y0, len, phase, amp) {
    const segs = 4;
    let d = `M${f1(x0)} ${y0}`, px = x0, py = y0;
    for (let s = 1; s <= segs; s++) {
      const y = y0 + (len * s) / segs;
      const x = x0 + Math.sin(phase + s * 1.3) * amp * (s / segs + 0.3);
      const cx = (px + x) / 2 + Math.cos(phase + s) * amp * 0.9;
      d += ` Q${f1(cx)} ${f1((py + y) / 2)} ${f1(x)} ${f1(y)}`;
      px = x; py = y;
    }
    return d;
  }

  function animatedPath(x0, y0, len, seed, amp, attrs, dur) {
    const frames = [0, 1, 2].map(k => tentaclePath(x0, y0, len, seed + k * 2.1, amp));
    return `<path d="${frames[0]}" ${attrs}><animate attributeName="d" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.33;.66;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1" values="${frames[0]};${frames[1]};${frames[2]};${frames[0]}"/></path>`;
  }

  function jelly(p, kind) {
    const o = JELLY[kind];
    const cx = 80, baseY = 92;
    let tentacles = '';
    for (let i = 0; i < o.n; i++) {
      const x0 = cx - 46 + (92 * i) / (o.n - 1);
      const len = o.len + ((i * 37) % 4) * 6;
      tentacles += animatedPath(x0, baseY, len, i * 0.9, 6 + (i % 3), `stroke="url(#${p}t)" stroke-width="${o.tw}" fill="none" stroke-linecap="round"`, 2.8 + (i % 3) * 0.45);
    }
    let arms = '';
    [68, 80, 92].forEach((x, i) => {
      arms += animatedPath(x, baseY - 4, o.len * 0.72, 4 + i * 1.7, 5, `stroke="${o.c1}" stroke-opacity=".5" stroke-width="${o.tw * 2.6}" fill="none" stroke-linecap="round"`, 3.4 + i * 0.3);
    });
    if (o.frills) {
      [40, 120].forEach((x, i) => {
        arms += animatedPath(x, baseY, o.len * 1.05, 2 + i * 2.4, 9, `stroke="${o.c2}" stroke-opacity=".35" stroke-width="${o.tw * 3.4}" fill="none" stroke-linecap="round"`, 4 + i * 0.5);
      });
    }
    let scallop = '';
    for (let k = 0; k < 8; k++) {
      const x1 = 144 - 16 * k;
      scallop += ` Q${x1 - 8} 101 ${x1 - 16} 92`;
    }
    let eyes = '';
    if (o.eyes === 'cute') {
      eyes = `<ellipse cx="66" cy="72" rx="4.6" ry="5.6" fill="#2a1406"/><ellipse cx="94" cy="72" rx="4.6" ry="5.6" fill="#2a1406"/>
        <circle cx="67.6" cy="70" r="1.7" fill="#fff"/><circle cx="95.6" cy="70" r="1.7" fill="#fff"/>
        <path d="M76 81 q4 3 8 0" stroke="#2a1406" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    } else if (o.eyes === 'calm') {
      eyes = `<path d="M60 72 q6 5 12 0 M88 72 q6 5 12 0" stroke="#2e1065" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <ellipse cx="62" cy="80" rx="5" ry="2.4" fill="#f0abfc" opacity=".5"/><ellipse cx="98" cy="80" rx="5" ry="2.4" fill="#f0abfc" opacity=".5"/>`;
    } else {
      eyes = `<g filter="url(#${p}eg)"><path class="j-eye" d="M54 64 L75 71 L58 76 Z" fill="#fff4b0"/><path class="j-eye" d="M106 64 L85 71 L102 76 Z" fill="#fff4b0"/></g>
        <path d="M64 86 Q80 80 96 86" stroke="#2a020b" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>`;
    }
    const crown = o.crown ? `<g class="j-crown">
        <path d="M52 44 L57 16 L67 32 L80 6 L93 32 L103 16 L108 44 Q80 36 52 44 Z" fill="url(#${p}gd)" stroke="#4a2f06" stroke-width="1"/>
        <circle cx="80" cy="30" r="3.6" fill="#38bdf8"/><circle cx="64" cy="38" r="2.4" fill="#f43f5e"/><circle cx="96" cy="38" r="2.4" fill="#f43f5e"/>
        <circle cx="57" cy="16" r="2" fill="#fde68a"/><circle cx="80" cy="6" r="2.4" fill="#fde68a"/><circle cx="103" cy="16" r="2" fill="#fde68a"/>
      </g>` : '';
    return `<svg class="spr spr-jelly spr-${kind}" viewBox="0 0 160 200" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <radialGradient id="${p}b" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="${o.c1}" stop-opacity=".97"/><stop offset=".55" stop-color="${o.c2}" stop-opacity=".88"/><stop offset="1" stop-color="${o.c3}" stop-opacity=".92"/></radialGradient>
        <radialGradient id="${p}c"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".4" stop-color="${o.glow}" stop-opacity=".7"/><stop offset="1" stop-color="${o.glow}" stop-opacity="0"/></radialGradient>
        <radialGradient id="${p}a"><stop offset="0" stop-color="${o.glow}" stop-opacity=".35"/><stop offset="1" stop-color="${o.glow}" stop-opacity="0"/></radialGradient>
        <linearGradient id="${p}t" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${o.c2}" stop-opacity=".95"/><stop offset="1" stop-color="${o.c1}" stop-opacity=".05"/></linearGradient>
        <linearGradient id="${p}gd" x1="0" x2="1"><stop offset="0" stop-color="#7a520f"/><stop offset=".45" stop-color="#ffe38a"/><stop offset=".7" stop-color="#d19b2c"/><stop offset="1" stop-color="#6b440a"/></linearGradient>
        <filter id="${p}eg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <ellipse class="j-aura" cx="80" cy="80" rx="76" ry="62" fill="url(#${p}a)"/>
      <g class="j-tent">${tentacles}${arms}</g>
      <g class="j-bell">
        <path d="M16 92 C 10 20 150 20 144 92${scallop} Z" fill="url(#${p}b)" stroke="${o.c1}" stroke-opacity=".55" stroke-width="1.5"/>
        <path d="M34 88 C 34 50 126 50 126 88" fill="none" stroke="${o.c1}" stroke-opacity=".28" stroke-width="2"/>
        <ellipse class="j-core" cx="80" cy="62" rx="26" ry="15" fill="url(#${p}c)"/>
        <g fill="${o.c1}" opacity=".35"><ellipse cx="70" cy="58" rx="6" ry="4"/><ellipse cx="90" cy="58" rx="6" ry="4"/><ellipse cx="80" cy="52" rx="5" ry="3.4"/></g>
        <path d="M36 60 C 42 42 60 33 78 33" stroke="#fff" stroke-opacity=".6" stroke-width="5" fill="none" stroke-linecap="round"/>
        <circle cx="112" cy="54" r="3" fill="#fff" opacity=".45"/><circle cx="120" cy="66" r="2" fill="#fff" opacity=".35"/>
        ${eyes}${crown}
      </g>
    </svg>`;
  }

  function unit(kind) {
    const p = nextId();
    if (kind === 'candle') return candle(p);
    if (kind === 'sword') return sword(p);
    if (kind === 'book') return book(p);
    return jelly(p, kind);
  }

  /* ---------- 아이콘 (24×24, currentColor) ---------- */
  const ICONS = {
    attack: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
    aoe: '<path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0 2 1 2 1M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0 2 1 2 1M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0 2 1 2 1"/>',
    debuff: '<path d="M12 3C8.5 8.5 6 11.5 6 15a6 6 0 0 0 12 0c0-3.5-2.5-6.5-6-12z"/><path d="M12 11v5.5M9.6 14.2 12 16.6l2.4-2.4"/>',
    buff: '<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>',
    summon: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
    ult: '<path d="M12 2 22 12 12 22 2 12z"/><path d="M12 7.5v5.5M12 16v.5"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    play: '<path d="M7 4.5 19 12 7 19.5z" fill="currentColor"/>',
    auto: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    fast: '<path d="M13 19l9-7-9-7zM2 19l9-7-9-7z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    star: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
    skull: '<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>'
  };
  function icon(name, cls = '') {
    return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  function reticle() {
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
      <g class="ret-spin"><circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="7 9"/></g>
      <path d="M50 2v14M50 84v14M2 50h14M84 50h14" stroke="currentColor" stroke-width="2.4"/>
      <path d="M50 30 70 50 50 70 30 50z" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".7"/>
    </svg>`;
  }

  /* ---------- 배경: 아르데코 스카이라인 ---------- */
  function skyline(seed, o) {
    const R = window.BattleEngine.mulberry32(seed);
    const W = 1600, H = 300;
    let d = '', wins = '';
    let x = -10;
    while (x < W) {
      const w = 34 + R() * 70;
      const h = o.min + R() * o.range;
      const top = H - h;
      if (x > 1080 && x < 1240 && o.tower) { x = 1250; continue; }
      const style = R();
      if (style < 0.28) {
        const s = w * 0.18;
        d += `M${f1(x)} ${H}V${f1(top + 24)}H${f1(x + s)}V${f1(top + 12)}H${f1(x + s * 2)}V${f1(top)}H${f1(x + w - s * 2)}V${f1(top + 12)}H${f1(x + w - s)}V${f1(top + 24)}H${f1(x + w)}V${H}Z`;
      } else if (style < 0.48) {
        d += `M${f1(x)} ${H}V${f1(top)}H${f1(x + w * 0.35)}L${f1(x + w / 2)} ${f1(top - 30 - R() * 40)}L${f1(x + w * 0.65)} ${f1(top)}H${f1(x + w)}V${H}Z`;
      } else if (style < 0.62) {
        const r = w / 2;
        d += `M${f1(x)} ${H}V${f1(top)}A${f1(r)} ${f1(r * 0.8)} 0 0 1 ${f1(x + w)} ${f1(top)}V${H}Z`;
      } else {
        d += `M${f1(x)} ${H}V${f1(top)}H${f1(x + w)}V${H}Z`;
        if (R() < 0.5) d += `M${f1(x + w / 2 - 1)} ${f1(top)}V${f1(top - 16 - R() * 20)}h2V${f1(top)}Z`;
      }
      if (o.windows) {
        for (let wy = top + 30; wy < H - 10; wy += 13) {
          for (let wx = x + 7; wx < x + w - 8; wx += 10) {
            if (R() < 0.13) wins += `<rect class="${R() < 0.25 ? 'tw' : ''}" x="${f1(wx)}" y="${f1(wy)}" width="3.6" height="5.4"/>`;
          }
        }
      }
      x += w + R() * 6;
    }
    let tower = '';
    if (o.tower) {
      const tx = 1160, tw = 56, th = 250;
      d += `M${tx - tw / 2} ${H}V${H - th}H${tx + tw / 2}V${H}Z`;
      d += `M${tx - tw / 2 - 6} ${H - th}L${tx} ${H - th - 70}L${tx + tw / 2 + 6} ${H - th}Z`;
      d += `M${tx - 1.5} ${H - th - 70}V${H - th - 100}h3V${H - th - 70}Z`;
      const cy = H - th + 34;
      tower = `<circle cx="${tx}" cy="${cy}" r="17" fill="${o.face}" opacity=".9"/>
        <circle cx="${tx}" cy="${cy}" r="17" fill="none" stroke="${o.color}" stroke-width="2"/>
        <path d="M${tx} ${cy}V${cy - 13}M${tx} ${cy}l-1.4 -10" stroke="${o.color}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    return `<svg class="${o.cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path d="${d}" fill="${o.color}"/>${tower}
      ${wins ? `<g fill="${o.light}">${wins}</g>` : ''}
    </svg>`;
  }

  window.Sprites = { unit, icon, reticle, skyline };
})();
