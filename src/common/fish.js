  // 낚시종류 고르기: 키워드가 하나라도 들어간 종류 중 맨 위 (없으면 null). textOf: 그 종류의 화면 글자
  function fishByKeyword(items, textOf) {
    return items.find((it) => CONFIG.fishKeywords.some((k) => textOf(it).includes(k))) || null;
  }
  // 낚시종류가 모두 마감(선택 불가)일 때는 진행하지 않고 안내
  const NO_FISH_MSG = '선택할 수 있는 낚시종류가 없습니다(모두 마감). 화면을 확인하세요.';
