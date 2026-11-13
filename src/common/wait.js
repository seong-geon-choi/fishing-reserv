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

  // ---------- 오픈 확인 간격 (사이트 차단을 피하려고 필요한 때만 빠르게) ----------
  // 오픈 10초 전까지는 3초, 오픈 직전·직후 1분은 설정값(최소 0.5초), 오픈 1분이 지나도 안 열리면 2→3→5초로 늘림.
  // 사이트 오류가 이어지면 2배씩 늘림(최대 8초). 일정한 기계적 간격이 드러나지 않게 ±20% 흔들림
  function pollGap() {
    const fast = Math.max(500, CONFIG.pollMs);
    let gap = fast;
    if (CONFIG.openAt) {
      const t = serverNow() - new Date(CONFIG.openAt).getTime(); // 오픈 기준 (음수 = 오픈 전)
      if (t < -10000) gap = Math.max(fast, 3000);
      else if (t >= 60000) gap = Math.max(fast, t < 120000 ? 2000 : t < 180000 ? 3000 : 5000);
    }
    gap = Math.min(gap * 2 ** Math.min(netErrors, 3), Math.max(8000, gap));
    return gap * (0.8 + Math.random() * 0.4);
  }

  // ---------- 확인 시간 상한: 브라우저를 켜 두고 잊어도 요청이 끝없이 가지 않게, 확인을 시작하고 설정한 시간(기본 60분)이 지나면 멈춤 ----------
  // (요청이 없는 카운트다운은 길어도 괜찮으므로 세지 않음)
  const pollLimitMin = () => Math.max(5, CONFIG.pollLimitMin || 60);
  const pollLimitMsg = () => `확인을 시작한 지 ${pollLimitMin()}분이 지나도 예약이 열리지 않아 자동으로 멈췄습니다(사이트 차단 방지). 다시 하려면 "예약 대기 시작"을 누르세요.`;
  let pollTimedOut = false; // 마지막 확인이 시간 상한으로 끝났는지

  // ---------- 겹쳐 보내기: 응답이 늦어도 끊지 않고 기다리되, 5초 넘게 응답이 없으면 하나 더 보냄 (최대 2개) ----------
  // probe(signal) → 열렸으면 결과, 아니면 null
  async function pollOverlap(probe, dead, label) {
    const MAX_INFLIGHT = 2, STAGGER_MS = 5000, ASK_AFTER_MS = 60000; // 사이트가 느릴 때 더 몰아붙이지 않게 최대 2개
    let found = null, sent = 0, lastSent = 0, gap = 0;
    const started = Date.now();
    pollTimedOut = false;
    const reqs = new Set(); // 응답을 기다리는 요청: { ctl, deadline }
    const fire = () => {
      sent++; lastSent = Date.now(); gap = pollGap();
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
      if (Date.now() - started >= pollLimitMin() * 60000) { pollTimedOut = true; stopped = true; stopBtn.hidden = true; status(pollLimitMsg()); break; }
      const since = Date.now() - lastSent;
      if ((reqs.size === 0 && since >= gap) || (reqs.size > 0 && reqs.size < MAX_INFLIGHT && since >= STAGGER_MS)) fire();
      const late = overdue().length;
      ask.hidden = !late;
      status(`${label} 오픈 대기 중… (${sent}회 확인, 약 ${(gap / 1000).toFixed(1)}초 간격)${reqs.size > 1 ? ` · 사이트 응답 지연, 응답 대기 ${reqs.size}개` : ""}${late ? ` · ${late}개 요청이 1분 넘게 응답이 없습니다. 더 기다릴까요?` : ""}`);
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
