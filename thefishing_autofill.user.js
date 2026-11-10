// ==UserScript==
// @name         더피싱 예약 자동입력 (만석호·나대세호·팀루피호 등)
// @namespace    reserv
// @version      1.0
// @description  예약 오픈 대기 → 낚시종류 선택 → 좌석/인원 → 예약자 정보 → 동의까지 자동. "예약 신청하기" 버튼은 직접 누르세요.
// @match        https://*.thefishing.kr/_core/module/reservation_boat_v5.2_seat1/popup.step1.php*
// @match        https://*.thefishing.kr/_core/module/reservation_boat_v5.2_seat1/popu2.step1.php*
// @샘플         https://mscufishing.thefishing.kr/_core/module/reservation_boat_v5.2_seat1/popup.step1.php?date=20261124&PA_N_UID=3570
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 설정 =====================
  const CONFIG = {
    fishKeywords: ['갑오징어', '오징어'],  // 하나라도 포함된 종류 중 맨 위 것 선택. 비우면([]) 첫 번째 종류 선택
    people: 4,                // 예약 인원
    // 좌석 그룹 (앞에서부터 우선). 그룹 안의 빈 좌석이 인원 이상이면 그 그룹에서 빈 좌석을 순서대로 선택.
    // 모든 그룹이 불가능하면 그룹들을 순서대로 펼친 목록에서 빈 좌석을 차례로 선택.
    seatGroups: [[8,9,7,10,11,6], [2,3,14,15,1,4,13], [8,9,10,11], [5,12]],
    fallbackAnySeat: true,    // 위 목록으로도 인원이 부족하면 남은 아무 좌석으로 채움
    name: '',                 // 예약자명
    depositor: '',            // 입금자명
    tel: ['', '', ''],        // 휴대폰 번호 세 칸 (예: ['010', '1234', '5678'])
    pollMs: 700,              // 오픈 대기 중 확인 주기(ms)
    openAt: '2027-01-01 12:00:01',               // 예약 오픈 시각 (PC 시계 기준). 예: '2026-11-11 09:00:00'. 비우면 바로 확인 시작
    startBeforeSec: 30,       // 오픈 몇 초 전부터 확인 요청을 보낼지
    autoSubmit: false,        // true: 입력 후 "예약 신청하기"까지 자동 클릭 (실제 예약됨!)
  };
  // =================================================

  const q = new URLSearchParams(location.search);
  const date = q.get('date');
  const pa = q.get('PA_N_UID');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:8px 12px;font:bold 14px sans-serif;background:#222;color:#ff0;';
  const status = (msg) => { banner.textContent = '[자동입력] ' + msg; console.log('[자동입력]', msg); };
  (document.body || document.documentElement).appendChild(banner);

  // 낚시종류 선택지(라디오)만. 페이지에는 같은 이름의 숨은 칸(ps_form)도 있음
  const fishRadios = (doc = document) => [...doc.querySelectorAll('input[type=radio][name=PS_N_UID]')];

  // 1) 오픈 전: 페이지를 새로고침하지 않고 fetch로 확인하다가 열리면 reload
  async function waitForOpen() {
    // 오픈 시각이 설정돼 있으면 (오픈 - startBeforeSec)까지는 요청 없이 카운트다운만
    if (CONFIG.openAt) {
      const startAt = new Date(CONFIG.openAt.replace(' ', 'T')).getTime() - CONFIG.startBeforeSec * 1000;
      while (Date.now() < startAt) {
        const s = Math.ceil((startAt - Date.now()) / 1000);
        const hms = new Date(s * 1000).toISOString().slice(11, 19);
        banner.textContent = `[자동입력] ${date} 오픈 ${CONFIG.openAt} / 확인 시작까지 ${s >= 86400 ? Math.floor(s / 86400) + '일 ' : ''}${hms} (요청 없음)`;
        await sleep(Math.min(1000, startAt - Date.now()));
      }
    }
    let n = 0;
    while (true) {
      n++;
      status(`${date} 오픈 대기 중…${CONFIG.openAt ? ` 오픈 ${CONFIG.openAt}` : ''} (${n}회 확인)`);
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
    status('낚시종류 선택: ' + (pick.closest('tr')?.innerText.trim().split('\n')[0] || pick.value));
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
    if (CONFIG.autoSubmit) {
      status(`좌석 [${picks.join(', ') || '지정없음'}] 예약 신청 중…`);
      btn.click(); // 사이트의 form_check 검증을 거쳐 제출됨
      return;
    }
    status(`완료: 좌석 [${picks.join(', ') || '지정없음'}], 인원 ${document.getElementById('BI_IN').value}명. 확인 후 빨간 버튼을 누르세요.`);
  }

  if (!fishRadios().length) waitForOpen();
  else if (!q.get('PS_N_UID')) selectFish();
  else fillForm();
})();
