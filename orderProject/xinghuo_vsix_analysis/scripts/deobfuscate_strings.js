/**
 * 自定义反混淆脚本：提取 javascript-obfuscator 的字符串表
 * 策略：在安全沙盒中执行字符串数组+旋转+解码函数，然后枚举所有可能的索引
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace(/\.js$/, '_decoded.js');

if (!inputFile) {
    console.error('Usage: node deobfuscate_strings.js <input.js> [output.js]');
    process.exit(1);
}

console.log(`[*] Reading ${inputFile}...`);
let code = fs.readFileSync(inputFile, 'utf-8');
console.log(`[*] File size: ${(code.length / 1024).toFixed(1)} KB`);

// Step 1: 提取字符串数组函数 (通常是第一个函数，返回一个大数组)
// 匹配 function X(){...return [...]} 模式
const arrayFuncMatch = code.match(/function\s+(\w+)\s*\(\s*\)\s*\{[^}]*?\bvar\s+\w+\s*=\s*\[([^\]]{100,})\]/s);
let arrayFuncName = null;
let stringArray = [];

if (arrayFuncMatch) {
    arrayFuncName = arrayFuncMatch[1];
    console.log(`[*] Found string array function: ${arrayFuncName}`);
}

// Step 2: 提取 IIFE rotation 和解码器
// 找到字符串数组的完整定义（从 function T() 开始）
// 以及旋转函数和解码函数

// 更通用的方法：找到所有顶层函数定义
const funcNames = new Set();
const funcRegex = /\bfunction\s+(\w+)\s*\(/g;
let m;
while ((m = funcRegex.exec(code.slice(0, 5000))) !== null) {
    funcNames.add(m[1]);
}
console.log(`[*] Top-level function names (first 5KB): ${[...funcNames].join(', ')}`);

// Step 3: 尝试提取并运行字符串解码器
// 策略：截取文件开头到第一个主逻辑开始的部分（通常是解码器设置）
// 在 instanceManager.js 中，结构是：
//   function z(R,I){...} (解码器)
//   (function(R,I){...}(T, number)); (旋转)  
//   (function(){...}()); (主逻辑)

// 找到解码器函数
const decoderMatch = code.match(/function\s+(\w+)\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{\s*\w+\s*=\s*\w+\s*-\s*(\d+)/);
let decoderName = null;
let decoderOffset = 0;

if (decoderMatch) {
    decoderName = decoderMatch[1];
    decoderOffset = parseInt(decoderMatch[2]);
    console.log(`[*] Found decoder function: ${decoderName}, offset: ${decoderOffset}`);
}

// 找到字符串数组函数名（解码器引用的）
const arrayRefMatch = code.match(new RegExp(`function\\s+${decoderName}[^{]*\\{[^}]*?var\\s+\\w+\\s*=\\s*(\\w+)\\(\\)`));
if (arrayRefMatch) {
    arrayFuncName = arrayRefMatch[1];
    console.log(`[*] String array function name: ${arrayFuncName}`);
}

// Step 4: 提取需要执行的代码块
// 找到字符串数组函数的完整定义
const arrayFuncDefRegex = new RegExp(`function\\s+${arrayFuncName}\\s*\\(\\)\\s*\\{`);
const arrayFuncStart = code.search(arrayFuncDefRegex);

// 找到解码器函数的完整定义
const decoderFuncDefRegex = new RegExp(`function\\s+${decoderName}\\s*\\(`);
const decoderFuncStart = code.search(decoderFuncDefRegex);

// 找到旋转 IIFE - 通常在解码器之后
// 匹配 (function(R,I){...while(true)...}(T, number))
const rotationIIFERegex = /\(function\s*\(\w+\s*,\s*\w+\)\s*\{[^}]*while\s*\(\s*!!\[\]\s*\)\s*\{[\s\S]*?\}\s*\}\s*\(\s*\w+\s*,\s*\d+\s*\)\s*\)\s*;/;
const rotationMatch = code.match(rotationIIFERegex);

if (!rotationMatch) {
    console.log('[!] Could not find rotation IIFE, trying alternative pattern...');
}

// 提取从文件开头到主逻辑开始之前的所有初始化代码
// 主逻辑通常以 (function(){...}()); 开始，在旋转IIFE之后
let setupEndIdx;
// 找到第三个顶层括号开始（第一个是字符串数组或解码器IIFE，第二个是旋转IIFE，第三个是主逻辑）
const topLevelParens = [];
let depth = 0;
let inString = false;
let stringChar = '';
for (let i = 0; i < Math.min(code.length, 50000); i++) {
    const c = code[i];
    if (inString) {
        if (c === stringChar && code[i-1] !== '\\') inString = false;
        continue;
    }
    if (c === '"' || c === "'" || c === '`') {
        inString = true;
        stringChar = c;
        continue;
    }
    if (c === '(' && depth === 0) {
        topLevelParens.push(i);
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
}

console.log(`[*] Found ${topLevelParens.length} top-level parentheses in first 50KB`);

// 找到旋转IIFE结束的位置
let setupCode = '';
if (rotationMatch) {
    const rotEnd = code.indexOf(rotationMatch[0]) + rotationMatch[0].length;
    setupCode = code.slice(0, rotEnd);
    setupEndIdx = rotEnd;
} else {
    // Fallback: 取前面两个IIFE
    setupEndIdx = Math.min(code.length, 10000);
    setupCode = code.slice(0, setupEndIdx);
}

console.log(`[*] Setup code length: ${setupCode.length} chars`);

// Step 5: 在 VM 中执行解码器，枚举所有字符串
try {
    const sandbox = { console: { log: () => {}, error: () => {} }, parseInt, isNaN, NaN, undefined, String, Array, Object, Math, RegExp, Boolean, Number, Error, TypeError, RangeError, Date, JSON, decodeURIComponent, encodeURIComponent, escape, unescape };
    const context = vm.createContext(sandbox);
    
    // 执行初始化代码
    vm.runInContext(setupCode, context, { timeout: 5000 });
    console.log(`[*] Setup code executed successfully`);
    
    // 检查解码器是否可用
    const testResult = vm.runInContext(`typeof ${decoderName}`, context);
    console.log(`[*] Decoder type: ${testResult}`);
    
    if (testResult === 'function') {
        // 枚举所有可能的索引
        const decodedStrings = new Map();
        const minIdx = decoderOffset;
        const maxIdx = decoderOffset + 1000; // 尝试足够大的范围
        
        let successCount = 0;
        for (let i = minIdx; i < maxIdx; i++) {
            try {
                const result = vm.runInContext(`${decoderName}(${i})`, context, { timeout: 100 });
                if (result !== undefined && result !== null && typeof result === 'string') {
                    decodedStrings.set(i, result);
                    successCount++;
                }
            } catch (e) {
                // 索引超出范围
            }
        }
        
        console.log(`[*] Decoded ${successCount} strings (index range: ${minIdx}-${maxIdx})`);
        
        // 输出前 50 个解码的字符串
        let count = 0;
        for (const [idx, str] of decodedStrings) {
            if (count++ < 50) {
                console.log(`  ${decoderName}(${idx}) = "${str.substring(0, 80)}"`);
            }
        }
        if (decodedStrings.size > 50) {
            console.log(`  ... and ${decodedStrings.size - 50} more`);
        }
        
        // Step 6: 替换代码中的字符串调用
        // 找到主逻辑代码
        let mainCode = code.slice(setupEndIdx);
        
        // 找到所有通过别名调用解码器的函数
        // 通常在主逻辑IIFE开头有 var o = z, H = z 这样的别名
        const aliasRegex = new RegExp(`var\\s+(\\w+)\\s*=\\s*${decoderName}\\b`, 'g');
        const aliases = [decoderName];
        let aliasMatch;
        while ((aliasMatch = aliasRegex.exec(mainCode.slice(0, 2000))) !== null) {
            aliases.push(aliasMatch[1]);
        }
        console.log(`[*] Decoder aliases: ${aliases.join(', ')}`);
        
        // 替换所有 decoderName(number) 和别名调用
        let replacedCode = code;
        let replaceCount = 0;
        
        for (const alias of aliases) {
            const callRegex = new RegExp(`\\b${alias}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g');
            replacedCode = replacedCode.replace(callRegex, (match, numStr) => {
                const num = parseInt(numStr);
                if (decodedStrings.has(num)) {
                    replaceCount++;
                    const str = decodedStrings.get(num);
                    // 转义特殊字符
                    const escaped = str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                    return `'${escaped}'`;
                }
                return match;
            });
        }
        
        console.log(`[*] Replaced ${replaceCount} string references`);
        
        // 写入输出文件
        fs.writeFileSync(outputFile, replacedCode, 'utf-8');
        console.log(`[*] Output written to: ${outputFile}`);
        console.log(`[*] Output size: ${(replacedCode.length / 1024).toFixed(1)} KB`);
        
        // 也输出字符串映射表
        const mapFile = outputFile.replace(/\.js$/, '_strings.json');
        const mapObj = {};
        for (const [idx, str] of decodedStrings) {
            mapObj[idx] = str;
        }
        fs.writeFileSync(mapFile, JSON.stringify(mapObj, null, 2), 'utf-8');
        console.log(`[*] String map written to: ${mapFile}`);
    }
} catch (e) {
    console.error(`[!] VM execution error: ${e.message}`);
    console.error(e.stack);
}
