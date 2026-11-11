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
