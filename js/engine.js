/* =========================================================
 *  전투 엔진 — 화면과 분리된 순수 규칙
 *  모든 행동은 "이벤트 목록"을 돌려주고, 화면(game.js)은 그 이벤트를 연출합니다.
 *  브라우저(window.BattleEngine)와 Node(require) 양쪽에서 사용합니다.
 * ========================================================= */
(function (root, factory) {
  const data = (root && root.GameData) || (typeof require === 'function' ? require('./data.js') : null);
  const api = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BattleEngine = api;
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  const { RULES, AFFLATUS_BEATS, STATUS, CHARACTERS, PARTY, SKILLS, ENEMIES, WAVES } = D;

  // 등급별 배열이면 해당 등급 값을, 아니면 값 그대로
  const at = (v, r) => (Array.isArray(v) ? v[Math.min(r, v.length - 1)] : v);
  const isDebuff = id => STATUS[id] && STATUS[id].type === 'debuff';
  const DOT = new Set(['burn', 'poison']);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function afflatusMult(att, def) {
    if (AFFLATUS_BEATS[att] === def) return 1.3;
    if (AFFLATUS_BEATS[def] === att) return 0.8;
    return 1;
  }

  class Battle {
    constructor(opts = {}) {
      this.seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2147483647);
      this.rand = mulberry32(this.seed);
      this.seq = 0;
      this.turn = 1;
      this.waveIndex = -1;
      this.ap = RULES.maxAp;
      this.hand = [];
      this.queue = [];
      this.history = [];
      this.cursor = 0;
      this.enemySteps = [];
      this.enemyCursor = 0;
      this.targetUid = null;
      this.phase = 'idle';
      this.allies = PARTY.map((key, slot) => this.makeAlly(key, slot));
      this.enemies = [];
      this.stats = { damage: {}, healing: {}, shielded: {}, maxHit: 0, maxHitBy: null, merges: 0, ults: 0, taken: 0, deaths: 0 };
      PARTY.forEach(k => { this.stats.damage[k] = 0; this.stats.healing[k] = 0; this.stats.shielded[k] = 0; });
    }

    /* ---------- 기본 도우미 ---------- */
    uid(prefix) { return prefix + (++this.seq); }
    pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }
    weighted(items, weightOf) {
      const ws = items.map(weightOf);
      let r = this.rand() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
      return items[items.length - 1];
    }

    makeAlly(key, slot) {
      const c = CHARACTERS[key];
      return {
        uid: 'a_' + key, key, side: 'ally', slot, name: c.name, afflatus: c.afflatus,
        maxHp: c.hp, hp: c.hp, atk: c.atk, def: c.def, crit: c.crit, critDmg: c.critDmg,
        moxie: 0, hasMoxie: true, statuses: [], alive: true
      };
    }

    makeEnemy(key, slot) {
      const e = ENEMIES[key];
      return {
        uid: this.uid('e'), key, side: 'enemy', slot, name: e.name, afflatus: e.afflatus,
        maxHp: e.hp, hp: e.hp, atk: e.atk, def: e.def, crit: e.crit || 0.05, critDmg: 1.5,
        moxie: e.moxie ? e.startMoxie || 0 : 0, hasMoxie: !!e.moxie, boss: !!e.boss, phase: 1,
        statuses: [], alive: true, intents: []
      };
    }

    get aliveAllies() { return this.allies.filter(u => u.alive); }
    get aliveEnemies() { return this.enemies.filter(u => u.alive); }
    get hasNextWave() { return this.waveIndex + 1 < WAVES.length; }
    unit(uid) { return this.allies.find(u => u.uid === uid) || this.enemies.find(u => u.uid === uid) || null; }
    ally(key) { return this.allies.find(u => u.key === key); }

    has(u, id) { return u.statuses.some(s => s.id === id); }
    status(u, id) { return u.statuses.find(s => s.id === id); }
    shieldOf(u) { const s = this.status(u, 'shield'); return s ? s.value : 0; }
    outMult(u) {
      let m = 1;
      if (this.has(u, 'atkUp')) m *= 1.2;
      if (this.has(u, 'enrage')) m *= 1.3;
      if (this.has(u, 'weaken')) m *= 0.75;
      return m;
    }
    inMult(u) { return this.has(u, 'vuln') ? 1.25 : 1; }

    /* ---------- 라운드 ---------- */
    startWave(index) {
      this.waveIndex = index;
      const w = WAVES[index];
      this.enemies = w.enemies.map(e => this.makeEnemy(e.key, e.slot));
      this.targetUid = null;
      this.ensureTarget();
      return [{ type: 'wave', index, boss: !!w.boss }, ...this.enemies.map(u => ({ type: 'spawn', uid: u.uid }))];
    }

    defaultTarget() {
      const alive = this.aliveEnemies;
      return alive.find(u => u.uid === this.targetUid) || alive.slice().sort((a, b) => a.slot - b.slot)[0] || null;
    }
    ensureTarget() {
      const t = this.defaultTarget();
      this.targetUid = t ? t.uid : null;
      return this.targetUid;
    }
    setTarget(uid) {
      if (!this.aliveEnemies.some(e => e.uid === uid)) return false;
      this.targetUid = uid;
      return true;
    }

    /* ---------- 계획 단계 ---------- */
    beginPlanning() {
      this.phase = 'planning';
      this.ap = RULES.maxAp;
      this.queue = [];
      this.cursor = 0;
      this.history = [];
      this.ensureTarget();
      this.planIntents();
      return this.refillHand();
    }

    makeCard(skillId, rank = 1) {
      const s = SKILLS[skillId];
      return { uid: this.uid('c'), skillId, owner: s.owner, rank, isUlt: !!s.ult };
    }

    canMerge(a, b) {
      return !!a && !!b && a !== b && !a.isUlt && !b.isUlt && a.skillId === b.skillId && a.rank === b.rank && a.rank < 3;
    }

    // 손패에서 이웃한 같은 카드를 끝까지 합성합니다. 반환: [{ keep, gone }]
    settleMerges(grantMoxie) {
      const merges = [];
      let i = 0;
      while (i < this.hand.length - 1) {
        const a = this.hand[i], b = this.hand[i + 1];
        if (this.canMerge(a, b)) {
          a.rank += 1;
          this.hand.splice(i + 1, 1);
          merges.push({ keep: a.uid, gone: b.uid });
          if (grantMoxie) { this.gainMoxie(this.ally(a.owner), 1); this.stats.merges += 1; }
          i = Math.max(0, i - 1);
        } else i += 1;
      }
      return merges;
    }

    gainMoxie(u, n) {
      if (u && u.hasMoxie) u.moxie = Math.min(RULES.moxieMax, u.moxie + n);
    }

    // 열정이 가득 찬 아군의 최종 술식 카드를 손패 맨 왼쪽에 추가
    spawnUlts() {
      const spawned = [];
      for (const a of this.aliveAllies) {
        if (a.moxie < RULES.moxieMax) continue;
        const inHand = this.hand.some(c => c.isUlt && c.owner === a.key);
        const inQueue = this.queue.some(q => q.card.isUlt && q.card.owner === a.key);
        if (inHand || inQueue) continue;
        const card = this.makeCard(CHARACTERS[a.key].ult);
        this.hand.unshift(card);
        spawned.push(card.uid);
      }
      return spawned;
    }

    refillHand() {
      const alive = new Set(this.aliveAllies.map(a => a.key));
      this.hand = this.hand.filter(c => alive.has(c.owner));
      this.settleMerges(false);
      const ults = this.spawnUlts();
      const pool = [];
      this.aliveAllies.forEach(a => CHARACTERS[a.key].skills.forEach(s => pool.push(s)));
      let guard = 0;
      while (this.hand.length < RULES.handSize && pool.length && guard++ < 80) {
        this.hand.push(this.makeCard(this.pick(pool)));
        this.settleMerges(false);
      }
      return { ults };
    }

    snapshot() {
      return JSON.stringify({
        hand: this.hand, queue: this.queue, ap: this.ap, merges: this.stats.merges,
        moxie: this.allies.map(a => a.moxie)
      });
    }
    restore(snap) {
      const s = JSON.parse(snap);
      this.hand = s.hand;
      this.queue = s.queue;
      this.ap = s.ap;
      this.stats.merges = s.merges;
      this.allies.forEach((a, i) => { a.moxie = s.moxie[i]; });
    }
    get canUndo() { return this.phase === 'planning' && this.history.length > 0; }
    undo() {
      if (!this.canUndo) return false;
      this.restore(this.history.pop());
      return true;
    }
    resetPlanning() {
      if (!this.canUndo) return false;
      this.restore(this.history[0]);
      this.history = [];
      return true;
    }

    // 카드 사용: 행동 슬롯에 넣고, 빈자리 양옆이 같은 카드면 연쇄 합성(열정 +1)
    playCard(index) {
      if (this.phase !== 'planning' || this.ap <= 0) return null;
      const card = this.hand[index];
      if (!card) return null;
      this.history.push(this.snapshot());
      this.hand.splice(index, 1);
      const foe = SKILLS[card.skillId].targeting === 'foe';
      this.queue.push({ type: 'play', card, targetUid: foe ? this.targetUid : null });
      this.ap -= 1;
      const merges = this.settleMerges(true);
      const ults = this.spawnUlts();
      return { card, merges, ults };
    }

    // 카드 합성: from 카드를 to 카드에 겹쳐 등급 상승 (행동력 1, 열정 +1)
    mergeCards(from, to) {
      if (this.phase !== 'planning' || this.ap <= 0) return null;
      const a = this.hand[from], b = this.hand[to];
      if (from === to || !this.canMerge(a, b)) return null;
      this.history.push(this.snapshot());
      b.rank += 1;
      this.hand.splice(from, 1);
      this.queue.push({ type: 'merge', card: { ...b } });
      this.ap -= 1;
      this.gainMoxie(this.ally(b.owner), 1);
      this.stats.merges += 1;
      const merges = [{ keep: b.uid, gone: a.uid }, ...this.settleMerges(true)];
      const ults = this.spawnUlts();
      return { card: b, merges, ults };
    }

    /* ---------- 적의 의도 ---------- */
    planIntents() {
      for (const e of this.aliveEnemies) {
        const def = ENEMIES[e.key];
        e.intents = [];
        for (let i = 0; i < def.actions; i++) {
          const skillId = i === 0 && def.ult && e.moxie >= RULES.moxieMax ? def.ult : this.chooseEnemySkill(e);
          e.intents.push({ skillId, targetUid: this.chooseEnemyTarget(SKILLS[skillId]) });
        }
      }
    }

    chooseEnemySkill(e) {
      const def = ENEMIES[e.key];
      const pendingSummons = this.aliveEnemies.reduce((n, u) => n + u.intents.filter(it => SKILLS[it.skillId].summon).length, 0);
      const options = def.skills.filter(id => {
        const s = SKILLS[id];
        if (s.summon) {
          const minions = this.aliveEnemies.filter(u => !u.boss).length + pendingSummons;
          return minions < (s.maxMinions || RULES.maxEnemies - 1) && this.aliveEnemies.length + pendingSummons < RULES.maxEnemies;
        }
        if (s.intent === 'buff') return !(s.apply || []).every(a => this.has(e, a.id)) && !e.intents.some(it => it.skillId === id);
        return true;
      });
      return this.weighted(options, id => SKILLS[id].weight || 1);
    }

    chooseEnemyTarget(skill) {
      if (skill.targeting !== 'foe') return null;
      const t = this.weighted(this.aliveAllies, a => 1 + 2 * (1 - a.hp / a.maxHp));
      return t ? t.uid : null;
    }

    /* ---------- 실행 단계 ---------- */
    beginExecution() {
      this.phase = 'executing';
      this.cursor = 0;
      this.history = [];
    }

    resolveNext() {
      const item = this.queue[this.cursor];
      if (!item) return null;
      this.cursor += 1;
      if (item.type === 'merge') return { item, events: [{ type: 'pass' }] };
      const caster = this.ally(item.card.owner);
      const skill = SKILLS[item.card.skillId];
      if (!caster.alive) return { item, caster, events: [{ type: 'fizzle', uid: caster.uid }] };
      const events = this.useSkill(caster, skill, item.card.rank - 1, item.targetUid);
      if (skill.ult) { caster.moxie = 0; this.stats.ults += 1; } else this.gainMoxie(caster, 1);
      events.push({ type: 'moxie', uid: caster.uid, value: caster.moxie });
      return { item, caster, skill, rank: item.card.rank, events };
    }

    beginEnemyPhase() {
      this.phase = 'enemy';
      const alive = this.aliveEnemies.slice().sort((a, b) => a.slot - b.slot);
      const maxN = Math.max(0, ...alive.map(e => e.intents.length));
      this.enemySteps = [];
      for (let i = 0; i < maxN; i++) alive.forEach(e => { if (e.intents[i]) this.enemySteps.push({ uid: e.uid, i }); });
      this.enemyCursor = 0;
    }

    resolveEnemyNext() {
      while (this.enemyCursor < this.enemySteps.length) {
        const step = this.enemySteps[this.enemyCursor++];
        const e = this.unit(step.uid);
        if (!e || !e.alive || !e.intents[step.i]) continue;
        const intent = e.intents[step.i];
        const skill = SKILLS[intent.skillId];
        const events = this.useSkill(e, skill, 0, intent.targetUid);
        if (e.hasMoxie && e.alive) {
          e.moxie = skill.ult ? 0 : Math.min(RULES.moxieMax, e.moxie + 1);
          events.push({ type: 'moxie', uid: e.uid, value: e.moxie });
        }
        return { caster: e, skill, rank: 1, intentIndex: step.i, events };
      }
      return null;
    }

    useSkill(caster, skill, r, targetUid) {
      const events = [];
      const foes = caster.side === 'ally' ? this.aliveEnemies : this.aliveAllies;
      const friends = caster.side === 'ally' ? this.aliveAllies : this.aliveEnemies;
      let targets = [];
      if (skill.targeting === 'foe') {
        const t = foes.find(u => u.uid === targetUid) || (caster.side === 'ally' ? this.defaultTarget() : this.pick(foes));
        if (t) targets = [t];
      } else if (skill.targeting === 'foes') targets = foes;
      else if (skill.targeting === 'allies') targets = friends;
      else if (skill.targeting === 'self') targets = [caster];
      events.push({ type: 'cast', uid: caster.uid, skill: skill.id, rank: r + 1, targets: targets.map(t => t.uid) });

      if (skill.rate) {
        const hits = skill.hits || 1;
        for (let h = 0; h < hits; h++) {
          for (const t of targets) {
            if (!t.alive) continue;
            events.push(this.dealDamage(caster, t, at(skill.rate, r), {
              critBonus: skill.critBonus || 0, forceCrit: !!skill.finalCrit && h === hits - 1, hit: h, hits
            }));
            const ph = this.checkPhase(t);
            if (ph) events.push(ph);
          }
        }
      }

      const group = to => (to === 'allies' ? friends.filter(u => u.alive) : to === 'self' ? [caster] : targets.filter(u => u.alive));
      (skill.apply || []).forEach(spec => group(spec.to).forEach(t => events.push(this.applyStatus(caster, t, spec, r))));
      if (skill.heal) {
        group(skill.heal.to).forEach(t => {
          const amount = skill.heal.maxHp ? t.maxHp * skill.heal.maxHp : caster.atk * at(skill.heal.atk, r) / 100;
          events.push(this.heal(caster, t, amount));
        });
      }
      if (skill.shield) {
        group(skill.shield.to).forEach(t => events.push(this.addShield(caster, t, caster.atk * at(skill.shield.atk, r) / 100, skill.shield.turns || 2)));
      }
      if (skill.cleanse) group(skill.cleanse).forEach(t => { const ev = this.cleanse(t); if (ev) events.push(ev); });
      if (skill.summon) { const ev = this.summon(skill.summon); if (ev) events.push(ev); }
      return events;
    }

    dealDamage(src, tgt, rate, opt) {
      const aff = afflatusMult(src.afflatus, tgt.afflatus);
      const crit = opt.forceCrit || this.rand() < src.crit + opt.critBonus;
      const variance = 0.95 + this.rand() * 0.1;
      const raw = src.atk * rate / 100 * this.outMult(src) * this.inMult(tgt) * aff * (crit ? src.critDmg : 1) * variance * (300 / (300 + tgt.def));
      const amount = Math.max(1, Math.round(raw));
      const absorbed = this.absorb(tgt, amount);
      tgt.hp = Math.max(0, tgt.hp - (amount - absorbed));
      if (src.side === 'ally') {
        this.stats.damage[src.key] += amount;
        if (amount > this.stats.maxHit) { this.stats.maxHit = amount; this.stats.maxHitBy = src.key; }
      } else this.stats.taken += amount - absorbed;
      const ev = {
        type: 'hit', src: src.uid, uid: tgt.uid, amount, absorbed, crit,
        aff: aff > 1 ? 'adv' : aff < 1 ? 'dis' : null, hp: tgt.hp, shield: this.shieldOf(tgt),
        hit: opt.hit, hits: opt.hits
      };
      if (tgt.hp <= 0) { this.kill(tgt); ev.killed = true; }
      return ev;
    }

    absorb(u, amount) {
      const s = this.status(u, 'shield');
      if (!s) return 0;
      const absorbed = Math.min(s.value, amount);
      s.value -= absorbed;
      if (s.value <= 0) u.statuses = u.statuses.filter(x => x !== s);
      return absorbed;
    }

    kill(u) {
      u.hp = 0;
      u.alive = false;
      u.statuses = [];
      if (u.intents) u.intents = [];
      if (u.side === 'ally') this.stats.deaths += 1;
    }

    heal(src, tgt, amount) {
      const gained = Math.min(tgt.maxHp - tgt.hp, Math.round(amount));
      tgt.hp += gained;
      if (src.side === 'ally') this.stats.healing[src.key] += gained;
      return { type: 'heal', src: src.uid, uid: tgt.uid, amount: gained, hp: tgt.hp };
    }

    addShield(src, tgt, value, turns) {
      const amount = Math.round(value);
      let s = this.status(tgt, 'shield');
      if (!s) { s = { id: 'shield', turns: 0, value: 0 }; tgt.statuses.push(s); }
      s.value = Math.min(Math.round(tgt.maxHp * RULES.shieldCap), s.value + amount);
      s.turns = Math.max(s.turns, turns);
      if (src.side === 'ally') this.stats.shielded[src.key] += amount;
      return { type: 'shield', src: src.uid, uid: tgt.uid, amount, shield: s.value };
    }

    applyStatus(src, tgt, spec, r) {
      const turns = at(spec.turns, r);
      const value = spec.power ? Math.round(src.atk * at(spec.power, r)) : 0;
      let s = this.status(tgt, spec.id);
      if (s) { s.turns = Math.max(s.turns, turns); s.value = Math.max(s.value, value); }
      else { s = { id: spec.id, turns, value, src: src.side === 'ally' ? src.key : null }; tgt.statuses.push(s); }
      return { type: 'status', src: src.uid, uid: tgt.uid, id: spec.id, turns: s.turns };
    }

    cleanse(tgt) {
      const before = tgt.statuses.length;
      tgt.statuses = tgt.statuses.filter(s => !isDebuff(s.id));
      return before !== tgt.statuses.length ? { type: 'cleanse', uid: tgt.uid } : null;
    }

    summon(key) {
      if (this.aliveEnemies.length >= RULES.maxEnemies) return null;
      const used = new Set(this.aliveEnemies.map(u => u.slot));
      const slot = [0, 2, 1].find(s => !used.has(s));
      if (slot === undefined) return null;
      const u = this.makeEnemy(key, slot);
      this.enemies.push(u);
      return { type: 'summon', uid: u.uid };
    }

    // 보스 2페이즈: 체력이 기준 이하로 떨어지면 격노
    checkPhase(u) {
      if (!u.boss || !u.alive || u.phase !== 1) return null;
      const def = ENEMIES[u.key];
      if (!def.phase2 || u.hp > u.maxHp * def.phase2) return null;
      u.phase = 2;
      u.statuses = u.statuses.filter(s => !isDebuff(s.id));
      u.statuses.push({ id: 'enrage', turns: 0, value: 0, permanent: true });
      u.moxie = Math.min(RULES.moxieMax, u.moxie + 2);
      return { type: 'phase', uid: u.uid, moxie: u.moxie };
    }

    // 턴 종료: 지속 피해 → 효과 지속 시간 감소 → 다음 턴
    endRound() {
      const events = [];
      const units = () => [...this.aliveAllies, ...this.aliveEnemies];
      for (const u of units()) {
        for (const s of u.statuses.slice()) {
          if (!u.alive || !DOT.has(s.id)) continue;
          const amount = Math.min(u.hp, s.value);
          u.hp -= amount;
          if (u.side === 'enemy' && s.src) this.stats.damage[s.src] += amount;
          if (u.side === 'ally') this.stats.taken += amount;
          const ev = { type: 'dot', uid: u.uid, id: s.id, amount, hp: u.hp };
          if (u.hp <= 0) { this.kill(u); ev.killed = true; }
          events.push(ev);
          const ph = this.checkPhase(u);
          if (ph) events.push(ph);
        }
      }
      for (const u of units()) {
        const expired = [];
        u.statuses = u.statuses.filter(s => {
          if (s.permanent) return true;
          s.turns -= 1;
          if (s.turns <= 0) { expired.push(s.id); return false; }
          return true;
        });
        expired.forEach(id => events.push({ type: 'expire', uid: u.uid, id }));
      }
      this.enemies.forEach(e => { e.intents = []; });
      this.turn += 1;
      this.phase = 'idle';
      return events;
    }

    // 라운드가 중간에 끝나면 아직 실행되지 않은 카드를 손패로 되돌립니다.
    returnUnplayed() {
      const rest = this.queue.slice(this.cursor).filter(q => q.type === 'play' && !this.hand.some(c => c.uid === q.card.uid));
      rest.forEach(q => this.hand.push(q.card));
      this.queue = this.queue.slice(0, this.cursor);
      return rest.map(q => q.card.uid);
    }

    outcome() {
      if (!this.aliveAllies.length) return 'defeat';
      if (!this.aliveEnemies.length) return this.hasNextWave ? 'waveClear' : 'victory';
      return null;
    }
  }

  /* =========================================================
   *  자동 전투 AI — 현재 상황에서 가장 점수가 높은 행동 하나를 고릅니다.
   * ========================================================= */
  function estimateIncoming(b) {
    const allies = b.aliveAllies;
    if (!allies.length) return 0;
    let single = 0, aoe = 0;
    for (const e of b.aliveEnemies) {
      for (const it of e.intents) {
        const s = SKILLS[it.skillId];
        if (!s.rate) continue;
        const dmg = e.atk * at(s.rate, 0) / 100 * b.outMult(e) * 0.85;
        if (s.targeting === 'foes') aoe += dmg; else single += dmg;
      }
    }
    return single / allies.length + aoe;
  }

  function pickTarget(b, caster) {
    let best = null, bestScore = -Infinity;
    for (const t of b.aliveEnemies) {
      const score = afflatusMult(caster.afflatus, t.afflatus) * (1.6 - t.hp / t.maxHp) + (t.intents.some(it => SKILLS[it.skillId].ult) ? 0.25 : 0);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  function autoChoice(b) {
    if (b.phase !== 'planning' || b.ap <= 0 || !b.hand.length || !b.aliveEnemies.length) return null;
    const allies = b.aliveAllies;
    const incoming = estimateIncoming(b);
    const queuedSkills = b.queue.filter(q => q.type === 'play').map(q => SKILLS[q.card.skillId]);
    const healQueued = queuedSkills.some(s => s.heal);
    const shieldQueued = queuedSkills.some(s => s.shield);
    let best = null;
    const consider = (score, choice) => { if (!best || score > best.score) best = Object.assign({ score }, choice); };

    b.hand.forEach((card, index) => {
      const s = SKILLS[card.skillId];
      const r = card.rank - 1;
      const caster = b.ally(card.owner);
      let score = 0;
      let target = null;
      if (s.rate) {
        if (s.targeting === 'foe') target = pickTarget(b, caster);
        const list = s.targeting === 'foes' ? b.aliveEnemies : [target];
        for (const t of list) {
          const dmg = caster.atk * at(s.rate, r) * (s.hits || 1) / 100 * afflatusMult(caster.afflatus, t.afflatus) * b.inMult(t) * 300 / (300 + t.def);
          score += Math.min(dmg, t.hp * 1.1) + (dmg >= t.hp ? 120 : 0);
        }
      }
      if (s.heal) {
        score += allies.reduce((sum, a) => {
          const amount = s.heal.maxHp ? a.maxHp * s.heal.maxHp : caster.atk * at(s.heal.atk, r) / 100;
          return sum + Math.min(a.maxHp - a.hp + incoming * 0.5, amount);
        }, 0) * (healQueued ? 0.4 : 0.9);
      }
      if (s.shield) {
        const v = caster.atk * at(s.shield.atk, r) / 100;
        score += allies.length * Math.min(v, incoming) * (shieldQueued ? 0.3 : 0.9);
      }
      for (const spec of s.apply || []) {
        if (spec.id === 'burn') score += caster.atk * at(spec.power, r) * at(spec.turns, r) * (s.targeting === 'foes' ? b.aliveEnemies.length : 1);
        if (spec.id === 'vuln') score += 90;
        if (spec.id === 'weaken') score += incoming * 0.4;
      }
      if (s.cleanse && allies.some(a => a.statuses.some(st => isDebuff(st.id)))) score += 120;
      if (s.ult) score += 150;
      if (b.canMerge(b.hand[index - 1], b.hand[index + 1])) score += 110;
      consider(score, { type: 'play', index, target: target && target.uid });
    });

    if (b.ap >= 2) {
      for (let i = 0; i < b.hand.length; i++) {
        for (let j = 0; j < b.hand.length; j++) {
          if (!b.canMerge(b.hand[i], b.hand[j])) continue;
          const owner = b.ally(b.hand[j].owner);
          consider(140 + (owner.moxie === RULES.moxieMax - 1 ? 80 : 0), { type: 'merge', from: i, to: j });
        }
      }
    }
    return best;
  }

  return { Battle, afflatusMult, autoChoice, at, isDebuff, mulberry32 };
});
