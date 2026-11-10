/*
 * 밸런스 시뮬레이션 + 기본 동작 검증
 * 실행: node tests/simulate.js [판수]
 */
'use strict';
const assert = require('assert');
const D = require('../js/data.js');
const E = require('../js/engine.js');

// 시드 고정 난수 (mulberry32)
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 간단한 AI: 체력이 낮으면 휴식/외출, 아니면 기대 상승치가 큰 트레이닝
function policy(state) {
  if (state.energy < 45) return state.mood < 0 ? ['outing'] : ['rest'];
  if (state.mood <= -1 && state.energy < 80) return ['outing'];
  let best = null;
  for (const k of Object.keys(D.TRAININGS)) {
    const pv = E.previewTraining(state, k);
    const total = Object.values(pv.gains).reduce((a, b) => a + b, 0);
    // 유대가 낮은 서포터와 함께하는 것도 가치로 친다
    const bond = pv.supporters.filter((id) => state.friendship[id] < 80).length * 6;
    // 낮은 스탯을 우선
    const balance = (1200 - state.stats[k]) / 200;
    const score = (total + bond + balance) * (1 - pv.failRate / 100);
    if (!best || score > best.score) best = { k, score };
  }
  return ['training', best.k];
}

function playOne(seed, speciesId) {
  const rng = makeRng(seed);
  const s = E.createGame({ name: '테스트', speciesId }, rng);
  let steps = 0;
  while (!s.finished) {
    if (s.pendingEvent) {
      E.resolveEvent(s, Math.floor(rng() * 2));
      continue;
    }
    const [a, t] = policy(s);
    E.performAction(s, a, t, rng);
    steps++;
    for (const k of D.STAT_KEYS) assert(s.stats[k] >= 0 && s.stats[k] <= D.STAT_CAP, 'stat out of range');
    assert(s.energy >= 0 && s.energy <= D.MAX_ENERGY, 'energy out of range');
    assert(s.mood >= -2 && s.mood <= 2, 'mood out of range');
  }
  assert.strictEqual(steps, D.TOTAL_TURNS, 'turn count');
  return s;
}

const N = Number(process.argv[2] || 300);
for (const sp of D.SPECIES) {
  const sums = Object.fromEntries(D.STAT_KEYS.map((k) => [k, 0]));
  let total = 0, maxTotal = 0, minTotal = Infinity, fails = 0, rests = 0, outs = 0;
  for (let i = 0; i < N; i++) {
    const s = playOne(1000 + i, sp.id);
    for (const k of D.STAT_KEYS) sums[k] += s.stats[k];
    const t = E.totalStats(s);
    total += t; maxTotal = Math.max(maxTotal, t); minTotal = Math.min(minTotal, t);
    fails += s.history.failures; rests += s.history.rests; outs += s.history.outings;
  }
  const avg = D.STAT_KEYS.map((k) => `${D.STAT_NAMES[k]} ${Math.round(sums[k] / N)}`).join(' / ');
  console.log(`[${sp.name}] ${avg}`);
  console.log(`   합계 평균 ${Math.round(total / N)} (최소 ${minTotal}, 최대 ${maxTotal}) | 실패 ${(fails / N).toFixed(1)} 휴식 ${(rests / N).toFixed(1)} 외출 ${(outs / N).toFixed(1)}`);
}

// 결정성 검증: 같은 시드 → 같은 결과
assert.deepStrictEqual(playOne(42, 'voltfox').stats, playOne(42, 'voltfox').stats);
console.log('OK');
