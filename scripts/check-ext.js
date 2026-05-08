const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const dirs = [
  'C:\\Users\\admin\\.windsurf\\extensions\\local.windsurf-pool-4.20.7',
  'C:\\Users\\admin\\.windsurf\\extensions\\local.windsurf-pool-4.21.0',
];

for (const d of dirs) {
  const pkg = path.join(d, 'package.json');
  const js = path.join(d, 'resources', 'windsurf-better.js');
  if (!fs.existsSync(js)) { console.log(d, '→ 脚本不存在'); continue; }
  const content = fs.readFileSync(js, 'utf8');
  const hash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 10);
  const m = content.match(/const VERSION = '([\d.]+)'/);
  const ver = m ? m[1] : '0.0.0';
  const pkgJson = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  console.log(`\n${d}`);
  console.log(`  package.json version: ${pkgJson.version}`);
  console.log(`  script hash (patchVersion): ${ver}-${hash}`);
  console.log(`  script length: ${content.length}`);
  console.log(`  有新代码 submitBubbleText 对齐? ${content.includes('submitBubbleText 对齐')}`);
  console.log(`  轮询 500? ${content.includes('setInterval(tick, 500)')}`);
}
