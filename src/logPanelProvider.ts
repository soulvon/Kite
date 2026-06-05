import * as vscode from 'vscode';
import { UsageTracker } from './usageTracker';
import { AutoSwitcher, UsageCacheEntry } from './autoSwitcher';
import * as accountStore from './accountStore';
import { requestSyncLogs, onBridgeResult, getBridgeInfo } from './bridgeServer';
import { getBridgeRelayScript } from './signalBridge';
import { getContextMonitorSnapshot } from './contextMonitor';

let _panel: vscode.WebviewPanel | undefined;
let _listenerDisposable: { dispose(): void } | undefined;
let _autoSwitcher: AutoSwitcher | undefined;

export function openLogPanel(
  ctx: vscode.ExtensionContext,
  tracker: UsageTracker,
  extensionUri: vscode.Uri,
  tab?: string,
  switcher?: AutoSwitcher
): void {
  if (switcher) _autoSwitcher = switcher;
  if (_panel) {
    _panel.reveal(vscode.ViewColumn.One);
    if (tab) _panel.webview.postMessage({ type: 'switchTab', tab });
    pushAllData(ctx, tracker, _panel.webview);
    return;
  }

  _panel = vscode.window.createWebviewPanel(
    'windsurfPool.logPanel',
    '统计面板',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')],
    }
  );

  const webview = _panel.webview;
  const ext = vscode.extensions.getExtension('local.windsurf-pool');
  const ver = ext?.packageJSON?.version || '0.0.0';
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'log-panel.css'));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'log-panel.js'));

  webview.html = buildHtml(cssUri.toString(), jsUri.toString(), ver, tab || 'quota');

  setTimeout(() => pushAllData(ctx, tracker, webview), 300);

  // 请求 windsurf-better.js 同步日志到 globalState
  requestSyncLogs();
  // 延迟重试：bridge 可能尚未就绪（统计面板 relay → window.top.postMessage → 轮询启动 需 1-3s）
  setTimeout(() => requestSyncLogs(), 2000);
  setTimeout(() => requestSyncLogs(), 4000);

  // 监听 bridge 返回的日志数据
  const resultListener = async (result: any) => {
    if (result.action === 'syncLogs') {
      if (Array.isArray(result.payload?.recoveryLogs)) {
        await ctx.globalState.update('recoveryLogs', result.payload.recoveryLogs);
      }
      if (Array.isArray(result.payload?.diagnoseLogs)) {
        await ctx.globalState.update('diagnoseLogs', result.payload.diagnoseLogs);
      }
      // 推送更新后的数据给面板
      if (_panel) pushAllData(ctx, tracker, _panel.webview);
    }
  };
  const unsubscribeBridge = onBridgeResult(resultListener);

  webview.onDidReceiveMessage(async (msg: any) => {
  if (msg.type === 'requestBridgeInfo') {
      // 统计面板的 relay 脚本请求 bridge 信息 → 广播到 workbench 顶层 frame
      const info = getBridgeInfo();
      if (info) webview.postMessage({ type: 'bridgeInfo', port: info.port, token: info.token });
      return;
    }
  if (msg.type === 'anomalyCheckDone') {
      // 保存异常数量到 globalState，供侧边栏读取
      ctx.globalState.update('anomalyCount', msg.count || 0);
      // 通过命令通知侧边栏
      vscode.commands.executeCommand('windsurfPool._anomalyCountUpdate', msg.count || 0);
      return;
    }
  if (msg.type === 'refresh') {
      requestSyncLogs(); // 重新从 windsurf-better.js 拉取最新日志
      pushAllData(ctx, tracker, webview);
      // 触发后端重新拉取配额，等结果后告知前端
      if (_autoSwitcher) {
        try {
          const result = await _autoSwitcher.refreshAll(true);
          webview.postMessage({ type: 'refreshDone', result });
        } catch (err) {
          webview.postMessage({ type: 'refreshDone', error: err instanceof Error ? err.message : String(err) });
        }
      } else {
        webview.postMessage({ type: 'refreshDone', result: { total: 0, success: 0, failed: 0, skippedExhausted: 0 } });
      }
    } else if (msg.type === 'refreshContext') {
      const contextMonitor = await getContextMonitorSnapshot();
      webview.postMessage({ type: 'contextData', contextMonitor });
    }
  });

  // 实时推送配额变动（200ms 防抖，避免多账号并发刷新时频繁全量推送）
  let _pushDebounceTimer: NodeJS.Timeout | null = null;
  _listenerDisposable = tracker.addHistoryListener(() => {
    if (_pushDebounceTimer) clearTimeout(_pushDebounceTimer);
    _pushDebounceTimer = setTimeout(() => {
      _pushDebounceTimer = null;
      if (_panel) pushAllData(ctx, tracker, _panel.webview);
    }, 200);
  });

  _panel.onDidDispose(() => {
    _listenerDisposable?.dispose();
    _listenerDisposable = undefined;
    unsubscribeBridge?.();
    if (_pushDebounceTimer) { clearTimeout(_pushDebounceTimer); _pushDebounceTimer = null; }
    _panel = undefined;
  });
}

/** 推送全量数据给面板 */
async function pushAllData(ctx: vscode.ExtensionContext, tracker: UsageTracker, webview: vscode.Webview) {
  const currentEmail = ctx.globalState.get<string>('lastEmail') || '';
  const quotaEntries = tracker.getQuotaHistory(undefined, 500);
  const quotaEmails = tracker.getHistoryEmails();
  const switchLogs: string[] = ctx.globalState.get('autoSwitchLogs', []);
  const recoveryLogs: any[] = ctx.globalState.get('recoveryLogs', []);
  const diagnoseLogs: any[] = ctx.globalState.get('diagnoseLogs', []);
  const diagnosticLogs = tracker.getDiagnosticHistory(undefined, 500);
  const summary = tracker.getSummary();
  const contextMonitor = await getContextMonitorSnapshot();

  // 账号总览：从 autoSwitcher 缓存 + accountStore 组合
  let accountOverview: any[] = [];
  try {
    const accounts = await accountStore.readAccounts(ctx);
    const cache = _autoSwitcher?.getAllCached();
    accountOverview = accounts.map(a => {
      const c = cache?.get(a.email);
      const snap = c?.snapshot;
      return {
        email: a.email,
        name: a.name || '',
        tags: a.tags || (a.tag ? [a.tag] : []),
        disabled: !!a.disabled,
        daily: snap ? Math.round(snap.dailyRemainingPercent) : null,
        weekly: snap ? Math.round(snap.weeklyRemainingPercent) : null,
        flex: snap ? (snap as any).flexCredits ?? null : null,
        cacheAge: c ? Math.round((Date.now() - c.ts) / 1000) : null,
        error: c?.error || null,
        isCurrent: a.email === currentEmail,
      };
    });
  } catch {}

  webview.postMessage({
    type: 'allData', currentEmail, quotaEntries, quotaEmails,
    switchLogs, recoveryLogs, diagnoseLogs, diagnosticLogs, summary, accountOverview, contextMonitor,
  });
}

/** 若面板已打开，追加切号日志并推送 */
export function pushSwitchLogToPanel(ctx: vscode.ExtensionContext, tracker: UsageTracker) {
  if (_panel) pushAllData(ctx, tracker, _panel.webview);
}

function buildHtml(cssUri: string, jsUri: string, version: string, initialTab: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${cssUri}">
</head>
<body data-initial-tab="${initialTab}">
<div class="lp-app">

  <header class="lp-header">
    <div class="lp-header-left">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      <span class="lp-title">WINDSURF POOL 统计面板</span>
      <span class="lp-version">v${version}</span>
    </div>
    <div class="lp-header-right">
      <button class="lp-btn" id="lpPrivacy" title="隐私模式：隐藏邮箱等敏感信息">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        隐私
      </button>
      <button class="lp-btn" id="lpRefresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        刷新
      </button>
    </div>
  </header>

  <nav class="lp-tabs">
    <button class="lp-tab active" data-tab="overview">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      账号总览
    </button>
    <button class="lp-tab" data-tab="quota">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      配额历史
    </button>
    <button class="lp-tab" data-tab="switch">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
      换号日志
    </button>
    <button class="lp-tab" data-tab="recovery">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      恢复日志
    </button>
    <button class="lp-tab" data-tab="diagnose">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="11"/><line x1="11" y1="14" x2="11.01" y2="14"/></svg>
      扫描诊断
    </button>
    <button class="lp-tab" data-tab="diagnostic">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-7"/><circle cx="7" cy="15" r="1"/><circle cx="11" cy="11" r="1"/><circle cx="14" cy="14" r="1"/><circle cx="19" cy="7" r="1"/></svg>
      账号诊断
    </button>
    <button class="lp-tab" data-tab="anomaly">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
      异常监控
    </button>
    <button class="lp-tab" data-tab="context">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6M7 16h8"/></svg>
      上下文
    </button>
  </nav>

  <!-- 账号总览 -->
  <div class="lp-content" id="lpOverview">
    <div class="lp-stats-row" id="lpStatsRow">
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpStatAccounts">0</div><div class="lp-stat-label">总账号</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpStatNormal">0</div><div class="lp-stat-label">正常</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpStatExhausted">0</div><div class="lp-stat-label">配额耗尽</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpStatError">0</div><div class="lp-stat-label">异常</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpStatAvgDaily">—</div><div class="lp-stat-label">均日配额</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpStatAvgWeekly">—</div><div class="lp-stat-label">均周配额</div></div>
    </div>
    <div class="lp-section-header">
      <span>账号配额一览</span>
      <span class="lp-count" id="lpAccountCount"></span>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr>
          <th></th>
          <th>账号</th>
          <th>标签</th>
          <th>日剩余</th>
          <th>周剩余</th>
          <th>缓存</th>
          <th>状态</th>
        </tr></thead>
        <tbody id="lpAccountBody"></tbody>
      </table>
    </div>
  </div>

  <!-- 配额历史 -->
  <div class="lp-content" id="lpQuota" hidden>
    <!-- 筛选栏（搜索+标签+时间） -->
    <div class="lp-quota-filter-bar">
      <input type="text" class="lp-search-input" id="lpEmailSearch" placeholder="搜索账号...">
      <div class="lp-quick-btns">
        <button class="lp-quick-btn" id="lpBtnCurrent">当前</button>
        <button class="lp-quick-btn" id="lpBtnRecent">最近</button>
      </div>
      <div class="lp-time-group">
        <button class="lp-time-btn" data-range="1h">1小时</button>
        <button class="lp-time-btn active" data-range="24h">24h</button>
        <button class="lp-time-btn" data-range="7d">7天</button>
        <button class="lp-time-btn" data-range="30d">30天</button>
        <button class="lp-time-btn" data-range="all">全部</button>
      </div>
    </div>
    <div class="lp-tag-chips" id="lpTagChips"></div>
    <div class="lp-chart-wrap">
      <div class="lp-chart-yaxis">
        <span>100%</span><span>80%</span><span>60%</span><span>40%</span><span>20%</span><span>0%</span>
      </div>
      <svg id="lpChart" class="lp-chart" preserveAspectRatio="none"></svg>
      <div class="lp-chart-legend">
        <span class="lp-legend"><span class="lp-legend-dot" style="background:#5b9aff"></span>日配额</span>
        <span class="lp-legend"><span class="lp-legend-dot" style="background:#ff9a5b"></span>周配额</span>
        <span class="lp-legend" id="lpLegendBalance" style="display:none" title="付费余额随时间变化（右 Y 轴：美元）"><span class="lp-legend-line lp-line-balance"></span>余额 <span class="lp-legend-balance-range" id="lpLegendBalanceRange"></span></span>
        <span class="lp-legend" title="剩余 30% 警戒线"><span class="lp-legend-line lp-line-warn"></span>30% 警戒</span>
        <span class="lp-legend" title="剩余 10% 危险线"><span class="lp-legend-line lp-line-danger"></span>10% 危险</span>
      </div>
    </div>
    <div class="lp-section-header">
      <span>明细</span>
      <span class="lp-count" id="lpQuotaCount"></span>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr>
          <th>记录时间</th>
          <th>账号</th>
          <th>日剩余</th>
          <th>周剩余</th>
          <th title="付费余额（overageBalanceMicros）">余额</th>
          <th title="百分点变化（与该账号上一次记录相比）">日变化 <span class="lp-th-unit">pt</span></th>
          <th title="百分点变化（与该账号上一次记录相比）">周变化 <span class="lp-th-unit">pt</span></th>
          <th>重置时间</th>
          <th>倒计时</th>
        </tr></thead>
        <tbody id="lpQuotaBody"></tbody>
      </table>
    </div>
    <div class="lp-pagination" id="lpQuotaPagination"></div>
  </div>

  <!-- 换号日志 -->
  <div class="lp-content" id="lpSwitch" hidden>
    <div class="lp-section-header">
      <span>切号记录</span>
      <span class="lp-count" id="lpSwitchCount"></span>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr>
          <th style="width:62px">时间</th>
          <th style="width:46px">类型</th>
          <th>来源账号</th>
          <th style="width:90px">来源配额</th>
          <th style="width:100px">触发原因</th>
          <th>目标账号</th>
          <th style="width:62px">结果</th>
        </tr></thead>
        <tbody id="lpSwitchBody"></tbody>
      </table>
    </div>
  </div>

  <!-- 恢复日志 -->
  <div class="lp-content" id="lpRecovery" hidden>
    <div class="lp-filter-row">
      <div class="lp-filter-group">
        <label class="lp-filter-label">分类</label>
        <select class="lp-select" id="lpRecoveryFilter">
          <option value="">全部</option>
          <option value="networkErrors">网络</option>
          <option value="quotaErrors">配额</option>
          <option value="modelErrors">模型</option>
          <option value="continuationErrors">截断</option>
          <option value="permissionRequests">权限</option>
          <option value="userIntervention">介入</option>
          <option value="custom">自定义</option>
        </select>
      </div>
    </div>
    <div class="lp-section-header">
      <span>恢复执行记录</span>
      <span class="lp-count" id="lpRecoveryCount"></span>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr>
          <th>时间</th>
          <th>分类</th>
          <th>错误文本</th>
          <th>执行动作</th>
          <th>耗时</th>
        </tr></thead>
        <tbody id="lpRecoveryBody"></tbody>
      </table>
    </div>
    <div class="lp-pagination" id="lpRecoveryPagination"></div>
  </div>

  <!-- 扫描诊断 -->
  <div class="lp-content" id="lpDiagnose" hidden>
    <div class="lp-filter-row">
      <div class="lp-filter-group">
        <label class="lp-filter-label">阶段</label>
        <select class="lp-select" id="lpDiagnoseFilter">
          <option value="">全部</option>
          <option value="no-match">未匹配（有候选）</option>
          <option value="pattern-miss">命中文本但无 PATTERN 匹配</option>
          <option value="pattern-matched">命中 PATTERN（已走 banner）</option>
          <option value="cooldown-skip">冷却跳过</option>
          <option value="banner-shown-skip">Banner 显示中跳过</option>
          <option value="no-rule">无规则配置</option>
        </select>
      </div>
      <div class="lp-filter-group">
        <span class="lp-filter-label">说明</span>
        <span style="color:var(--lp-fg-mute,#8a93a4);font-size:12px">每次 checkForErrors 扫描时记录一条；用于排查"为什么 banner 没触发"</span>
      </div>
    </div>
    <div class="lp-section-header">
      <span>扫描诊断记录</span>
      <span class="lp-count" id="lpDiagnoseCount"></span>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr>
          <th>时间</th>
          <th>阶段</th>
          <th>原因 / 命中文本</th>
          <th>候选/详情</th>
        </tr></thead>
        <tbody id="lpDiagnoseBody"></tbody>
      </table>
    </div>
    <div class="lp-pagination" id="lpDiagnosePagination"></div>
  </div>

  <!-- 账号诊断 -->
  <div class="lp-content" id="lpDiagnostic" hidden>
    <div class="lp-filter-row">
      <div class="lp-filter-group">
        <label class="lp-filter-label">结果</label>
        <select class="lp-select" id="lpDiagnosticFilter">
          <option value="">全部</option>
          <option value="warn">限速/暂不可用</option>
          <option value="error">无权/失败</option>
          <option value="ok">正常</option>
        </select>
      </div>
      <div class="lp-filter-group">
        <span class="lp-filter-label">说明</span>
        <span style="color:var(--lp-fg-mute,#8a93a4);font-size:12px">记录测活与切号预检结果；账号卡片会展示每个账号最新结论</span>
      </div>
    </div>
    <div class="lp-section-header">
      <span>账号诊断记录</span>
      <span class="lp-count" id="lpDiagnosticCount"></span>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr>
          <th>时间</th>
          <th>来源</th>
          <th>账号</th>
          <th>模型</th>
          <th>结果</th>
          <th>原因</th>
        </tr></thead>
        <tbody id="lpDiagnosticBody"></tbody>
      </table>
    </div>
    <div class="lp-pagination" id="lpDiagnosticPagination"></div>
  </div>

  <!-- 异常监控 -->
  <div class="lp-content" id="lpAnomaly" hidden>
    <div class="lp-anomaly-header">
      <div class="lp-anomaly-title-row">
        <div class="lp-section-title">异常监控</div>
        <div class="lp-anomaly-actions">
          <label class="lp-anomaly-tag-label">标签：<input type="text" class="lp-input lp-anomaly-tag-input" id="lpAnomalyTag" value="监控" placeholder="标签名"></label>
          <button class="lp-btn lp-btn-sm" id="lpAnomalyCheck">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            重新检测
          </button>
        </div>
      </div>
      <div class="lp-anomaly-desc">检测带 <code>监控</code> 标签的账号，配额减少但本机无使用记录 = 异常</div>
    </div>
    <div class="lp-anomaly-summary" id="lpAnomalySummary" hidden>
      <div class="lp-anomaly-summary-cards" id="lpAnomalyStats"></div>
    </div>
    <div class="lp-anomaly-cards" id="lpAnomalyBody"></div>
    <div class="lp-anomaly-empty" id="lpAnomalyEmpty">切换到此标签页时自动检测</div>
  </div>

  <!-- 上下文监控 -->
  <div class="lp-content" id="lpContext" hidden>
    <div class="lp-context-toolbar">
      <div>
        <div class="lp-section-title">Windsurf 上下文监控</div>
        <div class="lp-context-sub" id="lpContextMeta">等待刷新…</div>
      </div>
      <button class="lp-btn" id="lpContextRefresh">刷新上下文</button>
    </div>
    <div class="lp-stats-row">
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpCtxUsed">—</div><div class="lp-stat-label">上下文</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpCtxPct">—</div><div class="lp-stat-label">占用率</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpCtxInput">—</div><div class="lp-stat-label">Input</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpCtxOutput">—</div><div class="lp-stat-label">Output</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpCtxCache">—</div><div class="lp-stat-label">Cache</div></div>
      <div class="lp-stat-card"><div class="lp-stat-num" id="lpCtxSteps">—</div><div class="lp-stat-label">Steps</div></div>
    </div>
    <div class="lp-context-active" id="lpContextActive"></div>
    <div class="lp-section-header">
      <span>最近会话</span>
      <span class="lp-count" id="lpContextCount"></span>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr>
          <th>会话</th>
          <th>状态</th>
          <th>模型</th>
          <th>上下文</th>
          <th>Steps</th>
          <th>最新回复</th>
        </tr></thead>
        <tbody id="lpContextBody"></tbody>
      </table>
    </div>
  </div>


  <!-- Toast -->
  <div class="lp-toast" id="lpToast" hidden></div>

  <footer class="lp-footer" id="lpFooter"></footer>
</div>
<script>var vscode = acquireVsCodeApi();</script>
<script>${getBridgeRelayScript()}</script>
<script src="${jsUri}"></script>
</body></html>`;
}
