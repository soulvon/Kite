/* eslint-disable */
(function () {
  // @ts-ignore
  // vscode is already declared in inline script

  let accountList = [];
  let results = new Map(); // email → { ok, reason, httpStatus, elapsed }
  let checking = false;
  let totalCheck = 0;
  let completedCheck = 0;
  let startTime = 0;
  let privacyMode = false;

  // ── 历史轮次 ──
  var historyRounds = []; // Array<{ id, modelLabel, modelUid, ts, okCount, totalCount, results: { email: {ok,reason,elapsed} } }>
  var nextHistoryId = 1;
  var MAX_HISTORY = 10;
  var currentRoundModel = { label: '', uid: '' }; // 本轮测活的模型信息

  let searchQuery = '';
  let activeTag = ''; // '' = 全部
  let activeStatus = 'all';

  // ── Elements ──
  const startBtn = document.getElementById('hcStartBtn');
  const stopBtn = document.getElementById('hcStopBtn');
  const pauseBtn = document.getElementById('hcPauseBtn');
  const retestBtn = document.getElementById('hcRetestBtn');
  var paused = false;
  const progressWrap = document.getElementById('hcProgressWrap');
  const progressFill = document.getElementById('hcProgressFill');
  const progressText = document.getElementById('hcProgressText');
  const tableBody = document.getElementById('hcTableBody');
  const emptyEl = document.getElementById('hcEmpty');
  const privacyBtn = document.getElementById('hcPrivacy');
  const modelSelect = document.getElementById('hcModelSelect');
  const concurrencySelect = document.getElementById('hcConcurrencySelect');
  const probeMessageInput = document.getElementById('hcProbeMessage');
  const randomProbeBtn = document.getElementById('hcRandomProbe');
  const promptPoolBtn = document.getElementById('hcPromptPoolBtn');
  const promptModal = document.getElementById('hcPromptModal');
  const promptClose = document.getElementById('hcPromptClose');
  const promptSave = document.getElementById('hcPromptSave');
  const promptPoolInput = document.getElementById('hcPromptPool');
  const probeDelayInput = document.getElementById('hcProbeDelay');
  const searchInput = document.getElementById('hcSearchInput');
  const tagChipsEl = document.getElementById('hcTagChips');
  const statusTabsEl = document.getElementById('hcStatusTabs');
  const detailTip = document.getElementById('hcDetailTip');

  // ── Tag edit modal elements ──
  const tagEditModal = document.getElementById('hcTagEditModal');
  const tagEditTitle = document.getElementById('hcTagEditTitle');
  const tagEditSelected = document.getElementById('hcTagEditSelected');
  const tagEditInput = document.getElementById('hcTagEditInput');
  const tagEditAddBtn = document.getElementById('hcTagEditAddBtn');
  const tagEditExisting = document.getElementById('hcTagEditExisting');
  const tagEditSave = document.getElementById('hcTagEditSave');
  const tagEditCancel = document.getElementById('hcTagEditCancel');
  const tagEditClose = document.getElementById('hcTagEditClose');
  var tagEditEmail = '';
  var tagEditTags = [];

  // ── Stats elements ──
  const statTotal = document.getElementById('hcStatTotal');
  const statOk = document.getElementById('hcStatOk');
  const statFail = document.getElementById('hcStatFail');
  const statLimit = document.getElementById('hcStatLimit');
  const statTime = document.getElementById('hcStatTime');

  const DEFAULT_PROMPTS = [
    '你好，简单回复一下即可。',
    '请用一句话回复“收到”。',
    '帮我确认一下你现在可以正常回复吗？',
    '请简单回答：可以。',
    '测试一下当前会话是否可用，请简短回复。',
  ];

  let randomProbe = true;
  let promptPool = loadPromptPool();

  // ── 标签颜色系统 ──
  var TAG_PALETTE = [
    '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#14b8a6', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  ];
  var tagColorsMap = {};
  function getTagColor(tag) {
    if (!tag) return TAG_PALETTE[0];
    if (tagColorsMap[tag]) return tagColorsMap[tag];
    var hash = 0;
    for (var i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
    return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
  }

  if (promptPoolInput) promptPoolInput.value = promptPool.join('\n');

  function loadPromptPool() {
    try {
      var raw = localStorage.getItem('windsurfPool.health.prompts');
      var parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        var cleaned = parsed.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
        if (cleaned.length) return cleaned.slice(0, 50);
      }
    } catch (_) {}
    return DEFAULT_PROMPTS.slice();
  }

  function savePromptPool() {
    try { localStorage.setItem('windsurfPool.health.prompts', JSON.stringify(promptPool)); } catch (_) {}
  }

  function getPromptPoolFromInput() {
    var text = promptPoolInput ? promptPoolInput.value : '';
    var list = String(text || '')
      .split(/\r?\n/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean)
      .map(function (x) { return x.slice(0, 200); });
    return Array.from(new Set(list)).slice(0, 50);
  }

  function updateRandomButton() {
    if (!randomProbeBtn) return;
    randomProbeBtn.classList.toggle('is-active', randomProbe);
    randomProbeBtn.textContent = randomProbe ? '随机' : '单句';
    randomProbeBtn.title = randomProbe ? '已开启：每个账号随机使用提示词池' : '已关闭：使用输入框里的单句提示词';
  }

  updateRandomButton();

  if (randomProbeBtn) {
    randomProbeBtn.addEventListener('click', function () {
      randomProbe = !randomProbe;
      updateRandomButton();
      showToast(randomProbe ? '已开启随机提示词' : '已切换为单句提示词');
    });
  }

  if (promptPoolBtn && promptModal) {
    promptPoolBtn.addEventListener('click', function () {
      if (promptPoolInput) promptPoolInput.value = promptPool.join('\n');
      promptModal.hidden = false;
    });
  }
  if (promptClose && promptModal) {
    promptClose.addEventListener('click', function () { promptModal.hidden = true; });
  }
  if (promptSave && promptModal) {
    promptSave.addEventListener('click', function () {
      var list = getPromptPoolFromInput();
      if (!list.length) {
        showToast('提示词池不能为空');
        return;
      }
      promptPool = list;
      savePromptPool();
      promptModal.hidden = true;
      showToast('随机提示词已保存');
    });
  }
  if (promptModal) {
    promptModal.addEventListener('click', function (e) {
      if (e.target === promptModal) promptModal.hidden = true;
    });
  }

  // ── Privacy ──
  privacyBtn.addEventListener('click', function () {
    privacyMode = !privacyMode;
    privacyBtn.classList.toggle('hc-btn-active', privacyMode);
    renderTable();
    showToast(privacyMode ? '隐私模式已开启' : '隐私模式已关闭');
  });

  function maskEmail(em) {
    if (!privacyMode || !em) return em;
    var at = em.indexOf('@');
    if (at <= 0) return '***';
    return em[0] + '***' + em.slice(at);
  }

  // ── Search & Tag Filter ──
  searchInput.addEventListener('input', function () {
    searchQuery = this.value.trim().toLowerCase();
    renderTable();
  });

  if (statusTabsEl) {
    statusTabsEl.querySelectorAll('.hc-status-tab').forEach(function (el) {
      el.addEventListener('click', function () {
        activeStatus = this.dataset.status || 'all';
        statusTabsEl.querySelectorAll('.hc-status-tab').forEach(function (x) { x.classList.remove('active'); });
        this.classList.add('active');
        renderTable();
        updateRetestBtn();
      });
    });
  }

  function updateRetestBtn() {
    if (!retestBtn) return;
    // 只有当已有结果且选了非“全部”的筛选时才显示
    retestBtn.hidden = !(results.size > 0 && activeStatus !== 'all');
  }

  function buildTagChips() {
    var tags = new Set();
    accountList.forEach(function (a) {
      if (a.disabled) return;
      var at = (a.tags && a.tags.length > 0) ? a.tags : (a.tag ? [a.tag] : []);
      at.forEach(function (t) { tags.add(t); });
    });
    var html = '<span class="hc-tag-chip' + (!activeTag ? ' active' : '') + '" data-tag="">全部</span>';
    tags.forEach(function (t) {
      var tc = getTagColor(t);
      var isActive = activeTag === t;
      var chipStyle = isActive
        ? 'background:' + tc + ';color:#fff;border-color:' + tc
        : 'background:' + tc + '20;color:' + tc + ';border-color:' + tc + '60';
      html += '<span class="hc-tag-chip' + (isActive ? ' active' : '') + '" data-tag="' + escHtml(t) + '" style="' + chipStyle + '">' + escHtml(t) + '</span>';
    });
    tagChipsEl.innerHTML = html;
    tagChipsEl.querySelectorAll('.hc-tag-chip').forEach(function (el) {
      el.addEventListener('click', function () {
        activeTag = this.dataset.tag || '';
        buildTagChips();
        renderTable();
      });
    });
  }

  function filterAccounts(list, options) {
    var ignoreResultStatus = options && options.ignoreResultStatus;
    return list.filter(function (a) {
      if (a.disabled) return false;
      if (activeTag) {
        var at = (a.tags && a.tags.length > 0) ? a.tags : (a.tag ? [a.tag] : []);
        if (at.indexOf(activeTag) === -1) return false;
      }
      if (searchQuery && a.email.toLowerCase().indexOf(searchQuery) === -1) return false;
      if (!ignoreResultStatus && activeStatus !== 'all') {
        var r = results.get(a.email);
        var bucket = getResultBucket(r);
        if (bucket !== activeStatus) return false;
      }
      return true;
    });
  }

  // ── Start / Stop ──
  startBtn.addEventListener('click', function () {
    if (checking) return;
    // 测活目标只受搜索和标签限制；结果状态过滤只用于查看结果。
    // 否则选择“异常/无权限/待检测”等结果筛选时，开始检测可能被过滤成 0 个目标。
    var targetAccounts = filterAccounts(accountList, { ignoreResultStatus: true });
    // "跳过已测"：过滤掉已有结果的账号（适合重启后继续）
    var skipTestedCb = document.getElementById('hcSkipTested');
    var skipTested = skipTestedCb && skipTestedCb.checked;
    if (skipTested) {
      targetAccounts = targetAccounts.filter(function (a) { return !results.has(a.email); });
    }
    if (!targetAccounts.length) {
      showToast(skipTested ? '所有账号均已测试过，取消勾选"跳过已测"可重新检测' : '当前筛选没有可检测账号');
      return;
    }
    checking = true;
    if (!skipTested) results.clear();
    completedCheck = 0;
    startTime = Date.now();
    startBtn.disabled = true;
    startBtn.innerHTML = '<svg class="hc-spinning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 检测中...';
    progressWrap.hidden = false;
    progressFill.style.width = '0%';
    progressText.textContent = '准备中...';
    emptyEl.hidden = true;
    renderTable();
    updateStats();
    var selUid = modelSelect ? modelSelect.value : '';
    var selLabel = (modelSelect && modelSelect.value) ? modelSelect.options[modelSelect.selectedIndex].text : '';
    currentRoundModel.label = selLabel || currentModelLabel();
    currentRoundModel.uid = selUid || '';
    var concurrency = concurrencySelect ? parseInt(concurrencySelect.value, 10) || 1 : 1;
    var probeMessage = probeMessageInput ? (probeMessageInput.value || '你好').trim() : '你好';
    var delaySec = probeDelayInput ? Math.max(0, Math.min(600, parseInt(probeDelayInput.value, 10) || 0)) : 0;
    if (randomProbe && promptPoolInput) {
      var freshPool = getPromptPoolFromInput();
      if (freshPool.length) {
        promptPool = freshPool;
        savePromptPool();
      }
    }
    vscode.postMessage({
      type: 'startCheck',
      modelUid: selUid,
      modelLabel: selLabel,
      concurrency: concurrency,
      probeMessage: probeMessage || '你好',
      probeMessages: randomProbe ? promptPool : [],
      randomProbe: randomProbe,
      probeDelaySec: delaySec,
      emails: targetAccounts.map(function (a) { return a.email; }),
    });
  });

  stopBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'stopCheck' });
    paused = false;
    finishCheck();
    showToast('已停止测活');
  });

  // ── 重置机器码 ──
  var resetMachineIdBtn = document.getElementById('hcResetMachineId');
  if (resetMachineIdBtn) {
    resetMachineIdBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'resetMachineId' });
    });
  }

  // ── 暂停/继续 ──
  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      if (!checking) return;
      if (!paused) {
        paused = true;
        vscode.postMessage({ type: 'pauseCheck' });
        pauseBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>继续';
        pauseBtn.classList.add('hc-btn-resume');
        showToast('已暂停测活');
      } else {
        paused = false;
        vscode.postMessage({ type: 'resumeCheck' });
        pauseBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>暂停';
        pauseBtn.classList.remove('hc-btn-resume');
        showToast('继续测活');
      }
    });
  }

  // ── 二次测试（重测此类） ──
  if (retestBtn) {
    retestBtn.addEventListener('click', function () {
      if (checking) { showToast('请先停止当前测活'); return; }
      var targetEmails = [];
      accountList.forEach(function (a) {
        if (a.disabled) return;
        var r = results.get(a.email);
        var bucket = getResultBucket(r);
        if (activeStatus === 'all' || bucket === activeStatus) {
          targetEmails.push(a.email);
        }
      });
      if (!targetEmails.length) { showToast('当前筛选没有可重测账号'); return; }
      // 启动重测
      checking = true;
      results.clear();
      completedCheck = 0;
      startTime = Date.now();
      startBtn.disabled = true;
      startBtn.innerHTML = '<svg class="hc-spinning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 检测中...';
      progressWrap.hidden = false;
      progressFill.style.width = '0%';
      progressText.textContent = '准备中...';
      emptyEl.hidden = true;
      renderTable();
      updateStats();
      var selUid = modelSelect ? modelSelect.value : '';
      var selLabel = (modelSelect && modelSelect.value) ? modelSelect.options[modelSelect.selectedIndex].text : '';
      currentRoundModel.label = selLabel || currentModelLabel();
      currentRoundModel.uid = selUid || '';
      var concurrency = concurrencySelect ? parseInt(concurrencySelect.value, 10) || 1 : 1;
      var probeMessage = probeMessageInput ? (probeMessageInput.value || '你好').trim() : '你好';
      var delaySec = probeDelayInput ? Math.max(0, Math.min(600, parseInt(probeDelayInput.value, 10) || 0)) : 0;
      vscode.postMessage({
        type: 'retestByStatus',
        modelUid: selUid,
        modelLabel: selLabel,
        concurrency: concurrency,
        probeMessage: probeMessage || '你好',
        probeMessages: randomProbe ? promptPool : [],
        randomProbe: randomProbe,
        probeDelaySec: delaySec,
        emails: targetEmails,
      });
    });
  }

  function finishCheck() {
    checking = false;
    paused = false;
    startBtn.disabled = false;
    startBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> 一键测活';
    progressWrap.hidden = true;
    if (pauseBtn) { pauseBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>暂停'; pauseBtn.classList.remove('hc-btn-resume'); }
    updateStats();
    updateRetestBtn();
    saveHistoryRound();
  }

  // ── History: save / render / manage ──
  function saveHistoryRound() {
    if (results.size === 0) return;
    var snapshot = {};
    var ok = 0, total = 0;
    results.forEach(function (r, email) {
      snapshot[email] = { ok: r.ok, reason: r.reason || '', elapsed: r.elapsed || 0 };
      total++;
      if (r.ok) ok++;
    });
    historyRounds.push({
      id: nextHistoryId++,
      modelLabel: currentRoundModel.label || currentModelLabel(),
      modelUid: currentRoundModel.uid || (modelSelect ? modelSelect.value : ''),
      ts: Date.now(),
      okCount: ok,
      totalCount: total,
      results: snapshot,
    });
    if (historyRounds.length > MAX_HISTORY) historyRounds.shift();
    renderHistoryBar();
  }

  function deleteHistoryRound(id) {
    historyRounds = historyRounds.filter(function (r) { return r.id !== id; });
    renderHistoryBar();
    renderTable();
  }

  function clearHistory() {
    historyRounds = [];
    renderHistoryBar();
    renderTable();
  }

  function shortModel(label) {
    return (label || '')
      .replace(/（默认测活）/, '').replace(/\(默认测活\)/, '')
      .replace(/（不发消息）/, '').replace(/\(不发消息\)/, '')
      .trim();
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function renderHistoryBar() {
    var bar = document.getElementById('hcHistoryBar');
    if (!bar) return;
    if (historyRounds.length === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    var html = '<span class="hc-hist-label">📋 历史轮次</span>';
    historyRounds.forEach(function (round) {
      var d = new Date(round.ts);
      var timeStr = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      html += '<span class="hc-hist-chip" title="' + escHtml(round.modelLabel) + ' · ' + timeStr + '\n正常 ' + round.okCount + '/' + round.totalCount + '"'
        + ' data-rid="' + round.id + '">'
        + '<span class="hc-hist-model">' + escHtml(shortModel(round.modelLabel)) + '</span>'
        + '<span class="hc-hist-stat">' + round.okCount + '/' + round.totalCount + '</span>'
        + '<span class="hc-hist-time">' + timeStr + '</span>'
        + '<span class="hc-hist-del" data-rid="' + round.id + '" title="删除此轮">×</span>'
        + '</span>';
    });
    html += '<span class="hc-hist-clear" title="清空所有历史">清空</span>';
    bar.innerHTML = html;
    bar.querySelectorAll('.hc-hist-del').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteHistoryRound(parseInt(this.dataset.rid, 10));
      });
    });
    var clearBtn = bar.querySelector('.hc-hist-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearHistory);
  }

  function buildHistoryBadges(email) {
    if (historyRounds.length === 0) return '';
    var out = '';
    historyRounds.forEach(function (round) {
      var hr = round.results[email];
      if (!hr) return;
      var cls = hr.ok ? 'hc-hb-ok' : (getResultBucket(hr) === 'limit' ? 'hc-hb-warn' : 'hc-hb-fail');
      var tip = shortModel(round.modelLabel) + ': ' + (hr.ok ? '可用' : (hr.reason || '异常'));
      out += '<span class="hc-hb ' + cls + '" title="' + escHtml(tip) + '">'
        + escHtml(shortModel(round.modelLabel))
        + (hr.ok ? ' ✓' : ' ✗')
        + '</span>';
    });
    return out;
  }

  // ── Toast ──
  function showToast(msg, dur) {
    var el = document.getElementById('hcToast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('hc-toast-show');
    setTimeout(function () { el.classList.remove('hc-toast-show'); el.hidden = true; }, dur || 2000);
  }

  // ── Stats ──
  function updateStats() {
    var ok = 0, fail = 0, limit = 0;
    results.forEach(function (r) {
      if (r.ok) ok++;
      else if (getResultBucket(r) === 'limit') limit++;
      else fail++;
    });
    statTotal.textContent = accountList.filter(function (a) { return !a.disabled; }).length;
    statOk.textContent = ok;
    statFail.textContent = fail;
    statLimit.textContent = limit;

    if (startTime > 0 && results.size > 0) {
      var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      statTime.textContent = elapsed + 's';
    }
  }

  function getResultBucket(r) {
    if (!r) return 'pending';
    if (r.ok) return 'ok';
    var reason = r.reason || '';
    if (/\u5168\u5c40\u9650\u5236|\u957f\u671f\u4e0d\u53ef\u7528|\u9650\u6d41|\u9650\u901f|rate limit|quota.*exhaust|usage.*quota|daily.*quota|\u5269\u4f59\s*0|\u6d88\u606f\u5df2\u7528\u5c3d|\u6682\u4e0d\u53ef\u7528/i.test(reason)) return 'limit';
    if (/无权限|不支持|NO_ACCESS/i.test(reason)) return 'noaccess';
    if (/Key 已失效|401|invalid/i.test(reason)) return 'invalid';
    if (/封禁|403|到期|宽限期/i.test(reason)) return 'expired';
    return 'fail';
  }

  function currentModelLabel() {
    if (!modelSelect || !modelSelect.value) return '快速检测';
    return modelSelect.options[modelSelect.selectedIndex].text || '模型';
  }

  function parseReason(r) {
    var raw = String(r?.reason || '');
    var model = currentModelLabel();
    var text = raw;
    var colon = raw.indexOf(': ');
    if (colon > 0 && colon < 50) {
      model = raw.slice(0, colon);
      text = raw.slice(colon + 2);
    }

    var plan = '';
    var planMatch = text.match(/\[([^\]]+)\]/);
    if (planMatch) plan = planMatch[1];

    var daily = null, weekly = null;
    var quotaMatch = text.match(/日\s*(\d+(?:\.\d+)?)%\s*周\s*(\d+(?:\.\d+)?)%/);
    if (quotaMatch) {
      daily = quotaMatch[1];
      weekly = quotaMatch[2];
    }

    var bucket = getResultBucket(r);
    var label = '等待中';
    if (r) {
      if (r.ok) label = '可用';
      else if (bucket === 'limit') {
        if (/官方全局限制|长期不可用/i.test(text)) label = '官方全局限制';
        else if (/官方临时限流|暂不可用/i.test(text)) label = '官方临时限流';
        else label = /overall/i.test(text) ? 'overall 限速' : '消息限速';
      }
      else if (bucket === 'noaccess') label = '无模型权限';
      else if (bucket === 'invalid') label = 'Key 失效';
      else if (bucket === 'expired') label = /到期/.test(text) ? '已到期' : '账号封禁';
      else if (/无权限|不支持/.test(text)) label = '无模型权限';
      else if (/Key 已失效|401/.test(text)) label = 'Key 失效';
      else if (/封禁|403/.test(text)) label = '账号封禁';
      else if (/到期/.test(text)) label = '已到期';
      else if (/请求失败|异常|失败/.test(text)) label = '检测失败';
      else label = '异常';
    }

    var reply = '';
    var replyMatch = raw.match(/回复:\s*([\s\S]+)$/);
    if (replyMatch) reply = replyMatch[1].trim();

    return { raw, model, label, plan, daily, weekly, bucket, reply };
  }

  function detailTipText(acc, info, elapsed) {
    var lines = [];
    if (acc && acc.email) lines.push('账号: ' + acc.email);
    if (info && info.model) lines.push('模型: ' + info.model);
    if (info && info.label) lines.push('结果: ' + info.label);
    if (info && info.plan) lines.push('套餐: ' + info.plan);
    if (info && info.daily !== null && info.weekly !== null) lines.push('配额: 日 ' + info.daily + '% / 周 ' + info.weekly + '%');
    if (typeof elapsed === 'number') lines.push('耗时: ' + (elapsed / 1000).toFixed(1) + 's');
    if (info && info.reply) lines.push('回复: ' + info.reply);
    if (info && info.raw) lines.push('详情: ' + info.raw);
    return lines.join('\n');
  }

  function planHtml(info) {
    if (info.plan) return '<span class="hc-plan-pill">' + escHtml(info.plan) + '</span>';
    return '<span class="hc-muted">—</span>';
  }

  function quotaHtml(info) {
    var out = '';
    if (info.daily !== null && info.weekly !== null) {
      out += '<span class="hc-quota-pill ' + quotaClass(info.daily) + '">日 ' + escHtml(info.daily) + '%</span>';
      out += '<span class="hc-quota-pill ' + quotaClass(info.weekly) + '">周 ' + escHtml(info.weekly) + '%</span>';
    } else {
      out = '<span class="hc-muted">—</span>';
    }
    return out;
  }

  function quotaClass(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '';
    if (n <= 10) return 'danger';
    if (n <= 30) return 'warn';
    return 'ok';
  }

  // ── Render Table ──
  function renderTable() {
    if (!tableBody) return;
    var active = filterAccounts(accountList);

    if (active.length === 0 && results.size === 0) {
      tableBody.innerHTML = '';
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    // Sort: actionable failures first, then rate limited, then ok, then pending.
    var sorted = active.slice().sort(function (a, b) {
      var ra = results.get(a.email);
      var rb = results.get(b.email);
      var order = { noaccess: 0, invalid: 0, expired: 0, fail: 1, limit: 2, ok: 3, pending: 4 };
      var sa = order[getResultBucket(ra)] ?? 4;
      var sb = order[getResultBucket(rb)] ?? 4;
      return sa - sb;
    });

    var html = '';
    sorted.forEach(function (acc) {
      var r = results.get(acc.email);
      var statusHtml, resultHtml, elapsedHtml, modelHtml, planCellHtml, quotaCellHtml;

      if (r) {
        var info = parseReason(r);
        var tip = detailTipText(acc, info, r.elapsed);
        if (r.ok) {
          statusHtml = '<span class="hc-status-icon hc-status-ok">✓</span>';
          resultHtml = '<span class="hc-result-pill hc-result-ok hc-detail-tip-target" data-tip="' + escHtml(tip) + '" title="' + escHtml(info.raw) + '">' + escHtml(info.label) + '</span>';
        } else if (info.bucket === 'limit') {
          statusHtml = '<span class="hc-status-icon hc-status-warn">⚠</span>';
          resultHtml = '<span class="hc-result-pill hc-result-warn hc-detail-tip-target" data-tip="' + escHtml(tip) + '" title="' + escHtml(info.raw) + '">' + escHtml(info.label) + '</span>';
        } else {
          statusHtml = '<span class="hc-status-icon hc-status-fail">✗</span>';
          resultHtml = '<span class="hc-result-pill hc-result-fail hc-detail-tip-target" data-tip="' + escHtml(tip) + '" title="' + escHtml(info.raw) + '">' + escHtml(info.label) + '</span>';
        }
        modelHtml = '<span class="hc-model-cell hc-detail-tip-target" data-tip="' + escHtml(tip) + '" title="' + escHtml(info.model) + '">' + escHtml(info.model) + '</span>';
        planCellHtml = planHtml(info);
        quotaCellHtml = quotaHtml(info);
        elapsedHtml = '<span class="hc-elapsed">' + (r.elapsed / 1000).toFixed(1) + 's</span>';
      } else if (r === undefined && checking && acc._running) {
        statusHtml = acc._waiting
          ? '<span class="hc-status-icon hc-status-wait">…</span>'
          : '<span class="hc-status-icon hc-status-running"><svg class="hc-spinning" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>';
        modelHtml = '<span class="hc-model-cell">' + escHtml(currentModelLabel()) + '</span>';
        resultHtml = '<span class="hc-reason hc-reason-dim">' + (acc._waiting ? ('等待 ' + (acc._waitSec || '') + 's') : '检测中...') + '</span>';
        planCellHtml = '<span class="hc-muted">—</span>';
        quotaCellHtml = '<span class="hc-muted">—</span>';
        elapsedHtml = '<span class="hc-elapsed">—</span>';
      } else {
        statusHtml = '<span class="hc-status-icon hc-status-wait">·</span>';
        modelHtml = '<span class="hc-model-cell">' + escHtml(currentModelLabel()) + '</span>';
        resultHtml = '<span class="hc-reason hc-reason-dim">等待中</span>';
        planCellHtml = '<span class="hc-muted">—</span>';
        quotaCellHtml = '<span class="hc-muted">—</span>';
        elapsedHtml = '<span class="hc-elapsed">—</span>';
      }

      var accTags = (acc.tags && acc.tags.length > 0) ? acc.tags : (acc.tag ? [acc.tag] : []);
      var tagHtml = accTags.length > 0
        ? '<span class="hc-tag-cell" title="' + escHtml(accTags.join(', ')) + '">' + accTags.map(function (t) { var tc = getTagColor(t); return '<span class="hc-tag" style="background:' + tc + '20;color:' + tc + ';border-color:' + tc + '60">' + escHtml(t) + '</span>'; }).join('') + '</span>'
        : '';

      var hBadges = buildHistoryBadges(acc.email);
      var hBadgeHtml = hBadges ? '<div class="hc-hb-row">' + hBadges + '</div>' : '';

      // ── 操作列 ──
      var opsHtml = '<div class="hc-ops-cell">'
        + '<button class="hc-ops-btn hc-ops-switch" data-email="' + escHtml(acc.email) + '" title="切换到此账号">切号</button>'
        + '<button class="hc-ops-btn hc-ops-tag" data-email="' + escHtml(acc.email) + '" title="编辑标签">标签</button>'
        + '</div>';

      html += '<tr>'
        + '<td>' + statusHtml + '</td>'
        + '<td><span class="hc-email' + (r ? ' hc-detail-tip-target' : '') + '" data-tip="' + (r ? escHtml(detailTipText(acc, parseReason(r), r.elapsed)) : '') + '" title="' + escHtml(acc.email) + '">' + escHtml(maskEmail(acc.email)) + '</span></td>'
        + '<td>' + tagHtml + '</td>'
        + '<td>' + modelHtml + hBadgeHtml + '</td>'
        + '<td>' + resultHtml + '</td>'
        + '<td><div class="hc-plan-cell">' + planCellHtml + '</div></td>'
        + '<td><div class="hc-quota-cell">' + quotaCellHtml + '</div></td>'
        + '<td>' + opsHtml + '</td>'
        + '</tr>';
    });

    tableBody.innerHTML = html;

    // ── Bind ops buttons ──
    tableBody.querySelectorAll('.hc-ops-switch').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var email = this.dataset.email;
        if (!email) return;
        this.disabled = true;
        this.textContent = '切换中...';
        vscode.postMessage({ type: 'switchAccount', email: email });
      });
    });
    tableBody.querySelectorAll('.hc-ops-tag').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var email = this.dataset.email;
        if (!email) return;
        openTagEditModal(email);
      });
    });
  }

  function showDetailTip(text, x, y) {
    if (!detailTip || !text) return;
    detailTip.textContent = text;
    detailTip.hidden = false;
    var pad = 14;
    var rect = detailTip.getBoundingClientRect();
    var left = Math.min(window.innerWidth - rect.width - pad, x + 14);
    var top = Math.min(window.innerHeight - rect.height - pad, y + 14);
    detailTip.style.left = Math.max(pad, left) + 'px';
    detailTip.style.top = Math.max(pad, top) + 'px';
  }

  function hideDetailTip() {
    if (!detailTip) return;
    detailTip.hidden = true;
  }

  document.addEventListener('mousemove', function (ev) {
    var target = ev.target && ev.target.closest ? ev.target.closest('.hc-detail-tip-target') : null;
    if (!target) {
      hideDetailTip();
      return;
    }
    showDetailTip(target.getAttribute('data-tip') || target.getAttribute('title') || '', ev.clientX, ev.clientY);
  });
  document.addEventListener('mouseleave', hideDetailTip);

  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Messages from extension ──
  window.addEventListener('message', function (event) {
    var msg = event.data;
    switch (msg.type) {
      case 'accounts': {
        accountList = msg.list || [];
        // Restore cached results
        accountList.forEach(function (a) {
          if (a.cached && !results.has(a.email)) {
            results.set(a.email, {
              ok: a.cached.ok,
              reason: a.cached.reason,
              httpStatus: a.cached.status,
              elapsed: 0,
              ts: a.cached.ts,
            });
          }
        });
        buildTagChips();
        renderTable();
        updateStats();
        break;
      }

      case 'checkStart': {
        totalCheck = msg.total || 0;
        completedCheck = 0;
        // Clear running flags
        accountList.forEach(function (a) { a._running = false; a._waiting = false; a._waitSec = 0; });
        renderTable();
        break;
      }

      case 'checkProgress': {
        // Mark this account as running. Multiple accounts can be active with limited concurrency.
        var runningAcc = accountList.find(function (a) { return a.email === msg.email; });
        if (runningAcc) {
          runningAcc._running = true;
          runningAcc._waiting = msg.status === 'waiting';
          runningAcc._waitSec = msg.waitSec || 0;
        }
        var pct = totalCheck > 0 ? (completedCheck / totalCheck * 100) : 0;
        progressFill.style.width = pct + '%';
        progressText.textContent = msg.status === 'waiting'
          ? '等待间隔 ' + (msg.waitSec || 0) + 's · ' + completedCheck + '/' + totalCheck + '  ' + maskEmail(msg.email)
          : '检测中 ' + completedCheck + '/' + totalCheck + '  ' + maskEmail(msg.email);
        renderTable();
        break;
      }

      case 'checkResult': {
        results.set(msg.email, {
          ok: msg.ok,
          reason: msg.reason,
          httpStatus: msg.httpStatus,
          elapsed: msg.elapsed || 0,
        });
        // Clear running flag
        var acc = accountList.find(function (a) { return a.email === msg.email; });
        if (acc) { acc._running = false; acc._waiting = false; acc._waitSec = 0; }

        completedCheck = msg.completed || (completedCheck + 1);
        var pct2 = totalCheck > 0 ? (completedCheck / totalCheck * 100) : 0;
        progressFill.style.width = pct2 + '%';
        progressText.textContent = '已完成 ' + completedCheck + '/' + totalCheck;

        renderTable();
        updateStats();
        break;
      }

      case 'checkDone': {
        finishCheck();
        if (msg.empty) {
          showToast('没有可检测账号，请检查搜索/标签筛选', 4000);
          break;
        }
        var ok = 0, fail = 0;
        results.forEach(function (r) { if (r.ok) ok++; else fail++; });
        showToast('测活完成：' + ok + ' 正常，' + fail + ' 异常', 3000);
        break;
      }

      case 'modelList': {
        if (modelSelect && msg.models) {
          var selected = modelSelect.value;
          // 保留快速检测 + SWE-1.5 + 默认模型三个固定选项
          while (modelSelect.options.length > 3) modelSelect.remove(3);
          var seen = new Set(Array.prototype.map.call(modelSelect.options, function (o) { return o.value; }));
          msg.models.forEach(function (m) {
            if (!m || !m.uid || seen.has(m.uid)) return;
            seen.add(m.uid);
            var opt = document.createElement('option');
            opt.value = m.uid;
            opt.textContent = m.label;
            modelSelect.appendChild(opt);
          });
          if (selected) modelSelect.value = selected;
        }
        break;
      }

      case 'tagColors': {
        if (msg.colors && typeof msg.colors === 'object') {
          tagColorsMap = msg.colors;
          buildTagChips();
          renderTable();
        }
        break;
      }

      case 'checkPaused': {
        paused = true;
        if (pauseBtn) { pauseBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>继续'; pauseBtn.classList.add('hc-btn-resume'); }
        progressText.textContent = '已暂停 · ' + completedCheck + '/' + totalCheck;
        break;
      }

      case 'checkResumed': {
        paused = false;
        if (pauseBtn) { pauseBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>暂停'; pauseBtn.classList.remove('hc-btn-resume'); }
        break;
      }

      case 'switchTab': break;

      case 'switchResult': {
        if (msg.ok) {
          showToast('已切换到 ' + maskEmail(msg.email), 2000);
        } else {
          showToast('切换失败: ' + (msg.reason || '未知原因'), 3000);
        }
        renderTable();
        break;
      }

      case 'tagsUpdated': {
        // 更新本地账号列表中的标签
        var tagAcc = accountList.find(function (a) { return a.email === msg.email; });
        if (tagAcc) {
          tagAcc.tags = msg.tags || [];
          tagAcc.tag = (msg.tags && msg.tags[0]) || '';
        }
        buildTagChips();
        renderTable();
        showToast('标签已更新', 1500);
        break;
      }

      case 'diskResults': {
        // 多实例共享：其他实例的测活结果同步过来
        if (Array.isArray(msg.list)) {
          msg.list.forEach(function (item) {
            if (!item.email) return;
            var existing = results.get(item.email);
            // 仅当磁盘记录更新时覆盖
            if (!existing || (item.ts && item.ts > (existing.ts || 0))) {
              results.set(item.email, {
                ok: item.ok,
                reason: item.reason,
                httpStatus: item.status,
                elapsed: 0,
                ts: item.ts,
              });
            }
          });
          renderTable();
          updateStats();
        }
        break;
      }
    }
  });

  // ── Tag Edit Modal Logic ──
  function openTagEditModal(email) {
    tagEditEmail = email;
    var acc = accountList.find(function (a) { return a.email === email; });
    tagEditTags = acc ? (acc.tags && acc.tags.length > 0 ? acc.tags.slice() : (acc.tag ? [acc.tag] : [])) : [];
    if (tagEditTitle) tagEditTitle.textContent = '编辑标签 - ' + maskEmail(email);
    renderTagEditSelected();
    renderTagEditExisting();
    if (tagEditInput) tagEditInput.value = '';
    if (tagEditModal) tagEditModal.hidden = false;
    if (tagEditInput) tagEditInput.focus();
  }

  function renderTagEditSelected() {
    if (!tagEditSelected) return;
    if (tagEditTags.length === 0) {
      tagEditSelected.innerHTML = '<span style="color:var(--hc-fg-dim);font-size:11px">无标签</span>';
      return;
    }
    var html = '';
    tagEditTags.forEach(function (t) {
      var tc = getTagColor(t);
      html += '<span class="hc-tag-edit-chip" data-tag="' + escHtml(t) + '" style="background:' + tc + '20;color:' + tc + ';border-color:' + tc + '60" title="点击移除">' + escHtml(t) + ' ×</span>';
    });
    tagEditSelected.innerHTML = html;
    tagEditSelected.querySelectorAll('.hc-tag-edit-chip').forEach(function (el) {
      el.addEventListener('click', function () {
        var tag = this.dataset.tag;
        tagEditTags = tagEditTags.filter(function (t) { return t !== tag; });
        renderTagEditSelected();
        renderTagEditExisting();
      });
    });
  }

  function renderTagEditExisting() {
    if (!tagEditExisting) return;
    var allTags = new Set();
    accountList.forEach(function (a) {
      var at = (a.tags && a.tags.length > 0) ? a.tags : (a.tag ? [a.tag] : []);
      at.forEach(function (t) { allTags.add(t); });
    });
    if (allTags.size === 0) {
      tagEditExisting.innerHTML = '<span style="color:var(--hc-fg-dim);font-size:11px">无已有标签</span>';
      return;
    }
    var html = '';
    allTags.forEach(function (t) {
      var active = tagEditTags.indexOf(t) >= 0;
      var tc = getTagColor(t);
      html += '<span class="hc-tag-edit-chip hc-tag-existing-chip' + (active ? ' hc-tag-existing-active' : '') + '" data-tag="' + escHtml(t) + '"'
        + ' style="' + (active ? 'background:' + tc + ';color:#fff;border-color:' + tc : 'background:' + tc + '20;color:' + tc + ';border-color:' + tc + '60') + '"'
        + '>' + escHtml(t) + '</span>';
    });
    tagEditExisting.innerHTML = html;
    tagEditExisting.querySelectorAll('.hc-tag-edit-chip').forEach(function (el) {
      el.addEventListener('click', function () {
        var tag = this.dataset.tag;
        if (tagEditTags.indexOf(tag) >= 0) {
          tagEditTags = tagEditTags.filter(function (t) { return t !== tag; });
        } else {
          tagEditTags.push(tag);
        }
        renderTagEditSelected();
        renderTagEditExisting();
      });
    });
  }

  function addTagFromInput() {
    if (!tagEditInput) return;
    var val = tagEditInput.value.trim();
    if (!val) return;
    if (tagEditTags.indexOf(val) === -1) {
      tagEditTags.push(val);
    }
    tagEditInput.value = '';
    renderTagEditSelected();
    renderTagEditExisting();
  }

  if (tagEditAddBtn) tagEditAddBtn.addEventListener('click', addTagFromInput);
  if (tagEditInput) {
    tagEditInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); }
    });
  }
  if (tagEditSave) {
    tagEditSave.addEventListener('click', function () {
      vscode.postMessage({ type: 'updateTags', email: tagEditEmail, tags: tagEditTags });
      if (tagEditModal) tagEditModal.hidden = true;
    });
  }
  if (tagEditCancel) tagEditCancel.addEventListener('click', function () { if (tagEditModal) tagEditModal.hidden = true; });
  if (tagEditClose) tagEditClose.addEventListener('click', function () { if (tagEditModal) tagEditModal.hidden = true; });
  if (tagEditModal) {
    tagEditModal.addEventListener('click', function (e) {
      if (e.target === tagEditModal) tagEditModal.hidden = true;
    });
  }

})();
