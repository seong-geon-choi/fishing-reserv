  // 설정 창 머리 + 빈 입력 칸 격자. 버전 "2.3.1.1110-225502" (기본 버전.월일-시분초) → "버전 2.3.1 · 수정 11-10 22:55:02"
  function panelTop(note) {
    const raw = typeof GM_info !== 'undefined' ? GM_info.script.version : '';
    const vm = raw.match(/^(\d+\.\d+\.\d+)\.(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    const ver = !raw ? '' : vm ? `버전 ${vm[1]} · 수정 ${vm[2]}-${vm[3]} ${vm[4]}:${vm[5]}:${vm[6]}` : `버전 ${raw}`;
    panel.innerHTML = `<div class="phead" title="끌어서 옮길 수 있습니다"><b>예약 자동입력 설정</b><span class="ver">${ver}</span><span class="grip">⠿ 끌어서 이동</span><button type="button" class="x" aria-label="닫기">×</button></div>
      <p class="sub">이 사이트(${location.hostname})에 저장됩니다. 다른 업체 사이트에서는 따로 입력하세요.</p>
      <p class="err">${note || ''}</p><div class="grid4"></div>`;
    return panel.querySelector('.grid4');
  }
  // 설정 칸 하나 (체크박스 또는 입력칸, 지금 값으로 채움)
  function addField(grid, f, c) {
    const id = 'f_' + f.key;
    const help = f.help ? `<span class="help">${f.help}</span>` : '';
    if (f.inline) {
      // 바로 앞 체크박스 줄 끝에 작은 입력칸으로 붙임 (예: 최소 인원 [1]명)
      grid.lastElementChild.insertAdjacentHTML('beforeend', `<span class="inl">${f.label} <input id="${id}" type="number" inputmode="numeric">${f.unit || ''}</span>`);
      ui.getElementById(id).value = toText(f, c[f.key]);
      return;
    }
    if (f.type === 'check') {
      grid.insertAdjacentHTML('beforeend', `<label class="c span${f.w || 4} ${f.danger ? 'danger' : ''}"><input type="checkbox" id="${id}" ${c[f.key] ? 'checked' : ''}><span>${f.label}${f.danger ? `<span class="help danger">${f.danger}</span>` : help}</span></label>`);
      return;
    }
    const input = f.type === 'groups' ? `<textarea id="${id}"></textarea>`
      : `<input id="${id}" type="${{ number: 'number', datetime: 'datetime-local', date: 'date' }[f.type] || 'text'}" ${f.type === 'datetime' ? 'step="1"' : ''} ${f.type === 'phone' ? 'inputmode="tel"' : ''}>`;
    grid.insertAdjacentHTML('beforeend', `<label class="f span${f.w || 1}"><span>${f.label}${f.required ? ' <b>*</b>' : ''}</span>${input}${help}</label>`);
    ui.getElementById(id).value = toText(f, c[f.key]);
  }
  // 설정 창 아래 버튼을 붙이고 보이기
  function showPanel() {
    panel.insertAdjacentHTML('beforeend', `<div class="btns"><button type="button" class="close">닫기</button><button type="submit" class="primary">저장하고 새로고침</button></div>`);
    panel.querySelector('.close').onclick = () => { panel.hidden = true; };
    panel.querySelector('.x').onclick = () => { panel.hidden = true; };
    panel.hidden = false;
    placePanel();
  }
