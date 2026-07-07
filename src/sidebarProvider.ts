import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WebviewMessage, BackendMessage } from './types';
import * as accountStore from './accountStore';
import { login, loginByAuth1Token } from './loginService';
import { fetchUsage } from './usageService';
import { applyPatch, ensureAcpLocalRegistryFallback, getLastInjectFailure, injectSession, needsAcpUnlockPatch } from './sessionInjector';
import * as instanceManager from './instanceManager';
import { AutoSwitcher } from './autoSwitcher';
import { getSignalBridgeScript, getBridgeRelayScript, handlePoolSignal, PoolSignal } from './signalBridge';
import { getInjectionStatus, ensureEnhancement } from './enhancementInjector';
import { readEnhSettings, writeEnhSettings, mergeEnhSettings } from './enhSettingsStore';
import { enqueueCommand, onBridgeResult, getBridgeInfo } from './bridgeServer';
import { hasBubbleRules } from './rulesInjector';
import { playSystemSound } from './soundPlayer';
import { getOtherLockedEmails, getOtherLockedEmailsMap, acquireLock, releaseLock } from './accountLock';
import { UsageTracker } from './usageTracker';
import { getHealthCheckCache, testSingleAccount, setTagColors, clearHealthResult, resetMachineId } from './healthCheckPanel';
import { getContextMonitorSnapshot } from './contextMonitor';
import { getStateDbPath, getIdeDisplayName, detectIdeFlavor } from './ideDetector';
import { testModelAccess, ProbeModelInfo, setCascadeProbeEnabled } from './usageService';
import { stopIsolatedCascadeProbeLs } from './cascadeProbe';
import { scheduleAcpConnectionRecovery } from './acpRecovery';
import { loginByWindsurfOAuth } from './windsurfOAuthService';

/**
 * 侧栏 Webview 提供器
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private _output = vscode.window.createOutputChannel(`${getIdeDisplayName()} 号池`);
  onManualSwitch?: () => void;
  private _startTs = Date.now();
  private _healthCheckAbort?: AbortController;
  private _logFilePath: string;
  private _diagnoseLogPath: string;
  private _autoSwitcher: AutoSwitcher;
  private _usageTracker: UsageTracker;
  private _lastSoundTs = 0; // 防重：上次播放时间戳
  private _lastUsagePercent = new Map<string, number>(); // 上次额度快照，用于检测额度减少
  private _lastDiagnoseTs = 0; // 诊断日志写入时间戳，用于增量写入

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    autoSwitcher: AutoSwitcher,
    usageTracker: UsageTracker
  ) {
    this._usageTracker = usageTracker;
    // 日志文件：globalStorage/kite.log（保留最近 500KB）
    try {
      fs.mkdirSync(this._context.globalStorageUri.fsPath, { recursive: true });
    } catch {}
    this._logFilePath = path.join(this._context.globalStorageUri.fsPath, 'kite.log');
    this._diagnoseLogPath = path.join(this._context.globalStorageUri.fsPath, 'diagnose.log');
    // 每次启动在文件头写分隔符
    try {
      const header = `\n\n==================== ${new Date().toISOString()} ====================\n`;
      fs.appendFileSync(this._logFilePath, header, 'utf8');
      // 文件过大则截断（只保留后 200KB）
      const stat = fs.statSync(this._logFilePath);
      if (stat.size > 500 * 1024) {
        const buf = fs.readFileSync(this._logFilePath);
        fs.writeFileSync(this._logFilePath, buf.slice(-200 * 1024));
      }
    } catch {}

    this.log(`[lifecycle] SidebarProvider constructed ext=${this._context.extension.packageJSON?.version || 'unknown'} storage=${this._context.globalStorageUri.fsPath}`);
    this.log(`[lifecycle] env ide=${getIdeDisplayName()} flavor=${detectIdeFlavor()} appRoot=${vscode.env.appRoot}`);

    // 绑定后端自动切号引擎
    this._autoSwitcher = autoSwitcher;
    this._autoSwitcher.onUsageUpdate = (email, snapshot, error) => {
      // 检测额度减少 → 正在正常消耗 → 清除测活异常
      if (snapshot && typeof snapshot.dailyRemainingPercent === 'number') {
        const cur = snapshot.dailyRemainingPercent;
        const prev = this._lastUsagePercent.get(email);
        const hc = getHealthCheckCache().get(email);
        if (hc && !hc.ok) {
          if (prev !== undefined && cur < prev) {
            clearHealthResult(email);
            this._recordDiagnostic(email, 'health', true, '额度消耗中，已清除异常');
            this.postMessage({ type: 'testModelResult', email, ok: true, reason: '额度消耗中，已清除异常', ts: Date.now() } as any);
            this.log(`[usageWatch] ✓ ${email} 额度 ${prev}% → ${cur}%，清除测活异常`);
          }
        }
        this._lastUsagePercent.set(email, cur);
      }
      this.postMessage({ type: 'usage', email, snapshot, error } as any);
      this._pushUsageStats();
    };
    this._autoSwitcher.onSwitchEvent = (log, status, statusType) => {
      this.postMessage({ type: 'autoSwitchEvent', log, status, statusType } as any);
      // 持久化切号日志（webview 重建后可恢复）
      if (log) {
        const logs: string[] = this._context.globalState.get('autoSwitchLogs', []);
        logs.push(log);
        if (logs.length > 200) logs.splice(0, logs.length - 200);
        this._context.globalState.update('autoSwitchLogs', logs);
      }
    };
    this._autoSwitcher.onRefreshUI = () => {
      this.refresh();
    };
    // 配额变动时实时推送历史
    this._usageTracker.onHistoryUpdate = () => {
      this._pushQuotaHistory();
      this._pushDiagnosticSync();
    };
    // 定时器自动切号成功后 → 通知 bridge（windsurf-better.js 显示通知 + 重试消息）
    this._autoSwitcher.onAutoSwitchDone = (newEmail, reason) => {
      // 推送 pool-result 到 bridge，让 windsurf-better.js 处理（显示通知 + 重试）
      // v7.6.20 修订（#7）：失败时显式 warn 而非静默吞，避免"自动继续完全无反应"调试困难
      let bridgeOk = true;
      try {
        enqueueCommand({
          id: Date.now(),
          action: 'pool-result',
          payload: { type: 'switched', ts: Date.now(), email: newEmail }
        });
      } catch (e) {
        bridgeOk = false;
        console.warn('[sidebar] enqueueCommand pool-result 失败，自动继续将不会触发：', e);
        this.log(`[bridge ✗] pool-result 推送失败: ${(e as Error)?.message || e}`);
      }
      // 弹 VS Code 通知（面板关着也能看到）
      if (bridgeOk) {
        vscode.window.showInformationMessage(`额度不足，已自动切换至 ${newEmail}`);
      } else {
        vscode.window.showWarningMessage(`已切换至 ${newEmail}，但桥接通信失败，自动继续可能不生效，请手动发送`);
      }
    };

    // 监听 bridge 的 /result：
    // - type='pool-signal' → 切号请求（windsurf-better.js 主动发起），由 autoSwitcher 处理后反向回传
    // - 其他 → 命令结果，转发给 webview 显示
    const unsubscribeBridge = onBridgeResult((result) => {
      try {
        if (result && result.type === 'pool-signal' && result.signal) {
          this.log(`[bridge ←] pool-signal type=${result.signal.type}`);
          this._usageTracker.recordPoolSignal();
          handlePoolSignal(result.signal as PoolSignal, this._autoSwitcher, (poolResult) => {
            // 通过 enqueueCommand 反向把切号结果送回 windsurf-better.js
            // windsurf-better.js 收到 action='pool-result' 命令 → 写 localStorage 触发原处理逻辑
            enqueueCommand({ id: Date.now(), action: 'pool-result', payload: poolResult });
          }).catch(err => console.warn('[sidebar] handlePoolSignal err:', err));
          return;
        }
        // 完成提醒：通过 bridge 收到播放声音请求
        if (result && result.type === 'notify-sound') {
          this._playNotifyOnce(result.tone || 'funk', result.repeat || 2, result.customTone, result.audioFile, result.sound !== false, !!result.desktop, result.title, result.body);
          return;
        }
        // v7.8.5: 反向设置同步 —— 补丁端从 toast 等本地 UI 改的 settings，通过此通路持久化到 enh-settings.json
        // 死锁解药：bridge 就绪后补丁端调 flushPendingEnhPatch 自动推过来；扩展端这里 mergeEnhSettings + 重写 workbench.html → 下次启动也是新值
        if (result && result.type === 'enh-settings-patch' && result.patch && typeof result.patch === 'object') {
          const keys = Object.keys(result.patch);
          this.log(`[bridge ←] enh-settings-patch keys=${keys.join(',')}`);
          try {
            const merged = mergeEnhSettings(result.patch);
            // 同步重写 workbench.html，保证下次启动 __WS_BETTER_INJECTED_SETTINGS__ 已是新值
            try { ensureEnhancement(); } catch (e) { this.log(`[bridge ✗] ensureEnhancement 失败: ${(e as Error)?.message || e}`); }
            // 通知侧栏 UI 同步显示（如果当前打开着）
            this.postMessage({ type: 'enhSettings', settings: merged } as any);
            // 如果改了 autoSwitchEnabled，同步给 autoSwitcher（保持双端一致）
            if (typeof result.patch.autoSwitchEnabled === 'boolean') {
              this._autoSwitcher.updateSettings({ enabled: result.patch.autoSwitchEnabled })
                .catch(e => this.log(`[bridge ✗] autoSwitcher 同步失败: ${(e as Error)?.message || e}`));
            }
          } catch (e) {
            this.log(`[bridge ✗] mergeEnhSettings 失败: ${(e as Error)?.message || e}`);
          }
          return;
        }
        // 长任务状态通知：转发给 webview 更新 UI
        if (result?.action === 'lt-stopped') {
          this.postMessage({ type: 'ltStateUpdate', state: 'stopped', reason: result.reason, count: result.count } as any);
          return;
        }
        if (result?.action === 'lt-count') {
          this.postMessage({ type: 'ltStateUpdate', state: 'running', count: result.count, action: '✅ 发送"' + (result.text || '') + '"' } as any);
          return;
        }
        if (result?.action === 'ac-stats') {
          this.postMessage({ type: 'acStatsUpdate', stats: result.stats } as any);
          return;
        }
        // 恢复/诊断日志同步：windsurf-better.js 主动推送或响应 syncLogs 命令
        // 无论统计面板是否打开都存入 globalState，面板打开时直接读取
        if (result?.action === 'syncLogs' && result?.payload) {
          if (Array.isArray(result.payload.recoveryLogs)) {
            this._context.globalState.update('recoveryLogs', result.payload.recoveryLogs);
          }
          if (Array.isArray(result.payload.diagnoseLogs)) {
            this._context.globalState.update('diagnoseLogs', result.payload.diagnoseLogs);
            this._writeDiagnoseLogs(result.payload.diagnoseLogs);
          }
          return;
        }
        this.log(`[bridge ←] action=${result?.action} id=${result?.id} status=${result?.status}`);
        this.postMessage({ type: 'enhCommandResult', result } as any);
      } catch (err) {
        this.log(`[bridge ←] ✗ 异常: ${err}`);
      }
    });
    this._disposables.push({ dispose: unsubscribeBridge });

    // 定时 contextMonitor 检查：当前账号有活跃 session 有 token → 清除限速状态
    const contextCheckTimer = setInterval(() => this._checkContextForHealthClear(), 60_000);
    this._disposables.push({ dispose: () => clearInterval(contextCheckTimer) });
  }

  private async _checkContextForHealthClear(): Promise<void> {
    try {
      const currentEmail = this._context.globalState.get<string>('lastEmail') || '';
      if (!currentEmail) return;
      const hcCache = getHealthCheckCache();
      const hc = hcCache.get(currentEmail);
      if (!hc || hc.ok || (hc as any).testing) return;

      const snap = await getContextMonitorSnapshot();
      if (!snap.ok || !snap.active) return;
      // 检查活跃 session 是否有近期 token 产出（5 分钟内更新）
      const updatedAt = Date.parse(snap.active.updatedAt || '');
      if (!updatedAt || Date.now() - updatedAt > 5 * 60_000) return;
      if ((snap.active.outputTokens || 0) <= 0) return;

      // 有活跃 token 产出 → 账号正在正常使用，清除所有测活异常
      hcCache.set(currentEmail, {
        ...hc,
        ok: true,
        reason: 'Cascade 活跃使用中，已清除异常',
        ts: Date.now(),
      });
      this._recordDiagnostic(currentEmail, 'health', true, 'Cascade 活跃使用中，已清除异常');
      this.postMessage({ type: 'testModelResult', email: currentEmail, ok: true, reason: 'Cascade 活跃使用中，已清除异常', ts: Date.now() } as any);
      this.log(`[contextMonitor] ${currentEmail} 有活跃 session（outputTokens=${snap.active.outputTokens}），清除测活异常`);
    } catch (err) {
      // ignore
    }
  }

  private _recordSwitchLog(log: string, status: string, statusType: string = ''): void {
    this.postMessage({ type: 'autoSwitchEvent', log, status, statusType } as any);
    if (log) {
      const logs: string[] = this._context.globalState.get('autoSwitchLogs', []);
      logs.push(log);
      if (logs.length > 200) logs.splice(0, logs.length - 200);
      this._context.globalState.update('autoSwitchLogs', logs);
    }
  }

  private _tsFmt(): string {
    const n = new Date();
    return `${n.getMonth() + 1}/${n.getDate()} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
  }

  private log(msg: string) {
    const elapsed = ((Date.now() - this._startTs) / 1000).toFixed(2);
    const ts = new Date().toISOString().substring(11, 23);
    const line = `[${ts}] [+${elapsed}s] ${msg}`;
    this._output.appendLine(line);
    try { fs.appendFileSync(this._logFilePath, line + '\n', 'utf8'); } catch {}
  }

  private _formatError(err: unknown): string {
    if (err instanceof Error) {
      return `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ''}`;
    }
    try { return JSON.stringify(err); } catch {}
    return String(err);
  }

  private _formatWebviewDetail(detail: unknown): string {
    try {
      const text = JSON.stringify(detail);
      return text.length > 2000 ? text.slice(0, 2000) + '...(truncated)' : text;
    } catch {
      return String(detail);
    }
  }

  private _handleWebviewLog(message: any): void {
    const level = String(message.level || 'info').toUpperCase();
    const msg = String(message.message || '');
    const detail = message.detail === undefined ? '' : ` detail=${this._formatWebviewDetail(message.detail)}`;
    const state = message.readyState ? ` readyState=${message.readyState}` : '';
    this.log(`[webview ${level}] ${msg}${state}${detail}`);
  }

  /** 写诊断日志到文件（增量追加，文件过大时截断） */
  private _writeDiagnoseLogs(logs: any[]) {
    try {
      // 只写比上次更新的日志
      const newLogs = logs.filter((l: any) => l.ts && l.ts > this._lastDiagnoseTs);
      if (newLogs.length === 0) return;
      this._lastDiagnoseTs = Math.max(...newLogs.map((l: any) => l.ts || 0));

      const lines = newLogs.map((l: any) => {
        const ts = l.ts ? new Date(l.ts).toISOString() : 'N/A';
        const stage = l.stage || 'unknown';
        const reason = l.reason || '';
        const hit = l.hitText ? l.hitText.substring(0, 120) : '';
        const extra = l.candidates ? `candidates=${l.candidatesCount || 0}` : 
                      l.category ? `cat=${l.category} act=${l.action || ''}` : '';
        return `[${ts}] [${stage}] ${reason} | hit="${hit}" ${extra}`;
      }).join('\n');

      fs.appendFileSync(this._diagnoseLogPath, lines + '\n', 'utf8');
      // 文件过大截断（保留后 200KB）
      const stat = fs.statSync(this._diagnoseLogPath);
      if (stat.size > 500 * 1024) {
        const buf = fs.readFileSync(this._diagnoseLogPath);
        fs.writeFileSync(this._diagnoseLogPath, buf.slice(-200 * 1024));
      }
    } catch {}
  }

  /** 显示日志面板 */
  public showLog() {
    this._output.appendLine(`日志文件: ${this._logFilePath}`);
    this._output.appendLine(`诊断日志: ${this._diagnoseLogPath}`);
    this._output.show(true);
  }

  /** 供 extension.ts 启动流程写入同一份 Kite 日志 */
  public diagnosticLog(msg: string): void {
    this.log(msg);
  }

  /** 主动通知 webview 刷新 Windsurf 增强状态（供外部命令在修改文件/配置后调用） */
  public refreshEnhancementStatus(): void {
    this._pushEnhancementStatus();
  }

  /** 更新异常监控徽章（供统计面板检测完成后调用） */
  public updateAnomalyCount(count: number): void {
    this.postMessage({ type: 'anomalyCheckResult', count } as any);
  }

  /**
   * 推送 bridge 端口/token 到 sidebar webview，由 webview 转发给同进程的
   * workbench renderer（window.top.postMessage）。
   * 多实例关键：此通道是"同进程 sidebar iframe ↔ workbench 顶层 frame"，天然隔离。
   */
  public refreshBridgeInfo(): void {
    const info = getBridgeInfo();
    if (!info) return;
    this._view?.webview.postMessage({ type: 'bridgeInfo', port: info.port, token: info.token } as any);
  }

  /**
   * 从 Windsurf 本地 SQLite 数据库直接读取可用模型列表
   * 路径: %APPDATA%/Windsurf/User/globalStorage/state.vscdb
   * 键: windsurfConfigurations（base64 protobuf，含模型 label 文本）
   * 零 UI 操作、零 DOM 交互、瞬间返回
   */
  private async _handleFetchModels(cmdId: number) {
    try {
      const allModels = await this._readModelsFromStateDb();
      // 获取最近使用的模型 UID
      let recentUids: string[] = [];
      let currentModel = '';
      try {
        const codeiumState = await this._readStateDbKey('codeium.windsurf');
        if (codeiumState) {
          const state = JSON.parse(codeiumState);
          const selected = state['windsurf.state.lastSelectedCascadeModelUids'];
          if (Array.isArray(selected)) {
            recentUids = selected;
            const rawCurrent = selected[0] || '';
            // 将 UID/汉化名映射回可读 label（state DB 可能存了汉化后的名称）
            currentModel = this._resolveModelLabel(rawCurrent, allModels) || rawCurrent;
          }
        }
      } catch {}
      // 过滤：只保留主流基础模型 + 最近使用的
      const models = this._filterMainstreamModels(allModels, recentUids);
      this.postMessage({ type: 'enhCommandResult', result: {
        id: cmdId, action: 'fetch-models', status: 'done',
        models, currentModel
      }} as any);
    } catch (err) {
      this.postMessage({ type: 'enhCommandResult', result: {
        id: cmdId, action: 'fetch-models', status: 'error',
        message: '读取模型数据库失败: ' + err
      }} as any);
    }
  }

  /** 将 state DB 中的 UID 或汉化名映射回可读模型 label */
  private _resolveModelLabel(raw: string, allModels: string[]): string {
    if (!raw) return '';
    // 精确匹配
    if (allModels.includes(raw)) return raw;
    // UID 模糊匹配: claude-opus-4-7-medium → Claude Opus 4.7 Medium
    const rawNorm = raw.replace(/[-_.]/g, ' ').toLowerCase();
    for (const m of allModels) {
      const mNorm = m.replace(/[-.\s]/g, ' ').toLowerCase();
      if (mNorm === rawNorm || rawNorm.includes(mNorm) || mNorm.includes(rawNorm)) return m;
    }
    // 去掉中文字符后再匹配（处理汉化残留如 "SWE-1.6New免费" → "SWE-1.6New"）
    const rawAscii = raw.replace(/[^\x00-\x7F]/g, '').trim();
    if (rawAscii && rawAscii !== raw) {
      const asciiNorm = rawAscii.replace(/[-_.]/g, ' ').toLowerCase();
      for (const m of allModels) {
        const mNorm = m.replace(/[-.\s]/g, ' ').toLowerCase();
        if (mNorm.includes(asciiNorm) || asciiNorm.includes(mNorm)) return m;
      }
    }
    return '';
  }

  /** 过滤只保留主流模型 + 最近使用 */
  private _filterMainstreamModels(allModels: string[], recentUids: string[]): string[] {
    // 排除含这些关键词的变体（Low/Medium/High/XHigh/Fast/Mini/1M/Spark/Max）
    // 注意：Thinking 不排除，因为它是重要的模型行为差异（Claude Opus 4.6 vs Claude Opus 4.6 Thinking）
    const variantRe = /\b(Low|Medium|High|XHigh|X-High|Fast|Mini|1M|Spark|Max|Minimal)\b/i;
    const mainstream = allModels.filter(m => !variantRe.test(m));
    // 把最近使用的 uid 转成 label 匹配（uid: claude-opus-4-7-medium → 匹配 "Claude Opus 4.7 Medium"）
    const recentLabels: string[] = [];
    for (const uid of recentUids) {
      const normalized = uid.replace(/-/g, ' ').toLowerCase();
      const match = allModels.find(m => {
        const mNorm = m.replace(/[.\-]/g, ' ').toLowerCase();
        return mNorm === normalized || normalized.includes(mNorm) || mNorm.includes(normalized);
      });
      if (match && !mainstream.includes(match)) recentLabels.push(match);
    }
    // 合并：主流 + 最近使用（去重）
    const result = [...mainstream];
    for (const r of recentLabels) { if (!result.includes(r)) result.push(r); }
    return result;
  }

  private _readStateDbKey(key: string): Promise<string | null> {
    const dbPath = getStateDbPath();
    const sqlitePath = path.join(vscode.env.appRoot, 'node_modules/@vscode/sqlite3');
    return new Promise((resolve, reject) => {
      try {
        const sqlite = require(sqlitePath);
        const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY, (err: any) => {
          if (err) { reject(err); return; }
          db.get('SELECT value FROM ItemTable WHERE key = ?', [key], (e: any, row: any) => {
            db.close();
            if (e) reject(e);
            else resolve(row ? row.value : null);
          });
        });
      } catch (e) { reject(e); }
    });
  }

  private _diagnosticLevel(ok: boolean, reason?: string): 'ok' | 'warn' | 'error' {
    if (ok) return 'ok';
    return /全局限制|长期不可用|限流|限速|rate limit|message limit|消息.*上限|已达上限|用尽|cooldown|reset|暂不可用/i.test(reason || '') ? 'warn' : 'error';
  }

  private _recordDiagnostic(email: string, source: 'switch' | 'health', ok: boolean, reason?: string, model?: string, status?: number): void {
    this._usageTracker.recordDiagnostic({
      ts: Date.now(),
      email,
      source,
      level: this._diagnosticLevel(ok, reason),
      reason: ok ? (reason || (source === 'switch' ? '切换成功' : '测活正常')) : (reason || '未知原因'),
      model,
      status,
    });
  }

  private _pushDiagnosticSync(): void {
    this.postMessage({
      type: 'diagnosticSync',
      latest: this._usageTracker.getLatestDiagnosticsByAccount(),
    } as any);
  }

  private _writeStateDbKey(key: string, value: string): Promise<void> {
    const dbPath = getStateDbPath();
    const sqlitePath = path.join(vscode.env.appRoot, 'node_modules/@vscode/sqlite3');
    return new Promise((resolve, reject) => {
      try {
        const sqlite = require(sqlitePath);
        const db = new sqlite.Database(dbPath, (err: any) => {
          if (err) { reject(err); return; }
          db.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', [key, value], (e: any) => {
            db.close();
            if (e) reject(e);
            else resolve();
          });
        });
      } catch (e) { reject(e); }
    });
  }

  /**
   * 从 windsurfConfigurations protobuf 中提取 label → UID 映射
   * UID 格式: lowercase-kebab-case (如 claude-opus-4-7)
   * Label 格式: Title Case (如 Claude Opus 4.7)
   */
  private async _extractModelUidMapping(): Promise<Map<string, string>> {
    const raw = await this._readStateDbKey('windsurfConfigurations');
    if (!raw) return new Map();
    const buf = Buffer.from(raw, 'base64');
    const text = buf.toString('utf8');
    const mapping = new Map<string, string>();

    // 提取 labels (Title Case)
    const labels: string[] = [];
    const labelRe = /(?:Claude|GPT|SWE|Gemini|Grok|DeepSeek|Llama|Qwen|Mistral)[\w\s.\-()]+/g;
    let m: RegExpExecArray | null;
    while ((m = labelRe.exec(text)) !== null) {
      const name = m[0].trim();
      if (name.length > 3 && name.length < 50 && !/_/.test(name)) labels.push(name);
    }

    // 提取 UIDs (lowercase-kebab-case)
    const uids = new Set<string>();
    const uidRe = /\b(claude|gpt|swe|gemini|grok|deepseek|llama|qwen|mistral)[-a-z0-9]+/g;
    while ((m = uidRe.exec(text)) !== null) {
      const uid = m[0];
      if (uid.length > 3 && uid.includes('-')) uids.add(uid);
    }

    // 建立映射: 通过规范化文本匹配
    for (const label of labels) {
      const labelNorm = label.replace(/[.\-\s]/g, ' ').toLowerCase().trim();
      for (const uid of uids) {
        const uidNorm = uid.replace(/-/g, ' ');
        if (uidNorm === labelNorm || labelNorm.includes(uidNorm) || uidNorm.includes(labelNorm)) {
          mapping.set(label, uid);
          break;
        }
      }
    }
    return mapping;
  }

  /**
   * 切换模型：后端静默写入 state DB（持久化兜底），然后通过 bridge 执行 DOM 切换（立即生效）
   * bridge 结果由全局 onBridgeResult handler 推送给 webview，不产生竞态
   */
  private async _handleSwitchModel(cmdId: number, targetLabel: string) {
    if (!targetLabel) {
      this.postMessage({ type: 'enhCommandResult', result: {
        id: cmdId, action: 'test-switch-model', status: 'error',
        message: '未指定模型'
      }} as any);
      return;
    }

    // 1. 静默写入 state DB（不阻塞，不影响 bridge 结果）
    this._writeSwitchModelToDb(targetLabel).catch(err => {
      this.log(`[switchModel] DB 写入失败（降级）: ${err}`);
    });

    // 2. 通过 bridge 执行 DOM 切换（bridge 结果由全局 handler 推送 webview）
    enqueueCommand({ id: cmdId, action: 'test-switch-model', payload: { model: targetLabel } });

    // 3. 兜底超时：如果 bridge 8s 无响应，发送 DB 层面的成功
    setTimeout(() => {
      // 发一条 backup result（webview 会显示最后收到的结果）
      this.postMessage({ type: 'enhCommandResult', result: {
        id: cmdId, action: 'test-switch-model', status: 'done',
        message: `已设置 ${targetLabel}（数据库已更新，新对话生效）`,
        newModel: targetLabel
      }} as any);
    }, 8000);
  }

  /** 静默写入目标模型到 state DB */
  private async _writeSwitchModelToDb(targetLabel: string): Promise<void> {
    const uidMap = await this._extractModelUidMapping();
    let targetUid = uidMap.get(targetLabel) || '';
    if (!targetUid) {
      for (const [label, uid] of uidMap) {
        const labelNorm = label.replace(/[.\-\s]/g, ' ').toLowerCase();
        const targetNorm = targetLabel.replace(/[.\-\s]/g, ' ').toLowerCase();
        if (labelNorm.includes(targetNorm) || targetNorm.includes(labelNorm)) {
          targetUid = uid; break;
        }
      }
    }
    if (!targetUid) {
      targetUid = targetLabel.toLowerCase().replace(/\s+/g, '-').replace(/\./g, '-').replace(/[()]/g, '').replace(/--+/g, '-').replace(/-$/, '');
    }
    const codeiumRaw = await this._readStateDbKey('codeium.windsurf');
    const state = codeiumRaw ? JSON.parse(codeiumRaw) : {};
    const currentUids: string[] = state['windsurf.state.lastSelectedCascadeModelUids'] || [];
    state['windsurf.state.lastSelectedCascadeModelUids'] = [targetUid, ...currentUids.filter((u: string) => u !== targetUid)];
    await this._writeStateDbKey('codeium.windsurf', JSON.stringify(state));
    this.log(`[switchModel] DB 已更新: uid=${targetUid}`);
  }

  private async _readModelsFromStateDb(): Promise<string[]> {
    const raw = await this._readStateDbKey('windsurfConfigurations');
    if (!raw) return [];
    // windsurfConfigurations 是 base64 编码的 protobuf 二进制
    const buf = Buffer.from(raw, 'base64');
    const text = buf.toString('utf8');
    // 从二进制中提取可读的模型 label（过滤掉内部枚举名）
    const models = new Set<string>();
    const re = /(?:Claude|GPT|SWE|Gemini|Grok|DeepSeek|Llama|Qwen|Mistral)[\w\s.\-()]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[0].trim();
      // 只保留 display label（排除 ENUM 格式如 GPT_5_2_HIGH）
      if (name.length > 3 && name.length < 50 && !/_/.test(name)) {
        models.add(name);
      }
    }
    return [...models].sort();
  }

  /** 打开日志文件 */
  public async openLogFile() {
    try {
      const doc = await vscode.workspace.openTextDocument(this._logFilePath);
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      this.showAlert('错误', '打开日志失败：' + err, 'error');
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    this.log('[webview] resolveWebviewView:start');

    const extPkg = this._context.extension.packageJSON;
    webviewView.title = extPkg.version || '0.0.0';
    this.log(`[webview] title=${webviewView.title}`);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };
    this.log(`[webview] options enableScripts=true localRoot=${this._extensionUri.toString()}`);

    try {
      const html = this._getHtmlForWebview(webviewView.webview);
      this.log(`[webview] html generated length=${html.length}`);
      webviewView.webview.html = html;
      this.log('[webview] html assigned');
    } catch (err) {
      this.log(`[webview] html generation/assignment failed: ${this._formatError(err)}`);
      throw err;
    }

    // bridge 信息首次推送（webview 会转发给 workbench renderer）
    setTimeout(() => this.refreshBridgeInfo(), 500);

    // 初始加载：先用 poolLastEmail 快速渲染，5s 后做 auth 检测
    setTimeout(() => this.refresh(true), 300);
    setTimeout(() => {
      this.refresh();
      this._pushAutoSwitchSettings();
    }, 5000);

    // 推送后端缓存和设置给 webview
    setTimeout(() => {
      this._pushCachedUsage();
      this._pushAutoSwitchSettings();
      this._pushEnhancementStatus();
      this._pushPreflightSetting();
      this._pushUsageStats();
      this._pushQuotaHistory();

      // 记录实例启动日志（用于异常监控的引用计数）
      const curEmail = this._context.globalState.get<string>('lastEmail');
      if (curEmail) {
        const startLog = `[${this._tsFmt()}][start] (实例启动) → ${curEmail}`;
        this._recordSwitchLog(startLog, '');
      }

      // 恢复持久化的切号日志
      const savedLogs: string[] = this._context.globalState.get('autoSwitchLogs', []);
      if (savedLogs.length > 0) {
        for (const log of savedLogs) {
          this.postMessage({ type: 'autoSwitchEvent', log } as any);
        }
      }

      // 恢复上次保存的异常数量
      const anomalyCount = this._context.globalState.get<number>('anomalyCount', 0);
      this.postMessage({ type: 'anomalyCheckResult', count: anomalyCount } as any);
    }, 600);

    // 监听 auth session 变化（Windsurf 登录/登出时触发）
    try {
      const sub = vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === 'windsurf_auth') this.refresh();
      });
      this._disposables.push(sub);
    } catch { /* ignore */ }

    // 监听共享账号文件变化（多实例同步）
    try {
      let debounceTimer: NodeJS.Timeout | undefined;
      const unwatch = accountStore.watchAccountsFile(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { this.refresh(); }, 300);
      });
      this._disposables.push({ dispose: unwatch });
    } catch { /* ignore */ }

    // 监听 instances.json 变化（跨实例实时同步邮箱/状态）
    try {
      let instDebounce: NodeJS.Timeout | undefined;
      const unwatchInst = instanceManager.watchInstancesFile(() => {
        if (instDebounce) clearTimeout(instDebounce);
        instDebounce = setTimeout(async () => {
          try {
            const instances = await instanceManager.listInstances();
            this.postMessage({ type: 'instanceListResult', instances });
          } catch {}
        }, 500);
      });
      this._disposables.push({ dispose: unwatchInst });
    } catch { /* ignore */ }

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
        this._pushAutoSwitchSettings();
        this._pushEnhancementStatus();
        this._pushPreflightSetting();
        this._pushUsageStats();
        this._pushQuotaHistory();
        this.refreshBridgeInfo();
      }
    });

    // 监听 VS Code 配置变更（设置面板修改时实时同步到工具栏）
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('windsurfPool.preflightSwitchCheck')) {
        this._pushPreflightSetting();
      }
    });
    this._disposables.push(cfgSub);

    // 监听 webview 消息
    webviewView.webview.onDidReceiveMessage(async (message: any) => {
      if (message?.type === 'webviewLog') {
        this._handleWebviewLog(message);
        return;
      }
      try {
        await this.handleMessage(message);
      } catch (err) {
        this.log(`[webview -> host] handleMessage failed type=${message?.type}: ${this._formatError(err)}`);
        throw err;
      }
    });
    this.log('[webview] resolveWebviewView:done');
  }

  /** 推送后端缓存的所有 usage 数据给 webview */
  private _pushCachedUsage(): void {
    for (const [email, entry] of this._autoSwitcher.getAllCached()) {
      this.postMessage({ type: 'usage', email, snapshot: entry.snapshot, error: entry.error } as any);
      // 初始化额度基线，避免重启后需要两个刷新周期才能检测额度减少
      if (entry.snapshot && !this._lastUsagePercent.has(email)) {
        this._lastUsagePercent.set(email, entry.snapshot.dailyRemainingPercent);
      }
    }
  }

  /** 推送用量统计给 webview */
  private _pushUsageStats(): void {
    const summary = this._usageTracker.getSummary();
    this.postMessage({ type: 'usageStatsSync', ...summary } as any);
  }

  /** 推送配额变动历史给 webview */
  private _pushQuotaHistory(email?: string): void {
    const currentEmail = this._context.globalState.get<string>('lastEmail') || '';
    const entries = this._usageTracker.getQuotaHistory(email, 100);
    const emails = this._usageTracker.getHistoryEmails();
    this.postMessage({ type: 'quotaHistorySync', entries, emails, currentEmail } as any);
  }

  /** 推送 Windsurf 增强状态给 webview */
  private _pushEnhancementStatus(): void {
    try {
      const status = getInjectionStatus();
      const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', false);
      const autoRecovery = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('autoRecovery', true);
      const ext = vscode.extensions.getExtension('local.windsurf-pool') || vscode.extensions.getExtension('local.kite');
      const extVersion = ext?.packageJSON?.version || '0.0.0';
      const patchVersion = status.patchVersion || '0.0.0';
      const bubbleRulesInjected = hasBubbleRules();
      const signalBridgeActive = status.injected;
      this.postMessage({
        type: 'enhancementStatus',
        injected: status.injected,
        patchVersion,
        extensionVersion: extVersion,
        enabled,
        autoRecovery,
        bubbleRulesInjected,
        signalBridgeActive,
      } as any);
    } catch {}
  }

  /** 防重播放通知声音：5 秒内只允许一次（bridge + webview 可能对同一事件双触发） */
  private _playNotifyOnce(tone: string, repeat: number, customTone?: string, audioFile?: string, sound = true, desktop = false, title?: string, body?: string): void {
    const now = Date.now();
    if (now - this._lastSoundTs < 3000) return; // 3s 内去重
    this._lastSoundTs = now;
    if (sound) {
      playSystemSound(tone, repeat, customTone, audioFile);
    }
    if (desktop) {
      vscode.window.showInformationMessage(title || 'Cascade 完成', body || 'AI 回复已完成');
    }
  }

  /** 推送自动切号设置给 webview + 同步 enabled 状态到 windsurf-better.js */
  private _pushAutoSwitchSettings(): void {
    const s = this._autoSwitcher.settings;
    this.postMessage({ type: 'autoSwitchSettingsSync', ...s } as any);
    // 同步 autoSwitchEnabled 给 DOM 侧，关闭时 windsurf-better.js 不再发送切号信号
    try {
      enqueueCommand({ id: Date.now(), action: 'apply-settings', payload: { autoSwitchEnabled: s.enabled } });
    } catch {}
  }

  /** 推送切号预检设置给 webview */
  private _pushPreflightSetting(): void {
    const enabled = vscode.workspace.getConfiguration('windsurfPool').get<boolean>('preflightSwitchCheck', true);
    this.postMessage({ type: 'preflightSettingSync', enabled } as any);
  }

  /**
   * 处理 webview 消息
   */
  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'enhLoad': {
        // webview 启动时拉取磁盘上的真相源
        const settings = readEnhSettings();
        this.postMessage({ type: 'enhLoaded', settings } as any);
        // 推送 globalState 中的标签颜色（跨实例同步）
        const savedTagColors = this._context.globalState.get<Record<string, string>>('tagColors');
        if (savedTagColors && Object.keys(savedTagColors).length > 0) {
          this.postMessage({ type: 'tagColorsSync', colors: savedTagColors } as any);
        }
        return;
      }
      case 'requestBridgeInfo': {
        // sidebar webview 启动后主动拉取，避免与 extension 推送竞态
        this.refreshBridgeInfo();
        return;
      }
      case 'enhCommand': {
        // webview 触发命令 → 塞 bridge 队列，等 windsurf-better.js 来轮询取走执行
        const m = message as any;
        if (m.id != null && m.action) {
          this.log(`[enhCommand] → 入队 action=${m.action} id=${m.id}`);
          // 特殊处理：后端直接处理，不经过 bridge
          if (m.action === 'fetch-models') {
            this._handleFetchModels(m.id);
          } else if (m.action === 'test-switch-model') {
            this._handleSwitchModel(m.id, m.payload?.model);
          } else {
            enqueueCommand({ id: m.id, action: m.action, payload: m.payload || {} });
          }
        } else {
          this.log(`[enhCommand] ✗ 字段缺失 id=${(message as any).id} action=${(message as any).action}`);
        }
        return;
      }
      case 'enhSave': {
        // webview 改了设置 → 写盘 + 重写 workbench.html（下次启动用）+ 通过桥实时推送给 windsurf-better.js
        const patch = (message as any).settings || {};
        const merged = mergeEnhSettings(patch);
        // 重新注入 workbench.html（保证下次启动也是新值）
        try {
          ensureEnhancement();
        } catch (err) {
          console.warn('[kite] re-inject after enhSave failed:', err);
        }
        // ACP 解锁会修改 Devin 内置 extension.js；只在用户明确开启该开关时执行。
        // 保存其他增强设置不能顺带打补丁，否则 Devin 安全模式会被绕开。
        if (detectIdeFlavor() === 'devin' && patch.acpUnlock === true) {
          try {
            if (ensureAcpLocalRegistryFallback()) {
              this.log('[enhSave] ACP local registry fallback ensured; reloading connections');
              scheduleAcpConnectionRecovery('acp-local-registry-fallback', 800);
            }
            if (needsAcpUnlockPatch()) {
              this.log('[enhSave] ACP unlock requested; applying Devin extension patch');
              const ok = await applyPatch(this._context);
              this.log(`[enhSave] ACP unlock patch ${ok ? 'applied' : 'failed'}`);
            }
          } catch (err) {
            this.log(`[enhSave] ACP unlock patch failed: ${(err as Error)?.message || err}`);
          }
        }
        // 通过桥实时推送 apply-settings 命令给 windsurf-better.js
        // 这样改设置无需 reload，立即生效（启停 observer / 还原汉化 / 切换 bubbles 主题等）
        try {
          enqueueCommand({ id: Date.now(), action: 'apply-settings', payload: merged });
        } catch (err) {
          console.warn('[kite] bridge push apply-settings failed:', err);
        }
        // 回传保存结果（webview 显示"已实时应用"toast）
        this.postMessage({ type: 'enhSaved', settings: merged } as any);
        // 通知状态栏重新读取配置并重绘
        try { vscode.commands.executeCommand('windsurfPool.statusBarRefresh'); } catch { /* ignore */ }
        return;
      }
      case 'enhForceStop': {
        // 强制停止：发送 force-stop 命令给注入脚本
        try {
          enqueueCommand({ id: Date.now(), action: 'force-stop', payload: {} });
        } catch (err) {
          console.warn('[kite] bridge push force-stop failed:', err);
        }
        return;
      }
      case 'loginSave': {
        const { email, password, batch, authMethod, tag } = message;
        if (!email || !password) {
          if (!batch) {
            this.showAlert('提示', '请输入邮箱和密码', 'warn');
          }
          return;
        }

        const doLogin = async () => {
          const result = await login(email, password, authMethod || 'auto');
          if (result.ok && result.value) {
            if (tag) { result.value.tag = tag; result.value.tags = [tag]; }
            // 保存 importMeta 记录原始密码和导入来源
            result.value.importMeta = {
              source: 'password',
              password: password,
              importedAt: new Date().toISOString(),
              importedFrom: 'login-save',
            };
            const stored = await accountStore.upsertAccount(this._context, result.value);
            const finalEmail = stored.email;
            const aliased = finalEmail !== email;
            if (batch) {
              this.postMessage({ type: 'batchResult', ok: true, email: finalEmail });
              this.refresh();
            } else {
              const tip = aliased
                ? `已另存为新条目（保护旧账号 Devin token）：${finalEmail}`
                : '已登录并保存：' + finalEmail;
              this.showAlert('登录成功', tip, 'info');
              this.refresh();
            }
          } else {
            if (!batch) {
              this.showAlert('登录失败', (result.error || '登录失败') + '：' + email, 'error');
            } else {
              this.postMessage({ type: 'batchResult', ok: false, email, error: result.error });
            }
          }
        };

        if (batch) {
          await doLogin();
        } else {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '登录中… ' + email, cancellable: false },
            doLogin
          );
        }
        break;
      }

      case 'switch': {
        const { email } = message;
        if (!email) return;
        this.log(`[switch][trigger] 手动切号(webview): → ${email}`);

        const accounts = await accountStore.readAccounts(this._context);
        const account = accounts.find(a => a.email === email);
        if (!account) {
          this.showAlert('提示', '账号不存在', 'warn');
          return;
        }

        const prevEmail = this._context.globalState.get<string>('lastEmail') || '';
        const isForce = !!message.force;
        if (isForce) {
          this.log(`[switch][trigger] 强制切号(跨窗口抢占): → ${email}`);
        }
        const success = await injectSession(this._context, account, { force: isForce });
        if (success) {
          this.postMessage({ type: 'switchResult', email, ok: true } as any);
          this._recordDiagnostic(email, 'switch', true, '切换成功');
          clearHealthResult(email);
          this._recordDiagnostic(email, 'health', true, '切换成功，测活已清除');
          this.postMessage({ type: 'testModelResult', email, ok: true, reason: '切换成功，测活已清除', ts: Date.now() } as any);
          this._usageTracker.recordSwitch(email);
          // 跨窗口锁：释放旧号，锁定新号（强制切号时会覆写其他实例的锁）
          if (prevEmail) releaseLock(prevEmail);
          acquireLock(email);
          await accountStore.setCurrentAccount(this._context, email);
          const log = `[${this._tsFmt()}][manual${isForce ? '/force' : ''}] ${prevEmail} → ${email}`;
          this._recordSwitchLog(log, `${isForce ? '强制' : '手动'}切号 → ${email}`);
          // 无感切号：成功不弹任何提示，UI 高亮自动转移即为反馈
          this.refresh();
          this.onManualSwitch?.();
        } else {
          const failure = getLastInjectFailure(email);
          const reason = failure?.reason || '未知原因';
          const title = failure?.kind === 'blocked' ? '账号暂不可用' : '切换失败';
          this.postMessage({ type: 'switchResult', email, ok: false, reason, kind: failure?.kind || 'error', ts: Date.now() } as any);
          this._recordDiagnostic(email, 'switch', false, reason);
          if (failure?.kind !== 'blocked') {
            this.showAlert(title, `${email}\n${reason}`, 'error');
          }
        }
        break;
      }

      case 'delete': {
        const { email } = message;
        if (!email) return;

        const deleted = await accountStore.removeAccount(this._context, email);
        if (deleted) {
          this.refresh();
        }
        break;
      }

      case 'batchDelete': {
        const { emails } = message;
        if (!emails || !emails.length) return;
        const removed = await accountStore.batchRemove(this._context, emails);
        if (removed > 0) {
          this.refresh();
        }
        break;
      }

      case 'updateTag': {
        const { email } = message;
        if (!email) return;
        const tags = (message as any).tags;
        if (Array.isArray(tags)) {
          await accountStore.updateTags(this._context, email, tags);
        } else {
          await accountStore.updateTag(this._context, email, (message as any).tag || '');
        }
        this.refresh(true);
        break;
      }

      case 'toggleDisabled': {
        const { email } = message;
        if (!email) return;
        await accountStore.toggleDisabled(this._context, email);
        this.refresh(true);
        break;
      }

      case 'batchEnable': {
        const { emails } = message;
        if (!emails || !emails.length) return;
        await accountStore.batchSetDisabled(this._context, emails, false);
        this.refresh();
        break;
      }

      case 'batchDisable': {
        const { emails } = message;
        if (!emails || !emails.length) return;
        await accountStore.batchSetDisabled(this._context, emails, true);
        this.refresh();
        break;
      }

      case 'batchTag': {
        const { emails } = message;
        if (!emails || !emails.length) return;
        const tags = (message as any).tags;
        if (Array.isArray(tags)) {
          await accountStore.batchUpdateTags(this._context, emails, tags);
        } else {
          await accountStore.batchUpdateTag(this._context, emails, (message as any).tag || '');
        }
        this.refresh();
        break;
      }

      case 'syncTagColors': {
        const colors = (message as any).colors;
        if (colors && typeof colors === 'object') {
          // 持久化到 globalState（跨窗口共享）
          this._context.globalState.update('tagColors', colors);
          setTagColors(colors);
        }
        break;
      }

      case 'clearHealthRateLimit': {
        // webview 端基于配额或 contextMonitor 判定限速可清除，同步到扩展端 cache
        // 避免下次扩展端推送时被覆盖回限速状态
        const { email, reason } = message as any;
        if (!email) break;
        const hcCache = getHealthCheckCache();
        const hc = hcCache.get(email);
        if (hc && !hc.ok) {
          hcCache.set(email, { ...hc, ok: true, reason: reason || '限速已自动解除', ts: Date.now() });
        }
        break;
      }

      case 'fetchUsageFor': {
        const { email } = message;
        if (!email) return;

        // 优先返回后端缓存（60s 内有效）
        const cached = this._autoSwitcher.getCached(email);
        if (cached && Date.now() - cached.ts < 60_000) {
          this.postMessage({ type: 'usage', email, snapshot: cached.snapshot, error: cached.error });
          break;
        }

        // 缓存过期：后端刷新（结果通过 onUsageUpdate 回调推送）
        await this._autoSwitcher.refreshSingle(email, true);
        break;
      }

      case 'refreshAllUsage': {
        const force = (message as any).force !== false;
        this._autoSwitcher.refreshAll(force).catch(err => this.log(`[refreshAllUsage] error: ${err}`));
        break;
      }

      case 'getUsageStats': {
        this._pushUsageStats();
        break;
      }

      case 'getQuotaHistory': {
        this._pushQuotaHistory((message as any).email);
        break;
      }


      case 'openLogPanel': {
        vscode.commands.executeCommand('windsurfPool.openLogPanel', (message as any).tab);
        break;
      }

      case 'syncRecoveryLogs': {
        const logs = (message as any).logs;
        if (Array.isArray(logs)) {
          this._context.globalState.update('recoveryLogs', logs);
        }
        break;
      }

      case 'syncDiagnoseLogs': {
        const logs = (message as any).logs;
        if (Array.isArray(logs)) {
          this._context.globalState.update('diagnoseLogs', logs);
        }
        break;
      }

      case 'testModel': {
        const { email, modelKey } = message as any;
        if (!email) return;
        this.postMessage({ type: 'testModelResult', email, ok: false, reason: '检测中...', testing: true } as any);
        const result = await testSingleAccount(this._context, email, modelKey);
        const cache = getHealthCheckCache().get(email);
        this.postMessage({ type: 'testModelResult', email, ok: result.ok, reason: result.reason, ts: cache?.ts } as any);
        this._recordDiagnostic(email, 'health', result.ok, result.reason, modelKey || 'Claude Sonnet 4.6', cache?.status);
        break;
      }

      case 'testModelAll': {
        const { modelKey: mKey, modelLabel: mLabel } = message as any;
        const model: ProbeModelInfo | undefined = mKey ? { label: mLabel || mKey, uid: mKey } : undefined;
        this._healthCheckAbort = new AbortController();
        const hcSignal = this._healthCheckAbort.signal;
        setCascadeProbeEnabled(true);
        const accounts = await accountStore.readAccounts(this._context);
        const targets = accounts.filter(a => !a.disabled);
        for (const acc of targets) {
          if (hcSignal.aborted) break;
          this.postMessage({ type: 'testModelResult', email: acc.email, ok: false, reason: '检测中...', testing: true } as any);
          try {
            const result = await testModelAccess(acc, model, hcSignal);
            if (hcSignal.aborted) break;
            const hcCache = getHealthCheckCache();
            hcCache.set(acc.email, { ok: result.ok, reason: result.reason, status: result.status, ts: Date.now() });
            this.postMessage({ type: 'testModelResult', email: acc.email, ok: result.ok, reason: result.reason, ts: Date.now() } as any);
            this._recordDiagnostic(acc.email, 'health', result.ok, result.reason, model?.label || model?.uid || 'Claude Sonnet 4.6', result.status);
          } catch (err: any) {
            if (hcSignal.aborted) break;
            const reason = `异常: ${err?.message || err}`;
            this.postMessage({ type: 'testModelResult', email: acc.email, ok: false, reason, ts: Date.now() } as any);
            this._recordDiagnostic(acc.email, 'health', false, reason, model?.label || model?.uid || 'Claude Sonnet 4.6');
          }
        }
        this._healthCheckAbort = undefined;
        setCascadeProbeEnabled(false);
        stopIsolatedCascadeProbeLs();
        scheduleAcpConnectionRecovery('sidebar-health-check-done', 1500);
        this.postMessage({ type: 'testModelAllDone' } as any);
        break;
      }

      case 'stopHealthCheck': {
        this._healthCheckAbort?.abort();
        break;
      }

      case 'savePoolTags': {
        const m = message as any;
        const tags: string[] = m.poolTags || [];
        await this._context.globalState.update('as.poolTags', tags);
        this.postMessage({ type: 'poolTagsSaved', poolTags: tags } as any);
        break;
      }

      case 'autoSwitchSettings': {
        const m = message as any;
        await this._autoSwitcher.updateSettings({
          enabled: m.enabled,
          threshold: m.threshold,
          checkSec: m.checkSec,
          cooldownSec: m.cooldownSec,
          refreshMin: m.refreshMin,
          refreshConcurrency: m.refreshConcurrency,
          refreshBatchDelayMs: m.refreshBatchDelayMs,
          periodRefreshHours: m.periodRefreshHours,
          scoreMode: m.scoreMode,
          switchStrategy: m.switchStrategy,
          minQuota: m.minQuota,
          preferUsedThreshold: m.preferUsedThreshold,
          poolScope: m.poolScope,
          poolTags: m.poolTags,
        });
        this._pushAutoSwitchSettings();
        break;
      }

      case 'batchLogin': {
        const { email, password, authMethod } = message;
        if (!email || !password) return;

        const result = await login(email, password, authMethod || 'auto');
        if (result.ok && result.value) {
          // 保存 importMeta 记录原始密码和导入来源
          result.value.importMeta = {
            source: 'password',
            password: password,
            importedAt: new Date().toISOString(),
            importedFrom: 'batch-login',
          };
          const stored = await accountStore.upsertAccount(this._context, result.value);
          result.value.email = stored.email; // 下游代码可能还会读它
          this.postMessage({
            type: 'batchResult',
            ok: true,
            email
          });
        } else {
          this.postMessage({
            type: 'batchResult',
            ok: false,
            email,
            error: result.error
          });
        }
        break;
      }

      case 'batchTokenImport': {
        const token = message.token;
        if (!token) return;
        const tokenResult = await loginByAuth1Token(token);
        if (tokenResult.ok && tokenResult.value) {
          if (message.tag) { tokenResult.value.tag = message.tag; tokenResult.value.tags = [message.tag]; }
          // 保存 importMeta 记录原始 token 和导入来源
          tokenResult.value.importMeta = {
            source: 'token',
            rawToken: token,
            importedAt: new Date().toISOString(),
            importedFrom: 'batch-token',
          };
          const stored = await accountStore.upsertAccount(this._context, tokenResult.value);
          this.postMessage({ type: 'batchResult', ok: true, email: stored.email });
          this.refresh();
        } else {
          this.postMessage({ type: 'batchResult', ok: false, email: token.substring(0, 20) + '...', error: tokenResult.error });
        }
        break;
      }

      case 'batchStoredAccountImport': {
        const raw = (message as any).account || {};
        const email = String(raw.email || '').trim();
        const apiKey = String(raw.apiKey || '').trim();
        const apiServerUrl = String(raw.apiServerUrl || '').trim() || 'https://server.self-serve.windsurf.com';
        if (!email || !apiKey) {
          this.postMessage({ type: 'batchResult', ok: false, email: email || '账号配置', error: '缺少 email 或 apiKey' });
          return;
        }
        // 保留原始 importMeta，或创建新的
        const importMeta = raw.importMeta || {
          source: 'file' as const,
          importedAt: new Date().toISOString(),
          importedFrom: 'file-import',
        };
        const storedAcct = await accountStore.upsertAccount(this._context, {
          email,
          apiKey,
          apiServerUrl,
          name: raw.name,
          tag: raw.tag,
          tags: raw.tags || (raw.tag ? [raw.tag] : undefined),
          disabled: raw.disabled === true ? true : undefined,
          devinAuth1Token: raw.devinAuth1Token ? String(raw.devinAuth1Token).trim() : undefined,
          orgId: raw.orgId ? String(raw.orgId).trim() : undefined,
          importMeta,
        });
        this.postMessage({ type: 'batchResult', ok: true, email: storedAcct.email });
        this.refresh();
        break;
      }

      case 'bulkStoreAccounts': {
        // 快速批量存储（全部有 apiKey 的账号，无需登录验证）
        const rows = (message as any).accounts || [];
        const skipped = (message as any).skipped || 0;
        const results: { email: string; ok: boolean; error?: string }[] = [];
        for (const raw of rows) {
          const email = String(raw.email || '').trim();
          const apiKey = String(raw.apiKey || '').trim();
          if (!email || !apiKey) {
            results.push({ email: email || '?', ok: false, error: '缺少 email 或 apiKey' });
            continue;
          }
          try {
            // 保留原始 importMeta，或创建新的
            const importMeta = raw.importMeta || {
              source: 'file' as const,
              importedAt: new Date().toISOString(),
              importedFrom: 'bulk-store',
            };
            await accountStore.upsertAccount(this._context, {
              email,
              apiKey,
              apiServerUrl: String(raw.apiServerUrl || 'https://server.self-serve.windsurf.com').trim(),
              name: raw.name,
              tag: raw.tag,
              tags: raw.tags || (raw.tag ? [raw.tag] : undefined),
              disabled: raw.disabled === true ? true : undefined,
              devinAuth1Token: raw.devinAuth1Token ? String(raw.devinAuth1Token).trim() : undefined,
              orgId: raw.orgId ? String(raw.orgId).trim() : undefined,
              importMeta,
            });
            results.push({ email, ok: true });
          } catch (e: any) {
            results.push({ email, ok: false, error: e.message });
          }
        }
        this.postMessage({ type: 'bulkStoreResult', results, skipped } as any);
        this.refresh();
        break;
      }

      case 'exportAccounts': {
        const accounts = await accountStore.readAccounts(this._context);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const payload = {
          type: 'kite-accounts',
          version: 1,
          exportedAt: new Date().toISOString(),
          accounts,
        };
        const text = JSON.stringify(payload, null, 2);
        try { await vscode.env.clipboard.writeText(text); } catch {}
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(process.env.USERPROFILE || '', 'Desktop', `kite-accounts-${stamp}.json`)),
          filters: { JSON: ['json'] },
          saveLabel: '导出账号设置',
        });
        if (!uri) {
          this.postMessage({ type: 'exportAccountsResult', ok: true, copied: true, saved: false, count: accounts.length, message: `已复制 ${accounts.length} 个账号到剪贴板` } as any);
          break;
        }
        await fs.promises.writeFile(uri.fsPath, text, 'utf8');
        this.postMessage({ type: 'exportAccountsResult', ok: true, copied: true, saved: true, count: accounts.length, path: uri.fsPath, message: `已导出 ${accounts.length} 个账号` } as any);
        break;
      }

      case 'exportSelectedAccounts': {
        const emails: string[] = (message as any).emails || [];
        if (emails.length === 0) {
          this.postMessage({ type: 'exportAccountsResult', ok: false, message: '未选择账号' } as any);
          break;
        }
        const allAccounts = await accountStore.readAccounts(this._context);
        const emailSet = new Set(emails.map(e => e.toLowerCase()));
        const selected = allAccounts.filter(a => emailSet.has(a.email.toLowerCase()));
        if (selected.length === 0) {
          this.postMessage({ type: 'exportAccountsResult', ok: false, message: '未找到选中的账号' } as any);
          break;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const payload = {
          type: 'kite-accounts',
          version: 1,
          exportedAt: new Date().toISOString(),
          accounts: selected,
        };
        const text = JSON.stringify(payload, null, 2);
        try { await vscode.env.clipboard.writeText(text); } catch {}
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', `kite-accounts-${stamp}.json`)),
          filters: { JSON: ['json'] },
          saveLabel: '导出选中账号',
        });
        if (!uri) {
          this.postMessage({ type: 'exportAccountsResult', ok: true, copied: true, saved: false, count: selected.length, message: `已复制 ${selected.length} 个账号到剪贴板` } as any);
          break;
        }
        await fs.promises.writeFile(uri.fsPath, text, 'utf8');
        this.postMessage({ type: 'exportAccountsResult', ok: true, copied: true, saved: true, count: selected.length, path: uri.fsPath, message: `已导出 ${selected.length} 个账号` } as any);
        break;
      }

      case 'exportAccountsV2': {
        const { emails, format, copyClipboard } = message as unknown as { emails: string[]; format: 'json' | 'text'; copyClipboard: boolean };
        if (!emails || emails.length === 0) {
          this.postMessage({ type: 'exportAccountsResult', ok: false, message: '未选择账号' } as any);
          break;
        }
        const allAccounts = await accountStore.readAccounts(this._context);
        const emailSet = new Set(emails.map(e => e.toLowerCase()));
        const selected = allAccounts.filter(a => emailSet.has(a.email.toLowerCase()));
        if (selected.length === 0) {
          this.postMessage({ type: 'exportAccountsResult', ok: false, message: '未找到选中的账号' } as any);
          break;
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        let text: string;
        let ext: string;
        let filterName: string;

        if (format === 'text') {
          // 文本格式: email----password----token
          const lines: string[] = [];
          for (const acc of selected) {
            const password = acc.importMeta?.password || '';
            const rawToken = acc.importMeta?.rawToken || acc.devinAuth1Token || '';
            if (password || rawToken) {
              lines.push(`${acc.email}----${password}----${rawToken}`);
            } else {
              lines.push(acc.email);
            }
          }
          text = lines.join('\n');
          ext = 'txt';
          filterName = '文本文件';
        } else {
          // JSON 完整格式
          const payload = {
            type: 'kite-accounts',
            version: 2,
            exportedAt: new Date().toISOString(),
            accounts: selected,
          };
          text = JSON.stringify(payload, null, 2);
          ext = 'json';
          filterName = 'JSON 文件';
        }

        if (copyClipboard) {
          try { await vscode.env.clipboard.writeText(text); } catch {}
        }

        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', `kite-${stamp}.${ext}`)),
          filters: { [filterName]: [ext] },
          saveLabel: '导出账号',
        });

        if (!uri) {
          const msg = copyClipboard ? `已复制 ${selected.length} 个账号到剪贴板` : '已取消导出';
          this.postMessage({ type: 'exportAccountsResult', ok: true, copied: copyClipboard, saved: false, count: selected.length, message: msg } as any);
          break;
        }

        await fs.promises.writeFile(uri.fsPath, text, 'utf8');
        this.postMessage({ type: 'exportAccountsResult', ok: true, copied: copyClipboard, saved: true, count: selected.length, path: uri.fsPath, message: `已导出 ${selected.length} 个账号` } as any);
        break;
      }

      case 'importAccountsFile': {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { 'JSON 文件': ['json'] },
          openLabel: '导入账号',
        });
        if (!uris || uris.length === 0) {
          this.postMessage({ type: 'importAccountsFileResult', ok: false, message: '未选择文件' } as any);
          break;
        }
        try {
          const content = await fs.promises.readFile(uris[0].fsPath, 'utf8');
          const data = JSON.parse(content);
          const rows = Array.isArray(data) ? data : (Array.isArray(data.accounts) ? data.accounts : null);
          if (!rows || rows.length === 0) {
            this.postMessage({ type: 'importAccountsFileResult', ok: false, message: 'JSON 文件格式不正确或无账号数据' } as any);
            break;
          }
          this.postMessage({ type: 'importAccountsFileResult', ok: true, accounts: rows, message: `已读取 ${rows.length} 个账号，开始导入…` } as any);
        } catch (e: any) {
          this.postMessage({ type: 'importAccountsFileResult', ok: false, message: `读取文件失败: ${e.message}` } as any);
        }
        break;
      }

      case 'oauthLogin': {
        this.postMessage({ type: 'oauthStatus', phase: 'opening', message: '正在打开 Windsurf OAuth 授权页…' } as any);
        try {
          const account = await loginByWindsurfOAuth();
          const oauthTag = (message as any).tag;
          if (oauthTag) { account.tag = oauthTag; account.tags = [oauthTag]; }
          // 保存 importMeta 记录 OAuth 导入来源
          account.importMeta = {
            source: 'oauth',
            importedAt: new Date().toISOString(),
            importedFrom: 'oauth-login',
          };
          const originalEmail = account.email;
          const stored = await accountStore.upsertAccount(this._context, account);
          const finalEmail = stored.email;
          const aliased = finalEmail !== originalEmail;
          const okMsg = aliased
            ? `OAuth 已另存为新条目（保护旧账号 Devin token）：${finalEmail}`
            : `OAuth 导入成功：${finalEmail}`;
          this.postMessage({ type: 'oauthStatus', ok: true, email: finalEmail, message: okMsg } as any);
          this.refresh();
        } catch (err: any) {
          this.postMessage({ type: 'oauthStatus', ok: false, message: err?.message || String(err) } as any);
        }
        break;
      }

      case 'runCommand': {
        const { command, args } = message as { command: string; args?: any[] };
        if (command) {
          if (command === 'revealFileInOS' && args?.[0]) {
            // 打开文件所在文件夹并选中文件
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(args[0]));
          } else if (args && args.length > 0) {
            vscode.commands.executeCommand(command, ...args);
          } else {
            vscode.commands.executeCommand(command);
          }
        }
        break;
      }

      case 'openExternal': {
        const { url, uri } = message as { url?: string; uri?: string };
        if (uri) {
          // 打开本地文件
          vscode.env.openExternal(vscode.Uri.file(uri));
        } else if (url) {
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
        break;
      }

      case 'addCurrent': {
        await this.handleAddCurrent();
        break;
      }

      case 'alertResponse': {
        const cb = this._alertCallbacks.get(message.id!);
        if (cb) {
          this._alertCallbacks.delete(message.id!);
          cb(message.action ?? null);
        }
        break;
      }

      case 'getEnhancementStatus': {
        this._pushEnhancementStatus();
        break;
      }

      case 'togglePreflightCheck': {
        const current = vscode.workspace.getConfiguration('windsurfPool').get<boolean>('preflightSwitchCheck', true);
        const next = !current;
        await vscode.workspace.getConfiguration('windsurfPool').update('preflightSwitchCheck', next, vscode.ConfigurationTarget.Global);
        this._pushPreflightSetting();
        this.log(`[settings] 切号预检 ${next ? '已开启' : '已关闭'}`);
        break;
      }

      case 'resetMachineId': {
        await resetMachineId();
        break;
      }

      case 'toggleEnhancement': {
        const current = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', false);
        const next = !current;
        await vscode.workspace.getConfiguration('windsurfPool.enhancement').update('enabled', next, vscode.ConfigurationTarget.Global);

        // 真正启用/关闭：操作文件而非仅改配置
        const { ensureEnhancement, restoreWorkbench } = await import('./enhancementInjector');
        const { injectBubbleRules, removeBubbleRules, injectScriptDisciplineRules, removeScriptDisciplineRules } = await import('./rulesInjector');
        let fileChanged = false;
        try {
          if (next) {
            // 启用：注入 workbench.html + 注入增强相关规则（气泡+脚本纪律）
            const r = ensureEnhancement();
            if (r.injected && r.needRestart) fileChanged = true;
            injectBubbleRules();
            injectScriptDisciplineRules();
          } else {
            // 关闭：恢复 workbench.html + 移除增强相关规则
            if (restoreWorkbench()) fileChanged = true;
            removeBubbleRules();
            removeScriptDisciplineRules();
          }
        } catch (err) {
          console.error('[kite] toggleEnhancement file op failed:', err);
        }

        this._pushEnhancementStatus();
        const label = next ? '已启用' : '已关闭';
        const msg = fileChanged
          ? `${getIdeDisplayName()} 增强${label}，需要重载窗口才能生效。`
          : `${getIdeDisplayName()} 增强${label}。`;
        const action = await vscode.window.showInformationMessage(msg, '立即重载');
        if (action === '立即重载') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        break;
      }

      // ── 多实例管理 ──
      case 'instanceList': {
        try {
          const instances = await instanceManager.listInstances();
          // 将当前窗口的活跃账号同步到 instances.json（供其他窗口读取）
          const currentEmail = this._context.globalState.get<string>('lastEmail') || '';
          if (currentEmail) {
            const myInst = instances.find(i => i.current);
            if (myInst && myInst.bindEmail === '__auto__' && !myInst.currentEmail) {
              myInst.currentEmail = currentEmail;
            }
            if (myInst && myInst.bindEmail !== currentEmail && myInst.bindEmail !== '__auto__') {
              myInst.bindEmail = currentEmail;
              instanceManager.syncCurrentInstanceEmail(currentEmail);
            }
          }
          const hasUnimported = instanceManager.hasUnimportedCockpitInstances();
          this.postMessage({ type: 'instanceListResult', instances, hasUnimported });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceCreate': {
        const { instanceName, email, assignedTag } = message;
        if (!instanceName || !email) {
          this.postMessage({ type: 'instanceError', error: '名称和绑定账号不能为空' });
          return;
        }
        try {
          this.postMessage({ type: 'instanceProgress', message: '正在复制 Windsurf 数据目录…' });
          const newInst = await instanceManager.createInstance({
            name: instanceName,
            bindEmail: email,
            onProgress: (msg) => {
              this.postMessage({ type: 'instanceProgress', message: msg });
            }
          });
          if (assignedTag) {
            try { instanceManager.updateInstanceTag(newInst.id, assignedTag); } catch (e) { console.warn('[instanceCreate] set tag failed:', e); }
          }
          this.postMessage({ type: 'instanceProgress', message: '实例创建完成', done: true });
          // 刷新列表
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceProgress', message: String(err), done: true, error: true });
        }
        break;
      }

      case 'instanceDelete': {
        const { instanceId } = message;
        if (!instanceId) return;
        try {
          instanceManager.deleteInstance(instanceId);
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceStart': {
        const { instanceId } = message;
        if (!instanceId) return;
        try {
          this.postMessage({ type: 'instanceProgress', message: '正在启动实例…' });
          await instanceManager.startInstance(instanceId);
          this.postMessage({ type: 'instanceProgress', message: '实例已启动 ✓', done: true });
          // 稍等后刷新状态（让进程完全启动）
          setTimeout(async () => {
            try {
              const instances = await instanceManager.listInstances();
              this.postMessage({ type: 'instanceListResult', instances });
            } catch {}
          }, 3000);
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceFocus': {
        const { instanceId } = message;
        if (!instanceId) return;
        try {
          await instanceManager.focusInstance(instanceId);
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceStop': {
        const { instanceId } = message;
        if (!instanceId) return;
        try {
          this.postMessage({ type: 'instanceProgress', message: '正在优雅关闭实例…' });
          await instanceManager.stopInstance(instanceId);
          this.postMessage({ type: 'instanceProgress', message: '实例已停止', done: true });
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceUpdate': {
        const { instanceId, instanceName, email, assignedTag } = message;
        if (!instanceId) return;
        try {
          if (instanceName) {
            instanceManager.updateInstanceName(instanceId, instanceName);
          }
          if (email) {
            instanceManager.updateInstanceBind(instanceId, email);
          }
          if (assignedTag !== undefined) {
            instanceManager.updateInstanceTag(instanceId, assignedTag || undefined);
          }
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      // ── Cockpit Tools 导入 ──
      case 'cockpitList': {
        try {
          const instances = instanceManager.listCockpitInstances();
          this.postMessage({ type: 'cockpitListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      // ── 完成提醒：浏览音频文件 ──
      case 'browseAudioFile': {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { '音频文件': ['wav', 'mp3', 'ogg', 'flac'] },
          title: '选择提醒音频文件',
        });
        if (uris && uris.length > 0) {
          this.postMessage({ type: 'audioFileSelected', path: uris[0].fsPath } as any);
        }
        break;
      }

      // ── 完成提醒：系统声音播放 ──
      case 'playNotifySound': {
        const d = (message as any).data || {};
        this._playNotifyOnce(d.tone || 'funk', d.repeat || 2, d.customTone, d.audioFile, d.sound !== false, !!d.desktop, d.title, d.body);
        break;
      }

      // ── Windsurf 增强：信号桥接 ──
      case 'poolSignal': {
        const signal = (message as any).data as PoolSignal;
        if (!signal || !signal.ts) break;
        await handlePoolSignal(signal, this._autoSwitcher, (result) => {
          this.postMessage({ type: 'poolResult', data: result } as any);
        });
        break;
      }

      case 'cockpitImport': {
        const { cockpitId, instanceName, email } = message;
        if (!cockpitId || !instanceName || !email) {
          this.postMessage({ type: 'instanceError', error: '参数不完整' });
          return;
        }
        try {
          this.postMessage({ type: 'instanceProgress', message: '正在导入 Cockpit 实例…' });
          await instanceManager.importCockpitInstance(cockpitId, instanceName, email);
          this.postMessage({ type: 'instanceProgress', message: '导入完成', done: true });
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
          // 刷新 Cockpit 列表中的 imported 状态
          const cockpitInstances = instanceManager.listCockpitInstances();
          this.postMessage({ type: 'cockpitListResult', instances: cockpitInstances });
        } catch (err) {
          this.postMessage({ type: 'instanceProgress', message: String(err), done: true, error: true });
        }
        break;
      }
    }
  }

  /**
   * 从 Windsurf 当前已登录账户导入到号池
   * 复用 detectCurrentWindsurfAccount 获取 session 信息
   */
  private async handleAddCurrent(): Promise<void> {
    // 最多等待 15 秒，等 Windsurf 内置扩展就绪
    let apiKey = '';
    let accountLabel = '';
    let detectedApiServerUrl = '';
    let lastDiag: { patchRegistered: boolean; patchResult: string; authLabel: string; sessionResult: string } | undefined;
    for (let i = 0; i < 15; i++) {
      const result = await this.detectCurrentWindsurfAccount();
      apiKey = result.token;
      accountLabel = result.label;
      detectedApiServerUrl = result.apiServerUrl || '';
      lastDiag = result.diag;
      if (apiKey) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!apiKey) {
      // 输出详细诊断到 OutputChannel
      const d = lastDiag!;
      this.log(`[添加当前] 检测失败，诊断信息:`);
      this.log(`  补丁命令已注册: ${d.patchRegistered}`);
      this.log(`  补丁结果: ${d.patchResult}`);
      this.log(`  Auth API: ${d.authLabel}`);
      this.log(`  Session API: ${d.sessionResult}`);

      // 生成用户可理解的具体原因
      let reason: string;
      if (!d.patchRegistered) {
        reason = '补丁命令未注册 — 请先执行「应用补丁」并重启 Windsurf。';
      } else if (d.patchResult.startsWith('error') || d.patchResult.startsWith('exception')) {
        reason = `补丁命令执行出错: ${d.patchResult}\n请尝试重新「应用补丁」并重启。`;
      } else if (d.patchResult === 'empty-response') {
        reason = '补丁命令返回空 — 可能补丁版本不匹配，请重新「应用补丁」。';
      } else {
        reason = 'Windsurf 账户 Session 尚未就绪 — 请确认已登录 Windsurf 账号，稍后再试。';
      }

      this.showConfirm('检测失败', reason, ['重试', '查看日志', '取消'], 'warn').then(action => {
        if (action === '重试') { this.handleAddCurrent(); }
        if (action === '查看日志') { this.showLog(); }
      });
      return;
    }

    const email = accountLabel.includes('@') ? accountLabel : (accountLabel || 'user') + '@windsurf.local';

    // 检查是否重复
    const existing = await accountStore.readAccounts(this._context);
    const dup = existing.find(a => a.email === email);
    if (dup) {
      const action = await this.showConfirm('确认', `账号 ${email} 已在号池中，是否更新其 Session？`, ['更新', '取消'], 'warn');
      if (action !== '更新') return;
    }

    // 优先使用补丁命令返回的真实 apiServerUrl，回退到默认 codeium
    const account: any = {
      email,
      apiKey,
      apiServerUrl: detectedApiServerUrl || 'https://server.codeium.com',
      name: accountLabel || '',
      // 保存 importMeta 记录从当前会话导入
      importMeta: {
        source: 'session',
        importedAt: new Date().toISOString(),
        importedFrom: 'add-current',
      },
    };

    const stored = await accountStore.upsertAccount(this._context, account);
    const finalEmail = stored.email;
    const aliased = finalEmail !== email; // upsert 智能策略可能把它另存为 email#oauth
    // 加入后设为当前账户（因为这就是 Windsurf 实际登录的号）
    await accountStore.setCurrentAccount(this._context, finalEmail);
    const tip = aliased
      ? `已另存为新条目（保留旧账号 Devin token）：${finalEmail}`
      : (dup ? '已更新并设为当前：' : '已添加并设为当前：') + finalEmail;
    this.showAlert('添加成功', tip, 'info');
    this.refresh();
  }

  /**
   * 发送消息到 webview
   */
  private postMessage(message: BackendMessage): void {
    this._view?.webview.postMessage(message);
  }

  // 通用 webview 弹窗（无需回调）
  private showAlert(title: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this._view?.webview.postMessage({ type: 'showAlert', title, message, level });
  }

  // 通用 webview 确认弹窗（需要回调）
  private _alertCallbacks = new Map<string, (action: string | null) => void>();
  private showConfirm(title: string, message: string, buttons: string[], level: 'info' | 'warn' | 'error' = 'warn'): Promise<string | null> {
    return new Promise(resolve => {
      const id = 'alert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      this._alertCallbacks.set(id, resolve);
      this._view?.webview.postMessage({ type: 'showAlert', id, title, message, level, buttons });
      // 超时兜底
      setTimeout(() => {
        if (this._alertCallbacks.has(id)) {
          this._alertCallbacks.delete(id);
          resolve(null);
        }
      }, 60000);
    });
  }

  /**
   * 检测 Windsurf 当前登录的账户（优先补丁命令，回退 auth API）
   */
  private async detectCurrentWindsurfAccount(): Promise<{
    token: string; label: string; apiServerUrl?: string;
    diag: { patchRegistered: boolean; patchResult: string; authLabel: string; sessionResult: string };
  }> {
    let token = '';
    let label = '';
    let apiServerUrl = '';
    const diag = { patchRegistered: false, patchResult: '', authLabel: '', sessionResult: '' };

    // 1. 补丁命令（最可靠，直接返回邮箱、apiKey 和 apiServerUrl）
    try {
      const cmds = await vscode.commands.getCommands(true);
      if (cmds.includes('windsurf.exportCurrentSessionWithShit')) {
        diag.patchRegistered = true;
        const r: any = await vscode.commands.executeCommand('windsurf.exportCurrentSessionWithShit');
        if (r && !r.error) {
          if (r.apiKey) token = r.apiKey;
          if (r.email) label = r.email;
          if (r.apiServerUrl) apiServerUrl = r.apiServerUrl;
          diag.patchResult = token ? 'ok' : `no-apiKey(email=${r.email || 'none'})`;
        } else {
          diag.patchResult = r?.error ? `error: ${r.error}` : 'empty-response';
        }
      } else {
        diag.patchResult = 'command-not-registered';
      }
    } catch (e: any) {
      diag.patchResult = `exception: ${e?.message || e}`;
    }

    // 2. getAccounts（VS Code 1.85+，兜底拿 label）
    if (!label) {
      try {
        const api = vscode.authentication as any;
        if (typeof api.getAccounts === 'function') {
          const accts = await api.getAccounts('windsurf_auth');
          if (accts?.length) {
            label = accts[0].label || accts[0].id || '';
            diag.authLabel = label || 'empty-label';
          } else {
            diag.authLabel = 'no-accounts';
          }
        } else {
          diag.authLabel = 'api-unavailable';
        }
      } catch (e: any) {
        diag.authLabel = `exception: ${e?.message || e}`;
      }
    } else {
      diag.authLabel = 'skipped(from-patch)';
    }

    // 3. getSession 多 scope 尝试（兜底拿 token）
    if (!token) {
      const scopeSets: string[][] = [['login'], ['login', 'onboarding'], [], ['LOGIN']];
      const failures: string[] = [];
      for (const scopes of scopeSets) {
        try {
          const s = await vscode.authentication.getSession('windsurf_auth', scopes, { createIfNone: false });
          if (s?.accessToken) {
            token = s.accessToken;
            if (!label) label = s.account.label || s.account.id || '';
            diag.sessionResult = `ok(scope=${JSON.stringify(scopes)})`;
            break;
          } else {
            failures.push(`[${scopes.join(',')||'empty'}]:no-token`);
          }
        } catch (e: any) {
          failures.push(`[${scopes.join(',')||'empty'}]:${e?.message || e}`);
        }
      }
      if (!token) diag.sessionResult = failures.join('; ') || 'all-scopes-failed';
    } else {
      diag.sessionResult = 'skipped(from-patch)';
    }

    return { token, label, apiServerUrl, diag };
  }

  /**
   * 刷新 webview
   */
  async refresh(skipAuth = false): Promise<void> {
    if (!this._view) return;

    const accounts = await accountStore.readAccounts(this._context);
    const poolLastEmail = this._context.globalState.get<string>('lastEmail') || '';

    let activeEmail = poolLastEmail;
    let externalAccount = '';

    if (!skipAuth) {
      const { token: realToken, label: realLabel } = await this.detectCurrentWindsurfAccount();

      if (realToken || realLabel) {
        const tokenMatch = realToken ? accounts.find(a => a.apiKey === realToken) : null;
        const emailMatch = realLabel ? accounts.find(a =>
          a.email === realLabel ||
          a.name === realLabel ||
          a.email === realLabel + '@windsurf.local'
        ) : null;
        const poolMatch = poolLastEmail ? accounts.find(a => a.email === poolLastEmail) : null;

        if (tokenMatch) {
          activeEmail = tokenMatch.email;
        } else if (emailMatch) {
          activeEmail = emailMatch.email;
        } else if (realLabel && realLabel.includes('@')) {
          // 拿到真实邮箱且号池里没有 → 外部账户
          activeEmail = '';
          externalAccount = realLabel;
        } else if (poolMatch) {
          // realLabel 不是邮箱（如显示名）→ 回退 poolLastEmail
          activeEmail = poolMatch.email;
        }

        // 仅当 poolLastEmail 不在号池中（账号被删除等）时才允许覆盖
        // 否则信任号池的 lastEmail（启动时已 re-inject，Windsurf 旧 auth 状态不应覆盖号池）
        if (activeEmail && poolLastEmail !== activeEmail) {
          if (!poolMatch) {
            await accountStore.setCurrentAccount(this._context, activeEmail);
          } else {
            // 号池 lastEmail 仍有效，保持不变，用号池的值
            activeEmail = poolLastEmail;
          }
        }
      }
    }

    // 跨窗口锁：获取被其他窗口占用的账号
    const lockedEmails = [...getOtherLockedEmails()];
    const lockedEmailsMap = getOtherLockedEmailsMap();

    this.postMessage({
      type: 'accountsChanged',
      accounts,
      lastEmail: activeEmail,
      externalAccount,
      lockedEmails,
      lockedEmailsMap
    });

    // 同步当前实例邮箱到 instances.json（refresh 后 activeEmail 才可靠）
    if (activeEmail) {
      try {
        instanceManager.syncCurrentInstanceEmail(activeEmail);
        const instances = await instanceManager.listInstances();
        const myInst = instances.find(i => i.current);
        if (myInst && !myInst.bindEmail) {
          myInst.bindEmail = activeEmail;
        }
        // __auto__ 模式下不覆盖显示值（卡片会显示"自动切号"）
        this.postMessage({ type: 'instanceListResult', instances });
      } catch {}
    }

    // 推送已有的测活缓存，让卡片 badge 在刷新后保持
    const hcCache = getHealthCheckCache();
    if (hcCache.size > 0) {
      for (const [email, entry] of hcCache) {
        this.postMessage({ type: 'testModelResult', email, ok: entry.ok, reason: entry.reason, ts: entry.ts } as any);
      }
    }
    this._pushDiagnosticSync();
  }

  /**
   * 生成 webview HTML
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const ideName = getIdeDisplayName();
    const isDevin = detectIdeFlavor() === 'devin';
    const extVersion = (vscode.extensions.getExtension('local.windsurf-pool') || vscode.extensions.getExtension('local.kite'))?.packageJSON?.version || '0.0.0';
    const cssUri = `${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'main.css'))}?v=${extVersion}`;
    const jsUri = `${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'main.js'))}?v=${extVersion}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="app">
    <div class="app-tabs" id="appTabs" role="tablist">
      <button type="button" class="app-tab active" data-tab="account" role="tab" aria-selected="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        账户
      </button>
      <button type="button" class="app-tab" data-tab="instance" role="tab" aria-selected="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        实例
      </button>
      <button type="button" class="app-tab" data-tab="automation" role="tab" aria-selected="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="2"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M12 3v3"/><circle cx="12" cy="3" r="1"/><path d="M2 13v3"/><path d="M22 13v3"/><path d="M2 16h2"/><path d="M20 16h2"/></svg>
        自动化
      </button>
      <button type="button" class="app-tab" data-tab="enhance" role="tab" aria-selected="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        增强
      </button>
      <button type="button" class="app-tab" data-tab="byok" role="tab" aria-selected="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2a10 10 0 0 0-10 10c0 5.5 4.5 10 10 10s10-4.5 10-10A10 10 0 0 0 12 2Zm0 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 12.5c-2.5 0-4.7-1.3-6-3.2.3-2 4-3.1 6-3.1s5.7 1.1 6 3.1c-1.3 2-3.5 3.2-6 3.2Z"/></svg>
        BYOK
      </button>
    </div>

    <div class="tab-page" id="tab-enhance" data-tab-page="enhance" role="tabpanel">
    <div class="split-card" id="enhanceSplitCard">
      <div class="split-sidebar">
        <button type="button" class="split-sidebar-item active" data-pane="core">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.9 2.5 3.7 13.2A1.5 1.5 0 0 0 4.8 15H11l-1 6.2a1 1 0 0 0 1.75.78L21.9 9.8A1.5 1.5 0 0 0 20.75 7H14l1.65-3.45a1 1 0 0 0-1.75-1.05Z"/></svg>
          <span>核心增强</span>
        </button>
        <button type="button" class="split-sidebar-item" data-pane="bubble">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.33 14.22l-.58 2.66a1 1 0 0 0 1.24 1.17l2.56-.74A9 9 0 1 0 12 3Zm4.55 7.95-4.7 4.7a1 1 0 0 1-1.42 0l-2.35-2.36 1.42-1.41 1.64 1.64 3.99-3.99 1.42 1.42Z"/></svg>
          <span>回复建议</span>
        </button>
        <button type="button" class="split-sidebar-item" data-pane="statusbar">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 12h3a1 1 0 0 1 1 1v7H3v-7a1 1 0 0 1 1-1Zm7-4h3a1 1 0 0 1 1 1v11h-5V9a1 1 0 0 1 1-1Zm7-4h3a1 1 0 0 1 1 1v15h-5V5a1 1 0 0 1 1-1Z"/></svg>
          <span>状态栏</span>
        </button>
        <button type="button" class="split-sidebar-item" data-pane="notify">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a6 6 0 0 0-6 6v3.3c0 2.2-.86 3.75-1.72 4.8A1.2 1.2 0 0 0 5.2 18h13.6a1.2 1.2 0 0 0 .92-1.9C18.86 15.05 18 13.5 18 11.3V8a6 6 0 0 0-6-6Z"/><path d="M9.8 20a2.3 2.3 0 0 0 4.4 0H9.8Z"/></svg>
          <span>完成提醒</span>
        </button>
        <button type="button" class="split-sidebar-item" data-pane="i18n">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>
          <span>界面汉化</span>
        </button>
      </div>
      <div class="split-content active" data-pane-content="core">
    <!-- Windsurf 增强面板（顶部，默认折叠） -->
    <div class="card enhance-card" id="enhanceArea">
      <details class="enhance-details" id="enhanceDetails" open>
        <summary class="enhance-summary">
          <svg class="enhance-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.9 2.5 3.7 13.2A1.5 1.5 0 0 0 4.8 15H11l-1 6.2a1 1 0 0 0 1.75.78L21.9 9.8A1.5 1.5 0 0 0 20.75 7H14l1.65-3.45a1 1 0 0 0-1.75-1.05Z"/></svg>
          <span class="enhance-title">${ideName} 增强</span>
          <span class="enhance-arrow"></span>
          <button class="enhance-toggle-btn" id="enhanceToggleBtn">未启用</button>
        </summary>
        <div class="enhance-body">
          <!-- 状态信息 -->
          <div data-enhance-page="core" style="display:flex;flex-direction:column;gap:4px">
            <div class="v2-status-row">
              <span class="v2-status-label">增强脚本</span>
              <span class="v2-status-val" id="enhanceScriptStatus">检测中…</span>
            </div>
            <div class="v2-status-row">
              <span class="v2-status-label">智能建议规则</span>
              <span class="v2-status-val" id="enhanceBubbleRules">检测中…</span>
            </div>
            <div class="v2-status-row">
              <span class="v2-status-label">无感切号</span>
              <span class="v2-status-val" id="enhanceSignalBridge">检测中…</span>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div data-enhance-page="core" style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="v2-btn b-blue" id="enhanceReinjectBtn" title="重新注入增强脚本到 workbench.html">重新注入</button>
            <button class="v2-btn b-ghost" id="enhanceInjectRulesBtn" title="修改系统提示词（~/.windsurfrules）">修改提示词</button>
            <button class="v2-btn b-danger-outline" id="enhanceRestoreBtn" title="恢复原始 workbench.html">恢复原始</button>
            <button class="v2-btn b-ghost" id="enhResetMachineIdBtn" title="重置 Windsurf 机器码（machineId / sqmId / devDeviceId），需完全关闭后重启" style="color:#f59e0b">重置机器码</button>
          </div>

          <div class="v2-divider"></div>

          <!-- 侧栏面板 -->
          <div id="enhSectionSidebar" data-enhance-page="core">
            <div class="v2-section-title">侧栏面板</div>
            <div class="v2-strip">
              <div class="v2-strip-band c-blue"></div>
              <div class="v2-strip-info">
                <span class="v2-strip-name">显示测活面板</span>
                <span class="v2-strip-desc">在侧栏底部显示「测活面板」入口（默认关闭）</span>
              </div>
              <div class="v2-mini-toggle" id="enhShowHealthPanelToggle" data-target="enhShowHealthPanel"></div>
              <input type="checkbox" id="enhShowHealthPanel" hidden>
            </div>
          </div>

          <div class="v2-divider"></div>

          <!-- 回复建议提示设置 -->
          <div id="enhSectionBubble" data-enhance-page="bubble" hidden>
            <div class="v2-section-title">回复建议提示</div>
            <div class="v2-note" style="margin:4px 0 10px;padding:8px 12px;background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.1));border-radius:6px;font-size:12px;line-height:1.6;color:var(--vscode-descriptionForeground,#888)">
              <b>⚠️ 使用前提：</b>需要在 ${ideName} 的 <b>Global Rules</b>（全局提示词）中添加气泡规则，AI 才会在回复末尾输出 <code>:::bubbles</code> 标记。<br>
              点击上方「修改提示词」即可一键注入规则到全局提示词文件（<code>~/.windsurfrules</code>）。
            </div>
            <div class="v2-strip">
              <div class="v2-strip-band c-emerald"></div>
              <div class="v2-strip-info">
                <span class="v2-strip-name">启用回复建议</span>
                <span class="v2-strip-desc">AI 回复后显示建议操作气泡</span>
              </div>
              <div class="v2-mini-toggle is-on" id="enhBubblesEnabledToggle" data-target="enhBubblesEnabled"></div>
              <input type="checkbox" id="enhBubblesEnabled" checked hidden>
            </div>
            <div class="v2-strip">
              <div class="v2-strip-band c-cyan"></div>
              <div class="v2-strip-info">
                <span class="v2-strip-name">点击后自动发送</span>
                <span class="v2-strip-desc">选择建议后直接发送，无需手动确认</span>
              </div>
              <div class="v2-mini-toggle is-on" id="enhBubblesAutoSendToggle" data-target="enhBubblesAutoSend"></div>
              <input type="checkbox" id="enhBubblesAutoSend" checked hidden>
            </div>

            <div class="v2-opt-row" style="margin-top:8px">
              <span class="v2-opt-label">主题</span>
              <select class="v2-sel" id="enhBubblesTheme" style="flex:1">
                <option value="emerald">绿青蓝（翡翠）</option>
                <option value="aurora">紫粉（极光）</option>
                <option value="sunset">橙红（日落）</option>
                <option value="ocean">深蓝（海洋）</option>
                <option value="glass">透明（毛玻璃）</option>
                <option value="dark">暗夜</option>
              </select>
            </div>
            <div class="v2-opt-row">
              <span class="v2-opt-label">形状</span>
              <select class="v2-sel" id="enhBubblesShape" style="flex:1">
                <option value="pill">胶囊</option>
                <option value="rounded" selected>圆角</option>
                <option value="soft">柔和</option>
                <option value="sharp">直角</option>
              </select>
            </div>
            <!-- 气泡预览 -->
            <div class="bubble-preview">
              <div class="bubble-preview-label">预览效果</div>
              <div class="bubble-preview-container" id="bubblePreviewContainer">
                <div class="bubble-preview-item" id="bubblePreview1">添加单元测试</div>
                <div class="bubble-preview-item" id="bubblePreview2">优化错误处理</div>
                <div class="bubble-preview-item" id="bubblePreview3">重构为组件化</div>
              </div>
            </div>
          </div>

          <div class="v2-divider"></div>

          <!-- 界面汉化 -->
          <div class="v2-strip" id="enhSectionI18n" data-enhance-page="i18n" hidden>
            <div class="v2-strip-band c-blue"></div>
            <div class="v2-strip-info">
              <span class="v2-strip-name">启用界面汉化</span>
              <span class="v2-strip-desc">将 ${ideName} 英文界面翻译为中文</span>
            </div>
            <div class="v2-mini-toggle is-on" id="enhLocalizationEnabledToggle" data-target="enhLocalizationEnabled"></div>
            <input type="checkbox" id="enhLocalizationEnabled" checked hidden>
          </div>
          <div class="v2-opt-row" style="margin-top:6px" data-enhance-page="i18n" hidden>
            <span class="v2-opt-label">汉化模式</span>
            <div style="flex:1"></div>
            <select id="enhLocalizationMode" class="v2-select" style="min-width:120px;font-size:11.5px">
              <option value="realtime">实时翻译</option>
              <option value="patch">补丁模式（流畅）</option>
            </select>
          </div>

          ${isDevin ? `
          <div class="v2-divider"></div>

          <!-- ACP 智能体解锁（仅 Devin） -->
          <div class="v2-strip" data-enhance-page="core">
            <div class="v2-strip-band c-purple"></div>
            <div class="v2-strip-info">
              <span class="v2-strip-name">解锁 ACP 智能体</span>
              <span class="v2-strip-desc">绕过 Devin 对第三方 ACP 智能体的限制，启用 Claude/Codex/Cline 等所有智能体</span>
            </div>
            <div class="v2-mini-toggle is-on" id="enhAcpUnlockToggle" data-target="enhAcpUnlock"></div>
            <input type="checkbox" id="enhAcpUnlock" checked hidden>
          </div>
          ` : ''}

          <div class="v2-divider"></div>

          <!-- 底部状态栏 -->
          <div id="enhSectionStatusbar" data-enhance-page="statusbar" hidden>
            <div class="v2-section-title">底部状态栏</div>
            <div class="v2-strip">
              <div class="v2-strip-band c-green"></div>
              <div class="v2-strip-info">
                <span class="v2-strip-name">启用状态栏显示</span>
                <span class="v2-strip-desc">VS Code 底部显示当前账号、额度、号池、自动切号状态</span>
              </div>
              <div class="v2-mini-toggle is-on" id="enhStatusBarEnabledToggle" data-target="enhStatusBarEnabled"></div>
              <input type="checkbox" id="enhStatusBarEnabled" checked hidden>
            </div>
            <div class="v2-opt-row" style="margin-top:6px">
              <span class="v2-opt-label">位置</span>
              <select class="v2-sel" id="enhStatusBarPosition" style="flex:1" title="状态栏显示位置">
                <option value="left">← 左侧</option>
                <option value="right" selected>→ 右侧（默认）</option>
              </select>
            </div>
            <div class="v2-opt-row" style="margin-top:6px">
              <span class="v2-opt-label">样式</span>
              <select class="v2-sel" id="enhStatusBarStyle" style="flex:1" title="状态栏左段显示格式">
                <option value="dot">🟢 — 仅圆点</option>
                <option value="percent">75% — 仅百分比</option>
                <option value="compact">🟢 75% — 圆点 + 百分比</option>
                <option value="dual">🟢 75% / 87% — 日 / 周</option>
                <option value="labeled" selected>日剩余 🟡 75% 周剩余 87% — 标签式（默认）</option>
                <option value="full">sox · 🟢 日剩余75% 周剩余87% — 完整</option>
              </select>
            </div>
            <div class="v2-opt-row" style="margin-top:6px;flex-wrap:wrap;gap:4px">
              <span class="v2-opt-label">右段</span>
              <div style="flex:1"></div>
              <span class="v2-tag is-on" id="enhSbPoolTag" data-target="enhSbShowPool" title="显示号池可用账号数">池计数</span>
              <span class="v2-tag is-on" id="enhSbAutoTag" data-target="enhSbShowAutoSwitch" title="显示自动切号开关状态 / 冷却倒计时">自动状态</span>
              <span class="v2-tag is-on" id="enhSbInstTag" data-target="enhSbShowInstance" title="多实例开多个 Windsurf 时区分当前实例">实例名</span>
              <input type="checkbox" id="enhSbShowPool" checked hidden>
              <input type="checkbox" id="enhSbShowAutoSwitch" checked hidden>
              <input type="checkbox" id="enhSbShowInstance" checked hidden>
            </div>
            <!-- 额度刷新频率 -->
            <div style="margin-top:8px">
              <div class="v2-param-grid">
                <div class="v2-param-cell">
                  <span class="v2-param-label">当前账号</span>
                  <div><input type="number" class="v2-param-val" id="enhRefreshCurrent" value="5" min="3" max="60"><span class="v2-param-unit">秒</span></div>
                </div>
                <div class="v2-param-cell">
                  <span class="v2-param-label">全部账号</span>
                  <div><input type="number" class="v2-param-val" id="enhRefreshAll" value="3" min="1" max="30"><span class="v2-param-unit">分钟</span></div>
                </div>
              </div>
              <div class="v2-hint" style="margin-top:4px">当前账号：状态栏额度数字的刷新频率。全部账号：号池候选额度的刷新频率。</div>
              <details class="as-adv-details" style="margin-top:8px">
                <summary class="as-adv-summary">大号池刷新性能</summary>
                <div class="as-adv-body">
                  <div class="v2-param-grid cols-3">
                    <div class="v2-param-cell">
                      <span class="v2-param-label">刷新并发</span>
                      <div><input type="number" class="v2-param-val" id="enhRefreshConcurrency" value="12" min="1" max="50"><span class="v2-param-unit">线程</span></div>
                    </div>
                    <div class="v2-param-cell">
                      <span class="v2-param-label">批次间隔</span>
                      <div><input type="number" class="v2-param-val" id="enhRefreshBatchDelay" value="250" min="0" max="10000"><span class="v2-param-unit">ms</span></div>
                    </div>
                    <div class="v2-param-cell">
                      <span class="v2-param-label">会员补查</span>
                      <div><input type="number" class="v2-param-val" id="enhPeriodRefreshHours" value="6" min="0" max="168"><span class="v2-param-unit">小时</span></div>
                    </div>
                  </div>
                  <div class="v2-hint" style="margin-top:4px">300 个号建议：并发 12-20，间隔 200-500ms。会员补查设 0 表示每次都查期限，速度会明显变慢。</div>
                </div>
              </details>
            </div>
          </div>

          <div class="v2-divider"></div>

          <!-- 完成提醒 -->
          <div id="enhSectionNotify" data-enhance-page="notify" hidden>
            <div class="v2-section-title">完成提醒</div>
            <div class="v2-strip">
              <div class="v2-strip-band c-amber"></div>
              <div class="v2-strip-info">
                <span class="v2-strip-name">启用完成提醒</span>
                <span class="v2-strip-desc">AI 回复完成时播放提示音 / 弹通知</span>
              </div>
              <div class="v2-mini-toggle is-on" id="enhNotifyEnabledToggle" data-target="enhNotifyEnabled"></div>
              <input type="checkbox" id="enhNotifyEnabled" checked hidden>
            </div>
            <div class="v2-opt-row" style="margin-top:6px">
              <span class="v2-opt-label">触发</span>
              <select class="v2-sel" id="enhNotifyTrigger" style="flex:1">
                <option value="always">每次都响</option>
                <option value="error">仅异常时</option>
                <option value="idle">仅窗口不活跃时</option>
              </select>
            </div>
            <div class="v2-opt-row">
              <span class="v2-opt-label">铃声</span>
              <select class="v2-sel" id="enhNotifyTone" style="flex:1">
                <option value="funk">Funk</option>
                <option value="ding">Ding</option>
                <option value="chime">Chime</option>
                <option value="beep">Beep</option>
                <option value="custom">自定义音符</option>
                <option value="file">音频文件</option>
              </select>
              <button class="v2-btn b-ghost" id="enhNotifyTest" title="试听" style="padding:4px 10px;font-size:10px">试听</button>
            </div>
            <div class="v2-opt-row" id="enhCustomToneRow" style="display:none">
              <span class="v2-opt-label">自定义音符</span>
              <input type="text" class="v2-sel" id="enhCustomTone" style="flex:1" placeholder="频率:时长, ... 如 880:200,0:50,660:200" title="格式: 频率Hz:时长ms，逗号分隔。0表示静音">
            </div>
            <div class="v2-opt-row" id="enhAudioFileRow" style="display:none">
              <span class="v2-opt-label">文件路径</span>
              <input type="text" class="v2-sel" id="enhAudioFile" style="flex:1" placeholder="音频文件路径（.wav / .mp3）" title="支持 .wav / .mp3 文件">
              <button class="v2-btn b-ghost" id="enhAudioFileBrowse" title="浏览" style="padding:4px 10px;font-size:10px">📂</button>
            </div>
            <div class="v2-opt-row">
              <span class="v2-opt-label">次数</span>
              <span class="v2-inline-params"><input type="number" id="enhNotifyRepeat" value="1" min="1" max="5"></span>
              <span class="v2-opt-label">次</span>
              <div style="flex:1"></div>
              <span class="v2-tag is-on" id="enhNotifySoundTag" data-target="enhNotifySound">响铃</span>
              <span class="v2-tag is-on" id="enhNotifyDesktopTag" data-target="enhNotifyDesktop">通知</span>
              <input type="checkbox" id="enhNotifySound" checked hidden>
              <input type="checkbox" id="enhNotifyDesktop" checked hidden>
            </div>
          </div>

        </div>
      </details>
    </div>
      </div>
    </div>
    </div>

    <div class="tab-page" id="tab-byok" data-tab-page="byok" role="tabpanel">
      <div class="card byok-card" id="byokArea">
        <div class="byok-header">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 2a10 10 0 0 0-10 10c0 5.5 4.5 10 10 10s10-4.5 10-10A10 10 0 0 0 12 2Zm0 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 12.5c-2.5 0-4.7-1.3-6-3.2.3-2 4-3.1 6-3.1s5.7 1.1 6 3.1c-1.3 2-3.5 3.2-6 3.2Z"/></svg>
          <div>
            <div class="byok-title">BYOK 已迁移至 AnyBridge</div>
            <div class="byok-subtitle">自带 Key / 模型路由 / API 中转 能力独立为姊妹项目</div>
          </div>
        </div>
        <div class="byok-body">
          <p>Kite 不再内置 BYOK 功能。为了更专注于 IDE 增强与账号工作流，自带 Key、模型路由、API 中转等能力已独立为 <b>AnyBridge</b>。</p>
          <ul>
            <li>支持多供应商、多模型、故障转移</li>
            <li>可作为 Windsurf / Devin 的 API 中转层</li>
            <li>提供 VS Code 侧栏配置界面</li>
          </ul>
        </div>
        <div class="byok-actions">
          <button class="v2-btn b-blue" id="byokOpenAnyBridge" type="button">打开 AnyBridge 仓库</button>
          <span class="byok-url">https://github.com/soulvon/AnyBridge</span>
        </div>
      </div>
    </div>

    <div class="tab-page" id="tab-automation" data-tab-page="automation" role="tabpanel">
    <div class="split-card" id="autoSplitCard">
      <div class="split-sidebar">
        <button type="button" class="split-sidebar-item active" data-pane="auto-switch" data-scroll-target="autoSwitchArea">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.5 4a1 1 0 0 1 1 1v4.5H16a1 1 0 1 1 0-2h1.65A7 7 0 0 0 5.8 8.7a1 1 0 1 1-1.6-1.2A9 9 0 0 1 19.5 5V5a1 1 0 0 1 0-1Z"/><path d="M4.5 20a1 1 0 0 1-1-1v-4.5H8a1 1 0 1 1 0 2H6.35A7 7 0 0 0 18.2 15.3a1 1 0 1 1 1.6 1.2A9 9 0 0 1 4.5 19v.01A1 1 0 0 1 4.5 20Z"/></svg>
          <span>自动切号</span>
        </button>
        <button type="button" class="split-sidebar-item" data-pane="auto-continue" data-scroll-target="autoContinueArea">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 3h2v3h3a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-6a4 4 0 0 1 4-4h3V3Z"/><path d="M9 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm6 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm-4.4 3.3h2.8v-1.6h-2.8v1.6Z" fill="var(--vscode-sideBar-background, #1f1f1f)"/></svg>
          <span>自动继续</span>
        </button>
      </div>

      <div class="split-content active" data-pane-content="auto-switch" role="tabpanel">
    <!-- 自动切号面板 -->
    <div class="card auto-switch-card" id="autoSwitchArea">
      <details class="as-details" id="asDetails" open>
        <summary class="as-top-summary">
          <svg class="as-top-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span class="as-top-title">自动切号</span>
          <span class="as-top-arrow"></span>
          <label class="as-switch" onclick="event.stopPropagation()">
            <input type="checkbox" id="asEnabled" checked>
            <span class="as-switch-track"><span class="as-switch-thumb"></span></span>
          </label>
        </summary>
        <div class="as-body" id="asBody" style="flex-direction:column;gap:12px;padding-top:14px">

          <!-- ★ 核心设置：一句话说清楚 -->
          <div class="as-main-setting">
            <span>额度低于</span>
            <input type="number" class="as-inline-num" id="asThreshold" value="15" min="1" max="99">
            <span class="v2-param-unit">%</span>
            <span>时自动换号</span>
          </div>

          <!-- 范围（多标签用户常用） -->
          <div class="v2-opt-row">
            <span class="v2-opt-label">范围</span>
            <select class="v2-sel" id="asPoolScope" style="flex:1">
              <option value="all">全部账号</option>
              <option value="tag">按标签</option>
              <option value="instance">当前实例分组</option>
            </select>
          </div>
          <!-- 标签多选区（按标签时显示） -->
          <div id="asTagPicker" style="display:none">
            <div class="as-tag-options" id="asTagOptions">
              <!-- JS 动态填充可选标签 -->
            </div>
            <div class="as-tag-selected" id="asTagSelected">
              <!-- JS 动态填充已选标签 chips -->
            </div>
          </div>

          <div class="v2-hint" id="asHint">取日/周配额中较低者为准。例：日100% 周0% → 实际不可用，自动切到额度最充足的号。</div>

          <!-- ★ 高级设置（默认折叠） -->
          <div class="as-adv-details" id="asAdvancedDetails">
            <div class="as-adv-summary">高级设置</div>
            <div class="as-adv-body">

              <!-- 运行参数 -->
              <div class="v2-param-grid">
                <div class="v2-param-cell">
                  <span class="v2-param-label">切号冷却</span>
                  <div><input type="number" class="v2-param-val" id="asCooldown" value="15" min="5" max="300"><span class="v2-param-unit">秒</span></div>
                </div>
              </div>
              <!-- 切号策略 -->
              <div class="v2-opt-row">
                <span class="v2-opt-label">策略</span>
                <select class="v2-sel" id="asSwitchStrategy" style="flex:1">
                  <option value="highestFirst">满额度优先（推荐）</option>
                  <option value="lowestNonZero">先用完再换新</option>
                </select>
              </div>
              <div class="v2-hint" id="asStrategyHint">优先选额度最充足的号切入，保证可用时间最长</div>

              <div class="v2-divider"></div>

              <!-- 门槛参数 -->
              <div class="v2-param-grid">
                <div class="v2-param-cell">
                  <span class="v2-param-label">废号下限</span>
                  <div><input type="number" class="v2-param-val" id="asMinQuota" value="10" min="0" max="50"><span class="v2-param-unit">%</span></div>
                </div>
                <div class="v2-param-cell" id="asPreferUsedCell">
                  <span class="v2-param-label">已用阈值</span>
                  <div><input type="number" class="v2-param-val" id="asPreferUsedThreshold" value="50" min="10" max="90"><span class="v2-param-unit">%</span></div>
                </div>
              </div>
              <div class="v2-hint" style="margin-top:4px" id="asThresholdHint">废号下限：日/周任一配额低于此值的号不会被选中。</div>

              <!-- 余额号保护 -->
              <div class="v2-param-grid" style="margin-top:8px">
                <div class="v2-param-cell">
                  <span class="v2-param-label">💰 余额保护</span>
                  <div><input type="number" class="v2-param-val" id="asMinBalanceToSkip" value="0.10" min="0" max="100" step="0.01"><span class="v2-param-unit">$</span></div>
                </div>
              </div>
              <div class="v2-hint" style="margin-top:4px">余额 ≥ 此值时，配额耗尽不切号，自动发继续（0 = 禁用保护）。</div>

            </div>
          </div>

          <div style="margin-top:10px;padding:8px 10px;background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.08));border-radius:6px;font-size:11px;color:var(--vscode-descriptionForeground,#888);display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span>切号记录已移至统计面板</span>
            <button class="as-open-panel-btn" onclick="vscode.postMessage({type:'openLogPanel',tab:'switch'})" style="padding:2px 10px;font-size:11px;border-radius:4px;border:1px solid var(--border-subtle);background:transparent;color:inherit;cursor:pointer">查看日志 →</button>
          </div>

        </div>
      </details>
    </div>
      </div>

      <div class="split-content" data-pane-content="auto-continue" role="tabpanel">

    <!-- 自动继续面板 -->
    <div class="card auto-switch-card ac-root" id="autoContinueArea">
      <details class="as-details" id="acDetails" open>
        <summary class="as-top-summary">
          <svg class="as-top-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M12 17h.01"/></svg>
          <span class="as-top-title">自动继续</span>
          <span class="as-top-arrow"></span>
          <label class="as-switch" onclick="event.stopPropagation()">
            <input type="checkbox" id="enhAutoContinueEnabled" checked>
            <span class="as-switch-track"><span class="as-switch-thumb"></span></span>
          </label>
        </summary>
        <div class="ac-body" id="acBody">
          <!-- 关闭状态 -->
          <div id="acOffHint" class="ac-off-state" style="display:none">
            <div class="ac-glass-card">
              <div class="ac-off-content">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="ac-dim-icon"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                <div class="ac-off-title">功能已禁用</div>
                <p class="ac-off-desc">开启总开关以激活自动化任务处理</p>
              </div>
            </div>
          </div>

          <!-- 开启状态 -->
          <div id="acOnContent" style="display:flex;flex-direction:column;gap:12px">
            <!-- 本次会话统计 -->
            <div class="ac-stats-bar" id="acStatsBar" style="display:none">
              <div class="ac-stats-header">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/></svg>
                <span>本次统计</span>
                <span class="ac-stats-total" id="acStatsTotal">0</span>
              </div>
              <div class="ac-stats-items" id="acStatsItems">
                <span class="ac-stats-chip" data-key="continueBtn" title="自动点击「继续回复」按钮"><span class="ac-stats-dot c-emerald"></span>续写 <b id="acStatContinueBtn">0</b></span>
                <span class="ac-stats-chip" data-key="sendMsg" title="发送 continue 消息"><span class="ac-stats-dot c-blue"></span>发送 <b id="acStatSendMsg">0</b></span>
                <span class="ac-stats-chip" data-key="retry" title="自动重试"><span class="ac-stats-dot c-amber"></span>重试 <b id="acStatRetry">0</b></span>
                <span class="ac-stats-chip" data-key="switchAcct" title="自动切换账号"><span class="ac-stats-dot c-red"></span>切号 <b id="acStatSwitchAcct">0</b></span>
                <span class="ac-stats-chip" data-key="switchModel" title="自动切换模型"><span class="ac-stats-dot c-violet"></span>切模型 <b id="acStatSwitchModel">0</b></span>
                <span class="ac-stats-chip" data-key="permission" title="自动批准权限请求"><span class="ac-stats-dot c-cyan"></span>权限 <b id="acStatPermission">0</b></span>
                <span class="ac-stats-chip" data-key="dismiss" title="自动关闭干扰弹窗"><span class="ac-stats-dot c-gray"></span>清除 <b id="acStatDismiss">0</b></span>
              </div>
            </div>
            <!-- Segment Tab -->
            <div class="v2-segment v2-segment-3">
              <input type="radio" name="acTab" id="acTabSimple" value="simple" checked>
              <label for="acTabSimple" class="v2-segment-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></svg>
                简单
              </label>
              <input type="radio" name="acTab" id="acTabGuardian" value="guardian">
              <label for="acTabGuardian" class="v2-segment-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                守护
              </label>
              <input type="radio" name="acTab" id="acTabLongTask" value="long-task">
              <label for="acTabLongTask" class="v2-segment-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                长任务
              </label>
              <div class="v2-segment-slider" id="acSegmentSlider"></div>
            </div>

            <!-- 简单模式 -->
            <div class="ac-section-panel" id="acPanelSimple">
              <div class="v2-strip">
                <div class="v2-strip-band c-emerald"></div>
                <div class="v2-strip-info"><span class="v2-strip-name">触发条件</span><span class="v2-strip-desc">检测 AI 异常停止时显示的三角警告图标</span></div>
              </div>
              <div class="v2-strip">
                <div class="v2-strip-band c-blue"></div>
                <div class="v2-strip-info"><span class="v2-strip-name">执行动作</span><span class="v2-strip-desc">自动在输入框写入 continue 并发送</span></div>
              </div>
              <div class="v2-strip">
                <div class="v2-strip-band c-violet"></div>
                <div class="v2-strip-info"><span class="v2-strip-name">冷却间隔</span><span class="v2-strip-desc">连续触发最小间隔，避免重复发送</span></div>
                <div style="display:flex;align-items:center;gap:4px;margin-left:auto">
                  <input type="number" id="enhSimpleCooldown" min="1" max="60" value="3" style="width:48px;padding:2px 4px;text-align:center;border-radius:4px;border:1px solid var(--border-subtle);background:var(--input-bg);color:inherit">
                  <span style="font-size:11px;color:var(--muted)">秒</span>
                </div>
              </div>
              <div style="margin-top:8px;padding:8px 10px;background:rgba(16,185,129,0.06);border-left:2px solid #10b981;border-radius:4px;font-size:11px;color:var(--muted);line-height:1.5">
                极简模式，仅做一件事：AI 出错停止 → 发 continue。不依赖文本和语言，跨界面更新通用。如需点击「继续回复」按钮、自动重试、自动批准权限等更多能力，请切换到「守护」模式。
              </div>
            </div>

            <!-- 守护模式 -->
            <div class="ac-section-panel" id="acPanelGuardian" style="display:none">
              <div class="v2-strip">
                <div class="v2-strip-band c-emerald"></div>
                <div class="v2-strip-info"><span class="v2-strip-name">自动续写</span><span class="v2-strip-desc">自动点击「继续回复」按钮</span></div>
                <div class="v2-mini-toggle is-on" id="enhGdAutoContinueBtnToggle" data-target="enhGdAutoContinueBtn"></div>
                <input type="checkbox" id="enhGdAutoContinueBtn" checked hidden>
              </div>
              <div class="v2-strip">
                <div class="v2-strip-band c-blue"></div>
                <div class="v2-strip-info"><span class="v2-strip-name">自动重试</span><span class="v2-strip-desc">网络超时或生成失败时自动重试</span></div>
                <div class="v2-mini-toggle is-on" id="enhGdAutoRetryToggle" data-target="enhGdAutoRetry"></div>
                <input type="checkbox" id="enhGdAutoRetry" checked hidden>
              </div>
              <div class="v2-strip">
                <div class="v2-strip-band c-violet"></div>
                <div class="v2-strip-info"><span class="v2-strip-name">突破限制</span><span class="v2-strip-desc">工具调用上限时自动发送 continue</span></div>
                <div class="v2-mini-toggle is-on" id="enhGdAutoSendOnToolLimitToggle" data-target="enhGdAutoSendOnToolLimit"></div>
                <input type="checkbox" id="enhGdAutoSendOnToolLimit" checked hidden>
              </div>
              <div class="v2-strip">
                <div class="v2-strip-band c-amber"></div>
                <div class="v2-strip-info"><span class="v2-strip-name">清除干扰</span><span class="v2-strip-desc">自动关闭「文件损坏」等系统弹窗</span></div>
                <div class="v2-mini-toggle is-on" id="enhGdDismissCorruptToggle" data-target="enhGdDismissCorrupt"></div>
                <input type="checkbox" id="enhGdDismissCorrupt" checked hidden>
              </div>

              <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--card-border)">
                <div class="v2-section-title">自动批准权限</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                  <span class="v2-tag is-on" id="enhGdApproveWebTag" data-target="enhGdApproveWeb">Web 访问</span>
                  <span class="v2-tag is-on" id="enhGdApproveTerminalTag" data-target="enhGdApproveTerminal">终端执行</span>
                  <span class="v2-tag is-on" id="enhGdApproveFileTag" data-target="enhGdApproveFile">文件写入</span>
                  <input type="checkbox" id="enhGdApproveWeb" checked hidden>
                  <input type="checkbox" id="enhGdApproveTerminal" checked hidden>
                  <input type="checkbox" id="enhGdApproveFile" checked hidden>
                </div>
              </div>
            </div>

            <!-- 长任务模式 -->
            <div class="ac-section-panel" id="acPanelLongTask" style="display:none">
              <!-- 状态条 -->
              <div class="v2-lt-status" id="acStatusStrip">
                <div class="v2-lt-dot" id="acStatusDot"></div>
                <span class="v2-lt-text" id="acStatusText">系统就绪</span>
                <span class="v2-lt-count" id="acStatusCount" style="display:none"><span id="acContinueCount">0</span> 轮</span>
              </div>

              <!-- 指令队列 -->
              <div style="margin-top:12px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                  <span class="v2-section-title" style="margin:0">指令队列</span>
                  <span style="font-family:var(--vscode-editor-font-family,monospace);font-size:11px;color:var(--muted)">循环</span>
                </div>
                <div class="v2-queue-list" id="acQueueList">
                  <div class="v2-queue-item is-active" data-idx="0">
                    <span class="v2-queue-idx">1</span>
                    <input class="v2-queue-text" value="继续" placeholder="输入指令...">
                    <button class="ac-btn-icon ac-btn-del" title="删除" style="font-size:10px;opacity:0.5;cursor:pointer;background:none;border:none;color:inherit">✕</button>
                  </div>
                </div>
                <div style="display:flex;gap:4px;margin-top:6px">
                  <input class="v2-queue-text" id="acQueueNewText" placeholder="添加新指令..." style="flex:1;background:color-mix(in srgb, var(--vscode-editor-background) 50%, transparent);border:1px solid var(--card-border);border-radius:4px;padding:5px 8px">
                  <button class="v2-btn b-emerald" id="acQueueAddBtn" style="padding:5px 10px;font-size:10px">+ 添加</button>
                </div>
              </div>

              <!-- 运行参数 -->
              <div class="v2-param-grid cols-3" style="margin-top:14px">
                <div class="v2-param-cell"><span class="v2-param-label">等待</span><div><input type="number" class="v2-param-val" id="enhLtIdleSeconds" min="2" max="120" value="2"><span class="v2-param-unit">秒</span></div></div>
                <div class="v2-param-cell"><span class="v2-param-label">上限</span><div><input type="number" class="v2-param-val" id="enhLtMaxContinue" min="0" max="9999" value="100"><span class="v2-param-unit">轮</span></div></div>
                <div class="v2-param-cell"><span class="v2-param-label">重试</span><div><input type="number" class="v2-param-val" id="enhLtMaxSendRetries" min="1" max="20" value="10"><span class="v2-param-unit">次</span></div></div>
              </div>

              <!-- 选项标签 -->
              <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
                <span class="v2-opt-label">选项</span>
                <span class="v2-tag is-on" id="enhLtLoopTag" data-target="enhLtLoop">循环队列</span>
                <span class="v2-tag is-on" id="enhLtStopOnInterventionTag" data-target="enhLtStopOnIntervention">错误时停止</span>
                <input type="checkbox" id="enhLtLoop" checked hidden>
                <input type="checkbox" id="enhLtStopOnIntervention" checked hidden>
              </div>

              <!-- 操作栏 -->
              <div class="v2-ctrl-bar" style="margin-top:14px">
                <button class="v2-btn b-emerald" id="acStartBtn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
                  开始运行
                </button>
                <button class="v2-btn b-amber" id="acPauseBtn" style="display:none">⏸ 暂停</button>
                <button class="v2-btn b-emerald" id="acResumeBtn" style="display:none">▶ 继续</button>
                <button class="v2-btn b-red" id="acStopBtn" style="display:none">⏹ 停止</button>
              </div>
              <div style="display:flex;gap:6px;margin-top:8px">
                <button class="v2-btn b-ghost" id="testSendContinueBtn" style="flex:1;font-size:10px">测试发送</button>
                <button class="v2-btn b-danger-outline" id="acForceStopBtn" disabled style="flex:1;font-size:10px">强制中断</button>
              </div>
              <div class="test-result" id="testSendContinueResult"></div>
              <div class="ac-last-action" id="acLastAction" style="display:none"></div>
            </div>
          </div>
          </div>
        </details>

          <!-- 错误恢复核心引擎（仅守护/长任务模式显示） -->
          <div id="acErrorRecoverySection" style="display:none">
            <div class="v2-divider" style="margin:8px 0"></div>
            <div class="v2-engine">
            <div class="v2-engine-head">
              <div class="v2-engine-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
              </div>
              <div class="v2-engine-meta">
                <span class="v2-engine-name">错误恢复核心</span>
                <span class="v2-engine-stat">● 监控中</span>
              </div>
              </div>
            <div class="v2-engine-rules" style="padding:10px 12px">
              <div class="v2-strip" style="margin-bottom:8px;padding:8px 10px;background:color-mix(in srgb, var(--vscode-foreground) 3%, transparent);border-radius:4px">
                <div class="v2-strip-band c-emerald"></div>
                <div class="v2-strip-info" style="flex:1">
                  <span class="v2-strip-name">自动故障排除引擎</span>
                  <span class="v2-strip-desc">检测异常并按规则自动恢复</span>
                </div>
                <div class="v2-mini-toggle is-on" id="enhAutoRecoveryEnabledToggle" data-target="enhAutoRecoveryEnabled"></div>
                <input type="checkbox" id="enhAutoRecoveryEnabled" checked hidden>
              </div>

              <!-- v6.6.0 恢复确认 Banner 设置 -->
              <div class="v2-strip" style="margin-bottom:6px;padding:8px 10px;background:color-mix(in srgb, var(--vscode-foreground) 3%, transparent);border-radius:4px">
                <div class="v2-strip-band c-blue"></div>
                <div class="v2-strip-info" style="flex:1">
                  <span class="v2-strip-name">恢复确认 Banner</span>
                  <span class="v2-strip-desc">所有自动操作前弹倒计时，可切换策略或取消</span>
                </div>
                <div class="v2-mini-toggle is-on" id="enhRecoveryConfirmEnabledToggle" data-target="enhRecoveryConfirmEnabled"></div>
                <input type="checkbox" id="enhRecoveryConfirmEnabled" checked hidden>
              </div>
              <div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px;font-size:11.5px;color:var(--vscode-foreground);opacity:0.85">
                <span style="flex:1">倒计时秒数</span>
                <input type="number" min="3" max="15" step="1" id="enhRecoveryCountdownSeconds" value="5" style="width:58px;padding:3px 6px;border-radius:3px;border:1px solid var(--vscode-input-border, transparent);background:var(--vscode-input-background);color:var(--vscode-input-foreground);font-size:11.5px">
                <span style="opacity:0.6">秒（3-15）</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;padding:4px 10px 10px;font-size:11.5px;color:var(--vscode-foreground);opacity:0.85">
                <span style="flex:1">已学习的偏好</span>
                <button type="button" id="enhRecoveryPrefsClear" style="padding:4px 10px;border-radius:3px;border:1px solid var(--vscode-button-border, transparent);background:var(--vscode-button-secondaryBackground, #3a3a3a);color:var(--vscode-button-secondaryForeground, #cbd5e1);font-size:11px;cursor:pointer">清除所有偏好</button>
              </div>

              <div style="display:flex;flex-direction:column;gap:2px">
                <!-- 网络故障 -->
                <details class="v2-rule-details">
                  <summary class="v2-rule-row">
                    <span class="v2-rule-dot net"></span>
                    <span class="v2-rule-name">网络超时 / 通信异常</span>
                  </summary>
                  <div class="v2-rule-content">
                    <div class="v2-field-row">
                      <span>处理策略</span>
                      <select class="v2-sel" id="ruleNetworkAction">
                        <option value="retry">立即重试</option>
                        <option value="switch-account">切换备用号</option>
                        <option value="notify">仅发出警报</option>
                        <option value="ignore">不处理</option>
                      </select>
                    </div>
                    <div class="v2-field-row" id="ruleNetworkRetryOpts">
                      <span>重试参数</span>
                      <div class="v2-inline-params">
                        <input type="number" id="ruleNetworkMaxRetries" value="3" min="1" max="10" style="width:40px;text-align:center">次 /
                        <input type="number" id="ruleNetworkDelay" value="3" min="1" max="30" style="width:40px;text-align:center">秒
                      </div>
                    </div>
                    <button class="v2-btn-sm" id="testRetryBtn">执行模拟测试</button>
                    <div class="test-result" id="testRetryResult"></div>
                  </div>
                </details>

                <!-- 配额/频率 -->
                <details class="v2-rule-details">
                  <summary class="v2-rule-row">
                    <span class="v2-rule-dot quota"></span>
                    <span class="v2-rule-name">额度耗尽 / 访问限流</span>
                  </summary>
                  <div class="v2-rule-content">
                    <div class="v2-field-row">
                      <span>自动切号</span>
                      <div class="v2-mini-checks">
                        <label><input type="checkbox" id="enhAutoSwitchOnQuota" checked><span>额度</span></label>
                        <label><input type="checkbox" id="enhAutoSwitchOnRateLimit" checked><span>限流</span></label>
                      </div>
                    </div>
                    <div class="v2-field-row">
                      <span>恢复策略</span>
                      <select class="v2-sel" id="ruleQuotaAction">
                        <option value="switch-account">轮换至下一账号</option>
                        <option value="switch-model">降级至备用模型</option>
                        <option value="notify">仅发出警报</option>
                        <option value="ignore">忽略</option>
                      </select>
                    </div>
                    <div class="v2-field-row">
                      <span>切号后动作</span>
                      <select class="v2-sel" id="ruleQuotaAfterAction">
                        <option value="auto">智能接续</option>
                        <option value="send-continue">强制发继续</option>
                        <option value="retry-message">重发上一条</option>
                        <option value="none">等待指令</option>
                      </select>
                    </div>
                    <button class="v2-btn-sm" id="testSwitchAccountBtn">模拟切号流程</button>
                    <div class="test-result" id="testSwitchAccountResult"></div>
                  </div>
                </details>

                <!-- 模型故障 -->
                <details class="v2-rule-details">
                  <summary class="v2-rule-row">
                    <span class="v2-rule-dot model"></span>
                    <span class="v2-rule-name">模型过载 / 暂不可用</span>
                  </summary>
                  <div class="v2-rule-content">
                    <div class="v2-field-row">
                      <span>恢复方案</span>
                      <select class="v2-sel" id="ruleModelAction">
                        <option value="switch-model">轮换可用模型</option>
                        <option value="switch-account">换号并重试</option>
                        <option value="retry">原样重试</option>
                        <option value="notify">仅通知</option>
                        <option value="ignore">忽略</option>
                      </select>
                    </div>
                    <div class="v2-field-row">
                      <span>切换后</span>
                      <select class="v2-sel" id="ruleModelAfterAction">
                        <option value="send-continue">发送继续</option>
                        <option value="auto">智能判断</option>
                        <option value="retry-message">重发消息</option>
                        <option value="none">不操作</option>
                      </select>
                    </div>
                    <!-- 当前模型卡片 -->
                    <div class="ms-current ms-brand-claude" id="msCurrentCard" style="margin-top:8px">
                      <div class="ms-current-icon" id="msCurrentIcon">⚡</div>
                      <div class="ms-current-info">
                        <div class="ms-current-label">当前模型</div>
                        <div class="ms-current-name" id="currentModelName">-</div>
                      </div>
                      <div class="ms-current-pulse"></div>
                    </div>

                    <!-- 备选模型队列 -->
                    <div class="ms-section-head">
                      <span class="ms-section-title">备选队列</span>
                      <span class="ms-section-badge" id="msPriorityCount">0</span>
                    </div>
                    <div id="modelPriorityList" class="ac-tag-list"></div>

                    <!-- 操作按钮 -->
                    <div class="ms-actions">
                      <button class="ms-btn" id="fetchModelsBtn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                        获取列表
                      </button>
                      <button class="ms-btn ms-btn-primary" id="testSwitchModelBtn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
                        立即切换
                      </button>
                    </div>
                    <div class="ms-result" id="testSwitchModelResult"></div>

                    <!-- 手动输入 -->
                    <div class="ms-input-row">
                      <input type="text" id="modelPriorityInput" placeholder="输入模型名...">
                      <button id="modelPriorityAdd">添加</button>
                    </div>

                    <!-- 可用模型列表 -->
                    <div id="availableModelsList" class="ms-available-list"></div>
                  </div>
                </details>

                <!-- 其他规则 -->
                <details class="v2-rule-details">
                  <summary class="v2-rule-row">
                    <span class="v2-rule-dot other"></span>
                    <span class="v2-rule-name">截断 / 权限 / 自定义</span>
                  </summary>
                  <div class="v2-rule-content">
                    <div class="v2-field-row">
                      <span>截断处理</span>
                      <select class="v2-sel" id="ruleContinuationAction">
                        <option value="send-continue">发送接续指令</option>
                        <option value="notify">仅通知</option>
                        <option value="ignore">忽略</option>
                      </select>
                    </div>
                    <div class="v2-field-row">
                      <span>权限请求</span>
                      <select class="v2-sel" id="rulePermissionAction">
                        <option value="auto-allow">自动允许</option>
                        <option value="notify">仅通知</option>
                      </select>
                    </div>
                    <div id="permissionScopeOpts" style="margin:6px 0">
                      <div class="v2-mini-checks">
                        <label><input type="checkbox" id="permScopeWeb" checked><span>Web</span></label>
                        <label><input type="checkbox" id="permScopeTerminal"><span>终端</span></label>
                        <label><input type="checkbox" id="permScopeFile"><span>文件</span></label>
                      </div>
                    </div>
                    <button class="v2-btn-sm" id="testPermissionBtn">测试权限检测</button>
                    <div class="test-result" id="testPermissionResult"></div>
                    <div class="v2-field-row" style="margin-top:8px">
                      <span>用户介入</span>
                      <select class="v2-sel" id="ruleUserAction">
                        <option value="notify">仅通知</option>
                        <option value="ignore">忽略</option>
                      </select>
                    </div>
                    <div id="customRulesList" class="ac-custom-rules" style="margin-top:8px"></div>
                    <button class="v2-btn-sm" id="customRuleAdd" style="width:100%;margin-top:4px">+ 增加正则匹配规则</button>
                  </div>
                </details>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
      </div>
    </div>

    <div class="tab-page" id="tab-instance" data-tab-page="instance" role="tabpanel">
    <!-- 多实例管理面板 -->
    <div class="card instance-card" id="instanceArea">
      <details class="inst-details" id="instDetails" open>
        <summary class="inst-summary">
          <svg class="inst-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <span class="inst-title" title="同时开多个 Windsurf 窗口，每个窗口登不同账号，可以同时用同一个项目">多实例分身</span>
          <span class="inst-arrow"></span>
          <div style="flex:1"></div>
          <button class="inst-import-btn" id="instImportBtn" title="从 Cockpit Tools 导入">Cockpit</button>
          <button class="inst-add-btn" id="instAddBtn" title="新建实例">+</button>
          <button class="inst-refresh-btn" id="instRefreshBtn" title="刷新">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
        </summary>
        <div class="inst-body">
          <div id="instList" class="inst-list"></div>
          <div id="instEmpty" class="inst-empty" hidden>暂无实例，点击 + 新建</div>
        </div>
      </details>
    </div>
    </div>

    <!-- 新建实例模态框 -->
    <div id="instCreateOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(400px,92vw)">
        <div class="modal-header">
          <h3>新建实例</h3>
          <button class="modal-close" id="instCreateClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <label>实例名称</label>
          <input type="text" id="instCreateName" placeholder="例如：工作号、测试号">
          <label>绑定账号</label>
          <div id="instCreateAccount" class="account-picker"></div>
          <label>自动切号标签分组</label>
          <select id="instCreateTag" class="as-select" style="width:100%">
            <option value="">不限（全部账号）</option>
          </select>
          <div class="inst-create-hint">新实例将复制当前 Windsurf 环境，启动后自动登录所选账号</div>
          <div id="instCreateError" class="inst-error" hidden></div>
          <button class="primary inst-create-submit" id="instCreateSubmit">创建实例</button>
        </div>
      </div>
    </div>

    <!-- Cockpit Tools 导入模态框 -->
    <div id="cockpitImportOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(480px,94vw)">
        <div class="modal-header">
          <h3>从 Cockpit Tools 导入</h3>
          <button class="modal-close" id="cockpitImportClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <div id="cockpitList" class="cockpit-list"></div>
          <div id="cockpitEmpty" class="cockpit-empty" hidden>未找到 Cockpit Tools 实例</div>
        </div>
      </div>
    </div>

    <!-- Cockpit 导入填表模态框（第二步） -->
    <div id="cockpitFormOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(400px,92vw)">
        <div class="modal-header">
          <h3>导入 Cockpit 实例</h3>
          <button class="modal-close" id="cockpitFormClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <label>实例名称</label>
          <input type="text" id="cockpitFormName" placeholder="例如：工作号、测试号">
          <label>绑定账号</label>
          <div id="cockpitFormAccount" class="account-picker"></div>
          <div class="inst-create-hint">导入后，启动该实例时会自动登录所选账号。原 Cockpit 数据目录保留不变。</div>
          <div id="cockpitFormError" class="inst-error" hidden></div>
          <button class="primary inst-create-submit" id="cockpitFormSubmit">确认导入</button>
        </div>
      </div>
    </div>

    <!-- 实例编辑模态框 -->
    <div id="instEditOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(400px,92vw)">
        <div class="modal-header">
          <h3>编辑实例</h3>
          <button class="modal-close" id="instEditClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <label>实例名称</label>
          <input type="text" id="instEditName">
          <label>绑定账号</label>
          <div id="instEditAccount" class="account-picker"></div>
          <label>自动切号标签分组</label>
          <select id="instEditTag" class="as-select" style="width:100%">
            <option value="">不限（全部账号）</option>
          </select>
          <div id="instEditError" class="inst-error" hidden></div>
          <button class="primary inst-create-submit" id="instEditSubmit">保存</button>
        </div>
      </div>
    </div>

    <!-- 通用确认对话框 -->
    <div id="confirmOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(360px,90vw)">
        <div class="modal-header">
          <h3 id="confirmTitle">确认</h3>
          <button class="modal-close" id="confirmClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <div id="confirmMsg" style="font-size:13px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="modal-cancel-btn" id="confirmCancel">取消</button>
            <button class="primary" id="confirmOk">确定</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 导出账号确认/进度/结果模态框 -->
    <div id="exportAccountsOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(400px,90vw)">
        <div class="modal-header">
          <h3 id="exportAccountsTitle">导出账号</h3>
          <button class="modal-close" id="exportAccountsClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <!-- 确认阶段 -->
          <div id="exportConfirmStage">
            <!-- 导出范围 -->
            <div class="export-section">
              <div class="export-section-title">导出范围</div>
              <label class="export-radio"><input type="radio" name="exportScope" value="filtered" checked><span>当前筛选 (<strong id="exportFilteredCount" style="color:var(--ac-emerald)">0</strong> 个)</span></label>
              <label class="export-radio"><input type="radio" name="exportScope" value="all"><span>全部账号 (<strong id="exportAllCount" style="color:var(--ac-emerald)">0</strong> 个)</span></label>
            </div>
            <!-- 导出格式 -->
            <div class="export-section">
              <div class="export-section-title">导出格式</div>
              <label class="export-radio"><input type="radio" name="exportFormat" value="json" checked><span>JSON 完整格式</span><span class="export-hint">备份 / 迁移</span></label>
              <label class="export-radio"><input type="radio" name="exportFormat" value="text"><span>文本格式</span><span class="export-hint">email----pass----token</span></label>
            </div>
            <!-- 选项 -->
            <label class="export-checkbox"><input type="checkbox" id="exportCopyClipboard" checked><span>同时复制到剪贴板</span></label>
            <!-- 底部按钮 -->
            <div class="export-footer">
              <button class="modal-cancel-btn" id="exportCancelBtn">取消</button>
              <button class="primary" id="exportConfirmBtn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                导出 <span id="exportBtnCount">0</span> 个
              </button>
            </div>
          </div>
          <!-- 进度阶段 -->
          <div id="exportProgressStage" hidden>
            <div style="padding:20px 0">
              <div class="modal-progress-bar"><div class="modal-progress-fill" id="exportProgressFill" style="width:0%"></div></div>
              <div class="modal-progress-text" id="exportProgressText">准备导出…</div>
            </div>
          </div>
          <!-- 结果阶段 -->
          <div id="exportResultStage" hidden>
            <div id="exportResultIcon" style="text-align:center;margin:16px 0 12px"></div>
            <div id="exportResultMsg" style="font-size:13px;text-align:center;margin-bottom:16px"></div>
            <div id="exportResultActions" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="tab-page active" id="tab-account" data-tab-page="account" role="tabpanel">
    <!-- 我的账号（含汇总 + 账号列表） -->
    <div class="card list-card">
      <details class="list-details" id="listDetails" open>
        <summary class="list-summary">
          <svg class="list-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <h3>我的账号</h3>
          <span class="list-arrow"></span>
          <div style="flex:1"></div>
          <span class="grid-count" id="gridCount">0 个</span>
          <button class="add-account-btn" id="addAccountBtn">添加账号</button>
        </summary>
        <div class="list-body">
      <!-- 汇总统计 -->
      <div id="summaryCard">
        <div class="summary-stats">
          <div class="summary-stat" id="summaryDailyStat">
            <div class="summary-stat-head">
              <svg class="summary-stat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              <span class="summary-stat-label">本日</span>
              <span class="summary-stat-pct" id="summaryDailyPct">0%</span>
            </div>
            <div class="summary-bar"><div class="summary-bar-fill" id="summaryDailyBar" style="width:0%"></div></div>
            <div class="summary-stat-footer">
              <span class="summary-stat-num" id="summaryDailyNum">0</span>
              <span class="summary-stat-max" id="summaryDailyMax">/ 0</span>
            </div>
          </div>
          <div class="summary-stat" id="summaryWeeklyStat">
            <div class="summary-stat-head">
              <svg class="summary-stat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span class="summary-stat-label">本周</span>
              <span class="summary-stat-pct" id="summaryWeeklyPct">0%</span>
            </div>
            <div class="summary-bar"><div class="summary-bar-fill" id="summaryWeeklyBar" style="width:0%"></div></div>
            <div class="summary-stat-footer">
              <span class="summary-stat-num" id="summaryWeeklyNum">0</span>
              <span class="summary-stat-max" id="summaryWeeklyMax">/ 0</span>
            </div>
          </div>
        </div>
        <div class="summary-status-grid" id="summaryStatusGrid">
          <div class="summary-status-row"><span class="summary-status-label">活跃 / 禁用</span><span class="summary-status-val" id="summaryActiveDisabled">0 / 0</span></div>
          <div class="summary-status-row"><span class="summary-status-label">满额度账号</span><span class="summary-status-val ok" id="summaryHighQuota">0 个（≥ 80%）</span></div>
          <div class="summary-status-row"><span class="summary-status-label">低额度账号</span><span class="summary-status-val warn" id="summaryLowQuota">0 个（≤ 30%）</span></div>
          <div class="summary-status-row"><span class="summary-status-label">最近刷新</span><span class="summary-status-val off" id="summaryLastRefresh">--</span></div>
        </div>
        <!-- 用量统计 -->
        <details class="usage-stats-details" id="usageStatsDetails">
          <summary class="usage-stats-summary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            <span>用量统计</span>
            <span class="usage-stats-date" id="usageStatsDate"></span>
            <button class="as-open-panel-btn" title="打开统计面板（Ctrl+Shift+Q）" onclick="event.stopPropagation(); vscode.postMessage({type:'openLogPanel'})" style="margin-left:auto;display:inline-flex;align-items:center;gap:3px;padding:2px 8px;font-size:11px;border-radius:4px;border:1px solid var(--border-subtle);background:transparent;color:var(--muted);cursor:pointer">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              统计面板
            </button>
          </summary>
          <div class="usage-stats-body">
            <div class="usage-stats-grid">
              <div class="usage-stat-cell">
                <div class="usage-stat-num" id="statPoolSignals">0</div>
                <div class="usage-stat-label">请求信号</div>
              </div>
              <div class="usage-stat-cell">
                <div class="usage-stat-num" id="statSwitches">0</div>
                <div class="usage-stat-label">切号次数</div>
              </div>
              <div class="usage-stat-cell">
                <div class="usage-stat-num" id="statRefreshes">0</div>
                <div class="usage-stat-label">配额检查</div>
              </div>
              <div class="usage-stat-cell">
                <div class="usage-stat-num" id="statAvgDailyUsed">0%</div>
                <div class="usage-stat-label">平均日用量</div>
              </div>
            </div>
            <div class="usage-stats-balance-row" id="statBalanceRow" style="display:none" title="账号配额耗尽时仍可继续用付费余额，自动切号会跳过这些号">
              <span class="usage-stats-balance-icon">💰</span>
              <span class="usage-stats-balance-text">有 <span id="statBalanceCount">0</span> 个账号余额可用</span>
            </div>
            <div class="usage-stats-bar-section">
              <div class="usage-stats-bar-row">
                <span class="usage-stats-bar-label">日总用量</span>
                <div class="usage-stats-bar"><div class="usage-stats-bar-fill daily" id="statDailyBar" style="width:0%"></div></div>
                <span class="usage-stats-bar-val" id="statDailyVal">0</span>
              </div>
              <div class="usage-stats-bar-row">
                <span class="usage-stats-bar-label">周总用量</span>
                <div class="usage-stats-bar"><div class="usage-stats-bar-fill weekly" id="statWeeklyBar" style="width:0%"></div></div>
                <span class="usage-stats-bar-val" id="statWeeklyVal">0</span>
              </div>
            </div>
          </div>
        </details>

        <!-- 测活面板（默认隐藏，由 Windsurf 增强里的「显示测活面板」开关控制） -->
        <details class="usage-stats-details health-panel-details" id="healthPanelDetails" hidden>
          <summary class="usage-stats-summary health-panel-summary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            <span>测活面板</span>
            <span class="health-check-bar-count" id="hcBarCount"></span>
            <button class="as-open-panel-btn" id="hcBarOpenPanel" title="打开测活面板" onclick="event.stopPropagation(); vscode.postMessage({type:'runCommand', command:'windsurfPool.openHealthCheck'})" style="margin-left:auto;display:inline-flex;align-items:center;gap:3px;padding:2px 8px;font-size:11px;border-radius:4px;border:1px solid var(--border-subtle);background:transparent;color:var(--muted);cursor:pointer">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              测活面板
            </button>
          </summary>
        </details>
      </div>

      <div class="panel-divider"></div>

      <!-- 外部账户提示条 -->
      <div id="externalBanner" class="external-banner" hidden>
        <span class="external-banner-text">
          当前 Windsurf 登录的账户 <strong id="externalEmail"></strong> 不在号池中
        </span>
        <button class="external-banner-btn" id="externalAddBtn">加入号池</button>
      </div>
      <!-- 搜索栏 -->
      <div class="search-bar" id="searchBar">
        <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.8 4a6.8 6.8 0 1 0 4.25 12.12l3.42 3.42a1.2 1.2 0 0 0 1.7-1.7l-3.42-3.42A6.8 6.8 0 0 0 10.8 4Zm0 2.4a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8Z"/></svg>
        <input type="text" class="search-input" id="searchInput" placeholder="搜索账号..." autocomplete="off">
        <button class="search-clear" id="searchClear" hidden title="清除">×</button>
      </div>
      <!-- 工具栏：过滤 + 排序 + 刷新 -->
      <div class="toolbar-bar" id="toolbarBar">
        <div class="filter-wrap" id="filterWrap">
          <button class="filter-trigger" id="filterTrigger" title="过滤">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span id="filterLabel">ALL</span>
            <span class="filter-count" id="filterCount"></span>
          </button>
          <div class="filter-dropdown" id="filterDropdown" hidden>
            <div class="filter-section" id="filterPlanSection">
              <div class="filter-section-title">套餐</div>
              <div class="filter-options" id="filterPlanList"></div>
            </div>
            <div class="filter-section" id="filterTagSection">
              <div class="filter-section-title">标签</div>
              <div class="filter-options" id="filterTagList"></div>
            </div>
            <div class="filter-section" id="filterStatusSection">
              <div class="filter-section-title">状态</div>
              <div class="filter-options" id="filterStatusList"></div>
            </div>
            <div class="filter-section" id="filterHealthSection">
              <div class="filter-section-title">测活</div>
              <div class="filter-options" id="filterHealthList"></div>
            </div>
            <div class="filter-actions">
              <button class="filter-clear-btn" id="filterClearBtn">清空筛选</button>
            </div>
          </div>
        </div>
        <select class="group-select" id="sortSelect" title="排序方式">
          <option value="default">默认排序</option>
          <option value="recommend">⭐ 推荐</option>
          <option value="min">综合配额</option>
          <option value="daily">日配额</option>
          <option value="weekly">周配额</option>
          <option value="balance">💰 余额</option>
          <option value="planEnd">到期日</option>
          <option value="email">邮箱 A-Z</option>
          <option value="created">添加时间</option>
        </select>
        <button class="sort-direction-btn" id="sortDirectionBtn" title="切换排序方向">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <polyline points="19 12 12 19 5 12"/>
          </svg>
        </button>
        <button class="toolbar-icon-btn anomaly-badge-btn" id="anomalyBadgeBtn" title="异常监控：点击查看详情" hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span class="anomaly-badge-count" id="anomalyBadgeCount">0</span>
        </button>
        <button class="toolbar-icon-btn" id="refreshAllBtn" title="刷新全部配额">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <button class="toolbar-icon-btn" id="exportAccountsBtn" title="导出账号设置（换电脑用）">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button class="toolbar-icon-btn" id="privacyModeBtn" title="隐私模式：隐藏邮箱">
          <svg class="privacy-eye" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <svg class="privacy-eye-off" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden>
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19C5 19 1 12 1 12a20.29 20.29 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A10.84 10.84 0 0 1 12 4c7 0 11 8 11 8a20.88 20.88 0 0 1-2.16 3.19"/>
            <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        </button>
        <button class="preflight-toggle-btn" id="preflightToggleBtn" title="切号预检：开启则切号前先调用 Windsurf 官方 API 检查限速（多 0.5-2s 延迟，但能拦截当前模型限速的账号）。关闭则直接切，速度更快但可能切到限速的号。">
          <span class="preflight-label">切号预检</span>
          <span class="preflight-switch" aria-hidden="true">
            <span class="preflight-switch-thumb"></span>
          </span>
        </button>
        <button class="balance-filter-btn" id="balanceFilterBtn" title="筛选有额外余额的账号">
          <span class="balance-icon">💰</span>
          <span class="balance-label">有余额</span>
          <span class="balance-count" id="balanceCount">(0)</span>
        </button>
        <div style="flex:1"></div>
        <select class="page-size-select" id="pageSizeSelect" title="每页显示">
          <option value="10">10/页</option>
          <option value="20" selected>20/页</option>
          <option value="50">50/页</option>
          <option value="0">全部</option>
        </select>
        <button class="group-select-mode-btn" id="selectModeBtn" title="多选模式">多选</button>
      </div>
      <!-- 标签管理栏 -->
      <div class="tag-bar" id="tagBar">
        <span class="tag-bar-label">标签:</span>
        <div class="tag-list" id="tagList">
          <!-- 动态生成的标签 -->
        </div>
      </div>
      <!-- 批量操作栏（多选模式下显示） -->
      <div class="batch-bar" id="batchBar" hidden>
        <label class="batch-check-all"><input type="checkbox" id="batchCheckAll"><span>全选</span></label>
        <div style="flex:1"></div>
        <span class="batch-count" id="batchCount">已选 0</span>
        <button class="batch-action-btn batch-action-monitor" id="batchMonitorBtn" title="添加监控标签，用于异常检测">加监控</button>
        <button class="batch-action-btn" id="batchTagBtn" title="为选中账号设置标签">加标签</button>
        <button class="batch-action-btn" id="batchEnableBtn" title="启用选中账号">启用</button>
        <button class="batch-action-btn" id="batchDisableBtn" title="禁用选中账号">禁用</button>
        <button class="batch-action-btn" id="batchExportBtn" title="导出选中账号">导出</button>
        <button class="batch-action-btn batch-action-delete" id="batchDeleteBtn" title="删除选中账号">删除</button>
        <button class="batch-action-btn" id="batchCancelBtn">取消</button>
      </div>
        <div id="accountGrid" class="account-grid"></div>
        <div id="emptyState" class="empty-card">
          <div class="empty-title">还没有账号</div>
          <div class="empty-sub">点击上方 + 按钮添加账号</div>
        </div>
      </div>
    </details>
    </div>
    </div>

  </div>

  <!-- 添加账号模态框 -->
  <div id="addAccountOverlay" class="modal-overlay" hidden>
    <div class="modal-box" style="width:min(480px,94vw);max-height:88vh">
      <div class="modal-header">
        <h3>添加账号</h3>
        <button class="modal-close" id="addAccountClose" title="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="add-tabs">
          <button class="add-tab" data-tab="oauth">OAuth 授权</button>
          <button class="add-tab active" data-tab="batch">批量导入</button>
          <button class="add-tab" data-tab="single">单个登录</button>
          <button class="add-tab" data-tab="current">已登录账户</button>
        </div>

        <!-- 标签设置区（共享组件） -->
        <div class="add-account-tag-section" style="margin-top:12px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border,#333)">
          <label class="batch-mode-label" style="font-weight:bold;margin-bottom:6px;display:block">导入标签（可选）</label>
          <div id="addAccountSelectedTags" class="tag-edit-selected" style="display:flex;flex-wrap:wrap;gap:4px;min-height:28px;margin-bottom:8px;padding:4px 0"></div>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" id="addAccountTagInput" placeholder="输入标签名称，回车添加" style="flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box">
            <button id="addAccountTagAddBtn" style="flex:0 0 auto;padding:5px 14px;font-size:12px;white-space:nowrap;border-radius:6px;border:1px solid var(--accent,#10b981);background:var(--accent,#10b981);color:#fff;cursor:pointer">添加</button>
          </div>
          <div style="margin-top:8px">
            <label style="font-size:11px;opacity:0.7">已有标签（点击添加/移除）</label>
            <div id="addAccountExistingTags" class="tag-edit-existing" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;max-height:80px;overflow-y:auto"></div>
          </div>
        </div>

        <!-- OAuth 授权 -->
        <div id="oauthLoginArea" hidden>
          <p class="footnote">打开 Windsurf 官方授权页，完成后自动保存到号池。</p>
          <button class="primary" data-action="oauthLogin" style="margin-top:10px">开始 OAuth 授权</button>
          <div id="oauthMsg" class="batch-msg" hidden></div>
        </div>

        <!-- 单个登录 -->
        <div id="singleLoginArea" hidden>
          <label>邮箱</label>
          <input type="email" id="email" placeholder="your@email.com">
          <label>密码</label>
          <input type="password" id="loginPassword" placeholder="密码">
          <button class="primary" data-action="loginSave" style="margin-top:10px">登录并保存</button>
        </div>

        <!-- 批量导入 -->
        <div id="batchImportArea">
          <!-- 从文件导入（醒目入口） -->
          <div class="batch-file-import-bar">
            <button class="batch-file-import-btn" data-action="importAccountsFile">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>
              从文件导入
            </button>
            <span class="batch-file-import-hint">支持本插件导出的 JSON 文件，无需重新登录</span>
          </div>

          <div class="batch-section">
            <label class="batch-mode-label">导入格式</label>
            <div class="batch-radio-group">
              <label class="batch-radio"><input type="radio" name="batchFormat" value="text" checked> 文本</label>
              <label class="batch-radio"><input type="radio" name="batchFormat" value="json"> JSON</label>
              <label class="batch-radio"><input type="radio" name="batchFormat" value="devin"> Devin Token</label>
            </div>
          </div>

          <div class="batch-section" id="batchAuthSection">
            <label class="batch-mode-label">登录方式</label>
            <div class="batch-radio-group">
              <label class="batch-radio"><input type="radio" name="batchAuthMethod" value="auto" checked> 自动</label>
              <label class="batch-radio"><input type="radio" name="batchAuthMethod" value="auth1"> Auth1</label>
              <label class="batch-radio"><input type="radio" name="batchAuthMethod" value="firebase"> Firebase</label>
            </div>
          </div>

          <div id="batchTextArea" class="batch-text-area">
            <div class="batch-section">
              <label class="batch-mode-label">分隔符</label>
              <div class="batch-radio-group batch-radio-group--wrap">
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="smart" checked> 智能识别</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="----"> ----</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="\\t"> Tab</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value=" "> 空格</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value=","> 逗号</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="|"> 竖线</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="custom"> 自定义</label>
              </div>
              <input type="text" id="batchCustomDelim" class="batch-custom-delim" placeholder="输入自定义分隔符" hidden>
            </div>
            <select id="batchDelimiter" hidden><option value="smart">智能识别</option><option value="----">----</option><option value="\\t">Tab</option><option value=" ">空格</option><option value=",">逗号</option><option value="|">竖线</option><option value="custom">自定义</option></select>

            <label class="batch-hint">智能识别多种格式，直接粘贴即可</label>
            <textarea id="batchText" class="batch-textarea" rows="6" placeholder="user1@example.com----password123&#10;user2@example.com----abc456789&#10;邮箱：xxx 密码：xxx&#10;auth1_xxxx... 或 devin-session-token$eyJ..."></textarea>

            <details class="batch-example">
              <summary>格式示例（点击展开）</summary>
              <div class="batch-example-content">
                <div class="batch-example-label">邮箱 + 密码（分隔符）</div>
                <pre class="batch-example-code">user1@example.com----password123
user2@example.com:abc456789</pre>
                <div class="batch-example-label" style="margin-top:8px">中文标签格式（单行或多行）</div>
                <pre class="batch-example-code">邮箱：user@example.com 密码：mypass
邮箱：user2@example.com
密码：auth1_xxxxxxxx...</pre>
                <div class="batch-example-label" style="margin-top:8px">Token 直接导入</div>
                <pre class="batch-example-code">auth1_xxxxxxxxxxxx...
devin-session-token$eyJhbGciOi...</pre>
                <div class="batch-example-label" style="margin-top:8px">💡 密码字段为 auth1_ token 时自动识别</div>
              </div>
            </details>

            <button class="primary" data-action="batchImportText">批量导入</button>
          </div>

          <div id="batchJsonArea" hidden>
            <label>JSON 数据</label>
            <textarea id="batchJson" class="batch-textarea" rows="6" placeholder='[{"email":"user1@example.com","password":"pass1"},{"email":"user2@example.com","password":"pass2"}]'></textarea>

            <details class="batch-example">
              <summary>格式示例（点击展开）</summary>
              <div class="batch-example-content">
                <div class="batch-example-label">JSON 示例</div>
                <pre class="batch-example-code">[
  {"email": "user1@example.com", "password": "pass1"},
  {"email": "user2@example.com", "password": "pass2"}
]</pre>
              </div>
            </details>

            <button class="primary" data-action="batchImportJson">批量导入</button>
          </div>

          <div id="batchDevinArea" hidden>
            <label class="batch-hint">每行一个 Devin Session Token，自动提取 JWT 并导入。</label>
            <textarea id="batchDevinText" class="batch-textarea" rows="6" placeholder="devin-session-token$eyJhbGciOiJIUzI1NiIs...&#10;devin-session-token$eyJhbGciOiJIUzI1NiIs..."></textarea>

            <details class="batch-example">
              <summary>格式示例（点击展开）</summary>
              <div class="batch-example-content">
                <div class="batch-example-label">Devin Session Token</div>
                <pre class="batch-example-code">devin-session-token$eyJhbGciOiJIUzI1NiIs...
devin-session-token$eyJhbGciOiJIUzI1NiIs...</pre>
              </div>
            </details>

            <button class="primary" data-action="batchImportDevin">批量导入</button>
          </div>

          <div id="batchMsg" class="batch-msg" hidden></div>
        </div>

        <!-- 从当前已登录账户添加 -->
        <div id="currentAccountArea" hidden>
          <p class="footnote">将 Windsurf 当前已登录账户的 Session 保存到号池，无需密码。</p>
          <button class="primary" data-action="addCurrent" style="margin-top:10px">从当前账户添加</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量导入模态进度弹窗 -->
  <div id="batchModalOverlay" class="modal-overlay" hidden>
    <div class="modal-box">
      <div class="modal-header">
        <h3 id="batchModalTitle">批量导入中</h3>
        <button class="modal-close" id="batchModalClose" title="关闭" hidden>×</button>
      </div>
      <div class="modal-body">
        <div class="modal-progress-bar"><div class="modal-progress-fill" id="batchModalFill"></div></div>
        <div class="modal-progress-text" id="batchModalProgressText">准备中…</div>
        <div class="modal-current" id="batchModalCurrent"></div>
        <div class="modal-counts" id="batchModalCounts"></div>
        <div class="batch-ctrl-row" id="batchModalCtrlRow">
          <button class="batch-ctrl-btn batch-pause-btn" id="batchModalPause" title="暂停">⏸ 暂停</button>
          <button class="batch-ctrl-btn batch-cancel-btn" id="batchModalCancel" title="取消导入">✕ 取消</button>
        </div>
        <div class="modal-fail-list" id="batchModalFailList" hidden></div>
        <button class="modal-retry-btn" id="batchModalRetry" hidden>重试失败项</button>
        <button class="modal-done-btn" id="batchModalDone" hidden>完成</button>
      </div>
    </div>
  </div>

  <!-- 文件导入选项弹窗 -->
  <div id="importOptionsOverlay" class="modal-overlay" hidden>
    <div class="modal-box" style="max-width:360px">
      <div class="modal-header">
        <h3>导入选项</h3>
        <button class="modal-close" id="importOptionsClose" title="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="import-options-info" id="importOptionsInfo"></div>
        <div class="import-options-list">
          <label class="import-option">
            <input type="checkbox" id="importOptTags" checked>
            <span>导入原始标签</span>
          </label>
          <label class="import-option">
            <input type="checkbox" id="importOptDisabled" checked>
            <span>导入禁用状态</span>
          </label>
          <label class="import-option">
            <input type="checkbox" id="importOptRevalidate">
            <span>重新验证账号（即使有 apiKey）</span>
          </label>
        </div>
        <div class="import-options-btns">
          <button class="secondary" id="importOptionsCancel">取消</button>
          <button class="primary" id="importOptionsConfirm">开始导入</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 通用提示/确认模态弹窗 -->
  <div id="alertOverlay" class="modal-overlay" hidden>
    <div class="modal-box" style="width:min(360px,90vw)">
      <div class="modal-header">
        <h3 id="alertTitle">提示</h3>
        <button class="modal-close" id="alertCloseX" title="关闭">×</button>
      </div>
      <div class="modal-body">
        <div id="alertMessage" style="font-size:12.5px;line-height:1.6;word-break:break-word;"></div>
        <div id="alertActions" class="alert-actions"></div>
      </div>
    </div>
  </div>

  <!-- 标签编辑弹窗（多标签 picker） -->
  <div id="tagEditOverlay" class="modal-overlay" hidden>
    <div class="modal-box" style="width:min(400px,90vw)">
      <div class="modal-header">
        <h3 id="tagEditTitle">编辑标签</h3>
        <button class="modal-close" id="tagEditClose" title="关闭">×</button>
      </div>
      <div class="modal-body">
        <div id="tagEditSelected" class="tag-edit-selected" style="display:flex;flex-wrap:wrap;gap:4px;min-height:28px;margin-bottom:8px;padding:4px 0"></div>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="text" id="tagEditInput" placeholder="输入标签名称，回车添加" style="flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box">
          <button id="tagEditAddBtn" style="flex:0 0 auto;padding:5px 14px;font-size:12px;white-space:nowrap;border-radius:6px;border:1px solid var(--accent,#10b981);background:var(--accent,#10b981);color:#fff;cursor:pointer">添加</button>
        </div>
        <div id="tagEditError" class="inst-error" hidden></div>
        <div style="margin-top:8px">
          <label style="font-size:11px;opacity:0.7">已有标签（点击添加/移除）</label>
          <div id="tagEditExisting" class="tag-edit-existing" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;max-height:120px;overflow-y:auto"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
          <button class="modal-cancel-btn" id="tagEditCancel" style="min-width:72px;padding:6px 20px">取消</button>
          <button class="primary" id="tagEditSave" style="width:auto;min-width:72px;padding:6px 20px">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 全局 Toast 容器（实例操作进度/错误） -->
  <div id="toastContainer" class="toast-container"></div>

  <script>
    const vscode = acquireVsCodeApi();
    window.__kiteWebviewDiag = function(level, message, detail) {
      try {
        vscode.postMessage({
          type: 'webviewLog',
          level: level || 'info',
          message: String(message || ''),
          detail: detail,
          readyState: document.readyState,
          ts: Date.now()
        });
      } catch (e) {}
    };
    window.__kiteWebviewDiag('info', 'inline bootstrap loaded', {
      href: location.href,
      userAgent: navigator.userAgent,
      vscodeApi: !!vscode
    });
    window.addEventListener('error', function(event) {
      var target = event.target;
      if (target && target !== window && (target.tagName || target.src || target.href)) {
        window.__kiteWebviewDiag('error', 'resource load error', {
          tag: target.tagName,
          src: target.src || target.href || '',
          outerHTML: target.outerHTML ? target.outerHTML.slice(0, 500) : ''
        });
        return;
      }
      window.__kiteWebviewDiag('error', 'window error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error ? { name: event.error.name, message: event.error.message, stack: event.error.stack } : null
      });
    }, true);
    window.addEventListener('unhandledrejection', function(event) {
      var reason = event.reason;
      window.__kiteWebviewDiag('error', 'unhandled rejection', reason && reason.stack ? {
        name: reason.name,
        message: reason.message,
        stack: reason.stack
      } : reason);
    });
    document.addEventListener('DOMContentLoaded', function() {
      window.__kiteWebviewDiag('info', 'dom content loaded', {
        tabPages: document.querySelectorAll('.tab-page').length,
        scripts: document.scripts.length,
        stylesheets: document.styleSheets.length
      });
    });
  </script>
  <script>${getSignalBridgeScript()}</script>
  <script>${getBridgeRelayScript()}</script>
  <script src="${jsUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this._disposables.forEach(d => { try { d.dispose(); } catch { /* ignore */ } });
    this._disposables = [];
    try { this._output.dispose(); } catch { /* ignore */ }
  }
}
