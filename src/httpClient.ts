import * as https from 'https';

/**
 * HTTPS POST 辅助函数
 * 独立 agent：绕过 VS Code 注入的全局代理 agent，直连出站
 */
const directAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  timeout: 15000,
  maxSockets: 6,
});

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const RETRYABLE_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'];

function isRetryable(err: any): boolean {
  const code = err?.code || '';
  const msg = err?.message || '';
  if (RETRYABLE_CODES.includes(code)) return true;
  if (msg.includes('socket disconnected') || msg.includes('TLS') || msg.includes('ECONNRESET')) return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function postOnce(url: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      agent: directAgent,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', (chunk) => buf += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body: buf }));
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * 探测性 POST：发送请求后只等第一个数据块或 HTTP 状态，立即销毁连接。
 * 适用于 streaming RPC 端点（如 GetChatMessage），不消耗完整响应。
 * timeoutMs 默认 20s
 */
export function postProbe(url: string, body: any, headers: Record<string, string> = {}, timeoutMs = 20000, signal?: AbortSignal): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);
    let resolved = false;
    const done = (status: number, bodyStr: string) => {
      if (resolved) return;
      resolved = true;
      try { req.destroy(); } catch {}
      resolve({ status, body: bodyStr });
    };

    // 提前检查 abort
    if (signal?.aborted) { resolve({ status: 0, body: 'aborted' }); return; }

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      agent: directAgent,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      const status = res.statusCode || 0;
      // 非 200 直接返回（401/403/429 等）
      if (status !== 200) {
        let buf = '';
        res.on('data', (chunk) => { buf += chunk; if (buf.length > 1000) done(status, buf); });
        res.on('end', () => done(status, buf));
        return;
      }
      // 200：收集前 2000 字节数据作为证明
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        if (buf.length >= 500) done(status, buf.slice(0, 2000));
      });
      res.on('end', () => done(status, buf));
    });

    // abort 监听：立即销毁连接
    if (signal) {
      const onAbort = () => { done(0, 'aborted'); };
      signal.addEventListener('abort', onAbort, { once: true });
      // 清理
      const origDone = done;
      // req 完成后移除监听
      req.on('close', () => signal.removeEventListener('abort', onAbort));
    }

    req.on('timeout', () => {
      done(0, 'timeout');
    });
    req.on('error', (err) => {
      if (!resolved) { resolved = true; reject(err); }
    });
    req.write(data);
    req.end();
  });
}

export async function post(url: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await postOnce(url, body, headers);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * 通用 HTTP 请求（GET / POST / PUT / DELETE 等），带重试，复用直连 agent。
 */
function httpRequestOnce(method: string, url: string, body?: any, headers: Record<string, string> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const hasBody = body !== undefined && body !== null;
    const data = hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';

    const finalHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
    if (hasBody) {
      if (!finalHeaders['Content-Type'] && !finalHeaders['content-type']) {
        finalHeaders['Content-Type'] = 'application/json';
      }
      finalHeaders['Content-Length'] = String(Buffer.byteLength(data));
    }

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method.toUpperCase(),
      agent: directAgent,
      timeout: timeoutMs,
      headers: finalHeaders,
    };

    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', (chunk) => buf += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body: buf }));
    });

    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (hasBody) req.write(data);
    req.end();
  });
}

export async function httpRequest(method: string, url: string, body?: any, headers: Record<string, string> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ status: number; body: string }> {
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await httpRequestOnce(method, url, body, headers, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
