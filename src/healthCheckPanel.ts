import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as accountStore from './accountStore';
import { testModelAccess, ProbeModelInfo, setCascadeProbeEnabled, setCascadeProbeMessage } from './usageService';
import { stopIsolatedCascadeProbeLs, startLsPool, acquireLs, releaseLs, stopLsPool, LsInfo } from './cascadeProbe';
import { StoredAccount } from './types';
import { scheduleAcpConnectionRecovery } from './acpRecovery';
import { UsageTracker } from './usageTracker';
import { getPoolRoot, ensureDir } from './utils';
import { injectSession, getLastInjectFailure } from './sessionInjector';
import { acquireLock, releaseLock } from './accountLock';
import * as usageDiskCache from './usageDiskCache';
import { getStateDbPath, getIdeDisplayName } from './ideDetector';

let _panel: vscode.WebviewPanel | undefined;
let _abortController: AbortController | undefined;
let _paused = false;
let _pausePromise: Promise<void> | undefined;
let _pauseResolve: (() => void) | undefined;
let _diskWatcher: fs.FSWatcher | undefined;
let _lastDiskWriteTs = 0;

const DEFAULT_HEALTH_CHECK_CONCURRENCY = 5;
const DEFAULT_HEALTH_CHECK_MODEL: ProbeModelInfo = {
  label: 'Claude Opus 4.6',
  uid: 'claude-opus-4-6',
};
const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_PROBE_MESSAGES = [
  '你好，简单回复一下即可。',
  '请用一句话回复“收到”。',
  '帮我确认一下你现在可以正常回复吗？',
  '请简单回答：可以。',
  '测试一下当前会话是否可用，请简短回复。',
];

/** 测活结果缓存（跨面板生命周期保留，供侧栏卡片读取） */
const _resultCache = new Map<string, { ok: boolean; reason?: string; status?: number; ts: number; modelUid?: string }>();

const HEALTH_RESULTS_FILE = 'health-results.json';

function getHealthResultsPath(): string {
  return path.join(getPoolRoot(), HEALTH_RESULTS_FILE);
}

/** 从共享磁盘文件加载测活结果（启动时 + 文件变更时） */
function loadResultsFromDisk(): void {
  try {
    const p = getHealthResultsPath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;
    let changed = false;
    for (const [email, entry] of Object.entries(obj)) {
      const e = entry as any;
      if (!e || typeof e.ok !== 'boolean') continue;
      const existing = _resultCache.get(email);
      // 仅当磁盘记录更新时覆盖
      if (!existing || (e.ts && e.ts > existing.ts)) {
        _resultCache.set(email, { ok: e.ok, reason: e.reason, status: e.status, ts: e.ts || 0, modelUid: e.modelUid });
        changed = true;
      }
    }
    if (changed) {
      console.log('[healthCheck] Loaded', _resultCache.size, 'results from disk');
    }
  } catch (err) {
    console.warn('[healthCheck] loadResultsFromDisk failed:', err);
  }
}

/** 将测活结果持久化到共享磁盘文件 */
function saveResultsToDisk(): void {
  try {
    ensureDir(getPoolRoot());
    const p = getHealthResultsPath();
    const obj: Record<string, any> = {};
    for (const [email, entry] of _resultCache) {
      obj[email] = entry;
    }
    const tmp = p + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, p);
    } catch {
      try { fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
    }
    _lastDiskWriteTs = Date.now();
  } catch (err) {
    console.warn('[healthCheck] saveResultsToDisk failed:', err);
  }
}

/** 启动文件监听，实现多实例共享 */
function startDiskWatcher(): void {
  if (_diskWatcher) return;
  try {
    ensureDir(getPoolRoot());
    _diskWatcher = fs.watch(getPoolRoot(), (_evt, filename) => {
      if (filename !== HEALTH_RESULTS_FILE) return;
      // 跳过自己刚写入的变更
      if (Date.now() - _lastDiskWriteTs < 2000) return;
      loadResultsFromDisk();
      // 推送给前端
      if (_panel) {
        const list: any[] = [];
        for (const [email, entry] of _resultCache) {
          list.push({ email, ...entry });
        }
        _panel.webview.postMessage({ type: 'diskResults', list });
      }
    });
  } catch {}
}

function stopDiskWatcher(): void {
  if (_diskWatcher) {
    _diskWatcher.close();
    _diskWatcher = undefined;
  }
}

/** 标签颜色缓存（由侧栏同步过来） */
let _tagColors: Record<string, string> = {};

export function setTagColors(colors: Record<string, string>) {
  _tagColors = colors || {};
  if (_panel) {
    _panel.webview.postMessage({ type: 'tagColors', colors: _tagColors });
  }
}

export function getHealthCheckCache(): Map<string, { ok: boolean; reason?: string; status?: number; ts: number; modelUid?: string }> {
  return _resultCache;
}

/** 清除指定账号的测活异常缓存（正常使用成功后调用） */
export function clearHealthResult(email: string): void {
  const cached = _resultCache.get(email);
  if (cached && !cached.ok) {
    _resultCache.set(email, { ok: true, reason: '使用正常，已清除异常', ts: Date.now() });
    saveResultsToDisk();
  }
}

export function openHealthCheckPanel(
  ctx: vscode.ExtensionContext,
  extensionUri: vscode.Uri,
  usageTracker?: UsageTracker
): void {
  if (_panel) {
    _panel.reveal(vscode.ViewColumn.One);
    pushAccounts(ctx);
    return;
  }

  _panel = vscode.window.createWebviewPanel(
    'windsurfPool.healthCheck',
    '测活面板',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')],
    }
  );

  const webview = _panel.webview;
  const ext = vscode.extensions.getExtension('local.kite') || vscode.extensions.getExtension('local.windsurf-pool');
  const ver = ext?.packageJSON?.version || '0.0.0';
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'health-check.css'));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'health-check.js'));

  webview.html = buildHtml(cssUri.toString(), jsUri.toString(), ver);

  // 启动时加载磁盘历史结果，实现重启持久化 + 多实例共享
  loadResultsFromDisk();
  startDiskWatcher();

  setTimeout(() => pushAccounts(ctx), 200);
  // 动态读取 Windsurf 本地数据库中的模型列表
  readModelsFromStateDb().then(models => {
    _panel?.webview.postMessage({ type: 'modelList', models });
  }).catch(() => {});

  webview.onDidReceiveMessage(async (msg: any) => {
    switch (msg.type) {
      case 'startCheck': {
        const model: ProbeModelInfo | undefined = msg.modelUid
          ? { label: msg.modelLabel || msg.modelUid, uid: msg.modelUid }
          : undefined;
        await runHealthCheck(ctx, msg.emails, model, msg.concurrency, usageTracker, {
          probeMessage: msg.probeMessage,
          probeMessages: Array.isArray(msg.probeMessages) ? msg.probeMessages : undefined,
          randomProbe: !!msg.randomProbe,
          probeDelaySec: Number(msg.probeDelaySec) || 0,
        });
        break;
      }
      case 'stopCheck': {
        _paused = false;
        if (_pauseResolve) { _pauseResolve(); _pauseResolve = undefined; _pausePromise = undefined; }
        _abortController?.abort();
        break;
      }
      case 'pauseCheck': {
        _paused = true;
        _pausePromise = new Promise<void>(resolve => { _pauseResolve = resolve; });
        _panel?.webview.postMessage({ type: 'checkPaused' });
        break;
      }
      case 'resumeCheck': {
        _paused = false;
        if (_pauseResolve) { _pauseResolve(); _pauseResolve = undefined; _pausePromise = undefined; }
        _panel?.webview.postMessage({ type: 'checkResumed' });
        break;
      }
      case 'resetMachineId': {
        await resetMachineId();
        break;
      }
      case 'retestByStatus': {
        // 二次测试：只重测指定结果状态的账号
        const model2: ProbeModelInfo | undefined = msg.modelUid
          ? { label: msg.modelLabel || msg.modelUid, uid: msg.modelUid }
          : undefined;
        await runHealthCheck(ctx, msg.emails, model2, msg.concurrency, usageTracker, {
          probeMessage: msg.probeMessage,
          probeMessages: Array.isArray(msg.probeMessages) ? msg.probeMessages : undefined,
          randomProbe: !!msg.randomProbe,
          probeDelaySec: Number(msg.probeDelaySec) || 0,
        });
        break;
      }
      case 'switchAccount': {
        const email = msg.email;
        if (!email) break;
        const accounts = await accountStore.readAccounts(ctx);
        const account = accounts.find(a => a.email === email);
        if (!account) {
          _panel?.webview.postMessage({ type: 'switchResult', email, ok: false, reason: '账号不存在' });
          break;
        }
        const prevEmail = ctx.globalState.get<string>('lastEmail') || '';
        console.log(`[healthCheck][switch] 测活面板切号: ${prevEmail} → ${email}`);
        const switchOk = await injectSession(ctx, account);
        if (switchOk) {
          if (prevEmail) releaseLock(prevEmail);
          acquireLock(email);
          await accountStore.setCurrentAccount(ctx, email);
          clearHealthResult(email);
          _panel?.webview.postMessage({ type: 'switchResult', email, ok: true });
          scheduleAcpConnectionRecovery('health-panel-switch', 1500);
          vscode.commands.executeCommand('windsurfPool.refreshSidebar');
          pushAccounts(ctx);
        } else {
          const failure = getLastInjectFailure(email);
          _panel?.webview.postMessage({ type: 'switchResult', email, ok: false, reason: failure?.reason || '切换失败' });
        }
        break;
      }
      case 'updateTags': {
        const email = msg.email;
        const newTags: string[] = msg.tags || [];
        if (!email) break;
        await accountStore.updateTags(ctx, email, newTags);
        // 刷新账号列表（面板 + 侧栏）
        pushAccounts(ctx);
        _panel?.webview.postMessage({ type: 'tagsUpdated', email, tags: newTags });
        vscode.commands.executeCommand('windsurfPool.refreshSidebar');
        break;
      }
    }
  });

  _panel.onDidDispose(() => {
    _abortController?.abort();
    stopIsolatedCascadeProbeLs();
    stopDiskWatcher();
    _panel = undefined;
  });
}

/** 推送账号列表（含缓存的测活结果）给面板 */
async function pushAccounts(ctx: vscode.ExtensionContext) {
  if (!_panel) return;
  const accounts = await accountStore.readAccounts(ctx);
  const usageEntries = usageDiskCache.loadAll();
  const list = accounts.map(a => {
    const ue = usageEntries.get(a.email);
    const plan = ue?.snapshot?.planName || '';
    return {
      email: a.email,
      disabled: !!a.disabled,
      tag: a.tag || '',
      tags: a.tags || (a.tag ? [a.tag] : []),
      plan,
      cached: _resultCache.get(a.email) || null,
    };
  });
  _panel.webview.postMessage({ type: 'accounts', list });
  _panel.webview.postMessage({ type: 'tagColors', colors: _tagColors });
}

/** 逐个测活，实时推送结果 */
async function runHealthCheck(
  ctx: vscode.ExtensionContext,
  emails?: string[],
  model?: ProbeModelInfo,
  concurrency?: number,
  usageTracker?: UsageTracker,
  probeOptions?: {
    probeMessage?: string;
    probeMessages?: string[];
    randomProbe?: boolean;
    probeDelaySec?: number;
  }
) {
  if (!_panel) return;

  _abortController = new AbortController();
  const signal = _abortController.signal;
  setCascadeProbeEnabled(true);
  const probePool = normalizeProbeMessages(probeOptions);
  setCascadeProbeMessage(pickProbeMessage(probePool, 0, probeOptions?.randomProbe));

  const accounts = await accountStore.readAccounts(ctx);
  let targets: StoredAccount[];
  if (emails && emails.length > 0) {
    targets = accounts.filter(a => emails.includes(a.email));
  } else {
    targets = accounts.filter(a => !a.disabled);
  }

  const total = targets.length;
  let workerCount = Math.max(1, Math.min(20, Number(concurrency) || DEFAULT_HEALTH_CHECK_CONCURRENCY));
  const probeDelayMs = Math.max(0, Math.min(600, Number(probeOptions?.probeDelaySec) || 0)) * 1000;
  const usePool = workerCount > 1 && !!model; // 多 LS 并行仅在有模型选择时启用
  if (total === 0) {
    _panel.webview.postMessage({ type: 'checkDone', total, empty: true });
    _abortController = undefined;
    setCascadeProbeEnabled(false);
    return;
  }

  // 启动 LS 池：LS 数量 = 并发数（1:1），上限 10（~1.5GB 内存）
  let poolReady = 0;
  if (usePool) {
    const poolSize = workerCount;
    _panel.webview.postMessage({ type: 'checkProgress', email: '', index: 0, total, status: 'waiting', waitSec: 0 });
    try {
      poolReady = await startLsPool(poolSize);
    } catch { poolReady = 0; }
  }

  _panel.webview.postMessage({ type: 'checkStart', total, concurrency: workerCount, probeDelaySec: probeDelayMs / 1000 });

  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (!signal.aborted) {
      // 暂停等待
      if (_paused && _pausePromise) {
        await _pausePromise;
        if (signal.aborted) break;
      }
      const i = nextIndex++;
      if (i >= targets.length) break;

      const account = targets[i];
      if (probeDelayMs > 0 && i > 0) {
        _panel?.webview.postMessage({
          type: 'checkProgress',
          email: account.email,
          index: i,
          total,
          status: 'waiting',
          waitSec: Math.ceil(probeDelayMs / 1000),
        });
        await delayWithAbort(probeDelayMs, signal);
        if (signal.aborted) break;
      }

      const activeProbeMessage = pickProbeMessage(probePool, i, probeOptions?.randomProbe);
      setCascadeProbeMessage(activeProbeMessage);

      const cached = _resultCache.get(account.email);
      const modelUid = model?.uid || '';
      // 余额号豁免限速冷却：账号有付费余额时即使被报"限速"也实际可用，应正常复测
      const diskEntry = usageDiskCache.readEntry(account.email);
      const hasOverageBalance = ((diskEntry?.snapshot?.overageBalanceMicros) || 0) > 0;
      // 缓存命中且在限速冷却内（统一判断，避免日志判断与跳过判断条件不同步）
      const cachedIsRateLimit = !!(cached
        && cached.modelUid === modelUid
        && !cached.ok
        && /全局限制|长期不可用|限流|限速|rate limit|quota.*exhaust|usage.*quota|daily.*quota|消息已用尽|剩余 0|暂不可用/i.test(cached.reason || '')
        && Date.now() - cached.ts < RATE_LIMIT_COOLDOWN_MS);
      // 有余额且本应被冷却跳过时，输出日志便于排查"为什么这个限速号又测了一次"
      if (cachedIsRateLimit && hasOverageBalance) {
        const balanceUsd = ((diskEntry?.snapshot?.overageBalanceMicros) || 0) / 1_000_000;
        console.log(`[healthCheck] ${account.email} 余额可用 ($${balanceUsd.toFixed(2)})，跳过限速冷却，正常复测`);
      }
      // 仅在限速冷却内且无余额时跳过本轮探测
      if (cachedIsRateLimit && !hasOverageBalance && cached) {
        completed++;
        _panel?.webview.postMessage({
          type: 'checkResult',
          email: account.email,
          ok: false,
          reason: `${cached.reason || '限速'} (30分钟冷却内跳过复测)`,
          httpStatus: cached.status,
          elapsed: 0,
          index: i,
          completed,
          total,
        });
        continue;
      }

      // 通知前端"正在检测此账号"
      _panel?.webview.postMessage({
        type: 'checkProgress',
        email: account.email,
        index: i,
        total,
        status: 'running',
        probeMessage: activeProbeMessage,
      });

      // 从 LS 池获取独立实例，probe 连接失败时自动换 LS 重试（最多 3 次）
      const MAX_PROBE_RETRIES = 3;
      const startMs = Date.now();
      let result: { ok: boolean; reason?: string; status?: number; raw?: string } | undefined;
      let lastError: string | undefined;

      for (let attempt = 0; attempt < MAX_PROBE_RETRIES; attempt++) {
        if (signal.aborted) break;
        let workerLs: LsInfo | undefined;
        if (usePool && poolReady > 0) {
          const acquired = await acquireLs(30000);
          if (acquired) workerLs = acquired;
        }

        try {
          const r = await testModelAccess(account, model, signal, activeProbeMessage, workerLs);
          if (workerLs) releaseLs(workerLs);
          if (signal.aborted) break;
          // 探针连接失败 / 提供商不可达 / 全局限速 → 换 LS 重试
          const isConnErr = r.reason && /探针失败.*(?:ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up)/i.test(r.reason);
          const isProviderErr = !r.ok && r.reason && /提供商不可达|provider.*unavailable|provider.*unreachable/i.test(r.reason);
          const isGlobalRate = !r.ok && r.reason && /全局速率限制|全局限制|global rate limit|all API providers.*rate limit|官方全局限制/i.test(r.reason);
          if ((isConnErr || isProviderErr || isGlobalRate) && attempt < MAX_PROBE_RETRIES - 1) {
            lastError = r.reason;
            continue; // 重试
          }
          result = r;
          break;
        } catch (err: any) {
          if (workerLs) releaseLs(workerLs);
          lastError = `异常: ${err?.message || err}`;
          if (attempt < MAX_PROBE_RETRIES - 1) continue;
        }
      }

      if (signal.aborted) break;
      const elapsed = Date.now() - startMs;
      const finalOk = result?.ok ?? false;
      const finalReason = result?.reason || lastError || '探针重试耗尽';

      _resultCache.set(account.email, {
        ok: finalOk,
        reason: finalReason,
        status: result?.status,
        ts: Date.now(),
        modelUid: model?.uid || '',
      });
      saveResultsToDisk();
      usageTracker?.recordDiagnostic({
        ts: Date.now(),
        email: account.email,
        source: 'health',
        level: finalOk ? 'ok' : (/全局限制|长期不可用|限流|限速|rate limit|message limit|quota.*exhaust|usage.*quota|daily.*quota|消息.*上限|已达上限|用尽|cooldown|reset|暂不可用/i.test(finalReason) ? 'warn' : 'error'),
        reason: finalReason,
        model: model?.label || model?.uid || DEFAULT_HEALTH_CHECK_MODEL.label,
        status: result?.status,
      });

      completed++;
      _panel?.webview.postMessage({
        type: 'checkResult',
        email: account.email,
        ok: finalOk,
        reason: finalReason,
        httpStatus: result?.status,
        elapsed,
        index: i,
        completed,
        total,
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(workerCount, targets.length) }, () => worker())
  );

  _panel?.webview.postMessage({ type: 'checkDone', total });
  _abortController = undefined;
  setCascadeProbeEnabled(false);
  stopLsPool();
  stopIsolatedCascadeProbeLs();
  scheduleAcpConnectionRecovery('health-check-done', 1500);

  // 通知侧栏刷新卡片 badge
  vscode.commands.executeCommand('windsurfPool.refreshSidebar');
}

function normalizeProbeMessages(options?: { probeMessage?: string; probeMessages?: string[] }): string[] {
  const fromPool = (options?.probeMessages || [])
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .map(x => x.slice(0, 200));
  if (fromPool.length > 0) return [...new Set(fromPool)];

  const one = String(options?.probeMessage || '').trim();
  if (one) return [one.slice(0, 200)];
  return DEFAULT_PROBE_MESSAGES;
}

function pickProbeMessage(pool: string[], index: number, random?: boolean): string {
  const list = pool.length > 0 ? pool : DEFAULT_PROBE_MESSAGES;
  if (random) return list[Math.floor(Math.random() * list.length)] || DEFAULT_PROBE_MESSAGES[0];
  return list[index % list.length] || DEFAULT_PROBE_MESSAGES[0];
}

function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** 供侧栏调用：直接测单个账号并返回结果 */
export async function testSingleAccount(ctx: vscode.ExtensionContext, email: string, modelUid?: string): Promise<{ ok: boolean; reason?: string }> {
  const accounts = await accountStore.readAccounts(ctx);
  const account = accounts.find(a => a.email === email);
  if (!account) return { ok: false, reason: '账号不存在' };

  const model: ProbeModelInfo | undefined = modelUid ? { label: modelUid, uid: modelUid } : undefined;
  const result = await testModelAccess(account, model);
  _resultCache.set(email, {
    ok: result.ok,
    reason: result.reason,
    status: result.status,
    ts: Date.now(),
    modelUid: model?.uid || '',
  });
  saveResultsToDisk();
  return result;
}

/**
 * 从 Windsurf 本地 state.vscdb 动态读取可用模型列表
 * 返回 { label, uid } 数组，label 与 Windsurf 下拉一致
 */
async function readModelsFromStateDb(): Promise<Array<{ label: string; uid: string }>> {
  const dbPath = getStateDbPath();
  const sqlitePath = path.join(vscode.env.appRoot, 'node_modules/@vscode/sqlite3');

  const raw: string | null = await new Promise((resolve, reject) => {
    try {
      const sqlite = require(sqlitePath);
      const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY, (err: any) => {
        if (err) { reject(err); return; }
        db.get('SELECT value FROM ItemTable WHERE key = ?', ['windsurfConfigurations'], (e: any, row: any) => {
          db.close();
          if (e) reject(e);
          else resolve(row ? row.value : null);
        });
      });
    } catch (e) { reject(e); }
  });

  if (!raw) return [];
  const buf = Buffer.from(raw, 'base64');
  const text = buf.toString('utf8');

  // 提取可读 label
  const labels = new Set<string>();
  const labelRe = /(?:Claude|GPT|SWE|Gemini|Grok|DeepSeek|Llama|Qwen|Mistral)[\w\s.\-()]+/g;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text)) !== null) {
    const name = m[0].trim();
    if (name.length > 3 && name.length < 50 && !/_/.test(name)) labels.add(name);
  }

  // 提取 UID
  const uidMap = new Map<string, string>();
  const uidRe = /\b(claude|gpt|swe|gemini|grok|deepseek|llama|qwen|mistral)[-a-z0-9]+/g;
  const allUids = new Set<string>();
  while ((m = uidRe.exec(text)) !== null) {
    const uid = m[0];
    if (uid.length > 3 && uid.includes('-')) allUids.add(uid);
  }

  function normModelName(s: string): string {
    return s
      .replace(/[().]/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  function uidForLabel(label: string): string {
    const labelNorm = normModelName(label);
    const candidates = [...allUids];
    const exact = candidates.find(uid => normModelName(uid) === labelNorm);
    if (exact) return exact;

    // 普通模型优先匹配同名 UID，避免 "Claude Sonnet 4.6" 被错配到 Thinking/1M。
    const plain = candidates.find(uid => {
      const uidNorm = normModelName(uid);
      return uidNorm.startsWith(labelNorm)
        && !/\b(thinking|1m|low|medium|high|xhigh|fast|max|mini)\b/i.test(uidNorm.slice(labelNorm.length));
    });
    if (plain) return plain;

    const contained = candidates.find(uid => {
      const uidNorm = normModelName(uid);
      return uidNorm === labelNorm || labelNorm.includes(uidNorm) || uidNorm.includes(labelNorm);
    });
    return contained || label.toLowerCase().replace(/[\s.]/g, '-');
  }

  // label → uid 映射
  for (const label of labels) {
    uidMap.set(label, uidForLabel(label));
  }

  // 过滤掉变体（Low/Medium/High 等），只保留主流模型
  const variantRe = /\b(Low|Medium|High|XHigh|X-High|Fast|Mini|1M|Spark|Max|Minimal)\b/i;
  return [...labels]
    .filter(l => !variantRe.test(l))
    .sort()
    .map(label => ({
      label,
      uid: uidMap.get(label) || label.toLowerCase().replace(/[\s.]/g, '-')
    }))
    .filter((m, idx, arr) => arr.findIndex(x => x.uid === m.uid) === idx);
}

function buildHtml(cssUri: string, jsUri: string, version: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div class="hc-app">

  <header class="hc-header">
    <div class="hc-header-left">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
      <span class="hc-title">测活面板</span>
      <span class="hc-version">v${version}</span>
    </div>
    <div class="hc-header-right">
      <button class="hc-btn" id="hcPrivacy" title="隐私模式">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        隐私
      </button>
      <select class="hc-concurrency-select" id="hcConcurrencySelect" title="并发数">
        <option value="1" selected>稳定 x1</option>
        <option value="3">并发 x3</option>
        <option value="5">并发 x5</option>
        <option value="8">并发 x8</option>
        <option value="10">并发 x10</option>
        <option value="15">并发 x15</option>
        <option value="20">并发 x20</option>
      </select>
      <select class="hc-model-select" id="hcModelSelect" title="选择测试模型">
        <option value="">快速检测（不发消息）</option>
        <option value="MODEL_SWE_1_5">SWE-1.5（免费探针）</option>
        <option value="${DEFAULT_HEALTH_CHECK_MODEL.uid}" selected>${DEFAULT_HEALTH_CHECK_MODEL.label}</option>
      </select>
      <input class="hc-probe-input" id="hcProbeMessage" title="真实探针消息；开启随机后作为备用" value="你好" maxlength="200" />
      <button class="hc-btn hc-btn-toggle is-active" id="hcRandomProbe" title="每个账号随机使用提示词池中的一句">随机</button>
      <button class="hc-btn" id="hcPromptPoolBtn" title="编辑随机测活提示词">词池</button>
      <label class="hc-delay-field" title="真实探针之间的等待间隔，建议并发 x1 时使用">
        <span>间隔</span>
        <input id="hcProbeDelay" type="number" min="0" max="600" step="1" value="60" />
        <span>秒</span>
      </label>
      <button class="hc-btn hc-btn-primary" id="hcStartBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        一键测活
      </button>
      <label class="hc-check-label" title="跳过已有测试结果的账号，适合重启后继续未完成的测试">
        <input type="checkbox" id="hcSkipTested" />
        跳过已测
      </label>
      <button class="hc-btn" id="hcResetMachineId" title="重置 Windsurf 机器码（machineId / sqmId / devDeviceId），需完全关闭后重启生效" style="color:#f59e0b;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        重置机器码
      </button>
    </div>
  </header>

  <!-- 汇总卡片 -->
  <div class="hc-stats-row" id="hcStatsRow">
    <div class="hc-stat-card"><div class="hc-stat-num" id="hcStatTotal">0</div><div class="hc-stat-label">总数</div></div>
    <div class="hc-stat-card hc-stat-ok"><div class="hc-stat-num" id="hcStatOk">0</div><div class="hc-stat-label">正常</div></div>
    <div class="hc-stat-card hc-stat-limit"><div class="hc-stat-num" id="hcStatLimit">0</div><div class="hc-stat-label">限速</div></div>
    <div class="hc-stat-card hc-stat-fail"><div class="hc-stat-num" id="hcStatFail">0</div><div class="hc-stat-label">无权/失效</div></div>
    <div class="hc-stat-card"><div class="hc-stat-num" id="hcStatTime">—</div><div class="hc-stat-label">耗时</div></div>
  </div>

  <!-- 进度条 -->
  <div class="hc-progress-wrap" id="hcProgressWrap" hidden>
    <div class="hc-progress-bar"><div class="hc-progress-fill" id="hcProgressFill"></div></div>
    <div class="hc-progress-text">
      <span id="hcProgressText">准备中...</span>
      <div class="hc-progress-actions">
        <button class="hc-btn hc-btn-pause" id="hcPauseBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>暂停</button>
        <button class="hc-btn hc-btn-stop" id="hcStopBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>停止</button>
      </div>
    </div>
  </div>

  <!-- 历史轮次 -->
  <div class="hc-hist-bar" id="hcHistoryBar" hidden></div>

  <!-- 筛选栏 -->
  <div class="hc-filter-bar" id="hcFilterBar">
    <input type="text" class="hc-search-input" id="hcSearchInput" placeholder="搜索账号..." />
    <!-- 多维筛选下拉 -->
    <div class="hc-filter-wrap" id="hcFilterWrap">
      <button class="hc-filter-trigger" id="hcFilterTrigger" title="多维筛选">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        <span id="hcFilterLabel">筛选</span>
        <span class="hc-filter-count" id="hcFilterCount"></span>
      </button>
      <div class="hc-filter-dropdown" id="hcFilterDropdown" hidden>
        <div class="hc-filter-section" id="hcFilterPlanSection">
          <div class="hc-filter-section-title">套餐</div>
          <div class="hc-filter-options" id="hcFilterPlanList"></div>
        </div>
        <div class="hc-filter-section" id="hcFilterTagSection">
          <div class="hc-filter-section-title">标签</div>
          <div class="hc-filter-options" id="hcFilterTagList"></div>
        </div>
        <div class="hc-filter-actions">
          <button class="hc-btn hc-btn-sm" id="hcFilterClearBtn">清空筛选</button>
        </div>
      </div>
    </div>
    <div class="hc-status-tabs" id="hcStatusTabs">
      <span class="hc-status-tab active" data-status="all">全部</span>
      <span class="hc-status-tab" data-status="ok">可用</span>
      <span class="hc-status-tab" data-status="limit">限速</span>
      <span class="hc-status-tab" data-status="noaccess">无权限</span>
      <span class="hc-status-tab" data-status="invalid">Key 失效</span>
      <span class="hc-status-tab" data-status="expired">到期/封禁</span>
      <span class="hc-status-tab" data-status="fail">其它异常</span>
      <span class="hc-status-tab" data-status="pending">待检测</span>
    </div>
    <button class="hc-btn hc-btn-sm hc-btn-retest" id="hcRetestBtn" hidden title="对当前筛选的账号进行二次测试">重测此类</button>
    <div class="hc-tag-chips" id="hcTagChips"></div>
  </div>

  <!-- 结果表格 -->
  <div class="hc-table-wrap">
    <table class="hc-table">
      <thead><tr>
        <th class="hc-col-status">状态</th>
        <th class="hc-col-email">账号</th>
        <th class="hc-col-tag">标签</th>
        <th class="hc-col-model">模型</th>
        <th class="hc-col-result">结果</th>
        <th class="hc-col-plan">会员</th>
        <th class="hc-col-quota">配额</th>
        <th class="hc-col-ops">操作</th>
      </tr></thead>
      <tbody id="hcTableBody"></tbody>
    </table>
    <div class="hc-empty" id="hcEmpty">点击「一键测活」开始检测所有账号</div>
  </div>

</div>

<div class="hc-toast" id="hcToast" hidden></div>
<div class="hc-detail-tip" id="hcDetailTip" hidden></div>

<!-- 标签编辑弹窗 -->
<div class="hc-modal-backdrop" id="hcTagEditModal" hidden>
  <div class="hc-modal" style="width:min(400px,90vw)">
    <div class="hc-modal-head">
      <span id="hcTagEditTitle">编辑标签</span>
      <button class="hc-modal-close" id="hcTagEditClose">×</button>
    </div>
    <div style="padding:12px">
      <div id="hcTagEditSelected" style="display:flex;flex-wrap:wrap;gap:4px;min-height:28px;margin-bottom:8px;padding:4px 0"></div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" id="hcTagEditInput" placeholder="输入标签名称，回车添加" style="flex:1;padding:5px 8px;border:1px solid var(--hc-border);border-radius:var(--hc-radius);background:var(--hc-surface);color:var(--hc-fg);font-size:12px;outline:none" />
        <button class="hc-btn hc-btn-primary hc-btn-sm" id="hcTagEditAddBtn">添加</button>
      </div>
      <div style="margin-top:8px">
        <label style="font-size:11px;opacity:0.7">已有标签（点击添加/移除）</label>
        <div id="hcTagEditExisting" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;max-height:120px;overflow-y:auto"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
        <button class="hc-btn" id="hcTagEditCancel">取消</button>
        <button class="hc-btn hc-btn-primary" id="hcTagEditSave">保存</button>
      </div>
    </div>
  </div>
</div>
<div class="hc-modal-backdrop" id="hcPromptModal" hidden>
  <div class="hc-modal">
    <div class="hc-modal-head">
      <span>随机测活提示词</span>
      <button class="hc-modal-close" id="hcPromptClose">×</button>
    </div>
    <textarea class="hc-prompt-pool" id="hcPromptPool" spellcheck="false">${DEFAULT_PROBE_MESSAGES.join('\n')}</textarea>
    <div class="hc-modal-foot">
      <span class="hc-muted">每行一句，测活时随机选取。建议保留简短、自然的请求。</span>
      <button class="hc-btn hc-btn-primary" id="hcPromptSave">保存</button>
    </div>
  </div>
</div>

<script>const vscode = acquireVsCodeApi();</script>
<script src="${jsUri}"></script>
</body>
</html>`;
}

/**
 * 重置 Windsurf 全部设备指纹（4 项）：
 *   1. storage.json → telemetry.machineId  (64 hex)
 *   2. storage.json → telemetry.sqmId      ({UUID})
 *   3. storage.json → telemetry.devDeviceId (uuid)
 *   4. machineid 文件                       (uuid 纯文本)
 */
export async function resetMachineId(): Promise<void> {
  // 跨平台配置目录
  const configDir = process.platform === 'win32'
    ? process.env.APPDATA || ''
    : process.platform === 'darwin'
      ? path.join(process.env.HOME || '', 'Library', 'Application Support')
      : path.join(process.env.HOME || '', '.config');

  const versions = ['Devin', 'Windsurf', 'Windsurf - Next'];
  const storagePaths = versions
    .map(v => path.join(configDir, v, 'User', 'globalStorage', 'storage.json'))
    .filter(p => fs.existsSync(p));
  const machineIdPaths = versions
    .map(v => path.join(configDir, v, 'machineid'))
    .filter(p => fs.existsSync(p));

  // macOS 专属：.installerId 文件
  const installerIdPaths = process.platform === 'darwin'
    ? versions.map(v => path.join(configDir, v, '.installerId')).filter(p => fs.existsSync(p))
    : [];

  if (storagePaths.length === 0 && machineIdPaths.length === 0 && installerIdPaths.length === 0) {
    vscode.window.showErrorMessage(`未找到 ${getIdeDisplayName()} 配置文件，请确认已安装。`);
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `即将重置 ${getIdeDisplayName()} 全部设备指纹（machineId / macMachineId / sqmId / devDeviceId / machineid / .installerId）。\n⚠️ 请先关闭所有 ${getIdeDisplayName()} 窗口，否则退出时会覆盖回旧值。`,
    { modal: true },
    '重置并备份'
  );
  if (confirm !== '重置并备份') return;

  const newMachineId = crypto.randomBytes(32).toString('hex');
  const newMacMachineId = crypto.randomUUID();  // MAC 地址派生的机器码
  const newSqmId = `{${crypto.randomUUID().toUpperCase()}}`;
  const newDevDeviceId = crypto.randomUUID();
  const newMachineIdFile = crypto.randomUUID(); // machineid 文件用 UUID

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let resetCount = 0;

  // 1. 重置 storage.json 中的 4 个字段
  for (const filePath of storagePaths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      fs.writeFileSync(filePath + `.backup_${ts}`, raw, 'utf-8');

      data['telemetry.machineId'] = newMachineId;
      data['telemetry.macMachineId'] = newMacMachineId;
      data['telemetry.sqmId'] = newSqmId;
      data['telemetry.devDeviceId'] = newDevDeviceId;

      fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf-8');
      resetCount++;
    } catch (err: any) {
      const ver = path.basename(path.resolve(filePath, '..', '..', '..', '..'));
      vscode.window.showErrorMessage(`重置 storage.json 失败 (${ver}): ${err.message}`);
    }
  }

  // 2. 重置 machineid 独立文件
  for (const filePath of machineIdPaths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      fs.writeFileSync(filePath + `.backup_${ts}`, raw, 'utf-8');
      fs.writeFileSync(filePath, newMachineIdFile, 'utf-8');
      resetCount++;
    } catch (err: any) {
      const ver = path.basename(path.dirname(filePath));
      vscode.window.showErrorMessage(`重置 machineid 失败 (${ver}): ${err.message}`);
    }
  }

  // 3. macOS: 重置 .installerId 文件
  for (const filePath of installerIdPaths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      fs.writeFileSync(filePath + `.backup_${ts}`, raw, 'utf-8');
      fs.writeFileSync(filePath, crypto.randomUUID(), 'utf-8');
      resetCount++;
    } catch (err: any) {
      const ver = path.basename(path.dirname(filePath));
      vscode.window.showErrorMessage(`重置 .installerId 失败 (${ver}): ${err.message}`);
    }
  }

  if (resetCount > 0) {
    _panel?.webview.postMessage({
      type: 'machineIdReset',
      machineId: newMachineId.slice(0, 8) + '...',
      devDeviceId: newDevDeviceId,
    });
    vscode.window.showInformationMessage(
      `已重置 ${resetCount} 个文件的设备指纹（含 macMachineId / machineid${installerIdPaths.length ? ' / .installerId' : ''}），原文件已备份。\n请完全关闭 ${getIdeDisplayName()} 后重新打开生效。`
    );
  }
}

/**
 * 静默重置 Windsurf 设备指纹（切号后自动调用，无弹窗）
 * 返回 true 表示成功重置了至少一个文件
 */
export async function silentResetMachineId(): Promise<boolean> {
  const configDir = process.platform === 'win32'
    ? process.env.APPDATA || ''
    : process.platform === 'darwin'
      ? path.join(process.env.HOME || '', 'Library', 'Application Support')
      : path.join(process.env.HOME || '', '.config');

  const versions = ['Devin', 'Windsurf', 'Windsurf - Next'];
  const storagePaths = versions
    .map(v => path.join(configDir, v, 'User', 'globalStorage', 'storage.json'))
    .filter(p => fs.existsSync(p));
  const machineIdPaths = versions
    .map(v => path.join(configDir, v, 'machineid'))
    .filter(p => fs.existsSync(p));
  const installerIdPaths = process.platform === 'darwin'
    ? versions.map(v => path.join(configDir, v, '.installerId')).filter(p => fs.existsSync(p))
    : [];

  if (storagePaths.length === 0 && machineIdPaths.length === 0 && installerIdPaths.length === 0) {
    console.log(`[silentResetMachineId] 未找到 ${getIdeDisplayName()} 配置文件`);
    return false;
  }

  const newMachineId = crypto.randomBytes(32).toString('hex');
  const newMacMachineId = crypto.randomUUID();
  const newSqmId = `{${crypto.randomUUID().toUpperCase()}}`;
  const newDevDeviceId = crypto.randomUUID();
  const newMachineIdFile = crypto.randomUUID();

  let resetCount = 0;

  for (const filePath of storagePaths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      data['telemetry.machineId'] = newMachineId;
      data['telemetry.macMachineId'] = newMacMachineId;
      data['telemetry.sqmId'] = newSqmId;
      data['telemetry.devDeviceId'] = newDevDeviceId;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf-8');
      resetCount++;
    } catch (err) {
      console.warn('[silentResetMachineId] storage.json 失败:', err);
    }
  }

  for (const filePath of machineIdPaths) {
    try {
      fs.writeFileSync(filePath, newMachineIdFile, 'utf-8');
      resetCount++;
    } catch (err) {
      console.warn('[silentResetMachineId] machineid 失败:', err);
    }
  }

  for (const filePath of installerIdPaths) {
    try {
      fs.writeFileSync(filePath, crypto.randomUUID(), 'utf-8');
      resetCount++;
    } catch (err) {
      console.warn('[silentResetMachineId] .installerId 失败:', err);
    }
  }

  if (resetCount > 0) {
    console.log(`[silentResetMachineId] ✓ 已静默重置 ${resetCount} 个设备指纹文件 (machineId=${newMachineId.slice(0, 8)}...)`);
  }
  return resetCount > 0;
}
