import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MARKER_PREFIX = '<!-- ws-better-v';
const MARKER_SUFFIX = ' -->';
const BLOCK_START = '<!-- ws-better-start -->';
const BLOCK_END = '<!-- ws-better-end -->';

export interface EnhancementResult {
  injected: boolean;
  needRestart: boolean;
  error?: string;
}

/**
 * 确保 windsurf-better.js 已注入到 workbench.html
 * 版本不匹配时自动更新
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

  // 检查版本标记
  if (html.includes(`${MARKER_PREFIX}${patchVersion}${MARKER_SUFFIX}`)) {
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

  // 注入脚本
  const injection =
    `\n${BLOCK_START}\n` +
    `${MARKER_PREFIX}${patchVersion}${MARKER_SUFFIX}\n` +
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
