/* eslint-disable */
(function () {
  // @ts-ignore
  const vscode = window.vscode || acquireVsCodeApi();

  let allQuotaEntries = [];
  let allQuotaEmails = [];
  let allSwitchLogs = [];
  let allRecoveryLogs = [];
  let allDiagnoseLogs = [];
  let allDiagnosticLogs = [];
  let allAccountOverview = [];
  let contextMonitor = null;
  let allSummary = {};
  let currentEmail = '';
  let filterEmail = '';
  let timeRange = '24h';
  let recoveryFilter = '';
  let diagnoseFilter = '';
  let diagnosticFilter = '';
  let quotaPage = 1;
  let recoveryPage = 1;
  let diagnosePage = 1;
  let diagnosticPage = 1;
  const PAGE_SIZE = 30;
  let privacyMode = false;
  let refreshCooldown = 0;

  // ── 隐私模式 ──
  const privacyBtn = document.getElementById('lpPrivacy');
  privacyBtn.querySelector('svg').style.opacity = '0.6'; // 初始同步
  privacyBtn.addEventListener('click', () => {
    privacyMode = !privacyMode;
    privacyBtn.classList.toggle('lp-btn-active', privacyMode);
    privacyBtn.querySelector('svg').style.opacity = privacyMode ? '1' : '0.6';
    renderOverview();
    renderQuota();
    renderSwitch();
    renderRecovery();
    renderDiagnose();
    renderDiagnostic();
    renderContext();
    renderFooter();
    showToast(privacyMode ? '隐私模式已开启' : '隐私模式已关闭');
  });

  function maskEmail(em) {
    if (!privacyMode || !em) return em;
    const at = em.indexOf('@');
    if (at <= 0) return '***';
    return em[0] + '***' + em.slice(at);
  }
  function maskEmailShort(em) {
    if (!privacyMode) return shortEmail(em);
    return maskEmail(em);
  }

  // ── Toast ──
  function showToast(msg, dur) {
    const el = document.getElementById('lpToast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('lp-toast-show');
    setTimeout(() => { el.classList.remove('lp-toast-show'); el.hidden = true; }, dur || 2000);
  }


  // ── Tab 切换 ──
  const tabs = document.querySelectorAll('.lp-tab');
  const contents = document.querySelectorAll('.lp-content');
  let activeTab = '';
  function switchTab(name) {
    activeTab = name;
    tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === name));
    contents.forEach(c => { c.hidden = c.id !== 'lp' + name.charAt(0).toUpperCase() + name.slice(1); });
  }
  tabs.forEach(t => t.addEventListener('click', () => switchTab(t.getAttribute('data-tab'))));

  const initialTab = document.body.getAttribute('data-initial-tab') || 'quota';
  switchTab(initialTab);

  // ── 图表 resize 自适应 ──
  // 用 ResizeObserver 监听 chart 容器宽度变化，防抖后重绘
  let resizeDebounce = null;
  const chartWrap = document.querySelector('.lp-chart-wrap');
  if (chartWrap && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        // 只在配额 tab 显示时重绘，避免无效计算
        if (activeTab === 'quota') renderQuota();
      }, 120);
    }).observe(chartWrap);
  }

  // ── 刷新按钮（10s 冷却）──
  const refreshBtn = document.getElementById('lpRefresh');
  let refreshTimer = null;
  refreshBtn.addEventListener('click', () => {
    if (refreshCooldown > 0) return;
    vscode.postMessage({ type: 'refresh' });
    refreshCooldown = 10;
    refreshBtn.classList.add('lp-btn-cooling');
    refreshBtn.setAttribute('disabled', '');
    const tick = () => {
      refreshCooldown--;
      if (refreshCooldown <= 0) {
        refreshBtn.classList.remove('lp-btn-cooling');
        refreshBtn.removeAttribute('disabled');
        refreshBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 刷新';
        clearInterval(refreshTimer);
        refreshTimer = null;
      } else {
        refreshBtn.innerHTML = '<svg class="lp-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> ' + refreshCooldown + 's';
      }
    };
    tick();
    refreshTimer = setInterval(tick, 1000);
    showToast('正在刷新…');
  });

  // ── 时间范围 ──
  document.querySelectorAll('.lp-time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lp-time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      timeRange = btn.getAttribute('data-range');
      quotaPage = 1;
      renderQuota();
    });
  });

  // ── 账号筛选 ──
  const emailSel = document.getElementById('lpEmailFilter');
  emailSel.addEventListener('change', () => {
    filterEmail = emailSel.value;
    quotaPage = 1;
    renderQuota();
  });

  // ── 快捷筛选按钮 ──
  const btnCurrent = document.getElementById('lpBtnCurrent');
  const btnRecent = document.getElementById('lpBtnRecent');
  function setQuickFilter(val) {
    // 若目标值在下拉中不存在，回落为「全部账号」并提示，避免 filterEmail 与 select 显示不一致
    const exists = !!emailSel.querySelector('option[value="' + val + '"]');
    if (val && !exists) {
      filterEmail = '';
      emailSel.value = '';
      quotaPage = 1;
      btnCurrent.classList.remove('lp-quick-btn-active');
      btnRecent.classList.remove('lp-quick-btn-active');
      renderQuota();
      showToast(val === '_recent_' ? '暂无最近 7 天的配额变动' : '当前账号尚无配额变动记录');
      return;
    }
    filterEmail = val;
    emailSel.value = val;
    quotaPage = 1;
    btnCurrent.classList.toggle('lp-quick-btn-active', val === currentEmail && !!currentEmail);
    btnRecent.classList.toggle('lp-quick-btn-active', val === '_recent_');
    renderQuota();
  }
  if (btnCurrent) btnCurrent.addEventListener('click', () => {
    setQuickFilter(currentEmail || '');
  });
  if (btnRecent) btnRecent.addEventListener('click', () => {
    setQuickFilter('_recent_');
  });

  // ── 恢复日志筛选 ──
  const recFilter = document.getElementById('lpRecoveryFilter');
  if (recFilter) recFilter.addEventListener('change', () => {
    recoveryFilter = recFilter.value;
    recoveryPage = 1;
    renderRecovery();
  });

  // ── 扫描诊断筛选 ──
  const diagFilter = document.getElementById('lpDiagnoseFilter');
  if (diagFilter) diagFilter.addEventListener('change', () => {
    diagnoseFilter = diagFilter.value;
    diagnosePage = 1;
    renderDiagnose();
  });

  const diagnosticFilterEl = document.getElementById('lpDiagnosticFilter');
  if (diagnosticFilterEl) diagnosticFilterEl.addEventListener('change', () => {
    diagnosticFilter = diagnosticFilterEl.value;
    diagnosticPage = 1;
    renderDiagnostic();
  });

  const contextRefreshBtn = document.getElementById('lpContextRefresh');
  if (contextRefreshBtn) contextRefreshBtn.addEventListener('click', () => {
    contextRefreshBtn.setAttribute('disabled', '');
    contextRefreshBtn.textContent = '刷新中…';
    vscode.postMessage({ type: 'refreshContext' });
  });

  // ── 数据接收 ──
  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.type === 'allData') {
      allQuotaEntries = msg.quotaEntries || [];
      allQuotaEmails = msg.quotaEmails || [];
      allSwitchLogs = msg.switchLogs || [];
      allRecoveryLogs = msg.recoveryLogs || [];
      allDiagnoseLogs = msg.diagnoseLogs || [];
      allDiagnosticLogs = msg.diagnosticLogs || [];
      allAccountOverview = msg.accountOverview || [];
      contextMonitor = msg.contextMonitor || null;
      allSummary = msg.summary || {};
      currentEmail = msg.currentEmail || '';

      // 更新邮箱下拉
      const prev = emailSel.value;
      emailSel.innerHTML = '<option value="">全部账号</option><option value="_recent_">最近使用</option>';
      for (const em of allQuotaEmails) {
        const opt = document.createElement('option');
        opt.value = em;
        opt.textContent = maskEmailShort(em);
        emailSel.appendChild(opt);
      }
      if (!prev && currentEmail && allQuotaEmails.includes(currentEmail)) {
        emailSel.value = currentEmail;
        filterEmail = currentEmail;
      } else {
        emailSel.value = prev || '';
        filterEmail = emailSel.value;
      }

      renderOverview();
      renderQuota();
      renderSwitch();
      renderRecovery();
      renderDiagnose();
      renderDiagnostic();
      renderContext();
      renderFooter();
    }
    if (msg.type === 'contextData') {
      contextMonitor = msg.contextMonitor || null;
      const btn = document.getElementById('lpContextRefresh');
      if (btn) { btn.removeAttribute('disabled'); btn.textContent = '刷新上下文'; }
      renderContext();
      showToast(contextMonitor && contextMonitor.ok ? '上下文已刷新' : '上下文刷新失败', 2500);
    }
    if (msg.type === 'switchTab') switchTab(msg.tab);
    if (msg.type === 'refreshDone') {
      // 提前结束冷却（如果还在冷却中）
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      refreshCooldown = 0;
      refreshBtn.classList.remove('lp-btn-cooling');
      refreshBtn.removeAttribute('disabled');
      refreshBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 刷新';
      // 显示结果 toast
      if (msg.error) {
        showToast('刷新失败：' + msg.error, 3000);
      } else if (msg.result) {
        const r = msg.result;
        if (r.success === 0 && r.failed === 0 && r.skippedExhausted === 0) {
          showToast('已是最新数据（TTL 内无需刷新）');
        } else {
          const parts = [];
          if (r.success > 0) parts.push(r.success + ' 个已更新');
          if (r.failed > 0) parts.push(r.failed + ' 个失败');
          if (r.skippedExhausted > 0) parts.push(r.skippedExhausted + ' 个耗尽跳过');
          showToast('刷新完成：' + parts.join('，'));
        }
      } else {
        showToast('刷新完成');
      }
    }
  });

  // ── 工具函数 ──
  function shortEmail(em) {
    return em.length > 32 ? em.slice(0, 14) + '…' + em.slice(-14) : em;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const yearPrefix = d.getFullYear() !== now.getFullYear() ? (d.getFullYear() + '/') : '';
    return yearPrefix + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function fmtCountdown(resetAt) {
    if (!resetAt) return '—';
    const ms = resetAt * 1000 - Date.now();
    if (ms <= 0) return '<span class="lp-c-green">已重置</span>';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return d + '天' + h + 'h' + pad2(m) + 'm';
    return h + 'h' + pad2(m) + 'm';
  }

  function filterByTime(entries) {
    if (timeRange === 'all') return entries;
    const now = Date.now();
    const ranges = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    const cutoff = now - (ranges[timeRange] || 86400000);
    return entries.filter(e => e.ts >= cutoff);
  }

  function getFiltered() {
    let arr = allQuotaEntries;
    if (filterEmail) {
      if (filterEmail === '_recent_') {
        // 最近使用：筛选最近 7 天有配额变动的账号
        var recentCutoff = Date.now() - 604800000; // 7 天
        var recentEmails = new Set();
        for (var i = 0; i < allQuotaEntries.length; i++) {
          if (allQuotaEntries[i].ts >= recentCutoff) {
            recentEmails.add(allQuotaEntries[i].email);
          }
        }
        arr = arr.filter(function(e) { return recentEmails.has(e.email); });
      } else {
        arr = arr.filter(function(e) { return e.email === filterEmail; });
      }
    }
    return filterByTime(arr);
  }

  // ── 配额历史渲染 ──
  function renderQuota() {
    const filtered = getFiltered();
    document.getElementById('lpQuotaCount').textContent = filtered.length + ' 条';
    renderQuotaChart(filtered);
    renderQuotaTable(filtered);
  }

  // 为多账号分线场景生成调色板
  const MULTI_DAILY_COLORS = ['#5b9aff', '#3fb950', '#a371f7', '#e5a445', '#f778ba', '#79c0ff', '#56d364', '#d2a8ff'];
  const MULTI_WEEKLY_COLORS = ['#ff9a5b', '#f0883e', '#f85149', '#bf8700', '#db61a2', '#ffa657', '#ff7b72', '#cc8533'];

  function renderQuotaChart(entries) {
    const svg = document.getElementById('lpChart');
    if (!svg) return;
    const rect = svg.parentElement.getBoundingClientRect();
    const W = Math.max(rect.width - 50, 200);  // 减去 y 轴宽度
    const H = 200;
    const PAD = 4;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    // 获取主题色
    var cs = getComputedStyle(document.body);
    var gridColor = cs.getPropertyValue('--lp-chart-grid').trim() || 'rgba(128,128,128,0.1)';
    var dimColor = cs.getPropertyValue('--lp-fg-dim').trim() || '#888';

    // 网格线生成器（复用）
    function buildGrid() {
      let g = '';
      for (let pct = 0; pct <= 100; pct += 20) {
        const y = PAD + (100 - pct) / 100 * (H - PAD * 2);
        g += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + gridColor + '" />';
      }
      // 警告/危险线
      const y30 = PAD + 70 / 100 * (H - PAD * 2);
      const y10 = PAD + 90 / 100 * (H - PAD * 2);
      g += '<line x1="0" y1="' + y30 + '" x2="' + W + '" y2="' + y30 + '" stroke="rgba(255,200,50,0.2)" stroke-dasharray="4,3" />';
      g += '<line x1="0" y1="' + y10 + '" x2="' + W + '" y2="' + y10 + '" stroke="rgba(255,80,80,0.2)" stroke-dasharray="4,3" />';
      return g;
    }

    if (entries.length === 0) {
      // 0 条：空提示 + 引导
      const cx = W / 2, cy = H / 2;
      const rangeHint = timeRange === 'all' ? '该账号暂无配额记录' : '此时间范围内无配额变动';
      const actionHint = timeRange === 'all' ? '' : '切换至「24h」或「全部」查看更多';
      svg.innerHTML = buildGrid()
        + '<text x="' + cx + '" y="' + (cy - 8) + '" text-anchor="middle" fill="' + dimColor + '" font-size="13" font-weight="500">' + rangeHint + '</text>'
        + (actionHint ? '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" fill="' + dimColor + '" font-size="11" opacity="0.7">' + actionHint + '</text>' : '');
      return;
    }

    if (entries.length === 1) {
      // 1 条：画单点 + 引导
      const e = entries[0];
      const cx = W / 2;
      const cyD = PAD + (100 - e.daily) / 100 * (H - PAD * 2);
      const cyW = PAD + (100 - e.weekly) / 100 * (H - PAD * 2);
      let parts = buildGrid()
        + '<circle cx="' + cx + '" cy="' + cyD + '" r="5" fill="#5b9aff" stroke="rgba(91,154,255,0.3)" stroke-width="4" />'
        + '<circle cx="' + cx + '" cy="' + cyW + '" r="5" fill="#ff9a5b" stroke="rgba(255,154,91,0.3)" stroke-width="4" />';
      // 数值标签（错开方向避免重叠）
      const labelDailyAbove = cyD < cyW;
      parts += '<text x="' + cx + '" y="' + (labelDailyAbove ? cyD - 12 : cyD + 20) + '" text-anchor="middle" fill="#5b9aff" font-size="11" font-weight="600">日 ' + e.daily + '%</text>';
      parts += '<text x="' + cx + '" y="' + (labelDailyAbove ? cyW + 20 : cyW - 12) + '" text-anchor="middle" fill="#ff9a5b" font-size="11" font-weight="600">周 ' + e.weekly + '%</text>';
      parts += '<text x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle" fill="' + dimColor + '" font-size="11" opacity="0.7">仅 1 条记录 · 趋势线需至少 2 个数据点</text>';
      svg.innerHTML = parts;
      return;
    }

    // 按账号分组
    const byEmail = {};
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!byEmail[e.email]) byEmail[e.email] = [];
      byEmail[e.email].push(e);
    }
    const emails = Object.keys(byEmail);

    // 计算 x 坐标的时间范围（共享 timeline）
    let minTs = Infinity, maxTs = -Infinity;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].ts < minTs) minTs = entries[i].ts;
      if (entries[i].ts > maxTs) maxTs = entries[i].ts;
    }
    const tsSpan = Math.max(maxTs - minTs, 1);
    const tsToX = (ts) => PAD + (ts - minTs) / tsSpan * (W - PAD * 2);
    const pctToY = (p) => PAD + (100 - p) / 100 * (H - PAD * 2);

    // 单账号路径生成（检测重置事件断线）
    // 配额"重置"特征：相邻两点中后者比前者大 +20pt 以上，视为重置，断开折线
    function buildPath(arr, key) {
      let path = '';
      let started = false;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const x = tsToX(p.ts);
        const y = pctToY(p[key]);
        if (i > 0 && p[key] - arr[i - 1][key] >= 20) {
          // 重置：开始新段
          started = false;
        }
        path += (started ? 'L ' : 'M ') + x + ',' + y + ' ';
        started = true;
      }
      return path;
    }

    let body = buildGrid();

    if (emails.length === 1) {
      // 单账号：仍按小时聚合（更平滑），但检测重置事件
      const arr = byEmail[emails[0]].slice().sort((a, b) => a.ts - b.ts);
      const dailyPath = buildPath(arr, 'daily');
      const weeklyPath = buildPath(arr, 'weekly');
      body += '<path d="' + dailyPath + '" fill="none" stroke="#5b9aff" stroke-width="2" stroke-linejoin="round" />'
            + '<path d="' + weeklyPath + '" fill="none" stroke="#ff9a5b" stroke-width="2" stroke-linejoin="round" />';
      // 重置事件标记（小三角）
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].daily - arr[i - 1].daily >= 20) {
          const x = tsToX(arr[i].ts);
          body += '<g transform="translate(' + x + ',' + (H - 4) + ')"><path d="M0,-6 L4,0 L-4,0 Z" fill="#3fb950" opacity="0.7"><title>配额重置（日 ' + arr[i - 1].daily + '% → ' + arr[i].daily + '%）</title></path></g>';
        }
      }
    } else {
      // 多账号：每账号 2 条（日/周）；不再聚合（聚合无意义）
      // 顶部提示
      body += '<text x="' + (W - 6) + '" y="14" text-anchor="end" fill="' + dimColor + '" font-size="10" opacity="0.8">' + emails.length + ' 个账号 · 每色为一组（实线日/虚线周）</text>';
      for (let ei = 0; ei < emails.length; ei++) {
        const arr = byEmail[emails[ei]].slice().sort((a, b) => a.ts - b.ts);
        const dColor = MULTI_DAILY_COLORS[ei % MULTI_DAILY_COLORS.length];
        const wColor = MULTI_WEEKLY_COLORS[ei % MULTI_WEEKLY_COLORS.length];
        const dailyPath = buildPath(arr, 'daily');
        const weeklyPath = buildPath(arr, 'weekly');
        body += '<path d="' + dailyPath + '" fill="none" stroke="' + dColor + '" stroke-width="1.5" stroke-linejoin="round" opacity="0.85"><title>' + emails[ei] + ' · 日</title></path>'
              + '<path d="' + weeklyPath + '" fill="none" stroke="' + wColor + '" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="4,3" opacity="0.7"><title>' + emails[ei] + ' · 周</title></path>';
      }
    }

    svg.innerHTML = body;
  }

  function renderQuotaTable(filtered) {
    const tbody = document.getElementById('lpQuotaBody');
    if (!tbody) return;
    const total = filtered.length;
    const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (quotaPage > maxPage) quotaPage = maxPage;
    const start = (quotaPage - 1) * PAGE_SIZE;
    const page = filtered.slice().reverse().slice(start, start + PAGE_SIZE);

    // 计算每个账号在 filtered 里最早的一条 ts
    // 这条记录的 dDelta/wDelta 是相对于窗口外的某条记录算出的「跨窗口 delta」，视觉应弱化
    const firstTsByEmail = {};
    for (let i = 0; i < filtered.length; i++) {
      const f = filtered[i];
      if (firstTsByEmail[f.email] === undefined || f.ts < firstTsByEmail[f.email]) {
        firstTsByEmail[f.email] = f.ts;
      }
    }

    let html = '';
    for (const e of page) {
      const dCls = e.daily <= 10 ? ' lp-c-red' : e.daily <= 30 ? ' lp-c-yellow' : '';
      const wCls = e.weekly <= 10 ? ' lp-c-red' : e.weekly <= 30 ? ' lp-c-yellow' : '';
      // 跨窗口 delta：该账号在当前过滤后的最早一条，且有 delta 值
      const isCrossWindow = e.ts === firstTsByEmail[e.email] && (e.dDelta !== 0 || e.wDelta !== 0);
      const crossTitle = isCrossWindow ? ' title="相对于时间范围外的上一次记录"' : '';
      const ddCls = isCrossWindow ? ' lp-delta-dim' : (e.dDelta < 0 ? ' lp-c-red' : e.dDelta > 0 ? ' lp-c-green' : '');
      const wdCls = isCrossWindow ? ' lp-delta-dim' : (e.wDelta < 0 ? ' lp-c-red' : e.wDelta > 0 ? ' lp-c-green' : '');
      const ddStr = e.dDelta === 0 ? '—' : (e.dDelta > 0 ? '+' : '') + e.dDelta;
      const wdStr = e.wDelta === 0 ? '—' : (e.wDelta > 0 ? '+' : '') + e.wDelta;
      const resetStr = e.resetAt > 0 ? fmtTime(e.resetAt * 1000) : '—';
      const crossIcon = isCrossWindow ? '<span class="lp-delta-cross-icon" title="跨窗口对比">↗</span>' : '';

      html += '<tr>'
        + '<td>' + fmtTime(e.ts) + '</td>'
        + '<td class="lp-email-cell" title="' + esc(maskEmail(e.email)) + '">' + maskEmailShort(e.email) + '</td>'
        + '<td class="' + dCls + '"><div class="lp-pct-cell"><div class="lp-mini-bar"><div class="lp-mini-fill' + (e.daily <= 10 ? ' lp-fill-danger' : e.daily <= 30 ? ' lp-fill-warn' : ' lp-fill-ok') + '" style="width:' + Math.max(1, e.daily) + '%"></div></div>' + e.daily + '%</div></td>'
        + '<td class="' + wCls + '"><div class="lp-pct-cell"><div class="lp-mini-bar"><div class="lp-mini-fill' + (e.weekly <= 10 ? ' lp-fill-danger' : e.weekly <= 30 ? ' lp-fill-warn' : ' lp-fill-ok') + '" style="width:' + Math.max(1, e.weekly) + '%"></div></div>' + e.weekly + '%</div></td>'
        + '<td class="' + ddCls + '"' + crossTitle + '>' + ddStr + crossIcon + '</td>'
        + '<td class="' + wdCls + '"' + crossTitle + '>' + wdStr + '</td>'
        + '<td>' + resetStr + '</td>'
        + '<td>' + fmtCountdown(e.resetAt) + '</td>'
        + '</tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="8" class="lp-empty">暂无数据</td></tr>';

    // 分页
    const pag = document.getElementById('lpQuotaPagination');
    if (pag && maxPage > 1) {
      pag.innerHTML = '<span class="lp-page-info">第 ' + quotaPage + ' / ' + maxPage + ' 页　共 ' + total + ' 条</span>'
        + '<button class="lp-page-btn" id="lpPrev" ' + (quotaPage <= 1 ? 'disabled' : '') + '>上一页</button>'
        + '<button class="lp-page-btn" id="lpNext" ' + (quotaPage >= maxPage ? 'disabled' : '') + '>下一页</button>';
      document.getElementById('lpPrev')?.addEventListener('click', () => { quotaPage--; renderQuotaTable(filtered); });
      document.getElementById('lpNext')?.addEventListener('click', () => { quotaPage++; renderQuotaTable(filtered); });
    } else if (pag) {
      pag.innerHTML = total > 0 ? '<span class="lp-page-info">共 ' + total + ' 条</span>' : '';
    }
  }

  // ── 换号日志渲染 ──
  var TYPE_LABELS = { auto: '自动', signal: '信号', manual: '手动' };
  var TYPE_COLORS = { auto: '#388bfd', signal: '#f0883e', manual: '#3fb950' };
  var RESULT_COLORS = { ok: '#3fb950', warn: '#d29922', fail: '#f85149' };

  function renderSwitch() {
    const tbody = document.getElementById('lpSwitchBody');
    const countEl = document.getElementById('lpSwitchCount');
    if (!tbody) return;
    if (countEl) countEl.textContent = allSwitchLogs.length + ' 条';

    if (allSwitchLogs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="lp-empty">暂无切号记录</td></tr>';
      return;
    }

    const logs = allSwitchLogs.slice().reverse();
    let html = '';
    for (const raw of logs) {
      const p = parseSwitchLog(raw);
      const typeLabel = TYPE_LABELS[p.type] || p.type;
      const typeColor = TYPE_COLORS[p.type] || '#888';
      const resultOk = p.success;
      const resultColor = resultOk ? RESULT_COLORS.ok : (p.result === '无候选' ? RESULT_COLORS.warn : RESULT_COLORS.fail);
      const typeBadge = '<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600;background:' + typeColor + '22;color:' + typeColor + ';border:1px solid ' + typeColor + '44">' + esc(typeLabel) + '</span>';
      const resultBadge = '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:' + resultColor + '22;color:' + resultColor + ';border:1px solid ' + resultColor + '44">' + esc(p.result) + '</span>';
      const rowOpacity = p.success ? '' : 'opacity:0.65;';
      html += '<tr style="' + rowOpacity + '">'
        + '<td style="white-space:nowrap">' + esc(p.time) + '</td>'
        + '<td style="text-align:center">' + typeBadge + '</td>'
        + '<td class="lp-email-cell" title="' + esc(maskEmail(p.from)) + '">' + maskEmailShort(p.from) + '</td>'
        + '<td style="white-space:nowrap;font-size:11px;color:var(--vscode-descriptionForeground)">' + esc(p.fromQuota) + '</td>'
        + '<td style="font-size:11px">' + esc(p.trigger) + '</td>'
        + '<td class="lp-email-cell" title="' + esc(maskEmail(p.to)) + '">' + (p.to === '—' ? '<span style="color:var(--vscode-descriptionForeground)">—</span>' : maskEmailShort(p.to)) + '</td>'
        + '<td style="text-align:center">' + resultBadge + '</td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
  }

  function parseSwitchLog(raw) {
    // 支持新格式 [time][type] 和旧格式 [time]
    var m = raw.match(/^\[([^\]]+)\](?:\[([^\]]+)\])?\s*(.*)$/);
    var time = m ? m[1] : '';
    var typeTag = m ? (m[2] || '') : '';
    var body = m ? m[3] : raw;

    // 确定类型
    var type = 'auto';
    var signalReason = '';
    if (typeTag === 'manual') {
      type = 'manual';
    } else if (typeTag.slice(0, 7) === 'signal:') {
      type = 'signal';
      signalReason = typeTag.slice(7);
    } else if (!typeTag && body.slice(0, 4) === '信号切') {
      type = 'signal'; // 旧格式向宾
    }

    // 手动切号: [time][manual] from → to
    if (type === 'manual') {
      var ai = body.indexOf('→');
      var from = ai > 0 ? body.slice(0, ai).trim() : body;
      var to   = ai > 0 ? body.slice(ai + 1).trim() : '—';
      return { time: time, type: 'manual', from: from, fromQuota: '', trigger: '手动切号', to: to, result: '成功', success: true };
    }

    // 找箭头（寻找 → 或 ->）
    var arrowIdx = body.indexOf('→');
    if (arrowIdx < 0) arrowIdx = body.indexOf('->');

    if (arrowIdx > 0) {
      var left  = body.slice(0, arrowIdx).trim();
      var right = body.slice(arrowIdx + (body[arrowIdx] === '→' ? 1 : 2)).trim();

      // 旧格式信号切号: 信号切号(reason): from(quota) → to(quota)
      var sigM = left.match(/^信号切号\(([^)]+)\):\s*([^(]+)\(([^)]+)\)$/);
      if (sigM) {
        var rM = right.match(/^([^(]+?)(?:\(([^)]+)\))?$/);
        return { time: time, type: 'signal', from: sigM[2].trim(), fromQuota: sigM[3],
          trigger: '信号: ' + sigM[1], to: rM ? rM[1].trim() : right, result: '成功', success: true };
      }

      // 新格式信号切号: [time][signal:reason] from(quota) → to(quota)
      if (type === 'signal') {
        var slm = left.match(/^(.+?)\(([^)]+)\)$/);
        var srm = right.match(/^([^(]+?)(?:\(([^)]+)\))?$/);
        return { time: time, type: 'signal',
          from: slm ? slm[1].trim() : left, fromQuota: slm ? slm[2] : '',
          trigger: '信号: ' + signalReason,
          to: srm ? srm[1].trim() : right, result: '成功', success: true };
      }

      // 自动切号成功: from(quota) reason → to(quota)
      var lm = left.match(/^(.+?)\(([^)]+)\)\s*(.*?)$/);
      var rm = right.match(/^([^(]+?)(?:\(([^)]+)\))?$/);
      if (lm) {
        var trigger = lm[3].trim() || '阈值触发';
        return { time: time, type: 'auto', from: lm[1].trim(), fromQuota: lm[2],
          trigger: trigger, to: rm ? rm[1].trim() : right, result: '成功', success: true };
      }
    }

    // 失败: from(quota) reason
    var fail = body.match(/^([^(]+)\(([^)]+)\)\s+(.+)/);
    if (fail) {
      var reasonFull = fail[3].trim();
      var triggerM = reasonFull.match(/^(日配额[\u4e00-\u9fff \d%]*|周配额[\u4e00-\u9fff \d%]*|日 \d+% \/ 周 \d+%)/);
      var trigger = triggerM ? triggerM[1].replace(/\s+/g,' ').trim() : reasonFull.split('，')[0].split(',')[0];
      var result = reasonFull.indexOf('无可用候选') >= 0 ? '无候选'
                 : reasonFull.indexOf('验证失败') >= 0 ? '验证失败' : '未切换';
      return { time: time, type: 'auto', from: fail[1].trim(), fromQuota: fail[2],
        trigger: trigger, to: '—', result: result, success: false };
    }

    return { time: time, type: 'auto', from: body, fromQuota: '', trigger: '', to: '—', result: '未知', success: false };
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── 账号总览渲染 ──
  function renderOverview() {
    // 统计卡片
    var normalCount = 0, exhaustedCount = 0, errorCount = 0;
    var dailySum = 0, weeklySum = 0, dailyValid = 0, weeklyValid = 0;
    for (var i = 0; i < allAccountOverview.length; i++) {
      var a = allAccountOverview[i];
      if (a.disabled || a.error) {
        errorCount++;
        continue; // 异常账号不参与均值统计
      } else if (a.daily !== null && a.daily <= 10) {
        exhaustedCount++;
      } else {
        normalCount++;
      }
      if (a.daily !== null) { dailySum += a.daily; dailyValid++; }
      if (a.weekly !== null) { weeklySum += a.weekly; weeklyValid++; }
    }
    setText('lpStatAccounts', allAccountOverview.length);
    setText('lpStatNormal', normalCount);
    setText('lpStatExhausted', exhaustedCount);
    setText('lpStatError', errorCount);
    setText('lpStatAvgDaily', dailyValid ? Math.round(dailySum / dailyValid) + '%' : '—');
    setText('lpStatAvgWeekly', weeklyValid ? Math.round(weeklySum / weeklyValid) + '%' : '—');
    setText('lpAccountCount', allAccountOverview.length + ' 个');

    const tbody = document.getElementById('lpAccountBody');
    if (!tbody) return;
    if (allAccountOverview.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="lp-empty">暂无账号</td></tr>';
      return;
    }

    let html = '';
    for (const a of allAccountOverview) {
      const isCur = a.isCurrent ? '<span class="lp-cur-dot" title="当前账号">●</span>' : '';
      const dCls = a.daily !== null ? (a.daily <= 10 ? ' lp-c-red' : a.daily <= 30 ? ' lp-c-yellow' : '') : '';
      const wCls = a.weekly !== null ? (a.weekly <= 10 ? ' lp-c-red' : a.weekly <= 30 ? ' lp-c-yellow' : '') : '';
      const dBar = a.daily !== null
        ? '<div class="lp-pct-cell"><div class="lp-mini-bar"><div class="lp-mini-fill' + (a.daily <= 10 ? ' lp-fill-danger' : a.daily <= 30 ? ' lp-fill-warn' : ' lp-fill-ok') + '" style="width:' + Math.max(1, a.daily) + '%"></div></div>' + a.daily + '%</div>'
        : '<span class="lp-c-dim">—</span>';
      const wBar = a.weekly !== null
        ? '<div class="lp-pct-cell"><div class="lp-mini-bar"><div class="lp-mini-fill' + (a.weekly <= 10 ? ' lp-fill-danger' : a.weekly <= 30 ? ' lp-fill-warn' : ' lp-fill-ok') + '" style="width:' + Math.max(1, a.weekly) + '%"></div></div>' + a.weekly + '%</div>'
        : '<span class="lp-c-dim">—</span>';
      const age = a.cacheAge !== null ? (a.cacheAge < 60 ? a.cacheAge + 's' : Math.round(a.cacheAge / 60) + 'm') : '—';
      const status = a.disabled ? '<span class="lp-c-red">禁用</span>' : a.error ? '<span class="lp-c-yellow" title="' + esc(a.error) + '">异常</span>' : '<span class="lp-c-green">正常</span>';
      const tags = (a.tags || []).map(function(t) { return '<span class="lp-tag">' + esc(t) + '</span>'; }).join('');

      html += '<tr' + (a.isCurrent ? ' class="lp-row-current"' : '') + '>'
        + '<td>' + isCur + '</td>'
        + '<td class="lp-email-cell" title="' + esc(maskEmail(a.email)) + '">' + maskEmailShort(a.email) + '</td>'
        + '<td>' + (tags || '<span class="lp-c-dim">—</span>') + '</td>'
        + '<td class="' + dCls + '">' + dBar + '</td>'
        + '<td class="' + wCls + '">' + wBar + '</td>'
        + '<td class="lp-c-dim">' + age + '</td>'
        + '<td>' + status + '</td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
  }

  // ── 恢复日志渲染 ──
  const CATEGORY_LABELS = {
    networkErrors: '网络', quotaErrors: '配额', modelErrors: '模型',
    continuationErrors: '截断', permissionRequests: '权限',
    userIntervention: '介入', custom: '自定义'
  };
  const CATEGORY_COLORS = {
    networkErrors: '#5b9aff', quotaErrors: '#f14c4c', modelErrors: '#e5a445',
    continuationErrors: '#9b59b6', permissionRequests: '#3fb950',
    userIntervention: '#ff9a5b', custom: '#888'
  };

  /**
   * 通用分页渲染：把页码 UI 渲染到 containerId
   * @param {string} containerId 分页容器 id
   * @param {number} curPage 当前页（1-based）
   * @param {number} total 总条数
   * @param {(p:number)=>void} onPage 翻页回调
   */
  function renderPagination(containerId, curPage, total, onPage) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (maxPage <= 1) {
      el.innerHTML = total > 0 ? '<span class="lp-page-info">共 ' + total + ' 条</span>' : '';
      return;
    }
    el.innerHTML = '<span class="lp-page-info">第 ' + curPage + ' / ' + maxPage + ' 页　共 ' + total + ' 条</span>'
      + '<button class="lp-page-btn" data-act="prev" ' + (curPage <= 1 ? 'disabled' : '') + '>上一页</button>'
      + '<button class="lp-page-btn" data-act="next" ' + (curPage >= maxPage ? 'disabled' : '') + '>下一页</button>';
    el.querySelector('[data-act="prev"]')?.addEventListener('click', () => onPage(curPage - 1));
    el.querySelector('[data-act="next"]')?.addEventListener('click', () => onPage(curPage + 1));
  }

  function renderRecovery() {
    let logs = allRecoveryLogs.slice();
    if (recoveryFilter) logs = logs.filter(function(e) { return e.category === recoveryFilter; });
    setText('lpRecoveryCount', logs.length + ' 条');

    const tbody = document.getElementById('lpRecoveryBody');
    if (!tbody) return;
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="lp-empty">暂无恢复记录<br><small style="color:var(--lp-fg-dim)">如已使用错误恢复功能，请先打开侧栏以同步数据</small></td></tr>';
      renderPagination('lpRecoveryPagination', 1, 0, () => {});
      return;
    }

    const total = logs.length;
    const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (recoveryPage > maxPage) recoveryPage = maxPage;
    const start = (recoveryPage - 1) * PAGE_SIZE;
    const rows = logs.slice().reverse().slice(start, start + PAGE_SIZE);

    let html = '';
    for (const e of rows) {
      const catLabel = CATEGORY_LABELS[e.category] || e.category || '?';
      const catColor = CATEGORY_COLORS[e.category] || '#888';
      const time = e.ts ? fmtTime(e.ts) : '—';
      const errText = (e.errorText || '').length > 80 ? e.errorText.slice(0, 80) + '…' : (e.errorText || '—');
      const action = e.action || '—';
      const dur = e.duration ? e.duration + 'ms' : '—';

      html += '<tr>'
        + '<td>' + time + '</td>'
        + '<td><span class="lp-cat-badge" style="background:' + catColor + '22;color:' + catColor + ';border:1px solid ' + catColor + '44">' + catLabel + '</span></td>'
        + '<td class="lp-err-cell" title="' + esc(e.errorText || '') + '">' + esc(errText) + '</td>'
        + '<td>' + esc(action) + '</td>'
        + '<td class="lp-c-dim">' + dur + '</td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
    renderPagination('lpRecoveryPagination', recoveryPage, total, (p) => {
      recoveryPage = p;
      renderRecovery();
    });
  }

  // ── 扫描诊断渲染 ──
  const STAGE_LABELS = {
    'no-match': '未匹配（有候选）',
    'pattern-miss': '命中文本但无 PATTERN',
    'pattern-matched': '命中 PATTERN',
    'cooldown-skip': '冷却跳过',
    'banner-shown-skip': 'Banner 显示中',
    'no-rule': '无规则配置'
  };
  const STAGE_COLORS = {
    'no-match': '#f97316',
    'pattern-miss': '#ef4444',
    'pattern-matched': '#10b981',
    'cooldown-skip': '#6b7280',
    'banner-shown-skip': '#6b7280',
    'no-rule': '#f59e0b'
  };

  function renderDiagnose() {
    let logs = allDiagnoseLogs.slice();
    if (diagnoseFilter) logs = logs.filter(function(e) { return e.stage === diagnoseFilter; });
    setText('lpDiagnoseCount', logs.length + ' 条');

    const tbody = document.getElementById('lpDiagnoseBody');
    if (!tbody) return;
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="lp-empty">暂无扫描诊断记录</td></tr>';
      renderPagination('lpDiagnosePagination', 1, 0, () => {});
      return;
    }

    const total = logs.length;
    const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (diagnosePage > maxPage) diagnosePage = maxPage;
    const start = (diagnosePage - 1) * PAGE_SIZE;
    const rows = logs.slice().reverse().slice(start, start + PAGE_SIZE);
    let html = '';
    for (const e of rows) {
      const stage = e.stage || '?';
      const stageLabel = STAGE_LABELS[stage] || stage;
      const stageColor = STAGE_COLORS[stage] || '#888';
      const time = e.ts ? fmtTime(e.ts) : '—';

      let detail = esc(e.reason || '—');
      if (e.hitText) {
        const ht = e.hitText.length > 200 ? e.hitText.slice(0, 200) + '…' : e.hitText;
        detail += '<div class="lp-c-dim" style="margin-top:4px;font-size:11px">命中文本: <code style="background:#222;padding:1px 4px;border-radius:3px">' + esc(ht) + '</code></div>';
      }
      if (e.hitInAssistant === true) {
        detail += '<div class="lp-c-dim" style="margin-top:2px;font-size:11px;color:#f97316">⚠ 命中元素在 assistant 消息内</div>';
      }
      if (e.selfOrig) {
        detail += '<div class="lp-c-dim" style="margin-top:2px;font-size:11px">data-ws-orig (自身): ' + esc(e.selfOrig.slice(0, 120)) + '</div>';
      }

      let candHtml = '—';
      if (Array.isArray(e.candidates) && e.candidates.length > 0) {
        candHtml = '<details><summary style="cursor:pointer;color:#3b82f6">' + e.candidates.length + ' 个候选</summary><div style="margin-top:6px;font-size:11px;line-height:1.6">';
        for (let i = 0; i < e.candidates.length; i++) {
          const c = e.candidates[i];
          candHtml += '<div style="margin-bottom:6px;padding:4px;background:rgba(255,255,255,0.03);border-radius:3px">';
          candHtml += '<div><b>#' + (i + 1) + '</b> &lt;' + esc(c.tag || '') + '&gt; ';
          if (c.inAssistant) candHtml += '<span style="color:#f97316">[在 assistant 内]</span> ';
          if (c.handled) candHtml += '<span style="color:#ef4444">[已 handled]</span> ';
          candHtml += '<span class="lp-c-dim">children=' + (c.childCount || 0) + '</span></div>';
          candHtml += '<div style="margin-top:2px"><code style="background:#222;padding:1px 4px;border-radius:3px">' + esc((c.text || '').slice(0, 150)) + '</code></div>';
          if (c.selfOrig) candHtml += '<div class="lp-c-dim" style="margin-top:2px">自身 data-ws-orig: ' + esc(c.selfOrig.slice(0, 100)) + '</div>';
          if (c.descOrigCount > 0) candHtml += '<div class="lp-c-dim" style="margin-top:2px">后代 data-ws-orig × ' + c.descOrigCount + (c.descOrigSample ? ': ' + esc(c.descOrigSample.slice(0, 80)) : '') + '</div>';
          if (c.ancestorOrig) candHtml += '<div class="lp-c-dim" style="margin-top:2px;color:#f59e0b">祖先 data-ws-orig (向上 ' + c.ancestorOrig.level + ' 层): ' + esc(c.ancestorOrig.text.slice(0, 80)) + '</div>';
          candHtml += '</div>';
        }
        candHtml += '</div></details>';
      } else if (e.category || e.action) {
        candHtml = '';
        if (e.category) candHtml += '<div>分类: <b>' + esc(e.category) + '</b></div>';
        if (e.action) candHtml += '<div>动作: <b>' + esc(e.action) + '</b></div>';
        if (e.pattern) candHtml += '<div class="lp-c-dim" style="font-size:11px">pattern: <code>' + esc(e.pattern) + '</code></div>';
      }

      html += '<tr>'
        + '<td style="vertical-align:top">' + time + '</td>'
        + '<td style="vertical-align:top"><span class="lp-cat-badge" style="background:' + stageColor + '22;color:' + stageColor + ';border:1px solid ' + stageColor + '44">' + stageLabel + '</span></td>'
        + '<td style="vertical-align:top">' + detail + '</td>'
        + '<td style="vertical-align:top">' + candHtml + '</td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
    renderPagination('lpDiagnosePagination', diagnosePage, total, (p) => {
      diagnosePage = p;
      renderDiagnose();
    });
  }

  const DIAGNOSTIC_SOURCE_LABELS = {
    switch: '切号预检',
    health: '测活'
  };
  const DIAGNOSTIC_LEVEL_LABELS = {
    ok: '正常',
    warn: '限速/暂不可用',
    error: '无权/失败'
  };
  const DIAGNOSTIC_COLORS = {
    ok: '#10b981',
    warn: '#d29922',
    error: '#ef4444'
  };

  function renderDiagnostic() {
    let logs = allDiagnosticLogs.slice();
    if (diagnosticFilter) logs = logs.filter(function(e) { return e.level === diagnosticFilter; });
    setText('lpDiagnosticCount', logs.length + ' 条');

    const tbody = document.getElementById('lpDiagnosticBody');
    if (!tbody) return;
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="lp-empty">暂无账号诊断记录</td></tr>';
      renderPagination('lpDiagnosticPagination', 1, 0, () => {});
      return;
    }

    const total = logs.length;
    const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (diagnosticPage > maxPage) diagnosticPage = maxPage;
    const start = (diagnosticPage - 1) * PAGE_SIZE;
    const rows = logs.slice().reverse().slice(start, start + PAGE_SIZE);
    let html = '';
    for (const e of rows) {
      const level = e.level || 'error';
      const color = DIAGNOSTIC_COLORS[level] || '#888';
      const source = DIAGNOSTIC_SOURCE_LABELS[e.source] || e.source || '—';
      const result = DIAGNOSTIC_LEVEL_LABELS[level] || level;
      const reason = e.reason || '—';
      const shortReason = reason.length > 110 ? reason.slice(0, 110) + '…' : reason;
      html += '<tr>'
        + '<td>' + (e.ts ? fmtTime(e.ts) : '—') + '</td>'
        + '<td><span class="lp-cat-badge">' + esc(source) + '</span></td>'
        + '<td title="' + esc(e.email || '') + '">' + esc(maskEmailShort(e.email || '')) + '</td>'
        + '<td class="lp-c-dim">' + esc(e.model || '—') + '</td>'
        + '<td><span class="lp-cat-badge" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44">' + esc(result) + '</span></td>'
        + '<td class="lp-err-cell" title="' + esc(reason) + '">' + esc(shortReason) + (e.status ? '<span class="lp-c-dim"> · HTTP ' + e.status + '</span>' : '') + '</td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
    renderPagination('lpDiagnosticPagination', diagnosticPage, total, (p) => {
      diagnosticPage = p;
      renderDiagnostic();
    });
  }

  function fmtTok(n) {
    const num = Number(n || 0);
    if (!Number.isFinite(num) || num <= 0) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(num));
  }

  function fmtMaybeTime(value) {
    const ts = Date.parse(value || '');
    return Number.isFinite(ts) ? fmtTime(ts) : '—';
  }

  function renderContext() {
    const snap = contextMonitor || {};
    const active = snap.active || null;
    const sessions = Array.isArray(snap.sessions) ? snap.sessions : [];
    const meta = document.getElementById('lpContextMeta');
    if (meta) {
      if (!snap.ok) {
        meta.textContent = snap.error ? ('读取失败：' + snap.error) : '未读取到 Windsurf Language Server';
      } else {
        meta.textContent = 'LS 端口 ' + (snap.lsPort || '—') + ' · 更新于 ' + fmtMaybeTime(snap.updatedAt);
      }
    }

    setText('lpCtxUsed', active ? (fmtTok(active.totalTokens) + ' / ' + fmtTok(active.contextLimit)) : '—');
    setText('lpCtxPct', active ? (Math.round(active.contextPercent || 0) + '%') : '—');
    setText('lpCtxInput', active ? fmtTok(active.inputTokens) : '—');
    setText('lpCtxOutput', active ? fmtTok(active.outputTokens) : '—');
    setText('lpCtxCache', active ? fmtTok(active.cachedTokens) : '—');
    setText('lpCtxSteps', active ? String(active.stepCount || 0) : '—');
    setText('lpContextCount', sessions.length ? (sessions.length + ' 个最近会话') : '');

    const activeEl = document.getElementById('lpContextActive');
    if (activeEl) {
      if (!active) {
        activeEl.innerHTML = '<div class="lp-empty">暂无可显示的上下文会话。点击“刷新上下文”会重新读取 Windsurf 本地会话，不会发送消息。</div>';
      } else {
        const pct = Math.max(0, Math.min(100, Number(active.contextPercent || 0)));
        const fillClass = pct >= 85 ? 'lp-fill-danger' : (pct >= 65 ? 'lp-fill-warn' : 'lp-fill-ok');
        const reply = active.latestReply || '暂无模型回复';
        activeEl.innerHTML = ''
          + '<div class="lp-context-card">'
          + '<div class="lp-context-card-head">'
          + '<div><div class="lp-session-title">' + esc(active.title || active.id || '当前会话') + '</div>'
          + '<div class="lp-c-dim">' + esc(active.workspace || '—') + ' · ' + fmtMaybeTime(active.updatedAt) + '</div></div>'
          + '<span class="lp-context-badge">' + esc(active.status || 'unknown') + '</span>'
          + '</div>'
          + '<div class="lp-context-bar"><span class="' + fillClass + '" style="width:' + pct + '%"></span></div>'
          + '<div class="lp-context-grid">'
          + '<span>模型 <b>' + esc(active.model || '—') + '</b></span>'
          + '<span>上下文 <b>' + Math.round(pct) + '%</b></span>'
          + '<span>输入 <b>' + fmtTok(active.inputTokens) + '</b></span>'
          + '<span>输出 <b>' + fmtTok(active.outputTokens) + '</b></span>'
          + '<span>缓存 <b>' + fmtTok(active.cachedTokens) + '</b></span>'
          + '<span>Steps <b>' + String(active.stepCount || 0) + '</b></span>'
          + '</div>'
          + '<div class="lp-context-reply" title="' + esc(reply) + '">' + esc(reply) + '</div>'
          + '</div>';
      }
    }

    const tbody = document.getElementById('lpContextBody');
    if (!tbody) return;
    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="lp-empty">暂无最近会话记录</td></tr>';
      return;
    }
    tbody.innerHTML = sessions.map(function(s) {
      const pct = Math.max(0, Math.min(100, Number(s.contextPercent || 0)));
      const fillClass = pct >= 85 ? 'lp-fill-danger' : (pct >= 65 ? 'lp-fill-warn' : 'lp-fill-ok');
      const reply = s.latestReply || s.error || '—';
      const title = s.title || s.id || '未命名会话';
      return '<tr>'
        + '<td><div class="lp-session-title" title="' + esc(title) + '">' + esc(title) + '</div><div class="lp-c-dim">' + fmtMaybeTime(s.updatedAt) + '</div></td>'
        + '<td><span class="lp-cat-badge">' + esc(s.status || '—') + '</span></td>'
        + '<td class="lp-code-cell" title="' + esc(s.model || '') + '">' + esc(s.model || '—') + '</td>'
        + '<td><div class="lp-pct-cell"><span>' + Math.round(pct) + '%</span><span class="lp-mini-bar"><span class="lp-mini-fill ' + fillClass + '" style="width:' + pct + '%"></span></span></div></td>'
        + '<td>' + String(s.stepCount || 0) + '</td>'
        + '<td class="lp-context-reply-cell" title="' + esc(reply) + '">' + esc(reply) + '</td>'
        + '</tr>';
    }).join('');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }

  // ── 底部状态栏 ──
  function renderFooter() {
    const el = document.getElementById('lpFooter');
    if (!el) return;
    const qLen = allQuotaEntries.length;
    const sLen = allSwitchLogs.length;
    const rLen = allRecoveryLogs.length;
    const dLen = allDiagnosticLogs.length;
    const aLen = allAccountOverview.length;
    const now = new Date();
    const ts = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
    el.textContent = '账号: ' + aLen + ' · 配额: ' + qLen + ' 条 · 切号: ' + sLen + ' 条 · 恢复: ' + rLen + ' 条 · 诊断: ' + dLen + ' 条 · 更新于 ' + ts + (currentEmail ? ' · 当前: ' + maskEmailShort(currentEmail) : '');
  }

})();
