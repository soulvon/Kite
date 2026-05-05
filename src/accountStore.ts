import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StoredAccount } from './types';
import { getPoolRoot, ensureDir } from './utils';
import { CACHE_TTL } from './config';

const ACCOUNTS_KEY = 'windsurfPool.accounts.v1';
const ACCOUNTS_FILE = 'accounts.json';

function getAccountsFilePath(): string {
  return path.join(getPoolRoot(), ACCOUNTS_FILE);
}

let _accountsCache: StoredAccount[] | null = null;
let _accountsCacheTs = 0;

function readAccountsFromFile(forceFresh = false): StoredAccount[] {
  const now = Date.now();
  if (!forceFresh && _accountsCache && now - _accountsCacheTs < CACHE_TTL.ACCOUNTS) {
    return _accountsCache;
  }
  const p = getAccountsFilePath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const arr = JSON.parse(raw);
    _accountsCache = Array.isArray(arr) ? arr.filter(isValidAccount) : [];
    _accountsCacheTs = now;
    return _accountsCache;
  } catch {
    return [];
  }
}

function invalidateAccountsCache(): void {
  _accountsCache = null;
}

function saveAccountsToFile(accounts: StoredAccount[]): void {
  ensureDir(getPoolRoot());
  const p = getAccountsFilePath();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  _accountsCache = accounts;
  _accountsCacheTs = Date.now();
}

// ─── 文件监听（多实例同步）──────────────────────────────

let fileWatcher: fs.FSWatcher | null = null;
const changeListeners: Set<() => void> = new Set();

function startWatcher(): void {
  if (fileWatcher) return;
  try {
    ensureDir(getPoolRoot());
    fileWatcher = fs.watch(getPoolRoot(), (_evt, filename) => {
      // Windows 上 rename 事件的 filename 可能为 null，此时也视为变化
      if (!filename || filename === ACCOUNTS_FILE) {
        invalidateAccountsCache();
        for (const fn of changeListeners) {
          try { fn(); } catch { /* ignore */ }
        }
      }
    });
    fileWatcher.on('error', (err) => {
      console.warn('[accountStore] watcher 出错，将重试:', err);
      try { fileWatcher?.close(); } catch { /* ignore */ }
      fileWatcher = null;
      // 1 秒后重连
      setTimeout(() => { if (changeListeners.size > 0) startWatcher(); }, 1000);
    });
  } catch (e) {
    console.warn('[accountStore] watch 失败:', e);
  }
}

export function watchAccountsFile(onChange: () => void): () => void {
  changeListeners.add(onChange);
  startWatcher();
  return () => {
    changeListeners.delete(onChange);
    if (changeListeners.size === 0 && fileWatcher) {
      try { fileWatcher.close(); } catch { /* ignore */ }
      fileWatcher = null;
    }
  };
}

/**
 * 验证账号数据是否有效
 */
function isValidAccount(account: any): account is StoredAccount {
  return (
    typeof account === 'object' &&
    account !== null &&
    typeof account.email === 'string' &&
    typeof account.apiKey === 'string' &&
    typeof account.apiServerUrl === 'string'
  );
}

/**
 * 读取账号列表（从共享文件）
 */
export async function readAccounts(context: vscode.ExtensionContext): Promise<StoredAccount[]> {
  // 优先从共享文件读取
  const fileAccounts = readAccountsFromFile();
  if (fileAccounts.length > 0) return fileAccounts;

  // 回退：从 secrets 读取（首次迁移）
  const raw = await context.secrets.get(ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    const accounts = Array.isArray(arr) ? arr.filter(isValidAccount) : [];
    // 迁移到共享文件
    if (accounts.length > 0) {
      saveAccountsToFile(accounts);
    }
    return accounts;
  } catch {
    return [];
  }
}

/**
 * 保存账号列表（到共享文件）
 */
export async function saveAccounts(context: vscode.ExtensionContext, accounts: StoredAccount[]): Promise<void> {
  saveAccountsToFile(accounts);
  // 同时备份到 secrets（兼容旧版本）
  await context.secrets.store(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/**
 * 新增或更新账号
 */
export async function upsertAccount(context: vscode.ExtensionContext, account: StoredAccount): Promise<void> {
  const accounts = await readAccounts(context);
  const idx = accounts.findIndex(a => a.email === account.email);
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  await saveAccounts(context, accounts);
}

/**
 * 删除账号
 */
export async function removeAccount(context: vscode.ExtensionContext, email: string): Promise<boolean> {
  const accounts = await readAccounts(context);
  const filtered = accounts.filter(a => a.email !== email);
  if (filtered.length === accounts.length) return false;
  await saveAccounts(context, filtered);
  return true;
}

/**
 * 获取当前活跃账号
 */
export async function getCurrentAccount(context: vscode.ExtensionContext): Promise<StoredAccount | null> {
  const lastEmail = context.globalState.get<string>('lastEmail');
  if (!lastEmail) return null;
  const accounts = await readAccounts(context);
  return accounts.find(a => a.email === lastEmail) || null;
}

/**
 * 设置当前活跃账号
 */
export async function setCurrentAccount(context: vscode.ExtensionContext, email: string): Promise<void> {
  await context.globalState.update('lastEmail', email);
}
