import * as vscode from 'vscode';
import * as accountStore from './accountStore';
import { fetchUsage } from './usageService';
import { StoredAccount, UsageSnapshot } from './types';
import { getCurrentInstanceTag } from './instanceManager';

// ─── 类型 ───────────────────────────────────────────────

export interface UsageCacheEntry {
  snapshot: UsageSnapshot | null;
  error?: string;
  ts: number;
  skipUntil?: number;
}

export type ScoreMode = 'min' | 'daily' | 'weekly';
export type SwitchStrategy = 'lowestNonZero' | 'highestFirst';
export type PoolScope = 'all' | 'tag' | 'instance';

export interface AutoSwitchSettings {
  enabled: boolean;
  threshold: number;
  checkSec: number;
  cooldownSec: number;
  refreshMin: number;
  scoreMode: ScoreMode;
  switchStrategy: SwitchStrategy;
  minQuota: number;             // 低于此值视为“额度耗尽”，挑号时排除
  preferUsedThreshold: number;  // ≤此值视为“已经在用”，先消耗完它
  poolScope: PoolScope;         // 切号范围
  poolTag?: string;             // poolScope='tag' 时指定标签
}

type UsageUpdateCb = (email: string, snapshot: UsageSnapshot | null, error?: string) => void;
type SwitchEventCb = (log: string, status: string, statusType: string) => void;
type RefreshUICb = () => void;
type AutoSwitchDoneCb = (newEmail: string, reason: string) => void;

// ─── 默认值 ─────────────────────────────────────────────

const DEFAULTS: AutoSwitchSettings = {
  enabled: true,
  threshold: 10,
  checkSec: 60,
  cooldownSec: 30,
  scoreMode: 'min' as ScoreMode,
  refreshMin: 5,
  switchStrategy: 'highestFirst' as SwitchStrategy,
  minQuota: 10,
  preferUsedThreshold: 50,
  poolScope: 'all' as PoolScope,
  poolTag: undefined,
};

const THROTTLE_MS = 2000;
const ERROR_BACKOFF_MS = 5000;
const CURRENT_TTL_MS = 60_000;
const ANTI_BOUNCE_MS = 5 * 60_000;

// ─── AutoSwitcher ───────────────────────────────────────

export class AutoSwitcher implements vscode.Disposable {
  private _ctx: vscode.ExtensionContext;
  private _cache = new Map<string, UsageCacheEntry>();
  private _refreshTimer: NodeJS.Timeout | null = null;
  private _checkTimer: NodeJS.Timeout | null = null;
  private _refreshing = false;
  private _switching = false;
  private _cooldownUntil = 0;
  private _lastSwitchedFrom = '';
  private _lastSwitchedAt = 0;

  private _onUsageUpdate: UsageUpdateCb | null = null;
  private _onSwitchEvent: SwitchEventCb | null = null;
  private _onRefreshUI: RefreshUICb | null = null;
  private _onAutoSwitchDone: AutoSwitchDoneCb | null = null;

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
      switchStrategy: this._ctx.globalState.get('as.switchStrategy', DEFAULTS.switchStrategy) as SwitchStrategy,
      minQuota: this._ctx.globalState.get('as.minQuota', DEFAULTS.minQuota),
      preferUsedThreshold: this._ctx.globalState.get('as.preferUsedThreshold', DEFAULTS.preferUsedThreshold),
      poolScope: this._ctx.globalState.get('as.poolScope', DEFAULTS.poolScope) as PoolScope,
      poolTag: this._ctx.globalState.get<string>('as.poolTag', DEFAULTS.poolTag as any),
    };
  }

  async updateSettings(p: Partial<AutoSwitchSettings>): Promise<void> {
    if (p.enabled !== undefined) await this._ctx.globalState.update('as.enabled', p.enabled);
    if (p.threshold !== undefined) await this._ctx.globalState.update('as.threshold', p.threshold);
    if (p.checkSec !== undefined) await this._ctx.globalState.update('as.checkSec', p.checkSec);
    if (p.cooldownSec !== undefined) await this._ctx.globalState.update('as.cooldownSec', p.cooldownSec);
    if (p.refreshMin !== undefined) await this._ctx.globalState.update('as.refreshMin', p.refreshMin);
    if (p.scoreMode !== undefined) await this._ctx.globalState.update('as.scoreMode', p.scoreMode);
    if (p.switchStrategy !== undefined) await this._ctx.globalState.update('as.switchStrategy', p.switchStrategy);
    if (p.minQuota !== undefined) await this._ctx.globalState.update('as.minQuota', p.minQuota);
    if (p.preferUsedThreshold !== undefined) await this._ctx.globalState.update('as.preferUsedThreshold', p.preferUsedThreshold);
    if (p.poolScope !== undefined) await this._ctx.globalState.update('as.poolScope', p.poolScope);
    if (p.poolTag !== undefined) await this._ctx.globalState.update('as.poolTag', p.poolTag);
    this._restartTimers();
  }

  // ── 回调 ──

  set onUsageUpdate(cb: UsageUpdateCb | null) { this._onUsageUpdate = cb; }
  set onSwitchEvent(cb: SwitchEventCb | null) { this._onSwitchEvent = cb; }
  set onRefreshUI(cb: RefreshUICb | null) { this._onRefreshUI = cb; }
  set onAutoSwitchDone(cb: AutoSwitchDoneCb | null) { this._onAutoSwitchDone = cb; }

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

  get cacheSize(): number { return this._cache.size; }

  getCached(email: string): UsageCacheEntry | undefined { return this._cache.get(email); }

  getAllCached(): Map<string, UsageCacheEntry> { return this._cache; }

  // ── 刷新 ──

  // 并行批量大小：同时查询的账号数
  private static readonly BATCH_SIZE = 5;
  // 批次间等待时间（ms）
  private static readonly BATCH_DELAY = 1500;

  async refreshAll(force = false): Promise<void> {
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      const accounts = await accountStore.readAccounts(this._ctx);
      const ttlMs = this.settings.refreshMin * 60_000;

      // 过滤需要刷新的账号
      const toRefresh = accounts.filter(acct => {
        if (acct.disabled) return false;
        const cached = this._cache.get(acct.email);
        // 额度耗尽的号始终跳过（不论 force），等重置时间到再查
        if (cached?.skipUntil && Date.now() < cached.skipUntil) return false;
        // force 时跳过 TTL 检查，否则遵守 TTL
        if (!force && cached && Date.now() - cached.ts < ttlMs) return false;
        return true;
      });

      const skipped = accounts.length - toRefresh.length;
      if (skipped > 0) {
        console.log(`[autoSwitch] refreshAll: ${toRefresh.length} 个待刷新, ${skipped} 个跳过`);
      }

      // 并行批量刷新
      let consecutiveFailBatches = 0;
      for (let i = 0; i < toRefresh.length; i += AutoSwitcher.BATCH_SIZE) {
        const batch = toRefresh.slice(i, i + AutoSwitcher.BATCH_SIZE);
        await Promise.all(batch.map(acct => this._refreshOne(acct, true)));

        // 检查本批是否全部有 error（网络断了等）
        const batchHasErrors = batch.every(a => this._cache.get(a.email)?.error);
        if (batchHasErrors) consecutiveFailBatches++;
        else consecutiveFailBatches = 0;

        // 连续 3 批全失败 → 网络可能断了，提前终止
        if (consecutiveFailBatches >= 3) {
          console.warn(`[autoSwitch] refreshAll: 连续 ${consecutiveFailBatches} 批失败，终止刷新`);
          break;
        }

        // 批次间延迟（有错误时额外等待）
        if (i + AutoSwitcher.BATCH_SIZE < toRefresh.length) {
          await sleep(AutoSwitcher.BATCH_DELAY + (batchHasErrors ? ERROR_BACKOFF_MS : 0));
        }
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
    // 全量刷新定时器（始终运行）；force=true 只跳过 TTL，不跳过 skipUntil
    this._refreshTimer = setInterval(() => this.refreshAll(true), s.refreshMin * 60_000);
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

  // ── 内部：切号后刷新推送 ──

  private async _refreshAndPush(oldEmail: string, newEmail: string): Promise<void> {
    // 切号后延迟 3s 再刷新，避免请求风暴
    await sleep(3000);
    try {
      const accounts = await accountStore.readAccounts(this._ctx);
      for (const email of [oldEmail, newEmail]) {
        const acct = accounts.find(a => a.email === email);
        if (acct) {
          await this._refreshOne(acct, true);
          await sleep(THROTTLE_MS);
        }
      }
    } catch { /* ignore */ }
  }

  // ── 内部：自动切号 ──

  private async _checkAndSwitch(): Promise<void> {
    const s = this.settings;
    if (!s.enabled) { console.log('[autoSwitch] skip: disabled'); return; }
    if (this._switching) { console.log('[autoSwitch] skip: already switching'); return; }
    if (Date.now() < this._cooldownUntil) {
      console.log(`[autoSwitch] skip: cooldown ${Math.ceil((this._cooldownUntil - Date.now()) / 1000)}s`);
      return;
    }
    this._switching = true;
    try {
      const curEmail = this._ctx.globalState.get<string>('lastEmail');
      if (!curEmail) { console.log('[autoSwitch] skip: no current account'); return; }

      // 当前号缓存过期则先刷新
      const curEntry = this._cache.get(curEmail);
      if (!curEntry || Date.now() - curEntry.ts > CURRENT_TTL_MS) {
        await this.refreshSingle(curEmail, true);
      }

      const freshEntry = this._cache.get(curEmail);
      const snap = freshEntry?.snapshot;
      if (!snap) {
        console.log(`[autoSwitch] skip: no snapshot for ${curEmail}${freshEntry?.error ? ' err=' + freshEntry.error : ''}`);
        return;
      }

      const dPct = clamp(snap.dailyRemainingPercent);
      const wPct = clamp(snap.weeklyRemainingPercent);
      const curScore = calcScore(dPct, wPct, s.scoreMode);
      const minPct = Math.min(dPct, wPct);
      const minQ = s.minQuota ?? 10;

      // 硬约束：若任一维度低于 minQuota，视为当前号不可用，强制触发切号
      // 这避免了 scoreMode='daily' 时日限充足但周限耗尽却不切号的陷阱
      const hardExhausted = minPct <= minQ;

      if (!hardExhausted && curScore > s.threshold) {
        // 当前号额度充足，无需切换
        return;
      }

      // 确定瓶颈原因
      let reason: string;
      if (hardExhausted && minPct === wPct && wPct < dPct) {
        reason = `周配额耗尽 ${Math.round(wPct)}%`;
      } else if (hardExhausted && minPct === dPct && dPct < wPct) {
        reason = `日配额耗尽 ${Math.round(dPct)}%`;
      } else if (dPct <= s.threshold && wPct <= s.threshold) {
        reason = `日 ${Math.round(dPct)}% / 周 ${Math.round(wPct)}%`;
      } else if (s.scoreMode === 'daily' || dPct <= s.threshold) {
        reason = `日配额 ${Math.round(dPct)}%`;
      } else {
        reason = `周配额 ${Math.round(wPct)}%`;
      }

      // 寻找最佳候选
      // hardExhausted 时放宽阈值（当前号某个维度已耗尽，候选只需比 0 好即可）
      const findScore = hardExhausted ? 0 : curScore;
      const cand = this._findBest(curEmail, s.threshold, s.scoreMode, findScore);
      if (!cand) {
        const log = `[${ts()}] ${curEmail} ${reason} 低于阈值，无可用候选`;
        this._onSwitchEvent?.(log, `${curEmail} ${reason} 低于阈值，无可用候选`, 'warn');
        console.log(`[autoSwitch] ${curEmail} curScore=${Math.round(curScore)} d=${Math.round(dPct)} w=${Math.round(wPct)} no candidates`);
        return;
      }

      const log = `[${ts()}] ${curEmail} ${reason} → ${cand.email}`;
      this._onSwitchEvent?.(log, `${reason} 低于 ${s.threshold}%，切换至 ${cand.email}`, '');

      const accounts = await accountStore.readAccounts(this._ctx);
      const acct = accounts.find(a => a.email === cand.email);
      if (!acct) return;
      const { injectSession } = await import('./sessionInjector');
      const ok = await injectSession(this._ctx, acct, { silent: true });
      if (ok) {
        // 切换成功后才设置 cooldown（失败则立即可重试）
        this._cooldownUntil = Date.now() + s.cooldownSec * 1000;
        this._lastSwitchedFrom = curEmail;
        this._lastSwitchedAt = Date.now();
        await accountStore.setCurrentAccount(this._ctx, cand.email);
        this._onRefreshUI?.();
        // 通知 bridge → windsurf-better.js 显示通知 + 重试消息
        this._onAutoSwitchDone?.(cand.email, reason);
        // 后台异步刷新新旧账号配额（不阻塞切号流程）
        this._refreshAndPush(curEmail, cand.email).catch(() => {});
      } else {
        console.warn(`[autoSwitch] injectSession 失败: ${cand.email}`);
      }
    } catch (err) {
      console.warn('[autoSwitch] switch error:', err);
    } finally {
      this._switching = false;
    }
  }

  /**
   * 强制立即切号（由信号桥触发，跳过定时器和冷却期）
   * @param reason 触发原因（如 quota-exhausted）
   * @returns 切换成功返回新账号 email，失败返回 null
   */
  async forceSwitch(reason: string): Promise<{ email: string } | null> {
    // 如果定时器正在切号，等最多 5s（避免信号被白白丢弃）
    if (this._switching) {
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        if (!this._switching) break;
      }
      if (this._switching) return null;
    }
    this._switching = true;
    try {
      const s = this.settings;
      const curEmail = this._ctx.globalState.get<string>('lastEmail');
      if (!curEmail) return null;

      // ── 第 1 步：纯缓存挑号（0ms）──
      // 信号触发说明当前号 UI 已报错，不需要再 API 验证
      let cand = this._findBest(curEmail, 0, s.scoreMode);

      // ── 第 2 步：缓存无候选 → 快速并行刷新一批 ──
      if (!cand) {
        const accounts = await accountStore.readAccounts(this._ctx);
        const others = accounts.filter(a => a.email !== curEmail && !a.disabled);
        if (others.length > 0) {
          // 并行刷新（最多 10 个，~2s 完成）
          const batch = others.slice(0, 10);
          await Promise.allSettled(batch.map(a => this._refreshOne(a, true)));
          cand = this._findBest(curEmail, 0, s.scoreMode);
        }
      }

      if (!cand || cand.score <= 0) return null;

      // ── 第 3 步：执行切换 ──
      const accounts = await accountStore.readAccounts(this._ctx);
      const acct = accounts.find(a => a.email === cand.email);
      if (!acct) return null;

      const { injectSession } = await import('./sessionInjector');
      const ok = await injectSession(this._ctx, acct, { silent: true });
      if (!ok) return null;

      // 更新状态
      this._cooldownUntil = Date.now() + s.cooldownSec * 1000;
      this._lastSwitchedFrom = curEmail;
      this._lastSwitchedAt = Date.now();

      await accountStore.setCurrentAccount(this._ctx, cand.email);
      this._onRefreshUI?.();

      const log = `[${ts()}] 信号切号(${reason}): ${curEmail} → ${cand.email}`;
      this._onSwitchEvent?.(log, `${reason} → ${cand.email}`, '');

      // 后台异步刷新新旧账号配额（不阻塞返回）
      this._refreshAndPush(curEmail, cand.email).catch(() => {});

      return { email: cand.email };
    } finally {
      this._switching = false;
    }
  }

  private _findBest(curEmail: string, threshold: number, mode: ScoreMode, curScore: number = 0): { email: string; score: number } | null {
    const s = this.settings;
    const strategy = s.switchStrategy || 'lowestNonZero';
    const minQ = s.minQuota ?? 10;
    const prefUsed = s.preferUsedThreshold ?? 50;

    interface Cand { email: string; score: number; }
    const candidates: Cand[] = [];

    // 读取账号列表，用于检查 disabled 状态和标签
    const allAccounts = accountStore.readAccountsSync(this._ctx);
    const disabledSet = new Set(allAccounts.filter(a => a.disabled).map(a => a.email));

    // 根据 poolScope 构建允许的邮箱集合
    let poolEmails: Set<string> | null = null; // null = 不限制
    if (s.poolScope === 'tag' && s.poolTag) {
      poolEmails = new Set(allAccounts.filter(a => a.tag === s.poolTag).map(a => a.email));
    } else if (s.poolScope === 'instance') {
      const instTag = getCurrentInstanceTag();
      if (instTag) {
        poolEmails = new Set(allAccounts.filter(a => a.tag === instTag).map(a => a.email));
      }
    }

    // 候选阈值：取 max(传入 threshold, 当前号 score)
    // 语义：候选必须比当前号好；如果当前号 score 已经低于 threshold，则用 curScore 做下限
    // 避免 threshold 过高导致"无可用候选"的陷阱
    const effectiveThreshold = Math.max(threshold, curScore);
    let rejectedDueToThreshold = 0;
    let rejectedDueToMinQ = 0;

    for (const [email, entry] of this._cache.entries()) {
      if (email === curEmail) continue;
      if (disabledSet.has(email)) continue;
      if (poolEmails && !poolEmails.has(email)) continue;
      // 防止来回切：5 分钟内不回切到刚离开的号
      if (email === this._lastSwitchedFrom && Date.now() - this._lastSwitchedAt < ANTI_BOUNCE_MS) continue;
      if (!entry.snapshot) continue;
      // 跳过 Free 计划的账号
      const plan = (entry.snapshot.planName || '').toLowerCase();
      if (plan.includes('free')) continue;

      const dPct = clamp(entry.snapshot.dailyRemainingPercent);
      const wPct = clamp(entry.snapshot.weeklyRemainingPercent);

      // 硬约束 1：任一维度 ≤1% 视为耗尽，绝对不选（不受 minQ 配置影响）
      // 典型场景：周 0% 日 100% 的账号实际不可用
      if (dPct <= 1 || wPct <= 1) { rejectedDueToMinQ++; continue; }

      // 硬约束 2：两个维度取 min，低于 minQ 配置值也不选
      const minViable = Math.min(dPct, wPct);
      if (minViable <= minQ) { rejectedDueToMinQ++; continue; }

      const score = calcScore(dPct, wPct, mode);
      if (score > effectiveThreshold) candidates.push({ email, score });
      else rejectedDueToThreshold++;
    }

    if (candidates.length === 0) {
      console.log(`[autoSwitch] findBest: no candidates (checked ${this._cache.size}, rejected minQ=${rejectedDueToMinQ} threshold=${rejectedDueToThreshold}, effectiveThreshold=${effectiveThreshold})`);
      return null;
    }

    if (strategy === 'lowestNonZero') {
      // 分两组：已用号（score ≤ prefUsed）和满额号（score > prefUsed）
      const used = candidates.filter(c => c.score <= prefUsed);
      const fresh = candidates.filter(c => c.score > prefUsed);
      // 优先选已用号中额度最低的（消耗完再换新号）
      if (used.length > 0) {
        used.sort((a, b) => a.score - b.score);
        return used[0];
      }
      // 没有已用号，选满额号中额度最低的
      fresh.sort((a, b) => a.score - b.score);
      return fresh[0];
    } else {
      // highestFirst：旧策略，选额度最高的
      let best: Cand | null = null;
      for (const c of candidates) {
        if (!best || c.score > best.score) best = c;
      }
      return best;
    }
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
