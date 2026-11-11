// 배포용 스크립트 만들기: node build.js
// src/*.user.js 안의 "//@@include 파일" 줄을 src/common/의 그 파일 내용으로 바꿔 저장소 맨 위의 *.user.js를 만듦.
// 공통 코드(설정 창, 상태 바, 서버 시계, 겹쳐 보내기, 카운트다운, 다시 열기)는 src/common/에서만 고칠 것.
// 결과가 바뀐 파일만 다시 쓰고, @version은 마지막 자리를 1 올리고 수정 시각(월일-시분초)을 붙임.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const VER_LINE = /^(\/\/ @version\s+).*$/m;
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

for (const name of fs.readdirSync(SRC).filter((f) => f.endsWith('.user.js'))) {
  const out = read(path.join(SRC, name)).replace(/^[ \t]*\/\/@@include (\S+)[ \t]*\n/gm, (_, f) => read(path.join(SRC, 'common', f)));
  const dist = path.join(__dirname, name);
  const old = fs.existsSync(dist) ? read(dist) : '';
  if (out.replace(VER_LINE, '') === old.replace(VER_LINE, '')) { console.log(`${name}: 변경 없음`); continue; }
  const [a = 1, b = 0, c = -1] = ((old.match(/^\/\/ @version\s+(\d+)\.(\d+)\.(\d+)/m) || []).slice(1)).map(Number);
  const ver = `${a}.${b}.${c + 1}.${stamp}`;
  fs.writeFileSync(dist, out.replace(VER_LINE, (_, p) => p + ver));
  console.log(`${name}: ${ver}`);
}
