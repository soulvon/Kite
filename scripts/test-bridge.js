const http = require('http');
const TOKEN = '9aa2e8c6d8ef9a8d0a49fce7d805d234';
const PORT = 59104;

function req(method, path, body) {
  return new Promise((resolve) => {
    const opts = {
      host: '127.0.0.1', port: PORT, path, method,
      headers: { 'X-Bridge-Token': TOKEN, 'Content-Type': 'application/json' },
      timeout: 3000,
    };
    const r = http.request(opts, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', (e) => resolve({ err: e.code }));
    r.on('timeout', () => { r.destroy(); resolve({ err: 'TIMEOUT' }); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  console.log('=== 1. ping ===');
  console.log(await req('GET', '/ping'));

  console.log('\n=== 2. GET /pending (应为空) ===');
  console.log(await req('GET', '/pending'));

  console.log('\n=== 3. POST 伪造 result ===');
  const fake = await req('POST', '/result', { id: 9999, action: 'test-send-continue', status: 'done', message: 'fake-response-from-node-script', ts: Date.now() });
  console.log(fake);

  console.log('\n=== 4. 再 GET /pending 看有没有命令堆积 ===');
  console.log(await req('GET', '/pending'));

  console.log('\n=== 5. 连续 5 秒每秒 GET /pending 看轮询活性 ===');
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const pending = await req('GET', '/pending');
    console.log(`t+${i+1}s:`, pending.body);
  }
})();
