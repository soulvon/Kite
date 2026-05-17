/**
 * 反混淆 v6：AST + VM 联合方法
 * 先用 VM 解码字符串，再用正则解析常量对象，最终替换间接引用
 */
const fs = require('fs');
const vm = require('vm');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace(/\.js$/, '_deep.js');
if (!inputFile) { console.error('Usage: node deob_v6_ast.js <input.js> [output.js]'); process.exit(1); }

let code = fs.readFileSync(inputFile, 'utf-8');
console.log(`[*] File: ${inputFile}, size: ${(code.length / 1024).toFixed(1)} KB`);

// Step 1: 在 VM 中执行获取解码器
const decoderMatch = code.match(/function\s+(\w+)\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[^}]*?=\s*\w+\s*-\s*[\(-]/);
if (!decoderMatch) { console.error('[!] Cannot find decoder'); process.exit(1); }
const decoderName = decoderMatch[1];

const mockElement = {
    innerHTML:'', textContent:'', className:'', value:'', disabled:false,
    style: new Proxy({},{get:()=>'',set:()=>true}),
    classList:{add:()=>{},remove:()=>{},contains:()=>false},
    dataset: new Proxy({},{get:()=>'',set:()=>true}),
    getAttribute:()=>null, setAttribute:()=>{}, addEventListener:()=>{},
    querySelector:()=>null, querySelectorAll:()=>[],
    appendChild:()=>{}, remove:()=>{}, focus:()=>{}, click:()=>{},
    parentElement:null, children:[], childNodes:[], tagName:'DIV', id:'', nodeType:1,
};
const sandbox = {
    console:{log:()=>{},error:()=>{},warn:()=>{},info:()=>{},debug:()=>{}},
    parseInt,parseFloat,isNaN,isFinite,NaN,undefined,Infinity,
    String,Array,Object,Math,RegExp,Boolean,Number,
    Error,TypeError,RangeError,SyntaxError,URIError,EvalError,
    Date,JSON,Symbol,Map,Set,WeakMap,WeakSet,Proxy,Reflect,Promise,
    decodeURIComponent,encodeURIComponent,decodeURI,encodeURI,
    escape,unescape,btoa,atob,
    setTimeout:(fn)=>{try{fn();}catch(e){}},setInterval:()=>0,
    clearTimeout:()=>{},clearInterval:()=>{},
    document:{getElementById:()=>({...mockElement}),querySelector:()=>null,querySelectorAll:()=>[],
      createElement:()=>({...mockElement}),body:{...mockElement},head:{...mockElement},
      addEventListener:()=>{},documentElement:{...mockElement}},
    window:null,navigator:{userAgent:'',platform:'Win32'},
    location:{href:'',protocol:'https:',hostname:''},
    localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
    sessionStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
    acquireVsCodeApi:()=>({postMessage:()=>{},getState:()=>null,setState:()=>{}}),
    MutationObserver:function(){return{observe:()=>{},disconnect:()=>{}};},
    ResizeObserver:function(){return{observe:()=>{},disconnect:()=>{}};},
    Event:function(t){this.type=t;},CustomEvent:function(t){this.type=t;},
    requestAnimationFrame:()=>{},cancelAnimationFrame:()=>{},
    getComputedStyle:()=>new Proxy({},{get:()=>''}),
    performance:{now:()=>Date.now()},self:null,globalThis:null,
    queueMicrotask:(fn)=>{try{fn();}catch(e){}},
    XMLHttpRequest:function(){return{open:()=>{},send:()=>{},setRequestHeader:()=>{},addEventListener:()=>{}};},
    fetch:()=>Promise.resolve({json:()=>Promise.resolve({}),text:()=>Promise.resolve('')}),
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
try { vm.runInContext(code, ctx, { timeout: 15000 }); } catch(e) {
    console.log(`[*] Execution error (expected): ${e.message.substring(0,100)}`);
}

const dtype = vm.runInContext(`typeof ${decoderName}`, ctx);
if (dtype !== 'function') { console.error('[!] Decoder unavailable'); process.exit(1); }

// Step 2: 枚举解码所有可能的索引值
// 收集代码中出现的所有十六进制数字
const allHexNums = new Set();
const hexRe = /0x[0-9a-fA-F]+/g;
let hm;
while ((hm = hexRe.exec(code)) !== null) allHexNums.add(parseInt(hm[0], 16));
console.log(`[*] Unique hex values in code: ${allHexNums.size}`);

// 尝试解码每个值
const decoded = new Map();
for (const idx of allHexNums) {
    try {
        const r = vm.runInContext(`${decoderName}(${idx})`, ctx, { timeout: 100 });
        if (typeof r === 'string' && r.length > 0) decoded.set(idx, r);
    } catch(e) {}
}
console.log(`[*] Decoded strings: ${decoded.size}`);

// Step 3: 解析常量对象 - 例如 var hO = { R: 0x104, I: 0x5ef, ... }
const constObjRe = /\b(\w{2,4})\s*=\s*\{\s*((?:\w+\s*:\s*0x[0-9a-fA-F]+\s*,?\s*)+)\}/g;
const constObjects = new Map();
let cm;
while ((cm = constObjRe.exec(code)) !== null) {
    const name = cm[1];
    const body = cm[2];
    const props = {};
    const propRe = /(\w+)\s*:\s*(0x[0-9a-fA-F]+)/g;
    let pm;
    while ((pm = propRe.exec(body)) !== null) {
        props[pm[1]] = parseInt(pm[2], 16);
    }
    if (Object.keys(props).length > 0) constObjects.set(name, props);
}
console.log(`[*] Constant objects found: ${constObjects.size}`);

// Step 4: 收集所有别名
const aliases = [decoderName];
const aliasRe = new RegExp(`(\\w{1,4})\\s*=\\s*${decoderName}\\b`, 'g');
while ((am = aliasRe.exec(code)) !== null) {
    if (!aliases.includes(am[1])) aliases.push(am[1]);
}

// Step 5: 替换所有调用模式
let result = code;
let replaceCount = 0;

function escapeStr(s) {
    return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t');
}

// Pattern 1: alias(0xHEX) or alias(DEC)
for (const alias of aliases) {
    const re = new RegExp(`\\b${alias}\\s*\\(\\s*(0x[0-9a-fA-F]+|\\d+)\\s*\\)`, 'g');
    result = result.replace(re, (match, numStr) => {
        const num = numStr.startsWith('0x') ? parseInt(numStr, 16) : parseInt(numStr);
        if (decoded.has(num)) { replaceCount++; return `'${escapeStr(decoded.get(num))}'`; }
        return match;
    });
}

// Pattern 2: alias(OBJ.PROP) - 常量对象间接引用
for (const alias of aliases) {
    const re = new RegExp(`\\b${alias}\\s*\\(\\s*(\\w{2,4})\\.(\\w+)\\s*\\)`, 'g');
    result = result.replace(re, (match, objName, propName) => {
        const obj = constObjects.get(objName);
        if (obj && obj[propName] !== undefined) {
            const idx = obj[propName];
            if (decoded.has(idx)) { replaceCount++; return `'${escapeStr(decoded.get(idx))}'`; }
        }
        return match;
    });
}

// 后处理
let prev;
do { prev = result.length; result = result.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*\+\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m,a,b) => `'${a}${b}'`); } while (result.length !== prev);
result = result.replace(/\['(\w+)'\]/g, '.$1');

console.log(`[*] Total replacements: ${replaceCount}`);
fs.writeFileSync(outputFile, result, 'utf-8');
console.log(`[*] Output: ${outputFile} (${(result.length/1024).toFixed(1)} KB)`);

// 保存字符串表
const mapObj = {};
for (const [i,s] of [...decoded.entries()].sort((a,b)=>a[0]-b[0])) mapObj[i] = s;
fs.writeFileSync(outputFile.replace(/\.js$/,'_strings.json'), JSON.stringify(mapObj,null,2), 'utf-8');

// 输出有意义的字符串 (过滤掉太短的和纯数字的)
console.log(`\n[*] Key decoded strings:`);
let scnt = 0;
for (const [i,s] of [...decoded.entries()].sort((a,b)=>a[0]-b[0])) {
    if (s.length >= 3 && !/^\d+\w{3,}$/i.test(s) && scnt < 200) {
        console.log(`  [0x${i.toString(16)}] = "${s.length > 80 ? s.substring(0,80)+'...' : s}"`);
        scnt++;
    }
}
