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
  hasBalance?: boolean;  // 账号当前是否有付费余额（overageBalanceMicros > 0）
}

export interface QuotaHistoryEntry {
  ts: number;
  email: string;
  daily: number;       // dailyRemainingPercent
  weekly: number;      // weeklyRemainingPercent
  dDelta: number;      // daily change (negative = consumed)
  wDelta: number;      // weekly change
  resetAt: number;     // earlier reset unix timestamp
  balance?: number;    // overageBalanceMicros (付费余额，单位: 微美元)
  bDelta?: number;     // balance change (micros, negative = 消耗付费余额)
}

export type DiagnosticEventSource = 'switch' | 'health';
export type DiagnosticEventLevel = 'ok' | 'warn' | 'error';

export interface DiagnosticEvent {
  ts: number;
  email: string;
  source: DiagnosticEventSource;
  level: DiagnosticEventLevel;
  reason: string;
  model?: string;
  status?: number;
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
const HISTORY_KEY = 'usageTracker.quotaHistory';
const DIAGNOSTIC_KEY = 'usageTracker.diagnosticHistory';
const MAX_HISTORY = 500;
const MAX_DIAGNOSTIC_HISTORY = 1000;

export class UsageTracker {
  private _ctx: vscode.ExtensionContext;
  private _stats: PoolStats;
  private _dirty = false;
  private _saveTimer: NodeJS.Timeout | null = null;
  private _quotaHistory: QuotaHistoryEntry[] = [];
  private _lastQuotaMap: Map<string, { daily: number; weekly: number; balance?: number }> = new Map();
  private _historyDirty = false;
  private _historySaveTimer: NodeJS.Timeout | null = null;
  private _historyListeners = new Set<() => void>();
  private _diagnosticHistory: DiagnosticEvent[] = [];
  private _diagnosticDirty = false;
  private _diagnosticSaveTimer: NodeJS.Timeout | null = null;

  constructor(ctx: vscode.ExtensionContext) {
    this._ctx = ctx;
    this._stats = this._load();
    this._maybeResetDaily();
    this._quotaHistory = this._ctx.globalState.get<QuotaHistoryEntry[]>(HISTORY_KEY, []);
    this._diagnosticHistory = this._ctx.globalState.get<DiagnosticEvent[]>(DIAGNOSTIC_KEY, []);
    // 初始化 _lastQuotaMap（从历史末尾恢复每个账号的最后已知配额 + 余额）
    for (let i = this._quotaHistory.length - 1; i >= 0; i--) {
      const e = this._quotaHistory[i];
      if (!this._lastQuotaMap.has(e.email)) {
        this._lastQuotaMap.set(e.email, { daily: e.daily, weekly: e.weekly, balance: e.balance });
      }
    }
  }

  set onHistoryUpdate(cb: (() => void) | null) {
    // 兼容旧 API：侧栏用 setter
    if ((this as any)._legacyHistoryCb) this._historyListeners.delete((this as any)._legacyHistoryCb);
    (this as any)._legacyHistoryCb = cb;
    if (cb) this._historyListeners.add(cb);
  }

  addHistoryListener(cb: () => void): { dispose(): void } {
    this._historyListeners.add(cb);
    return { dispose: () => { this._historyListeners.delete(cb); } };
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
      // 同步清空快照映射，避免跨日 dDelta 基于昨天数据计算出错误的"重置"标记
      this._lastQuotaMap.clear();
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

  recordUsage(email: string, dailyRemaining: number, weeklyRemaining: number, dailyResetAt?: number, weeklyResetAt?: number, balance?: number): void {
    this._maybeResetDaily();
    const acct = this._ensureAccount(email);
    acct.dailyUsedPct = Math.max(0, 100 - dailyRemaining);
    acct.weeklyUsedPct = Math.max(0, 100 - weeklyRemaining);
    acct.lastCheckTs = Date.now();
    acct.hasBalance = (balance || 0) > 0;

    // 配额变动历史：仅在数值变化时记录（避免轮询产生大量重复条目）
    const daily = Math.round(dailyRemaining);
    const weekly = Math.round(weeklyRemaining);
    const last = this._lastQuotaMap.get(email);
    // 余额变化检测（兼容老条目没有 balance 字段：仅当上次与本次都存在 balance 才算变化）
    const balanceChanged = !!last
      && typeof last.balance === 'number'
      && typeof balance === 'number'
      && last.balance !== balance;
    if (!last || last.daily !== daily || last.weekly !== weekly || balanceChanged) {
      const dDelta = last ? daily - last.daily : 0;
      const wDelta = last ? weekly - last.weekly : 0;
      const bDelta = (last && typeof last.balance === 'number' && typeof balance === 'number')
        ? (balance - last.balance)
        : 0;
      const resetAt = Math.min(
        dailyResetAt || Infinity,
        weeklyResetAt || Infinity
      );
      this._quotaHistory.push({
        ts: Date.now(),
        email,
        daily,
        weekly,
        dDelta,
        wDelta,
        resetAt: resetAt === Infinity ? 0 : resetAt,
        balance,
        bDelta,
      });
      if (this._quotaHistory.length > MAX_HISTORY) {
        this._quotaHistory.splice(0, this._quotaHistory.length - MAX_HISTORY);
      }
      this._lastQuotaMap.set(email, { daily, weekly, balance });
      this._debounceHistorySave();
      for (const cb of this._historyListeners) { try { cb(); } catch {} }
    }

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
    let accountsWithBalance = 0;

    for (const acct of Object.values(s.accounts)) {
      if (acct.lastCheckTs > 0) {
        totalDailyUsed += acct.dailyUsedPct;
        totalWeeklyUsed += acct.weeklyUsedPct;
        accountCount++;
        if (acct.hasBalance) accountsWithBalance++;
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
      accountsWithBalance,
      sessionStartTs: s.sessionStartTs,
      date: s.lastResetDate,
      perAccount: s.accounts,
    };
  }

  // ── 配额历史 ──

  getQuotaHistory(email?: string, limit = 100): QuotaHistoryEntry[] {
    let result = this._quotaHistory;
    if (email) {
      result = result.filter(e => e.email === email);
    }
    return result.slice(-limit);
  }

  /** 清除配额历史（不传 email 则清除全部） */
  clearQuotaHistory(email?: string): void {
    if (email) {
      this._quotaHistory = this._quotaHistory.filter(e => e.email !== email);
      this._lastQuotaMap.delete(email);
    } else {
      this._quotaHistory = [];
      this._lastQuotaMap.clear();
    }
    this._ctx.globalState.update(HISTORY_KEY, this._quotaHistory);
    for (const cb of this._historyListeners) { try { cb(); } catch {} }
  }

  /** 获取历史中涉及的所有账号（去重） */
  getHistoryEmails(): string[] {
    const set = new Set<string>();
    for (const e of this._quotaHistory) set.add(e.email);
    return Array.from(set);
  }

  // ── 账号诊断历史 ──

  recordDiagnostic(event: DiagnosticEvent): void {
    if (!event.email) return;
    this._diagnosticHistory.push({
      ts: event.ts || Date.now(),
      email: event.email,
      source: event.source,
      level: event.level,
      reason: event.reason || '无详情',
      model: event.model,
      status: event.status,
    });
    if (this._diagnosticHistory.length > MAX_DIAGNOSTIC_HISTORY) {
      this._diagnosticHistory.splice(0, this._diagnosticHistory.length - MAX_DIAGNOSTIC_HISTORY);
    }
    this._debounceDiagnosticSave();
    for (const cb of this._historyListeners) { try { cb(); } catch {} }
  }

  getDiagnosticHistory(email?: string, limit = 300): DiagnosticEvent[] {
    let result = this._diagnosticHistory;
    if (email) {
      result = result.filter(e => e.email === email);
    }
    return result.slice(-limit);
  }

  getLatestDiagnosticsByAccount(): Record<string, { health?: DiagnosticEvent; switch?: DiagnosticEvent }> {
    const latest: Record<string, { health?: DiagnosticEvent; switch?: DiagnosticEvent }> = {};
    for (const e of this._diagnosticHistory) {
      const bucket = latest[e.email] || (latest[e.email] = {});
      if (e.source === 'health') bucket.health = e;
      if (e.source === 'switch') bucket.switch = e;
    }
    return latest;
  }

  private _debounceDiagnosticSave(): void {
    this._diagnosticDirty = true;
    if (this._diagnosticSaveTimer) return;
    this._diagnosticSaveTimer = setTimeout(() => {
      this._diagnosticSaveTimer = null;
      if (this._diagnosticDirty) {
        this._diagnosticDirty = false;
        this._ctx.globalState.update(DIAGNOSTIC_KEY, this._diagnosticHistory);
      }
    }, 3000);
  }

  private _debounceHistorySave(): void {
    this._historyDirty = true;
    if (this._historySaveTimer) return;
    this._historySaveTimer = setTimeout(() => {
      this._historySaveTimer = null;
      if (this._historyDirty) {
        this._historyDirty = false;
        this._ctx.globalState.update(HISTORY_KEY, this._quotaHistory);
      }
    }, 3000);
  }

  // ── 内部 ──

  private _ensureAccount(email: string): AccountStats {
    if (!this._stats.accounts[email]) {
      this._stats.accounts[email] = {
        switchToCount: 0,
        dailyUsedPct: 0,
        weeklyUsedPct: 0,
        lastCheckTs: 0,
        hasBalance: false,
      };
    }
    return this._stats.accounts[email];
  }

  // 记录正在进行的最后一次 flush，dispose 可能被调多次（subscriptions + deactivate），
  // 保留 promise 让所有调用方都能等到真正落盘完成
  private _disposePromise: Promise<void> | null = null;

  dispose(): Promise<void> {
    if (this._disposePromise) return this._disposePromise;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._historySaveTimer) { clearTimeout(this._historySaveTimer); this._historySaveTimer = null; }
    if (this._diagnosticSaveTimer) { clearTimeout(this._diagnosticSaveTimer); this._diagnosticSaveTimer = null; }
    const tasks: Thenable<void>[] = [];
    if (this._dirty) {
      this._dirty = false;
      tasks.push(this._ctx.globalState.update(STORAGE_KEY, this._stats));
    }
    if (this._historyDirty) {
      this._historyDirty = false;
      tasks.push(this._ctx.globalState.update(HISTORY_KEY, this._quotaHistory));
    }
    if (this._diagnosticDirty) {
      this._diagnosticDirty = false;
      tasks.push(this._ctx.globalState.update(DIAGNOSTIC_KEY, this._diagnosticHistory));
    }
    if (tasks.length === 0) {
      this._disposePromise = Promise.resolve();
    } else {
      this._disposePromise = Promise.all(tasks)
        .then(() => undefined)
        .catch(err => { console.warn('[usageTracker] dispose flush error:', err); });
    }
    return this._disposePromise;
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
  accountsWithBalance: number;  // 有付费余额的账号数（overageBalanceMicros > 0）
  sessionStartTs: number;
  date: string;
  perAccount: Record<string, AccountStats>;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
