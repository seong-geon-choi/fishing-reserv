
  // ---------- 긴급 정지: 스크립트가 일하는 중(예약 대기·다시 열기·자동입력)에 Esc → 확인창 → 모두 멈춤 ----------
  // 브라우저 기본 확인창(confirm)은 브라우저 전체를 멈추므로 쓰지 않고 화면 안의 확인창을 씀.
  // 확인창이 떠 있는 동안에는 예약 화면 이동·다시 열기·자동 신청 같은 다음 단계로 넘어가지 않음 (checkpoint에서 기다림)
  let halted = false; // 긴급 정지함
  let asking = false; // 확인창이 떠 있음
  let filling = false; // 예약 화면 자동입력 중
  let onHalt = () => {}; // 사이트별 정리 (이 탭의 시작 표시 지우기 등)
  const haltBox = document.createElement('div');
  haltBox.className = 'halt';
  haltBox.hidden = true;
  haltBox.innerHTML = `<div class="halt-box" role="alertdialog" aria-modal="true"><b>스크립트 작업을 중단할까요?</b>
    <p>예약 대기, 자동입력, 자동 신청을 모두 멈춥니다. 사이트 화면에 이미 입력된 내용은 그대로 둡니다.</p>
    <div class="btns"><button type="button" class="halt-no">취소</button><button type="button" class="halt-yes primary">중단</button></div></div>`;
  ui.appendChild(haltBox);
  const busy = () => !halted && (filling || !stopBtn.hidden);
  const closeAsk = () => { asking = false; haltBox.hidden = true; };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || asking || !busy()) return; // 일하지 않을 때는 사이트의 Esc 동작을 막지 않음
    e.preventDefault();
    e.stopPropagation();
    asking = true;
    haltBox.hidden = false;
    haltBox.querySelector('.halt-yes').focus(); // Enter = 중단
  }, true);
  haltBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAsk(); } });
  haltBox.querySelector('.halt-no').onclick = closeAsk;
  haltBox.querySelector('.halt-yes').onclick = () => { closeAsk(); halt(); };
  function halt() {
    halted = true;
    stopped = true; // 대기·겹쳐 보내기·다시 열기가 이 표시를 보고 멈춤
    for (const c of ['.stop', '.ask', '.start']) ui.querySelector(c).hidden = true;
    onHalt();
    status('긴급 정지했습니다. 스크립트는 더 이상 아무것도 하지 않습니다. 다시 하려면 새로고침한 뒤 시작하세요.');
  }
  // 다음 단계로 넘어가기 전에 부름: 확인창이 떠 있으면 답할 때까지 기다리고, 정지했으면 false
  async function checkpoint() {
    while (asking) await sleep(100);
    return !halted;
  }
