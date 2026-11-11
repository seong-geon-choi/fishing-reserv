  // 좌석 고르기: 인원만큼 빈 좌석이 있는 첫 그룹 → 없으면 그룹 좌석을 적은 순서대로 → (설정 시) 남은 빈 좌석을 화면 순서대로
  // freeSeats: 지금 빈 좌석 번호 (화면 순서)
  function pickSeats(freeSeats, want) {
    const free = (n) => freeSeats.includes(n);
    const group = CONFIG.seatGroups.find((g) => g.filter(free).length >= want);
    let picks = (group || [...new Set(CONFIG.seatGroups.flat())]).filter(free).slice(0, want);
    if (picks.length < want && CONFIG.fallbackAnySeat) picks = picks.concat(freeSeats.filter((n) => !picks.includes(n)).slice(0, want - picks.length));
    return picks;
  }
  // 잡은 좌석이 인원보다 적을 때: "남은 좌석만큼만 예약"이 켜져 있고 최소 인원 이상이면 그 인원으로 진행.
  // 진행할 인원 수를 돌려주고, 진행하지 않으면(자동 신청 안 함) 0
  function seatShortage(got, want) {
    if (got >= want) return want;
    const min = Math.max(1, CONFIG.minPeople || 1);
    if (CONFIG.partialSeats && got >= min) {
      toast(`잡을 수 있는 좌석이 ${got}석뿐이라 ${got}명으로 예약합니다 (설정 인원 ${want}명)`);
      return got;
    }
    const why = !got ? '잡을 수 있는 좌석이 없습니다'
      : `잡을 수 있는 좌석이 ${got}석뿐입니다 (설정 인원 ${want}명${CONFIG.partialSeats ? `, 최소 인원 ${min}명` : ''})`;
    toast(`${why}. 자동 신청하지 않습니다. 화면을 확인하고 직접 정하세요.`);
    return 0;
  }
