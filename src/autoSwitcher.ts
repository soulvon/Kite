import * as vscode from 'vscode';
import * as accountStore from './accountStore';
import { fetchUsage } from './usageService';
import { StoredAccount, UsageSnapshot } from './types';

// ─── 类型 ───────────────────────────────────────────────

export interface UsageCacheEntry {
  snapshot: UsageSnapshot | null;
  error?: string;
  ts: number;
  skipUntil?: number;
}

export type ScoreMode = 'min' | 'daily' | 'weekly';

export interface AutoSwitchSettings {
  enabled: boolean;
  threshold: number;
  checkSec: number;
  cooldownSec: number;
  refreshMin: number;
  scoreMode: ScoreMode;
}

type UsageUpdateCb = (email: string, snapshot: UsageSnapshot | null, error?: string) => void;
type SwitchEventCb = (log: string, status: string, statusType: string) => void;
type RefreshUICb = () => void;

// ─── 默认值 ─────────────────────────────────────────────

const DEFAULTS: AutoSwitchSettings = {
  enabled: true,
  threshold: 10,
  checkSec: 60,
  cooldownSec: 30,
  scoreMode: 'min' as ScoreMode,
  refreshMin: 5,
};

const THROTTLE_MS = 800;
const CURRENT_TTL_MS = 60_000;
const ANTI_BOUNCE_MS = 5 * 60_000;

// ─── AutoSwitcher ───────────────────────────────────────

export class AutoSwitcher implements vscode.Disposable {
  private _ctx: vscode.ExtensionContext;
  private _cache = new Map<string, UsageCacheEntry>();
  private _refreshTimer: NodeJS.Timeout | null = null;
  private _checkTimer: NodeJS.Timeout | null = null;
  private _refreshing = false;
  private _cooldownUntil = 0;
  private _lastSwitchedFrom = '';
  private _lastSwitchedAt = 0;

  private _onUsageUpdate: UsageUpdateCb | null = null;
  private _onSwitchEvent: SwitchEventCb | null = null;
  private _onRefreshUI: RefreshUICb | null = null;

  constructor(ctx: vscode.ExtensionContext) {
    this._ctx = ctx;
  }

  // ── 设置 ──

  get settings(): AutoSwitchSettings {
    return {
      enabled: this._ctx.globalState.get('as.enabled', DEFAULTS.enabled),
      threshold: this._ctx.globalState.get('as.threshold', DEFAULTS.threshold),
      checkSec: this._ctx.globalState.get('as.checkSec', DEFAULTS.checkSec),
      cooldownSec: this._ctx.globalState.get('as.cooldownSec', DEFAULTS.cooldownSec),
      refreshMin: this._ctx.globalState.get('as.refreshMin', DEFAULTS.refreshMin),
      scoreMode: this._ctx.globalState.get('as.scoreMode', DEFAULTS.scoreMode) as ScoreMode,
    };
  }

  async updateSettings(p: Partial<AutoSwitchSettings>): Promise<void> {
    if (p.enabled !== undefined) await this._ctx.globalState.update('as.enabled', p.enabled);
    if (p.threshold !== undefined) await this._ctx.globalState.update('as.threshold', p.threshold);
    if (p.checkSec !== undefined) await this._ctx.globalState.update('as.checkSec', p.checkSec);
    if (p.cooldownSec !== undefined) await this._ctx.globalState.update('as.cooldownSec', p.cooldownSec);
    if (p.refreshMin !== undefined) await this._ctx.globalState.update('as.refreshMin', p.refreshMin);
    if (p.scoreMode !== undefined) await this._ctx.globalState.update('as.scoreMode', p.scoreMode);
    this._restartTimers();
  }

  // ── 回调 ──

  set onUsageUpdate(cb: UsageUpdateCb | null) { this._onUsageUpdate = cb; }
  set onSwitchEvent(cb: SwitchEventCb | null) { this._onSwitchEvent = cb; }
  set onRefreshUI(cb: RefreshUICb | null) { this._onRefreshUI = cb; }

  // ── 生命周期 ──

  start(): void {
    this._restartTimers();
    setTimeout(() => this.refreshAll(), 3000);
  }

  dispose(): void {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    if (this._checkTimer) { clearInterval(this._checkTimer); this._checkTimer = null; }
  }

  // ── 缓存访问 ──

  getCached(email: string): UsageCacheEntry | undefined { return this._cache.get(email); }

  getAllCached(): Map<string, UsageCacheEntry> { return this._cache; }

  // ── 刷新 ──

  async refreshAll(force = false): Promise<void> {
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      const accounts = await accountStore.readAccounts(this._ctx);
      for (const acct of accounts) {
        if (!force && this._shouldSkip(acct.email)) continue;
        await this._refreshOne(acct);
        await sleep(THROTTLE_MS);
      }
      // 全量刷新完成后检查自动切号
      this._checkAndSwitch();
    } finally {
      this._refreshing = false;
    }
  }

  async refreshSingle(email: string, force = false): Promise<void> {
    const accounts = await accountStore.readAccounts(this._ctx);
    const acct = accounts.find(a => a.email === email);
    if (acct) await this._refreshOne(acct, force);
  }

  // ── 内部：定时器 ──

  private _restartTimers(): void {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    if (this._checkTimer) { clearInterval(this._checkTimer); this._checkTimer = null; }

    const s = this.settings;
    // 全量刷新定时器（始终运行）
    this._refreshTimer = setInterval(() => this.refreshAll(), s.refreshMin * 60_000);
    // 自动切号检查（仅启用时）
    if (s.enabled) {
      this._checkTimer = setInterval(() => this._checkAndSwitch(), s.checkSec * 1000);
    }
  }

  // ── 内部：单账号刷新 ──

  private async _refreshOne(acct: StoredAccount, force = false): Promise<void> {
    if (!force && this._shouldSkip(acct.email)) return;

    const { snapshot, error } = await fetchUsage(acct);
    const entry: UsageCacheEntry = { snapshot, error, ts: Date.now() };

    // 智能跳过：额度耗尽时设置 skipUntil 为重置时间
    if (snapshot) {
      const d = snapshot.dailyRemainingPercent;
      const w = snapshot.weeklyRemainingPercent;
      if (d <= 0 && w <= 0) {
        const reset = Math.min(
          snapshot.dailyResetAtUnix || Infinity,
          snapshot.weeklyResetAtUnix || Infinity
        );
        if (reset !== Infinity) entry.skipUntil = reset * 1000;
      } else if (d <= 0 && snapshot.dailyResetAtUnix) {
        entry.skipUntil = snapshot.dailyResetAtUnix * 1000;
      } else if (w <= 0 && snapshot.weeklyResetAtUnix) {
        entry.skipUntil = snapshot.weeklyResetAtUnix * 1000;
      }
    }

    this._cache.set(acct.email, entry);
    this._onUsageUpdate?.(acct.email, snapshot, error);
  }

  // ── 内部：跳过判断 ──

  private _shouldSkip(email: string): boolean {
    const e = this._cache.get(email);
    if (!e) return false;
    // 额度耗尽且未到重置时间
    if (e.skipUntil && Date.now() < e.skipUntil) return true;
    // TTL 内不重复查
    const s = this.settings;
    const ttl = s.refreshMin * 60_000;
    if (Date.now() - e.ts < ttl) return true;
    return false;
  }

  // ── 内部：自动切号 ──

  private async _checkAndSwitch(): Promise<void> {
    const s = this.settings;
    if (!s.enabled) return;
    if (Date.now() < this._cooldownUntil) return;

    const curEmail = this._ctx.globalState.get<string>('lastEmail');
    if (!curEmail) return;

    // 当前号缓存过期则先刷新
    const curEntry = this._cache.get(curEmail);
    if (!curEntry || Date.now() - curEntry.ts > CURRENT_TTL_MS) {
      await this.refreshSingle(curEmail, true);
    }

    const snap = this._cache.get(curEmail)?.snapshot;
    if (!snap) return;

    const dPct = clamp(snap.dailyRemainingPercent);
    const wPct = clamp(snap.weeklyRemainingPercent);
    const curScore = calcScore(dPct, wPct, s.scoreMode);

    if (curScore > s.threshold) {
      this._onSwitchEvent?.('', '', '');
      return;
    }

    // 确定瓶颈原因
    let reason: string;
    if (dPct <= s.threshold && wPct <= s.threshold) {
      reason = `日 ${Math.round(dPct)}% / 周 ${Math.round(wPct)}%`;
    } else if (s.scoreMode === 'daily' || dPct <= s.threshold) {
      reason = `日配额 ${Math.round(dPct)}%`;
    } else {
      reason = `周配额 ${Math.round(wPct)}%`;
    }

    // 寻找最佳候选
    const cand = this._findBest(curEmail, s.threshold, s.scoreMode);
    if (!cand) {
      const log = `[${ts()}] ${curEmail} ${reason} 低于阈值，无可用候选`;
      this._onSwitchEvent?.(log, `${curEmail} ${reason} 低于阈值，无可用候选`, 'warn');
      return;
    }

    // 执行切换
    this._cooldownUntil = Date.now() + s.cooldownSec * 1000;
    this._lastSwitchedFrom = curEmail;
    this._lastSwitchedAt = Date.now();

    const log = `[${ts()}] ${curEmail} ${reason} → ${cand.email}`;
    this._onSwitchEvent?.(log, `${reason} 低于 ${s.threshold}%，切换至 ${cand.email}`, '');

    try {
      const accounts = await accountStore.readAccounts(this._ctx);
      const acct = accounts.find(a => a.email === cand.email);
      if (!acct) return;
      const { injectSession } = await import('./sessionInjector');
      const ok = await injectSession(this._ctx, acct);
      if (ok) {
        await accountStore.setCurrentAccount(this._ctx, cand.email);
        this._onRefreshUI?.();
      }
    } catch { /* ignore */ }
  }

  private _findBest(curEmail: string, threshold: number, mode: ScoreMode): { email: string; score: number } | null {
    let best: { email: string; score: number } | null = null;
    for (const [email, entry] of this._cache.entries()) {
      if (email === curEmail) continue;
      // 防止来回切：5 分钟内不回切到刚离开的号
      if (email === this._lastSwitchedFrom && Date.now() - this._lastSwitchedAt < ANTI_BOUNCE_MS) continue;
      if (!entry.snapshot) continue;
      const score = calcScore(clamp(entry.snapshot.dailyRemainingPercent), clamp(entry.snapshot.weeklyRemainingPercent), mode);
      if (score > threshold && (!best || score > best.score)) {
        best = { email, score };
      }
    }
    return best;
  }
}

// ── 工具 ──

function clamp(v: number): number { return Math.max(0, Math.min(100, v)); }
function calcScore(dPct: number, wPct: number, mode: ScoreMode): number {
  if (mode === 'daily') return dPct;
  if (mode === 'weekly') return wPct;
  return Math.min(dPct, wPct);
}
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function ts(): string { return new Date().toLocaleTimeString(); }
