  // 자동 신청이 켜져 있으면 눈에 띄게: 상태 바의 "자동 신청 켜짐" + 화면 전체 빨간 테두리 깜빡임
  ui.querySelector('.auto').hidden = !CONFIG.autoSubmit;
  ui.querySelector('.autoframe').hidden = !CONFIG.autoSubmit;
