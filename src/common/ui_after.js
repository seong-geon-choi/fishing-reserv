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
    $toasts.style.top = $bar.offsetHeight + 8 + 'px';
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
