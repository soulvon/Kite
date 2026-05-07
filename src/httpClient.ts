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
