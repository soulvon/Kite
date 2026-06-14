const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '../resources/windsurf-better.js'),
  path.join(__dirname, '../resources/devin-better.js')
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  
  // 找到诊断块开始位置 (window.wsDiagnoseError = function)
  let diagStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('window.wsDiagnoseError = function')) {
      // 往前找注释行
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].trim().startsWith('//') && lines[j].includes('诊断工具')) {
          diagStart = j;
          break;
        }
      }
      if (diagStart === -1) diagStart = i;
      break;
    }
  }
  
  // 找到测试块结束位置 (console.log('[Test] 已暴露测试函数')后的空行)
  let testEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('[Test] 已暴露测试函数')) {
      testEnd = i + 1; // 包含这行日志
      // 跳过空行
      while (testEnd < lines.length && lines[testEnd].trim() === '') {
        testEnd++;
      }
      break;
    }
  }
  
  if (diagStart !== -1 && testEnd !== -1) {
    // 删除 diagStart 到 testEnd 之间的行
    const before = lines.slice(0, diagStart);
    const after = lines.slice(testEnd);
    const newContent = before.concat(after).join('\n');
    fs.writeFileSync(file, newContent, 'utf8');
    console.log(`✅ ${path.basename(file)}: 已删除第 ${diagStart + 1}-${testEnd} 行 (诊断+测试块)`);
  } else {
    console.log(`⚠️ ${path.basename(file)}: 未找到完整的诊断/测试块 (start=${diagStart}, end=${testEnd})`);
  }
});
