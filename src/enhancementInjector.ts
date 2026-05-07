import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { readEnhSettings } from './enhSettingsStore';

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
  const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', true);
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
    fs.copyFileSync(workbenchPath, originPath);
  }

  let newHtml = html;

  // 清理旧注入
  const blockStartIdx = newHtml.indexOf(BLOCK_START);
  const blockEndIdx = newHtml.indexOf(BLOCK_END);
  if (blockStartIdx >= 0 && blockEndIdx >= 0) {
    newHtml = newHtml.substring(0, blockStartIdx) +
              newHtml.substring(blockEndIdx + BLOCK_END.length);
  }

  // CSP: 添加 'unsafe-inline'
  newHtml = ensureCSP(newHtml);

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
  fs.writeFileSync(workbenchPath, newHtml, 'utf8');

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
  fs.copyFileSync(originPath, workbenchPath);
  return true;
}

/**
 * 检查当前注入状态
 */
export function getInjectionStatus(): { injected: boolean; patchVersion: string | null } {
  const workbenchPath = getWorkbenchHtmlPath();
  if (!workbenchPath) return { injected: false, patchVersion: null };

  const html = fs.readFileSync(workbenchPath, 'utf8');
  const match = html.match(/<!-- ws-better-v([\d.]+) -->/);
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

// 缓存 windsurf-better.js 内容（启动后不变）
let _scriptCache: string | null = null;
function getScriptContent(): string | null {
  if (_scriptCache !== null) return _scriptCache;
  const ext = vscode.extensions.getExtension('local.windsurf-pool');
  if (!ext) return null;
  const scriptPath = path.join(ext.extensionPath, 'resources', 'windsurf-better.js');
  if (!fs.existsSync(scriptPath)) return null;
  _scriptCache = fs.readFileSync(scriptPath, 'utf8');
  return _scriptCache;
}

function getPatchVersion(): string {
  const content = getScriptContent();
  if (!content) return '0.0.0';
  const match = content.match(/const VERSION = '([\d.]+)'/);
  return match ? match[1] : '0.0.0';
}

/**
 * 计算设置对象的稳定哈希（用于检测设置变化）
 * 递归对所有层级的 object key 排序，保证嵌套结构（如 recoveryRules）也稳定
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

function ensureTrustedTypes(html: string): string {
  if (html.includes('abBubbles')) return html;
  return html.replace(
    /(trusted-types\s+[^;]+)/,
    '$1 abBubbles'
  );
}
