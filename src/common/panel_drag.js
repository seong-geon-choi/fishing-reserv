  // ---------- 설정 창 끌어서 옮기기 (위치는 이 사이트에 기억) ----------
  const POS_KEY = 'fishingReserv.panelPos';
  function placePanel(x, y) {
    if (x === undefined) {
      let p = null;
      try { p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { /* 무시 */ }
      x = p ? p.x : (window.innerWidth - panel.offsetWidth) / 2;
      y = p ? p.y : 48;
    }
    // 화면 밖으로 나가지 않게 (머리 부분은 항상 보이게)
    x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - panel.offsetWidth));
    y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 48));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    return { x, y };
  }
  panel.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.phead');
    if (!head || e.target.closest('.x')) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => placePanel(ev.clientX - dx, ev.clientY - dy);
    const up = (ev) => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      const pos = placePanel(ev.clientX - dx, ev.clientY - dy);
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (err) { /* 무시 */ }
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  window.addEventListener('resize', () => { if (!panel.hidden) placePanel(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0); });

  ui.querySelector('.gear').onclick = () => (panel.hidden ? openPanel() : (panel.hidden = true));
