// ==UserScript==
// @name         선상24 예약 자동입력 (빅보스호·가가호 등)
// @namespace    reserv
// @version      2.0.0
// @description  일정 페이지에서 예약 오픈 대기 → 예약 화면 이동 → 인원/예약자/약관 동의까지 자동. 화면 위 "설정" 버튼에서 정보를 입력하세요.
// @match        https://*.sunsang24.com/ship/schedule_fleet*
// @match        https://*.sunsang24.com/mypage/reservation_ready/*
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
    openAt: '', startBeforeSec: 30, pollMs: 1000, autoSubmit: false,
  };
  const FIELDS = [
    { key: 'date', label: '출조일 (예약할 날짜)', type: 'date', required: true },
    { key: 'shipName', label: '배 이름', type: 'list', help: '배 이름 일부, 쉼표로 여러 개 가능 (예: 가가호). 날짜마다 여러 배가 나오는 사이트에서는 꼭 입력하세요. 비우면 그 날짜의 첫 번째 배' },
    { key: 'people', label: '예약 인원', type: 'number', min: 1, max: 30 },
    { key: 'name', label: '예약자명', type: 'text', help: '비우면 화면에 미리 채워진 이름을 그대로 씁니다' },
    { key: 'depositor', label: '입금자명', type: 'text', help: '입금자명 칸이 있는 배(예: 가가호)에서만 씁니다' },
    { key: 'phone', label: '휴대폰 번호', type: 'phone', help: '화면에 계정 번호가 이미 채워져 있으면 그대로 둡니다. 비어 있을 때만 사용' },
    { key: 'openAt', label: '예약 오픈 시각', type: 'datetime', help: '비우면 페이지를 열자마자 확인을 시작합니다' },
    { key: 'startBeforeSec', label: '오픈 몇 초 전부터 확인할지', type: 'number', min: 5, max: 600 },
    { key: 'pollMs', label: '확인 간격 (밀리초)', type: 'number', min: 500, max: 10000, help: '1000 이상 권장. 너무 짧으면 사이트에서 차단될 수 있습니다' },
    { key: 'autoSubmit', label: '"예약하기"와 확인창까지 자동으로 누르기', type: 'check', danger: '켜면 확인 없이 실제로 예약됩니다. 연습할 때는 반드시 끄세요.' },
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
    <div class="bar"><span class="msg"></span><span class="auto" hidden>자동 신청 켜짐</span><button class="gear" type="button">설정</button></div>
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

  // ===================== 예약 자동입력 =====================
  const [Y, M, D] = CONFIG.date.split('-').map(Number);
  const shipNames = [].concat(CONFIG.shipName || []).filter(Boolean);
  const ym = `${Y}${String(M).padStart(2, '0')}`;
  const FLAG = 'ss24_auto_schedule'; // 이 스크립트가 예약 화면으로 보냈다는 표시

  // 일정 페이지 HTML에서 원하는 날짜의 "바로예약" 일정번호 찾기
  function findSchedule(doc) {
    for (const td of doc.querySelectorAll('td.date_info')) {
      const m = td.textContent.match(/(\d+)월\s*(\d+)일/);
      if (!m || +m[1] !== M || +m[2] !== D) continue;
      const row = td.closest('tr');
      for (const btn of row.querySelectorAll('button.btn_user_reservation[data-schedule_no]')) {
        const ship = btn.closest('td.ship_info')?.textContent || '';
        if (!shipNames.length || shipNames.some((s) => ship.includes(s))) return btn.dataset.schedule_no;
      }
    }
    return null;
  }

  // 1) 일정 페이지: 오픈 시각까지 카운트다운 → 바로예약 버튼이 생길 때까지 확인 → 예약 화면으로 이동
  async function waitOnSchedule() {
    const label = `${M}월 ${D}일${shipNames.length ? ` ${shipNames.join('/')}` : ''}${CONFIG.openAt ? ` / 오픈 ${fmtTime(CONFIG.openAt)}` : ''}`;
    if (CONFIG.openAt) {
      const startAt = new Date(CONFIG.openAt).getTime() - CONFIG.startBeforeSec * 1000;
      while (Date.now() < startAt) {
        const s = Math.ceil((startAt - Date.now()) / 1000);
        const hms = new Date(s * 1000).toISOString().slice(11, 19);
        $msg.textContent = `${label} / 확인 시작까지 ${s >= 86400 ? Math.floor(s / 86400) + '일 ' : ''}${hms} (요청 없음)`;
        await sleep(Math.min(1000, startAt - Date.now()));
      }
    }
    let n = 0;
    while (true) {
      n++;
      status(`${label} 오픈 대기 중… (${n}회 확인)`);
      try {
        const html = await fetch(`/ship/schedule_fleet/${ym}`, { cache: 'no-store' }).then((r) => r.text());
        const no = findSchedule(new DOMParser().parseFromString(html, 'text/html'));
        if (no) {
          status(`예약 오픈 감지! 예약 화면으로 이동합니다 (일정 ${no})`);
          try { sessionStorage.setItem(FLAG, no); } catch (e) { /* 저장 불가 시 자동 제출만 생략됨 */ }
          location.href = `/mypage/reservation_ready/${no}`;
          return;
        }
      } catch (e) { /* 네트워크 오류는 다음 주기에 재시도 */ }
      await sleep(CONFIG.pollMs);
    }
  }

  // 2) 예약 화면: 인원 → 예약자 → 약관 동의 → (autoSubmit) 예약하기
  async function fillReservation() {
    const scheduleNo = location.pathname.split('/').pop();
    let fromScript = false;
    try { fromScript = sessionStorage.getItem(FLAG) === scheduleNo; sessionStorage.removeItem(FLAG); } catch (e) { /* 무시 */ }

    const btn = document.getElementById('btn_payment');
    if (!btn) {
      status('선상24에 로그인되어 있지 않습니다. 로그인한 뒤 이 화면을 새로고침하세요.');
      return;
    }

    // 인원: +/− 버튼을 눌러 맞춤 (최대 인원에 막히면 멈춤)
    const countEl = document.querySelector('.people_count');
    const count = () => parseInt(countEl?.textContent, 10) || 0;
    for (let i = 0; i < 40 && countEl && count() !== CONFIG.people; i++) {
      const before = count();
      document.querySelector(before < CONFIG.people ? 'a.plus' : 'a.minus')?.click();
      await sleep(80);
      if (count() === before) break;
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
    const seatBoxes = document.querySelectorAll('input[name="select_seat_nos[]"]').length;
    const notes = [];
    if (people !== CONFIG.people) notes.push(`인원이 ${CONFIG.people}명이 아니라 ${people}명입니다(최대 인원 제한)`);
    if (seatBoxes) notes.push('이 배는 좌석을 직접 골라야 합니다');
    const summary = `인원 ${people}명, 예약자 ${document.querySelector('input[name=name]')?.value || '(비어 있음)'}`;

    if (!CONFIG.autoSubmit || !fromScript || seatBoxes || people !== CONFIG.people) {
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

  if (location.pathname.startsWith('/mypage/reservation_ready/')) fillReservation();
  else waitOnSchedule();
})();
