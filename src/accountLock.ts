import * as fs from 'fs';
import * as path from 'path';
import { getPoolRoot, ensureDir } from './utils';

// ─── 类型 ───────────────────────────────────────────────

interface LockEntry {
  instanceId: string;
  instanceName?: string;
  pid: number;
  ts: number;
}

interface LockFile {
  locks: Record<string, LockEntry>;
}

// ─── 常量 ───────────────────────────────────────────────

const LOCK_FILE_NAME = 'account-locks.json';
const HEARTBEAT_INTERVAL_MS = 30_000;   // 30s 心跳
const STALE_THRESHOLD_MS = 90_000;      // 90s 超时视为死锁

// ─── 状态 ───────────────────────────────────────────────

let _heartbeatTimer: NodeJS.Timeout | null = null;
let _currentInstanceId: string = '';
let _currentInstanceName: string = '';
let _currentLockedEmail: string | null = null;

// ─── 路径 ───────────────────────────────────────────────

function getLockFilePath(): string {
  return path.join(getPoolRoot(), LOCK_FILE_NAME);
}

// ─── 读写 ───────────────────────────────────────────────

function readLockFile(): LockFile {
  const p = getLockFilePath();
  if (!fs.existsSync(p)) return { locks: {} };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return { locks: parsed.locks && typeof parsed.locks === 'object' ? parsed.locks : {} };
  } catch {
    return { locks: {} };
  }
}

function writeLockFile(data: LockFile): void {
  ensureDir(getPoolRoot());
  const p = getLockFilePath();
  const tmp = p + '.tmp.' + process.pid + '.' + Date.now();
  const json = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(tmp, json, 'utf8');
    try {
      fs.renameSync(tmp, p);
    } catch (renameErr) {
      // Windows 下偶发 EPERM/EBUSY（文件被另一进程读取/锁定），回退到直接覆写
      try { fs.writeFileSync(p, json, 'utf8'); } catch (writeErr) {
        console.warn('[accountLock] writeLockFile fallback failed:', writeErr);
      }
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  } catch (err) {
    console.warn('[accountLock] writeLockFile error:', err);
  }
}

// ─── 进程判活 ─────────────────────────────────────────────

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── 清理过期锁 ─────────────────────────────────────────

function cleanStaleLocks(data: LockFile): boolean {
  const now = Date.now();
  let changed = false;
  for (const [email, entry] of Object.entries(data.locks)) {
    const isStale = now - entry.ts > STALE_THRESHOLD_MS;
    const isDead = !isPidAlive(entry.pid);
    if (isStale || isDead) {
      delete data.locks[email];
      changed = true;
    }
  }
  return changed;
}

// ─── 公开 API ───────────────────────────────────────────

/**
 * 初始化锁模块，设置实例标识
 */
export function initAccountLock(instanceId: string, instanceName?: string): void {
  _currentInstanceId = instanceId || `pid-${process.pid}`;
  _currentInstanceName = instanceName || '';
}

/**
 * 锁定账号（切换成功后调用）
 */
export function acquireLock(email: string): void {
  if (!email) return;
  const data = readLockFile();
  cleanStaleLocks(data);

  // 释放当前实例旧锁
  if (_currentLockedEmail && _currentLockedEmail !== email) {
    delete data.locks[_currentLockedEmail];
  }

  data.locks[email] = {
    instanceId: _currentInstanceId,
    instanceName: _currentInstanceName || undefined,
    pid: process.pid,
    ts: Date.now(),
  };
  _currentLockedEmail = email;

  try { writeLockFile(data); } catch (err) {
    console.warn('[accountLock] acquireLock write error:', err);
  }
}

/**
 * 释放账号锁（切走或退出时调用）
 */
export function releaseLock(email?: string): void {
  const target = email || _currentLockedEmail;
  if (!target) return;

  const data = readLockFile();
  const entry = data.locks[target];
  // 只释放自己的锁
  if (entry && entry.pid === process.pid) {
    delete data.locks[target];
    try { writeLockFile(data); } catch (err) {
      console.warn('[accountLock] releaseLock write error:', err);
    }
  }
  if (_currentLockedEmail === target) {
    _currentLockedEmail = null;
  }
}

/**
 * 获取被其他存活窗口占用的账号邮箱集合
 */
export function getOtherLockedEmails(): Set<string> {
  const data = readLockFile();
  const cleaned = cleanStaleLocks(data);
  // 有清理时持久化，避免文件膨胀
  if (cleaned) {
    try { writeLockFile(data); } catch { /* ignore */ }
  }

  const result = new Set<string>();
  for (const [email, entry] of Object.entries(data.locks)) {
    // 排除自己
    if (entry.pid === process.pid) continue;
    // 再次确认对方存活
    if (isPidAlive(entry.pid)) {
      result.add(email);
    }
  }
  return result;
}

/**
 * 获取被其他存活窗口占用的账号映射（包含实例名）
 */
export function getOtherLockedEmailsMap(): Record<string, { instanceName: string; pid: number }> {
  const data = readLockFile();
  const cleaned = cleanStaleLocks(data);
  if (cleaned) {
    try { writeLockFile(data); } catch { /* ignore */ }
  }

  const result: Record<string, { instanceName: string; pid: number }> = {};
  for (const [email, entry] of Object.entries(data.locks)) {
    if (entry.pid === process.pid) continue;
    if (isPidAlive(entry.pid)) {
      result[email] = {
        instanceName: entry.instanceName || `PID ${entry.pid}`,
        pid: entry.pid
      };
    }
  }
  return result;
}

/**
 * 启动心跳（定期更新自己的锁时间戳）
 */
export function startHeartbeat(): void {
  if (_heartbeatTimer) return;
  _heartbeatTimer = setInterval(() => {
    if (!_currentLockedEmail) return;
    try {
      const data = readLockFile();
      // 先清理过期锁
      cleanStaleLocks(data);

      const entry = data.locks[_currentLockedEmail];
      if (entry && entry.pid === process.pid) {
        // 正常情况：更新心跳时间戳
        entry.ts = Date.now();
      } else if (!entry) {
        // 锁被清理了（比如文件被手动删除），重新获取
        data.locks[_currentLockedEmail] = {
          instanceId: _currentInstanceId,
          instanceName: _currentInstanceName || undefined,
          pid: process.pid,
          ts: Date.now(),
        };
      } else {
        // 锁被另一个存活进程抢走了，放弃持有（避免 ping-pong）
        _currentLockedEmail = null;
        writeLockFile(data);
        return;
      }
      writeLockFile(data);
    } catch (err) {
      console.warn('[accountLock] heartbeat error:', err);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * 停止心跳
 */
export function stopHeartbeat(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

/**
 * 获取当前锁定的邮箱（调试用）
 */
export function getCurrentLockedEmail(): string | null {
  return _currentLockedEmail;
}

/**
 * 获取所有存活窗口的 instanceId → email 映射（包含当前窗口）
 * 用于在实例列表中展示"自动选号模式"实例当前实际登录的账号
 */
export function getInstanceEmailMap(): Record<string, string> {
  const data = readLockFile();
  const cleaned = cleanStaleLocks(data);
  if (cleaned) {
    try { writeLockFile(data); } catch { /* ignore */ }
  }
  const map: Record<string, string> = {};
  for (const [email, entry] of Object.entries(data.locks)) {
    if (entry.instanceId) map[entry.instanceId] = email;
  }
  return map;
}
