const fs = require('fs');
const p = 'E:\\Program\\Windsurf\\resources\\app\\out\\vs\\code\\electron-browser\\workbench\\workbench.html';
const html = fs.readFileSync(p, 'utf8');

const marker = html.match(/<!-- ws-better-v([\d.]+-[a-f0-9]+) -->/);
console.log('marker version:', marker ? marker[1] : '(无)');

const idx = html.indexOf("case 'test-send-continue':");
console.log('test-send-continue 位置:', idx);
if (idx > 0) {
  console.log('--- workbench.html 中的 test-send-continue 代码 ---');
  console.log(html.substring(idx, idx + 2500));
}
