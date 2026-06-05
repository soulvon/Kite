/**
 * IDE 类型检测模块
 * 统一检测当前运行环境是 Windsurf 还是 Devin
 */
import * as path from 'path';
import * as fs from 'fs';

// 缓存检测结果（process.execPath 不会变，无需重复计算）
let _cachedFlavor: 'devin' | 'windsurf' | null = null;

/**
 * 检测当前运行的 IDE 类型
 * 基于 process.execPath 判断
 */
export function detectIdeFlavor(): 'devin' | 'windsurf' {
  if (_cachedFlavor) return _cachedFlavor;
  try {
    const execPath = process.execPath.toLowerCase();
    if (execPath.includes('devin')) {
      _cachedFlavor = 'devin';
      return 'devin';
    }
    if (execPath.includes('windsurf')) {
      _cachedFlavor = 'windsurf';
      return 'windsurf';
    }
  } catch {
    // fallback
  }
  _cachedFlavor = 'windsurf';
  return 'windsurf';
}

/**
 * 获取 IDE 显示名称
 */
export function getIdeDisplayName(flavor?: 'devin' | 'windsurf'): string {
  return (flavor || detectIdeFlavor()) === 'devin' ? 'Devin' : 'Windsurf';
}

/**
 * 获取 IDE 可执行文件名（Windows）
 */
export function getIdeExeName(flavor?: 'devin' | 'windsurf'): string {
  return (flavor || detectIdeFlavor()) === 'devin' ? 'Devin.exe' : 'Windsurf.exe';
}

/**
 * 获取 IDE 进程名列表（用于进程搜索，大小写不敏感匹配）
 */
export function getIdeProcessNames(): string[] {
  return ['Devin.exe', 'Windsurf.exe'];
}

export interface UserDataDirCandidate {
  path: string;
  flavor: 'devin' | 'windsurf';
}

/**
 * 获取 userDataDir 候选路径列表
 * 当前 IDE 类型优先排在前面
 */
export function getUserDataDirCandidates(): UserDataDirCandidate[] {
  const appData = process.env.APPDATA || '';
  const current = detectIdeFlavor();
  const all: UserDataDirCandidate[] = [
    { path: `${appData}\\Devin`, flavor: 'devin' as const },
    { path: `${appData}\\Windsurf`, flavor: 'windsurf' as const },
    { path: `${appData}\\Windsurf - Next`, flavor: 'windsurf' as const },
  ];
  // 当前 IDE 类型优先
  all.sort((a, b) => {
    if (a.flavor === current && b.flavor !== current) return -1;
    if (a.flavor !== current && b.flavor === current) return 1;
    return 0;
  });
  return all;
}

/**
 * 获取 state.vscdb 路径
 * 优先当前 IDE 类型对应的路径；如不存在则回退到另一个
 */
export function getStateDbPath(): string {
  const appData = process.env.APPDATA || '';
  const current = detectIdeFlavor();
  const candidates = current === 'devin'
    ? [
        `${appData}\\Devin\\User\\globalStorage\\state.vscdb`,
        `${appData}\\Windsurf\\User\\globalStorage\\state.vscdb`,
      ]
    : [
        `${appData}\\Windsurf\\User\\globalStorage\\state.vscdb`,
        `${appData}\\Devin\\User\\globalStorage\\state.vscdb`,
      ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  // 默认回退当前 IDE 类型
  return candidates[0];
}

/**
 * 获取增强脚本文件名（根据 IDE 类型）
 */
export function getEnhancementScriptName(): string {
  return detectIdeFlavor() === 'devin' ? 'devin-better.js' : 'windsurf-better.js';
}

/**
 * 获取扩展目录基名（.devin 或 .windsurf）
 * 优先当前 IDE 类型；如不存在则回退
 */
export function getExtensionsDirBase(homeDir: string): string {
  const current = detectIdeFlavor();
  const primary = path.join(homeDir, current === 'devin' ? '.devin' : '.windsurf', 'extensions');
  const fallback = path.join(homeDir, current === 'devin' ? '.windsurf' : '.devin', 'extensions');
  if (fs.existsSync(primary) && fs.readdirSync(primary).length > 1) return primary;
  if (fs.existsSync(fallback) && fs.readdirSync(fallback).length > 1) return fallback;
  return primary;
}

/**
 * 从当前运行的 IDE 的 package.json 获取版本号
 */
export function getIdeVersion(): string {
  try {
    const execDir = path.dirname(process.execPath);
    const pkgPath = path.join(execDir, 'resources', 'app', 'package.json');
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '2.2.17';
    }
  } catch {}
  return '2.2.17';
}
