// ==UserScript==
// @name         선상24 예약 자동입력 (빅보스호 등)
// @namespace    reserv
// @version      1.0
// @description  일정 페이지에서 예약 오픈 대기 → 예약 화면 이동 → 인원/예약자/약관 동의까지 자동. autoSubmit이 true면 예약하기까지.
// @match        https://*.sunsang24.com/ship/schedule_fleet*
// @match        https://*.sunsang24.com/mypage/reservation_ready/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 설정 =====================
  const CONFIG = {
    date: '2026-12-10',       // 예약하려는 출조일
    shipName: ['빅보스','가가호'],             // 배 이름 일부. 여러 개면 하나라도 맞는 배 중 화면 첫 번째. 비우면('' 또는 []) 그 날짜의 첫 번째 배
    depositor: '',            // 입금자명 (입금자명 칸이 있는 배만, 예: 가가호). 비우면 입력 안 함
    people: 4,                // 예약 인원
    name: '',                 // 예약자명. 비우면 화면에 미리 채워진 값 사용
    phone: ['', '', ''],      // 휴대전화. 화면에 이미 채워져 있으면 건드리지 않음 (계정 인증 번호 유지)
    pollMs: 1000,             // 오픈 대기 중 확인 주기(ms). 일정 페이지가 무거우니 1000 이상 권장
    openAt: '',               // 예약 오픈 시각 (PC 시계 기준). 예: '2026-11-20 09:00:00'. 비우면 바로 확인 시작
    startBeforeSec: 30,       // 오픈 몇 초 전부터 확인 요청을 보낼지
    autoSubmit: false,        // true: 예약하기 + 확인창까지 자동 (실제 예약됨!)
  };
  // =================================================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const [Y, M, D] = CONFIG.date.split('-').map(Number);
  const shipNames = [].concat(CONFIG.shipName || []).filter(Boolean); // 글자 하나 또는 배열 모두 허용
  const ym = `${Y}${String(M).padStart(2, '0')}`;
  const FLAG = 'ss24_auto_schedule'; // 이 스크립트가 예약 화면으로 보냈다는 표시

  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:8px 12px;font:bold 14px sans-serif;background:#222;color:#ff0;';
  const status = (msg) => { banner.textContent = '[자동입력] ' + msg; console.log('[자동입력]', msg); };
  (document.body || document.documentElement).appendChild(banner);

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
    const label = `${M}월 ${D}일${CONFIG.openAt ? ` / 오픈 ${CONFIG.openAt}` : ''}`;
    if (CONFIG.openAt) {
      const startAt = new Date(CONFIG.openAt.replace(' ', 'T')).getTime() - CONFIG.startBeforeSec * 1000;
      while (Date.now() < startAt) {
        const s = Math.ceil((startAt - Date.now()) / 1000);
        const hms = new Date(s * 1000).toISOString().slice(11, 19);
        banner.textContent = `[자동입력] ${label} / 확인 시작까지 ${s >= 86400 ? Math.floor(s / 86400) + '일 ' : ''}${hms} (요청 없음)`;
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
          status(`예약 오픈 감지! 예약 화면으로 이동 (일정 ${no})`);
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

    const btn = document.getElementById('btn_payment');
    btn.scrollIntoView({ block: 'center' });
    btn.style.outline = '4px solid red';

    const people = count();
    const seatBoxes = document.querySelectorAll('input[name="select_seat_nos[]"]').length;
    const notes = [];
    if (people !== CONFIG.people) notes.push(`인원이 ${CONFIG.people}명이 아니라 ${people}명입니다(최대 인원 제한)`);
    if (seatBoxes) notes.push('이 배는 좌석을 직접 골라야 합니다');
    const summary = `인원 ${people}명, 예약자 ${document.querySelector('input[name=name]')?.value || '(비어 있음)'}`;

    if (!CONFIG.autoSubmit || !fromScript || seatBoxes || people !== CONFIG.people) {
      const why = CONFIG.autoSubmit && !fromScript ? ' (직접 연 화면이라 자동 제출 안 함)' : '';
      status(`완료: ${summary}. ${notes.join(', ')}${notes.length ? '. ' : ''}확인 후 빨간 "예약하기"를 누르세요.${why}`);
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

  if (location.pathname.startsWith('/mypage/reservation_ready/')) fillReservation();
  else waitOnSchedule();
})();
