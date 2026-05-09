import * as vscode from 'vscode';

/**
 * 用量统计追踪器
 *
 * 追踪每个账号和全局的用量数据，持久化到 globalState。
 * - 切号次数（手动 + 自动）
 * - Bridge 请求信号次数（pool-signal，代表实际 AI 请求触发）
 * - 配额刷新次数
 * - 每账号已用配额百分比
 * - 每日自动重置
 */

export interface AccountStats {
  switchToCount: number;
  dailyUsedPct: number;
  weeklyUsedPct: number;
  lastCheckTs: number;
}

export interface PoolStats {
  totalSwitches: number;
  totalPoolSignals: number;
  totalRefreshes: number;
  sessionStartTs: number;
  lastResetDate: string;
  accounts: Record<string, AccountStats>;
}

const STORAGE_KEY = 'usageTracker.stats';

export class UsageTracker {
  private _ctx: vscode.ExtensionContext;
  private _stats: PoolStats;
  private _dirty = false;
  private _saveTimer: NodeJS.Timeout | null = null;

  constructor(ctx: vscode.ExtensionContext) {
    this._ctx = ctx;
    this._stats = this._load();
    this._maybeResetDaily();
  }

  private _load(): PoolStats {
    const saved = this._ctx.globalState.get<PoolStats>(STORAGE_KEY);
    if (saved && saved.lastResetDate) return saved;
    return this._empty();
  }

  private _empty(): PoolStats {
    return {
      totalSwitches: 0,
      totalPoolSignals: 0,
      totalRefreshes: 0,
      sessionStartTs: Date.now(),
      lastResetDate: todayStr(),
      accounts: {},
    };
  }

  private _debounceSave(): void {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this._dirty) {
        this._dirty = false;
        this._ctx.globalState.update(STORAGE_KEY, this._stats);
      }
    }, 2000);
  }

  private _maybeResetDaily(): void {
    const today = todayStr();
    if (this._stats.lastResetDate !== today) {
      // 保留 sessionStartTs，重置计数
      this._stats.totalSwitches = 0;
      this._stats.totalPoolSignals = 0;
      this._stats.totalRefreshes = 0;
      this._stats.accounts = {};
      this._stats.lastResetDate = today;
      this._debounceSave();
    }
  }

  // ── 记录事件 ──

  recordSwitch(email: string): void {
    this._maybeResetDaily();
    this._stats.totalSwitches++;
    this._ensureAccount(email).switchToCount++;
    this._debounceSave();
  }

  recordPoolSignal(): void {
    this._maybeResetDaily();
    this._stats.totalPoolSignals++;
    this._debounceSave();
  }

  recordRefresh(): void {
    this._maybeResetDaily();
    this._stats.totalRefreshes++;
    this._debounceSave();
  }

  recordUsage(email: string, dailyRemaining: number, weeklyRemaining: number): void {
    this._maybeResetDaily();
    const acct = this._ensureAccount(email);
    acct.dailyUsedPct = Math.max(0, 100 - dailyRemaining);
    acct.weeklyUsedPct = Math.max(0, 100 - weeklyRemaining);
    acct.lastCheckTs = Date.now();
    this._debounceSave();
  }

  // ── 读取 ──

  getStats(): PoolStats {
    this._maybeResetDaily();
    return JSON.parse(JSON.stringify(this._stats));
  }

  /** 获取适合推送到 webview 的摘要 */
  getSummary(): StatsSummary {
    this._maybeResetDaily();
    const s = this._stats;
    let totalDailyUsed = 0;
    let totalWeeklyUsed = 0;
    let accountCount = 0;

    for (const acct of Object.values(s.accounts)) {
      if (acct.lastCheckTs > 0) {
        totalDailyUsed += acct.dailyUsedPct;
        totalWeeklyUsed += acct.weeklyUsedPct;
        accountCount++;
      }
    }

    return {
      totalSwitches: s.totalSwitches,
      totalPoolSignals: s.totalPoolSignals,
      totalRefreshes: s.totalRefreshes,
      avgDailyUsedPct: accountCount > 0 ? Math.round(totalDailyUsed / accountCount) : 0,
      avgWeeklyUsedPct: accountCount > 0 ? Math.round(totalWeeklyUsed / accountCount) : 0,
      totalDailyUsed: Math.round(totalDailyUsed),
      totalWeeklyUsed: Math.round(totalWeeklyUsed),
      accountCount,
      sessionStartTs: s.sessionStartTs,
      date: s.lastResetDate,
      perAccount: s.accounts,
    };
  }

  // ── 内部 ──

  private _ensureAccount(email: string): AccountStats {
    if (!this._stats.accounts[email]) {
      this._stats.accounts[email] = {
        switchToCount: 0,
        dailyUsedPct: 0,
        weeklyUsedPct: 0,
        lastCheckTs: 0,
      };
    }
    return this._stats.accounts[email];
  }

  dispose(): void {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._dirty) {
      this._ctx.globalState.update(STORAGE_KEY, this._stats);
    }
  }
}

export interface StatsSummary {
  totalSwitches: number;
  totalPoolSignals: number;
  totalRefreshes: number;
  avgDailyUsedPct: number;
  avgWeeklyUsedPct: number;
  totalDailyUsed: number;
  totalWeeklyUsed: number;
  accountCount: number;
  sessionStartTs: number;
  date: string;
  perAccount: Record<string, AccountStats>;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
