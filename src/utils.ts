import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

/**
 * 安全注册命令：当稳定扩展 local.windsurf-pool 与临时改名版本 local.kite 同时安装时，
 * 相同命令 ID 会导致 registerCommand 抛出 "already exists" 错误，
 * 进而使整个 activate 函数崩溃。
 * 此包装器捕获该错误并返回 no-op disposable，让扩展继续激活。
 */
export function safeRegisterCommand(
  commandId: string,
  callback: (...args: any[]) => any,
  thisArg?: any
): vscode.Disposable {
  try {
    return vscode.commands.registerCommand(commandId, callback, thisArg);
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      console.warn(`[kite] 命令 '${commandId}' 已被其他 Kite 扩展注册，跳过。请卸载临时改名版本 local.kite，只保留 local.windsurf-pool。`);
      return { dispose() {} };
    }
    throw err;
  }
}

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
