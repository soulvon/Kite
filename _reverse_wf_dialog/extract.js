const fs = require('fs');
const s = fs.readFileSync('e:/project/windsurf-pool/_reverse_wf_dialog/extension/dist/extension.js', 'utf8');

// 找到 DevinAutomationService 类定义
const marker = "DevinAutomationService']=void";
const i = s.indexOf(marker);
console.log('class start @', i);

// 提取 50KB
let t = s.substring(i, i + 50000);

// 反转义 \xNN
t = t.replace(/\\x([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
t = t.replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

// 简单格式化
t = t.replace(/;/g, ';\n').replace(/\{/g, '{\n').replace(/\}/g, '\n}\n');

fs.writeFileSync('e:/project/windsurf-pool/_reverse_wf_dialog/devin_auto.js', t);
console.log('written, lines:', t.split('\n').length);
