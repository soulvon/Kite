/**
 * 反混淆 v2：利用括号平衡精确提取初始化代码块
 */
const fs = require('fs');
const vm = require('vm');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace(/\.js$/, '_decoded.js');

if (!inputFile) { console.error('Usage: node deob_v2.js <input.js> [output.js]'); process.exit(1); }

const code = fs.readFileSync(inputFile, 'utf-8');
console.log(`[*] File: ${inputFile}, size: ${(code.length / 1024).toFixed(1)} KB`);

// Step 1: 找到解码器函数名和字符串数组函数名
const decoderMatch = code.match(/^function\s+(\w+)\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{\s*\w+\s*=\s*\w+\s*-\s*\(/m);
if (!decoderMatch) { console.error('[!] Cannot find decoder function'); process.exit(1); }
const decoderName = decoderMatch[1];
console.log(`[*] Decoder function: ${decoderName}`);

// 找字符串数组函数名
const arrayRefMatch = code.match(new RegExp(`function\\s+${decoderName}[^{]*\\{[\\s\\S]*?var\\s+\\w+\\s*=\\s*(\\w+)\\(\\)`));
const arrayFuncName = arrayRefMatch ? arrayRefMatch[1] : null;
console.log(`[*] String array function: ${arrayFuncName}`);

// Step 2: 用括号平衡法精确提取代码块
function extractBalanced(src, startIdx) {
    let depth = 0;
    let started = false;
    let inStr = false;
    let strCh = '';
    let escaped = false;
    for (let i = startIdx; i < src.length; i++) {
        const c = src[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\' && inStr) { escaped = true; continue; }
        if (inStr) { if (c === strCh) inStr = false; continue; }
        if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
        if (c === '{' || c === '(') { depth++; started = true; }
        if (c === '}' || c === ')') { depth--; }
        if (started && depth === 0) return i + 1;
    }
    return src.length;
}

// 提取解码器函数 z(R,I){...}
const decoderStart = code.indexOf(decoderMatch[0]);
const decoderEnd = extractBalanced(code, decoderStart);
const decoderCode = code.slice(decoderStart, decoderEnd);
console.log(`[*] Decoder function: ${decoderStart}-${decoderEnd} (${decoderEnd - decoderStart} chars)`);

// 提取字符串数组函数
let arrayCode = '';
if (arrayFuncName) {
    const arrayRe = new RegExp(`function\\s+${arrayFuncName}\\s*\\(`);
    const arrayMatch = code.match(arrayRe);
    if (arrayMatch) {
        const arrayStart = code.indexOf(arrayMatch[0]);
        const arrayEnd = extractBalanced(code, arrayStart);
        arrayCode = code.slice(arrayStart, arrayEnd);
        console.log(`[*] Array function: ${arrayStart}-${arrayEnd} (${arrayEnd - arrayStart} chars)`);
    }
}

// 提取旋转 IIFE (function(X,Y){...while...}(T, number));
// 搜索 decoderEnd 之后的第一个 IIFE
let rotationCode = '';
const afterDecoder = code.slice(decoderEnd);
const rotStart = afterDecoder.search(/\(function\s*\(/);
if (rotStart >= 0) {
    const absRotStart = decoderEnd + rotStart;
    const rotEnd = extractBalanced(code, absRotStart);
    // 包含末尾的分号
    let endIdx = rotEnd;
    while (endIdx < code.length && (code[endIdx] === ';' || code[endIdx] === '\n' || code[endIdx] === '\r')) endIdx++;
    rotationCode = code.slice(absRotStart, endIdx);
    console.log(`[*] Rotation IIFE: ${absRotStart}-${endIdx} (${endIdx - absRotStart} chars)`);
}

// Step 3: 在 VM 中执行
const setupCode = arrayCode + '\n' + decoderCode + '\n' + rotationCode;
console.log(`[*] Total setup code: ${setupCode.length} chars`);

try {
    const sandbox = {
        console: { log: () => {}, error: () => {}, warn: () => {} },
        parseInt, isNaN, NaN, undefined, Infinity,
        String, Array, Object, Math, RegExp, Boolean, Number,
        Error, TypeError, RangeError, SyntaxError, URIError,
        Date, JSON, 
        decodeURIComponent, encodeURIComponent,
        escape, unescape,
        setTimeout: () => {}, setInterval: () => {}, clearTimeout: () => {}, clearInterval: () => {},
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(setupCode, context, { timeout: 10000 });
    
    const decoderType = vm.runInContext(`typeof ${decoderName}`, context);
    console.log(`[*] Decoder available: ${decoderType}`);
    
    if (decoderType !== 'function') {
        console.error('[!] Decoder not a function after execution');
        process.exit(1);
    }
    
    // Step 4: 枚举所有可能的字符串
    const decodedStrings = new Map();
    // 先找到代码中实际使用的索引
    const usedIndices = new Set();
    const aliases = [decoderName];
    
    // 找别名
    const aliasRegex = new RegExp(`\\b(\\w+)\\s*=\\s*${decoderName}\\b`, 'g');
    let am;
    while ((am = aliasRegex.exec(code)) !== null) {
        if (!aliases.includes(am[1])) aliases.push(am[1]);
    }
    console.log(`[*] Aliases: ${aliases.join(', ')}`);
    
    // 收集所有使用的索引
    for (const alias of aliases) {
        const idxRegex = new RegExp(`\\b${alias}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g');
        let im;
        while ((im = idxRegex.exec(code)) !== null) {
            usedIndices.add(parseInt(im[1]));
        }
    }
    console.log(`[*] Found ${usedIndices.size} unique indices used in code`);
    
    // 解码所有使用的索引
    let decodeSuccess = 0;
    let decodeFail = 0;
    for (const idx of usedIndices) {
        try {
            const result = vm.runInContext(`${decoderName}(${idx})`, context, { timeout: 200 });
            if (typeof result === 'string') {
                decodedStrings.set(idx, result);
                decodeSuccess++;
            }
        } catch (e) {
            decodeFail++;
        }
    }
    console.log(`[*] Decoded: ${decodeSuccess} success, ${decodeFail} fail`);
    
    // 输出前 80 个
    let cnt = 0;
    for (const [idx, str] of [...decodedStrings.entries()].sort((a,b) => a[0]-b[0])) {
        if (cnt++ < 80) {
            const display = str.length > 60 ? str.substring(0, 60) + '...' : str;
            console.log(`  [${idx}] = "${display}"`);
        }
    }
    if (decodedStrings.size > 80) console.log(`  ... and ${decodedStrings.size - 80} more`);
    
    // Step 5: 替换代码中所有字符串调用
    let result = code;
    let replaceCount = 0;
    
    for (const alias of aliases) {
        const callRegex = new RegExp(`\\b${alias}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g');
        result = result.replace(callRegex, (match, numStr) => {
            const num = parseInt(numStr);
            if (decodedStrings.has(num)) {
                replaceCount++;
                const s = decodedStrings.get(num);
                const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
                return `'${escaped}'`;
            }
            return match;
        });
    }
    
    console.log(`[*] Replaced ${replaceCount} string references`);
    
    // Step 6: 简单的后处理 - 合并字符串连接
    // 'abc' + 'def' => 'abcdef'
    let prevLen;
    do {
        prevLen = result.length;
        result = result.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*\+\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m, a, b) => `'${a}${b}'`);
    } while (result.length !== prevLen);
    
    // 清理 ['propName'] => .propName
    result = result.replace(/\[['"](\w+)['"]\]/g, '.$1');
    
    fs.writeFileSync(outputFile, result, 'utf-8');
    console.log(`[*] Output: ${outputFile} (${(result.length / 1024).toFixed(1)} KB)`);
    
    // 字符串映射表
    const mapFile = outputFile.replace(/\.js$/, '_strings.json');
    const mapObj = {};
    for (const [idx, str] of decodedStrings) mapObj[idx] = str;
    fs.writeFileSync(mapFile, JSON.stringify(mapObj, null, 2), 'utf-8');
    console.log(`[*] String map: ${mapFile}`);
    
} catch (e) {
    console.error(`[!] Error: ${e.message}`);
    console.error(e.stack);
    // 保存 setup code 供调试
    fs.writeFileSync(outputFile.replace(/\.js$/, '_setup_debug.js'), setupCode, 'utf-8');
    console.log(`[*] Debug: saved setup code`);
}
