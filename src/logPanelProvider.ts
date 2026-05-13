import * as vscode from 'vscode';
import { UsageTracker } from './usageTracker';
import { AutoSwitcher, UsageCacheEntry } from './autoSwitcher';
import * as accountStore from './accountStore';
import { requestSyncLogs, onBridgeResult } from './bridgeServer';

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
    if (msg.type === 'refresh') {
      pushAllData(ctx, tracker, webview);
    }
  });

  // 实时推送配额变动
  _listenerDisposable = tracker.addHistoryListener(() => {
    if (_panel) pushAllData(ctx, tracker, _panel.webview);
  });

  _panel.onDidDispose(() => {
    _listenerDisposable?.dispose();
    _listenerDisposable = undefined;
    unsubscribeBridge?.();
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
  const summary = tracker.getSummary();

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
        tags: a.tag ? [a.tag] : [],
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
    switchLogs, recoveryLogs, diagnoseLogs, summary, accountOverview,
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
    <div class="lp-filter-row">
      <div class="lp-filter-group">
        <label class="lp-filter-label">账号</label>
        <select class="lp-select" id="lpEmailFilter"><option value="">全部账号</option><option value="_recent_">最近使用</option></select>
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
    <div class="lp-chart-wrap">
      <div class="lp-chart-yaxis">
        <span>100%</span><span>80%</span><span>60%</span><span>40%</span><span>20%</span><span>0%</span>
      </div>
      <svg id="lpChart" class="lp-chart" preserveAspectRatio="none"></svg>
      <div class="lp-chart-legend">
        <span class="lp-legend"><span class="lp-legend-dot" style="background:#5b9aff"></span>日配额</span>
        <span class="lp-legend"><span class="lp-legend-dot" style="background:#ff9a5b"></span>周配额</span>
        <span class="lp-legend"><span class="lp-legend-line lp-line-warn"></span>30%</span>
        <span class="lp-legend"><span class="lp-legend-line lp-line-danger"></span>10%</span>
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
          <th>日变化</th>
          <th>周变化</th>
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
  </div>


  <!-- Toast -->
  <div class="lp-toast" id="lpToast" hidden></div>

  <footer class="lp-footer" id="lpFooter"></footer>
</div>
<script src="${jsUri}"></script>
</body></html>`;
}
