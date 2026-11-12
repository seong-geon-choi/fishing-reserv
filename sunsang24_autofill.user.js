// ==UserScript==
// @name         선상24 예약 자동입력 (빅보스호·가가호 등)
// @namespace    reserv
// @version      2.5.26.1112-175132
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

  // 예약 화면은 일정 페이지에서 "예약 대기 시작"으로 넘어온 경우(이 탭에 시작 표시가 있을 때)만 동작.
  // 사이트의 "바로예약"으로 직접 연 예약 화면에서는 아무것도 표시하지 않음 (설정은 일정 페이지에서, 더피싱과 같음)
  const FLAG = 'ss24_auto_schedule'; // 이 스크립트가 예약 화면으로 보냈다는 표시 (이 탭 안에서만)
  const isReserve = /^\/mypage\/reservation_(default_)?ready\//.test(location.pathname);
  if (isReserve) {
    let fromScript = false;
    try { fromScript = sessionStorage.getItem(FLAG) === location.pathname; sessionStorage.removeItem(FLAG); } catch (e) { /* 무시 */ }
    if (!fromScript) return;
  }

  // ===================== 설정 항목 =====================
  // 값은 코드가 아니라 화면 위 "설정" 버튼에서 입력합니다. 이 사이트(주소)별로 브라우저에 저장되고, 스크립트가 업데이트돼도 유지됩니다.
  const STORE_KEY = 'fishingReserv.sunsang24';
  const DEFAULTS = {
    date: '', shipName: [], fishKeywords: [], people: 2, name: '', depositor: '', phone: ['', '', ''],
    seatGroups: [], fallbackAnySeat: true, partialSeats: false, minPeople: 1,
    openAt: '', startBeforeSec: 30, pollMs: 1000, autoSubmit: false,
  };
  const FIELDS = [
    { key: 'date', w: 1, label: '출조일', type: 'date', required: true },
    { key: 'shipName', w: 2, label: '배 이름', type: 'list', help: '이 일정 페이지에 나오는 배 중에서 선택 (없으면 맨 아래 "직접 입력…"). 배가 하나뿐인 사이트는 비워도 됨',
      // 일정 페이지 각 줄의 배 이름
      choices: () => [...new Set([...document.querySelectorAll('td.ship_info .title')].map((e) => e.textContent.trim()).filter(Boolean))] },
    { key: 'fishKeywords', w: 1, label: '낚시종류 키워드', type: 'list', help: '선택출항 예약만. 쉼표로 구분, 하나라도 들어간 맨 위 종류(없으면 화면 선택 그대로)' },
    { key: 'people', w: 1, label: '예약 인원', type: 'number', min: 1, max: 30 },
    { key: 'name', w: 1, label: '예약자명', type: 'text', help: '비우면 화면 값 사용' },
    { key: 'depositor', w: 1, label: '입금자명', type: 'text', help: '칸이 있는 배만' },
    { key: 'phone', w: 1, label: '휴대폰 번호', type: 'phone', help: '화면이 비었을 때만' },
    { key: 'partialSeats', w: 4, label: '좌석이 인원보다 적으면 남은 좌석만큼만 예약', type: 'check', help: '끄면 좌석이 모자랄 때 자동 신청하지 않고 안내만 합니다. 켜면 최소 인원 이상일 때만 진행' },
    { key: 'minPeople', inline: true, unit: '명', label: '최소 인원', type: 'number', min: 1, max: 30 },
    { key: 'seatGroups', w: 2, label: '좌석 그룹 (좌석 선택이 있는 배만)', type: 'groups', help: '한 줄에 그룹 하나 (예: 2, 3, 4), 위쪽이 우선. 예약 화면의 자리배치도 그림 번호를 보고 적으세요. 좌석 선택이 없는 배에서는 무시' },
    { key: 'fallbackAnySeat', w: 4, label: '그룹으로 인원을 못 채우면 남은 좌석으로 채우기', type: 'check' },
    { key: 'openAt', w: 2, label: '예약 오픈 시각', type: 'datetime', help: '비우면 시작할 때 한 번만 확인 (안 열렸으면 안내하고 멈춤)' },
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
      input[type=text], input[type=number], input[type=date], input[type=datetime-local], textarea, select { width:100%; font-size:15px; padding:8px; border:1px solid #9aa5b1; border-radius:6px; background:#fff; color:#1f2933; }
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
      input[type=text], input[type=number], input[type=date], input[type=datetime-local], textarea, select { font-size:14px; padding:6px 8px; }
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
      .seatimg img { display:block; max-width:100%; border-radius:6px; }
      .seatimg .help { margin-top:4px; }
    </style>
    <div class="bar"><span class="msg"></span><span class="auto" hidden>자동 신청 켜짐</span><button class="start primary" type="button" hidden>예약 대기 시작</button><span class="ask" hidden><button class="wait1" type="button">1분 더 기다리기</button><button class="cut" type="button">끊고 새로 요청</button></span><button class="stop" type="button" hidden>중지</button><button class="gear" type="button">설정</button></div>
    <div class="autoframe" hidden></div>
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
  // ---------- 사이트 요청 줄이기·차단 대응 ----------
  // 사이트가 접근을 막으면(403 Forbidden·429 Too Many Requests) 요청을 계속 보내 차단이 길어지지 않게 스크립트를 모두 멈춤
  const BLOCK_MSG = '사이트가 이 인터넷 주소의 접근을 막았습니다(403/429). 스크립트는 요청을 멈췄습니다. 이 사이트를 한동안(수십 분 이상) 열지 말고 기다렸다가 다시 시도하세요.';
  const isBlockedPage = () => /^(403 Forbidden|429 Too Many Requests)$/.test(document.title.trim())
    || /You don't have permission to access/.test(document.body?.textContent || '');
  let blocked = false;
  // 사이트 페이지 받기: 차단 응답이면 모든 대기·요청을 멈추고 알림
  async function fetchPage(url, opts = {}) {
    if (blocked) throw new Error('blocked');
    const r = await fetch(url, { cache: 'no-store', ...opts });
    if (r.status === 403 || r.status === 429) {
      blocked = true;
      stopped = true; // 대기·겹쳐 보내기·다시 열기가 이 표시를 보고 멈춤
      ui.querySelector('.stop').hidden = true;
      status(BLOCK_MSG);
      throw new Error('blocked');
    }
    return r;
  }
  // 차단 화면이 열렸으면 다시 열기 등을 하지 않고 여기서 멈춤
  if (isBlockedPage()) { status(BLOCK_MSG); return; }

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
    const input = f.choices ? `<select id="${id}"></select>` // 드롭다운 (예: 이 사이트의 배 이름 목록)
      : f.type === 'groups' ? `<textarea id="${id}"></textarea>`
      : `<input id="${id}" type="${{ number: 'number', datetime: 'datetime-local', date: 'date' }[f.type] || 'text'}" ${f.type === 'datetime' ? 'step="1"' : ''} ${f.type === 'phone' ? 'inputmode="tel"' : ''}>`;
    grid.insertAdjacentHTML('beforeend', `<label class="f span${f.w || 1}"><span>${f.label}${f.required ? ' <b>*</b>' : ''}</span>${input}${help}</label>`);
    const el = ui.getElementById(id);
    if (f.choices) {
      // 선택지: "선택하세요" + 목록. 저장된 값이 목록에 없으면(다른 달에만 나오는 배 등) 그 값도 넣어 둠
      const cur = toText(f, c[f.key]);
      for (const n of ['', ...new Set([...f.choices(), cur].filter(Boolean))]) el.add(new Option(n || '선택하세요', n));
      // 맨 아래 "직접 입력…": 고르면 그 자리를 글자 입력칸으로 바꿈 (목록에 없는 배, 이름 일부만 적기)
      const CUSTOM = '__직접입력__';
      el.add(new Option('직접 입력…', CUSTOM));
      el.addEventListener('change', () => {
        if (el.value !== CUSTOM) return;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.id = id;
        inp.placeholder = '배 이름 (일부만 적어도 됨)';
        el.replaceWith(inp);
        inp.focus();
      });
    }
    el.value = toText(f, c[f.key]);
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
    const c = loadConfig();
    dayUrlPromise = null; // 하루치 일정은 설정 창을 열 때마다 새로 (한 번만)
    const grid = panelTop(note);
    for (const f of FIELDS) {
      addField(grid, f, c);
      if (f.key === 'fishKeywords') {
        // 낚시종류 선택은 선택출항 예약에만 있음: 설정한 날짜·배가 일반 예약이면 칸을 막음 (아직 일정에 없으면 그대로 둠)
        reserveKind().then((kind) => {
          if (kind === 'normal') disableField('fishKeywords', '설정한 날짜·배는 일반 예약이라 낚시종류 선택이 없습니다',
            '어종 선택은 선사 고정입니다. 낚시종류 키워드는 선택출항 예약에서만 쓰입니다.');
        }).catch(() => {});
      }
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
  // 설정한 날짜·배의 예약 종류: 'default'(선택출항, 낚시종류를 고름) / 'normal'(일반) / null(아직 일정에 없어 모름)
  async function reserveKind() {
    if (/^\/mypage\/reservation_default_ready\//.test(location.pathname)) return 'default';
    if (/^\/mypage\/reservation_ready\//.test(location.pathname)) return 'normal';
    const url = await dayReserveUrl();
    return !url ? null : url.includes('reservation_default_ready') ? 'default' : 'normal';
  }
  // 설정한 날짜의 하루치 일정(한 달치보다 15~20배 가벼움)에서 그 배의 예약 화면 주소.
  // 설정 창을 한 번 여는 동안 한 번만 받아 자리배치도·낚시종류 판단이 같이 씀
  let dayUrlPromise = null;
  function dayReserveUrl() {
    if (!dayUrlPromise) {
      dayUrlPromise = (async () => {
        const cfg = loadConfig();
        if (!cfg.date) return null;
        const r = await fetchPage(`/ship/schedule_fleet/${cfg.date}/0/simple_day1`);
        return r.ok ? findInDay(new DOMParser().parseFromString(`<table>${await r.text()}</table>`, 'text/html')) : null;
      })().catch(() => null);
    }
    return dayUrlPromise;
  }
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
    const btn = pickBtn(document); // 지금 보고 있는 일정 페이지에 그 배가 있으면 요청 없이
    const url = btn ? reserveUrl(btn) : await dayReserveUrl();
    if (!url) return null; // 예약 화면을 못 찾음 (기억하지 않음)
    const doc = new DOMParser().parseFromString(await fetchPage(url).then((r) => r.text()), 'text/html');
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
  // 자동 신청이 켜져 있으면 눈에 띄게: 상태 바의 "자동 신청 켜짐" + 화면 전체 빨간 테두리 깜빡임
  ui.querySelector('.auto').hidden = !CONFIG.autoSubmit;
  ui.querySelector('.autoframe').hidden = !CONFIG.autoSubmit;

  // ===================== 예약 자동입력 =====================
  const [Y, M, D] = CONFIG.date.split('-').map(Number);
  const shipNames = [].concat(CONFIG.shipName || []).filter(Boolean);
  const ym = `${Y}${String(M).padStart(2, '0')}`;

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
      if ((reqs.size === 0 && since >= Math.max(500, CONFIG.pollMs)) || (reqs.size > 0 && reqs.size < MAX_INFLIGHT && since >= STAGGER_MS)) fire();
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
  // 새로고침은 그림·CSS까지 통째로 다시 받으므로, 혼잡할 때 몰리지 않게 3→6→12→24→48초로 늘리고 최대 5번까지만.
  // 횟수는 이 탭에서 같은 화면 기준으로 세고, 마지막 시도 뒤 2분이 지나면 처음부터
  const RELOAD_KEY = 'fishingReserv.reloads';
  const RELOAD_MAX = 5;
  function reloadSoon(why, beforeReload) {
    const key = location.pathname + location.search;
    let r = null;
    try { r = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || 'null'); } catch (e) { /* 무시 */ }
    const n = r && r.key === key && Date.now() - r.t < 2 * 60 * 1000 ? r.n : 0;
    if (n >= RELOAD_MAX) {
      try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) { /* 무시 */ }
      stopBtn.hidden = true;
      status(`${why} ${RELOAD_MAX}번 다시 열어도 안 되어 멈췄습니다. 잠시 뒤 직접 새로고침(F5)하세요.`);
      return;
    }
    let sec = 3 * 2 ** n;
    stopped = false;
    stopBtn.hidden = false;
    const tick = () => {
      if (stopped) return;
      if (asking) { setTimeout(tick, 200); return; } // 긴급 정지 확인창이 떠 있으면 다시 열지 않고 기다림
      status(`${why} ${sec}초 뒤 다시 엽니다 (${n + 1}/${RELOAD_MAX})… (그만하려면 중지)`);
      if (sec-- <= 0) {
        try { sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ key, n: n + 1, t: Date.now() })); } catch (e) { /* 무시 */ }
        beforeReload?.();
        location.reload();
        return;
      }
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
  onHalt = () => { try { sessionStorage.removeItem(FLAG); } catch (e) { /* 무시 */ } };
  stopBtn.onclick = () => {
    stopped = true;
    stopBtn.hidden = true;
    showStart('대기를 중지했습니다. 다시 하려면 "예약 대기 시작"을 누르세요.');
  };

  // 로그인 확인: 마이페이지에 "로그아웃" 메뉴가 있으면 로그인 상태 (선상24는 배 사이트 주소마다 로그인이 따로)
  async function loggedIn() {
    try {
      const html = await fetchPage('/mypage/my').then((r) => r.text());
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
    // 하루치 일정(사이트가 예약 완료 후 쓰는 요청)만 받아 확인: 한 달치 페이지보다 15~20배 작음.
    // 하루치가 안 되면 기본은 하루치를 다시 시도하고, 연속 10번 실패할 때만 무거운 한 달치로 한 번 확인
    let dayFails = 0;
    const probe = async (signal) => {
      let r = null;
      try { r = await fetchPage(`/ship/schedule_fleet/${CONFIG.date}/0/simple_day1`, { signal }); } catch (e) { if (blocked) throw e; }
      if (r && r.ok) { dayFails = 0; return findInDay(new DOMParser().parseFromString(`<table>${await r.text()}</table>`, 'text/html')); }
      if (++dayFails % 10) return null;
      const html = await fetchPage(`/ship/schedule_fleet/${ym}`, { signal }).then((x) => x.text());
      return findSchedule(new DOMParser().parseFromString(html, 'text/html'));
    };
    if (!CONFIG.openAt) {
      // 오픈 시각이 없으면 한 번만 확인: 열려 있으면 바로 진행, 아니면 안내하고 멈춤 (계속 확인하지 않음)
      const url = await probe().catch(() => null);
      if (!url) { notOpenYet(); return; }
      return goReserve(url);
    }
    const url = await pollOverlap(probe, dead, label);
    if (!url) return;
    return goReserve(url);
  }
  // 오픈 시각 없이 시작했는데 아직 안 열림
  function notOpenYet() {
    stopped = true;
    stopBtn.hidden = true;
    status('아직 예약이 오픈되지 않았습니다. 설정에서 "예약 오픈 시각"을 입력하면 그 시각에 맞춰 자동으로 확인합니다.');
    const btn = ui.querySelector('.start');
    btn.hidden = false;
    btn.onclick = () => { btn.hidden = true; panel.hidden = true; waitOnSchedule(); };
  }
  async function goReserve(url) {
    if (!(await checkpoint())) return; // 긴급 정지 확인창이 떠 있으면 기다리고, 정지했으면 여기서 멈춤
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
  // 낚시종류 고르기: 키워드가 하나라도 들어간 종류 중 맨 위 (없으면 null). textOf: 그 종류의 화면 글자
  function fishByKeyword(items, textOf) {
    return items.find((it) => CONFIG.fishKeywords.some((k) => textOf(it).includes(k))) || null;
  }

  // 이 예약 화면에서 한 번에 예약할 수 있는 최대 인원. 사이트의 + 버튼이 확인하는 세 값 중 가장 작은 값
  // (남은 승선 인원, 1인 최대 예약 인원, 가격 옵션의 최대 인원. 뒤의 둘은 0이면 제한 없음)
  function maxPeople() {
    const sc = (window.data && window.data.schedule) || {};
    const plus = document.querySelector('a.plus');
    const opt = (window.jQuery && plus && window.jQuery(plus).parent().data('price_option')) || {};
    const limits = [];
    if (sc.remain_embarkation_num != null && sc.remain_embarkation_num !== '') limits.push(Math.max(0, +sc.remain_embarkation_num));
    if (+sc.person_per_reservation > 0) limits.push(+sc.person_per_reservation);
    if (+opt.pmax > 0) limits.push(+opt.pmax);
    return limits.length ? Math.min(...limits) : Infinity;
  }

  // 2) 예약 화면: 인원 → 예약자 → 약관 동의 → (autoSubmit) 예약하기
  // 일정 페이지에서 "예약 대기 시작"으로 들어온 경우만 여기까지 옴 (맨 위에서 확인)
  async function fillReservation() {
    const btn = document.getElementById('btn_payment');
    if (!btn) {
      status('선상24에 로그인되어 있지 않습니다. 로그인한 뒤 이 화면을 새로고침하세요.');
      return;
    }

    // 선택출항 예약: 낚시종류 고르기 (가격·최대 인원이 종류에 따라 달라질 수 있어 인원보다 먼저)
    // 키워드가 들어간 맨 위 종류, 없으면 화면에 선택된 종류 그대로
    const fishRadios = [...document.querySelectorAll('input[name="default_schedule_no"]')].filter((r) => !r.disabled);
    const fishText = (r) => { const it = r.parentElement?.parentElement; return ((it?.querySelector('.fish') || it)?.textContent || '').replace(/\s+/g, ' ').trim(); };
    if (fishRadios.length && CONFIG.fishKeywords.length) {
      const fish = fishByKeyword(fishRadios, fishText);
      if (!fish) toast(`낚시종류 키워드(${CONFIG.fishKeywords.join(', ')})에 맞는 종류가 없어 화면에 선택된 종류로 진행합니다`);
      else if (!fish.checked) { fish.click(); await sleep(200); }
    }

    // 인원: +/− 버튼을 눌러 맞춤. 최대 인원을 넘겨 누르면 사이트가 경고창을 띄워 멈추므로, 최대 인원을 먼저 알아내 그 이상은 누르지 않음
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
    const unmute = muteDialogs(); // 그래도 사이트 경고창이 뜨면 화면을 멈추지 않고 토스트로
    const allowed = Math.min(CONFIG.people, maxPeople());
    // 예약 가능한 인원이 설정 인원보다 적으면 좌석이 모자랄 때와 같은 규칙("남은 좌석만큼만 예약"·최소 인원)
    const peopleOk = seatShortage(allowed, CONFIG.people, '인원');
    if (allowed > 0) await setPeople(allowed);
    const mismatch = allowed > 0 && count() !== allowed; // 그래도 맞지 않음 (예상 못 한 제한)

    // 좌석 선택이 있는 배(예: 뉴항구호): 체크박스 목록 = 지금 빈 좌석. 좌석 그룹 규칙으로 인원수만큼 체크.
    // 사이트는 "체크 수 > 인원"이면 경고창을 띄우므로 인원을 먼저 맞춘 뒤, 인원수까지만 체크함
    const seatBoxes = [...document.querySelectorAll('input[name="select_seat_nos[]"]')];
    let seatPicks = [];
    let short = !peopleOk; // 인원·좌석이 모자라 자동 신청하지 않음
    if (seatBoxes.length) {
      const boxOf = (n) => seatBoxes.find((b) => +b.value === n && !b.disabled);
      const want = count();
      seatPicks = pickSeats(seatBoxes.filter((b) => !b.disabled).map((b) => +b.value), want);
      const n = short ? want : seatShortage(seatPicks.length, want); // 인원에서 이미 멈췄으면 안내를 겹쳐 띄우지 않음
      if (!n) short = true;
      if (n && n < want) await setPeople(n); // 남은 좌석만큼만 예약: 인원을 먼저 줄임
      seatBoxes.forEach((b) => { if (b.checked) b.click(); }); // 이미 체크된 것은 해제 후 다시
      for (const n of seatPicks) { boxOf(n).click(); await sleep(30); }
      seatPicks = seatBoxes.filter((b) => b.checked).map((b) => +b.value);
    }
    unmute();
    if (!(await checkpoint())) return; // 긴급 정지 확인창이 떠 있으면 기다리고, 정지했으면 여기서 멈춤

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

    markButton(btn);

    const people = count();
    const seatsShort = seatBoxes.length > 0 && seatPicks.length !== people;
    const notes = [];
    if (!peopleOk) notes.push(`예약 가능한 인원이 ${allowed}명이라 설정 인원(${CONFIG.people}명)을 채우지 못해 자동 신청하지 않았습니다`);
    if (mismatch) notes.push(`인원이 ${allowed}명으로 맞춰지지 않았습니다(지금 ${count()}명)`);
    if (seatsShort) notes.push(`좌석이 ${seatPicks.length}석만 골라졌습니다. 인원(${people}명)만큼 직접 골라 주세요`);
    const fishNow = fishRadios.find((r) => r.checked);
    const summary = `${fishNow ? `낚시종류 ${fishText(fishNow)}, ` : ''}인원 ${people}명${seatBoxes.length ? (seatPicks.length ? `, 좌석 ${seatPicks.join(', ')}번` : ', 좌석 없음') : ''}, 예약자 ${document.querySelector('input[name=name]')?.value || '(비어 있음)'}`;

    if (!CONFIG.autoSubmit || short || seatsShort || mismatch) {
      status(`입력 완료: ${summary}. ${notes.join(', ')}${notes.length ? '. ' : ''}내용을 확인하고 빨간 테두리 "예약하기"를 누르세요.`);
      return;
    }

    // 자동 제출: 사이트의 확인창(confirm)을 자동으로 "확인" 처리
    if (!(await checkpoint())) return; // 긴급 정지 확인창이 떠 있으면 기다리고, 정지했으면 여기서 멈춤
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

  if (isReserve) {
    // 여기까지 오면 "예약 대기 시작"으로 넘어온 화면 (맨 위에서 확인)
    const loggedOut = !document.getElementById('btn_payment') && document.querySelector('.btn_payment');
    if (document.getElementById('btn_payment')) { filling = true; fillReservation().finally(() => { filling = false; }); }
    else if (loggedOut) status(LOGIN_MSG);
    else {
      // 혼잡으로 예약 화면이 제대로 안 열림 → 시작 표시를 다시 남기고 잠시 뒤 다시 열기 (다시 열리면 이어서 진행)
      stopBtn.onclick = () => { stopped = true; stopBtn.hidden = true; status('다시 열기를 중지했습니다. 다시 하려면 일정 페이지에서 "예약 대기 시작"을 누르세요.'); };
      reloadSoon('예약 화면이 제대로 열리지 않았습니다.', () => { try { sessionStorage.setItem(FLAG, location.pathname); } catch (e) { /* 무시 */ } });
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
