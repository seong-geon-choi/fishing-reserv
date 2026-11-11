// ==UserScript==
// @name         더피싱 예약 자동입력 (만석호·나대세호·팀루피호·하이피싱호 등)
// @namespace    reserv
// @version      (build.js가 채움)
// @description  예약 목록에서 날짜·배 선택 → 예약 오픈 대기 → 낚시종류 선택 → 좌석/인원 → 예약자 정보 → 동의까지 자동. 화면 위 "설정" 버튼에서 정보를 입력하세요.
// @match        https://*.thefishing.kr/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/seong-geon-choi/fishing-reserv/main/thefishing_autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/seong-geon-choi/fishing-reserv/main/thefishing_autofill.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 예약 목록 페이지(index.php?mid=bk)와 예약 화면(popup/popu2.step1.php)에서만 동작.
  // @match를 사이트 전체로 둔 이유: Chrome의 Tampermonkey가 "index.php*" 규칙으로 ?mid=bk 주소를 잡지 못함
  const isList = /^\/(index\.php)?$/.test(location.pathname) && new URLSearchParams(location.search).get('mid') === 'bk';
  const isStep1 = /^\/_core\/module\/reservation_boat_[^/]+\/popu[p2]\.step1\.php$/.test(location.pathname);
  if (!isList && !isStep1) return;
  // 예약 화면은 예약 목록 페이지에서 "예약 대기 시작"으로 넘어온 경우(이 탭에 시작 표시가 있을 때)만 동작.
  // 사이트의 "예약하기"로 직접 연 예약 화면에서는 아무것도 표시하지 않음 (설정·좌석 고르기는 예약 목록 페이지에서)
  if (isStep1) {
    const q0 = new URLSearchParams(location.search);
    let started = false;
    try { started = sessionStorage.getItem('frs_target') === `${q0.get('date')}|${q0.get('PA_N_UID')}`; } catch (e) { /* 무시 */ }
    if (!started) return;
  }

  // ===================== 설정 항목 =====================
  // 값은 코드가 아니라 화면 위 "설정" 버튼에서 입력합니다. 이 사이트(주소)별로 브라우저에 저장되고, 스크립트가 업데이트돼도 유지됩니다.
  const STORE_KEY = 'fishingReserv.thefishing';
  const SIM_URL = 'https://seong-geon-choi.github.io/fishing-reserv/seat_simulator.html';
  const DEFAULTS = {
    date: '', shipName: [],
    name: '', depositor: '', tel: ['', '', ''],
    people: 2, fishKeywords: [], seatGroups: [], fallbackAnySeat: true, partialSeats: false, minPeople: 1,
    openAt: '', startBeforeSec: 30, pollMs: 700, autoSubmit: false,
    perShip: {}, // 배 번호(PA_N_UID)별 설정: { '3570': { fishKeywords, seatGroups, fallbackAnySeat } }
  };
  const FIELDS = [
    { key: 'date', w: 1, label: '출조일', type: 'date', help: '목록 페이지에서 시작할 때 사용' },
    { key: 'shipName', w: 3, label: '배 이름', type: 'list', help: '이름 일부, 쉼표로 여러 개 (예: 만석호)' },
    { key: 'name', w: 1, label: '예약자명', type: 'text', required: true },
    { key: 'depositor', w: 1, label: '입금자명', type: 'text', help: '예약자와 다를 때만' },
    { key: 'tel', w: 1, label: '휴대폰 번호', type: 'phone', required: true, help: '010-1234-5678' },
    { key: 'people', w: 1, label: '예약 인원', type: 'number', min: 1, max: 30 },
//@@include fields_partial.js
    { key: 'fishKeywords', w: 2, perShip: true, label: '낚시종류 키워드', type: 'list', help: '쉼표로 구분. 하나라도 들어간 맨 위 종류, 비우면 첫 번째' },
    { key: 'seatGroups', w: 2, perShip: true, label: '좌석 그룹', type: 'groups', help: '한 줄에 그룹 하나 (예: 7, 8, 9), 위쪽이 우선' },
    { key: 'fallbackAnySeat', w: 4, perShip: true, label: '그룹으로 인원을 못 채우면 남은 좌석으로 채우기', type: 'check' },
    { key: 'openAt', w: 2, label: '예약 오픈 시각', type: 'datetime', help: '비우면 시작하자마자 확인' },
    { key: 'startBeforeSec', w: 1, label: '몇 초 전부터 확인', type: 'number', min: 5, max: 600 },
    { key: 'pollMs', w: 1, label: '확인 간격(ms)', type: 'number', min: 300, max: 10000, help: '700~1000 권장' },
    { key: 'autoSubmit', w: 4, label: '"예약 신청하기"까지 자동으로 누르기', type: 'check', danger: '켜면 확인 없이 실제로 예약됩니다. 연습할 때는 끄세요.' },
  ];
  // =====================================================

//@@include core.js
  // 배별 설정을 덮어쓴 값. 배별 설정이 아직 없는 배는 예전(공통) 값을 그대로 씀
  const forShip = (c, shipId) => ({ ...c, ...((c.perShip || {})[shipId] || {}) });
  // 지금 화면의 배: 예약 화면은 주소의 배 번호, 목록 페이지는 설정의 배 이름으로 찾은 배
  function currentShip() {
    if (isStep1) {
      const id = new URLSearchParams(location.search).get('PA_N_UID');
      return id ? { id, name: document.title.split('>')[0].trim() || `배 ${id}` } : null;
    }
    const names = [].concat(loadConfig().shipName || []).filter(Boolean);
    return (names.length && shipLinks().find((s) => names.some((n) => s.name.includes(n)))) || null;
  }

//@@include fields.js

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `
    <style>
//@@include ui_css_base.css
      h3.shiphead { margin:18px 0 2px; padding-top:12px; border-top:1px solid #d5dce2; font-size:15px; color:#1c6fb8; }
      .shipnote { margin:0 0 10px; }
      .pickrow { margin:-6px 0 12px; }
//@@include ui_css_panel.css
      .simlink { font-size:12px; font-weight:700; color:#1c6fb8; }
      .pickpanel { position:fixed; left:50%; top:52px; transform:translateX(-50%); width:min(1120px, calc(100vw - 16px)); max-height:calc(100vh - 60px); overflow:auto;
        background:#fff; color:#1f2933; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.3); padding:0 14px 12px; font-size:13px; font-weight:400; }
      .pickpanel[hidden] { display:none; }
      .pp-head { margin:0 -14px 8px; padding:9px 12px 9px 14px; background:#1f2933; color:#fff; font-weight:700; border-radius:10px 10px 0 0;
        cursor:move; user-select:none; touch-action:none; display:flex; align-items:center; gap:8px; position:sticky; top:0; z-index:1; }
      .pp-head small { margin-left:auto; color:#9aa5b1; font-weight:400; }
      .pp-x { background:transparent; border:0; color:#fff; font-size:20px; line-height:1; padding:0 4px; }
      .pp-dates { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:8px; }
      .pp-dlabel { font-weight:700; margin-right:2px; }
      .pp-dchips { display:flex; flex-wrap:wrap; gap:6px; }
      .pp-dchip { padding:3px 10px; font-size:12px; border-radius:999px; }
      .pp-dchip.on { background:#1f2933; color:#fff; border-color:#1f2933; }
      .pp-body { display:grid; grid-template-columns:minmax(0, 2.3fr) minmax(250px, 1fr); gap:14px; align-items:start; }
      @media (max-width: 760px) { .pp-body { grid-template-columns:minmax(0, 1fr); } .pickpanel { top:8px; } }
      .pp-map { min-width:0; }
      .pp-svg { display:block; width:100%; height:auto; }
      .pp-svg[hidden] { display:none; }
      .pp-svg .seat { cursor:pointer; }
      .pp-mapmsg { margin:24px 0; text-align:center; color:#52606d; }
      .pp-legend { margin:4px 0 0; color:#52606d; font-size:12px; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      .lg { display:inline-block; width:12px; height:12px; border-radius:3px; border:1.5px solid #8396a6; background:#fff; }
      .lg.taken { background:#c3ccd5; border-color:#c3ccd5; }
      .pp-steps { margin:0 0 6px; padding-left:18px; line-height:1.5; }
      .pp-hint { margin:0 0 8px; color:#52606d; font-size:12px; }
      .pp-groups { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
      .pp-group { border:2px solid #d5dce2; border-radius:8px; padding:6px 8px; cursor:pointer; }
      .pp-group.active { background:#f3f7fb; }
      .pp-group .pp-top { display:flex; align-items:center; gap:6px; }
      .pp-group .pp-name { font-weight:700; }
      .pp-group .pp-now { font-size:11px; color:#fff; border-radius:4px; padding:0 5px; }
      .pp-group .pp-del { margin-left:auto; padding:2px 6px; font-size:12px; }
      .pp-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:5px; min-height:22px; }
      .pp-chip { display:inline-flex; align-items:center; gap:3px; border-radius:11px; padding:1px 4px 1px 8px; color:#fff; font-weight:700; font-size:12px; }
      .pp-chip { cursor:grab; touch-action:none; user-select:none; }
      .pp-chip.dragging { opacity:.55; outline:2px dashed #1f2933; cursor:grabbing; }
      .pp-chip button { border:0; background:rgba(255,255,255,.25); color:#fff; border-radius:50%; width:16px; height:16px; padding:0; font-size:11px; line-height:16px; }
      .pp-empty { color:#9aa5b1; font-size:12px; }
      .pp-warn { color:#b45309; font-size:11px; margin-top:3px; }
      .pp-add { width:100%; margin-bottom:8px; }
      .pp-btns { display:flex; gap:8px; justify-content:flex-end; }
    </style>
//@@include ui_bar.html
    <form class="panel" hidden></form>
    <div class="pickpanel" hidden>
      <div class="pp-head"><span class="pp-title">배 그림에서 좌석 고르기</span><small>⠿ 끌어서 이동</small><button type="button" class="pp-x" aria-label="닫기">×</button></div>
      <div class="pp-dates"><span class="pp-dlabel">날짜</span><span class="pp-dchips"></span></div>
      <div class="pp-body">
        <div class="pp-map"><p class="pp-mapmsg">예약 가능한 날짜를 찾는 중…</p><svg class="pp-svg" viewBox="0 0 960 304" hidden></svg>
          <p class="pp-legend"><i class="lg free"></i>빈 좌석 <i class="lg taken"></i>그 날 이미 예약됨 (좌석 그룹에는 넣을 수 있음)</p></div>
        <div class="pp-side">
          <ol class="pp-steps">
            <li>같이 앉고 싶은 좌석을 <b>원하는 순서대로</b> 누르세요. 다시 누르면 지금 그룹에서 빠집니다.</li>
            <li>다른 후보가 있으면 <b>+ 다음 후보 그룹 추가</b> 후 이어서 고르세요. <b>같은 좌석을 여러 그룹에 넣어도 됩니다.</b></li>
            <li>순서를 바꾸려면 그룹 안의 <b>번호 칩을 끌어서</b> 원하는 위치에 놓으세요.</li>
            <li>다 고르면 <b>완료</b>를 누르세요.</li>
          </ol>
          <p class="pp-hint"></p>
          <div class="pp-groups"></div>
          <button type="button" class="pp-add">+ 다음 후보 그룹 추가</button>
          <div class="pp-btns"><button type="button" class="pp-cancel">취소</button><button type="button" class="pp-done primary">완료</button></div>
        </div>
      </div>
    </div>`;
//@@include ui_after.js

//@@include panel_ui.js
  function openPanel(note) {
    const ship = currentShip();
    panel.dataset.shipId = ship ? ship.id : '';
    const all = loadConfig();
    const c = ship ? forShip(all, ship.id) : all;
    const grid = panelTop(note);
    let shipHeadDone = false;
    for (const f of FIELDS) {
      if (f.perShip && !shipHeadDone) {
        shipHeadDone = true;
        grid.insertAdjacentHTML('beforeend', ship
          ? `<h3 class="shiphead full">${ship.name} 전용 설정</h3><p class="help shipnote full">아래 항목은 이 배에만 적용됩니다. 같은 사이트의 다른 배는 따로 정합니다.</p>`
          : `<h3 class="shiphead full">배별 설정 (낚시종류·좌석)</h3><p class="help shipnote full">배 이름을 입력하고 저장하면, 그 배의 낚시종류·좌석 설정이 여기에 나타납니다.</p>`);
      }
      if (f.perShip && !ship) continue;
      addField(grid, f, c);
      if (f.key === 'seatGroups') {
        const id = 'f_' + f.key;
        ui.getElementById(id).closest('label').insertAdjacentHTML('beforeend', `<div class="pickrow"><button type="button" class="pickseat">배 그림에서 좌석 고르기</button></div>`);
        panel.querySelector('.pickseat').addEventListener('click', () => startPick(ship));
        // 좌석 시뮬레이터: 지금 배·인원·좌석 그룹(입력 중인 값)을 넘겨서 열기. 개인정보는 넘기지 않음
        ui.getElementById(id).closest('label').insertAdjacentHTML('beforeend',
          `<div class="pickrow"><a class="simlink" target="_blank" rel="noopener" href="${SIM_URL}">좌석 시뮬레이터에서 미리 보기 ↗</a></div>`);
        panel.querySelector('.simlink').addEventListener('click', (e) => {
          const groups = ui.getElementById('f_seatGroups').value.split('\n').map((l) => nums(l).join(',')).filter(Boolean).join('|');
          const p = new URLSearchParams({ ship: ship ? ship.id : '', people: ui.getElementById('f_people').value, groups, fallback: ui.getElementById('f_fallbackAnySeat')?.checked ? '1' : '0',
            partial: ui.getElementById('f_partialSeats')?.checked ? '1' : '0', min: ui.getElementById('f_minPeople')?.value || '1' });
          e.currentTarget.href = `${SIM_URL}#${p}`;
          if (!ship) return;
          // 이 배의 실제 좌석 배치와 가장 가까운 예약 가능 날짜의 예약 현황도 함께 넘김.
          // 가져오는 데 몇 초 걸리므로 새 탭을 먼저 열어 두고(팝업 차단 방지) 다 가져오면 주소를 넣음
          e.preventDefault();
          const w = window.open('', '_blank');
          if (w) w.document.write('<p style="font:16px sans-serif;padding:24px">예약 사이트에서 좌석 배치를 가져오는 중…</p>');
          siteLayout(ship.id).catch(() => null).then((lay) => {
            if (lay && lay.seats.length) {
              p.set('name', ship.name);
              p.set('date', lay.ds);
              p.set('layout', lay.seats.map((x) => `${x.slot}:${x.n}`).join(','));
              p.set('taken', lay.seats.filter((x) => x.taken).map((x) => x.n).join(','));
            }
            const url = `${SIM_URL}#${p}`;
            if (w) w.location.href = url; else window.open(url, '_blank');
          });
        });
      }
    }
    showPanel();
  }
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const c = loadConfig();
      const shipId = panel.dataset.shipId;
      for (const f of FIELDS) {
        if (!f.perShip) { c[f.key] = readField(f, ui.getElementById('f_' + f.key)); continue; }
        if (!shipId) continue; // 배를 모르는 화면에서는 배별 설정 칸이 없음
        c.perShip = c.perShip || {};
        (c.perShip[shipId] = c.perShip[shipId] || {})[f.key] = readField(f, ui.getElementById('f_' + f.key));
      }
      saveConfig(c);
      location.reload();
    } catch (err) {
      panel.querySelector('.err').textContent = String(err);
      panel.scrollTop = 0;
    }
  });
//@@include panel_drag.js

  // ---------- 배 그림에서 좌석 고르기 ----------
  // 그 배의 예약 가능한 날짜를 찾고, 그 날 예약 화면(낚시종류 선택된 화면)을 받아 좌석 배치만 읽어 직접 그림.
  // 화면을 받아 보기만 하므로 예약은 생기지 않음. 사이트 좌석판의 칸 좌표(reservation_boat_v5.2_seat1, 960x304)를 사용.
  const SLOT = {};
  [[35, 120], [53, 85], [81, 57], [117, 39], [157, 30]].forEach((p, i) => { SLOT[1 + i] = p; });
  for (let i = 0; i < 20; i++) SLOT[6 + i] = [200 + i * 34, 37];
  for (let i = 0; i < 7; i++) SLOT[26 + i] = [890, 36 + i * 33];
  [[157, 239], [117, 231], [81, 216], [53, 188], [35, 156]].forEach((p, i) => { SLOT[33 + i] = p; });
  for (let i = 0; i < 20; i++) SLOT[38 + i] = [200 + i * 34, 233];
  const GROUP_COLORS = ['#e8590c', '#1c6fb8', '#2b8a3e', '#862e9c', '#c2255c', '#5f3dc4'];
  const gColor = (i) => GROUP_COLORS[i % GROUP_COLORS.length];
  const pp = ui.querySelector('.pickpanel');
  const svg = pp.querySelector('.pp-svg');
  const mapMsg = pp.querySelector('.pp-mapmsg');
  let pick = null; // { ship, groups, active, before, hidden, dates: [{ds, url}], cur: 날짜 인덱스, seats: [{slot, n, taken}] }

  const stepUrl = (q) => new URL(`/_core/module/${moduleDir()}/popup.step1.php?${q}`, location.origin).href;
  function moduleDir() {
    const m = location.pathname.match(/\/_core\/module\/([^/]+)\//)
      || (document.querySelector('[onclick*="popup.step1.php"]')?.getAttribute('onclick') || '').match(/\/_core\/module\/([^/]+)\//);
    return m ? m[1] : 'reservation_boat_v5.2_seat1';
  }
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const parseHtml = (h) => new DOMParser().parseFromString(h, 'text/html');
  const radiosIn = (doc) => [...doc.querySelectorAll('input[type=radio][name=PS_N_UID]')];

  // 예약 가능한 날짜 찾기: 오늘부터 하루씩(6개씩 묶어) 확인, 최대 60일 · 8개까지
  // 시뮬레이터로 넘길 배치: 가장 가까운 예약 가능 날짜 하나의 좌석 배치·예약 현황 (한 번 읽으면 기억)
  const layoutCache = {};
  async function siteLayout(shipId) {
    if (layoutCache[shipId]) return layoutCache[shipId];
    const dates = await findOpenDates(shipId, () => {}, 1, () => true);
    if (!dates.length) return null;
    layoutCache[shipId] = { ds: dates[0].ds, seats: await loadSeats(dates[0].url) };
    return layoutCache[shipId];
  }

  // want: 찾을 날짜 수, alive: 계속 찾을지 (좌석 고르기 창을 닫으면 멈춤)
  async function findOpenDates(shipId, onFound, want = 8, alive = () => !!pick) {
    const found = [];
    const today = new Date();
    for (let i = 0; i < 60 && found.length < want && alive(); i += 6) {
      const batch = [];
      for (let j = i; j < i + 6 && j < 60; j++) {
        const d = new Date(today); d.setDate(today.getDate() + j);
        const ds = ymd(d);
        batch.push(fetch(stepUrl(`date=${ds}&PA_N_UID=${shipId}`), { cache: 'no-store' }).then((r) => r.text()).then((h) => {
          const r0 = radiosIn(parseHtml(h)).find((r) => !r.disabled);
          if (!r0) return null;
          const m = (r0.getAttribute('onclick') || '').match(/ps_url\('(\d+)',\s*'(\d+)',\s*'(\d*)',\s*'(\d+)'\)/);
          const [dd, p, ph, ps] = m ? m.slice(1) : [ds, shipId, '0', r0.value];
          return { ds, url: stepUrl(`date=${dd}&PA_N_UID=${p}&PH_N_UID=${ph || 0}&PS_N_UID=${ps}`) };
        }).catch(() => null));
      }
      for (const r of await Promise.all(batch)) if (r && found.length < want) { found.push(r); onFound(found); }
    }
    return found;
  }

  // 그 날 좌석 배치 읽기: 칸 번호(res_seatNN) + 좌석 번호 + 이미 예약됐는지
  async function loadSeats(url) {
    const doc = parseHtml(await fetch(url, { cache: 'no-store' }).then((r) => r.text()));
    const seats = [];
    for (const el of doc.querySelectorAll('.res_ship_seat [class*="res_seat"]')) {
      const slot = +((el.className.match(/res_seat(\d+)/) || [])[1]);
      const sp = el.querySelector('span');
      const n = sp && sp.textContent.trim();
      if (!SLOT[slot] || !/^\d+$/.test(n || '')) continue;
      seats.push({ slot, n: +n, taken: !(sp.classList.contains('res_num_view') && sp.getAttribute('onclick')) });
    }
    return seats;
  }

  function renderDates() {
    const chips = pp.querySelector('.pp-dchips');
    chips.innerHTML = pick.dates.map((d, i) => `<button type="button" class="pp-dchip ${i === pick.cur ? 'on' : ''}" data-i="${i}">${+d.ds.slice(4, 6)}/${+d.ds.slice(6, 8)}</button>`).join('')
      || '<span class="pp-empty">찾는 중…</span>';
  }

  function renderMap() {
    const NS = 'http://www.w3.org/2000/svg';
    if (!pick.seats || !pick.seats.length) { svg.toggleAttribute('hidden', true); return; }
    svg.toggleAttribute('hidden', false);
    svg.innerHTML = `<path d="M 6 152 C 30 70, 100 16, 190 14 L 932 14 Q 954 14 954 36 L 954 268 Q 954 290 932 290 L 190 290 C 100 288, 30 234, 6 152 Z" fill="#eef2f5" stroke="#9aabb9" stroke-width="3"/>
      <rect x="236" y="98" width="600" height="108" rx="10" fill="#f8fafb" stroke="#d5dce2"/>
      <text x="536" y="157" text-anchor="middle" font-size="15" fill="#52606d">${pick.ship.name}</text>
      <text x="150" y="157" text-anchor="middle" font-size="14" fill="#52606d">◀ 선수</text><text x="862" y="157" text-anchor="middle" font-size="14" fill="#52606d">선미</text>`;
    for (const st of pick.seats) {
      const [x, y] = SLOT[st.slot];
      // 같은 좌석이 여러 그룹에 있을 수 있음: 지금 고르는 그룹을 우선 표시, 다른 그룹에만 있으면 점선 테두리
      const inActive = (pick.groups[pick.active] || []).includes(st.n);
      const gi = inActive ? pick.active : pick.groups.findIndex((g) => g.includes(st.n));
      const others = pick.groups.filter((g, i) => i !== gi && g.includes(st.n)).length;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'seat');
      g.dataset.n = st.n;
      const color = gi >= 0 ? gColor(gi) : '#8396a6';
      g.innerHTML = `<rect x="${x}" y="${y}" width="32" height="32" rx="7" fill="${st.taken ? '#c3ccd5' : '#fff'}" stroke="${color}" stroke-width="${gi >= 0 ? 4 : 2}" ${gi >= 0 && !inActive ? 'stroke-dasharray="5 3"' : ''}/>
        <text x="${x + 16}" y="${y + 22}" text-anchor="middle" font-size="16" font-weight="600" fill="${st.taken ? '#fff' : '#1f2933'}">${st.n}</text>`
        + (gi >= 0 ? `<circle cx="${x + 32}" cy="${y}" r="10" fill="${color}" ${inActive ? '' : 'opacity="0.6"'}/><text x="${x + 32}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${pick.groups[gi].indexOf(st.n) + 1}</text>` : '')
        + (others ? `<text x="${x - 1}" y="${y + 42}" font-size="10" font-weight="700" fill="#52606d">+${others}그룹</text>` : '');
      svg.appendChild(g);
    }
  }

  function renderPick() {
    const people = parseInt(ui.getElementById('f_people')?.value, 10) || 0;
    renderDates();
    renderMap();
    pp.querySelector('.pp-hint').textContent = people ? `예약 인원 ${people}명: 그룹마다 ${people}자리 이상 고르면 그 그룹 안에서 자리를 잡습니다.` : '';
    pp.querySelector('.pp-groups').innerHTML = pick.groups.map((g, i) => {
      const chips = g.length
        ? g.map((n) => `<span class="pp-chip" data-g="${i}" data-n="${n}" style="background:${gColor(i)}" title="끌어서 순서 바꾸기">${n}<button type="button" data-g="${i}" data-n="${n}" title="${n}번 빼기">×</button></span>`).join('')
        : '<span class="pp-empty">배 그림에서 좌석을 누르세요</span>';
      const warn = g.length && people && g.length < people ? `<div class="pp-warn">인원 ${people}명보다 적어서 이 그룹만으로는 자리를 다 잡지 못합니다</div>` : '';
      return `<div class="pp-group ${i === pick.active ? 'active' : ''}" data-g="${i}" style="border-color:${i === pick.active ? gColor(i) : ''}">
        <div class="pp-top"><span class="pp-name" style="color:${gColor(i)}">${i + 1}순위</span>${i === pick.active ? `<span class="pp-now" style="background:${gColor(i)}">지금 고르는 중</span>` : ''}<button type="button" class="pp-del" data-g="${i}" title="이 그룹 지우기">🗑 삭제</button></div>
        <div class="pp-chips">${chips}</div>${warn}</div>`;
    }).join('');
    const total = pick.groups.reduce((a, g) => a + g.length, 0);
    status(`좌석 고르기 중: ${pick.groups.length}개 그룹, ${total}자리. 좌석 고르기 창에서 고치고 "완료"를 누르세요.`);
  }

  async function showDate(i) {
    pick.cur = i;
    pick.seats = null;
    svg.toggleAttribute('hidden', true);
    mapMsg.hidden = false;
    mapMsg.textContent = '배 그림을 불러오는 중…';
    renderDates();
    try {
      const seats = await loadSeats(pick.dates[i].url);
      if (!pick || pick.cur !== i) return;
      pick.seats = seats;
      mapMsg.hidden = !!seats.length;
      mapMsg.textContent = seats.length ? '' : '이 배는 좌석을 지정하지 않는 배입니다. 좌석 그룹은 쓰이지 않습니다.';
    } catch (e) {
      mapMsg.textContent = '배 그림을 불러오지 못했습니다. 다른 날짜를 눌러 보세요.';
    }
    if (pick) renderPick();
  }

  // 배 그림의 좌석 누르기: "지금 고르는 중"인 그룹 기준으로만 판단
  // 그 그룹에 없으면 추가(다른 그룹에 있어도 추가 → 그룹끼리 겹쳐도 됨), 이미 있으면 그 그룹에서만 빼기
  svg.addEventListener('click', (e) => {
    const g = e.target.closest('.seat');
    if (!g || !pick) return;
    const n = +g.dataset.n;
    const cur = pick.groups[pick.active];
    if (cur.includes(n)) cur.splice(cur.indexOf(n), 1);
    else cur.push(n);
    renderPick();
  });

  // 창 안의 클릭: 날짜 / 그룹 선택 / 좌석 빼기 / 그룹 삭제
  // 번호 칩을 끌어서 그룹 안 순서 바꾸기 (마우스·터치 모두). 같은 그룹 안에서만 옮김
  let chipDrag = null;
  let suppressClickUntil = 0;
  pp.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.pp-chip');
    if (!chip || e.target.closest('button') || !pick) return;
    e.preventDefault();
    chipDrag = { chip, box: chip.parentElement, g: +chip.dataset.g, moved: false, x: e.clientX, y: e.clientY };
    chip.setPointerCapture(e.pointerId);
  });
  pp.addEventListener('pointermove', (e) => {
    if (!chipDrag) return;
    if (!chipDrag.moved && Math.hypot(e.clientX - chipDrag.x, e.clientY - chipDrag.y) < 4) return; // 살짝 누른 건 끌기로 보지 않음
    chipDrag.moved = true;
    chipDrag.chip.classList.add('dragging');
    const over = ui.elementFromPoint(e.clientX, e.clientY)?.closest('.pp-chip');
    if (!over || over === chipDrag.chip || over.parentElement !== chipDrag.box) return;
    const r = over.getBoundingClientRect();
    const after = e.clientY > r.bottom || (e.clientY >= r.top && e.clientX > r.left + r.width / 2);
    chipDrag.box.insertBefore(chipDrag.chip, after ? over.nextSibling : over);
  });
  const endChipDrag = () => {
    if (!chipDrag) return;
    const d = chipDrag;
    chipDrag = null;
    d.chip.classList.remove('dragging');
    if (!d.moved) return;
    pick.groups[d.g] = [...d.box.querySelectorAll('.pp-chip')].map((c) => +c.dataset.n);
    suppressClickUntil = Date.now() + 300; // 끈 직후 따라오는 클릭(그룹 선택)은 무시
    renderPick();
  };
  pp.addEventListener('pointerup', endChipDrag);
  pp.addEventListener('pointercancel', endChipDrag);

  pp.addEventListener('click', (e) => {
    if (!pick || Date.now() < suppressClickUntil) return;
    const dchip = e.target.closest('.pp-dchip');
    const chipX = e.target.closest('.pp-chip button');
    const del = e.target.closest('.pp-del');
    const grp = e.target.closest('.pp-group');
    if (dchip) { showDate(+dchip.dataset.i); return; }
    if (chipX) {
      const g = pick.groups[+chipX.dataset.g];
      g.splice(g.indexOf(+chipX.dataset.n), 1);
    } else if (del) {
      const i = +del.dataset.g;
      pick.groups.splice(i, 1);
      if (!pick.groups.length) pick.groups.push([]);
      if (pick.active >= i) pick.active = Math.max(0, pick.active - 1);
    } else if (grp) {
      pick.active = +grp.dataset.g; // 이 그룹에 이어서 고르기
    } else return;
    renderPick();
  });
  pp.querySelector('.pp-add').onclick = () => {
    const empty = pick.groups.findIndex((g) => !g.length);
    if (empty >= 0) pick.active = empty;
    else { pick.groups.push([]); pick.active = pick.groups.length - 1; }
    renderPick();
  };

  async function startPick(ship) {
    if (!ship) return;
    const ta = ui.getElementById('f_seatGroups');
    const groups = ta.value.split('\n').map(nums).filter((g) => g.length);
    pick = { ship, groups: groups.length ? groups : [[]], active: 0, before: ta.value, hidden: {}, dates: [], cur: -1, seats: null };
    if (groups.length) { pick.groups.push([]); pick.active = pick.groups.length - 1; } // 기존 그룹은 두고 새 그룹부터
    for (const c of ['.gear', '.start', '.stop', '.ask']) { const el = ui.querySelector(c); if (el) { pick.hidden[c] = el.hidden; el.hidden = true; } }
    panel.hidden = true;
    pp.hidden = false;
    pp.querySelector('.pp-title').textContent = `배 그림에서 좌석 고르기 · ${ship.name}`;
    svg.toggleAttribute('hidden', true);
    mapMsg.hidden = false;
    mapMsg.textContent = '예약 가능한 날짜를 찾는 중… (예약 화면을 보기만 하고, 예약은 하지 않습니다)';
    renderPick();
    const dates = await findOpenDates(ship.id, (list) => {
      if (!pick) return;
      pick.dates = list.slice();
      if (pick.cur < 0) showDate(0); else renderDates();
    });
    if (pick && !dates.length) mapMsg.textContent = '앞으로 60일 안에 예약이 열린 날짜가 없어 배 그림을 가져오지 못했습니다. 좌석 그룹 칸에 번호를 직접 적거나 좌석 시뮬레이터를 이용하세요.';
  }
  function endPick(apply) {
    if (!pick) return;
    pp.hidden = true;
    for (const c in pick.hidden) ui.querySelector(c).hidden = pick.hidden[c];
    ui.getElementById('f_seatGroups').value = apply
      ? pick.groups.filter((g) => g.length).map((g) => g.join(', ')).join('\n')
      : pick.before;
    pick = null;
    svg.innerHTML = '';
    status(apply ? '좌석 그룹을 설정 창에 넣었습니다. "저장하고 새로고침"을 눌러야 저장됩니다.' : '좌석 고르기를 취소했습니다.');
    panel.hidden = false;
  }
  // 창은 제목줄을 끌어서 옮김 (가운데 정렬을 풀고 좌표로 이동)
  pp.querySelector('.pp-head').addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pp-x')) return;
    e.preventDefault();
    const head = e.currentTarget;
    const r = pp.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    pp.style.transform = 'none';
    pp.style.left = r.left + 'px';
    const move = (ev) => {
      pp.style.left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - pp.offsetWidth) + 'px';
      pp.style.top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 40) + 'px';
    };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  pp.querySelector('.pp-x').onclick = () => endPick(false);
  pp.querySelector('.pp-cancel').onclick = () => endPick(false);
  pp.querySelector('.pp-done').onclick = () => endPick(true);

  // 예약 화면에서는 이 배의 배별 설정(낚시종류·좌석)을 적용
  const CONFIG = isStep1 ? forShip(loadConfig(), new URLSearchParams(location.search).get('PA_N_UID')) : loadConfig();
  ui.querySelector('.auto').hidden = !CONFIG.autoSubmit;

  // ===================== 예약 목록 페이지: 날짜·배 이름으로 예약 화면 찾기 =====================
  // 배 이름 링크(…PA_N_UID=번호)는 예약 오픈 전에도 항상 있음
  function shipLinks() {
    const ships = new Map();
    for (const a of document.querySelectorAll('a[href*="PA_N_UID="]')) {
      const id = (a.getAttribute('href').match(/PA_N_UID=(\d+)/) || [])[1];
      const name = a.textContent.replace(/\s+/g, ' ').trim();
      if (id && name && !/^공지/.test(name) && !ships.has(id)) ships.set(id, name);
    }
    return [...ships].map(([id, name]) => ({ id, name }));
  }
  const SHIPS = isList ? shipLinks() : [];
  if (SHIPS.length) FIELDS.find((f) => f.key === 'shipName').help += ` 이 사이트의 배: ${SHIPS.map((s) => s.name).join(', ')}`;

  function startOnList() {
    const names = [].concat(CONFIG.shipName || []).filter(Boolean);
    const shipList = SHIPS.map((s) => s.name).join(', ');
    if (!CONFIG.date || !names.length) {
      status(`설정에서 출조일과 배 이름을 입력하면 여기서 예약 대기를 시작할 수 있습니다.`);
      return;
    }
    const ship = SHIPS.find((s) => names.some((n) => s.name.includes(n)));
    if (!ship) { status(`설정한 배 이름(${names.join(', ')})을 이 사이트에서 찾지 못했습니다. 이 사이트의 배: ${shipList}`); return; }
    if (new Date(CONFIG.date + 'T23:59:59') < new Date()) { status(`출조일(${CONFIG.date})이 이미 지났습니다. 설정에서 날짜를 바꾸세요.`); return; }
    const mod = (document.querySelector('[onclick*="popup.step1.php"]')?.getAttribute('onclick').match(/\/_core\/module\/([^/]+)\//) || [])[1] || 'reservation_boat_v5.2_seat1';
    const url = `/_core/module/${mod}/popup.step1.php?date=${CONFIG.date.replace(/-/g, '')}&PA_N_UID=${ship.id}`;
    status(`${CONFIG.date} ${ship.name}: 준비되면 "예약 대기 시작"을 누르세요. 예약 화면으로 이동해 오픈을 기다립니다.`);
    const btn = ui.querySelector('.start');
    btn.hidden = false;
    btn.onclick = () => { arm(`${CONFIG.date.replace(/-/g, '')}|${ship.id}`); location.href = url; };
  }

  // "예약 대기 시작"을 누른 날짜·배의 예약 화면에서만 자동으로 진행 (이 탭 안에서만 유지)
  // → 사이트의 "예약하기"로 다른 날짜·배 팝업을 열었을 때 자동입력/자동신청이 일어나지 않게
  const TARGET_KEY = 'frs_target';
  const arm = (target) => { try { sessionStorage.setItem(TARGET_KEY, target); } catch (e) { /* 저장 불가 시 매번 버튼 필요 */ } };

  // ===================== 예약 자동입력 =====================
  const q = new URLSearchParams(location.search);
  const date = q.get('date');
  const pa = q.get('PA_N_UID');

  // 낚시종류 선택지(라디오)만. 페이지에는 같은 이름의 숨은 칸(ps_form)도 있음
  const fishRadios = (doc = document) => [...doc.querySelectorAll('input[type=radio][name=PS_N_UID]')];

  // 낚시종류 고르기: 키워드가 하나라도 들어간 종류 중 맨 위, 없으면 첫 번째
  function pickFish(radios) {
    const usable = radios.filter((r) => !r.disabled);
    return usable.find((r) => CONFIG.fishKeywords.some((k) => (r.closest('tr')?.textContent || '').includes(k))) || usable[0];
  }
  // 낚시종류가 선택된 예약 화면 주소 (사이트의 ps_url(date, PA, PH, PS)과 같은 주소)
  function fishUrl(radio) {
    const m = (radio.getAttribute('onclick') || '').match(/ps_url\('(\d+)',\s*'(\d+)',\s*'(\d*)',\s*'(\d+)'\)/);
    const [d, p, ph, ps] = m ? m.slice(1) : [date, pa, '0', radio.value];
    return new URL(`./popup.step1.php?date=${d}&PA_N_UID=${p}&PH_N_UID=${ph || 0}&PS_N_UID=${ps}`, location.href).href;
  }
  const fishLabel = (r) => (r.closest('tr')?.textContent || r.value).replace(/\s+/g, ' ').trim();

  // 1) 오픈 전: 페이지를 새로고침하지 않고 fetch로 확인하다가, 열리면 낚시종류가 선택된 화면으로 바로 이동
  // 대기 중지: "중지"를 누르면 확인 요청을 멈추고, 이 탭의 시작 표시도 지워 새로고침해도 다시 시작하지 않음
//@@include wait.js
  stopBtn.onclick = () => {
    stopped = true;
    stopBtn.hidden = true;
    try { sessionStorage.removeItem(TARGET_KEY); } catch (e) { /* 무시 */ }
    showStep1Start('대기를 중지했습니다. 다시 하려면 "예약 대기 시작"을 누르세요.');
  };

  async function waitForOpen() {
    const my = ++runId;
    stopped = false;
    const dead = () => stopped || my !== runId;
    stopBtn.hidden = false;
    const openLabel = CONFIG.openAt ? ` 오픈 ${fmtTime(CONFIG.openAt)}` : '';
    if (!(await countdown(`${date}${openLabel}`, dead))) return;
    const radios = await pollOverlap(async (signal) => {
      const html = await fetch(location.href, { cache: 'no-store', signal }).then((r) => r.text());
      const found = fishRadios(new DOMParser().parseFromString(html, 'text/html'));
      return found.length ? found : null;
    }, dead, `${date}${openLabel}`);
    if (!radios) return;
    // 받은 화면에서 낚시종류를 골라, 그 종류가 선택된 예약 화면으로 바로 이동 (새로고침 + 선택 페이지 로딩 2번 → 1번)
    stopBtn.hidden = true;
    const pick = pickFish(radios);
    status(`오픈 감지! 낚시종류 "${fishLabel(pick)}" 화면으로 이동합니다…`);
    location.href = fishUrl(pick);
  }

  // 2) 이미 열린 화면에서 낚시종류 선택
  function selectFish() {
    const pick = pickFish(fishRadios());
    status('낚시종류 선택: ' + fishLabel(pick));
    location.href = fishUrl(pick);
  }

//@@include seats.js

  // 3) 좌석 → 예약자 정보 → 동의
  async function fillForm() {
    // 좌석이 있는 배인지: 좌석판에 번호 칸이 있으면 (빈 좌석이 0개여도)
    const seatShip = [...document.querySelectorAll('.res_ship_seat [class*="res_seat"] span')].some((s) => /^\d+$/.test(s.textContent.trim()));
    // 지금 고를 수 있는 좌석 (화면 순서). 이 브라우저에서 이미 눌러 둔 좌석(res_num_view_chosen: 다시 열린 화면 등)도 포함
    const seatSpans = [...document.querySelectorAll(`span[id^="c${date}${pa}"][onclick]`)].filter((el) => /\bres_num_view(_chosen)?\b/.test(el.className));
    const seatNo = (el) => Number(el.id.slice(`c${date}${pa}`.length));
    const freeSeats = seatSpans.map(seatNo);
    const chosen = seatSpans.filter((el) => el.classList.contains('res_num_view_chosen')).map(seatNo);
    let picks = [];
    let short = false; // 좌석이 모자라 자동 신청하지 않음
    if (seatShip) {
      picks = pickSeats(freeSeats, CONFIG.people);
      short = !seatShortage(picks.length, CONFIG.people);
      // 좌석을 누른 수만큼 인원이 정해짐 (남은 좌석만큼만 예약이면 그 인원으로).
      // 누를 때마다 선택/해제가 바뀌므로, 이미 눌러 둔 좌석은 고른 것만 두고 풀고, 나머지 고른 좌석만 누름
      const toggle = [...chosen.filter((n) => !picks.includes(n)), ...picks.filter((n) => !chosen.includes(n))];
      for (const n of toggle) { window.ticket_seat_click(date, pa, String(n)); await sleep(250); }
    } else {
      // 좌석지정이 없는 배/종류인 경우 인원만 선택
      document.getElementById('BI_IN').value = String(CONFIG.people);
      window.popup_ajax_step1();
    }
    // 인원/금액 반영(사이트 ajax) 완료 대기: 혼잡하면 느리니 최대 15초, 안 되면 한 번 더 요청
    const statEl = document.getElementById('temp_bi_stat');
    const settled = async (ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const idle = !(window.jQuery && window.jQuery.active > 0);
        if (idle && (!statEl || statEl.value === '확인')) return true;
        await sleep(100);
      }
      return false;
    };
    status('인원·금액 반영을 기다리는 중…');
    let applied = seatShip && !picks.length ? true : await settled(15000); // 누른 좌석이 없으면 기다릴 것도 없음
    if (!applied) {
      status('사이트 응답이 늦어 인원·금액을 다시 요청합니다…');
      window.popup_ajax_step1();
      applied = await settled(15000);
    }

    const set = (sel, v) => { const el = document.querySelector(sel); if (el) el.value = v; };
    set('[name=BI_NAME]', CONFIG.name);
    set('[name=BI_BANK]', CONFIG.depositor);
    set('[name=BI_TEL1]', CONFIG.tel[0]);
    set('[name=BI_TEL2]', CONFIG.tel[1]);
    set('[name=BI_TEL3]', CONFIG.tel[2]);

    const check = (name, val) => { const el = document.querySelector(`input[name=${name}][value="${val}"]`); if (el) el.click(); };
    check('agree', 'Y');
    check('BI_3JA', '1');
    check('BI_AD', '1');
    check('all_agree', 'Y');

    const btn = document.getElementById('submit');
    btn.scrollIntoView({ block: 'center' });
    btn.style.outline = '4px solid red';
    const seats = picks.length ? `좌석 ${picks.join(', ')}번` : seatShip ? '좌석 없음' : '좌석 지정 없음';
    if (short) {
      status(`${seats}: 잡을 수 있는 좌석이 설정 인원(${CONFIG.people}명)보다 적어 자동 신청하지 않았습니다. 인원과 좌석을 확인하고 직접 신청하세요.`);
      return;
    }
    if (!applied) {
      // 인원·금액이 확인되지 않은 채로 자동 신청하지 않음
      status(`${seats}: 사이트 응답이 없어 인원·금액이 확인되지 않았습니다. 화면의 인원과 금액을 확인하고 직접 신청하세요.`);
      return;
    }
    if (CONFIG.autoSubmit) {
      status(`${seats}, 인원 ${document.getElementById('BI_IN').value}명으로 예약 신청 중…`);
      btn.click(); // 사이트의 form_check 검증을 거쳐 제출됨
      return;
    }
    status(`입력 완료: ${seats}, 인원 ${document.getElementById('BI_IN').value}명. 내용을 확인하고 빨간 테두리 버튼을 누르세요.`);
  }

  // 필수 정보가 없으면 설정부터
  const missing = missingRequired(CONFIG);
  if (missing.length) {
    status('처음 사용하시나요? 설정에서 예약자 정보를 먼저 입력하세요.');
    openPanel(`시작하려면 다음 항목을 입력하세요: ${missing.map((f) => f.label).join(', ')}`);
    return;
  }

  function runStep1() {
    if (q.get('PS_N_UID')) {
      // 낚시종류까지 고른 화면인데 입력칸이 없으면 (혼잡으로 화면이 제대로 안 열림) 잠시 뒤 다시 열기
      if (document.getElementById('BI_IN') && document.getElementById('submit')) { fillForm(); return; }
      if (fishRadios().length || /예약할 수 없는/.test(document.body?.textContent || '')) { waitForOpen(); return; }
      reloadSoon('예약 화면이 제대로 열리지 않았습니다.');
      return;
    }
    if (fishRadios().length) selectFish();
    else waitForOpen();
  }

  function showStep1Start(msg) {
    status(msg);
    const btn = ui.querySelector('.start');
    btn.hidden = false;
    btn.onclick = () => { btn.hidden = true; panel.hidden = true; arm(`${date}|${pa}`); runStep1(); };
  }

  if (isList) startOnList();
  else runStep1(); // 예약 화면은 시작 표시가 있을 때만 여기까지 옴 (맨 위에서 확인)
})();
