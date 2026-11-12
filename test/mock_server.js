// 연습용 가짜 예약 사이트 (실제 사이트에 요청을 보내지 않고 스크립트를 시험)
// 실행: node test/mock_server.js  → http://localhost:8787/
// 실제 더피싱·선상24와 같은 경로·화면 구조를 흉내 내고, 빌드된 두 스크립트(*.user.js)를 페이지에 붙여 실행함.
// 상황 조절: /__admin (오픈까지 남은 시간, 예약된 좌석, 남은 인원, 로그인, 응답 지연, 화면 깨짐, 차단 403, 예약 내역)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 8787;
const ROOT = path.join(__dirname, '..');
const MOD = '/_core/module/reservation_boat_v5.2_seat1';

// ---------- 상황 (관리 화면에서 바꿈) ----------
const S = {
  openAt: Date.now(), // 이 시각부터 예약이 열림
  slowMs: 0, // 오픈 확인 요청 응답 지연
  broken: 0, // 남은 횟수만큼 예약 화면을 깨진 채로 보냄
  dayFail: false, // 선상24 하루치 일정 요청을 실패(500)로
  hits: {}, // 경로별 요청 수 (스크립트가 사이트에 얼마나 요청하는지 확인용)
  block: false, // 모든 페이지를 403으로
  // 더피싱
  tfTaken: new Set([3, 9]), // 만석호 이미 예약된 좌석
  tfChosen: new Set(), // 이 브라우저가 눌러 둔 좌석 (실제 사이트는 세션에 기억)
  tfRemain: 2, // 팀루피호(좌석 없는 배) 남은 자리
  // 선상24
  ssLoggedIn: true,
  ssRemain: 12, // 남은 승선 인원
  ssPerReservation: 20, // 1인 최대 예약 인원
  ssTaken: new Set([1, 8]), // 테스트호 이미 예약된 좌석 (1~20)
  log: [], // 접수된 예약
};
const isOpen = () => Date.now() >= S.openAt;
const TF_SHIPS = { 3570: { name: '만석호', seats: 15 }, 6161: { name: '팀루피호', seats: 0 } };

// ---------- 공통 ----------
const page = (title, body, script) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px sans-serif;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}
.res_ship_seat{display:flex;flex-wrap:wrap;gap:4px;width:420px}.res_ship_seat div{width:40px}
.res_num_view,.res_num_view_chosen,.res_num_view_disable{display:inline-block;width:32px;text-align:center;border:1px solid #888;cursor:pointer}
.res_num_view_chosen{background:#1c6fb8;color:#fff}.res_num_view_disable{background:#ccc;cursor:default}
button,#submit{padding:8px 16px}</style></head><body>${body}
${script ? `<script src="/${script}"></script>` : ''}</body></html>`;
const send = (res, code, html, headers = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(html); };
const FORBIDDEN = '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"><html><head><title>403 Forbidden</title></head><body><h1>Forbidden</h1><p>You don\'t have permission to access this resource.</p></body></html>';
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(new URLSearchParams(b))); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (site, info) => { S.log.push({ at: new Date().toLocaleTimeString('ko-KR'), site, ...info }); console.log('[예약 접수]', site, JSON.stringify(info)); };

// ---------- 더피싱 ----------
function tfList() {
  const links = Object.entries(TF_SHIPS).map(([id, s]) => `<li><a href="/index.php?mid=bk&PA_N_UID=${id}">${s.name}</a></li>`).join('');
  return page('예약하기 - 연습용 더피싱', `<h2>예약 목록 (연습용)</h2><ul>${links}</ul>
    <p><button onclick="window.open('${MOD}/popup.step1.php?date=20261120&PA_N_UID=3570')">예약하기</button></p>`, 'thefishing_autofill.user.js');
}
function tfStep1(q) {
  const date = q.get('date'), pa = q.get('PA_N_UID'), ps = q.get('PS_N_UID');
  const ship = TF_SHIPS[pa];
  // 실제 사이트는 글자만 보내지만, Tampermonkey처럼 스크립트가 붙도록 페이지로 감쌈
  if (!ship || !isOpen()) return page('예약1단계', '예약할 수 없는 날짜이거나 예약권한이 없습니다', 'thefishing_autofill.user.js');
  const title = `${ship.name} > 예약1단계`;
  const fish = `<table><tr><th>낚시종류(남은자리)</th></tr>
    <tr><td><input type="radio" name="PS_N_UID" value="100" ${ps === '100' ? 'checked' : ''} onclick="ps_url('${date}','${pa}','0','100')"> 쭈꾸미(${ship.seats ? ship.seats - S.tfTaken.size : S.tfRemain}명)</td></tr>
    <tr><td><input type="radio" name="PS_N_UID" value="101" ${ps === '101' ? 'checked' : ''} onclick="ps_url('${date}','${pa}','0','101')"> 갑오징어(${ship.seats ? ship.seats - S.tfTaken.size : S.tfRemain}명)</td></tr></table>
    <form name="ps_form"><input type="hidden" name="PS_N_UID" value="${ps || ''}"></form>
    <script>function ps_url(d,p,h,s){ location.href='./popup.step1.php?date='+d+'&PA_N_UID='+p+'&PH_N_UID='+h+'&PS_N_UID='+s; }</script>`;
  if (!ps) return page(title, `<h2>${title}</h2>${fish}`, 'thefishing_autofill.user.js');
  if (S.broken > 0) { S.broken--; return page(title, `<h2>${title}</h2><p>(일부만 그려진 화면)</p>`, 'thefishing_autofill.user.js'); }
  const seatMap = ship.seats ? `<div class="res_ship_seat">${Array.from({ length: ship.seats }, (_, i) => {
    const n = i + 1, slot = String(6 + i).padStart(2, '0'), id = `c${date}${pa}${n}`;
    if (S.tfTaken.has(n)) return `<div class="res_seat${slot}"><span id="${id}" class="res_num_view_disable">${n}</span></div>`;
    const cls = S.tfChosen.has(n) ? 'res_num_view_chosen' : 'res_num_view';
    return `<div class="res_seat${slot}"><span id="${id}" class="${cls}" onclick="ticket_seat_click('${date}','${pa}','${n}')">${n}</span></div>`;
  }).join('')}</div>` : '';
  const opts = ['<option value="">선택</option>', ...Array.from({ length: 99 }, (_, i) => `<option>${i + 1}</option>`)].join('');
  const naun = ship.seats ? ship.seats - S.tfTaken.size : S.tfRemain;
  const radio = (n, v, label) => `<label><input type="radio" name="${n}" value="${v}"> ${label}</label>`;
  return page(title, `<h2>${title}</h2>${fish}${seatMap}
    <form name="insert_form" method="post" action="${MOD}/action/popup.step1.action.php" onsubmit="return form_check(this);">
    <input type="hidden" name="date" value="${date}"><input type="hidden" name="PA_N_UID" value="${pa}"><input type="hidden" name="seats" id="seats">
    <p>인원 <select id="BI_IN" name="BI_IN" onchange="popup_ajax_step1()" ${ship.seats ? 'disabled' : ''}>${opts}</select>
      <span id="id_ye">인원을 선택하세요.</span> / <span id="id_to"></span><input type="hidden" id="temp_bi_stat" value=""></p>
    <p>예약자명 <input name="BI_NAME"> 입금자명 <input name="BI_BANK"> 휴대폰 <input name="BI_TEL1" size="3">-<input name="BI_TEL2" size="4">-<input name="BI_TEL3" size="4"></p>
    <p>1. ${radio('agree', 'Y', '동의')} ${radio('agree', 'N', '동의 안 함')}<br>2. ${radio('BI_3JA', '1', '동의')}<br>3. ${radio('BI_AD', '1', '동의')}<br>${radio('all_agree', 'Y', '전체동의합니다.')}</p>
    <p><button type="submit" id="submit" class="lar_btn f_sm">예약 신청하기</button></p></form>
    <script>
    var SEAT_SHIP = ${ship.seats ? 'true' : 'false'};
    function chosen(){ return Array.prototype.map.call(document.querySelectorAll('.res_num_view_chosen'), function(e){ return e.textContent; }); }
    function ticket_seat_click(d, p, n) {
      var el = document.getElementById('c' + d + p + n);
      el.className = el.className === 'res_num_view_chosen' ? 'res_num_view' : 'res_num_view_chosen';
      fetch('${MOD}/action/seat.php?n=' + n + '&on=' + (el.className === 'res_num_view_chosen' ? 1 : 0));
      document.getElementById('BI_IN').value = String(chosen().length || '');
      document.getElementById('seats').value = chosen().join(',');
      popup_ajax_step1();
    }
    function popup_ajax_step1() {
      var BI_IN = document.getElementById('BI_IN').value;
      document.getElementById('temp_bi_stat').value = '';
      fetch('${MOD}/action/popup.step1.ajax.php', { method: 'POST', body: 'BI_IN=' + BI_IN + '&naun=${naun}' }).then(function(r){ return r.text(); }).then(function(html){
        var a = html.split('|^|'); document.getElementById('id_ye').innerHTML = a[0]; document.getElementById('id_to').innerHTML = a[1]; document.getElementById('temp_bi_stat').value = a[2];
        if (a[2] == '최대인원초과') { document.getElementById('BI_IN').value = ''; document.getElementById('temp_bi_stat').value = ''; alert('인원초과 입니다, 인원을 다시 선택해주십시오.'); }
      });
    }
    function form_check(f) {
      document.getElementById('BI_IN').disabled = false;
      if (!f.BI_IN.value) { alert('인원을 선택해 주십시오.'); return false; }
      if (document.getElementById('temp_bi_stat').value != '확인') { alert('인원·금액을 확인 중입니다.'); return false; }
      if (!f.BI_NAME.value) { alert('예약자명을 입력하세요.'); return false; }
      if (!document.querySelector('input[name=all_agree]:checked')) { alert('약관에 동의하세요.'); return false; }
      if (!confirm(document.getElementById('submit').innerHTML + ' 하시겠습니까?')) { return false; }
    }
    </script>`, 'thefishing_autofill.user.js');
}
function tfStep2(pending) {
  return page('만석호 > 예약확인', `<h2>STEP 02. 예약확인</h2>
    <p>${pending ? `${pending.date} / 배 ${pending.pa} / 인원 ${pending.people}명 / 좌석 ${pending.seats || '-'} / 예약자 ${pending.name}` : '(내용 없음)'}</p>
    <p>예약2단계입니다. 예약완료를 위해 예약 신청하기 버튼을 클릭하세요.</p>
    <form name="insert_form" method="post" action="${MOD}/action/popup.step2.action.php" onsubmit="return form_check(this);">
    <input type="hidden" name="action" value="insert"><button type="submit" id="submit" class="lar_btn f_sm">예약 신청하기</button></form>
    <script>function form_check(f) { /* 실제 사이트도 이 단계는 확인창 없음 */ }</script>`, 'thefishing_autofill.user.js');
}
let tfPending = null;

// ---------- 선상24 ----------
const SS_DATE = '2026-11-20';
const ssRow = () => `<tr><td class="date_info">11월 20일</td><td class="ship_info"><div class="title">테스트호</div><div class="btn_wrap">${isOpen()
  ? '<button class="direct btn_ship_reservation btn_user_reservation" data-schedule_no="5001" data-ship_no="77" data-sdate="2026-11-20" data-ship_status_code="ING">바로예약</button>'
  : '<span>예약 준비중</span>'}</div></td></tr>`;
function ssSchedule() {
  return page('연습용 선상24', `<div>${S.ssLoggedIn ? '<a href="#">로그아웃</a> <a href="/mypage/my">마이페이지</a>' : '<a href="#">로그인</a>'}</div>
    <h2>출항일정 (연습용)</h2><table>${ssRow()}</table>
    <script>document.addEventListener('click', function(e){ var b = e.target.closest('.btn_user_reservation'); if (b) location.href = '/mypage/reservation_ready/' + b.dataset.schedule_no; });</script>`, 'sunsang24_autofill.user.js');
}
function ssReserve() {
  if (S.broken > 0) { S.broken--; return page('예약', '<p>(일부만 그려진 화면)</p>', 'sunsang24_autofill.user.js'); }
  const seats = Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => !S.ssTaken.has(n))
    .map((n) => `<label><input type="checkbox" name="select_seat_nos[]" value="${n}"> ${n}</label>`).join(' ');
  const pay = S.ssLoggedIn ? '<button type="button" id="btn_payment" class="btn_payment">예약하기</button>' : '<button type="button" class="btn_payment">로그인 후 예약하기</button>';
  return page('테스트호 예약', `<h2>테스트호 ${SS_DATE} 예약</h2>
    <script>var data = { schedule: { remain_embarkation_num: ${S.ssRemain}, person_per_reservation: ${S.ssPerReservation} } };</script>
    <dl><dt class="num_modify"><a class="minus" href="javascript:;">−</a> <span class="people_count">1</span> <a class="plus" href="javascript:;">+</a></dt></dl>
    <input type="hidden" name="person_count" value="1">
    <div class="arrange_seating_wrap"><p>자리 선택: ${seats}</p></div>
    <p>예약자 <input name="name"> 입금자 <input name="deposit_name"> 휴대폰 <input name="phone1" size="3">-<input name="phone2" size="4">-<input name="phone3" size="4"></p>
    <p><label><input type="checkbox" name="all_check"> 전체 동의</label> <label><input type="checkbox" name="agree_rule[]"> 약관1</label> <label><input type="checkbox" name="agree_rule[]"> 약관2</label></p>
    <p>${pay}</p>
    <script>
    var cnt = document.querySelector('.people_count'), pc = document.querySelector('input[name=person_count]');
    document.querySelectorAll('dt.num_modify a').forEach(function(a){ a.addEventListener('click', function(){
      var n = +cnt.textContent + (a.classList.contains('plus') ? 1 : -1);
      if (n > data.schedule.remain_embarkation_num) { alert('최대 예약 가능한 인원은 ' + data.schedule.remain_embarkation_num + '명 입니다.'); return; }
      if (data.schedule.person_per_reservation > 0 && n > data.schedule.person_per_reservation) { alert('1인 최대 예약가능 인원은 ' + data.schedule.person_per_reservation + '명 입니다.'); return; }
      if (n < 0) return; cnt.textContent = n; pc.value = n; }); });
    document.querySelectorAll('input[name="select_seat_nos[]"]').forEach(function(b){ b.addEventListener('change', function(){
      if (document.querySelectorAll('input[name="select_seat_nos[]"]:checked').length > +pc.value) { b.checked = false; alert('인원수 만큼 자리를 선택 해 주시기 바랍니다.'); } }); });
    var pay = document.getElementById('btn_payment');
    if (pay) pay.addEventListener('click', function(){
      if (!document.querySelector('input[name=all_check]').checked) { alert('약관에 동의하세요.'); return; }
      if (!confirm('예약하시겠습니까?')) return;
      var seats = Array.prototype.map.call(document.querySelectorAll('input[name="select_seat_nos[]"]:checked'), function(b){ return b.value; }).join(',');
      fetch('/mypage/reservation_end/1', { method: 'POST', body: 'people=' + pc.value + '&seats=' + seats + '&name=' + encodeURIComponent(document.querySelector('input[name=name]').value) })
        .then(function(){ location.href = '/__done?site=sunsang24'; });
    });
    </script>`, 'sunsang24_autofill.user.js');
}

// ---------- 관리 화면 ----------
function admin(q) {
  if (q.has('open')) S.openAt = Date.now() + (+q.get('open')) * 1000;
  if (q.has('slow')) S.slowMs = +q.get('slow');
  if (q.has('broken')) S.broken = +q.get('broken');
  if (q.has('block')) S.block = q.get('block') === '1';
  if (q.has('dayFail')) S.dayFail = q.get('dayFail') === '1';
  if (q.has('hits')) S.hits = {};
  if (q.has('tfTaken')) S.tfTaken = new Set(q.get('tfTaken').split(',').filter(Boolean).map(Number));
  if (q.has('tfRemain')) S.tfRemain = +q.get('tfRemain');
  if (q.has('ssLoggedIn')) S.ssLoggedIn = q.get('ssLoggedIn') === '1';
  if (q.has('ssRemain')) S.ssRemain = +q.get('ssRemain');
  if (q.has('ssTaken')) S.ssTaken = new Set(q.get('ssTaken').split(',').filter(Boolean).map(Number));
  if (q.has('reset')) { S.log = []; S.tfChosen.clear(); tfPending = null; }
  const state = { hits: S.hits, dayFail: S.dayFail, openIn: Math.round((S.openAt - Date.now()) / 1000), open: isOpen(), slowMs: S.slowMs, broken: S.broken, block: S.block,
    tfTaken: [...S.tfTaken], tfChosen: [...S.tfChosen], tfRemain: S.tfRemain, ssLoggedIn: S.ssLoggedIn, ssRemain: S.ssRemain, ssTaken: [...S.ssTaken], log: S.log };
  if (q.get('json') === '1') return { json: state };
  return page('연습용 사이트 관리', `<h2>연습용 사이트 관리</h2><pre>${JSON.stringify(state, null, 2)}</pre>
    <p>바꾸기 예: <code>/__admin?open=60</code> (60초 뒤 오픈), <code>?tfTaken=3,9</code>, <code>?tfRemain=2</code>, <code>?ssRemain=12</code>, <code>?ssLoggedIn=0</code>, <code>?slow=8000</code>, <code>?broken=1</code>, <code>?block=1</code>, <code>?dayFail=1</code>, <code>?hits=0</code> (요청 수 초기화), <code>?reset=1</code>, <code>?json=1</code></p>
    <ul><li><a href="/index.php?mid=bk">더피싱 예약 목록</a></li><li><a href="/ship/schedule_fleet">선상24 일정 페이지</a></li></ul>`);
}

// ---------- 서버 ----------
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname, q = u.searchParams;
  if (!p.startsWith('/__') && !/\.user\.js$/.test(p)) S.hits[p] = (S.hits[p] || 0) + 1;
  try {
    if (p === '/__admin') { const r = admin(q); return r.json ? (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(r.json))) : send(res, 200, r); }
    if (p === '/__done') return send(res, 200, page('예약 완료', `<h2>예약 완료 (연습용, ${q.get('site')})</h2><p><a href="/__admin">관리 화면에서 접수 내역 보기</a></p>`));
    if (/\.user\.js$/.test(p)) { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(ROOT, path.basename(p)))); }
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (S.block) return send(res, 403, FORBIDDEN);
    if (p === '/') return send(res, 302, '', { Location: '/__admin' });
    // 더피싱
    if ((p === '/index.php' || p === '/') && q.get('mid') === 'bk') return send(res, 200, tfList());
    if (p === `${MOD}/popup.step1.php`) { if (S.slowMs) await sleep(S.slowMs); return send(res, 200, tfStep1(q)); }
    if (p === `${MOD}/action/seat.php`) { const n = +q.get('n'); if (q.get('on') === '1') S.tfChosen.add(n); else S.tfChosen.delete(n); return send(res, 200, 'ok'); }
    if (p === `${MOD}/action/popup.step1.ajax.php`) {
      const b = await readBody(req); const n = +b.get('BI_IN'), naun = +b.get('naun');
      await sleep(150);
      return send(res, 200, !n ? '인원을 선택하세요.|^||^|' : n > naun ? '|^||^|최대인원초과' : `${n * 90000}원|^|${n * 90000}원|^|확인`);
    }
    if (p === `${MOD}/action/popup.step1.action.php`) {
      const b = await readBody(req);
      tfPending = { date: b.get('date'), pa: b.get('PA_N_UID'), people: b.get('BI_IN'), seats: b.get('seats'), name: b.get('BI_NAME') };
      return send(res, 302, '', { Location: `${MOD}/popup.step2.php` });
    }
    if (p === `${MOD}/popup.step2.php`) return send(res, 200, tfStep2(tfPending));
    if (p === `${MOD}/action/popup.step2.action.php`) {
      if (tfPending) { record('thefishing', tfPending); for (const n of (tfPending.seats || '').split(',').filter(Boolean)) S.tfTaken.add(+n); S.tfChosen.clear(); }
      tfPending = null;
      return send(res, 302, '', { Location: '/__done?site=thefishing' });
    }
    // 선상24
    if (/^\/ship\/schedule_fleet(\/\d{6})?$/.test(p)) return send(res, 200, ssSchedule());
    if (/^\/ship\/schedule_fleet\/\d{4}-\d{2}-\d{2}\/0\/simple_day1$/.test(p)) { if (S.slowMs) await sleep(S.slowMs); if (S.dayFail) return send(res, 500, 'error'); return send(res, 200, p.includes(SS_DATE) ? ssRow() : ''); }
    if (p === '/mypage/my') return send(res, 200, page('마이페이지', S.ssLoggedIn ? '<a href="#">로그아웃</a>' : '<a href="#">로그인</a>'));
    if (p === '/mypage/reservation_ready/5001') return send(res, 200, ssReserve());
    if (p === '/mypage/reservation_end/1') {
      const b = await readBody(req);
      record('sunsang24', { date: SS_DATE, people: b.get('people'), seats: b.get('seats'), name: b.get('name') });
      for (const n of (b.get('seats') || '').split(',').filter(Boolean)) S.ssTaken.add(+n);
      S.ssRemain = Math.max(0, S.ssRemain - (+b.get('people') || 0));
      return send(res, 200, 'ok');
    }
    send(res, 404, page('404', '<p>없는 페이지 (연습용 사이트)</p>'));
  } catch (e) { console.error(e); send(res, 500, String(e)); }
}).listen(PORT, () => console.log(`연습용 사이트: http://localhost:${PORT}/__admin`));
