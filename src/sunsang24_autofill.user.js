// ==UserScript==
// @name         선상24 예약 자동입력 (빅보스호·가가호 등)
// @namespace    reserv
// @version      (build.js가 채움)
// @description  일정 페이지에서 예약 오픈 대기 → 예약 화면 이동 → 인원/예약자/약관 동의까지 자동. 화면 위 "설정" 버튼에서 정보를 입력하세요.
// @match        https://*.sunsang24.com/ship/schedule_fleet*
// @match        https://*.sunsang24.com/mypage/reservation_ready/*
// @match        https://*.sunsang24.com/mypage/reservation_default_ready/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/seong-geon-choi/fishing-reserv/main/sunsang24_autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/seong-geon-choi/fishing-reserv/main/sunsang24_autofill.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 설정 항목 =====================
  // 값은 코드가 아니라 화면 위 "설정" 버튼에서 입력합니다. 이 사이트(주소)별로 브라우저에 저장되고, 스크립트가 업데이트돼도 유지됩니다.
  const STORE_KEY = 'fishingReserv.sunsang24';
  const DEFAULTS = {
    date: '', shipName: [], people: 2, name: '', depositor: '', phone: ['', '', ''],
    seatGroups: [], fallbackAnySeat: true, partialSeats: false, minPeople: 1,
    openAt: '', startBeforeSec: 30, pollMs: 1000, autoSubmit: false,
  };
  const FIELDS = [
    { key: 'date', w: 1, label: '출조일', type: 'date', required: true },
    { key: 'shipName', w: 3, label: '배 이름', type: 'list', help: '이름 일부, 쉼표로 여러 개 (예: 가가호). 여러 배가 나오는 사이트는 꼭 입력' },
    { key: 'people', w: 1, label: '예약 인원', type: 'number', min: 1, max: 30 },
    { key: 'name', w: 1, label: '예약자명', type: 'text', help: '비우면 화면 값 사용' },
    { key: 'depositor', w: 1, label: '입금자명', type: 'text', help: '칸이 있는 배만' },
    { key: 'phone', w: 1, label: '휴대폰 번호', type: 'phone', help: '화면이 비었을 때만' },
    { key: 'seatGroups', w: 2, label: '좌석 그룹 (좌석 선택이 있는 배만)', type: 'groups', help: '한 줄에 그룹 하나 (예: 2, 3, 4), 위쪽이 우선. 예약 화면의 자리배치도 그림 번호를 보고 적으세요. 좌석 선택이 없는 배에서는 무시' },
    { key: 'fallbackAnySeat', w: 2, label: '그룹으로 인원을 못 채우면 남은 좌석으로 채우기', type: 'check' },
//@@include fields_partial.js
    { key: 'openAt', w: 2, label: '예약 오픈 시각', type: 'datetime', help: '비우면 시작하자마자 확인' },
    { key: 'startBeforeSec', w: 1, label: '몇 초 전부터 확인', type: 'number', min: 5, max: 600 },
    { key: 'pollMs', w: 1, label: '확인 간격(ms)', type: 'number', min: 500, max: 10000, help: '1000 이상 권장' },
    { key: 'autoSubmit', w: 4, label: '"예약하기"와 확인창까지 자동으로 누르기', type: 'check', danger: '켜면 확인 없이 실제로 예약됩니다. 연습할 때는 끄세요.' },
  ];
  // =====================================================

//@@include core.js

//@@include fields.js

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `
    <style>
//@@include ui_css_base.css
//@@include ui_css_panel.css
      .seatimg img { display:block; max-width:100%; border-radius:6px; }
      .seatimg .help { margin-top:4px; }
    </style>
//@@include ui_bar.html
    <form class="panel" hidden></form>`;
//@@include ui_after.js

//@@include panel_ui.js
  function openPanel(note) {
    const c = loadConfig();
    const grid = panelTop(note);
    for (const f of FIELDS) {
      addField(grid, f, c);
      if (f.key === 'seatGroups') {
        // 좌석 그룹 칸 옆에 그 배의 자리배치도 그림
        grid.insertAdjacentHTML('beforeend', '<div class="span2 seatimg"><p class="help">자리배치도를 찾는 중…</p></div>');
        const cell = grid.querySelector('.seatimg');
        findSeatImg().then((src) => {
          cell.innerHTML = src
            ? `<a href="${src}" target="_blank" rel="noopener" title="크게 보기"><img src="${src}" alt="자리배치도"></a><p class="help">자리배치도 (그림을 누르면 크게 보기). 이 번호로 좌석 그룹을 적으세요.</p>`
            : '<p class="help">이 배는 자리배치도가 없습니다. 좌석 선택이 없는 배이거나, 설정의 배 이름·출조일로 예약 화면을 찾지 못했습니다.</p>';
        }).catch(() => { cell.innerHTML = '<p class="help">자리배치도를 가져오지 못했습니다.</p>'; });
      }
    }
    showPanel();
  }
  // 자리배치도 그림 주소 찾기: 예약 화면이면 이 화면에서, 아니면 설정의 배 이름으로 그 배의 예약 화면을 받아 봄
  // (받아 보기만 하므로 예약은 생기지 않음). 배치도는 배마다 고정이라 배 이름별로 기억
  const SEATIMG_KEY = 'fishingReserv.ss24SeatImg';
  async function findSeatImg() {
    const here = document.querySelector('.arrange_seating_wrap img');
    if (here) return here.src;
    const cfg = loadConfig();
    const names = [].concat(cfg.shipName || []).filter(Boolean);
    const key = names.join('|') || '(첫 번째 배)';
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(SEATIMG_KEY) || '{}'); } catch (e) { /* 무시 */ }
    if (key in cache) return cache[key];
    const pickBtn = (doc) => [...doc.querySelectorAll('button.btn_user_reservation[data-schedule_no]')].find((b) =>
      b.dataset.ship_status_code !== 'END_READY' && (!names.length || names.some((n) => (b.closest('td.ship_info')?.textContent || '').includes(n))));
    let btn = pickBtn(document);
    if (!btn && cfg.date) btn = pickBtn(new DOMParser().parseFromString(await fetch(`/ship/schedule_fleet/${cfg.date.slice(0, 7).replace('-', '')}`).then((r) => r.text()), 'text/html'));
    const url = btn && reserveUrl(btn);
    if (!url) return null; // 예약 화면을 못 찾음 (기억하지 않음)
    const doc = new DOMParser().parseFromString(await fetch(url, { cache: 'no-store' }).then((r) => r.text()), 'text/html');
    const src = doc.querySelector('.arrange_seating_wrap img')?.getAttribute('src') || '';
    cache[key] = src;
    try { localStorage.setItem(SEATIMG_KEY, JSON.stringify(cache)); } catch (e) { /* 무시 */ }
    return src;
  }

  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const c = loadConfig();
      for (const f of FIELDS) c[f.key] = readField(f, ui.getElementById('f_' + f.key));
      saveConfig(c);
      location.reload();
    } catch (err) {
      panel.querySelector('.err').textContent = String(err);
      panel.scrollTop = 0;
    }
  });
//@@include panel_drag.js

  const CONFIG = loadConfig();
  ui.querySelector('.auto').hidden = !CONFIG.autoSubmit;

  // ===================== 예약 자동입력 =====================
  const [Y, M, D] = CONFIG.date.split('-').map(Number);
  const shipNames = [].concat(CONFIG.shipName || []).filter(Boolean);
  const ym = `${Y}${String(M).padStart(2, '0')}`;
  const FLAG = 'ss24_auto_schedule'; // 이 스크립트가 예약 화면으로 보냈다는 표시

  // 일정 페이지 HTML에서 원하는 날짜의 "바로예약" 일정번호 찾기
  // 사이트의 "바로예약" 버튼과 같은 규칙: 일정번호가 있으면 일반 예약, 0이면 선택출항 예약(날짜/배번호)
  function reserveUrl(btn) {
    const no = +btn.dataset.schedule_no;
    if (no > 0) return `/mypage/reservation_ready/${no}`;
    return btn.dataset.sdate && btn.dataset.ship_no ? `/mypage/reservation_default_ready/${btn.dataset.sdate}/${btn.dataset.ship_no}` : null;
  }

  function findSchedule(doc) {
    for (const td of doc.querySelectorAll('td.date_info')) {
      const m = td.textContent.match(/(\d+)월\s*(\d+)일/);
      if (!m || +m[1] !== M || +m[2] !== D) continue;
      const row = td.closest('tr');
      for (const btn of row.querySelectorAll('button.btn_user_reservation[data-schedule_no]')) {
      if (btn.dataset.ship_status_code === 'END_READY') continue; // 전화 예약만 가능한 배
        const ship = btn.closest('td.ship_info')?.textContent || '';
        if (!shipNames.length || shipNames.some((s) => ship.includes(s))) return reserveUrl(btn);
      }
    }
    return null;
  }

  // 하루치 일정 응답에서 "바로예약" 일정번호 찾기 (날짜 칸 없이 배별 줄만 옴)
  function findInDay(doc) {
    for (const btn of doc.querySelectorAll('button.btn_user_reservation[data-schedule_no]')) {
      if (btn.dataset.ship_status_code === 'END_READY') continue; // 전화 예약만 가능한 배
      const ship = btn.closest('td.ship_info')?.textContent || '';
      if (!shipNames.length || shipNames.some((s) => ship.includes(s))) return reserveUrl(btn);
    }
    return null;
  }

  // 1) 일정 페이지: 오픈 시각까지 카운트다운 → 바로예약 버튼이 생길 때까지 확인 → 예약 화면으로 이동
  // 대기 중지: "중지"를 누르면 확인 요청을 멈추고 시작 버튼으로 돌아감
//@@include wait.js
  stopBtn.onclick = () => {
    stopped = true;
    stopBtn.hidden = true;
    showStart('대기를 중지했습니다. 다시 하려면 "예약 대기 시작"을 누르세요.');
  };

  // 로그인 확인: 마이페이지에 "로그아웃" 메뉴가 있으면 로그인 상태 (선상24는 배 사이트 주소마다 로그인이 따로)
  async function loggedIn() {
    try {
      const html = await fetch('/mypage/my', { cache: 'no-store' }).then((r) => r.text());
      return />\s*로그아웃\s*</.test(html);
    } catch (e) { return null; } // 확인 실패(혼잡 등)는 로그아웃으로 보지 않음
  }
  const LOGIN_MSG = `이 배 사이트(${location.hostname})에 로그인되어 있지 않습니다. 로그인한 뒤 이 화면을 새로고침하세요.`;

  async function waitOnSchedule() {
    const my = ++runId;
    stopped = false;
    const dead = () => stopped || my !== runId;
    stopBtn.hidden = false;
    // 대기 중 로그인이 풀리면 멈추고 알림 (풀린 채로 예약 화면에 가면 예약할 수 없음)
    const loginLost = async () => {
      if ((await loggedIn()) !== false || dead()) return false;
      stopped = true;
      stopBtn.hidden = true;
      status('로그인이 풀려 대기를 멈췄습니다. ' + LOGIN_MSG + ' 그다음 "예약 대기 시작"을 다시 누르세요.');
      return true;
    };
    const label = `${M}월 ${D}일${shipNames.length ? ` ${shipNames.join('/')}` : ''}${CONFIG.openAt ? ` / 오픈 ${fmtTime(CONFIG.openAt)}` : ''}`;
    let nextLoginCheck = 0; // 시작할 때, 그 뒤 5분마다 로그인 확인
    const ok = await countdown(label, dead, async () => {
      if (Date.now() < nextLoginCheck) return true;
      nextLoginCheck = Date.now() + 5 * 60 * 1000;
      return !(await loginLost());
    });
    if (!ok) return;
    if (await loginLost()) return; // 확인 요청을 시작하기 직전에 한 번 더
    const url = await pollOverlap(async (signal) => {
      // 하루치 일정(사이트가 예약 완료 후 쓰는 요청)만 받아 확인: 한 달치 페이지보다 15~20배 작음
      const r = await fetch(`/ship/schedule_fleet/${CONFIG.date}/0/simple_day1`, { cache: 'no-store', signal });
      if (r.ok) return findInDay(new DOMParser().parseFromString(`<table>${await r.text()}</table>`, 'text/html'));
      // 하루치 요청이 안 되면 한 달치 일정 페이지로 확인
      const html = await fetch(`/ship/schedule_fleet/${ym}`, { cache: 'no-store', signal }).then((x) => x.text());
      return findSchedule(new DOMParser().parseFromString(html, 'text/html'));
    }, dead, label);
    if (!url) return;
    stopBtn.hidden = true;
    status(`예약 오픈 감지! 예약 화면으로 이동합니다 (${url.split('/').slice(-2).join('/')})`);
    try { sessionStorage.setItem(FLAG, url); } catch (e) { /* 저장 불가 시 자동 제출만 생략됨 */ }
    location.href = url;
  }

//@@include seats.js

  // 2) 예약 화면: 인원 → 예약자 → 약관 동의 → (autoSubmit) 예약하기
  // fromScript: 일정 페이지에서 "예약 대기 시작"으로 들어온 경우만 true (자동 신청은 이때만)
  async function fillReservation(fromScript) {
    const btn = document.getElementById('btn_payment');
    if (!btn) {
      status('선상24에 로그인되어 있지 않습니다. 로그인한 뒤 이 화면을 새로고침하세요.');
      return;
    }

    // 인원: +/− 버튼을 눌러 맞춤 (최대 인원에 막히면 멈춤)
    const countEl = document.querySelector('.people_count');
    const count = () => parseInt(countEl?.textContent, 10) || 0;
    const setPeople = async (target) => {
      for (let i = 0; i < 40 && countEl && count() !== target; i++) {
        const before = count();
        document.querySelector(before < target ? 'a.plus' : 'a.minus')?.click();
        await sleep(80);
        if (count() === before) break;
      }
    };
    await setPeople(CONFIG.people);
    const cappedTo = count() !== CONFIG.people ? count() : 0; // 배의 최대 인원 제한에 막힘

    // 좌석 선택이 있는 배(예: 뉴항구호): 체크박스 목록 = 지금 빈 좌석. 좌석 그룹 규칙으로 인원수만큼 체크.
    // 사이트는 "체크 수 > 인원"이면 경고창을 띄우므로 인원을 먼저 맞춘 뒤, 인원수까지만 체크함
    const seatBoxes = [...document.querySelectorAll('input[name="select_seat_nos[]"]')];
    let seatPicks = [];
    let short = false; // 좌석이 모자라 자동 신청하지 않음
    if (seatBoxes.length) {
      const boxOf = (n) => seatBoxes.find((b) => +b.value === n && !b.disabled);
      const want = count();
      seatPicks = pickSeats(seatBoxes.filter((b) => !b.disabled).map((b) => +b.value), want);
      const n = seatShortage(seatPicks.length, want);
      short = !n;
      if (n && n < want) await setPeople(n); // 남은 좌석만큼만 예약: 인원을 먼저 줄임
      seatBoxes.forEach((b) => { if (b.checked) b.click(); }); // 이미 체크된 것은 해제 후 다시
      for (const n of seatPicks) { boxOf(n).click(); await sleep(30); }
      seatPicks = seatBoxes.filter((b) => b.checked).map((b) => +b.value);
    }

    const setVal = (sel, v) => { const el = document.querySelector(sel); if (el && v) el.value = v; };
    if (CONFIG.name) setVal('input[name=name]', CONFIG.name);
    if (CONFIG.depositor) setVal('input[name=deposit_name]', CONFIG.depositor);
    ['phone1', 'phone2', 'phone3'].forEach((f, i) => {
      const el = document.querySelector(`input[name=${f}]`);
      if (el && !el.value.trim()) setVal(`input[name=${f}]`, CONFIG.phone[i]);
    });

    const all = document.querySelector('input[name=all_check]');
    if (all && !all.checked) all.click();
    document.querySelectorAll('input[name="agree_rule[]"]').forEach((c) => { if (!c.checked) c.click(); });

    btn.scrollIntoView({ block: 'center' });
    btn.style.outline = '4px solid red';

    const people = count();
    const seatsShort = seatBoxes.length > 0 && seatPicks.length !== people;
    const notes = [];
    if (cappedTo) notes.push(`인원이 ${CONFIG.people}명이 아니라 ${cappedTo}명입니다(최대 인원 제한)`);
    if (seatsShort) notes.push(`좌석이 ${seatPicks.length}석만 골라졌습니다. 인원(${people}명)만큼 직접 골라 주세요`);
    const summary = `인원 ${people}명${seatBoxes.length ? (seatPicks.length ? `, 좌석 ${seatPicks.join(', ')}번` : ', 좌석 없음') : ''}, 예약자 ${document.querySelector('input[name=name]')?.value || '(비어 있음)'}`;

    if (!CONFIG.autoSubmit || !fromScript || short || seatsShort || cappedTo) {
      const why = CONFIG.autoSubmit && !fromScript ? ' (직접 연 화면이라 자동 신청은 하지 않습니다)' : '';
      status(`입력 완료: ${summary}. ${notes.join(', ')}${notes.length ? '. ' : ''}내용을 확인하고 빨간 테두리 "예약하기"를 누르세요.${why}`);
      return;
    }

    // 자동 제출: 사이트의 확인창(confirm)을 자동으로 "확인" 처리
    let confirmed = false;
    window.confirm = (msg) => { confirmed = true; console.log('[자동입력] 확인창 자동 승인:', msg); return true; };
    status(`${summary} 예약 신청 중…`);
    btn.click();
    await sleep(400);
    // 출항 임박 안내창이 뜬 경우 "동의함"
    const agree = document.getElementById('btn_imminent_departure_agree');
    if (!confirmed && agree && agree.offsetParent !== null) { agree.click(); await sleep(400); }
    if (!confirmed) btn.click();
  }

  // 필수 정보가 없으면 설정부터
  const missing = missingRequired(CONFIG);
  if (missing.length) {
    status('처음 사용하시나요? 설정에서 예약할 날짜를 먼저 입력하세요.');
    openPanel(`시작하려면 다음 항목을 입력하세요: ${missing.map((f) => f.label).join(', ')}`);
    return;
  }

  if (/^\/mypage\/reservation_(default_)?ready\//.test(location.pathname)) {
    const scheduleNo = location.pathname; // 이 스크립트가 보낸 예약 화면 주소와 비교
    let fromScript = false;
    try { fromScript = sessionStorage.getItem(FLAG) === scheduleNo; sessionStorage.removeItem(FLAG); } catch (e) { /* 무시 */ }
    const loggedOut = !document.getElementById('btn_payment') && document.querySelector('.btn_payment');
    if (fromScript && document.getElementById('btn_payment')) fillReservation(true);
    else if (fromScript && !loggedOut) {
      // 혼잡으로 예약 화면이 제대로 안 열림 → 시작 표시를 다시 남기고 잠시 뒤 다시 열기 (다시 열리면 이어서 진행)
      stopBtn.onclick = () => { stopped = true; stopBtn.hidden = true; status('다시 열기를 중지했습니다. 예약 화면을 직접 새로고침하면 "자동입력 시작" 버튼이 나옵니다.'); };
      reloadSoon('예약 화면이 제대로 열리지 않았습니다.', () => { try { sessionStorage.setItem(FLAG, scheduleNo); } catch (e) { /* 무시 */ } });
    }
    else if (loggedOut) status(LOGIN_MSG);
    else if (!document.getElementById('btn_payment')) status('예약 화면이 제대로 열리지 않았습니다. 새로고침(F5)하세요.');
    else {
      // 사이트의 "바로예약"으로 직접 연 화면: 버튼을 눌러야 입력 (설정을 먼저 확인·변경할 수 있게, 자동 신청은 하지 않음)
      status('이 예약 화면에서 자동입력을 하려면 "자동입력 시작"을 누르세요. 먼저 설정을 확인할 수 있습니다.');
      const b = ui.querySelector('.start');
      b.textContent = '자동입력 시작';
      b.hidden = false;
      b.onclick = () => { b.hidden = true; panel.hidden = true; fillReservation(false); };
    }
  }
  else showStart();

  // 일정 페이지는 평소에도 여는 곳이라, 버튼을 눌러야 대기를 시작 (설정을 먼저 확인·변경할 수 있게)
  async function showStart(msg) {
    if (new Date(CONFIG.date + 'T23:59:59') < new Date()) { status(`출조일(${CONFIG.date})이 이미 지났습니다. 설정에서 날짜를 바꾸세요.`); return; }
    if ((await loggedIn()) === false) { status(LOGIN_MSG); return; }
    const ship = shipNames.length ? ` ${shipNames.join('/')}` : '';
    status(msg || `${M}월 ${D}일${ship}: 설정을 확인하고 준비되면 "예약 대기 시작"을 누르세요.`);
    const btn = ui.querySelector('.start');
    btn.hidden = false;
    btn.onclick = () => { btn.hidden = true; panel.hidden = true; waitOnSchedule(); };
  }
})();
