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
    cutscene: $('#cutscene'), ghosts: $('#ghost-layer'), tip: $('#tooltip')
  };

  /* ---------- 상태 ---------- */
  let battle = null;
  let busy = true;
  let autoOn = false;
  let autoRunning = false;
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
    ally: [{ x: 22, y: 14 }, { x: 50, y: 5 }, { x: 78, y: 14 }],
    enemy: [{ x: 22, y: 45 }, { x: 50, y: 50 }, { x: 78, y: 45 }]
  };
  let portrait = false;
  const defOf = u => (u.side === 'ally' ? CHARACTERS[u.key] : ENEMIES[u.key]);

  function placeUnit(el, side, slot) {
    const pos = (portrait ? POS_PORTRAIT : POS)[side][slot];
    el.style.left = pos.x + '%';
    el.style.bottom = pos.y + '%';
    el.style.zIndex = String(100 - Math.round(pos.y));
  }

  function layoutUnits() {
    portrait = R.stage.clientHeight > R.stage.clientWidth * 1.05;
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
      if (card) setTimeout(() => moxieGainText(card.owner), 200 + i * 120);
    });
    if (res.merges.length) setTimeout(() => sfx('merge'), 160);
    if (res.ults.length) { setTimeout(() => sfx('ultReady'), 380); toast('최종 술식 카드가 준비되었습니다', 'gold'); }
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

  function doUndo() {
    if (!planReady() || !battle.undo()) return;
    selectedUid = null;
    sfx('undo');
    renderHand(); renderSlots(); renderAP(); syncAll(); updateButtons(); showDetail(null);
  }

  function doReset() {
    if (!planReady() || !battle.resetPlanning()) return;
    selectedUid = null;
    sfx('undo');
    renderHand(); renderSlots(); renderAP(); syncAll(); updateButtons(); showDetail(null);
  }

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
    return new Promise(res => setTimeout(() => { if (t === gameToken) b.className = ''; res(); }, dur(ms)));
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
  function hideCombo() { R.combo.className = R.combo.className ? 'show out' : ''; setTimeout(() => { R.combo.className = ''; }, 400); }

  function hurt(u, v, ev, c) {
    const dir = u.side === 'enemy' ? -1 : 1;
    v.mover.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${dir * (ev.crit ? 24 : 12)}px)` }, { transform: 'translateX(0)' }],
      { duration: dur(240), easing: 'ease-out', composite: 'add' }
    );
    v.sprite.classList.remove('hurt');
    void v.sprite.offsetWidth;
    v.sprite.classList.add('hurt');
    const fullyBlocked = ev.absorbed && ev.absorbed >= ev.amount;
    sfx(fullyBlocked ? 'shieldHit' : ev.crit ? 'crit' : 'hit');
    FX.shake(ev.crit ? 9 : 4, ev.crit ? 320 : 180);
    if (ev.absorbed) FX.ring(c.x, c.y, { color: '#7dd3fc', r0: 24, r1: 76, width: 4, life: 420 });
  }

  function damageNumber(u, c, ev) {
    const multi = ev.hits > 1;
    const x = c.x + FX.rand(-16, 16) + (multi ? (ev.hit % 2 ? 26 : -26) : 0);
    const y = c.y - 24 - (multi ? ev.hit * 15 : 0);
    const tags = (ev.crit ? '<i class="tag">CRITICAL</i>' : '') +
      (ev.aff === 'adv' ? '<i class="aff up">▲ 우세</i>' : ev.aff === 'dis' ? '<i class="aff down">▼ 열세</i>' : '');
    const abs = ev.absorbed ? `<i class="abs">盾 ${fmt(ev.absorbed)} 흡수</i>` : '';
    FX.text(x, y, `${tags}<b>${fmt(ev.amount)}</b>${abs}`, `dmg${ev.crit ? ' crit' : ''}${u.side === 'ally' ? ' on-ally' : ''}`, ev.crit ? 1350 : 1050);
  }

  function die(u, v) {
    v.el.classList.add('dead');
    const c = centerOf(u.uid);
    const color = AFFLATUS[u.afflatus].color;
    if (u.side === 'enemy') {
      sfx('death');
      FX.burst(c.x, c.y, { count: 46, colors: [color, '#ffffff', '#fde68a'], speed: [1, 5], life: [700, 1400], size: [2, 5], gravity: -0.05, drag: 0.03 });
      FX.ring(c.x, c.y, { color, r1: c.h * 0.9, width: 5, life: 800 });
      v.sprite.animate(
        [{ opacity: 1, filter: 'brightness(1)', transform: 'none' }, { opacity: 0.9, filter: 'brightness(2.6) saturate(.4)', transform: 'scale(1.06)', offset: 0.3 }, { opacity: 0, filter: 'brightness(4) blur(8px)', transform: 'translateY(-30px) scale(1.15)' }],
        { duration: dur(1000), easing: 'ease-in', fill: 'forwards' }
      );
      if (u.boss) setTimeout(() => R.bossBar.classList.add('hidden'), dur(900));
    } else {
      sfx('allyDown');
      FX.text(c.x, c.y - 70, '전투 불능', 'down', 1400);
      FX.burst(c.x, c.y, { count: 24, colors: ['#94a3b8', '#e2e8f0'], speed: [0.5, 2.5], life: [700, 1200], size: [2, 4], gravity: -0.03 });
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
        if (ev.amount > 0) FX.text(c.x + FX.rand(-10, 10), c.y - 20, `+${fmt(ev.amount)}`, 'heal', 1000);
        FX.burst(c.x, c.y + c.h * 0.2, { kind: 'leaf', count: 12, colors: ['#86efac', '#4ade80', '#bbf7d0', '#fef9c3'], speed: [0.4, 1.8], angle: -90, spread: 120, gravity: -0.04, life: [700, 1200], size: [3, 5], blend: 'source-over' });
        FX.burst(c.x, c.y, { count: 10, colors: ['#bbf7d0', '#ffffff'], speed: [0.5, 2], angle: -90, spread: 90, life: [500, 900], size: [2, 4] });
        sfx('heal');
        break;
      case 'shield':
        setShield(v, u, ev.shield);
        FX.text(c.x + FX.rand(-10, 10), c.y - 44, `盾 +${fmt(ev.amount)}`, 'shield', 1000);
        FX.dom('shield-orb', c.x, c.y, 1000, '', { width: c.w * 1.25 + 'px', height: c.h * 1.05 + 'px' });
        sfx('shield');
        break;
      case 'status': {
        const d = STATUS[ev.id];
        renderStatuses(v, u);
        FX.text(c.x + FX.rand(-12, 12), c.y - c.h * 0.42, `${d.glyph} ${d.name}`, 'status ' + d.type, 1100).style.setProperty('--c', d.color);
        sfx(d.type === 'debuff' ? 'debuff' : 'buff');
        break;
      }
      case 'cleanse':
        renderStatuses(v, u);
        FX.text(c.x, c.y - c.h * 0.42, '정화', 'heal', 1000);
        FX.burst(c.x, c.y, { count: 16, colors: ['#ffffff', '#e0f2fe'], speed: [1, 3], life: [500, 800], size: [2, 4] });
        break;
      case 'expire':
        renderStatuses(v, u);
        setShield(v, u, battle.shieldOf(u));
        break;
      case 'moxie':
        renderMoxie(v, u, ev.value);
        if (u.side === 'ally' && ev.value >= RULES.moxieMax) FX.text(c.x, c.y - c.h * 0.55, '열정 MAX', 'moxie', 1100);
        break;
      case 'dot': {
        setHP(v, u, ev.hp);
        const d = STATUS[ev.id];
        FX.text(c.x + FX.rand(-14, 14), c.y - 10, `${d.glyph} ${fmt(ev.amount)}`, 'dot', 1000).style.setProperty('--c', d.color);
        FX.burst(c.x, c.y + c.h * 0.15, { count: 16, colors: ev.id === 'burn' ? ['#ffb347', '#ff6a00', '#ffd27a'] : ['#bef264', '#84cc16', '#d9f99d'], speed: [0.5, 2.5], angle: -90, spread: 80, gravity: -0.06, life: [500, 900], size: [2, 5] });
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

  /* ---------- 이동 모션 ---------- */
  const MOTION = {
    dash: (dx, dy, s) => ({ t: 230, back: 300, sfx: 'whoosh', go: [{ transform: 'none' }, { transform: `translate(${dx * 0.12}px, -8px) rotate(${6 * s}deg)`, offset: 0.25 }, { transform: `translate(${dx}px, ${dy}px) rotate(${-16 * s}deg)` }] }),
    leap: (dx, dy, s) => ({ t: 360, back: 340, sfx: 'whoosh', go: [{ transform: 'none' }, { transform: `translate(${dx * 0.5}px, ${dy - 120}px) rotate(${-25 * s}deg)`, offset: 0.55 }, { transform: `translate(${dx}px, ${dy - 14}px) rotate(${-50 * s}deg) scale(1.06)` }] }),
    hover: dx => ({ t: 320, back: 320, go: [{ transform: 'none' }, { transform: `translate(${dx * 0.28}px, -46px) scale(1.1)` }] }),
    ascend: () => ({ t: 360, back: 360, go: [{ transform: 'none' }, { transform: 'translateY(-80px) scale(1.12)' }] }),
    float: (dx, dy, s) => ({ t: 300, back: 300, go: [{ transform: 'none' }, { transform: `translate(${dx * 0.16}px, -38px) rotate(${-6 * s}deg)` }] }),
    ultAscend: () => ({ t: 480, back: 420, go: [{ transform: 'none' }, { transform: 'translateY(-130px) scale(1.3)' }] }),
    ultDash: (dx, dy, s) => ({ t: 170, back: 320, sfx: 'whoosh', go: [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy - 16}px) scale(1.2) rotate(${-24 * s}deg)` }] }),
    ultFloat: dx => ({ t: 450, back: 400, go: [{ transform: 'none' }, { transform: `translate(${dx * 0.2}px, -100px) scale(1.22)` }] }),
    lunge: (dx, dy) => ({ t: 260, back: 320, sfx: 'lunge', ease: 'cubic-bezier(.5,0,.2,1)', go: [{ transform: 'none' }, { transform: `translate(${-dx * 0.06}px, -10px) scale(.94)`, offset: 0.35 }, { transform: `translate(${dx}px, ${dy}px) scale(1.06)` }] }),
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
    const go = v.mover.animate(m.go, { duration: dur(m.t), easing: m.ease || 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    await go.finished;
    return async () => {
      const back = v.mover.animate([m.go[m.go.length - 1], { transform: 'none' }], { duration: dur(m.back), easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      await back.finished;
      go.cancel();
      back.cancel();
    };
  }

  /* ---------- 마법진 ---------- */
  function sigil(color) {
    const ticks = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const r1 = 44, r2 = i % 2 ? 47 : 49;
      return `M${50 + Math.cos(a) * r1} ${50 + Math.sin(a) * r1}L${50 + Math.cos(a) * r2} ${50 + Math.sin(a) * r2}`;
    }).join('');
    return `<svg viewBox="0 0 100 100" fill="none" stroke="${color}" stroke-width="1.2">
      <circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="40" stroke-dasharray="2 3"/><circle cx="50" cy="50" r="22"/>
      <path d="${ticks}"/>
      <path d="M50 10 L84.6 70 L15.4 70Z M50 90 L15.4 30 L84.6 30Z" stroke-width=".9"/>
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

  const sweepAcross = (targets, colors) => {
    const { w } = stageSize();
    targets.forEach(uid => {
      const c = centerOf(uid);
      FX.burst(c.x - 80, c.y + c.h * 0.2, { count: 40, colors, speed: [6, 14], angle: -15, spread: 40, life: [400, 800], size: [3, 8], gravity: 0.12, drag: 0.02, jitterY: c.h * 0.35, jitter: 30 });
    });
    FX.burst(w * 0.45, stageSize().h * 0.72, { count: 60, colors, speed: [8, 16], angle: -8, spread: 22, life: [600, 1000], size: [3, 9], gravity: 0.05, drag: 0.01, jitter: 40, jitterY: 60 });
  };

  const CHOREO = {
    /* ── 촛불 ── */
    async flame(res, cast) {
      const tgt = cast.targets[0];
      const back = await motion(cast.uid, 'hover', tgt);
      const from = centerOf(cast.uid, 'top');
      sfx('fireball');
      await FX.projectile(from, centerOf(tgt), { color: '#ffb347', trail: ['#ff6a00', '#ffd27a', '#ff3d00'], size: 13, duration: 320, arc: 46 });
      await runEvents(res.events, {
        onHit: ev => {
          const c = centerOf(ev.uid);
          sfx('flame');
          FX.flash('#ff7a1a', 240, 0.22);
          FX.burst(c.x, c.y, { count: 36, colors: PAL.fire, speed: [2, 7], life: [400, 900], size: [3, 7], gravity: -0.08, drag: 0.06 });
          FX.burst(c.x, c.y, { kind: 'spark', count: 16, colors: ['#ffd27a', '#fff'], speed: [4, 10], life: [200, 400], size: [1.5, 2.5], len: 2 });
          FX.ring(c.x, c.y, { color: '#ff9a2e', r1: c.h * 0.6, width: 8 });
        }
      });
      await back();
    },
    async bless(res, cast) {
      const back = await motion(cast.uid, 'ascend');
      const c = centerOf(cast.uid, 'top');
      sfx('holy');
      FX.flash('#fde68a', 320, 0.22);
      FX.burst(c.x, c.y, { count: 34, colors: PAL.holy, speed: [1, 4], life: [600, 1100], size: [2, 5] });
      FX.ring(c.x, c.y, { color: '#fde68a', r1: 150, width: 5, life: 700 });
      await wait(220);
      await runEvents(res.events, {
        gap: 110,
        before: ev => { if (ev.type === 'shield') { const t = centerOf(ev.uid); FX.beam(c.x, c.y, t.x, t.y, { color: '#fde68a', width: 4, life: 420 }); } }
      });
      await back();
    },
    async judgment(res, cast) {
      const back = await motion(cast.uid, 'ultAscend');
      const c = centerOf(cast.uid, 'top');
      const { w, h: sh } = stageSize();
      sfx('holy');
      FX.flash('#000000', 600, 0.55);
      FX.ring(c.x, c.y, { color: '#fde68a', r1: 220, width: 6, life: 900 });
      FX.dom('sigil', c.x, c.y, 1600, sigil('#fde68a'), { '--w': '260px' });
      await wait(420);
      cast.targets.forEach(uid => { const t = centerOf(uid, 'feet'); FX.pillar(t.x, t.y, { width: 80, height: t.y + 60, color: '#fde68a', life: 1000 }); });
      sfx('boom');
      FX.flash('#fff7d6', 420, 0.75);
      FX.shake(14, 650);
      FX.punch(w * 0.3, sh * 0.6, 1.05, 520);
      await runEvents(res.events, {
        gap: 90,
        onHit: ev => {
          const p = centerOf(ev.uid);
          FX.burst(p.x, p.y, { count: 30, colors: PAL.holy, speed: [2, 8], life: [500, 1000], size: [2, 6], gravity: -0.05 });
          FX.burst(p.x, p.y, { count: 18, colors: PAL.fire, speed: [1, 5], life: [600, 1100], size: [3, 6], gravity: -0.08 });
        },
        before: ev => { if (ev.type === 'shield') { const t = centerOf(ev.uid); FX.beam(c.x, c.y, t.x, t.y, { color: '#fde68a', width: 5, life: 420 }); } }
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
          FX.slash(c.x + c.w * 0.15, c.y, { angle: 195, arc: 150, radius: c.h * 0.5, width: 7, color: '#bae6fd', life: 400, dir: -1 });
          FX.burst(c.x, c.y, { kind: 'spark', count: 24, colors: PAL.steel, speed: [5, 12], life: [200, 450], size: [1.5, 3], len: 2.5, angle: 180, spread: 130 });
          FX.flash('#ffffff', 160, 0.18);
          await FX.hitstop(ev.crit ? 95 : 55);
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
          FX.slash(c.x, c.y, { angle: 225, arc: 70, radius: c.h * 0.55, width: 6, color: '#93c5fd', life: 420 });
          FX.slash(c.x, c.y, { angle: 135, arc: 70, radius: c.h * 0.55, width: 6, color: '#93c5fd', life: 420, dir: -1 });
          FX.burst(c.x, c.y, { kind: 'shard', count: 14, colors: ['#bfdbfe', '#e0f2fe', '#60a5fa'], speed: [3, 8], life: [400, 800], size: [4, 8], gravity: 0.2, blend: 'source-over', spin: 2 });
          FX.ring(c.x, c.y + c.h * 0.4, { color: '#93c5fd', r1: 90, width: 5, squash: 0.3 });
          await FX.hitstop(ev.crit ? 90 : 60);
        }
      });
      await back();
    },
    async barrage(res, cast) {
      const back = await motion(cast.uid, 'ultDash', cast.targets[0]);
      const angles = [200, 20, 150, 330, 250, 90];
      let k = 0;
      startCombo();
      await runEvents(res.events, {
        hitGap: 70,
        onHit: async ev => {
          const c = centerOf(ev.uid);
          const last = ev.hit === ev.hits - 1;
          sfx('slash');
          FX.slash(c.x, c.y, { angle: angles[k++ % angles.length], arc: last ? 240 : 130, radius: c.h * (last ? 0.62 : 0.42), width: last ? 12 : 6, color: last ? '#fde68a' : '#bae6fd', life: last ? 650 : 300, dir: k % 2 ? 1 : -1 });
          FX.burst(c.x, c.y, { kind: 'spark', count: last ? 44 : 14, colors: PAL.steel, speed: [5, 14], life: [200, 500], size: [1.5, 3], len: 2.5 });
          if (last) {
            FX.flash('#ffffff', 340, 0.85);
            FX.ring(c.x, c.y, { color: '#fde68a', r1: 200, width: 10, life: 700 });
            FX.punch(c.x, c.y, 1.12, 520);
            sfx('boom');
            await FX.hitstop(170);
          } else await FX.hitstop(35);
        }
      });
      await wait(260);
      hideCombo();
      await back();
    },

    /* ── 책갈피 ── */
    async ink(res, cast) {
      const tgt = cast.targets[0];
      const back = await motion(cast.uid, 'float', tgt);
      const from = centerOf(cast.uid, 'top');
      sfx('page');
      FX.glyphs(from.x, from.y, { chars: ['註', '文', '書'], count: 5, color: '#c4b5fd', speed: [0.5, 1.5] });
      const to = centerOf(tgt);
      await Promise.all([0, 1, 2].map(i => wait(i * 70).then(() => FX.projectile(from, { x: to.x + FX.rand(-15, 15), y: to.y + FX.rand(-15, 15) }, { color: '#a78bfa', trail: PAL.ink, size: 8, duration: 300, arc: 30 + i * 25 }))));
      await runEvents(res.events, {
        onHit: ev => {
          const c = centerOf(ev.uid);
          sfx('ink');
          FX.burst(c.x, c.y, { count: 30, colors: ['#4c1d95', '#6d28d9', '#1e1b4b'], speed: [2, 6], life: [500, 900], size: [3, 7], blend: 'source-over', gravity: 0.08 });
          FX.burst(c.x, c.y, { count: 14, colors: PAL.ink, speed: [1, 4], life: [500, 900], size: [2, 4] });
          FX.ring(c.x, c.y, { color: '#a78bfa', r1: c.h * 0.6, width: 6 });
          FX.glyphs(c.x, c.y, { chars: ['弱', '註'], count: 3, color: '#ddd6fe' });
        }
      });
      await back();
    },
    async mend(res, cast) {
      const back = await motion(cast.uid, 'float');
      const c = centerOf(cast.uid, 'top');
      sfx('page');
      FX.burst(c.x, c.y, { kind: 'leaf', count: 22, colors: PAL.leaf, speed: [1, 4], angle: -90, spread: 160, life: [800, 1300], size: [3, 6], blend: 'source-over', gravity: 0.02 });
      FX.ring(c.x, c.y, { color: '#86efac', r1: 120, width: 4, life: 700 });
      await wait(200);
      await runEvents(res.events, {
        gap: 90,
        before: ev => { if (ev.type === 'heal') { const t = centerOf(ev.uid); FX.beam(c.x, c.y, t.x, t.y, { color: '#86efac', width: 3, life: 380 }); } }
      });
      await back();
    },
    async lastpage(res, cast) {
      const tgt = cast.targets[0];
      const back = await motion(cast.uid, 'ultFloat', tgt);
      const t = centerOf(tgt, 'feet');
      const tc = centerOf(tgt);
      sfx('page');
      FX.dom('sigil jade', t.x, t.y - 4, 1700, sigil('#a7f3d0'), { '--w': tc.w * 2.4 + 'px' });
      FX.glyphs(tc.x, tc.y, { chars: ['終', '章', '書', '智'], count: 10, color: '#d9f99d', speed: [0.4, 1.4] });
      await wait(480);
      FX.pillar(t.x, t.y, { width: 96, height: t.y + 60, color: '#a7f3d0', life: 950 });
      sfx('boom');
      FX.flash('#ecfccb', 380, 0.6);
      FX.shake(12, 520);
      await runEvents(res.events, {
        gap: 80,
        onHit: ev => {
          const c = centerOf(ev.uid);
          FX.burst(c.x, c.y, { count: 40, colors: [...PAL.leaf, '#fde68a'], speed: [2, 9], life: [500, 1100], size: [2, 6] });
          FX.ring(c.x, c.y, { color: '#d9f99d', r1: c.h * 0.9, width: 8, life: 700 });
        }
      });
      await back();
    },

    /* ── 적 ── */
    async zap(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      await runEvents(res.events, {
        onHit: async ev => {
          const a = centerOf(cast.uid), c = centerOf(ev.uid);
          sfx('zap');
          FX.bolt(a.x, a.y, c.x, c.y, { color: '#fde68a', width: 2.4, life: 280 });
          FX.burst(c.x, c.y, { kind: 'spark', count: 16, colors: ['#fde68a', '#ffffff'], speed: [3, 8], life: [150, 350], size: [1, 2], len: 2 });
          await FX.hitstop(40);
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
          FX.burst(c.x, c.y, { count: 26, colors: PAL.venom, speed: [2, 6], life: [400, 800], size: [3, 6], gravity: 0.12, blend: 'source-over' });
          FX.bubbles(c.x, c.y, { count: 8, color: 'rgba(190,242,100,.8)' });
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
          FX.slash(c.x - c.w * 0.1, c.y, { angle: 345, arc: 140, radius: c.h * 0.48, width: 6, color: '#f0abfc', life: 380 });
          FX.burst(c.x, c.y, { count: 18, colors: PAL.violet, speed: [2, 7], life: [300, 600], size: [2, 4] });
          await FX.hitstop(45);
        }
      });
      await back();
    },
    async glow(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const c = centerOf(cast.uid);
      sfx('buff');
      FX.ring(c.x, c.y, { color: '#fde68a', r1: 160, width: 6, life: 700 });
      FX.flash('#fde68a', 260, 0.15);
      await runEvents(res.events, {
        before: ev => { if (ev.type === 'status') { const t = centerOf(ev.uid); FX.ring(t.x, t.y, { color: '#fca5a5', r1: t.h * 0.6, width: 4 }); FX.burst(t.x, t.y, { count: 12, colors: ['#fca5a5', '#fde68a'], speed: [1, 3], angle: -90, spread: 90, life: [500, 800] }); } }
      });
      await back();
    },
    async toxin(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      sfx('splash');
      FX.flash('#365314', 500, 0.35);
      cast.targets.forEach(uid => { const t = centerOf(uid); FX.burst(t.x, t.y - t.h * 0.8, { count: 26, colors: PAL.venom, speed: [1, 3], angle: 90, spread: 50, gravity: 0.25, life: [500, 900], size: [3, 6], blend: 'source-over', jitter: 40 }); });
      await wait(250);
      await runEvents(res.events, { onHit: ev => { const c = centerOf(ev.uid); FX.bubbles(c.x, c.y, { count: 10, color: 'rgba(190,242,100,.85)' }); } });
      await back();
    },
    async smash(res, cast) {
      const back = await motion(cast.uid, 'lunge', cast.targets[0]);
      await runEvents(res.events, {
        onHit: async ev => {
          const c = centerOf(ev.uid);
          sfx('splash');
          FX.ring(c.x, c.y + c.h * 0.4, { color: '#7dd3fc', r1: 140, width: 8, squash: 0.35, life: 600 });
          FX.burst(c.x, c.y + c.h * 0.3, { count: 40, colors: PAL.sea, speed: [3, 9], angle: -90, spread: 120, gravity: 0.3, life: [500, 900], size: [3, 7] });
          FX.shake(10, 380);
          await FX.hitstop(70);
        }
      });
      await back();
    },
    async tsunami(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      sfx('water');
      FX.flash('#0c4a6e', 500, 0.3);
      sweepAcross(cast.targets, PAL.sea);
      await wait(260);
      await runEvents(res.events, { onHit: () => FX.shake(6, 260) });
      await back();
    },
    async gaze(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const a = centerOf(cast.uid, 'top');
      const t = centerOf(cast.targets[0]);
      sfx('gaze');
      FX.beam(a.x, a.y, t.x, t.y, { color: '#e879f9', width: 7, life: 520 });
      FX.ring(a.x, a.y, { color: '#e879f9', r1: 60, width: 4 });
      await wait(200);
      await runEvents(res.events, { onHit: ev => { const c = centerOf(ev.uid); FX.burst(c.x, c.y, { count: 20, colors: ['#f0abfc', '#e879f9', '#ffffff'], speed: [1, 5], life: [400, 800] }); } });
      await back();
    },
    async summon(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const c = centerOf(cast.uid);
      sfx('bubbles');
      FX.ring(c.x, c.y, { color: '#c084fc', r1: 120, width: 4 });
      FX.bubbles(c.x, c.y, { count: 16, spread: 70 });
      await wait(300);
      await runEvents(res.events);
      await back();
    },
    async tide(res, cast) {
      const back = await motion(cast.uid, 'pulse');
      const { w, h: sh } = stageSize();
      FX.flash('#082f49', 700, 0.55);
      sfx('water');
      sweepAcross(cast.targets, PAL.sea);
      await wait(200);
      sweepAcross(cast.targets, ['#ffffff', '#bae6fd', '#38bdf8']);
      FX.shake(16, 800);
      FX.punch(w * 0.7, sh * 0.6, 1.04, 600);
      await wait(260);
      await runEvents(res.events, { onHit: () => FX.shake(8, 260) });
      await back();
    },
    async basic(res, cast) {
      const back = await motion(cast.uid, cast.targets.length === 1 ? 'lunge' : 'pulse', cast.targets[0]);
      await runEvents(res.events);
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
    FX.flash('#ffffff', 300, 0.9);
    FX.shake(10, 420);
    for (let i = 0; i < 22; i++) {
      const s = h('i');
      const size = FX.rand(10, 34);
      s.style.cssText = `left:${FX.rand(5, 95)}%;top:${FX.rand(30, 70)}%;width:${size}px;height:${size * 1.5}px;--tx:${FX.rand(-1, 1) * 420}px;--ty:${FX.rand(-1, 1) * 360}px;--rot:${FX.rand(-540, 540)}deg`;
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
    FX.flash('#b91c1c', 600, 0.45);
    FX.shake(14, 750);
    v.el.classList.add('enraged');
    const c = centerOf(ev.uid);
    FX.ring(c.x, c.y, { color: '#ef4444', r1: 240, width: 10, life: 900 });
    FX.burst(c.x, c.y, { count: 50, colors: PAL.blood, speed: [2, 7], life: [600, 1200], size: [2, 6], gravity: -0.04 });
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
    if (res.ults.length) setTimeout(() => sfx('ultReady'), 400);
    const threat = battle.aliveEnemies.find(e => e.intents.some(it => SKILLS[it.skillId].ult));
    if (threat) setTimeout(() => { sfx('warning'); toast(`${josa(threat.name, '이/가')} 최종 술식을 준비합니다! 보호막과 회복으로 대비하세요.`, 'danger'); }, 600);
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
      autoRunning = false;
      updateButtons();
    }
    if (go) executeTurn();
  }

  function toggleAuto() {
    if (!battle || busy && battle.phase !== 'executing' && battle.phase !== 'enemy') return;
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
    autoOn = false;
    updateButtons();
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
    stars.forEach((s, i) => { if (s.ok) setTimeout(() => sfx('star', { i }), 500 + i * 260); });
    setTimeout(() => sfx('stamp'), 1350);
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
  async function newGame() {
    gameToken += 1;
    const token = gameToken;
    $$('.overlay.show').forEach(closeModal);
    hideTip();
    views.clear();
    prevRanks.clear();
    R.units.innerHTML = '';
    R.hand.innerHTML = '';
    R.ghosts.innerHTML = '';
    R.bossBar.classList.add('hidden');
    R.callout.className = '';
    R.combo.className = '';
    R.banner.className = '';
    R.cutscene.className = '';
    document.body.classList.remove('executing');
    selectedUid = null;
    busy = true;
    autoRunning = false;
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
    gameToken += 1;
    battle = null;
    autoOn = false;
    $$('.overlay.show').forEach(closeModal);
    R.units.innerHTML = '';
    R.hand.innerHTML = '';
    views.clear();
    R.bossBar.classList.add('hidden');
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
      if (/^[1-9]$/.test(e.key)) {
        const card = battle.hand[Number(e.key) - 1];
        if (card) onCardTap(card.uid);
        return;
      }
      switch (e.key.toLowerCase()) {
        case ' ': case 'enter': e.preventDefault(); executeTurn(); break;
        case 'z': case 'backspace': e.preventDefault(); doUndo(); break;
        case 'r': doReset(); break;
        case 'tab': e.preventDefault(); cycleTarget(e.shiftKey ? -1 : 1); break;
        case 'a': toggleAuto(); break;
        case 's': R.speed.click(); break;
        case 'm': R.sound.click(); break;
        case 'i': openModal('enemy'); break;
        case 'h': case '?': openModal('help'); break;
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
      { canvas: $('#fx-canvas'), ambCanvas: $('#ambient-canvas'), shakeEl: R.shake, camEl: R.camera, flashEl: $('#flash'), floatEl: $('#float-layer'), domEl: $('#fx-dom') },
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
  window.__game = { get battle() { return battle; }, newGame, executeTurn, settings, refresh() { renderHand(); renderSlots(); renderAP(); syncAll(); updateButtons(); } };
})();
