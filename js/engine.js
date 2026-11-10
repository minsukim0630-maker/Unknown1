/*
 * 육성 엔진 (순수 로직, DOM 의존 없음)
 * 모든 함수는 state 를 직접 갱신하고, UI 표시용 결과 객체를 반환한다.
 * rng 는 테스트를 위해 주입 가능 (기본 Math.random).
 */
(function (root) {
  'use strict';

  const D = typeof module !== 'undefined' && module.exports ? require('./data.js') : root.GameData;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  const supporterById = (id) => D.SUPPORTERS.find((s) => s.id === id);
  const trainingKeys = Object.keys(D.TRAININGS);

  // ---------------------------------------------------------------- 턴 정보

  function turnInfo(turn) {
    const t = Math.min(turn, D.TOTAL_TURNS - 1);
    const year = Math.floor(t / D.TURNS_PER_YEAR) + 1;
    const month = Math.floor((t % D.TURNS_PER_YEAR) / 2) + 1;
    const half = t % 2 === 0 ? '전반' : '후반';
    const isCamp = D.CAMP_YEARS.includes(year) && D.CAMP_MONTHS.includes(month);
    return {
      turn: t,
      year,
      month,
      half,
      isCamp,
      label: `${year}년차 ${month}월 ${half}`,
      remaining: D.TOTAL_TURNS - turn,
    };
  }

  // ---------------------------------------------------------------- 생성

  function createGame({ name, speciesId }, rng = Math.random) {
    const species = D.SPECIES.find((s) => s.id === speciesId) || D.SPECIES[0];
    const state = {
      version: 1,
      name: (name || species.name).trim() || species.name,
      speciesId: species.id,
      turn: 0,
      stats: { ...species.baseStats },
      energy: D.MAX_ENERGY,
      mood: 0,
      trainingCounts: Object.fromEntries(trainingKeys.map((k) => [k, 0])),
      friendship: Object.fromEntries(D.SUPPORTERS.map((s) => [s.id, 0])),
      assignments: {},
      pendingEvent: null,
      finished: false,
      history: { trainings: 0, rests: 0, outings: 0, failures: 0 },
    };
    assignSupporters(state, rng);
    return state;
  }

  function species(state) {
    return D.SPECIES.find((s) => s.id === state.speciesId);
  }

  // ---------------------------------------------------------------- 서포터 배치

  function assignSupporters(state, rng = Math.random) {
    const assignments = Object.fromEntries(trainingKeys.map((k) => [k, []]));
    for (const s of D.SUPPORTERS) {
      if (rng() < D.SUPPORTER_ABSENT_RATE) continue;
      let target;
      if (s.type !== 'friend' && rng() < D.SUPPORTER_SPECIALTY_RATE) {
        target = s.type;
      } else {
        const others = trainingKeys.filter((k) => k !== s.type);
        target = pick(others, rng);
      }
      assignments[target].push(s.id);
    }
    state.assignments = assignments;
  }

  // ---------------------------------------------------------------- 트레이닝 계산

  function trainingLevel(state, type) {
    return Math.min(D.MAX_TRAINING_LEVEL, 1 + Math.floor(state.trainingCounts[type] / D.USES_PER_LEVEL));
  }

  function effectiveLevel(state, type) {
    return turnInfo(state.turn).isCamp ? D.MAX_TRAINING_LEVEL : trainingLevel(state, type);
  }

  function failRate(state, type) {
    const tr = D.TRAININGS[type];
    if (state.energy >= tr.failThreshold) return 0;
    return clamp(Math.ceil((tr.failThreshold - state.energy) * 1.6), 0, 99);
  }

  function isFriendshipTraining(state, supporter, type) {
    return supporter.type === type && state.friendship[supporter.id] >= D.FRIENDSHIP_TRAINING_THRESHOLD;
  }

  /** 트레이닝 미리보기: 상승치, 체력 변화, 실패율 등 */
  function previewTraining(state, type) {
    const tr = D.TRAININGS[type];
    const lv = effectiveLevel(state, type);
    const sp = species(state);
    const present = (state.assignments[type] || []).map(supporterById);

    const moodMult = 1 + 0.1 * state.mood;
    let trainBonus = 0;
    let friendMult = 1;
    let energySave = 0;
    const friendshipActive = [];
    for (const s of present) {
      trainBonus += s.trainBonus;
      energySave += s.energySave || 0;
      if (isFriendshipTraining(state, s, type)) {
        friendMult *= 1 + s.friendBonus;
        friendshipActive.push(s.id);
      }
    }
    const headcountMult = 1 + 0.05 * present.length;

    const gains = {};
    for (const [stat, table] of Object.entries(tr.gains)) {
      const growth = 1 + (sp.growth[stat] || 0);
      const raw = Math.floor(table[lv - 1] * moodMult * (1 + trainBonus) * friendMult * headcountMult * growth);
      gains[stat] = Math.min(raw, D.STAT_CAP - state.stats[stat]);
    }

    const energyCost = Math.max(0, tr.energy + (lv - 1) - energySave);

    return {
      type,
      level: lv,
      gains,
      energyCost,
      failRate: failRate(state, type),
      supporters: present.map((s) => s.id),
      friendshipActive,
    };
  }

  // ---------------------------------------------------------------- 상태 변경 헬퍼

  function changeStat(state, stat, delta) {
    const before = state.stats[stat];
    state.stats[stat] = clamp(before + delta, 0, D.STAT_CAP);
    return state.stats[stat] - before;
  }

  function changeEnergy(state, delta) {
    const before = state.energy;
    state.energy = clamp(before + delta, 0, D.MAX_ENERGY);
    return state.energy - before;
  }

  function changeMood(state, delta) {
    const before = state.mood;
    state.mood = clamp(before + delta, -2, 2);
    return state.mood - before;
  }

  function changeFriendship(state, id, delta) {
    const before = state.friendship[id];
    state.friendship[id] = clamp(before + delta, 0, D.FRIENDSHIP_MAX);
    return state.friendship[id] - before;
  }

  function emptyChanges() {
    return { stats: {}, energy: 0, mood: 0, friendship: {} };
  }

  // ---------------------------------------------------------------- 행동

  function doTraining(state, type, rng) {
    const pv = previewTraining(state, type);
    const changes = emptyChanges();
    const result = { action: 'training', type, preview: pv, changes, success: true, bigFail: false, messages: [] };
    const trName = D.TRAININGS[type].name;

    if (rng() * 100 < pv.failRate) {
      // 실패
      result.success = false;
      state.history.failures++;
      const bigFail = pv.failRate >= 30 && rng() * 100 < pv.failRate / 2;
      result.bigFail = bigFail;
      if (bigFail) {
        changes.stats[type] = changeStat(state, type, -10);
        const others = D.STAT_KEYS.filter((k) => k !== type);
        for (let i = 0; i < 2; i++) {
          const st = pick(others, rng);
          changes.stats[st] = (changes.stats[st] || 0) + changeStat(state, st, -10);
        }
        changes.mood = changeMood(state, -2);
        result.messages.push(`${trName} 트레이닝 대실패… 무리를 하고 말았다.`);
      } else {
        const main = Object.keys(D.TRAININGS[type].gains)[0];
        changes.stats[main] = changeStat(state, main, -5);
        changes.mood = changeMood(state, -1);
        result.messages.push(`${trName} 트레이닝 실패… 집중이 흐트러졌다.`);
      }
      return result;
    }

    for (const [stat, g] of Object.entries(pv.gains)) {
      changes.stats[stat] = changeStat(state, stat, g);
    }
    changes.energy = changeEnergy(state, -pv.energyCost);

    // 유대 상승
    for (const id of pv.supporters) {
      changes.friendship[id] = changeFriendship(state, id, D.FRIENDSHIP_GAIN_PER_TRAINING);
    }

    state.trainingCounts[type]++;
    state.history.trainings++;

    const prevLv = Math.min(D.MAX_TRAINING_LEVEL, 1 + Math.floor((state.trainingCounts[type] - 1) / D.USES_PER_LEVEL));
    const newLv = trainingLevel(state, type);

    if (pv.friendshipActive.length) {
      const names = pv.friendshipActive.map((id) => supporterById(id).name).join(', ');
      result.messages.push(`우정 트레이닝 발동! (${names})`);
    }
    result.messages.push(`${trName} 트레이닝 성공!`);
    if (newLv > prevLv) result.messages.push(`${trName} 트레이닝이 Lv${newLv}(으)로 올랐다!`);
    return result;
  }

  function doRest(state, rng) {
    const changes = emptyChanges();
    const info = turnInfo(state.turn);
    let r = rng();
    let amount = D.REST_TABLE[D.REST_TABLE.length - 1][0];
    for (const [amt, p] of D.REST_TABLE) {
      if (r < p) {
        amount = amt;
        break;
      }
      r -= p;
    }
    changes.energy = changeEnergy(state, amount);
    const messages = [];
    if (info.isCamp) {
      // 합숙 중 휴식은 외출 효과도 겸한다
      changes.mood = changeMood(state, 1);
      messages.push('합숙지에서 푹 쉬었다. 바닷바람이 기분 좋다.');
    } else if (amount >= 70) {
      messages.push('푹 잤다! 체력이 크게 회복되었다.');
    } else if (amount >= 50) {
      messages.push('충분히 쉬었다.');
    } else {
      messages.push('잠을 설쳤다… 체력이 조금밖에 회복되지 않았다.');
    }
    state.history.rests++;
    return { action: 'rest', changes, success: true, messages };
  }

  const OUTINGS = [
    { text: '{name}와(과) 함께 공원으로 산책을 나갔다.', mood: 1, energy: 10 },
    { text: '포켓몬센터 카페에서 디저트를 먹었다!', mood: 2, energy: 5 },
    { text: '포케슬론 돔을 견학했다. 의욕이 솟는다!', mood: 1, energy: 15 },
    { text: '노래방에서 신나게 놀았다!', mood: 2, energy: 0 },
  ];

  function doOuting(state, rng) {
    const changes = emptyChanges();
    const o = pick(OUTINGS, rng);
    changes.mood = changeMood(state, o.mood);
    changes.energy = changeEnergy(state, o.energy);
    // 외출에는 단짝 친구가 따라오는 경우가 있다
    const messages = [o.text.replace('{name}', state.name)];
    if (rng() < 0.5) {
      const friend = D.SUPPORTERS.find((s) => s.type === 'friend');
      changes.friendship[friend.id] = changeFriendship(state, friend.id, 5);
      messages.push(`${friend.name}도 함께했다.`);
    }
    state.history.outings++;
    return { action: 'outing', changes, success: true, messages };
  }

  // ---------------------------------------------------------------- 이벤트

  function rollEvent(state, rng) {
    if (rng() >= D.EVENT_RATE) return null;
    const total = D.EVENTS.reduce((a, e) => a + e.weight, 0);
    let r = rng() * total;
    let ev = D.EVENTS[0];
    for (const e of D.EVENTS) {
      if (r < e.weight) {
        ev = e;
        break;
      }
      r -= e.weight;
    }
    // 'random' 대상은 이벤트 발생 시점에 확정해 둔다 (선택지 표시와 실제 효과 일치)
    const supporter = pick(D.SUPPORTERS, rng).id;
    const randomStat = pick(D.STAT_KEYS, rng);
    return { id: ev.id, supporter, randomStat };
  }

  function eventDef(id) {
    return D.EVENTS.find((e) => e.id === id);
  }

  /** 이벤트 표시용 텍스트/선택지 */
  function describeEvent(state, pending) {
    const ev = eventDef(pending.id);
    const sup = supporterById(pending.supporter);
    const fill = (t) => t.replace(/\{name\}/g, state.name).replace(/\{supporter\}/g, sup.name);
    const choices = (ev.choices || [{ label: '확인', effect: ev.effect }]).map((c) => ({
      label: c.label,
      effectText: effectText(c.effect, pending),
    }));
    return { title: ev.title, text: fill(ev.text), choices };
  }

  function resolveEffect(effect, pending) {
    const out = { stats: {}, energy: effect.energy || 0, mood: effect.mood || 0, friendship: {} };
    for (const [k, v] of Object.entries(effect.stats || {})) {
      const key = k === 'random' ? pending.randomStat : k;
      out.stats[key] = (out.stats[key] || 0) + v;
    }
    for (const [k, v] of Object.entries(effect.friendship || {})) {
      const key = k === 'random' ? pending.supporter : k;
      out.friendship[key] = (out.friendship[key] || 0) + v;
    }
    return out;
  }

  function effectText(effect, pending) {
    const e = resolveEffect(effect || {}, pending);
    const parts = [];
    for (const [k, v] of Object.entries(e.stats)) parts.push(`${D.STAT_NAMES[k]} ${v > 0 ? '+' : ''}${v}`);
    if (e.energy) parts.push(`체력 ${e.energy > 0 ? '+' : ''}${e.energy}`);
    if (e.mood) parts.push(`컨디션 ${e.mood > 0 ? '↑' : '↓'}`);
    for (const [k, v] of Object.entries(e.friendship)) parts.push(`${supporterById(k).name} 유대 +${v}`);
    return parts.join(', ');
  }

  function resolveEvent(state, choiceIndex = 0) {
    const pending = state.pendingEvent;
    if (!pending) return null;
    const ev = eventDef(pending.id);
    const choice = ev.choices ? ev.choices[clamp(choiceIndex, 0, ev.choices.length - 1)] : { effect: ev.effect };
    const eff = resolveEffect(choice.effect || {}, pending);
    const changes = emptyChanges();
    for (const [k, v] of Object.entries(eff.stats)) changes.stats[k] = changeStat(state, k, v);
    if (eff.energy) changes.energy = changeEnergy(state, eff.energy);
    if (eff.mood) changes.mood = changeMood(state, eff.mood);
    for (const [k, v] of Object.entries(eff.friendship)) changes.friendship[k] = changeFriendship(state, k, v);
    state.pendingEvent = null;
    checkFinished(state);
    return { action: 'event', changes, messages: [`[${ev.title}] ${choice.label || ''}`.trim()] };
  }

  // ---------------------------------------------------------------- 턴 진행

  function checkFinished(state) {
    if (state.turn >= D.TOTAL_TURNS && !state.pendingEvent) state.finished = true;
  }

  /**
   * 행동 실행 → 턴 진행 → 이벤트 판정 → 서포터 재배치
   * action: 'training' | 'rest' | 'outing'
   */
  function performAction(state, action, type, rng = Math.random) {
    if (state.finished) throw new Error('육성이 이미 종료되었습니다.');
    if (state.pendingEvent) throw new Error('처리되지 않은 이벤트가 있습니다.');

    const before = turnInfo(state.turn);
    let result;
    if (action === 'training') {
      if (!D.TRAININGS[type]) throw new Error(`알 수 없는 트레이닝: ${type}`);
      result = doTraining(state, type, rng);
    } else if (action === 'rest') {
      result = doRest(state, rng);
    } else if (action === 'outing') {
      result = doOuting(state, rng);
    } else {
      throw new Error(`알 수 없는 행동: ${action}`);
    }

    state.turn++;
    if (state.turn < D.TOTAL_TURNS) {
      state.pendingEvent = rollEvent(state, rng);
      assignSupporters(state, rng);
    }
    checkFinished(state);

    const after = turnInfo(state.turn);
    result.notices = [];
    if (!state.finished) {
      if (after.isCamp && !before.isCamp) result.notices.push(`${after.year}년차 여름 합숙 시작! 모든 트레이닝이 Lv5가 된다.`);
      if (!after.isCamp && before.isCamp) result.notices.push('여름 합숙 종료! 성과를 살려 나가자.');
      if (after.year !== before.year) result.notices.push(`${after.year}년차가 시작되었다!`);
      if (after.remaining === 1) result.notices.push('마지막 턴! 포케슬론이 코앞이다.');
    }
    return result;
  }

  // ---------------------------------------------------------------- 평가

  function rankOf(value) {
    for (const [min, r] of D.RANKS) if (value >= min) return r;
    return 'G';
  }

  function totalStats(state) {
    return D.STAT_KEYS.reduce((a, k) => a + state.stats[k], 0);
  }

  function overallRank(state) {
    return rankOf(Math.floor(totalStats(state) / D.STAT_KEYS.length));
  }

  const Engine = {
    turnInfo,
    createGame,
    species,
    assignSupporters,
    trainingLevel,
    effectiveLevel,
    failRate,
    previewTraining,
    performAction,
    describeEvent,
    resolveEvent,
    rankOf,
    totalStats,
    overallRank,
    supporterById,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Engine;
  } else {
    root.Engine = Engine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
