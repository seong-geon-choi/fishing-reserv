// ==UserScript==
// @name         선상24 예약 자동입력 (빅보스호·가가호 등)
// @namespace    reserv
// @version      2.5.5.1111-155311
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
    { key: 'partialSeats', w: 4, label: '좌석이 인원보다 적으면 남은 좌석만큼만 예약', type: 'check', help: '끄면 좌석이 모자랄 때 자동 신청하지 않고 안내만 합니다' },
    { key: 'minPeople', w: 1, label: '최소 인원', type: 'number', min: 1, max: 30, help: '남은 좌석만큼 예약할 때 이 인원 이상이어야 진행' },
    { key: 'openAt', w: 2, label: '예약 오픈 시각', type: 'datetime', help: '비우면 시작하자마자 확인' },
    { key: 'startBeforeSec', w: 1, label: '몇 초 전부터 확인', type: 'number', min: 5, max: 600 },
    { key: 'pollMs', w: 1, label: '확인 간격(ms)', type: 'number', min: 500, max: 10000, help: '1000 이상 권장' },
    { key: 'autoSubmit', w: 4, label: '"예약하기"와 확인창까지 자동으로 누르기', type: 'check', danger: '켜면 확인 없이 실제로 예약됩니다. 연습할 때는 끄세요.' },
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
      .ver { font-size:12px; font-weight:400; color:#52606d; }
      .ask { display:inline-flex; gap:6px; }
      .ask[hidden] { display:none; }
      .toasts { position:fixed; left:50%; transform:translateX(-50%); width:min(560px, calc(100vw - 16px)); display:flex; flex-direction:column; gap:6px; pointer-events:none; }
      .toast { background:#1f2933; color:#fff; border-left:5px solid #ffe14d; border-radius:8px; padding:10px 14px; font-size:14px; font-weight:700; box-shadow:0 6px 20px rgba(0,0,0,.3); transition:opacity .4s; }
      /* 떠 있는 설정 창 + 한 화면 격자 배치 */
      .panel { position:fixed; margin:0; max-width:none; width:min(820px, calc(100vw - 16px)); max-height:calc(100vh - 16px); border-radius:10px; padding:0 16px 14px; }
      .phead { display:flex; align-items:center; gap:8px; margin:0 -16px 8px; padding:9px 12px 9px 16px; background:#1f2933; color:#fff;
        border-radius:10px 10px 0 0; cursor:move; user-select:none; touch-action:none; position:sticky; top:0; z-index:1; }
      .phead b { font-size:15px; }
      .phead .ver { color:#c9d3dc; }
      .phead .grip { color:#9aa5b1; font-size:12px; font-weight:400; margin-left:auto; }
      .phead .x { background:transparent; border:0; color:#fff; font-size:20px; line-height:1; padding:0 4px; cursor:pointer; }
      .sub { margin:0 0 6px; font-size:12px; }
      .err { margin:0 0 8px; }
      .grid4 { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px 12px; align-items:start; }
      .span1 { grid-column:span 1; } .span2 { grid-column:span 2; } .span3 { grid-column:span 3; } .span4, .full { grid-column:1 / -1; }
      @media (max-width: 640px) { .grid4 { grid-template-columns:repeat(2, minmax(0, 1fr)); } .span3 { grid-column:1 / -1; } }
      label.f { margin:0; min-width:0; }
      label.f > span { font-size:13px; margin-bottom:2px; }
      input[type=text], input[type=number], input[type=date], input[type=datetime-local], textarea { font-size:14px; padding:6px 8px; }
      textarea { min-height:64px; }
      label.c { margin:0; font-size:13px; align-items:center; }
      label.c input { width:18px; height:18px; }
      .help { font-size:11px; line-height:1.35; margin-top:2px; }
      h3.shiphead { margin:6px 0 0; padding-top:8px; font-size:14px; }
      .shipnote { margin:-4px 0 0; }
      .pickrow { margin:4px 0 0; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .pickrow button { padding:4px 10px; font-size:12px; }
      .btns { margin-top:12px; }
      .seatimg img { display:block; max-width:100%; border-radius:6px; }
      .seatimg .help { margin-top:4px; }
    </style>
    <div class="bar"><span class="msg"></span><span class="auto" hidden>자동 신청 켜짐</span><button class="start primary" type="button" hidden>예약 대기 시작</button><span class="ask" hidden><button class="wait1" type="button">1분 더 기다리기</button><button class="cut" type="button">끊고 새로 요청</button></span><button class="stop" type="button" hidden>중지</button><button class="gear" type="button">설정</button></div>
    <form class="panel" hidden></form>`;
  document.documentElement.appendChild(host);
  // 상태 바가 사이트 위쪽 메뉴를 가리지 않게, 바 높이만큼 페이지를 아래로 밀기
  const $bar = ui.querySelector('.bar');
  new ResizeObserver(() => { document.documentElement.style.paddingTop = $bar.offsetHeight + 'px'; }).observe($bar);
  const $msg = ui.querySelector('.msg');
  const panel = ui.querySelector('.panel');
  const status = (m) => { $msg.textContent = m; console.log('[자동입력]', m); };
  // 잠깐 보였다가 저절로 사라지는 안내 (화면을 막지 않고, 누를 필요 없음)
  const $toasts = document.createElement('div');
  $toasts.className = 'toasts';
  ui.appendChild($toasts);
  function toast(m, ms = 7000) {
    console.log('[자동입력]', m);
    $toasts.style.top = $bar.offsetHeight + 8 + 'px';
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = m;
    $toasts.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, ms);
  }

  // 설정 창 머리 + 빈 입력 칸 격자. 버전 "2.3.1.1110-225502" (기본 버전.월일-시분초) → "버전 2.3.1 · 수정 11-10 22:55:02"
  function panelTop(note) {
    const raw = typeof GM_info !== 'undefined' ? GM_info.script.version : '';
    const vm = raw.match(/^(\d+\.\d+\.\d+)\.(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    const ver = !raw ? '' : vm ? `버전 ${vm[1]} · 수정 ${vm[2]}-${vm[3]} ${vm[4]}:${vm[5]}:${vm[6]}` : `버전 ${raw}`;
    panel.innerHTML = `<div class="phead" title="끌어서 옮길 수 있습니다"><b>예약 자동입력 설정</b><span class="ver">${ver}</span><span class="grip">⠿ 끌어서 이동</span><button type="button" class="x" aria-label="닫기">×</button></div>
      <p class="sub">이 사이트(${location.hostname})에 저장됩니다. 다른 업체 사이트에서는 따로 입력하세요.</p>
      <p class="err">${note || ''}</p><div class="grid4"></div>`;
    return panel.querySelector('.grid4');
  }
  // 설정 칸 하나 (체크박스 또는 입력칸, 지금 값으로 채움)
  function addField(grid, f, c) {
    const id = 'f_' + f.key;
    const help = f.help ? `<span class="help">${f.help}</span>` : '';
    if (f.type === 'check') {
      grid.insertAdjacentHTML('beforeend', `<label class="c span4 ${f.danger ? 'danger' : ''}"><input type="checkbox" id="${id}" ${c[f.key] ? 'checked' : ''}><span>${f.label}${f.danger ? `<span class="help danger">${f.danger}</span>` : help}</span></label>`);
      return;
    }
    const input = f.type === 'groups' ? `<textarea id="${id}"></textarea>`
      : `<input id="${id}" type="${{ number: 'number', datetime: 'datetime-local', date: 'date' }[f.type] || 'text'}" ${f.type === 'datetime' ? 'step="1"' : ''} ${f.type === 'phone' ? 'inputmode="tel"' : ''}>`;
    grid.insertAdjacentHTML('beforeend', `<label class="f span${f.w || 1}"><span>${f.label}${f.required ? ' <b>*</b>' : ''}</span>${input}${help}</label>`);
    ui.getElementById(id).value = toText(f, c[f.key]);
  }
  // 설정 창 아래 버튼을 붙이고 보이기
  function showPanel() {
    panel.insertAdjacentHTML('beforeend', `<div class="btns"><button type="button" class="close">닫기</button><button type="submit" class="primary">저장하고 새로고침</button></div>`);
    panel.querySelector('.close').onclick = () => { panel.hidden = true; };
    panel.querySelector('.x').onclick = () => { panel.hidden = true; };
    panel.hidden = false;
    placePanel();
  }
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
  // ---------- 설정 창 끌어서 옮기기 (위치는 이 사이트에 기억) ----------
  const POS_KEY = 'fishingReserv.panelPos';
  function placePanel(x, y) {
    if (x === undefined) {
      let p = null;
      try { p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { /* 무시 */ }
      x = p ? p.x : (window.innerWidth - panel.offsetWidth) / 2;
      y = p ? p.y : 48;
    }
    // 화면 밖으로 나가지 않게 (머리 부분은 항상 보이게)
    x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - panel.offsetWidth));
    y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 48));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    return { x, y };
  }
  panel.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.phead');
    if (!head || e.target.closest('.x')) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => placePanel(ev.clientX - dx, ev.clientY - dy);
    const up = (ev) => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      const pos = placePanel(ev.clientX - dx, ev.clientY - dy);
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (err) { /* 무시 */ }
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  window.addEventListener('resize', () => { if (!panel.hidden) placePanel(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0); });

  ui.querySelector('.gear').onclick = () => (panel.hidden ? openPanel() : (panel.hidden = true));

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
  let stopped = false;
  let runId = 0; // 중지 후 다시 시작해도 이전 대기 루프가 함께 돌지 않게
  const stopBtn = ui.querySelector('.stop');

  // 오픈 시각(설정)까지 요청 없이 카운트다운 (서버 시계 기준). 끝까지 기다렸으면 true, 중지되면 false
  // tick: 1초마다 함께 할 일 (false를 돌려주면 멈춤)
  async function countdown(label, dead, tick) {
    if (CONFIG.openAt) {
      status('서버 시계를 확인하는 중…');
      await syncClock();
      const startAt = new Date(CONFIG.openAt).getTime() - CONFIG.startBeforeSec * 1000;
      while (serverNow() < startAt) {
        if (dead() || (tick && !(await tick()))) return false;
        const s = Math.ceil((startAt - serverNow()) / 1000);
        const hms = new Date(s * 1000).toISOString().slice(11, 19);
        $msg.textContent = `${label} / 확인 시작까지 ${s >= 86400 ? Math.floor(s / 86400) + '일 ' : ''}${hms} (요청 없음)${offsetNote()}`;
        await sleep(Math.min(1000, startAt - serverNow()));
      }
    }
    return !dead();
  }

  // ---------- 서버 시계 보정: 사이트 응답의 Date 헤더로 PC 시계와의 차이를 잼 ----------
  let clockOffset = 0; // 서버시각 - PC시각 (ms)
  function serverNow() { return Date.now() + clockOffset; }
  async function syncClock() {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      try {
        const t0 = Date.now();
        const r = await fetch('/favicon.ico', { method: 'HEAD', cache: 'no-store' });
        const t1 = Date.now();
        const d = Date.parse(r.headers.get('date') || '');
        if (!isNaN(d)) samples.push(d + 500 - (t0 + t1) / 2); // Date 헤더는 초 단위라 0.5초 보정
      } catch (e) { /* 실패하면 PC 시계 사용 */ }
    }
    if (samples.length) clockOffset = samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  }
  function offsetNote() {
    return Math.abs(clockOffset) >= 1000
      ? ` · 서버 시계 기준(PC가 ${Math.round(Math.abs(clockOffset) / 1000)}초 ${clockOffset > 0 ? '늦음' : '빠름'})` : '';
  }

  // ---------- 겹쳐 보내기: 응답이 늦어도 끊지 않고 기다리되, 5초 넘게 응답이 없으면 하나 더 보냄 (최대 3개) ----------
  // probe(signal) → 열렸으면 결과, 아니면 null
  async function pollOverlap(probe, dead, label) {
    const MAX_INFLIGHT = 3, STAGGER_MS = 5000, ASK_AFTER_MS = 60000;
    let found = null, sent = 0, lastSent = 0;
    const reqs = new Set(); // 응답을 기다리는 요청: { ctl, deadline }
    const fire = () => {
      sent++; lastSent = Date.now();
      const req = { ctl: new AbortController(), deadline: Date.now() + ASK_AFTER_MS };
      reqs.add(req);
      probe(req.ctl.signal).then((r) => { if (r && !found) found = r; }).catch(() => {}).finally(() => reqs.delete(req));
    };
    // 1분 넘게 응답이 없는 요청은 자동으로 끊지 않고 사용자에게 물음 (고르지 않으면 계속 기다림)
    const ask = ui.querySelector(".ask");
    const overdue = () => [...reqs].filter((r) => Date.now() >= r.deadline);
    // "1분 더 기다리기": 기다리는 요청 전부를 1분 연장 (겹쳐 보낸 요청마다 몇 초 간격으로 다시 묻지 않게)
    ask.querySelector(".wait1").onclick = () => { for (const r of reqs) r.deadline = Date.now() + ASK_AFTER_MS; ask.hidden = true; };
    ask.querySelector(".cut").onclick = () => { for (const r of overdue()) r.ctl.abort(); ask.hidden = true; };
    while (!found && !dead()) {
      const since = Date.now() - lastSent;
      if ((reqs.size === 0 && since >= CONFIG.pollMs) || (reqs.size > 0 && reqs.size < MAX_INFLIGHT && since >= STAGGER_MS)) fire();
      const late = overdue().length;
      ask.hidden = !late;
      status(`${label} 오픈 대기 중… (${sent}회 확인)${reqs.size > 1 ? ` · 사이트 응답 지연, 응답 대기 ${reqs.size}개` : ""}${late ? ` · ${late}개 요청이 1분 넘게 응답이 없습니다. 더 기다릴까요?` : ""}`);
      await sleep(100);
    }
    ask.hidden = true;
    if (dead()) for (const r of reqs) r.ctl.abort(); // 중지하면 남은 요청 정리
    return dead() ? null : found;
  }

  // 화면이 깨졌을 때 잠시 뒤 다시 열기 (beforeReload: 다시 열기 직전에 할 일)
  function reloadSoon(why, beforeReload) {
    let sec = 3;
    stopped = false;
    stopBtn.hidden = false;
    const tick = () => {
      if (stopped) return;
      status(`${why} ${sec}초 뒤 다시 엽니다… (그만하려면 중지)`);
      if (sec-- <= 0) { beforeReload?.(); location.reload(); return; }
      setTimeout(tick, 1000);
    };
    tick();
  }
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

  // 좌석 고르기: 인원만큼 빈 좌석이 있는 첫 그룹 → 없으면 그룹 좌석을 적은 순서대로 → (설정 시) 남은 빈 좌석을 화면 순서대로
  // freeSeats: 지금 빈 좌석 번호 (화면 순서)
  function pickSeats(freeSeats, want) {
    const free = (n) => freeSeats.includes(n);
    const group = CONFIG.seatGroups.find((g) => g.filter(free).length >= want);
    let picks = (group || [...new Set(CONFIG.seatGroups.flat())]).filter(free).slice(0, want);
    if (picks.length < want && CONFIG.fallbackAnySeat) picks = picks.concat(freeSeats.filter((n) => !picks.includes(n)).slice(0, want - picks.length));
    return picks;
  }
  // 잡은 좌석이 인원보다 적을 때: "남은 좌석만큼만 예약"이 켜져 있고 최소 인원 이상이면 그 인원으로 진행.
  // 진행할 인원 수를 돌려주고, 진행하지 않으면(자동 신청 안 함) 0
  function seatShortage(got, want) {
    if (got >= want) return want;
    const min = Math.max(1, CONFIG.minPeople || 1);
    if (CONFIG.partialSeats && got >= min) {
      toast(`잡을 수 있는 좌석이 ${got}석뿐이라 ${got}명으로 예약합니다 (설정 인원 ${want}명)`);
      return got;
    }
    const why = !got ? '잡을 수 있는 좌석이 없습니다'
      : `잡을 수 있는 좌석이 ${got}석뿐입니다 (설정 인원 ${want}명${CONFIG.partialSeats ? `, 최소 인원 ${min}명` : ''})`;
    toast(`${why}. 자동 신청하지 않습니다. 화면을 확인하고 직접 정하세요.`);
    return 0;
  }

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
