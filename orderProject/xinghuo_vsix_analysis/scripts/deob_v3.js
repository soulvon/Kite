/**
 * 反混淆 v3：直接在 VM 中执行整个文件，拦截 DOM 调用
 * 对小文件 (<500KB) 有效
 */
const fs = require('fs');
const vm = require('vm');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace(/\.js$/, '_decoded.js');
if (!inputFile) { console.error('Usage: node deob_v3.js <input.js> [output.js]'); process.exit(1); }

const code = fs.readFileSync(inputFile, 'utf-8');
console.log(`[*] File: ${inputFile}, size: ${(code.length / 1024).toFixed(1)} KB`);

// 找解码器函数名
const decoderMatch = code.match(/function\s+(\w+)\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[^}]*?=\s*\w+\s*-\s*[\(-]/);
if (!decoderMatch) { console.error('[!] Cannot find decoder'); process.exit(1); }
const decoderName = decoderMatch[1];
console.log(`[*] Decoder: ${decoderName}`);

// 找字符串数组函数
const arrayMatch = code.match(new RegExp(`function\\s+${decoderName}[\\s\\S]*?var\\s+\\w+\\s*=\\s*(\\w+)\\s*\\(\\s*\\)`));
const arrayFuncName = arrayMatch ? arrayMatch[1] : null;
console.log(`[*] Array func: ${arrayFuncName}`);

// 策略：只提取 function T(){...} 和 function z(R,I){...} 以及中间的旋转IIFE
// 方法：正则匹配每个顶层 function 或 IIFE，手动用计数器找结束位置

function findBlockEnd(src, startPos) {
    // 找到第一个 { 然后跟踪嵌套
    let depth = 0;
    let inStr = false, strCh = '', esc = false;
    let foundFirst = false;
    for (let i = startPos; i < src.length; i++) {
        const c = src[i];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (inStr) {
            if (c === strCh) inStr = false;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; continue; }
        if (c === '{') { depth++; foundFirst = true; }
        else if (c === '}') {
            depth--;
            if (foundFirst && depth === 0) return i + 1;
        }
    }
    return src.length;
}

// 提取 function z(...){...}
const zStart = code.indexOf(decoderMatch[0]);
const zBodyStart = code.indexOf('{', zStart);
const zEnd = findBlockEnd(code, zBodyStart);
const zCode = code.slice(zStart, zEnd);
console.log(`[*] Decoder z: pos ${zStart}-${zEnd}, ${zEnd - zStart} chars`);

// 提取 function T(){...}
let tCode = '';
if (arrayFuncName) {
    const tRe = new RegExp(`function\\s+${arrayFuncName}\\s*\\(\\s*\\)\\s*\\{`);
    const tMatch = code.match(tRe);
    if (tMatch) {
        const tStart = code.indexOf(tMatch[0]);
        const tBodyStart = code.indexOf('{', tStart);
        const tEnd = findBlockEnd(code, tBodyStart);
        tCode = code.slice(tStart, tEnd);
        console.log(`[*] Array func T: pos ${tStart}-${tEnd}, ${tEnd - tStart} chars`);
    }
}

// 提取旋转 IIFE: (function(R,I){...while(!![]){...}}(T, 188022));
// 它在 z 函数之后，主逻辑 IIFE 之前
const afterZ = code.slice(zEnd);
// 找到 (function 开头的 IIFE
const iifeMatch = afterZ.match(/\(function\s*\(\s*\w+\s*,\s*\w+\s*\)/);
let rotCode = '';
if (iifeMatch) {
    const iifeStart = zEnd + afterZ.indexOf(iifeMatch[0]);
    // 找到匹配的结束括号：需要跟踪 ()
    let depth = 0, inStr = false, strCh = '', esc = false;
    let iifeEnd = iifeStart;
    for (let i = iifeStart; i < code.length; i++) {
        const c = code[i];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (inStr) { if (c === strCh) inStr = false; continue; }
        if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; continue; }
        if (c === '(') depth++;
        if (c === ')') { depth--; if (depth === 0) { iifeEnd = i + 1; break; } }
    }
    // 包含末尾分号
    while (iifeEnd < code.length && code[iifeEnd] === ';') iifeEnd++;
    rotCode = code.slice(iifeStart, iifeEnd);
    console.log(`[*] Rotation IIFE: pos ${iifeStart}-${iifeEnd}, ${rotCode.length} chars`);
}

// 组合并执行
const setupCode = tCode + ';\n' + zCode + ';\n' + rotCode;
console.log(`[*] Setup code total: ${setupCode.length} chars`);

// 保存调试文件
fs.writeFileSync(outputFile.replace(/\.js$/, '_setup.js'), setupCode, 'utf-8');

try {
    const sandbox = {
        console: { log: ()=>{}, error: ()=>{}, warn: ()=>{} },
        parseInt, isNaN, NaN, undefined, Infinity,
        String, Array, Object, Math, RegExp, Boolean, Number,
        Error, TypeError, RangeError, SyntaxError,
        Date, JSON, decodeURIComponent, encodeURIComponent
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(setupCode, ctx, { timeout: 10000 });
    
    const dtype = vm.runInContext(`typeof ${decoderName}`, ctx);
    console.log(`[*] Decoder type after exec: ${dtype}`);
    
    if (dtype !== 'function') { console.error('[!] Decoder unavailable'); process.exit(1); }
    
    // 收集别名
    const aliases = [decoderName];
    const aliasRe = new RegExp(`\\b(\\w+)\\s*=\\s*${decoderName}\\b`, 'g');
    let am;
    while ((am = aliasRe.exec(code)) !== null) {
        if (!aliases.includes(am[1]) && am[1].length <= 3) aliases.push(am[1]);
    }
    console.log(`[*] Aliases: ${aliases.join(', ')}`);
    
    // 收集使用的索引
    const usedIndices = new Set();
    for (const alias of aliases) {
        const idxRe = new RegExp(`\\b${alias}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g');
        let im;
        while ((im = idxRe.exec(code)) !== null) usedIndices.add(parseInt(im[1]));
    }
    console.log(`[*] Unique indices: ${usedIndices.size}`);
    
    // 解码
    const decoded = new Map();
    for (const idx of usedIndices) {
        try {
            const r = vm.runInContext(`${decoderName}(${idx})`, ctx, { timeout: 200 });
            if (typeof r === 'string') decoded.set(idx, r);
        } catch (e) {}
    }
    console.log(`[*] Decoded: ${decoded.size}/${usedIndices.size}`);
    
    // 输出
    let cnt = 0;
    for (const [i, s] of [...decoded.entries()].sort((a,b) => a[0]-b[0])) {
        if (cnt++ < 100) console.log(`  [${i}] = "${s.length > 60 ? s.substring(0,60)+'...' : s}"`);
    }
    if (decoded.size > 100) console.log(`  ... and ${decoded.size - 100} more`);
    
    // 替换
    let result = code;
    let replaceCount = 0;
    for (const alias of aliases) {
        const callRe = new RegExp(`\\b${alias}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g');
        result = result.replace(callRe, (match, numStr) => {
            const num = parseInt(numStr);
            if (decoded.has(num)) {
                replaceCount++;
                const s = decoded.get(num);
                return `'${s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r')}'`;
            }
            return match;
        });
    }
    
    // 后处理
    let prev;
    do { prev = result.length; result = result.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*\+\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m,a,b) => `'${a}${b}'`); } while (result.length !== prev);
    result = result.replace(/\['(\w+)'\]/g, '.$1');
    
    console.log(`[*] Replaced ${replaceCount} string refs`);
    fs.writeFileSync(outputFile, result, 'utf-8');
    console.log(`[*] Output: ${outputFile}`);
    
    // 字符串表
    const mapObj = {};
    for (const [i,s] of decoded) mapObj[i] = s;
    fs.writeFileSync(outputFile.replace(/\.js$/,'_strings.json'), JSON.stringify(mapObj,null,2), 'utf-8');
    
} catch(e) {
    console.error(`[!] ${e.message}`);
    console.error(e.stack);
}
