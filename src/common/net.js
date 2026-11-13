  // ---------- 사이트 요청 줄이기·차단 대응 ----------
  // 사이트가 접근을 막으면(403 Forbidden·429 Too Many Requests) 요청을 계속 보내 차단이 길어지지 않게 스크립트를 모두 멈춤
  const BLOCK_MSG = '사이트가 이 인터넷 주소의 접근을 막았습니다(403/429). 스크립트는 요청을 멈췄습니다. 이 사이트를 한동안(수십 분 이상) 열지 말고 기다렸다가 다시 시도하세요.';
  const isBlockedPage = () => /^(403 Forbidden|429 Too Many Requests)$/.test(document.title.trim())
    || /You don't have permission to access/.test(document.body?.textContent || '');
  let blocked = false;
  let netErrors = 0; // 사이트 오류(5xx 등)·연결 실패가 연달아 난 횟수 (오픈 확인 간격을 늘리는 데 씀)
  // 사이트 페이지 받기: 차단 응답이면 모든 대기·요청을 멈추고 알림
  async function fetchPage(url, opts = {}) {
    if (blocked) throw new Error('blocked');
    let r;
    try { r = await fetch(url, { cache: 'no-store', ...opts }); } catch (e) {
      if (e.name !== 'AbortError') netErrors++; // 직접 끊은 요청은 사이트 문제가 아님
      throw e;
    }
    netErrors = r.ok ? 0 : netErrors + 1;
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
