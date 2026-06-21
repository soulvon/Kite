import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { readEnhSettings } from './enhSettingsStore';
import { writeFileWithElevation, copyFileWithElevation } from './elevatedFs';
import { getEnhancementScriptName } from './ideDetector';

const MARKER_PREFIX = '<!-- ws-better-v';
const MARKER_SUFFIX = ' -->';
const BLOCK_START = '<!-- ws-better-start -->';
const BLOCK_END = '<!-- ws-better-end -->';

// 设置嵌入标记：用于强制重新注入（即便版本相同）以更新嵌入的设置
const SETTINGS_MARKER_PREFIX = '<!-- ws-better-settings-hash:';
const SETTINGS_MARKER_SUFFIX = ' -->';

export interface EnhancementResult {
  injected: boolean;
  needRestart: boolean;
  error?: string;
}

/**
 * 确保 windsurf-better.js 已注入到 workbench.html
 * 版本不匹配或共享设置变化时自动更新
 */
export function ensureEnhancement(): EnhancementResult {
  // 默认值与 package.json 中 windsurfPool.enhancement.enabled 的 default=false 保持一致，
  // 避免读到的值与用户在设置 UI 中看到的不一致造成误导。
  const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', false);
  if (!enabled) {
    return { injected: false, needRestart: false };
  }

  const workbenchPath = getWorkbenchHtmlPath();
  if (!workbenchPath) {
    return { injected: false, needRestart: false, error: '未找到 workbench.html' };
  }

  const html = fs.readFileSync(workbenchPath, 'utf8');
  const patchVersion = getPatchVersion();
  const settings = readEnhSettings();
  const settingsHash = hashSettings(settings);

  // 同时匹配版本和设置哈希才视为已最新；任一不同都重新注入
  const versionMatch = html.includes(`${MARKER_PREFIX}${patchVersion}${MARKER_SUFFIX}`);
  const settingsMatch = html.includes(`${SETTINGS_MARKER_PREFIX}${settingsHash}${SETTINGS_MARKER_SUFFIX}`);
  if (versionMatch && settingsMatch) {
    return { injected: true, needRestart: false };
  }

  // 需要注入或更新
  const scriptContent = getScriptContent();
  if (!scriptContent) {
    return { injected: false, needRestart: false, error: '未找到 windsurf-better.js' };
  }

  // 备份（仅首次）
  const originPath = workbenchPath + '.origin';
  if (!fs.existsSync(originPath)) {
    copyFileWithElevation(workbenchPath, originPath);
  }

  let newHtml = html;

  // 清理旧注入
  const blockStartIdx = newHtml.indexOf(BLOCK_START);
  const blockEndIdx = newHtml.indexOf(BLOCK_END);
  if (blockStartIdx >= 0 && blockEndIdx >= 0) {
    newHtml = newHtml.substring(0, blockStartIdx) +
              newHtml.substring(blockEndIdx + BLOCK_END.length);
  }

  // CSP: 添加 'unsafe-inline' + 允许 localhost connect（用于 bridge HTTP server）
  newHtml = ensureCSP(newHtml);
  newHtml = ensureConnectSrc(newHtml);

  // Trusted Types: 添加 abBubbles
  newHtml = ensureTrustedTypes(newHtml);

  // 注入脚本：先嵌入共享设置为全局变量，再加载主脚本
  const settingsJSON = JSON.stringify(settings).replace(/</g, '\\u003c');
  const settingsBootstrap = `<script>window.__WS_BETTER_INJECTED_SETTINGS__=${settingsJSON};</script>\n`;
  const injection =
    `\n${BLOCK_START}\n` +
    `${MARKER_PREFIX}${patchVersion}${MARKER_SUFFIX}\n` +
    `${SETTINGS_MARKER_PREFIX}${settingsHash}${SETTINGS_MARKER_SUFFIX}\n` +
    settingsBootstrap +
    `<script>\n${scriptContent}\n</script>\n` +
    `${BLOCK_END}\n`;

  newHtml = newHtml.replace('</body>', injection + '</body>');
  writeFileWithElevation(workbenchPath, newHtml, 'utf8');

  return { injected: true, needRestart: true };
}

/**
 * 恢复原始 workbench.html
 */
export function restoreWorkbench(): boolean {
  const workbenchPath = getWorkbenchHtmlPath();
  if (!workbenchPath) return false;
  const originPath = workbenchPath + '.origin';
  if (!fs.existsSync(originPath)) return false;
  copyFileWithElevation(originPath, workbenchPath);
  return true;
}

/**
 * 检查当前注入状态
 */
export function getInjectionStatus(): { injected: boolean; patchVersion: string | null } {
  const workbenchPath = getWorkbenchHtmlPath();
  if (!workbenchPath) return { injected: false, patchVersion: null };

  const html = fs.readFileSync(workbenchPath, 'utf8');
  const match = html.match(/<!-- ws-better-v([\d.]+-[a-f0-9]+) -->/);
  if (match) {
    return { injected: true, patchVersion: match[1] };
  }
  return { injected: false, patchVersion: null };
}

function getWorkbenchHtmlPath(): string | null {
  const appRoot = vscode.env.appRoot;
  // Windsurf 的 workbench.html 路径
  const p = path.join(appRoot, 'out', 'vs', 'code',
    'electron-browser', 'workbench', 'workbench.html');
  if (fs.existsSync(p)) return p;

  // 备选路径（某些版本结构不同）
  const p2 = path.join(appRoot, 'out', 'vs', 'code',
    'browser', 'workbench', 'workbench.html');
  if (fs.existsSync(p2)) return p2;

  return null;
}

// 缓存 windsurf-better.js / devin-better.js 内容（启动后不变）
let _scriptCache: string | null = null;
function getScriptContent(): string | null {
  if (_scriptCache !== null) return _scriptCache;
  const ext = vscode.extensions.getExtension('local.kite') || vscode.extensions.getExtension('local.windsurf-pool');
  if (!ext) return null;
  const scriptName = getEnhancementScriptName();
  const scriptPath = path.join(ext.extensionPath, 'resources', scriptName);
  if (!fs.existsSync(scriptPath)) return null;
  _scriptCache = fs.readFileSync(scriptPath, 'utf8');
  return _scriptCache;
}

/**
 * 计算脚本"版本"，用于决定是否需要重新注入到 workbench.html
 *
 * 历史教训：之前只读脚本里的 `const VERSION = '1.1.0'` 常量做匹配，但每次改脚本
 * 都要手动递增 VERSION，遗漏过多次 → 用户装新 vsix 后旧 windsurf-better.js
 * 仍嵌在 workbench.html，新代码完全没生效。
 *
 * 现改为：以脚本内容的 SHA256 前 12 位作为版本标识。
 * 内容变了 hash 必然变 → 自动触发重注入，无需人为维护版本号。
 * 拼上文件中的 VERSION 字符串便于人眼阅读 marker。
 */
function getPatchVersion(): string {
  const content = getScriptContent();
  if (!content) return '0.0.0';
  // 用 SHA256 + 12 位 hex（48 bit）替代 SHA1 + 10 位（40 bit），SHA1 已退役
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  const m = content.match(/const VERSION = '([\d.]+)'/);
  const ver = m ? m[1] : '0.0.0';
  return `${ver}-${hash}`;
}

/**
 * 计算设置对象的稳定哈希（用于检测设置变化）
 * 递归对所有层级的 object key 排序，保证嵌套结构（如 recoveryRules）也稳定
 * 注意：bridge 端口/token 不再写入 enh-settings.json（见 bridgeServer.ts），
 * workbench.html 只因真正的用户设置变化才重写，避免多实例互踢触发无谓提权。
 */
function hashSettings(settings: Record<string, any>): string {
  try {
    const json = stableStringify(settings);
    let h = 0;
    for (let i = 0; i < json.length; i++) {
      h = ((h << 5) - h + json.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  } catch {
    return '0';
  }
}

function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function ensureCSP(html: string): string {
  // 抽取 script-src 指令块单独检查（避免被 style-src 'unsafe-inline' 误判）
  const m = html.match(/script-src\s+[^;]*/);
  if (!m) return html; // CSP 没有 script-src 指令，跳过
  if (m[0].includes("'unsafe-inline'")) return html; // script-src 已含
  return html.replace(/(script-src\s+[^;]*)/, "$1 'unsafe-inline'");
}

/**
 * 允许 connect-src 到 127.0.0.1 / localhost（任意端口），用于 bridge HTTP server
 */
function ensureConnectSrc(html: string): string {
  const m = html.match(/connect-src\s+[^;]*/);
  if (!m) return html;
  if (m[0].includes('127.0.0.1')) return html; // 已含
  return html.replace(/(connect-src\s+[^;]*)/, '$1 http://127.0.0.1:* http://localhost:*');
}

function ensureTrustedTypes(html: string): string {
  if (html.includes('abBubbles')) return html;
  return html.replace(
    /(trusted-types\s+[^;]+)/,
    '$1 abBubbles'
  );
}
