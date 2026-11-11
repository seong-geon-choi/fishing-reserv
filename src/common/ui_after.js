  document.documentElement.appendChild(host);
  // 상태 바가 사이트 위쪽 메뉴를 가리지 않게, 바 높이만큼 페이지를 아래로 밀기
  const $bar = ui.querySelector('.bar');
  new ResizeObserver(() => { document.documentElement.style.paddingTop = $bar.offsetHeight + 'px'; }).observe($bar);
  const $msg = ui.querySelector('.msg');
  const panel = ui.querySelector('.panel');
  const status = (m) => { $msg.textContent = m; console.log('[자동입력]', m); };
