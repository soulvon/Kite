(function () {
    'use strict';

    // ============================================================
    //  自动续聊脚本 — 注入到 Windsurf/Cascade 聊天 webview 中
    //  版本: 2026052101
    // ============================================================

    var VERSION = '2026052101';
    var TAG = '[auto-continue]';

    // ---- 从 URL 参数读取配置 ----
    var continueText = 'Continue';
    var cooldownMs = 3000;
    var limitWindowMs = 600000; // 10 分钟
    var limitCount = 3;
    var initialEnabled = true;

    try {
        var scripts = document.querySelectorAll('script[src*="a8-auto-continue.js"]');
        for (var i = 0; i < scripts.length; i++) {
            var u = new URL(scripts[i].src, location.href);
            if (u.searchParams.has('continue')) {
                initialEnabled = u.searchParams.get('continue') !== '0';
            }
            if (u.searchParams.has('text')) {
                var t = u.searchParams.get('text');
                if (t && t.trim()) continueText = t;
            }
            if (u.searchParams.has('window')) {
                var w = Number(u.searchParams.get('window'));
                if (w >= 0) limitWindowMs = w;
            }
            if (u.searchParams.has('limit')) {
                var l = Number(u.searchParams.get('limit'));
                if (l >= 0) limitCount = l;
            }
            break;
        }
    } catch (e) {}

    // ---- 防重复运行 ----
    if (window.__autoContinueRunning && window.__autoContinueVersion !== VERSION) {
        if (typeof window.acStop === 'function') {
            try { window.acStop(true); } catch (e) {}
        }
    }
    if (window.__autoContinueRunning) return;
    window.__autoContinueRunning = true;
    window.__autoContinueVersion = VERSION;

    // ============================================================
    //  状态变量
    // ============================================================
    var enabled = true;
    var retryCount = 0;
    var lastSendTime = 0;
    var sending = false;
    var pollTimer = null;
    var recentSends = [];
    var limitPaused = false;

    var STORAGE_KEY = 'ac_recent_sends';

    // ---- 从 localStorage 恢复频次记录 ----
    function loadRecentSends() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            return arr.filter(function (v) { return Number.isFinite(Number(v)); }).map(Number);
        } catch (e) {
            return [];
        }
    }

    function saveRecentSends() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(recentSends));
        } catch (e) {}
    }

    recentSends = loadRecentSends();

    // ============================================================
    //  DOM 工具函数
    // ============================================================

    /** 元素是否在页面上可见 */
    function isVisible(el) {
        if (!el) return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    /**
     * 元素是否在终端面板内部 — 这是核心修复：
     * xterm.js 终端会创建 contenteditable 或 textarea 元素用于输入，
     * 如果我们的选择器误匹配到终端里的元素，就会把 "Continue" 打到命令行里。
     * 这里向上遍历祖先，排除任何跟终端/xterm 相关的容器。
     */
    function isInsideTerminal(el) {
        var current = el;
        while (current) {
            // 检查 class — xterm 是终端专用的渲染库
            var cls = current.className || '';
            if (typeof cls === 'string') {
                if (cls.indexOf('xterm') !== -1) return true;
                if (cls.indexOf('terminal-wrapper') !== -1) return true;
                if (cls.indexOf('integrated-terminal') !== -1) return true;
            }
            // 检查 role="tabpanel" 且 aria-label 包含 terminal
            var role = current.getAttribute ? current.getAttribute('role') : null;
            if (role === 'tabpanel') {
                var label = (current.getAttribute('aria-label') || '').toLowerCase();
                if (label.indexOf('terminal') !== -1) return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    /** 元素是否可交互（在聊天输入场景下） */
    function isInteractable(el) {
        if (!isVisible(el)) return false;
        if (isInsideTerminal(el)) return false; // <-- 关键修复
        if (el.matches && el.matches('textarea,input')) {
            return !el.disabled && !el.readOnly;
        }
        return el.isContentEditable || el.getAttribute('contenteditable') === 'true';
    }

    /** 等待指定毫秒 */
    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /** 截断过长字符串，方便日志输出 */
    function truncate(s, maxLen) {
        maxLen = maxLen || 80;
        s = String(s || '').replace(/\s+/g, ' ').trim();
        return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
    }

    // ============================================================
    //  输入框 & 发送按钮 查找
    // ============================================================

    /**
     * 查找聊天输入框 — 按优先级从精确到宽泛逐层回退
     * 返回找到的第一个（DOM 顺序最后）可见且可交互的元素
     */
    function findInputElement() {
        var selectors = [
            'textarea[placeholder="Ask anything"]',
            'div.panel-border textarea',
            'div.panel-border [data-lexical-editor="true"][contenteditable="true"]',
            '[data-lexical-editor="true"][role="textbox"][contenteditable="true"]',
            '[data-lexical-editor="true"][contenteditable="true"]',
            'div[role="textbox"][contenteditable="true"]',
        ];

        for (var i = 0; i < selectors.length; i++) {
            var matches = [];
            var all = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < all.length; j++) {
                if (isInteractable(all[j])) {
                    matches.push(all[j]);
                }
            }
            if (matches.length > 0) {
                return matches[matches.length - 1]; // DOM 顺序最后一个
            }
        }
        return null;
    }

    /** 查找发送按钮的容器选择器 */
    var SEND_BUTTON_SELECTOR = 'div.panel-border button[type="submit"]';

    /** 获取所有可见发送按钮 */
    function findAllSendButtons() {
        var all = document.querySelectorAll(SEND_BUTTON_SELECTOR);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            if (isVisible(all[i])) result.push(all[i]);
        }
        return result;
    }

    /** 找到可点击的发送按钮（未禁用 + 非 loading） */
    function findClickableSendButton() {
        var buttons = findAllSendButtons();
        for (var i = buttons.length - 1; i >= 0; i--) {
            var btn = buttons[i];
            if (!isVisible(btn)) continue;
            if (btn.disabled) continue;
            if (btn.getAttribute('aria-disabled') === 'true') continue;
            if (btn.classList.contains('cursor-not-allowed')) continue;
            return btn;
        }
        return null;
    }

    /** 等待发送按钮就绪，超时返回 null */
    async function waitForSendButton(timeoutMs) {
        timeoutMs = timeoutMs || 2000;
        var start = Date.now();
        while (Date.now() - start <= timeoutMs) {
            var btn = findClickableSendButton();
            if (btn) return btn;
            await sleep(100);
        }
        return null;
    }

    // ============================================================
    //  读取 / 写入 输入框内容
    // ============================================================

    /** 读取输入框当前文本 */
    function readInput(el) {
        if (!el) return '';
        if (el.matches && el.matches('textarea,input')) {
            return (el.value || '').trim();
        }
        return (el.innerText || el.textContent || '').trim();
    }

    /** 判断输入框是否为 contenteditable 类型 */
    function isContentEditableType(el) {
        return !!(el && (el.isContentEditable || el.getAttribute('contenteditable') === 'true'));
    }

    /** 聚焦并选中全部内容 */
    function focusAndSelectAll(el) {
        el.focus();
        var sel = window.getSelection();
        if (!sel) return false;
        var range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
    }

    /** 用 execCommand 写入文本 */
    function writeViaExecCommand(el, text) {
        try {
            if (!focusAndSelectAll(el)) return false;
            var ok = text
                ? document.execCommand('insertText', false, text)
                : document.execCommand('delete', false, null);
            try { window.getSelection().removeAllRanges(); } catch (e) {}
            return ok;
        } catch (e) {
            return false;
        }
    }

    /** 替换 contenteditable 元素的子节点 */
    function replaceChildrenContent(el, text, focusAfter) {
        if (text) {
            var p = document.createElement('p');
            var span = document.createElement('span');
            span.setAttribute('data-lexical-text', 'true');
            span.textContent = text;
            p.appendChild(span);
            el.replaceChildren(p);
        } else {
            el.replaceChildren();
        }
        if (focusAfter !== false) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /** 通过原生 value setter 写入 textarea/input */
    function writeTextarea(el, text) {
        el.focus();
        var proto = el instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (setter) {
            setter.call(el, text);
        } else {
            el.value = text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return readInput(el) === text;
    }

    /** 清空输入框 */
    async function clearInput(el) {
        if (!el) el = findInputElement();
        if (!el) return false;

        try {
            if (el.matches && el.matches('textarea,input')) {
                var proto = el instanceof HTMLTextAreaElement
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                if (setter) setter.call(el, '');
                else el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return !readInput(el);
            }

            el.focus();
            if (writeViaExecCommand(el, '')) {
                await sleep(100);
                if (!readInput(el)) return true;
            }

            replaceChildrenContent(el, '', true);
            await sleep(50);
            if (!readInput(el)) return true;

            replaceChildrenContent(el, '', false);
            await sleep(50);
            return !readInput(el);
        } catch (e) {
            console.warn(TAG, '清空输入框失败:', e);
            return false;
        }
    }

    /** 向输入框写入指定文本（自适应 textarea / contenteditable） */
    async function writeToInput(el, text) {
        if (isContentEditableType(el)) {
            el.focus();
            if (writeViaExecCommand(el, text)) {
                await sleep(150);
                if (readInput(el) === text) return true;
            }
            replaceChildrenContent(el, text);
            await sleep(100);
            return readInput(el) === text;
        }

        return writeTextarea(el, text);
    }

    // ============================================================
    //  异常检测
    // ============================================================

    /**
     * 检查 AI 是否正在生成回复（有加载动画）
     * Cascade 在生成回复时，cascade-scrollbar 里会有 animate-in items-stretch 元素
     */
    function isGenerating() {
        return !!document.querySelector('.cascade-scrollbar div.animate-in.items-stretch');
    }

    /**
     * 检测异常终止标志
     * 在 cascade-scrollbar 中找最后一个消息元素，检查其前一个兄弟是否包含警告图标
     */
    function detectErrorStop() {
        var scrollbar = document.querySelector('.cascade-scrollbar');
        if (!scrollbar) return null;

        var messages = scrollbar.querySelectorAll('div.mark-js-ignore');
        if (messages.length === 0) return null;

        var lastMsg = messages[messages.length - 1];
        var prev = lastMsg.previousElementSibling;
        if (!prev) return null;

        if (prev.querySelector('svg.lucide-triangle-alert')) {
            return { pattern: 'svg.lucide-triangle-alert' };
        }

        return null;
    }

    // ============================================================
    //  发送逻辑
    // ============================================================

    /** 核心发送函数：写入 "Continue" 并点击发送按钮 */
    async function performSend(text) {
        var input = findInputElement();
        if (!input) {
            console.warn(TAG, '未找到可用的聊天输入框');
            return false;
        }

        var buttons = findAllSendButtons();
        if (buttons.length === 0) {
            console.warn(TAG, '发送按钮未就绪，跳过写入');
            return false;
        }

        // 写入文本
        var writeOk = isContentEditableType(input)
            ? await writeToInput(input, text)
            : writeTextarea(input, text);

        if (!writeOk) {
            console.warn(TAG, '写入输入框失败，当前内容:', truncate(readInput(input)));
            await clearInput(input);
            return false;
        }

        // 等待发送按钮就绪
        var btn = await waitForSendButton(2500);
        if (!btn) {
            console.warn(TAG, '未找到可用发送按钮');
            if (readInput(input) === text) await clearInput(input);
            return false;
        }

        // 模拟完整点击序列（某些 UI 需要 hover → mousedown → mouseup → click）
        try {
            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        } catch (e) {}
        btn.click();

        await sleep(500);

        // 验证：输入框应该被清空
        if (readInput(input) === text && !isGenerating()) {
            console.warn(TAG, '发送按钮点击后输入框未清空，可能发送失败');
            await clearInput(input);
            return false;
        }

        return true;
    }

    // ============================================================
    //  频率限制
    // ============================================================

    function checkRateLimit(now) {
        if (limitWindowMs > 0 && limitCount > 0) {
            var oldLen = recentSends.length;
            while (recentSends.length && now - recentSends[0] > limitWindowMs) {
                recentSends.shift();
            }
            if (recentSends.length !== oldLen) saveRecentSends();

            if (recentSends.length >= limitCount) {
                if (!limitPaused) {
                    var remainingSec = Math.max(1, Math.ceil(
                        (limitWindowMs - (now - recentSends[0])) / 1000
                    ));
                    console.warn(
                        TAG,
                        Math.round(limitWindowMs / 1000) + '秒内已达' + limitCount + '次上限，约' +
                        remainingSec + '秒后可再试'
                    );
                    limitPaused = true;
                }
                return false;
            }
        }

        if (limitPaused) {
            limitPaused = false;
            console.log(TAG, '频次冷却完成，已恢复');
        }
        return true;
    }

    function recordSend(now) {
        recentSends.push(now);
        saveRecentSends();
    }

    function rollbackSend() {
        recentSends.pop();
        saveRecentSends();
    }

    // ============================================================
    //  主循环
    // ============================================================

    async function checkAndSend() {
        if (!enabled) return;

        try {
            var now = Date.now();

            // 冷却期检查
            if (now - lastSendTime < cooldownMs) {
                scheduleNext();
                return;
            }

            // 正在生成回复，跳过
            if (isGenerating()) {
                retryCount = 0;
                scheduleNext();
                return;
            }

            // 频率限制
            if (!checkRateLimit(now)) {
                scheduleNext();
                return;
            }

            // 检测异常终止
            var errorInfo = detectErrorStop();
            if (!errorInfo || sending) {
                scheduleNext();
                return;
            }

            // 发送 "Continue"
            sending = true;
            lastSendTime = now;
            retryCount++;
            recordSend(now);

            try {
                var ok = await performSend(continueText);
                if (ok) {
                    console.log(TAG, '检测到异常提示，已发送 ' + continueText + '，匹配:', truncate(errorInfo.pattern, 120));
                } else {
                    // 发送失败，回滚计数
                    retryCount = Math.max(0, retryCount - 1);
                    rollbackSend();
                    console.warn(TAG, '发送失败（写入未生效或发送按钮未就绪），已回滚计数');
                }
            } finally {
                sending = false;
            }
        } catch (e) {
            console.error(TAG, 'error:', e);
        }

        scheduleNext();
    }

    function scheduleNext(delayMs) {
        if (!enabled) return;
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(checkAndSend, delayMs || 2000);
    }

    // ============================================================
    //  "安装损坏" 通知自动清理（附加功能）
    // ============================================================

    function setupNotificationCleaner() {
        var STATUS_SELECTOR = 'footer#workbench\\.parts\\.statusbar\\.part\\.statusbar '
            + '> div.right-items\\.items-container '
            + '> div#status\\.notifications\\.statusbar-item\\.right\\.last-visible-item'
            + '[role="status"][aria-live="off"][tabindex="0"]';

        var LIST_SELECTOR = 'div.notifications-list-container '
            + '> div.monaco-list[role="list"][aria-multiselectable="true"]';

        var CORRUPT_KEYWORDS = ['安装似乎损坏', 'installation appears to be corrupt'];

        var TOOLBAR_BTN_SELECTOR = 'div.notification-list-item-toolbar-container '
            + '> div.monaco-action-bar a.action-label[role="button"]';

        var panelOpen = false;
        var panelOpenTime = 0;
        var lastEnsureTime = 0;
        var CLEANUP_INTERVAL = 2000;
        var INITIAL_DELAY = 5000;
        var WAIT_BEFORE_ENSURE = 20000;
        var RETRY_INTERVAL = 30000;
        var MAX_AGE = 300000; // 5 分钟
        var ensureHoverTimer = null;

        var startupTime = Date.now();

        function clickEl(el) {
            if (!el) return false;
            try {
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
                el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
                el.click();
                return true;
            } catch (e) {
                return false;
            }
        }

        function getToolbarBtn(row) {
            return row.querySelector(TOOLBAR_BTN_SELECTOR);
        }

        function isListVisible() {
            var list = document.querySelector(LIST_SELECTOR);
            return list && isVisible(list);
        }

        function getStatusEl() {
            return document.querySelector(STATUS_SELECTOR);
        }

        function openNotificationPanel() {
            if (isListVisible()) return false;
            var statusEl = getStatusEl();
            if (!statusEl) return false;
            if (!clickEl(statusEl)) return false;
            panelOpen = true;
            panelOpenTime = Date.now();
            return true;
        }

        function closeNotificationPanel() {
            if (!panelOpen) return;
            if (!isListVisible()) { panelOpen = false; return; }
            clickEl(getStatusEl());
            panelOpen = false;
        }

        function buildCorruptSelector(base) {
            return CORRUPT_KEYWORDS.map(function (kw) {
                return base + '.monaco-list-row[role="dialog"][aria-label*="' + kw + '"]';
            }).join(', ');
        }

        function dismissListCorrupt() {
            var list = document.querySelector(LIST_SELECTOR);
            if (!list || !isVisible(list)) return false;
            var sel = buildCorruptSelector(LIST_SELECTOR + ' ');
            var rows = document.querySelectorAll(sel);
            for (var i = 0; i < rows.length; i++) {
                try {
                    rows[i].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                    rows[i].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
                } catch (e) {}
                if (clickEl(getToolbarBtn(rows[i]))) return true;
            }
            return false;
        }

        function dismissToastCorrupt() {
            var toastContainer = document.querySelector('div.notification-toast-container');
            if (!toastContainer) return false;
            var toasts = toastContainer.querySelectorAll('div.notification-toast-container');
            for (var i = 0; i < toasts.length; i++) {
                var row = toasts[i].querySelector(
                    CORRUPT_KEYWORDS.map(function (kw) {
                        return '.monaco-list-row[role="dialog"][aria-label*="' + kw + '"]';
                    }).join(', ')
                );
                if (!row) continue;
                try {
                    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                    row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
                } catch (e) {}
                if (clickEl(getToolbarBtn(row))) return true;
                try { toastContainer.remove(); return true; } catch (e) { return false; }
            }
            return false;
        }

        function dismissCorrupt() {
            return dismissToastCorrupt() || dismissListCorrupt();
        }

        function cleanup() {
            var didClose = false;
            var dismissed = dismissCorrupt();
            if (dismissed) {
                closeNotificationPanel();
                didClose = true;
            }
            if (didClose) return;

            var now = Date.now();
            var age = now - startupTime;

            if (age > MAX_AGE) {
                if (panelOpen && now - panelOpenTime > 1500) {
                    closeNotificationPanel();
                }
                return;
            }

            if (!panelOpen && isListVisible()) return;

            if (panelOpen && now - panelOpenTime > 1500) {
                closeNotificationPanel();
                return;
            }

            var shouldEnsure = lastEnsureTime === 0 && age >= INITIAL_DELAY
                || lastEnsureTime > 0 && now - lastEnsureTime >= RETRY_INTERVAL;

            if (shouldEnsure && openNotificationPanel()) {
                lastEnsureTime = now;
            }
        }

        // 用 MutationObserver 监听 DOM 变化，有新通知时立即检查
        if (!ensureHoverTimer) {
            try {
                var observer = new MutationObserver(function () {
                    if (ensureHoverTimer) return;
                    ensureHoverTimer = setTimeout(function () {
                        ensureHoverTimer = null;
                        try { cleanup(); } catch (e) {}
                    }, 100);
                });
                var bindObserver = function () {
                    if (!document.body) return false;
                    try {
                        observer.observe(document.body, { childList: true, subtree: true });
                        return true;
                    } catch (e) { return false; }
                };
                if (!bindObserver()) {
                    document.addEventListener('DOMContentLoaded', bindObserver, { once: true });
                }
            } catch (e) {}
        }

        // 初始检查
        try { cleanup(); } catch (e) {}

        // 定时轮询
        setInterval(function () {
            try {
                if (dismissCorrupt()) return;
                var age = Date.now() - startupTime;
                if (age > MAX_AGE) {
                    if (panelOpen && Date.now() - panelOpenTime > 1500) closeNotificationPanel();
                    return;
                }
                if (!panelOpen && isListVisible()) return;
                if (panelOpen && Date.now() - panelOpenTime > 1500) {
                    closeNotificationPanel();
                    return;
                }
                var shouldEnsure = lastEnsureTime === 0 && age >= INITIAL_DELAY
                    || lastEnsureTime > 0 && Date.now() - lastEnsureTime >= RETRY_INTERVAL;
                if (shouldEnsure && openNotificationPanel()) {
                    lastEnsureTime = Date.now();
                }
            } catch (e) {}
        }, CLEANUP_INTERVAL);
    }

    // ============================================================
    //  公开 API（挂到 window）
    // ============================================================

    window.acStart = function () {
        enabled = true;
        retryCount = 0;
        sending = false;
        recentSends = loadRecentSends();
        limitPaused = false;
        scheduleNext();
        console.log(TAG, 'started');
    };

    window.acStop = function (silent) {
        enabled = false;
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
        window.__autoContinueRunning = false;
        if (!silent) console.log(TAG, 'stopped');
    };

    window.acResetLimit = function () {
        recentSends = [];
        saveRecentSends();
        limitPaused = false;
        console.log(TAG, '已重置频次计数');
    };

    // ============================================================
    //  启动
    // ============================================================

    function init() {
        // 启动通知清理器
        try { setupNotificationCleaner(); } catch (e) {}

        if (initialEnabled) {
            // 延迟 5 秒开始轮询，等页面完全加载
            scheduleNext(5000);
        } else {
            enabled = false;
            console.log(TAG, '主续聊已禁用（URL 参数 continue=0）');
        }
    }

    init();
})();
