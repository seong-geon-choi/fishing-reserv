  // 낚시종류 고르기: 키워드가 하나라도 들어간 종류 중 맨 위 (없으면 null). textOf: 그 종류의 화면 글자
  function fishByKeyword(items, textOf) {
    return items.find((it) => CONFIG.fishKeywords.some((k) => textOf(it).includes(k))) || null;
  }
