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

/**
 * 升级重置：每次版本号变化时强制将 continueMode 重置为 'simple'。
 *
 * 背景：v7.7.8 引入三模式互斥，simple 是新默认。但只要用户曾经手动选过守护，
 * 就会一直停留在守护，无法享受新默认。本函数将「默认 simple」作为长期产品策略：
 *   - 同版本内重启 → 不重复触发（尊重用户当前偏好）
 *   - 跨版本升级 → 强制把 smart 重置为 simple（除长任务运行中和已禁用）
 *
 * 规则：
 *   - `continueMode === 'smart'`     → 强制 → `'simple'`（同步 `autoContinueTab='simple'`）
 *   - `continueMode === undefined`   → 强制 → `'simple'`
 *   - `continueMode === 'brainless'` → 不动（避免打断长任务运行中的用户）
 *   - `continueMode === 'simple'`    → 不动（已是新默认）
 *   - `continueMode === 'off'`       → 不动（尊重用户明确禁用的意愿）
 *
 * 通过 `__defaultsAppliedAt` 字段记录上次应用版本，与传入的 `currentVersion` 对比触发。
 * 同时清理旧的 `__migratedToSimpleV779` 标记（被版本号机制取代）。
 *
 * 调用时机：扩展激活时、`ensureEnhancement()` 之前。
 */
export function resetContinueModeOnUpgrade(currentVersion: string): {
  changed: boolean;
  from?: string;
  lastVersion?: string;
} {
  const settings = readEnhSettings();
  const lastVersion: string | undefined = settings.__defaultsAppliedAt;

  // 同版本启动 → 跳过（一个版本周期内只触发一次，尊重用户在该版本内的偏好）
  if (lastVersion === currentVersion) return { changed: false, lastVersion };

  const from = settings.continueMode;
  let changed = false;

  if (from === undefined || from === 'smart') {
    settings.continueMode = 'simple';
    settings.autoContinueTab = 'simple';
    changed = true;
  }
  // brainless / simple / off 保持不变

  settings.__defaultsAppliedAt = currentVersion;
  // 清理旧的一次性标记（被版本号机制取代）
  if ('__migratedToSimpleV779' in settings) {
    delete settings.__migratedToSimpleV779;
  }

  writeEnhSettings(settings);
  return { changed, from, lastVersion };
}
