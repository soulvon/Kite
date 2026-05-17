(function() {
  'use strict';

  // ==================== 状态管理 ====================
  let accounts = [];
  let lastEmail = '';
  let usageCache = new Map();
  let lastRefreshTime = 0;
  let autoSwitchEnabled = true;
  let _ltRunning = false; // 长任务是否正在运行（防止其他保存操作覆盖 continueMode）
  let autoSwitchThreshold = 10;
  let autoSwitchCheckSec = 60;
  let autoSwitchCooldownSec = 30;
  let autoSwitchScoreMode = 'min';
  let autoSwitchStrategy = 'highestFirst';
  let autoSwitchMinQuota = 10;
  let autoSwitchPreferUsedThreshold = 50;
  let autoSwitchPoolScope = 'all';
  let autoSwitchPoolTags = [];
  let autoSwitchPoolTagsDirty = false; // 本地已修改但未被后端确认
  let autoSwitchRefreshMin = 5;
  let autoSwitchRefreshConcurrency = 12;
  let autoSwitchRefreshBatchDelayMs = 250;
  let autoSwitchPeriodRefreshHours = 6;
  let autoSwitchSynced = false; // 是否已收到后端同步
  let pageSize = 20; // 每页显示数量，0=全部
  let currentPage = 1;
  let refreshInterval = null;
  let externalAccount = ''; // Windsurf 当前登录但不在号池中的账户
  let lockedEmails = new Set(); // 被其他窗口占用的账号
  let lockedEmailsMap = {}; // email → { instanceName }
  let perAccountStats = {}; // email → { switchToCount, dailyUsedPct, weeklyUsedPct }
  let tagColors = {}; // tag → color hex（用户自定义颜色，持久化到 localStorage）
  let privacyMode = false;
  let healthCheckCache = new Map(); // email → { ok, reason, ts, testing }
  let healthCheckBusy = false;
  let switchIssueCache = new Map(); // email → { reason, kind, ts }
  let switchingEmail = '';

  // ── 标签颜色系统 ──
  const TAG_PALETTE = [
    '#8b5cf6', // violet
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#6366f1', // indigo
  ];
  // 加载用户自定义标签颜色
  try { tagColors = JSON.parse(localStorage.getItem('ws-pool-tag-colors') || '{}'); } catch(e) { tagColors = {}; }

  function saveTagColors() {
    try { localStorage.setItem('ws-pool-tag-colors', JSON.stringify(tagColors)); } catch(e) {}
    postMsg('syncTagColors', { colors: tagColors });
  }

  function getTagColor(tag) {
    if (!tag) return TAG_PALETTE[0];
    // 用户自定义色优先
    if (tagColors[tag]) return tagColors[tag];
    // 根据 tag 名 hash 分配默认色
    let hash = 0;
    for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
    return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
  }

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

  function maskEmail(email) {
    if (!email || typeof email !== 'string') return '';
    const at = email.indexOf('@');
    if (at <= 0) return email.length <= 4 ? '*'.repeat(email.length) : email.slice(0, 2) + '***' + email.slice(-2);
    const name = email.slice(0, at);
    const domain = email.slice(at + 1);
    const maskedName = name.length <= 2 ? name[0] + '***' : name.slice(0, 2) + '***' + name.slice(-1);
    const dot = domain.lastIndexOf('.');
    if (dot <= 0) return maskedName + '@***';
    const host = domain.slice(0, dot);
    const suffix = domain.slice(dot);
    const maskedHost = host.length <= 2 ? host[0] + '***' : host.slice(0, 1) + '***' + host.slice(-1);
    return maskedName + '@' + maskedHost + suffix;
  }

  function displayEmail(email) {
    return privacyMode ? maskEmail(email) : email;
  }

  function updatePrivacyModeUi() {
    if (!privacyModeBtn) return;
    privacyModeBtn.classList.toggle('is-active', privacyMode);
    privacyModeBtn.title = privacyMode ? '隐私模式：已开启，点击显示邮箱' : '隐私模式：隐藏邮箱';
    const eye = privacyModeBtn.querySelector('.privacy-eye');
    const eyeOff = privacyModeBtn.querySelector('.privacy-eye-off');
    if (eye) eye.hidden = privacyMode;
    if (eyeOff) eyeOff.hidden = !privacyMode;
  }

  function setExternalEmailText() {
    const emailEl = document.getElementById('externalEmail');
    if (emailEl) emailEl.textContent = displayEmail(externalAccount);
  }

  // ==================== DOM 元素 ====================
  const $ = (sel) => document.querySelector(sel);
  const accountGrid = $('#accountGrid');
  const gridCount = $('.grid-count');
  const emptyState = $('#emptyState');
  const asEnabledEl = $('#asEnabled');
  const asThresholdEl = $('#asThreshold');
  const refreshAllBtn = $('#refreshAllBtn');
  const privacyModeBtn = $('#privacyModeBtn');

  // Windsurf 增强面板元素
  const enhanceToggleBtn = $('#enhanceToggleBtn');
  const enhanceScriptStatus = $('#enhanceScriptStatus');
  const enhanceReinjectBtn = $('#enhanceReinjectBtn');
  const enhanceInjectRulesBtn = $('#enhanceInjectRulesBtn');
  const enhanceRestoreBtn = $('#enhanceRestoreBtn');
  const enhanceBubbleRules = $('#enhanceBubbleRules');
  const featLocalization = $('#featLocalization');
  const featBubbles = $('#featBubbles');
  const featAutoRecovery = $('#featAutoRecovery');
  const featSignalBridge = $('#featSignalBridge');
  // 增强设置控件
  const enhBubblesEnabled = $('#enhBubblesEnabled');
  const enhBubblesAutoSend = $('#enhBubblesAutoSend');
  const enhBubblesTheme = $('#enhBubblesTheme');
  const enhBubblesShape = $('#enhBubblesShape');
  const enhLocalizationEnabled = $('#enhLocalizationEnabled');
  // 底部状态栏设置
  const enhStatusBarEnabled = $('#enhStatusBarEnabled');
  const enhStatusBarPosition = $('#enhStatusBarPosition');
  const enhStatusBarStyle = $('#enhStatusBarStyle');
  const enhSbShowPool = $('#enhSbShowPool');
  const enhSbShowAutoSwitch = $('#enhSbShowAutoSwitch');
  const enhSbShowInstance = $('#enhSbShowInstance');
  // ── 自动继续（新 UI） ──
  const enhAutoContinueEnabled = $('#enhAutoContinueEnabled');
  const acOffHint = $('#acOffHint');
  const acOnContent = $('#acOnContent');
  const acTabGuardian = $('#acTabGuardian');
  const acTabLongTask = $('#acTabLongTask');
  const acPanelGuardian = $('#acPanelGuardian');
  const acPanelLongTask = $('#acPanelLongTask');
  // 守护面板
  const enhGdAutoContinueBtn = $('#enhGdAutoContinueBtn');
  const enhGdAutoRetry = $('#enhGdAutoRetry');
  const enhGdAutoSendOnToolLimit = $('#enhGdAutoSendOnToolLimit');
  const enhGdApproveWeb = $('#enhGdApproveWeb');
  const enhGdApproveTerminal = $('#enhGdApproveTerminal');
  const enhGdApproveFile = $('#enhGdApproveFile');
  const enhGdDismissCorrupt = $('#enhGdDismissCorrupt');
  // 长任务面板
  const acForceStopBtn = $('#acForceStopBtn');
  const acStatusDot = $('#acStatusDot');
  const acStatusText = $('#acStatusText');
  const acStatusCount = $('#acStatusCount');
  const acContinueCount = $('#acContinueCount');
  const acQueueList = $('#acQueueList');
  const acQueueNewText = $('#acQueueNewText');
  const acQueueAddBtn = $('#acQueueAddBtn');
  const enhLtLoop = $('#enhLtLoop');
  const enhLtIdleSeconds = $('#enhLtIdleSeconds');
  const enhLtMaxContinue = $('#enhLtMaxContinue');
  const enhLtMaxSendRetries = $('#enhLtMaxSendRetries');
  const enhLtStopOnIntervention = $('#enhLtStopOnIntervention');
  const acStartBtn = $('#acStartBtn');
  const acPauseBtn = $('#acPauseBtn');
  const acResumeBtn = $('#acResumeBtn');
  const acStopBtn = $('#acStopBtn');
  const acLastAction = $('#acLastAction');
  // 兼容旧引用
  const enhAutoSwitchOnQuota = $('#enhAutoSwitchOnQuota');
  const enhAutoSwitchOnRateLimit = $('#enhAutoSwitchOnRateLimit');
  const enhAutoRecoveryEnabled = $('#enhAutoRecoveryEnabled');
  // v6.6.0 恢复确认 Banner 控件
  const enhRecoveryConfirmEnabled = $('#enhRecoveryConfirmEnabled');
  const enhRecoveryCountdownSeconds = $('#enhRecoveryCountdownSeconds');
  const enhRecoveryPrefsClear = $('#enhRecoveryPrefsClear');
  // 恢复规则控件
  const ruleNetworkAction = $('#ruleNetworkAction');
  const ruleNetworkMaxRetries = $('#ruleNetworkMaxRetries');
  const ruleNetworkDelay = $('#ruleNetworkDelay');
  const ruleQuotaAction = $('#ruleQuotaAction');
  const ruleQuotaAfterAction = $('#ruleQuotaAfterAction');
  const ruleModelAction = $('#ruleModelAction');
  const ruleModelAfterAction = $('#ruleModelAfterAction');
  const modelPriorityList = $('#modelPriorityList');
  const modelPriorityInput = $('#modelPriorityInput');
  const modelPriorityAdd = $('#modelPriorityAdd');
  const ruleContinuationAction = $('#ruleContinuationAction');
  const rulePermissionAction = $('#rulePermissionAction');
  const permScopeWeb = $('#permScopeWeb');
  const permScopeTerminal = $('#permScopeTerminal');
  const permScopeFile = $('#permScopeFile');
  const ruleUserAction = $('#ruleUserAction');
  const customRulesList = $('#customRulesList');
  const customRuleAdd = $('#customRuleAdd');
  // 测试按钮 & 模型获取
  const fetchModelsBtn = $('#fetchModelsBtn');
  const availableModelsList = $('#availableModelsList');
  const currentModelName = $('#currentModelName');
  const testRetryBtn = $('#testRetryBtn');
  const testRetryResult = $('#testRetryResult');
  const testSwitchAccountBtn = $('#testSwitchAccountBtn');
  const testSwitchAccountResult = $('#testSwitchAccountResult');
  const testSwitchModelBtn = $('#testSwitchModelBtn');
  const testSwitchModelResult = $('#testSwitchModelResult');
  const testSendContinueBtn = $('#testSendContinueBtn');
  const testSendContinueResult = $('#testSendContinueResult');
  const testPermissionBtn = $('#testPermissionBtn');
  const testPermissionResult = $('#testPermissionResult');
  const enhNotifyEnabled = $('#enhNotifyEnabled');
  const enhNotifyTrigger = $('#enhNotifyTrigger');
  const enhNotifySound = $('#enhNotifySound');
  const enhNotifyDesktop = $('#enhNotifyDesktop');
  const enhNotifyTone = $('#enhNotifyTone');
  const enhNotifyRepeat = $('#enhNotifyRepeat');
  const enhNotifyTest = $('#enhNotifyTest');
  const enhCustomToneRow = $('#enhCustomToneRow');
  const enhCustomTone = $('#enhCustomTone');
  const enhAudioFileRow = $('#enhAudioFileRow');
  const enhAudioFile = $('#enhAudioFile');
  const enhAudioFileBrowse = $('#enhAudioFileBrowse');

  // ==================== 多选 ====================
  let selectMode = false;
  const selectedEmails = new Set();

  // ==================== 搜索 & 排序 ====================
  let searchQuery = '';
  let sortDirection = 'desc'; // desc | asc

  // ==================== 统一过滤器 ====================
  // 每个维度是一个 Set，空 Set 表示不过滤该维度（显示全部）
  let filterPlans = new Set();   // 套餐名称
  let filterTags = new Set();    // 标签
  let filterStatuses = new Set(); // 状态
  let filterHealth = new Set();  // 测活结果

  // 兼容旧分组逻辑（现在不做分组，只过滤）
  let groupBy = 'none';
  let activeTagFilter = null;
  let activeTagFilters = [];

  // ==================== 标签管理 ====================
  let tagEditMode = null; // null | 'add' | 'edit' | 'batch'
  let tagEditEmail = null; // 正在编辑标签的账号邮箱
  let tagEditBatchEmails = null; // 批量模式下要打标签的账号列表
  let tagEditPendingTags = []; // 编辑弹窗中的临时标签列表

  // 获取账号标签数组（兼容旧 tag 字段）
  function getAccTags(a) {
    if (a.tags && a.tags.length > 0) return a.tags;
    if (a.tag) return [a.tag];
    return [];
  }

  // ========== 过滤器辅助 ==========
  function getAccountStatus(account) {
    const cached = usageCache.get(account.email);
    const snap = cached?.snapshot;
    const err = cached?.error;
    if (err) return '异常';
    if (!snap) return '未加载';
    if (snap.planEnd && new Date(snap.planEnd).getTime() < Date.now()) return '已到期';
    if ((snap.weeklyRemainingPercent || 0) <= 0) return '周额度耗尽';
    if ((snap.dailyRemainingPercent || 0) <= 0) return '日额度耗尽';
    return '正常';
  }

  function getHealthStatus(email) {
    const hc = getHealthEntry(email);
    if (!hc) return '未检测';
    if (hc.testing) return '检测中';
    if (hc.stale) return '待复测';
    if (hc.ok) return '可用';
    const reason = hc.reason || '';
    if (/待复测/i.test(reason)) return '待复测';
    if (/全局限制|长期不可用|限流|限速|rate limit|剩余\s*0|消息已用尽|模型额度|额度.*上限|已达上限|用尽|overall|暂不可用/i.test(reason)) return '限速';
    return '异常';
  }

  function planTierClass(planName) {
    const p = (planName || '').toLowerCase();
    if (p.includes('free')) return 'tier-free';
    if (p.includes('trial')) return 'tier-trial';
    if (p.includes('pro')) return 'tier-pro';
    if (p.includes('team')) return 'tier-team';
    if (p.includes('enterprise')) return 'tier-enterprise';
    return 'tier-unknown';
  }

  function getAccountPlan(account) {
    const snap = usageCache.get(account.email)?.snapshot;
    return snap ? (snap.planName || 'Unknown') : '未加载';
  }

  function passesFilter(account) {
    if (filterPlans.size > 0 && !filterPlans.has(getAccountPlan(account))) return false;
    if (filterTags.size > 0) {
      const at = getAccTags(account);
      const matched = at.length > 0 ? at.some(t => filterTags.has(t)) : filterTags.has('未分类');
      if (!matched) return false;
    }
    if (filterStatuses.size > 0 && !filterStatuses.has(getAccountStatus(account))) return false;
    if (filterHealth.size > 0 && !filterHealth.has(getHealthStatus(account.email))) return false;
    return true;
  }

  // 当前搜索 + 筛选后可见的账号集合（与 renderCards 中筛选逻辑一致）
  function getVisibleAccounts() {
    let list = accounts.slice();
    const q = (searchQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(a => (a.email || '').toLowerCase().includes(q) || getAccTags(a).some(t => t.toLowerCase().includes(q)));
    }
    list = list.filter(a => passesFilter(a));
    return list;
  }

  function buildFilterDropdown() {
    const planList = document.getElementById('filterPlanList');
    const tagList = document.getElementById('filterTagList');
    const statusList = document.getElementById('filterStatusList');
    const healthList = document.getElementById('filterHealthList');
    if (!planList || !tagList || !statusList || !healthList) return;

    // 统计各维度计数
    const planCounts = {};
    const tagCounts = {};
    const statusCounts = {};
    const healthCounts = {};
    accounts.forEach(a => {
      const p = getAccountPlan(a);
      planCounts[p] = (planCounts[p] || 0) + 1;
      const accTags = getAccTags(a);
      if (accTags.length === 0) {
        tagCounts['未分类'] = (tagCounts['未分类'] || 0) + 1;
      } else {
        accTags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
      }
      const s = getAccountStatus(a);
      statusCounts[s] = (statusCounts[s] || 0) + 1;
      const h = getHealthStatus(a.email);
      healthCounts[h] = (healthCounts[h] || 0) + 1;
    });

    function renderOptions(container, counts, activeSet) {
      container.innerHTML = '';
      Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([val, cnt]) => {
        const el = document.createElement('div');
        el.className = 'filter-option' + (activeSet.has(val) ? ' is-active' : '');
        el.dataset.value = val;
        el.innerHTML = `<span class="filter-option-name">${escHtml(val)}</span><span class="filter-option-count">${cnt}</span>`;
        container.appendChild(el);
      });
    }

    renderOptions(planList, planCounts, filterPlans);
    renderOptions(tagList, tagCounts, filterTags);
    renderOptions(statusList, statusCounts, filterStatuses);
    renderOptions(healthList, healthCounts, filterHealth);

    // 更新触发器标签
    updateFilterLabel();
  }

  function updateFilterLabel() {
    const labelEl = document.getElementById('filterLabel');
    const countEl = document.getElementById('filterCount');
    if (!labelEl || !countEl) return;
    const totalFilters = filterPlans.size + filterTags.size + filterStatuses.size + filterHealth.size;
    if (totalFilters === 0) {
      labelEl.textContent = 'ALL';
      countEl.textContent = '(' + accounts.length + ')';
    } else {
      const matched = accounts.filter(a => passesFilter(a)).length;
      labelEl.textContent = '筛选中';
      countEl.textContent = '(' + matched + '/' + accounts.length + ')';
    }
    const quickHealthOkBtn = document.getElementById('quickHealthOkBtn');
    if (quickHealthOkBtn) quickHealthOkBtn.classList.toggle('is-active', filterHealth.has('可用'));
  }

  function getAccountGroup(account) {
    const snap = usageCache.get(account.email)?.snapshot;
    const err = usageCache.get(account.email)?.error;
    switch (groupBy) {
      case 'tag': return getAccTags(account).join(', ') || '未分组';
      case 'plan': return snap ? (snap.planName || 'Unknown') : '未加载';
      case 'status': {
        if (err) return '异常';
        if (!snap) return '未加载';
        if (snap.planEnd && new Date(snap.planEnd).getTime() < Date.now()) return '已到期';
        if ((snap.weeklyRemainingPercent || 0) <= 0) return '周额度耗尽';
        if ((snap.dailyRemainingPercent || 0) <= 0) return '日额度耗尽';
        const minPct = Math.min(snap.dailyRemainingPercent || 0, snap.weeklyRemainingPercent || 0);
        if (minPct < 10) return '额度不足';
        return '正常';
      }
      case 'tier': {
        // 按会员等级：Free / Pro / Team / Enterprise / 未知
        if (!snap) return '未加载';
        const plan = (snap.planName || '').toLowerCase();
        if (plan.includes('free')) return '🆓 Free';
        if (plan.includes('enterprise')) return '🏢 Enterprise';
        if (plan.includes('team')) return '👥 Team';
        if (plan.includes('pro')) return '⭐ Pro';
        return '❓ 其他';
      }
      case 'usage': {
        // 按用量水平
        if (err) return '❌ 失效';
        if (!snap) return '⏳ 未加载';
        const minPct = Math.min(snap.dailyRemainingPercent || 0, snap.weeklyRemainingPercent || 0);
        if (minPct <= 0) return '🔴 已用尽 (0%)';
        if (minPct <= 10) return '🟠 即将耗尽 (≤10%)';
        if (minPct <= 30) return '🟡 用量较高 (≤30%)';
        if (minPct <= 60) return '🟢 用量适中 (≤60%)';
        return '🔵 余量充足 (>60%)';
      }
      case 'expiry': {
        // 按到期状态
        if (!snap) return '⏳ 未加载';
        if (!snap.planEnd) return '📅 无到期信息';
        const endTs = new Date(snap.planEnd).getTime();
        const now = Date.now();
        const daysLeft = Math.ceil((endTs - now) / 86400000);
        if (daysLeft < 0) return '⛔ 已过期';
        if (daysLeft <= 3) return '🔴 3天内到期';
        if (daysLeft <= 7) return '🟠 7天内到期';
        if (daysLeft <= 30) return '🟡 30天内到期';
        return '🟢 30天以上';
      }
      case 'domain': {
        const parts = account.email.split('@');
        return parts.length > 1 ? parts[1] : '未知';
      }
      default: return '__all__';
    }
  }

  function updateBatchCount() {
    const visible = getVisibleAccounts();
    const visibleSelected = visible.filter(a => selectedEmails.has(a.email)).length;
    const el = document.getElementById('batchCount');
    if (el) {
      // 当筛选后的可见数 != 总账号数时，显示"已选 N/可见M"提升清晰度
      if (visible.length !== accounts.length) {
        el.textContent = '已选 ' + selectedEmails.size + '（可见 ' + visibleSelected + '/' + visible.length + '）';
      } else {
        el.textContent = '已选 ' + selectedEmails.size;
      }
    }
    const allCb = document.getElementById('batchCheckAll');
    if (allCb) allCb.checked = visible.length > 0 && visibleSelected === visible.length;
  }

  // ==================== 卡片视图 ====================
  function buildCard(account, isActive) {
    const card = document.createElement('div');
    card.className = 'grid-card' + (isActive ? ' is-active' : '');
    card.dataset.email = account.email;

    const cached = usageCache.get(account.email);
    const snap = cached?.snapshot;
    const err = cached?.error;
    const accTags = getAccTags(account);
    const tagHtml = accTags.length > 0
      ? accTags.map(t => {
          const tc = getTagColor(t);
          const active = filterTags.has(t);
          return `<span class="grid-tag-chip${active ? ' is-active' : ''}" data-action="filterTag" data-tag="${escHtml(t)}" title="点击筛选此标签 / 右键修改标签 / 双击改色" style="background:${tc}">${escHtml(t)}</span>`;
        }).join('') + `<span class="grid-tag-add" data-action="editTag" title="编辑标签">+</span>`
      : `<span class="grid-tag-add" data-action="editTag" title="添加标签">+ 标签</span>`;

    if (selectMode) card.classList.add('is-select-mode');
    if (account.disabled) card.classList.add('is-disabled');
    if (getAccountIssue(account.email)) card.classList.add('has-switch-issue');
    const lockInfo = !isActive && lockedEmailsMap[account.email];
    if (lockInfo) card.classList.add('is-locked');
    card.innerHTML = `
      ${lockInfo ? `<div class="grid-lock-overlay"><div class="grid-lock-overlay-box"><div class="grid-lock-overlay-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><div class="grid-lock-overlay-text">${escHtml(lockInfo.instanceName)} 使用中</div><button class="grid-force-switch-btn" data-action="forceSwitch" title="强制切换到此账号（将从其他实例抢占）">强制切换</button></div></div>` : ''}
      ${selectMode ? `<div class="grid-check-col"><input type="checkbox" class="grid-check-input" data-email="${escHtml(account.email)}" ${selectedEmails.has(account.email) ? 'checked' : ''}></div>` : ''}
      <div class="grid-card-body">
      <div class="grid-card-head">
        <div class="grid-card-email" title="${escHtml(displayEmail(account.email))}">${escHtml(displayEmail(account.email))}</div>
        ${isActive ? '<span class="grid-active-tag">当前</span>' : ''}
        ${!isActive && lockedEmails.has(account.email) ? '<span class="grid-locked-tag" title="被其他窗口占用中">🔒 占用</span>' : ''}
        ${account.disabled ? '<span class="grid-disabled-tag">已禁用</span>' : ''}
      </div>
      <div class="grid-card-meta">
        <span class="grid-plan-chip ${snap ? planTierClass(snap.planName) : ''}" data-field="plan">${snap ? escHtml(snap.planName || 'Unknown') : '...'}</span>
        ${tagHtml}
        ${buildHealthBadge(account.email)}
        ${buildSwitchIssueBadge(account.email)}
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
        <div class="grid-extra-row"><span>今日切号</span><span class="grid-extra-val" data-field="switchCount">${perAccountStats[account.email]?.switchToCount || 0} 次</span></div>
      </div>
      ${buildSwitchIssueRow(account.email)}
      <div class="grid-card-actions">
        ${isActive
          ? '<span class="grid-current-label"><span style="color:#3fb950">●</span> 使用中</span>'
          : `<button class="grid-switch-btn" data-action="switch" ${switchingEmail === account.email ? 'disabled' : ''}>${switchingEmail === account.email ? '<span class="btn-mini-spinner"></span>检查中' : '切换'}</button>`
        }
        <div class="grid-actions-right">
          <button class="status-toggle-btn ${account.disabled ? 'is-disabled' : 'is-enabled'}" data-action="toggleDisabled" title="${account.disabled ? '点击启用账号' : '点击禁用账号'}">${account.disabled ? '已禁用' : '已启用'}</button>
          <button class="icon-btn" data-action="refresh" title="刷新配额">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
          <button class="icon-btn danger" data-action="delete" title="删除账号">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
      <div class="grid-card-error" ${err ? '' : 'hidden'}>${err ? escHtml(err) : ''}</div>
      </div>
    `;

    return card;
  }

  function updateCard(card, snapshot) {
    const email = card.dataset.email;
    if (!email || !snapshot) return;

    const planEl = card.querySelector('[data-field="plan"]');
    if (planEl) {
      planEl.textContent = snapshot.planName || 'Unknown';
      planEl.className = 'grid-plan-chip ' + planTierClass(snapshot.planName);
    }

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

    const switchEl = card.querySelector('[data-field="switchCount"]');
    if (switchEl) {
      switchEl.textContent = (perAccountStats[email]?.switchToCount || 0) + ' 次';
    }

    const errEl = card.querySelector('.grid-card-error');
    if (errEl) errEl.hidden = true;

    maybeDowngradeTemporaryHealth(email, snapshot);
    usageCache.set(email, { snapshot, ts: Date.now() });
    persistState();
  }

  let _rerenderTimer = null;
  // 防抖 patch：usage 消息陆续到达时合并为一次就地 patch（不重建 DOM，避免闪烁）
  function scheduleRerender() {
    if (_rerenderTimer) clearTimeout(_rerenderTimer);
    _rerenderTimer = setTimeout(() => {
      _rerenderTimer = null;
      if (!accountGrid) return;
      accountGrid.querySelectorAll('.grid-card').forEach(card => {
        const email = card.dataset.email;
        if (!email) return;
        const cached = usageCache.get(email);
        if (cached?.snapshot) updateCard(card, cached.snapshot);
        if (cached?.error) {
          const errEl = card.querySelector('.grid-card-error');
          if (errEl) { errEl.textContent = cached.error; errEl.hidden = false; }
        }
      });
      updateSummary();
    }, 400);
  }

  // 排序模式：recommend | min | daily | weekly | planEnd | email | created | default
  let sortMode = 'recommend';

  function getSnap(email) { return usageCache.get(email)?.snapshot; }

  function cmpByMode(a, b, mode) {
    const sa = getSnap(a.email), sb = getSnap(b.email);
    const has = (s) => s ? 1 : 0;
    const dir = (sortDirection === 'asc') ? -1 : 1;
    switch (mode) {
      case 'recommend': {
        // 智能推荐：综合配额余量 + 计划未过期 + 无错误优先
        const ea = usageCache.get(a.email)?.error, eb = usageCache.get(b.email)?.error;
        // 失效账号排最后
        if (ea && !eb) return 1;
        if (!ea && eb) return -1;
        // 未加载排在失效之前、已加载之后
        if (!sa && sb) return 1;
        if (sa && !sb) return -1;
        if (!sa && !sb) return 0;
        // 过期排后
        const aNow = sa.planEnd ? new Date(sa.planEnd).getTime() > Date.now() : true;
        const bNow = sb.planEnd ? new Date(sb.planEnd).getTime() > Date.now() : true;
        if (aNow && !bNow) return -1;
        if (!aNow && bNow) return 1;
        // 按综合配额余量降序
        const va = Math.min(sa.dailyRemainingPercent||0, sa.weeklyRemainingPercent||0);
        const vb = Math.min(sb.dailyRemainingPercent||0, sb.weeklyRemainingPercent||0);
        return (vb - va) * dir;
      }
      case 'min': {
        const va = sa ? Math.min(sa.dailyRemainingPercent||0, sa.weeklyRemainingPercent||0) : -1;
        const vb = sb ? Math.min(sb.dailyRemainingPercent||0, sb.weeklyRemainingPercent||0) : -1;
        return (vb - va) * dir;
      }
      case 'daily': {
        const va = sa ? (sa.dailyRemainingPercent||0) : -1;
        const vb = sb ? (sb.dailyRemainingPercent||0) : -1;
        return (vb - va) * dir;
      }
      case 'weekly': {
        const va = sa ? (sa.weeklyRemainingPercent||0) : -1;
        const vb = sb ? (sb.weeklyRemainingPercent||0) : -1;
        return (vb - va) * dir;
      }
      case 'planEnd': {
        if (has(sa) !== has(sb)) return has(sb) - has(sa);
        const va = sa?.planEnd ? new Date(sa.planEnd).getTime() : Infinity;
        const vb = sb?.planEnd ? new Date(sb.planEnd).getTime() : Infinity;
        return (va - vb) * dir;
      }
      case 'email':
        return (a.email || '').localeCompare(b.email || '') * dir;
      case 'created': {
        const ta = a.created_at || 0, tb = b.created_at || 0;
        return (tb - ta) * dir;
      }
      case 'default':
      default:
        return 0;
    }
  }

  function renderCards() {
    if (!accountGrid) return;

    // 搜索筛选
    let filtered = [...accounts];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(a => (a.email || '').toLowerCase().includes(q) || getAccTags(a).some(t => t.toLowerCase().includes(q)));
    }
    // 统一过滤器
    filtered = filtered.filter(a => passesFilter(a));
    // 更新过滤器标签
    updateFilterLabel();

    const sorted = filtered.sort((a, b) => {
      if (a.email === lastEmail) return -1;
      if (b.email === lastEmail) return 1;
      return cmpByMode(a, b, sortMode);
    });

    // 禁用入场动画（避免全量重建时卡片闪烁）
    accountGrid.classList.add('no-card-anim');

    // 更新标签栏
    renderTagBar();

    // 使用 DocumentFragment 先在内存中构建，再一次性替换（原子操作，无中间空白帧）
    const frag = document.createDocumentFragment();

    if (groupBy === 'none') {
      // 分页
      const total = sorted.length;
      let pageItems = sorted;
      if (pageSize > 0 && total > pageSize) {
        const maxPage = Math.ceil(total / pageSize);
        if (currentPage > maxPage) currentPage = maxPage;
        if (currentPage < 1) currentPage = 1;
        const start = (currentPage - 1) * pageSize;
        pageItems = sorted.slice(start, start + pageSize);
      }
      pageItems.forEach(account => {
        frag.appendChild(buildCard(account, account.email === lastEmail));
      });
      // 分页控件
      if (pageSize > 0 && total > pageSize) {
        const maxPage = Math.ceil(total / pageSize);
        const pager = document.createElement('div');
        pager.className = 'pager-bar';
        pager.innerHTML = `
          <button class="pager-btn" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>&lt;</button>
          <span class="pager-info">${currentPage} / ${maxPage}</span>
          <button class="pager-btn" data-page="next" ${currentPage >= maxPage ? 'disabled' : ''}>&gt;</button>
          <span class="pager-info pager-total">共 ${total} 个</span>
        `;
        frag.appendChild(pager);
        pager.querySelectorAll('.pager-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            if (btn.dataset.page === 'prev' && currentPage > 1) { currentPage--; renderCards(); }
            else if (btn.dataset.page === 'next' && currentPage < maxPage) { currentPage++; renderCards(); }
          });
        });
      }
    } else {
      // 分组渲染
      const groups = new Map();
      sorted.forEach(account => {
        const key = getAccountGroup(account);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(account);
      });

      // 排序分组：未分组/未加载 放最后
      const sortedKeys = [...groups.keys()].sort((a, b) => {
        const tailWords = ['未分组', '未加载', '未知', '__all__'];
        const ai = tailWords.indexOf(a), bi = tailWords.indexOf(b);
        if (ai >= 0 && bi < 0) return 1;
        if (ai < 0 && bi >= 0) return -1;
        return a.localeCompare(b);
      });

      for (const key of sortedKeys) {
        const items = groups.get(key);
        const header = document.createElement('div');
        header.className = 'group-header';
        header.dataset.group = key;
        const groupEmails = items.map(a => a.email);
        const allSelected = groupEmails.every(e => selectedEmails.has(e));
        header.innerHTML = `
          ${selectMode ? `<label class="group-check"><input type="checkbox" class="group-check-input" data-group="${escHtml(key)}" ${allSelected ? 'checked' : ''}></label>` : ''}
          <span class="group-name">${escHtml(key)}</span>
          <span class="group-count">${items.length}</span>
        `;
        frag.appendChild(header);
        items.forEach(account => {
          frag.appendChild(buildCard(account, account.email === lastEmail));
        });
      }
    }

    accountGrid.replaceChildren(frag);

    // 下一帧恢复动画（后续真正新增卡片时才有动画）
    requestAnimationFrame(() => {
      if (accountGrid) accountGrid.classList.remove('no-card-anim');
    });

    const hasFilter = searchQuery.trim() || activeTagFilters.length > 0 || activeTagFilter || filterPlans.size > 0 || filterTags.size > 0 || filterStatuses.size > 0 || filterHealth.size > 0;
    if (gridCount) gridCount.textContent = hasFilter ? filtered.length + ' / ' + accounts.length + ' 个' : accounts.length + ' 个';
    if (emptyState) emptyState.hidden = accounts.length > 0;
    if (accountGrid) accountGrid.hidden = accounts.length === 0;

    updateSummary();
    if (selectMode) updateBatchCount();
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

    // --- 状态行 ---
    const activeCount = accounts.filter(a => !a.disabled).length;
    const disabledCount = accounts.length - activeCount;
    const adEl = document.getElementById('summaryActiveDisabled');
    if (adEl) adEl.textContent = `${activeCount} / ${disabledCount}`;

    let highQuota = 0, lowQuota = 0;
    accounts.forEach(a => {
      const snap = usageCache.get(a.email)?.snapshot;
      if (snap) {
        const dp = snap.dailyRemainingPercent || 0;
        if (dp >= 80) highQuota++;
        if (dp <= 30) lowQuota++;
      }
    });
    const hqEl = document.getElementById('summaryHighQuota');
    if (hqEl) hqEl.textContent = hasData ? `${highQuota} 个（≥ 80%）` : '--';
    const lqEl = document.getElementById('summaryLowQuota');
    if (lqEl) lqEl.textContent = hasData ? `${lowQuota} 个（≤ 30%）` : '--';

    const lrEl = document.getElementById('summaryLastRefresh');
    if (lrEl) {
      if (lastRefreshTime) {
        const sec = Math.round((Date.now() - lastRefreshTime) / 1000);
        lrEl.textContent = sec < 60 ? `${sec} 秒前` : `${Math.round(sec / 60)} 分钟前`;
      } else {
        lrEl.textContent = '--';
      }
    }
  }

  // 已移除列表视图，仅保留卡片视图

  // ==================== 测活 badge ====================
  function parseHealthRecoverAt(reason, baseTs) {
    const text = String(reason || '');
    if (!text) return 0;
    if (/官方全局限制|长期不可用/i.test(text)) return 0;

    const now = Date.now();
    const base = Number(baseTs) || now;
    const minuteMatch = text.match(/约\s*(\d+)\s*分钟/) || text.match(/(\d+)\s*min/i);
    if (minuteMatch) return base + Number(minuteMatch[1]) * 60 * 1000;
    const secondMatch = text.match(/约\s*(\d+)\s*秒/) || text.match(/(\d+)\s*s/i);
    if (secondMatch) return base + Number(secondMatch[1]) * 1000;

    const etaMatch = text.match(/预计\s*(明天\s*)?(\d{1,2})[:：](\d{2})\s*恢复?/);
    if (etaMatch) {
      const d = new Date();
      d.setHours(Number(etaMatch[2]), Number(etaMatch[3]), 0, 0);
      if (etaMatch[1]) d.setDate(d.getDate() + 1);
      if (d.getTime() < now - 60 * 1000) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    return 0;
  }

  function isTemporaryHealthLimit(reason) {
    const text = String(reason || '');
    return !/官方全局限制|长期不可用/i.test(text)
      && /限流|限速|频率限制|消息.*限制|rate limit|message limit|模型额度|额度.*上限|已达上限|用尽|overall|暂不可用|恢复时间|预计/i.test(text);
  }

  function normalizeHealthEntry(email, entry) {
    if (!entry || entry.testing || entry.ok) return entry;
    if (!isTemporaryHealthLimit(entry.reason)) return entry;
    const recoverAt = entry.recoverAt || parseHealthRecoverAt(entry.reason, entry.ts);
    if (recoverAt && Date.now() >= recoverAt) {
      return {
        ...entry,
        ok: false,
        stale: true,
        reason: '临时限速已到预计恢复时间，待复测',
        recoverAt,
      };
    }
    return recoverAt ? { ...entry, recoverAt } : entry;
  }

  function getHealthEntry(email) {
    const entry = healthCheckCache.get(email);
    if (!entry) return null;
    const normalized = normalizeHealthEntry(email, entry);
    if (normalized !== entry) healthCheckCache.set(email, normalized);
    return normalized;
  }

  function maybeDowngradeTemporaryHealth(email, snapshot) {
    if (!email || !snapshot) return false;
    const hc = healthCheckCache.get(email);
    if (!hc || hc.ok || hc.testing) return false;
    if (/官方全局限制|长期不可用/i.test(hc.reason || '')) return false;
    if (!isTemporaryHealthLimit(hc.reason)) return false;
    // 如果用量刷新显示有剩余配额，直接标记为正常
    const dailyPct = snapshot.dailyRemainingPercent ?? 0;
    const weeklyPct = snapshot.weeklyRemainingPercent ?? 0;
    if (dailyPct > 0 && weeklyPct > 0) {
      const reason = '用量刷新正常，限速已解除';
      healthCheckCache.set(email, {
        ...hc,
        ok: true,
        stale: false,
        reason,
        ts: Date.now(),
      });
      // 同步到扩展端 cache，避免下次推送覆盖
      try { vscode.postMessage({ type: 'clearHealthRateLimit', email, reason }); } catch (e) {}
      return true;
    }
    healthCheckCache.set(email, {
      ...hc,
      ok: false,
      stale: true,
      reason: '配额统计已正常刷新，待复测确认',
      ts: Date.now(),
    });
    return true;
  }

  function buildHealthBadge(email) {
    var hc = getHealthEntry(email);
    if (!hc) return '';
    if (hc.testing) {
      return '<span class="grid-health-badge grid-health-testing" title="检测中..."><svg class="grid-health-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>';
    }
    var ago = hc.ts ? formatTimeAgo(hc.ts) : '';
    var tip = escHtml((hc.reason || '') + (ago ? ' · ' + ago : ''));
    if (hc.stale) {
      return '<span class="grid-health-badge grid-health-warn" title="' + tip + '">待复测</span>';
    }
    if (hc.ok) {
      return '<span class="grid-health-badge grid-health-ok" title="' + tip + '">✓ 正常</span>';
    }
    if (hc.reason && /全局限制|长期不可用|限流|限速|rate limit|message limit|quota.*exhaust|usage.*quota|daily.*quota|模型额度|额度.*上限|已达上限|用尽|overall|暂不可用/i.test(hc.reason)) {
      var label = /官方全局限制|长期不可用/i.test(hc.reason)
        ? '全局限制'
        : (/官方临时限流|暂不可用/i.test(hc.reason) ? '官方限流' : '限速');
      return '<span class="grid-health-badge grid-health-warn" title="' + tip + '">⚠ ' + label + '</span>';
    }
    return '<span class="grid-health-badge grid-health-fail" title="' + tip + '">✗ 异常</span>';
  }

  function getSwitchIssue(email) {
    const issue = switchIssueCache.get(email);
    if (!issue) return null;
    return issue;
  }

  function summarizeAccountIssue(reason) {
    // 去掉模型前缀（如 "GPT-5.5: " "Claude Opus 4.6: "）
    const text = String(reason || '暂不可用').replace(/\s+/g, ' ').replace(/^[A-Za-z0-9. -]+:\s*/, '').trim();
    if (!text) return '暂不可用';
    const minuteMatch = text.match(/约\s*(\d+)\s*分钟/) || text.match(/(\d+)\s*min/i);
    if (/官方全局限制|长期不可用/i.test(text)) {
      return '官方全局限制，全模型疑似长期不可用';
    }
    if (/官方临时限流|暂不可用/i.test(text)) {
      const resetMatch = text.match(/恢复时间\s*([^|]+)/);
      return resetMatch ? `官方临时限流，${resetMatch[1].trim()} 后再试` : '官方临时限流，稍后再试';
    }
    if (/消息.*额度|消息.*限制|模型额度|额度.*上限|已达上限|用尽|频率|限流|限速|rate limit|quota.*exhaust|usage.*quota|daily.*quota|overall|reset/i.test(text)) {
      if (minuteMatch) return `消息/频率限制，约 ${minuteMatch[1]} 分钟后恢复`;
      const secondMatch = text.match(/(\d+)\s*s/i) || text.match(/(\d+)\s*秒/);
      if (secondMatch) return `消息/频率限制，约 ${secondMatch[1]} 秒后恢复`;
      return '账号消息/频率限制，稍后恢复';
    }
    if (/探针失败|probe.*fail|probe.*error|probe:/i.test(text)) return '探针检测异常';
    if (/NO_ACCESS|无权限|不支持|unsupported|not.*support/i.test(text)) return '当前模型无权限';
    if (/401|unauthori[sz]ed|key.*失效|invalid.*key|token/i.test(text)) return '登录凭据失效，需要重新导入';
    if (/封禁|suspend|ban|disabled/i.test(text)) return '账号异常/封禁';
    if (/异常|失败|错误|error|fail|timeout|超时|请求失败/i.test(text)) return '检测异常';
    return text.length > 30 ? text.slice(0, 30) + '…' : text;
  }

  function getAccountIssue(email) {
    const switchIssue = getSwitchIssue(email);
    if (switchIssue) {
      return {
        reason: switchIssue.reason || '暂不可用',
        summary: summarizeAccountIssue(switchIssue.reason),
        kind: switchIssue.kind || 'error',
        ts: switchIssue.ts,
        source: 'switch',
      };
    }
    const hc = getHealthEntry(email);
    if (hc && !hc.testing && !hc.ok) {
      const reason = hc.reason || '测活异常';
      return {
        reason,
        summary: hc.stale ? '测活：待复测确认' : '测活：' + summarizeAccountIssue(reason),
        kind: /全局限制|长期不可用|限流|限速|rate limit|message limit|quota.*exhaust|usage.*quota|daily.*quota|消息|模型额度|额度.*上限|已达上限|用尽|overall|reset|暂不可用/i.test(reason) ? 'blocked' : 'error',
        ts: hc.ts,
        source: 'health',
      };
    }
    return null;
  }

  function applyDiagnosticSync(latest) {
    if (!latest || typeof latest !== 'object') return;
    Object.keys(latest).forEach(function (email) {
      var item = latest[email] || {};
      if (item.health) {
        const entry = {
          ok: item.health.level === 'ok',
          reason: item.health.reason,
          ts: item.health.ts || Date.now(),
          testing: false,
        };
        healthCheckCache.set(email, normalizeHealthEntry(email, entry));
      }
      if (item.switch) {
        if (item.switch.level === 'ok') {
          switchIssueCache.delete(email);
        } else {
          switchIssueCache.set(email, {
            reason: item.switch.reason || '暂不可用',
            kind: item.switch.level === 'warn' ? 'blocked' : 'error',
            ts: item.switch.ts || Date.now(),
          });
        }
      }
    });
    renderCards();
    updateHealthBadges();
  }

  function buildSwitchIssueBadge(email) {
    const issue = getAccountIssue(email);
    if (!issue) return '';
    if (issue.source === 'health') return '';
    const tip = escHtml((issue.reason || '暂不可用') + ' · ' + formatTimeAgo(issue.ts));
    const label = '暂不可用';
    return `<span class="grid-switch-issue-badge ${issue.kind === 'blocked' ? 'is-blocked' : 'is-error'}" title="${tip}">${escHtml(label)}</span>`;
  }

  function buildSwitchIssueRow(email) {
    const issue = getAccountIssue(email);
    if (!issue) return '';
    const tip = escHtml((issue.reason || issue.summary || '暂不可用') + (issue.ts ? ' · ' + formatTimeAgo(issue.ts) : ''));
    return `
      <div class="grid-switch-issue ${issue.kind === 'blocked' ? 'is-blocked' : 'is-error'}" title="${tip}">
        <span class="grid-switch-issue-dot"></span>
        <span class="grid-switch-issue-text">${escHtml(issue.summary || issue.reason || '暂不可用')}</span>
      </div>
    `;
  }

  function formatTimeAgo(ts) {
    var diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 60) return diff + '秒前';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    return Math.floor(diff / 3600) + '小时前';
  }

  function updateHealthBadges() {
    if (!accountGrid) return;
    accountGrid.querySelectorAll('.grid-card').forEach(function (card) {
      var email = card.dataset.email;
      if (!email) return;
      var metaEl = card.querySelector('.grid-card-meta');
      if (!metaEl) return;
      var old = metaEl.querySelector('.grid-health-badge');
      var newHtml = buildHealthBadge(email);
      if (old) old.remove();
      if (newHtml) metaEl.insertAdjacentHTML('beforeend', newHtml);
    });
    updateHealthBarCount();
  }

  function updateHealthBarCount() {
    var countEl = document.getElementById('hcBarCount');
    if (!countEl) return;
    if (healthCheckCache.size === 0) { countEl.textContent = ''; return; }
    var ok = 0, fail = 0;
    healthCheckCache.forEach(function (v) {
      if (v.testing) return;
      if (v.ok) ok++; else fail++;
    });
    countEl.textContent = ok + ' 正常' + (fail > 0 ? ' / ' + fail + ' 异常' : '');
    countEl.className = 'health-check-bar-count' + (fail > 0 ? ' has-fail' : '');
  }

  setInterval(function () {
    var changed = false;
    healthCheckCache.forEach(function (entry, email) {
      var normalized = normalizeHealthEntry(email, entry);
      if (normalized !== entry) {
        healthCheckCache.set(email, normalized);
        changed = true;
      }
    });
    if (changed) {
      renderCards();
      updateFilterLabel();
    }
  }, 60 * 1000);

  // 测活面板入口事件
  (function () {
    // 侧栏入口按钮使用 summary 内联 onclick，避免折叠行点击同时触发。
  })();

  // ==================== 用量统计 ====================
  function updateUsageStatsUI(stats) {
    if (!stats) return;
    // 保存每账号统计
    if (stats.perAccount) perAccountStats = stats.perAccount;

    // 日期
    const dateEl = document.getElementById('usageStatsDate');
    if (dateEl) dateEl.textContent = stats.date || '';

    // 四格统计数字
    const setNum = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setNum('statPoolSignals', stats.totalPoolSignals || 0);
    setNum('statSwitches', stats.totalSwitches || 0);
    setNum('statRefreshes', stats.totalRefreshes || 0);
    setNum('statAvgDailyUsed', (stats.avgDailyUsedPct || 0) + '%');

    // 总用量条形图
    const acctCount = stats.accountCount || 1;
    const maxDaily = acctCount * 100;
    const dailyPct = maxDaily > 0 ? Math.min(100, (stats.totalDailyUsed / maxDaily) * 100) : 0;
    const weeklyPct = maxDaily > 0 ? Math.min(100, (stats.totalWeeklyUsed / maxDaily) * 100) : 0;

    const dailyBar = document.getElementById('statDailyBar');
    if (dailyBar) dailyBar.style.width = dailyPct.toFixed(1) + '%';
    const dailyVal = document.getElementById('statDailyVal');
    if (dailyVal) dailyVal.textContent = Math.round(stats.totalDailyUsed || 0) + '/' + maxDaily;

    const weeklyBar = document.getElementById('statWeeklyBar');
    if (weeklyBar) weeklyBar.style.width = weeklyPct.toFixed(1) + '%';
    const weeklyVal = document.getElementById('statWeeklyVal');
    if (weeklyVal) weeklyVal.textContent = Math.round(stats.totalWeeklyUsed || 0) + '/' + maxDaily;
  }

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

  // ==================== 标签管理 ====================
  function persistTagFilters() {
    try {
      const st = vscode.getState() || {};
      st._filterTags = [...filterTags];
      vscode.setState(st);
    } catch {}
  }

  function renderTagBar() {
    const tagListEl = document.getElementById('tagList');
    if (!tagListEl) return;

    // 统计每个标签的账号数
    const tagCounts = {};
    let untaggedCount = 0;
    accounts.forEach(acc => {
      const at = getAccTags(acc);
      if (at.length > 0) {
        at.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
      } else {
        untaggedCount++;
      }
    });
    const tags = Object.keys(tagCounts);

    tagListEl.innerHTML = '';

    // "全部"按钮 → 清空标签筛选
    const allChip = document.createElement('span');
    allChip.className = 'tag-chip' + (filterTags.size === 0 ? ' is-active' : '');
    allChip.textContent = '全部(' + accounts.length + ')';
    allChip.onclick = () => {
      filterTags.clear();
      persistTagFilters();
      currentPage = 1;
      const dropdown = document.getElementById('filterDropdown');
      if (dropdown && !dropdown.hidden) buildFilterDropdown();
      renderTagBar();
      renderCards();
    };
    tagListEl.appendChild(allChip);

    // 每个标签 → toggle filterTags Set
    tags.forEach(tag => {
      const chip = document.createElement('span');
      const isActive = filterTags.has(tag);
      chip.className = 'tag-chip' + (isActive ? ' is-active' : '');
      chip.textContent = tag + '(' + (tagCounts[tag] || 0) + ')';
      // 应用标签颜色
      const tc = getTagColor(tag);
      if (isActive) {
        chip.style.background = tc;
        chip.style.borderColor = tc;
        chip.style.color = '#fff';
      } else {
        chip.style.background = tc + '20';
        chip.style.borderColor = tc + '60';
        chip.style.color = tc;
      }
      chip.onclick = () => {
        if (filterTags.has(tag)) filterTags.delete(tag);
        else filterTags.add(tag);
        persistTagFilters();
        currentPage = 1;
        const dropdown = document.getElementById('filterDropdown');
        if (dropdown && !dropdown.hidden) buildFilterDropdown();
        renderTagBar();
        renderCards();
      };
      chip.oncontextmenu = (e) => {
        e.preventDefault();
        openTagColorPicker(tag, chip);
      };
      tagListEl.appendChild(chip);
    });

    // "未分类"按钮 → 筛选没有 tag 的账号
    if (untaggedCount > 0) {
      const untaggedChip = document.createElement('span');
      const isActive = filterTags.has('未分类');
      untaggedChip.className = 'tag-chip' + (isActive ? ' is-active' : '');
      untaggedChip.textContent = '未分类(' + untaggedCount + ')';
      if (isActive) {
        untaggedChip.style.background = '#8b8b8b';
        untaggedChip.style.borderColor = '#8b8b8b';
        untaggedChip.style.color = '#fff';
      } else {
        untaggedChip.style.background = '#8b8b8b20';
        untaggedChip.style.borderColor = '#8b8b8b60';
        untaggedChip.style.color = '#8b8b8b';
      }
      untaggedChip.onclick = () => {
        if (filterTags.has('未分类')) filterTags.delete('未分类');
        else filterTags.add('未分类');
        persistTagFilters();
        currentPage = 1;
        const dropdown = document.getElementById('filterDropdown');
        if (dropdown && !dropdown.hidden) buildFilterDropdown();
        renderTagBar();
        renderCards();
      };
      tagListEl.appendChild(untaggedChip);
    }
  }

  function openTagEditModal(mode, emailOrEmails = null) {
    tagEditMode = mode;
    tagEditEmail = null;
    tagEditBatchEmails = null;
    tagEditPendingTags = [];

    const overlay = document.getElementById('tagEditOverlay');
    const title = document.getElementById('tagEditTitle');
    const input = document.getElementById('tagEditInput');
    const error = document.getElementById('tagEditError');

    if (!overlay || !title || !input || !error) return;

    error.hidden = true;
    input.value = '';

    if (mode === 'edit' && typeof emailOrEmails === 'string') {
      tagEditEmail = emailOrEmails;
      const account = accounts.find(a => a.email === emailOrEmails);
      tagEditPendingTags = account ? [...getAccTags(account)] : [];
      title.textContent = '编辑标签';
    } else if (mode === 'batch' && Array.isArray(emailOrEmails)) {
      tagEditBatchEmails = [...emailOrEmails];
      // 预填所有选中账号的共有标签
      const batchAccounts = emailOrEmails.map(e => accounts.find(a => a.email === e)).filter(Boolean);
      if (batchAccounts.length > 0) {
        const first = new Set(getAccTags(batchAccounts[0]));
        tagEditPendingTags = [...first].filter(t => batchAccounts.every(a => getAccTags(a).includes(t)));
      } else {
        tagEditPendingTags = [];
      }
      title.textContent = `为 ${emailOrEmails.length} 个账号打标签`;
    } else {
      title.textContent = '添加标签';
    }

    renderTagEditUI();
    overlay.hidden = false;
    input.focus();
  }

  function renderTagEditUI() {
    const selectedEl = document.getElementById('tagEditSelected');
    const existingEl = document.getElementById('tagEditExisting');
    if (!selectedEl || !existingEl) return;

    // 已选标签 chips（带颜色圆点 + × 移除）
    if (tagEditPendingTags.length === 0) {
      selectedEl.innerHTML = '<span style="color:var(--muted);font-size:11px">暂无标签</span>';
    } else {
      selectedEl.innerHTML = tagEditPendingTags.map(t => {
        const tc = getTagColor(t);
        return `<span class="tag-edit-chip" style="background:${tc}18;border:1px solid ${tc}60;color:${tc};padding:2px 10px;border-radius:10px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:4px" data-tag="${escHtml(t)}"><span class="tag-edit-color-dot" data-tag="${escHtml(t)}" style="width:10px;height:10px;border-radius:50%;background:${tc};cursor:pointer;flex-shrink:0;border:2px solid #fff;box-shadow:0 0 0 1px ${tc}" title="点击换色"></span>${escHtml(t)} <span style="opacity:0.5;font-size:13px;margin-left:2px" class="tag-edit-remove">×</span></span>`;
      }).join('');
    }

    // 点击已选标签的 × → 移除；点击颜色圆点 → 改色
    selectedEl.querySelectorAll('.tag-edit-chip').forEach(chip => {
      const removeBtn = chip.querySelector('.tag-edit-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const t = chip.dataset.tag;
          tagEditPendingTags = tagEditPendingTags.filter(x => x !== t);
          renderTagEditUI();
        });
      }
      const colorDot = chip.querySelector('.tag-edit-color-dot');
      if (colorDot) {
        colorDot.addEventListener('click', (e) => {
          e.stopPropagation();
          openTagColorPicker(colorDot.dataset.tag, colorDot);
        });
      }
    });

    // 已有标签列表（带颜色圆点，可点击改色 / 点标签名 toggle 选中）
    const allTags = getTagList();
    const pending = new Set(tagEditPendingTags);
    existingEl.innerHTML = allTags
      .map(t => {
        const tc = getTagColor(t);
        const selected = pending.has(t);
        return `<span class="tag-edit-opt" style="padding:2px 8px;border-radius:10px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;border:1px solid ${tc}60;background:${selected ? tc : tc + '20'};color:${selected ? '#fff' : tc}" data-tag="${escHtml(t)}"><span class="tag-edit-color-dot" data-tag="${escHtml(t)}" style="width:10px;height:10px;border-radius:50%;background:${selected ? '#fff' : tc};cursor:pointer;flex-shrink:0;border:1px solid ${selected ? '#fff8' : tc + '80'};box-shadow:0 0 0 1px ${tc}40" title="点击换色"></span>${escHtml(t)}</span>`;
      }).join('') || '<span style="color:var(--muted);font-size:11px">暂无标签</span>';

    // 点击已有标签 → toggle；点击颜色圆点 → 改色
    existingEl.querySelectorAll('.tag-edit-opt').forEach(opt => {
      const colorDot = opt.querySelector('.tag-edit-color-dot');
      if (colorDot) {
        colorDot.addEventListener('click', (e) => {
          e.stopPropagation();
          openTagColorPicker(colorDot.dataset.tag, colorDot);
        });
      }
      opt.addEventListener('click', () => {
        const t = opt.dataset.tag;
        if (tagEditPendingTags.includes(t)) {
          tagEditPendingTags = tagEditPendingTags.filter(x => x !== t);
        } else {
          tagEditPendingTags.push(t);
        }
        renderTagEditUI();
      });
    });
  }

  function addTagFromInput() {
    const input = document.getElementById('tagEditInput');
    const error = document.getElementById('tagEditError');
    if (!input || !error) return;
    const newTag = input.value.trim();
    if (!newTag) return;
    error.hidden = true;
    if (!tagEditPendingTags.includes(newTag)) {
      // 新标签首次出现时随机分配颜色
      if (!tagColors[newTag] && !getTagList().includes(newTag)) {
        tagColors[newTag] = TAG_PALETTE[Math.floor(Math.random() * TAG_PALETTE.length)];
        saveTagColors();
      }
      tagEditPendingTags.push(newTag);
      renderTagEditUI();
    }
    input.value = '';
    input.focus();
  }

  function closeTagEditModal() {
    const overlay = document.getElementById('tagEditOverlay');
    if (overlay) overlay.hidden = true;
    tagEditMode = null;
    tagEditEmail = null;
    tagEditBatchEmails = null;
    tagEditPendingTags = [];
  }

  function saveTagEdit() {
    if (tagEditMode === 'edit' && tagEditEmail) {
      postMsg('updateTag', { email: tagEditEmail, tags: [...tagEditPendingTags] });
    } else if (tagEditMode === 'batch' && tagEditBatchEmails && tagEditBatchEmails.length > 0) {
      postMsg('batchTag', { emails: tagEditBatchEmails, tags: [...tagEditPendingTags] });
    }
    closeTagEditModal();
  }

  // ── 标签颜色选择器 ──
  function openTagColorPicker(tag, anchorEl) {
    // 移除已有的颜色选择器
    const existing = document.getElementById('tagColorPicker');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.id = 'tagColorPicker';
    picker.className = 'tag-color-picker';
    const currentColor = getTagColor(tag);

    picker.innerHTML = `
      <div class="tag-color-picker-title">「${escHtml(tag)}」颜色</div>
      <div class="tag-color-picker-grid">
        ${TAG_PALETTE.map(c => `<span class="tag-color-dot${c === currentColor ? ' is-active' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}
      </div>
      <div class="tag-color-picker-custom">
        <input type="color" class="tag-color-input" value="${currentColor}">
        <span class="tag-color-reset" title="重置为默认色">↺</span>
      </div>
    `;

    // 定位
    const rect = anchorEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.left = rect.left + 'px';
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.zIndex = '9999';
    document.body.appendChild(picker);

    function applyColorChange() {
      renderAccounts();
      // 如果标签编辑弹窗打开则同步刷新
      const overlay = document.getElementById('tagEditOverlay');
      if (overlay && !overlay.hidden) renderTagEditUI();
    }
    // 点击预设色
    picker.querySelectorAll('.tag-color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        tagColors[tag] = dot.dataset.color;
        saveTagColors();
        picker.remove();
        applyColorChange();
      });
    });
    // 自定义取色器
    const colorInput = picker.querySelector('.tag-color-input');
    colorInput.addEventListener('input', () => {
      tagColors[tag] = colorInput.value;
      saveTagColors();
      applyColorChange();
    });
    // 重置
    picker.querySelector('.tag-color-reset').addEventListener('click', () => {
      delete tagColors[tag];
      saveTagColors();
      picker.remove();
      applyColorChange();
    });
    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener('click', function closePicker(e) {
        if (!picker.contains(e.target)) {
          picker.remove();
          document.removeEventListener('click', closePicker);
        }
      });
    }, 10);
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
    // 从原始队列中查找失败项的完整信息（含 tag、authMethod 等）
    const retryAccts = [];
    for (const r of failedResults) {
      const original = _lastBatchQueue.find(a =>
        a.email ? a.email === r.email : (a.token && r.email && a.token.startsWith(r.email.replace(/\.{3}$/, '')))
      );
      if (original) {
        retryAccts.push(Object.assign({}, original));
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
    const isStoredAccount = !!item.apiKey;
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
      postMsg('batchTokenImport', { token: item.token, batch: true, tag: item.tag || '' });
    } else if (isStoredAccount) {
      postMsg('batchStoredAccountImport', { account: item, batch: true });
    } else {
      postMsg('loginSave', { email: item.email, password: item.password, batch: true, authMethod: item.authMethod || 'auto', tag: item.tag || '' });
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
      const raw = lines[i].trim().replace(/\\$/, ''); // 去掉行末反斜杠
      if (!raw || raw.startsWith('#')) continue;

      // ── 优先级1：整行就是 token ──────────────────────────────────
      if (/^auth1_[A-Za-z0-9_]+$/.test(raw) || /^devin-session-token\$/.test(raw)) {
        const tokenKey = raw.trim();
        if (seen.has(tokenKey)) { errors.push(`第 ${i+1} 行 token 重复`); continue; }
        seen.add(tokenKey);
        accts.push({ token: raw });
        continue;
      }

      // ── 优先级2：行内任意位置有 token → 直接取 token ──────────────
      // 同一行同时带 devin-session-token 与 auth1= 时优先 auth1。
      // 部分导出数据里的 devin session 已过期/不适配，但 auth1 仍可 PostAuth 换新 session。
      const tokenMatch = raw.match(/\b(auth1_[A-Za-z0-9_]+)/) || raw.match(/(devin-session-token\$[A-Za-z0-9._\-]+)/);
      if (tokenMatch) {
        const tok = tokenMatch[1];
        const tokenKey = tok.trim();
        if (seen.has(tokenKey)) { errors.push(`第 ${i+1} 行 token 重复`); continue; }
        seen.add(tokenKey);
        accts.push({ token: tok });
        continue;
      }

      // ── 优先级3：行内找邮箱，剩余作为密码 ──────────────────────
      const emailMatch = raw.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) {
        const email = emailMatch[1];
        // 把邮箱从原串里去掉，剩余部分去掉分隔符得到密码
        const rest = raw.replace(email, '').replace(/^[\s\-,|:：]+|[\s\-,|:：]+$/g, '').trim();
        if (!rest) { errors.push(`第 ${i+1} 行缺少密码: ${raw.substring(0,40)}`); continue; }
        if (seen.has(email.toLowerCase())) { errors.push(`第 ${i+1} 行邮箱重复: ${email}`); continue; }
        seen.add(email.toLowerCase());
        accts.push({ email, password: rest, authMethod });
        continue;
      }

      // ── 优先级4：中文格式"邮箱：xxx 密码：xxx"或多行 ─────────────
      const cnEmail = raw.match(/邮箱[：:]\s*(\S+)/);
      if (cnEmail) {
        const email = cnEmail[1].trim();
        const cnPwd = raw.match(/(?:密码|[Pp]assword)[：:]\s*(\S+)/);
        if (cnPwd) {
          const password = cnPwd[1].trim();
          if (seen.has(email.toLowerCase())) { errors.push(`第 ${i+1} 行邮箱重复`); continue; }
          seen.add(email.toLowerCase());
          accts.push({ email, password, authMethod });
          continue;
        }
        // 密码在下一行
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          const pwdMatch = nextLine.match(/(?:密码|[Pp]assword)[：:]\s*(\S+)/);
          if (pwdMatch) {
            const password = pwdMatch[1].trim();
            if (seen.has(email.toLowerCase())) { errors.push(`第 ${i+1} 行邮箱重复`); i++; continue; }
            seen.add(email.toLowerCase());
            accts.push({ email, password, authMethod });
            i++; continue;
          }
        }
      }

      errors.push(`第 ${i+1} 行格式无法识别: ${raw.substring(0, 40)}`);
    }
    const batchTagEl = document.getElementById('batchTag');
    const batchTag = batchTagEl ? batchTagEl.value.trim() : '';
    if (batchTag) accts.forEach(a => { a.tag = batchTag; a.tags = [batchTag]; });
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
    const rows = Array.isArray(data) ? data : (Array.isArray(data.accounts) ? data.accounts : null);
    if (!rows) {
      setBatchMsg('JSON 必须是数组，或 { accounts: [...] } 格式', true);
      return;
    }
    const accts = [];
    const errors = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      if (!item.email || (!item.password && !item.apiKey && !item.token)) { errors.push(`第 ${i+1} 项缺少 email/password、apiKey 或 token`); continue; }
      const em = String(item.email).trim().toLowerCase();
      if (seen.has(em)) { errors.push(`第 ${i+1} 项邮箱重复: ${item.email}`); continue; }
      seen.add(em);
      const itemTags = Array.isArray(item.tags) ? item.tags.map(t => String(t).trim()).filter(Boolean) : (item.tag ? [String(item.tag).trim()] : undefined);
      if (item.apiKey) {
        accts.push({
          email: String(item.email).trim(),
          apiKey: String(item.apiKey).trim(),
          apiServerUrl: String(item.apiServerUrl || 'https://server.self-serve.windsurf.com').trim(),
          name: item.name ? String(item.name).trim() : undefined,
          tag: itemTags ? itemTags[0] : undefined,
          tags: itemTags,
          disabled: item.disabled === true,
        });
      } else if (item.token) {
        accts.push({ token: String(item.token).trim(), tag: itemTags ? itemTags[0] : undefined, tags: itemTags });
      } else {
        accts.push({ email: String(item.email).trim(), password: String(item.password).trim() });
      }
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

  async function doBatchImportDevin() {
    if (batchBusy) return;
    const textarea = document.getElementById('batchDevinText');
    if (!textarea || !textarea.value.trim()) {
      setBatchMsg('请输入 Devin Session Token', true);
      return;
    }
    const lines = textarea.value.trim().split('\n').filter(l => l.trim());
    const accts = [];
    const errors = [];
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;
      const auth1Inline = line.match(/\b(auth1_[A-Za-z0-9_]+)/);
      if (auth1Inline) {
        line = auth1Inline[1];
      }
      // 自动补前缀
      if (!line.startsWith('auth1_') && !line.startsWith('devin-session-token$')) {
        // 如果粘的是纯 JWT，自动加前缀
        if (line.startsWith('eyJ')) {
          line = 'devin-session-token$' + line;
        } else {
          errors.push(`第 ${i+1} 行格式错误（需以 auth1_、devin-session-token$ 或 eyJ 开头）`);
          continue;
        }
      }
      const tokenKey = line.trim();
      if (seen.has(tokenKey)) { errors.push(`第 ${i+1} 行 token 重复`); continue; }
      seen.add(tokenKey);
      accts.push({ token: line });
    }
    const batchTagEl = document.getElementById('batchTag');
    const batchTag = batchTagEl ? batchTagEl.value.trim() : '';
    if (batchTag) accts.forEach(a => { a.tag = batchTag; a.tags = [batchTag]; });
    const { fresh, skipped } = filterExistingAccounts(accts);
    if (fresh.length === 0) {
      const msg = skipped.length ? `所有 ${skipped.length} 个 token 已存在` : (errors.length ? errors.join('\n') : '未解析到有效 token');
      setBatchMsg(msg, true);
      showBatchModal('Devin Token 导入');
      finalizeBatchModal('Devin Token 导入', [], { skipped: skipped.length, parseFail: errors.length });
      return;
    }
    setBatchBusy(true, '[data-action="batchImportDevin"]');
    try {
      await sendBatchAccounts(fresh, { skipped: skipped.length, parseFail: errors.length });
    } finally {
      setBatchBusy(false, '[data-action="batchImportDevin"]');
    }
  }

  function updateTextPlaceholder(delim, authMethod) {
    const ta = document.getElementById('batchText');
    const hint = document.querySelector('#batchTextArea .batch-hint');
    if (!(ta instanceof HTMLTextAreaElement)) return;
    let d = delim || 'smart';
    if (d === 'smart') d = '----';
    if (d === '\\t') d = '\t';
    if (d === 'custom') d = '<自定义>';
    const am = authMethod || 'auto';
    if (am === 'auth1') {
      ta.placeholder = `user1@example.com${d}password123\nuser2@example.com${d}abc456789\n邮箱：xxx 密码：xxx\nauth1_xxxx... 或 devin-session-token$eyJ...`;
      if (hint) hint.textContent = '智能识别多种格式，直接粘贴即可';
    } else if (am === 'firebase') {
      ta.placeholder = `user1@example.com${d}password123\nuser2@example.com${d}abc456789\n邮箱：xxx 密码：xxx`;
      if (hint) hint.textContent = '智能识别多种格式，直接粘贴即可';
    } else {
      ta.placeholder = `user1@example.com${d}password123\nuser2@example.com${d}abc456789\n邮箱：xxx 密码：xxx\nauth1_xxxx... 或 devin-session-token$eyJ...`;
      if (hint) hint.textContent = '智能识别多种格式，直接粘贴即可';
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

  // ── 配额历史 ──

  let _qhEntries = [];
  let _qhEmails = [];
  let _qhFilterEmail = '';
  let _qhCurrentEmail = '';
  let _qhInitialized = false;

  function renderQuotaHistory(entries, emails, currentEmail) {
    _qhEntries = entries || [];
    _qhEmails = emails || [];
    if (currentEmail !== undefined) _qhCurrentEmail = currentEmail;

    // 更新账号下拉
    const sel = document.getElementById('qhEmailFilter');
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = '<option value="">全部账号</option>';
      for (const em of _qhEmails) {
        const opt = document.createElement('option');
        opt.value = em;
        opt.textContent = em.length > 28 ? em.slice(0, 14) + '…' + em.slice(-12) : em;
        sel.appendChild(opt);
      }
      // 首次加载：默认选当前活跃账号（而非全部混在一起）
      if (!_qhInitialized && _qhCurrentEmail && _qhEmails.includes(_qhCurrentEmail)) {
        sel.value = _qhCurrentEmail;
        _qhInitialized = true;
      } else {
        sel.value = prev || '';
      }
      _qhFilterEmail = sel.value;
    }

    const filtered = _qhFilterEmail
      ? _qhEntries.filter(e => e.email === _qhFilterEmail)
      : _qhEntries;

    const emptyEl = document.getElementById('qhEmpty');
    const listEl = document.getElementById('qhCardList');
    const chartWrap = document.getElementById('qhChartWrap');
    if (filtered.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      if (listEl) listEl.style.display = 'none';
      if (chartWrap) chartWrap.style.display = 'none';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.style.display = '';
    if (chartWrap) chartWrap.style.display = '';

    // 渲染卡片列表（最新在上）
    if (listEl) {
      const items = filtered.slice().reverse().slice(0, 50);
      listEl.innerHTML = '';
      for (let idx = 0; idx < items.length; idx++) {
        const e = items[idx];
        const card = document.createElement('div');
        card.className = 'qh-card';

        const d = new Date(e.ts);
        const timeStr = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
        const dateStr = String(d.getMonth()+1) + '/' + String(d.getDate());
        const shortEmail = e.email.length > 24 ? e.email.slice(0, 10) + '…' + e.email.slice(-10) : e.email;

        // 头部：时间 + 账号
        const header = document.createElement('div');
        header.className = 'qh-card-header';
        header.innerHTML = '<span class="qh-card-time">' + dateStr + ' ' + timeStr + '</span>'
          + (_qhFilterEmail ? '' : '<span class="qh-card-email" title="' + e.email.replace(/"/g, '&quot;') + '">' + shortEmail + '</span>');
        card.appendChild(header);

        // 日配额行
        const dailyRow = document.createElement('div');
        dailyRow.className = 'qh-card-row';
        const dClass = e.daily <= 10 ? 'qh-bar-danger' : e.daily <= 30 ? 'qh-bar-warn' : 'qh-bar-ok';
        const dDeltaStr = e.dDelta !== 0 ? ('<span class="' + (e.dDelta < 0 ? 'qh-delta-neg' : 'qh-delta-pos') + '">' + (e.dDelta > 0 ? '+' : '') + e.dDelta + '</span>') : '';
        dailyRow.innerHTML = '<span class="qh-card-label">日</span>'
          + '<div class="qh-bar"><div class="qh-bar-fill ' + dClass + '" style="width:' + Math.max(1, e.daily) + '%"></div></div>'
          + '<span class="qh-card-pct">' + e.daily + '%</span>'
          + dDeltaStr;
        card.appendChild(dailyRow);

        // 周配额行
        const weeklyRow = document.createElement('div');
        weeklyRow.className = 'qh-card-row';
        const wClass = e.weekly <= 10 ? 'qh-bar-danger' : e.weekly <= 30 ? 'qh-bar-warn' : 'qh-bar-ok';
        const wDeltaStr = e.wDelta !== 0 ? ('<span class="' + (e.wDelta < 0 ? 'qh-delta-neg' : 'qh-delta-pos') + '">' + (e.wDelta > 0 ? '+' : '') + e.wDelta + '</span>') : '';
        weeklyRow.innerHTML = '<span class="qh-card-label">周</span>'
          + '<div class="qh-bar"><div class="qh-bar-fill ' + wClass + '" style="width:' + Math.max(1, e.weekly) + '%"></div></div>'
          + '<span class="qh-card-pct">' + e.weekly + '%</span>'
          + wDeltaStr;
        card.appendChild(weeklyRow);

        // 底部：重置时间 + 倒计时
        if (e.resetAt > 0) {
          const footer = document.createElement('div');
          footer.className = 'qh-card-footer';
          const r = new Date(e.resetAt * 1000);
          const resetStr = String(r.getMonth()+1) + '/' + String(r.getDate()) + ' ' + String(r.getHours()).padStart(2,'0') + ':' + String(r.getMinutes()).padStart(2,'0');
          const remainMs = e.resetAt * 1000 - Date.now();
          let countdownStr = '';
          if (remainMs > 0) {
            const h = Math.floor(remainMs / 3600000);
            const m = Math.floor((remainMs % 3600000) / 60000);
            countdownStr = '<span class="qh-countdown">' + h + 'h' + String(m).padStart(2,'0') + 'm</span>';
          } else {
            countdownStr = '<span class="qh-countdown qh-expired">已重置</span>';
          }
          footer.innerHTML = '<span class="qh-reset-label">重置</span><span class="qh-reset-time">' + resetStr + '</span>' + countdownStr;
          card.appendChild(footer);
        }

        listEl.appendChild(card);
      }
    }

    // 渲染折线图
    renderQuotaChart(filtered);
  }

  function renderQuotaChart(entries) {
    const svg = document.getElementById('qhChart');
    if (!svg || entries.length < 2) {
      if (svg) svg.innerHTML = '';
      return;
    }

    const W = 300, H = 80, PAD = 4;
    const n = entries.length;
    const xStep = n > 1 ? (W - PAD * 2) / (n - 1) : 0;

    // 日配额折线
    let dailyPts = '';
    let weeklyPts = '';
    for (let i = 0; i < n; i++) {
      const x = PAD + i * xStep;
      const yD = PAD + (100 - entries[i].daily) / 100 * (H - PAD * 2);
      const yW = PAD + (100 - entries[i].weekly) / 100 * (H - PAD * 2);
      dailyPts += `${x},${yD} `;
      weeklyPts += `${x},${yW} `;
    }

    svg.innerHTML = `
      <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(255,255,255,0.02)" rx="4"/>
      <line x1="${PAD}" y1="${PAD + (100-30)/100*(H-PAD*2)}" x2="${W-PAD}" y2="${PAD + (100-30)/100*(H-PAD*2)}" stroke="rgba(255,200,50,0.15)" stroke-dasharray="3,3"/>
      <line x1="${PAD}" y1="${PAD + (100-10)/100*(H-PAD*2)}" x2="${W-PAD}" y2="${PAD + (100-10)/100*(H-PAD*2)}" stroke="rgba(255,80,80,0.15)" stroke-dasharray="3,3"/>
      <polyline points="${dailyPts}" fill="none" stroke="#5b9aff" stroke-width="1.5" stroke-linejoin="round"/>
      <polyline points="${weeklyPts}" fill="none" stroke="#ff9a5b" stroke-width="1.5" stroke-linejoin="round"/>
      <text x="${W-PAD}" y="${PAD+8}" font-size="8" fill="#5b9aff" text-anchor="end">日</text>
      <text x="${W-PAD}" y="${PAD+17}" font-size="8" fill="#ff9a5b" text-anchor="end">周</text>
    `;
  }

  // 绑定账号筛选
  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('qhEmailFilter');
    if (sel) {
      sel.addEventListener('change', () => {
        _qhFilterEmail = sel.value;
        vscode.postMessage({ type: 'getQuotaHistory', email: _qhFilterEmail || undefined });
      });
    }
  });

  // 多标签选择器（需在 syncAutoSwitchUI 之前定义）
  function renderTagPicker() {
    const picker = document.getElementById('asTagPicker');
    const optionsEl = document.getElementById('asTagOptions');
    const selectedEl = document.getElementById('asTagSelected');
    if (!picker || !optionsEl || !selectedEl) return;

    const isTag = autoSwitchPoolScope === 'tag';
    picker.style.display = isTag ? '' : 'none';
    if (!isTag) return;

    const allTags = getTagList();
    const selectedSet = new Set(autoSwitchPoolTags);

    // 可选标签（点击添加）
    optionsEl.innerHTML = allTags
      .filter(t => !selectedSet.has(t))
      .map(t => `<span class="as-tag-opt" data-tag="${escHtml(t)}">${escHtml(t)}</span>`)
      .join('');
    if (allTags.length === 0) {
      optionsEl.innerHTML = '<span style="color:var(--muted);font-size:11px">暂无标签，请先给账号添加标签</span>';
    } else if (optionsEl.innerHTML === '') {
      optionsEl.innerHTML = '<span style="color:var(--muted);font-size:11px">已全部选择</span>';
    }

    // 已选标签（点击移除）
    selectedEl.innerHTML = autoSwitchPoolTags.length === 0
      ? '<span style="color:var(--muted);font-size:11px">未选择标签，将使用全部账号</span>'
      : autoSwitchPoolTags.map(t => `<span class="as-tag-chip" data-tag="${escHtml(t)}">${escHtml(t)} ×</span>`).join('');

    // 绑定点击事件
    optionsEl.querySelectorAll('.as-tag-opt').forEach(el => {
      el.addEventListener('click', () => {
        const tag = el.dataset.tag;
        if (tag && !autoSwitchPoolTags.includes(tag)) {
          autoSwitchPoolTags.push(tag);
          autoSwitchPoolTagsDirty = true;
          renderTagPicker();
          // 直接走轻量专用消息保存（绕过 autoSwitchSettings 大 payload 丢失问题）
          postMsg('savePoolTags', { poolTags: [...autoSwitchPoolTags] });
        }
      });
    });
    selectedEl.querySelectorAll('.as-tag-chip').forEach(el => {
      el.addEventListener('click', () => {
        const tag = el.dataset.tag;
        autoSwitchPoolTags = autoSwitchPoolTags.filter(t => t !== tag);
        autoSwitchPoolTagsDirty = true;
        renderTagPicker();
        postMsg('savePoolTags', { poolTags: [...autoSwitchPoolTags] });
      });
    });
  }

  function syncAutoSwitchUI() {
    if (asEnabledEl) asEnabledEl.checked = autoSwitchEnabled;
    if (asThresholdEl) asThresholdEl.value = autoSwitchThreshold;
    const asCooldownEl = document.getElementById('asCooldown');
    if (asCooldownEl) asCooldownEl.value = autoSwitchCooldownSec;
    // 刷新频率（位于 Windsurf 增强面板）
    const enhRefCurEl = document.getElementById('enhRefreshCurrent');
    const enhRefAllEl = document.getElementById('enhRefreshAll');
    const enhRefreshConcurrencyEl = document.getElementById('enhRefreshConcurrency');
    const enhRefreshBatchDelayEl = document.getElementById('enhRefreshBatchDelay');
    const enhPeriodRefreshHoursEl = document.getElementById('enhPeriodRefreshHours');
    if (enhRefCurEl) enhRefCurEl.value = autoSwitchCheckSec;
    if (enhRefAllEl) enhRefAllEl.value = autoSwitchRefreshMin;
    if (enhRefreshConcurrencyEl) enhRefreshConcurrencyEl.value = autoSwitchRefreshConcurrency;
    if (enhRefreshBatchDelayEl) enhRefreshBatchDelayEl.value = autoSwitchRefreshBatchDelayMs;
    if (enhPeriodRefreshHoursEl) enhPeriodRefreshHoursEl.value = autoSwitchPeriodRefreshHours;
    const asScoreModeEl = document.getElementById('asScoreMode');
    if (asScoreModeEl) asScoreModeEl.value = autoSwitchScoreMode;
    updateScoreModeHint();
    const asPoolScopeEl = document.getElementById('asPoolScope');
    if (asPoolScopeEl) asPoolScopeEl.value = autoSwitchPoolScope;
    renderTagPicker();
  }

  const SCORE_MODE_HINTS = {
    min: '取日/周配额中较低者评分（推荐）。例：日100% 周0% → 评分0%，自动切号。',
    daily: '仅看日配额评分。安全兜底：周配额 ≤ 额度下限时仍会强制切号。',
    weekly: '仅看周配额评分。安全兜底：日配额 ≤ 额度下限时仍会强制切号。',
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

  function refreshAll(force = true, showSpinner = true) {
    // 通知后端全量刷新（后端分批限流，结果通过 usage 消息逐个推送）
    postMsg('refreshAllUsage', { force });
    if (showSpinner && refreshAllBtn) {
      refreshAllBtn.classList.add('is-spinning');
      refreshAllBtn._pendingCount = accounts.length || 1;
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
        switchingEmail = email;
        renderCards();
        postMsg('switch', { email });
        break;
      case 'forceSwitch':
        switchingEmail = email;
        renderCards();
        postMsg('switch', { email, force: true });
        break;
      case 'refresh':
        postMsg('fetchUsageFor', { email });
        { const refreshBtn = card.querySelector('[data-action="refresh"]');
          if (refreshBtn) refreshBtn.classList.add('is-spinning'); }
        break;
      case 'delete': {
        // 淡出动画后发送删除消息（原版风格，无 confirm 弹窗）
        card.style.transition = 'opacity 0.2s, transform 0.2s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => postMsg('delete', { email }), 200);
        break;
      }
      case 'editTag': {
        openTagEditModal('edit', email);
        break;
      }
      case 'filterTag': {
        const chipEl = target.closest('[data-tag]');
        const tag = chipEl?.dataset.tag;
        if (!tag) break;
        if (filterTags.has(tag)) filterTags.delete(tag);
        else filterTags.add(tag);
        persistTagFilters();
        currentPage = 1;
        const dropdown = document.getElementById('filterDropdown');
        if (dropdown && !dropdown.hidden) buildFilterDropdown();
        renderTagBar();
        renderCards();
        break;
      }
      case 'toggleDisabled': {
        postMsg('toggleDisabled', { email });
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
    const tag = $('#loginTag')?.value?.trim() || '';
    postMsg('loginSave', { email, password, authMethod, tag });
  }

  // ==================== 消息监听 ====================
  function handleAccountsChanged(newAccounts, newLastEmail, newExternalAccount) {
    const accountsChanged = newAccounts.length !== accounts.length || newAccounts.some((a, i) => a.email !== accounts[i]?.email);
    accounts = newAccounts;
    lastEmail = newLastEmail;
    externalAccount = newExternalAccount || '';
    // 自动清除无效过滤器：如果过滤器激活但 0 条匹配，清掉过时状态
    const totalFilters = filterPlans.size + filterTags.size + filterStatuses.size + filterHealth.size;
    if (totalFilters > 0 && accounts.length > 0 && accounts.filter(a => passesFilter(a)).length === 0) {
      filterPlans.clear();
      filterTags.clear();
      filterStatuses.clear();
      filterHealth.clear();
      try { const st = vscode.getState() || {}; st._filterPlans = []; st._filterTags = []; st._filterStatuses = []; st._filterHealth = []; vscode.setState(st); } catch {}
    }
    renderCards();
    // 账号数据到达后重新渲染标签选择器（修复时序问题：settingsSync 先到，accounts 后到时标签列表为空）
    renderTagPicker();
    // 更新外部账户提示条
    const banner = document.getElementById('externalBanner');
    if (banner) {
      banner.hidden = !externalAccount;
      setExternalEmailText();
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
        lockedEmails = new Set(msg.lockedEmails || []);
        lockedEmailsMap = msg.lockedEmailsMap || {};
        handleAccountsChanged(msg.accounts, msg.lastEmail, msg.externalAccount);
        // 批量模式下，accountsChanged 仅刷新 UI，不再驱动队列推进
        // 队列推进改由后端的 batchResult 消息驱动（更准确）
        break;

      case 'usage': {
        const { email, snapshot, error } = msg;
        if (!email) break;
        if (snapshot) maybeDowngradeTemporaryHealth(email, snapshot);
        usageCache.set(email, { snapshot: snapshot || null, error, ts: Date.now() });
        lastRefreshTime = Date.now();
        persistState();
        const card = accountGrid?.querySelector(`[data-email="${cssEscape(email)}"]`);
        if (card && snapshot) {
          updateCard(card, snapshot);
        } else if (card && error) {
          const errEl = card.querySelector('.grid-card-error');
          if (errEl) { errEl.textContent = error; errEl.hidden = false; }
        }
        // 刷新完成：停止单卡转圈
        if (card) { const rb = card.querySelector('[data-action="refresh"]'); if (rb) rb.classList.remove('is-spinning'); }
        // 刷新完成：refreshAll 计数递减，到 0 停转
        if (refreshAllBtn?.classList.contains('is-spinning')) {
          refreshAllBtn._pendingCount = Math.max(0, (refreshAllBtn._pendingCount || 1) - 1);
          if (refreshAllBtn._pendingCount <= 0) refreshAllBtn.classList.remove('is-spinning');
        }
        // 新额度到达后防抖重排（按日配额降序）
        scheduleRerender();
        break;
      }

      case 'batchResult': {
        if (globalThis._wsBatchMode) {
          handleBatchItemResult(msg.email, msg.ok, msg.error);
        }
        break;
      }

      case 'oauthStatus': {
        const el = document.getElementById('oauthMsg');
        if (el) {
          el.hidden = false;
          el.textContent = msg.message || (msg.ok ? 'OAuth 导入成功' : 'OAuth 导入失败');
          el.className = 'batch-msg ' + (msg.ok === false ? 'is-error' : 'is-ok');
        }
        if (msg.ok) showToast(msg.message || 'OAuth 导入成功', 'success', 3500);
        else if (msg.ok === false) showToast(msg.message || 'OAuth 导入失败', 'error', 8000);
        else showToast(msg.message || '正在打开 OAuth 授权页…', 'info', 3000);
        break;
      }

      case 'exportAccountsResult': {
        if (msg.ok) {
          showToast(msg.message || `已导出 ${msg.count || 0} 个账号设置`, 'success', 6000);
        } else {
          showToast(msg.message || '导出账号设置失败', 'error', 8000);
        }
        break;
      }

      case 'switchResult': {
        const { email, ok, reason, kind, ts } = msg;
        switchingEmail = '';
        if (email) {
          if (ok) {
            switchIssueCache.delete(email);
            showToast('已切换：' + displayEmail(email), 'success', 1800);
          } else {
            switchIssueCache.set(email, { reason: reason || '切换失败', kind: kind || 'error', ts: ts || Date.now() });
            // blocked 类型（限速/额度不足）：用 toast 通知（sidebar 不弹 showAlert）
            // 非 blocked 类型（补丁/异常）：由 sidebar 的 showAlert 模态弹窗处理，不重复 toast
            if (kind === 'blocked') {
              showToast(displayEmail(email) + ' 暂不可用：' + (reason || '额度不足'), 'warning', 5000, 'switch-unavailable');
            }
          }
        }
        renderCards();
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
        autoSwitchStrategy = msg.switchStrategy || 'highestFirst';
        autoSwitchMinQuota = msg.minQuota ?? 10;
        autoSwitchPreferUsedThreshold = msg.preferUsedThreshold ?? 50;
        autoSwitchPoolScope = msg.poolScope || 'all';
        // 仅在本地未修改时才接受后端的 poolTags（避免后端旧值覆盖本地新选择）
        if (!autoSwitchPoolTagsDirty) {
          autoSwitchPoolTags = msg.poolTags || [];
        }
        autoSwitchRefreshMin = msg.refreshMin || 5;
        autoSwitchRefreshConcurrency = msg.refreshConcurrency || 12;
        autoSwitchRefreshBatchDelayMs = msg.refreshBatchDelayMs ?? 250;
        autoSwitchPeriodRefreshHours = msg.periodRefreshHours ?? 6;
        autoSwitchSynced = true;
        syncAutoSwitchUI();
        syncStrategyUI();
        const asDetailsSync = document.getElementById('asDetails');
        if (asDetailsSync) { if (autoSwitchEnabled) asDetailsSync.setAttribute('open', ''); else asDetailsSync.removeAttribute('open'); }
        break;
      }

      case 'poolTagsSaved': {
        // 后端确认 poolTags 已保存，清除 dirty 标记
        autoSwitchPoolTagsDirty = false;
        break;
      }

      case 'usageStatsSync': {
        updateUsageStatsUI(msg);
        break;
      }

      case 'testModelResult': {
        const entry = {
          ok: msg.ok,
          reason: msg.reason,
          ts: msg.ts || Date.now(),
          testing: !!msg.testing,
        };
        healthCheckCache.set(msg.email, normalizeHealthEntry(msg.email, entry));
        // 交叉检查：如果显示限速但已有配额数据显示正常，自动清除
        if (!entry.ok && !entry.testing) {
          const cached = usageCache.get(msg.email);
          if (cached && cached.snapshot) {
            maybeDowngradeTemporaryHealth(msg.email, cached.snapshot);
          }
        }
        renderCards();
        updateFilterLabel();
        const dropdown = document.getElementById('filterDropdown');
        if (dropdown && !dropdown.hidden) buildFilterDropdown();
        break;
      }

      case 'testModelAllDone': {
        healthCheckBusy = false;
        renderCards();
        updateFilterLabel();
        const dropdown = document.getElementById('filterDropdown');
        if (dropdown && !dropdown.hidden) buildFilterDropdown();
        break;
      }

      case 'diagnosticSync': {
        applyDiagnosticSync(msg.latest);
        break;
      }

      case 'quotaHistorySync': {
        renderQuotaHistory(msg.entries, msg.emails, msg.currentEmail);
        break;
      }

      case 'enhancementStatus': {
        updateEnhancementUI(msg);
        break;
      }

      case 'audioFileSelected': {
        if (enhAudioFile && msg.path) {
          enhAudioFile.value = msg.path;
          saveEnhanceSettings();
        }
        break;
      }

      case 'enhLoaded': {
        // 后端返回真相源设置 → 应用到 UI + 缓存
        if (msg.settings) {
          try { localStorage.setItem('ws-better-settings', JSON.stringify(msg.settings)); } catch {}
          applyEnhSettingsToUI(msg.settings);
          if (typeof updateBubblePreview === 'function') updateBubblePreview();
        }
        break;
      }

      case 'tagColorsSync': {
        // 从 globalState 同步标签颜色（跨实例共享）
        if (msg.colors && typeof msg.colors === 'object') {
          // 合并：globalState 为底，本地 localStorage 覆盖（用户本地修改优先）
          const merged = { ...msg.colors, ...tagColors };
          // 如果本地无自定义（空对象），直接采纳 globalState
          if (Object.keys(tagColors).length === 0) {
            tagColors = msg.colors;
          } else {
            tagColors = merged;
          }
          try { localStorage.setItem('ws-pool-tag-colors', JSON.stringify(tagColors)); } catch(e) {}
          renderAccounts();
        }
        break;
      }

      case 'enhSaved': {
        // 后端确认设置已写盘且 workbench 已重新注入；banner 已在保存时弹出
        break;
      }

      case 'enhCommandResult': {
        // bridge HTTP server 收到 windsurf-better.js 的执行结果，转发给 webview
        if (msg.result) handleCommandResult(msg.result);
        break;
      }

      case 'ltStateUpdate': {
        // 长任务状态更新（从 bridge/扩展侧推送）
        if (msg.state === 'stopped' || msg.state === 'idle') {
          _ltRunning = false;
        }
        updateLtState(msg.state || 'idle', { label: msg.label, count: msg.count, action: msg.action, reason: msg.reason });
        break;
      }

      case 'acStatsUpdate': {
        updateAcStats(msg.stats || {});
        break;
      }
    }
  });

  // ==================== Windsurf 增强 UI ====================
  function updateEnhancementUI(msg) {
    const { injected, patchVersion, extensionVersion, enabled, autoRecovery } = msg;

    // 按钮状态
    if (enhanceToggleBtn) {
      enhanceToggleBtn.textContent = enabled ? '已启用' : '未启用';
      enhanceToggleBtn.className = 'enhance-toggle-btn' + (enabled ? ' is-on' : '');
    }

    // 增强脚本注入状态
    if (enhanceScriptStatus) {
      enhanceScriptStatus.className = 'enhance-value';
      if (injected) {
        enhanceScriptStatus.textContent = 'v' + patchVersion + '  ✓ 已注入';
        enhanceScriptStatus.classList.add('is-ok');
      } else {
        enhanceScriptStatus.textContent = '✗ 未注入';
        enhanceScriptStatus.classList.add('is-err');
      }
    }

    // 智能建议规则状态
    if (enhanceBubbleRules) {
      enhanceBubbleRules.className = 'enhance-value';
      if (msg.bubbleRulesInjected) {
        enhanceBubbleRules.textContent = '✓ 已注入';
        enhanceBubbleRules.classList.add('is-ok');
      } else {
        enhanceBubbleRules.textContent = '✗ 未注入';
        enhanceBubbleRules.classList.add('is-err');
      }
    }

    // 无感切号（信号桥）状态 —— 只看脚本是否注入，不依赖增强开关
    const enhanceSignalBridge = $('#enhanceSignalBridge');
    if (enhanceSignalBridge) {
      enhanceSignalBridge.className = 'enhance-value';
      if (msg.signalBridgeActive) {
        enhanceSignalBridge.textContent = '✓ 已就绪';
        enhanceSignalBridge.classList.add('is-ok');
      } else {
        enhanceSignalBridge.textContent = '✗ 未注入';
        enhanceSignalBridge.classList.add('is-err');
      }
    }

    // 功能标签
    const isActive = injected && enabled;
    [featLocalization, featBubbles].forEach(el => {
      if (el) el.className = 'enhance-feat' + (isActive ? ' is-on' : '');
    });
    if (featAutoRecovery) {
      featAutoRecovery.className = 'enhance-feat' + (isActive && autoRecovery ? ' is-on' : '');
    }
    if (featSignalBridge) {
      featSignalBridge.className = 'enhance-feat' + (isActive && autoRecovery ? ' is-on' : '');
    }
  }

  // ==================== 命令通信 & 测试 ====================

  let _cmdIdCounter = 0;
  function sendCommand(action, extra) {
    // 走扩展宿主 → bridge HTTP server → windsurf-better.js 轮询取走
    const id = ++_cmdIdCounter;
    const payload = extra || {};
    try { vscode.postMessage({ type: 'enhCommand', id, action, payload }); } catch {}
    return id;
  }

  function showTestResult(el, status, message) {
    if (!el) return;
    el.className = 'test-result show ' + status;
    el.textContent = message;
    if (status !== 'running') {
      setTimeout(() => { el.className = 'test-result'; }, 5000);
    }
  }

  // 处理命令结果（由扩展宿主通过 'enhCommandResult' 消息推过来）
  function handleCommandResult(result) {
    if (!result) return;

    // 获取模型列表结果
    if (result.action === 'fetch-models') {
      if (fetchModelsBtn) {
        fetchModelsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>获取列表';
        fetchModelsBtn.disabled = false;
      }
      if (result.status === 'done') {
        updateCurrentModelCard(result.currentModel || '-');
        if (result.models && result.models.length > 0) {
          renderAvailableModels(result.models);
        } else {
          showMsResult(testSwitchModelResult, 'error', '未检测到可用模型');
        }
      } else if (result.status === 'error') {
        showMsResult(testSwitchModelResult, 'error', result.message || '获取失败');
      }
    }

    // 获取当前模型结果
    if (result.action === 'get-current-model' && result.status === 'done') {
      updateCurrentModelCard(result.currentModel || '-');
    }

    // 测试切换模型结果
    if (result.action === 'test-switch-model') {
      showMsResult(testSwitchModelResult, result.status === 'done' ? 'success' : (result.status === 'running' ? 'running' : 'error'), result.message || '');
      if (result.newModel) updateCurrentModelCard(result.newModel);
    }

    // 测试重试结果
    if (result.action === 'test-retry') {
      showTestResult(testRetryResult, result.status === 'done' ? 'success' : 'error', result.message || '');
    }

    // 测试发送 continue 结果
    if (result.action === 'test-send-continue') {
      showTestResult(testSendContinueResult, result.status === 'done' ? 'success' : 'error', result.message || '');
    }

    // 测试切号结果
    if (result.action === 'test-switch-account') {
      showTestResult(testSwitchAccountResult, result.status === 'done' ? 'success' : (result.status === 'running' ? 'running' : 'error'), result.message || '');
    }

    // 测试权限检测结果
    if (result.action === 'test-permission') {
      showTestResult(testPermissionResult, result.status === 'done' ? 'success' : 'error', result.message || '');
    }
  }

  // ==================== 模型切换 UI 辅助 ====================

  function getModelBrandClass(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('claude') || n.includes('sonnet') || n.includes('opus') || n.includes('haiku')) return 'ms-brand-claude';
    if (n.includes('gpt') || n.includes('openai') || n.includes('o1') || n.includes('o3') || n.includes('o4')) return 'ms-brand-gpt';
    if (n.includes('deepseek') || n.includes('deep-seek')) return 'ms-brand-deepseek';
    if (n.includes('gemini') || n.includes('google')) return 'ms-brand-gemini';
    if (n.includes('kimi') || n.includes('moonshot')) return 'ms-brand-kimi';
    return 'ms-brand-default';
  }

  function getModelIcon(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('claude') || n.includes('sonnet') || n.includes('opus') || n.includes('haiku')) return '◈';
    if (n.includes('gpt') || n.includes('openai')) return '◉';
    if (n.includes('deepseek')) return '◆';
    if (n.includes('gemini')) return '✦';
    if (n.includes('kimi')) return '◎';
    return '⚡';
  }

  function updateCurrentModelCard(modelName) {
    if (currentModelName) currentModelName.textContent = modelName;
    const card = document.getElementById('msCurrentCard');
    const icon = document.getElementById('msCurrentIcon');
    if (card) {
      card.className = 'ms-current ' + getModelBrandClass(modelName);
    }
    if (icon) icon.textContent = getModelIcon(modelName);
  }

  function showMsResult(el, type, msg) {
    if (!el) return;
    el.className = 'ms-result ' + (type === 'success' ? 'ok' : type);
    el.textContent = msg;
    if (type === 'success' || type === 'error') {
      setTimeout(() => { el.className = 'ms-result'; el.textContent = ''; }, 6000);
    }
  }

  function updatePriorityBadge() {
    const badge = document.getElementById('msPriorityCount');
    if (badge) badge.textContent = getModelPriorityFromDOM().length;
  }

  function renderAvailableModels(models) {
    if (!availableModelsList) return;
    const currentPriority = getModelPriorityFromDOM();
    availableModelsList.style.display = 'flex';
    availableModelsList.innerHTML = '';
    models.forEach(name => {
      const row = document.createElement('div');
      const brand = getModelBrandClass(name);
      const isSelected = currentPriority.some(p => name.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(name.toLowerCase()));
      row.className = 'available-model-row ' + brand + (isSelected ? ' selected' : '');
      row.innerHTML = '<span class="amr-brand-dot"></span><span class="amr-name">' + escHtml(name) + '</span><span class="amr-check">' + (isSelected ? '✓' : '') + '</span>';
      row.addEventListener('click', () => {
        if (row.classList.contains('selected')) {
          row.classList.remove('selected');
          row.querySelector('.amr-check').textContent = '';
          const items = getModelPriorityFromDOM().filter(m => !name.toLowerCase().includes(m.toLowerCase()) && !m.toLowerCase().includes(name.toLowerCase()));
          renderModelPriority(items);
        } else {
          row.classList.add('selected');
          row.querySelector('.amr-check').textContent = '✓';
          const items = getModelPriorityFromDOM();
          items.push(name);
          renderModelPriority(items);
        }
        updatePriorityBadge();
        saveEnhanceSettings();
      });
      availableModelsList.appendChild(row);
    });
  }

  // ==================== 恢复规则辅助函数 ====================

  function collectRecoveryRules() {
    const scope = [];
    if (permScopeWeb && permScopeWeb.checked) scope.push('web-request');
    if (permScopeTerminal && permScopeTerminal.checked) scope.push('terminal');
    if (permScopeFile && permScopeFile.checked) scope.push('file-write');
    return {
      networkErrors: {
        action: ruleNetworkAction ? ruleNetworkAction.value : 'retry',
        maxRetries: ruleNetworkMaxRetries ? parseInt(ruleNetworkMaxRetries.value) || 3 : 3,
        delay: ruleNetworkDelay ? (parseInt(ruleNetworkDelay.value) || 3) * 1000 : 3000,
      },
      quotaErrors: {
        action: ruleQuotaAction ? ruleQuotaAction.value : 'switch-account',
        afterAction: ruleQuotaAfterAction ? ruleQuotaAfterAction.value : 'auto',
      },
      modelErrors: {
        action: ruleModelAction ? ruleModelAction.value : 'switch-model',
        afterAction: ruleModelAfterAction ? ruleModelAfterAction.value : 'send-continue',
        modelPriority: getModelPriorityFromDOM(),
      },
      continuationErrors: {
        action: ruleContinuationAction ? ruleContinuationAction.value : 'send-continue',
      },
      permissionRequests: {
        action: rulePermissionAction ? rulePermissionAction.value : 'auto-allow',
        scope,
      },
      userIntervention: {
        action: ruleUserAction ? ruleUserAction.value : 'notify',
      },
    };
  }

  function getModelPriorityFromDOM() {
    if (!modelPriorityList) return [];
    const items = modelPriorityList.querySelectorAll('.model-priority-item');
    return Array.from(items).map(el => el.dataset.model).filter(Boolean);
  }

  function renderModelPriority(models) {
    if (!modelPriorityList) return;
    modelPriorityList.innerHTML = '';
    models.forEach((model, i) => {
      const item = document.createElement('div');
      const brand = getModelBrandClass(model);
      item.className = 'model-priority-item ' + brand;
      item.draggable = true;
      item.dataset.model = model;
      item.innerHTML = '<span class="model-priority-rank">' + (i + 1) + '</span>'
        + '<span class="model-priority-name">' + escHtml(model) + '</span>'
        + '<button class="model-priority-remove" title="移除">&times;</button>';
      // 拖拽排序
      item.addEventListener('dragstart', e => {
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        modelPriorityList.querySelectorAll('.model-priority-item').forEach((el, idx) => {
          const rank = el.querySelector('.model-priority-rank');
          if (rank) rank.textContent = idx + 1;
        });
        saveEnhanceSettings();
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        const dragging = modelPriorityList.querySelector('.dragging');
        if (dragging && dragging !== item) {
          const rect = item.getBoundingClientRect();
          const after = e.clientY > rect.top + rect.height / 2;
          modelPriorityList.insertBefore(dragging, after ? item.nextSibling : item);
        }
      });
      // 移除
      item.querySelector('.model-priority-remove').addEventListener('click', () => {
        item.remove();
        modelPriorityList.querySelectorAll('.model-priority-item').forEach((el, idx) => {
          const rank = el.querySelector('.model-priority-rank');
          if (rank) rank.textContent = idx + 1;
        });
        updatePriorityBadge();
        saveEnhanceSettings();
      });
      modelPriorityList.appendChild(item);
    });
    updatePriorityBadge();
  }

  function collectCustomRules() {
    if (!customRulesList) return [];
    const items = customRulesList.querySelectorAll('.custom-rule-item');
    return Array.from(items).map(el => ({
      name: (el.querySelector('.custom-rule-name') || {}).value || '',
      pattern: (el.querySelector('.custom-rule-pattern') || {}).value || '',
      action: (el.querySelector('.custom-rule-action') || {}).value || 'retry',
      enabled: (el.querySelector('.custom-rule-enabled') || {}).checked !== false,
    }));
  }

  function renderCustomRules(rules) {
    if (!customRulesList) return;
    customRulesList.innerHTML = '';
    (rules || []).forEach((rule, i) => {
      const item = document.createElement('div');
      item.className = 'custom-rule-item';
      item.innerHTML = '<div class="custom-rule-header">'
        + '<input type="checkbox" class="custom-rule-enabled"' + (rule.enabled !== false ? ' checked' : '') + '>'
        + '<input type="text" class="enhance-select custom-rule-name" value="' + (rule.name || '') + '" placeholder="规则名称">'
        + '<button class="model-priority-remove custom-rule-remove" title="删除">&times;</button>'
        + '</div>'
        + '<div class="custom-rule-row">'
        + '<span class="enhance-option-label">匹配</span>'
        + '<input type="text" class="enhance-select custom-rule-pattern" value="' + (rule.pattern || '') + '" placeholder="错误文本正则...">'
        + '</div>'
        + '<div class="custom-rule-row">'
        + '<span class="enhance-option-label">动作</span>'
        + '<select class="enhance-select custom-rule-action">'
        + '<option value="retry"' + (rule.action === 'retry' ? ' selected' : '') + '>自动重试</option>'
        + '<option value="switch-account"' + (rule.action === 'switch-account' ? ' selected' : '') + '>切换账号</option>'
        + '<option value="switch-model"' + (rule.action === 'switch-model' ? ' selected' : '') + '>切换模型</option>'
        + '<option value="send-continue"' + (rule.action === 'send-continue' ? ' selected' : '') + '>发送继续</option>'
        + '<option value="notify"' + (rule.action === 'notify' ? ' selected' : '') + '>仅通知</option>'
        + '<option value="ignore"' + (rule.action === 'ignore' ? ' selected' : '') + '>忽略</option>'
        + '</select>'
        + '</div>';
      // 删除
      item.querySelector('.custom-rule-remove').addEventListener('click', () => {
        item.remove();
        saveEnhanceSettings();
      });
      // 变更自动保存
      item.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', saveEnhanceSettings);
      });
      customRulesList.appendChild(item);
    });
  }

  // ==================== 增强设置同步 ====================
  // 真相源：扩展宿主管理的 enh-settings.json（通过 postMessage 通信）
  // localStorage 仅作启动期回退；正常流程是：
  //   webview 启动 → postMessage('enhLoad') → 后端回 'enhLoaded' → applySettingsToUI
  //   控件改变 → saveEnhanceSettings → postMessage('enhSave') → 后端写盘+重新注入 → 回 'enhSaved'

  // 渲染队列列表 DOM
  function renderQueueList(queue) {
    if (!acQueueList) return;
    acQueueList.innerHTML = '';
    (queue || ['继续']).forEach((text, idx) => {
      const item = document.createElement('div');
      item.className = 'v2-queue-item';
      if (idx === 0) item.classList.add('is-active');
      item.dataset.idx = idx;
      item.innerHTML = '<span class="v2-queue-idx">' + (idx + 1) + '</span>'
        + '<input type="text" class="v2-queue-text ac-queue-input" value="' + (text || '').replace(/"/g, '&quot;') + '" placeholder="输入指令...">'
        + '<button class="ac-queue-del" title="删除" style="font-size:10px;opacity:0.5;cursor:pointer;background:none;border:none;color:inherit">✕</button>';
      item.querySelector('.ac-queue-del').addEventListener('click', () => {
        item.remove();
        if (!acQueueList.querySelector('.v2-queue-item')) renderQueueList(['继续']);
        saveEnhanceSettings();
      });
      item.querySelector('.ac-queue-input').addEventListener('blur', saveEnhanceSettings);
      acQueueList.appendChild(item);
    });
  }

  // 切换 Tab 面板显示
  function switchAcTab(tab) {
    if (acPanelGuardian) acPanelGuardian.style.display = tab === 'guardian' ? '' : 'none';
    if (acPanelLongTask) acPanelLongTask.style.display = tab === 'long-task' ? '' : 'none';
    // V2 segment slider
    const slider = $('#acSegmentSlider');
    if (slider) { tab === 'long-task' ? slider.classList.add('right') : slider.classList.remove('right'); }
  }

  // 切换总开关显示
  function toggleAcEnabled(enabled) {
    if (acOffHint) acOffHint.style.display = enabled ? 'none' : '';
    if (acOnContent) acOnContent.style.display = enabled ? '' : 'none';
  }

  // 长任务面板状态切换
  // state: 'idle' | 'running' | 'paused' | 'stopped' | 'handling'
  function updateLtState(state, extra) {
    const dotClasses = { idle: 'ac-dot-idle', running: 'ac-dot-running', paused: 'ac-dot-paused', stopped: 'ac-dot-stopped', handling: 'ac-dot-handling' };
    const labels = { idle: '就绪', running: '运行中', paused: '已暂停', stopped: '已停止', handling: '处理中断' };
    // V2: 保留 v2-lt-dot 基础类 + 状态类
    if (acStatusDot) { acStatusDot.className = 'v2-lt-dot ' + (dotClasses[state] || 'ac-dot-idle'); }
    const reason = extra && extra.reason;
    if (acStatusText) acStatusText.textContent = (extra && extra.label) || (state === 'stopped' && reason ? '已停止: ' + reason : labels[state]) || '就绪';
    // 计数
    if (acStatusCount) acStatusCount.style.display = (state === 'idle') ? 'none' : '';
    if (acContinueCount && extra && extra.count !== undefined) acContinueCount.textContent = extra.count;
    // 强制停止按钮
    if (acForceStopBtn) acForceStopBtn.disabled = (state === 'idle' || state === 'stopped');
    // 控制按钮
    const show = (el, v) => { if (el) el.style.display = v ? '' : 'none'; };
    if (state === 'idle' || state === 'stopped') {
      show(acStartBtn, true); show(acPauseBtn, false); show(acResumeBtn, false); show(acStopBtn, false);
      if (state === 'stopped' && acStartBtn) acStartBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg> 重新开始';
      else if (acStartBtn) acStartBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg> 开始运行';
    } else if (state === 'running' || state === 'handling') {
      show(acStartBtn, false); show(acPauseBtn, true); show(acResumeBtn, false); show(acStopBtn, true);
    } else if (state === 'paused') {
      show(acStartBtn, false); show(acPauseBtn, false); show(acResumeBtn, true); show(acStopBtn, true);
    }
    // 最近操作
    if (acLastAction && extra && extra.action) {
      acLastAction.textContent = extra.action;
      acLastAction.style.display = '';
    }
  }

  // 自动操作统计更新
  const acStatsBar = $('#acStatsBar');
  const acStatsTotal = $('#acStatsTotal');
  const statEls = {
    continueBtn: $('#acStatContinueBtn'),
    sendMsg: $('#acStatSendMsg'),
    retry: $('#acStatRetry'),
    switchAcct: $('#acStatSwitchAcct'),
    switchModel: $('#acStatSwitchModel'),
    permission: $('#acStatPermission'),
    dismiss: $('#acStatDismiss'),
  };
  function updateAcStats(stats) {
    let total = 0;
    for (const [key, el] of Object.entries(statEls)) {
      const v = stats[key] || 0;
      total += v;
      if (el) el.textContent = v;
    }
    if (acStatsTotal) acStatsTotal.textContent = total;
    // 有任何非零计数时显示统计条
    if (acStatsBar) acStatsBar.style.display = total > 0 ? '' : 'none';
  }

  function applyEnhSettingsToUI(s) {
    if (!s || typeof s !== 'object') return;
    try {
      if (enhBubblesEnabled) enhBubblesEnabled.checked = s.bubblesEnabled !== false;
      if (enhBubblesAutoSend) enhBubblesAutoSend.checked = s.bubblesAutoSend !== false;
      if (enhBubblesTheme) enhBubblesTheme.value = s.bubblesTheme || 'emerald';
      if (enhBubblesShape) enhBubblesShape.value = s.bubblesShape || 'rounded';
      if (enhLocalizationEnabled) enhLocalizationEnabled.checked = s.localizationEnabled !== false;

      // 底部状态栏
      const sb = s.statusBar || {};
      if (enhStatusBarEnabled) enhStatusBarEnabled.checked = sb.enabled !== false;
      if (enhStatusBarPosition) enhStatusBarPosition.value = sb.position || 'right';
      if (enhStatusBarStyle) enhStatusBarStyle.value = sb.style || 'labeled';
      if (enhSbShowPool) enhSbShowPool.checked = sb.showPool !== false;
      if (enhSbShowAutoSwitch) enhSbShowAutoSwitch.checked = sb.showAutoSwitch !== false;
      if (enhSbShowInstance) enhSbShowInstance.checked = sb.showInstance !== false;

      // 自动继续：新 UI
      const acEnabled = s.autoContinueEnabled !== undefined ? s.autoContinueEnabled : true;
      if (enhAutoContinueEnabled) enhAutoContinueEnabled.checked = acEnabled;
      toggleAcEnabled(acEnabled);

      const acTab = s.autoContinueTab || (s.continueMode === 'brainless' ? 'long-task' : 'guardian');
      if (acTabGuardian) acTabGuardian.checked = acTab === 'guardian';
      if (acTabLongTask) acTabLongTask.checked = acTab === 'long-task';
      switchAcTab(acTab);

      // 守护模式
      const gd = s.guardian || {};
      if (enhGdAutoContinueBtn) enhGdAutoContinueBtn.checked = gd.autoContinueButton !== false;
      if (enhGdAutoRetry) enhGdAutoRetry.checked = gd.autoRetry !== false;
      if (enhGdAutoSendOnToolLimit) enhGdAutoSendOnToolLimit.checked = gd.autoSendOnToolLimit !== false;
      const permScope = gd.permissionScope || ['web-request', 'terminal', 'file-write'];
      if (enhGdApproveWeb) enhGdApproveWeb.checked = permScope.includes('web-request');
      if (enhGdApproveTerminal) enhGdApproveTerminal.checked = permScope.includes('terminal');
      if (enhGdApproveFile) enhGdApproveFile.checked = permScope.includes('file-write');
      if (enhGdDismissCorrupt) enhGdDismissCorrupt.checked = gd.dismissCorrupt !== undefined ? gd.dismissCorrupt : (s.dismissCorruptEnabled !== false);

      // 长任务模式
      const lt = s.longTask || {};
      renderQueueList(lt.continueQueue || (s.continueText ? [s.continueText] : ['继续']));
      if (enhLtLoop) enhLtLoop.checked = lt.loop !== false;
      if (enhLtIdleSeconds) enhLtIdleSeconds.value = lt.idleSeconds || s.brainlessIdleSeconds || 8;
      if (enhLtMaxContinue) enhLtMaxContinue.value = lt.maxContinueCount !== undefined ? lt.maxContinueCount : (s.brainlessMaxConsecutive || 0);
      if (enhLtMaxSendRetries) enhLtMaxSendRetries.value = lt.maxSendRetries !== undefined ? lt.maxSendRetries : 3;
      if (enhLtStopOnIntervention) enhLtStopOnIntervention.checked = lt.stopOnUserIntervention !== false;

      // 兼容旧字段
      if (enhAutoSwitchOnQuota) enhAutoSwitchOnQuota.checked = s.autoSwitchOnQuota !== false;
      if (enhAutoSwitchOnRateLimit) enhAutoSwitchOnRateLimit.checked = s.autoSwitchOnRateLimit !== false;
      if (enhAutoRecoveryEnabled) enhAutoRecoveryEnabled.checked = s.autoRecoveryEnabled !== false;
      // v6.6.0 恢复确认 Banner
      if (enhRecoveryConfirmEnabled) enhRecoveryConfirmEnabled.checked = s.recoveryConfirmEnabled !== false;
      if (enhRecoveryCountdownSeconds) {
        const sec = parseInt(s.recoveryCountdownSeconds, 10);
        enhRecoveryCountdownSeconds.value = (sec >= 3 && sec <= 15) ? sec : 5;
      }
      // 恢复规则
      const rules = s.recoveryRules || {};
      if (ruleNetworkAction && rules.networkErrors) ruleNetworkAction.value = rules.networkErrors.action || 'retry';
      if (ruleNetworkMaxRetries && rules.networkErrors) ruleNetworkMaxRetries.value = rules.networkErrors.maxRetries || 3;
      if (ruleNetworkDelay && rules.networkErrors) ruleNetworkDelay.value = Math.round((rules.networkErrors.delay || 3000) / 1000);
      if (ruleQuotaAction && rules.quotaErrors) ruleQuotaAction.value = rules.quotaErrors.action || 'switch-account';
      if (ruleQuotaAfterAction && rules.quotaErrors) ruleQuotaAfterAction.value = rules.quotaErrors.afterAction || 'auto';
      if (ruleModelAction && rules.modelErrors) ruleModelAction.value = rules.modelErrors.action || 'switch-model';
      if (ruleModelAfterAction && rules.modelErrors) ruleModelAfterAction.value = rules.modelErrors.afterAction || 'send-continue';
      if (ruleContinuationAction && rules.continuationErrors) ruleContinuationAction.value = rules.continuationErrors.action || 'send-continue';
      if (rulePermissionAction && rules.permissionRequests) rulePermissionAction.value = rules.permissionRequests.action || 'auto-allow';
      const rulePermScope = (rules.permissionRequests && rules.permissionRequests.scope) || ['web-request'];
      if (permScopeWeb) permScopeWeb.checked = rulePermScope.includes('web-request');
      if (permScopeTerminal) permScopeTerminal.checked = rulePermScope.includes('terminal');
      if (permScopeFile) permScopeFile.checked = rulePermScope.includes('file-write');
      if (ruleUserAction && rules.userIntervention) ruleUserAction.value = rules.userIntervention.action || 'notify';
      // 模型优先级（默认轮换：Claude Opus 4.6 Thinking → Claude Opus 4.7 → GPT-5.5）
      renderModelPriority((rules.modelErrors && rules.modelErrors.modelPriority) || ['Claude Opus 4.6 Thinking', 'Claude Opus 4.7', 'GPT-5.5']);
      // 自定义规则
      renderCustomRules(s.customRecoveryRules || []);
      if (enhNotifyEnabled) enhNotifyEnabled.checked = s.notifyEnabled !== false;
      if (enhNotifyTrigger) enhNotifyTrigger.value = s.notifyTrigger || 'always';
      if (enhNotifySound) enhNotifySound.checked = s.notifySound !== false;
      if (enhNotifyDesktop) enhNotifyDesktop.checked = s.notifyDesktop !== false;
      if (enhNotifyTone) enhNotifyTone.value = s.notifyTone || 'funk';
      if (enhNotifyRepeat) enhNotifyRepeat.value = s.notifyRepeat || 2;
      if (enhCustomTone && s.customTone) enhCustomTone.value = s.customTone;
      if (enhAudioFile && s.audioFile) enhAudioFile.value = s.audioFile;
      if (enhCustomToneRow) enhCustomToneRow.style.display = (s.notifyTone === 'custom') ? 'flex' : 'none';
      if (enhAudioFileRow) enhAudioFileRow.style.display = (s.notifyTone === 'file') ? 'flex' : 'none';

      // V2: 同步视觉状态到 toggle/tag/strategy
      syncV2VisualState();
    } catch {}
  }

  // 将 hidden checkbox 状态同步到 V2 可视组件
  function syncV2VisualState() {
    document.querySelectorAll('.v2-mini-toggle[data-target]').forEach(toggle => {
      const cb = document.getElementById(toggle.dataset.target);
      if (cb) toggle.classList.toggle('is-on', cb.checked);
    });
    document.querySelectorAll('.v2-tag[data-target]').forEach(tag => {
      const cb = document.getElementById(tag.dataset.target);
      if (cb) tag.classList.toggle('is-on', cb.checked);
    });
    // Strategy select (已从卡片改为下拉)
    const stratSel = document.getElementById('asSwitchStrategy');
    if (stratSel && window.autoSwitchStrategy) stratSel.value = window.autoSwitchStrategy;
  }

  // 启动时向后端拉取真相源；失败则回退到本地缓存
  function loadEnhanceSettings() {
    try { vscode.postMessage({ type: 'enhLoad' }); } catch {}
    // 回退：先用 localStorage 缓存填充 UI，避免拉取期间 UI 全空
    try {
      const raw = localStorage.getItem('ws-better-settings');
      if (raw) applyEnhSettingsToUI(JSON.parse(raw));
    } catch {}
  }

  // 把当前 UI 状态收集为 settings 对象（保存/比较用）
  // 从队列 DOM 收集文本数组
  function getQueueFromDOM() {
    if (!acQueueList) return ['继续'];
    const items = acQueueList.querySelectorAll('.ac-queue-input, .v2-queue-text');
    const arr = [];
    items.forEach(inp => { const v = (inp.value || '').trim(); if (v) arr.push(v); });
    return arr.length ? arr : ['继续'];
  }

  function collectEnhSettings() {
    const acEnabled = enhAutoContinueEnabled ? enhAutoContinueEnabled.checked : true;
    const acTab = (acTabLongTask && acTabLongTask.checked) ? 'long-task' : 'guardian';
    // 长任务正在运行时保持 brainless；否则始终为 smart，避免重启后意外触发
    const continueMode = !acEnabled ? 'off' : (_ltRunning ? 'brainless' : 'smart');

    // 预计算共享值，避免重复 parseInt / DOM 查询
    const idleSec = enhLtIdleSeconds ? Math.max(3, parseInt(enhLtIdleSeconds.value) || 8) : 8;
    const maxCount = enhLtMaxContinue ? Math.max(0, parseInt(enhLtMaxContinue.value) || 0) : 0;
    const queue = getQueueFromDOM();
    const dismissCorrupt = enhGdDismissCorrupt ? enhGdDismissCorrupt.checked : true;
    const permScope = [
      ...(enhGdApproveWeb && enhGdApproveWeb.checked ? ['web-request'] : []),
      ...(enhGdApproveTerminal && enhGdApproveTerminal.checked ? ['terminal'] : []),
      ...(enhGdApproveFile && enhGdApproveFile.checked ? ['file-write'] : []),
    ];

    return {
      bubblesEnabled: enhBubblesEnabled ? enhBubblesEnabled.checked : true,
      bubblesAutoSend: enhBubblesAutoSend ? enhBubblesAutoSend.checked : true,
      bubblesTheme: enhBubblesTheme ? enhBubblesTheme.value : 'emerald',
      bubblesShape: enhBubblesShape ? enhBubblesShape.value : 'rounded',
      localizationEnabled: enhLocalizationEnabled ? enhLocalizationEnabled.checked : true,
      statusBar: {
        enabled: enhStatusBarEnabled ? enhStatusBarEnabled.checked : true,
        position: enhStatusBarPosition ? enhStatusBarPosition.value : 'right',
        style: enhStatusBarStyle ? enhStatusBarStyle.value : 'labeled',
        showPool: enhSbShowPool ? enhSbShowPool.checked : true,
        showAutoSwitch: enhSbShowAutoSwitch ? enhSbShowAutoSwitch.checked : true,
        showInstance: enhSbShowInstance ? enhSbShowInstance.checked : true,
      },
      continueMode,
      autoContinueEnabled: acEnabled,
      autoContinueTab: acTab,
      guardian: {
        autoContinueButton: enhGdAutoContinueBtn ? enhGdAutoContinueBtn.checked : true,
        autoRetry: enhGdAutoRetry ? enhGdAutoRetry.checked : true,
        autoSendOnToolLimit: enhGdAutoSendOnToolLimit ? enhGdAutoSendOnToolLimit.checked : true,
        autoApprovePermission: permScope.length > 0,
        permissionScope: permScope,
        dismissCorrupt,
      },
      longTask: {
        idleSeconds: idleSec,
        maxContinueCount: maxCount,
        continueQueue: queue,
        loop: enhLtLoop ? enhLtLoop.checked : true,
        maxSendRetries: enhLtMaxSendRetries ? Math.max(1, parseInt(enhLtMaxSendRetries.value) || 3) : 3,
        stopOnUserIntervention: enhLtStopOnIntervention ? enhLtStopOnIntervention.checked : true,
      },
      // 兼容旧脚本 windsurf-better.js 直接读取的顶层字段
      dismissCorruptEnabled: dismissCorrupt,
      autoSwitchOnQuota: enhAutoSwitchOnQuota ? enhAutoSwitchOnQuota.checked : true,
      autoSwitchOnRateLimit: enhAutoSwitchOnRateLimit ? enhAutoSwitchOnRateLimit.checked : true,
      brainlessModeEnabled: false, // 清除旧字段，防止 loadSettings 迁移逻辑重新激活 brainless
      brainlessIdleSeconds: idleSec,
      brainlessMaxConsecutive: maxCount,  // 0 = 无限
      autoRecoveryEnabled: enhAutoRecoveryEnabled ? enhAutoRecoveryEnabled.checked : true,
      // v6.6.0 恢复确认 Banner
      recoveryConfirmEnabled: enhRecoveryConfirmEnabled ? enhRecoveryConfirmEnabled.checked : true,
      recoveryCountdownSeconds: enhRecoveryCountdownSeconds
        ? Math.max(3, Math.min(15, parseInt(enhRecoveryCountdownSeconds.value, 10) || 5))
        : 5,
      continueText: queue[0] || 'continue',
      recoveryRules: collectRecoveryRules(),
      customRecoveryRules: collectCustomRules(),
      notifyEnabled: enhNotifyEnabled ? enhNotifyEnabled.checked : true,
      notifyTrigger: enhNotifyTrigger ? enhNotifyTrigger.value : 'always',
      notifySound: enhNotifySound ? enhNotifySound.checked : true,
      notifyDesktop: enhNotifyDesktop ? enhNotifyDesktop.checked : true,
      notifyTone: enhNotifyTone ? enhNotifyTone.value : 'funk',
      notifyRepeat: enhNotifyRepeat ? parseInt(enhNotifyRepeat.value) || 2 : 2,
      customTone: enhCustomTone ? enhCustomTone.value : '',
      audioFile: enhAudioFile ? enhAudioFile.value : '',
    };
  }

  // 将侧栏设置同步到后端：postMessage 给扩展宿主写盘并重新注入 workbench
  function saveEnhanceSettings() {
    try {
      const updated = collectEnhSettings();
      // 本地缓存留底（postMessage 失败时仍可作为回退展示）
      try { localStorage.setItem('ws-better-settings', JSON.stringify(updated)); } catch {}
      vscode.postMessage({ type: 'enhSave', settings: updated });
      // 切换自定义行显示
      if (enhCustomToneRow) enhCustomToneRow.style.display = (updated.notifyTone === 'custom') ? 'flex' : 'none';
      if (enhAudioFileRow) enhAudioFileRow.style.display = (updated.notifyTone === 'file') ? 'flex' : 'none';
      updateBubblePreview();
    } catch {}
  }

  // 气泡预览：主题和形状数据（与 windsurf-better.js 保持一致）
  const PREVIEW_THEMES = {
    emerald: { bg:'linear-gradient(135deg,#22c55e,#06b6d4,#3b82f6)', bgHover:'linear-gradient(135deg,#16a34a,#0891b2,#2563eb)', color:'#fff', shadow:'0 2px 8px rgba(34,197,94,.2)', border:'none' },
    aurora:  { bg:'linear-gradient(135deg,#a855f7,#ec4899)', bgHover:'linear-gradient(135deg,#9333ea,#db2777)', color:'#fff', shadow:'0 2px 8px rgba(168,85,247,.2)', border:'none' },
    sunset:  { bg:'linear-gradient(135deg,#f59e0b,#ef4444)', bgHover:'linear-gradient(135deg,#d97706,#dc2626)', color:'#fff', shadow:'0 2px 8px rgba(245,158,11,.2)', border:'none' },
    ocean:   { bg:'#1e40af', bgHover:'#1e3a8a', color:'#fff', shadow:'0 2px 8px rgba(30,64,175,.25)', border:'none' },
    glass:   { bg:'rgba(255,255,255,.08)', bgHover:'rgba(255,255,255,.14)', color:'rgba(255,255,255,.8)', shadow:'0 2px 8px rgba(0,0,0,.1)', border:'1px solid rgba(255,255,255,.12)', blur:true },
    dark:    { bg:'#1f2937', bgHover:'#111827', color:'#e5e7eb', shadow:'0 2px 8px rgba(0,0,0,.3)', border:'1px solid rgba(255,255,255,.08)' },
  };
  const PREVIEW_SHAPES = { pill:'20px', rounded:'10px', soft:'6px', sharp:'2px' };

  function updateBubblePreview() {
    const container = document.getElementById('bubblePreviewContainer');
    if (!container) return;
    const themeId = enhBubblesTheme ? enhBubblesTheme.value : 'emerald';
    const shapeId = enhBubblesShape ? enhBubblesShape.value : 'rounded';
    const theme = PREVIEW_THEMES[themeId] || PREVIEW_THEMES.emerald;
    const radius = PREVIEW_SHAPES[shapeId] || '10px';
    container.querySelectorAll('.bubble-preview-item').forEach(el => {
      el.style.background = theme.bg;
      el.style.color = theme.color;
      el.style.boxShadow = theme.shadow;
      el.style.border = (theme.border && theme.border !== 'none') ? theme.border : 'none';
      el.style.borderRadius = radius;
      el.style.backdropFilter = theme.blur ? 'blur(12px)' : '';
      el.onmouseenter = () => { el.style.background = theme.bgHover; };
      el.onmouseleave = () => { el.style.background = theme.bg; };
    });
  }

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
      primaryBtn = '';
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

    // 跳转按钮：运行中非当前窗口时显示，其余不渲染（避免空白占位）
    const canFocus = !isCurrent && inst.running;
    const focusBtn = canFocus ? `<button class="icon-btn focus" data-inst-action="focus" title="跳转到此窗口">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
       </button>` : '';
    return { statusClass, stateText, isDefault, isCurrent, sourceBadge, primaryBtn, focusBtn, running: inst.running };
  }

  // 智能选号图标（取代 emoji ⭐）
  const SMART_ICON_SVG = '<svg class="inst-smart-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>';

  function buildInstEmailHTML(inst) {
    if (inst.bindEmail === '__auto__') {
      const smartLabel = `<span class="inst-smart-label">${SMART_ICON_SVG}智能选号</span>`;
      if (inst.currentEmail) {
        return `${smartLabel}<span class="inst-email-sep">·</span><span class="inst-email-text">${escHtml(inst.currentEmail)}</span>`;
      }
      return `${smartLabel}<span class="inst-email-sep">·</span><span class="inst-email-empty">尚未启动</span>`;
    }
    if (inst.bindEmail) {
      return `<span class="inst-email-text">${escHtml(inst.bindEmail)}</span>`;
    }
    return `<span class="inst-email-empty">未绑定账号</span>`;
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
        const emailHTML = buildInstEmailHTML(inst);
        const tagHTML = inst.assignedTag
          ? `<span class="inst-tag-badge" data-inst-action="viewTag" title="点击查看该标签下的账号">${escHtml(inst.assignedTag)}</span>`
          : `<span class="inst-tag-none" data-inst-action="viewTag">默认分组</span>`;
        return `<div class="inst-card ${statusClass}" data-inst-id="${escHtml(inst.id)}">
          <div class="inst-card-header">
            <div class="inst-card-name">${escHtml(inst.name)}</div>${sourceBadge}
            <span class="inst-card-state ${statusClass}">${stateText}</span>
          </div>
          <div class="inst-card-email" title="${escHtml(inst.bindEmail === '__auto__' ? (inst.currentEmail || '智能选号') : (inst.bindEmail || ''))}">${emailHTML}</div>
          <div class="inst-card-tag">${tagHTML}</div>
          <div class="inst-card-actions">
            ${focusBtn}${primaryBtn}
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
        if (stateEl) { stateEl.className = 'inst-card-state ' + statusClass; stateEl.textContent = stateText; }
        const emailEl = card.querySelector('.inst-card-email');
        if (emailEl) {
          emailEl.title = inst.bindEmail === '__auto__' ? (inst.currentEmail || '智能选号') : (inst.bindEmail || '');
          emailEl.innerHTML = buildInstEmailHTML(inst);
        }
        const tagEl = card.querySelector('.inst-card-tag');
        if (tagEl) {
          tagEl.innerHTML = inst.assignedTag
            ? '<span class="inst-tag-badge" data-inst-action="viewTag" title="点击查看该标签下的账号">' + escHtml(inst.assignedTag) + '</span>'
            : '<span class="inst-tag-none" data-inst-action="viewTag">默认分组</span>';
        }
        const actionsEl = card.querySelector('.inst-card-actions');
        if (actionsEl) {
          // 更新 focus + 主按钮（全部重建前头部分，保留 edit/delete）
          const editBtn = actionsEl.querySelector('[data-inst-action="edit"]');
          const delBtn = actionsEl.querySelector('[data-inst-action="delete"]');
          // 清除除 edit/delete 以外的所有按钮
          [...actionsEl.children].forEach(c => {
            if (c !== editBtn && c !== delBtn) c.remove();
          });
          // 新插入 focus + primary 在头部
          const headFrag = document.createElement('div');
          headFrag.innerHTML = focusBtn + primaryBtn;
          [...headFrag.children].reverse().forEach(c => actionsEl.insertBefore(c, actionsEl.firstChild));
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
  const _toastByKey = new Map();

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

  function createToast(msg, type, key) {
    const container = document.getElementById('toastContainer');
    if (!container) return null;
    if (key && _toastByKey.has(key)) {
      const old = _toastByKey.get(key);
      removeToast(old, true);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    if (key) toast.dataset.toastKey = key;
    const iconHtml = type === 'loading'
      ? '<span class="toast-spinner"></span>'
      : type === 'success'
        ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 8l3 3 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="5" x2="8" y2="9" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.6" fill="currentColor"/></svg>';
    toast.innerHTML = `${iconHtml}<span class="toast-msg">${escHtml(msg)}</span><button class="toast-close" aria-label="关闭">✕</button>`;
    toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
    container.appendChild(toast);
    if (key) _toastByKey.set(key, toast);
    while (container.children.length > 3) removeToast(container.firstElementChild, true);
    requestAnimationFrame(() => toast.classList.add('toast-in'));
    return toast;
  }

  function showToast(msg, type = 'success', ttl = 2200, key = '') {
    const toast = createToast(msg, type, key);
    if (toast) {
      if (toast._hideTimer) clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => removeToast(toast), ttl);
    }
  }

  function removeToast(toast, immediate = false) {
    if (!toast || !toast.parentNode) return;
    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    if (toast.dataset && toast.dataset.toastKey && _toastByKey.get(toast.dataset.toastKey) === toast) {
      _toastByKey.delete(toast.dataset.toastKey);
    }
    if (immediate) {
      toast.remove();
      if (_persistentToast === toast) _persistentToast = null;
      return;
    }
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
    const autoOptHtml = `<div class="ap-item ap-item-auto" data-email="__auto__">
      <div class="ap-email" style="display:flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> 智能选号（推荐）</div>
      <div class="ap-usage"><span class="ap-stat" style="color:var(--ac-emerald)">自动用余额最多的账号，用完自动换下一个</span></div>
    </div>`;
    list.innerHTML = autoOptHtml + accounts.map(a =>
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
      const content = trigger.querySelector('.ap-trigger-content');
      if (email === '__auto__') {
        if (content) content.innerHTML = `<div class="ap-email" style="display:flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> 智能选号（推荐）</div><div class="ap-usage"><span class="ap-stat" style="color:var(--ac-emerald)">自动用余额最多的账号，用完自动换下一个</span></div>`;
      } else {
        const acc = accounts.find(a => a.email === email);
        if (content) content.innerHTML = renderAccountItemContent(acc);
      }
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
    const initialEmail = selectedEmail === '__auto__'
      ? '__auto__'
      : (selectedEmail && accounts.some(a => a.email === selectedEmail))
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
    const tagSelect = document.getElementById('instCreateTag');
    const errorEl = document.getElementById('instCreateError');
    if (!overlay) return;

    renderAccountPicker(accountEl, '__auto__');
    populateTagSelect(tagSelect, '');
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

    const tagSelect = document.getElementById('instCreateTag');
    const assignedTag = tagSelect?.value || '';
    if (overlay) overlay.hidden = true;
    postMsg('instanceCreate', { instanceName: name, email, assignedTag });
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

  function getTagList() {
    const tags = new Set();
    accounts.forEach(a => { getAccTags(a).forEach(t => tags.add(t)); });
    return [...tags].sort();
  }

  function populateTagSelect(selectEl, currentTag) {
    if (!selectEl) return;
    const tags = getTagList();
    selectEl.innerHTML = '<option value="">不限（全部账号）</option>' +
      tags.map(t => `<option value="${escHtml(t)}" ${t === currentTag ? 'selected' : ''}>${escHtml(t)}</option>`).join('');
  }

  function openInstEditModal(inst) {
    const overlay = document.getElementById('instEditOverlay');
    const nameInput = document.getElementById('instEditName');
    const accountEl = document.getElementById('instEditAccount');
    const tagSelect = document.getElementById('instEditTag');
    const errorEl = document.getElementById('instEditError');
    if (!overlay) return;

    renderAccountPicker(accountEl, '__auto__');
    populateTagSelect(tagSelect, inst.assignedTag || '');
    if (nameInput) nameInput.value = inst.name;
    if (errorEl) errorEl.hidden = true;
    overlay.dataset.instId = inst.id;
    overlay.hidden = false;
  }

  function submitInstEdit() {
    const overlay = document.getElementById('instEditOverlay');
    const nameInput = document.getElementById('instEditName');
    const tagSelect = document.getElementById('instEditTag');
    const errorEl = document.getElementById('instEditError');
    const id = overlay?.dataset.instId;
    const name = nameInput?.value?.trim();
    const email = getAccountPickerValue('instEditAccount');
    const assignedTag = tagSelect?.value || '';
    if (!id) return;
    if (!name) {
      if (errorEl) { errorEl.textContent = '请输入实例名称'; errorEl.hidden = false; }
      return;
    }
    if (overlay) overlay.hidden = true;
    postMsg('instanceUpdate', { instanceId: id, instanceName: name, email, assignedTag });
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
    // 卡片右键：右键标签 chip 时打开"修改标签"模态
    if (accountGrid) accountGrid.addEventListener('contextmenu', (e) => {
      const chip = e.target.closest('.grid-tag-chip');
      if (!chip) return;
      const card = chip.closest('.grid-card');
      const email = card?.dataset.email;
      if (!email) return;
      e.preventDefault();
      openTagEditModal('edit', email);
    });
    // 双击标签 chip 修改颜色
    if (accountGrid) accountGrid.addEventListener('dblclick', (e) => {
      const chip = e.target.closest('.grid-tag-chip');
      if (!chip) return;
      const card = chip.closest('.grid-card');
      const email = card?.dataset.email;
      const tagName = chip.dataset.tag;
      if (!tagName) return;
      e.preventDefault();
      openTagColorPicker(tagName, chip);
    });

    // ── 统一过滤器 ──
    const filterTrigger = document.getElementById('filterTrigger');
    const filterDropdown = document.getElementById('filterDropdown');
    const filterClearBtn = document.getElementById('filterClearBtn');
    const quickHealthOkBtn = document.getElementById('quickHealthOkBtn');
    // 恢复持久化
    try {
      const st = vscode.getState() || {};
      if (st._filterPlans) filterPlans = new Set(st._filterPlans);
      if (st._filterTags) filterTags = new Set(st._filterTags);
      if (st._filterStatuses) filterStatuses = new Set(st._filterStatuses);
      if (st._filterHealth) filterHealth = new Set(st._filterHealth);
    } catch {}
    function persistFilters() {
      const st = vscode.getState() || {};
      st._filterPlans = [...filterPlans];
      st._filterTags = [...filterTags];
      st._filterStatuses = [...filterStatuses];
      st._filterHealth = [...filterHealth];
      vscode.setState(st);
    }
    if (filterTrigger && filterDropdown) {
      filterTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        filterDropdown.hidden = !filterDropdown.hidden;
        if (!filterDropdown.hidden) buildFilterDropdown();
      });
      filterDropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.filter-option');
        if (!option) return;
        const name = option.dataset.value;
        if (!name) return;
        const section = option.closest('.filter-section');
        if (!section) return;
        const sectionId = section.id;
        let targetSet;
        if (sectionId === 'filterPlanSection') targetSet = filterPlans;
        else if (sectionId === 'filterTagSection') targetSet = filterTags;
        else if (sectionId === 'filterStatusSection') targetSet = filterStatuses;
        else if (sectionId === 'filterHealthSection') targetSet = filterHealth;
        else return;
        if (targetSet.has(name)) targetSet.delete(name); else targetSet.add(name);
        persistFilters();
        currentPage = 1;
        buildFilterDropdown();
        renderCards();
      });
      document.addEventListener('click', (e) => {
        if (filterDropdown.hidden) return;
        if (!filterDropdown.contains(e.target) && e.target !== filterTrigger && !filterTrigger.contains(e.target)) {
          filterDropdown.hidden = true;
        }
      });
    }
    if (filterClearBtn) {
      filterClearBtn.addEventListener('click', () => {
        filterPlans.clear();
        filterTags.clear();
        filterStatuses.clear();
        filterHealth.clear();
        persistFilters();
        currentPage = 1;
        buildFilterDropdown();
        renderCards();
      });
    }
    if (quickHealthOkBtn) {
      quickHealthOkBtn.addEventListener('click', () => {
        if (filterHealth.has('可用')) filterHealth.delete('可用');
        else filterHealth.add('可用');
        persistFilters();
        currentPage = 1;
        const dropdown = document.getElementById('filterDropdown');
        if (dropdown && !dropdown.hidden) buildFilterDropdown();
        renderCards();
      });
    }
    updateFilterLabel();

    // 多选模式
    const selectModeBtn = document.getElementById('selectModeBtn');
    const batchBar = document.getElementById('batchBar');
    if (selectModeBtn) {
      selectModeBtn.addEventListener('click', () => {
        selectMode = !selectMode;
        selectModeBtn.classList.toggle('is-active', selectMode);
        selectModeBtn.textContent = selectMode ? '退出多选' : '多选';
        if (batchBar) batchBar.hidden = !selectMode;
        if (accountGrid) accountGrid.classList.toggle('is-select-mode', selectMode);
        if (!selectMode) selectedEmails.clear();
        renderCards();
      });
    }

    // 全选（只选中当前筛选/搜索后可见的账号）
    const batchCheckAll = document.getElementById('batchCheckAll');
    if (batchCheckAll) {
      batchCheckAll.addEventListener('change', (e) => {
        const visible = getVisibleAccounts();
        if (e.target.checked) {
          visible.forEach(a => selectedEmails.add(a.email));
        } else {
          // 取消全选时只取消当前可见的，避免误清掉其他页/筛选外已选项
          visible.forEach(a => selectedEmails.delete(a.email));
        }
        renderCards();
      });
    }

    // 分组全选 & 卡片复选框
    if (accountGrid) {
      accountGrid.addEventListener('change', (e) => {
        const input = e.target;
        if (input.classList.contains('group-check-input')) {
          const groupKey = input.dataset.group;
          // 分组全选也只针对当前筛选可见的账号
          const groupAccounts = getVisibleAccounts().filter(a => getAccountGroup(a) === groupKey);
          groupAccounts.forEach(a => {
            if (input.checked) selectedEmails.add(a.email);
            else selectedEmails.delete(a.email);
          });
          renderCards();
        } else if (input.classList.contains('grid-check-input')) {
          const email = input.dataset.email;
          if (input.checked) selectedEmails.add(email);
          else selectedEmails.delete(email);
          updateBatchCount();
          // 更新分组全选状态（基于当前可见集合）
          const visible = getVisibleAccounts();
          accountGrid.querySelectorAll('.group-check-input').forEach(gcb => {
            const gk = gcb.dataset.group;
            const ga = visible.filter(a => getAccountGroup(a) === gk);
            gcb.checked = ga.length > 0 && ga.every(a => selectedEmails.has(a.email));
          });
        }
      });
    }

    // 批量删除
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    if (batchDeleteBtn) {
      batchDeleteBtn.addEventListener('click', async () => {
        if (selectedEmails.size === 0) return;
        // webview 不支持原生 confirm，必须用自定义 showConfirm
        const ok = await showConfirm(`确定删除选中的 ${selectedEmails.size} 个账号？`, '批量删除');
        if (!ok) return;
        postMsg('batchDelete', { emails: [...selectedEmails] });
        selectedEmails.clear();
        if (batchBar) batchBar.hidden = true;
        if (accountGrid) accountGrid.classList.remove('is-select-mode');
        selectMode = false;
        if (selectModeBtn) {
          selectModeBtn.classList.remove('is-active');
          selectModeBtn.textContent = '多选';
        }
      });
    }

    // 批量启用
    const batchEnableBtn = document.getElementById('batchEnableBtn');
    if (batchEnableBtn) {
      batchEnableBtn.addEventListener('click', () => {
        if (selectedEmails.size === 0) return;
        postMsg('batchEnable', { emails: [...selectedEmails] });
      });
    }

    // 批量禁用
    const batchDisableBtn = document.getElementById('batchDisableBtn');
    if (batchDisableBtn) {
      batchDisableBtn.addEventListener('click', () => {
        if (selectedEmails.size === 0) return;
        postMsg('batchDisable', { emails: [...selectedEmails] });
      });
    }

    // 批量打标签
    const batchTagBtn = document.getElementById('batchTagBtn');
    if (batchTagBtn) {
      batchTagBtn.addEventListener('click', () => {
        if (selectedEmails.size === 0) return;
        // webview 不支持原生 prompt，使用自带的标签编辑 modal
        openTagEditModal('batch', [...selectedEmails]);
      });
    }


    // 取消多选
    const batchCancelBtn = document.getElementById('batchCancelBtn');
    if (batchCancelBtn) {
      batchCancelBtn.addEventListener('click', () => {
        selectMode = false;
        selectedEmails.clear();
        if (batchBar) batchBar.hidden = true;
        if (accountGrid) accountGrid.classList.remove('is-select-mode');
        if (selectModeBtn) {
          selectModeBtn.classList.remove('is-active');
          selectModeBtn.textContent = '多选';
        }
        renderCards();
      });
    }

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
    if (refreshAllBtn) refreshAllBtn.addEventListener('click', () => refreshAll(true, true));
    const exportAccountsBtn = document.getElementById('exportAccountsBtn');
    if (exportAccountsBtn) {
      exportAccountsBtn.addEventListener('click', () => {
        postMsg('exportAccounts', {});
      });
    }

    const savedState = vscode.getState() || {};
    privacyMode = savedState.privacyMode === true;
    updatePrivacyModeUi();
    if (privacyModeBtn) {
      privacyModeBtn.addEventListener('click', () => {
        privacyMode = !privacyMode;
        const st = vscode.getState() || {};
        st.privacyMode = privacyMode;
        vscode.setState(st);
        updatePrivacyModeUi();
        setExternalEmailText();
        renderCards();
      });
    }

    // 批量导入按钮（点击后关闭添加模态框，进度由批量进度框显示）
    const batchTextBtn = $('[data-action="batchImportText"]');
    if (batchTextBtn) batchTextBtn.addEventListener('click', () => { doBatchImportText(); closeAddAccountModal(); });
    const batchJsonBtn = $('[data-action="batchImportJson"]');
    if (batchJsonBtn) batchJsonBtn.addEventListener('click', () => { doBatchImportJson(); closeAddAccountModal(); });
    const batchDevinBtn = $('[data-action="batchImportDevin"]');
    if (batchDevinBtn) batchDevinBtn.addEventListener('click', () => { doBatchImportDevin(); closeAddAccountModal(); });
    const oauthLoginBtn = $('[data-action="oauthLogin"]');
    if (oauthLoginBtn) oauthLoginBtn.addEventListener('click', () => {
      const tagEl = document.getElementById('oauthTag');
      const msgEl = document.getElementById('oauthMsg');
      if (msgEl) {
        msgEl.hidden = false;
        msgEl.textContent = '正在打开授权页…';
        msgEl.className = 'batch-msg is-ok';
      }
      postMsg('oauthLogin', { tag: tagEl ? tagEl.value.trim() : '' });
    });

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

    // 排序下拉
    const sortSelect = document.getElementById('sortSelect');
    // 恢复持久化排序
    try {
      const savedState = vscode.getState() || {};
      if (savedState._sortMode) sortMode = savedState._sortMode;
      if (savedState._sortDirection) sortDirection = savedState._sortDirection;
      if (savedState._searchQuery) searchQuery = savedState._searchQuery;
      if (savedState._activeTagFilters) activeTagFilters = savedState._activeTagFilters;
    } catch {}
    if (sortSelect) {
      sortSelect.value = sortMode;
      sortSelect.addEventListener('change', () => {
        sortMode = sortSelect.value || 'default';
        const st = vscode.getState() || {};
        st._sortMode = sortMode;
        vscode.setState(st);
        renderCards();
      });
    }
    // 恢复排序方向按钮
    const sortDirectionBtn = document.getElementById('sortDirectionBtn');
    if (sortDirectionBtn) {
      const updateSortIcon = () => {
        const svg = sortDirectionBtn.querySelector('svg');
        if (svg) {
          svg.style.transform = sortDirection === 'desc' ? 'rotate(0deg)' : 'rotate(180deg)';
          svg.style.transition = 'transform 0.2s ease';
        }
      };
      updateSortIcon();
      sortDirectionBtn.addEventListener('click', () => {
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
        sortDirectionBtn.title = sortDirection === 'desc' ? '当前：降序，点击切换为升序' : '当前：升序，点击切换为降序';
        const st = vscode.getState() || {};
        st._sortDirection = sortDirection;
        vscode.setState(st);
        updateSortIcon();
        renderCards();
      });
    }
    // 搜索栏
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    if (searchInput) {
      if (searchQuery) { searchInput.value = searchQuery; if (searchClear) searchClear.hidden = false; }
      let _searchTimer = null;
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        if (searchClear) searchClear.hidden = !searchQuery;
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
          currentPage = 1;
          const st = vscode.getState() || {};
          st._searchQuery = searchQuery;
          vscode.setState(st);
          renderCards();
        }, 250);
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchQuery = '';
        if (searchInput) searchInput.value = '';
        searchClear.hidden = true;
        currentPage = 1;
        const st = vscode.getState() || {};
        st._searchQuery = '';
        vscode.setState(st);
        renderCards();
      });
    }
    // (旧标签筛选已合并到统一过滤器)

    // 每页显示切换
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
      // 恢复之前的选择
      try {
        const st = vscode.getState() || {};
        if (st._pageSize !== undefined) { pageSize = parseInt(st._pageSize) || 0; pageSizeSelect.value = String(pageSize); }
      } catch {}
      pageSizeSelect.addEventListener('change', () => {
        pageSize = parseInt(pageSizeSelect.value) || 0;
        currentPage = 1;
        const st = vscode.getState() || {};
        st._pageSize = pageSize;
        vscode.setState(st);
        renderCards();
      });
    }

    // 自动切号设置 → 发送到后端
    function sendAutoSwitchSettings() {
      if (!autoSwitchSynced) return;
      postMsg('autoSwitchSettings', {
        enabled: autoSwitchEnabled,
        threshold: autoSwitchThreshold,
        checkSec: autoSwitchCheckSec,
        cooldownSec: autoSwitchCooldownSec,
        refreshMin: autoSwitchRefreshMin,
        refreshConcurrency: autoSwitchRefreshConcurrency,
        refreshBatchDelayMs: autoSwitchRefreshBatchDelayMs,
        periodRefreshHours: autoSwitchPeriodRefreshHours,
        scoreMode: autoSwitchScoreMode,
        switchStrategy: autoSwitchStrategy,
        minQuota: autoSwitchMinQuota,
        preferUsedThreshold: autoSwitchPreferUsedThreshold,
        poolScope: autoSwitchPoolScope,
        poolTags: autoSwitchPoolTags,
      });
    }
    if (asEnabledEl) {
      asEnabledEl.addEventListener('change', () => {
        autoSwitchEnabled = asEnabledEl.checked;
        const asDetailsToggle = document.getElementById('asDetails');
        if (asDetailsToggle) { if (autoSwitchEnabled) asDetailsToggle.setAttribute('open', ''); else asDetailsToggle.removeAttribute('open'); }
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
    // 刷新频率（位于 Windsurf 增强面板 → 底部状态栏下方）
    const enhRefreshCurrentEl = document.getElementById('enhRefreshCurrent');
    if (enhRefreshCurrentEl) {
      enhRefreshCurrentEl.addEventListener('change', () => {
        autoSwitchCheckSec = Math.max(3, parseInt(enhRefreshCurrentEl.value) || 5);
        enhRefreshCurrentEl.value = autoSwitchCheckSec;
        sendAutoSwitchSettings();
      });
    }
    const enhRefreshAllEl = document.getElementById('enhRefreshAll');
    if (enhRefreshAllEl) {
      enhRefreshAllEl.addEventListener('change', () => {
        autoSwitchRefreshMin = Math.max(1, parseInt(enhRefreshAllEl.value) || 5);
        enhRefreshAllEl.value = autoSwitchRefreshMin;
        sendAutoSwitchSettings();
      });
    }
    const enhRefreshConcurrencyEl = document.getElementById('enhRefreshConcurrency');
    if (enhRefreshConcurrencyEl) {
      enhRefreshConcurrencyEl.addEventListener('change', () => {
        autoSwitchRefreshConcurrency = Math.max(1, Math.min(50, parseInt(enhRefreshConcurrencyEl.value) || 12));
        enhRefreshConcurrencyEl.value = autoSwitchRefreshConcurrency;
        sendAutoSwitchSettings();
      });
    }
    const enhRefreshBatchDelayEl = document.getElementById('enhRefreshBatchDelay');
    if (enhRefreshBatchDelayEl) {
      enhRefreshBatchDelayEl.addEventListener('change', () => {
        autoSwitchRefreshBatchDelayMs = Math.max(0, Math.min(10000, parseInt(enhRefreshBatchDelayEl.value) || 0));
        enhRefreshBatchDelayEl.value = autoSwitchRefreshBatchDelayMs;
        sendAutoSwitchSettings();
      });
    }
    const enhPeriodRefreshHoursEl = document.getElementById('enhPeriodRefreshHours');
    if (enhPeriodRefreshHoursEl) {
      enhPeriodRefreshHoursEl.addEventListener('change', () => {
        autoSwitchPeriodRefreshHours = Math.max(0, Math.min(168, Number(enhPeriodRefreshHoursEl.value) || 0));
        enhPeriodRefreshHoursEl.value = autoSwitchPeriodRefreshHours;
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

    // 切号范围
    const asPoolScopeSelectEl = document.getElementById('asPoolScope');
    if (asPoolScopeSelectEl) {
      asPoolScopeSelectEl.addEventListener('change', () => {
        autoSwitchPoolScope = asPoolScopeSelectEl.value || 'all';
        renderTagPicker();
        sendAutoSwitchSettings();
      });
    }

    // 切号策略配置
    const STRATEGY_HINTS = {
      highestFirst: '优先选额度最充足的号切入，保证可用时间最长',
      lowestNonZero: '优先消耗快用完的号，节省满额度号留作备用',
    };
    function updateStrategyHint() {
      const el = document.getElementById('asStrategyHint');
      if (el) el.textContent = STRATEGY_HINTS[autoSwitchStrategy] || '';
      updatePreferUsedVisibility();
    }
    function updatePreferUsedVisibility() {
      const cell = document.getElementById('asPreferUsedCell');
      const hint = document.getElementById('asThresholdHint');
      const isLowest = autoSwitchStrategy === 'lowestNonZero';
      if (cell) {
        cell.style.opacity = isLowest ? '1' : '0.35';
        cell.style.pointerEvents = isLowest ? '' : 'none';
      }
      if (hint) {
        hint.textContent = isLowest
          ? '额度下限：低于此值的号视为废号，不会被选中。已用阈值：低于此值的号视为"正在用"，优先消耗完再换新号。'
          : '额度下限：日/周任一配额低于此值的号视为废号，不会被选中。';
      }
    }
    function syncStrategyUI() {
      const sel = document.getElementById('asSwitchStrategy');
      if (sel) sel.value = autoSwitchStrategy;
      const minQuotaEl = document.getElementById('asMinQuota');
      const prefUsedEl = document.getElementById('asPreferUsedThreshold');
      if (minQuotaEl) minQuotaEl.value = autoSwitchMinQuota;
      if (prefUsedEl) prefUsedEl.value = autoSwitchPreferUsedThreshold;
      updateStrategyHint();
    }
    const strategySelect = document.getElementById('asSwitchStrategy');
    if (strategySelect) {
      strategySelect.addEventListener('change', () => {
        autoSwitchStrategy = strategySelect.value;
        updateStrategyHint();
        sendAutoSwitchSettings();
      });
    }
    const asMinQuotaEl = document.getElementById('asMinQuota');
    if (asMinQuotaEl) {
      asMinQuotaEl.addEventListener('change', () => {
        autoSwitchMinQuota = parseInt(asMinQuotaEl.value) || 10;
        sendAutoSwitchSettings();
      });
    }
    const asPreferUsedEl = document.getElementById('asPreferUsedThreshold');
    if (asPreferUsedEl) {
      asPreferUsedEl.addEventListener('change', () => {
        autoSwitchPreferUsedThreshold = parseInt(asPreferUsedEl.value) || 50;
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
      const oauthArea = document.getElementById('oauthLoginArea');
      if (singleArea) singleArea.hidden = mode !== 'single';
      if (batchArea) batchArea.hidden = mode !== 'batch';
      if (currentArea) currentArea.hidden = mode !== 'current';
      if (oauthArea) oauthArea.hidden = mode !== 'oauth';
      setBatchMsg('', false);
      const oauthMsg = document.getElementById('oauthMsg');
      if (oauthMsg && mode !== 'oauth') oauthMsg.hidden = true;
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
          const fmt = target.value;
          const textArea = document.getElementById('batchTextArea');
          const jsonArea = document.getElementById('batchJsonArea');
          const devinArea = document.getElementById('batchDevinArea');
          const authSection = document.getElementById('batchAuthSection');
          if (textArea) textArea.hidden = fmt !== 'text';
          if (jsonArea) jsonArea.hidden = fmt !== 'json';
          if (devinArea) devinArea.hidden = fmt !== 'devin';
          if (authSection) authSection.hidden = fmt === 'devin';
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

    // 标签管理事件
    const tagAddBtn = document.getElementById('tagAddBtn');
    if (tagAddBtn) tagAddBtn.addEventListener('click', () => openTagEditModal('add'));

    const tagEditClose = document.getElementById('tagEditClose');
    const tagEditCancel = document.getElementById('tagEditCancel');
    const tagEditSave = document.getElementById('tagEditSave');
    const tagEditOverlay = document.getElementById('tagEditOverlay');

    if (tagEditClose) tagEditClose.addEventListener('click', closeTagEditModal);
    if (tagEditCancel) tagEditCancel.addEventListener('click', closeTagEditModal);
    if (tagEditSave) tagEditSave.addEventListener('click', saveTagEdit);
    if (tagEditOverlay) {
      tagEditOverlay.addEventListener('click', (e) => {
        if (e.target === tagEditOverlay) closeTagEditModal();
      });
    }
    // 标签输入框回车 → 添加标签
    const tagEditInput = document.getElementById('tagEditInput');
    if (tagEditInput) tagEditInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); }
    });
    // "添加"按钮
    const tagEditAddBtn = document.getElementById('tagEditAddBtn');
    if (tagEditAddBtn) tagEditAddBtn.addEventListener('click', addTagFromInput);

    // 实例编辑模态框
    const instEditClose = document.getElementById('instEditClose');
    const instEditOverlay = document.getElementById('instEditOverlay');
    if (instEditClose && instEditOverlay) {
      instEditClose.addEventListener('click', () => { instEditOverlay.hidden = true; });
    }
    const instEditSubmit = document.getElementById('instEditSubmit');
    if (instEditSubmit) instEditSubmit.addEventListener('click', submitInstEdit);

    // 面板折叠状态持久化（enhance/inst/as/list）
    (function persistDetailsState() {
      const KEY = 'ws-pool-details-open';
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
      const ids = ['enhanceDetails', 'instDetails', 'acDetails', 'asDetails', 'listDetails'];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (Object.prototype.hasOwnProperty.call(saved, id)) {
          if (saved[id]) el.setAttribute('open', ''); else el.removeAttribute('open');
        }
        el.addEventListener('toggle', () => {
          try {
            const cur = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
            cur[id] = el.open;
            localStorage.setItem(KEY, JSON.stringify(cur));
          } catch {}
        });
      });
    })();

    // Windsurf 增强开关按钮（直接绑定到按钮，避免 summary 冒泡和子元素点击失效）
    if (enhanceToggleBtn) {
      enhanceToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        postMsg('toggleEnhancement', {});
      });
    }

    // Windsurf 增强按钮事件
    if (enhanceReinjectBtn) {
      enhanceReinjectBtn.addEventListener('click', () => {
        postMsg('runCommand', { command: 'windsurfPool.reinjectEnhancement' });
      });
    }
    if (enhanceInjectRulesBtn) {
      enhanceInjectRulesBtn.addEventListener('click', () => {
        postMsg('runCommand', { command: 'windsurfPool.injectBubbleRules' });
      });
    }
    if (enhanceRestoreBtn) {
      enhanceRestoreBtn.addEventListener('click', () => {
        postMsg('runCommand', { command: 'windsurfPool.restoreWorkbench' });
      });
    }
    var enhResetMachineIdBtn = $('#enhResetMachineIdBtn');
    if (enhResetMachineIdBtn) {
      enhResetMachineIdBtn.addEventListener('click', () => {
        postMsg('resetMachineId');
      });
    }

    // 增强设置控件事件
    loadEnhanceSettings();
    updateBubblePreview();
    // 确保初始 HTML 队列项的事件被绑定（loadEnhanceSettings 可能异步延迟）
    renderQueueList(getQueueFromDOM());

    // ── 自动继续：总开关 ──
    if (enhAutoContinueEnabled) enhAutoContinueEnabled.addEventListener('change', () => {
      toggleAcEnabled(enhAutoContinueEnabled.checked);
      saveEnhanceSettings();
    });

    // ── 自动继续：Tab 切换（只切换面板，不立即变更 continueMode，避免杀掉运行中的长任务） ──
    [acTabGuardian, acTabLongTask].forEach(radio => {
      if (radio) radio.addEventListener('change', () => {
        // G7: 长任务运行中切换到守护 Tab 时确认
        if (_ltRunning && radio.value === 'guardian') {
          if (!confirm('长任务正在运行中，切换将停止长任务。确定切换？')) {
            // 恢复 Tab 选中状态
            if (acTabLongTask) acTabLongTask.checked = true;
            return;
          }
          _ltRunning = false;
          updateLtState('stopped', { reason: '切换到守护模式' });
          saveLtMode('smart');
        }
        switchAcTab(radio.value);
        // 只保存 Tab 偏好，不强制同步 continueMode — 让用户通过控制按钮显式操作
        try {
          const cur = JSON.parse(localStorage.getItem('ws-better-settings') || '{}');
          cur.autoContinueTab = radio.value;
          localStorage.setItem('ws-better-settings', JSON.stringify(cur));
        } catch {}
      });
    });

    // ── 守护面板 + 长任务面板的所有勾选/输入 ──
    const enhSettingsEls = [
      enhBubblesEnabled, enhBubblesAutoSend, enhBubblesTheme, enhBubblesShape, enhLocalizationEnabled,
      enhStatusBarEnabled, enhStatusBarPosition, enhStatusBarStyle, enhSbShowPool, enhSbShowAutoSwitch, enhSbShowInstance,
      // 守护模式
      enhGdAutoContinueBtn, enhGdAutoRetry, enhGdAutoSendOnToolLimit,
      enhGdApproveWeb, enhGdApproveTerminal, enhGdApproveFile, enhGdDismissCorrupt,
      // 长任务模式
      enhLtLoop, enhLtIdleSeconds, enhLtMaxContinue, enhLtMaxSendRetries, enhLtStopOnIntervention,
      // 兼容旧
      enhAutoSwitchOnQuota, enhAutoSwitchOnRateLimit, enhAutoRecoveryEnabled,
      // v6.6.0 恢复确认 Banner
      enhRecoveryConfirmEnabled, enhRecoveryCountdownSeconds,
      // 通知
      enhNotifyEnabled, enhNotifyTrigger, enhNotifySound, enhNotifyDesktop, enhNotifyTone, enhNotifyRepeat, enhCustomTone, enhAudioFile,
      // 恢复规则
      ruleNetworkAction, ruleNetworkMaxRetries, ruleNetworkDelay, ruleQuotaAction, ruleQuotaAfterAction, ruleModelAction, ruleModelAfterAction, ruleContinuationAction, rulePermissionAction, permScopeWeb, permScopeTerminal, permScopeFile, ruleUserAction,
    ];
    enhSettingsEls.forEach(el => {
      if (el) el.addEventListener('change', saveEnhanceSettings);
    });

    // ── 长任务：队列添加（按钮 + Enter 键） ──
    function addQueueItem() {
      const text = acQueueNewText ? acQueueNewText.value.trim() : '';
      if (!text) return;
      const queue = getQueueFromDOM();
      queue.push(text);
      renderQueueList(queue);
      if (acQueueNewText) acQueueNewText.value = '';
      saveEnhanceSettings();
    }
    if (acQueueAddBtn) acQueueAddBtn.addEventListener('click', addQueueItem);
    if (acQueueNewText) acQueueNewText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addQueueItem(); }
    });

    // ── 长任务：控制按钮 ──
    // 通过修改 continueMode 并保存来触发注入脚本的 applySettingsChange
    if (acStartBtn) acStartBtn.addEventListener('click', () => {
      _ltRunning = true;
      updateLtState('running');
      saveLtMode('brainless');
    });
    if (acPauseBtn) acPauseBtn.addEventListener('click', () => {
      _ltRunning = false;
      updateLtState('paused');
      saveLtMode('smart');
    });
    if (acResumeBtn) acResumeBtn.addEventListener('click', () => {
      _ltRunning = true;
      updateLtState('running');
      saveLtMode('brainless');
    });
    if (acStopBtn) acStopBtn.addEventListener('click', () => {
      _ltRunning = false;
      updateLtState('idle');
      saveLtMode('smart');
    });
    if (acForceStopBtn) acForceStopBtn.addEventListener('click', () => {
      _ltRunning = false;
      updateLtState('idle');
      saveLtMode('smart');
      // G5: 发送 force-stop 命令清空输入框 + 取消待执行操作
      vscode.postMessage({ type: 'enhForceStop' });
    });
    // 辅助函数：保存设置并强制覆盖 continueMode
    function saveLtMode(mode) {
      const s = collectEnhSettings();
      s.continueMode = mode;
      try { localStorage.setItem('ws-better-settings', JSON.stringify(s)); } catch {}
      vscode.postMessage({ type: 'enhSave', settings: s });
    }

    // 模型优先级添加
    if (modelPriorityAdd) {
      modelPriorityAdd.addEventListener('click', () => {
        const name = (modelPriorityInput ? modelPriorityInput.value : '').trim();
        if (!name) return;
        if (modelPriorityInput) modelPriorityInput.value = '';
        const items = getModelPriorityFromDOM();
        items.push(name);
        renderModelPriority(items);
        saveEnhanceSettings();
      });
    }
    if (modelPriorityInput) {
      modelPriorityInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); if (modelPriorityAdd) modelPriorityAdd.click(); }
      });
    }

    // 测试按钮事件
    if (fetchModelsBtn) {
      fetchModelsBtn.addEventListener('click', () => {
        fetchModelsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>获取中...';
        fetchModelsBtn.disabled = true;
        sendCommand('fetch-models');
        setTimeout(() => {
          if (fetchModelsBtn.disabled) {
            fetchModelsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>获取列表';
            fetchModelsBtn.disabled = false;
            showMsResult(testSwitchModelResult, 'error', '超时未响应（请确认增强脚本已注入）');
          }
        }, 10000);
      });
    }
    // 通用超时：测试命令 12s 无响应则提示脚本未注入
    function sendTestCommand(action, resultEl, extra) {
      sendCommand(action, extra);
      setTimeout(() => {
        if (resultEl && resultEl.classList.contains('show') && resultEl.textContent.includes('中...')) {
          showTestResult(resultEl, 'error', '超时未响应（请确认增强脚本已注入）');
        }
      }, 12000);
    }
    if (testSwitchModelBtn) {
      testSwitchModelBtn.addEventListener('click', () => {
        const priority = getModelPriorityFromDOM();
        if (priority.length === 0) {
          showMsResult(testSwitchModelResult, 'error', '请先添加备选模型');
          return;
        }
        showMsResult(testSwitchModelResult, 'running', '正在切换到 ' + priority[0] + '...');
        sendTestCommand('test-switch-model', testSwitchModelResult, { model: priority[0] });
      });
    }
    if (testRetryBtn) {
      testRetryBtn.addEventListener('click', () => {
        showTestResult(testRetryResult, 'running', '测试中...');
        sendTestCommand('test-retry', testRetryResult);
      });
    }
    if (testSwitchAccountBtn) {
      testSwitchAccountBtn.addEventListener('click', () => {
        showTestResult(testSwitchAccountResult, 'running', '测试中...');
        sendTestCommand('test-switch-account', testSwitchAccountResult);
      });
    }
    if (testSendContinueBtn) {
      testSendContinueBtn.addEventListener('click', () => {
        const text = (getQueueFromDOM()[0] || 'continue');
        showTestResult(testSendContinueResult, 'running', '测试中...');
        sendTestCommand('test-send-continue', testSendContinueResult, { text });
      });
    }
    if (testPermissionBtn) {
      testPermissionBtn.addEventListener('click', () => {
        showTestResult(testPermissionResult, 'running', '测试中...');
        sendTestCommand('test-permission', testPermissionResult);
      });
    }

    // 初始获取当前模型名
    sendCommand('get-current-model');

    // 自定义规则添加
    if (customRuleAdd) {
      customRuleAdd.addEventListener('click', () => {
        const rules = collectCustomRules();
        rules.push({ name: '新规则', pattern: '', action: 'retry', enabled: true });
        renderCustomRules(rules);
        saveEnhanceSettings();
      });
    }

    // v6.6.0 清除恢复偏好按钮
    if (enhRecoveryPrefsClear) {
      enhRecoveryPrefsClear.addEventListener('click', () => {
        try {
          // 优先通过 vscode message 让扩展宿主走桥接通知 windsurf-better.js 清理
          // 这里直接清空 webview 本地 localStorage 作为兜底
          localStorage.removeItem('ws-recovery-prefs');
        } catch {}
        // 通知 windsurf-better.js 也清理一遍（它有自己独立的 localStorage scope）
        sendCommand('clear-recovery-prefs');
        const btn = enhRecoveryPrefsClear;
        const old = btn.textContent;
        btn.textContent = '已清除 ✓';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1500);
      });
    }

    // 浏览音频文件按钮
    if (enhAudioFileBrowse) {
      enhAudioFileBrowse.addEventListener('click', () => {
        postMsg('browseAudioFile', {});
      });
    }

    // ==================== AutoRecovery 日志面板 ====================
    const recoveryLogList = document.getElementById('recoveryLogList');
    const recoveryLogCount = document.getElementById('recoveryLogCount');
    const recoveryLogFilter = document.getElementById('recoveryLogFilter');
    const recoveryLogRefresh = document.getElementById('recoveryLogRefresh');
    const recoveryLogClear = document.getElementById('recoveryLogClear');

    function fmtRecoveryTime(ts) {
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, '0');
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      const time = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      return sameDay ? time : (pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + time);
    }

    function renderRecoveryLog() {
      if (!recoveryLogList) return;
      let list = [];
      try {
        const raw = localStorage.getItem('ws-recovery-log');
        if (raw) list = JSON.parse(raw) || [];
      } catch {}
      const filter = recoveryLogFilter ? recoveryLogFilter.value : '';
      const filtered = filter ? list.filter(e => e.category === filter) : list;
      if (recoveryLogCount) recoveryLogCount.textContent = String(filtered.length);
      if (filtered.length === 0) {
        recoveryLogList.innerHTML = '<div class="recovery-log-empty">暂无恢复记录</div>';
        return;
      }
      // 倒序展示（最新在上）
      const html = filtered.slice().reverse().map(entry => {
        const cat = entry.category || '?';
        const time = fmtRecoveryTime(entry.ts || Date.now());
        const isFailed = String(entry.result || '').startsWith('failed') || entry.result === 'gave-up';
        const errSnippet = entry.error ? escHtml(String(entry.error).slice(0, 200)) : '';
        const action = escHtml(entry.action || '');
        const result = escHtml(entry.result || '');
        const extra = entry.attempt ? ` · 第 ${entry.attempt} 次` : (entry.delay ? ` · ${Math.round(entry.delay/1000)}s` : '');
        return `
          <div class="recovery-log-entry">
            <span class="recovery-log-cat cat-${cat}">${cat}</span>
            <div class="recovery-log-body">
              <div class="recovery-log-meta">
                <span>${time}</span>
                <span class="recovery-log-action">${action}${extra}</span>
                <span class="recovery-log-result${isFailed ? ' is-failed' : ''}">${result}</span>
              </div>
              ${errSnippet ? `<div class="recovery-log-error">${errSnippet}</div>` : ''}
            </div>
          </div>
        `;
      }).join('');
      recoveryLogList.innerHTML = html;
    }

    if (recoveryLogRefresh) recoveryLogRefresh.addEventListener('click', renderRecoveryLog);
    if (recoveryLogFilter) recoveryLogFilter.addEventListener('change', renderRecoveryLog);
    if (recoveryLogClear) {
      recoveryLogClear.addEventListener('click', () => {
        try { localStorage.removeItem('ws-recovery-log'); } catch {}
        renderRecoveryLog();
      });
    }
    // 同步恢复日志到 extension host（供全屏面板使用）
    function syncRecoveryLogsToHost() {
      try {
        const raw = localStorage.getItem('ws-recovery-log');
        const list = raw ? JSON.parse(raw) : [];
        vscode.postMessage({ type: 'syncRecoveryLogs', logs: list });
      } catch {}
    }
    // 同步扫描诊断日志到 extension host
    function syncDiagnoseLogsToHost() {
      try {
        const raw = localStorage.getItem('ws-diagnose-log');
        const list = raw ? JSON.parse(raw) : [];
        vscode.postMessage({ type: 'syncDiagnoseLogs', logs: list });
      } catch {}
    }

    // 首次渲染 + webview 加载时立即同步所有日志
    renderRecoveryLog();
    syncRecoveryLogsToHost();
    syncDiagnoseLogsToHost();
    // 定时刷新（当面板展开时）
    setInterval(() => {
      const details = document.querySelector('.enhance-recovery-log-details');
      if (details && details.open) renderRecoveryLog();
      // 持续同步日志到 globalState（供全屏面板使用）
      syncRecoveryLogsToHost();
      syncDiagnoseLogsToHost();
    }, 5000);

    // 试听按钮：在 webview 中使用 Web Audio API 播放
    let _testAudioCtx = null;
    if (enhNotifyTest) {
      enhNotifyTest.addEventListener('click', () => {
        const TONE_PRESETS = {
          funk: [{freq:587.33,dur:0.12},{freq:783.99,dur:0.12},{freq:880,dur:0.18}],
          ding: [{freq:880,dur:0.25}],
          chime: [{freq:659.25,dur:0.1},{freq:783.99,dur:0.1},{freq:987.77,dur:0.2}],
          beep: [{freq:1000,dur:0.15},{freq:0,dur:0.05},{freq:1000,dur:0.15}],
        };
        const tone = enhNotifyTone ? enhNotifyTone.value : 'funk';
        const repeat = enhNotifyRepeat ? parseInt(enhNotifyRepeat.value) || 2 : 2;
        let notes;
        if (tone === 'custom' && enhCustomTone && enhCustomTone.value.trim()) {
          notes = enhCustomTone.value.split(',').map(p => {
            const [f, d] = p.trim().split(':');
            return { freq: parseFloat(f) || 0, dur: (parseFloat(d) || 150) / 1000 };
          }).filter(n => n.dur > 0);
          if (notes.length === 0) notes = TONE_PRESETS.funk;
        } else {
          notes = TONE_PRESETS[tone] || TONE_PRESETS.funk;
        }
        const duration = notes.reduce((s, n) => s + n.dur, 0);
        if (!_testAudioCtx) _testAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _testAudioCtx;
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => {});
        function playOnce(startOffset) {
          let t = ctx.currentTime + startOffset;
          notes.forEach(n => {
            if (n.freq > 0) {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.value = n.freq;
              gain.gain.setValueAtTime(0.3, t);
              gain.gain.exponentialRampToValueAtTime(0.01, t + n.dur);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start(t);
              osc.stop(t + n.dur);
            }
            t += n.dur;
          });
        }
        for (let i = 0; i < repeat; i++) {
          playOnce(i * (duration + 0.6));
        }
      });
    }

    // 初始加载实例列表
    postMsg('instanceList', {});
    // 主动请求增强状态
    postMsg('getEnhancementStatus', {});
    // 同步标签颜色给其他面板
    postMsg('syncTagColors', { colors: tagColors });

    // 实例状态自动轮询（8s）—— 检测实例启停变化
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        postMsg('instanceList', {});
      }
    }, 8000);

    syncAutoSwitchUI();
    restoreState();
    startAutoRefresh();
    checkBatchResume();

    // ── V2 组件交互初始化 ──

    // V2 Mini Toggle: 点击时同步隐藏 checkbox，触发 change 事件
    document.querySelectorAll('.v2-mini-toggle[data-target]').forEach(toggle => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('is-on');
        const cb = document.getElementById(toggle.dataset.target);
        if (cb) { cb.checked = toggle.classList.contains('is-on'); cb.dispatchEvent(new Event('change', {bubbles:true})); }
      });
    });

    // V2 Tag Chip: 点击时同步隐藏 checkbox
    document.querySelectorAll('.v2-tag[data-target]').forEach(tag => {
      tag.addEventListener('click', () => {
        tag.classList.toggle('is-on');
        const cb = document.getElementById(tag.dataset.target);
        if (cb) { cb.checked = tag.classList.contains('is-on'); cb.dispatchEvent(new Event('change', {bubbles:true})); }
      });
    });

    // V2 Strategy: 兼容旧版（已改为 select）
    window.v2SelectStrategy = function() {};

    // 初始加载后延迟拉配额
    setTimeout(() => {
      if (accounts.length > 0) refreshAll(false, false);
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
