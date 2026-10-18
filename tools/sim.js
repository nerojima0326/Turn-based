#!/usr/bin/env node
/* 밸런스 시뮬레이터 — 자동 전투 AI로 전투를 반복해 승률·평균 턴 수를 출력합니다.
 * 사용법: node tools/sim.js [횟수=1000] */
'use strict';
const D = require('../js/data.js');
const { Battle, autoChoice } = require('../js/engine.js');

function runBattle(seed) {
  const b = new Battle({ seed });
  b.startWave(0);
  let waveTurns = [];
  let waveStart = 1;
  for (;;) {
    if (b.turn > D.RULES.maxTurn) return { win: false, reason: 'timeout', b, waveTurns };
    b.beginPlanning();
    let c;
    while ((c = autoChoice(b))) {
      if (c.target) b.setTarget(c.target);
      if (c.type === 'merge') b.mergeCards(c.from, c.to); else b.playCard(c.index);
    }
    b.beginExecution();
    let out = null;
    while (!out && b.resolveNext()) out = b.outcome();
    if (!out) {
      b.beginEnemyPhase();
      while (!out && b.resolveEnemyNext()) out = b.outcome();
    }
    if (out === 'victory') return { win: true, turns: b.turn, b, waveTurns: [...waveTurns, b.turn - waveStart + 1] };
    if (out === 'defeat') return { win: false, reason: 'wipe', b, waveTurns };
    b.endRound();
    out = b.outcome();
    if (out === 'victory') return { win: true, turns: b.turn - 1, b, waveTurns: [...waveTurns, b.turn - waveStart] };
    if (out === 'defeat') return { win: false, reason: 'wipe', b, waveTurns };
    if (out === 'waveClear') {
      waveTurns.push(b.turn - waveStart);
      waveStart = b.turn;
      b.returnUnplayed();
      b.startWave(b.waveIndex + 1);
    }
  }
}

const N = Number(process.argv[2]) || 1000;
let wins = 0, turns = 0, deaths = 0, flawless = 0, timeouts = 0, ults = 0;
const w1 = [], w2 = [], lossWave = [0, 0];
const turnHist = {};
for (let i = 0; i < N; i++) {
  const r = runBattle(1000 + i);
  if (r.win) {
    wins++; turns += r.turns; turnHist[r.turns] = (turnHist[r.turns] || 0) + 1;
    deaths += r.b.stats.deaths; if (!r.b.stats.deaths) flawless++;
    w1.push(r.waveTurns[0]); w2.push(r.waveTurns[1]);
  } else {
    if (r.reason === 'timeout') timeouts++;
    lossWave[r.b.waveIndex]++;
  }
  ults += r.b.stats.ults;
}
const avg = a => (a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(2);
console.log(`전투 ${N}회`);
console.log(`승률 ${(wins / N * 100).toFixed(1)}%  (시간 초과 ${timeouts}, 1라운드 패배 ${lossWave[0]}, 2라운드 패배 ${lossWave[1]})`);
console.log(`평균 턴 ${(turns / (wins || 1)).toFixed(2)}  (1라운드 ${avg(w1)} / 2라운드 ${avg(w2)})`);
console.log(`승리 시 평균 전투 불능 ${(deaths / (wins || 1)).toFixed(2)}  · 무손실 승리 ${(flawless / N * 100).toFixed(1)}%`);
console.log(`전투당 최종 술식 ${(ults / N).toFixed(2)}회`);
console.log('턴 분포', Object.entries(turnHist).sort((a, b) => a[0] - b[0]).map(([t, n]) => `${t}:${n}`).join(' '));
