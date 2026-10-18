#!/usr/bin/env node
/* 전투 엔진 테스트 — 사용법: node tools/test.js */
'use strict';
const assert = require('assert');
const D = require('../js/data.js');
const { Battle, afflatusMult } = require('../js/engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

// 손패를 원하는 카드로 고정한 계획 단계 전투
function planningBattle(cards) {
  const b = new Battle({ seed: 42 });
  b.startWave(0);
  b.beginPlanning();
  if (cards) b.hand = cards.map(([id, rank]) => b.makeCard(id, rank || 1));
  b.history = [];
  return b;
}

console.log('engine');

test('영감 상성: 순환 우세 / 열세, 영혼↔지능 상호 우세', () => {
  assert.strictEqual(afflatusMult('star', 'mineral'), 1.3);
  assert.strictEqual(afflatusMult('mineral', 'star'), 0.8);
  assert.strictEqual(afflatusMult('mineral', 'beast'), 1.3);
  assert.strictEqual(afflatusMult('spirit', 'intellect'), 1.3);
  assert.strictEqual(afflatusMult('intellect', 'spirit'), 1.3);
  assert.strictEqual(afflatusMult('star', 'spirit'), 1);
});

test('수동 합성: 등급 +1, 행동력 -1, 열정 +1, 슬롯에 합성 기록', () => {
  const b = planningBattle([['s_slash'], ['c_flame'], ['s_slash'], ['b_mend']]);
  const r = b.mergeCards(0, 2);
  assert.ok(r);
  assert.deepStrictEqual(b.hand.map(c => c.skillId + c.rank), ['c_flame1', 's_slash2', 'b_mend1']);
  assert.strictEqual(b.ap, D.RULES.maxAp - 1);
  assert.strictEqual(b.ally('sword').moxie, 1);
  assert.strictEqual(b.queue[0].type, 'merge');
});

test('다른 카드·다른 등급·★3은 합성되지 않음', () => {
  const b = planningBattle([['s_slash'], ['c_flame'], ['s_slash', 2], ['b_mend', 3], ['b_mend', 3]]);
  assert.strictEqual(b.mergeCards(0, 1), null);
  assert.strictEqual(b.mergeCards(0, 2), null);
  assert.strictEqual(b.mergeCards(3, 4), null);
  assert.strictEqual(b.ap, D.RULES.maxAp);
});

test('연쇄 합성: 카드를 쓰고 양옆이 같아지면 자동 합성(행동력 소모 없음, 열정 +1)', () => {
  const b = planningBattle([['s_slash'], ['c_flame'], ['s_slash'], ['b_mend']]);
  const r = b.playCard(1);
  assert.strictEqual(r.merges.length, 1);
  assert.deepStrictEqual(b.hand.map(c => c.skillId + c.rank), ['s_slash2', 'b_mend1']);
  assert.strictEqual(b.ap, D.RULES.maxAp - 1);
  assert.strictEqual(b.ally('sword').moxie, 1);
});

test('연쇄 합성은 끝까지 이어짐 (★1+★1 → ★2, 옆의 ★2와 다시 ★3)', () => {
  const b = planningBattle([['s_slash', 2], ['s_slash'], ['c_flame'], ['s_slash']]);
  const r = b.playCard(2);
  assert.strictEqual(r.merges.length, 2);
  assert.deepStrictEqual(b.hand.map(c => c.skillId + c.rank), ['s_slash3']);
  assert.strictEqual(b.ally('sword').moxie, 2);
});

test('되돌리기: 합성과 열정까지 원래대로 (기존 무한 열정 버그 수정)', () => {
  const b = planningBattle([['s_slash'], ['c_flame'], ['s_slash'], ['b_mend']]);
  const start = JSON.stringify(b.hand);
  b.mergeCards(0, 2);
  b.playCard(0);
  assert.ok(b.undo());
  assert.ok(b.undo());
  assert.strictEqual(JSON.stringify(b.hand), start);
  assert.strictEqual(b.ally('sword').moxie, 0);
  assert.strictEqual(b.ap, D.RULES.maxAp);
  assert.strictEqual(b.queue.length, 0);
  assert.strictEqual(b.stats.merges, 0);
});

test('초기화: 이번 턴 시작 상태로 한 번에 복원', () => {
  const b = planningBattle([['s_slash'], ['c_flame'], ['s_slash'], ['b_mend'], ['b_mend']]);
  b.mergeCards(0, 2);
  b.mergeCards(2, 3);
  b.playCard(0);
  assert.ok(b.resetPlanning());
  assert.strictEqual(b.hand.length, 5);
  assert.strictEqual(b.ally('sword').moxie + b.ally('bookmark').moxie, 0);
  assert.strictEqual(b.canUndo, false);
});

test('열정 5 → 최종 술식 카드가 맨 왼쪽에 한 장만 생성', () => {
  const b = planningBattle([['s_slash'], ['c_flame'], ['s_slash'], ['b_mend']]);
  b.ally('sword').moxie = D.RULES.moxieMax - 1;
  const r = b.mergeCards(0, 2);
  assert.strictEqual(r.ults.length, 1);
  assert.strictEqual(b.hand[0].skillId, 'u_sword');
  assert.strictEqual(b.spawnUlts().length, 0);
});

test('최종 술식 사용 시 열정 0, 일반 카드 실행 시 열정 +1', () => {
  const b = planningBattle([['u_sword'], ['c_flame']]);
  b.ally('sword').moxie = D.RULES.moxieMax;
  b.playCard(0);
  b.playCard(0);
  b.beginExecution();
  const r1 = b.resolveNext();
  assert.strictEqual(r1.events.filter(e => e.type === 'hit').length > 0, true);
  assert.strictEqual(b.ally('sword').moxie, 0);
  b.resolveNext();
  assert.strictEqual(b.ally('candle').moxie, 1);
});

test('보호막은 피해를 먼저 흡수', () => {
  const b = planningBattle();
  const sword = b.ally('sword');
  const e = b.aliveEnemies[0];
  b.addShield(sword, sword, 100, 2);
  const ev = b.dealDamage(e, sword, 100, { critBonus: -1, hit: 0, hits: 1 });
  assert.ok(ev.absorbed > 0);
  assert.strictEqual(sword.hp, sword.maxHp - (ev.amount - ev.absorbed));
});

test('턴 종료: 지속 피해 후 효과 지속 시간 감소', () => {
  const b = planningBattle();
  const e = b.aliveEnemies[0];
  b.applyStatus(b.ally('candle'), e, { id: 'burn', turns: 2, power: 0.5 }, 0);
  const hp = e.hp;
  const evs = b.endRound();
  assert.ok(evs.some(x => x.type === 'dot' && x.uid === e.uid));
  assert.ok(e.hp < hp);
  assert.strictEqual(b.status(e, 'burn').turns, 1);
  assert.strictEqual(b.turn, 2);
});

test('보스는 체력 50% 이하에서 격노', () => {
  const b = new Battle({ seed: 1 });
  b.startWave(1);
  const q = b.aliveEnemies[0];
  q.hp = Math.floor(q.maxHp * 0.5) - 1;
  const ev = b.checkPhase(q);
  assert.ok(ev && ev.type === 'phase');
  assert.ok(b.has(q, 'enrage'));
  assert.strictEqual(b.checkPhase(q), null);
});

test('라운드 클리어 시 실행되지 않은 카드는 손패로 돌아옴', () => {
  const b = planningBattle([['s_slash'], ['c_flame'], ['b_mend']]);
  b.playCard(0); b.playCard(0); b.playCard(0);
  b.beginExecution();
  b.aliveEnemies.forEach(e => b.kill(e));
  b.cursor = 1;
  const back = b.returnUnplayed();
  assert.strictEqual(back.length, 2);
  assert.strictEqual(b.outcome(), 'waveClear');
});

test('같은 시드면 같은 전투', () => {
  const a = new Battle({ seed: 7 }), c = new Battle({ seed: 7 });
  a.startWave(0); c.startWave(0);
  a.beginPlanning(); c.beginPlanning();
  assert.deepStrictEqual(a.hand.map(x => x.skillId), c.hand.map(x => x.skillId));
  assert.deepStrictEqual(a.enemies.map(e => e.intents), c.enemies.map(e => e.intents));
});

console.log(`\n${passed}개 통과`);
