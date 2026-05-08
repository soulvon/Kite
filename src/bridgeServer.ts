import * as http from 'http';
import * as crypto from 'crypto';

/**
 * Bridge HTTP Server (localhost only)
 *
 * 用途：跨 origin 通信桥
 *   - webview ↔ workbench (windsurf-better.js) 之间无法直接通信（origin 隔离）
 *   - 扩展宿主进程起一个 localhost HTTP server 作中转
 *
 * 数据流：
 *   1. webview ─postMessage('enhCommand')→ 扩展宿主 ─enqueueCommand─→ 内部队列
 *   2. windsurf-better.js ─GET /pending─→ 取出待执行命令 → 执行
 *   3. windsurf-better.js ─POST /result─→ 扩展宿主 ─postMessage─→ webview
 *
 * 安全：
 *   - 只绑定 127.0.0.1，外部不可访问
 *   - 每次启动随机 token，client 必须在 X-Bridge-Token header 提供
 *   - port 由 OS 分配（listen(0)），避免冲突
 */

export interface BridgeInfo {
  port: number;
  token: string;
}

export interface PendingCommand {
  id: number;
  action: string;
  payload: any;
  ts: number;
}

let server: http.Server | null = null;
let port = 0;
let token = '';
const pendingQueue: PendingCommand[] = [];
const resultListeners: Array<(result: any) => void> = [];

export function getBridgeInfo(): BridgeInfo | null {
  if (!server || !port) return null;
  return { port, token };
}

export function startBridgeServer(opts?: { preferredPort?: number; preferredToken?: string }): Promise<BridgeInfo> {
  return new Promise((resolve, reject) => {
    if (server && port) return resolve({ port, token });
    // 复用上次的 token 也很重要：workbench 嵌入的旧 token 这次仍要被校验通过
    token = (opts && opts.preferredToken) || crypto.randomBytes(16).toString('hex');
    server = http.createServer((req, res) => {
      // CORS for vscode-file:// origin
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Bridge-Token');
      // 24h preflight 缓存，避免每秒 GET /pending 都触发 OPTIONS
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      // Token 校验（除了 /ping 健康检查）
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/ping') {
        const reqToken = req.headers['x-bridge-token'];
        if (reqToken !== token) { res.writeHead(401); res.end('unauthorized'); return; }
      }

      if (req.method === 'GET' && url.pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ts: Date.now() }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/pending') {
        // 一次性取出全部待执行命令并清空（windsurf-better.js 每秒轮询一次）
        const out = pendingQueue.splice(0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/result') {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 1024 * 256) req.destroy(); });
        req.on('end', () => {
          try {
            const r = JSON.parse(body);
            for (const fn of resultListeners.slice()) {
              try { fn(r); } catch (err) { console.warn('[bridge] result listener error:', err); }
            }
            res.writeHead(204); res.end();
          } catch {
            res.writeHead(400); res.end('bad json');
          }
        });
        return;
      }

      res.writeHead(404); res.end('not found');
    });

    let triedFallback = false;
    let resolved = false;

    const onListening = () => {
      const addr = server!.address();
      if (addr && typeof addr === 'object') {
        port = addr.port;
        resolved = true;
        const reused = !triedFallback && opts && opts.preferredPort === port;
        console.log(`[bridge] listening on 127.0.0.1:${port}${reused ? ' (reused)' : ''}`);
        resolve({ port, token });
      } else {
        reject(new Error('failed to get server address'));
      }
    };

    server.on('listening', onListening);
    server.on('error', err => {
      if (resolved) return;
      // 端口被占 → fallback 到 OS 分配（仅当指定了首选端口且未尝试过 fallback）
      if ((err as any).code === 'EADDRINUSE' && !triedFallback && opts && opts.preferredPort) {
        triedFallback = true;
        console.warn(`[bridge] preferred port ${opts.preferredPort} busy, falling back to OS-assigned`);
        // 直接 listen(0)，复用同一个 server 实例（监听器仍生效）
        try { server!.listen(0, '127.0.0.1'); } catch (e) { reject(e); }
        return;
      }
      console.error('[bridge] server error:', err);
      server = null;
      port = 0;
      reject(err);
    });

    // 优先用上次的端口（windsurf-better.js 已嵌入此值）；不行则 OS 分配
    const tryPort = (opts && opts.preferredPort) || 0;
    server.listen(tryPort, '127.0.0.1');
  });
}

export function stopBridgeServer(): void {
  if (server) {
    try { server.close(); } catch {}
    server = null;
    port = 0;
    token = '';
    pendingQueue.length = 0;
    resultListeners.length = 0;
  }
}

/**
 * 扩展宿主入队一条命令，等待 windsurf-better.js 来 GET /pending 取走
 */
export function enqueueCommand(cmd: { id: number; action: string; payload?: any }): void {
  pendingQueue.push({
    id: cmd.id,
    action: cmd.action,
    payload: cmd.payload || {},
    ts: Date.now(),
  });
  // 防止队列无限增长（如果 windsurf-better.js 没启动）
  while (pendingQueue.length > 100) pendingQueue.shift();
}

/**
 * 注册 result 监听器，windsurf-better.js POST /result 时被回调
 * 返回取消订阅函数
 */
export function onBridgeResult(fn: (result: any) => void): () => void {
  resultListeners.push(fn);
  return () => {
    const i = resultListeners.indexOf(fn);
    if (i >= 0) resultListeners.splice(i, 1);
  };
}
