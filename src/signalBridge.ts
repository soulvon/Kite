import { AutoSwitcher } from './autoSwitcher';

// ─── 类型定义 ───────────────────────────────────────────

export interface PoolSignal {
  type: 'quota-exhausted'
      | 'quota-daily-exhausted'
      | 'rate-limited'
      | 'provider-overloaded'
      | 'provider-unavailable';
  ts: number;
  lastMessage?: string;
  conversationId?: string;
  retryCount?: number;
  /** 强制执行（测试按钮触发时为 true，绕过 autoSwitchEnabled 等总开关） */
  force?: boolean;
}

export interface PoolResult {
  type: 'switched'
      | 'switch-failed'
      | 'retrying'
      | 'balance-available';  // v7.7.2: 有付费余额时不切号，通知 workbench 发继续
  ts: number;
  email?: string;
  error?: string;
}

/**
 * 生成注入到 sidebarProvider webview 中的 localStorage 信号桥脚本
 * webview 定时轮询 localStorage['ws-pool-signal']
 * 发现新信号 → postMessage → 扩展处理 → 回写 localStorage['ws-pool-result']
 */
export function getSignalBridgeScript(): string {
  return `
    // ── localStorage 信号桥 ──
    (function() {
      let lastSignalTs = 0;

      function pollSignal() {
        try {
          const raw = localStorage.getItem('ws-pool-signal');
          if (!raw) return;
          const signal = JSON.parse(raw);
          if (!signal || !signal.ts) return;
          if (signal.ts <= lastSignalTs) return;
          // 只处理 60s 内的信号，避免处理过期信号
          if (Date.now() - signal.ts > 60000) { lastSignalTs = signal.ts; return; }
          lastSignalTs = signal.ts;
          // 根据设置过滤信号（signal.force=true 时绕过所有开关，用于测试按钮）
          if (!signal.force) {
            try {
              const settingsRaw = localStorage.getItem('ws-better-settings');
              if (settingsRaw) {
                const s = JSON.parse(settingsRaw);
                if (s.autoSwitchEnabled === false) return;
                const isQuota = signal.type === 'quota-exhausted' || signal.type === 'quota-daily-exhausted';
                const isRate = signal.type === 'rate-limited' || signal.type === 'provider-overloaded' || signal.type === 'provider-unavailable';
                if (isQuota && s.autoSwitchOnQuota === false) return;
                if (isRate && s.autoSwitchOnRateLimit === false) return;
              }
            } catch(ex) {}
          }
          // 通知扩展
          vscode.postMessage({ type: 'poolSignal', data: signal });
        } catch(e) {
          // ignore parse errors
        }
      }

      // ── 完成提醒信号轮询 ──
      let lastNotifyTs = 0;
      function pollNotify() {
        try {
          const raw = localStorage.getItem('ws-pool-notify');
          if (!raw) return;
          const sig = JSON.parse(raw);
          if (!sig || !sig.ts) return;
          if (sig.ts <= lastNotifyTs) return;
          if (Date.now() - sig.ts > 30000) { lastNotifyTs = sig.ts; return; }
          lastNotifyTs = sig.ts;
          vscode.postMessage({ type: 'playNotifySound', data: sig });
        } catch(e) {}
      }

      // 轮询间隔 1s（减少信号丢失窗口）
      setInterval(() => { pollSignal(); pollNotify(); }, 1000);

      // webview 恢复可见时立即检查积压信号
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { pollSignal(); pollNotify(); }
      });

      // 接收扩展回复，写入 localStorage 供 windsurf-better.js 读取
      window.addEventListener('message', e => {
        if (e.data && e.data.type === 'poolResult') {
          try {
            localStorage.setItem('ws-pool-result', JSON.stringify(e.data.data));
          } catch(ex) {}
        }
      });
    })();
  `;
}

/**
 * 处理来自 webview 的 poolSignal 消息
 * 触发 autoSwitcher 强制切号并返回结果
 */
export async function handlePoolSignal(
  signal: PoolSignal,
  autoSwitcher: AutoSwitcher,
  respond: (result: PoolResult) => void
): Promise<void> {
  const t0 = Date.now();
  console.log('[signalBridge] 收到信号:', signal.type);

  // 先通知 DOM 正在处理
  respond({ type: 'retrying', ts: t0 });

  try {
    const switched = await autoSwitcher.forceSwitch(signal.type, { force: !!signal.force });
    const elapsed = Date.now() - t0;
    if (switched) {
      // v7.7.2: 余额号保护 — 有余额时不切号，通知 workbench 发继续
      if (switched.email === '__balance_skip__') {
        console.log(`[signalBridge] 跳过切号: 当前账号有付费余额 (${elapsed}ms)`);
        respond({
          type: 'balance-available',
          ts: Date.now(),
        });
        return;
      }
      console.log(`[signalBridge] 切号成功 → ${switched.email} (${elapsed}ms)`);
      respond({
        type: 'switched',
        ts: Date.now(),
        email: switched.email,
      });
    } else {
      console.log(`[signalBridge] 切号失败: 无可用账号 (${elapsed}ms, cache=${autoSwitcher.cacheSize})`);
      respond({
        type: 'switch-failed',
        ts: Date.now(),
        error: `无可用账号(缓存${autoSwitcher.cacheSize}个, 耗时${elapsed}ms)`,
      });
    }
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(`[signalBridge] 切号异常 (${elapsed}ms):`, err);
    respond({
      type: 'switch-failed',
      ts: Date.now(),
      error: `异常: ${String(err)} (${elapsed}ms)`,
    });
  }
}

/**
 * Bridge 中继脚本：sidebar webview（在 workbench 的 iframe 中）把当前进程的
 * bridge port/token 通过 window.top.postMessage 转发给 workbench 顶层 frame。
 *
 * 为什么这样做：
 * - workbench.html 是所有 Windsurf 实例共享的物理文件，无法在注入时区分实例；
 * - 每个实例的 extension host 拥有自己的 sidebar webview，webview 的 iframe
 *   天然嵌在"本进程"的 workbench 顶层 frame 内；
 * - cross-origin window.top.postMessage 是 Web 标准允许的 API，不会跨进程串号。
 *
 * workbench 侧（windsurf-better.js）监听 message 事件拿到 port/token，
 * 之后只连自己这一份 bridge。
 */
export function getBridgeRelayScript(): string {
  return `
    (function() {
      let lastBridge = null;
      function relay(port, token) {
        if (!port || !token) return;
        lastBridge = { port, token };
        // 同时 post 到 top 和 parent，兼容 VSCode webview 嵌套 iframe（outer shell + inner sandbox）
        const payload = { type: 'ws-pool-bridge', port, token };
        try { window.top && window.top.postMessage(payload, '*'); } catch (e) {}
        try { window.parent && window.parent !== window && window.parent.postMessage(payload, '*'); } catch (e) {}
      }
      // 扩展宿主推送 bridgeInfo 时中继
      window.addEventListener('message', e => {
        const d = e && e.data;
        if (d && d.type === 'bridgeInfo' && typeof d.port === 'number' && typeof d.token === 'string') {
          relay(d.port, d.token);
        }
      });
      // 主动请求 bridge 信息：消除"webview 监听器未挂上而 extension 先推送"的竞态
      function requestBridgeInfo() {
        try { vscode.postMessage({ type: 'requestBridgeInfo' }); } catch (e) {}
      }
      // 立即请求 + 没拿到时退避重试（最多 ~30s）
      requestBridgeInfo();
      let retries = 0;
      const reqTimer = setInterval(() => {
        if (lastBridge || retries++ > 15) { clearInterval(reqTimer); return; }
        requestBridgeInfo();
      }, 2000);
      // 定时重播：保证 workbench 脚本即使晚于 sidebar 启动也能收到
      setInterval(() => { if (lastBridge) relay(lastBridge.port, lastBridge.token); }, 5000);
    })();
  `;
}
