import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StoredAccount } from './types';
import { getStateDbPath } from './ideDetector';
import { getPoolRoot } from './utils';

const LEGACY_EXTENSION_ID = 'local.windsurf-pool';
const STALE_KITE_EXTENSION_ID = 'local.kite';
const RECOVERY_EXTENSION_IDS = [STALE_KITE_EXTENSION_ID, LEGACY_EXTENSION_ID];
const LEGACY_ACCOUNTS_KEY = 'windsurfPool.accounts.v1';
const LEGACY_SECRET_PREFIX = 'windsurfPool.accountSecret.v1.';
const KITE_ACCOUNTS_KEY = 'windsurfPool.accounts.v1';
const KITE_SECRET_PREFIX = 'windsurfPool.accountSecret.v1.';

let _legacyRecoveryAttempted = false;
let _legacyRecoveryLog: string[] = [];

export function getLegacyRecoveryLog(): string[] {
  return _legacyRecoveryLog;
}

function log(msg: string): void {
  const line = `[legacy-migration] ${msg}`;
  _legacyRecoveryLog.push(line);
  console.log(line);
}

/**
 * 从 state.vscdb 中读取指定 key 的原始值（可能是加密字符串或二进制）。
 * 使用 VS Code 内置的 @vscode/sqlite3 模块。
 */
export function readVscdbKey(dbPath: string, key: string): string | null {
  if (!fs.existsSync(dbPath)) {
    log(`state.vscdb 不存在: ${dbPath}`);
    return null;
  }
  const sqlitePath = path.join(vscode.env.appRoot, 'node_modules/@vscode/sqlite3');
  let result: string | null = null;
  try {
    const sqlite = require(sqlitePath);
    const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY);
    try {
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
      result = row ? row.value : null;
    } finally {
      db.close();
    }
  } catch (err) {
    log(`读取 state.vscdb 失败: ${err}`);
  }
  return result;
}

/**
 * 尝试用 Windows DPAPI 解密一段 base64 编码的加密数据。
 * 返回解密后的 UTF-8 字符串，失败返回 null。
 */
export function tryDpapiDecrypt(base64Cipher: string): string | null {
  if (process.platform !== 'win32') {
    return null;
  }
  if (!base64Cipher || base64Cipher.length < 8) {
    return null;
  }
  try {
    const { execSync } = require('child_process');
    const ps = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.Security',
      `$b = [Convert]::FromBase64String('${base64Cipher.replace(/'/g, "''")}')`,
      '$d = [System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '[Console]::Write([Text.Encoding]::UTF8.GetString($d))'
    ].join('; ');
    const out = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\"')}"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return out;
  } catch (err) {
    log(`DPAPI 解密失败: ${err}`);
    return null;
  }
}

/**
 * VS Code secrets 在 SQLite 中可能以二进制 BLOB 或 TEXT 存储。
 * 如果是 Buffer，转成 base64 再尝试 DPAPI 解密。
 * 如果是字符串，直接尝试 DPAPI 解密。
 */
function tryDecryptValue(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  let base64 = '';
  if (Buffer.isBuffer(raw)) {
    base64 = raw.toString('base64');
  } else if (typeof raw === 'string') {
    // 有些值直接是 base64 字符串；有些可能是二进制字符串
    base64 = raw;
    // 如果长度不是 4 的倍数或包含非 base64 字符，说明是二进制字符串，需要重新编码
    const base64Re = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Re.test(base64) || base64.length % 4 !== 0) {
      base64 = Buffer.from(raw, 'binary').toString('base64');
    }
  } else {
    return null;
  }
  return tryDpapiDecrypt(base64);
}

function encodeAccountSecretKey(email: string, field: string): string {
  return `${LEGACY_SECRET_PREFIX}${encodeURIComponent(email)}.${field}`;
}

function kiteSecretKey(email: string, field: string): string {
  return `${KITE_SECRET_PREFIX}${encodeURIComponent(email)}.${field}`;
}

function secretDbKeys(extensionId: string, key: string): string[] {
  return [
    `secret://${JSON.stringify({ extensionId, key })}`,
    `secret://${extensionId}/${key}`,
  ];
}

function readFirstSecretValue(dbPath: string, extensionId: string, key: string): any | null {
  for (const candidate of secretDbKeys(extensionId, key)) {
    const raw = readVscdbKey(dbPath, candidate);
    if (raw) {
      return raw;
    }
  }
  return null;
}

/**
 * 尝试从旧扩展/短暂改名扩展的 secrets 中恢复账号凭据。
 * 仅当当前账号列表中存在 apiKey 为空的账号时才执行。
 * 仅在 Windows 上有效（依赖 DPAPI）。
 */
export async function tryRecoverLegacyAccounts(
  context: vscode.ExtensionContext,
  accounts: StoredAccount[]
): Promise<{ accounts: StoredAccount[]; recovered: boolean }> {
  if (_legacyRecoveryAttempted) {
    return { accounts, recovered: false };
  }
  _legacyRecoveryAttempted = true;

  const missing = accounts.filter(a => !a.apiKey);
  if (missing.length === 0) {
    log('当前账号列表中无 apiKey 为空，无需恢复');
    return { accounts, recovered: false };
  }
  log(`检测到 ${missing.length} 个账号缺少 apiKey，尝试从扩展 ${RECOVERY_EXTENSION_IDS.join(', ')} 恢复`);

  const dbPath = getStateDbPath();
  const recoveredSecrets: Map<string, Map<string, string>> = new Map();
  let anyRecovered = false;

  // 1. 尝试读取历史 ACCOUNTS_KEY 备份（可能包含明文账号列表）
  for (const extensionId of RECOVERY_EXTENSION_IDS) {
    const accountsRaw = readFirstSecretValue(dbPath, extensionId, LEGACY_ACCOUNTS_KEY);
    if (accountsRaw) {
      log(`找到 ${extensionId} ACCOUNTS_KEY 加密记录`);
      const decrypted = tryDecryptValue(accountsRaw);
      if (decrypted) {
        try {
          const arr = JSON.parse(decrypted);
          if (Array.isArray(arr)) {
            for (const a of arr) {
              if (a && a.email && a.apiKey) {
                const map = recoveredSecrets.get(a.email) || new Map();
                map.set('apiKey', a.apiKey);
                recoveredSecrets.set(a.email, map);
                anyRecovered = true;
              }
            }
            log(`从 ${extensionId} ACCOUNTS_KEY 恢复 ${recoveredSecrets.size} 个账号`);
          }
        } catch (err) {
          log(`解析 ${extensionId} ACCOUNTS_KEY 失败: ${err}`);
        }
      } else {
        log(`${extensionId} ACCOUNTS_KEY 解密失败（可能不是 DPAPI 或数据格式不同）`);
      }
    } else {
      log(`未找到 ${extensionId} ACCOUNTS_KEY 记录`);
    }
  }

  // 2. 逐个尝试读取历史 accountSecret 记录
  for (const m of missing) {
    const fields = ['apiKey', 'devinAuth1Token', 'password', 'rawToken'] as const;
    for (const field of fields) {
      if (recoveredSecrets.get(m.email)?.has(field)) continue;
      for (const extensionId of RECOVERY_EXTENSION_IDS) {
        const raw = readFirstSecretValue(dbPath, extensionId, encodeAccountSecretKey(m.email, field));
        if (!raw) continue;
        const decrypted = tryDecryptValue(raw);
        if (decrypted) {
          const map = recoveredSecrets.get(m.email) || new Map();
          map.set(field, decrypted);
          recoveredSecrets.set(m.email, map);
          anyRecovered = true;
          log(`从 ${extensionId} 恢复 ${m.email} 的 ${field}`);
          break;
        }
      }
    }
  }

  if (!anyRecovered) {
    log('未能从旧扩展恢复任何凭据');
    return { accounts, recovered: false };
  }

  // 3. 把恢复的凭据合并到当前账号，并写入 Kite 的 secrets
  const updated = accounts.map(a => {
    const secrets = recoveredSecrets.get(a.email);
    if (!secrets) return a;
    const clone: StoredAccount = { ...a };
    if (secrets.has('apiKey')) clone.apiKey = secrets.get('apiKey')!;
    if (secrets.has('devinAuth1Token')) clone.devinAuth1Token = secrets.get('devinAuth1Token')!;
    if (secrets.has('password') || secrets.has('rawToken')) {
      clone.importMeta = { ...(clone.importMeta || {}) };
      if (secrets.has('password')) clone.importMeta.password = secrets.get('password')!;
      if (secrets.has('rawToken')) clone.importMeta.rawToken = secrets.get('rawToken')!;
    }
    return clone;
  });

  // 4. 写入 Kite 的 secrets
  for (const a of updated) {
    const secrets = recoveredSecrets.get(a.email);
    if (!secrets) continue;
    for (const [field, value] of secrets) {
      await context.secrets.store(kiteSecretKey(a.email, field), value);
    }
  }

  // 5. 同时备份一份非敏感索引（兼容旧版本）
  const safeAccounts = updated.map(a => {
    const s = { ...a };
    s.apiKey = '';
    delete s.devinAuth1Token;
    if (s.importMeta) {
      delete s.importMeta.password;
      delete s.importMeta.rawToken;
      if (Object.keys(s.importMeta).length === 0) delete (s as any).importMeta;
    }
    return s;
  });
  await context.secrets.store(KITE_ACCOUNTS_KEY, JSON.stringify(safeAccounts));

  log(`完成恢复：${recoveredSecrets.size} 个账号，已写入 Kite secrets`);
  return { accounts: updated, recovered: true };
}

/**
 * 尝试读取旧扩展安装在磁盘上的 accounts.json 文件。
 * 新旧扩展共享同一个 getPoolRoot() 路径，所以通常已经读取过。
 * 这里仅作为兜底：如果旧扩展在另一个配置目录（理论上没有）。
 */
export function tryReadLegacyAccountsFile(): StoredAccount[] {
  try {
    const legacyPath = path.join(getPoolRoot(), 'accounts.json');
    if (!fs.existsSync(legacyPath)) return [];
    const raw = fs.readFileSync(legacyPath, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((a: any) => a && typeof a.email === 'string' && typeof a.apiKey === 'string');
  } catch (err) {
    log(`读取旧 accounts.json 失败: ${err}`);
    return [];
  }
}

/**
 * 重置恢复尝试标记（用于测试或手动重试）。
 */
export function resetLegacyRecoveryAttempt(): void {
  _legacyRecoveryAttempted = false;
  _legacyRecoveryLog = [];
}

// ── globalState 迁移 ──────────────────────────────────────────

let _globalStateMigrated = false;

/**
 * 从 state.vscdb 读取所有以指定前缀开头的 key-value 对。
 */
function readVscdbByPrefix(dbPath: string, keyPrefix: string): Map<string, any> {
  const result = new Map<string, any>();
  if (!fs.existsSync(dbPath)) return result;
  const sqlitePath = path.join(vscode.env.appRoot, 'node_modules/@vscode/sqlite3');
  try {
    const sqlite = require(sqlitePath);
    const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY);
    try {
      const rows = db.prepare('SELECT key, value FROM ItemTable WHERE key LIKE ?').all(`${keyPrefix}%`);
      for (const row of rows) {
        result.set(row.key, row.value);
      }
    } finally {
      db.close();
    }
  } catch (err) {
    log(`readVscdbByPrefix 失败: ${err}`);
  }
  return result;
}

/**
 * 从 state.vscdb 读取单个 key 的值。
 */
function readVscdbSingleKey(dbPath: string, key: string): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const sqlitePath = path.join(vscode.env.appRoot, 'node_modules/@vscode/sqlite3');
  try {
    const sqlite = require(sqlitePath);
    const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY);
    try {
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
      return row ? row.value : null;
    } finally {
      db.close();
    }
  } catch (err) {
    log(`readVscdbSingleKey 失败: ${err}`);
    return null;
  }
}

/**
 * 尝试从旧扩展迁移 globalState 数据。
 * VS Code globalState 按扩展 ID 隔离，改扩展名后所有设置丢失。
 *
 * 同步函数：globalState.update() 的 in-memory 缓存同步更新，
 * Thenable 仅用于磁盘持久化。不 await 以确保 activate() 中同步完成。
 *
 * 搜索策略（按优先级）：
 * 1. globalState/<extensionId>/<key> — 前缀格式
 * 2. <extensionId>/<key> — 简化前缀
 * 3. globalState.<extensionId> — 单个 JSON blob
 * 4. 任意包含 <extensionId> 的 key — 兜底搜索
 */
export function tryMigrateLegacyGlobalState(context: vscode.ExtensionContext): boolean {
  if (_globalStateMigrated) return false;
  _globalStateMigrated = true;

  // 检查是否已有数据（如果新扩展已有 lastEmail 说明之前已迁移过）
  const hasExisting = context.globalState.get<string>('lastEmail');
  if (hasExisting) {
    log('globalState 已有 lastEmail，跳过迁移');
    return false;
  }

  const dbPath = getStateDbPath();

  // 策略 1: globalState/<extensionId>/<key>
  const prefix1 = `globalState/${LEGACY_EXTENSION_ID}/`;
  let entries = readVscdbByPrefix(dbPath, prefix1);
  let prefixUsed = prefix1;

  // 策略 2: <extensionId>/<key>
  if (entries.size === 0) {
    const prefix2 = `${LEGACY_EXTENSION_ID}/`;
    entries = readVscdbByPrefix(dbPath, prefix2);
    prefixUsed = prefix2;
  }

  // 策略 3: globalState.<extensionId> 单个 JSON blob
  if (entries.size === 0) {
    const blobKey = `globalState.${LEGACY_EXTENSION_ID}`;
    const blob = readVscdbSingleKey(dbPath, blobKey);
    if (blob) {
      log(`找到 globalState JSON blob (key=${blobKey})`);
      try {
        const obj = JSON.parse(blob);
        if (obj && typeof obj === 'object') {
          let migrated = 0;
          for (const [key, value] of Object.entries(obj)) {
            try {
              context.globalState.update(key, value);
              migrated++;
              log(`迁移 globalState (blob): ${key}`);
            } catch (err) {
              log(`迁移 globalState (blob) 失败: key=${key}, err=${err}`);
            }
          }
          if (migrated > 0) {
            log(`globalState 迁移完成（blob 格式），共 ${migrated} 项`);
            return true;
          }
        }
      } catch (err) {
        log(`解析 globalState blob 失败: ${err}`);
      }
    }
  }

  // 策略 4: 任意包含 <extensionId> 的 key（兜底）
  if (entries.size === 0) {
    const broadPrefix = `%${LEGACY_EXTENSION_ID}%`;
    // 使用 SQL LIKE 的中间匹配
    if (!fs.existsSync(dbPath)) {
      log('state.vscdb 不存在，globalState 迁移终止');
      return false;
    }
    const sqlitePath = path.join(vscode.env.appRoot, 'node_modules/@vscode/sqlite3');
    try {
      const sqlite = require(sqlitePath);
      const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY);
      try {
        const rows = db.prepare('SELECT key, value FROM ItemTable WHERE key LIKE ?').all(broadPrefix);
        for (const row of rows) {
          entries.set(row.key, row.value);
        }
        log(`策略4 兜底搜索: 找到 ${entries.size} 个匹配 key`);
      } finally {
        db.close();
      }
    } catch (err) {
      log(`策略4 兜底搜索失败: ${err}`);
    }

    if (entries.size === 0) {
      log('所有策略均未找到旧扩展 globalState 数据');
      return false;
    }

    // 对于兜底搜索结果，提取 key 中扩展 ID 后面的部分作为 shortKey
    let migrated = 0;
    for (const [fullKey, value] of entries) {
      // 尝试从 key 中提取扩展 ID 后的部分
      const idx = fullKey.indexOf(LEGACY_EXTENSION_ID);
      if (idx < 0) continue;
      const afterExt = fullKey.substring(idx + LEGACY_EXTENSION_ID.length);
      // 去掉开头的 / 或 .
      const shortKey = afterExt.replace(/^[/\.]/, '');
      if (!shortKey || shortKey.length === 0) continue;

      try {
        const parsed = JSON.parse(value);
        context.globalState.update(shortKey, parsed);
      } catch {
        context.globalState.update(shortKey, value);
      }
      migrated++;
      log(`迁移 globalState (broad): ${fullKey} → ${shortKey}`);
    }
    if (migrated > 0) {
      log(`globalState 迁移完成（兜底搜索），共 ${migrated} 项`);
      return true;
    }
    return false;
  }

  // 正常前缀格式处理
  let migrated = 0;
  for (const [fullKey, value] of entries) {
    const shortKey = fullKey.substring(prefixUsed.length);
    try {
      const parsed = JSON.parse(value);
      context.globalState.update(shortKey, parsed);
    } catch {
      context.globalState.update(shortKey, value);
    }
    migrated++;
    log(`迁移 globalState: ${shortKey}`);
  }
  log(`globalState 迁移完成（prefix=${prefixUsed}），共 ${migrated} 项`);
  return true;
}

// ── globalStorageUri 文件迁移 ──────────────────────────────────

let _storageFilesMigrated = false;

/**
 * 尝试从旧扩展的 globalStorage 目录迁移文件到新扩展。
 * globalStorageUri 路径为 .../User/globalStorage/<extensionId>/
 * 改扩展名后路径变化，磁盘缓存和日志文件找不到。
 */
export function tryMigrateLegacyStorageFiles(context: vscode.ExtensionContext): boolean {
  if (_storageFilesMigrated) return false;
  _storageFilesMigrated = true;

  const newDir = context.globalStorageUri.fsPath;
  // 旧路径：把 newDir 中的 local.kite 替换为 local.windsurf-pool
  const oldDir = newDir.replace('local.kite', LEGACY_EXTENSION_ID);

  // 安全检查：如果替换后路径没变，说明路径中不含 local.kite，无法定位旧目录
  if (oldDir === newDir) {
    log(`globalStorageUri 路径中未找到 local.kite，无法推导旧路径: ${newDir}`);
    return false;
  }

  if (!fs.existsSync(oldDir)) {
    log(`旧 globalStorage 目录不存在: ${oldDir}`);
    return false;
  }

  if (!fs.existsSync(newDir)) {
    fs.mkdirSync(newDir, { recursive: true });
  }

  let copied = 0;
  function copyRecursive(srcDir: string, dstDir: string): void {
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    const items = fs.readdirSync(srcDir);
    for (const item of items) {
      const src = path.join(srcDir, item);
      const dst = path.join(dstDir, item);
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        copyRecursive(src, dst);
      } else if (stat.isFile()) {
        if (fs.existsSync(dst)) {
          log(`跳过已存在的文件: ${path.relative(oldDir, src)}`);
          continue;
        }
        fs.copyFileSync(src, dst);
        copied++;
        log(`迁移文件: ${path.relative(oldDir, src)}`);
      }
    }
  }
  try {
    copyRecursive(oldDir, newDir);
  } catch (err) {
    log(`迁移 globalStorage 文件失败: ${err}`);
    return false;
  }

  log(`globalStorage 文件迁移完成，共复制 ${copied} 个文件`);
  return true;
}
