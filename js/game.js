/* =========================================================
 *  화면 · 연출 · 입력
 *  전투 엔진(engine.js)이 돌려준 이벤트를 차례대로 연출합니다.
 * ========================================================= */
(() => {
  'use strict';

  const { RULES, AFFLATUS, AFFLATUS_BEATS, STATUS, KIND_LABEL, INTENT_LABEL, CHARACTERS, PARTY, SKILLS, ENEMIES, WAVES } = window.GameData;
  const { Battle, autoChoice, afflatusMult } = window.BattleEngine;

  /* ---------- 유틸 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const pad2 = n => String(n).padStart(2, '0');
  const josa = (word, pair) => {
    const [withBatchim, without] = pair.split('/');
    const c = word.charCodeAt(word.length - 1);
    const has = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 > 0;
    return word + (has ? withBatchim : without);
  };
  const ROMAN = ['I', 'II', 'III', 'IV'];

  /* ---------- 설정 (브라우저에 저장) ---------- */
  const SETTINGS_KEY = 'turn-based.settings.v1';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const settings = Object.assign({ sfx: 0.8, bgm: 0.5, bgmOn: true, muted: false, speed: 1, shake: !reducedMotion }, loadSettings());
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 저장할 수 없는 환경 */ }
  }
  function applySound() {
    Sound.configure({ sfx: settings.muted ? 0 : settings.sfx, bgm: settings.bgm, bgmOn: settings.bgmOn && !settings.muted });
  }

  /* ---------- 시간 (배속 반영, 재시작 시 진행 중인 연출 중단) ---------- */
  class Abort extends Error {}
  let gameToken = 0;
  const isAbort = e => e instanceof Abort || (e && e.name === 'AbortError');
  const wait = ms => {
    const t = gameToken;
    return new Promise((res, rej) => setTimeout(() => (t === gameToken ? res() : rej(new Abort())), ms / settings.speed));
  };
  const dur = ms => ms / settings.speed;
  // 재시작·타이틀 이동 전에 시작된 연출(배너, 이동, 발사체, 히트스톱)이 끝나면
  // 이어서 새 게임을 건드리지 않도록 중단시킵니다.
  const guard = p => {
    const t = gameToken;
    return Promise.resolve(p).then(v => { if (t !== gameToken) throw new Abort(); return v; });
  };
  // 같은 이유로, 지연 실행되는 연출도 그사이 게임이 바뀌었으면 건너뜁니다.
  const later = (fn, ms) => {
    const t = gameToken;
    setTimeout(() => { if (t === gameToken) fn(); }, ms);
  };

  const sfxLast = {};
  function sfx(name, opt) {
    const now = performance.now();
    if (sfxLast[name] && now - sfxLast[name] < 45) return;
    sfxLast[name] = now;
    Sound.play(name, opt);
  }

  /* ---------- DOM 참조 ---------- */
  const R = {
    stage: $('#stage'), shake: $('#shake'), camera: $('#camera'), units: $('#units'),
    hand: $('#hand'), slots: $$('.slot'), ap: $('#ap'), detail: $('#detail'), deck: $('#deck'),
    exec: $('#btn-exec'), undo: $('#btn-undo'), reset: $('#btn-reset'), auto: $('#btn-auto'),
    round: $('#hud-round'), roundOf: $('#hud-round-of'), roundName: $('#hud-round-name'), turn: $('#hud-turn'), turnOf: $('#hud-turn-of'),
    speed: $('#btn-speed'), sound: $('#btn-sound'),
    bossBar: $('#boss-bar'), callout: $('#callout'), banner: $('#banner'), combo: $('#combo'), toast: $('#toast'),
    cutscene: $('#cutscene'), ghosts: $('#ghost-layer'), tip: $('#tooltip'), fxDom: $('#fx-dom')
  };

  /* ---------- 상태 ---------- */
  let battle = null;
  let busy = true;
  let autoOn = false;
  let autoRunning = false;
  let finished = false;
  let selectedUid = null;
  const views = new Map();
  const prevRanks = new Map();
  const comboState = { n: 0, total: 0 };

  const planReady = fromAuto => !!battle && battle.phase === 'planning' && !busy && (fromAuto || !autoRunning);

  /* =========================================================
   *  툴팁
   * ========================================================= */
  const tipFns = new WeakMap();
  function bindTip(el, fn) {
    tipFns.set(el, fn);
    el.addEventListener('pointerenter', showTip);
    el.addEventListener('pointerleave', hideTip);
  }
  function showTip(e) {
    if (e.pointerType === 'touch') return;
    const fn = tipFns.get(e.currentTarget);
    const html = fn && fn();
    if (!html) return;
    R.tip.innerHTML = html;
    R.tip.classList.add('show');
    const r = e.currentTarget.getBoundingClientRect();
    const t = R.tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.top - t.height - 10;
    if (y < 8) y = r.bottom + 10;
    x = Math.max(8, Math.min(window.innerWidth - t.width - 8, x));
    R.tip.style.transform = `translate(${x}px, ${y}px)`;
  }
  function hideTip() { R.tip.classList.remove('show'); }

  function statusLine(s) {
    const d = STATUS[s.id];
    return `<li><b style="color:${d.color}">${d.glyph} ${d.name}</b> ${d.desc(s)}${s.permanent ? '' : ` <span class="dim">· ${s.turns}턴</span>`}</li>`;
  }

  function unitTip(u) {
    if (!u) return '';
    const def = defOf(u);
    const aff = AFFLATUS[u.afflatus];
    return `<div class="tt-title">${u.name}${def.title ? `<small>${def.title}</small>` : ''}</div>
      <div class="tt-sub"><span style="color:${aff.color}">${aff.glyph} ${aff.name}</span>${def.role ? ` · ${def.role}` : ''}${u.boss ? ' · 보스' : ''}</div>
      <div class="tt-stats">체력 <b>${fmt(u.hp)}</b> / ${fmt(u.maxHp)} · 공격 <b>${u.atk}</b> · 방어 <b>${u.def}</b></div>
      ${u.statuses.length ? `<ul class="tt-list">${u.statuses.map(statusLine).join('')}</ul>` : ''}
      ${u.side === 'enemy' && u.alive && battle.phase === 'planning' ? '<div class="tt-hint">클릭해서 공격 대상으로 지정</div>' : ''}`;
  }

  function richDesc(text) {
    return text.replace(/\[(.+?)\]/g, (m, name) => {
      const st = Object.values(STATUS).find(s => s.name === name);
      return `<em style="color:${st ? st.color : '#fde68a'}">${name}</em>`;
    });
  }

  function intentTip(e, it) {
    const s = SKILLS[it.skillId];
    const tgt = it.targetUid ? battle.unit(it.targetUid) : null;
    return `<div class="tt-title">${s.name}<small>${INTENT_LABEL[s.intent]}</small></div>
      <div class="tt-desc">${richDesc(s.desc(s, 0))}</div>
      ${tgt ? `<div class="tt-sub">표적: <b>${tgt.name}</b></div>` : ''}`;
  }

  /* =========================================================
   *  유닛 (전장의 캐릭터)
   * ========================================================= */
  // 가로 화면: 적은 왼쪽, 아군은 오른쪽 / 세로 화면: 적은 위, 아군은 아래
  const POS = {
    ally: [{ x: 63, y: 23 }, { x: 76.5, y: 13 }, { x: 89.5, y: 24 }],
    enemy: [{ x: 37, y: 22 }, { x: 22.5, y: 13 }, { x: 9.5, y: 23 }]
  };
  const POS_PORTRAIT = {
    ally: [{ x: 20, y: 11 }, { x: 50, y: 3 }, { x: 80, y: 11 }],
    enemy: [{ x: 20, y: 44 }, { x: 50, y: 45 }, { x: 80, y: 44 }]
  };
  let portrait = false;
  const defOf = u => (u.side === 'ally' ? CHARACTERS[u.key] : ENEMIES[u.key]);

  function placeUnit(el, side, slot) {
    const pos = (portrait ? POS_PORTRAIT : POS)[side][slot];
    el.style.left = pos.x + '%';
    el.style.bottom = pos.y + '%';
    el.style.zIndex = String(100 - Math.round(pos.y));
  }

  // 휴대폰을 세로로 들었을 때(화면이 세로로 길 때)는 적이 위, 아군이 아래에 섭니다.
  function layoutUnits() {
    portrait = window.innerHeight > window.innerWidth;
    R.stage.classList.toggle('portrait', portrait);
    if (!battle) return;
    [...battle.allies, ...battle.enemies].forEach(u => { const v = views.get(u.uid); if (v) placeUnit(v.el, u.side, u.slot); });
  }

  function createUnitView(u, { spawn = false } = {}) {
    const def = defOf(u);
    const aff = AFFLATUS[u.afflatus];
    const el = h('div', `unit ${u.side}${u.boss ? ' boss' : ''} k-${u.key}`);
    el.dataset.uid = u.uid;
    placeUnit(el, u.side, u.slot);
    el.style.setProperty('--size', def.size || 1);
    el.style.setProperty('--ar', def.ar || 0.75);
    el.style.setProperty('--aff', aff.color);
    el.innerHTML = `
      <div class="ground"><i class="glow"></i><i class="ripple"></i><i class="ripple r2"></i></div>
      <div class="mover"><div class="sprite">${Sprites.unit(def.sprite)}</div></div>
      ${u.side === 'enemy' ? `<div class="reticle">${Sprites.reticle()}</div>` : ''}
      <div class="uhud">
        ${u.side === 'enemy' ? '<div class="intents"></div>' : ''}
        <div class="nameplate"><span class="aff"><span>${aff.glyph}</span></span><span class="uname">${u.name}</span></div>
        ${u.boss ? '' : '<div class="hpbar"><i class="lag"></i><i class="fill"></i></div><div class="shbar"><i></i></div><div class="hpnum"></div>'}
        <div class="hud-row"><div class="moxie"></div><div class="statuses"></div></div>
      </div>`;
    R.units.appendChild(el);
    const v = {
      uid: u.uid, el, mover: $('.mover', el), sprite: $('.sprite', el), hud: $('.uhud', el),
      fill: $('.hpbar .fill', el), lag: $('.hpbar .lag', el), sh: $('.shbar i', el), shbar: $('.shbar', el), num: $('.hpnum', el),
      moxie: $('.moxie', el), statuses: $('.statuses', el), intents: $('.intents', el)
    };
    views.set(u.uid, v);
    if (!u.hasMoxie) v.moxie.classList.add('none');
    syncUnit(u);
    if (u.side === 'enemy') v.mover.addEventListener('click', () => onEnemyClick(u.uid));
    bindTip(v.mover, () => unitTip(battle && battle.unit(u.uid)));
    if (spawn) {
      v.mover.animate(
        [{ opacity: 0, transform: 'translateY(50px) scale(.6)', filter: 'brightness(3) blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
        { duration: dur(800), easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
      v.hud.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur(500), delay: dur(450), fill: 'backwards' });
      requestAnimationFrame(() => {
        const c = centerOf(u.uid, 'feet');
        FX.ring(c.x, c.y, { color: aff.color, r0: 10, r1: 110, width: 5, life: 900, squash: 0.3 });
        FX.bubbles(c.x, c.y - 20, { count: 14, spread: 50 });
        FX.flare(c.x, c.y - c.h * 0.4, { color: aff.color, size: c.h * 0.9, rays: 10, life: 520 });
        FX.swirl(c.x, c.y - c.h * 0.3, { count: 16, colors: [aff.color, '#ffffff'], radius: [c.h * 0.3, c.h * 0.45], squash: 0.4, rise: c.h * 0.5, life: [600, 800] });
      });
    }
    return v;
  }

  function syncUnit(u) {
    const v = views.get(u.uid);
    if (!v || !battle) return;
    setHP(v, u, u.hp);
    setShield(v, u, battle.shieldOf(u));
    renderMoxie(v, u);
    renderStatuses(v, u);
    v.el.classList.toggle('dead', !u.alive);
    v.el.classList.toggle('enraged', u.phase === 2);
  }

  function syncAll() {
    if (!battle) return;
    battle.allies.forEach(syncUnit);
    battle.enemies.forEach(syncUnit);
  }

  function setHP(v, u, hp) {
    const pct = Math.max(0, (hp / u.maxHp) * 100);
    if (v.fill) {
      v.fill.style.width = pct + '%';
      v.lag.style.width = pct + '%';
      v.num.textContent = fmt(hp);
      v.el.classList.toggle('low', pct < 30 && hp > 0);
    }
    if (u.boss) updateBossBar(u, hp);
  }

  function setShield(v, u, value) {
    if (!v.sh) return;
    const pct = Math.min(100, (value / u.maxHp) * 200);
    v.sh.style.width = pct + '%';
    v.shbar.classList.toggle('on', value > 0);
    v.el.classList.toggle('shielded', value > 0);
  }

  function renderMoxie(v, u, value = u.moxie) {
    if (!u.hasMoxie) return;
    const full = value >= RULES.moxieMax;
    v.moxie.innerHTML = Array.from({ length: RULES.moxieMax }, (_, i) => `<i class="${i < value ? 'on' : ''}"></i>`).join('');
    v.moxie.classList.toggle('full', full);
    v.el.classList.toggle('charged', u.side === 'ally' && u.alive && full);
  }

  function renderStatuses(v, u) {
    v.statuses.innerHTML = u.statuses.map(s => {
      const d = STATUS[s.id];
      return `<span class="st ${d.type}" style="--c:${d.color}">${d.glyph}${s.permanent ? '' : `<sub>${s.turns}</sub>`}</span>`;
    }).join('');
  }

  function centerOf(uid, where) {
    const v = views.get(uid);
    if (!v) return { x: 0, y: 0, w: 0, h: 0 };
    const s = R.stage.getBoundingClientRect();
    const r = v.sprite.getBoundingClientRect();
    const x = r.left + r.width / 2 - s.left;
    const y = where === 'top' ? r.top + r.height * 0.2 - s.top : where === 'feet' ? r.bottom - s.top : r.top + r.height * 0.5 - s.top;
    return { x, y, w: r.width, h: r.height };
  }
  const stageSize = () => { const r = R.stage.getBoundingClientRect(); return { w: r.width, h: r.height }; };

  /* ---------- 보스 체력 바 ---------- */
  function showBossBar(u) {
    const def = ENEMIES[u.key];
    const aff = AFFLATUS[u.afflatus];
    $('.bb-aff', R.bossBar).textContent = aff.glyph;
    $('.bb-aff', R.bossBar).style.background = aff.color;
    $('.bb-name', R.bossBar).textContent = u.name;
    $('.bb-title', R.bossBar).textContent = def.title || 'BOSS';
    $('.bb-mark', R.bossBar).style.left = (def.phase2 || 0) * 100 + '%';
    R.bossBar.classList.remove('hidden');
    updateBossBar(u, u.hp);
  }
  function updateBossBar(u, hp) {
    const pct = Math.max(0, (hp / u.maxHp) * 100);
    $('.bb-fill', R.bossBar).style.width = pct + '%';
    $('.bb-lag', R.bossBar).style.width = pct + '%';
    $('.bb-num', R.bossBar).textContent = `${fmt(hp)} / ${fmt(u.maxHp)}`;
    R.bossBar.classList.toggle('enraged', u.phase === 2);
  }

  /* ---------- 적의 의도 ---------- */
  function intentLabel(s, it) {
    if (s.targeting === 'foe') { const t = battle.unit(it.targetUid); return t ? t.name : ''; }
    if (s.targeting === 'foes') return '전체';
    if (s.summon) return '소환';
    return '강화';
  }

  function renderIntents() {
    for (const e of battle.enemies) {
      const v = views.get(e.uid);
      if (!v || !v.intents) continue;
      v.intents.innerHTML = '';
      v.el.classList.toggle('charging', e.alive && e.intents.some(it => SKILLS[it.skillId].ult));
      if (!e.alive) continue;
      e.intents.forEach((it, i) => {
        const s = SKILLS[it.skillId];
        const chip = h('div', `intent ${s.intent}`, `${Sprites.icon(s.intent)}<span>${intentLabel(s, it)}</span>`);
        chip.dataset.i = i;
        bindTip(chip, () => intentTip(e, it));
        chip.addEventListener('pointerenter', () => markThreat(s, it, true));
        chip.addEventListener('pointerleave', () => markThreat(s, it, false));
        v.intents.appendChild(chip);
      });
    }
  }

  function markThreat(s, it, on) {
    const targets = s.targeting === 'foe' ? [it.targetUid] : s.targeting === 'foes' ? battle.aliveAllies.map(a => a.uid) : [];
    targets.forEach(uid => { const v = views.get(uid); if (v) v.el.classList.toggle('threatened', on); });
  }

  function updateReticle() {
    for (const e of battle ? battle.enemies : []) {
      const v = views.get(e.uid);
      if (v) v.el.classList.toggle('targeted', e.alive && e.uid === battle.targetUid);
    }
  }

  function onEnemyClick(uid) {
    if (!planReady()) return;
    if (battle.setTarget(uid)) {
      sfx('target');
      updateReticle();
      const sel = battle.hand.find(c => c.uid === selectedUid);
      showDetail(sel || null);
    }
  }

  function cycleTarget(dir) {
    if (!planReady()) return;
    const alive = battle.aliveEnemies.slice().sort((a, b) => a.slot - b.slot);
    if (alive.length < 2) return;
    const i = alive.findIndex(e => e.uid === battle.targetUid);
    onEnemyClick(alive[(i + dir + alive.length) % alive.length].uid);
  }

  /* =========================================================
   *  손패 (카드)
   * ========================================================= */
  function cardInner(card) {
    const s = SKILLS[card.skillId];
    const ch = CHARACTERS[card.owner];
    const aff = AFFLATUS[ch.afflatus];
    const stars = card.isUlt
      ? '<span class="ult-tag">ULT</span>'
      : [1, 2, 3].map(i => `<i class="${i <= card.rank ? 'on' : ''}">★</i>`).join('');
    return `<div class="card-inner">
      <div class="card-top"><span class="kind">${KIND_LABEL[s.kind]}</span><span class="stars">${stars}</span></div>
      <div class="card-art"><span class="wm">${aff.glyph}</span><span class="glyph">${s.glyph}</span></div>
      <div class="card-name">${s.name}</div>
      <div class="card-owner"><b style="color:${aff.color}">${aff.glyph}</b>${ch.name}</div>
      <div class="merge-badge">합성</div>
    </div>`;
  }

  function makeCardNode(card) {
    const n = h('div', 'card');
    n.dataset.uid = card.uid;
    bindCard(n);
    return n;
  }

  function decorateCard(n, card) {
    const sel = battle.hand.find(c => c.uid === selectedUid);
    const ch = CHARACTERS[card.owner];
    n.className = `card r${card.rank}${card.isUlt ? ' ult' : ''}${selectedUid === card.uid ? ' selected' : ''}${sel && battle.canMerge(sel, card) ? ' mergeable' : ''}`;
    n.style.setProperty('--c', ch.color);
    n.style.setProperty('--aff', AFFLATUS[ch.afflatus].color);
    if (n.dataset.rank !== String(card.rank)) {
      n.innerHTML = cardInner(card);
      n.dataset.rank = String(card.rank);
    }
  }

  function renderHand({ deal = false } = {}) {
    if (!battle) return;
    const first = new Map();
    const existing = new Map();
    for (const n of R.hand.children) { first.set(n.dataset.uid, n.getBoundingClientRect()); existing.set(n.dataset.uid, n); }
    const nodes = battle.hand.map(card => {
      const n = existing.get(card.uid) || makeCardNode(card);
      decorateCard(n, card);
      return n;
    });
    R.hand.style.setProperty('--n', Math.max(RULES.handSize, nodes.length));
    R.hand.replaceChildren(...nodes);
    let k = 0;
    nodes.forEach((n, i) => {
      const card = battle.hand[i];
      const f = first.get(card.uid);
      if (f) {
        const l = n.getBoundingClientRect();
        const dx = f.left - l.left;
        if (Math.abs(dx) > 1) n.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
      } else {
        n.animate(
          [{ transform: 'translate(140px, 30px) rotate(10deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: 460, delay: deal ? 70 * k++ : 0, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
        );
        if (card.isUlt) {
          n.classList.add('ult-arrive');
          setTimeout(() => n.classList.remove('ult-arrive'), 1300);
        }
      }
      const old = prevRanks.get(card.uid);
      if (old != null && old < card.rank) {
        n.classList.add('upgraded');
        setTimeout(() => n.classList.remove('upgraded'), 900);
      }
    });
    prevRanks.clear();
    battle.hand.forEach(c => prevRanks.set(c.uid, c.rank));
  }

  function refreshCardStates() {
    for (const n of R.hand.children) {
      const card = battle.hand.find(c => c.uid === n.dataset.uid);
      if (card) decorateCard(n, card);
    }
  }

  function select(uid) {
    selectedUid = uid;
    refreshCardStates();
    const card = battle.hand.find(c => c.uid === uid);
    showDetail(card || null);
    if (uid) sfx('select');
  }

  function onCardTap(uid) {
    if (!battle || battle.phase !== 'planning' || busy || autoRunning) return;
    const idx = battle.hand.findIndex(c => c.uid === uid);
    if (idx < 0) return;
    if (selectedUid === uid) { doPlay(idx); return; }
    if (selectedUid) {
      const sIdx = battle.hand.findIndex(c => c.uid === selectedUid);
      if (sIdx >= 0 && battle.canMerge(battle.hand[sIdx], battle.hand[idx])) { doMerge(sIdx, idx); return; }
    }
    select(uid);
  }

  /* ---------- 드래그: 위로 끌어 사용, 같은 카드 위에 놓아 합성 ---------- */
  let suppressClick = false;
  function bindCard(n) {
    n.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      onCardTap(n.dataset.uid);
    });
    n.addEventListener('pointerenter', e => {
      if (e.pointerType === 'touch' || !battle) return;
      const card = battle.hand.find(c => c.uid === n.dataset.uid);
      if (card && battle.phase === 'planning') { showDetail(card); sfx('hover'); }
    });
    n.addEventListener('pointerleave', e => {
      if (e.pointerType === 'touch' || !battle) return;
      showDetail(battle.hand.find(c => c.uid === selectedUid) || null);
    });
    n.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !battle || battle.phase !== 'planning' || busy || autoRunning) return;
      const uid = n.dataset.uid;
      const start = { x: e.clientX, y: e.clientY };
      const rect = n.getBoundingClientRect();
      let ghost = null, overUid = null, overPlay = false;
      const move = ev => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (!ghost) {
          if (Math.hypot(dx, dy) < 10) return;
          ghost = n.cloneNode(true);
          ghost.classList.add('drag-ghost');
          ghost.classList.remove('selected', 'mergeable');
          Object.assign(ghost.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
          R.ghosts.appendChild(ghost);
          n.classList.add('lifted');
          if (selectedUid !== uid) select(uid);
          document.body.classList.add('dragging');
        }
        ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(-12, Math.min(12, dx * 0.05))}deg) scale(1.05)`;
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const cardEl = under && under.closest('#hand .card');
        const a = battle.hand.find(c => c.uid === uid);
        const b = cardEl && battle.hand.find(c => c.uid === cardEl.dataset.uid);
        const next = b && battle.canMerge(a, b) ? b.uid : null;
        if (next !== overUid) {
          $$('#hand .card.drop').forEach(c => c.classList.remove('drop'));
          if (next) cardEl.classList.add('drop');
          overUid = next;
        }
        overPlay = !overUid && ev.clientY < R.hand.getBoundingClientRect().top - 24;
        document.body.classList.toggle('drop-play', overPlay);
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        document.body.classList.remove('dragging', 'drop-play');
        if (!ghost) return;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        const gRect = ghost.getBoundingClientRect();
        ghost.remove();
        n.classList.remove('lifted');
        $$('#hand .card.drop').forEach(c => c.classList.remove('drop'));
        const from = battle.hand.findIndex(c => c.uid === uid);
        if (overUid) doMerge(from, battle.hand.findIndex(c => c.uid === overUid));
        else if (overPlay) doPlay(from, gRect);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  /* ---------- 계획 단계 조작 ---------- */
  function cardRects() {
    const m = new Map();
    for (const n of R.hand.children) m.set(n.dataset.uid, { rect: n.getBoundingClientRect(), node: n });
    return m;
  }

  function denied(msg) {
    sfx('error');
    if (msg) toast(msg);
    R.deck.classList.remove('nope');
    void R.deck.offsetWidth;
    R.deck.classList.add('nope');
  }

  function doPlay(index, fromRect, fromAuto) {
    if (!planReady(fromAuto)) return;
    if (battle.ap <= 0) return denied('행동력을 모두 사용했습니다');
    const before = cardRects();
    const res = battle.playCard(index);
    if (!res) return denied();
    selectedUid = null;
    afterPlanChange(res, before, { played: res.card, fromRect });
  }

  function doMerge(from, to, fromAuto) {
    if (!planReady(fromAuto)) return;
    if (battle.ap <= 0) return denied('행동력을 모두 사용했습니다');
    const before = cardRects();
    const res = battle.mergeCards(from, to);
    if (!res) return denied();
    selectedUid = null;
    afterPlanChange(res, before, {});
  }

  function afterPlanChange(res, before, o) {
    renderHand();
    if (o.played) {
      const b = before.get(o.played.uid);
      const slot = R.slots[battle.queue.length - 1];
      if (b && slot) flyNode(b.node, o.fromRect || b.rect, slot.getBoundingClientRect(), { ms: 300 });
      sfx('place');
    }
    res.merges.forEach((m, i) => {
      const g = before.get(m.gone);
      const keep = R.hand.querySelector(`[data-uid="${m.keep}"]`);
      if (g && keep) flyNode(g.node, g.rect, keep.getBoundingClientRect(), { scale: 1, ms: 260, delay: i * 120 });
      const card = battle.hand.find(c => c.uid === m.keep);
      if (card) later(() => moxieGainText(card.owner), 200 + i * 120);
    });
    if (res.merges.length) later(() => sfx('merge'), 160);
    if (res.ults.length) { later(() => sfx('ultReady'), 380); toast('최종 술식 카드가 준비되었습니다', 'gold'); }
    renderSlots(true);
    renderAP();
    battle.allies.forEach(a => { const v = views.get(a.uid); if (v) renderMoxie(v, a); });
    updateButtons();
    showDetail(null);
  }

  function moxieGainText(ownerKey) {
    const u = battle.ally(ownerKey);
    if (!u) return;
    const c = centerOf(u.uid, 'top');
    FX.text(c.x, c.y - 30, '열정 +1', 'moxie', 900);
  }

  function flyNode(node, from, to, { scale = null, ms = 340, delay = 0 } = {}) {
    node.classList.add('flying');
    node.classList.remove('selected', 'mergeable', 'lifted', 'drop');
    Object.assign(node.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
    R.ghosts.appendChild(node);
    const s = scale != null ? scale : to.width / from.width;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const a = node.animate(
      [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.1 }],
      { duration: ms, delay, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'both' }
    );
    a.finished.then(() => node.remove(), () => node.remove());
  }

  function refreshPlanning() {
    renderHand(); renderSlots(); renderAP(); syncAll(); updateButtons(); showDetail(null);
  }

  function restorePlanning(restore) {
    if (!planReady() || !restore()) return;
    selectedUid = null;
    sfx('undo');
    refreshPlanning();
  }
  const doUndo = () => restorePlanning(() => battle.undo());
  const doReset = () => restorePlanning(() => battle.resetPlanning());

  /* ---------- 행동 슬롯 · 행동력 · 버튼 ---------- */
  function renderSlots(popLast = false) {
    R.slots.forEach((slot, i) => {
      const q = battle && battle.queue[i];
      const key = q ? `${q.type}:${q.card.uid}:${q.card.rank}` : 'empty';
      if (slot.dataset.key === key) return;
      slot.dataset.key = key;
      slot.className = 'slot';
      if (!q) { slot.innerHTML = `<span class="num">${ROMAN[i]}</span>`; return; }
      const s = SKILLS[q.card.skillId];
      slot.style.setProperty('--c', CHARACTERS[q.card.owner].color);
      if (q.type === 'merge') {
        slot.classList.add('merge');
        slot.innerHTML = `<span class="g">${s.glyph}</span><span class="sr">합성</span><span class="t">${s.name}</span>`;
      } else {
        slot.classList.add('filled');
        if (q.card.isUlt) slot.classList.add('ult');
        slot.innerHTML = `<span class="g">${s.glyph}</span><span class="sr">${q.card.isUlt ? 'ULT' : '★'.repeat(q.card.rank)}</span><span class="t">${s.name}</span>`;
      }
      if (popLast && i === battle.queue.length - 1) slot.classList.add('pop');
    });
  }

  function setSlotState(i, state) {
    R.slots.forEach((s, k) => {
      s.classList.toggle('active', k === i && state === 'active');
      if (k < i) s.classList.add('done');
    });
  }
  function clearSlotStates() { R.slots.forEach(s => s.classList.remove('active', 'done')); }

  function renderAP() {
    const ap = battle ? battle.ap : RULES.maxAp;
    R.ap.innerHTML = Array.from({ length: RULES.maxAp }, (_, i) => `<i class="${i < ap ? 'on' : ''}"></i>`).join('');
    R.ap.title = `행동력 ${ap}/${RULES.maxAp}`;
  }

  function updateButtons() {
    const ready = planReady();
    R.exec.disabled = !ready || !battle.queue.length;
    R.exec.classList.toggle('ready', ready && battle.queue.length > 0 && battle.ap === 0);
    R.undo.disabled = !ready || !battle.canUndo;
    R.reset.disabled = !ready || !battle.canUndo;
    R.auto.classList.toggle('on', autoOn);
    R.auto.setAttribute('aria-pressed', String(autoOn));
  }

  function updateHud() {
    if (!battle) return;
    const w = WAVES[Math.max(0, battle.waveIndex)];
    R.round.textContent = Math.max(1, battle.waveIndex + 1);
    R.roundOf.textContent = '/' + WAVES.length;
    R.roundName.textContent = w.name;
    R.turn.textContent = pad2(Math.min(battle.turn, RULES.maxTurn));
    R.turnOf.textContent = '/' + RULES.maxTurn;
    $('.hud-turn').classList.toggle('late', battle.turn >= RULES.maxTurn - 3);
  }

  /* ---------- 카드 상세 ---------- */
  function showDetail(card) {
    if (!battle) return;
    R.detail.classList.toggle('show', !!card);
    if (!card) {
      const hint = battle.phase !== 'planning' ? '전투가 진행 중입니다…'
        : battle.ap === 0 ? '행동력을 모두 사용했습니다. <b>전투 실행</b>을 눌러 주세요.'
        : '카드를 눌러 선택하고, 한 번 더 누르면 사용합니다.<br>같은 카드끼리 겹치면 <b>합성</b>되어 등급이 오릅니다.';
      R.detail.innerHTML = `<div class="d-empty"><div class="d-title">스킬 정보</div><div class="d-desc">${hint}</div></div>`;
      return;
    }
    const s = SKILLS[card.skillId];
    const ch = CHARACTERS[card.owner];
    const aff = AFFLATUS[ch.afflatus];
    const r = card.rank - 1;
    let affLine = '';
    if (s.targeting === 'foe' || s.targeting === 'foes') {
      const targets = s.targeting === 'foe' ? [battle.unit(battle.targetUid)].filter(Boolean) : battle.aliveEnemies;
      affLine = targets.map(t => {
        const m = afflatusMult(ch.afflatus, t.afflatus);
        const ta = AFFLATUS[t.afflatus];
        const label = m > 1 ? '<span class="up">우세 ▲ 피해 +30%</span>' : m < 1 ? '<span class="down">열세 ▼ 피해 -20%</span>' : '<span>보통</span>';
        return `<div class="d-aff">대상 <b style="color:${ta.color}">${ta.glyph}</b> ${t.name} · ${label}</div>`;
      }).join('');
    }
    const selected = card.uid === selectedUid;
    const hint = selected ? (battle.ap > 0 ? '한 번 더 누르면 사용 · 같은 카드를 누르면 합성' : '행동력이 없습니다') : '';
    R.detail.innerHTML = `
      <div class="d-head" style="--c:${ch.color}">
        <span class="d-glyph">${s.glyph}</span>
        <div>
          <div class="d-name">${s.name} <span class="d-rank">${card.isUlt ? '최종 술식' : '★'.repeat(card.rank)}</span></div>
          <div class="d-owner"><b style="color:${aff.color}">${aff.glyph}</b> ${ch.name} · ${KIND_LABEL[s.kind]}</div>
        </div>
      </div>
      <div class="d-desc">${richDesc(s.desc(s, r))}</div>
      ${affLine}
      ${hint ? `<div class="d-hint">${hint}</div>` : ''}`;
  }

  /* =========================================================
   *  연출 도구
   * ========================================================= */
  function toast(msg, kind = '') {
    const t = h('div', 'toast-item ' + kind, msg);
    R.toast.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }

  function banner(main, sub, kind = '', ms = 1100) {
    const b = R.banner;
    b.className = '';
    b.innerHTML = `<div class="bn-band"></div><div class="bn-main">${main}</div><div class="bn-sub">${sub}</div>`;
    void b.offsetWidth;
    b.className = 'show ' + kind;
    b.style.setProperty('--bn-dur', dur(ms) + 'ms');
    const t = gameToken;
    const shown = guard(new Promise(res => setTimeout(() => { if (t === gameToken) b.className = ''; res(); }, dur(ms))));
    shown.catch(() => {}); // 기다리지 않고 띄우는 배너도 있으므로, 재시작으로 인한 중단을 처리된 것으로 표시
    return shown;
  }

  function showCallout(caster, skill, rank) {
    const isAlly = caster.side === 'ally';
    const color = isAlly ? CHARACTERS[caster.key].color : '#f87171';
    const glyph = isAlly ? skill.glyph : '';
    const rankTxt = skill.ult ? 'ULTIMATE' : isAlly ? '★'.repeat(rank) : INTENT_LABEL[skill.intent];
    R.callout.innerHTML = `<div class="co-inner ${isAlly ? '' : 'foe'}" style="--c:${color}">
      ${glyph ? `<span class="co-glyph">${glyph}</span>` : Sprites.icon(skill.intent, 'co-ico')}
      <span class="co-text"><span class="co-owner">${caster.name}</span><span class="co-name">${skill.name}</span></span>
      <span class="co-rank">${rankTxt}</span></div>`;
    R.callout.className = 'show';
  }
  function hideCallout() { R.callout.className = ''; }

  function startCombo() { comboState.n = 0; comboState.total = 0; }
  function bumpCombo(ev) {
    comboState.n += 1;
    comboState.total += ev.amount;
    if (comboState.n < 2) return;
    R.combo.innerHTML = `<b>${comboState.n}</b><span>HITS</span><em>${fmt(comboState.total)}</em>`;
    R.combo.className = '';
    void R.combo.offsetWidth;
    R.combo.className = 'show';
  }
  function hideCombo() { R.combo.className = R.combo.className ? 'show out' : ''; later(() => { R.combo.className = ''; }, 400); }

  // 잔상: 빠르게 움직이는 캐릭터의 모습을 몇 장 남깁니다.
  function afterimages(uid, count, ms, color) {
    const v = views.get(uid);
    if (!v) return;
    for (let i = 1; i <= count; i++) {
      later(() => {
        if (!v.el.isConnected) return;
        const s = R.stage.getBoundingClientRect();
        const r = v.el.getBoundingClientRect();
        const g = h('div', 'ghost-img', v.sprite.innerHTML);
        g.style.cssText = `left:${r.left - s.left}px;top:${r.top - s.top}px;width:${r.width}px;height:${r.height}px;transform:${getComputedStyle(v.mover).transform};--gc:${color};animation-duration:${dur(440)}ms`;
        R.fxDom.appendChild(g);
        setTimeout(() => g.remove(), dur(460));
      }, dur((ms * i) / (count + 1)));
    }
  }

  function hurt(u, v, ev, c) {
    const dir = u.side === 'enemy' ? -1 : 1;
    v.mover.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${dir * (ev.crit ? 26 : 12)}px)` }, { transform: 'translateX(0)' }],
      { duration: dur(240), easing: 'ease-out', composite: 'add' }
    );
    v.sprite.classList.remove('hurt');
    void v.sprite.offsetWidth;
    v.sprite.classList.add('hurt');
    const fullyBlocked = ev.absorbed && ev.absorbed >= ev.amount;
    sfx(fullyBlocked ? 'shieldHit' : ev.crit ? 'crit' : 'hit');
    FX.shake(ev.crit ? 10 : 4, ev.crit ? 340 : 180);
    const hx = c.x + FX.rand(-0.15, 0.15) * c.w, hy = c.y + FX.rand(-0.15, 0.1) * c.h;
    if (ev.absorbed) FX.ring(c.x, c.y, { color: '#7dd3fc', r0: 24, r1: c.h * 0.6, width: 5, life: 440, fill: true });
    if (fullyBlocked) {
      FX.flare(hx, hy, { color: '#7dd3fc', size: 70, rays: 6, life: 300 });
      return;
    }
    FX.flare(hx, hy, { color: u.side === 'enemy' ? '#fff3c4' : '#fecaca', size: ev.crit ? 150 : 72, rays: ev.crit ? 14 : 8, life: ev.crit ? 440 : 260, streakScale: ev.crit ? 4 : 2.4 });
    FX.burst(hx, hy, { kind: 'spark', count: ev.crit ? 28 : 12, colors: ['#ffffff', '#fde68a'], speed: [4, 11], life: [180, 400], size: [1.2, 2.4], len: 2.4 });
    if (ev.crit) {
      FX.ring(hx, hy, { color: '#fde68a', r0: 10, r1: c.h * 0.85, width: 7, life: 440, fill: true });
      FX.impact(60);
      FX.chroma(200);
    }
  }

  function damageNumber(u, c, ev) {
    const multi = ev.hits > 1;
    const x = c.x + FX.rand(-16, 16) + (multi ? (ev.hit % 2 ? 26 : -26) : 0);
    const y = c.y - 24 - (multi ? ev.hit * 15 : 0);
    const tags = (ev.crit ? '<i class="tag">CRITICAL</i>' : '') +
      (ev.aff === 'adv' ? '<i class="aff up">▲ 우세</i>' : ev.aff === 'dis' ? '<i class="aff down">▼ 열세</i>' : '');
    const abs = ev.absorbed ? `<i class="abs">盾 ${fmt(ev.absorbed)} 흡수</i>` : '';
    const cls = `dmg${ev.crit ? ' crit' : ''}${ev.amount >= 500 ? ' heavy' : ''}${u.side === 'ally' ? ' on-ally' : ''}`;
    FX.text(x, y, `${tags}<b>${fmt(ev.amount)}</b>${abs}`, cls, ev.crit ? 1400 : 1100);
  }

  function die(u, v) {
    v.el.classList.add('dead');
    v.el.classList.remove('charged', 'charging');
    const c = centerOf(u.uid);
    const color = AFFLATUS[u.afflatus].color;
    if (u.side === 'enemy') {
      sfx('death');
      FX.flare(c.x, c.y, { color, size: c.h * 1.3, rays: 16, life: 650, streakScale: 4 });
      FX.burst(c.x, c.y, { kind: 'shard', count: 26, colors: [color, '#ffffff', '#fde68a'], speed: [2, 8], life: [600, 1100], size: [4, 9], gravity: 0.15, spin: 2, blend: 'source-over' });
      FX.burst(c.x, c.y, { count: 46, colors: [color, '#ffffff', '#fde68a'], speed: [1, 5], life: [700, 1400], size: [2, 5], gravity: -0.05, drag: 0.03 });
      FX.burst(c.x, c.y, { count: 7, colors: [color, '#ffffff'], speed: [0.3, 1], angle: -90, spread: 60, life: [1500, 2100], size: [6, 10], gravity: -0.035, drag: 0.01, sway: 16, fadeIn: 0.15 });
      FX.ring(c.x, c.y, { color, r1: c.h * 1.1, width: 6, life: 820, fill: true });
      v.sprite.animate(
        [{ opacity: 1, filter: 'brightness(1)', transform: 'none' }, { opacity: 0.9, filter: 'brightness(2.6) saturate(.4)', transform: 'scale(1.06)', offset: 0.3 }, { opacity: 0, filter: 'brightness(4) blur(8px)', transform: 'translateY(-30px) scale(1.15)' }],
        { duration: dur(1000), easing: 'ease-in', fill: 'forwards' }
      );
      if (u.boss) later(() => R.bossBar.classList.add('hidden'), dur(900));
    } else {
      sfx('allyDown');
      FX.text(c.x, c.y - 70, '전투 불능', 'down', 1400);
      FX.burst(c.x, c.y, { kind: 'shard', count: 16, colors: ['#94a3b8', '#e2e8f0', '#64748b'], speed: [1, 5], life: [600, 1000], size: [3, 7], gravity: 0.2, spin: 2, blend: 'source-over' });
      FX.burst(c.x, c.y, { count: 24, colors: ['#94a3b8', '#e2e8f0'], speed: [0.5, 2.5], life: [700, 1200], size: [2, 4], gravity: -0.03 });
      FX.ring(c.x, c.y + c.h * 0.4, { color: '#94a3b8', r1: c.w, width: 4, squash: 0.3, life: 700 });
    }
  }

  function applyEvent(ev) {
    if (!battle) return;
    const u = battle.unit(ev.uid);
    const v = views.get(ev.uid);
    if (ev.type === 'summon') {
      if (u && !v) { createUnitView(u, { spawn: true }); sfx('summon'); }
      return;
    }
    if (!u || !v) return;
    const c = centerOf(ev.uid);
    switch (ev.type) {
      case 'hit':
        setHP(v, u, ev.hp);
        setShield(v, u, ev.shield);
        hurt(u, v, ev, c);
        damageNumber(u, c, ev);
        if (ev.hits > 1) bumpCombo(ev);
        if (ev.killed) die(u, v);
        break;
      case 'heal':
        setHP(v, u, ev.hp);
        if (ev.amount > 0) FX.text(c.x + FX.rand(-10, 10), c.y - 20, `+${fmt(ev.amount)}`, 'heal', 1100);
        FX.pillar(c.x, c.y + c.h * 0.48, { width: c.w * 0.55, height: c.h * 1.5, color: '#86efac', life: 700 });
        FX.swirl(c.x, c.y + c.h * 0.3, { count: 14, kind: 'leaf', colors: PAL.leaf, radius: [c.w * 0.45, c.w * 0.6], squash: 0.35, rise: c.h * 0.9, turns: 1.2, expand: 0, life: [900, 1200], size: [3, 5], blend: 'source-over' });
        FX.burst(c.x, c.y, { count: 12, colors: ['#bbf7d0', '#ffffff'], speed: [0.5, 2], angle: -90, spread: 90, life: [500, 900], size: [2, 4] });
        sfx('heal');
        break;
      case 'shield':
        setShield(v, u, ev.shield);
        FX.text(c.x + FX.rand(-10, 10), c.y - 44, `盾 +${fmt(ev.amount)}`, 'shield', 1100);
        FX.dom('shield-orb', c.x, c.y, 1150, '', { width: c.w * 1.3 + 'px', height: c.h * 1.1 + 'px' });
        FX.flare(c.x, c.y - c.h * 0.3, { color: '#7dd3fc', size: 80, rays: 8, life: 380 });
        FX.swirl(c.x, c.y, { count: 12, colors: ['#bae6fd', '#ffffff'], radius: [c.w * 0.6, c.w * 0.65], squash: 0.45, turns: 1, expand: 0, life: [600, 800], size: [2, 3] });
        sfx('shield');
        break;
      case 'status': {
        const d = STATUS[ev.id];
        renderStatuses(v, u);
        FX.text(c.x + FX.rand(-12, 12), c.y - c.h * 0.42, `${d.glyph} ${d.name}`, 'status ' + d.type, 1100).style.setProperty('--c', d.color);
        if (d.type === 'debuff') {
          FX.burst(c.x, c.y - c.h * 0.2, { count: 16, colors: [d.color, '#1f2937', '#4b5563'], speed: [0.4, 2], angle: 90, spread: 140, life: [600, 1000], size: [3, 7], blend: 'source-over', alpha: 0.75 });
          FX.ring(c.x, c.y, { color: d.color, r0: c.h * 0.7, r1: c.h * 0.2, width: 4, life: 500 });
        } else {
          FX.burst(c.x, c.y + c.h * 0.3, { kind: 'spark', count: 14, colors: [d.color, '#ffffff'], speed: [2, 4.5], angle: -90, spread: 24, life: [400, 700], size: [1.5, 2.5], len: 4, jitter: c.w * 0.35 });
          FX.ring(c.x, c.y + c.h * 0.45, { color: d.color, r1: c.w * 0.8, width: 4, squash: 0.3, fill: true });
        }
        sfx(d.type === 'debuff' ? 'debuff' : 'buff');
        break;
      }
      case 'cleanse':
        renderStatuses(v, u);
        FX.text(c.x, c.y - c.h * 0.42, '정화', 'heal', 1000);
        FX.flare(c.x, c.y, { color: '#ffffff', size: 90, rays: 10, life: 420 });
        FX.burst(c.x, c.y, { kind: 'spark', count: 18, colors: ['#ffffff', '#e0f2fe'], speed: [2, 5], angle: -90, spread: 100, life: [400, 700], size: [1.5, 2.5], len: 3 });
        break;
      case 'expire':
        renderStatuses(v, u);
        setShield(v, u, battle.shieldOf(u));
        break;
      case 'moxie':
        renderMoxie(v, u, ev.value);
        if (u.side === 'ally' && ev.value >= RULES.moxieMax) {
          FX.text(c.x, c.y - c.h * 0.55, '열정 MAX', 'moxie', 1200);
          FX.flare(c.x, c.y, { color: '#fbbf24', size: 120, rays: 12, life: 520 });
          FX.ring(c.x, c.y + c.h * 0.45, { color: '#fbbf24', r1: c.w * 1.1, width: 5, squash: 0.3, fill: true, life: 700 });
          FX.embers(c.x, c.y + c.h * 0.2, { count: 16, spread: c.w * 0.5, colors: ['#fbbf24', '#fde68a', '#ffffff'] });
        }
        break;
      case 'dot': {
        setHP(v, u, ev.hp);
        const d = STATUS[ev.id];
        FX.text(c.x + FX.rand(-14, 14), c.y - 10, `${d.glyph} ${fmt(ev.amount)}`, 'dot', 1000).style.setProperty('--c', d.color);
        if (ev.id === 'burn') {
          FX.burst(c.x, c.y + c.h * 0.3, { count: 26, colors: PAL.fire, speed: [1, 3.5], angle: -90, spread: 50, gravity: -0.08, life: [500, 900], size: [3, 7], jitter: c.w * 0.3 });
          FX.embers(c.x, c.y, { count: 10, spread: c.w * 0.4 });
        } else {
          FX.burst(c.x, c.y + c.h * 0.15, { count: 18, colors: PAL.venom, speed: [0.5, 2.5], angle: -90, spread: 80, gravity: -0.05, life: [500, 900], size: [2, 5] });
          FX.bubbles(c.x, c.y, { count: 10, spread: c.w * 0.4, color: 'rgba(190,242,100,.85)' });
        }
        v.sprite.classList.remove('hurt');
        void v.sprite.offsetWidth;
        v.sprite.classList.add('hurt');
        sfx(ev.id === 'burn' ? 'flame' : 'debuff');
        if (ev.killed) die(u, v);
        break;
      }
      default: break;
    }
  }

  async function runEvents(events, { onHit, before, hitGap = 90, gap = 70 } = {}) {
    for (const ev of events) {
      if (ev.type === 'cast' || ev.type === 'pass') continue;
      if (ev.type === 'hit') {
        if (onHit) await onHit(ev);
        applyEvent(ev);
        await wait(ev.hits > 1 ? hitGap : 120);
      } else if (ev.type === 'phase') {
        await bossPhase(ev);
      } else {
        if (before) before(ev);
        applyEvent(ev);
        if (ev.type !== 'moxie') await wait(gap);
      }
    }
  }

  /* ---------- 이동 모션 (trail: 잔상 수) ---------- */
  const MOTION = {
    dash: (dx, dy, s) => ({ t: 230, back: 300, sfx: 'whoosh', trail: 4, go: [{ transform: 'none' }, { transform: `translate(${dx * 0.12}px, -8px) rotate(${6 * s}deg)`, offset: 0.25 }, { transform: `translate(${dx}px, ${dy}px) rotate(${-16 * s}deg)` }] }),
    leap: (dx, dy, s) => ({ t: 360, back: 340, sfx: 'whoosh', trail: 5, go: [{ transform: 'none' }, { transform: `translate(${dx * 0.5}px, ${dy - 120}px) rotate(${-25 * s}deg)`, offset: 0.55 }, { transform: `translate(${dx}px, ${dy - 14}px) rotate(${-50 * s}deg) scale(1.06)` }] }),
    hover: dx => ({ t: 320, back: 320, go: [{ transform: 'none' }, { transform: `translate(${dx * 0.28}px, -46px) scale(1.1)` }] }),
    ascend: () => ({ t: 360, back: 360, go: [{ transform: 'none' }, { transform: 'translateY(-80px) scale(1.12)' }] }),
    float: (dx, dy, s) => ({ t: 300, back: 300, go: [{ transform: 'none' }, { transform: `translate(${dx * 0.16}px, -38px) rotate(${-6 * s}deg)` }] }),
    ultAscend: () => ({ t: 480, back: 420, trail: 3, go: [{ transform: 'none' }, { transform: 'translateY(-130px) scale(1.3)' }] }),
    ultDash: (dx, dy, s) => ({ t: 170, back: 320, sfx: 'whoosh', trail: 6, go: [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy - 16}px) scale(1.2) rotate(${-24 * s}deg)` }] }),
    ultFloat: dx => ({ t: 450, back: 400, trail: 3, go: [{ transform: 'none' }, { transform: `translate(${dx * 0.2}px, -100px) scale(1.22)` }] }),
    lunge: (dx, dy) => ({ t: 260, back: 320, sfx: 'lunge', trail: 3, ease: 'cubic-bezier(.5,0,.2,1)', go: [{ transform: 'none' }, { transform: `translate(${-dx * 0.06}px, -10px) scale(.94)`, offset: 0.35 }, { transform: `translate(${dx}px, ${dy}px) scale(1.06)` }] }),
    pulse: () => ({ t: 280, back: 280, go: [{ transform: 'none' }, { transform: 'translateY(-16px) scale(1.1)' }] })
  };

  async function motion(uid, style, targetUid) {
    const v = views.get(uid);
    const M = MOTION[style];
    if (!v || !M) return async () => {};
    let dx = 0, dy = 0;
    const tv = targetUid && views.get(targetUid);
    if (tv) {
      const a = v.el.getBoundingClientRect(), b = tv.el.getBoundingClientRect();
      const ac = a.left + a.width / 2, bc = b.left + b.width / 2;
      if (portrait) {
        // 세로 화면에서는 대상의 앞(아래/위)까지 다가갑니다.
        dx = bc - ac;
        dy = b.bottom - a.bottom + Math.sign(a.bottom - b.bottom) * a.height * 0.45;
      } else {
        const dir = Math.sign(ac - bc) || 1;
        dx = bc + dir * (b.width * 0.42 + a.width * 0.4) - ac;
        dy = b.bottom - a.bottom;
      }
    }
    const m = M(dx, dy, dx <= 0 ? 1 : -1);
    if (m.sfx) sfx(m.sfx);
    const u = battle.unit(uid);
    const color = u ? AFFLATUS[u.afflatus].color : '#ffffff';
    if (m.trail) {
      afterimages(uid, m.trail, m.t, color);
      const f = centerOf(uid, 'feet');
      FX.ring(f.x, f.y, { color, r0: 8, r1: 70, width: 4, squash: 0.3, life: 420 });
      FX.burst(f.x, f.y, { count: 10, colors: [color, '#e2e8f0'], speed: [1, 3], angle: -90, spread: 160, life: [300, 500], size: [2, 4] });
    }
    const go = v.mover.animate(m.go, { duration: dur(m.t), easing: m.ease || 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    await guard(go.finished);
    return async () => {
      const back = v.mover.animate([m.go[m.go.length - 1], { transform: 'none' }], { duration: dur(m.back), easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      await guard(back.finished);
      go.cancel();
      back.cancel();
    };
  }

  /* ---------- 마법진: 바깥 고리에 글자가 돌고, 안쪽 별이 반대로 돕니다 ---------- */
  function sigil(color, chars = '律審炎光智書星岩') {
    const ticks = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const r1 = 36, r2 = i % 2 ? 38.5 : 40;
      return `M${(50 + Math.cos(a) * r1).toFixed(1)} ${(50 + Math.sin(a) * r1).toFixed(1)}L${(50 + Math.cos(a) * r2).toFixed(1)} ${(50 + Math.sin(a) * r2).toFixed(1)}`;
    }).join('');
    const glyphs = [...chars].map((ch, i, arr) => `<text x="50" y="7.8" font-size="5" text-anchor="middle" fill="${color}" stroke="none" font-family="serif" transform="rotate(${(i / arr.length) * 360} 50 50)">${ch}</text>`).join('');
    return `<svg viewBox="0 0 100 100" fill="none" stroke="${color}" stroke-width="1.1">
      <circle cx="50" cy="50" r="48.5"/><circle cx="50" cy="50" r="42.5"/>${glyphs}
      <g class="sg-in"><circle cx="50" cy="50" r="34" stroke-dasharray="2 3"/><path d="${ticks}"/>
        <path d="M50 18 L77.7 66 L22.3 66Z M50 82 L22.3 34 L77.7 34Z" stroke-width=".9"/>
        <circle cx="50" cy="50" r="16"/><circle cx="50" cy="50" r="7" fill="${color}" fill-opacity=".3"/></g>
    </svg>`;
  }

  /* =========================================================
   *  스킬 연출
   * ========================================================= */
  const PAL = {
    fire: ['#ffb347', '#ff6a00', '#ffd27a', '#fff3b0'],
    holy: ['#fde68a', '#fff7d6', '#fbbf24'],
    steel: ['#e0f2fe', '#7dd3fc', '#ffffff'],
    ink: ['#c4b5fd', '#7c3aed', '#a78bfa', '#ede9fe'],
    leaf: ['#86efac', '#4ade80', '#bbf7d0', '#fef9c3'],
    venom: ['#bef264', '#84cc16', '#d9f99d'],
    sea: ['#7dd3fc', '#38bdf8', '#e0f2fe', '#0ea5e9'],
    blood: ['#fb7185', '#e11d48', '#fecdd3'],
    violet: ['#f0abfc', '#c084fc', '#fae8ff']
  };

  // 대상들의 발 높이(평균)와 키(최대) — 해일을 그릴 위치
  function rowOf(uids) {
    const cs = uids.map(uid => centerOf(uid, 'feet'));
    const hs = uids.map(uid => centerOf(uid).h);
    return { y: cs.reduce((s, c) => s + c.y, 0) / Math.max(1, cs.length), h: Math.max(60, ...hs) };
  }

  // 각 대상 위로 물보라를 흩뿌립니다.
  function splashOn(uids, colors) {
    uids.forEach(uid => {
      const c = centerOf(uid);
      FX.burst(c.x, c.y + c.h * 0.3, { count: 34, colors, speed: [3, 9], angle: -90, spread: 110, life: [500, 900], size: [3, 7], gravity: 0.3, drag: 0.02 });
      FX.ring(c.x, c.y + c.h * 0.45, { color: '#7dd3fc', r1: c.w * 1.2, width: 5, squash: 0.3, life: 600 });
    });
  }

  const CHOREO = {
    /* ── 촛불 ── */
    async flame(res, cast) {
      const tgt = cast.targets[0];
      const back = await motion(cast.uid, 'hover', tgt);
      const from = centerOf(cast.uid, 'top');
      FX.flare(from.x, from.y, { color: '#ffb347', size: 70, rays: 8, life: 320 });
      FX.swirl(from.x, from.y, { count: 16, colors: PAL.fire, radius: [26, 42], inward: true, turns: 1.2, life: [260, 320], size: [2, 4] });
      sfx('fireball');
      await guard(FX.projectile(from, centerOf(tgt), { color: '#ffb347', trail: ['#ff6a00', '#ffd27a', '#ff3d00'], size: 15, duration: 330, arc: 46, spiral: true }));
      await runEvents(res.events, {
        onHit: ev => {
          const c = centerOf(ev.uid);
          sfx('flame');
          FX.flash('#ff7a1a', 260, 0.28);
          FX.flare(c.x, c.y, { color: '#ffb347', size: c.h * 1.15, rays: 12, life: 440 });
          FX.pillar(c.x, c.y + c.h * 0.45, { width: c.w * 0.7, height: c.h * 1.7, color: '#ff8a1f', life: 620 });
          FX.burst(c.x, c.y, { count: 46, colors: PAL.fire, speed: [2, 8], life: [400, 900], size: [3, 8], gravity: -0.08, drag: 0.06 });
          FX.burst(c.x, c.y, { kind: 'spark', count: 22, colors: ['#ffd27a', '#fff'], speed: [4, 11], life: [200, 420], size: [1.5, 2.5], len: 2 });
          FX.ring(c.x, c.y, { color: '#ff9a2e', r1: c.h * 0.75, width: 9, fill: true });
          FX.embers(c.x, c.y, { count: 18, spread: c.w * 0.6 });
        }
      });
      await back();
    },
    async bless(res, cast) {
      const back = await motion(cast.uid, 'ascend');
      const c = centerOf(cast.uid, 'top');
      sfx('holy');
      FX.flash('#fde68a', 360, 0.28);
      FX.flare(c.x, c.y, { color: '#fde68a', size: 170, rays: 16, life: 720 });
      FX.dom('sigil', c.x, c.y, 1300, sigil('#fde68a', '燈護光盾守明'), { '--w': '180px' });
      FX.ring(c.x, c.y, { color: '#fde68a', r1: 190, width: 5, life: 820, fill: true });
      FX.burst(c.x, c.y, { count: 40, colors: PAL.holy, speed: [1, 5], life: [600, 1200], size: [2, 5] });
      cast.targets.forEach(uid => {
        const t = centerOf(uid);
        FX.burst(t.x, t.y - t.h * 1.1, { kind: 'leaf', count: 7, colors: ['#fff7d6', '#fde68a'], speed: [0.2, 0.8], angle: 90, spread: 60, gravity: 0.01, life: [1000, 1500], size: [4, 6], blend: 'source-over', jitter: t.w * 0.5 });
      });
      await wait(220);
      await runEvents(res.events, {
        gap: 110,
        before: ev => { if (ev.type === 'shield') { const t = centerOf(ev.uid); FX.beam(c.x, c.y, t.x, t.y, { color: '#fde68a', width: 5, life: 480 }); } }
      });
      await back();
    },
    async judgment(res, cast) {
      const back = await motion(cast.uid, 'ultAscend');
      const c = centerOf(cast.uid, 'top');
      const { w, h: sh } = stageSize();
      sfx('holy');
      FX.flash('#000000', 700, 0.6);
      FX.speedLines({ x: c.x, y: c.y, color: '#fff7d6', life: 950, alpha: 0.4 });
      FX.flare(c.x, c.y, { color: '#fde68a', size: 230, rays: 18, life: 950, streakScale: 5 });
      FX.ring(c.x, c.y, { color: '#fde68a', r1: 270, width: 7, life: 1000, fill: true });
      FX.dom('sigil big', c.x, c.y, 1900, sigil('#fde68a', '規律審判正義秩序光'), { '--w': Math.min(w, sh) * 0.75 + 'px' });
      FX.swirl(c.x, c.y, { count: 36, colors: PAL.holy, radius: [90, 150], inward: true, turns: 1.4, life: [480, 620], size: [2, 5] });
      await wait(460);
      cast.targets.forEach((uid, i) => later(() => {
        const t = centerOf(uid, 'feet');
        FX.pillar(t.x, t.y, { width: 100, height: t.y + 60, color: '#fde68a', life: 1150 });
        FX.crack(t.x, t.y, { color: '#fde68a', branches: 8, length: [50, 130] });
        FX.flare(t.x, t.y - 50, { color: '#fff7d6', size: 190, rays: 14, life: 520 });
      }, dur(i * 90)));
      sfx('boom');
      FX.flash('#fff7d6', 480, 0.8);
      FX.impact(90);
      FX.chroma(260);
      FX.shake(16, 720);
      FX.punch(w * 0.3, sh * 0.6, 1.06, 560);
      await runEvents(res.events, {
        gap: 90,
        onHit: ev => {
          const p = centerOf(ev.uid);
          FX.burst(p.x, p.y, { count: 36, colors: PAL.holy, speed: [2, 9], life: [500, 1000], size: [2, 6], gravity: -0.05 });
          FX.burst(p.x, p.y, { count: 22, colors: PAL.fire, speed: [1, 6], life: [600, 1200], size: [3, 7], gravity: -0.08 });
          FX.embers(p.x, p.y, { count: 14, spread: p.w * 0.6 });
        },
        before: ev => { if (ev.type === 'shield') { const t = centerOf(ev.uid); FX.beam(c.x, c.y, t.x, t.y, { color: '#fde68a', width: 6, life: 480 }); } }
      });
      await back();
    },

    /* ── 칼 ── */
    async slash(res, cast) {
      const back = await motion(cast.uid, 'dash', cast.targets[0]);
      await runEvents(res.events, {
        onHit: async ev => {
          const c = centerOf(ev.uid);
          sfx('slash');
          FX.bigSlash(c.x + c.w * 0.15, c.y, { angle: 195, arc: 160, radius: c.h * 0.55, width: 8, color: '#bae6fd', life: 430, dir: -1 });
          FX.streak(c.x, c.y, { size: c.w * 4, width: 5, color: '#bae6fd', life: 440 });
          FX.burst(c.x, c.y, { kind: 'spark', count: 30, colors: PAL.steel, speed: [5, 13], life: [200, 480], size: [1.5, 3], len: 2.5, angle: 180, spread: 140 });
          FX.flash('#ffffff', 180, 0.22);
          await guard(FX.hitstop(ev.crit ? 110 : 60));
        }
      });
      await back();
    },
    async pierce(res, cast) {
      const back = await motion(cast.uid, 'leap', cast.targets[0]);
      await runEvents(res.events, {
        onHit: async ev => {
          const c = centerOf(ev.uid);
          sfx('slash');
          sfx('zap');
          FX.bolt(c.x + 24, c.y - c.h * 1.5, c.x, c.y + c.h * 0.3, { color: '#93c5fd', width: 3, jitter: 22, forks: 3, life: 320 });
          FX.bigSlash(c.x, c.y, { angle: 225, arc: 80, radius: c.h * 0.6, width: 7, color: '#93c5fd', life: 450 });
          FX.bigSlash(c.x, c.y, { angle: 135, arc: 80, radius: c.h * 0.6, width: 7, color: '#93c5fd', life: 450, dir: -1 });
          FX.burst(c.x, c.y, { kind: 'shard', count: 18, colors: ['#bfdbfe', '#e0f2fe', '#60a5fa'], speed: [3, 9], life: [400, 850], size: [4, 9], gravity: 0.2, blend: 'source-over', spin: 2 });
          FX.crack(c.x, c.y + c.h * 0.45, { color: '#93c5fd', branches: 6, length: [30, 90] });
          FX.ring(c.x, c.y + c.h * 0.45, { color: '#93c5fd', r1: 100, width: 6, squash: 0.3, fill: true });
          await guard(FX.hitstop(ev.crit ? 100 : 65));
        }
      });
      await back();
    },
    async barrage(res, cast) {
      const tgt = cast.targets[0];
      const t0 = centerOf(tgt);
      FX.speedLines({ x: t0.x, y: t0.y, color: '#e0f2fe', life: 1700, alpha: 0.45, count: 60 });
      R.stage.classList.add('dim');
      try {
        const back = await motion(cast.uid, 'ultDash', tgt);
        const angles = [200, 20, 150, 330, 250, 90];
        let k = 0;
        startCombo();
        await runEvents(res.events, {
          hitGap: 70,
          onHit: async ev => {
            const c = centerOf(ev.uid);
            const last = ev.hit === ev.hits - 1;
            sfx('slash');
            if (!last) {
              FX.bigSlash(c.x, c.y, { angle: angles[k % angles.length], arc: 140, radius: c.h * FX.rand(0.38, 0.55), width: 6, color: k % 2 ? '#bae6fd' : '#e0e7ff', life: 330, dir: k % 2 ? 1 : -1 });
              FX.streak(c.x, c.y + FX.rand(-20, 20), { size: c.w * 3, width: 3, color: '#bae6fd', life: 280 });
              k += 1;
              await guard(FX.hitstop(35));
              return;
            }
            // 마지막 X자 일섬
            FX.bigSlash(c.x, c.y, { angle: 225, arc: 100, radius: c.h * 0.95, width: 15, color: '#fde68a', life: 720 });
            FX.bigSlash(c.x, c.y, { angle: 135, arc: 100, radius: c.h * 0.95, width: 15, color: '#fde68a', life: 720, dir: -1 });
            FX.flare(c.x, c.y, { color: '#fde68a', size: 280, rays: 18, life: 720, streakScale: 5 });
            FX.ring(c.x, c.y, { color: '#fde68a', r1: 250, width: 12, life: 780, fill: true });
            FX.burst(c.x, c.y, { kind: 'shard', count: 30, colors: ['#e0f2fe', '#fde68a', '#ffffff'], speed: [4, 12], life: [600, 1100], size: [4, 10], gravity: 0.2, spin: 3, blend: 'source-over' });
            FX.flash('#ffffff', 380, 0.9);
            FX.impact(110);
            FX.chroma(320);
            FX.punch(c.x, c.y, 1.14, 560);
            sfx('boom');
            await guard(FX.hitstop(190));
          }
        });
        await wait(260);
        hideCombo();
        R.stage.classList.remove('dim');
        await back();
      } finally {
        R.stage.classList.remove('dim');
      }
    },

    /* ── 책갈피 ── */
    async ink(res, cast) {
      const tgt = cast.targets[0];
      const back = await motion(cast.uid, 'float', tgt);
      const from = centerOf(cast.uid, 'top');
      sfx('page');
      FX.glyphs(from.x, from.y, { chars: ['註', '文', '書', '弱'], count: 8, color: '#c4b5fd', speed: [0.5, 1.8] });
      FX.swirl(from.x, from.y, { count: 18, colors: PAL.ink, radius: [30, 50], turns: 1, life: [400, 520] });
      const to = centerOf(tgt);
      await guard(Promise.all([0, 1, 2].map(i => wait(i * 70).then(() => FX.projectile(from, { x: to.x + FX.rand(-15, 15), y: to.y + FX.rand(-15, 15) }, { color: '#a78bfa', trail: PAL.ink, size: 9, duration: 300, arc: 30 + i * 25, spiral: i === 1 })))));
      await runEvents(res.events, {
        onHit: ev => {
          const c = centerOf(ev.uid);
          sfx('ink');
          FX.brush(c.x - c.w * 0.65, c.y - c.h * 0.35, c.x + c.w * 0.65, c.y + c.h * 0.3, { width: c.w * 0.2, color: '#ede9fe', glow: '#8b5cf6', bend: 0.18 });
          later(() => FX.brush(c.x + c.w * 0.6, c.y - c.h * 0.4, c.x - c.w * 0.55, c.y + c.h * 0.35, { width: c.w * 0.16, color: '#f5f3ff', glow: '#a78bfa', bend: -0.2 }), dur(90));
          FX.flare(c.x, c.y, { color: '#a78bfa', size: c.h * 0.95, rays: 10, life: 400 });
          FX.burst(c.x, c.y, { count: 30, colors: ['#4c1d95', '#6d28d9', '#1e1b4b'], speed: [2, 7], life: [500, 900], size: [3, 7], blend: 'source-over', gravity: 0.1 });
          FX.burst(c.x, c.y, { count: 14, colors: PAL.ink, speed: [1, 4], life: [500, 900], size: [2, 4] });
          FX.ring(c.x, c.y, { color: '#a78bfa', r1: c.h * 0.7, width: 6, fill: true });
          FX.glyphs(c.x, c.y, { chars: ['弱', '註'], count: 4, color: '#ddd6fe' });
        }
      });
      await back();
    },
    async mend(res, cast) {
      const back = await motion(cast.uid, 'float');
      const c = centerOf(cast.uid, 'top');
      sfx('page');
      FX.flare(c.x, c.y, { color: '#86efac', size: 130, rays: 12, life: 540 });
      FX.swirl(c.x, c.y, { count: 22, kind: 'leaf', colors: PAL.leaf, radius: [30, 50], expand: 1.6, turns: 1, life: [800, 1100], size: [3, 6], blend: 'source-over' });
      FX.ring(c.x, c.y, { color: '#86efac', r1: 140, width: 4, life: 720, fill: true });
      FX.glyphs(c.x, c.y, { chars: ['書', '癒', '生'], count: 5, color: '#bbf7d0' });
      await wait(220);
      await runEvents(res.events, {
        gap: 90,
        before: ev => { if (ev.type === 'heal') { const t = centerOf(ev.uid); FX.beam(c.x, c.y, t.x, t.y, { color: '#86efac', width: 4, life: 420 }); } }
      });
      await back();
    },
    async lastpage(res, cast) {
      const tgt = cast.targets[0];
      const back = await motion(cast.uid, 'ultFloat', tgt);
      const t = centerOf(tgt, 'feet');
      const tc = centerOf(tgt);
      const cc = centerOf(cast.uid, 'top');
      sfx('page');
      FX.speedLines({ x: tc.x, y: tc.y, color: '#ecfccb', life: 1200, alpha: 0.35 });
      FX.dom('sigil jade', t.x, t.y - 4, 1800, sigil('#a7f3d0', '終章書智結末物語'), { '--w': tc.w * 2.6 + 'px' });
      FX.glyphs(tc.x, tc.y, { chars: ['終', '章', '書', '智'], count: 12, color: '#d9f99d', speed: [0.4, 1.4] });
      FX.swirl(tc.x, tc.y, { count: 20, kind: 'leaf', colors: ['#fffbeb', '#fef3c7', '#ffffff'], radius: [tc.w, tc.w * 1.4], inward: true, turns: 1.3, life: [450, 560], size: [5, 8], blend: 'source-over' });
      FX.beam(cc.x, cc.y, tc.x, tc.y, { color: '#a7f3d0', width: 6, life: 620 });
      await wait(480);
      FX.pillar(t.x, t.y, { width: 120, height: t.y + 60, color: '#a7f3d0', life: 1100 });
      FX.flare(tc.x, tc.y, { color: '#ecfccb', size: 250, rays: 16, life: 720, streakScale: 5 });
      FX.crack(t.x, t.y, { color: '#a7f3d0', branches: 8, length: [50, 120] });
      sfx('boom');
      FX.flash('#ecfccb', 420, 0.7);
      FX.impact(90);
      FX.chroma(240);
      FX.shake(13, 560);
      FX.punch(tc.x, tc.y, 1.08, 520);
      await runEvents(res.events, {
        gap: 80,
        onHit: ev => {
          const c = centerOf(ev.uid);
          FX.burst(c.x, c.y, { count: 44, colors: [...PAL.leaf, '#fde68a'], speed: [2, 9], life: [500, 1100], size: [2, 6] });
          FX.ring(c.x, c.y, { color: '#d9f99d', r1: c.h * 0.95, width: 8, life: 720, fill: true });
        }
      });
      await back();
    },

    /* ── 적 ── */
    async zap(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const a0 = centerOf(cast.uid);
      FX.swirl(a0.x, a0.y, { count: 12, colors: ['#fde68a', '#ffffff'], radius: [20, 36], inward: true, turns: 1, life: [220, 280] });
      await runEvents(res.events, {
        onHit: async ev => {
          const a = centerOf(cast.uid), c = centerOf(ev.uid);
          sfx('zap');
          FX.bolt(a.x, a.y, c.x, c.y, { color: '#fde68a', width: 2.6, life: 300, forks: 3 });
          later(() => FX.bolt(a.x, a.y, c.x, c.y, { color: '#fef9c3', width: 1.6, life: 200, forks: 1 }), dur(60));
          FX.flare(c.x, c.y, { color: '#fde68a', size: 90, rays: 10, life: 320 });
          FX.burst(c.x, c.y, { kind: 'spark', count: 18, colors: ['#fde68a', '#ffffff'], speed: [3, 9], life: [150, 380], size: [1, 2], len: 2 });
          FX.flash('#fef9c3', 140, 0.18);
          await guard(FX.hitstop(45));
        }
      });
      await back();
    },
    async venom(res, cast) {
      const back = await motion(cast.uid, 'lunge', cast.targets[0]);
      await runEvents(res.events, {
        onHit: ev => {
          const c = centerOf(ev.uid);
          sfx('splash');
          FX.flare(c.x, c.y, { color: '#bef264', size: 80, rays: 8, life: 300 });
          FX.burst(c.x, c.y, { count: 30, colors: PAL.venom, speed: [2, 7], life: [400, 850], size: [3, 7], gravity: 0.15, blend: 'source-over' });
          FX.burst(c.x, c.y - c.h * 0.2, { count: 10, colors: ['#84cc16', '#365314'], speed: [0.2, 0.8], angle: 90, spread: 40, life: [700, 1100], size: [3, 5], gravity: 0.08, blend: 'source-over', jitter: c.w * 0.3 });
          FX.ring(c.x, c.y, { color: '#a3e635', r1: c.h * 0.6, width: 5, fill: true });
          FX.bubbles(c.x, c.y, { count: 10, color: 'rgba(190,242,100,.85)' });
        }
      });
      await back();
    },
    async whip(res, cast) {
      const back = await motion(cast.uid, 'lunge', cast.targets[0]);
      await runEvents(res.events, {
        onHit: async ev => {
          const c = centerOf(ev.uid);
          sfx('slash');
          FX.bigSlash(c.x - c.w * 0.1, c.y, { angle: 345, arc: 150, radius: c.h * 0.5, width: 7, color: '#f0abfc', life: 400 });
          FX.burst(c.x, c.y, { count: 22, colors: PAL.violet, speed: [2, 7], life: [300, 650], size: [2, 5] });
          await guard(FX.hitstop(45));
        }
      });
      await back();
    },
    async glow(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const c = centerOf(cast.uid);
      sfx('buff');
      FX.flare(c.x, c.y, { color: '#fde68a', size: 150, rays: 14, life: 600 });
      FX.ring(c.x, c.y, { color: '#fde68a', r1: 180, width: 6, life: 720, fill: true });
      FX.ring(c.x, c.y, { color: '#fca5a5', r1: 120, width: 4, life: 560 });
      FX.flash('#fde68a', 280, 0.16);
      await runEvents(res.events, {
        before: ev => {
          if (ev.type !== 'status') return;
          const t = centerOf(ev.uid);
          FX.beam(c.x, c.y, t.x, t.y, { color: '#fde68a', width: 3, life: 380 });
          FX.swirl(t.x, t.y, { count: 12, colors: ['#fca5a5', '#fde68a'], radius: [t.w * 0.5, t.w * 0.6], squash: 0.5, turns: 1, rise: t.h * 0.5, life: [600, 800] });
        }
      });
      await back();
    },
    async toxin(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const c = centerOf(cast.uid);
      sfx('splash');
      FX.flash('#365314', 520, 0.38);
      FX.dom('sigil', c.x, c.y, 1300, sigil('#bef264', '毒深海腐蝕沈'), { '--w': c.w * 2 + 'px' });
      FX.flare(c.x, c.y, { color: '#bef264', size: 170, rays: 14, life: 620 });
      cast.targets.forEach(uid => {
        const t = centerOf(uid);
        FX.burst(t.x, t.y - t.h * 0.9, { count: 30, colors: PAL.venom, speed: [1, 3], angle: 90, spread: 50, gravity: 0.25, life: [500, 900], size: [3, 7], blend: 'source-over', jitter: 46 });
        FX.swirl(t.x, t.y, { count: 10, kind: 'bubble', colors: ['rgba(190,242,100,.85)'], radius: [t.w * 0.4, t.w * 0.6], squash: 0.5, rise: t.h * 0.6, life: [700, 900], size: [3, 6], blend: 'source-over' });
      });
      await wait(260);
      await runEvents(res.events, { onHit: ev => { const t = centerOf(ev.uid); FX.flare(t.x, t.y, { color: '#bef264', size: 90, rays: 8, life: 320 }); FX.bubbles(t.x, t.y, { count: 10, color: 'rgba(190,242,100,.85)' }); } });
      await back();
    },
    async smash(res, cast) {
      const back = await motion(cast.uid, 'lunge', cast.targets[0]);
      await runEvents(res.events, {
        onHit: async ev => {
          const c = centerOf(ev.uid);
          sfx('splash');
          FX.flare(c.x, c.y, { color: '#bae6fd', size: c.h * 1.2, rays: 12, life: 420 });
          splashOn([ev.uid], PAL.sea);
          FX.crack(c.x, c.y + c.h * 0.45, { color: '#7dd3fc', branches: 7 });
          FX.ring(c.x, c.y + c.h * 0.4, { color: '#7dd3fc', r1: 160, width: 9, squash: 0.35, life: 640, fill: true });
          FX.shake(11, 400);
          FX.chroma(160);
          await guard(FX.hitstop(75));
        }
      });
      await back();
    },
    async tsunami(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const { w } = stageSize();
      const row = rowOf(cast.targets);
      sfx('water');
      FX.flash('#0c4a6e', 500, 0.32);
      FX.wave({ from: -160, to: w + 260, y: row.y, height: row.h * 1.25, life: 1050 });
      await wait(380);
      await runEvents(res.events, { onHit: ev => { splashOn([ev.uid], PAL.sea); FX.shake(6, 260); } });
      await back();
    },
    async gaze(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const a = centerOf(cast.uid, 'top');
      const t = centerOf(cast.targets[0]);
      sfx('gaze');
      FX.dom('sigil', a.x, a.y, 1000, sigil('#e879f9', '眼深淵凝視'), { '--w': '110px' });
      FX.flare(a.x, a.y, { color: '#e879f9', size: 110, rays: 10, life: 520 });
      FX.beam(a.x, a.y, t.x, t.y, { color: '#e879f9', width: 9, life: 560 });
      FX.swirl(t.x, t.y, { count: 16, colors: PAL.violet, radius: [t.w * 0.6, t.w * 0.8], inward: true, turns: 1.2, life: [380, 460] });
      await wait(200);
      await runEvents(res.events, { onHit: ev => { const c = centerOf(ev.uid); FX.flare(c.x, c.y, { color: '#f0abfc', size: 100, rays: 10, life: 360 }); FX.burst(c.x, c.y, { count: 22, colors: ['#f0abfc', '#e879f9', '#ffffff'], speed: [1, 5], life: [400, 800] }); } });
      await back();
    },
    async summon(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const c = centerOf(cast.uid);
      sfx('bubbles');
      FX.swirl(c.x, c.y + c.h * 0.3, { count: 26, colors: ['#c084fc', '#7dd3fc', '#ffffff'], radius: [c.w * 0.3, c.w * 0.5], squash: 0.35, expand: 1.4, turns: 2, life: [700, 900] });
      FX.ring(c.x, c.y, { color: '#c084fc', r1: 140, width: 5, fill: true });
      FX.bubbles(c.x, c.y, { count: 16, spread: 70 });
      await wait(300);
      await runEvents(res.events);
      await back();
    },
    async tide(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const { w, h: sh } = stageSize();
      const c = centerOf(cast.uid);
      const row = rowOf(cast.targets);
      FX.flash('#082f49', 760, 0.6);
      FX.speedLines({ x: c.x, y: c.y, color: '#bae6fd', life: 1300, alpha: 0.35 });
      FX.flare(c.x, c.y, { color: '#7dd3fc', size: 220, rays: 16, life: 760, streakScale: 5 });
      sfx('water');
      FX.wave({ from: -260, to: w + 360, y: row.y + 10, height: row.h * 2.1, length: row.h * 6, life: 1300 });
      later(() => FX.wave({ from: -200, to: w + 300, y: row.y + 4, height: row.h * 1.2, life: 1100, color: 'rgba(14,165,233,0.8)' }), dur(220));
      FX.shake(18, 900);
      FX.punch(w * 0.7, sh * 0.6, 1.05, 640);
      await wait(520);
      FX.impact(90);
      FX.chroma(280);
      await runEvents(res.events, { onHit: ev => { splashOn([ev.uid], ['#ffffff', '#bae6fd', '#38bdf8']); FX.shake(9, 280); } });
      await back();
    },
    async basic(res, cast) {
      const back = await motion(cast.uid, cast.targets.length === 1 ? 'lunge' : 'pulse', cast.targets[0]);
      await runEvents(res.events, { onHit: ev => { const c = centerOf(ev.uid); FX.flare(c.x, c.y, { size: 80, rays: 8, life: 300 }); } });
      await back();
    }
  };

  async function performSkill(res) {
    const cast = res.events.find(e => e.type === 'cast');
    if (!cast) { await runEvents(res.events); return; }
    showCallout(res.caster, res.skill, res.rank);
    startCombo();
    if (res.skill.ult) await cutscene(res.caster, res.skill);
    await (CHOREO[res.skill.vfx] || CHOREO.basic)(res, cast);
    hideCallout();
    syncAll();
  }

  /* ---------- 최종 술식 컷신 ---------- */
  async function cutscene(caster, skill) {
    const isAlly = caster.side === 'ally';
    const def = defOf(caster);
    const cs = R.cutscene;
    cs.className = isAlly ? 'ally' : 'foe';
    cs.style.setProperty('--c', isAlly ? CHARACTERS[caster.key].color : '#ef4444');
    cs.style.setProperty('--spd', settings.speed);
    $('.cs-portrait', cs).innerHTML = Sprites.unit(def.sprite);
    $('.cs-owner', cs).textContent = isAlly ? `${caster.name} · 최종 술식` : `${caster.name} · 위협 감지`;
    $('.cs-title', cs).innerHTML = [...skill.name].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
    $('.cs-en', cs).textContent = skill.en || 'ULTIMATE';
    $('.cs-quote', cs).textContent = isAlly ? `“${def.quote}”` : '“바다가 차오른다. 모두 삼켜 주마.”';
    const shards = $('.cs-shards', cs);
    shards.innerHTML = '';
    sfx('ultCharge');
    void cs.offsetWidth;
    cs.classList.add('show');
    await wait(1000);
    cs.classList.add('cut');
    sfx('ultCut');
    FX.flash('#ffffff', 320, 0.95);
    FX.shake(12, 460);
    FX.impact(80);
    for (let i = 0; i < 30; i++) {
      const s = h('i');
      const size = FX.rand(10, 38);
      s.style.cssText = `left:${FX.rand(5, 95)}%;top:${FX.rand(30, 70)}%;width:${size}px;height:${size * 1.5}px;--tx:${FX.rand(-1, 1) * 460}px;--ty:${FX.rand(-1, 1) * 380}px;--rot:${FX.rand(-540, 540)}deg`;
      shards.appendChild(s);
    }
    await wait(460);
    cs.classList.add('out');
    await wait(280);
    cs.className = '';
  }

  /* ---------- 보스 격노 ---------- */
  async function bossPhase(ev) {
    const u = battle.unit(ev.uid);
    const v = views.get(ev.uid);
    if (!u || !v) return;
    await wait(300);
    sfx('roar');
    const c = centerOf(ev.uid);
    FX.flash('#b91c1c', 650, 0.5);
    FX.shake(16, 800);
    FX.impact(90);
    FX.chroma(360);
    FX.speedLines({ x: c.x, y: c.y, color: '#fecaca', life: 1100, alpha: 0.4 });
    v.el.classList.add('enraged');
    FX.flare(c.x, c.y, { color: '#ef4444', size: 260, rays: 18, life: 900, streakScale: 5 });
    FX.ring(c.x, c.y, { color: '#ef4444', r1: 260, width: 10, life: 950, fill: true });
    FX.crack(c.x, c.y + c.h * 0.45, { color: '#ef4444', branches: 9, length: [60, 150] });
    FX.burst(c.x, c.y, { count: 60, colors: PAL.blood, speed: [2, 8], life: [600, 1300], size: [2, 6], gravity: -0.04 });
    FX.embers(c.x, c.y, { count: 24, spread: c.w * 0.7, colors: ['#ef4444', '#fb7185', '#fecaca'] });
    renderStatuses(v, u);
    renderMoxie(v, u, ev.moxie);
    updateBossBar(u, u.hp);
    await banner('격 노', `${josa(u.name, '이/가')} 분노하여 해일을 부릅니다`, 'rage', 1400);
  }

  /* =========================================================
   *  턴 진행
   * ========================================================= */
  async function playAllyAction(res, i) {
    setSlotState(i, 'active');
    if (res.item.type === 'merge') { await wait(280); return; }
    if (res.events[0].type === 'fizzle') {
      const c = centerOf(res.events[0].uid);
      FX.text(c.x, c.y - 40, '행동 불가', 'info', 900);
      await wait(500);
      return;
    }
    await performSkill(res);
  }

  async function playEnemyAction(res) {
    const v = views.get(res.caster.uid);
    const chip = v && v.intents && v.intents.children[res.intentIndex];
    if (chip) chip.classList.add('active');
    await performSkill(res);
    if (chip) { chip.classList.remove('active'); chip.classList.add('done'); }
  }

  async function playRoundEnd(events) {
    let ticked = false;
    for (const ev of events) {
      if (ev.type === 'phase') { await bossPhase(ev); continue; }
      applyEvent(ev);
      if (ev.type === 'dot') { ticked = true; await wait(260); }
    }
    if (ticked) await wait(300);
  }

  async function executeTurn() {
    if (!planReady() || !battle.queue.length) return;
    const token = gameToken;
    busy = true;
    selectedUid = null;
    hideTip();
    document.body.classList.add('executing');
    updateButtons();
    refreshCardStates();
    updateReticle();
    showDetail(null);
    sfx('execute');
    try {
      battle.beginExecution();
      let outcome = null;
      for (let i = 0; ; i++) {
        const res = battle.resolveNext();
        if (!res) break;
        await playAllyAction(res, i);
        outcome = battle.outcome();
        if (outcome) break;
        await wait(200);
      }
      setSlotState(RULES.maxAp, 'done');
      if (!outcome) {
        await wait(220);
        sfx('enemyTurn');
        await banner('ENEMY PHASE', '적의 차례', 'enemy', 900);
        battle.beginEnemyPhase();
        for (;;) {
          const res = battle.resolveEnemyNext();
          if (!res) break;
          await playEnemyAction(res);
          outcome = battle.outcome();
          if (outcome) break;
          await wait(200);
        }
      }
      const roundTurn = battle.turn;
      if (outcome !== 'victory' && outcome !== 'defeat') {
        await playRoundEnd(battle.endRound());
        outcome = battle.outcome();
      }
      if (outcome === 'victory') return await finish(true, roundTurn);
      if (outcome === 'defeat') return await finish(false, roundTurn, 'wipe');
      if (outcome === 'waveClear') { battle.returnUnplayed(); await nextWave(); }
      if (battle.turn > RULES.maxTurn) return await finish(false, RULES.maxTurn, 'timeout');
      await startPlanning();
    } catch (err) {
      if (!isAbort(err)) console.error(err);
    } finally {
      if (token === gameToken) document.body.classList.remove('executing');
    }
  }

  async function startPlanning() {
    const res = battle.beginPlanning();
    busy = false;
    selectedUid = null;
    updateHud();
    clearSlotStates();
    renderSlots();
    renderHand({ deal: true });
    renderAP();
    renderIntents();
    syncAll();
    updateReticle();
    updateButtons();
    showDetail(null);
    sfx('turn');
    banner(`TURN ${pad2(battle.turn)}`, `ROUND ${battle.waveIndex + 1} · ${WAVES[battle.waveIndex].name}`, 'turn', 900);
    if (res.ults.length) later(() => sfx('ultReady'), 400);
    const threat = battle.aliveEnemies.find(e => e.intents.some(it => SKILLS[it.skillId].ult));
    if (threat) later(() => { sfx('warning'); toast(`${josa(threat.name, '이/가')} 최종 술식을 준비합니다! 보호막과 회복으로 대비하세요.`, 'danger'); }, 600);
    else if (battle.turn === RULES.maxTurn) toast('마지막 턴입니다!', 'danger');
    if (autoOn) runAuto();
  }

  async function nextWave() {
    await wait(500);
    await banner('ROUND CLEAR', '다음 물결이 밀려옵니다', 'clear', 1300);
    battle.enemies.forEach(e => { const v = views.get(e.uid); if (v) v.el.remove(); views.delete(e.uid); });
    battle.startWave(battle.waveIndex + 1);
    await waveIntro();
  }

  async function waveIntro() {
    const w = WAVES[battle.waveIndex];
    updateHud();
    if (w.boss) Sound.bgm('boss');
    sfx('gong');
    const shown = banner(`ROUND ${battle.waveIndex + 1}`, `${w.name} · ${w.en}`, w.boss ? 'boss' : 'wave', 1700);
    await wait(500);
    for (const e of battle.enemies) {
      createUnitView(e, { spawn: true });
      await wait(200);
    }
    const boss = battle.enemies.find(e => e.boss);
    if (boss) {
      showBossBar(boss);
      sfx('roar');
      FX.shake(8, 700);
    }
    await shown;
  }

  /* ---------- 자동 전투 ---------- */
  async function runAuto() {
    if (autoRunning || !autoOn) return;
    autoRunning = true;
    updateButtons();
    const token = gameToken;
    let go = false;
    try {
      await wait(550);
      while (autoOn && token === gameToken && planReady(true) && battle.ap > 0) {
        const c = autoChoice(battle);
        if (!c) break;
        if (c.target && c.target !== battle.targetUid) { battle.setTarget(c.target); updateReticle(); }
        if (c.type === 'merge') doMerge(c.from, c.to, true);
        else doPlay(c.index, null, true);
        await wait(420);
      }
      go = autoOn && token === gameToken && planReady(true) && battle.queue.length > 0;
    } catch (e) {
      if (!isAbort(e)) console.error(e);
    } finally {
      if (token === gameToken) {
        autoRunning = false;
        updateButtons();
      }
    }
    if (go) executeTurn();
  }

  // 연출 중에 켜도 다음 계획 단계부터 자동으로 진행됩니다.
  function toggleAuto() {
    if (!battle || finished) return;
    autoOn = !autoOn;
    sfx('click');
    toast(autoOn ? '자동 전투 켜짐' : '자동 전투 꺼짐');
    updateButtons();
    if (autoOn && planReady()) runAuto();
  }

  /* =========================================================
   *  결과
   * ========================================================= */
  async function finish(victory, turns, reason) {
    busy = true;
    finished = true;
    autoOn = false;
    updateButtons();
    if (victory) celebrate();
    await wait(victory ? 1100 : 900);
    Sound.stopBgm();
    sfx(victory ? 'victory' : 'defeat');
    const st = battle.stats;
    const deaths = battle.allies.filter(a => !a.alive).length;
    const goalTurns = 11;
    const stars = [
      { ok: victory, label: '전투 승리' },
      { ok: victory && deaths === 0, label: '아군 전원 생존' },
      { ok: victory && turns <= goalTurns, label: `${goalTurns}턴 이내 승리` }
    ];
    const nStars = stars.filter(s => s.ok).length;
    const rank = !victory ? 'F' : nStars === 3 ? (turns <= 9 ? 'S' : 'A') : nStars === 2 ? 'B' : 'C';
    const score = k => st.damage[k] + st.healing[k] * 0.9 + st.shielded[k] * 0.5;
    const mvp = PARTY.slice().sort((a, b) => score(b) - score(a))[0];
    const total = PARTY.reduce((s, k) => s + st.damage[k], 0);
    const maxShare = Math.max(1, ...PARTY.map(k => st.damage[k]));
    const reasonTxt = reason === 'timeout' ? '제한 턴 안에 적을 쓰러뜨리지 못했습니다.' : '파티가 전멸했습니다.';

    const panel = $('#m-result .panel');
    panel.className = 'panel result ' + (victory ? 'win' : 'lose');
    panel.innerHTML = `
      <div class="rs-sub">${victory ? 'STAGE COMPLETE' : 'BATTLE LOST'}</div>
      <div class="rs-title">${victory ? 'VICTORY' : 'DEFEAT'}</div>
      ${victory ? '' : `<div class="rs-reason">${reasonTxt}</div>`}
      <div class="rs-rank r-${rank}" data-rank="${rank}">${rank}</div>
      <div class="rs-stars">${stars.map((s, i) => `<div class="rs-star ${s.ok ? 'ok' : ''}" style="--i:${i}">${Sprites.icon('star')}<span>${s.label}</span></div>`).join('')}</div>
      <div class="rs-grid">
        <div><span>소요 턴</span><b data-count="${turns}">0</b></div>
        <div><span>총 피해량</span><b data-count="${total}">0</b></div>
        <div><span>최대 일격</span><b data-count="${st.maxHit}">0</b><small>${st.maxHitBy ? CHARACTERS[st.maxHitBy].name : '-'}</small></div>
        <div><span>카드 합성</span><b data-count="${st.merges}">0</b></div>
        <div><span>최종 술식</span><b data-count="${st.ults}">0</b></div>
        <div><span>받은 피해</span><b data-count="${st.taken}">0</b></div>
      </div>
      <div class="rs-party">${PARTY.map(k => {
        const a = battle.ally(k);
        const ch = CHARACTERS[k];
        return `<div class="rs-member ${a.alive ? '' : 'down'} ${k === mvp ? 'mvp' : ''}" style="--c:${ch.color}">
          <div class="rs-face">${Sprites.unit(ch.sprite)}</div>
          <div class="rs-info"><div class="rs-name">${ch.name}${k === mvp ? '<em>MVP</em>' : ''}${a.alive ? '' : '<i>전투 불능</i>'}</div>
          <div class="rs-bar"><i style="--w:${(st.damage[k] / maxShare) * 100}%"></i></div>
          <div class="rs-nums">피해 ${fmt(st.damage[k])} · 회복 ${fmt(st.healing[k])} · 보호막 ${fmt(st.shielded[k])}</div></div>
        </div>`;
      }).join('')}</div>
      <div class="rs-btns"><button class="btn primary big" data-act="retry">${victory ? '다시 도전' : '재도전'}</button><button class="btn" data-act="title">타이틀로</button></div>`;
    openModal('result');
    $$('.rs-grid b[data-count]', panel).forEach(b => countUp(b, Number(b.dataset.count)));
    stars.forEach((s, i) => { if (s.ok) later(() => sfx('star', { i }), 500 + i * 260); });
    later(() => sfx('stamp'), 1350);
  }

  // 승리 축하 불꽃놀이
  function celebrate() {
    const { w, h: sh } = stageSize();
    for (let i = 0; i < 10; i++) {
      later(() => {
        const x = FX.rand(w * 0.12, w * 0.88), y = FX.rand(sh * 0.12, sh * 0.42);
        guard(FX.projectile({ x: FX.rand(w * 0.3, w * 0.7), y: sh }, { x, y }, { color: '#fff7d6', trail: ['#fde68a', '#ffffff'], size: 5, duration: 460 }))
          .then(() => { FX.firework(x, y); sfx('firework'); })
          .catch(() => {});
      }, i * 300);
    }
  }

  function countUp(el, to) {
    const t0 = performance.now();
    const len = 900;
    const tick = now => {
      const k = Math.min(1, (now - t0) / len);
      el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* =========================================================
   *  모달
   * ========================================================= */
  function openModal(name) {
    const m = $('#m-' + name);
    if (!m) return;
    if (name === 'enemy') renderEnemyInfo();
    if (name === 'settings') renderSettings();
    hideTip();
    m.classList.add('show');
    sfx('click');
  }
  function closeModal(m) { m.classList.remove('show'); }
  const openedModal = () => $('.overlay.modal.show');

  function afflatusChart() {
    const cx = 78, cy = 78, r = 50;
    const cyc = ['beast', 'plant', 'star', 'mineral'];
    const pts = cyc.map((k, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      return { k, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });
    const arrows = pts.map((p, i) => {
      const q = pts[(i + 1) % 4];
      const mx = (p.x + q.x) / 2 + (((p.x + q.x) / 2 - cx) * 0.35);
      const my = (p.y + q.y) / 2 + (((p.y + q.y) / 2 - cy) * 0.35);
      const sx = p.x + (q.x - p.x) * 0.24, sy = p.y + (q.y - p.y) * 0.24;
      const ex = p.x + (q.x - p.x) * 0.76, ey = p.y + (q.y - p.y) * 0.76;
      return `<path d="M${sx} ${sy} Q${mx} ${my} ${ex} ${ey}" marker-end="url(#ah)"/>`;
    }).join('');
    const node = (k, x, y) => `<g><circle cx="${x}" cy="${y}" r="15" fill="#0b1210" stroke="${AFFLATUS[k].color}" stroke-width="2"/>
      <text x="${x}" y="${y + 5}" text-anchor="middle" fill="${AFFLATUS[k].color}" font-size="14" font-family="serif">${AFFLATUS[k].glyph}</text>
      <text x="${x}" y="${y + 29}" text-anchor="middle" fill="#cbd5c9" font-size="9">${AFFLATUS[k].name}</text></g>`;
    return `<svg class="aff-chart" viewBox="0 0 300 160" aria-label="영감 상성표">
      <defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#d4af37"/></marker></defs>
      <g stroke="#d4af37" stroke-width="1.6" fill="none">${arrows}<path d="M213 78 H247" marker-end="url(#ah)" marker-start="url(#ah)"/></g>
      ${pts.map(p => node(p.k, p.x, p.y)).join('')}
      ${node('spirit', 196, 78)}${node('intellect', 264, 78)}
      <text x="230" y="130" text-anchor="middle" fill="#9aa69f" font-size="9">서로 우세</text>
    </svg>`;
  }

  function renderEnemyInfo() {
    const box = $('#enemy-list');
    if (!battle || !battle.enemies.length) {
      box.innerHTML = '<p class="dim">아직 적이 나타나지 않았습니다.</p>';
      return;
    }
    const seen = new Set();
    const list = battle.aliveEnemies.filter(e => (seen.has(e.key) ? false : seen.add(e.key)));
    box.innerHTML = list.map(e => {
      const def = ENEMIES[e.key];
      const aff = AFFLATUS[e.afflatus];
      const beats = AFFLATUS_BEATS[e.afflatus];
      const weak = Object.keys(AFFLATUS_BEATS).filter(k => AFFLATUS_BEATS[k] === e.afflatus);
      const skills = [...def.skills, def.ult].filter(Boolean).map(id => {
        const s = SKILLS[id];
        return `<li class="${s.intent}">${Sprites.icon(s.intent)}<div><b>${s.name}</b><span>${richDesc(s.desc(s, 0))}</span></div></li>`;
      }).join('');
      return `<div class="en-card" style="--aff:${aff.color}">
        <div class="en-face">${Sprites.unit(def.sprite)}</div>
        <div class="en-body">
          <div class="en-name">${e.name}${def.title ? `<small>${def.title}</small>` : ''}</div>
          <div class="en-meta"><span style="color:${aff.color}">${aff.glyph} ${aff.name}</span> · 체력 ${fmt(e.hp)}/${fmt(e.maxHp)} · 공격 ${e.atk} · 방어 ${e.def}</div>
          <div class="en-meta">약점: ${weak.map(k => `<b style="color:${AFFLATUS[k].color}">${AFFLATUS[k].glyph} ${AFFLATUS[k].name}</b>`).join(', ')} · 우세: <b style="color:${AFFLATUS[beats].color}">${AFFLATUS[beats].glyph} ${AFFLATUS[beats].name}</b></div>
          <p class="en-lore">${def.lore}</p>
          <ul class="en-skills">${skills}</ul>
        </div>
      </div>`;
    }).join('');
  }

  function renderSettings() {
    $('#set-sfx').value = settings.sfx;
    $('#set-bgm').value = settings.bgm;
    $('#set-bgm-on').checked = settings.bgmOn;
    $('#set-shake').checked = settings.shake;
    $$('#set-speed button').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === settings.speed));
    $$('#dev-moxie button').forEach(b => { b.disabled = !planReady(); });
  }

  function setSpeed(v) {
    settings.speed = v;
    document.documentElement.style.setProperty('--spd', v);
    R.speed.querySelector('span').textContent = 'x' + v;
    saveSettings();
  }

  function setMuted(m) {
    settings.muted = m;
    R.sound.innerHTML = Sprites.icon(m ? 'mute' : 'volume');
    R.sound.classList.toggle('off', m);
    applySound();
    saveSettings();
  }

  /* =========================================================
   *  게임 시작
   * ========================================================= */
  // 진행 중인 연출을 모두 끊고 전장·손패·오버레이를 비웁니다.
  function teardown() {
    gameToken += 1;
    $$('.overlay.show').forEach(closeModal);
    hideTip();
    views.clear();
    prevRanks.clear();
    R.units.innerHTML = '';
    R.hand.innerHTML = '';
    R.ghosts.innerHTML = '';
    R.toast.innerHTML = '';
    R.bossBar.classList.add('hidden');
    R.callout.className = '';
    R.combo.className = '';
    R.banner.className = '';
    R.cutscene.className = '';
    document.body.classList.remove('executing', 'dragging', 'drop-play');
    R.stage.classList.remove('dim', 'impact', 'chroma');
    selectedUid = null;
    busy = true;
    autoRunning = false;
    finished = false;
  }

  async function newGame() {
    teardown();
    const token = gameToken;
    battle = new Battle();
    battle.allies.forEach((u, i) => {
      const v = createUnitView(u);
      v.mover.animate([{ transform: 'translateX(240px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, delay: 150 * i, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
    renderSlots();
    renderAP();
    updateButtons();
    updateHud();
    showDetail(null);
    Sound.bgm('calm');
    try {
      battle.startWave(0);
      await waveIntro();
      if (token !== gameToken) return;
      await startPlanning();
    } catch (e) {
      if (!isAbort(e)) console.error(e);
    }
  }

  function goTitle() {
    teardown();
    battle = null;
    autoOn = false;
    updateButtons();
    Sound.bgm('calm');
    $('#title').classList.add('show');
  }

  /* ---------- 이벤트 연결 ---------- */
  function bindUI() {
    $('#btn-start').addEventListener('click', () => {
      Sound.init();
      applySound();
      $('#title').classList.remove('show');
      newGame();
    });
    $('#btn-howto').addEventListener('click', () => { Sound.init(); applySound(); openModal('help'); });
    R.exec.addEventListener('click', executeTurn);
    R.undo.addEventListener('click', doUndo);
    R.reset.addEventListener('click', doReset);
    R.auto.addEventListener('click', toggleAuto);
    R.slots.forEach((s, i) => s.addEventListener('click', () => { if (battle && i === battle.queue.length - 1) doUndo(); }));
    $('#btn-enemy').addEventListener('click', () => openModal('enemy'));
    $('#btn-help').addEventListener('click', () => openModal('help'));
    $('#btn-settings').addEventListener('click', () => openModal('settings'));
    R.speed.addEventListener('click', () => { setSpeed(settings.speed >= 3 ? 1 : settings.speed + 1); sfx('click'); });
    R.sound.addEventListener('click', () => { Sound.init(); setMuted(!settings.muted); });

    $$('.overlay.modal').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m && m.id !== 'm-result') closeModal(m); });
      $$('[data-close]', m).forEach(b => b.addEventListener('click', () => closeModal(m)));
    });
    $('#m-result').addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'retry') newGame(); else goTitle();
    });

    $('#set-sfx').addEventListener('input', e => { settings.sfx = Number(e.target.value); applySound(); saveSettings(); });
    $('#set-sfx').addEventListener('change', () => sfx('select'));
    $('#set-bgm').addEventListener('input', e => { settings.bgm = Number(e.target.value); applySound(); saveSettings(); });
    $('#set-bgm-on').addEventListener('change', e => { settings.bgmOn = e.target.checked; applySound(); saveSettings(); });
    $('#set-shake').addEventListener('change', e => { settings.shake = e.target.checked; saveSettings(); });
    $$('#set-speed button').forEach(b => b.addEventListener('click', () => { setSpeed(Number(b.dataset.v)); renderSettings(); sfx('click'); }));
    $$('#dev-moxie button').forEach(b => b.addEventListener('click', () => {
      if (!planReady()) return;
      const a = battle.ally(b.dataset.k);
      if (!a || !a.alive) return;
      a.moxie = RULES.moxieMax;
      const spawned = battle.spawnUlts();
      renderHand();
      syncAll();
      if (spawned.length) sfx('ultReady');
      toast(`${a.name}의 열정을 가득 채웠습니다`, 'gold');
    }));
    $('#btn-restart').addEventListener('click', () => newGame());
    $('#btn-to-title').addEventListener('click', goTitle);

    document.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input')) return;
      const modal = openedModal();
      if ($('#title').classList.contains('show') && !modal) {
        if (e.key === 'Enter') $('#btn-start').click();
        return;
      }
      if (e.key === 'Escape') {
        if (modal) { if (modal.id !== 'm-result') closeModal(modal); }
        else if (selectedUid) select(null);
        else openModal('settings');
        return;
      }
      if (modal || !battle) return;
      // 한글 입력 상태에서는 e.key가 'ㅋ' 같은 자모로 오므로, 물리 키(e.code)로 판단합니다.
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (digit) {
        const card = battle.hand[Number(digit[1]) - 1];
        if (card) onCardTap(card.uid);
        return;
      }
      switch (e.code) {
        case 'Space': case 'Enter': case 'NumpadEnter': e.preventDefault(); executeTurn(); break;
        case 'KeyZ': case 'Backspace': e.preventDefault(); doUndo(); break;
        case 'KeyR': doReset(); break;
        case 'Tab': e.preventDefault(); cycleTarget(e.shiftKey ? -1 : 1); break;
        case 'KeyA': toggleAuto(); break;
        case 'KeyS': R.speed.click(); break;
        case 'KeyM': R.sound.click(); break;
        case 'KeyI': openModal('enemy'); break;
        case 'KeyH': case 'Slash': openModal('help'); break;
        default: break;
      }
    });
    window.addEventListener('resize', () => { hideTip(); layoutUnits(); });
  }

  function buildScenery() {
    $('#city').innerHTML =
      Sprites.skyline(7, { cls: 'sky-far', color: '#0d1d20', light: '#5b7d78', min: 40, range: 120, windows: false }) +
      Sprites.skyline(19, { cls: 'sky-near', color: '#060d0e', light: '#e9c46a', face: '#f3e3b0', min: 30, range: 90, windows: true, tower: true });
    const c = document.createElement('canvas');
    c.width = c.height = 140;
    const g = c.getContext('2d');
    const img = g.createImageData(140, 140);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--noise', `url(${c.toDataURL()})`);
    $('#help-chart').innerHTML = afflatusChart();
    $('#title-party').innerHTML = PARTY.map(k => {
      const ch = CHARACTERS[k];
      const aff = AFFLATUS[ch.afflatus];
      return `<div class="tp" style="--c:${ch.color}"><div class="tp-face">${Sprites.unit(ch.sprite)}</div><div class="tp-name">${ch.name}</div><div class="tp-role"><b style="color:${aff.color}">${aff.glyph}</b> ${ch.role}</div></div>`;
    }).join('');
    $$('[data-icon]').forEach(el => { el.insertAdjacentHTML('afterbegin', Sprites.icon(el.dataset.icon)); });
  }

  /* ---------- 초기화 ---------- */
  buildScenery();
  FX.init(
      { canvas: $('#fx-canvas'), ambCanvas: $('#ambient-canvas'), stageEl: R.stage, skyEl: $('.bg-sky'), shakeEl: R.shake, camEl: R.camera, flashEl: $('#flash'), floatEl: $('#float-layer'), domEl: R.fxDom },
      { speed: () => settings.speed, shake: () => settings.shake, lite: window.innerWidth < 700 }
  );
  bindUI();
  layoutUnits();
  setSpeed(settings.speed);
  setMuted(settings.muted);
  renderSlots();
  renderAP();
  updateButtons();

  // 디버깅/테스트용 노출
  window.__game = { get battle() { return battle; }, newGame, executeTurn, settings, refresh: () => refreshPlanning() };
})();
