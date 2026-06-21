import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

/**
 * 获取跨平台应用数据目录
 * Windows: %APPDATA%
 * macOS:   ~/Library/Application Support
 * Linux:   $XDG_CONFIG_HOME 或 ~/.config
 */
export function getAppDataDir(): string {
  if (isWindows) {
    const appdata = process.env.APPDATA;
    if (!appdata) { throw new Error('APPDATA 环境变量不存在'); }
    return appdata;
  }
  if (isMac) {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  // Linux / other
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/**
 * 获取兼容数据根目录（路径保持不变，用于老用户数据连续）
 */
export function getPoolRoot(): string {
  return path.join(getAppDataDir(), '.windsurf-pool');
}

/**
 * 确保目录存在
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 检测路径是否可写（用 fs.accessSync W_OK 检测）
 * 不存在则返回 true（创建时再判断）
 */
export function isWritable(p: string): boolean {
  try {
    if (!fs.existsSync(p)) return true;
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
