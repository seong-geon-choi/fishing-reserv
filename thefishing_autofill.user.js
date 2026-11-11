// ==UserScript==
// @name         더피싱 예약 자동입력 (만석호·나대세호·팀루피호·하이피싱호 등)
// @namespace    reserv
// @version      2.8.18.1111-170552
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
    { key: 'shipName', w: 2, label: '배 이름', type: 'list', help: '이름 일부, 쉼표로 여러 개 (예: 만석호)' },
    { key: 'fishKeywords', w: 1, perShip: true, label: '낚시종류 키워드', type: 'list', help: '쉼표로 구분. 하나라도 들어간 맨 위 종류(비우면 첫 번째). 배마다 따로 저장' },
    { key: 'people', w: 1, label: '예약 인원', type: 'number', min: 1, max: 30 },
    { key: 'name', w: 1, label: '예약자명', type: 'text', required: true },
    { key: 'depositor', w: 1, label: '입금자명', type: 'text', help: '예약자와 다를 때만' },
    { key: 'tel', w: 1, label: '휴대폰 번호', type: 'phone', required: true, help: '010-1234-5678' },
    { key: 'partialSeats', w: 4, label: '좌석이 인원보다 적으면 남은 좌석만큼만 예약', type: 'check', help: '끄면 좌석이 모자랄 때 자동 신청하지 않고 안내만 합니다. 켜면 최소 인원 이상일 때만 진행' },
    { key: 'minPeople', inline: true, unit: '명', label: '최소 인원', type: 'number', min: 1, max: 30 },
    { key: 'seatGroups', w: 2, perShip: true, label: '좌석 그룹', type: 'groups', help: '한 줄에 그룹 하나 (예: 7, 8, 9), 위쪽이 우선' },
    { key: 'fallbackAnySeat', w: 4, perShip: true, label: '그룹으로 인원을 못 채우면 남은 좌석으로 채우기', type: 'check' },
    { key: 'openAt', w: 2, label: '예약 오픈 시각', type: 'datetime', help: '비우면 시작하자마자 확인' },
    { key: 'startBeforeSec', w: 1, label: '몇 초 전부터 확인', type: 'number', min: 5, max: 600 },
    { key: 'pollMs', w: 1, label: '확인 간격(ms)', type: 'number', min: 300, max: 10000, help: '700~1000 권장' },
    { key: 'autoSubmit', w: 4, label: '"예약 신청하기"까지 자동으로 누르기', type: 'check', danger: '켜면 확인 없이 실제로 예약됩니다. 연습할 때는 끄세요.' },
  ];
  // =====================================================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 설정 저장/불러오기 ----------
  const loadConfig = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; } };
  const saveConfig = (c) => localStorage.setItem(STORE_KEY, JSON.stringify(c));
  const fmtTime = (s) => (s || '').replace('T', ' ');
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
      /* 자동 신청이 켜져 있을 때: 화면 전체 빨간 테두리 깜빡임 (클릭은 막지 않음) */
      .autoframe { position:fixed; inset:0; border:8px solid #e03131; pointer-events:none; animation:autoblink 1s steps(1) infinite; }
      .autoframe[hidden] { display:none; }
      .auto { animation:autoblink-badge 1s steps(1) infinite; }
      @keyframes autoblink { 50% { border-color:rgba(224, 49, 49, .15); } }
      @keyframes autoblink-badge { 50% { background:#7a1515; } }
      /* 긴급 정지 확인창 */
      .halt { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; }
      .halt[hidden] { display:none; }
      .halt-box { background:#fff; color:#1f2933; border-radius:10px; padding:18px 20px; width:min(420px, calc(100vw - 32px)); box-shadow:0 10px 30px rgba(0,0,0,.35); font-size:14px; font-weight:400; }
      .halt-box b { font-size:16px; color:#c92a2a; }
      .halt-box p { margin:8px 0 14px; color:#52606d; }
      .halt-box .btns { display:flex; gap:8px; justify-content:flex-end; }
      h3.shiphead { margin:18px 0 2px; padding-top:12px; border-top:1px solid #d5dce2; font-size:15px; color:#1c6fb8; }
      .shipnote { margin:0 0 10px; }
      .pickrow { margin:-6px 0 12px; }
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
      label.c .inl { margin-left:auto; display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
      label.c .inl input { width:64px; }
      input.off { background:#eef1f4; color:#8396a6; cursor:not-allowed; }
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
    <div class="bar"><span class="msg"></span><span class="auto" hidden>자동 신청 켜짐</span><button class="start primary" type="button" hidden>예약 대기 시작</button><span class="ask" hidden><button class="wait1" type="button">1분 더 기다리기</button><button class="cut" type="button">끊고 새로 요청</button></span><button class="stop" type="button" hidden>중지</button><button class="gear" type="button">설정</button></div>
    <div class="autoframe" hidden></div>
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
  function toast(m, ms = 14000) {
    console.log('[자동입력]', m);
    if ([...$toasts.children].some((t) => t.textContent === m && t.style.opacity !== '0')) return; // 같은 안내가 떠 있으면 쌓지 않음
    // 설정 창이 열려 있으면 설정 창 제목줄 바로 아래 가운데에, 아니면 상태 바 아래 화면 가운데에
    const head = !panel.hidden && panel.querySelector('.phead');
    if (head) {
      const p = panel.getBoundingClientRect();
      $toasts.style.top = head.getBoundingClientRect().bottom + 6 + 'px';
      $toasts.style.left = p.left + p.width / 2 + 'px';
      $toasts.style.width = Math.min(560, p.width - 32) + 'px';
    } else {
      $toasts.style.top = $bar.offsetHeight + 8 + 'px';
      $toasts.style.left = $toasts.style.width = '';
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = m;
    $toasts.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, ms);
  }
  // 스크립트가 인원·좌석을 넣는 동안 사이트의 경고창(alert)·확인창(confirm)이 화면을 멈추지 않게:
  // 경고창은 토스트로 보여 주고, 확인창(예: 대기자 등록)은 "취소"로 처리. 돌려받은 함수를 부르면 원래대로
  function muteDialogs() {
    const a = window.alert, c = window.confirm;
    window.alert = (m) => toast(`사이트 안내: ${m}`);
    window.confirm = (m) => { toast(`사이트 확인창은 취소로 처리했습니다: ${m}`); return false; };
    return () => { window.alert = a; window.confirm = c; };
  }
  // 사용자가 누를 버튼을 화면 가운데로 옮기고 빨간 테두리로 강조.
  // 사이트 CSS가 테두리를 막아도 보이게 important로 지정 (더피싱: * { outline: 0 !important })
  function markButton(btn) {
    btn.scrollIntoView({ block: 'center' });
    btn.style.setProperty('outline', '4px solid red', 'important');
    btn.style.setProperty('outline-offset', '2px', 'important');
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
    if (f.inline) {
      // 바로 앞 체크박스 줄 끝에 작은 입력칸으로 붙임 (예: 최소 인원 [1]명)
      grid.lastElementChild.insertAdjacentHTML('beforeend', `<span class="inl">${f.label} <input id="${id}" type="number" inputmode="numeric">${f.unit || ''}</span>`);
      ui.getElementById(id).value = toText(f, c[f.key]);
      return;
    }
    if (f.type === 'check') {
      grid.insertAdjacentHTML('beforeend', `<label class="c span${f.w || 4} ${f.danger ? 'danger' : ''}"><input type="checkbox" id="${id}" ${c[f.key] ? 'checked' : ''}><span>${f.label}${f.danger ? `<span class="help danger">${f.danger}</span>` : help}</span></label>`);
      return;
    }
    const input = f.type === 'groups' ? `<textarea id="${id}"></textarea>`
      : `<input id="${id}" type="${{ number: 'number', datetime: 'datetime-local', date: 'date' }[f.type] || 'text'}" ${f.type === 'datetime' ? 'step="1"' : ''} ${f.type === 'phone' ? 'inputmode="tel"' : ''}>`;
    grid.insertAdjacentHTML('beforeend', `<label class="f span${f.w || 1}"><span>${f.label}${f.required ? ' <b>*</b>' : ''}</span>${input}${help}</label>`);
    ui.getElementById(id).value = toText(f, c[f.key]);
  }
  // 지금은 쓰이지 않는 칸: 입력을 막고(회색) 이유를 칸 아래에 표시, 누르면 tip을 토스트로.
  // disabled는 브라우저가 클릭을 무시해 안내를 띄울 수 없으므로 읽기 전용으로 (값은 바뀌지 않은 채 저장됨)
  function disableField(key, why, tip) {
    const el = ui.getElementById('f_' + key);
    if (!el) return;
    el.readOnly = true;
    el.classList.add('off');
    el.closest('label').insertAdjacentHTML('beforeend', `<span class="help">${why}</span>`);
    el.addEventListener('click', () => toast(tip || why));
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
    const ship = currentShip();
    panel.dataset.shipId = ship ? ship.id : '';
    const all = loadConfig();
    const c = ship ? forShip(all, ship.id) : all;
    const grid = panelTop(note);
    let shipHeadDone = false;
    for (const f of FIELDS) {
      if (f.key === 'fishKeywords') {
        // 배 이름 옆에 두지만 값은 그 배 전용. 배를 모르면 입력할 수 없음
        addField(grid, f, c);
        if (!ship) disableField(f.key, '배 이름을 저장하면 그 배의 키워드를 입력할 수 있습니다',
          '배 이름을 먼저 저장하세요. 낚시종류 키워드는 배마다 따로 저장됩니다.');
        continue;
      }
      if (f.perShip && !shipHeadDone) {
        shipHeadDone = true;
        grid.insertAdjacentHTML('beforeend', ship
          ? `<h3 class="shiphead full">${ship.name} 전용 설정</h3><p class="help shipnote full">아래 항목은 이 배에만 적용됩니다. 같은 사이트의 다른 배는 따로 정합니다.</p>`
          : `<h3 class="shiphead full">배별 설정 (좌석)</h3><p class="help shipnote full">배 이름을 입력하고 저장하면, 그 배의 좌석 설정이 여기에 나타납니다.</p>`);
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
  // 자동 신청이 켜져 있으면 눈에 띄게: 상태 바의 "자동 신청 켜짐" + 화면 전체 빨간 테두리 깜빡임
  ui.querySelector('.auto').hidden = !CONFIG.autoSubmit;
  ui.querySelector('.autoframe').hidden = !CONFIG.autoSubmit;

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
    return fishByKeyword(usable, (r) => r.closest('tr')?.textContent || '') || usable[0];
  }
  // 낚시종류 고르기: 키워드가 하나라도 들어간 종류 중 맨 위 (없으면 null). textOf: 그 종류의 화면 글자
  function fishByKeyword(items, textOf) {
    return items.find((it) => CONFIG.fishKeywords.some((k) => textOf(it).includes(k))) || null;
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
      if (asking) { setTimeout(tick, 200); return; } // 긴급 정지 확인창이 떠 있으면 다시 열지 않고 기다림
      status(`${why} ${sec}초 뒤 다시 엽니다… (그만하려면 중지)`);
      if (sec-- <= 0) { beforeReload?.(); location.reload(); return; }
      setTimeout(tick, 1000);
    };
    tick();
  }

  // ---------- 긴급 정지: 스크립트가 일하는 중(예약 대기·다시 열기·자동입력)에 Esc → 확인창 → 모두 멈춤 ----------
  // 브라우저 기본 확인창(confirm)은 브라우저 전체를 멈추므로 쓰지 않고 화면 안의 확인창을 씀.
  // 확인창이 떠 있는 동안에는 예약 화면 이동·다시 열기·자동 신청 같은 다음 단계로 넘어가지 않음 (checkpoint에서 기다림)
  let halted = false; // 긴급 정지함
  let asking = false; // 확인창이 떠 있음
  let filling = false; // 예약 화면 자동입력 중
  let onHalt = () => {}; // 사이트별 정리 (이 탭의 시작 표시 지우기 등)
  const haltBox = document.createElement('div');
  haltBox.className = 'halt';
  haltBox.hidden = true;
  haltBox.innerHTML = `<div class="halt-box" role="alertdialog" aria-modal="true"><b>스크립트 작업을 중단할까요?</b>
    <p>예약 대기, 자동입력, 자동 신청을 모두 멈춥니다. 사이트 화면에 이미 입력된 내용은 그대로 둡니다.</p>
    <div class="btns"><button type="button" class="halt-no">취소</button><button type="button" class="halt-yes primary">중단</button></div></div>`;
  ui.appendChild(haltBox);
  const busy = () => !halted && (filling || !stopBtn.hidden);
  const closeAsk = () => { asking = false; haltBox.hidden = true; };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || asking || !busy()) return; // 일하지 않을 때는 사이트의 Esc 동작을 막지 않음
    e.preventDefault();
    e.stopPropagation();
    asking = true;
    haltBox.hidden = false;
    haltBox.querySelector('.halt-yes').focus(); // Enter = 중단
  }, true);
  haltBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAsk(); } });
  haltBox.querySelector('.halt-no').onclick = closeAsk;
  haltBox.querySelector('.halt-yes').onclick = () => { closeAsk(); halt(); };
  function halt() {
    halted = true;
    stopped = true; // 대기·겹쳐 보내기·다시 열기가 이 표시를 보고 멈춤
    for (const c of ['.stop', '.ask', '.start']) ui.querySelector(c).hidden = true;
    onHalt();
    status('긴급 정지했습니다. 스크립트는 더 이상 아무것도 하지 않습니다. 다시 하려면 새로고침한 뒤 시작하세요.');
  }
  // 다음 단계로 넘어가기 전에 부름: 확인창이 떠 있으면 답할 때까지 기다리고, 정지했으면 false
  async function checkpoint() {
    while (asking) await sleep(100);
    return !halted;
  }
  onHalt = () => { try { sessionStorage.removeItem(TARGET_KEY); } catch (e) { /* 무시 */ } };
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
    if (!(await checkpoint())) return; // 긴급 정지 확인창이 떠 있으면 기다리고, 정지했으면 여기서 멈춤
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

  // 좌석 고르기: 인원만큼 빈 좌석이 있는 첫 그룹 → 없으면 그룹 좌석을 적은 순서대로 → (설정 시) 남은 빈 좌석을 화면 순서대로
  // freeSeats: 지금 빈 좌석 번호 (화면 순서)
  function pickSeats(freeSeats, want) {
    const free = (n) => freeSeats.includes(n);
    const group = CONFIG.seatGroups.find((g) => g.filter(free).length >= want);
    let picks = (group || [...new Set(CONFIG.seatGroups.flat())]).filter(free).slice(0, want);
    if (picks.length < want && CONFIG.fallbackAnySeat) picks = picks.concat(freeSeats.filter((n) => !picks.includes(n)).slice(0, want - picks.length));
    return picks;
  }
  // 잡은 좌석(또는 예약 가능한 인원)이 설정 인원보다 적을 때: "남은 좌석만큼만 예약"이 켜져 있고 최소 인원 이상이면 그 인원으로 진행.
  // 진행할 인원 수를 돌려주고, 진행하지 않으면(자동 신청 안 함) 0. what: '좌석' 또는 '인원'(배의 최대 예약 인원)
  function seatShortage(got, want, what = '좌석') {
    if (got >= want) return want;
    const have = what === '좌석' ? `잡을 수 있는 좌석이 ${got}석` : `예약 가능한 인원이 ${got}명`;
    const none = what === '좌석' ? '잡을 수 있는 좌석이 없습니다' : '예약 가능한 인원이 없습니다';
    const min = Math.max(1, CONFIG.minPeople || 1);
    if (CONFIG.partialSeats && got >= min) {
      toast(`${have}뿐이라 ${got}명으로 예약합니다 (설정 인원 ${want}명)`);
      return got;
    }
    const why = !got ? none : `${have}뿐입니다 (설정 인원 ${want}명${CONFIG.partialSeats ? `, 최소 인원 ${min}명` : ''})`;
    toast(`${why}. 자동 신청하지 않습니다. 화면을 확인하고 직접 정하세요.`);
    return 0;
  }

  // 좌석 지정이 없는 배의 남은 자리: 사이트가 인원 확인 요청에 함께 보내는 값(naun, 낚시종류 줄의 "(2명)"과 같음).
  // 이보다 많이 고르면 사이트가 대기자 확인창이나 "최대 예약인원 초과" 경고창을 띄움
  function remainSeats() {
    const m = [...document.scripts].map((sc) => sc.textContent).join('\n').match(/naun=(\d+)/);
    return m ? +m[1] : Infinity;
  }

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
    let short = false; // 자리가 모자라 자동 신청하지 않음
    let chosenNone = false; // 좌석도 인원도 넣지 않음 (기다릴 것 없음)
    const unmute = muteDialogs(); // 인원·좌석을 넣는 동안 사이트 경고창이 화면을 멈추지 않게
    if (seatShip) {
      picks = pickSeats(freeSeats, CONFIG.people);
      short = !seatShortage(picks.length, CONFIG.people);
      // 좌석을 누른 수만큼 인원이 정해짐 (남은 좌석만큼만 예약이면 그 인원으로).
      // 누를 때마다 선택/해제가 바뀌므로, 이미 눌러 둔 좌석은 고른 것만 두고 풀고, 나머지 고른 좌석만 누름
      const toggle = [...chosen.filter((n) => !picks.includes(n)), ...picks.filter((n) => !chosen.includes(n))];
      for (const n of toggle) { window.ticket_seat_click(date, pa, String(n)); await sleep(250); }
      chosenNone = !picks.length;
    } else {
      // 좌석지정이 없는 배/종류인 경우 인원만 선택. 남은 자리를 넘지 않게 (모자라면 "남은 좌석만큼만 예약" 규칙)
      const allowed = Math.min(CONFIG.people, remainSeats());
      short = !seatShortage(allowed, CONFIG.people, '인원');
      chosenNone = allowed <= 0;
      if (!chosenNone) {
        document.getElementById('BI_IN').value = String(allowed);
        window.popup_ajax_step1();
      }
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
    let applied = chosenNone ? true : await settled(15000); // 넣은 것이 없으면 기다릴 것도 없음
    if (!applied) {
      status('사이트 응답이 늦어 인원·금액을 다시 요청합니다…');
      window.popup_ajax_step1();
      applied = await settled(15000);
    }
    unmute();
    if (!(await checkpoint())) return; // 긴급 정지 확인창이 떠 있으면 기다리고, 정지했으면 여기서 멈춤

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
    markButton(btn);
    const seats = picks.length ? `좌석 ${picks.join(', ')}번` : seatShip ? '좌석 없음' : '좌석 지정 없음';
    if (short) {
      status(`${seats}: 잡을 수 있는 자리가 설정 인원(${CONFIG.people}명)보다 적어 자동 신청하지 않았습니다. 인원과 좌석을 확인하고 직접 신청하세요.`);
      return;
    }
    if (!applied) {
      // 인원·금액이 확인되지 않은 채로 자동 신청하지 않음
      status(`${seats}: 사이트 응답이 없어 인원·금액이 확인되지 않았습니다. 화면의 인원과 금액을 확인하고 직접 신청하세요.`);
      return;
    }
    if (CONFIG.autoSubmit) {
      status(`${seats}, 인원 ${document.getElementById('BI_IN').value}명으로 예약 신청 중…`);
      if (!(await checkpoint())) return; // 긴급 정지 확인창이 떠 있으면 기다리고, 정지했으면 여기서 멈춤
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
      if (document.getElementById('BI_IN') && document.getElementById('submit')) { filling = true; fillForm().finally(() => { filling = false; }); return; }
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
