import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StoredAccount } from './types';
import { getPoolRoot, ensureDir } from './utils';
import { CACHE_TTL } from './config';
import { tryRecoverLegacyAccounts, tryReadLegacyAccountsFile } from './legacySecretMigration';

const ACCOUNTS_KEY = 'windsurfPool.accounts.v1';
const ACCOUNTS_FILE = 'accounts.json';
const ACCOUNT_SECRET_PREFIX = 'windsurfPool.accountSecret.v1.';

type SecretField = 'apiKey' | 'devinAuth1Token' | 'password' | 'rawToken';

function getAccountsFilePath(): string {
  return path.join(getPoolRoot(), ACCOUNTS_FILE);
}

let _accountsCache: StoredAccount[] | null = null;
let _accountsCacheTs = 0;

function accountSecretKey(email: string, field: SecretField): string {
  return `${ACCOUNT_SECRET_PREFIX}${encodeURIComponent(email)}.${field}`;
}

function cloneAccount(account: StoredAccount): StoredAccount {
  return {
    ...account,
    tags: account.tags ? [...account.tags] : undefined,
    importMeta: account.importMeta ? { ...account.importMeta } : undefined,
  };
}

function sanitizeAccountForDisk(account: StoredAccount): StoredAccount {
  const sanitized = cloneAccount(account);
  sanitized.apiKey = '';
  delete sanitized.devinAuth1Token;
  if (sanitized.importMeta) {
    delete sanitized.importMeta.password;
    delete sanitized.importMeta.rawToken;
    if (Object.keys(sanitized.importMeta).length === 0) {
      delete sanitized.importMeta;
    }
  }
  return sanitized;
}

function sanitizeAccountsForDisk(accounts: StoredAccount[]): StoredAccount[] {
  return accounts.map(account => sanitizeAccountForDisk(account));
}

function hasInlineSecrets(account: StoredAccount): boolean {
  return !!(
    account.apiKey ||
    account.devinAuth1Token ||
    account.importMeta?.password ||
    account.importMeta?.rawToken
  );
}

async function storeAccountSecrets(context: vscode.ExtensionContext, account: StoredAccount): Promise<void> {
  const stores: Array<[SecretField, string | undefined]> = [
    ['apiKey', account.apiKey],
    ['devinAuth1Token', account.devinAuth1Token],
    ['password', account.importMeta?.password],
    ['rawToken', account.importMeta?.rawToken],
  ];

  for (const [field, value] of stores) {
    if (typeof value === 'string' && value.length > 0) {
      await context.secrets.store(accountSecretKey(account.email, field), value);
    }
  }
}

async function deleteAccountSecrets(context: vscode.ExtensionContext, email: string): Promise<void> {
  await Promise.all((['apiKey', 'devinAuth1Token', 'password', 'rawToken'] as SecretField[])
    .map(field => context.secrets.delete(accountSecretKey(email, field))));
}

async function hydrateAccount(context: vscode.ExtensionContext, account: StoredAccount): Promise<{ account: StoredAccount; hadInlineSecrets: boolean }> {
  const hadInlineSecrets = hasInlineSecrets(account);
  if (hadInlineSecrets) {
    await storeAccountSecrets(context, account);
  }

  const hydrated = cloneAccount(account);
  hydrated.apiKey = account.apiKey || await context.secrets.get(accountSecretKey(account.email, 'apiKey')) || '';
  const devinAuth1Token = account.devinAuth1Token || await context.secrets.get(accountSecretKey(account.email, 'devinAuth1Token'));
  if (devinAuth1Token) hydrated.devinAuth1Token = devinAuth1Token;

  const password = account.importMeta?.password || await context.secrets.get(accountSecretKey(account.email, 'password'));
  const rawToken = account.importMeta?.rawToken || await context.secrets.get(accountSecretKey(account.email, 'rawToken'));
  if (password || rawToken || hydrated.importMeta) {
    hydrated.importMeta = { ...(hydrated.importMeta || {}) };
    if (password) hydrated.importMeta.password = password;
    if (rawToken) hydrated.importMeta.rawToken = rawToken;
  }

  return { account: normalizeAccountTags(hydrated), hadInlineSecrets };
}

async function hydrateAccounts(context: vscode.ExtensionContext, accounts: StoredAccount[]): Promise<{ accounts: StoredAccount[]; hadInlineSecrets: boolean }> {
  let hadInlineSecrets = false;
  const hydrated: StoredAccount[] = [];
  for (const account of accounts) {
    const result = await hydrateAccount(context, account);
    hydrated.push(result.account);
    hadInlineSecrets = hadInlineSecrets || result.hadInlineSecrets;
  }
  return { accounts: hydrated, hadInlineSecrets };
}

function readAccountsFileRaw(): StoredAccount[] {
  const p = getAccountsFilePath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isValidAccount).map(normalizeAccountTags) : [];
  } catch {
    return [];
  }
}

function readAccountsFromFile(forceFresh = false): StoredAccount[] {
  const now = Date.now();
  if (!forceFresh && _accountsCache && now - _accountsCacheTs < CACHE_TTL.ACCOUNTS) {
    return _accountsCache;
  }
  const p = getAccountsFilePath();
  if (!fs.existsSync(p)) return [];
  try {
    _accountsCache = readAccountsFileRaw().map(account => normalizeAccountTags(sanitizeAccountForDisk(account)));
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
  const safeAccounts = sanitizeAccountsForDisk(accounts);
  const p = getAccountsFilePath();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(safeAccounts, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  _accountsCache = safeAccounts;
  _accountsCacheTs = Date.now();
}

// ─── 写入队列（串行化 read-modify-write，避免并发丢数据） ────
// 关键设计：前一次失败不应阻塞后续任务（_writeQueue 必须始终 resolve）。
// 调用方的 result/error 通过返回的 Promise 单独透传，不污染队列。
let _writeQueue: Promise<void> = Promise.resolve();
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  // 任务在队列就绪后执行（无论前一个成功或失败都执行）
  const ready = _writeQueue.then(() => {}, () => {});
  const next = ready.then(task);
  // 队列只跟踪"已完成"状态，吞掉错误避免阻塞下一个任务
  _writeQueue = next.then(() => {}, () => {});
  return next;
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
 * 归一化：将旧 tag 字段迁移到 tags 数组，保持双字段同步
 */
function normalizeAccountTags(a: StoredAccount): StoredAccount {
  if (!a.tags && a.tag) {
    a.tags = [a.tag];
  }
  if (a.tags && a.tags.length > 0) {
    a.tag = a.tags[0];
  } else if (!a.tag) {
    delete (a as any).tags;
    delete (a as any).tag;
  }
  return a;
}

/**
 * 同步读取账号列表（仅从文件缓存，用于不能 await 的场景）
 */
export function readAccountsSync(_context: vscode.ExtensionContext): StoredAccount[] {
  return readAccountsFromFile();
}

/**
 * 读取账号列表（从共享文件）
 */
export async function readAccounts(context: vscode.ExtensionContext): Promise<StoredAccount[]> {
  // 优先从共享文件读取
  const fileAccounts = readAccountsFileRaw();
  if (fileAccounts.length > 0) {
    const hydrated = await hydrateAccounts(context, fileAccounts);
    // 兼容：从旧扩展 windsurf-pool 恢复凭据
    const recovered = await tryRecoverLegacyAccounts(context, hydrated.accounts);
    const finalAccounts = recovered.accounts;
    if (hydrated.hadInlineSecrets || recovered.recovered) {
      await saveAccounts(context, finalAccounts);
    }
    warnMissingCredentials(finalAccounts);
    return finalAccounts;
  }

  // 回退：从旧扩展 accounts.json 文件读取（兼容路径）
  const legacyFileAccounts = tryReadLegacyAccountsFile();
  if (legacyFileAccounts.length > 0) {
    const hydrated = await hydrateAccounts(context, legacyFileAccounts);
    await saveAccounts(context, hydrated.accounts);
    warnMissingCredentials(hydrated.accounts);
    return hydrated.accounts;
  }

  // 回退：从 secrets 读取（首次迁移）
  const raw = await context.secrets.get(ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    const accounts = Array.isArray(arr) ? arr.filter(isValidAccount) : [];
    // 迁移到共享文件
    if (accounts.length > 0) {
      await saveAccounts(context, accounts);
    }
    const hydrated = await hydrateAccounts(context, accounts);
    const recovered = await tryRecoverLegacyAccounts(context, hydrated.accounts);
    warnMissingCredentials(recovered.accounts);
    return recovered.accounts;
  } catch {
    return [];
  }
}

let _missingCredentialsWarned = false;

function warnMissingCredentials(accounts: StoredAccount[]): void {
  const empty = accounts.filter(a => !a.apiKey);
  if (empty.length === 0 || _missingCredentialsWarned) return;
  _missingCredentialsWarned = true;
  console.warn(
    `[accountStore] ${empty.length} 个账号缺少 apiKey，刷新/切号会失败。` +
    `请尝试命令面板 "Kite: 修复缺失凭据" 或重新导入账号。`
  );
}

/**
 * 保存账号列表（到共享文件）
 */
export async function saveAccounts(context: vscode.ExtensionContext, accounts: StoredAccount[]): Promise<void> {
  for (const account of accounts) {
    await storeAccountSecrets(context, account);
  }
  saveAccountsToFile(accounts);
  // 同时备份非敏感索引到 secrets（兼容旧版本，不再写入凭据明文）
  await context.secrets.store(ACCOUNTS_KEY, JSON.stringify(sanitizeAccountsForDisk(accounts)));
}

/**
 * upsertAccount 的去重策略：
 *  - 'auto'（默认）：
 *      新的有 devinAuth1Token → 覆盖（修复缺 token 的旧记录）
 *      新的没 devinAuth1Token 且旧的有 → **另存为新条目**（email 加 `#oauth`/`#alt` 后缀），保护旧 auth1
 *      其余情况 → 覆盖
 *  - 'always'：永远按 email 去重覆盖（保留旧版行为）
 *  - 'never'：永远另存为新条目
 */
export type UpsertDedupStrategy = 'auto' | 'always' | 'never';

export interface UpsertOptions {
  dedupStrategy?: UpsertDedupStrategy;
  /** 另存时 email 加的来源标识（如 'oauth' / 'session'），默认按 account 字段推断 */
  sourceTag?: string;
}

/**
 * 在已有账号列表里找到一个唯一的 alternate email（email 末尾加 `#sourceTag` 或递增数字）
 */
function generateAlternateEmail(baseEmail: string, accounts: StoredAccount[], sourceTag: string): string {
  const tag = sourceTag.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'alt';
  let candidate = `${baseEmail}#${tag}`;
  if (!accounts.some(a => a.email === candidate)) return candidate;
  for (let i = 2; i < 100; i++) {
    const c = `${baseEmail}#${tag}${i}`;
    if (!accounts.some(a => a.email === c)) return c;
  }
  // 兜底：加时间戳
  return `${baseEmail}#${tag}${Date.now().toString(36)}`;
}

function inferSourceTag(account: StoredAccount, fallback = 'alt'): string {
  // 已有 devinAuth1Token → 不应该走到另存分支，但兜底用 'auth1'
  if ((account as any).devinAuth1Token) return 'auth1';
  // sessionInjector 系列没 auth1，标记为 oauth/session
  return fallback === 'alt' ? 'oauth' : fallback;
}

/**
 * 新增或更新账号。
 *
 * 返回最终被存储的账号（注意：email 可能被改成 `email#oauth` 形式以避免覆盖旧条目）。
 * 调用方需要用返回值的 email 做后续操作（setCurrentAccount / postMessage 等）。
 */
export async function upsertAccount(
  context: vscode.ExtensionContext,
  account: StoredAccount,
  options?: UpsertOptions
): Promise<StoredAccount> {
  return enqueueWrite(async () => {
    invalidateAccountsCache(); // 强制重读，避免用过期缓存
    const accounts = await readAccounts(context);
    const idx = accounts.findIndex(a => a.email === account.email);
    const strategy = options?.dedupStrategy || 'auto';

    if (idx < 0) {
      accounts.push(account);
      await saveAccounts(context, accounts);
      return account;
    }

    // 同 email 已存在 → 按策略决定覆盖 or 另存
    const old = accounts[idx];
    let shouldDedup: boolean;
    if (strategy === 'always') {
      shouldDedup = true;
    } else if (strategy === 'never') {
      shouldDedup = false;
    } else {
      // 'auto' 智能策略
      const newHasAuth1 = !!account.devinAuth1Token;
      const oldHasAuth1 = !!old.devinAuth1Token;
      if (newHasAuth1) shouldDedup = true;          // 新的有 auth1 → 覆盖修复
      else if (oldHasAuth1) shouldDedup = false;    // 新的没 auth1 但旧的有 → 不要抹掉旧 auth1，另存
      else shouldDedup = true;                       // 都没 auth1 → 覆盖
    }

    if (shouldDedup) {
      // 合并保护：永不抹掉旧账号的 devinAuth1Token（即便策略是 always 时也保留）
      if (!account.devinAuth1Token && old.devinAuth1Token) {
        account = { ...account, devinAuth1Token: old.devinAuth1Token };
      }
      accounts[idx] = account;
      await saveAccounts(context, accounts);
      return account;
    }

    // 另存为新条目
    const sourceTag = options?.sourceTag || inferSourceTag(account);
    const altEmail = generateAlternateEmail(account.email, accounts, sourceTag);
    const altAccount: StoredAccount = { ...account, email: altEmail };
    accounts.push(altAccount);
    await saveAccounts(context, accounts);
    return altAccount;
  });
}

/**
 * 把 `email#oauth` 形式的内部 key 还原为原始邮箱（用于注入到 Windsurf 等场景）。
 */
export function stripEmailEntrySuffix(email: string): string {
  const i = email.indexOf('#');
  return i > 0 ? email.slice(0, i) : email;
}

/**
 * 删除账号
 */
export async function removeAccount(context: vscode.ExtensionContext, email: string): Promise<boolean> {
  return enqueueWrite(async () => {
    invalidateAccountsCache();
    const accounts = await readAccounts(context);
    const filtered = accounts.filter(a => a.email !== email);
    if (filtered.length === accounts.length) return false;
    await saveAccounts(context, filtered);
    await deleteAccountSecrets(context, email);
    return true;
  });
}

/**
 * 批量删除账号
 */
export async function batchRemove(context: vscode.ExtensionContext, emails: string[]): Promise<number> {
  return enqueueWrite(async () => {
    invalidateAccountsCache();
    const accounts = await readAccounts(context);
    const emailSet = new Set(emails);
    const filtered = accounts.filter(a => !emailSet.has(a.email));
    const removed = accounts.length - filtered.length;
    if (removed > 0) {
      await saveAccounts(context, filtered);
      await Promise.all([...emailSet].map(email => deleteAccountSecrets(context, email)));
    }
    return removed;
  });
}

/**
 * 更新账号标签（单标签，向后兼容）
 */
export async function updateTag(context: vscode.ExtensionContext, email: string, tag: string): Promise<void> {
  const tags = tag ? [tag] : [];
  return updateTags(context, email, tags);
}

/**
 * 更新账号标签（多标签）
 */
export async function updateTags(context: vscode.ExtensionContext, email: string, tags: string[]): Promise<void> {
  return enqueueWrite(async () => {
    invalidateAccountsCache();
    const accounts = await readAccounts(context);
    const acct = accounts.find(a => a.email === email);
    if (acct) {
      acct.tags = tags.length > 0 ? tags : undefined;
      acct.tag = tags[0] || undefined;
      await saveAccounts(context, accounts);
    }
  });
}

/**
 * 切换账号启用/禁用状态
 */
export async function toggleDisabled(context: vscode.ExtensionContext, email: string): Promise<void> {
  return enqueueWrite(async () => {
    invalidateAccountsCache();
    const accounts = await readAccounts(context);
    const acct = accounts.find(a => a.email === email);
    if (acct) {
      acct.disabled = !acct.disabled;
      if (!acct.disabled) delete (acct as any).disabled;
      await saveAccounts(context, accounts);
    }
  });
}

/**
 * 批量设置启用/禁用
 */
export async function batchSetDisabled(context: vscode.ExtensionContext, emails: string[], disabled: boolean): Promise<number> {
  return enqueueWrite(async () => {
    invalidateAccountsCache();
    const accounts = await readAccounts(context);
    let count = 0;
    const emailSet = new Set(emails);
    for (const acct of accounts) {
      if (emailSet.has(acct.email)) {
        if (disabled) {
          acct.disabled = true;
        } else {
          delete (acct as any).disabled;
        }
        count++;
      }
    }
    if (count > 0) await saveAccounts(context, accounts);
    return count;
  });
}

/**
 * 批量更新标签（单标签，向后兼容）
 */
export async function batchUpdateTag(context: vscode.ExtensionContext, emails: string[], tag: string): Promise<number> {
  const tags = tag ? [tag] : [];
  return batchUpdateTags(context, emails, tags);
}

/**
 * 批量更新标签（多标签）
 */
export async function batchUpdateTags(context: vscode.ExtensionContext, emails: string[], tags: string[]): Promise<number> {
  return enqueueWrite(async () => {
    invalidateAccountsCache();
    const accounts = await readAccounts(context);
    let count = 0;
    const emailSet = new Set(emails);
    for (const acct of accounts) {
      if (emailSet.has(acct.email)) {
        acct.tags = tags.length > 0 ? tags : undefined;
        acct.tag = tags[0] || undefined;
        count++;
      }
    }
    if (count > 0) await saveAccounts(context, accounts);
    return count;
  });
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
