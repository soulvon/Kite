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
}

export interface PoolResult {
  type: 'switched'
      | 'switch-failed'
      | 'retrying';
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
          // 根据设置过滤信号
          try {
            const settingsRaw = localStorage.getItem('ws-better-settings');
            if (settingsRaw) {
              const s = JSON.parse(settingsRaw);
              const isQuota = signal.type === 'quota-exhausted' || signal.type === 'quota-daily-exhausted';
              const isRate = signal.type === 'rate-limited' || signal.type === 'provider-overloaded' || signal.type === 'provider-unavailable';
              if (isQuota && s.autoSwitchOnQuota === false) return;
              if (isRate && s.autoSwitchOnRateLimit === false) return;
            }
          } catch(ex) {}
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
    const switched = await autoSwitcher.forceSwitch(signal.type);
    const elapsed = Date.now() - t0;
    if (switched) {
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
