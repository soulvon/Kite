/* eslint-disable */
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  let allQuotaEntries = [];
  let allQuotaEmails = [];
  let allSwitchLogs = [];
  let allRecoveryLogs = [];
  let allDiagnoseLogs = [];
  let allAccountOverview = [];
  let allSummary = {};
  let currentEmail = '';
  let filterEmail = '';
  let timeRange = '24h';
  let recoveryFilter = '';
  let diagnoseFilter = '';
  let quotaPage = 1;
  const PAGE_SIZE = 30;
  let privacyMode = false;
  let refreshCooldown = 0;

  // ── 隐私模式 ──
  const privacyBtn = document.getElementById('lpPrivacy');
  privacyBtn.addEventListener('click', () => {
    privacyMode = !privacyMode;
    privacyBtn.classList.toggle('lp-btn-active', privacyMode);
    privacyBtn.querySelector('svg').style.opacity = privacyMode ? '1' : '0.6';
    renderOverview();
    renderQuota();
    renderSwitch();
    renderRecovery();
    renderDiagnose();
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
    filterEmail = val;
    emailSel.value = emailSel.querySelector('option[value="' + val + '"]') ? val : '';
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
    renderRecovery();
  });

  // ── 扫描诊断筛选 ──
  const diagFilter = document.getElementById('lpDiagnoseFilter');
  if (diagFilter) diagFilter.addEventListener('change', () => {
    diagnoseFilter = diagFilter.value;
    renderDiagnose();
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
      allAccountOverview = msg.accountOverview || [];
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
      renderFooter();
    }
    if (msg.type === 'switchTab') switchTab(msg.tab);
  });

  // ── 工具函数 ──
  function shortEmail(em) {
    return em.length > 32 ? em.slice(0, 14) + '…' + em.slice(-14) : em;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtTime(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function fmtCountdown(resetAt) {
    if (!resetAt) return '—';
    const ms = resetAt * 1000 - Date.now();
    if (ms <= 0) return '<span class="lp-c-green">已重置</span>';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
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

  function renderQuotaChart(entries) {
    const svg = document.getElementById('lpChart');
    if (!svg) return;
    const rect = svg.parentElement.getBoundingClientRect();
    const W = Math.max(rect.width - 50, 200);  // 减去 y 轴宽度
    const H = 200;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    // 获取主题色
    var cs = getComputedStyle(document.body);
    var gridColor = cs.getPropertyValue('--lp-chart-grid').trim() || 'rgba(128,128,128,0.1)';
    var dimColor = cs.getPropertyValue('--lp-fg-dim').trim() || '#888';

    if (entries.length < 2) {
      svg.innerHTML = '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" fill="' + dimColor + '" font-size="13">数据不足</text>';
      return;
    }

    // 按小时聚合；若唯一小时数 < 2 则直接使用原始点（数据太少，聚合无意义）
    var hourMap = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var d = new Date(e.ts);
      var hourKey = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
      if (!hourMap[hourKey]) {
        hourMap[hourKey] = { daily: [], weekly: [] };
      }
      if (e.daily !== null) hourMap[hourKey].daily.push(e.daily);
      if (e.weekly !== null) hourMap[hourKey].weekly.push(e.weekly);
    }
    var hours = Object.keys(hourMap).map(Number).sort(function(a, b) { return a - b; });
    var aggregated = [];
    if (hours.length < 2) {
      // 数据不足以聚合，直接用原始点
      aggregated = entries.map(function(e) { return { ts: e.ts, daily: e.daily, weekly: e.weekly }; });
    } else {
      for (var j = 0; j < hours.length; j++) {
        var h = hours[j];
        var dVals = hourMap[h].daily;
        var wVals = hourMap[h].weekly;
        var avgDaily = dVals.length ? Math.round(dVals.reduce(function(a, b) { return a + b; }, 0) / dVals.length) : null;
        var avgWeekly = wVals.length ? Math.round(wVals.reduce(function(a, b) { return a + b; }, 0) / wVals.length) : null;
        aggregated.push({ ts: h, daily: avgDaily, weekly: avgWeekly });
      }
    }

    const n = aggregated.length;
    const xStep = (W - 8) / Math.max(n - 1, 1);
    const PAD = 4;

    // 网格线
    let grid = '';
    for (let pct = 0; pct <= 100; pct += 20) {
      const y = PAD + (100 - pct) / 100 * (H - PAD * 2);
      grid += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + gridColor + '" />';
    }
    // 警告/危险线
    const y30 = PAD + 70 / 100 * (H - PAD * 2);
    const y10 = PAD + 90 / 100 * (H - PAD * 2);
    grid += '<line x1="0" y1="' + y30 + '" x2="' + W + '" y2="' + y30 + '" stroke="rgba(255,200,50,0.2)" stroke-dasharray="4,3" />';
    grid += '<line x1="0" y1="' + y10 + '" x2="' + W + '" y2="' + y10 + '" stroke="rgba(255,80,80,0.2)" stroke-dasharray="4,3" />';

    let dailyPts = '', weeklyPts = '';
    let dailyArea = 'M ' + PAD + ',' + H + ' ';
    let weeklyArea = 'M ' + PAD + ',' + H + ' ';

    for (let i = 0; i < n; i++) {
      const x = PAD + i * xStep;
      const yD = aggregated[i].daily !== null ? PAD + (100 - aggregated[i].daily) / 100 * (H - PAD * 2) : null;
      const yW = aggregated[i].weekly !== null ? PAD + (100 - aggregated[i].weekly) / 100 * (H - PAD * 2) : null;
      if (yD !== null) {
        dailyPts += x + ',' + yD + ' ';
        dailyArea += 'L ' + x + ',' + yD + ' ';
      }
      if (yW !== null) {
        weeklyPts += x + ',' + yW + ' ';
        weeklyArea += 'L ' + x + ',' + yW + ' ';
      }
    }
    const lastX = PAD + (n - 1) * xStep;
    dailyArea += 'L ' + lastX + ',' + H + ' Z';
    weeklyArea += 'L ' + lastX + ',' + H + ' Z';

    svg.innerHTML = grid
      + '<path d="' + dailyArea + '" fill="rgba(91,154,255,0.08)" />'
      + '<path d="' + weeklyArea + '" fill="rgba(255,154,91,0.08)" />'
      + '<polyline points="' + dailyPts + '" fill="none" stroke="#5b9aff" stroke-width="2" stroke-linejoin="round" />'
      + '<polyline points="' + weeklyPts + '" fill="none" stroke="#ff9a5b" stroke-width="2" stroke-linejoin="round" />';
  }

  function renderQuotaTable(filtered) {
    const tbody = document.getElementById('lpQuotaBody');
    if (!tbody) return;
    const total = filtered.length;
    const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (quotaPage > maxPage) quotaPage = maxPage;
    const start = (quotaPage - 1) * PAGE_SIZE;
    const page = filtered.slice().reverse().slice(start, start + PAGE_SIZE);

    let html = '';
    for (const e of page) {
      const dCls = e.daily <= 10 ? ' lp-c-red' : e.daily <= 30 ? ' lp-c-yellow' : '';
      const wCls = e.weekly <= 10 ? ' lp-c-red' : e.weekly <= 30 ? ' lp-c-yellow' : '';
      const ddCls = e.dDelta < 0 ? ' lp-c-red' : e.dDelta > 0 ? ' lp-c-green' : '';
      const wdCls = e.wDelta < 0 ? ' lp-c-red' : e.wDelta > 0 ? ' lp-c-green' : '';
      const ddStr = e.dDelta === 0 ? '—' : (e.dDelta > 0 ? '+' : '') + e.dDelta;
      const wdStr = e.wDelta === 0 ? '—' : (e.wDelta > 0 ? '+' : '') + e.wDelta;
      const resetStr = e.resetAt > 0 ? fmtTime(e.resetAt * 1000) : '—';

      html += '<tr>'
        + '<td>' + fmtTime(e.ts) + '</td>'
        + '<td class="lp-email-cell" title="' + esc(maskEmail(e.email)) + '">' + maskEmailShort(e.email) + '</td>'
        + '<td class="' + dCls + '"><div class="lp-pct-cell"><div class="lp-mini-bar"><div class="lp-mini-fill' + (e.daily <= 10 ? ' lp-fill-danger' : e.daily <= 30 ? ' lp-fill-warn' : ' lp-fill-ok') + '" style="width:' + Math.max(1, e.daily) + '%"></div></div>' + e.daily + '%</div></td>'
        + '<td class="' + wCls + '"><div class="lp-pct-cell"><div class="lp-mini-bar"><div class="lp-mini-fill' + (e.weekly <= 10 ? ' lp-fill-danger' : e.weekly <= 30 ? ' lp-fill-warn' : ' lp-fill-ok') + '" style="width:' + Math.max(1, e.weekly) + '%"></div></div>' + e.weekly + '%</div></td>'
        + '<td class="' + ddCls + '">' + ddStr + '</td>'
        + '<td class="' + wdCls + '">' + wdStr + '</td>'
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
  function renderSwitch() {
    const tbody = document.getElementById('lpSwitchBody');
    const countEl = document.getElementById('lpSwitchCount');
    if (!tbody) return;
    if (countEl) countEl.textContent = allSwitchLogs.length + ' 条';

    if (allSwitchLogs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="lp-empty">暂无切号记录</td></tr>';
      return;
    }

    // 解析日志字符串
    const logs = allSwitchLogs.slice().reverse();
    let html = '';
    for (const raw of logs) {
      const parsed = parseSwitchLog(raw);
      const resultCls = parsed.success ? ' lp-c-green' : ' lp-c-yellow';
      html += '<tr>'
        + '<td>' + esc(parsed.time) + '</td>'
        + '<td class="lp-email-cell" title="' + esc(maskEmail(parsed.from)) + '">' + maskEmailShort(parsed.from) + '</td>'
        + '<td>' + esc(parsed.fromQuota) + '</td>'
        + '<td>' + esc(parsed.reason) + '</td>'
        + '<td class="lp-email-cell" title="' + esc(maskEmail(parsed.to)) + '">' + maskEmailShort(parsed.to) + '</td>'
        + '<td>' + esc(parsed.toQuota) + '</td>'
        + '<td class="' + resultCls + '">' + esc(parsed.result) + '</td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
  }

  function parseSwitchLog(raw) {
    const m = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
    const time = m ? m[1] : '';
    const body = m ? m[2] : raw;

    // 用字符位置找箭头（避免正则字符编码不匹配），支持 → 和 ->
    var arrowIdx = body.indexOf('\u2192');
    if (arrowIdx < 0) arrowIdx = body.indexOf('->');

    if (arrowIdx > 0) {
      var left = body.slice(0, arrowIdx).trim();
      var right = body.slice(arrowIdx + (body[arrowIdx] === '\u2192' ? 1 : 2)).trim();

      // 信号切号：信号切号(reason): from(quota)
      var sigLeft = left.match(/^信号切号\(([^)]+)\):\s*([^(]+)\(([^)]+)\)$/);
      if (sigLeft) {
        var sigRight = right.match(/^([^(]+)\(([^)]+)\)/);
        return { time, from: sigLeft[2].trim(), fromQuota: sigLeft[3],
          reason: '信号: ' + sigLeft[1],
          to: sigRight ? sigRight[1].trim() : right, toQuota: sigRight ? sigRight[2] : '',
          result: '成功', success: true };
      }

      // 普通切号：from(quota) reason
      var leftM = left.match(/^(.+?)\(([^)]+)\)\s*(.*?)$/);
      var rightM = right.match(/^([^(]+)\(([^)]+)\)/);
      if (leftM) {
        return { time, from: leftM[1].trim(), fromQuota: leftM[2], reason: leftM[3].trim(),
          to: rightM ? rightM[1].trim() : right, toQuota: rightM ? rightM[2] : '',
          result: '成功', success: true };
      }
    }

    // 无候选 / 验证失败：from(quota) reason
    var fail = body.match(/^([^(]+)\(([^)]+)\)\s+(.+)/);
    if (fail) return { time, from: fail[1].trim(), fromQuota: fail[2], reason: fail[3].trim(), to: '—', toQuota: '—', result: '未切换', success: false };

    // 兜底：显示原始日志
    return { time, from: body, fromQuota: '', reason: body, to: '', toQuota: '', result: '', success: false };
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

  function renderRecovery() {
    let logs = allRecoveryLogs.slice();
    if (recoveryFilter) logs = logs.filter(function(e) { return e.category === recoveryFilter; });
    setText('lpRecoveryCount', logs.length + ' 条');

    const tbody = document.getElementById('lpRecoveryBody');
    if (!tbody) return;
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="lp-empty">暂无恢复记录<br><small style="color:var(--lp-fg-dim)">如已使用错误恢复功能，请先打开侧栏以同步数据</small></td></tr>';
      return;
    }

    const rows = logs.slice().reverse().slice(0, 100);
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
      return;
    }

    const rows = logs.slice().reverse().slice(0, 100);
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
    const aLen = allAccountOverview.length;
    const now = new Date();
    const ts = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
    el.textContent = '账号: ' + aLen + ' · 配额: ' + qLen + ' 条 · 切号: ' + sLen + ' 条 · 恢复: ' + rLen + ' 条 · 更新于 ' + ts + (currentEmail ? ' · 当前: ' + maskEmailShort(currentEmail) : '');
  }

})();
