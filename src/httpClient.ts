import * as https from 'https';

/**
 * HTTPS POST 辅助函数
 * 独立 agent：绕过 VS Code 注入的全局代理 agent，直连出站
 */
const directAgent = new https.Agent({ keepAlive: true });

export function post(url: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      agent: directAgent,
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

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
