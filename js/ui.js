/*
 * 화면 표시 및 입력 처리
 */
(function () {
  'use strict';

  const D = window.GameData;
  const E = window.Engine;
  const SAVE_KEY = 'pokeathlon-training-save-v1';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  const sign = (v) => (v > 0 ? `+${v}` : `${v}`);

  let state = null;
  let selectedSpecies = D.SPECIES[0].id;
  let selectedTraining = null; // 클릭으로 고정된 미리보기
  let hoverTraining = null; // 마우스 오버 미리보기
  let busy = false;
  let logLines = [];

  // ---------------------------------------------------------------- 저장

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ state, logLines }));
    } catch (e) {
      /* 저장 불가 환경은 무시 */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data.state || data.state.version !== 1 || data.state.finished) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      /* 무시 */
    }
  }

  // ---------------------------------------------------------------- 화면 전환

  function showScreen(name) {
    for (const s of ['start', 'train', 'result']) $(`screen-${s}`).hidden = s !== name;
  }

  // ---------------------------------------------------------------- 시작 화면

  function renderStart() {
    const list = $('species-list');
    list.innerHTML = '';
    for (const sp of D.SPECIES) {
      const card = el('button', 'species-card' + (sp.id === selectedSpecies ? ' selected' : ''));
      const growth = Object.entries(sp.growth)
        .map(([k, v]) => `${D.STAT_NAMES[k]} +${Math.round(v * 100)}%`)
        .join(' · ');
      card.innerHTML = `
        <div class="sp-icon">${sp.icon}</div>
        <div class="sp-name">${sp.name}</div>
        <div class="sp-desc">${sp.desc}</div>
        <div class="sp-growth">성장률 ${growth}</div>`;
      card.onclick = () => {
        selectedSpecies = sp.id;
        renderStart();
      };
      list.appendChild(card);
    }
    $('btn-continue').hidden = !load();
    showScreen('start');
  }

  function startNew() {
    state = E.createGame({ name: $('input-name').value, speciesId: selectedSpecies });
    logLines = [];
    selectedTraining = null;
    addLog(`${state.name}의 육성이 시작되었다! 목표는 포케슬론 출전!`);
    save();
    showScreen('train');
    render();
  }

  function continueGame() {
    const data = load();
    if (!data) return renderStart();
    state = data.state;
    logLines = data.logLines || [];
    selectedTraining = null;
    showScreen('train');
    render();
    // 이벤트 도중 저장된 경우 이어서 처리
    if (state.pendingEvent) handleEvent();
  }

  // ---------------------------------------------------------------- 육성 화면

  function addLog(msg, turn = state.turn) {
    const info = E.turnInfo(turn);
    logLines.unshift(`<span class="log-turn">${info.year}년 ${info.month}월</span> ${msg}`);
    logLines = logLines.slice(0, 40);
  }

  function currentPreview() {
    const t = hoverTraining || selectedTraining;
    return t ? E.previewTraining(state, t) : null;
  }

  function render() {
    const info = E.turnInfo(state.turn);
    const sp = E.species(state);
    const pv = currentPreview();

    // 상단
    $('turn-label').textContent = info.label;
    $('turn-remaining').innerHTML = `남은 턴 <b>${info.remaining}</b>`;
    $('turn-badges').innerHTML = info.isCamp ? '<span class="badge camp">🏖️ 여름 합숙</span>' : '';

    // 캐릭터
    $('char-icon').textContent = sp.icon;
    $('char-name').textContent = state.name;
    $('char-species').textContent = sp.name;

    $('energy-text').textContent = `${state.energy} / ${D.MAX_ENERGY}`;
    const energyAfter = pv ? Math.max(0, state.energy - pv.energyCost) : state.energy;
    $('energy-fill').style.width = `${energyAfter}%`;
    $('energy-fill').className = 'bar-fill energy ' + energyClass(state.energy);
    $('energy-preview').style.left = `${energyAfter}%`;
    $('energy-preview').style.width = `${state.energy - energyAfter}%`;

    const mood = D.MOODS[String(state.mood)];
    $('mood').className = `mood ${mood.cls}`;
    $('mood').innerHTML = `${mood.icon} 컨디션 <b>${mood.name}</b> <small>(효율 ${sign(state.mood * 10)}%)</small>`;

    renderSupporters();
    renderStats($('stats'), pv ? pv.gains : null);
    renderTrainings(info);

    $('log').innerHTML = logLines.map((l) => `<li>${l}</li>`).join('');
  }

  function energyClass(e) {
    if (e >= 70) return 'high';
    if (e >= 40) return 'mid';
    return 'low';
  }

  function renderSupporters() {
    const ul = $('supporter-list');
    ul.innerHTML = '';
    for (const s of D.SUPPORTERS) {
      const f = state.friendship[s.id];
      const li = el('li', 'supporter');
      const typeName = s.type === 'friend' ? '친구' : D.TRAININGS[s.type].name;
      li.innerHTML = `
        <span class="sup-icon">${s.icon}</span>
        <span class="sup-name">${s.name}<small>${typeName}</small></span>
        <span class="bar small"><span class="bar-fill friend ${f >= D.FRIENDSHIP_TRAINING_THRESHOLD ? 'max' : ''}" style="width:${f}%"></span></span>
        <span class="sup-val">${f}</span>`;
      li.title = `${s.role} · 트레이닝 효과 +${Math.round(s.trainBonus * 100)}%` +
        (s.friendBonus ? ` · 우정 트레이닝 +${Math.round(s.friendBonus * 100)}%` : '') +
        (s.energySave ? ` · 체력 소모 -${s.energySave}` : '');
      ul.appendChild(li);
    }
  }

  function renderStats(container, gains) {
    container.innerHTML = '';
    for (const k of D.STAT_KEYS) {
      const v = state.stats[k];
      const g = gains && gains[k] ? gains[k] : 0;
      const row = el('div', 'stat');
      row.innerHTML = `
        <div class="stat-head">
          <span class="stat-name">${D.STAT_NAMES[k]}</span>
          <span class="rank rank-${rankCls(E.rankOf(v))}">${E.rankOf(v)}</span>
        </div>
        <div class="stat-value">${v}<small>/${D.STAT_CAP}</small></div>
        <div class="stat-gain">${g ? `+${g}` : ''}</div>
        <div class="bar"><div class="bar-fill stat-${k}" style="width:${(v / D.STAT_CAP) * 100}%"></div>
          <div class="bar-preview gain" style="left:${(v / D.STAT_CAP) * 100}%;width:${(g / D.STAT_CAP) * 100}%"></div></div>`;
      container.appendChild(row);
    }
  }

  function rankCls(r) {
    return r.replace('+', 'p').toLowerCase();
  }

  function renderTrainings(info) {
    const grid = $('training-grid');
    grid.innerHTML = '';
    for (const [type, tr] of Object.entries(D.TRAININGS)) {
      const pv = E.previewTraining(state, type);
      const card = el('button', 'training-card');
      if (selectedTraining === type) card.classList.add('selected');
      if (pv.friendshipActive.length) card.classList.add('friendship');
      if (pv.failRate > 0) card.classList.add(pv.failRate >= 30 ? 'danger' : 'warn');

      const count = state.trainingCounts[type];
      const lvBase = E.trainingLevel(state, type);
      const toNext = lvBase >= D.MAX_TRAINING_LEVEL ? 'MAX' : `${count % D.USES_PER_LEVEL}/${D.USES_PER_LEVEL}`;
      const sups = pv.supporters
        .map((id) => {
          const s = E.supporterById(id);
          const f = state.friendship[id];
          const cls = pv.friendshipActive.includes(id) ? 'active' : f >= D.FRIENDSHIP_TRAINING_THRESHOLD ? 'max' : '';
          return `<span class="sup-chip ${cls}" title="${s.name} (유대 ${f})">${s.icon}<i style="width:${f}%"></i></span>`;
        })
        .join('');
      const total = Object.values(pv.gains).reduce((a, b) => a + b, 0);

      card.innerHTML = `
        <div class="tc-head"><span class="tc-icon">${tr.icon}</span><span class="tc-name">${tr.name}</span>
          <span class="tc-lv">Lv${pv.level}${info.isCamp ? '' : `<small>${toNext}</small>`}</span></div>
        <div class="tc-sups">${sups || '<span class="none">서포터 없음</span>'}</div>
        <div class="tc-foot">
          <span class="tc-total">+${total}</span>
          <span class="tc-energy">체력 -${pv.energyCost}</span>
          <span class="tc-fail">실패 ${pv.failRate}%</span>
        </div>
        ${pv.friendshipActive.length ? '<div class="tc-friend">우정 트레이닝!</div>' : ''}`;
      card.title = tr.desc;

      card.onmouseenter = () => {
        if (window.matchMedia('(hover: hover)').matches) {
          hoverTraining = type;
          renderPreviewOnly();
        }
      };
      card.onmouseleave = () => {
        hoverTraining = null;
        renderPreviewOnly();
      };
      card.onclick = () => onTrainingClick(type);
      grid.appendChild(card);
    }
  }

  // 마우스 오버 시에는 카드 DOM 을 다시 만들지 않고 스탯/체력만 갱신
  function renderPreviewOnly() {
    const pv = currentPreview();
    renderStats($('stats'), pv ? pv.gains : null);
    const energyAfter = pv ? Math.max(0, state.energy - pv.energyCost) : state.energy;
    $('energy-fill').style.width = `${energyAfter}%`;
    $('energy-preview').style.left = `${energyAfter}%`;
    $('energy-preview').style.width = `${state.energy - energyAfter}%`;
  }

  function onTrainingClick(type) {
    if (busy) return;
    if (selectedTraining === type) {
      act('training', type);
    } else {
      selectedTraining = type;
      render();
    }
  }

  // ---------------------------------------------------------------- 행동

  async function act(action, type) {
    if (busy || !state || state.finished) return;
    busy = true;
    try {
      const turnBefore = state.turn;
      const result = E.performAction(state, action, type);
      selectedTraining = null;
      hoverTraining = null;
      for (const m of result.messages) addLog(m, turnBefore);
      save();
      render();

      await showModal({
        title: resultTitle(result),
        body: `<p>${result.messages.join('<br>')}</p>${changesHtml(result.changes)}` +
          (result.notices.length ? `<p class="notice">${result.notices.join('<br>')}</p>` : ''),
        buttons: [{ label: '다음', cls: 'btn-main' }],
        cls: result.success === false ? 'fail' : '',
      });
      for (const n of result.notices) addLog(n);

      if (state.pendingEvent) await handleEvent();
      render();
      if (state.finished) finish();
    } finally {
      busy = false;
    }
  }

  async function handleEvent() {
    const desc = E.describeEvent(state, state.pendingEvent);
    const idx = await showModal({
      title: `✨ ${desc.title}`,
      body: `<p>${desc.text}</p>`,
      buttons: desc.choices.map((c) => ({
        label: c.label,
        sub: c.effectText,
        cls: desc.choices.length > 1 ? 'btn-choice' : 'btn-main',
      })),
    });
    const r = E.resolveEvent(state, idx);
    for (const m of r.messages) addLog(m);
    save();
    render();
    if (state.finished) finish();
  }

  function resultTitle(r) {
    if (r.action === 'training') {
      const n = D.TRAININGS[r.type].name;
      if (!r.success) return r.bigFail ? `💥 ${n} 트레이닝 대실패` : `😣 ${n} 트레이닝 실패`;
      return `${D.TRAININGS[r.type].icon} ${n} 트레이닝`;
    }
    return r.action === 'rest' ? '🛏️ 휴식' : '🎈 외출';
  }

  function changesHtml(c) {
    const items = [];
    for (const [k, v] of Object.entries(c.stats)) {
      if (v) items.push(`<li class="${v > 0 ? 'up' : 'down'}">${D.STAT_NAMES[k]} ${sign(v)}</li>`);
    }
    if (c.energy) items.push(`<li class="${c.energy > 0 ? 'up' : 'down'}">체력 ${sign(c.energy)}</li>`);
    if (c.mood) {
      const m = D.MOODS[String(state.mood)];
      items.push(`<li class="${c.mood > 0 ? 'up' : 'down'}">컨디션 ${c.mood > 0 ? '↑' : '↓'} (${m.name})</li>`);
    }
    for (const [id, v] of Object.entries(c.friendship)) {
      if (v) items.push(`<li class="up">${E.supporterById(id).name} 유대 ${sign(v)}</li>`);
    }
    return items.length ? `<ul class="changes">${items.join('')}</ul>` : '';
  }

  // ---------------------------------------------------------------- 모달

  function showModal({ title, body, buttons, cls }) {
    return new Promise((resolve) => {
      $('modal-title').textContent = title;
      $('modal-body').innerHTML = body;
      $('modal').querySelector('.modal').className = `modal ${cls || ''}`;
      const box = $('modal-buttons');
      box.innerHTML = '';
      buttons.forEach((b, i) => {
        const btn = el('button', `btn ${b.cls || ''}`, `${b.label}${b.sub ? `<small>${b.sub}</small>` : ''}`);
        btn.onclick = () => {
          $('modal').hidden = true;
          resolve(i);
        };
        box.appendChild(btn);
      });
      $('modal').hidden = false;
      box.querySelector('button').focus();
    });
  }

  // ---------------------------------------------------------------- 결과

  function finish() {
    const sp = E.species(state);
    clearSave();
    $('result-char').innerHTML = `<span class="char-icon">${sp.icon}</span><div><b>${state.name}</b><br><small>${sp.name}</small></div>`;
    const r = E.overallRank(state);
    $('result-rank').innerHTML = `종합 평가 <span class="rank big rank-${rankCls(r)}">${r}</span> <small>스탯 합계 ${E.totalStats(state)}</small>`;
    renderStats($('result-stats'), null);
    const h = state.history;
    $('result-summary').textContent = `트레이닝 ${h.trainings}회 · 휴식 ${h.rests}회 · 외출 ${h.outings}회 · 실패 ${h.failures}회`;
    showScreen('result');
  }

  // ---------------------------------------------------------------- 초기화

  $('btn-start').onclick = startNew;
  $('btn-continue').onclick = continueGame;
  $('btn-rest').onclick = () => act('rest');
  $('btn-outing').onclick = () => act('outing');
  $('btn-restart').onclick = renderStart;
  $('input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startNew();
  });

  renderStart();
})();
