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
