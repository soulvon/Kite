/**
 * 跨窗口共享的额度文件缓存
 *
 * 借鉴 vscode-antigravity-cockpit 的设计：把额度数据缓存到 globalStorage 下的
 * 单一 JSON 文件，所有 Windsurf 窗口的扩展进程共享读写，避免多窗口重复刷新。
 *
 * 写入采用 atomic（temp + rename）+ 队列化，避免并发写冲突；
 * 读取时合并最新磁盘内容到内存，保证多窗口数据最终一致。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { UsageCacheEntry } from './autoSwitcher';

const FILE_NAME = 'usage-cache.json';
const FILE_VERSION = 1;

interface DiskShape {
  v: number;
  entries: Record<string, UsageCacheEntry>;
}

let _ctx: vscode.ExtensionContext | null = null;
let _path: string | null = null;
let _writeQueue: Promise<void> = Promise.resolve();

export function initDiskCache(ctx: vscode.ExtensionContext): void {
  _ctx = ctx;
  _path = null; // reset，下次 lazy 解析
}

function resolvePath(): string | null {
  if (_path) return _path;
  if (!_ctx) return null;
  try {
    const dir = _ctx.globalStorageUri.fsPath;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _path = path.join(dir, FILE_NAME);
    return _path;
  } catch (err) {
    console.warn('[usageDiskCache] resolve path failed:', err);
    return null;
  }
}

function readShape(): DiskShape {
  const p = resolvePath();
  const empty: DiskShape = { v: FILE_VERSION, entries: {} };
  if (!p || !fs.existsSync(p)) return empty;
  try {
    const txt = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(txt) as DiskShape;
    if (obj?.v !== FILE_VERSION || !obj.entries) return empty;
    return obj;
  } catch (err) {
    console.warn('[usageDiskCache] read failed:', err);
    return empty;
  }
}

/**
 * 启动时一次性加载所有缓存，回填到内存
 */
export function loadAll(): Map<string, UsageCacheEntry> {
  const result = new Map<string, UsageCacheEntry>();
  const obj = readShape();
  for (const [email, entry] of Object.entries(obj.entries)) {
    if (entry && typeof entry.ts === 'number') {
      result.set(email, entry);
    }
  }
  return result;
}

/**
 * 读取单条记录（用于运行时检查其他窗口是否刚刷过）
 */
export function readEntry(email: string): UsageCacheEntry | null {
  const obj = readShape();
  return obj.entries[email] || null;
}

/**
 * 队列化写入单条记录（atomic：tmp + rename）
 * 多窗口并发安全：每次写入前重新读盘合并，避免互相覆盖。
 */
export function writeEntry(email: string, entry: UsageCacheEntry): void {
  _writeQueue = _writeQueue.then(() => doWrite(email, entry)).catch(err => {
    console.warn('[usageDiskCache] write queue error:', err);
  });
}

async function doWrite(email: string, entry: UsageCacheEntry): Promise<void> {
  const p = resolvePath();
  if (!p) return;
  try {
    const obj = readShape();
    obj.entries[email] = entry;
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    try {
      fs.renameSync(tmp, p);
    } catch (renameErr) {
      // Windows 下偶发 EPERM/EBUSY，回退到直接写
      try { fs.writeFileSync(p, JSON.stringify(obj), 'utf8'); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
      throw renameErr;
    }
  } catch (err) {
    console.warn('[usageDiskCache] doWrite failed:', err);
  }
}

/**
 * 比较两个缓存条目，返回更新的那个（ts 更大）
 */
export function pickNewer(
  a: UsageCacheEntry | undefined,
  b: UsageCacheEntry | null | undefined,
): UsageCacheEntry | undefined {
  if (!a) return b || undefined;
  if (!b) return a;
  return b.ts > a.ts ? b : a;
}
