/**
 * 反混淆 v4：基于 }(T, 或 }(B, 模式定位旋转 IIFE 边界
 */
const fs = require('fs');
const vm = require('vm');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace(/\.js$/, '_decoded.js');
if (!inputFile) { console.error('Usage: node deob_v4.js <input.js> [output.js]'); process.exit(1); }

const code = fs.readFileSync(inputFile, 'utf-8');
console.log(`[*] File: ${inputFile}, size: ${(code.length / 1024).toFixed(1)} KB`);

// 找解码器
const decoderMatch = code.match(/function\s+(\w+)\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[^}]*?=\s*\w+\s*-\s*[\(-]/);
if (!decoderMatch) { console.error('[!] Cannot find decoder'); process.exit(1); }
const decoderName = decoderMatch[1];

// 找字符串数组函数
const arrayMatch = code.match(new RegExp(`function\\s+${decoderName}[\\s\\S]{0,500}?var\\s+\\w+\\s*=\\s*(\\w+)\\s*\\(\\s*\\)`));
const arrayFuncName = arrayMatch ? arrayMatch[1] : null;
console.log(`[*] Decoder: ${decoderName}, Array: ${arrayFuncName}`);

// 找旋转 IIFE 结束位置 - 模式: }(T, <hex_expr>)
const rotEndPattern = new RegExp(`\\}\\s*\\(\\s*${arrayFuncName}\\s*,`);
const rotEndMatch = code.match(rotEndPattern);
let rotEndPos = -1;
if (rotEndMatch) {
    const matchStart = code.indexOf(rotEndMatch[0]);
    // 从这里往后找到 ); 
    let depth = 0;
    for (let i = matchStart + 1; i < code.length; i++) {
        if (code[i] === '(') depth++;
        if (code[i] === ')') {
            if (depth === 0) {
                // 跳过分号
                rotEndPos = i + 1;
                while (rotEndPos < code.length && code[rotEndPos] === ';') rotEndPos++;
                break;
            }
            depth--;
        }
    }
}
console.log(`[*] Rotation IIFE ends at: ${rotEndPos}`);

if (rotEndPos < 0) { console.error('[!] Cannot find rotation end'); process.exit(1); }

// 找 T 函数定义
const tFuncRe = new RegExp(`function\\s+${arrayFuncName}\\s*\\(\\s*\\)\\s*\\{`);
const tFuncMatch = code.match(tFuncRe);
let tFuncCode = '';
if (tFuncMatch) {
    const tStart = code.indexOf(tFuncMatch[0]);
    // 找到函数体结束
    let depth = 0, foundFirst = false;
    let inStr = false, strCh = '', esc = false;
    let tEnd = tStart;
    for (let i = tStart; i < code.length; i++) {
        const c = code[i];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (inStr) { if (c === strCh) inStr = false; continue; }
        if (c === "'" || c === '"') { inStr = true; strCh = c; continue; }
        if (c === '{') { depth++; foundFirst = true; }
        if (c === '}') { depth--; if (foundFirst && depth === 0) { tEnd = i + 1; break; } }
    }
    tFuncCode = code.slice(tStart, tEnd);
    console.log(`[*] Array func ${arrayFuncName}: pos ${tStart}-${tEnd}, ${tFuncCode.length} chars`);
}

// 组装：T函数 + 文件开头到旋转IIFE结束
const setupPrefix = code.slice(0, rotEndPos);
const setupCode = tFuncCode + ';\n' + setupPrefix;
console.log(`[*] Setup code: ${setupCode.length} chars`);

// 执行
try {
    const sandbox = {
        console: { log:()=>{}, error:()=>{}, warn:()=>{} },
        parseInt, isNaN, NaN, undefined, Infinity,
        String, Array, Object, Math, RegExp, Boolean, Number,
        Error, TypeError, RangeError, SyntaxError,
        Date, JSON, decodeURIComponent, encodeURIComponent
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(setupCode, ctx, { timeout: 10000 });
    console.log(`[*] Setup executed OK`);
    
    const dtype = vm.runInContext(`typeof ${decoderName}`, ctx);
    console.log(`[*] Decoder type: ${dtype}`);
    if (dtype !== 'function') { console.error('[!] Decoder not available'); process.exit(1); }
    
    // 收集别名 - 只在主逻辑部分搜索
    const mainCode = code.slice(rotEndPos);
    const aliases = [decoderName];
    const aliasRe = new RegExp(`(\\w{1,2})\\s*=\\s*${decoderName}\\b`, 'g');
    let am;
    while ((am = aliasRe.exec(mainCode.slice(0, 3000))) !== null) {
        if (!aliases.includes(am[1])) aliases.push(am[1]);
    }
    console.log(`[*] Aliases: ${aliases.join(', ')}`);
    
    // 收集使用的索引 - 注意混淆后索引可能是十六进制 0x1ac
    const usedIndices = new Set();
    for (const alias of aliases) {
        // 十进制
        const decRe = new RegExp(`\\b${alias}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g');
        let im;
        while ((im = decRe.exec(code)) !== null) usedIndices.add(parseInt(im[1]));
        // 十六进制
        const hexRe = new RegExp(`\\b${alias}\\s*\\(\\s*(0x[0-9a-fA-F]+)\\s*\\)`, 'g');
        while ((im = hexRe.exec(code)) !== null) usedIndices.add(parseInt(im[1], 16));
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
    
    // 输出字符串表
    let cnt = 0;
    for (const [i, s] of [...decoded.entries()].sort((a,b) => a[0]-b[0])) {
        if (cnt++ < 120) console.log(`  [${i}] = "${s.length > 70 ? s.substring(0,70)+'...' : s}"`);
    }
    if (decoded.size > 120) console.log(`  ... and ${decoded.size - 120} more`);
    
    // 替换代码中的字符串调用
    let result = code;
    let replaceCount = 0;
    for (const alias of aliases) {
        // 替换十六进制调用
        const hexCallRe = new RegExp(`\\b${alias}\\s*\\(\\s*(0x[0-9a-fA-F]+)\\s*\\)`, 'g');
        result = result.replace(hexCallRe, (match, hexStr) => {
            const num = parseInt(hexStr, 16);
            if (decoded.has(num)) {
                replaceCount++;
                const s = decoded.get(num);
                return `'${s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r')}'`;
            }
            return match;
        });
        // 替换十进制调用
        const decCallRe = new RegExp(`\\b${alias}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g');
        result = result.replace(decCallRe, (match, numStr) => {
            const num = parseInt(numStr);
            if (decoded.has(num)) {
                replaceCount++;
                const s = decoded.get(num);
                return `'${s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r')}'`;
            }
            return match;
        });
    }
    
    // 后处理：合并字符串连接
    let prev;
    do { prev = result.length; result = result.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*\+\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m,a,b) => `'${a}${b}'`); } while (result.length !== prev);
    // ['prop'] => .prop
    result = result.replace(/\['(\w+)'\]/g, '.$1');
    
    console.log(`[*] Replaced ${replaceCount} string refs`);
    fs.writeFileSync(outputFile, result, 'utf-8');
    console.log(`[*] Output: ${outputFile} (${(result.length/1024).toFixed(1)} KB)`);
    
    const mapObj = {};
    for (const [i,s] of decoded) mapObj[i] = s;
    fs.writeFileSync(outputFile.replace(/\.js$/,'_strings.json'), JSON.stringify(mapObj,null,2), 'utf-8');
    console.log(`[*] String map saved`);
    
} catch(e) {
    console.error(`[!] ${e.message}`);
    // 保存 setup 用于调试
    fs.writeFileSync(outputFile.replace(/\.js$/,'_setup_debug.js'), setupCode, 'utf-8');
}
