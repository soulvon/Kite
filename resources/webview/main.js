(function() {
  'use strict';

  // ==================== 状态管理 ====================
  let accounts = [];
  let lastEmail = '';
  let usageCache = new Map();
  let autoSwitchEnabled = false;
  let autoSwitchThreshold = 10;
  let autoSwitchCheckSec = 60;
  let autoSwitchCooldownSec = 30;
  let autoSwitchScoreMode = 'min';
  let refreshInterval = null;
  let externalAccount = ''; // Windsurf 当前登录但不在号池中的账户

  // ==================== 工具函数 ====================
  const _escDiv = document.createElement('div');
  function escHtml(text) {
    _escDiv.textContent = text;
    return _escDiv.innerHTML;
  }

  function cssEscape(str) {
    return str.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
  }

  function formatUnix(ts) {
    if (!ts) return '—';
    const date = new Date(ts * 1000);
    const now = new Date();
    const diff = date - now;
    if (diff < 0) return '已重置';
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}天${hours % 24}时后重置`;
    if (hours > 0) return `${hours}时${mins}分后重置`;
    if (mins > 0) return `${mins}分钟后重置`;
    return '即将重置';
  }

  function formatPeriod(startTs, endTs) {
    if (!startTs || !endTs) return '—';
    const start = new Date(startTs * 1000);
    const end = new Date(endTs * 1000);
    const now = new Date();
    if (end < now) return '已过期';
    const diff = end - now;
    const days = Math.floor(diff / 86400000);
    if (days > 365) return '永久';
    if (days > 0) return `${days}天后过期`;
    return '即将过期';
  }

  function formatPeriodSimple(start, end) {
    if (!start || !end) return '—';
    const startDate = new Date(start);
    const endDate = new Date(end);
    const now = new Date();
    const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / 86400000);
    const fmtD = (d) => (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0');
    const range = fmtD(startDate) + '-' + fmtD(endDate);
    if (daysLeft <= 0) return '已到期 (' + range + ')';
    return '剩余' + daysLeft + '天 (' + range + ')';
  }

  function pctClass(pct) {
    if (pct <= 10) return 'is-danger';
    if (pct <= 30) return 'is-warn';
    if (pct < 50) return 'is-info';
    return 'is-ok';
  }

  function periodClass(planEnd) {
    const daysLeft = Math.ceil((new Date(planEnd).getTime() - Date.now()) / 86400000);
    if (daysLeft <= 0) return 'period-gray';
    if (daysLeft <= 1) return 'period-red';
    if (daysLeft <= 3) return 'period-yellow';
    return 'period-green';
  }

  // ==================== DOM 元素 ====================
  const $ = (sel) => document.querySelector(sel);
  const accountGrid = $('#accountGrid');
  const gridCount = $('.grid-count');
  const emptyState = $('#emptyState');
  const asEnabledEl = $('#asEnabled');
  const asThresholdEl = $('#asThreshold');
  const asBadge = $('#asBadge');
  const refreshAllBtn = $('#refreshAllBtn');
  const settingsBtn = $('#settingsBtn');

  // ==================== 卡片视图 ====================
  function buildCard(account, isActive) {
    const card = document.createElement('div');
    card.className = 'grid-card' + (isActive ? ' is-active' : '');
    card.dataset.email = account.email;

    const cached = usageCache.get(account.email);
    const snap = cached?.snapshot;
    const err = cached?.error;

    card.innerHTML = `
      <div class="grid-card-head">
        <div class="grid-card-email" title="${escHtml(account.email)}">${escHtml(account.email)}</div>
        ${isActive ? '<span class="grid-active-tag">当前</span>' : ''}
      </div>
      <div class="grid-card-meta">
        <span class="grid-plan-chip" data-field="plan">${snap ? escHtml(snap.planName || 'Unknown') : '...'}</span>
      </div>
      <div class="grid-card-quotas">
        <div class="grid-quota-item">
          <div class="grid-quota-head"><span>日配额</span><span data-field="dailyPct" class="grid-quota-val ${snap ? pctClass(snap.dailyRemainingPercent) : ''}">${snap ? Math.round(snap.dailyRemainingPercent) + '%' : '—'}</span></div>
          <div class="quota-bar"><div class="quota-bar-fill ${snap ? pctClass(snap.dailyRemainingPercent) : ''}" data-field="dailyBar" style="width:${snap ? snap.dailyRemainingPercent : 0}%"></div></div>
          <div class="grid-quota-reset" data-field="dailyReset">${snap ? formatUnix(snap.dailyResetAtUnix) : '—'}</div>
        </div>
        <div class="grid-quota-item">
          <div class="grid-quota-head"><span>周配额</span><span data-field="weeklyPct" class="grid-quota-val ${snap ? pctClass(snap.weeklyRemainingPercent) : ''}">${snap ? Math.round(snap.weeklyRemainingPercent) + '%' : '—'}</span></div>
          <div class="quota-bar"><div class="quota-bar-fill ${snap ? pctClass(snap.weeklyRemainingPercent) : ''}" data-field="weeklyBar" style="width:${snap ? snap.weeklyRemainingPercent : 0}%"></div></div>
          <div class="grid-quota-reset" data-field="weeklyReset">${snap ? formatUnix(snap.weeklyResetAtUnix) : '—'}</div>
        </div>
      </div>
      <div class="grid-card-extra">
        <div class="grid-extra-row"><span>额外用量余额</span><span class="grid-extra-val" data-field="flexCredits">${snap && snap.overageBalanceMicros !== undefined ? '$' + (snap.overageBalanceMicros / 1000000).toFixed(2) : '—'}</span></div>
        <div class="grid-extra-row"><span>会员期限</span><span class="grid-extra-val ${snap && snap.planEnd ? periodClass(snap.planEnd) : ''}" data-field="period">${snap && snap.planStart && snap.planEnd ? formatPeriodSimple(snap.planStart, snap.planEnd) : '—'}</span></div>
      </div>
      <div class="grid-card-actions">
        ${isActive
          ? '<span class="grid-current-label"><span style="color:#3fb950">●</span> 使用中</span>'
          : '<button class="grid-switch-btn" data-action="switch">切换</button>'
        }
        <div class="grid-actions-right">
          <button class="icon-btn" data-action="refresh" title="刷新配额">
            <svg width="18" height="18" viewBox="0 0 1402 1024" fill="currentColor"><path d="M136.479 521.213a45.223 45.223 0 0 1-30.526-78.01l156.02-145.845a45.223 45.223 0 0 1 62.182 1.13l149.237 145.845a45.223 45.223 0 0 1-63.313 64.443L291.369 392.326 167.005 508.776a45.223 45.223 0 0 1-30.526 12.437zM1051.12 740.545a45.223 45.223 0 0 1-30.526-12.436L863.443 582.264a45.596 45.596 0 1 1 62.182-66.704l124.364 117.58 118.711-116.45a45.223 45.223 0 0 1 63.313 64.443l-149.237 146.976a45.223 45.223 0 0 1-31.656 12.436z"/><path d="M1048.859 737.154a45.223 45.223 0 0 1-45.224-45.224V513.298c0-183.154-149.236-332.391-332.391-332.391a332.391 332.391 0 0 0-218.202 81.402 45.255 45.255 0 0 1-59.921-67.835 422.838 422.838 0 0 1 700.961 318.824v178.632a45.223 45.223 0 0 1-45.223 45.224zM671.244 933.875a422.838 422.838 0 0 1-422.838-422.838V332.405a45.223 45.223 0 0 1 90.447 0v178.632c0 183.154 149.237 332.391 332.391 332.391a331.261 331.261 0 0 0 223.856-87.055 45.223 45.223 0 0 1 61.051 66.705 421.707 421.707 0 0 1-284.907 110.797z"/></svg>
          </button>
          <button class="icon-btn danger" data-action="delete" title="删除账号">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
      <div class="grid-card-error" ${err ? '' : 'hidden'}>${err ? escHtml(err) : ''}</div>
    `;

    return card;
  }

  function updateCard(card, snapshot) {
    const email = card.dataset.email;
    if (!email || !snapshot) return;

    const planEl = card.querySelector('[data-field="plan"]');
    if (planEl) planEl.textContent = snapshot.planName || 'Unknown';

    const dailyPctEl = card.querySelector('[data-field="dailyPct"]');
    const dailyBarEl = card.querySelector('[data-field="dailyBar"]');
    const dailyResetEl = card.querySelector('[data-field="dailyReset"]');
    if (dailyPctEl) {
      dailyPctEl.textContent = Math.round(snapshot.dailyRemainingPercent) + '%';
      dailyPctEl.className = 'grid-quota-val ' + pctClass(snapshot.dailyRemainingPercent);
    }
    if (dailyBarEl) {
      dailyBarEl.style.width = snapshot.dailyRemainingPercent + '%';
      dailyBarEl.className = 'quota-bar-fill ' + pctClass(snapshot.dailyRemainingPercent);
    }
    if (dailyResetEl) dailyResetEl.textContent = formatUnix(snapshot.dailyResetAtUnix);

    const weeklyPctEl = card.querySelector('[data-field="weeklyPct"]');
    const weeklyBarEl = card.querySelector('[data-field="weeklyBar"]');
    const weeklyResetEl = card.querySelector('[data-field="weeklyReset"]');
    if (weeklyPctEl) {
      weeklyPctEl.textContent = Math.round(snapshot.weeklyRemainingPercent) + '%';
      weeklyPctEl.className = 'grid-quota-val ' + pctClass(snapshot.weeklyRemainingPercent);
    }
    if (weeklyBarEl) {
      weeklyBarEl.style.width = snapshot.weeklyRemainingPercent + '%';
      weeklyBarEl.className = 'quota-bar-fill ' + pctClass(snapshot.weeklyRemainingPercent);
    }
    if (weeklyResetEl) weeklyResetEl.textContent = formatUnix(snapshot.weeklyResetAtUnix);

    const flexEl = card.querySelector('[data-field="flexCredits"]');
    if (flexEl) {
      const micros = snapshot.overageBalanceMicros || 0;
      const dollars = micros / 1000000;
      flexEl.textContent = '$' + dollars.toFixed(2);
    }

    const periodEl = card.querySelector('[data-field="period"]');
    if (periodEl && snapshot.planStart && snapshot.planEnd) {
      periodEl.textContent = formatPeriodSimple(snapshot.planStart, snapshot.planEnd);
      periodEl.className = 'grid-extra-val ' + periodClass(snapshot.planEnd);
    }

    const errEl = card.querySelector('.grid-card-error');
    if (errEl) errEl.hidden = true;

    usageCache.set(email, { snapshot, ts: Date.now() });
    persistState();
  }

  let _rerenderTimer = null;
  // 防抖重排：usage 消息陆续到达时合并为一次渲染
  function scheduleRerender() {
    if (_rerenderTimer) clearTimeout(_rerenderTimer);
    _rerenderTimer = setTimeout(() => {
      _rerenderTimer = null;
      renderCards();
    }, 400);
  }

  // 排序模式：min | daily | weekly | planEnd | email | default
  let sortMode = 'min';

  function getSnap(email) { return usageCache.get(email)?.snapshot; }

  function cmpByMode(a, b, mode) {
    const sa = getSnap(a.email), sb = getSnap(b.email);
    const has = (s) => s ? 1 : 0;
    switch (mode) {
      case 'min': {
        const va = sa ? Math.min(sa.dailyRemainingPercent||0, sa.weeklyRemainingPercent||0) : -1;
        const vb = sb ? Math.min(sb.dailyRemainingPercent||0, sb.weeklyRemainingPercent||0) : -1;
        return vb - va;
      }
      case 'daily': {
        const va = sa ? (sa.dailyRemainingPercent||0) : -1;
        const vb = sb ? (sb.dailyRemainingPercent||0) : -1;
        return vb - va;
      }
      case 'weekly': {
        const va = sa ? (sa.weeklyRemainingPercent||0) : -1;
        const vb = sb ? (sb.weeklyRemainingPercent||0) : -1;
        return vb - va;
      }
      case 'planEnd': {
        // 升序：到期日近的在前；未加载最后
        if (has(sa) !== has(sb)) return has(sb) - has(sa);
        const va = sa?.planEnd ? new Date(sa.planEnd).getTime() : Infinity;
        const vb = sb?.planEnd ? new Date(sb.planEnd).getTime() : Infinity;
        return va - vb;
      }
      case 'email':
        return (a.email || '').localeCompare(b.email || '');
      case 'default':
      default:
        return 0;
    }
  }

  function renderCards() {
    if (!accountGrid) return;

    const sorted = [...accounts].sort((a, b) => {
      if (a.email === lastEmail) return -1;
      if (b.email === lastEmail) return 1;
      return cmpByMode(a, b, sortMode);
    });

    const newEmails = sorted.map(a => a.email);
    const oldCards = [...accountGrid.querySelectorAll('.grid-card')];
    const oldEmails = oldCards.map(c => c.dataset.email);

    // 结构变化（账号增减或顺序改变）时才重建，否则原地更新
    const structChanged = newEmails.length !== oldEmails.length || newEmails.some((e, i) => e !== oldEmails[i]);

    if (structChanged) {
      accountGrid.innerHTML = '';
      sorted.forEach(account => {
        accountGrid.appendChild(buildCard(account, account.email === lastEmail));
      });
    } else {
      sorted.forEach((account, i) => {
        const card = oldCards[i];
        if (!card) return;
        const isActive = account.email === lastEmail;
        card.className = 'grid-card' + (isActive ? ' is-active' : '');
        const cached = usageCache.get(account.email);
        if (cached?.snapshot) updateCard(card, cached.snapshot);
      });
    }

    if (gridCount) gridCount.textContent = accounts.length + ' 个';
    if (emptyState) emptyState.hidden = accounts.length > 0;
    if (accountGrid) accountGrid.hidden = accounts.length === 0;

    updateSummary();
  }

  // ==================== 号池汇总 ====================
  function updateSummary() {
    const card = document.getElementById('summaryCard');
    if (!card) return;
    if (accounts.length === 0) { card.hidden = true; return; }

    let dailySum = 0, weeklySum = 0, dataCount = 0;
    accounts.forEach(a => {
      const snap = usageCache.get(a.email)?.snapshot;
      if (snap) {
        dailySum += Math.max(0, Math.min(100, snap.dailyRemainingPercent || 0));
        weeklySum += Math.max(0, Math.min(100, snap.weeklyRemainingPercent || 0));
        dataCount++;
      }
    });

    card.hidden = false;

    const max = accounts.length * 100;
    const hasData = dataCount > 0;
    const dailyPct = hasData && max > 0 ? (dailySum / max) * 100 : 0;
    const weeklyPct = hasData && max > 0 ? (weeklySum / max) * 100 : 0;

    const countEl = document.getElementById('summaryCount');
    if (countEl) countEl.textContent = `${accounts.length} 账号`;

    const setStat = (prefix, sum, pct) => {
      const bar = document.getElementById(`summary${prefix}Bar`);
      const num = document.getElementById(`summary${prefix}Num`);
      const maxEl = document.getElementById(`summary${prefix}Max`);
      const pctEl = document.getElementById(`summary${prefix}Pct`);
      if (bar) bar.style.width = pct.toFixed(1) + '%';
      if (num) num.textContent = hasData ? Math.round(sum) : '—';
      if (maxEl) maxEl.textContent = `/ ${max}`;
      if (pctEl) pctEl.textContent = hasData ? pct.toFixed(1) + '%' : '—';
    };

    setStat('Daily', dailySum, dailyPct);
    setStat('Weekly', weeklySum, weeklyPct);
  }

  // 已移除列表视图，仅保留卡片视图

  // ==================== 批量导入 ====================
  let batchBusy = false;

  function setBatchMsg(text, isError) {
    // inline 提示仅用于错误/输入校验（如解析失败、请输入数据等）
    const el = document.getElementById('batchMsg');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
    el.className = 'batch-msg' + (isError ? ' is-error' : text ? ' is-ok' : '');
  }

  // ==================== 批量导入模态弹窗 ====================
  function showBatchModal(title) {
    const ov = document.getElementById('batchModalOverlay');
    if (!ov) return;
    const t = document.getElementById('batchModalTitle');
    const fill = document.getElementById('batchModalFill');
    const text = document.getElementById('batchModalProgressText');
    const cur = document.getElementById('batchModalCurrent');
    const cnt = document.getElementById('batchModalCounts');
    const fl = document.getElementById('batchModalFailList');
    const close = document.getElementById('batchModalClose');
    if (t) t.textContent = title || '批量导入中';
    if (fill) fill.style.width = '0%';
    if (text) text.textContent = '准备中…';
    if (cur) cur.textContent = '';
    if (cnt) cnt.innerHTML = '';
    if (fl) { fl.hidden = true; fl.innerHTML = ''; }
    if (close) close.hidden = true;
    const done = document.getElementById('batchModalDone');
    if (done) done.hidden = true;
    ov.hidden = false;
  }

  function updateBatchModal(info) {
    const { done = 0, total = 0, current = '', ok = 0, fail = 0, skipped = 0, retryInfo = '' } = info;
    const fill = document.getElementById('batchModalFill');
    const text = document.getElementById('batchModalProgressText');
    const cur = document.getElementById('batchModalCurrent');
    const cnt = document.getElementById('batchModalCounts');
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = `进度 ${done}/${total}（${pct}%）`;
    if (cur) cur.textContent = current ? (retryInfo ? `${retryInfo} ${current}` : `正在导入：${current}`) : '';
    if (cnt) {
      cnt.innerHTML =
        `<span class="count-ok">✓ 成功 ${ok}</span>` +
        `<span class="count-fail">✗ 失败 ${fail}</span>` +
        (skipped ? `<span class="count-skip">⤼ 跳过 ${skipped}</span>` : '');
    }
  }

  // 暂存最近一次批量导入的原始队列，用于重试时查找密码
  let _lastBatchQueue = [];

  function finalizeBatchModal(title, results, meta) {
    const ov = document.getElementById('batchModalOverlay');
    if (!ov) return;
    const t = document.getElementById('batchModalTitle');
    const text = document.getElementById('batchModalProgressText');
    const cur = document.getElementById('batchModalCurrent');
    const cnt = document.getElementById('batchModalCounts');
    const fl = document.getElementById('batchModalFailList');
    const close = document.getElementById('batchModalClose');
    const fill = document.getElementById('batchModalFill');
    const retryBtn = document.getElementById('batchModalRetry');
    const ok = results.filter(r => r.ok);
    const fail = results.filter(r => !r.ok);
    if (t) t.textContent = title || '批量导入完成';
    if (fill) fill.style.width = '100%';
    if (text) text.textContent = `完成：${ok.length}/${results.length} 成功`;
    if (cur) cur.textContent = '';
    if (cnt) {
      cnt.innerHTML =
        `<span class="count-ok">✓ 成功 ${ok.length}</span>` +
        `<span class="count-fail">✗ 失败 ${fail.length}</span>` +
        (meta?.skipped ? `<span class="count-skip">⤼ 已跳过重复 ${meta.skipped}</span>` : '') +
        (meta?.parseFail ? `<span class="count-skip">⚠ 解析失败 ${meta.parseFail}</span>` : '');
    }
    if (fl) {
      if (fail.length > 0) {
        fl.hidden = false;
        fl.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">失败明细</div>' +
          fail.map(r => `<div class="fail-item">· ${r.email}${r.error ? '（' + r.error + '）' : ''}</div>`).join('');
      } else {
        fl.hidden = true;
      }
    }
    // 有失败项时显示重试按钮
    if (retryBtn) {
      if (fail.length > 0) {
        retryBtn.hidden = false;
        retryBtn.textContent = `重试 ${fail.length} 个失败项`;
        retryBtn.onclick = () => retryFailedItems(fail);
      } else {
        retryBtn.hidden = true;
        retryBtn.onclick = null;
      }
    }
    if (close) close.hidden = false;
    const done = document.getElementById('batchModalDone');
    if (done) {
      done.hidden = false;
      done.onclick = () => hideBatchModal();
    }
  }

  function retryFailedItems(failedResults) {
    // 从原始队列中查找失败项的密码
    const retryAccts = [];
    for (const r of failedResults) {
      const original = _lastBatchQueue.find(a => a.email === r.email);
      if (original) {
        retryAccts.push({ email: original.email, password: original.password });
      }
    }
    if (retryAccts.length === 0) return;
    // 隐藏重试按钮，重新开始批量导入
    const retryBtn = document.getElementById('batchModalRetry');
    if (retryBtn) { retryBtn.hidden = true; retryBtn.onclick = null; }
    sendBatchAccounts(retryAccts, { skipped: 0, parseFail: 0 });
  }

  function hideBatchModal() {
    const ov = document.getElementById('batchModalOverlay');
    if (ov) ov.hidden = true;
  }

  function setBatchBusy(busy, btnSelector) {
    batchBusy = busy;
    const btn = document.querySelector(btnSelector);
    if (btn instanceof HTMLButtonElement) btn.disabled = busy;
  }

  async function sendBatchAccounts(accts, meta) {
    if (!accts.length) {
      // 没有需要导入的账号（全重复或全解析失败）：直接弹出总结
      const m = meta || { skipped: 0, parseFail: 0 };
      showBatchModal('批量导入完成');
      finalizeBatchModal('批量导入完成', [], m);
      return;
    }
    _lastBatchQueue = accts.slice(); // 保存原始队列用于重试
    globalThis._wsBatchMode = true;
    const prev = vscode.getState() || {};
    vscode.setState(Object.assign(prev, {
      _batchQueue: accts,
      _batchIndex: 0,
      _batchTotal: accts.length,
      _batchResults: [],
      _batchMeta: meta || { skipped: 0, parseFail: 0 }
    }));
    showBatchModal('批量导入中');
    updateBatchModal({ done: 0, total: accts.length, ok: 0, fail: 0, skipped: meta?.skipped || 0 });
    setBatchMsg('', false); // 清除 inline
    sendNextBatchItem();
  }

  // 批量导入参数
  const BATCH_RETRY_MAX = 2;          // 失败最多重试次数（共尝试 1 + RETRY_MAX 次）
  const BATCH_RETRY_DELAY = 2500;     // 重试前等待 ms
  const BATCH_INTERVAL_MIN = 800;     // 相邻账号最小间隔 ms（避免限流）
  const BATCH_TIMEOUT = 20000;        // 单个登录超时 ms

  // 不应重试的错误类型（账号本身问题）
  function shouldRetryError(err) {
    if (!err) return true;
    const noRetryKeywords = [
      '邮箱或密码错误', '邮箱不存在', '密码错误', '账号已被禁用',
      '尝试过多', '未开启密码登录', '请先设置密码', '请输入'
    ];
    return !noRetryKeywords.some(k => err.includes(k));
  }

  let _batchTimeoutTimer = null;
  let _lastBatchSentAt = 0;

  function sendNextBatchItem() {
    const st = vscode.getState() || {};
    const queue = st._batchQueue;
    const idx = st._batchIndex || 0;
    const total = st._batchTotal || 0;
    if (_batchTimeoutTimer) { clearTimeout(_batchTimeoutTimer); _batchTimeoutTimer = null; }
    if (!queue || idx >= total) {
      showBatchSummary();
      clearBatchState();
      return;
    }
    const wait = Math.max(0, BATCH_INTERVAL_MIN - (Date.now() - _lastBatchSentAt));
    setTimeout(() => actuallySendCurrentItem(), wait);
  }

  function actuallySendCurrentItem() {
    const st = vscode.getState() || {};
    const queue = st._batchQueue;
    const idx = st._batchIndex || 0;
    const total = st._batchTotal || 0;
    if (!queue || idx >= total) return;
    const item = queue[idx];
    const isToken = !!item.token;
    const itemLabel = isToken ? (item.token.substring(0, 20) + '...') : item.email;
    const retries = (st._batchRetries || {})[itemLabel] || 0;
    const retryHint = retries > 0 ? `重试 ${retries}/${BATCH_RETRY_MAX}` : '';
    const r0 = vscode.getState()?._batchResults || [];
    const meta0 = vscode.getState()?._batchMeta || {};
    updateBatchModal({
      done: idx,
      total,
      current: itemLabel,
      retryInfo: retryHint,
      ok: r0.filter(x => x.ok).length,
      fail: r0.filter(x => !x.ok).length,
      skipped: meta0.skipped || 0,
    });
    // 推进 index 到"待响应"状态
    vscode.setState(Object.assign(vscode.getState() || {}, { _batchIndex: idx + 1 }));
    _lastBatchSentAt = Date.now();
    if (isToken) {
      postMsg('batchTokenImport', { token: item.token, batch: true });
    } else {
      postMsg('loginSave', { email: item.email, password: item.password, batch: true, authMethod: item.authMethod || 'auto' });
    }

    // 超时兜底：后端无响应也推进
    _batchTimeoutTimer = setTimeout(() => {
      const cur = vscode.getState() || {};
      if (cur._batchQueue && (cur._batchIndex || 0) === idx + 1) {
        handleBatchItemResult(itemLabel, false, '请求超时');
      }
    }, BATCH_TIMEOUT);
  }

  // 处理单个账号的结果（成功或最终失败），决定是重试还是推进
  function handleBatchItemResult(email, ok, error) {
    if (_batchTimeoutTimer) { clearTimeout(_batchTimeoutTimer); _batchTimeoutTimer = null; }
    const st = vscode.getState() || {};
    if (!st._batchQueue) return;

    if (!ok && shouldRetryError(error)) {
      const retries = (st._batchRetries || {})[email] || 0;
      if (retries < BATCH_RETRY_MAX) {
        // 重试：回退 _batchIndex，安排延迟重发
        const newRetries = Object.assign({}, st._batchRetries || {}, { [email]: retries + 1 });
        const newIdx = (st._batchIndex || 1) - 1;
        vscode.setState(Object.assign(st, { _batchRetries: newRetries, _batchIndex: newIdx }));
        const r1 = vscode.getState()?._batchResults || [];
        const meta1 = vscode.getState()?._batchMeta || {};
        updateBatchModal({
          done: newIdx,
          total: st._batchTotal || 0,
          current: `${email} — ${error || '未知错误'}，${BATCH_RETRY_DELAY/1000}s 后重试…`,
          retryInfo: '',
          ok: r1.filter(x => x.ok).length,
          fail: r1.filter(x => !x.ok).length,
          skipped: meta1.skipped || 0,
        });
        setTimeout(() => sendNextBatchItem(), BATCH_RETRY_DELAY);
        return;
      }
    }

    // 不重试：记录结果并推进
    recordBatchResult(email, ok, error);
    sendNextBatchItem();
  }

  function recordBatchResult(email, ok, error) {
    const st = vscode.getState() || {};
    const results = st._batchResults || [];
    results.push({ email, ok, error });
    st._batchResults = results;
    vscode.setState(st);
  }

  function showBatchSummary() {
    const st = vscode.getState() || {};
    const results = st._batchResults || [];
    const meta = st._batchMeta || { skipped: 0, parseFail: 0 };
    // 清除 inline 提示
    setBatchMsg('', false);
    // 用 webview 内模态弹窗呈现最终结果（带"关闭"按钮）
    finalizeBatchModal('批量导入完成', results, meta);
  }

  function clearBatchState() {
    globalThis._wsBatchMode = false;
    if (_batchTimeoutTimer) { clearTimeout(_batchTimeoutTimer); _batchTimeoutTimer = null; }
    const st = vscode.getState() || {};
    delete st._batchQueue;
    delete st._batchIndex;
    delete st._batchTotal;
    delete st._batchResults;
    delete st._batchMeta;
    delete st._batchRetries;
    vscode.setState(st);
  }

  // 启动时若有残留批量状态：静默清理（webview 关闭即视为放弃批量导入）
  function checkBatchResume() {
    const st = vscode.getState() || {};
    if (st._batchQueue || st._batchIndex || st._batchTotal || st._batchResults || st._batchMeta || st._batchRetries) {
      clearBatchState();
    }
  }

  // 过滤已存在账号，返回 { fresh, skipped }
  function filterExistingAccounts(accts) {
    const existing = new Set(accounts.map(a => a.email.toLowerCase()));
    const fresh = [];
    const skipped = [];
    for (const a of accts) {
      if (a.token) { fresh.push(a); continue; } // token 导入无法预判重复，始终放行
      if (existing.has(a.email.toLowerCase())) skipped.push(a.email);
      else fresh.push(a);
    }
    return { fresh, skipped };
  }

  async function doBatchImportText() {
    if (batchBusy) return;
    const text = document.getElementById('batchText');
    if (!text || !text.value.trim()) {
      setBatchMsg('请输入账号数据', true);
      return;
    }
    const delimSelect = document.getElementById('batchDelimiter');
    let delim = delimSelect ? delimSelect.value : '----';
    if (delim === 'custom') {
      const customEl = document.getElementById('batchCustomDelim');
      delim = customEl ? customEl.value : '';
      if (!delim) { setBatchMsg('请输入自定义分隔符', true); return; }
    } else if (delim === '\\t') {
      delim = '\t';
    }
    const authMethodEl = document.querySelector('input[name="batchAuthMethod"]:checked');
    const authMethod = authMethodEl ? authMethodEl.value : 'auto';
    const lines = text.value.trim().split('\n').filter(l => l.trim());
    const accts = [];
    const errors = [];
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // 检测 auth1_ token 直接导入
      if (line.startsWith('auth1_')) {
        const tokenKey = line.substring(0, 24);
        if (seen.has(tokenKey)) { errors.push(`第 ${i+1} 行 token 重复`); continue; }
        seen.add(tokenKey);
        accts.push({ token: line });
        continue;
      }
      const idx = line.indexOf(delim);
      if (idx <= 0) { errors.push(`第 ${i+1} 行格式错误: ${line.substring(0,40)}`); continue; }
      const email = line.substring(0, idx).trim();
      const password = line.substring(idx + delim.length).trim();
      if (!email || !password) { errors.push(`第 ${i+1} 行邮箱或密码为空`); continue; }
      if (seen.has(email.toLowerCase())) { errors.push(`第 ${i+1} 行邮箱重复: ${email}`); continue; }
      seen.add(email.toLowerCase());
      accts.push({ email, password, authMethod });
    }
    const { fresh, skipped } = filterExistingAccounts(accts);
    if (fresh.length === 0) {
      const msg = skipped.length ? `所有 ${skipped.length} 个账号已存在，跳过导入` : (errors.length ? errors.join('\n') : '未解析到有效账号');
      setBatchMsg(msg, true);
      showBatchModal('批量导入');
      finalizeBatchModal('批量导入', [], { skipped: skipped.length, parseFail: errors.length });
      return;
    }
    setBatchBusy(true, '[data-action="batchImportText"]');
    try {
      await sendBatchAccounts(fresh, { skipped: skipped.length, parseFail: errors.length });
    } finally {
      setBatchBusy(false, '[data-action="batchImportText"]');
    }
  }

  async function doBatchImportJson() {
    if (batchBusy) return;
    const textarea = document.getElementById('batchJson');
    if (!textarea || !textarea.value.trim()) {
      setBatchMsg('请输入 JSON 数据', true);
      return;
    }
    let data;
    try {
      data = JSON.parse(textarea.value.trim());
    } catch (e) {
      setBatchMsg('JSON 格式错误: ' + e.message, true);
      return;
    }
    if (!Array.isArray(data)) {
      setBatchMsg('JSON 必须是数组格式 [{email, password}, ...]', true);
      return;
    }
    const accts = [];
    const errors = [];
    const seen = new Set();
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (!item.email || !item.password) { errors.push(`第 ${i+1} 项缺少 email 或 password`); continue; }
      const em = String(item.email).trim().toLowerCase();
      if (seen.has(em)) { errors.push(`第 ${i+1} 项邮箱重复: ${item.email}`); continue; }
      seen.add(em);
      accts.push({ email: String(item.email).trim(), password: String(item.password).trim() });
    }
    const { fresh, skipped } = filterExistingAccounts(accts);
    if (fresh.length === 0) {
      const msg = skipped.length ? `所有 ${skipped.length} 个账号已存在，跳过导入` : (errors.length ? errors.join('\n') : '未解析到有效账号');
      setBatchMsg(msg, true);
      showBatchModal('批量导入');
      finalizeBatchModal('批量导入', [], { skipped: skipped.length, parseFail: errors.length });
      return;
    }
    setBatchBusy(true, '[data-action="batchImportJson"]');
    try {
      await sendBatchAccounts(fresh, { skipped: skipped.length, parseFail: errors.length });
    } finally {
      setBatchBusy(false, '[data-action="batchImportJson"]');
    }
  }

  function updateTextPlaceholder(delim, authMethod) {
    const ta = document.getElementById('batchText');
    const hint = document.querySelector('#batchTextArea .batch-hint');
    if (!(ta instanceof HTMLTextAreaElement)) return;
    let d = delim || '----';
    if (d === '\\t') d = '\t';
    if (d === 'custom') d = '<自定义>';
    const am = authMethod || 'auto';
    if (am === 'auth1') {
      ta.placeholder = `user1@example.com${d}password123\nuser2@example.com${d}abc456789\nauth1_xxxx... (直接粘 auth1_ token 也行)`;
      if (hint) hint.textContent = '每行一组: 邮箱{分隔符}密码（Auth1 登录） — 或直接粘贴 auth1_ token';
    } else if (am === 'firebase') {
      ta.placeholder = `user1@example.com${d}password123\nuser2@example.com${d}abc456789`;
      if (hint) hint.textContent = '每行一组: 邮箱{分隔符}密码（Firebase 登录）';
    } else {
      ta.placeholder = `user1@example.com${d}password123\nuser2@example.com${d}abc456789\nauth1_xxxx... (直接粘 auth1_ token 也行)`;
      if (hint) hint.textContent = '每行一组: 邮箱{分隔符}密码 — 或直接粘贴以 auth1_ 开头的 token 自动识别';
    }
  }

  // ==================== 自动切号 ====================
  // 自动切号逻辑已移至后端 autoSwitcher.ts

  function setAutoSwitchMsg(text, type) {
    const el = document.getElementById('autoSwitchStatus');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
    el.className = 'as-status' + (type === 'warn' ? ' is-warn' : '');
  }

  function addAutoSwitchLog(line) {
    const el = document.getElementById('autoSwitchLog');
    if (!el) return;
    el.hidden = false;
    const lines = el.textContent ? el.textContent.split('\n') : [];
    lines.push(line);
    if (lines.length > 20) lines.splice(0, lines.length - 20);
    el.textContent = lines.join('\n');
    el.scrollTop = el.scrollHeight;
  }

  function syncAutoSwitchUI() {
    if (asEnabledEl) asEnabledEl.checked = autoSwitchEnabled;
    if (asThresholdEl) asThresholdEl.value = autoSwitchThreshold;
    const asCheckEl = document.getElementById('asCheckInterval');
    const asCooldownEl = document.getElementById('asCooldown');
    if (asCheckEl) asCheckEl.value = autoSwitchCheckSec;
    if (asCooldownEl) asCooldownEl.value = autoSwitchCooldownSec;
    const asScoreModeEl = document.getElementById('asScoreMode');
    if (asScoreModeEl) asScoreModeEl.value = autoSwitchScoreMode;
    updateScoreModeHint();
    if (asBadge) {
      asBadge.textContent = autoSwitchEnabled ? 'ON' : 'OFF';
      asBadge.className = 'as-badge' + (autoSwitchEnabled ? ' is-on' : '');
    }
  }

  const SCORE_MODE_HINTS = {
    min: '取 min(日配额, 周配额) 作为评分，任一配额低于阈值即触发切号。',
    daily: '仅以日配额作为评分，日配额低于阈值即触发切号，忽略周配额。',
    weekly: '仅以周配额作为评分，周配额低于阈值即触发切号，忽略日配额。',
  };
  function updateScoreModeHint() {
    const el = document.getElementById('asHint');
    if (el) el.textContent = SCORE_MODE_HINTS[autoSwitchScoreMode] || SCORE_MODE_HINTS.min;
  }

  // ==================== 定时刷新 ====================
  // 后端 AutoSwitcher 负责额度刷新和自动切号，webview 不再有独立定时器
  function startAutoRefresh() {
    stopAutoRefresh();
  }

  function stopAutoRefresh() {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  }

  function refreshAll() {
    // 通知后端全量刷新（后端串行+限流，结果通过 usage 消息逐个推送）
    postMsg('refreshAllUsage', {});
    if (refreshAllBtn) {
      refreshAllBtn.classList.add('is-spinning');
      setTimeout(() => refreshAllBtn.classList.remove('is-spinning'), 15000);
    }
  }

  // ==================== 通用提示/确认弹窗 ====================
  const alertIcons = {
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
  };

  function showAlert({ id, title, message, level, buttons }) {
    const ov = document.getElementById('alertOverlay');
    if (!ov) return;
    const titleEl = document.getElementById('alertTitle');
    const msgEl = document.getElementById('alertMessage');
    const actEl = document.getElementById('alertActions');
    const closeX = document.getElementById('alertCloseX');

    if (titleEl) titleEl.textContent = title || '提示';

    const iconClass = level === 'error' ? 'is-error' : level === 'warn' ? 'is-warn' : 'is-info';
    const iconSvg = alertIcons[level] || alertIcons.info;
    if (msgEl) msgEl.innerHTML = `<div class="alert-icon ${iconClass}">${iconSvg}<span>${escHtml(message)}</span></div>`;

    if (actEl) {
      actEl.innerHTML = '';
      const btns = buttons && buttons.length ? buttons : ['确定'];
      btns.forEach((label, idx) => {
        const btn = document.createElement('button');
        btn.className = 'alert-btn ' + (idx === 0 ? 'primary' : 'secondary');
        btn.textContent = label;
        btn.onclick = () => {
          ov.hidden = true;
          if (id) postMsg('alertResponse', { id, action: label });
        };
        actEl.appendChild(btn);
      });
    }

    if (closeX) {
      closeX.onclick = () => {
        ov.hidden = true;
        if (id) postMsg('alertResponse', { id, action: null });
      };
    }

    ov.hidden = false;
  }

  // ==================== 消息发送 ====================
  function postMsg(type, data = {}) {
    vscode.postMessage({ type, ...data });
  }

  // ==================== 事件处理 ====================
  function handleCardAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const card = btn.closest('.grid-card');
    const email = card?.dataset.email;
    if (!email) return;

    switch (action) {
      case 'switch':
        postMsg('switch', { email });
        break;
      case 'refresh':
        postMsg('fetchUsageFor', { email });
        const refreshBtn = card.querySelector('[data-action="refresh"]');
        if (refreshBtn) {
          refreshBtn.classList.add('is-spinning');
          setTimeout(() => refreshBtn.classList.remove('is-spinning'), 1500);
        }
        break;
      case 'delete': {
        // 淡出动画后发送删除消息（原版风格，无 confirm 弹窗）
        card.style.transition = 'opacity 0.2s, transform 0.2s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => postMsg('delete', { email }), 200);
        break;
      }
    }
  }

  function handleLogin() {
    const email = $('#email')?.value?.trim();
    const password = $('#loginPassword')?.value;
    if (!email || !password) return;
    const amEl = document.querySelector('input[name="batchAuthMethod"]:checked');
    const authMethod = amEl ? amEl.value : 'auto';
    postMsg('loginSave', { email, password, authMethod });
  }

  // ==================== 消息监听 ====================
  function handleAccountsChanged(newAccounts, newLastEmail, newExternalAccount) {
    const accountsChanged = newAccounts.length !== accounts.length || newAccounts.some((a, i) => a.email !== accounts[i]?.email);
    accounts = newAccounts;
    lastEmail = newLastEmail;
    externalAccount = newExternalAccount || '';
    renderCards();
    // 更新外部账户提示条
    const banner = document.getElementById('externalBanner');
    const emailEl = document.getElementById('externalEmail');
    if (banner) {
      banner.hidden = !externalAccount;
      if (emailEl) emailEl.textContent = externalAccount;
    }
    // 没有缓存额度的账号分批拉取，每批 10 个，间隔 300ms
    const needFetch = accounts.filter(a => !usageCache.has(a.email)).map(a => a.email);
    const BATCH = 10, DELAY = 300;
    let idx = 0;
    function fetchBatch() {
      const batch = needFetch.slice(idx, idx + BATCH);
      batch.forEach(email => postMsg('fetchUsageFor', { email }));
      idx += BATCH;
      if (idx < needFetch.length) setTimeout(fetchBatch, DELAY);
    }
    if (needFetch.length) fetchBatch();
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'accountsChanged':
        handleAccountsChanged(msg.accounts, msg.lastEmail, msg.externalAccount);
        // 批量模式下，accountsChanged 仅刷新 UI，不再驱动队列推进
        // 队列推进改由后端的 batchResult 消息驱动（更准确）
        break;

      case 'usage': {
        const { email, snapshot, error } = msg;
        if (!email) break;
        usageCache.set(email, { snapshot: snapshot || null, error, ts: Date.now() });
        persistState();
        const card = accountGrid?.querySelector(`[data-email="${cssEscape(email)}"]`);
        if (card && snapshot) {
          updateCard(card, snapshot);
        } else if (card && error) {
          const errEl = card.querySelector('.grid-card-error');
          if (errEl) { errEl.textContent = error; errEl.hidden = false; }
        }
        // 新额度到达后防抖重排（按日配额降序）
        scheduleRerender();
        // 即时更新汇总面板（不用等防抖重排）
        updateSummary();
        break;
      }

      case 'batchResult': {
        if (globalThis._wsBatchMode) {
          handleBatchItemResult(msg.email, msg.ok, msg.error);
        }
        break;
      }

      case 'instanceListResult': {
        renderInstanceList(msg.instances || [], msg.hasUnimported);
        break;
      }

      case 'instanceProgress': {
        showInstProgress(msg.message, msg.done, msg.error);
        break;
      }

      case 'instanceError': {
        showInstProgress(msg.error, true, true);
        break;
      }

      case 'cockpitListResult': {
        renderCockpitList(msg.instances || []);
        break;
      }

      case 'showAlert': {
        showAlert(msg);
        break;
      }

      case 'autoSwitchEvent': {
        if (msg.log) addAutoSwitchLog(msg.log);
        if (msg.status !== undefined) setAutoSwitchMsg(msg.status, msg.statusType);
        break;
      }

      case 'autoSwitchSettingsSync': {
        autoSwitchEnabled = !!msg.enabled;
        autoSwitchThreshold = msg.threshold || 10;
        autoSwitchCheckSec = msg.checkSec || 60;
        autoSwitchCooldownSec = msg.cooldownSec || 30;
        autoSwitchScoreMode = msg.scoreMode || 'min';
        syncAutoSwitchUI();
        const asBody = document.getElementById('asBody');
        if (asBody) asBody.style.display = autoSwitchEnabled ? '' : 'none';
        break;
      }
    }
  });

  // ==================== 持久化 ====================
  function persistState() {
    const cacheObj = {};
    usageCache.forEach((v, k) => { cacheObj[k] = v; });
    // 合并而非覆盖，避免清掉批量导入队列等其他 state
    const prev = vscode.getState() || {};
    vscode.setState(Object.assign(prev, {
      _usageCache: cacheObj,
    }));
  }

  function restoreState() {
    const s = vscode.getState();
    if (!s) return;
    if (s._usageCache) {
      Object.entries(s._usageCache).forEach(([email, data]) => {
        if (data.ts && Date.now() - data.ts < 5 * 60 * 1000) usageCache.set(email, data);
      });
    }
    // 自动切号设置从后端 autoSwitchSettingsSync 消息获取
    renderCards();
  }

  // ==================== 多实例管理 ====================
  let _instances = [];

  function buildInstCardHTML(inst) {
    const isCurrent = inst.current;
    const statusClass = isCurrent ? 'current' : (inst.running ? 'running' : 'stopped');
    const stateText = isCurrent ? '当前窗口' : (inst.running ? '运行中' : '已停止');
    const isDefault = inst.id === 'default';
    const sourceBadge = inst.source === 'cockpit'
      ? '<span class="inst-source-badge" title="实例数据来自 Cockpit Tools，删除时仅解除关联">Cockpit</span>'
      : isDefault
        ? '<span class="inst-source-badge default" title="Windsurf 默认实例">主实例</span>'
        : '';

    let primaryBtn;
    if (isCurrent) {
      primaryBtn = `<button class="inst-card-btn current" disabled title="正是当前窗口，无需操作">
         <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8l3 3 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg>
         当前窗口
       </button>`;
    } else if (inst.running) {
      primaryBtn = `<button class="inst-card-btn stop" data-inst-action="stop" title="停止">
         <svg width="11" height="11" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" fill="currentColor" rx="1"/></svg>
         停止
       </button>`;
    } else {
      primaryBtn = `<button class="inst-card-btn start" data-inst-action="start" title="启动">
         <svg width="11" height="11" viewBox="0 0 16 16"><polygon points="4,3 13,8 4,13" fill="currentColor"/></svg>
         启动
       </button>`;
    }

    // 跳转按钮：始终占位，运行中非当前窗口时可见
    const canFocus = !isCurrent && inst.running;
    const focusBtn = `<button class="icon-btn focus" data-inst-action="focus" title="跳转到此窗口"${canFocus ? '' : ' style="visibility:hidden" disabled'}>
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
       </button>`;
    return { statusClass, stateText, isDefault, isCurrent, sourceBadge, primaryBtn, focusBtn };
  }

  function renderInstanceList(instances, hasUnimported) {
    _instances = instances;
    const list = document.getElementById('instList');
    const empty = document.getElementById('instEmpty');
    const count = document.getElementById('instCount');
    if (count) count.textContent = String(instances.length);
    if (!list) return;
    if (instances.length === 0) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    const oldCards = [...list.querySelectorAll('.inst-card')];
    const oldIds = oldCards.map(c => c.dataset.instId);
    const newIds = instances.map(i => i.id);

    // 结构变化时才重建，否则原地更新
    const structChanged = newIds.length !== oldIds.length || newIds.some((id, i) => id !== oldIds[i]);

    if (structChanged) {
      list.innerHTML = instances.map(inst => {
        const { statusClass, stateText, isDefault, isCurrent, sourceBadge, primaryBtn, focusBtn } = buildInstCardHTML(inst);
        return `<div class="inst-card ${statusClass}" data-inst-id="${escHtml(inst.id)}">
          <div class="inst-card-header">
            <span class="inst-status-dot ${statusClass}" title="${stateText}"></span>
            <div class="inst-card-name">${escHtml(inst.name)}</div>${sourceBadge}
            ${focusBtn}<span class="inst-card-state">${stateText}</span>
          </div>
          <div class="inst-card-email" title="${escHtml(inst.bindEmail || '')}">${inst.bindEmail ? escHtml(inst.bindEmail) : '<span style="opacity:0.4">未绑定账号</span>'}</div>
          <div class="inst-card-actions">
            ${primaryBtn}
            <button class="icon-btn" data-inst-action="edit" title="编辑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
            </button>
            <button class="icon-btn danger" data-inst-action="delete" title="删除"${(isCurrent || isDefault) ? ' disabled' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </div>`;
      }).join('');
    } else {
      // 原地更新：只更新变化的属性
      instances.forEach((inst, i) => {
        const card = oldCards[i];
        if (!card) return;
        const { statusClass, stateText, isDefault, isCurrent, sourceBadge, primaryBtn, focusBtn } = buildInstCardHTML(inst);
        card.className = 'inst-card ' + statusClass;
        const dot = card.querySelector('.inst-status-dot');
        if (dot) { dot.className = 'inst-status-dot ' + statusClass; dot.title = stateText; }
        const nameEl = card.querySelector('.inst-card-name');
        if (nameEl) {
          nameEl.textContent = inst.name;
          // 更新 sourceBadge（作为 header 的独立子元素）
          const header = card.querySelector('.inst-card-header');
          const oldBadge = header?.querySelector('.inst-source-badge');
          if (oldBadge) oldBadge.remove();
          if (sourceBadge && header) {
            const tmp = document.createElement('div');
            tmp.innerHTML = sourceBadge;
            if (tmp.firstElementChild) header.insertBefore(tmp.firstElementChild, nameEl.nextSibling);
          }
        }
        const stateEl = card.querySelector('.inst-card-state');
        if (stateEl) stateEl.textContent = stateText;
        const emailEl = card.querySelector('.inst-card-email');
        if (emailEl) {
          emailEl.title = inst.bindEmail || '';
          emailEl.innerHTML = inst.bindEmail ? escHtml(inst.bindEmail) : '<span style="opacity:0.4">未绑定账号</span>';
        }
        const actionsEl = card.querySelector('.inst-card-actions');
        if (actionsEl) {
          // 更新主按钮
          const oldPrimary = actionsEl.querySelector('.inst-card-btn');
          if (oldPrimary) {
            const tmp = document.createElement('div');
            tmp.innerHTML = primaryBtn;
            actionsEl.replaceChild(tmp.firstElementChild, oldPrimary);
          }
          // 更新删除按钮禁用状态
          const delBtn = actionsEl.querySelector('[data-inst-action="delete"]');
          if (delBtn) delBtn.disabled = isCurrent || isDefault;
        }
      });
    }

    // 检测 Cockpit 未导入实例并提示
    if (hasUnimported && !window._cockpitPromptShown) {
      window._cockpitPromptShown = true;
      setTimeout(async () => {
        const ok = await showConfirm('检测到 Cockpit Tools 的 Windsurf 实例，是否现在导入？', 'Cockpit Tools 实例');
        if (ok) openCockpitImportModal();
      }, 500);
    }
  }

  // 持久 toast 引用（用于"加载中"等持续状态，done 时被替换/关闭）
  let _persistentToast = null;

  function showInstProgress(msg, done, error) {
    if (!msg) return;
    // 移除上一个未完成的 persistent toast
    if (_persistentToast) {
      _persistentToast.remove();
      _persistentToast = null;
    }
    const toast = createToast(msg, error ? 'error' : (done ? 'success' : 'loading'));
    if (!done) {
      _persistentToast = toast;
    } else {
      const ttl = error ? 5000 : 2000;
      setTimeout(() => removeToast(toast), ttl);
    }
  }

  function createToast(msg, type) {
    const container = document.getElementById('toastContainer');
    if (!container) return null;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const iconHtml = type === 'loading'
      ? '<span class="toast-spinner"></span>'
      : type === 'success'
        ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 8l3 3 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="5" x2="8" y2="9" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.6" fill="currentColor"/></svg>';
    toast.innerHTML = `${iconHtml}<span class="toast-msg">${escHtml(msg)}</span><button class="toast-close" aria-label="关闭">✕</button>`;
    toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-in'));
    return toast;
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove('toast-in');
    toast.classList.add('toast-out');
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 220);
    if (_persistentToast === toast) _persistentToast = null;
  }

  // 生成下一个"实例N"的默认名称，跳过已存在的
  function getNextInstanceName() {
    let n = 1;
    while (_instances.some(i => i.name === '实例' + n)) { n++; }
    return '实例' + n;
  }

  // ==================== 自定义账号下拉组件 ====================
  function getUsageLevel(pct) {
    if (pct == null || isNaN(pct)) return 'unknown';
    if (pct < 50) return 'low';
    if (pct < 90) return 'mid';
    return 'high';
  }

  function renderAccountItemContent(account) {
    if (!account) return '<span class="ap-empty">选择账号</span>';
    const cache = usageCache.get(account.email);
    const snap = cache?.snapshot;
    let usageHtml = '';
    if (snap) {
      const dayRemain = Math.max(0, Math.min(100, snap.dailyRemainingPercent ?? 100));
      const weekRemain = Math.max(0, Math.min(100, snap.weeklyRemainingPercent ?? 100));
      usageHtml = `
        <span class="ap-stat ap-day-${getUsageLevel(100 - dayRemain)}">日余 ${dayRemain.toFixed(0)}%</span>
        <span class="ap-stat ap-week-${getUsageLevel(100 - weekRemain)}">周余 ${weekRemain.toFixed(0)}%</span>
      `;
    } else if (cache?.error) {
      usageHtml = '<span class="ap-stat ap-err">额度获取失败</span>';
    } else {
      usageHtml = '<span class="ap-stat ap-loading">加载中…</span>';
    }
    return `
      <div class="ap-email">${escHtml(account.email)}</div>
      <div class="ap-usage">${usageHtml}</div>
    `;
  }

  function renderAccountPicker(el, selectedEmail) {
    if (!el || accounts.length === 0) {
      if (el) el.innerHTML = '<div class="ap-empty-state">暂无账号，请先在号池添加</div>';
      return;
    }

    el.innerHTML = '';
    el.classList.add('account-picker');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ap-trigger';
    trigger.innerHTML = `<div class="ap-trigger-content"></div><span class="ap-arrow">▾</span>`;

    // 下拉列表挂载到 body 末尾，避免被模态框 overflow 裁切
    const list = document.createElement('div');
    list.className = 'ap-list ap-list-portal';
    list.hidden = true;
    list.innerHTML = accounts.map(a =>
      `<div class="ap-item" data-email="${escHtml(a.email)}">${renderAccountItemContent(a)}</div>`
    ).join('');

    function positionList() {
      const rect = trigger.getBoundingClientRect();
      const vh = window.innerHeight;
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      const listMaxH = 280;
      // 空间不足时向上展开
      if (spaceBelow < listMaxH && spaceAbove > spaceBelow) {
        list.style.top = '';
        list.style.bottom = (vh - rect.top + 4) + 'px';
        list.style.maxHeight = Math.min(listMaxH, spaceAbove - 8) + 'px';
      } else {
        list.style.bottom = '';
        list.style.top = (rect.bottom + 4) + 'px';
        list.style.maxHeight = Math.min(listMaxH, spaceBelow - 8) + 'px';
      }
      list.style.left = rect.left + 'px';
      list.style.width = rect.width + 'px';
    }

    function selectEmail(email) {
      el.dataset.value = email;
      const acc = accounts.find(a => a.email === email);
      const content = trigger.querySelector('.ap-trigger-content');
      if (content) content.innerHTML = renderAccountItemContent(acc);
      list.hidden = true;
      list.querySelectorAll('.ap-item').forEach(it => {
        it.classList.toggle('selected', it.getAttribute('data-email') === email);
      });
    }

    function openList() {
      positionList();
      list.hidden = false;
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (list.hidden) openList();
      else list.hidden = true;
    });
    list.addEventListener('click', (e) => {
      const item = e.target.closest('[data-email]');
      if (item) selectEmail(item.getAttribute('data-email'));
    });

    // 点击外部 / 滚动 / resize 时关闭
    const onOutside = (e) => { if (!list.hidden && !el.contains(e.target) && !list.contains(e.target)) list.hidden = true; };
    const onScroll = () => { if (!list.hidden) positionList(); };
    document.addEventListener('click', onOutside);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);

    // 缓存清理（picker 重渲染时旧 list 移除）
    if (el._cleanupPicker) el._cleanupPicker();
    el._cleanupPicker = () => {
      document.removeEventListener('click', onOutside);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
      list.remove();
    };

    el.appendChild(trigger);
    document.body.appendChild(list);

    // 默认选中
    const initialEmail = (selectedEmail && accounts.some(a => a.email === selectedEmail))
      ? selectedEmail
      : accounts[0].email;
    selectEmail(initialEmail);
  }

  function getAccountPickerValue(elId) {
    const el = document.getElementById(elId);
    return el?.dataset.value || '';
  }

  function openInstCreateModal() {
    const overlay = document.getElementById('instCreateOverlay');
    const nameInput = document.getElementById('instCreateName');
    const accountEl = document.getElementById('instCreateAccount');
    const errorEl = document.getElementById('instCreateError');
    if (!overlay) return;

    renderAccountPicker(accountEl, lastEmail);
    if (nameInput) nameInput.value = getNextInstanceName();
    if (errorEl) errorEl.hidden = true;
    overlay.hidden = false;
  }

  function submitInstCreate() {
    const nameInput = document.getElementById('instCreateName');
    const errorEl = document.getElementById('instCreateError');
    const overlay = document.getElementById('instCreateOverlay');
    const name = nameInput?.value?.trim();
    const email = getAccountPickerValue('instCreateAccount');

    if (!name) {
      if (errorEl) { errorEl.textContent = '请输入实例名称'; errorEl.hidden = false; }
      return;
    }
    if (!email) {
      if (errorEl) { errorEl.textContent = '请选择绑定账号'; errorEl.hidden = false; }
      return;
    }
    if (_instances.some(i => i.name === name)) {
      if (errorEl) { errorEl.textContent = '实例名称已存在'; errorEl.hidden = false; }
      return;
    }

    if (overlay) overlay.hidden = true;
    postMsg('instanceCreate', { instanceName: name, email });
  }

  // 自定义确认对话框（webview 不支持原生 confirm）
  function showConfirm(message, title) {
    return new Promise(resolve => {
      const overlay = document.getElementById('confirmOverlay');
      const titleEl = document.getElementById('confirmTitle');
      const msgEl = document.getElementById('confirmMsg');
      const okBtn = document.getElementById('confirmOk');
      const cancelBtn = document.getElementById('confirmCancel');
      const closeBtn = document.getElementById('confirmClose');
      if (!overlay) { resolve(false); return; }

      if (titleEl) titleEl.textContent = title || '确认';
      if (msgEl) msgEl.textContent = message;
      overlay.hidden = false;

      const cleanup = (result) => {
        overlay.hidden = true;
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        closeBtn.onclick = null;
        resolve(result);
      };
      okBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
      closeBtn.onclick = () => cleanup(false);
    });
  }

  function openInstEditModal(inst) {
    const overlay = document.getElementById('instEditOverlay');
    const nameInput = document.getElementById('instEditName');
    const accountEl = document.getElementById('instEditAccount');
    const errorEl = document.getElementById('instEditError');
    if (!overlay) return;

    renderAccountPicker(accountEl, inst.bindEmail);
    if (nameInput) nameInput.value = inst.name;
    if (errorEl) errorEl.hidden = true;
    overlay.dataset.instId = inst.id;
    overlay.hidden = false;
  }

  function submitInstEdit() {
    const overlay = document.getElementById('instEditOverlay');
    const nameInput = document.getElementById('instEditName');
    const errorEl = document.getElementById('instEditError');
    const id = overlay?.dataset.instId;
    const name = nameInput?.value?.trim();
    const email = getAccountPickerValue('instEditAccount');
    if (!id) return;
    if (!name) {
      if (errorEl) { errorEl.textContent = '请输入实例名称'; errorEl.hidden = false; }
      return;
    }
    if (overlay) overlay.hidden = true;
    postMsg('instanceUpdate', { instanceId: id, instanceName: name, email });
  }

  async function handleInstAction(e) {
    const btn = e.target.closest('[data-inst-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-inst-action');
    const item = btn.closest('[data-inst-id]');
    const id = item?.getAttribute('data-inst-id');
    if (!id) return;

    if (action === 'start') {
      btn.disabled = true;
      btn.innerHTML = '<span class="toast-spinner" style="width:11px;height:11px"></span> 启动中…';
      postMsg('instanceStart', { instanceId: id });
    } else if (action === 'stop') {
      btn.disabled = true;
      btn.innerHTML = '<span class="toast-spinner" style="width:11px;height:11px"></span> 停止中…';
      postMsg('instanceStop', { instanceId: id });
    } else if (action === 'focus') {
      postMsg('instanceFocus', { instanceId: id });
    } else if (action === 'edit') {
      const inst = _instances.find(i => i.id === id);
      if (!inst) return;
      openInstEditModal(inst);
    } else if (action === 'delete') {
      const inst = _instances.find(i => i.id === id);
      if (inst?.running) {
        showInstProgress('请先停止实例再删除', true, true);
        return;
      }
      const hint = inst?.source === 'cockpit'
        ? '仅会解除与 Cockpit Tools 实例的关联，原 Cockpit 实例目录保留。'
        : '实例数据目录将被永久删除。';
      const ok = await showConfirm('确定删除实例 "' + (inst?.name || id) + '"？\n' + hint, '删除实例');
      if (!ok) return;
      postMsg('instanceDelete', { instanceId: id });
    }
  }

  // ── Cockpit 导入 ──
  let _cockpitInstances = [];

  function openCockpitImportModal() {
    const overlay = document.getElementById('cockpitImportOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    postMsg('cockpitList', {});
  }

  function renderCockpitList(instances) {
    _cockpitInstances = instances;
    const list = document.getElementById('cockpitList');
    const empty = document.getElementById('cockpitEmpty');
    if (!list) return;
    if (instances.length === 0) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = instances.map(inst => {
      const email = inst.bindEmail || '未绑定';
      const btn = inst.imported
        ? '<button class="cockpit-import-btn" disabled>已导入</button>'
        : '<button class="cockpit-import-btn" data-cockpit-action="import">导入</button>';
      return `<div class="cockpit-item ${inst.imported ? 'imported' : ''}" data-cockpit-id="${escHtml(inst.id)}">
        <span class="cockpit-id">${escHtml(inst.id.substring(0, 8))}</span>
        <div class="cockpit-info">
          <div class="cockpit-email">${escHtml(email)}</div>
          <div class="cockpit-hint">Cockpit 实例</div>
        </div>
        ${btn}
      </div>`;
    }).join('');
  }

  function handleCockpitAction(e) {
    const btn = e.target.closest('[data-cockpit-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-cockpit-action');
    const item = btn.closest('[data-cockpit-id]');
    const id = item?.getAttribute('data-cockpit-id');
    if (!id || action !== 'import') return;

    const inst = _cockpitInstances.find(i => i.id === id);
    if (!inst) return;

    openCockpitFormModal(inst);
  }

  function openCockpitFormModal(cockpitInst) {
    const overlay = document.getElementById('cockpitFormOverlay');
    const importOverlay = document.getElementById('cockpitImportOverlay');
    const nameInput = document.getElementById('cockpitFormName');
    const accountEl = document.getElementById('cockpitFormAccount');
    const errorEl = document.getElementById('cockpitFormError');
    if (!overlay) return;

    if (importOverlay) importOverlay.hidden = true;

    renderAccountPicker(accountEl, cockpitInst.bindEmail);
    if (nameInput) nameInput.value = getNextInstanceName();
    if (errorEl) errorEl.hidden = true;
    overlay.dataset.cockpitId = cockpitInst.id;
    overlay.hidden = false;
  }

  function submitCockpitImport() {
    const overlay = document.getElementById('cockpitFormOverlay');
    const nameInput = document.getElementById('cockpitFormName');
    const errorEl = document.getElementById('cockpitFormError');
    const cockpitId = overlay?.dataset.cockpitId;
    const name = nameInput?.value?.trim();
    const email = getAccountPickerValue('cockpitFormAccount');

    if (!cockpitId) return;
    if (!name) {
      if (errorEl) { errorEl.textContent = '请输入实例名称'; errorEl.hidden = false; }
      return;
    }
    if (!email) {
      if (errorEl) { errorEl.textContent = '请选择绑定账号（需先在号池中添加该账号）'; errorEl.hidden = false; }
      return;
    }
    if (_instances.some(i => i.name === name)) {
      if (errorEl) { errorEl.textContent = '实例名称已存在'; errorEl.hidden = false; }
      return;
    }

    if (overlay) overlay.hidden = true;
    postMsg('cockpitImport', { cockpitId, instanceName: name, email });
  }

  // ==================== 初始化 ====================
  function init() {
    // 卡片点击
    if (accountGrid) accountGrid.addEventListener('click', handleCardAction);

    // 关闭"添加账号"模态框
    const closeAddAccountModal = () => {
      const overlay = document.getElementById('addAccountOverlay');
      if (overlay) overlay.hidden = true;
    };

    // 登录按钮（单个登录）
    const loginBtn = $('[data-action="loginSave"]');
    if (loginBtn) loginBtn.addEventListener('click', () => { handleLogin(); closeAddAccountModal(); });

    // Enter 键登录
    $('#loginPassword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { handleLogin(); closeAddAccountModal(); }
    });

    // 刷新全部
    if (refreshAllBtn) refreshAllBtn.addEventListener('click', refreshAll);

    // 批量导入按钮（点击后关闭添加模态框，进度由批量进度框显示）
    const batchTextBtn = $('[data-action="batchImportText"]');
    if (batchTextBtn) batchTextBtn.addEventListener('click', () => { doBatchImportText(); closeAddAccountModal(); });
    const batchJsonBtn = $('[data-action="batchImportJson"]');
    if (batchJsonBtn) batchJsonBtn.addEventListener('click', () => { doBatchImportJson(); closeAddAccountModal(); });

    // 从当前账户添加
    const addCurrentBtn = $('[data-action="addCurrent"]');
    if (addCurrentBtn) addCurrentBtn.addEventListener('click', () => { postMsg('addCurrent', {}); closeAddAccountModal(); });

    // 外部账户 "加入号池" 按钮
    const externalAddBtn = document.getElementById('externalAddBtn');
    if (externalAddBtn) externalAddBtn.addEventListener('click', () => postMsg('addCurrent', {}));

    // 添加账号模态框
    const addAccountBtn = document.getElementById('addAccountBtn');
    const addAccountOverlay = document.getElementById('addAccountOverlay');
    const addAccountClose = document.getElementById('addAccountClose');
    if (addAccountBtn && addAccountOverlay) {
      addAccountBtn.addEventListener('click', () => { addAccountOverlay.hidden = false; });
    }
    if (addAccountClose && addAccountOverlay) {
      addAccountClose.addEventListener('click', () => { addAccountOverlay.hidden = true; });
    }

    // 批量导入模态框关闭按钮
    const batchModalClose = document.getElementById('batchModalClose');
    if (batchModalClose) batchModalClose.addEventListener('click', hideBatchModal);

    // 排序菜单
    const sortBtn = document.getElementById('sortBtn');
    const sortMenu = document.getElementById('sortMenu');
    function markActiveSort() {
      if (!sortMenu) return;
      sortMenu.querySelectorAll('.sort-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-sort') === sortMode);
      });
    }
    // 恢复持久化排序
    try {
      const savedState = vscode.getState() || {};
      if (savedState._sortMode) sortMode = savedState._sortMode;
    } catch {}
    markActiveSort();
    if (sortBtn && sortMenu) {
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sortMenu.hidden = !sortMenu.hidden;
        if (!sortMenu.hidden) markActiveSort();
      });
      sortMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.sort-item');
        if (!item) return;
        sortMode = item.getAttribute('data-sort') || 'min';
        const st = vscode.getState() || {};
        st._sortMode = sortMode;
        vscode.setState(st);
        sortMenu.hidden = true;
        markActiveSort();
        renderCards();
      });
      document.addEventListener('click', (e) => {
        if (sortMenu.hidden) return;
        if (!sortMenu.contains(e.target) && e.target !== sortBtn && !sortBtn.contains(e.target)) {
          sortMenu.hidden = true;
        }
      });
    }

    // 自动切号设置 → 发送到后端
    function sendAutoSwitchSettings() {
      postMsg('autoSwitchSettings', {
        enabled: autoSwitchEnabled,
        threshold: autoSwitchThreshold,
        checkSec: autoSwitchCheckSec,
        cooldownSec: autoSwitchCooldownSec,
        scoreMode: autoSwitchScoreMode,
      });
    }
    if (asEnabledEl) {
      asEnabledEl.addEventListener('change', () => {
        autoSwitchEnabled = asEnabledEl.checked;
        const asBody = document.getElementById('asBody');
        if (asBody) asBody.style.display = autoSwitchEnabled ? '' : 'none';
        syncAutoSwitchUI();
        sendAutoSwitchSettings();
      });
    }
    if (asThresholdEl) {
      asThresholdEl.addEventListener('change', () => {
        autoSwitchThreshold = parseInt(asThresholdEl.value) || 10;
        sendAutoSwitchSettings();
      });
    }
    const asCheckIntervalEl = document.getElementById('asCheckInterval');
    if (asCheckIntervalEl) {
      asCheckIntervalEl.addEventListener('change', () => {
        autoSwitchCheckSec = Math.max(10, parseInt(asCheckIntervalEl.value) || 60);
        asCheckIntervalEl.value = autoSwitchCheckSec;
        sendAutoSwitchSettings();
      });
    }
    const asCooldownInputEl = document.getElementById('asCooldown');
    if (asCooldownInputEl) {
      asCooldownInputEl.addEventListener('change', () => {
        autoSwitchCooldownSec = Math.max(5, parseInt(asCooldownInputEl.value) || 30);
        asCooldownInputEl.value = autoSwitchCooldownSec;
        sendAutoSwitchSettings();
      });
    }
    const asScoreModeSelectEl = document.getElementById('asScoreMode');
    if (asScoreModeSelectEl) {
      asScoreModeSelectEl.addEventListener('change', () => {
        autoSwitchScoreMode = asScoreModeSelectEl.value || 'min';
        updateScoreModeHint();
        sendAutoSwitchSettings();
      });
    }

    // Tab 切换（单个/批量/已登录）
    const addTabs = document.querySelectorAll('.add-tab');
    function switchAddTab(mode) {
      addTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === mode));
      const singleArea = document.getElementById('singleLoginArea');
      const batchArea = document.getElementById('batchImportArea');
      const currentArea = document.getElementById('currentAccountArea');
      if (singleArea) singleArea.hidden = mode !== 'single';
      if (batchArea) batchArea.hidden = mode !== 'batch';
      if (currentArea) currentArea.hidden = mode !== 'current';
      setBatchMsg('', false);
    }
    addTabs.forEach(tab => {
      tab.addEventListener('click', () => switchAddTab(tab.getAttribute('data-tab') || 'single'));
    });

    // 批量导入子选项（格式/分隔符）— 委托到 addAccountOverlay
    const addOverlay = document.getElementById('addAccountOverlay');
    if (addOverlay) {
      addOverlay.addEventListener('change', (e) => {
        const target = e.target;
        if (target.name === 'batchFormat') {
          const isJson = target.value === 'json';
          const textArea = document.getElementById('batchTextArea');
          const jsonArea = document.getElementById('batchJsonArea');
          if (textArea) textArea.hidden = isJson;
          if (jsonArea) jsonArea.hidden = !isJson;
          setBatchMsg('', false);
        }
        if (target.name === 'batchDelimRadio') {
          const delimSelect = document.getElementById('batchDelimiter');
          const customInput = document.getElementById('batchCustomDelim');
          if (delimSelect) delimSelect.value = target.value;
          if (customInput) customInput.hidden = target.value !== 'custom';
          const curAuth = document.querySelector('input[name="batchAuthMethod"]:checked');
          updateTextPlaceholder(target.value, curAuth ? curAuth.value : 'auto');
        }
        if (target.name === 'batchAuthMethod') {
          const curDelim = document.querySelector('input[name="batchDelimRadio"]:checked');
          updateTextPlaceholder(curDelim ? curDelim.value : '----', target.value);
        }
      });
    }

    // 设置按钮
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        const existing = document.querySelector('.settings-popup');
        if (existing) {
          existing.remove();
          return;
        }
        const popup = document.createElement('div');
        popup.className = 'settings-popup';
        popup.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:12px;font-weight:600">设置</span>
            <button class="icon-btn" id="closeSettingsBtn" style="width:20px;height:20px">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
              </svg>
            </button>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="font-size:11px;opacity:0.7">后端每 5 分钟自动刷新全部账号额度，额度耗尽的账号自动跳过直到重置。</div>
            <button class="primary" id="forceRefreshBtn" style="margin-top:4px">立即刷新全部</button>
          </div>
        `;
        settingsBtn.parentElement.appendChild(popup);
        const closeBtn = popup.querySelector('#closeSettingsBtn');
        const forceBtn = popup.querySelector('#forceRefreshBtn');
        closeBtn.addEventListener('click', () => popup.remove());
        forceBtn.addEventListener('click', () => {
          refreshAll();
          popup.remove();
        });
      });
    }

    // 多实例面板事件
    const instImportBtn = document.getElementById('instImportBtn');
    if (instImportBtn) instImportBtn.addEventListener('click', openCockpitImportModal);

    const instAddBtn = document.getElementById('instAddBtn');
    if (instAddBtn) instAddBtn.addEventListener('click', openInstCreateModal);

    const instRefreshBtn = document.getElementById('instRefreshBtn');
    if (instRefreshBtn) instRefreshBtn.addEventListener('click', () => postMsg('instanceList', {}));

    const instList = document.getElementById('instList');
    if (instList) instList.addEventListener('click', handleInstAction);

    const instCreateClose = document.getElementById('instCreateClose');
    const instCreateOverlay = document.getElementById('instCreateOverlay');
    if (instCreateClose && instCreateOverlay) {
      instCreateClose.addEventListener('click', () => { instCreateOverlay.hidden = true; });
    }

    const instCreateSubmit = document.getElementById('instCreateSubmit');
    if (instCreateSubmit) instCreateSubmit.addEventListener('click', submitInstCreate);

    const cockpitImportClose = document.getElementById('cockpitImportClose');
    const cockpitImportOverlay = document.getElementById('cockpitImportOverlay');
    if (cockpitImportClose && cockpitImportOverlay) {
      cockpitImportClose.addEventListener('click', () => { cockpitImportOverlay.hidden = true; });
    }

    const cockpitList = document.getElementById('cockpitList');
    if (cockpitList) cockpitList.addEventListener('click', handleCockpitAction);

    // Cockpit 导入填表模态框
    const cockpitFormClose = document.getElementById('cockpitFormClose');
    const cockpitFormOverlay = document.getElementById('cockpitFormOverlay');
    if (cockpitFormClose && cockpitFormOverlay) {
      cockpitFormClose.addEventListener('click', () => { cockpitFormOverlay.hidden = true; });
    }
    const cockpitFormSubmit = document.getElementById('cockpitFormSubmit');
    if (cockpitFormSubmit) cockpitFormSubmit.addEventListener('click', submitCockpitImport);

    // 实例编辑模态框
    const instEditClose = document.getElementById('instEditClose');
    const instEditOverlay = document.getElementById('instEditOverlay');
    if (instEditClose && instEditOverlay) {
      instEditClose.addEventListener('click', () => { instEditOverlay.hidden = true; });
    }
    const instEditSubmit = document.getElementById('instEditSubmit');
    if (instEditSubmit) instEditSubmit.addEventListener('click', submitInstEdit);

    // 初始加载实例列表
    postMsg('instanceList', {});

    // 实例状态自动轮询（8s）—— 检测实例启停变化
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        postMsg('instanceList', {});
      }
    }, 8000);

    restoreState();
    startAutoRefresh();
    checkBatchResume();

    // 初始加载后延迟拉配额
    setTimeout(() => {
      if (accounts.length > 0) refreshAll();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
