import * as fs from 'fs';
import * as path from 'path';

/**
 * 获取 Windsurf Pool 根目录
 */
export function getPoolRoot(): string {
  const appdata = process.env.APPDATA;
  if (!appdata) { throw new Error('APPDATA 环境变量不存在'); }
  return path.join(appdata, '.windsurf-pool');
}

/**
 * 确保目录存在
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
