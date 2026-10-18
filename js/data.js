/* =========================================================
 *  전투 데이터 — 영감(상성) · 상태 효과 · 캐릭터 · 스킬 · 적 · 라운드
 *  브라우저(window.GameData)와 Node(require) 양쪽에서 사용합니다.
 * ========================================================= */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.GameData = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULES = {
    maxAp: 3,        // 한 턴에 사용할 수 있는 행동 수
    handSize: 7,     // 손패 최대 장수
    maxTurn: 20,     // 제한 턴
    moxieMax: 5,     // 열정 최대치 (가득 차면 최종 술식)
    maxEnemies: 3,
    shieldCap: 0.5   // 보호막 최대치 (최대 체력 대비)
  };

  /* ---------- 영감(Afflatus) 상성 ---------- */
  const AFFLATUS = {
    beast:     { name: '야수', glyph: '獸', color: '#f87171' },
    plant:     { name: '식물', glyph: '木', color: '#4ade80' },
    star:      { name: '항성', glyph: '星', color: '#60a5fa' },
    mineral:   { name: '암석', glyph: '岩', color: '#e0a458' },
    spirit:    { name: '영혼', glyph: '靈', color: '#c084fc' },
    intellect: { name: '지능', glyph: '智', color: '#fde047' }
  };
  // 공격자 → 우위를 점하는 대상 (영혼 ↔ 지능은 서로 우위)
  const AFFLATUS_BEATS = {
    beast: 'plant', plant: 'star', star: 'mineral', mineral: 'beast',
    spirit: 'intellect', intellect: 'spirit'
  };

  /* ---------- 상태 효과 ---------- */
  const STATUS = {
    burn:   { name: '화상',     glyph: '炎', type: 'debuff', color: '#fb923c', desc: s => `턴 종료 시 ${s.value} 피해` },
    poison: { name: '중독',     glyph: '毒', type: 'debuff', color: '#a3e635', desc: s => `턴 종료 시 ${s.value} 피해` },
    vuln:   { name: '취약',     glyph: '破', type: 'debuff', color: '#f472b6', desc: () => '받는 피해 25% 증가' },
    weaken: { name: '약화',     glyph: '弱', type: 'debuff', color: '#94a3b8', desc: () => '주는 피해 25% 감소' },
    shield: { name: '보호막',   glyph: '盾', type: 'buff',   color: '#7dd3fc', desc: s => `피해 ${s.value} 흡수` },
    atkUp:  { name: '공격 강화', glyph: '攻', type: 'buff',   color: '#fca5a5', desc: () => '주는 피해 20% 증가' },
    enrage: { name: '격노',     glyph: '怒', type: 'buff',   color: '#ef4444', desc: () => '주는 피해 30% 증가 · 해제 불가' }
  };

  const KIND_LABEL = { attack: '공격', buff: '강화', debuff: '약화', heal: '치유', ult: '최종' };
  const INTENT_LABEL = { attack: '단일 공격', aoe: '전체 공격', debuff: '약화 공격', buff: '강화', summon: '소환', ult: '최종 술식' };

  /* ---------- 아군 ---------- */
  const CHARACTERS = {
    sword: {
      name: '칼', title: '이름 없는 검객', role: '딜러', afflatus: 'star',
      hp: 1320, atk: 150, def: 42, crit: 0.2, critDmg: 1.7,
      color: '#7cb4ff', sprite: 'sword', size: 1, ar: 0.62,
      skills: ['s_slash', 's_trail'], ult: 'u_sword',
      quote: '한 번 뽑은 칼은, 반드시 벤다.'
    },
    candle: {
      name: '촛불', title: '밤을 지키는 등불', role: '서포터', afflatus: 'mineral',
      hp: 1650, atk: 105, def: 62, crit: 0.08, critDmg: 1.5,
      color: '#f5a524', sprite: 'candle', size: 1, ar: 0.7,
      skills: ['c_flame', 'c_bless'], ult: 'u_candle',
      quote: '어둠이 깊을수록, 불꽃은 선명해지는 법이죠.'
    },
    bookmark: {
      name: '책갈피', title: '잊힌 장의 수호자', role: '치유사', afflatus: 'intellect',
      hp: 1450, atk: 112, def: 50, crit: 0.1, critDmg: 1.5,
      color: '#34d399', sprite: 'book', size: 1, ar: 0.82,
      skills: ['b_note', 'b_mend'], ult: 'u_book',
      quote: '이야기는, 아직 끝나지 않았어요.'
    }
  };
  // 배치 순서 (0번이 적과 가장 가까운 전열)
  const PARTY = ['sword', 'candle', 'bookmark'];

  const pct = v => Math.round(v * 100);

  /* ---------- 스킬 ----------
   * targeting: foe(적 하나) · foes(적 전체) · allies(자기 편 전체) · self
   * rate: 등급(★1~3)별 공격력 대비 피해 배율(%) / hits: 타수
   * apply: 상태 효과 [{ id, turns, power(지속 피해 계수), to }]
   * heal / shield: { atk: 공격력 대비 % | maxHp: 최대 체력 비율, to }
   */
  const SKILLS = {
    /* ── 칼 ── */
    s_slash: {
      owner: 'sword', name: '쾌검일섬', glyph: '⚔️', kind: 'attack', targeting: 'foe',
      rate: [190, 285, 475], critBonus: 0.25, vfx: 'slash', motion: 'dash',
      desc: (s, r) => `순식간에 돌진해 적 하나에게 ${s.rate[r]}% 현실 피해. 이 공격의 치명타 확률 +25%.`
    },
    s_trail: {
      owner: 'sword', name: '칼날의 궤적', glyph: '🗡️', kind: 'debuff', targeting: 'foe',
      rate: [140, 210, 350], apply: [{ id: 'vuln', turns: [2, 2, 3] }], vfx: 'pierce', motion: 'leap',
      desc: (s, r) => `도약 후 내리꽂아 ${s.rate[r]}% 현실 피해를 주고 ${s.apply[0].turns[r]}턴간 [취약](받는 피해 +25%)을 겁니다.`
    },
    u_sword: {
      owner: 'sword', ult: true, name: '무형의 연격', en: 'FORMLESS BARRAGE', glyph: '⚡', kind: 'ult', targeting: 'foe',
      rate: [125], hits: 6, finalCrit: true, vfx: 'barrage', motion: 'ultDash',
      desc: s => `적 하나를 ${s.hits}번 연속으로 베어 각 ${s.rate[0]}% 현실 피해. 마지막 일격은 반드시 치명타.`
    },

    /* ── 촛불 ── */
    c_flame: {
      owner: 'candle', name: '정화의 불꽃', glyph: '🔥', kind: 'attack', targeting: 'foe',
      rate: [160, 240, 400], apply: [{ id: 'burn', turns: 2, power: [0.4, 0.55, 0.8] }], vfx: 'flame', motion: 'hover',
      desc: (s, r) => `적 하나에게 ${s.rate[r]}% 현실 피해를 주고 2턴간 [화상](턴마다 공격력의 ${pct(s.apply[0].power[r])}%)을 겁니다.`
    },
    c_bless: {
      owner: 'candle', name: '등불의 가호', glyph: '✨', kind: 'buff', targeting: 'allies',
      shield: { atk: [140, 210, 350], turns: 2 }, vfx: 'bless', motion: 'ascend',
      desc: (s, r) => `아군 전체에게 2턴간 공격력의 ${s.shield.atk[r]}%만큼 피해를 흡수하는 [보호막]을 씌웁니다.`
    },
    u_candle: {
      owner: 'candle', ult: true, name: '규율과 심판', en: 'DISCIPLINE & JUDGMENT', glyph: '⚖️', kind: 'ult', targeting: 'foes',
      rate: [340], apply: [{ id: 'burn', turns: 3, power: 0.6 }], shield: { to: 'allies', atk: [200], turns: 2 },
      vfx: 'judgment', motion: 'ultAscend',
      desc: s => `적 전체에게 ${s.rate[0]}% 현실 피해와 3턴간 [화상]. 아군 전체에게 공격력의 ${s.shield.atk[0]}% [보호막].`
    },

    /* ── 책갈피 ── */
    b_note: {
      owner: 'bookmark', name: '각주의 속삭임', glyph: '📜', kind: 'debuff', targeting: 'foe',
      rate: [150, 225, 375], apply: [{ id: 'weaken', turns: 2 }], vfx: 'ink', motion: 'float',
      desc: (s, r) => `적 하나에게 ${s.rate[r]}% 정신 피해를 주고 2턴간 [약화](주는 피해 -25%)를 겁니다.`
    },
    b_mend: {
      owner: 'bookmark', name: '별책부록', glyph: '🍃', kind: 'heal', targeting: 'allies',
      heal: { atk: [150, 225, 375] }, vfx: 'mend', motion: 'float',
      desc: (s, r) => `아군 전체의 체력을 공격력의 ${s.heal.atk[r]}%만큼 회복합니다.`
    },
    u_book: {
      owner: 'bookmark', ult: true, name: '마지막 장', en: 'THE LAST CHAPTER', glyph: '🔖', kind: 'ult', targeting: 'foe',
      rate: [420], heal: { to: 'allies', maxHp: 0.25 }, cleanse: 'allies', vfx: 'lastpage', motion: 'ultFloat',
      desc: s => `적 하나에게 ${s.rate[0]}% 정신 피해. 아군 전체의 최대 체력 25%를 회복하고 해로운 효과를 모두 해제합니다.`
    },

    /* ── 적: 작은 해파리 ── */
    e_sting: {
      name: '전기 쏘기', intent: 'attack', targeting: 'foe', rate: [100], weight: 3, vfx: 'zap',
      desc: s => `대상에게 ${s.rate[0]}% 피해.`
    },
    e_venom: {
      name: '마비독', intent: 'debuff', targeting: 'foe', rate: [55], weight: 2, vfx: 'venom',
      apply: [{ id: 'poison', turns: 2, power: 0.6 }],
      desc: s => `대상에게 ${s.rate[0]}% 피해를 주고 2턴간 [중독].`
    },
    /* ── 적: 해파리 ── */
    e_whip: {
      name: '촉수 채찍', intent: 'attack', targeting: 'foe', rate: [130], weight: 3, vfx: 'whip',
      desc: s => `대상에게 ${s.rate[0]}% 피해.`
    },
    e_glow: {
      name: '발광 신호', intent: 'buff', targeting: 'allies', weight: 1.4, vfx: 'glow',
      apply: [{ id: 'atkUp', turns: 2 }],
      desc: () => '적 전체의 주는 피해가 2턴간 20% 증가.'
    },
    e_jult: {
      name: '심해의 독', en: 'ABYSSAL TOXIN', ult: true, intent: 'ult', targeting: 'foes', rate: [115], vfx: 'toxin',
      apply: [{ id: 'poison', turns: 2, power: 0.6 }],
      desc: s => `[최종 술식] 아군 전체에게 ${s.rate[0]}% 피해와 2턴간 [중독].`
    },
    /* ── 적: 만조의 여왕 ── */
    q_smash: {
      name: '조류 강타', intent: 'attack', targeting: 'foe', rate: [150], weight: 3, vfx: 'smash',
      desc: s => `대상에게 ${s.rate[0]}% 피해.`
    },
    q_wave: {
      name: '해일', intent: 'aoe', targeting: 'foes', rate: [70], weight: 2.2, vfx: 'tsunami',
      desc: s => `아군 전체에게 ${s.rate[0]}% 피해.`
    },
    q_gaze: {
      name: '심연의 응시', intent: 'debuff', targeting: 'foe', rate: [60], weight: 1.8, vfx: 'gaze',
      apply: [{ id: 'vuln', turns: 2 }],
      desc: s => `대상에게 ${s.rate[0]}% 피해를 주고 2턴간 [취약].`
    },
    q_summon: {
      name: '권속 소환', intent: 'summon', targeting: 'self', summon: 'minijelly', maxMinions: 1, weight: 1.2, vfx: 'summon',
      desc: () => '작은 해파리 한 마리를 불러냅니다.'
    },
    q_ult: {
      name: '만조', en: 'HIGH TIDE', ult: true, intent: 'ult', targeting: 'foes', rate: [190], vfx: 'tide',
      desc: s => `[최종 술식] 거대한 해일로 아군 전체에게 ${s.rate[0]}% 피해.`
    }
  };
  Object.keys(SKILLS).forEach(id => { SKILLS[id].id = id; });

  /* ---------- 적 ---------- */
  const ENEMIES = {
    minijelly: {
      name: '작은 해파리', afflatus: 'mineral', hp: 650, atk: 155, def: 30, actions: 1,
      skills: ['e_sting', 'e_venom'], sprite: 'minijelly', size: 0.66, ar: 0.8,
      lore: '물가에 떠밀려 온 어린 해파리. 약하지만 독침이 성가십니다.'
    },
    jelly: {
      name: '해파리', afflatus: 'spirit', hp: 1600, atk: 240, def: 45, actions: 1,
      moxie: true, startMoxie: 1, skills: ['e_whip', 'e_glow'], ult: 'e_jult',
      sprite: 'jelly', size: 0.95, ar: 0.8,
      lore: '빛으로 무리를 이끄는 해파리. 열정이 차오르면 맹독을 퍼뜨립니다.'
    },
    queen: {
      name: '만조의 여왕', title: '심해의 군주', afflatus: 'beast', hp: 4000, atk: 420, def: 60, actions: 2,
      moxie: true, startMoxie: 0, boss: true, phase2: 0.5,
      skills: ['q_smash', 'q_wave', 'q_gaze', 'q_summon'], ult: 'q_ult',
      sprite: 'queen', size: 1.45, ar: 0.8,
      lore: '밀물과 함께 깨어난 심해의 군주. 체력이 절반 아래로 떨어지면 [격노]합니다.'
    }
  };

  /* ---------- 라운드 ---------- */
  const WAVES = [
    { name: '얕은 물가', en: 'SHALLOW SHORE', enemies: [{ key: 'minijelly', slot: 0 }, { key: 'jelly', slot: 1 }, { key: 'minijelly', slot: 2 }] },
    { name: '만조의 옥좌', en: 'THRONE OF HIGH TIDE', boss: true, enemies: [{ key: 'queen', slot: 1 }] }
  ];

  return { RULES, AFFLATUS, AFFLATUS_BEATS, STATUS, KIND_LABEL, INTENT_LABEL, CHARACTERS, PARTY, SKILLS, ENEMIES, WAVES };
});
