import * as fs from 'fs';
import * as path from 'path';
import { getPoolRoot, ensureDir } from './utils';

/**
 * 增强设置共享存储（enh-settings.json）
 *
 * 用途：
 * VS Code 侧栏 webview 的 localStorage 与 workbench.html 的 localStorage 因 origin
 * 隔离不能直接同步。本模块将设置持久化到磁盘文件，由扩展宿主作为中转：
 *
 *   侧栏 webview → postMessage → 扩展宿主 → 写入 enh-settings.json
 *                                       └─→ 注入 workbench.html 时嵌入为全局变量
 *                                              ↓ reload 后
 *                                       windsurf-better.js 读取生效
 *
 * 真相源：本模块管理的 JSON 文件
 */

const ENH_SETTINGS_FILE = 'enh-settings.json';

export function getEnhSettingsPath(): string {
  return path.join(getPoolRoot(), ENH_SETTINGS_FILE);
}

/**
 * 读取增强设置（不存在时返回 {}）
 */
export function readEnhSettings(): Record<string, any> {
  try {
    const p = getEnhSettingsPath();
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    // 兼容：旧版本在此文件里写了 __bridgePort/__bridgeToken（多实例会互相覆盖）。
    // 新版本 bridge 信息改由 sidebar postMessage 广播，这里剥离掉避免污染 hash。
    if ('__bridgePort' in obj || '__bridgeToken' in obj) {
      delete obj.__bridgePort;
      delete obj.__bridgeToken;
    }
    return obj;
  } catch {
    return {};
  }
}

/**
 * 写入增强设置（原子替换）
 */
export function writeEnhSettings(settings: Record<string, any>): boolean {
  try {
    ensureDir(getPoolRoot());
    const p = getEnhSettingsPath();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 合并部分设置后写回（用于 webview 的 saveEnhanceSettings 增量同步）
 */
export function mergeEnhSettings(patch: Record<string, any>): Record<string, any> {
  const current = readEnhSettings();
  const updated = { ...current, ...patch };
  writeEnhSettings(updated);
  return updated;
}
