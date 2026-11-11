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
