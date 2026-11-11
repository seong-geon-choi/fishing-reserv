  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 설정 저장/불러오기 ----------
  const loadConfig = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; } };
  const saveConfig = (c) => localStorage.setItem(STORE_KEY, JSON.stringify(c));
  const fmtTime = (s) => (s || '').replace('T', ' ');
