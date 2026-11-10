// ==UserScript==
// @name         더피싱 예약 자동입력 (만석호·나대세호·팀루피호·하이피싱호 등)
// @namespace    reserv
// @version      2.1.0
// @description  예약 목록에서 날짜·배 선택 → 예약 오픈 대기 → 낚시종류 선택 → 좌석/인원 → 예약자 정보 → 동의까지 자동. 화면 위 "설정" 버튼에서 정보를 입력하세요.
// @match        https://*.thefishing.kr/index.php*
// @match        https://*.thefishing.kr/_core/module/reservation_boat_v5.2_seat1/popup.step1.php*
// @match        https://*.thefishing.kr/_core/module/reservation_boat_v5.2_seat1/popu2.step1.php*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/seong-geon-choi/fishing-reserv/main/thefishing_autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/seong-geon-choi/fishing-reserv/main/thefishing_autofill.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 예약 목록 페이지(index.php?mid=bk)와 예약 화면(step1)에서만 동작
  const isList = location.pathname.endsWith('/index.php');
  if (isList && new URLSearchParams(location.search).get('mid') !== 'bk') return;

  // ===================== 설정 항목 =====================
  // 값은 코드가 아니라 화면 위 "설정" 버튼에서 입력합니다. 이 사이트(주소)별로 브라우저에 저장되고, 스크립트가 업데이트돼도 유지됩니다.
  const STORE_KEY = 'fishingReserv.thefishing';
  const DEFAULTS = {
    date: '', shipName: [],
    name: '', depositor: '', tel: ['', '', ''],
    people: 2, fishKeywords: [], seatGroups: [], fallbackAnySeat: true,
    openAt: '', startBeforeSec: 30, pollMs: 700, autoSubmit: false,
  };
  const FIELDS = [
    { key: 'date', label: '출조일 (예약할 날짜)', type: 'date', help: '예약 목록 페이지에서 "예약 대기 시작"을 누를 때 사용합니다' },
    { key: 'shipName', label: '배 이름', type: 'list', help: '배 이름 일부, 쉼표로 여러 개 가능 (예: 만석호). 하나라도 맞는 배 중 목록의 첫 번째 배를 고릅니다.' },
    { key: 'name', label: '예약자명', type: 'text', required: true },
    { key: 'depositor', label: '입금자명', type: 'text', help: '예약자와 다를 때만 입력' },
    { key: 'tel', label: '휴대폰 번호', type: 'phone', required: true, help: '예: 010-1234-5678' },
    { key: 'people', label: '예약 인원', type: 'number', min: 1, max: 30 },
    { key: 'fishKeywords', label: '낚시종류 키워드', type: 'list', help: '쉼표로 구분 (예: 갑오징어, 쭈꾸미). 하나라도 들어간 종류 중 맨 위 것을 고릅니다. 비우면 첫 번째 종류' },
    { key: 'seatGroups', label: '좌석 그룹', type: 'groups', help: '한 줄에 그룹 하나 (예: 7, 8, 9). 위쪽 줄이 우선입니다. 좌석 지정이 없는 배에서는 무시됩니다' },
    { key: 'fallbackAnySeat', label: '그룹으로 인원을 못 채우면 남은 좌석으로 채우기', type: 'check' },
    { key: 'openAt', label: '예약 오픈 시각', type: 'datetime', help: '비우면 페이지를 열자마자 확인을 시작합니다' },
    { key: 'startBeforeSec', label: '오픈 몇 초 전부터 확인할지', type: 'number', min: 5, max: 600 },
    { key: 'pollMs', label: '확인 간격 (밀리초)', type: 'number', min: 300, max: 10000, help: '700~1000 권장. 너무 짧으면 사이트에서 차단될 수 있습니다' },
    { key: 'autoSubmit', label: '"예약 신청하기"까지 자동으로 누르기', type: 'check', danger: '켜면 확인 없이 실제로 예약됩니다. 연습할 때는 반드시 끄세요.' },
  ];
  // =====================================================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 설정 저장/불러오기 ----------
  const loadConfig = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; } };
  const saveConfig = (c) => localStorage.setItem(STORE_KEY, JSON.stringify(c));
  const fmtTime = (s) => (s || '').replace('T', ' ');

  // ---------- 상태 표시줄 + 설정 패널 (사이트 CSS와 섞이지 않게 Shadow DOM 사용) ----------
  const nums = (s) => (String(s).match(/\d+/g) || []).map(Number);
  const toText = (f, v) => f.type === 'list' ? (v || []).join(', ')
    : f.type === 'groups' ? (v || []).map((g) => g.join(', ')).join('\n')
    : f.type === 'phone' ? (v || []).filter(Boolean).join('-')
    : (v ?? '');
  function readField(f, el) {
    const s = f.type === 'check' ? '' : el.value.trim();
    let v;
    switch (f.type) {
      case 'check': return el.checked;
      case 'number': v = Number(s); if (!s || !Number.isInteger(v) || v < f.min || v > f.max) throw `${f.label}: ${f.min}~${f.max} 사이의 숫자를 입력하세요.`; return v;
      case 'list': v = s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean); break;
      case 'groups': v = s.split('\n').map(nums).filter((g) => g.length); break;
      case 'phone': {
        if (!s) { v = ['', '', '']; break; }
        const m = s.replace(/\D/g, '').match(/^(01\d)(\d{3,4})(\d{4})$/);
        if (!m) throw `${f.label}: 010-1234-5678 형식으로 입력하세요.`;
        v = [m[1], m[2], m[3]]; break;
      }
      case 'datetime':
        if (!s) { v = ''; break; }
        if (isNaN(new Date(s).getTime())) throw `${f.label}: 날짜와 시간을 다시 확인하세요.`;
        v = s.length === 16 ? s + ':00' : s; break;
      case 'date':
        if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw `${f.label}: 날짜를 선택하세요.`;
        v = s; break;
      default: v = s;
    }
    const empty = Array.isArray(v) ? !v.filter(Boolean).length : !v;
    if (f.required && empty) throw `${f.label}: 꼭 입력해야 하는 항목입니다.`;
    return v;
  }
  const missingRequired = (c) => FIELDS.filter((f) => f.required && (Array.isArray(c[f.key]) ? !c[f.key].filter(Boolean).length : !c[f.key]));

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; }
      .bar { display:flex; gap:8px; align-items:center; padding:8px 12px; background:#1f2933; color:#ffe14d; font-size:14px; font-weight:700; }
      .msg { flex:1; min-width:0; }
      .auto { background:#c92a2a; color:#fff; border-radius:4px; padding:2px 6px; font-size:12px; white-space:nowrap; }
      button { font:inherit; font-size:13px; cursor:pointer; border-radius:6px; padding:6px 12px; border:1px solid #9aa5b1; background:#fff; color:#1f2933; }
      button.primary { background:#1c6fb8; border-color:#1c6fb8; color:#fff; }
      .panel { background:#fff; color:#1f2933; max-width:520px; margin:0 auto; max-height:calc(100vh - 50px); overflow:auto; padding:16px; border-radius:0 0 10px 10px; box-shadow:0 8px 24px rgba(0,0,0,.25); font-size:14px; font-weight:400; }
      .panel[hidden] { display:none; }
      h2 { margin:0 0 4px; font-size:17px; }
      .sub { margin:0 0 12px; color:#52606d; font-size:13px; }
      label.f { display:block; margin:0 0 12px; }
      label.f > span { display:block; font-weight:700; margin-bottom:4px; }
      label.f > span b { color:#c92a2a; }
      input[type=text], input[type=number], input[type=date], input[type=datetime-local], textarea { width:100%; font-size:15px; padding:8px; border:1px solid #9aa5b1; border-radius:6px; background:#fff; color:#1f2933; }
      textarea { min-height:88px; font-family:Consolas, monospace; }
      label.c { display:flex; gap:8px; align-items:flex-start; margin:0 0 12px; font-weight:700; }
      label.c input { width:20px; height:20px; margin:0; flex:none; }
      .help { display:block; color:#52606d; font-size:12px; margin-top:3px; font-weight:400; }
      .danger { color:#c92a2a; }
      .err { background:#fde8e8; color:#c92a2a; border-radius:6px; padding:8px; margin:0 0 12px; }
      .err:empty { display:none; }
      .btns { display:flex; gap:8px; justify-content:flex-end; }
    </style>
    <div class="bar"><span class="msg"></span><span class="auto" hidden>자동 신청 켜짐</span><button class="start primary" type="button" hidden>예약 대기 시작</button><button class="gear" type="button">설정</button></div>
    <form class="panel" hidden></form>`;
  document.documentElement.appendChild(host);
  const $msg = ui.querySelector('.msg');
  const panel = ui.querySelector('.panel');
  const status = (m) => { $msg.textContent = m; console.log('[자동입력]', m); };

  function openPanel(note) {
    const c = loadConfig();
    panel.innerHTML = `<h2>예약 자동입력 설정</h2>
      <p class="sub">이 사이트(${location.hostname})에 저장됩니다. 다른 업체 사이트에서는 따로 입력하세요.</p>
      <p class="err">${note || ''}</p>`;
    for (const f of FIELDS) {
      const id = 'f_' + f.key;
      const help = f.help ? `<span class="help">${f.help}</span>` : '';
      if (f.type === 'check') {
        panel.insertAdjacentHTML('beforeend', `<label class="c ${f.danger ? 'danger' : ''}"><input type="checkbox" id="${id}" ${c[f.key] ? 'checked' : ''}><span>${f.label}${f.danger ? `<span class="help danger">${f.danger}</span>` : help}</span></label>`);
        continue;
      }
      const input = f.type === 'groups' ? `<textarea id="${id}"></textarea>`
        : `<input id="${id}" type="${{ number: 'number', datetime: 'datetime-local', date: 'date' }[f.type] || 'text'}" ${f.type === 'datetime' ? 'step="1"' : ''} ${f.type === 'phone' ? 'inputmode="tel"' : ''}>`;
      panel.insertAdjacentHTML('beforeend', `<label class="f"><span>${f.label}${f.required ? ' <b>*</b>' : ''}</span>${input}${help}</label>`);
      ui.getElementById(id).value = toText(f, c[f.key]);
    }
    panel.insertAdjacentHTML('beforeend', `<div class="btns"><button type="button" class="close">닫기</button><button type="submit" class="primary">저장하고 다시 시작</button></div>`);
    panel.querySelector('.close').onclick = () => { panel.hidden = true; };
    panel.hidden = false;
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
  ui.querySelector('.gear').onclick = () => (panel.hidden ? openPanel() : (panel.hidden = true));

  const CONFIG = loadConfig();
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
    btn.onclick = () => { location.href = url; };
  }

  // ===================== 예약 자동입력 =====================
  const q = new URLSearchParams(location.search);
  const date = q.get('date');
  const pa = q.get('PA_N_UID');

  // 낚시종류 선택지(라디오)만. 페이지에는 같은 이름의 숨은 칸(ps_form)도 있음
  const fishRadios = (doc = document) => [...doc.querySelectorAll('input[type=radio][name=PS_N_UID]')];

  // 1) 오픈 전: 페이지를 새로고침하지 않고 fetch로 확인하다가 열리면 reload
  async function waitForOpen() {
    const openLabel = CONFIG.openAt ? ` 오픈 ${fmtTime(CONFIG.openAt)}` : '';
    // 오픈 시각이 설정돼 있으면 (오픈 - startBeforeSec)까지는 요청 없이 카운트다운만
    if (CONFIG.openAt) {
      const startAt = new Date(CONFIG.openAt).getTime() - CONFIG.startBeforeSec * 1000;
      while (Date.now() < startAt) {
        const s = Math.ceil((startAt - Date.now()) / 1000);
        const hms = new Date(s * 1000).toISOString().slice(11, 19);
        $msg.textContent = `${date}${openLabel} / 확인 시작까지 ${s >= 86400 ? Math.floor(s / 86400) + '일 ' : ''}${hms} (요청 없음)`;
        await sleep(Math.min(1000, startAt - Date.now()));
      }
    }
    let n = 0;
    while (true) {
      n++;
      status(`${date} 오픈 대기 중…${openLabel} (${n}회 확인)`);
      try {
        const html = await fetch(location.href, { cache: 'no-store' }).then((r) => r.text());
        if (fishRadios(new DOMParser().parseFromString(html, 'text/html')).length) { status('오픈 감지! 새로고침'); location.reload(); return; }
      } catch (e) { /* 네트워크 오류는 다음 주기에 재시도 */ }
      await sleep(CONFIG.pollMs);
    }
  }

  // 2) 낚시종류 선택 (클릭하면 사이트가 PS_N_UID를 붙여 페이지를 다시 로드함)
  function selectFish() {
    const radios = fishRadios().filter((r) => !r.disabled);
    const pick = radios.find((r) => CONFIG.fishKeywords.some((k) => (r.closest('tr')?.innerText || '').includes(k))) || radios[0];
    status('낚시종류 선택: ' + (pick.closest('tr')?.innerText.replace(/\s+/g, ' ').trim() || pick.value));
    pick.click();
  }

  // 3) 좌석 → 예약자 정보 → 동의
  async function fillForm() {
    const seatEl = (n) => document.getElementById(`c${date}${pa}${n}`);
    const isFree = (n) => { const el = seatEl(n); return el && el.getAttribute('onclick') && el.classList.contains('res_num_view'); };

    const group = CONFIG.seatGroups.find((g) => g.filter(isFree).length >= CONFIG.people);
    let picks = (group || [...new Set(CONFIG.seatGroups.flat())]).filter(isFree).slice(0, CONFIG.people);
    if (picks.length < CONFIG.people && CONFIG.fallbackAnySeat) {
      const others = [...document.querySelectorAll(`span[id^="c${date}${pa}"].res_num_view[onclick]`)]
        .map((el) => Number(el.id.slice(`c${date}${pa}`.length)))
        .filter((n) => !picks.includes(n));
      picks = picks.concat(others.slice(0, CONFIG.people - picks.length));
    }

    if (picks.length) {
      for (const n of picks) { window.ticket_seat_click(date, pa, String(n)); await sleep(250); }
    } else {
      // 좌석지정이 없는 배/종류인 경우 인원만 선택
      document.getElementById('BI_IN').value = String(CONFIG.people);
      window.popup_ajax_step1();
    }
    // 인원/금액 ajax 완료 대기
    for (let i = 0; i < 40 && window.jQuery && window.jQuery.active > 0; i++) await sleep(100);

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
    const seats = picks.length ? `좌석 ${picks.join(', ')}번` : '좌석 지정 없음';
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

  if (isList) startOnList();
  else if (!fishRadios().length) waitForOpen();
  else if (!q.get('PS_N_UID')) selectFish();
  else fillForm();
})();
