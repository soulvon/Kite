/**
 * 反混淆 v5：暴力法 - 直接在沙盒中执行整个文件
 * 拦截所有 DOM/browser API，提取解码器函数后枚举字符串
 */
const fs = require('fs');
const vm = require('vm');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace(/\.js$/, '_decoded.js');
if (!inputFile) { console.error('Usage: node deob_v5.js <input.js> [output.js]'); process.exit(1); }

let code = fs.readFileSync(inputFile, 'utf-8');
console.log(`[*] File: ${inputFile}, size: ${(code.length / 1024).toFixed(1)} KB`);

// 找解码器函数名
const decoderMatch = code.match(/function\s+(\w+)\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[^}]*?=\s*\w+\s*-\s*[\(-]/);
if (!decoderMatch) { console.error('[!] Cannot find decoder'); process.exit(1); }
const decoderName = decoderMatch[1];
console.log(`[*] Decoder: ${decoderName}`);

// 创建全面的 DOM 模拟
const mockElement = {
    innerHTML: '', textContent: '', className: '', value: '', disabled: false,
    style: new Proxy({}, { get: () => '', set: () => true }),
    classList: { add: ()=>{}, remove: ()=>{}, contains: ()=>false, toggle: ()=>{} },
    dataset: new Proxy({}, { get: () => '', set: () => true }),
    getAttribute: () => null,
    setAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    appendChild: () => {},
    removeChild: () => {},
    remove: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100 }),
    focus: () => {},
    blur: () => {},
    click: () => {},
    dispatchEvent: () => {},
    parentElement: null,
    children: [],
    childNodes: [],
    firstChild: null,
    lastChild: null,
    nextSibling: null,
    previousSibling: null,
    tagName: 'DIV',
    id: '',
    nodeType: 1,
};

const mockDocument = {
    getElementById: () => ({...mockElement}),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({...mockElement}),
    createTextNode: () => ({...mockElement}),
    body: {...mockElement},
    head: {...mockElement},
    documentElement: {...mockElement},
    addEventListener: () => {},
    removeEventListener: () => {},
    createEvent: () => ({ initEvent: ()=>{} }),
};

const capturedCalls = [];
const sandbox = {
    console: { log:()=>{}, error:()=>{}, warn:()=>{}, info:()=>{}, debug:()=>{}, dir:()=>{} },
    parseInt, parseFloat, isNaN, isFinite, NaN, undefined, Infinity,
    String, Array, Object, Math, RegExp, Boolean, Number,
    Error, TypeError, RangeError, SyntaxError, URIError, EvalError,
    Date, JSON, Symbol, Map, Set, WeakMap, WeakSet, Proxy, Reflect, Promise,
    decodeURIComponent, encodeURIComponent, decodeURI, encodeURI,
    escape, unescape, btoa, atob,
    setTimeout: (fn) => { try { fn(); } catch(e) {} },
    setInterval: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    document: mockDocument,
    window: null, // will be set to sandbox itself
    navigator: { userAgent: '', platform: 'Win32' },
    location: { href: '', protocol: 'https:', hostname: '' },
    localStorage: { getItem: ()=>null, setItem: ()=>{}, removeItem: ()=>{}, length: 0, key: ()=>null },
    sessionStorage: { getItem: ()=>null, setItem: ()=>{}, removeItem: ()=>{} },
    XMLHttpRequest: function() { return { open:()=>{}, send:()=>{}, setRequestHeader:()=>{}, addEventListener:()=>{} }; },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    acquireVsCodeApi: () => ({ postMessage: (msg) => { capturedCalls.push(msg); }, getState: ()=>null, setState: ()=>{} }),
    Notification: { permission: 'denied', requestPermission: ()=>{} },
    MutationObserver: function() { return { observe:()=>{}, disconnect:()=>{} }; },
    ResizeObserver: function() { return { observe:()=>{}, disconnect:()=>{} }; },
    IntersectionObserver: function() { return { observe:()=>{}, disconnect:()=>{} }; },
    Event: function(type) { this.type = type; },
    CustomEvent: function(type) { this.type = type; },
    KeyboardEvent: function(type) { this.type = type; },
    MouseEvent: function(type) { this.type = type; },
    HTMLElement: function() {},
    Node: function() {},
    NodeList: function() {},
    requestAnimationFrame: (fn) => { try { fn(0); } catch(e) {} },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => new Proxy({}, { get: () => '' }),
    performance: { now: () => Date.now() },
    self: null,
    globalThis: null,
    queueMicrotask: (fn) => { try { fn(); } catch(e) {} },
    structuredClone: (v) => JSON.parse(JSON.stringify(v)),
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

try {
    const ctx = vm.createContext(sandbox);
    
    // 尝试执行 - 忽略 DOM 错误
    try {
        vm.runInContext(code, ctx, { timeout: 15000 });
    } catch (e) {
        console.log(`[*] Execution had error (expected for DOM code): ${e.message.substring(0, 100)}`);
    }
    
    // 检查解码器是否可用
    const dtype = vm.runInContext(`typeof ${decoderName}`, ctx);
    console.log(`[*] Decoder type: ${dtype}`);
    
    if (dtype !== 'function') {
        console.error('[!] Decoder not available after execution');
        process.exit(1);
    }
    
    // 收集别名
    const aliases = [decoderName];
    const aliasRe = new RegExp(`(\\w{1,3})\\s*=\\s*${decoderName}\\b`, 'g');
    let am;
    while ((am = aliasRe.exec(code)) !== null) {
        if (!aliases.includes(am[1])) aliases.push(am[1]);
    }
    console.log(`[*] Aliases: ${aliases.join(', ')}`);
    
    // 收集索引（十进制和十六进制）
    const usedIndices = new Set();
    for (const alias of aliases) {
        // 十进制
        let im;
        const decRe = new RegExp(`\\b${alias}\\s*\\(\\s*(\\d+)\\s*[,)]`, 'g');
        while ((im = decRe.exec(code)) !== null) usedIndices.add(parseInt(im[1]));
        // 十六进制
        const hexRe = new RegExp(`\\b${alias}\\s*\\(\\s*(0x[0-9a-fA-F]+)\\s*[,)]`, 'g');
        while ((im = hexRe.exec(code)) !== null) usedIndices.add(parseInt(im[1], 16));
    }
    console.log(`[*] Unique indices: ${usedIndices.size}`);
    
    // 解码所有字符串
    const decoded = new Map();
    for (const idx of usedIndices) {
        try {
            const r = vm.runInContext(`${decoderName}(${idx})`, ctx, { timeout: 200 });
            if (typeof r === 'string') decoded.set(idx, r);
        } catch (e) {}
    }
    console.log(`[*] Decoded: ${decoded.size}/${usedIndices.size}`);
    
    // 输出解码的字符串
    let cnt = 0;
    for (const [i, s] of [...decoded.entries()].sort((a,b) => a[0]-b[0])) {
        if (cnt++ < 150) console.log(`  [${i}/${i.toString(16)}] = "${s.length > 70 ? s.substring(0,70)+'...' : s}"`);
    }
    if (decoded.size > 150) console.log(`  ... and ${decoded.size - 150} more`);
    
    // 替换字符串调用
    let result = code;
    let replaceCount = 0;
    
    for (const alias of aliases) {
        // 替换 alias(0xHEX) 和 alias(DEC)
        const callRe = new RegExp(`\\b${alias}\\s*\\(\\s*(0x[0-9a-fA-F]+|\\d+)\\s*\\)`, 'g');
        result = result.replace(callRe, (match, numStr) => {
            const num = numStr.startsWith('0x') ? parseInt(numStr, 16) : parseInt(numStr);
            if (decoded.has(num)) {
                replaceCount++;
                const s = decoded.get(num);
                return `'${s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r')}'`;
            }
            return match;
        });
    }
    
    // 后处理：连续字符串拼接
    let prev;
    do { prev = result.length; result = result.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*\+\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m,a,b) => `'${a}${b}'`); } while (result.length !== prev);
    result = result.replace(/\['(\w+)'\]/g, '.$1');
    
    console.log(`[*] Replaced ${replaceCount} string refs`);
    fs.writeFileSync(outputFile, result, 'utf-8');
    console.log(`[*] Output: ${outputFile} (${(result.length/1024).toFixed(1)} KB)`);
    
    // 保存字符串映射表
    const mapObj = {};
    for (const [i,s] of decoded) mapObj[i] = s;
    fs.writeFileSync(outputFile.replace(/\.js$/,'_strings.json'), JSON.stringify(mapObj,null,2), 'utf-8');
    console.log(`[*] String map saved`);
    
    // 显示捕获的 VSCode 消息
    if (capturedCalls.length > 0) {
        console.log(`\n[*] Captured VSCode messages (${capturedCalls.length}):`);
        capturedCalls.forEach((m, i) => console.log(`  ${i}: ${JSON.stringify(m)}`));
    }
    
} catch(e) {
    console.error(`[!] ${e.message}`);
    console.error(e.stack);
}
